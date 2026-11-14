// A SPICE part: a maker's model pasted into a part, simulated as written, exported, and said in the checks
import { cad, check } from "./harness.mjs";
import { readFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";

{
  const AMP = await readFile(new URL("../fixtures/testamp.lib", import.meta.url), "utf8"), DEV = await readFile(new URL("../fixtures/devices.lib", import.meta.url), "utf8");
  check(await cad.evaluate(() => [...document.querySelectorAll("#palette .pal-item")].some(el => /SPICE part/.test(el.textContent))), "palette: Integrated circuits offers the SPICE part");
  // an inverting ×10 stage around a SPICE part still without a model, drawn as an op-amp
  const id = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
    const add = (type, params, x, y, rot) => { const c = C.makeComp(type, params, x, y, rot || 0); S.comps.push(c); return c; };
    const pin = (c, p) => C.compPins(c).find(q => q.id === p);
    const wire = (p, q, hFirst) => C.lRoute(p.x, p.y, q.x, q.y, hFirst !== false).forEach(s => C.addSegment(...s));
    const U = add("spice", { sym: "opamp", pinNames: ["1", "2", "3", "4", "5"], map: ["+", "-", "V+", "V-", "OUT"] }, 400, 300, 0), G = add("siggen", { amp: 0.5, freq: 100, rs: 0 }, 200, 340);
    const Ri = add("resistor", { r: 10e3 }, 300, 260, 0), Rf = add("resistor", { r: 100e3 }, 400, 200, 0), RL = add("resistor", { r: 10e3 }, 500, 360, 1);
    const P = add("vdc", { v: 15 }, 600, 140), N = add("vdc", { v: 15 }, 600, 460), g1 = add("ground", {}, 200, 420), g2 = add("ground", {}, 340, 420), g3 = add("ground", {}, 600, 200), g4 = add("ground", {}, 660, 440), g5 = add("ground", {}, 500, 420);
    wire(pin(G, "+"), pin(Ri, "1"), false); wire(pin(Ri, "2"), pin(U, "-")); wire(pin(G, "-"), pin(g1, "G"));
    wire(pin(U, "+"), pin(g2, "G")); wire(pin(Rf, "1"), pin(Ri, "2"), false); wire(pin(Rf, "2"), pin(U, "OUT"), false);
    wire(pin(U, "OUT"), pin(RL, "1")); wire(pin(RL, "2"), pin(g5, "G"));
    wire(pin(U, "V+"), pin(P, "+"), false); wire(pin(P, "-"), pin(g3, "G")); wire(pin(U, "V-"), pin(N, "-"), false); wire(pin(N, "+"), pin(g4, "G"));
    S.sel.comps.add(U.id); C.commit(); C.updateInspector();
    return U.id;
  });
  const before = await cad.evaluate(() => ({ issues: TubeCAD.circuitIssues().join(" | "), insp: document.getElementById("inspector").textContent.replace(/\s+/g, " ") }));
  check(/DA1 has no SPICE model yet/.test(before.issues) && /No model yet/.test(before.insp) && /none yet/.test(before.insp), "a SPICE part without a model says so, in the inspector and in the checks");

  // Model…: the text is read, five pins are taken as an op-amp in the usual order
  await cad.click("#btn-spice-model");
  await cad.fill("#sppart-text", AMP);
  await cad.waitForFunction(() => !document.getElementById("sppart-ok").disabled, null, { timeout: 5000 }).catch(() => {});
  const dlg = await cad.evaluate(() => ({ sub: document.getElementById("sppart-sub").value, name: document.getElementById("sppart-name").value, sym: document.getElementById("sppart-sym").value,
    map: [...document.querySelectorAll("#sppart-pins select")].map(s => s.value).join(","), est: document.getElementById("sppart-est").textContent }));
  check(dlg.sub === "TESTAMP" && dlg.name === "TESTAMP" && dlg.sym === "opamp" && dlg.map === "+,-,V+,V-,OUT" && /11 elements/.test(dlg.est), `Model…: the subcircuit is read (${dlg.est.slice(0, 60)}), an op-amp by its five pins`);
  // two pins of the model on one pin of the symbol: refused with the reason
  await cad.selectOption("#sppart-pins .spimp-pin:nth-child(2) select", "+");
  const why = await cad.evaluate(() => ({ off: document.getElementById("sppart-ok").disabled, title: document.getElementById("sppart-ok").title }));
  check(why.off && /No pin of the model is the symbol's -|Two pins/.test(why.title), `a pin mapped twice is refused (${why.title})`);
  await cad.selectOption("#sppart-pins .spimp-pin:nth-child(2) select", "-");
  const seq0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.click("#sppart-ok");
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, seq0, { timeout: 30000 }).catch(() => {});
  const run = await cad.evaluate(uid => {
    const C = TubeCAD, S = C.state, T = C.topo(), r = S.sim.result, w = r && r.tran && r.tran.nodes[T.pinNet.get(uid + ":OUT")];
    let lo = Infinity, hi = -Infinity; if (w) for (const x of w) { lo = Math.min(lo, x); hi = Math.max(hi, x); }
    const c = S.comps.find(k => k.id === uid);
    return { err: S.sim.error, pp: hi - lo, issues: C.circuitIssues().join(" | "), insp: document.getElementById("inspector").textContent.replace(/\s+/g, " "), value: CadLib.LIB.spice.value(c), saved: JSON.parse(C.circuitJSON()).comps.find(k => k.type === "spice").params };
  }, id);
  check(!run.err && Math.abs(run.pp - 10) < 0.05 && !/SPICE model|cannot be simulated/.test(run.issues), `the stage runs on the model: 1 Vpp in, ${run.pp && run.pp.toFixed(3)} Vpp out (×−10)`);
  check(/SPICE subcircuit TESTAMP, simulated as written: 11 elements/.test(run.insp) && run.value === "TESTAMP" && /\.SUBCKT TESTAMP/.test(run.saved.text) && run.saved.sub === "TESTAMP", "the model is saved in the circuit file with the part, and named in the inspector");

  // the SPICE export: the part as one X line, the model as it came; ngspice (where installed) agrees
  const sp = await cad.evaluate(() => TubeCAD.spiceNetlist());
  check(/^XDA1\S* (\S+ ){5}TESTAMP$/m.test(sp.replace(/^X(c\w+)/m, "XDA1")) && /^\.SUBCKT TESTAMP inp inn vcc vee out$/m.test(sp) && /^\.MODEL DCLAMP/m.test(sp), "SPICE export: the part as a subcircuit call, with its model as it came");
  let ng = null; try { execFileSync("ngspice", ["-v"], { stdio: "ignore" }); ng = true; } catch { ng = false; }
  if (ng) {
    const out = /^R\S+ (\S+) 0 10000$/m.exec(sp)?.[1];
    const res = execFileSync("ngspice", ["-b"], { input: sp.replace(/^\.end\s*$/m, `.control\nrun\nmeas tran hi max v(${out})\nmeas tran lo min v(${out})\n.endc\n.end`), encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] });
    const hi = +(/hi\s*=\s*([-+.\de]+)/i.exec(res) || [])[1], lo = +(/lo\s*=\s*([-+.\de]+)/i.exec(res) || [])[1];
    check(Math.abs(hi - lo - run.pp) < 0.03, `ngspice runs the export and gives the same swing (${(hi - lo).toFixed(3)} Vpp)`);
  }

  // a model the simulator cannot run: said in the dialog; put in a part by hand, the part is left out and the checks say why
  await cad.click("#btn-spice-model");
  await cad.fill("#sppart-text", ".subckt lap in out\nE1 out 0 CHEBYSHEV {V(in)} = LP 1k 2k 0.1 50\n.ends");
  await cad.waitForFunction(() => /cannot be simulated/.test(document.getElementById("sppart-msg").textContent), null, { timeout: 5000 }).catch(() => {});
  const bad = await cad.evaluate(() => ({ off: document.getElementById("sppart-ok").disabled, msg: document.getElementById("sppart-msg").textContent }));
  check(bad.off && /cannot be simulated/.test(bad.msg) && /CHEBYSHEV/i.test(bad.msg), "a model with a CHEBYSHEV source is refused in the dialog, with the reason");
  // a lone .MODEL out of a file of several parts: found with its kind, drawn as that device
  await cad.fill("#sppart-text", DEV);
  await cad.selectOption("#sppart-sub", "qtest");
  const dev = await cad.evaluate(() => ({ n: document.getElementById("sppart-sub").options.length, sym: document.getElementById("sppart-sym").value, map: [...document.querySelectorAll("#sppart-pins select")].map(s => s.value).join(","), count: document.getElementById("sppart-count").textContent }));
  check(dev.n === 8 && dev.sym === "npn" && dev.map === "C,B,E" && /8 parts/.test(dev.count), `a library of several parts lists them (${dev.count}); a lone NPN model takes the transistor's symbol`);
  await cad.click("#sppart-cancel");
  check(await cad.evaluate(() => document.getElementById("sppart-modal").hidden && TubeCAD.state.comps.find(c => c.type === "spice").params.sub === "TESTAMP"), "Cancel leaves the part's model as it was");
  // --- the rules on pin types: an op-amp input behind a capacitor only is named in the Checks; a resistor to ground clears it ---
  const ercOf = () => cad.evaluate(() => TubeCAD.circuitIssues().join(" | "));
  const ids = await cad.evaluate(() => {
    const C = TubeCAD, S = C.state, U = S.comps.find(c => c.type === "spice"), pin = (c, p) => C.compPins(c).find(q => q.id === p);
    // cut the + input from ground: a capacitor in between
    const g = S.comps.filter(c => c.type === "ground").find(c => { const p = pin(c, "G"), q = pin(U, "+"); return C.topo().pinNet.get(U.id + ":+") === 0 && Math.abs(p.x - q.x) < 80 && p.y > q.y; });
    S.wires = S.wires.filter(w => !((w.x1 === pin(U, "+").x && w.y1 === pin(U, "+").y) || (w.x2 === pin(U, "+").x && w.y2 === pin(U, "+").y)));
    const cap = C.makeComp("capacitor", { c: 1e-6 }, 300, 380, 0); S.comps.push(cap);
    const wire = (p, q, h) => C.lRoute(p.x, p.y, q.x, q.y, h !== false).forEach(s => C.addSegment(...s));
    wire(pin(U, "+"), pin(cap, "2"), false); wire(pin(cap, "1"), pin(g, "G"), false);
    C.commit(); return { u: U.id, label: U.label, cap: cap.id };
  });
  const flagged = await ercOf();
  check(new RegExp(`No DC path for ${ids.label}\\.\\+: only capacitors`).test(flagged), `Checks: an input with only a capacitor on it has no DC path (${(/No DC path[^|]*/.exec(flagged) || [flagged.slice(0, 80)])[0].slice(0, 60)}…)`);
  await cad.evaluate(i => {
    const C = TubeCAD, S = C.state, U = S.comps.find(c => c.id === i.u), pin = (c, p) => C.compPins(c).find(q => q.id === p);
    const r = C.makeComp("resistor", { r: 1e6 }, 340, 340, 1), g = C.makeComp("ground", {}, 340, 400, 0); S.comps.push(r, g);
    const wire = (p, q, h) => C.lRoute(p.x, p.y, q.x, q.y, h !== false).forEach(s => C.addSegment(...s));
    wire(pin(U, "+"), pin(r, "1"), true); wire(pin(r, "2"), pin(g, "G"), false); C.commit();
  }, ids);
  check(!/No DC path/.test(await ercOf()), "a resistor to ground gives the path: the message goes");
  // every example passes the rules
  const yes = d => d.accept().catch(() => {});
  cad.on("dialog", yes);
  const seen = await cad.evaluate(async () => { const out = []; for (const ex of TubeCAD.EXAMPLES) { await TubeCAD.openExample(ex); out.push({ file: ex.file, parts: TubeCAD.state.comps.length, erc: TubeCAD.erc().map(i => i.text) }); } return out; });
  cad.off("dialog", yes);
  const dirty = seen.filter(x => x.erc.length).map(x => `${x.file}: ${x.erc[0]}`);
  check(seen.length >= 20 && seen.every(x => x.parts > 5) && dirty.length === 0, `all ${seen.length} examples pass the pin rules${dirty.length ? ": " + dirty.join(" | ").slice(0, 300) : ""}`);
  await cad.evaluate(() => { const S = TubeCAD.state; S.comps = []; S.wires = []; S.sel.comps.clear(); TubeCAD.commit(); });
}
