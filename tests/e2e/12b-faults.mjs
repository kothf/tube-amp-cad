// AI ▾ → Find a fault…: readings typed for the built amplifier, the faults simulated and ranked,
// and the AI's diagnosis (a stand-in for the provider: no network, no real key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  await cad.route("https://api.anthropic.com/**", async route => {
    sent.push(JSON.parse(route.request().postData() || "{}"));
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: "**Most likely: R9 open.** The phase splitter's cathode sits at B+." }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^14-/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "R9") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, null, { timeout: 60000 });

  // the bench: the amplifier as built has R9 open; its voltages are what the meter reads
  const bench = await cad.evaluate(async () => {
    const S = TubeCAD.state, c = S.comps.find(k => k.label === "R9"), g = S.comps.find(k => k.type === "siggen"), amp = g.params.amp;
    c.params.r = 1e9; g.params.amp = 0;
    const net = TubeCAD.buildNetlist(); c.params.r = 47000; g.params.amp = amp;
    const r = TubeSimEngine.simulate(net, { budgetMs: 60000, maxPeriods: 20000 });
    return TubeCAD.faults.points().map(pt => ({ label: pt.label, v: window.Faults.meter(r, pt.net) }));
  });
  await cad.click("#btn-ai"); await cad.click("#menu-ai-fault");
  await cad.waitForSelector("#fault-modal:not([hidden])");
  const rows = await cad.evaluate(() => [...document.querySelectorAll("#fault-rows tr")].map(tr => tr.cells[0].textContent));
  check(rows[0] === "VL1.1 anode" && rows.includes("VL1.2 cathode") && rows.includes("B+") && rows.includes("VL2 cathode · VL3 cathode"), `the test points start at the tubes' pins, anode first, then the supply (${rows.length}: ${rows.slice(0, 4).join(", ")} …)`);
  // a builder's six readings: the anodes and cathodes
  const want = ["VL1.1 anode", "VL1.1 cathode", "VL1.2 anode", "VL1.2 cathode", "VL2 anode", "VL2 cathode · VL3 cathode"];
  for (const label of want) { const k = rows.indexOf(label), v = bench.find(b => b.label === label).v; await cad.fill(`#fault-in-${k}`, v.toFixed(1)); }
  await cad.fill(`#fault-in-${rows.indexOf("B+")}`, "abc");
  await cad.click("#btn-fault-go");
  check(await cad.evaluate(() => !document.getElementById("fault-modal").hidden && /not a number/.test(document.getElementById("fault-out").textContent)), "a reading that is not a number is refused, and the dialog stays");
  await cad.fill(`#fault-in-${rows.indexOf("B+")}`, "");
  await cad.click("#btn-fault-go");
  await cad.waitForFunction(() => /Fault finder · 6 readings/.test(document.getElementById("ai-log").innerText), null, { timeout: 180000 });
  const out = await cad.evaluate(() => ({ text: document.getElementById("ai-log").innerText, first: document.querySelector(".fault-table tr:nth-child(3) td").innerText }));
  check(/Most likely: R9 open circuit/.test(out.text) && out.first === "R9 open circuit" && /As drawn \(no fault\)\s+poor/.test(out.text), "the faults are simulated and R9 open, the fault built in, comes first; the circuit as drawn matches poorly");
  check(/Add an AI key/.test(out.text) && !sent.length, "without a key the ranking stands on its own and nothing is sent");
  const kept = await cad.evaluate(() => { const j = JSON.parse(TubeCAD.circuitJSON()); return j.comps.reduce((n, c) => n + Object.keys(c.meas || {}).length, 0); });
  check(kept === 6, `the readings are kept on the parts' pins and saved with the circuit (${kept})`);

  // with a key: the AI gets the readings and the ranking, and writes the diagnosis
  await cad.evaluate(() => localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })));
  await cad.click("#btn-ai-fault");
  await cad.waitForSelector("#fault-modal:not([hidden])");
  check(await cad.evaluate(() => document.getElementById("fault-in-0").value !== ""), "the dialog opens with the readings typed before");
  await cad.click("#btn-fault-go");
  await cad.waitForFunction(() => /R9 open\.\s*The phase splitter/.test(document.getElementById("ai-log").innerText), null, { timeout: 180000 });
  const p = sent[0] && JSON.stringify(sent[0].messages);
  check(!!p && /VL1\.2 cathode: measured 30\d/.test(p) && /1\. R9 open circuit/.test(p) && /lethal charge/.test(JSON.stringify(sent[0].system)), "the AI is sent each reading against the circuit as drawn and the ranked faults, and writes the diagnosis");
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  await cad.unrouteAll({ behavior: "ignoreErrors" });
  // the parts after this one start from example 06, simulated, as 12-ai leaves it
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "BA1") && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result && TubeCAD.state.sim.topo === TubeCAD.state.topo, null, { timeout: 60000 });
}
