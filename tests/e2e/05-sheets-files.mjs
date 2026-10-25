// New, Save as PDF, several sheets, ratings, locked frames, PDF/PNG export, side panels
import { cad, check } from "./harness.mjs";
import { readFile } from "node:fs/promises";
import { scope, spectrum, tracer } from "./02-instruments.mjs";

// --- 12. File menu: New with a drawing frame, Save as PDF --------------------------
{
  await cad.locator("#btn-file").click();
  check(await cad.locator("#file-menu .menu-list").isVisible(), "File menu opens");
  await cad.getByRole("menuitem", { name: /New/ }).click();
  await cad.locator('#new-size .btn[data-v="A4"]').click();
  await cad.locator('#new-orient .btn[data-v="portrait"]').click();
  await cad.locator("#new-title").fill("Test stage");
  await cad.locator("#btn-new-create").click();
  const f = await cad.evaluate(() => { const S = TubeCAD.state, fr = S.comps.find(c => c.type === "frame"); return fr && { n: S.comps.length, w: S.wires.length, p: fr.params, g: CadLib.sheetGeom(fr) }; });
  check(f && f.n === 1 && f.w === 0 && f.p.size === "A4" && f.p.orient === "portrait" && f.p.title === "Test stage" && f.g.W === 210 * 4 && f.g.H === 297 * 4 && f.g.tb.x2 - f.g.tb.x1 === 180 * 4,
    `New… creates an empty sheet with an A4 portrait frame (${f && f.g.W / 4} × ${f && f.g.H / 4} mm, title block ${f && (f.g.tb.x2 - f.g.tb.x1) / 4} mm wide)`);
  await cad.evaluate(() => { const S = TubeCAD.state, C = TubeCAD; const r = C.makeComp("resistor", { r: 4700 }, 400, 400, 0); S.comps.push(r); C.commit(); });
  const pdf = await cad.evaluate(() => { const b = TubeCAD.exportPDF(false); let s = ""; for (const c of b) s += String.fromCharCode(c); return s; });
  const xref = +pdf.match(/startxref\n(\d+)/)[1];
  const offs = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
  check(pdf.startsWith("%PDF-1.4") && /\/MediaBox \[0 0 595.276 841.89\]/.test(pdf) && pdf.slice(xref, xref + 4) === "xref" && offs.every((o, i) => pdf.slice(o).startsWith(`${i + 1} 0 obj`)),
    `Save as PDF: a valid A4 portrait PDF (${pdf.length} bytes, ${offs.length} objects, cross-reference table checks out)`);
  check(/\(R1\) Tj/.test(pdf) && /\(Test stage\) Tj/.test(pdf) && /\/BaseFont \/Courier/.test(pdf) && !/rgb|#/.test(pdf.slice(0, xref).replace(/\/Title \([^)]*\)/, "")),
    "the PDF holds the drawing as vector paths and text (designation R1, title block), black on white");
}

