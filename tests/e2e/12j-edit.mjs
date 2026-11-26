// AI ▾ → Edit by command…: the AI's edits (set, connect, add, delete) made in place on the drawing as one
// step to undo, checked against the parts (a stand-in for the provider: no network, no real key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  let answer = "";
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: answer }], stop_reason: "end_turn" }) });
  });
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "VL2") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 60000 });
  await cad.evaluate(() => { localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })); TubeCAD.state.ai.log = []; TubeCAD.ai.render(); });
  const g = await cad.evaluate(() => { const T = TubeCAD.topo(), c = TubeCAD.state.comps.find(c => c.label === "VL2"); return TubeCAD.ai.netNames().get(T.pinNet.get(c.id + ":G1")); });
  const n0 = await cad.evaluate(() => ({ comps: TubeCAD.state.comps.length, wires: TubeCAD.state.wires.length }));
  answer = JSON.stringify({ summary: "A grid stopper on VL2, re-biased.", edits: [
    { op: "connect", part: "VL2", pin: "G1", net: "VL2G" },
    { op: "add", ref: "R50", type: "resistor", values: { r: "1k" }, pins: { 1: g, 2: "VL2G" } },
    { op: "set", part: "R10", field: "r", value: "1.2k" },
    { op: "delete", part: "C5'" },
    { op: "set", part: "R99", field: "r", value: "1k" }] });
  await cad.click("#btn-ai"); await cad.click("#menu-ai-edit");
  await cad.fill("#edit-text", "Add a 1 kΩ grid stopper in front of VL2 and re-bias it");
  await cad.click("#btn-edit-go");
  await cad.waitForFunction(() => /Ctrl\+Z takes the whole edit back/.test(document.getElementById("ai-log").innerText), null, { timeout: 60000 });
  const p = JSON.stringify(sent[0]);
  check(/The circuit on the sheet now/.test(p) && /grid stopper in front of VL2/.test(p) && /connect moves one pin/.test(p), "the AI gets the circuit with its nets, the change asked for and the edits it can make");
  const r = await cad.evaluate(() => {
    const S = TubeCAD.state, T = TubeCAD.topo(), by = l => S.comps.find(c => c.label === l), net = (l, pin) => T.pinNet.get(by(l).id + ":" + pin);
    return { r50: !!by("R50"), stop: net("R50", "2") === net("VL2", "G1"), old: net("R50", "1") === net("VL1.1", "A"), apart: net("VL2", "G1") !== net("VL1.1", "A"), r10: by("R10").params.r, c5: !!by("C5'"), sel: [...S.sel.comps].map(id => S.comps.find(c => c.id === id).label).sort().join(), log: document.getElementById("ai-log").innerText };
  });
  check(r.r50 && r.stop && r.old && r.apart && r.r10 === 1200 && !r.c5, `the edits are made: R50 between VL1.1's anode and VL2's grid, R10 1.2 kΩ, C5' deleted (${JSON.stringify({ r50: r.r50, stop: r.stop, old: r.old, apart: r.apart, r10: r.r10 })})`);
  check(r.sel === "R10,R50,VL2" && /there is no part R99/.test(r.log) && /Checks list \d+ problems? \(\d+ before\)/.test(r.log), `what changed is selected (${r.sel}); an edit of a part that does not exist is left out; the Checks are compared`);
  await cad.evaluate(() => TubeCAD.undo());
  const n1 = await cad.evaluate(() => ({ comps: TubeCAD.state.comps.length, wires: TubeCAD.state.wires.length, r50: TubeCAD.state.comps.some(c => c.label === "R50"), c5: TubeCAD.state.comps.some(c => c.label === "C5'"), r10: TubeCAD.state.comps.find(c => c.label === "R10").params.r }));
  // (the undo history is capped, so its index is not compared: a long run before this part fills it)
  check(n1.comps === n0.comps && n1.wires === n0.wires && !n1.r50 && n1.c5 && n1.r10 === 1500, `one Undo takes the whole edit back (${JSON.stringify(n1)} vs ${JSON.stringify(n0)})`);
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
