// Runs last: it opens examples and leaves its own circuit behind, which the board part (07) must not inherit.
// Parts a signal drives: what the inspector, Checks, the needles and lamps show with the signal on
// (the averages over its cycle, not the operating point at rest); the Transient tab's pin currents
// of ideal inputs and connectors
import { cad, check } from "./harness.mjs";

// a circuit from a generator through parts in a row to ground: [type, params, in pin, out pin] each
let seq0 = 0;
const build = async (gen, chain) => { seq0 = await cad.evaluate(() => TubeCAD.state.sim.seq); return cad.evaluate(([gen, chain]) => {
  const C = TubeCAD, S = C.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear();
  const pin = (c, p) => C.compPins(c).find(q => q.id === p), wire = (p, q) => C.lRoute(p.x, p.y, q.x, q.y, true).forEach(s => C.addSegment(...s));
  const place = (type, params, pid, to, dx, dy, rot) => { const c = C.makeComp(type, params, 0, 0, rot || 0), p = pin(c, pid); c.x = to.x + dx - p.x; c.y = to.y + dy - p.y; S.comps.push(c); wire(to, pin(c, pid)); return c; };
  const G = C.makeComp("siggen", gen, 200, 300, 0); S.comps.push(G);
  place("ground", {}, "G", pin(G, "-"), 0, 30);
  let at = pin(G, "+"); const ids = [];
  chain.forEach(([type, params, a, b]) => {
    // each part laid left to right: its in pin 60 units on, its out pin further right
    let c = place(type, params, a, at, 60, 0, 0);
    if (pin(c, b).x <= pin(c, a).x) { S.comps.pop(); S.wires.pop(); c = place(type, params, a, at, 60, 0, 2); }
    ids.push(c.id); at = pin(c, b);
  });
  place("ground", {}, "G", at, 0, 40);
  C.commit(); return ids;
}, [gen, chain]); };
// the run of the circuit just built
const settle = () => cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, seq0, { timeout: 60000 });
const inspect = id => cad.evaluate(id => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.comps.add(id); TubeCAD.updateInspector(); return document.getElementById("insp-live").textContent.replace(/\s+/g, " "); }, id);
const comp = id => `TubeCAD.state.comps.find(c => c.id === "${id}")`;

// --- a rectifier meter on a sine: at rest it reads nothing, with the signal its average ---
{
  const [d, m] = await build({ wave: "sine", freq: 1000, amp: 10, rs: 0.1 }, [["diode", { model: "1N4007" }, "A", "K"], ["meter", { kind: "a", fs: "1m" }, "+", "-"], ["resistor", { r: 10e3 }, "1", "2"]]);
  await settle();
  const t = await inspect(m), x = await cad.evaluate(s => TubeCAD.meterReading(eval(s)), comp(m));
  const pct = +((/(\d+) % of full scale/.exec(t) || [])[1] || -1);
  check(pct > 22 && pct < 34 && /average over the signal's cycle/.test(t) && x > 0.22 && x < 0.34, `a rectifier meter on a 10 V sine reads its average, about 29 % of 1 mA (${pct} %, needle ${x && x.toFixed(3)}): ${t.slice(0, 160)}`);
  const td = await inspect(d);
  check(/Current with signal \(avg\)\s*2\d\d(\.\d+)?µA/.test(td), `the diode shows its average current with the signal (${td.slice(0, 160)})`);
}
// --- a neon on 115 V peak: dark at rest, lit on the peaks ---
{
  const [, n] = await build({ wave: "sine", freq: 50, amp: 115, rs: 0.1 }, [["resistor", { r: 100e3 }, "1", "2"], ["neon", { model: "NE-2" }, "A", "K"]]);
  await settle();
  const t = await inspect(n), q = +((/lit (\d+) % of the time/.exec(t) || [])[1] || 0);
  check(q > 20 && q < 95 && /strikes on the peaks/.test(t), `a neon on a 115 V peak sine: lit ${q} % of the time, not "dark" (${t.slice(0, 160)})`);
  check(await cad.evaluate(s => TubeCAD.ledLevel(eval(s)), comp(n)) > 0, "it is drawn lit");
}
// --- an LED on a 5 V sine: lit without Animate, its average current shown; past its maximum, Checks says so ---
{
  const [, l] = await build({ wave: "sine", freq: 1000, amp: 5, rs: 0.1 }, [["resistor", { r: 220 }, "1", "2"], ["led", { color: "red" }, "A", "K"]]);
  await settle();
  const t = await inspect(l);
  check(/Current with signal \(avg\)/.test(t) && await cad.evaluate(s => TubeCAD.ledLevel(eval(s)), comp(l)) > 0, `an LED a signal drives is lit and shows its average current (${t.slice(0, 160)})`);
  await build({ wave: "sine", freq: 1000, amp: 12, rs: 0.1 }, [["resistor", { r: 33 }, "1", "2"], ["led", { color: "red" }, "A", "K"]]);
  await settle();
  check((await cad.evaluate(() => TubeCAD.circuitIssues())).some(s => /LED, red\) carries .* on average, more than its \d+ mA maximum/.test(s)), "Checks: an LED driven past its maximum by the signal");
}
// --- Transient: a 555's trigger input draws nothing (no error); a connector says it carries no current of its own ---
{
  cad.once("dialog", dl => dl.accept().catch(() => {}));
  const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^16-/.test(x.file))));
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy, s0, { timeout: 60000 });
  await cad.evaluate(() => { const T = TubeCAD.transient; T.opts.mode = "tran"; T.opts.stop = "2m"; T.run(); });
  await cad.waitForFunction(() => !TubeCAD.state.tran.job, null, { timeout: 120000 });
  const xt = await cad.evaluate(() => TubeCAD.transient.evalTrace("I(XT1.1)"));
  check(/only joins its nets and carries no current of its own/.test(xt.error || ""), `I(XT1.1) of a terminal block explains itself (${xt.error})`);
}
{
  cad.once("dialog", dl => dl.accept().catch(() => {}));
  const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^11-/.test(x.file))));
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy, s0, { timeout: 60000 });
  await cad.evaluate(() => { const T = TubeCAD.transient; T.opts.mode = "tran"; T.opts.stop = "5m"; T.run(); });
  await cad.waitForFunction(() => !TubeCAD.state.tran.job, null, { timeout: 120000 });
  const tr = await cad.evaluate(() => { const c = TubeCAD.state.comps.find(k => k.type === "timer555"), d = TubeCAD.desig(c), v = TubeCAD.transient.evalTrace(`I(${d}.2)`), w = TubeCAD.transient.evalTrace(`I(${d}.1)`); return { d, err: v.error, zero: v.y && v.y.every(x => x === 0), out: w.y && Math.max(...w.y.map(Math.abs)) }; });
  check(!tr.err && tr.zero && tr.out > 1e-4, `I(${tr.d}.2), the 555's trigger, reads zero (an ideal input) instead of an error; its ground pin carries current (${tr.err || ""} ${tr.out})`);
}
// leave the Transient tab as a fresh page has it (the parts after this one start their own runs)
await cad.evaluate(() => { const T = TubeCAD.state.tran; T.traces = null; T.result = null; T.panes = [{ fft: false }]; T.active = 0; TubeCAD.transient.opts.stop = "10m"; TubeCAD.transient.render(); });
