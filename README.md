# IRIS DocBook -> Markdown (Browser Extension)

Convert InterSystems IRIS DocBook documentation pages into clean Markdown, with a safe preview, copy/download actions, and strictly offline processing (no network calls from the extension).

## What it does

When you click the extension icon on a supported DocBook page, it:

- Extracts the main article DOM from the active tab (on-demand).
- Converts DocBook HTML to Markdown using a custom pipeline.
- Opens a viewer tab with:
  - Markdown output (editable textarea).
  - Sanitized preview (sandboxed iframe).
  - One-click copy/download.
  - Optional link/table stripping.

## Supported pages

This extension is intentionally scoped to InterSystems IRIS documentation:

- Host must be: `docs.intersystems.com`
- Path must include one of:
  - `/csp/docbook/DocBook.UI.Page.cls`
  - `/csp/docbook/Doc.View.cls`
- URL must include a `KEY=...` query parameter

If you click the icon on an unsupported page, the viewer opens with an explanatory error.

## Install


### Prerequisites

- Node.js (recent LTS recommended).

### Build

```bash
npm install
npm run build
```

### Load into Chrome

1. Open `chrome://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `dist/` folder produced by `npm run build`.

### Load into Edge

1. Open `edge://extensions`.
2. Enable `Developer mode`.
3. Click `Load unpacked`.
4. Select the `dist/` folder produced by `npm run build`.

## Usage

Open a supported IRIS DocBook page:

- Click the extension icon.
- A new tab opens showing the converted Markdown.

In the viewer you can:

* `Copy Markdown`
* `Download .md`
* `Copy Source URL`
* `Clear Session Data`
* Toggle:
  * `Strip Links (Keep Text)`
  * `Remove HTML Tables`

## Output notes

The conversion pipeline does a set of targeted normalizations aimed at DocBook pages:

* Flattens tabbed blocks into headings + content.
* Promotes table titles and glossary entries into headings.
* Normalizes code blocks and attempts language detection (e.g., ObjectScript/SQL/XML/JS/Python).
* Converts admonitions (note/important/caution/tip/warning) into blockquotes with a label.
* Removes images (replaces with a text placeholder when an `alt` value exists).
* Repairs some malformed list structures.
* Emits tables as **raw HTML** by default (optionally removable in the viewer).

Markdown conversion is done via Turndown with a few overrides for better fidelity.

## Security & privacy

This extension is built to be conservative:

* **No network access from extension pages**:

  * Extension CSP includes `connect-src 'none'`.
* Runs only when you click the extension icon
* Only extracts DOM from the **active tab**, and only on supported DocBook URLs.
* Extracted content is stored in a session-scoped manner using **`chrome.storage.session`**.
  * You can clear it immediately via `Clear Session Data`.
* Preview is hardened:
  * Markdown is rendered to HTML locally.
  * HTML is sanitized with DOMPurify and a tight allow-list.
  * Links are rewritten to allow only `http(s)` URLs on `docs.intersystems.com`.
  * Preview is displayed in a sandboxed `iframe` using `srcdoc`.
  * Scripts are blocked.

## Development

Run a local dev server:

```bash
npm run dev
```

Build the unpacked extension:

```bash
npm run build
```

Then load `dist/` via `Load unpacked`.

## Project structure (high level)

* `src/background.ts` - action click handler; validates URL; extracts page DOM; stores session payload; opens viewer.
* `src/viewer.ts` - reads session payload; converts to Markdown; renders output + safe preview; copy/download actions.
* `src/convert.ts` - conversion orchestrator (DOM passes + Turndown).
* `src/domPasses.ts` - targeted DOM normalization passes for InterSystems DocBook HTML.
* `viewer.html` - viewer UI (Markdown + Preview tabs).
* `icons/` - extension icons.