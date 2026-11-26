// AI ▾ → Design from a description, against a stand-in provider: a design with a mistake is sent
// back once, the corrected one is drawn on a new sheet and simulated, and Ctrl+Z brings back the
// circuit that was there
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const parts = bad => [
    { ref: "G1", type: "siggen", values: { amp: "0.1", freq: "1k" }, pins: { "+": "IN", "-": "GND" } },
    { ref: "C1", type: "capacitor", values: { c: "100n" }, pins: { 1: "IN", 2: "G" } },
    { ref: "R1", type: "resistor", values: { r: "1M" }, pins: { 1: "G", 2: "GND" } },
    { ref: "VL1", type: "tube", values: { tube: "12AX7" }, pins: bad ? { A: "A", G: "G", K: "K", X: "A" } : { A: "A", G: "G", K: "K" } },
    { ref: "R2", type: "resistor", values: { r: "100k" }, pins: { 1: "B+", 2: "A" } },
    { ref: "R3", type: "resistor", values: { r: "1.5k" }, pins: { 1: "K", 2: "GND" } },
    { ref: "C2", type: "electrolytic", values: { c: "22u", v: "25" }, pins: { "+": "K", "-": "GND" } },
    { ref: "C3", type: "capacitor", values: { c: "100n" }, pins: { 1: "A", 2: "OUT" } },
    { ref: "R4", type: "resistor", values: { r: "470k" }, pins: { 1: "OUT", 2: "GND" } },
    { ref: "SC1", type: "scope", pins: { CH1: "IN", CH2: "OUT", COM: "GND" } }];
  const sent = [];
  await cad.route("https://api.anthropic.com/**", async route => {
    const body = JSON.parse(route.request().postData() || "{}"); sent.push(body);
    const design = { title: "12AX7 gain stage", summary: "One 12AX7 triode, common cathode, about 1 mA.", parts: parts(sent.length === 1), rails: { "B+": 250 } };
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ content: [{ type: "text", text: JSON.stringify(design) }], stop_reason: "end_turn" }) });
  });
  await cad.evaluate(() => { localStorage.setItem("tubecad_ai", JSON.stringify({ provider: "anthropic", keys: { anthropic: "sk-ant-test" } })); TubeCAD.ai.render(); });
  const before = await cad.evaluate(() => TubeCAD.state.comps.length);

  await cad.click("#btn-ai"); await cad.click("#menu-ai-design");
  check(await cad.evaluate(() => !document.getElementById("design-modal").hidden && document.querySelectorAll("#design-chips .ai-chip").length >= 3), "Design from a description opens its dialog with examples");
  await cad.click("#design-chips .ai-chip");
  check(/EL84/.test(await cad.inputValue("#design-text")), "an example fills the description");
  await cad.fill("#design-text", "A 12AX7 gain stage on 250 V");
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.click("#btn-design-go");
  await cad.waitForFunction(() => TubeCAD.state.design && !TubeCAD.state.design.busy && /12AX7 gain stage/.test(document.getElementById("ai-log").innerText), null, { timeout: 90000 });
  const sys = sent[0].system[0].text, first = sent[0].messages[0].content[0].text;
  check(/pins maps EVERY pin/.test(sys) && /resistor: Resistor\. Pins 1 2/.test(sys) && /12AX7 \(triode/.test(sys) && /A 12AX7 gain stage on 250 V/.test(first), "the request carries the rules, the part library, the tubes and the description");
  check(sent.length === 2 && /VL1 has no pin X/.test(sent[1].messages[2].content[0].text), "a design the CAD cannot use goes back once with its problems");
  const r = await cad.evaluate(() => { const S = TubeCAD.state, vl = S.comps.find(c => c.label === "VL1"), m = TubeCAD.measurements().find(x => x.label === "VL1 Ia");
    return { n: S.comps.filter(c => !["frame", "ground", "rail", "offsheet"].includes(c.type)).length, frame: S.comps.filter(c => c.type === "frame").map(c => c.params.size + " " + c.params.title).join(), tube: vl && vl.params.tube, ia: m && m.v, log: document.getElementById("ai-log").innerText }; });
  check(r.n === 10 && r.frame === "A3 12AX7 gain stage" && r.tube === "12AX7", `the design is drawn on a new A3 sheet (${r.n} parts, ${r.frame})`);
  check(r.ia > 0.5e-3 && r.ia < 2e-3 && /Checks find no problems/.test(r.log), `and simulated: VL1 draws ${(r.ia * 1000).toFixed(2)} mA, no problems in the Checks`);
  await cad.evaluate(() => TubeCAD.undo());
  check(await cad.evaluate(() => TubeCAD.state.comps.length) === before, "Ctrl+Z brings back the circuit that was on the sheet");
  await cad.unrouteAll({ behavior: "ignoreErrors" });

  // drawn live: the answer streams slowly (a fetch stand-in that drips the SSE events); parts are on
  // the sheet before it ends, with the bar over the sheet; Stop puts the circuit back
  const design = { title: "Live stage", rails: { "B+": 250 }, parts: parts(false), summary: "One 12AX7 triode." };
  await cad.evaluate(({ text, gap }) => {
    const ev = (e, d) => `event: ${e}\ndata: ${JSON.stringify(d)}\n\n`, evs = [ev("message_start", { type: "message_start", message: {} })];
    window.__designText = text;
    for (let i = 0; i < text.length; i += 16) evs.push(ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: text.slice(i, i + 16) } }));
    evs.push(ev("message_delta", { type: "message_delta", delta: { stop_reason: "end_turn" } }));
    window.__of = window.__of || window.fetch;
    window.__answers = [];   // the next answers' texts (as SSE); the design's otherwise
    window.fetch = (u, o) => {
      if (!/anthropic/.test(String(u))) return window.__of(u, o);
      const next = window.__answers.shift(), list = next ? [ev("content_block_delta", { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: next } }), evs[evs.length - 1]] : evs.slice();
      let i = 0; const enc = new TextEncoder();
      const body = new ReadableStream({ pull(c) { return new Promise(r => setTimeout(() => { if (o && o.signal && o.signal.aborted) c.error(new DOMException("aborted", "AbortError")); else if (i >= list.length) c.close(); else c.enqueue(enc.encode(list[i++])); r(); }, gap)); } });
      return Promise.resolve(new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } }));
    };
  }, { text: JSON.stringify(design, null, 1), gap: 40 });
  const kept = await cad.evaluate(() => TubeCAD.state.comps.length);
  await cad.evaluate(() => { window.confirm = () => true; TubeCAD.state.design.rounds = 0; document.getElementById("btn-ai").click(); document.getElementById("menu-ai-design").click(); document.getElementById("design-text").value = "Live stage"; document.getElementById("design-revise").checked = false; document.getElementById("btn-design-go").click(); });
  await cad.waitForFunction(() => TubeCAD.state.design.live && TubeCAD.state.comps.some(c => c.label === "VL1"), null, { timeout: 30000 });
  const mid = await cad.evaluate(() => ({ n: TubeCAD.state.comps.filter(c => c.label).length, bar: !document.getElementById("design-live").hidden && document.getElementById("design-live-text").textContent, busy: TubeCAD.state.design.busy, ticking: !!document.querySelector("#ai-log .ai-busy-t") }));
  check(mid.busy && mid.n >= 3 && mid.n < 10 && /drawing “Live stage” · \d+ parts? so far/.test(mid.bar) && mid.ticking, `the design is drawn while the answer is written (${mid.n} parts so far, bar: ${mid.bar})`);
  await cad.keyboard.press("Delete");
  check(await cad.evaluate(() => TubeCAD.state.comps.some(c => c.label === "VL1")), "the sheet takes no edits while the AI draws");
  await cad.click("#btn-design-stop");
  await cad.waitForFunction(() => !TubeCAD.state.design.busy, null, { timeout: 10000 });
  const after = await cad.evaluate(() => ({ n: TubeCAD.state.comps.length, bar: document.getElementById("design-live").hidden, log: document.getElementById("ai-log").innerText }));
  check(after.n === kept && after.bar && /back as it was/.test(after.log), "Stop puts back the circuit that was on the sheet and hides the bar");

  // asked to draw in the AI tab: the assistant hands it to Design instead of writing instructions
  await cad.evaluate(() => { window.__answers.push("[[DRAW]] A 12AX7 gain stage on 250 V"); document.getElementById("ai-input").value = "draw me a 12AX7 gain stage"; document.getElementById("btn-ai-send").click(); });
  await cad.waitForFunction(() => TubeCAD.state.design.busy, null, { timeout: 20000 });
  await cad.waitForFunction(() => !TubeCAD.state.design.busy && TubeCAD.state.comps.some(c => c.label === "VL1"), null, { timeout: 90000 });
  const log = await cad.evaluate(() => document.getElementById("ai-log").innerText);
  check(/Drawing it on the sheet: A 12AX7 gain stage/.test(log) && /Live stage/.test(log) && !/\[\[DRAW\]\]/.test(log), "“draw me …” in the AI tab draws the circuit on the sheet");
  await cad.evaluate(() => { window.fetch = window.__of; TubeCAD.state.design.rounds = 2; localStorage.removeItem("tubecad_ai"); TubeCAD.ai.render(); });
}
