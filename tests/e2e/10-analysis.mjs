// Analyses under the schematic: the power sweep
import { cad, check } from "./harness.mjs";

// --- Power sweep ----------------------------------------------------------------------------
{
  await cad.bringToFront();
  cad.once("dialog", d => d.accept());
  const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^05-/.test(x.file))));
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, s0, { timeout: 60000 });
  await cad.click("#btn-view"); await cad.click("#btn-power"); await cad.keyboard.press("Escape");
  check(await cad.evaluate(() => !document.getElementById("pw-pane").hidden && document.getElementById("btn-power").getAttribute("aria-checked") === "true"), "View ▾ → Power sweep opens the Power tab, ticked");
  const out = await cad.evaluate(() => [...document.querySelectorAll("#pw-out option")].map(o => o.textContent));
  check(out[0] === "BA1 speaker" && out.some(o => /P1 CH1/.test(o)), `the output list offers the speaker first, then the scope channels (${out.join(", ")})`);
  for (const [id, v] of [["#pw-lo", "-12"], ["#pw-hi", "12"], ["#pw-steps", "9"]]) { await cad.fill(id, v); await cad.press(id, "Tab"); }
  const seq = await cad.evaluate(() => TubeCAD.state.power.seq);
  await cad.click("#btn-pw-run");
  await cad.waitForFunction(seq => TubeCAD.state.power.seq !== seq && !TubeCAD.state.power.job && TubeCAD.state.power.points, seq, { timeout: 180000 });
  const P = await cad.evaluate(() => { const P = TubeCAD.state.power; return { n: P.points.length, ok: P.points.filter(p => p.out > 0).length, refined: P.points.filter(p => Math.abs(p.db * 1e3 % 3000) > 1).length, now: P.points.find(p => p.db === 0), unit: P.unit }; });
  const sp = await cad.evaluate(() => TubeCAD.state.comps.find(c => c.type === "speaker").id);
  const pNow = await cad.evaluate(id => TubeCAD.measurements().find(m => m.key === id + ":p").v, sp);
  check(P.ok === P.n && P.n > 9 && P.refined > 0, `9 levels and more around the THD marks all settle (${P.n} levels, ${P.refined} added)`);
  check(P.unit === "W" && Math.abs(P.now.out / pNow - 1) < 0.02, `at 0 dB the sweep reads the speaker's power as the simulation does (${P.now.out.toFixed(3)} W vs ${pNow.toFixed(3)} W)`);
  const cards = await cad.evaluate(() => [...document.querySelectorAll(".pw-card b")].map(b => b.textContent));
  const w1 = parseFloat(cards[0]);
  check(/W$/.test(cards[0]) && w1 > 6 && w1 < 10 && parseFloat(cards[2]) > w1, `the cards read the power at 1 % and 10 % THD (${cards.join(" · ")})`);
  check(await cad.locator("#pw-pane .pw-chart circle.pt").count() === P.n && await cad.locator("#pw-table tbody tr").count() === P.n, "the chart and the table show every level");
  // Use: the generator goes to that level, one undo step back
  const amp = () => cad.evaluate(() => TubeCAD.state.comps.find(c => c.type === "siggen").params.amp);
  const a0 = await amp(), k = await cad.evaluate(() => TubeCAD.state.power.points.findIndex(p => p.db === 6));
  await cad.locator(`#pw-table tr[data-i="${k}"]`).hover(); await cad.click(`#pw-table .pw-use[data-i="${k}"]`);
  const a1 = await amp();
  check(Math.abs(a1 / a0 - Math.pow(10, 6 / 20)) < 1e-3, `Use sets the generator to that level (+6 dB: ${a0} → ${a1} Vpk)`);
  check(await cad.locator("#pw-pane .tol-note").count() === 1, "the edit marks the sweep as the old circuit's");
  await cad.evaluate(() => TubeCAD.undo());
  check(await amp() === a0, "undo puts the generator back");
  // a circuit without a generator says what is missing
  await cad.evaluate(() => { const S = TubeCAD.state; S.comps = S.comps.filter(c => c.type !== "siggen"); TubeCAD.commit(); });
  await cad.click("#btn-pw-run");
  check(/signal generator/.test(await cad.textContent("#pw-pane")), "without a generator the tab says the sweep needs one");
  await cad.evaluate(() => TubeCAD.undo());
  await cad.evaluate(() => TubeCAD.toggleBom(false));
}