// --- 13. Several sheets, joined by sheet connectors -------------------------------
{
  // the A4 portrait sheet from section 12 holds R1; add a second sheet from the File menu
  await cad.locator("#btn-file").click();
  await cad.getByRole("menuitem", { name: /Add sheet/ }).click();
  check(await cad.locator("#new-modal .insp-title").textContent() === "Add sheet", "File → Add sheet… opens the format dialog for a further sheet");
  await cad.locator('#new-size .btn[data-v="A4"]').click();
  await cad.locator('#new-orient .btn[data-v="landscape"]').click();
  await cad.locator("#new-title").fill("Output stage");
  await cad.locator("#btn-new-create").click();
  const sh = await cad.evaluate(() => TubeCAD.frames().map(f => ({ x: f.x, y: f.y, sheet: f.params.sheet, title: f.params.title, size: f.params.size, orient: f.params.orient, w: CadLib.sheetGeom(f).W })));
  check(sh.every(f => f.x % 10 === 0 && f.y % 10 === 0), `sheets lie on the drawing grid (x ${sh.map(f => f.x).join(", ")})`);
  check(sh.length === 2 && sh[0].sheet === "1/2" && sh[1].sheet === "2/2" && sh[1].x >= sh[0].x + sh[0].w && sh[1].y === sh[0].y && sh[1].title === "Output stage" && sh[1].orient === "landscape",
    `the new sheet sits right of sheet 1 and both are numbered (${sh.map(s => s.sheet).join(", ")})`);
  const nav = await cad.evaluate(() => { const n = document.getElementById("sheet-nav"); return { hidden: n.hidden, opts: [...n.options].map(o => o.textContent) }; });
  check(!nav.hidden && nav.opts.length === 3 && /^Sheet 2 · Output stage/.test(nav.opts[2]), `the Sheet selector lists both sheets (${nav.opts.join(" | ")})`);
  // Fit fits the sheet you are on: the one holding the selection, else the one clicked last,
  // else the one filling most of the view; pressed again on a fitted sheet it shows all sheets
  const view = () => cad.evaluate(() => ({ ...TubeCAD.state.view }));
  const same = (a, b) => Math.abs(a.scale - b.scale) < 1e-6 && Math.abs(a.ox - b.ox) < 0.5 && Math.abs(a.oy - b.oy) < 0.5;
  const ids = await cad.evaluate(() => TubeCAD.frames().map(f => f.id));
  const forget = () => cad.evaluate(() => { const S = TubeCAD.state; S.lastClick = null; S.sel.comps.clear(); S.sel.wires.clear(); });
  await cad.locator("#sheet-nav").selectOption(ids[0]); const v1 = await view();
  await cad.locator("#sheet-nav").selectOption(ids[1]); const v2 = await view();
  await cad.locator("#sheet-nav").selectOption(""); const vAll = await view();
  // looking at sheet 2 (panned a little off), nothing chosen in the list or clicked
  await cad.locator("#sheet-nav").selectOption(ids[1]); await forget();
  await cad.evaluate(() => { const v = TubeCAD.state.view; v.ox += 60; v.scale *= 1.1; document.getElementById("sheet-nav").value = ""; });
  await cad.locator("#btn-zoom-fit").click();
  const looked = await view();
  await cad.keyboard.press("f");
  const again = await view();
  // all sheets in view: a click on sheet 2, then F
  await forget();
  const p1 = await cad.evaluate(id => { const f = TubeCAD.state.comps.find(c => c.id === id), v = TubeCAD.state.view, r = document.getElementById("cad").getBoundingClientRect();
    return { x: r.left + (f.x + 40) * v.scale + v.ox, y: r.top + (f.y + 40) * v.scale + v.oy }; }, ids[1]);
  await cad.mouse.click(p1.x, p1.y); await cad.keyboard.press("Escape");
  await cad.keyboard.press("f");
  const clicked = await view();
  // a part selected on sheet 1 wins over the click on sheet 2
  const onSheet1 = await cad.evaluate(id => { const S = TubeCAD.state;
    const part = S.comps.find(c => c.type !== "frame" && (TubeCAD.zoneOf(c.x, c.y) || {}).frame?.id === id); if (part) S.sel.comps.add(part.id); return !!part; }, ids[0]);
  await cad.keyboard.press("f");
  const selected = await view();
  await forget();
  check(onSheet1 && same(looked, v2) && same(again, vAll) && same(clicked, v2) && same(selected, v1) && !same(v1, v2) && !same(v2, vAll),
    "Fit (button or F) fits the sheet in view, the clicked one, or the one with the selection; again on a fitted sheet shows all sheets");
  // the horizontal scroll bar: both sheets marked on its track, the arrows step between them,
  // a click on a sheet's mark shows that sheet, dragging the thumb scrolls the drawing
  {
    await cad.locator("#sheet-nav").selectOption(ids[0]);
    const bar = await cad.evaluate(() => ({ hidden: document.getElementById("hscroll").hidden, marks: [...document.querySelectorAll(".hs-mark")].map(m => m.textContent),
      prev: document.getElementById("hs-prev").disabled, next: document.getElementById("hs-next").disabled }));
    await cad.locator("#hs-next").click(); const n1 = await view();
    await cad.keyboard.press("PageUp"); const p1v = await view();
    await cad.keyboard.press("PageDown"); const n2 = await view();
    await cad.locator(".hs-mark").first().click(); const m1 = await view();
    const tb = await cad.locator("#hs-thumb").boundingBox();
    await cad.mouse.move(tb.x + tb.width / 2, tb.y + tb.height / 2); await cad.mouse.down();
    await cad.mouse.move(tb.x + tb.width / 2 + 40, tb.y + tb.height / 2, { steps: 4 }); await cad.mouse.up();
    const dragged = await view();
    check(!bar.hidden && bar.marks.join() === "1,2" && bar.prev && !bar.next, `with two sheets a scroll bar under the drawing marks them (${bar.marks.join(", ")}); on sheet 1 only → is live`);
    check(same(n1, v2) && same(p1v, v1) && same(n2, v2) && same(m1, v1), "the scroll bar's arrows (and Page Up / Page Down) step between the sheets, a click on a sheet's mark shows it");
    check(dragged.ox < m1.ox - 20 && dragged.scale === m1.scale && dragged.oy === m1.oy, `dragging the thumb right scrolls the drawing left (ox ${m1.ox.toFixed(0)} → ${dragged.ox.toFixed(0)})`);
    const one = await cad.evaluate(() => { const S = TubeCAD.state, keep = S.comps.slice(); S.comps = [keep.find(c => c.type === "frame")]; TubeCAD.fitView();
      const h = document.getElementById("hscroll").hidden; S.comps = keep; TubeCAD.fitView(); return h; });
    check(one, "with one sheet that fits in the view the scroll bar is hidden");
  }
  // a 300 V supply on sheet 1 feeds a 1 kΩ load on sheet 2 through two "+B" connectors
  const r = await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD, [f1, f2] = C.frames();
    S.comps = S.comps.filter(c => c.type === "frame"); S.wires = [];
    const add = (t, p, x, y, rot) => { const c = C.makeComp(t, p, x, y, rot || 0); S.comps.push(c); return c; };
    const v = add("vdc", { v: 300 }, f1.x + 300, f1.y + 300), g1 = add("ground", {}, f1.x + 300, f1.y + 330);
    const k1 = add("offsheet", { name: "+B" }, f1.x + 400, f1.y + 270, 0);
    const k2 = add("offsheet", { name: "+b " }, f2.x + 200, f2.y + 270, 2), load = add("resistor", { r: 1000 }, f2.x + 300, f2.y + 300, 1), g2 = add("ground", {}, f2.x + 300, f2.y + 330);
    S.wires.push({ id: "wa", x1: f1.x + 300, y1: f1.y + 270, x2: f1.x + 400, y2: f1.y + 270 }, { id: "wb", x1: f2.x + 200, y1: f2.y + 270, x2: f2.x + 300, y2: f2.y + 270 });
    C.commit();
    const T = C.topo();
    return { same: T.pinNet.get(v.id + ":+") === T.pinNet.get(load.id + ":1"), net: T.pinNet.get(load.id + ":1"), refs1: C.connRefs(k1), refs2: C.connRefs(k2), zone: C.zoneOf(k2.x, k2.y).text };
  });
  check(r.same && r.net > 0, "connectors with the same name (case and spaces ignored) join their wires into one net across sheets");
  check(r.refs1.length === 1 && r.refs1[0] === r.zone && /^2\/[A-H]\d$/.test(r.zone) && /^1\/[A-H]\d$/.test(r.refs2[0] || ""), `each connector shows where its partner is (sheet 1 → ${r.refs1}, sheet 2 → ${r.refs2})`);
  const short = await cad.evaluate(() => [TubeCAD.refText(["B2", "A3", "A5", "B5", "D2", "E2", "D3", "D5", "E5", "B8"]), TubeCAD.refText(["2/C4", "1/A3", "2/C1", "1/A5"])]);
  check(short[0] === "A3,5 B2,5,8 D2,3,5 E2,5" && short[1] === "1/A3,5 2/C1,4", `zone references are written one row letter per group (${short.join(" · ")})`);
  await cad.evaluate(() => TubeCAD.runSim("full"));
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  const vLoad = await cad.evaluate(() => { const S = TubeCAD.state, T = TubeCAD.topo(), l = S.comps.find(c => c.type === "resistor"); return S.sim.result.dc.nodes[T.pinNet.get(l.id + ":1")]; });
  check(Math.abs(vLoad - 300) < 1, `the simulation sees the joined net: the load on sheet 2 gets ${vLoad && vLoad.toFixed(1)} V from the supply on sheet 1`);
  const pdf = await cad.evaluate(() => { const b = TubeCAD.exportPDF(false); let s = ""; for (const c of b) s += String.fromCharCode(c); return s; });
  const xref = +pdf.match(/startxref\n(\d+)/)[1];
  const offs = [...pdf.slice(xref).matchAll(/^(\d{10}) 00000 n $/gm)].map(m => +m[1]);
  const pages = pdf.match(/\/Type \/Page\b/g) || [];
  check(pages.length === 2 && /\/Count 2/.test(pdf) && /\/MediaBox \[0 0 595.276 841.89\]/.test(pdf) && /\/MediaBox \[0 0 841.89 595.276\]/.test(pdf) && offs.every((o, i) => pdf.slice(o).startsWith(`${i + 1} 0 obj`)),
    `Save as PDF writes one page per sheet (${pages.length} pages: A4 portrait and A4 landscape, cross-reference table checks out)`);
  // each page holds only its own sheet: the load's designation is on page 2 only
  const streams = [...pdf.matchAll(/stream\n([\s\S]*?)\nendstream/g)].map(m => m[1]);
  check(streams.length === 2 && !/\(R1\) Tj/.test(streams[0]) && /\(R1\) Tj/.test(streams[1]) && /\(\+B\) Tj/.test(streams[0]) && /\(\+b \) Tj/.test(streams[1]), "each PDF page holds only the parts on its own sheet");
}

