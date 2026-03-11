import { convertHtmlToMarkdown } from "./convert.ts";
import { marked } from "marked";
import createDOMPurify from "dompurify";

type ExtractedDoc = {
  html: string;
  title: string;
  canonicalUrl: string;
  sourceUrl: string;
  docbookBaseUrl: string;
  extractedAt: number;
};

function $(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

function safeFilename(title: string): string {
  const base = (title || "docbook").trim().slice(0, 120);
  return base.replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim() || "docbook";
}

function cleanMarkdown(text: string, stripLinks: boolean, stripTables: boolean): string {
  let cleaned = text;
  if (stripLinks) {
    cleaned = cleaned.replace(/\[([^\]]+)\]\([^)]+\)/g, "$1");
  }
  if (stripTables) {
    cleaned = cleaned.replace(/<table[^>]*>[\s\S]*?<\/table>/gi, "");
    cleaned = cleaned.replace(/\n{3,}/g, "\n\n");
  }
  return cleaned.trimEnd() + "\n";
}

// Helper to show a nice error box and hide the rest of the UI
function triggerFatalError(title: string, description: string, code?: string) {
  const errorBox = $("errorBox");
  const errorTitle = $("errorTitle");
  const errorDesc = $("errorDesc");

  errorTitle.textContent = title;

  // Clear prior content
  errorDesc.textContent = description;

  if (code) {
    errorDesc.appendChild(document.createTextNode(" "));
    const c = document.createElement("code");
    c.textContent = code; // SAFE
    errorDesc.appendChild(c);
  }

  errorBox.style.display = "block";
  document.querySelectorAll(".hidden-on-error").forEach((el) => {
    (el as HTMLElement).style.display = "none";
  });
}

/**
 * --- Preview security strategy ---
 * - Render Markdown -> HTML via marked.
 * - Sanitize HTML via DOMPurify (locally bundled).
 * - Rewrite links:
 *    - allow only https/http to docs.intersystems.com (customizable allowlist)
 *    - force target=_blank + rel=noopener noreferrer
 *    - unwrap everything else (keep link text, drop href)
 * - Inject sanitized HTML into a sandboxed iframe via srcdoc (no scripts allowed).
 */

// Create a DOMPurify instance bound to the extension page Window.
const DOMPurify = createDOMPurify(window);

/** Restrict what links are allowed to open from Preview. */
function isAllowedLinkUrl(u: URL): boolean {
  // Protocol allowlist
  if (u.protocol !== "https:" && u.protocol !== "http:") return false;

  // Host allowlist (tighten/expand as you see fit)
  if (u.hostname !== "docs.intersystems.com") return false;

  return true;
}

/**
 * Resolve and validate an href. Returns absolute URL string if allowed; otherwise null.
 * baseUrl should be the current doc URL (canonical/source) so relative + #hash resolve correctly.
 */
function resolveAndValidateHref(rawHref: string, baseUrl: string): string | null {
  const href = (rawHref || "").trim();
  if (!href) return null;

  let u: URL;
  try {
    u = new URL(href, baseUrl);
  } catch {
    return null;
  }

  if (!isAllowedLinkUrl(u)) return null;
  return u.href;
}

/**
 * Build a safe iframe srcdoc wrapper.
 * Note: the iframe sandbox is the primary defense; this CSP is defense-in-depth.
 */
function buildPreviewSrcdoc(bodyHtml: string): string {
  const csp = [
    "default-src 'none'",
    "script-src 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
    "img-src 'none'",
    "media-src 'none'",
    "connect-src 'none'",
    "style-src 'unsafe-inline'",
  ].join("; ");

  return `<!doctype html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="Content-Security-Policy" content="${csp}">
  <meta name="referrer" content="no-referrer">

  <style>
    :root {
      --bg-color: #ffffff;
      --text-color: #333333;
      --border-color: #dddddd;
      --code-bg: #f3f3f3;
      --pre-bg: #f6f8fa;
      --link-color: #0b57d0;
      --blockquote-border: #dfe2e5;
      --blockquote-text: #6a737d;
    }

    @media (prefers-color-scheme: dark) {
      :root {
        --bg-color: #1e1e1e;
        --text-color: #d4d4d4;
        --border-color: #444444;
        --code-bg: #2d2d2d;
        --pre-bg: #252525;
        --link-color: #5ea5fa;
        --blockquote-border: #555555;
        --blockquote-text: #999999;
      }
    }

    html, body {
      margin: 0;
      padding: 16px;
      font-family: system-ui, sans-serif;
      background-color: var(--bg-color);
      color: var(--text-color);
      line-height: 1.6;
    }

    h1, h2, h3 {
      margin-top: 1.5em;
      margin-bottom: 0.5em;
    }

    h1:first-child {
      margin-top: 0;
    }

    a {
      color: var(--link-color);
      text-decoration: underline;
    }

    code {
      background: var(--code-bg);
      padding: 2px 6px;
      border-radius: 4px;
      font-size: 0.9em;
      font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    }

    pre {
      background: var(--pre-bg);
      padding: 16px;
      border-radius: 8px;
      overflow-x: auto;
      border: 1px solid var(--border-color);
    }

    pre code {
      background: none;
      padding: 0;
    }

    blockquote {
      border-left: 4px solid var(--blockquote-border);
      margin: 0;
      padding-left: 16px;
      color: var(--blockquote-text);
    }

    table {
      border-collapse: collapse;
      width: 100%;
      margin: 16px 0;
    }

    th, td {
      border: 1px solid var(--border-color);
      padding: 8px 12px;
      text-align: left;
      vertical-align: top;
    }
  </style>
</head>
<body>
${bodyHtml}
</body>
</html>`;
}

