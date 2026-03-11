import { CONFIG } from "./config.ts";

// --- Helpers ---

function isBlankTextNode(n: Node | null): boolean {
  if (!n) return false;
  return n.nodeType === Node.TEXT_NODE && !(n.textContent || "").trim();
}

function unwrap(el: Element): void {
  const parent = el.parentNode;
  if (!parent) return;
  while (el.firstChild) {
    parent.insertBefore(el.firstChild, el);
  }
  parent.removeChild(el);
}

export function fixMalformedLists(root: Element): void {
  // Finds lists (ul, ol) that are direct children of another list
  const nestedLists = Array.from(root.querySelectorAll("ul > ul, ul > ol, ol > ul, ol > ol"));
  
  for (const list of nestedLists) {
    const prev = list.previousElementSibling;
    // If the element right before this inner list is an <li>, append the list into it
    if (prev && prev.tagName === "LI") {
      prev.appendChild(list);
    }
  }
}

export function cleanCodeText(s: string): string {
  return s
    .replace(/\u00A0/g, " ")
    .replace(CONFIG.ZWSP_RE, "")
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map(line => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/^\n+|\n+$/g, "");
}

function detectCodeLanguage(spanClasses: string, rawCode: string): string {
  const s = spanClasses.toUpperCase();
  if (/\bSQL\d+\b/.test(s)) return "sql";
  if (/\bPYTHON\d+\b/.test(s)) return "python";
  if (/\bXML\d+\b/.test(s)) return "xml";
  if (/\bJS\d+\b/.test(s)) return "javascript";
  if (/\b(COS|CLS)\d+\b/.test(s)) return "objectscript";

  if (/^\s*(%SYS|[A-Za-z][A-Za-z0-9_]*)>\s*/m.test(rawCode)) {
    return "objectscript";
  }

  const osig = ["##class(", "ClassMethod ", "Class ", "Property ", "Do ", "Write ", "Kill ", "New ", "Set ", "ZWrite", "%Status"];
  let matchCount = 0;
  for (const k of osig) {
    if (rawCode.includes(k)) matchCount++;
  }
  return matchCount >= 3 ? "objectscript" : "";
}

function getAppropriateHeadingLevel(element: Element): string {
  const container = element.closest("section, article");
  if (container) {
    const heading = container.querySelector("h1, h2, h3, h4, h5");
    if (heading) {
      const level = parseInt(heading.tagName[1], 10);
      return `h${Math.min(level + 1, 6)}`;
    }
  }
  return "h3";
}

// --- Structural Passes ---

export function flattenTabs(root: Element): void {
  const tabsElements = Array.from(root.querySelectorAll("div.tabs"));
  for (const tabs of tabsElements) {
    const buttons = Array.from(tabs.querySelectorAll("button.tabtitle"));
    const titles = buttons.map(b => b.getAttribute("data-language") || (b.textContent || "").trim());
    const panels = Array.from(tabs.querySelectorAll("div.tabcontent"));
    const targetH = getAppropriateHeadingLevel(tabs);
    const doc = root.ownerDocument!;

    const flattenedNodes: Node[] = [];
    panels.forEach((panel, i) => {
      const hx = doc.createElement(targetH);
      hx.textContent = (titles[i] && titles[i].trim()) ? titles[i].trim() : `Tab ${i + 1}`;
      flattenedNodes.push(hx);

      panel.querySelectorAll("button, .tooltiptext, .ac-visually-hidden").forEach(x => x.remove());
      
      Array.from(panel.childNodes).forEach(child => {
        if (!isBlankTextNode(child)) flattenedNodes.push(child);
      });
    });

    flattenedNodes.reverse().forEach(node => tabs.after(node));
    tabs.remove();
  }
}

export function normalizeTableTitles(root: Element): void {
  const titles = Array.from(root.querySelectorAll("div.table-title"));
  const doc = root.ownerDocument!;
  for (const tt of titles) {
    const hx = doc.createElement(getAppropriateHeadingLevel(tt));
    if (tt.id) hx.id = tt.id;
    hx.textContent = (tt.textContent || "").trim();
    tt.replaceWith(hx);
  }
}

