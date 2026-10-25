// Bill of materials; transistors, zener, LED and current stickers
import { cad, check, toScreen } from "./harness.mjs";
import { readFile } from "node:fs/promises";

// --- Bill of materials -------------------------------------------------------
{
  await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD, f = C.frames()[0];
    f.params.title = "BOM test"; f.params.docno = "TA-001";
    S.comps = S.comps.filter(c => c.type === "frame"); S.wires = [];
    const add = (t, p, x, y, label) => { const c = C.makeComp(t, p, f.x + x, f.y + y, 0); if (label) c.label = label; S.comps.push(c); return c; };
    ["R1", "R2", "R3", "R4"].forEach((l, i) => add("resistor", { r: 100e3 }, 200 + 80 * i, 200, l));
    add("resistor", { r: 1500, w: "0.5" }, 200, 300, "R5"); add("resistor", { r: 1500, w: "0.5" }, 280, 300, "R7");
    add("capacitor", { c: 22e-9 }, 200, 400, "C1"); add("electrolytic", { c: 100e-6 }, 280, 400, "C2");
    add("tube", { tube: "12AX7" }, 500, 300, "VL1.1"); add("tube", { tube: "12AX7" }, 650, 300, "VL1.2"); add("tube", { tube: "EL84", connection: "pentode" }, 800, 300, "VL2");
    add("opt_cat", { model: "125ESE", tap: "GRN" }, 950, 300, "T1"); add("ground", {}, 200, 500); add("vdc", { v: 300 }, 300, 500, "G1");
    C.commit();
  });
  const bom = await cad.evaluate(() => TubeCAD.bomData());
  const line = v => bom.rows.find(r => r.value === v);
  check(line("100kΩ") && line("100kΩ").qty === 4 && line("100kΩ").refs === "R1-R4", `equal parts share one line with a designator range (${line("100kΩ") && line("100kΩ").refs})`);
  check(line("1.5kΩ") && line("1.5kΩ").refs === "R5, R7" && line("1.5kΩ").rating === "0.5 W", "the power rating goes in the Rating column");
  check(line("12AX7") && line("12AX7").qty === 1 && line("12AX7").refs === "VL1", "both sections of a dual triode (VL1.1, VL1.2) count as one tube");
  check(!bom.rows.some(r => /DC supply|Ground/.test(r.desc)), "sources and ground are left out by default");
  const sock = bom.rows.filter(r => r.desc === "Tube socket");
  check(sock.length === 1 && sock[0].value === "Noval B9A" && sock[0].qty === 2, `tube sockets are counted per base (${sock.map(r => r.qty + " × " + r.value).join(", ")})`);
  check(bom.rows.map(r => r.item).join() === bom.rows.map((_, i) => i + 1).join() && bom.rows[0].refs.startsWith("C"), "lines are numbered in designator order");

  await cad.keyboard.press("Escape"); await cad.locator("#cad").focus(); await cad.keyboard.press("b");
  check(await cad.isVisible("#bom") && (await cad.locator("#bom-table tbody tr").count()) === bom.rows.length, "B opens the BOM panel under the schematic with every line");
  const inp = cad.locator("#bom-table tr", { hasText: "R1-R4" }).locator("input");
  await inp.fill("Vishay MRS25 100K"); await inp.press("Enter");
  const pn = await cad.evaluate(() => TubeCAD.state.comps.filter(c => c.params.partno === "Vishay MRS25 100K").map(c => c.label).sort().join());
  check(pn === "R1,R2,R3,R4", `a part number typed in the BOM is stored on each part of the line (${pn})`);
  await cad.locator("#bom-table tr", { hasText: "125ESE" }).locator("td").first().click();
  check(await cad.evaluate(() => [...TubeCAD.state.sel.comps].map(id => TubeCAD.state.comps.find(c => c.id === id).label).join()) === "T1", "clicking a BOM line selects its parts on the sheet");
  {
    // a part clicked on the sheet brings its line into view in a short, scrolled-away list
    await cad.evaluate(() => { document.getElementById("bom").style.setProperty("--bom-h", "150px"); TubeCAD.fitView(); });
    await cad.waitForTimeout(100);
    await cad.evaluate(() => { document.querySelector("#bom .bom-scroll").scrollTop = 0; });
    const t1 = await cad.evaluate(() => { const c = TubeCAD.state.comps.find(c => c.label === "T1"); return { x: c.x, y: c.y + 10 }; });
    const [px, py] = await toScreen(t1.x, t1.y);
    // the toolbar may have wrapped since the start, so measure the canvas again
    const cb = await cad.locator("#cad").boundingBox();
    const [sx, sy] = await cad.evaluate(([x, y]) => { const v = TubeCAD.state.view; return [x * v.scale + v.ox, y * v.scale + v.oy]; }, [t1.x, t1.y]);
    await cad.mouse.click(cb.x + sx, cb.y + sy);
    const vis = await cad.evaluate(() => {
      const box = document.querySelector("#bom .bom-scroll"), tr = document.querySelector("#bom-table tbody tr.sel"), b = box.getBoundingClientRect(), r = tr && tr.getBoundingClientRect();
      return { text: tr ? tr.textContent : "", scrolled: box.scrollTop > 0, inView: !!r && r.top >= b.top + document.querySelector("#bom-table thead").offsetHeight - 1 && r.bottom <= b.bottom + 1 };
    });
    check(/125ESE/.test(vis.text) && vis.scrolled && vis.inView, `selecting T1 on the sheet scrolls the BOM to its highlighted line`);
    await cad.evaluate(() => document.getElementById("bom").style.removeProperty("--bom-h"));
  }
  await cad.check("#bom-bench");
  check(await cad.locator("#bom-table tr", { hasText: "DC supply" }).count() === 1, "Sources & instruments adds the bench supply");
  await cad.uncheck("#bom-bench");

  const files = {};
  for (const fmt of ["txt", "csv", "xlsx", "pdf"]) {
    const [dl] = await Promise.all([cad.waitForEvent("download"), cad.click(`#bom [data-bom="${fmt}"]`)]);
    const path = await dl.path(); files[fmt] = { name: dl.suggestedFilename(), data: await readFile(path) };
  }
  const txt = files.txt.data.toString("utf8"), csv = files.csv.data.toString("utf8");
  check(files.txt.name === "TA-001-BOM.txt" && /BILL OF MATERIALS/.test(txt) && /R1-R4\s+Resistor\s+100kΩ/.test(txt) && /Vishay MRS25 100K/.test(txt), "TXT export: aligned table with the part numbers");
  check(csv.startsWith("﻿Item,Qty,Designators") && csv.includes('"R5, R7"') && csv.split("\r\n").filter(Boolean).length === bom.rows.length + 1, "CSV export: header, one row per line, quoted lists, UTF-8 mark");
  const x = files.xlsx.data, entries = [];
  for (let o = 0; o + 30 < x.length && x.readUInt32LE(o) === 0x04034b50;) {
    const n = x.readUInt16LE(o + 26), size = x.readUInt32LE(o + 18), name = x.toString("utf8", o + 30, o + 30 + n), body = x.subarray(o + 30 + n, o + 30 + n + size);
    entries.push({ name, crcOk: (await cad.evaluate(a => BomLib.crc32(new Uint8Array(a)), [...body])) === x.readUInt32LE(o + 14), body: body.toString("utf8") });
    o += 30 + n + size;
  }
  const sheet = (entries.find(e => e.name === "xl/worksheets/sheet1.xml") || {}).body || "";
  check(files.xlsx.name.endsWith(".xlsx") && entries.length === 7 && entries.every(e => e.crcOk) && sheet.includes("R1-R4") && sheet.includes("<autoFilter"), `XLSX export: a valid zip of ${entries.length} parts with the table`);
  const pdfs = files.pdf.data.toString("latin1");
  check(pdfs.startsWith("%PDF-1.4") && /\(BILL OF MATERIALS\) Tj/.test(pdfs) && /\(R1-R4\) Tj/.test(pdfs) && /page 1 of 1/.test(pdfs), "PDF export: a page with the title and the table");
  await cad.keyboard.press("b");
  check(!(await cad.isVisible("#bom")), "B closes the panel again");
}

