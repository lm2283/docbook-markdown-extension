export const CONFIG = {
  DOCBOOK_BASE_URL: "https://docs.intersystems.com/latest/csp/docbook/",
  PRESERVE_LINK_TARGETS: true,
  TABLES_AS_HTML: true,

  TRASH_CLASSES: new Set([
    "copycode", "anchorlink", "tooltip", "tooltiptext",
    "ac-visually-hidden", "superscript", "mobile",
    "righttoccontent", "rightttoctitle",
  ]),
  TRASH_IDS: new Set(["topButton"]),
  
  INLINE_CODE_CLASSES: new Set([
    "varname", "literal", "function", "command", "classname",
    "methodname", "filename", "property", "userinput",
    "systemitem", "replaceable", "keycap", "guilabel",
  ]),

  ADMONITIONS: ["note", "important", "caution", "tip", "warning"],
  
  PRESENTATION_CLASS_RE: /^(COS|SQL|XML|CLS|JS|HTML|PYTHON|NULL)\d+$/i,
  LANG_RE: /language-([A-Za-z0-9_+-]+)/,
  ZWSP_RE: /[\u200b\u200c\u200d\ufeff]/g,
};