// Analyses under the schematic: the power sweep, listening, the parameter sweep, noise and hum; the Bode plotter's loop gain
import { readFileSync } from "node:fs";
import { cad, check, open } from "./harness.mjs";

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
  for (const [id, v] of [["#pw-lo", "-12"], ["#pw-hi", "15"], ["#pw-steps", "10"]]) { await cad.fill(id, v); await cad.press(id, "Tab"); }
  const seq = await cad.evaluate(() => TubeCAD.state.power.seq);
  await cad.click("#btn-pw-run");
  await cad.waitForFunction(seq => TubeCAD.state.power.seq !== seq && !TubeCAD.state.power.job && TubeCAD.state.power.points, seq, { timeout: 180000 });
  const P = await cad.evaluate(() => { const P = TubeCAD.state.power; return { n: P.points.length, ok: P.points.filter(p => p.out > 0).length, refined: P.points.filter(p => Math.abs(p.db * 1e3 % 3000) > 1).length, now: P.points.find(p => p.db === 0), unit: P.unit }; });
  const sp = await cad.evaluate(() => TubeCAD.state.comps.find(c => c.type === "speaker").id);
  const pNow = await cad.evaluate(id => TubeCAD.measurements().find(m => m.key === id + ":p").v, sp);
  check(P.ok === P.n && P.n > 10 && P.refined > 0, `10 levels and more around the THD marks all settle (${P.n} levels, ${P.refined} added)`);
  check(P.unit === "W" && Math.abs(P.now.out / pNow - 1) < 0.02, `at 0 dB the sweep reads the speaker's power as the simulation does (${P.now.out.toFixed(3)} W vs ${pNow.toFixed(3)} W)`);
  const cards = await cad.evaluate(() => [...document.querySelectorAll(".pw-card b")].map(b => b.textContent));
  const w1 = parseFloat(cards[0]);
  check(/W$/.test(cards[0]) && w1 > 6 && w1 < 12 && parseFloat(cards[2]) > w1, `the cards read the power at 1 % and 10 % THD (${cards.join(" · ")})`);
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
  // the live radio: its stream answered here with the MP3 fixture (no network in the test)
  const mp3 = readFileSync(new URL("../fixtures/stereo-440-660.mp3", import.meta.url));
  let hits = 0;
  await cad.route(/streams\.radiobob\.de\/70errock\//, r => { hits++; r.fulfill({ status: 200, contentType: "audio/mpeg", headers: { "access-control-allow-origin": "*" }, body: mp3 }); });
  await cad.selectOption("#ls-src", "radio");
  check(await cad.evaluate(() => !document.getElementById("ls-radio-btn").hidden && document.getElementById("ls-file-btn").hidden), "70s rock radio (live) shows Tune in again, not Open file");
  await cad.fill("#ls-len", "0.8"); await cad.press("#ls-len", "Tab");
  const tr = await render();
  const rs = await cad.evaluate(() => ({ radio: !!TubeCAD.state.listen.radio, src: TubeCAD.state.listen.take && TubeCAD.state.listen.take.source, name: document.getElementById("ls-file-name").textContent }));
  check(hits === 1 && rs.radio && !tr.error && tr.ch === 1 && tr.n === Math.round(0.8 * 48000) && tr.peak > 0.5 && /RADIO BOB! 70s Rock \(live at \d\d:\d\d\)/.test(rs.src) && /caught at/.test(rs.name),
    `▶ Render tunes in to the radio, catches a piece of it and plays it through the circuit (${rs.src}, peak ${tr.peak && tr.peak.toFixed(2)} V)`);
  await cad.unroute(/streams\.radiobob\.de\/70errock\//);
  await cad.route(/streams\.radiobob\.de\/70errock\//, r => r.fulfill({ status: 503, body: "" }));
  await cad.click("#ls-radio-btn");
  await cad.waitForFunction(() => !TubeCAD.state.listen.tuning && TubeCAD.state.listen.error, null, { timeout: 10000 });
  check(/Could not reach RADIO BOB/.test(await cad.textContent("#ls-note")), "a station that does not answer is said so in the tab");
  await cad.unroute(/streams\.radiobob\.de\/70errock\//);
  await cad.selectOption("#ls-src", "file").catch(() => {});
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

// --- Parameter sweep ------------------------------------------------------------------------
{
  cad.once("dialog", d => d.accept().catch(() => {}));
  const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^03-/.test(x.file))));
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, s0, { timeout: 60000 });
  await cad.click("#btn-view"); await cad.click("#btn-sweep"); await cad.keyboard.press("Escape");
  check(await cad.evaluate(() => !document.getElementById("sw-pane").hidden && document.getElementById("btn-sweep").getAttribute("aria-checked") === "true"), "View ▾ → Parameter sweep opens the Sweep tab, ticked");
  const r2 = await cad.evaluate(() => TubeCAD.state.comps.find(c => c.label === "R2"));
  await cad.selectOption("#sw-part", r2.id);
  check(await cad.evaluate(() => document.getElementById("sw-field").value === "r" && /now 150kΩ/.test(document.getElementById("sw-now").textContent) && document.getElementById("sw-from").placeholder === "75kΩ"), "picking a part offers its value, with half and twice it as the range");
  for (const [id, v] of [["#sw-from", "100k"], ["#sw-to", "220k"], ["#sw-steps", "5"]]) { await cad.fill(id, v); await cad.press(id, "Tab"); }
  const seq = await cad.evaluate(() => TubeCAD.state.sweep.seq);
  await cad.click("#btn-sw-run");
  await cad.waitForFunction(seq => TubeCAD.state.sweep.seq !== seq && !TubeCAD.state.sweep.job && TubeCAD.state.sweep.steps, seq, { timeout: 120000 });
  const W = await cad.evaluate(() => { const W = TubeCAD.state.sweep; return { vs: W.steps.map(s => s.v), ia: W.steps.map(s => (s.rows.find(r => r.label === "VL1 Ia") || {}).v), keys: W.keys.map(k => k.label) }; });
  check(W.vs.length === 5 && Math.abs(W.vs[0] - 100e3) < 1e-6 && Math.abs(W.vs[4] - 220e3) < 1e-3, `5 steps from 100k to 220k (${W.vs.map(v => Math.round(v / 1e3)).join(", ")} k)`);
  check(W.ia.every((v, i) => i === 0 || v < W.ia[i - 1]), `a larger anode resistor draws less anode current, step by step (${W.ia.map(v => (v * 1e3).toFixed(3)).join(" > ")} mA)`);
  check(["VL1 Ia", "VL1 Pa", "P1 CH1 AC", "P1 CH1 THD"].every(l => W.keys.includes(l)), "the table has tubes, scope channels and their THD");
  // the circuit is as it was; a step at R2 = 150k reads what the simulation reads
  const ia150 = await cad.evaluate(() => TubeCAD.tubeData(TubeCAD.state.comps.find(c => c.label === "VL1")).dc.ia);
  check(await cad.evaluate(id => TubeCAD.state.comps.find(c => c.id === id).params.r, r2.id) === 150e3 && ia150 < W.ia[2] && ia150 > W.ia[3], "the sweep leaves the part as it was, and the drawn value falls between its neighbours");
  await cad.click('#sw-table tbody tr:has-text("P1 CH1 AC")');
  check(await cad.locator("#sw-pane .sw-waves polyline").count() === 5 && /P1 CH1 AC/.test(await cad.textContent(".sw-title")), "clicking a scope channel's line plots it and overlays its wave at each step");
  await cad.click('.sw-step[data-i="4"]');
  check(await cad.evaluate(id => TubeCAD.state.comps.find(c => c.id === id).params.r, r2.id) === 220e3, "clicking a step sets the part to that value");
  await cad.evaluate(() => TubeCAD.undo());
  check(await cad.evaluate(id => TubeCAD.state.comps.find(c => c.id === id).params.r, r2.id) === 150e3, "undo puts it back");
  await cad.evaluate(() => TubeCAD.toggleBom(false));
}