/**
 * Render markdown safely into the sandboxed preview iframe.
 */
function renderPreviewIntoIframe(frame: HTMLIFrameElement, md: string, baseUrl: string): void {
  // 1) Markdown -> HTML (potentially unsafe)
  const dirtyHtml = marked.parse(md) as string;

  // 2) Sanitize HTML
  // Keep only the tags/attrs you actually need for preview fidelity.
  // (Tables are needed because your pipeline emits raw HTML tables.)
  const cleanHtml = DOMPurify.sanitize(dirtyHtml, {
    ALLOWED_TAGS: [
      "p", "br", "hr",
      "h1", "h2", "h3", "h4", "h5", "h6",
      "strong", "em", "code", "pre", "blockquote",
      "ul", "ol", "li",
      "table", "thead", "tbody", "tfoot", "tr", "th", "td", "caption", "colgroup", "col",
      "a",
    ],
    ALLOWED_ATTR: [
      "href", "title",
      "rowspan", "colspan",
    ],
    // Extra hardening: forbid things that tend to introduce risk or network
    FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "form", "input", "button", "textarea", "img", "svg", "math"],
    FORBID_ATTR: ["style"],
  }) as string;

  // 3) Rewrite links to enforce allowlist + safe opening behavior.
  const doc = new DOMParser().parseFromString(cleanHtml, "text/html");

  for (const a of Array.from(doc.querySelectorAll("a"))) {
    const safeHref = resolveAndValidateHref(a.getAttribute("href") || "", baseUrl);

    if (!safeHref) {
      // Unwrap unsafe links (keep text)
      const text = doc.createTextNode(a.textContent || "");
      a.replaceWith(text);
      continue;
    }

    a.setAttribute("href", safeHref);
    a.setAttribute("target", "_blank");
    a.setAttribute("rel", "noopener noreferrer");
    a.setAttribute("referrerpolicy", "no-referrer");
  }

  // 4) Inject into iframe via srcdoc (iframe is sandboxed in viewer.html)
  frame.srcdoc = buildPreviewSrcdoc(doc.body.innerHTML);
}

function safeDocsUrl(urlStr: string): string | null {
  try {
    const u = new URL(urlStr);
    if ((u.protocol !== "https:" && u.protocol !== "http:") || u.hostname !== "docs.intersystems.com") return null;
    return u.href;
  } catch {
    return null;
  }
}