// --- 14. Resistor power rating ----------------------------------------------------
{
  // the 1 kΩ load of section 13 across 300 V dissipates 90 W; rate it 10 W
  const v = await cad.evaluate(() => { const l = TubeCAD.state.comps.find(c => c.type === "resistor"); l.params.w = "10"; TubeCAD.state.sel.comps.clear(); TubeCAD.commit(); return CadLib.LIB.resistor.value(l); });
  await cad.evaluate(() => TubeCAD.runSim("full"));
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  await cad.waitForFunction(() => /dissipates/.test(document.getElementById("inspector").textContent), null, { timeout: 10000 }).catch(() => {});
  const r = await cad.evaluate(() => { const l = TubeCAD.state.comps.find(c => c.type === "resistor"); return { p: TubeCAD.resistorPower(l), text: document.getElementById("inspector").textContent, small: CadLib.LIB.resistor.value({ params: { r: 470e3, w: "0.25" } }) }; });
  check(v === "1kΩ 10W" && r.small === "470kΩ", `the value text carries ratings from 1 W up ("${v}"; a 0.25 W part reads "${r.small}" and shows it by the mark in its body)`);
  check(Math.abs(r.p - 90) < 1 && /R1 dissipates 90(\.0+)? ?W, more than its 10 W rating/.test(r.text), `the circuit checks flag a resistor beyond its rating (${r.p.toFixed(1)} W in a 10 W part)`);
}

