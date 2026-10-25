/* The CAD's PDF and PNG export and printing: Save as PDF (vector, black on white, each sheet at its
   own paper size), the Export dialog (PDF or PNG of one sheet, all sheets or each sheet), and Print
   (Ctrl+P) of a sheet, all sheets or the bill of materials through the browser's print dialog.
   drawSheet stays in cad-app.js: it draws the parts with the editor's own code. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadExport = function (cad) {
    const { S, baseName, bind, bomData, compBBox, currentSheet, drawSheet, frames, setStatus, sheetNo } = cad;
    // Save as PDF: the sheet in vector form, black on white. With a drawing frame the
    // page is that sheet (A4…A1, landscape or portrait, 1:1); without one, the drawing's bounds.
    // drawing bounds of everything (a circuit without a drawing frame)
    function drawingBounds() {
      let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
      S.comps.forEach(c => { const b = compBBox(c); x1 = Math.min(x1, b.x1 - 60); y1 = Math.min(y1, b.y1 - 40); x2 = Math.max(x2, b.x2 + 60); y2 = Math.max(y2, b.y2 + 40); });
      S.wires.forEach(w => { x1 = Math.min(x1, w.x1, w.x2); y1 = Math.min(y1, w.y1, w.y2); x2 = Math.max(x2, w.x1, w.x2); y2 = Math.max(y2, w.y1, w.y2); });
      return isFinite(x1) ? { x1, y1, x2, y2 } : { x1: 0, y1: 0, x2: 1188, y2: 840 };
    }
    // sheets: the frames to print (default all), one page each; name: the file name without .pdf
    function exportPDF(download, sheets, name) {
      const MMU = CadLib.MM, k = 72 / 25.4 / MMU;         // pt per drawing unit
      const list = sheets || frames(), f = list[0];
      let page;
      if (f) page = list.map(fr => { const g = CadLib.sheetGeom(fr); return { widthPt: g.W * k, heightPt: g.H * k, k, ox: fr.x, oy: fr.y, frame: fr }; });
      else { const { x1, y1, x2, y2 } = drawingBounds(); page = { widthPt: (x2 - x1) * k, heightPt: (y2 - y1) * k, k, ox: x1, oy: y1 }; }
      const bytes = PdfExport.buildPdf(page, (pc, i) => drawSheet(pc, Array.isArray(page) ? page[i].frame : null), { title: f && f.params.title });
      if (download !== false) {
        const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
        const file = (name || baseName()) + ".pdf";
        a.download = file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        setStatus("ok", `Saved ${file} (${list.length > 1 ? list.length + " sheets, " : ""}${Math.round(bytes.length / 1024)} kB)`);
      }
      return bytes;
    }
    // PNG of one sheet (or of the whole drawing without frames) at dpi. "print" colours are
    // those of the PDF (black on white, same luminance rule); "screen" keeps the editor's.
    // Very large sheets come out at a lower resolution: a canvas holds at most ~16k px a side.
    function renderPNG(frame, dpi, colours) {
      const b = frame ? compBBox(frame) : drawingBounds(), W = b.x2 - b.x1, H = b.y2 - b.y1;
      let scale = dpi / 25.4 / CadLib.MM;
      const limit = Math.min(16384 / W, 16384 / H, Math.sqrt(120e6 / (W * H)));
      if (scale > limit) scale = limit;
      const cv = document.createElement("canvas"); cv.width = Math.round(W * scale); cv.height = Math.round(H * scale);
      const c2 = cv.getContext("2d"), print = colours !== "screen";
      c2.fillStyle = print ? "#ffffff" : "#0a0e14"; c2.fillRect(0, 0, cv.width, cv.height);
      c2.setTransform(scale, 0, 0, scale, -b.x1 * scale, -b.y1 * scale);
      // print colours: every fill and stroke colour becomes black or white as it is set; reads
      // give back the drawing's own colour (code like fillStyle = strokeStyle copies it), and
      // save/restore keep those in step with the canvas state
      let orig = { fillStyle: "#000", strokeStyle: "#000" };
      const stack = [];
      const target = !print ? c2 : new Proxy(c2, {
        get: (t, p) => {
          if (p === "fillStyle" || p === "strokeStyle") return orig[p];
          if (p === "save") return () => { stack.push(Object.assign({}, orig)); t.save(); };
          if (p === "restore") return () => { if (stack.length) orig = stack.pop(); t.restore(); };
          const v = t[p]; return typeof v === "function" ? v.bind(t) : v;
        },
        set: (t, p, v) => {
          if ((p === "fillStyle" || p === "strokeStyle") && typeof v === "string") { orig[p] = v; v = PdfExport.ink(v) ? "#ffffff" : "#000000"; }
          t[p] = v; return true;
        }
      });
      drawSheet(target, frame);
      return { canvas: cv, dpi: Math.round(scale * 25.4 * CadLib.MM) };
    }
    function download(blob, name) {
      const a = document.createElement("a"); a.href = URL.createObjectURL(blob); a.download = name; a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    }
    const sheetLabel = (f, list) => "Sheet " + sheetNo(f, list) + (f.params.title ? " · " + f.params.title : "");
    // Export dialog: PDF or PNG, of the sheet in use, of all sheets in one PDF, or of each sheet as its own file
    const EXP_KEY = "tubecad_export";
    const expOpts = { fmt: "pdf", which: "current", dpi: "300", colours: "print" };
    try { Object.assign(expOpts, JSON.parse(localStorage.getItem(EXP_KEY)) || {}); } catch (e) {}
    function openExportDialog(fmt) {
      if (fmt) expOpts.fmt = fmt;
      const m = document.getElementById("export-modal"), list = frames(), cur = currentSheet();
      m.dataset.sheet = cur ? cur.id : "";
      document.getElementById("exp-current-name").textContent = cur ? sheetLabel(cur, list) : "the whole drawing (no sheet frame)";
      syncExportDialog(); m.hidden = false;
    }
    function syncExportDialog() {
      const list = frames(), png = expOpts.fmt === "png";
      if (list.length < 2 && expOpts.which !== "current") expOpts.which = "current";
      if (png && expOpts.which === "all") expOpts.which = "each";
      document.querySelectorAll("#export-modal [data-k]").forEach(b => {
        b.classList.toggle("active", expOpts[b.dataset.k] === b.dataset.v);
        if (b.dataset.k === "which") b.disabled = b.dataset.v !== "current" && list.length < 2 || (png && b.dataset.v === "all");
      });
      document.getElementById("exp-png-opts").hidden = !png;
      const n = expOpts.which === "current" ? 1 : list.length;
      document.getElementById("exp-summary").textContent = expOpts.which === "all" ? `One PDF with ${list.length} pages.` : `${n} ${png ? "PNG" : "PDF"} file${n > 1 ? "s" : ""}` + (n > 1 ? ", one per sheet." : ".");
    }
    async function runExport() {
      try { localStorage.setItem(EXP_KEY, JSON.stringify(expOpts)); } catch (e) {}
      document.getElementById("export-modal").hidden = true;
      const list = frames(), cur = S.comps.find(c => c.id === document.getElementById("export-modal").dataset.sheet) || null;
      const sheets = expOpts.which === "current" ? [cur] : list;
      const fileOf = f => baseName() + (f && list.length > 1 ? "-sheet" + sheetNo(f, list) : "");
      if (expOpts.fmt === "pdf") {
        if (expOpts.which === "all") exportPDF(true, list);
        else sheets.forEach(f => exportPDF(true, f ? [f] : null, fileOf(f)));
        if (sheets.length > 1 && expOpts.which === "each") setStatus("ok", `Saved ${sheets.length} PDF files, one per sheet`);
        return sheets.length;
      }
      let last = null;
      for (const f of sheets) {
        const { canvas: cv, dpi } = renderPNG(f, +expOpts.dpi, expOpts.colours);
        const blob = await new Promise(res => cv.toBlob(res, "image/png"));
        download(blob, fileOf(f) + ".png"); last = { dpi, w: cv.width, h: cv.height, kb: Math.round(blob.size / 1024) };
      }
      setStatus("ok", sheets.length > 1 ? `Saved ${sheets.length} PNG files, one per sheet (${last.dpi} dpi)` : `Saved ${fileOf(sheets[0])}.png (${last.w} × ${last.h} px, ${last.dpi} dpi${last.dpi < +expOpts.dpi ? ", reduced to fit" : ""}, ${last.kb} kB)`);
      return sheets.length;
    }
    // Print (Ctrl+P): this sheet, all sheets or the bill of materials, as the pages Save as PDF
    // makes (vector, black on white, each sheet at its own paper size), through the browser's
    // print dialog (PdfExport.print)
    const prnOpts = { which: "current" };
    const printModal = () => document.getElementById("print-modal");
    const printSheet = () => S.comps.find(c => c.id === printModal().dataset.sheet) || null;
    function openPrintDialog(which) {
      if (which) prnOpts.which = which;
      const cur = currentSheet();
      printModal().dataset.sheet = cur ? cur.id : "";
      syncPrintDialog(); printModal().hidden = false;
    }
    function syncPrintDialog() {
      const list = frames(), cur = printSheet();
      if (list.length < 2 && prnOpts.which === "all") prnOpts.which = "current";
      document.querySelectorAll("#print-modal [data-p]").forEach(b => { b.classList.toggle("active", prnOpts.which === b.dataset.p); b.disabled = b.dataset.p === "all" && list.length < 2; });
      const size = f => { const g = CadLib.sheetGeom(f); return `${f.params.size || "A2"}, ${Math.round(g.W / CadLib.MM)} × ${Math.round(g.H / CadLib.MM)} mm`; };
      document.getElementById("prn-summary").textContent = prnOpts.which === "bom" ? `The bill of materials (${bomData().rows.length} lines), A4 landscape.`
        : prnOpts.which === "all" ? `${list.length} pages, one per sheet.`
        : cur ? `${sheetLabel(cur, list)} (${size(cur)}).` : "The whole drawing on one page (no sheet frame).";
    }
    // the pages to print and a file name for them
    function printPages() {
      if (prnOpts.which === "bom") return { bytes: BomLib.toPdf(bomData()), name: baseName() + "-BOM", what: "the bill of materials" };
      const list = frames(), sheets = prnOpts.which === "all" ? list : list.length ? [printSheet() || list[0]] : null;
      return { bytes: exportPDF(false, sheets), name: baseName(), what: sheets && sheets.length > 1 ? sheets.length + " sheets" : "the sheet" };
    }
    function runPrint() {
      printModal().hidden = true;
      const p = printPages(), how = PdfExport.print(p.bytes, { name: p.name + ".pdf" });
      setStatus(how === "blocked" ? "warn" : "ok", how === "dialog" ? `Printing ${p.what}…`
        : how === "tab" ? `Opened ${p.what} as a PDF in a new tab: print it from there (Ctrl+P)`
        : `The browser blocked the print tab; saved ${p.name}.pdf to print instead`);
      return p;
    }
    // the buttons and dialogs (called from init)
    function initExport() {
        bind("btn-pdf", () => exportPDF());
        bind("btn-print", () => openPrintDialog());
        document.querySelectorAll("#print-modal [data-p]").forEach(b => b.addEventListener("click", () => { prnOpts.which = b.dataset.p; syncPrintDialog(); }));
        bind("btn-prn-cancel", () => { printModal().hidden = true; });
        bind("btn-prn-ok", runPrint);
        bind("btn-prn-pdf", () => { printModal().hidden = true; const p = printPages(); download(new Blob([p.bytes], { type: "application/pdf" }), p.name + ".pdf"); setStatus("ok", `Saved ${p.name}.pdf (${Math.round(p.bytes.length / 1024)} kB)`); });
        printModal().addEventListener("keydown", e => { if (e.key === "Escape") printModal().hidden = true; else if (e.key === "Enter" && e.target.tagName !== "BUTTON") runPrint(); });
        bind("btn-export", () => openExportDialog());
        bind("btn-png", () => openExportDialog("png"));
        document.querySelectorAll("#export-modal [data-k]").forEach(b => b.addEventListener("click", () => { expOpts[b.dataset.k] = b.dataset.v; syncExportDialog(); }));
        bind("btn-exp-cancel", () => { document.getElementById("export-modal").hidden = true; });
        bind("btn-exp-ok", runExport);
        document.getElementById("export-modal").addEventListener("keydown", e => { if (e.key === "Escape") document.getElementById("export-modal").hidden = true; });
    }
    return { expOpts, exportPDF, initExport, openExportDialog, openPrintDialog, printPages, prnOpts, renderPNG, runExport, runPrint };
  };
})(window);