async function main() {
  const params = new URLSearchParams(location.search);
  const error = params.get("error");
  const docId = params.get("doc");

  const msg = $("msg");
  const titleEl = $("title");
  const urlEl = $("url") as HTMLAnchorElement;

  const out = $("out") as HTMLTextAreaElement;

  // Updated: preview is now an iframe, not a div
  const previewFrame = $("previewFrame") as HTMLIFrameElement;

  const tabMd = $("tabMd") as HTMLButtonElement;
  const tabPreview = $("tabPreview") as HTMLButtonElement;

  const copyMdBtn = $("copyMd") as HTMLButtonElement;
  const downloadBtn = $("downloadMd") as HTMLButtonElement;
  const copyUrlBtn = $("copyUrl") as HTMLButtonElement;
  const clearBtn = $("clear") as HTMLButtonElement;

  const stripLinksCb = $("stripLinks") as HTMLInputElement;
  const stripTablesCb = $("stripTables") as HTMLInputElement;

  const disableActions = () => {
    copyMdBtn.disabled = true;
    downloadBtn.disabled = true;
    copyUrlBtn.disabled = true;
    clearBtn.disabled = true;
    stripLinksCb.disabled = true;
    stripTablesCb.disabled = true;
  };

  const enableActions = () => {
    copyMdBtn.disabled = false;
    downloadBtn.disabled = false;
    copyUrlBtn.disabled = false;
    clearBtn.disabled = false;
    stripLinksCb.disabled = false;
    stripTablesCb.disabled = false;
  };

  disableActions();

  // Tab switching logic
  tabMd.onclick = () => {
    tabMd.classList.add("active");
    tabPreview.classList.remove("active");
    out.style.display = "block";
    previewFrame.style.display = "none";
  };

  tabPreview.onclick = () => {
    tabPreview.classList.add("active");
    tabMd.classList.remove("active");
    previewFrame.style.display = "block";
    out.style.display = "none";
  };

  const ERROR_COPY: Record<string, { title: string; desc: string }> = {
    "not-docbook": {
      title: "Unsupported Page",
      desc: 'This extension only supports InterSystems DocBook pages (URL contains "/csp/docbook/" and has a KEY=... parameter).',
    },
    "no-tab-id": { title: "Tab Error", desc: "Could not determine the active tab ID." },
    "extract-failed": { title: "Extraction Error", desc: "Failed to read the DocBook page DOM." },
  };

  if (error) {
    const known = ERROR_COPY[error];
    if (known) triggerFatalError(known.title, known.desc);
    else triggerFatalError("Error", "Unknown error code:", error);
    return;
  }

  if (!docId) {
    triggerFatalError("Missing Document ID", "No document ID was passed to the viewer. Please click the extension icon again.");
    return;
  }

  msg.textContent = "Loading extracted HTML…";
  const items = await chrome.storage.session.get(docId);
  const payload = items[docId] as ExtractedDoc | undefined;

  if (!payload?.html) {
    triggerFatalError(
      "Session Data Missing",
      "No extracted content found in session storage. The data may have been cleared, or the page was too large. Please go back and click the extension again."
    );
    return;
  }

  // Display URL in header: prefer canonical, but only if it's actually a docs URL.
  const displayUrl = safeDocsUrl(payload.canonicalUrl) ?? safeDocsUrl(payload.sourceUrl) ?? "";
  titleEl.textContent = payload.title || "(untitled)";

  urlEl.textContent = displayUrl || "(no URL)";
  if (displayUrl) {
    urlEl.href = displayUrl;
    urlEl.rel = "noopener noreferrer"; // ensure reverse-tabnabbing protection
  } else {
    // No safe URL -> don't make it clickable
    urlEl.removeAttribute("href");
  }

  msg.textContent = "Converting…";
  // Ensure the UI paints "Converting…" before we do heavy synchronous work.
  await new Promise<void>((r) => requestAnimationFrame(() => r()));

  const baseMd = convertHtmlToMarkdown(payload.html, payload.canonicalUrl, payload.docbookBaseUrl);

  const baseForPreviewLinks =
    // Prefer the actual page URL so #hash and relative links resolve correctly
    (safeDocsUrl(payload.canonicalUrl) ?? safeDocsUrl(payload.sourceUrl) ?? safeDocsUrl(payload.docbookBaseUrl)) ||
    "https://docs.intersystems.com/";

  const render = () => {
    const finalMd = cleanMarkdown(baseMd, stripLinksCb.checked, stripTablesCb.checked);
    out.value = finalMd;

    // Secure preview (no innerHTML in privileged extension DOM)
    renderPreviewIntoIframe(previewFrame, finalMd, baseForPreviewLinks);

    msg.textContent = `Done. (${finalMd.length.toLocaleString()} chars)`;
  };

  render();
  enableActions();

  stripLinksCb.addEventListener("change", render);
  stripTablesCb.addEventListener("change", render);

  // --- Standard Actions ---
  copyMdBtn.onclick = async () => {
    await navigator.clipboard.writeText(out.value);
    msg.textContent = "Copied Markdown.";
  };

  copyUrlBtn.onclick = async () => {
    // Copy the actual source URL (this should always be docs.intersystems.com due to eligibility)
    await navigator.clipboard.writeText(payload.sourceUrl);
    msg.textContent = "Copied source URL.";
  };

  downloadBtn.onclick = () => {
    const blob = new Blob([out.value], { type: "text/markdown;charset=utf-8" });
    const a = document.createElement("a");
    const blobUrl = URL.createObjectURL(blob);
    a.href = blobUrl;
    a.download = `${safeFilename(payload.title)}.md`;
    a.click();
    // Revoke after a tick to avoid edge cases in some browsers
    setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
  };

  clearBtn.onclick = async () => {
    await chrome.storage.session.remove(docId);
    out.value = "";
    previewFrame.srcdoc = "";
    disableActions();
    msg.textContent = "Cleared session data.";
  };
}

// Global catch to handle crashes safely (NO innerHTML)
main().catch((e) => {
  console.error(e);
  try {
    triggerFatalError(
      "Viewer Crashed",
      "An unexpected error occurred during rendering. Please check the Developer Tools console for the exact stack trace."
    );
  } catch {
    // Last-ditch fallback: do nothing (avoid throwing again)
  }
});