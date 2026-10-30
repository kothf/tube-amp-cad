// Auto-tune: the Tune tab's goals and values, a short run on example 06, Apply and Undo, and
// AI start against a stand-in provider
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "BA1") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 60000 });

  await cad.click("#btn-ai"); await cad.click("#menu-ai-tune");
  check(await cad.evaluate(() => !document.getElementById("tune-pane").hidden), "AI ▾ → Auto-tune opens the Tune tab");
  const qs = await cad.evaluate(() => TubeCAD.tune.quantities().map(q => q.label));
  check(qs.some(l => /^BA1 output/.test(l)) && qs.some(l => /^BA1 THD/.test(l)), `goals can be any measurement, the speaker's power and THD among them (${qs.length})`);
  await cad.click("#btn-tune-suggest");
  const sug = await cad.evaluate(() => TubeCAD.tune.state.vars.map(v => TubeCAD.state.comps.find(c => c.id === v.id).label));
  check(sug.includes("R10"), `Suggest adds the resistors at the tubes' pins (${sug.join(" ")})`);

  // goal: at most 2 W into BA1 (3.4 W now), varying the generator's level only
  await cad.evaluate(() => { const T = TubeCAD.tune.state, S = TubeCAD.state, ba = S.comps.find(c => c.label === "BA1"), g = S.comps.find(c => c.label === "G2");
    T.goals = [{ key: ba.id + ":p", op: "<=", target: 2 }]; T.vars = []; TubeCAD.tune.addVar(g.id, "amp"); T.budget = 40; TubeCAD.tune.render(); });
  const amp0 = await cad.evaluate(() => TubeCAD.state.comps.find(c => c.label === "G2").params.amp);
  await cad.click("#btn-tune-run");
  await cad.waitForFunction(() => TubeCAD.tune.state.run && TubeCAD.tune.state.run.phase === "done", null, { timeout: 180000 });
  const R = await cad.evaluate(() => { const R = TubeCAD.tune.state.run; return { ok: R.ok, evals: R.evals, snapped: R.snapped, text: document.getElementById("tune-pane").innerText }; });
  check(R.ok && R.evals <= 40 && R.snapped && R.snapped[0] < amp0, `the run gets BA1 down to 2 W within its budget (${R.evals} tries, level ${amp0} → ${R.snapped && R.snapped[0]})`);
  await cad.click("#btn-tune-apply");
  check(await cad.evaluate(a => TubeCAD.state.comps.find(c => c.label === "G2").params.amp === a, R.snapped[0]), "Apply sets the found value");
  await cad.evaluate(() => TubeCAD.undo());
  check(await cad.evaluate(() => TubeCAD.state.comps.find(c => c.label === "G2").params.amp) === amp0, "Undo takes it back");

  // AI start: the model's variables and starting values, checked against the circuit
  await cad.route("https://api.anthropic.com/**", route => route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" },
    body: JSON.stringify({ content: [{ type: "text", text: '{"note": "Bias and drive.", "variables": [{"part": "R10", "field": "r", "min": "500", "max": "3k", "start": "1.2k"}, {"part": "R99", "field": "r", "min": "1", "max": "2"}]}' }], stop_reason: "end_turn" }) }));
  await cad.evaluate(() => { localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" }, models: {} })); TubeCAD.ai.render(); });
  await cad.click("#btn-tune-ai");
  await cad.waitForFunction(() => /Values to change/.test(document.getElementById("ai-log").innerText));
  const ai = await cad.evaluate(() => ({ vars: TubeCAD.tune.state.vars.map(v => `${TubeCAD.state.comps.find(c => c.id === v.id).label} ${v.lo} ${v.hi}`), r10: TubeCAD.state.comps.find(c => c.label === "R10").params.r, log: document.getElementById("ai-log").innerText, tab: !document.getElementById("tune-pane").hidden }));
  check(ai.vars.join() === "R10 500 3000" && ai.r10 === 1200 && /Left out.*R99/.test(ai.log) && ai.tab, `AI start sets the variables and the start, and leaves out parts that don't exist (${ai.vars.join()})`);
  await cad.evaluate(() => { TubeCAD.undo(); localStorage.removeItem("tubecad_ai"); TubeCAD.tune.state.goals = []; TubeCAD.tune.state.vars = []; TubeCAD.tune.state.run = null; TubeCAD.tune.render(); });
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