// --- Noise and hum, and the loop gain in the Bode plotter --------------------------------------
{
  cad.once("dialog", d => d.accept().catch(() => {}));
  const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^07-/.test(x.file))));
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, s0, { timeout: 120000 });
  await cad.click("#btn-view"); await cad.click("#btn-noise"); await cad.keyboard.press("Escape");
  check(await cad.evaluate(() => !document.getElementById("nz-pane").hidden && document.getElementById("btn-noise").getAttribute("aria-checked") === "true"), "View ▾ → Noise and hum opens the Noise tab, ticked");
  const runNoise = async heaters => {
    await cad.selectOption("#nz-heaters", heaters);
    const seq = await cad.evaluate(() => TubeCAD.state.noise.seq);
    await cad.click("#btn-nz-run");
    await cad.waitForFunction(seq => TubeCAD.state.noise.seq !== seq && !TubeCAD.state.noise.job, seq, { timeout: 180000 });
    return cad.evaluate(() => { const N = TubeCAD.state.noise, r = N.res || {}; return { error: N.error, outA: r.outA, flat: r.outFlat, einA: r.einA, g: r.g1k, ripple: r.ripple && r.ripple.h.map(x => x.rms), heater: r.heater && r.heater.rms, parts: (r.parts || []).map(p => p.label), allA: r.allA, v1W: r.v1W }; });
  };
  const g = await runNoise("ground");
  check(!g.error && g.outA > 0.3e-6 && g.outA < 30e-6 && g.flat > g.outA, `example 07: a few µV of noise at the speaker, A-weighting below flat (${(g.outA * 1e6).toFixed(2)} µV (A), ${(g.flat * 1e6).toFixed(2)} µV flat)`);
  check(Math.abs(g.einA * g.g / g.outA - 1) < 1e-9 && g.einA < 5e-6, `the input noise is the output's over the gain (${(g.einA * 1e9).toFixed(0)} nV (A))`);
  check(g.ripple && g.ripple[1] > g.ripple[0] && g.ripple[1] > g.ripple[2], `the full-wave supply's ripple at the speaker is mostly at 100 Hz (${g.ripple.map(v => (v * 1e6).toFixed(2)).join(", ")} µV)`);
  check(g.parts.length > 3 && g.parts.some(p => /^VL/.test(p)) && g.parts.some(p => /^R/.test(p)), `the noise is split among tubes and resistors (${g.parts.slice(0, 4).join(", ")})`);
  const sn = 20 * Math.log10(g.v1W / g.allA);
  check(sn > 70 && sn < 140 && new RegExp(sn.toFixed(1) + " dB").test(await cad.textContent("#nz-pane .pw-card.main")), `the S/N card reads ${sn.toFixed(1)} dB(A) re 1 W`);
  const ct = await runNoise("ct"), dc = await runNoise("dc");
  check(Math.abs(ct.heater / g.heater - 0.05) < 1e-6 && dc.heater === 0 && Math.abs(ct.outA / g.outA - 1) < 1e-9, `a centre-tapped heater couples 5 % of one grounded at one side, DC heaters none (${(g.heater * 1e6).toFixed(2)} → ${(ct.heater * 1e6).toFixed(3)} µV)`);
  await cad.selectOption("#nz-heaters", "ground");
  await cad.evaluate(() => TubeCAD.toggleBom(false));

  // loop gain: example 06 has global feedback from the speaker to the first cathode
  const s1 = await cad.evaluate(() => TubeCAD.state.sim.seq);
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  await cad.waitForFunction(s1 => TubeCAD.state.sim.seq !== s1 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, s1, { timeout: 120000 });
  const bode = await open("bode-loop", "bode.html?mode=loop");
  const loopRead = () => bode.waitForFunction(() => { const L = Instrument.loop; return L && !L.running && L.ok && Bode.traces(); }, null, { timeout: 60000 }).then(() => bode.evaluate(() => {
    const T = Bode.traces(), M = Bode.margins(T.f, T.list[0].db, T.list[0].ph);
    return { at: Instrument.loop.label, places: Instrument.loop.places.map(p => p.label), mid: M.mid, midPh: M.midPh, hi: M.hi, lo: M.lo, verdict: Bode.verdict(M, T.f), text: document.getElementById("resp").textContent };
  }));
  const L = await loopRead();
  check(/^R5 \(global feedback\)/.test(L.places[0]) && L.at === L.places[0], `the feedback resistor is offered first and broken at (${L.places.slice(0, 3).join(", ")})`);
  check(L.mid > 1 && L.mid < 20 && Math.abs(L.midPh) < 30, `the loop gain at 1 kHz is negative feedback of a few dB (${L.mid.toFixed(1)} dB, ${L.midPh.toFixed(0)}°)`);
  check(L.hi.unity > 20e3 && L.hi.pm > 20 && L.lo.unity > 5 && L.lo.unity < 200 && L.lo.pm > 45, `unity gain at both ends with their phase margins (${L.lo.unity.toFixed(0)} Hz ${L.lo.pm.toFixed(0)}°, ${(L.hi.unity / 1e3).toFixed(0)} kHz ${L.hi.pm.toFixed(0)}°)`);
  check(L.verdict[0] !== "bad" && /Phase margin/.test(L.text), `the panel reads the margins and a verdict (${L.verdict[1]})`);
  // the same loop broken at the other end of the resistor reads as positive feedback: the wrong way round
  await bode.check("#loop-rev");
  await bode.waitForFunction(() => Instrument.loop && Instrument.loop.reverse && !Instrument.loop.running, null, { timeout: 60000 });
  const R = await loopRead();
  check(R.verdict[0] === "bad" && /Other end/.test(R.verdict[1]), "broken at the other end, the panel says the loop reads as positive feedback and to tick Other end");
  await bode.close();
}
