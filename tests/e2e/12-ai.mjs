// AI ▾: the settings dialog, the assistant's questions, Explain and Fix the checks, against
// stand-ins for the three providers (no network, no real key)
import { cad, check } from "./harness.mjs";

{
  await cad.bringToFront();
  const sent = [];
  const answer = (text, provider) => (provider === "openai" ? { status: "completed", output: [{ type: "message", content: [{ type: "output_text", text }] }] }
    : provider === "gemini" ? { candidates: [{ content: { parts: [{ text }] }, finishReason: "STOP" }] } : { content: [{ type: "text", text }], stop_reason: "end_turn" });
  const reply = provider => async route => {
    const body = JSON.parse(route.request().postData() || "{}");
    sent.push({ provider, url: route.request().url(), headers: route.request().headers(), body });
    const q = JSON.stringify(body);
    const text = /Reply with the single word/.test(q) ? "ready"
      : /Propose the value changes/.test(q) ? 'Here you are:\n```json\n{"summary": "VL2 runs past its anode rating: a larger cathode resistor lowers its current.", "fixes": [{"part": "R10", "field": "r", "value": "1.5k", "why": "back to the published bias"}, {"part": "R77", "field": "r", "value": "1k", "why": "no such part"}]}\n```'
        : "## Input stage\nVL1.1 amplifies; R3 sets its bias.\n- point one";
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify(answer(text, provider)) });
  };
  await cad.route("https://api.anthropic.com/**", reply("anthropic"));
  await cad.route("https://api.openai.com/**", reply("openai"));
  await cad.route("https://generativelanguage.googleapis.com/**", reply("gemini"));
  await cad.evaluate(() => { localStorage.removeItem("tubecad_ai"); TubeCAD.ai.render(); });

  // no key yet: the assistant says how to add one and asks nothing
  await cad.click("#btn-ai"); await cad.click("#menu-ai-explain");
  await cad.waitForSelector("#ai-log [data-settings]");
  check(!sent.length && await cad.evaluate(() => !document.getElementById("ai-pane").hidden), "AI ▾ → Explain without a key opens the AI tab with how to add one, and sends nothing");

  // settings: ChatGPT with a key, Test, Save
  await cad.click("#ai-log [data-settings]");
  check(await cad.evaluate(() => !document.getElementById("ai-modal").hidden && document.getElementById("ai-model").value === "claude-opus-5-5"), "AI settings opens on Claude with Opus 5.5");
  await cad.click('#ai-providers [data-p="openai"]');
  await cad.fill("#ai-key", "sk-test-openai");
  await cad.click("#btn-ai-test");
  await cad.waitForFunction(() => /answered: ready/.test(document.getElementById("ai-test-out").textContent));
  check(sent[0].url === "https://api.openai.com/v1/responses" && sent[0].headers.authorization === "Bearer sk-test-openai" && sent[0].body.model === "gpt-6.1-sol", "Test asks OpenAI with the key and the default model");
  await cad.click("#btn-ai-save");
  check(await cad.evaluate(() => document.getElementById("ai-modal").hidden && /ChatGPT · GPT-6.1 Sol/.test(document.getElementById("ai-who").textContent) && JSON.parse(localStorage.getItem("tubecad_ai")).keys.openai === "sk-test-openai"), "Save keeps the key in this browser and the tab shows ChatGPT · GPT-6.1 Sol");

  // a circuit with a problem: example 06 with VL2's cathode resistor far too small
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^06-/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.comps.some(k => k.label === "VL2"));
  await cad.evaluate(() => { const c = TubeCAD.state.comps.find(k => k.label === "R10"); c.params.r = 330; TubeCAD.commit(); });
  await cad.waitForFunction(() => !TubeCAD.state.sim.busy && TubeCAD.circuitIssues().some(i => /VL2/.test(i)), null, { timeout: 60000 });
  const before = await cad.evaluate(() => TubeCAD.circuitIssues().length);

  // a question: the circuit goes with it, the manual goes as the instructions
  sent.length = 0;
  await cad.fill("#ai-input", "Why is VL2 hot?");
  await cad.press("#ai-input", "Enter");
  await cad.waitForSelector(".ai-msg.answer");
  const q = sent[0].body, qText = q.input[q.input.length - 1].content[0].text;
  check(/R10 Resistor \[resistance 330Ω/.test(qText) && /VL2 Vacuum tube/.test(qText) && /Checks.*\n- .*VL2/s.test(qText) && /Question: Why is VL2 hot\?/.test(qText), "a question goes with the circuit: parts, values, nets and the Checks");
  check(/## /.test(q.instructions) && q.instructions.length > 20000, `and the manual as the model's instructions (${q.instructions.length} characters)`);
  const ans = await cad.evaluate(() => document.querySelector(".ai-msg.answer").innerHTML);
  check(/<h4>Input stage<\/h4>/.test(ans) && /data-ref="VL1.1"/.test(ans) && /<li>point one<\/li>/.test(ans), "the answer is formatted and its part designators are links");
  await cad.click('.ai-msg.answer [data-ref="R3"]');
  check(await cad.evaluate(() => [...TubeCAD.state.sel.comps].map(id => TubeCAD.state.comps.find(c => c.id === id).label).join() === "R3"), "clicking a designator selects that part");

  // Fix the checks: a card with Apply; applying re-simulates and the Checks clear
  await cad.click("#btn-ai-fix");
  await cad.waitForSelector(".ai-fixes");
  const card = await cad.evaluate(() => document.querySelector(".ai-fixes").innerText);
  check(/R10\s+Resistance\s+330Ω → 1.5kΩ/.test(card) && /there is no part R77/.test(card), "Fix the checks lists the change from the current value and refuses a part that does not exist");
  await cad.click(".ai-fixes [data-apply]");
  await cad.waitForFunction(() => /Checks: \d+ → \d+/.test(document.getElementById("ai-log").innerText), null, { timeout: 60000 });
  const after = await cad.evaluate(() => ({ r: TubeCAD.state.comps.find(k => k.label === "R10").params.r, n: TubeCAD.circuitIssues().length, text: document.getElementById("ai-log").innerText }));
  check(after.r === 1500 && after.n < before && new RegExp(`Checks: ${before} → ${after.n}`).test(after.text), `Apply sets R10 to 1.5 kΩ, re-simulates and reports the Checks (${before} → ${after.n})`);
  await cad.click("#ai-log [data-undo]");
  check(await cad.evaluate(() => TubeCAD.state.comps.find(k => k.label === "R10").params.r) === 330, "Undo takes the change back");

  // Gemini, through Explain
  await cad.evaluate(() => { const s = JSON.parse(localStorage.getItem("tubecad_ai")); s.provider = "gemini"; s.keys.gemini = "AIza-test"; localStorage.setItem("tubecad_ai", JSON.stringify(s)); });
  sent.length = 0;
  await cad.click("#btn-ai-explain");
  await cad.waitForFunction(() => document.querySelectorAll(".ai-msg.answer").length >= 3);
  check(/gemini-3\.1-pro-preview:streamGenerateContent\?alt=sse$/.test(sent[0].url) && sent[0].headers["x-goog-api-key"] === "AIza-test" && /stage by stage/.test(JSON.stringify(sent[0].body.contents)), "Explain asks Gemini with its key");
  await cad.click("#btn-ai-clear");
  check(await cad.evaluate(() => !TubeCAD.state.ai.log.length && !!document.querySelector(".ai-chips")), "Clear starts a new conversation");
  await cad.evaluate(() => localStorage.removeItem("tubecad_ai"));
  await cad.unrouteAll({ behavior: "ignoreErrors" });
}