// --- 15. Catalog output transformer (Hammond 125SE) ------------------------------
{
  // 300 V through the 125ESE primary (103 Ω) into 3 kΩ: 97 mA DC, over its 80 mA rating
  const r = await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD, f = C.frames()[0];
    S.comps = S.comps.filter(c => c.type === "frame"); S.wires = [];
    const add = (t, p, x, y, rot) => { const c = C.makeComp(t, p, x, y, rot || 0); S.comps.push(c); return c; };
    const v = add("vdc", { v: 300 }, f.x + 300, f.y + 300), g = add("ground", {}, f.x + 300, f.y + 330);
    const t = add("opt_cat", { model: "125ESE", tap: "GRN" }, f.x + 500, f.y + 300), rl = add("resistor", { r: 3000 }, f.x + 400, f.y + 400, 1);
    const sp = add("speaker", { r: 4 }, f.x + 600, f.y + 300), g2 = add("ground", {}, f.x + 400, f.y + 430), g3 = add("ground", {}, f.x + 600, f.y + 330);
    const P = (c, id) => C.compPins(c).find(p => p.id === id);
    const w = (a, b) => S.wires.push({ id: "w" + S.wires.length, x1: a.x, y1: a.y, x2: b.x, y2: a.y }, { id: "w" + S.wires.length + "b", x1: b.x, y1: a.y, x2: b.x, y2: b.y });
    w(P(v, "+"), P(t, "P1")); w(P(t, "P2"), P(rl, "1")); w(P(t, "S1"), P(sp, "+")); w(P(t, "S2"), P(sp, "-"));
    C.commit();
    return { value: CadLib.LIB.opt_cat.value(t), info: CadLib.LIB.opt_cat.info(t) };
  });
  await cad.evaluate(() => TubeCAD.runSim("full"));
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  await cad.waitForFunction(() => /125ESE\) carries/.test(document.getElementById("inspector").textContent), null, { timeout: 10000 }).catch(() => {});
  const txt = await cad.evaluate(() => document.getElementById("inspector").textContent);
  check(r.value === "125ESE GRN" && /103 Ω/.test(r.info) && /5 kΩ with 4 Ω/.test(r.info), `the Hammond 125SE list gives the model's data ("${r.value}": ${r.info.slice(0, 60)}…)`);
  check(/T1 \(Hammond 125ESE\) carries 9\d mA DC, more than its 80 mA rating/.test(txt), `the checks flag DC current beyond the output transformer's rating (${(txt.match(/carries \d+ mA/) || ["?"])[0]})`);
}