export function promoteGlossaryTerms(root: Element): void {
  const entries = Array.from(root.querySelectorAll("div.glossentry"));
  const doc = root.ownerDocument!;
  for (const entry of entries) {
    const entryId = entry.id || (entry.parentElement?.tagName === "DIV" ? entry.parentElement.id : null);
    const term = entry.querySelector("span.glossterm, div.glossterm, span.firstterm");
    const hx = doc.createElement(getAppropriateHeadingLevel(entry));
    if (entryId) hx.id = entryId;

    if (term) {
      hx.textContent = (term.textContent || "").trim();
      entry.before(hx);
      term.remove();
      unwrap(entry);
    } else {
      hx.textContent = (entry.textContent || "").trim();
      entry.replaceWith(hx);
    }
  }
}

export function linkifyHeadings(root: Element, canonicalUrl: string): void {
  if (!canonicalUrl) return;
  const headings = Array.from(root.querySelectorAll("h1, h2, h3, h4, h5, h6"));
  const doc = root.ownerDocument!;
  for (const h of headings) {
    let hid = h.id;
    if (!hid) {
      const parentSection = h.closest("section");
      if (parentSection && parentSection.querySelector("h1, h2, h3, h4, h5, h6") === h) {
        hid = parentSection.id;
      }
    }
    if (hid) {
      const a = doc.createElement("a");
      a.href = `${canonicalUrl}#${hid}`;
      while (h.firstChild) a.appendChild(h.firstChild);
      h.appendChild(a);
    }
  }
}

export function normalizeCodeBlocks(root: Element): void {
  const divs = Array.from(root.querySelectorAll("div.programlisting, div.synopsis, div.literallayout"));
  const doc = root.ownerDocument!;
  for (const div of divs) {
    const preTag = div.querySelector("pre");
    if (!preTag) continue;

    const spans = Array.from(preTag.querySelectorAll("span"));
    const spanClasses = spans.map(sp => sp.className).join(" ");
    const rawCode = cleanCodeText(preTag.textContent || "");
    const lang = detectCodeLanguage(spanClasses, rawCode);

    const newPre = doc.createElement("pre");
    const newCode = doc.createElement("code");
    if (lang) newCode.className = `language-${lang}`;
    newCode.textContent = rawCode + "\n";
    
    newPre.appendChild(newCode);
    div.replaceWith(newPre);
  }
}

export function normalizeAdmonitions(root: Element): void {
  const doc = root.ownerDocument!;
  for (const admType of CONFIG.ADMONITIONS) {
    const divs = Array.from(root.querySelectorAll(`div.${admType}, div.box.${admType}`));
    for (const div of divs) {
      div.querySelectorAll(`span.${admType}, div.box-icon`).forEach(el => el.remove());
      div.querySelectorAll("div.box-content").forEach(el => unwrap(el));
      
      Array.from(div.children).forEach(child => {
        if (child.tagName === "DIV" && !(child.textContent || "").trim() && !child.firstElementChild) {
          child.remove();
        }
      });

      const blockquote = doc.createElement("blockquote");
      while (div.firstChild) blockquote.appendChild(div.firstChild);
      
      const strong = doc.createElement("strong");
      strong.textContent = `${admType.charAt(0).toUpperCase() + admType.slice(1)}:`;
      blockquote.prepend(doc.createTextNode(" "));
      blockquote.prepend(strong);
      
      div.replaceWith(blockquote);
    }
  }
}

export function removeImages(root: Element): void {
  const imgs = Array.from(root.querySelectorAll("img"));
  const doc = root.ownerDocument!;
  for (const img of imgs) {
    const alt = (img.getAttribute("alt") || "").trim();
    const placeholderText = alt ? `[Image: ${alt}]` : "";

    const graphic = img.closest("div.graphic");
    if (graphic) {
      const meaningfulKids = Array.from(graphic.childNodes).filter((n) => !isBlankTextNode(n));
      if (meaningfulKids.length === 1) {
        if (placeholderText) graphic.replaceWith(doc.createTextNode(placeholderText));
        else graphic.remove();
        continue;
      }
    }

    if (placeholderText) img.replaceWith(doc.createTextNode(placeholderText));
    else img.remove();
  }
}