// --- Transistors, zener, LED; current stickers ------------------------------------
{
  // groups fold: Semiconductors starts closed, a click opens it and the browser remembers
  check(await cad.getByRole("button", { name: /^NPN transistor/ }).count() === 0, "palette: the Semiconductors group starts folded");
  await cad.locator(".pal-group", { hasText: "Semiconductors" }).click();
  check(await cad.evaluate(() => JSON.parse(localStorage.getItem("tubecad_palette")).closed.Semiconductors) === false, "palette: an opened group is remembered");
  // one search box for parts, part numbers, tubes and values
  const search = cad.locator("#pal-search");
  await search.fill("2n2222");
  const hit = await cad.locator("#palette .pal-item").allTextContents();
  {
    // germanium in the CAD: the Temperature field reaches the model, the leakage shows in the inspector and goes to SPICE
    const ge = await cad.evaluate(() => {
      const C = TubeCAD, L = CadLib.LIB, c = C.makeComp("pnp", { model: "AC128", temp: 45 }, 0, 0, 0), els = [];
      L.pnp.build(c, p => ({ C: 1, B: 2, E: 0 })[p], null, els);
      const q = els.find(e => e.kind === "BJT").model, f = L.pnp.fields.find(x => x.key === "temp");
      return { icbo: q.icbo, t: q.t, field: !!f, info: L.pnp.info(c) };
    });
    check(ge.field && ge.t === 45 && Math.abs(ge.icbo / 4e-6 - 4) < 1e-6 && /leakage ICBO 16µA \(4µA at 25 °C/.test(ge.info), `germanium AC128 at 45 °C: ICBO ${(ge.icbo * 1e6).toFixed(1)} µA (4 µA at 25 °C, doubling every 10 °C)`);
  }
  // germanium: by the Latin name, by the Cyrillic one (МП39Б), and by "germanium"
  await search.fill("мп39"); const ge1 = await cad.locator("#palette .pal-item").allTextContents();
  await search.fill("ac128"); const ge2 = await cad.locator("#palette .pal-item").allTextContents();
  await search.fill("germanium"); const ge3 = await cad.locator("#palette .pal-item").count();
  check(ge1.length === 1 && /MP39B/.test(ge1[0]) && ge2.some(t => /PNP · AC128/.test(t)) && ge3 === 20, `the search finds the germanium transistors: "мп39" → ${ge1.join("")}, "ac128" → AC128, "germanium" → ${ge3} parts`);
  await search.fill("el84"); const tubes = await cad.locator("#palette .pal-item").allTextContents();
  await search.fill("47k"); const val = await cad.locator("#palette .pal-item").first().textContent();
  await search.press("Enter");
  const placing = await cad.evaluate(() => TubeCAD.state.placing);
  await cad.keyboard.press("Escape"); await search.fill(""); await cad.keyboard.press("Escape");
  check(hit.length === 1 && /NPN · 2N2222A/.test(hit[0]) && tubes.some(t => /^EL84/.test(t)) && /Resistor\s*47kΩ/.test(val) && placing && placing.type === "resistor" && placing.params.r === 47000,
    `palette search finds part numbers (${hit[0]}), tubes (EL84) and values ("47k" → ${val && val.replace(/\s+/g, " ")}; Enter picks it)`);
  for (const name of ["NPN transistor", "PNP transistor", "NPN, high voltage", "N-MOSFET, depletion", "P-MOSFET", "PNP, germanium", "NPN, germanium", "PNP, germanium (USSR)", "Zener diode", "LED"])
    check(await cad.getByRole("button", { name: new RegExp("^" + name.replace(/[()]/g, "\\$&")) }).count() > 0, `palette offers "${name}" under Semiconductors`);
  {
    // Sources: DC supplies, then AC sources; ground and sheet connectors under their own group
    const pal = await cad.evaluate(() => {
      const out = {}; let g = null, sub = null;
      document.querySelectorAll("#palette .pal-group, #palette .pal-sub, #palette .pal-item").forEach(el => {
        if (el.classList.contains("pal-group")) { g = el.textContent.replace("▾", "").trim(); sub = null; out[g] = []; }
        else if (el.classList.contains("pal-sub")) sub = el.textContent;
        else if (g && el.offsetParent !== null) out[g].push((sub ? sub + ": " : "") + el.querySelector("span").textContent);
      });
      return out;
    });
    const src = (pal.Sources || []).join(" | "), gc = (pal["Ground & connectors"] || []).join(" | ");
    check(src === "DC supplies: DC supply | DC supplies: Power rail | DC supplies: Current source | AC sources: Signal generator | AC sources: AC mains"
      && gc === "Ground | Sheet connector", `palette: Sources split into DC supplies and AC sources (${src}); Ground & connectors apart (${gc})`);
    // the current source: 2 mA from ground up into 10 kΩ gives 20 V; the inspector reads it
    await cad.evaluate(() => {
      const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
      const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
      const pin = (c, id) => C.compPins(c).find(p => p.id === id);
      const wire = (a, b, hFirst) => C.lRoute(a.x, a.y, b.x, b.y, hFirst !== false).forEach(s => C.addSegment(...s));
      const I = add("isrc", { i: 2e-3 }, 200, 300), R = add("resistor", { r: 10e3 }, 320, 300, 1), g = add("ground", {}, 260, 400);
      wire(pin(I, "+"), pin(R, "1")); wire(pin(I, "-"), pin(g, "G")); wire(pin(R, "2"), pin(g, "G"));
      S.sel.comps.add(I.id); C.commit();
    });
    await cad.waitForFunction(() => !TubeCAD.state.sim.busy && TubeCAD.state.sim.result && /Voltage across \(\+ to -\)\s*-?[\d.]+V/.test(document.getElementById("insp-live").textContent), null, { timeout: 30000 });
    const live = (await cad.textContent("#insp-live")).replace(/\s+/g, " ");
    const vI = +((/Voltage across \(\+ to -\)\s*([\d.]+)V/.exec(live) || [])[1]);
    check(Math.abs(vI - 20 * 10e6 / (10e6 + 10e3)) < 0.02 && /drives current uphill/.test(live), `current source: 2 mA into 10 kΩ reads 20 V across it (10 kΩ ∥ its 10 MΩ output resistance: ${vI} V) and warns it delivers power`);
    // one DC supply for B+ and bias: Polarity flips the sign, the Voltage field shows its size and keeps the sign
    {
      const id = await cad.evaluate(() => { const C = TubeCAD, S = C.state, b = C.makeComp("vdc", {}, 600, 300, 0); S.comps.push(b); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(b.id); C.commit(); return b.id; });
      const vOf = () => cad.evaluate(i => TubeCAD.state.comps.find(c => c.id === i).params.v, id);
      const v0 = await vOf();
      await cad.locator("#inspector .row", { hasText: "Polarity" }).locator("select").selectOption("-");
      const v1 = await vOf(), shown = await cad.locator("#inspector .row", { hasText: "Voltage" }).locator("input").inputValue();
      const volt = cad.locator("#inspector .row", { hasText: "Voltage" }).locator("input");
      await volt.fill("20"); await volt.press("Enter");
      const v2 = await vOf();
      await cad.locator("#inspector .row", { hasText: "Polarity" }).locator("select").selectOption("+");
      const v3 = await vOf();
      check(v0 === 300 && v1 === -300 && shown === "300" && v2 === -20 && v3 === 20, `DC supply polarity: ${v0} V → Negative ${v1} V (shown as ${shown}) → typed 20: ${v2} V → Positive ${v3} V`);
      await cad.evaluate(i => { const S = TubeCAD.state; S.comps = S.comps.filter(c => c.id !== i); S.sel.comps.clear(); TubeCAD.commit(); }, id);
    }
    // the signal generator's fields stand under Signal, Level and Output
    await cad.evaluate(() => { const C = TubeCAD, S = C.state, g = C.makeComp("siggen", {}, 600, 300, 0); S.comps.push(g); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(g.id); C.commit(); });
    const heads = await cad.evaluate(() => [...document.querySelectorAll("#inspector .insp-sub")].map(h => h.textContent).slice(0, 3).join(" / "));
    check(heads === "Signal / Level / Output", `signal generator inspector in sections (${heads})`);
    await cad.evaluate(() => { const S = TubeCAD.state; S.comps = []; S.wires = []; S.sel.comps.clear(); TubeCAD.commit(); });
  }
  {
    // the transistor's Type list sorts the parts under Silicon and Germanium
    const groups = await cad.evaluate(() => {
      const f = CadLib.LIB.pnp.fields.find(x => x.key === "model"), opts = f.options({ params: {} }), by = {};
      opts.forEach(([k, , g]) => (by[g] = by[g] || []).push(k));
      return { ge: by.Germanium || [], si: by.Silicon || [], none: opts.filter(o => !o[2]).length };
    });
    check(groups.none === 0 && groups.ge.includes("AC128") && groups.ge.includes("MP39B") && !groups.ge.includes("BC557B") && groups.si.includes("BC557B"),
      `the PNP Type list puts ${groups.ge.length} germanium parts under Germanium and ${groups.si.length} under Silicon`);
  }
  {
    // op-amps: the palette's Integrated circuits group; a TL072 inverting ×−10 on ±15 V through the editor,
    // its inspector reading the gain and the clipping, the SPICE export, and the package's pin numbers
    const ics = await cad.evaluate(() => [...document.querySelectorAll("#palette .pal-group")].find(g => /Integrated circuits/.test(g.textContent)) ? [...document.querySelectorAll("#palette .pal-item")].filter(el => /TL07|LM741|LM301|LM324/.test(el.textContent)).length : 0);
    check(ics === 6, `palette: Integrated circuits offers the six op-amps (${ics})`);
    const build = amp => cad.evaluate(a => {
      const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
      const add = (type, params, x, y, rot, label) => { const c = C.makeComp(type, params, x, y, rot || 0); if (label) c.label = label; S.comps.push(c); return c; };
      const pin = (c, id) => C.compPins(c).find(p => p.id === id);
      const wire = (p, q, hFirst) => C.lRoute(p.x, p.y, q.x, q.y, hFirst !== false).forEach(s => C.addSegment(...s));
      const U = add("opamp", { model: "TL072" }, 400, 300, 0, "DA1.2"), G = add("siggen", { amp: a, freq: 1000, rs: 0 }, 200, 340);
      const Ri = add("resistor", { r: 10e3 }, 300, 260, 0), Rf = add("resistor", { r: 100e3 }, 400, 200, 0), RL = add("resistor", { r: 10e3 }, 500, 360, 1);
      const P = add("vdc", { v: 15 }, 600, 140), N = add("vdc", { v: 15 }, 600, 460), g1 = add("ground", {}, 200, 420), g2 = add("ground", {}, 340, 420), g3 = add("ground", {}, 600, 200), g4 = add("ground", {}, 660, 440), g5 = add("ground", {}, 500, 420);
      wire(pin(G, "+"), pin(Ri, "1"), false); wire(pin(Ri, "2"), pin(U, "-")); wire(pin(G, "-"), pin(g1, "G"));
      wire(pin(U, "+"), pin(g2, "G")); wire(pin(Rf, "1"), pin(Ri, "2"), false); wire(pin(Rf, "2"), pin(U, "OUT"), false);
      wire(pin(U, "OUT"), pin(RL, "1")); wire(pin(RL, "2"), pin(g5, "G"));
      wire(pin(U, "V+"), pin(P, "+"), false); wire(pin(P, "-"), pin(g3, "G")); wire(pin(U, "V-"), pin(N, "-"), false); wire(pin(N, "+"), pin(g4, "G"));
      S.sel.comps.add(U.id); C.commit();
    }, amp);
    const readOut = async () => {
      await cad.waitForFunction(() => !TubeCAD.state.sim.busy && TubeCAD.state.sim.result && /Output swing/.test(document.getElementById("insp-live").textContent), null, { timeout: 30000 });
      return (await cad.textContent("#insp-live")).replace(/\s+/g, " ");
    };
    await build(0.5);
    let live = await readOut();
    const pp = +((/Output swing\s*([\d.]+)Vpp/.exec(live) || [])[1]);
    const info = (await cad.textContent("#inspector")).replace(/\s+/g, " ");
    check(Math.abs(pp - 10) < 0.02 && !/clips/.test(live) && /Amplifier 2 of 2 in a DIP-8: pins 5 \(\+\), 6 \(−\), 7 \(out\)/.test(info), `op-amp: TL072 (DA1.2) inverting ×−10 gives ${pp} Vpp from 1 Vpp, on pins 5, 6, 7 of its DIP-8`);
    await build(2);
    live = await readOut();
    check(/clips/.test(live) && /Output swing\s*2[67][\d.]*Vpp/.test(live), `op-amp: 4 Vpp in clips at the TL072's swing (${(/Output swing\s*([\d.]+Vpp)/.exec(live) || [])[1]})`);
    const sp = await cad.evaluate(() => TubeCAD.spiceNetlist ? TubeCAD.spiceNetlist() : "");
    check((/\.subckt OPAMP_TL072 INP INN OUT VP VN N1 N2/.test(sp) && /^X\S+ (\S+ ){7}OPAMP_TL072$/m.test(sp)), "SPICE export: the TL072 as a subcircuit");
    await cad.evaluate(() => { const S = TubeCAD.state; S.comps = []; S.wires = []; S.sel.comps.clear(); TubeCAD.commit(); });
  }
  {
    // power rails: two VCC arrows and a VCC sheet connector are one 9 V net fed by one ideal source;
    // a rail of another voltage on that net shows in Checks
    const pal = await cad.evaluate(() => [...document.querySelectorAll("#palette .pal-item")].some(el => /Power rail/.test(el.textContent)));
    const r = await cad.evaluate(() => {
      const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
      const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
      const pin = (c, id) => C.compPins(c).find(p => p.id === id);
      const wire = (p, q) => C.lRoute(p.x, p.y, q.x, q.y, true).forEach(s => C.addSegment(...s));
      const V1 = add("rail", { name: "VCC", v: 9 }, 200, 200), V2 = add("rail", { name: "vcc", v: 9 }, 400, 200, 1), X = add("offsheet", { name: "VCC" }, 600, 200);
      const R1 = add("resistor", { r: 10e3 }, 200, 300, 1), R2 = add("resistor", { r: 10e3 }, 200, 420, 1), R3 = add("resistor", { r: 10e3 }, 400, 300, 1), R4 = add("resistor", { r: 10e3 }, 600, 300, 1);
      const g1 = add("ground", {}, 200, 500), g2 = add("ground", {}, 400, 400), g3 = add("ground", {}, 600, 400);
      wire(pin(V1, "1"), pin(R1, "1")); wire(pin(R1, "2"), pin(R2, "1")); wire(pin(R2, "2"), pin(g1, "G"));
      wire(pin(V2, "1"), pin(R3, "1")); wire(pin(R3, "2"), pin(g2, "G")); wire(pin(X, "1"), pin(R4, "1")); wire(pin(R4, "2"), pin(g3, "G"));
      S.sel.comps.add(V2.id); C.commit();
      return { mid: C.compPins(R1).find(p => p.id === "2"), v2: V2.id };
    });
    await cad.waitForFunction(() => { const S = TubeCAD.state; return !S.sim.busy && S.sim.result && S.sim.topo === TubeCAD.topo() && /Current supplied\s*[\d.]+\s*mA/.test(document.getElementById("insp-live").textContent); }, null, { timeout: 30000 });
    const live = (await cad.textContent("#insp-live")).replace(/\s+/g, " ");
    const got = await cad.evaluate(() => { const C = TubeCAD, S = C.state, T = C.topo(), R1 = S.comps.find(c => c.type === "resistor"), R4 = S.comps.filter(c => c.type === "resistor")[3];
      return { vMid: S.sim.result.dc.nodes[T.pinNet.get(R1.id + ":2")], vX: S.sim.result.dc.nodes[T.pinNet.get(R4.id + ":1")], sources: C.buildNetlist().elements.filter(e => e.kind === "V").length }; });
    const cur = (/Current supplied\s*([\d.]+)\s*mA/.exec(live) || [])[1];
    check(pal && got.sources === 1 && Math.abs(got.vMid - 4.5) < 1e-3 && Math.abs(got.vX - 9) < 1e-3 && Math.abs(+cur - 2.25) < 0.06,
      `power rail: two VCC rails and a VCC connector are one 9 V net from one source (${got.sources}), divider ${got.vMid && got.vMid.toFixed(3)} V, rail supplies ${cur} mA`);
    await cad.evaluate(() => { const S = TubeCAD.state; S.comps.find(c => c.type === "rail" && c.params.name === "vcc").params.v = 5; TubeCAD.commit(); });
    await cad.waitForFunction(() => !TubeCAD.state.sim.busy, null, { timeout: 30000 });
    const issues = await cad.evaluate(() => TubeCAD.circuitIssues().join(" | "));
    check(/Power rails on one net with different voltages: VCC 9V, vcc 5V/.test(issues), `power rail: Checks reports VCC 9 V against vcc 5 V on one net (${issues})`);
    await cad.evaluate(() => { const S = TubeCAD.state; S.comps = []; S.wires = []; S.sel.comps.clear(); TubeCAD.commit(); });
  }
  // 12AX7 with red-LED cathode bias, MJE340 follower on its anode, 1N4742A shunt regulator from B+
  await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD; S.comps = []; S.wires = [];
    const add = (t, p, x, y, rot, label) => { const c = C.makeComp(t, p, x, y, rot || 0); if (label) c.label = label; S.comps.push(c); return c; };
    const poly = (...pts) => { for (let i = 0; i + 3 < pts.length; i += 2) S.wires.push({ id: "s" + S.wires.length, x1: pts[i], y1: pts[i + 1], x2: pts[i + 2], y2: pts[i + 3] }); };
    add("vdc", { v: 300 }, 200, 300, 0, "G1"); add("ground", {}, 200, 330);
    add("resistor", { r: 47000 }, 400, 200, 1, "R1"); add("tube", { tube: "12AX7" }, 400, 320, 0, "VL1");
    add("led", { color: "red" }, 400, 400, 1, "HL1"); add("ground", {}, 400, 420);
    add("resistor", { r: 1e6 }, 300, 360, 1, "R2"); add("ground", {}, 300, 390);
    add("npn", { model: "MJE340" }, 550, 300, 0, "VT1"); add("resistor", { r: 33000, w: "2" }, 560, 380, 1, "R3"); add("ground", {}, 560, 410);
    add("zener", { model: "1N4742A" }, 700, 380, 3, "VD1"); add("resistor", { r: 15000, w: "10" }, 700, 200, 1, "R4"); add("ground", {}, 700, 400);
    poly(200, 270, 200, 150, 400, 150, 400, 170); poly(400, 230, 400, 270); poly(400, 370, 400, 380);
    poly(350, 320, 300, 320, 300, 330); poly(400, 250, 520, 250, 520, 300);
    poly(560, 270, 560, 150, 400, 150); poly(560, 330, 560, 350);
    poly(560, 150, 700, 150, 700, 170); poly(700, 230, 700, 360);
    C.commit(); C.runSim("full");
  });
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  const r = await cad.evaluate(() => {
    const S = TubeCAD.state, C = TubeCAD, g = l => S.comps.find(c => c.label === l), dev = l => (S.sim.result.dc.devices[g(l).id] || {}).main, v = n => S.sim.result.dc.nodes[n];
    const net = (l, p) => C.topo().pinNet.get(g(l).id + ":" + p), wc = C.wireCurrents().currents, pins = C.pinCurrents();
    const seg = (x1, y1, x2, y2) => { const w = S.wires.find(w => (w.x1 === x1 && w.y1 === y1 && w.x2 === x2 && w.y2 === y2) || (w.x1 === x2 && w.y1 === y2 && w.x2 === x1 && w.y2 === y1)); return w ? (w.x1 === x1 && w.y1 === y1 ? 1 : -1) * wc.get(w.id) : null; };
    return { err: S.sim.error, vz: v(net("VD1", "K")), vled: v(net("HL1", "A")), q: dev("VT1"), ia: dev("VL1").ia, supply: -dev("G1").i,
      rail: seg(200, 150, 400, 150), r1: seg(400, 230, 400, 250), base: seg(400, 250, 520, 250), anode: seg(400, 250, 400, 270), emitter: seg(560, 330, 560, 350),
      zener: seg(700, 230, 700, 360), pinR4: pins.get(g("R4").id + ":1"), checks: document.getElementById("inspector").textContent };
  });
  check(!r.err && Math.abs(r.vz - 12) < 0.3, `the 1N4742A holds ${r.vz.toFixed(2)} V (12 V zener at ~19 mA)`);
  // red LED: 1.8 V at 10 mA, 2·Vt per e-fold below (plus 5 Ω), so ~1.70 V at the 12AX7's 1.4 mA
  const vled = 2 * 0.025852 * Math.log(r.ia / (0.01 / Math.exp(1.8 / (2 * 0.025852)))) + 5 * r.ia;
  check(Math.abs(r.vled - vled) < 0.005, `the red LED biases the 12AX7 cathode at ${r.vled.toFixed(3)} V (expected ${vled.toFixed(3)} V at ${(r.ia * 1e3).toFixed(2)} mA)`);
  check(r.q && r.q.vbe > 0.55 && r.q.vbe < 0.75 && r.q.ic > 5e-3 && r.q.ic < 9e-3 && r.q.pd > 0.3 && r.q.pd < 0.7, `MJE340 follower: Vbe ${r.q.vbe.toFixed(3)} V, Ic ${(r.q.ic * 1e3).toFixed(2)} mA, ${r.q.pd.toFixed(2)} W`);
  check(Math.abs(Math.abs(r.rail) - Math.abs(r.supply)) < 1e-6, `the B+ rail wire carries the supply current (${(r.rail * 1e3).toFixed(2)} mA)`);
  check(Math.abs(r.r1 - (r.base + r.anode)) < 1e-8 && Math.abs(r.anode - r.ia) < 1e-6 && Math.abs(r.base - r.q.ib) < 1e-6, `R1's current splits at the junction into the anode (${(r.anode * 1e3).toFixed(3)} mA) and the base (${(r.base * 1e6).toFixed(1)} µA)`);
  check(Math.abs(r.emitter - (r.q.ic + r.q.ib)) < 1e-6, `the emitter wire carries Ic + Ib (${(r.emitter * 1e3).toFixed(3)} mA)`);
  check(Math.abs(r.zener - r.pinR4) < 1e-6 && r.zener > 0.018, `the zener branch carries R4's current down (${(r.zener * 1e3).toFixed(2)} mA)`);
  await cad.evaluate(() => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.comps.add(S.comps.find(c => c.label === "VT1").id); TubeCAD.commit(); });
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  const insp = await cad.textContent("#inspector");
  check(/NPN transistor/.test(insp) && /hFE \(Ic\/Ib\)\d+/.test(insp) && /Dissipation.*of 20 W/.test(insp), "the inspector shows Vce, Vbe, Ic, Ib, hFE and dissipation against the rating");
  const spice = await cad.evaluate(() => TubeCAD.spiceNetlist());
  check(/^QVT|^Q\S+ N\d+ N\d+ N\d+ QN_MJE340$/m.test(spice) && /\.model QN_MJE340 NPN\(IS=/.test(spice), "SPICE export writes the transistor as a Q element with its .model");
  {
    // a germanium part at 45 °C: SPICE's temperature terms on the model, temp= on the instance, the leakage as a B source
    const sp = await cad.evaluate(() => { const S = TubeCAD.state, q = S.comps.find(c => c.label === "VT1"); Object.assign(q.params, { model: "AC127", temp: 45 }); const t = TubeCAD.spiceNetlist(); Object.assign(q.params, { model: "MJE340", temp: 25 }); return t; });
    check(/^Q\S+ N\d+ N\d+ N\d+ QN_AC127 temp=45$/m.test(sp) && /\.model QN_AC127 NPN\(IS=4e-7 .*EG=0\.67 XTI=3 XTB=1\.5 TNOM=25\)/.test(sp) && /^B\S+_LK N\d+ N\d+ I=1\.200e-5\*\(V\(N\d+,N\d+\)<0 \? 1-exp\(V\(N\d+,N\d+\)\/0\.027586\)/m.test(sp),
      "SPICE export of a germanium transistor at 45 °C: EG 0.67 with the temperature terms, temp=45, and its leakage (12 µA) as a B source");
  }
  const bom = await cad.evaluate(() => TubeCAD.bomData().rows.map(r => [r.refs, r.desc, r.value, r.rating, r.sim].join("|")));
  check(bom.some(l => l.startsWith("VT1|Transistor, NPN|MJE340|300 V, 0.5 A, 20 W, TO-126|")) && bom.some(l => /^VD1\|Zener diode\|1N4742A\|12 V, 1 W\|/.test(l)) && bom.some(l => /^HL1\|LED, red\|/.test(l)), `the BOM lists the transistor, zener and LED with their ratings`);
  // nothing selected: the inspector sums up where the power goes
  await cad.evaluate(() => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.wires.clear(); TubeCAD.commit(); });
  await cad.waitForFunction(() => { const S = TubeCAD.state; return S.sim.result && !S.sim.busy; }, null, { timeout: 30000 });
  await cad.waitForTimeout(150);
  const ins = await cad.textContent("#inspector");
  const sup = +((/From DC supplies([\d.]+)W/.exec(ins) || [])[1]);
  check(/Power/.test(ins) && /Transistors[\d.]+m?W/.test(ins) && /Resistors[\d.]+W/.test(ins) && sup > 8 && sup < 9, `with nothing selected the inspector shows the power summary (DC supplies ${sup} W = 300 V × 27.6 mA)`);
  // help: F1 opens the window with the shortcut list, Esc closes it; the toolbar mirrors too
  await cad.locator("#cad").focus(); await cad.keyboard.press("F1");
  const help = await cad.isVisible("#help-modal") && /Ctrl\+Enter/.test(await cad.textContent("#help-modal"));
  await cad.keyboard.press("Escape");
  check(help && !(await cad.isVisible("#help-modal")), "F1 opens the help with every keyboard shortcut; Esc closes it");
  const mb = await cad.evaluate(() => { const S = TubeCAD.state, q = S.comps.find(c => c.label === "VT1"); S.sel.comps.clear(); S.sel.comps.add(q.id); document.getElementById("btn-mirror").click(); const f = q.params.flip; TubeCAD.undo(); return f; });
  check(mb === "yes", "the toolbar's Mirror button mirrors the selection");
  check(await cad.evaluate(() => [...document.querySelectorAll("select")].every(s => getComputedStyle(s).appearance === "none" || getComputedStyle(s).webkitAppearance === "none")), "every dropdown is drawn by the page (dark in Safari too)");
  // stickers keep clear of every text and of each other
  await cad.evaluate(() => TubeCAD.fitView()); await cad.waitForTimeout(150);
  const sr = await cad.evaluate(() => TubeCAD.stickerReport());
  check(sr.volts >= 6 && sr.amps >= 8 && !sr.onText.length && !sr.onOther.length, `voltage and current stickers cover no text and no other sticker (${sr.volts} voltages, ${sr.amps} currents${sr.hidden.length ? `, ${sr.hidden.length} left out for want of room` : ""})`);
  // a designation sitting right where a sticker would go moves the sticker, not onto the text
  const moved = await cad.evaluate(async () => {
    const S = TubeCAD.state, C = TubeCAD, rail = S.wires.find(w => w.y1 === 150 && w.y2 === 150 && Math.min(w.x1, w.x2) === 200);
    const before = TubeCAD.stickerReport().list.find(t => t.kind === "v" && t.txt === "300V");
    const n = C.makeComp("note", { text: "NOTE OVER THE RAIL STICKER", size: "12" }, Math.round(before.x1 / 10) * 10 - 20, Math.round(before.y2 / 10) * 10, 0); S.comps.push(n); C.commit();
    await new Promise(r => setTimeout(r, 150));
    const rep = TubeCAD.stickerReport(), after = rep.list.find(t => t.kind === "v" && t.txt === "300V");
    S.comps = S.comps.filter(c => c !== n); C.commit();
    return { before, after, onText: rep.onText, rail: !!rail };
  });
  check(moved.after && (moved.after.x1 !== moved.before.x1 || moved.after.y1 !== moved.before.y1) && !moved.onText.length, `a text placed over a sticker pushes the sticker to a free spot (300V moved from ${Math.round(moved.before.x1)},${Math.round(moved.before.y1)} to ${moved.after && Math.round(moved.after.x1)},${moved.after && Math.round(moved.after.y1)})`);
  // Mirror (M): the transistor takes its base from the other side
  const mir = await cad.evaluate(() => { const S = TubeCAD.state, q = S.comps.find(c => c.label === "VT1"), pin = id => TubeCAD.compPins(q).find(p => p.id === id); const b0 = pin("B").x - q.x; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(q.id); TubeCAD.mirrorSelection(); const r = { b0, b1: pin("B").x - q.x, c1: pin("C").y - q.y, flip: q.params.flip }; TubeCAD.undo(); return r; });
  check(mir.b0 === -30 && mir.b1 === 30 && mir.c1 === -30 && mir.flip === "yes", "Mirror (M) flips a transistor left to right: the base moves to the other side, the collector stays on top");
  // Mirror works for every part that rotates, new ones included, and the oscilloscope; not for the frame or notes
  const mall = await cad.evaluate(() => {
    const C = TubeCAD, L = CadLib.LIB, bad = [], skip = [];
    for (const type of Object.keys(L)) {
      const c = C.makeComp(type, {}, 5000, 5000, 0);
      if (L[type].noRotate && !L[type].mirror) { c.params.flip = "yes"; if (C.compPins(c).some((p, i) => p.x !== C.compPins(Object.assign({}, c, { params: { ...c.params, flip: "no" } }))[i].x)) bad.push(type + " (should not mirror)"); skip.push(type); continue; }
      const a = C.compPins(c); c.params.flip = "yes"; const b = C.compPins(c);
      if (a.some((p, i) => b[i].x - 5000 !== -(p.x - 5000) || b[i].y !== p.y)) bad.push(type);
    }
    return { bad, skip };
  });
  check(!mall.bad.length && mall.skip.sort().join() === "frame,note", `Mirror flips the pins of every rotatable part, and the oscilloscope, left to right (${mall.bad.length ? "wrong: " + mall.bad.join(", ") : "all " + (await cad.evaluate(() => Object.keys(CadLib.LIB).length)) + " types checked"}; frame and notes stay put)`);
  // the oscilloscope mirrored: its inputs on the right, the Mirror field in its inspector, the screen still upright (no rotation)
  const scm = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state, c = C.makeComp("scope", {}, 5000, 5000, 0); S.comps.push(c);
    S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(c.id); C.updateInspector();
    const field = [...document.querySelectorAll("#inspector .row")].some(r => /Mirror/.test(r.textContent));
    C.mirrorSelection(); const pins = C.compPins(c).map(p => p.x - 5000), rot0 = c.rot;
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "r", code: "KeyR", bubbles: true }));
    const out = { field, flip: c.params.flip, pins, rot: c.rot, rot0 };
    S.comps = S.comps.filter(k => k !== c); C.commit(); return out;
  });
  check(scm.field && scm.flip === "yes" && scm.pins.every(x => x === 80) && scm.rot === 0, `the oscilloscope mirrors: its CH1, CH2 and COM inputs move to the right (${scm.pins.join(", ")}); it still does not rotate`);
  const mins = await cad.evaluate(async () => {
    const S = TubeCAD.state, cap = S.comps.find(c => c.type === "zener"); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(cap.id); TubeCAD.commit();
    await new Promise(r => setTimeout(r, 50));
    const row = [...document.querySelectorAll("#inspector .row")].find(r => /Mirror/.test(r.textContent)), btn = [...document.querySelectorAll("#inspector button")].find(b => /Mirror/.test(b.textContent));
    return { row: !!row, btn: !!btn && !btn.disabled };
  });
  check(mins.row && mins.btn, "the inspector of any part (here a zener) has the Mirror field and button");
  // stickers: drawn when Currents is on (the canvas changes when it is turned off)
  const shot = () => cad.locator("#cad").screenshot();
  const amps = async () => { await cad.click("#btn-view"); await cad.click("#btn-amps"); await cad.keyboard.press("Escape"); };
  const on = await shot(); await amps(); const off = await shot(); await amps();
  check(!on.equals(off) && await cad.evaluate(() => TubeCAD.state.showAmps), "Currents toggles the current stickers on the wires");
  // hovering a wire reports its current too
  const cb = await cad.locator("#cad").boundingBox();
  const [hx, hy] = await cad.evaluate(() => { const v = TubeCAD.state.view; return [300 * v.scale + v.ox, 150 * v.scale + v.oy]; });
  await cad.mouse.move(cb.x + hx, cb.y + hy);
  const hov = await cad.textContent("#status-hover");
  check(/I →\d/.test(hov) && /mA DC/.test(hov), `hovering the rail shows its current ("${hov.trim()}")`);
}