// --- Locked sheet frames; export of each sheet as PDF or PNG -------------------
{
  const fr = () => cad.evaluate(() => TubeCAD.frames().map(f => ({ id: f.id, x: f.x, y: f.y, locked: TubeCAD.isLocked(f), size: f.params.size, orient: f.params.orient })));
  const before = await fr();
  check(before.length === 2 && before.every(f => f.locked), "sheet frames are locked by default");
  // drag the first frame by its title block with the real mouse, then press Delete
  await cad.evaluate(() => TubeCAD.fitView()); await cad.waitForTimeout(100);
  const cb = await cad.locator("#cad").boundingBox();
  const grab = await cad.evaluate(() => { const f = TubeCAD.frames()[0], g = CadLib.sheetGeom(f), v = TubeCAD.state.view, x = f.x + g.tb.x1 + 40, y = f.y + g.tb.y2 - 20; return [x * v.scale + v.ox, y * v.scale + v.oy]; });
  await cad.mouse.move(cb.x + grab[0], cb.y + grab[1]); await cad.mouse.down(); await cad.mouse.move(cb.x + grab[0] + 120, cb.y + grab[1] + 60, { steps: 6 }); await cad.mouse.up();
  const sel = await cad.evaluate(() => [...TubeCAD.state.sel.comps]);
  await cad.keyboard.press("Delete");
  const after = await fr();
  check(sel.includes(before[0].id) && after.length === 2 && after[0].x === before[0].x && after[0].y === before[0].y && /frame is locked/.test(await cad.textContent("#status-sim")),
    "a locked frame can be selected (for its title block) but neither dragged nor deleted, and the status says why");
  await cad.locator("#inspector .row", { hasText: "Position" }).locator("select").selectOption("no");
  await cad.mouse.move(cb.x + grab[0], cb.y + grab[1]); await cad.mouse.down(); await cad.mouse.move(cb.x + grab[0] + 120, cb.y + grab[1] + 60, { steps: 6 }); await cad.mouse.up();
  const moved = (await fr())[0];
  check(!moved.locked && (moved.x !== before[0].x || moved.y !== before[0].y), "an unlocked frame moves");
  await cad.keyboard.press("Control+z"); await cad.keyboard.press("Control+z");
  check((await fr())[0].locked && (await fr())[0].x === before[0].x, "undo restores the frame and its lock");

  const grabAll = async (n, fn) => { const got = []; const on = d => got.push(d); cad.on("download", on); await fn(); for (let k = 0; k < 50 && got.length < n; k++) await cad.waitForTimeout(100); cad.off("download", on); return got; };
  // each sheet as its own PDF
  await cad.evaluate(() => TubeCAD.fitSheet(TubeCAD.frames()[1]));
  await cad.evaluate(() => TubeCAD.openExportDialog("pdf"));
  check(/Sheet 2/.test(await cad.textContent("#exp-current-name")), "the export dialog offers the sheet in view as \"This sheet\"");
  await cad.click('#export-modal [data-k="which"][data-v="each"]');
  let dls = await grabAll(2, () => cad.click("#btn-exp-ok"));
  const pdfs = await Promise.all(dls.map(async d => ({ name: d.suggestedFilename(), text: (await readFile(await d.path())).toString("latin1") })));
  const mb = t => (t.match(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g) || []).length;
  check(pdfs.length === 2 && pdfs.map(p => p.name).sort().join() === ["Test-amplifier-sheet1.pdf", "Test-amplifier-sheet2.pdf"].sort().join() || (pdfs.length === 2 && pdfs.every(p => /-sheet[12]\.pdf$/.test(p.name))),
    `"Each sheet, own file" saves one PDF per sheet (${pdfs.map(p => p.name).join(", ")})`);
  check(pdfs.every(p => mb(p.text) === 1), "each of those PDFs has exactly one page");
  // this sheet as PNG, 150 dpi, black on white
  await cad.evaluate(() => TubeCAD.openExportDialog("png"));
  await cad.click('#export-modal [data-k="which"][data-v="current"]'); await cad.click('#export-modal [data-k="dpi"][data-v="150"]'); await cad.click('#export-modal [data-k="colours"][data-v="print"]');
  check(await cad.isDisabled('#export-modal [data-k="which"][data-v="all"]'), "PNG has no \"all in one\" option (one image per sheet)");
  dls = await grabAll(1, () => cad.click("#btn-exp-ok"));
  const png = dls.length ? await readFile(await dls[0].path()) : Buffer.alloc(0);
  const pw = png.length > 24 ? png.readUInt32BE(16) : 0, ph = png.length > 24 ? png.readUInt32BE(20) : 0;
  const f2 = before[1], mm = { A4: [297, 210], A3: [420, 297] }[f2.size], [wmm, hmm] = f2.orient === "portrait" ? [mm[1], mm[0]] : mm;
  check(png.subarray(1, 4).toString() === "PNG" && Math.abs(pw - wmm / 25.4 * 150) < 2 && Math.abs(ph - hmm / 25.4 * 150) < 2 && /-sheet2\.png$/.test(dls[0].suggestedFilename()),
    `PNG of the sheet in view at 150 dpi: ${pw} × ${ph} px for ${f2.size} ${f2.orient} (${dls[0] && dls[0].suggestedFilename()})`);
  const ink = await cad.evaluate(() => { const f = TubeCAD.frames()[1], { canvas: cv } = TubeCAD.renderPNG(f, 100, "print"), d = cv.getContext("2d").getImageData(0, 0, cv.width, cv.height).data;
    let white = 0, black = 0, colour = 0; for (let i = 0; i < d.length; i += 4) { const v = (d[i] + d[i + 1] + d[i + 2]) / 3; if (Math.max(Math.abs(d[i] - d[i + 1]), Math.abs(d[i + 1] - d[i + 2])) > 8) colour++; else if (v > 235) white++; else if (v < 60) black++; } return { white, black, colour }; });
  check(ink.white > 10 * ink.black && ink.black > 1000 && ink.colour === 0, `print colours: white paper, black ink, no colour (${ink.white} white, ${ink.black} black, ${ink.colour} coloured pixels)`);
  // the same sheet's PDF and PNG carry the same text (the grid labels and title block included)
  const texts = await cad.evaluate(() => { const f = TubeCAD.frames()[1], seen = [], { canvas: cv } = TubeCAD.renderPNG(f, 50, "print");
    const bytes = TubeCAD.exportPDF(false, [f]); let p = ""; for (const b of bytes) p += String.fromCharCode(b);
    return { pdfCols: /\(1\) Tj/.test(p) && /\(A\) Tj/.test(p), w: cv.width }; });
  check(texts.pdfCols, "the sheet's PDF has its reference-grid labels");
  // Print (Ctrl+P): the dialog prints the sheet in view, all sheets or the BOM through PdfExport.print
  await cad.evaluate(() => { window.__printed = []; window.__print0 = PdfExport.print; PdfExport.print = (b, o) => { let t = ""; for (const x of b) t += String.fromCharCode(x); window.__printed.push({ pages: (t.match(/\/Type \/Page\b/g) || []).length, name: o.name }); return "dialog"; }; });
  await cad.evaluate(() => document.activeElement && document.activeElement.blur());
  await cad.keyboard.press("Control+p");
  const pd = await cad.evaluate(() => ({ open: !document.getElementById("print-modal").hidden, sum: document.getElementById("prn-summary").textContent }));
  check(pd.open && /Sheet 2/.test(pd.sum) && /mm/.test(pd.sum), `Ctrl+P opens the Print dialog on the sheet in view ("${pd.sum}")`);
  await cad.click('#print-modal [data-p="current"]'); await cad.click("#btn-prn-ok");
  await cad.evaluate(() => TubeCAD.openPrintDialog("all")); await cad.click("#btn-prn-ok");
  await cad.evaluate(() => TubeCAD.openPrintDialog("bom")); await cad.click("#btn-prn-ok");
  const printed = await cad.evaluate(() => window.__printed);
  check(printed.length === 3 && printed[0].pages === 1 && printed[1].pages === 2 && printed[2].pages >= 1 && /-BOM\.pdf$/.test(printed[2].name) && /Printing/.test(await cad.textContent("#status-sim")),
    `Print: this sheet ${printed[0] && printed[0].pages} page, all sheets ${printed[1] && printed[1].pages} pages, the BOM ${printed[2] && printed[2].pages} page(s), and the dialog closes`);
  // the real PdfExport.print: Chromium prints the PDF from a hidden frame, others open it in a tab
  const how = await cad.evaluate(() => { PdfExport.print = window.__print0; const opened = []; const open0 = window.open; window.open = u => { opened.push(u); return {}; };
    const had = "chrome" in window, ch = window.chrome; window.chrome = ch || {}; const a = PdfExport.print(TubeCAD.exportPDF(false), { name: "x.pdf" }); const fr = document.getElementById("pdf-print-frame");
    const frame = !!fr && /^blob:/.test(fr.src); if (fr) fr.remove(); delete window.chrome; const b = PdfExport.print(TubeCAD.exportPDF(false), { name: "x.pdf" }); if (had) window.chrome = ch; window.open = open0;
    return { a, frame, b, tab: opened.length === 1 && /^blob:/.test(opened[0]) }; });
  check(how.a === "dialog" && how.frame && how.b === "tab" && how.tab, `PdfExport.print: a hidden frame in Chromium (${how.a}), a new tab elsewhere (${how.b})`);
}

