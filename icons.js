/* The app's line icons: 16 × 16, drawn in the text colour (class "ico" in ui.css), the same
   style as the Board's tool icons. Everything is here, nothing is fetched.
   An element with data-ico="name" gets its icon when the page loads: a button gets it in front
   of its name; a menu item gets it inside a span with the name (span.ico-l), so the shortcut or
   note after it stays on the right. The text nodes are moved, not rewritten, so the language
   switch (i18n.js) keeps working. Icons.svg(name) gives the markup for scripts that build
   their own buttons. */
(function (root) {
  "use strict";
  const DOC = `<path d="M9.5 1.5H4a1 1 0 0 0-1 1v11a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1V5z"/><path d="M9.5 1.5V5H13"/>`;
  const AXES = `<path d="M1.5 1.5v13h13"/>`;
  const P = {
    // CAD tools and view
    select: `<path d="M3.5 2l9 5.2-4.2 1.1-2 4z"/>`,
    wire: `<circle cx="2.8" cy="12.5" r="1.3"/><circle cx="13.2" cy="3.5" r="1.3"/><path d="M4.1 12.5H8V3.5h3.9"/>`,
    probe: `<path d="M11 1.5l3.5 3.5-6.5 6.5L4.5 8z"/><path d="M6.2 9.8 1.5 14.5"/><path d="M9 4.5l2.5 2.5"/>`,
    fit: `<path d="M1.5 5V1.5H5M11 1.5h3.5V5M14.5 11v3.5H11M5 14.5H1.5V11"/><rect x="5" y="5" width="6" height="6" rx=".5"/>`,
    inspector: `<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M10 2.5v11M11.8 5.5h1M11.8 8h1M11.8 10.5h1"/>`,
    // files
    "new": DOC + `<path d="M8 7.5v4M6 9.5h4"/>`,
    sheet: `<path d="M5.5 1.5h7a1 1 0 0 1 1 1v9"/><rect x="2.5" y="4.5" width="8" height="10" rx="1"/><path d="M6.5 7.5v4M4.5 9.5h4"/>`,
    open: `<path d="M1.5 4a1 1 0 0 1 1-1h3.5l1.5 1.5h6a1 1 0 0 1 1 1V12a1 1 0 0 1-1 1h-11a1 1 0 0 1-1-1z"/>`,
    save: `<path d="M2.5 2.5h9l2 2v9h-11z"/><path d="M5 2.5V6h5V2.5"/><path d="M4.5 13.5V9.5h7v4"/>`,
    "save-as": `<path d="M8 13.5H2.5v-11h9l2 2V7"/><path d="M5 2.5V6h5V2.5"/><path d="M13.5 9l1 1-4 4H9.5v-1z"/>`,
    link: `<path d="M6.5 9.5l3-3"/><path d="M7 4.6l1.3-1.3a2.6 2.6 0 0 1 3.7 3.7L10.7 8.3"/><path d="M5.3 7.7 4 9a2.6 2.6 0 0 0 3.7 3.7L9 11.4"/>`,
    history: `<path d="M2.5 8a5.5 5.5 0 1 0 1.6-3.9"/><path d="M2 1.8V5h3.2"/><path d="M8 5v3.2l2.2 1.4"/>`,
    gallery: `<rect x="2" y="2" width="5" height="5" rx="1"/><rect x="9" y="2" width="5" height="5" rx="1"/><rect x="2" y="9" width="5" height="5" rx="1"/><rect x="9" y="9" width="5" height="5" rx="1"/>`,
    print: `<path d="M4.5 5.5v-4h7v4"/><path d="M4.5 11.5h-2a1 1 0 0 1-1-1v-4a1 1 0 0 1 1-1h11a1 1 0 0 1 1 1v4a1 1 0 0 1-1 1h-2"/><path d="M4.5 9h7v5.5h-7z"/>`,
    pdf: DOC + `<path d="M8 6.5v5M6 9.5l2 2 2-2"/>`,
    "export": `<path d="M11.5 9.5v4a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-8a1 1 0 0 1 1-1h4"/><path d="M9 1.5h5.5V7M14.5 1.5 7.5 8.5"/>`,
    image: `<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5.5" cy="6.2" r="1.2"/><path d="M1.5 12l4-3.5 3 2.5 2-1.5 4 3"/>`,
    chip: `<rect x="4" y="4" width="8" height="8" rx="1"/><path d="M6.5 1.5V4M9.5 1.5V4M6.5 12v2.5M9.5 12v2.5M1.5 6.5H4M1.5 9.5H4M12 6.5h2.5M12 9.5h2.5"/>`,
    netlist: DOC + `<path d="M5.5 8h5M5.5 10.5h5M5.5 13h3"/>`,
    table: `<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M1.5 6h13M1.5 9.7h13M6 2.5v11"/>`,
    json: `<path d="M5.5 2.5c-1.5 0-2 .5-2 2V6c0 1-.5 2-1.5 2 1 0 1.5 1 1.5 2v1.5c0 1.5.5 2 2 2M10.5 2.5c1.5 0 2 .5 2 2V6c0 1 .5 2 1.5 2-1 0-1.5 1-1.5 2v1.5c0 1.5-.5 2-2 2"/>`,
    download: `<path d="M8 1.5v8.5M4.8 7 8 10.2 11.2 7"/><path d="M2 10.5v3a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1v-3"/>`,
    // what the schematic shows, the analyses under it
    volts: `<path d="M3 3l5 10 5-10"/>`,
    amps: `<path d="M1.5 8h13"/><path d="M7.5 4.5 11 8l-3.5 3.5"/>`,
    legend: `<rect x="2" y="3" width="3" height="3" rx=".5"/><rect x="2" y="10" width="3" height="3" rx=".5"/><path d="M7.5 4.5h6.5M7.5 11.5h6.5"/>`,
    bom: `<rect x="3" y="2.5" width="10" height="12" rx="1"/><path d="M6 1.5h4v2.2H6z"/><path d="M5.5 7h5M5.5 9.5h5M5.5 12h3"/>`,
    checks: `<path d="M8 1.8 14.8 13.8H1.2z"/><path d="M8 6.2v3.6M8 11.8v.1"/>`,
    tolerance: `<path d="M8 2v7.5M4.2 5.8h7.6M4.2 13.5h7.6"/>`,
    power: AXES + `<path d="M3.5 12.5C7.5 12 10.5 9 12.5 3"/>`,
    noise: `<path d="M1 8h2l1-4 1.5 8L7 4.5l1.5 6.5L10 6l1 4 1-2h3"/>`,
    sweep: `<path d="M1.5 13.5h3v-3h3v-3h3v-3h4"/>`,
    listen: `<path d="M2.5 11V8.5a5.5 5.5 0 0 1 11 0V11"/><rect x="1.5" y="10" width="3" height="4.5" rx="1"/><rect x="11.5" y="10" width="3" height="4.5" rx="1"/>`,
    // AI
    chat: `<path d="M2.5 2.5h11a1 1 0 0 1 1 1V10a1 1 0 0 1-1 1H7.5L4 14v-3H2.5a1 1 0 0 1-1-1V3.5a1 1 0 0 1 1-1z"/>`,
    sparkle: `<path d="M6.5 1.5c.4 3 1.6 4.4 5 4.8-3.4.6-4.6 2-5 5-.4-3-1.6-4.4-5-5 3.4-.4 4.6-1.8 5-4.8z"/><path d="M12.5 10v4.5M10.2 12.2h4.6"/>`,
    bulb: `<path d="M6 12v-1.3A4.5 4.5 0 1 1 10 10.7V12z"/><path d="M6.5 14.5h3"/>`,
    wrench: `<path d="M10.5 1.8a3.5 3.5 0 0 0-3.3 4.7L1.9 11.8a1.5 1.5 0 0 0 2.2 2.2l5.3-5.3a3.5 3.5 0 0 0 4.7-3.3l-2.2 2.2-2-.4-.4-2z"/>`,
    datasheet: DOC + `<path d="M5 12.5c1.2-3.5 2.8-4.8 6-5.2"/>`,
    target: `<circle cx="8" cy="8" r="6.5"/><circle cx="8" cy="8" r="3.5"/><circle cx="8" cy="8" r=".6"/>`,
    key: `<circle cx="5" cy="11" r="3"/><path d="M7.2 8.8 14 2M11.5 4.5l2 2M9.6 6.4l1.5 1.5"/>`,
    // instruments and windows
    scope: `<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M3.5 8c1-3 2-3 3 0s2 3 3 0 2-3 3 0"/>`,
    spectrum: `<path d="M1.5 14.5h13"/><path d="M3.5 14.5v-11M6.5 14.5v-6M9.5 14.5v-8M12.5 14.5v-3"/>`,
    bode: AXES + `<path d="M3 4.5h5c2 0 3.5 2 5.5 7.5"/>`,
    tracer: AXES + `<path d="M2 13.5C3 8 4 6 14 6M2 13.5C3 11 4 9.5 14 9.5M2 13.5c1-1 2-1.5 12-1.5"/>`,
    board: `<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><circle cx="5" cy="6" r="1.2"/><circle cx="11" cy="10" r="1.2"/><path d="M6.2 6H9l2 2v.8"/>`,
    tab: `<rect x="1.5" y="2.5" width="13" height="11" rx="1"/><path d="M1.5 6h13M6 2.5V6"/>`,
    book: `<path d="M8 4C6.5 2.5 4 2 1.5 2.5v10C4 12 6.5 12.5 8 14c1.5-1.5 4-2 6.5-1.5v-10C12 2 9.5 2.5 8 4z"/><path d="M8 4v10"/>`,
    wand: `<path d="M2 14 10 6"/><path d="M11.5 1.5v3M10 3h3M14 6.5v2M13 7.5h2"/>`,
    model: AXES + `<path d="M3.5 12.5C5.5 7 8.5 5 14 4.5"/><circle cx="6.5" cy="8.4" r="1"/><circle cx="10.5" cy="5.6" r="1"/>`,
    // board
    cube: `<path d="M8 1.5 14 4.8v6.4L8 14.5 2 11.2V4.8z"/><path d="M2 4.8 8 8l6-3.2M8 8v6.5"/>`,
    axes: `<path d="M3 13V2M3 13h11"/><path d="M1.5 3.5 3 2l1.5 1.5M12.5 11.5 14 13l-1.5 1.5"/>`,
    panels: `<rect x="1.5" y="2.5" width="13" height="11" rx="1.5"/><path d="M5 2.5v11M11 2.5v11"/>`,
    flag: `<path d="M3 14.5v-13"/><path d="M3 2h9.5l-2 3 2 3H3"/>`,
    layout: `<rect x="1.5" y="1.5" width="5" height="5" rx="1"/><rect x="9.5" y="9.5" width="5" height="5" rx="1"/><path d="M6.5 4h4.5a1.5 1.5 0 0 1 1.5 1.5v4"/>`,
    eraser: `<path d="M6 14.5h8.5"/><path d="M2.5 10.5 9 4l4 4-6.5 6.5H5z"/><path d="M5.8 7.2l4 4"/>`,
    server: `<rect x="2" y="2" width="12" height="5" rx="1"/><rect x="2" y="9" width="12" height="5" rx="1"/><path d="M4.5 4.5h1M4.5 11.5h1"/>`,
    sliders: `<path d="M1.5 4h7M11.5 4h3M1.5 8h2M6.5 8h8M1.5 12h8M12.5 12h2"/><circle cx="10" cy="4" r="1.5"/><circle cx="5" cy="8" r="1.5"/><circle cx="11" cy="12" r="1.5"/>`,
    clearance: `<path d="M2 2v12M14 2v12"/><path d="M4.5 8h7M6.5 6 4.5 8l2 2M9.5 6l2 2-2 2"/>`,
    layers: `<path d="M8 1.5 14.5 5 8 8.5 1.5 5z"/><path d="M1.5 8 8 11.5 14.5 8"/><path d="M1.5 11 8 14.5 14.5 11"/>`,
    mirror: `<path d="M8 1.5v13" stroke-dasharray="2 1.6"/><path d="M6 4 2 12h4z"/><path d="M10 4l4 8h-4z"/>`,
    pen: `<path d="M8 14.5 3.5 8 8 1.5 12.5 8z"/><circle cx="8" cy="9" r="1.2"/><path d="M8 1.5v6.3"/>`,
    // edit
    rotate: `<path d="M13 8a5 5 0 1 1-1.6-3.7"/><path d="M11.7 1.6v3h-3"/>`,
    "delete": `<path d="M2.5 4.5h11"/><path d="M6 4.5V2.5h4v2"/><path d="M4 4.5l.8 9.5h6.4l.8-9.5"/><path d="M6.8 7v4.5M9.2 7v4.5"/>`,
    undo: `<path d="M5.5 3.5 2.5 6.5l3 3"/><path d="M2.5 6.5h7a4 4 0 0 1 0 8H7"/>`,
    redo: `<path d="M10.5 3.5l3 3-3 3"/><path d="M13.5 6.5h-7a4 4 0 0 0 0 8H9"/>`,
    copy: `<rect x="5.5" y="5.5" width="9" height="9" rx="1"/><path d="M10.5 5.5v-3a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3"/>`,
    paste: `<rect x="3" y="2.5" width="10" height="12" rx="1"/><path d="M6 1.5h4v2.2H6z"/>`,
    duplicate: `<rect x="5.5" y="5.5" width="9" height="9" rx="1"/><path d="M10.5 5.5v-3a1 1 0 0 0-1-1h-7a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h3"/><path d="M10 8v4M8 10h4"/>`,
    "select-all": `<rect x="2" y="2" width="12" height="12" rx="1" stroke-dasharray="2 2"/><path d="M5.5 8l2 2 3-4"/>`
  };
  const svg = name => P[name] ? `<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">${P[name]}</svg>` : "";
  function node(name) {
    const t = document.createElement("template"); t.innerHTML = svg(name); return t.content.firstChild;
  }
  // give every [data-ico] under root its icon (once)
  function decorate(rootEl) {
    (rootEl || document).querySelectorAll("[data-ico]").forEach(el => {
      if (el.querySelector(":scope > svg.ico, :scope > .ico-l")) return;
      const ico = node(el.dataset.ico); if (!ico) return;
      if (!el.classList.contains("menu-item")) { el.insertBefore(ico, el.firstChild); return; }
      // a menu item: the icon and the name together, the note (kbd / small) still to the right
      const box = document.createElement("span"); box.className = "ico-l"; box.appendChild(ico);
      while (el.firstChild && !(el.firstChild.nodeType === 1 && /^(KBD|SMALL)$/.test(el.firstChild.nodeName))) box.appendChild(el.firstChild);
      el.insertBefore(box, el.firstChild);
    });
  }
  const api = { svg, names: () => Object.keys(P), decorate };
  root.Icons = api;
  if (typeof document !== "undefined") decorate(document);
})(typeof window !== "undefined" ? window : globalThis);
