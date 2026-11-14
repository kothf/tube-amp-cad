// Logic ICs and the logic source in the CAD: a 74HC14 RC oscillator clocking a 74HC393, a logic
// source into a CD4017; the Transient tab's logic pane and D() traces; the ERC, the footprints and
// the SPICE export of the logic parts
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const built = await cad.evaluate(async () => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = [];
    const add = (type, params, x, y, rot, label) => { const c = C.makeComp(type, params, x, y, rot || 0); if (label) c.label = label; S.comps.push(c); return c; };
    const pin = (c, id) => C.compPins(c).find(p => p.id === id);
    const wire = (a, b, hFirst) => C.lRoute(a.x, a.y, b.x, b.y, hFirst !== false).forEach(s => C.addSegment(...s));
    const gnd = p => { const g = add("ground", {}, p.x, p.y + 30); wire(p, pin(g, "G"), false); };
    const rail = (p, dy) => { const r = add("rail", { name: "VCC", v: 5 }, p.x, p.y + (dy || -30)); wire(p, C.compPins(r)[0], false); };
    // the oscillator: a Schmitt inverter, 10 kΩ from its output back to its input, 10 nF to ground
    const U1 = add("logic", { model: "74HC14" }, 300, 300, 0, "DD1.1"), R1 = add("resistor", { r: 10e3 }, 300, 220), C1 = add("capacitor", { c: 10e-9 }, 230, 360, 1);
    rail(pin(U1, "VCC")); gnd(pin(U1, "GND"));
    wire(pin(U1, "Y"), pin(R1, "2"), false); wire(pin(R1, "1"), pin(U1, "A"), false); wire(pin(U1, "A"), pin(C1, "1"), true); gnd(pin(C1, "2"));
    // its output clocks a counter: four bits
    const U2 = add("logic", { model: "74HC393" }, 520, 320, 0, "DD2.1");
    rail(pin(U2, "VCC")); gnd(pin(U2, "GND")); wire(pin(U1, "Y"), pin(U2, "CP"), true); gnd(pin(U2, "MR"));
    const outs = ["Q0", "Q1", "Q2", "Q3"].map((q, k) => { const o = add("offsheet", { name: "B" + k }, pin(U2, q).x + 40, pin(U2, q).y); wire(pin(U2, q), C.compPins(o)[0], true); return o; });
    // a logic source into a decade counter
    const G = add("logicsrc", { wave: "clock", freq: 100e3, vhi: 5 }, 300, 560, 0, "G1"), U3 = add("logic", { model: "CD4017" }, 520, 600, 0, "DD3");
    gnd(pin(G, "-")); rail(pin(U3, "VCC")); gnd(pin(U3, "GND")); gnd(pin(U3, "CE")); gnd(pin(U3, "RST")); wire(pin(G, "+"), pin(U3, "CLK"), true);
    const q3 = add("offsheet", { name: "S3" }, pin(U3, "Q3").x + 40, pin(U3, "Q3").y); wire(pin(U3, "Q3"), C.compPins(q3)[0], true);
    S.sel.comps.clear(); C.commit(); C.fitView();
    const T = C.topo(), open = [];
    S.comps.forEach(c => C.compPins(c).forEach(p => { if (!T.pinConnected.get(`${c.id}:${p.id}`)) open.push(`${c.label}.${p.id}`); }));
    return { open, outs: outs.length };
  });
  const unused = built.open.filter(x => !/^DD3\.(Q[0-24-9]|CO)$/.test(x));
  check(unused.length === 0, `the logic circuit is wired (open pins other than DD3's unused outputs: ${unused.join(", ") || "none"})`);
  const erc = await cad.evaluate(() => TubeCAD.erc().map(i => `${i.kind}: ${i.text}`));
  check(!erc.some(x => /DD\d/.test(x) && /power|supply|out.*out/i.test(x)), `the ERC has nothing against the logic ICs (${erc.filter(x => /DD\d/.test(x)).join("; ") || "nothing"})`);

  // the transient: the oscillator's period from its formula, the counter dividing it by 2, 4, 8, 16
  await cad.click("#btn-analyze"); await cad.click("#btn-transient"); await cad.keyboard.press("Escape");
  await cad.selectOption("#tr-start", "zero");
  await cad.fill("#tr-stop", "1m"); await cad.press("#tr-stop", "Tab");
  await cad.evaluate(() => TubeCAD.transient.setTraces(["B0", "B1", "B2", "B3"]));
  await cad.click("#btn-tr-run");
  await cad.waitForFunction(() => { const T = TubeCAD.state.tran; return !T.job && (T.result || T.error); }, null, { timeout: 60000 });
  const run = await cad.evaluate(() => {
    const T = TubeCAD.state.tran, r = T.result; if (!r) return { error: T.error };
    const rises = expr => { const q = TubeCAD.transient.shown().find(x => x.expr === expr), out = []; for (let i = 1; i < r.t.length; i++) if (q.y[i - 1] < 2.5 && q.y[i] >= 2.5) out.push(r.t[i]); return out; };
    const b0 = rises("B0"), b3 = rises("B3");
    return { b0: b0.length, b3: b3.length, period: (b0[b0.length - 1] - b0[1]) / (b0.length - 2), digital: (r.digital || []).length };
  });
  // the period of B0 is two of the oscillator's: RC·(ln((1−0.31)/(1−0.53)) + ln(0.53/0.31)) each, 10.05 kΩ with the output's 50 Ω
  const osc = 10.05e3 * 10e-9 * (Math.log(0.69 / 0.47) + Math.log(0.53 / 0.31));
  check(!run.error && Math.abs(run.period / (2 * osc) - 1) < 0.01, `the 74HC14 oscillator clocks the 74HC393: Q0's period ${run.period ? (run.period * 1e6).toFixed(2) : "?"} µs is two of the formula's ${(osc * 1e6).toFixed(2)} µs${run.error ? ` (${run.error})` : ""}`);
  check(run.b0 >= 4 && Math.abs(run.b0 / Math.max(1, run.b3) - 8) <= 4, `Q3 rises an eighth as often as Q0 (${run.b0} and ${run.b3} rising edges)`);

  // the logic pane: lanes, hatching where a trace is between the thresholds, states in the readout
  await cad.click('#tr-pane .tr-logic-b[data-p="0"]');
  const lane = await cad.evaluate(() => ({ svg: !!document.querySelector("#tr-pane svg.tr-logic[data-kind=time]"), lines: document.querySelectorAll("#tr-pane svg.tr-logic polyline").length }));
  check(lane.svg && lane.lines === 4, `Logic shows the pane as a lane per trace (${lane.lines} lanes)`);
  const cb = await cad.locator("#tr-chart").boundingBox();
  await cad.mouse.move(cb.x + cb.width * 0.5, cb.y + cb.height / 2);
  const rd = await cad.textContent("#tr-read");
  check(/B0\s*[01X]\b/.test(rd) && /B3\s*[01X]\b/.test(rd), `the readout gives each lane's state (${rd.replace(/\s+/g, " ").trim().slice(0, 80)})`);
  await cad.click('#tr-pane .tr-logic-b[data-p="0"]');

  // a logic net of the simulator by name: the 4017's decoded output as D(DD3:Q3)
  const dn = await cad.evaluate(() => [...document.querySelectorAll("#tr-add optgroup option")].map(o => o.value));
  check(dn.includes("D(DD3:Q3)") && dn.includes("D(DD1.1:Y)"), `+ Plot a net offers the logic nets (${dn.slice(0, 4).join(", ")} … ${dn.length})`);
  await cad.fill("#tr-expr", "D(DD3:Q3)"); await cad.press("#tr-expr", "Enter");
  const d3 = await cad.evaluate(() => { const q = TubeCAD.transient.shown().find(x => x.expr === "D(DD3:Q3)"), r = TubeCAD.state.tran.result; let n = 0; for (let i = 1; i < r.t.length; i++) if (q.y[i - 1] < 0.5 && q.y[i] > 0.5) n++; return { ok: !!q.y, n, s3: TubeCAD.transient.shown().length }; });
  // a 100 kHz clock for 1 ms: 100 counts, Q3 every tenth
  check(d3.ok && d3.n === 10, `D(DD3:Q3) plots the 4017's Q3: high once every ten clocks (${d3.n} times in 1 ms)`);

  // the board: the gates of one package share it, DIP-14 and DIP-16; the SPICE export writes XSPICE
  const fp = await cad.evaluate(() => BoardCore.physicalParts(TubeCAD.boardNetlist()).filter(g => /^DD/.test(g.ref)).map(g => `${g.ref} ${g.defaultFp} (${g.members.length})`));
  check(fp.some(x => /^DD1 DIP-14/.test(x)) && fp.some(x => /^DD3 DIP-16/.test(x)), `the logic ICs get DIP footprints (${fp.join(", ")})`);
  const sp = await cad.evaluate(() => TubeCAD.spiceNetlist());
  check(/\.subckt LOGIC_74HC14 A Y VCC GND/.test(sp) && /d_inverter/.test(sp) && /\.subckt LOGIC_CD4017/.test(sp) && /PULSE\(0 5 0 /.test(sp) && /\.tran .* uic/.test(sp), "the SPICE export writes each logic type as an XSPICE subcircuit, the logic source as a PULSE, and starts from zero");
  // a maker's card named N1 (as BSIM cards often are): the nets then go out as NET1 …, not N1, which
  // ngspice would read as the model
  const sp2 = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state, m = C.makeComp("spice", { name: "N1", text: ".model N1 nmos level=1 vto=1 kp=1e-3", sub: "N1", sym: "nmos", pinNames: ["D", "G", "S"], map: ["D", "G", "S"] }, 900, 700, 0);
    S.comps.push(m); C.commit(); const out = C.spiceNetlist(); S.comps.pop(); C.commit(); return out;
  });
  check(!/\bN\d+\b/.test(sp2.replace(/^\.model N1 .*$/m, "")) && /\bNET\d+\b/.test(sp2), "a model named N1 moves the exported nets to NET1 …");
}