// --- Resizable side panels in every window --------------------------------------
{
  const drag = async (page, sel, dx) => {
    const h = page.locator(sel), b = await h.boundingBox();
    await page.mouse.move(b.x + b.width / 2, b.y + 200); await page.mouse.down(); await page.mouse.move(b.x + b.width / 2 + dx, b.y + 200, { steps: 5 }); await page.mouse.up();
  };
  const width = (page, sel) => page.evaluate(sel => document.querySelector(sel).getBoundingClientRect().width, sel);
  const handles = page => page.evaluate(() => document.querySelectorAll(".panel-split").length);
  // CAD: inspector (right) and palette (left)
  const i0 = await width(cad, "#inspector"), p0 = await width(cad, "#palette"), c0 = await cad.evaluate(() => document.getElementById("cad").clientWidth);
  await drag(cad, ".panel-split >> nth=1", -120);
  await drag(cad, ".panel-split >> nth=0", 60);
  const i1 = await width(cad, "#inspector"), p1 = await width(cad, "#palette"), c1 = await cad.evaluate(() => document.getElementById("cad").clientWidth);
  check(await handles(cad) === 2 && Math.abs(i1 - i0 - 120) < 3 && Math.abs(p1 - p0 - 60) < 3 && Math.abs((c0 - c1) - 180) < 4,
    `CAD: dragging the panel edges resizes the inspector (${Math.round(i0)} → ${Math.round(i1)} px) and the palette (${Math.round(p0)} → ${Math.round(p1)} px); the schematic gives way`);
  await cad.reload(); await cad.waitForFunction(() => window.TubeCAD);
  check(Math.abs(await width(cad, "#inspector") - i1) < 3, "CAD: the panel widths are kept after a reload");
  await cad.locator(".panel-split >> nth=1").dblclick();
  check(Math.abs(await width(cad, "#inspector") - 280) < 3, "CAD: double-clicking an edge resets the panel");
  await drag(cad, ".panel-split >> nth=1", -2000);
  check(await cad.evaluate(() => document.getElementById("cad").clientWidth) >= 355, "CAD: a panel can't be dragged so wide that the schematic disappears");
  await cad.locator(".panel-split >> nth=1").dblclick(); await cad.locator(".panel-split >> nth=0").dblclick();
  // tracer, scope and analyzer
  for (const [page, name, sel, nth, dx] of [[tracer, "curve tracer", ".col.right", 1, -100], [scope, "oscilloscope", "main > :nth-child(2)", 0, -100], [spectrum, "spectrum analyzer", "main > :nth-child(2)", 0, -100]]) {
    const w0 = await width(page, sel);
    await drag(page, `.panel-split >> nth=${nth}`, dx);
    const w1 = await width(page, sel);
    check(Math.abs(w1 - w0 + dx) < 3, `${name}: the side panel resizes by dragging its edge (${Math.round(w0)} → ${Math.round(w1)} px)`);
    await page.locator(`.panel-split >> nth=${nth}`).dblclick();
  }
}

