// Analyses under the schematic: the power sweep, listening
import { cad, check } from "./harness.mjs";

// --- Power sweep ----------------------------------------------------------------------------
{
  await cad.bringToFront();
  cad.once("dialog", d => d.accept().catch(() => {}));
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

// --- Listen ---------------------------------------------------------------------------------
{
  await cad.click("#btn-view"); await cad.click("#btn-listen"); await cad.keyboard.press("Escape");
  check(await cad.evaluate(() => !document.getElementById("ls-pane").hidden && document.getElementById("btn-listen").getAttribute("aria-checked") === "true"), "View ▾ → Listen opens the Listen tab, ticked");
  const render = async () => {
    const seq = await cad.evaluate(() => TubeCAD.state.listen.seq);
    await cad.click("#btn-ls-run");
    await cad.waitForFunction(seq => TubeCAD.state.listen.seq !== seq && !TubeCAD.state.listen.job, seq, { timeout: 180000 });
    return cad.evaluate(() => { const L = TubeCAD.state.listen, t = L.take; return { error: L.error, ch: t && t.out.length, n: t && t.out[0].length, peak: t && t.peak, rms: t && t.rms, cores: t && t.cores }; });
  };
  await cad.selectOption("#ls-src", "riff");
  await cad.fill("#ls-len", "2"); await cad.press("#ls-len", "Tab");
  const t = await render();
  check(!t.error && t.ch === 1 && t.n === 96000 && t.peak > 1 && t.rms > 0.1, `2 s of the guitar riff play through example 05 into its speaker (peak ${t.peak && t.peak.toFixed(2)} V, ${t.cores} pieces)`);
  // the output agrees with the steady-state simulation: the generator's tone at its own level gives the speaker's rms
  await cad.selectOption("#ls-src", "tone");
  const tt = await render();
  const vrms = await cad.evaluate(() => { const sp = TubeCAD.state.comps.find(c => c.type === "speaker"); return TubeCAD.state.sim.result && Math.sqrt(TubeCAD.measurements().find(m => m.key === sp.id + ":p").v * sp.params.r); });
  check(Math.abs(tt.rms / vrms - 1) < 0.03, `the generator's tone through the circuit reads the speaker's rms as the simulation does (${tt.rms.toFixed(3)} vs ${vrms.toFixed(3)} V)`);
  // an MP3 (stereo) file: decoded, its excerpt rendered
  await cad.selectOption("#ls-src", "file").catch(() => {});
  await cad.setInputFiles("#ls-file", new URL("../fixtures/stereo-440-660.mp3", import.meta.url).pathname);
  await cad.waitForFunction(() => TubeCAD.state.listen.file, null, { timeout: 10000 });
  const f = await cad.evaluate(() => { const F = TubeCAD.state.listen.file; return { ch: F.chs.length, s: F.seconds, name: document.getElementById("ls-file-name").textContent }; });
  check(f.ch === 2 && Math.abs(f.s - 1.5) < 0.1 && /stereo-440-660\.mp3/.test(f.name), `an MP3 file is read: stereo, ${f.s.toFixed(2)} s, its name shown`);
  await cad.fill("#ls-len", "1"); await cad.press("#ls-len", "Tab");
  const tf = await render();
  check(!tf.error && tf.n === 48000 && tf.peak > 0.5, `its excerpt plays through the circuit (1 s, peak ${tf.peak && tf.peak.toFixed(2)} V)`);
  // a WAV file made here
  const wav = await cad.evaluate(() => Array.from(new Uint8Array(CadListen.wav([CadListen.tone("sine", 220, 0.5)], 48000, 0.8))));
  await cad.setInputFiles("#ls-file", { name: "a220.wav", mimeType: "audio/wav", buffer: Buffer.from(wav) });
  await cad.waitForFunction(() => TubeCAD.state.listen.file && TubeCAD.state.listen.file.name === "a220.wav", null, { timeout: 10000 });
  check(await cad.evaluate(() => TubeCAD.state.listen.file.chs.length === 1 && Math.abs(TubeCAD.state.listen.file.seconds - 0.5) < 0.01), "a WAV file is read (mono, 0.5 s)");
  // play, A/B
  await cad.click("#ls-play"); await cad.waitForTimeout(400);
  const playing = await cad.evaluate(() => TubeCAD.state.listen.playing);
  await cad.click('[data-ab="in"]');
  check(playing && await cad.evaluate(() => TubeCAD.state.listen.ab === "in" && document.querySelector('[data-ab="in"]').getAttribute("aria-pressed") === "true"), "▶ Play plays; A switches to the input");
  await cad.click("#ls-play");
  check(await cad.evaluate(() => !TubeCAD.state.listen.playing), "■ Stop stops");
  const [dl] = await Promise.all([cad.waitForEvent("download"), cad.click("#ls-save")]);
  check(/-through-circuit\.wav$/.test(dl.suggestedFilename()), `Save WAV downloads the output (${dl.suggestedFilename()})`);
  await cad.evaluate(() => { const r = TubeCAD.state.comps.find(c => c.type === "resistor"); r.params.r *= 1.1; TubeCAD.commit(); });
  check(/changed/.test(await cad.textContent("#ls-note")), "an edit marks the render as the old circuit's");
  await cad.evaluate(() => TubeCAD.undo());
  await cad.evaluate(() => TubeCAD.toggleBom(false));
}

