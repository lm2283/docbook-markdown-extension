import TurndownService from "turndown";
import type { Rule } from "turndown";
import { CONFIG } from "./config.ts";
import { 
  flattenTabs, normalizeTableTitles, promoteGlossaryTerms, linkifyHeadings,
  normalizeCodeBlocks, normalizeAdmonitions, removeImages, singlePassCleanup, 
  slimTableStructures, mergeAdjacentCode, dropEmptyBlocks, cleanCodeText, 
  fixMalformedLists
} from "./domPasses.ts";

function buildTurndown(): TurndownService {
  const td = new TurndownService({
    headingStyle: "atx",
    codeBlockStyle: "fenced",
    fence: "```",
  });

  // Override Turndown's aggressive escaping to match Python's `escape_asterisks=False`
  td.escape = (str: string) => str;

  if (CONFIG.TABLES_AS_HTML) {
    const tableAsHtml: Rule = {
      filter: (node: Node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        (node as Element).tagName === "TABLE",
      replacement: (_content: string, node: Node) =>
        `\n\n${(node as HTMLElement).outerHTML}\n\n`,
    };
    td.addRule("tableAsHtml", tableAsHtml);
  }

  const fencedPre: Rule = {
    filter: (node: Node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      (node as Element).tagName === "PRE",
    replacement: (_content: string, node: Node) => {
      const pre = node as HTMLElement;
      const code = pre.querySelector("code");

      const text = cleanCodeText((code ?? pre).textContent || "");
      if (!code) return `\n\n\`\`\`\n${text}\n\`\`\`\n\n`;

      const langClass = Array.from(code.classList).find(c => c.startsWith("language-"));
      const lang = langClass ? langClass.slice("language-".length) : "";
      const fence = text.includes("```") ? "~~~" : "```";
      
      return `\n\n${fence}${lang}\n${text}\n${fence}\n\n`;
    },
  };
  td.addRule("fencedPre", fencedPre);

  return td;
}

export function convertHtmlToMarkdown(
  articleOuterHtml: string, 
  canonicalUrl: string = "", 
  docbookBaseUrl: string = CONFIG.DOCBOOK_BASE_URL
): string {
  const doc = new DOMParser().parseFromString(articleOuterHtml, "text/html");
  const root = (doc.querySelector("article") ?? doc.body) as Element;

  // Step 1: Structural Passes
  flattenTabs(root);
  normalizeTableTitles(root);
  promoteGlossaryTerms(root);
  linkifyHeadings(root, canonicalUrl);
  normalizeCodeBlocks(root);
  normalizeAdmonitions(root);
  removeImages(root);
  fixMalformedLists(root);

  // Step 2: Single-Pass Visitor
  singlePassCleanup(root, docbookBaseUrl);

  // Step 3: Final Cleanup
  slimTableStructures(root);
  mergeAdjacentCode(root);
  dropEmptyBlocks(root);

  // Markdown Generation
  const td = buildTurndown();
  let md = td.turndown(root as unknown as HTMLElement);

  md = md.replace(/\u00A0/g, " ").replace(/\\_/g, "_");
  return md.replace(/\n{3,}/g, "\n\n").trimEnd() + "\n";
}