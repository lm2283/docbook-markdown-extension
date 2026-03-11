type ExtractedDoc = {
  html: string;
  title: string;
  canonicalUrl: string;
  sourceUrl: string;
  docbookBaseUrl: string; // derived from the current URL (version-safe)
  extractedAt: number;
};

function isEligibleDocbookUrl(urlStr: string | undefined): boolean {
  if (!urlStr) return false;

  let url: URL;
  try {
    url = new URL(urlStr);
  } catch {
    return false;
  }

  // Must be on the docs site
  if (url.hostname !== "docs.intersystems.com") return false;

  // Must be one of the recognized DocBook viewer pages
  const validPaths = [
    "/csp/docbook/DocBook.UI.Page.cls",
    "/csp/docbook/Doc.View.cls",
  ];
  
  if (!validPaths.some(p => url.pathname.includes(p))) {
    return false;
  }

  // Must have a KEY parameter
  const key = url.searchParams.get("KEY");
  if (!key || key.trim().length === 0) return false;

  return true;
}

async function extractFromActiveTab(tabId: number): Promise<ExtractedDoc> {
  // In Chrome, executeScript return values must be JSON-serializable. :contentReference[oaicite:2]{index=2}
  const results = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => {
      const pickRoot = (): Element | null => {
        return (
          document.querySelector("article") ||
          document.querySelector("main") ||
          document.body
        );
      };

      const root = pickRoot();
      const canonicalUrl =
        document.querySelector<HTMLLinkElement>('link[rel~="canonical"]')?.href || "";

      const sourceUrl = location.href;

      // Derive "https://docs.intersystems.com/<version>/csp/docbook/"
      const u = new URL(sourceUrl);
      const marker = "/csp/docbook/";
      const idx = u.pathname.indexOf(marker);
      const docbookBaseUrl =
        idx >= 0 ? `${u.origin}${u.pathname.slice(0, idx + marker.length)}` : `${u.origin}/`;

      return {
        html: root ? (root as HTMLElement).outerHTML : "",
        title: document.title || "",
        canonicalUrl,
        sourceUrl,
        docbookBaseUrl,
        extractedAt: Date.now(),
      };
    },
  });

  const first = results?.[0] as { result?: ExtractedDoc } | undefined;
  const payload = first?.result;

  if (!payload || !payload.html) {
    throw new Error("Extractor returned empty HTML.");
  }

  return payload;
}

chrome.action.onClicked.addListener(async (tab: chrome.tabs.Tab) => {
  const ok = isEligibleDocbookUrl(tab.url);

  if (!ok) {
    const url = chrome.runtime.getURL("viewer.html?error=not-docbook");
    const newIndex = (tab.index ?? 0) + 1;
    await chrome.tabs.create({ url: url, index: newIndex });
    return;
  }

  if (!tab.id) {
    const url = chrome.runtime.getURL("viewer.html?error=no-tab-id");
    const newIndex = (tab.index ?? 0) + 1;
    await chrome.tabs.create({ url: url, index: newIndex });
    return;
  }

  try {
    const payload = await extractFromActiveTab(tab.id);
    const docId = crypto.randomUUID();

    await chrome.storage.session.set({ [docId]: payload });

    const viewerUrl = chrome.runtime.getURL(`viewer.html?doc=${encodeURIComponent(docId)}`);
    const newIndex = (tab.index ?? 0) + 1;
    await chrome.tabs.create({ url: viewerUrl, index: newIndex });
  } catch (err) {
    console.error(err);
    const viewerUrl = chrome.runtime.getURL("viewer.html?error=extract-failed");
    const newIndex = (tab.index ?? 0) + 1;
    await chrome.tabs.create({ url: viewerUrl, index: newIndex });
  }
});