// --- Opening on sheet 1, progress on ▶ Simulate, one-cycle load line ------------------
{
  const two = await cad.evaluate(() => TubeCAD.frames().length);
  await cad.reload(); await cad.waitForFunction(() => window.TubeCAD); await cad.waitForTimeout(300);
  const nav = await cad.evaluate(() => [document.getElementById("sheet-nav").value, TubeCAD.frames()[0].id]);
  check(two >= 2 && nav[0] === nav[1], `a circuit with ${two} sheets opens on sheet 1, not on all of them at once`);
  // record every text the button shows, so a run that finishes at once is caught too
  await cad.evaluate(() => { const b = document.getElementById("btn-sim"); window.__simTexts = []; new MutationObserver(() => window.__simTexts.push(b.textContent)).observe(b, { childList: true, characterData: true, subtree: true }); TubeCAD.runSim("full"); });
  await cad.waitForFunction(() => !TubeCAD.state.sim.busy, null, { timeout: 30000 });
  const texts = await cad.evaluate(() => window.__simTexts);
  check(texts.some(t => /■ Stop · \d+ %/.test(t)) && /^▶ Simulate$/.test(await cad.textContent("#btn-sim")), `▶ Simulate shows the run's progress (${texts[texts.length - 1] || "—"}) and goes back when it is done`);
}
