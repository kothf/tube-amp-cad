/**
 * AI features without a network: the requests each provider gets (ai-client.js), their answers
 * read back, the errors in words, and the part-library side (ai-circuit.js): values set as the
 * inspector sets them, the catalogue for prompts and answers rendered as safe HTML.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

globalThis.window = globalThis;
for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "ai-client.js", "ai-circuit.js"]) runInThisContext(readFileSync(new URL("../" + f, import.meta.url), "utf8"), { filename: f });
const { AiClient: C, AiCircuit: A, CadLib } = globalThis;

const store = () => { const m = new Map(); return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)) }; };
const reply = (status, body) => async () => ({ ok: status < 300, status, json: async () => body });
const pdf = { name: "EL84.pdf", mime: "application/pdf", data: "JVBERi0=" };

test("settings: defaults for every provider, kept and read back", () => {
  const s = store(), cfg = C.load(s);
  assert.equal(cfg.provider, "anthropic");
  assert.equal(cfg.models.anthropic, "claude-opus-5-5");
  assert.ok(!C.ready(cfg));
  cfg.provider = "gemini"; cfg.keys.gemini = "  AIza-x  "; cfg.models.openai = "gpt-6-luna";
  C.save(cfg, s);
  const back = C.load(s);
  assert.equal(back.provider, "gemini"); assert.equal(back.keys.gemini, "AIza-x"); assert.equal(back.models.openai, "gpt-6-luna");
  assert.ok(C.ready(back));
  assert.equal(C.load({ getItem: () => "not json" }).provider, "anthropic");
});

test("Claude: the browser header, the cached system prompt, a PDF as a document, fallbacks on Opus", () => {
  const { url, init } = C.build("anthropic", "claude-opus-5-5", "sk-ant-1", { system: "manual", messages: [{ role: "user", text: "hi", files: [pdf] }, { role: "assistant", text: "yes" }, { role: "user", text: "more" }] });
  const b = JSON.parse(init.body);
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.headers["x-api-key"], "sk-ant-1");
  assert.equal(init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(init.headers["anthropic-beta"], "server-side-fallback-2026-07-01");
  assert.equal(b.fallbacks, "default");
  assert.deepEqual(b.system, [{ type: "text", text: "manual", cache_control: { type: "ephemeral" } }]);
  assert.deepEqual(b.messages[0].content[0], { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdf.data } });
  assert.deepEqual(b.messages.map(m => m.role), ["user", "assistant", "user"]);
  assert.ok(!("temperature" in b));
  const h = JSON.parse(C.build("anthropic", "claude-haiku-5-5", "k", { messages: [{ role: "user", text: "x" }] }).init.body);
  assert.ok(!("fallbacks" in h) && !("system" in h));
});

test("ChatGPT: the Responses API, instructions, a PDF as an input file", () => {
  const { url, init } = C.build("openai", "gpt-6.1-sol", "sk-1", { system: "sys", messages: [{ role: "user", text: "read", files: [pdf] }, { role: "assistant", text: "ok" }] });
  const b = JSON.parse(init.body);
  assert.equal(url, "https://api.openai.com/v1/responses");
  assert.equal(init.headers.authorization, "Bearer sk-1");
  assert.equal(b.instructions, "sys");
  assert.deepEqual(b.input[0].content[0], { type: "input_file", filename: "EL84.pdf", file_data: "data:application/pdf;base64," + pdf.data });
  assert.deepEqual(b.input[1].content, [{ type: "output_text", text: "ok" }]);
});

test("Gemini: generateContent with the key in a header, the system instruction, a PDF inline", () => {
  const { url, init } = C.build("gemini", "gemini-3.1-pro-preview", "AIza", { system: "sys", messages: [{ role: "user", text: "q", files: [pdf] }, { role: "assistant", text: "a" }] });
  const b = JSON.parse(init.body);
  assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.1-pro-preview:generateContent");
  assert.equal(init.headers["x-goog-api-key"], "AIza");
  assert.deepEqual(b.systemInstruction, { parts: [{ text: "sys" }] });
  assert.deepEqual(b.contents.map(c => c.role), ["user", "model"]);
  assert.deepEqual(b.contents[0].parts[0], { inlineData: { mimeType: "application/pdf", data: pdf.data } });
});

test("answers read back from each provider; refusals and blocks become errors", async () => {
  const cfg = p => C.normalise({ provider: p, keys: { [p]: "k" } });
  assert.equal(await C.chat(cfg("anthropic"), { messages: [{ role: "user", text: "q" }] }, reply(200, { content: [{ type: "thinking", thinking: "" }, { type: "text", text: "Hello" }], stop_reason: "end_turn" })), "Hello");
  assert.equal(await C.chat(cfg("openai"), { messages: [{ role: "user", text: "q" }] }, reply(200, { status: "completed", output: [{ type: "reasoning" }, { type: "message", content: [{ type: "output_text", text: "Hi" }] }] })), "Hi");
  assert.equal(await C.chat(cfg("gemini"), { messages: [{ role: "user", text: "q" }] }, reply(200, { candidates: [{ content: { parts: [{ text: "x", thought: true }, { text: "Hey" }] }, finishReason: "STOP" }] })), "Hey");
  assert.match(await C.chat(cfg("anthropic"), { messages: [{ role: "user", text: "q" }] }, reply(200, { content: [{ type: "text", text: "long" }], stop_reason: "max_tokens" })), /cut short/);
  await assert.rejects(C.chat(cfg("anthropic"), { messages: [{ role: "user", text: "q" }] }, reply(200, { content: [], stop_reason: "refusal" })), /declined/);
  await assert.rejects(C.chat(cfg("gemini"), { messages: [{ role: "user", text: "q" }] }, reply(200, { promptFeedback: { blockReason: "SAFETY" } })), /blocked/);
});

test("errors say what to do: no key, a refused key, an unknown model, rate limits, no network", async () => {
  const q = { messages: [{ role: "user", text: "q" }] };
  await assert.rejects(C.chat(C.normalise({}), q, reply(200, {})), /No Claude API key/);
  const cfg = C.normalise({ provider: "openai", keys: { openai: "bad" } });
  await assert.rejects(C.chat(cfg, q, reply(401, { error: { message: "Incorrect API key" } })), e => /refused the API key \(401\).*Incorrect API key/.test(e.message) && e.status === 401);
  await assert.rejects(C.chat(cfg, q, reply(404, { error: { message: "model not found" } })), /does not know this model/);
  await assert.rejects(C.chat(cfg, q, reply(429, {})), /rate-limiting/);
  await assert.rejects(C.chat(cfg, q, async () => { throw new TypeError("Failed to fetch"); }), /Could not reach ChatGPT/);
});

test("Load list: each provider's model list, chat models only", async () => {
  assert.deepEqual(await C.listModels("anthropic", "k", reply(200, { data: [{ id: "claude-opus-5-5" }, { id: "claude-haiku-5-5" }] })), ["claude-opus-5-5", "claude-haiku-5-5"]);
  assert.deepEqual(await C.listModels("openai", "k", reply(200, { data: [{ id: "gpt-6-luna" }, { id: "text-embedding-3" }, { id: "gpt-6-realtime" }, { id: "gpt-6.1-sol" }] })), ["gpt-6.1-sol", "gpt-6-luna"]);
  assert.deepEqual(await C.listModels("gemini", "k", reply(200, { models: [{ name: "models/gemini-3.8-flash", supportedGenerationMethods: ["generateContent"] }, { name: "models/embedding-001", supportedGenerationMethods: ["embedContent"] }] })), ["gemini-3.8-flash"]);
});

test("extractJson: plain, fenced or wrapped in prose", () => {
  assert.deepEqual(C.extractJson('{"a":1}'), { a: 1 });
  assert.deepEqual(C.extractJson('Here:\n```json\n{"fixes":[]}\n```'), { fixes: [] });
  assert.deepEqual(C.extractJson('Sure! {"x": {"y": 2}} Hope it helps.'), { x: { y: 2 } });
  assert.throws(() => C.extractJson("no json here"), /JSON/);
});

const part = (type, params) => ({ id: "c1", type, x: 0, y: 0, rot: 0, label: "X1", params: Object.assign({}, CadLib.LIB[type].defaults, params) });

test("setValue: engineering values, ratings from their options, tubes by name, bad values refused", () => {
  const r = part("resistor");
  assert.equal(A.setValue(r, "r", "1.5k").value, 1500);
  assert.equal(A.setValue(r, "r", "2.2 MΩ").value, 2.2e6);
  assert.equal(A.setValue(r, "r", 470).value, 470);
  assert.equal(A.setValue(r, "w", "2").value, "2");
  assert.equal(A.setValue(r, "w", "2 W").value, "2");
  assert.match(A.setValue(r, "w", "7").error, /no option/);
  assert.match(A.setValue(r, "r", "abc").error, /not a number/);
  assert.match(A.setValue(r, "c", "1u").error, /not a value/);
  const c = part("electrolytic");
  assert.equal(A.setValue(c, "c", "47u").value, 47e-6);
  assert.ok(Math.abs(A.setValue(c, "c", "100µF").value - 100e-6) < 1e-12);
  const t = part("tube", { tube: "12AX7", connection: "triode" });
  assert.equal(A.setValue(t, "tube", "el84").value, "EL84");
  assert.equal(t.params.connection, "pentode");
  assert.match(A.setValue(t, "tube", "XYZ99").error, /no XYZ99/);
  const q = part("npn");
  assert.equal(A.setValue(q, "model", "2N3904").value, "2N3904");
});

test("catalogue: every part type with pins and values; tubes and options listed", () => {
  const cat = A.catalogue();
  assert.match(cat, /^resistor: Resistor\. Pins 1 2\. Values: r \(Resistance, Ω\); w=/m);
  assert.match(cat, /^tube: Vacuum tube\. Pins A G K\. .*tube=<tube name>/m);
  assert.match(cat, /^rail: Power rail\. Pins 1\./m);
  assert.ok(!/^frame:/m.test(cat));
  assert.match(A.tubeList(), /EL84 \(pentode/);
});

test("markdown: structure kept, HTML escaped, part designators linked", () => {
  const h = A.markdown("## Stage 1\n**VL1.1** biased by R3 <script>x</script>\n- R3 = `1.5k`\n- C2 couples\n\n| a | b |\n|---|---|\n| R30 | 2 |", ["R3", "VL1.1", "C2"]);
  assert.match(h, /<h4>Stage 1<\/h4>/);
  assert.match(h, /<b><a href="#" class="ai-ref" data-ref="VL1.1">VL1.1<\/a><\/b>/);
  assert.match(h, /&lt;script&gt;/);
  assert.ok(!/<script>/.test(h));
  assert.match(h, /<li><a [^>]*data-ref="R3">R3<\/a> = <code>1.5k<\/code><\/li>/);
  assert.match(h, /<td>R30<\/td>/);   // R30 is not R3
  assert.match(A.markdown("```\nx<y\n```"), /<pre>x&lt;y<\/pre>/);
});