export function singlePassCleanup(root: Element, docbookBaseUrl: string): void {
  const all = Array.from(root.querySelectorAll("*"));
  const doc = root.ownerDocument!;

  for (const el of all) {
    if (!el.isConnected) continue;

    const classes = Array.from(el.classList);

    // 1. Trash
    if ((el.id && CONFIG.TRASH_IDS.has(el.id)) || classes.some(c => CONFIG.TRASH_CLASSES.has(c))) {
      el.remove();
      continue;
    }

    // 2. Unwrap Presentation Spans
    if (el.tagName === "SPAN" && classes.some(c => CONFIG.PRESENTATION_CLASS_RE.test(c))) {
      unwrap(el);
      continue;
    }

    // 3. Semantic Spans -> Code
    if (el.tagName === "SPAN" && classes.some(c => CONFIG.INLINE_CODE_CLASSES.has(c))) {
      const code = doc.createElement("code");
      code.textContent = el.textContent || "";
      el.replaceWith(code);
      continue;
    }

    // 5. Link Resolution (Before total attr stripping so we have the raw href)
    if (el.tagName === "A") {
      if (el.closest("code, pre")) {
        unwrap(el);
        continue;
      }
      let href = el.getAttribute("href");
      if (CONFIG.PRESERVE_LINK_TARGETS && href && !href.startsWith("#")) {
        try {
          href = new URL(href, docbookBaseUrl).href;
        } catch { /* Ignore malformed */ }
      }
      
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
      if (CONFIG.PRESERVE_LINK_TARGETS && href) {
        el.setAttribute("href", href);
      } else {
        unwrap(el);
      }
      continue;
    }

    // 4. Strip Attributes 
    if (el.tagName === "TD" || el.tagName === "TH") {
      const rowspan = el.getAttribute("rowspan");
      const colspan = el.getAttribute("colspan");
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
      if (rowspan) el.setAttribute("rowspan", rowspan);
      if (colspan) el.setAttribute("colspan", colspan);
    } else if (el.tagName === "CODE") {
      const langClasses = classes.filter(c => c.startsWith("language-"));
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
      if (langClasses.length) el.className = langClasses.join(" ");
    } else {
      for (const a of Array.from(el.attributes)) el.removeAttribute(a.name);
    }
  }
}

export function slimTableStructures(root: Element): void {
  root.querySelectorAll("td, th").forEach(cell => {
    const kids = Array.from(cell.childNodes).filter(n => !isBlankTextNode(n));
    if (kids.length === 1 && kids[0].nodeType === Node.ELEMENT_NODE && (kids[0] as Element).tagName === "P") {
      unwrap(kids[0] as Element);
    }
  });
  
  root.querySelectorAll("span").forEach(span => {
    if (span.attributes.length === 0) unwrap(span);
  });
  
  root.querySelectorAll("tbody, thead, tfoot").forEach(t => unwrap(t));
}

export function mergeAdjacentCode(root: Element): void {
  const codes = Array.from(root.querySelectorAll("code"));
  for (const code of codes) {
    if (!code.isConnected) continue;
    
    while (true) {
      let nxt = code.nextSibling;
      const wsNodes: Node[] = [];
      
      while (isBlankTextNode(nxt)) {
        wsNodes.push(nxt as Node);
        nxt = nxt!.nextSibling;
      }
      
      if (nxt && nxt.nodeType === Node.ELEMENT_NODE && (nxt as Element).tagName === "CODE") {
        wsNodes.forEach(n => n.parentNode?.removeChild(n));
        if (wsNodes.length > 0) code.appendChild(root.ownerDocument!.createTextNode(" "));
        code.appendChild(root.ownerDocument!.createTextNode(nxt.textContent || ""));
        (nxt as Element).remove();
      } else {
        break;
      }
    }
  }
}

export function dropEmptyBlocks(root: Element): void {
  const blocks = Array.from(root.querySelectorAll("div, p"));
  for (const el of blocks) {
    if (!el.isConnected) continue;
    if (!(el.textContent || "").trim() && !el.firstElementChild) {
      el.remove();
    }
  }
}