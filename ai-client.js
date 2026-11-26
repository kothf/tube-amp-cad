/* AI providers for the CAD's AI features (cad-ai.js, cad-tune.js): Claude (Anthropic), ChatGPT
   (OpenAI), Gemini (Google), and any other service that speaks OpenAI's Chat Completions API
   ("compat": OpenRouter, DeepSeek, Mistral, Groq, xAI, Together, or a model on this computer in
   Ollama or LM Studio) at the base URL the user gives, called straight from the page with the
   user's own API key (none for a local server). There
   is no server of ours in between: the key stays in this browser (localStorage "tubecad_ai") and
   goes only to the provider it belongs to, as the DigiKey key does (mpn-online.js). No DOM, so
   Node tests run it with a stand-in fetch.

   chat(cfg, { system, messages, maxTokens }, fetch) → the answer's text. A message is
   { role: "user" | "assistant", text, files: [{ name, mime, data (base64) }] }; a PDF in files
   goes to the model as a document (all three read PDFs). */
(function (root) {
  "use strict";
  const STORE = "tubecad_ai";
  // the models offered in the settings (any other id can be typed, or loaded with "Load list")
  const PROVIDERS = {
    anthropic: {
      name: "Claude", maker: "Anthropic", keyUrl: "https://console.anthropic.com/settings/keys", keyHint: "sk-ant-…",
      models: [["claude-opus-5-5", "Claude Opus 5.5 · best for most work"], ["claude-sonnet-5-5", "Claude Sonnet 5.5 · faster"], ["claude-haiku-5-5", "Claude Haiku 5.5 · fastest, cheapest"], ["claude-fable-5-1", "Claude Fable 5.1 · most capable, slow"]]
    },
    openai: {
      name: "ChatGPT", maker: "OpenAI", keyUrl: "https://platform.openai.com/api-keys", keyHint: "sk-…",
      models: [["gpt-6.1-sol", "GPT-6.1 Sol · recommended"], ["gpt-6-astra", "GPT-6 Astra · most capable"], ["gpt-6.1-terra", "GPT-6.1 Terra · fast"], ["gpt-6-luna", "GPT-6 Luna · cheapest"]]
    },
    gemini: {
      name: "Gemini", maker: "Google", keyUrl: "https://aistudio.google.com/apikey", keyHint: "AIza…",
      models: [["gemini-3.1-pro-preview", "Gemini 3.1 Pro (preview) · best"], ["gemini-3.8-flash", "Gemini 3.8 Flash · fast"], ["gemini-3.5-flash-lite", "Gemini 3.5 Flash-Lite · cheapest"]]
    },
    // any OpenAI-compatible server: base URL + model typed (or loaded with Load list), key optional
    compat: {
      name: "OpenAI-compatible", maker: "", keyUrl: "", keyHint: "key (none for Ollama, LM Studio)", models: []
    }
  };
  // the services offered for the base URL of "compat" (any other URL can be typed)
  const SERVICES = [
    ["OpenRouter", "https://openrouter.ai/api/v1", "https://openrouter.ai/settings/keys"],
    ["DeepSeek", "https://api.deepseek.com/v1", "https://platform.deepseek.com/api_keys"],
    ["Mistral", "https://api.mistral.ai/v1", "https://console.mistral.ai/api-keys"],
    ["Groq", "https://api.groq.com/openai/v1", "https://console.groq.com/keys"],
    ["xAI Grok", "https://api.x.ai/v1", "https://console.x.ai"],
    ["Together", "https://api.together.xyz/v1", "https://api.together.ai/settings/api-keys"],
    ["Ollama", "http://localhost:11434/v1", ""],
    ["LM Studio", "http://localhost:1234/v1", ""]
  ];
  const cleanBase = u => String(u || "").trim().replace(/\/+$/, "").replace(/\/chat\/completions$/, "");
  // the service's name for a base URL: a known one, else its host
  function serviceName(base) {
    base = cleanBase(base); if (!base) return "OpenAI-compatible";
    const s = SERVICES.find(x => x[1] === base); if (s) return s[0];
    try { return new URL(base).host; } catch (e) { return base; }
  }
  const isLocal = base => { try { return /^(localhost|127\.|\[::1\]|0\.0\.0\.0|192\.168\.|10\.|.*\.local$)/.test(new URL(cleanBase(base)).hostname); } catch (e) { return false; } };
  const IDS = Object.keys(PROVIDERS);
  const defaultModel = p => (PROVIDERS[p].models[0] || [""])[0];
  const modelName = (p, m) => { const x = PROVIDERS[p] && PROVIDERS[p].models.find(q => q[0] === m); return x ? x[1].replace(/ ·.*$/, "") : m; };

  // settings: { provider, keys: { anthropic, openai, gemini, compat }, models: { … }, baseUrl (compat's) }
  function normalise(o) {
    o = o && typeof o === "object" ? o : {};
    const cfg = { provider: IDS.includes(o.provider) ? o.provider : "anthropic", keys: {}, models: {}, baseUrl: cleanBase(o.baseUrl) };
    IDS.forEach(p => {
      cfg.keys[p] = typeof (o.keys || {})[p] === "string" ? o.keys[p].trim() : "";
      cfg.models[p] = typeof (o.models || {})[p] === "string" && o.models[p].trim() ? o.models[p].trim() : defaultModel(p);
    });
    return cfg;
  }
  function load(storage) {
    storage = storage || root.localStorage;
    try { return normalise(JSON.parse(storage.getItem(STORE))); } catch (e) { return normalise(null); }
  }
  function save(cfg, storage) {
    storage = storage || root.localStorage;
    try { storage.setItem(STORE, JSON.stringify(normalise(cfg))); return true; } catch (e) { return false; }
  }
  // the provider in use and whether it can be asked: a key, or for "compat" a base URL and a model
  // (a local server needs no key)
  const ready = cfg => !!(cfg && cfg.keys && (cfg.provider === "compat" ? cfg.baseUrl && cfg.models && cfg.models.compat : cfg.keys[cfg.provider]));
  const who = cfg => (cfg.provider === "compat" ? serviceName(cfg.baseUrl) : PROVIDERS[cfg.provider].name);
  const label = cfg => `${who(cfg)} · ${cfg.provider === "compat" ? (cfg.models.compat || "no model") : modelName(cfg.provider, cfg.models[cfg.provider])}`;

  // The Claude models whose refusals another model may answer instead (server-side fallback)
  const FALLBACK = /^claude-(opus-5-5|sonnet-5-5|fable-5-1|opus-5)$/;

  // { url, init } of one request; req: { system, messages, maxTokens, stream, plain };
  // base: compat's base URL. plain: compat's retry for a server that refused the first try (no
  // stream, no length limit)
  function build(provider, model, key, req, base) {
    const max = req.maxTokens || 16000, system = req.system || "";
    const msgs = (req.messages || []).filter(m => m && (m.text || (m.files && m.files.length)));
    if (provider === "anthropic") {
      const content = m => (m.files || []).map(f => (f.mime === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.data } }
        : { type: "image", source: { type: "base64", media_type: f.mime, data: f.data } })).concat(m.text ? [{ type: "text", text: m.text }] : []);
      const body = { model, max_tokens: max, messages: msgs.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: content(m) })) };
      if (req.stream) body.stream = true;
      // the long, unchanging part of the prompt (the manual, the parts catalogue) is cached between questions
      if (system) body.system = [{ type: "text", text: system, cache_control: { type: "ephemeral" } }];
      const headers = { "content-type": "application/json", "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" };
      if (FALLBACK.test(model)) { headers["anthropic-beta"] = "server-side-fallback-2026-07-01"; body.fallbacks = "default"; }
      return { url: "https://api.anthropic.com/v1/messages", init: { method: "POST", headers, body: JSON.stringify(body) } };
    }
    if (provider === "openai") {
      const content = m => (m.role === "assistant" ? [{ type: "output_text", text: m.text }]
        : (m.files || []).map(f => (f.mime === "application/pdf"
          ? { type: "input_file", filename: f.name || "datasheet.pdf", file_data: `data:application/pdf;base64,${f.data}` }
          : { type: "input_image", image_url: `data:${f.mime};base64,${f.data}` })).concat(m.text ? [{ type: "input_text", text: m.text }] : []));
      const body = { model, max_output_tokens: max, input: msgs.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: content(m) })) };
      if (system) body.instructions = system;
      if (req.stream) body.stream = true;
      return { url: "https://api.openai.com/v1/responses", init: { method: "POST", headers: { "content-type": "application/json", authorization: "Bearer " + key }, body: JSON.stringify(body) } };
    }
    if (provider === "gemini") {
      const parts = m => (m.files || []).map(f => ({ inlineData: { mimeType: f.mime, data: f.data } })).concat(m.text ? [{ text: m.text }] : []);
      const body = { contents: msgs.map(m => ({ role: m.role === "assistant" ? "model" : "user", parts: parts(m) })), generationConfig: { maxOutputTokens: max } };
      if (system) body.systemInstruction = { parts: [{ text: system }] };
      return { url: `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:${req.stream ? "streamGenerateContent?alt=sse" : "generateContent"}`, init: { method: "POST", headers: { "content-type": "application/json", "x-goog-api-key": key }, body: JSON.stringify(body) } };
    }
    if (provider === "compat") {
      // plain text where there are no files: some servers take only a string as the content
      const content = m => (!(m.files && m.files.length) || m.role === "assistant" ? (m.text || "")
        : m.files.map(f => (f.mime === "application/pdf"
          ? { type: "file", file: { filename: f.name || "datasheet.pdf", file_data: `data:application/pdf;base64,${f.data}` } }
          : { type: "image_url", image_url: { url: `data:${f.mime};base64,${f.data}` } })).concat(m.text ? [{ type: "text", text: m.text }] : []));
      const messages = (system ? [{ role: "system", content: system }] : []).concat(msgs.map(m => ({ role: m.role === "assistant" ? "assistant" : "user", content: content(m) })));
      const body = { model, messages };
      if (!req.plain) { body.max_tokens = max; if (req.stream) body.stream = true; }
      const headers = { "content-type": "application/json" };
      if (key) headers.authorization = "Bearer " + key;
      return { url: cleanBase(base) + "/chat/completions", init: { method: "POST", headers, body: JSON.stringify(body) } };
    }
    throw new Error("Unknown AI provider: " + provider);
  }
  // a reasoning model's thinking (<think>…</think>, as DeepSeek R1 or Qwen write it in the answer),
  // left out of the answer; an unfinished one too while it streams
  const unthink = t => String(t || "").replace(/<think>[\s\S]*?(<\/think>\s*|$)/g, "");
  // the text of a Chat Completions content: a string, or a list of parts
  const ccText = c => (typeof c === "string" ? c : Array.isArray(c) ? c.map(x => (x && typeof x.text === "string" ? x.text : "")).join("") : "");

  // an error that says what to do about it
  function AiError(message, status) { const e = new Error(message); e.name = "AiError"; e.status = status || 0; return e; }
  function apiMessage(j) { const e = j && (j.error || j); return (e && (e.message || (typeof e === "string" ? e : ""))) || ""; }
  function failure(provider, status, j, name) {
    const who = name || PROVIDERS[provider].name, msg = apiMessage(j);
    if (provider === "compat" && status === 404) return AiError(`${who} answered 404${msg ? ": " + msg : ""}. Check the base URL (it usually ends in /v1) and the model name in AI settings; Load list there shows the models it has.`, status);
    if (status === 401 || status === 403) return AiError(`${who} refused the API key (${status}). Check it in AI settings.` + (msg ? ` ${who} says: ${msg}` : ""), status);
    if (status === 404) return AiError(`${who} does not know this model (${msg || "404"}). Pick another one in AI settings, or press Load list there.`, status);
    if (status === 429) return AiError(`${who} is rate-limiting this key or its credit ran out (429). Wait a minute or check your plan.` + (msg ? ` ${msg}` : ""), status);
    if (status === 400 && /api[_ ]?key/i.test(msg)) return AiError(`${who} refused the API key: ${msg}`, status);
    return AiError(`${who} answered ${status}${msg ? ": " + msg : ""}`, status);
  }
  // the answer's text from a provider's reply
  function parse(provider, j) {
    if (provider === "anthropic") {
      if (j.stop_reason === "refusal") throw AiError("Claude declined to answer this request.");
      const text = (j.content || []).filter(b => b.type === "text").map(b => b.text).join("");
      return { text, cut: j.stop_reason === "max_tokens" };
    }
    if (provider === "openai") {
      let text = typeof j.output_text === "string" ? j.output_text : "";
      if (!text) (j.output || []).forEach(o => { if (o.type === "message") (o.content || []).forEach(c => { if (c.type === "output_text") text += c.text; else if (c.type === "refusal") throw AiError("ChatGPT declined: " + c.refusal); }); });
      return { text, cut: j.status === "incomplete" };
    }
    if (provider === "compat") {
      if (j.error) throw AiError("The model's server answered with an error: " + apiMessage(j));
      const c = (j.choices || [])[0] || {}, m = c.message || {};
      if (m.refusal) throw AiError("The model declined: " + m.refusal);
      return { text: unthink(ccText(m.content)), cut: c.finish_reason === "length" };
    }
    const block = j.promptFeedback && j.promptFeedback.blockReason;
    if (block) throw AiError("Gemini blocked the request: " + block);
    const c = (j.candidates || [])[0] || {};
    const text = ((c.content || {}).parts || []).filter(p => typeof p.text === "string" && !p.thought).map(p => p.text).join("");
    if (!text && c.finishReason && c.finishReason !== "STOP" && c.finishReason !== "MAX_TOKENS") throw AiError("Gemini stopped: " + c.finishReason);
    return { text, cut: c.finishReason === "MAX_TOKENS" };
  }
  // A streamed answer (server-sent events), read as it comes: { text, cut }. Streaming keeps
  // bytes flowing, so a proxy or firewall that drops a quiet connection after 30 s does not cut
  // a long answer off, and the answer can be shown while it is written (onText).
  function streamState(provider) {
    const st = { text: "", cut: false, done: false };
    st.event = j => {
      if (!j || typeof j !== "object") return;
      if (provider === "anthropic") {
        if (j.type === "error") throw AiError("Claude stopped with an error: " + apiMessage(j));
        if (j.type === "content_block_delta" && j.delta && j.delta.type === "text_delta") st.text += j.delta.text;
        if (j.type === "message_delta" && j.delta) { if (j.delta.stop_reason === "refusal") throw AiError("Claude declined to answer this request."); st.cut = j.delta.stop_reason === "max_tokens"; }
        if (j.type === "message_stop") st.done = true;
      } else if (provider === "openai") {
        if (j.type === "error" || j.type === "response.failed") throw AiError("ChatGPT stopped with an error: " + (apiMessage(j.response || j) || j.type));
        if (j.type === "response.output_text.delta") st.text += j.delta || "";
        if (j.type === "response.refusal.done") throw AiError("ChatGPT declined: " + (j.refusal || ""));
        if (j.type === "response.incomplete") { st.cut = true; st.done = true; }
        if (j.type === "response.completed") st.done = true;
      } else if (provider === "compat") {
        if (j.error) throw AiError("The model's server stopped with an error: " + apiMessage(j));
        const c = (j.choices || [])[0]; if (!c) return;
        const d = c.delta || c.message || {};
        st.raw = (st.raw || "") + ccText(d.content); st.text = unthink(st.raw);
        if (c.finish_reason) { st.cut = c.finish_reason === "length"; st.done = true; }
      } else {
        if (j.error) throw AiError("Gemini stopped with an error: " + apiMessage(j));
        const out = parse("gemini", j);
        st.text += out.text; if (out.cut) st.cut = true;
      }
    };
    return st;
  }
  // feeds each event's data of a server-sent-events text to fn; returns what is left over
  function sseChunks(buf, fn) {
    const parts = buf.split(/\r?\n\r?\n/), rest = parts.pop();
    parts.forEach(ev => {
      const data = ev.split(/\r?\n/).filter(l => l.startsWith("data:")).map(l => l.slice(5).replace(/^ /, "")).join("\n");
      if (!data || data === "[DONE]") return;
      let j; try { j = JSON.parse(data); } catch (e) { return; }
      fn(j);
    });
    return rest;
  }
  async function readStream(provider, res, onText) {
    const st = streamState(provider);
    let buf = "";
    const feed = chunk => { buf = sseChunks(buf + chunk, st.event); if (onText && st.text) onText(st.text); };
    if (res.body && typeof res.body.getReader === "function") {
      const rd = res.body.getReader(), dec = new TextDecoder();
      for (;;) { const { done, value } = await rd.read(); if (done) break; feed(dec.decode(value, { stream: true })); }
    } else feed(await res.text());
    feed("\n\n");
    return st;
  }

  async function chat(cfg, req, fetchFn, signal) {
    fetchFn = fetchFn || root.fetch.bind(root);
    const p = cfg.provider, key = cfg.keys[p], name = who(cfg), compat = p === "compat";
    if (compat && !cfg.baseUrl) throw AiError("No base URL for the OpenAI-compatible model yet: open AI ▾ → AI settings… and pick a service or type its address.");
    if (compat && !cfg.models.compat) throw AiError(`No model chosen for ${name} yet: open AI ▾ → AI settings…, type the model's name or press Load list.`);
    if (!compat && !key) throw AiError(`No ${name} API key yet: open AI ▾ → AI settings… and paste one.`);
    const stream = req.stream !== false;
    const ask = plain => { const b = build(p, cfg.models[p] || defaultModel(p), key, Object.assign({}, req, { stream: stream && !plain, plain }), cfg.baseUrl); if (signal) b.init.signal = signal; return b; };
    let { url, init } = ask(false);
    const host = (() => { try { return new URL(url).host; } catch (e) { return url; } })();
    const unreachable = e => AiError(compat
      ? `Could not reach ${name} at ${cleanBase(cfg.baseUrl)} (${e.message}). ` + (isLocal(cfg.baseUrl)
        ? "Is the server running? A local server must allow this page's address (CORS): in Ollama set OLLAMA_ORIGINS to this site's address and restart it; in LM Studio switch on Enable CORS in the server settings. The browser may also ask to allow access to devices on your network."
        : "Check the address; the service must allow calls from a web page (CORS), and a browser extension or a firewall may block it.")
      : `Could not reach ${name} (${e.message}). Check the connection; a browser extension or a firewall may block ${host}.`);
    let res;
    try { res = await fetchFn(url, init); }
    catch (e) { if (e && e.name === "AbortError") throw e; throw unreachable(e); }
    // a server that does not take streaming or a length limit this long gets one plain try
    if (compat && !res.ok && [400, 413, 422].includes(res.status)) {
      let first = null; try { first = await res.json(); } catch (e) { first = null; }
      ({ url, init } = ask(true));
      try { res = await fetchFn(url, init); }
      catch (e) { if (e && e.name === "AbortError") throw e; throw unreachable(e); }
      if (!res.ok) {
        let j = null; try { j = await res.json(); } catch (e) { j = first; }
        const files = (req.messages || []).some(m => m && m.files && m.files.length);
        const err = failure(p, res.status, j || first, name);
        if (files) err.message += ` This model may not read pictures or PDFs: pick one that does (a "vision" model), or use Claude, ChatGPT or Gemini for this.`;
        throw err;
      }
    }
    const type = (res.headers && typeof res.headers.get === "function" && res.headers.get("content-type")) || "";
    let out;
    if (res.ok && /event-stream/i.test(type)) {
      try { out = await readStream(p, res, req.onText); }
      catch (e) { if (e && (e.name === "AbortError" || e.name === "AiError")) throw e; throw unreachable(e); }
    } else {
      let j = null; try { j = await res.json(); } catch (e) { j = null; }
      if (!res.ok) throw failure(p, res.status, j, name);
      if (!j) throw AiError(`${name} sent an answer that is not JSON`);
      out = parse(p, j);
    }
    if (!out.text) throw AiError(out.cut ? `${name} used the whole length limit on thinking and wrote no answer. Try again, or pick a model that thinks less (AI settings…).` : `${name} sent an empty answer`);
    return out.cut ? out.text + "\n\n(The answer was cut short at its length limit.)" : out.text;
  }

  // the models a key may use, newest first where the provider says (for the settings' Load list)
  async function listModels(provider, key, fetchFn, base) {
    fetchFn = fetchFn || root.fetch.bind(root);
    if (provider === "compat") {
      if (!cleanBase(base)) throw AiError("Pick a service or type its base URL first.");
      let res;
      try { res = await fetchFn(cleanBase(base) + "/models", { headers: key ? { authorization: "Bearer " + key } : {} }); }
      catch (e) { throw AiError(`Could not reach ${serviceName(base)} (${e.message}).` + (isLocal(base) ? " Is the server running, and does it allow this page (CORS)? See the manual, AI settings." : "")); }
      let j = null; try { j = await res.json(); } catch (e) { j = null; }
      if (!res.ok) throw failure(provider, res.status, j, serviceName(base));
      return ((j && (j.data || j.models)) || []).map(m => (typeof m === "string" ? m : m.id || m.name)).filter(Boolean).sort();
    }
    const req = provider === "anthropic" ? ["https://api.anthropic.com/v1/models?limit=100", { headers: { "x-api-key": key, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" } }]
      : provider === "openai" ? ["https://api.openai.com/v1/models", { headers: { authorization: "Bearer " + key } }]
        : ["https://generativelanguage.googleapis.com/v1beta/models?pageSize=200", { headers: { "x-goog-api-key": key } }];
    const res = await fetchFn(req[0], req[1]);
    let j = null; try { j = await res.json(); } catch (e) { j = null; }
    if (!res.ok) throw failure(provider, res.status, j);
    if (provider === "gemini") return (j.models || []).filter(m => (m.supportedGenerationMethods || []).includes("generateContent")).map(m => String(m.name).replace(/^models\//, "")).filter(n => /^gemini/.test(n));
    const ids = (j.data || []).map(m => m.id);
    return provider === "openai" ? ids.filter(id => /^(gpt|o\d|chatgpt)/.test(id) && !/(audio|realtime|transcribe|tts|image|search|embedding)/.test(id)).sort().reverse() : ids;
  }

  // The JSON object in a model's answer: the whole text, a ```json block, or the outermost { … }
  function extractJson(text) {
    const t = String(text || "").trim();
    const tries = [t];
    const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/i); if (fence) tries.push(fence[1]);
    const a = t.indexOf("{"), b = t.lastIndexOf("}"); if (a >= 0 && b > a) tries.push(t.slice(a, b + 1));
    for (const s of tries) { try { const o = JSON.parse(s); if (o && typeof o === "object") return o; } catch (e) { /* the next */ } }
    throw AiError("The answer did not contain the JSON asked for. Try again, or pick a stronger model in AI settings.");
  }

  root.AiClient = { STORE, PROVIDERS, IDS, SERVICES, serviceName, cleanBase, isLocal, who, defaultModel, modelName, normalise, load, save, ready, label, build, parse, chat, listModels, extractJson, streamState, sseChunks };
})(typeof window !== "undefined" ? window : globalThis);
