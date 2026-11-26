/* The AI assistant, the AI tab under the schematic and the AI ▾ menu: a conversation about the
   circuit on the sheet and about the app, with the user's own key for Claude, ChatGPT, Gemini or any OpenAI-compatible model
   (ai-client.js; AI settings… holds the keys, in this browser only).
   - Ask: any question; the circuit (parts, nets, the simulated operating point and Checks) goes
     with it, and the manual (help.html) is the model's reference for how-to questions.
   - Explain my circuit: stage by stage, why each part is there.
   - Fix the checks: the Checks list turned into value changes (R7 → 1.5 kΩ), each with an Apply
     button; applying one re-simulates and shows how the Checks changed.
   Other AI features (design, auto-tune, datasheets) add themselves through `actions`. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadAi(cad) {
    const { S, VERSION, circuitIssues, commit, compPins, desig, fmtEng, harmonics, measurements, netAC, netDC, runSim, selectParts, setStatus, signalFreq, speakerWave, toggleBom, topo, tubeData, undo, whenSimulated } = cad;
    const LIB = CadLib.LIB, A = root.AiCircuit, esc = A.esc;
    const AI = S.ai = { cfg: AiClient.load(), log: [], busy: null, manual: null };
    const actions = [];   // { id, label, title, run } of the other AI features, as buttons above the conversation
    const $ = id => document.getElementById(id);

    // -------------------------------------------------------------------------
    // The circuit as text for a prompt
    // -------------------------------------------------------------------------
    const isDoc = c => c.type === "frame" || c.type === "note";
    const refOf = c => desig(c) || c.label || c.id;
    // each net's name: GND, a connector's or rail's name, else N1, N2 … in the order parts use them
    function netNames(T) {
      const names = new Map([[0, "GND"]]);
      // connectors and rails name their net first, then net labels
      [["offsheet", "rail"], ["netlabel"]].forEach(types => S.comps.forEach(c => { if (types.includes(c.type) && c.params.name) { const n = T.pinNet.get(c.id + ":1"); if (n !== undefined && !names.has(n)) names.set(n, String(c.params.name)); } }));
      let k = 1;
      S.comps.forEach(c => compPins(c).forEach(p => { const n = T.pinNet.get(c.id + ":" + p.id); if (n !== undefined && !names.has(n)) names.set(n, "N" + k++); }));
      return names;
    }
    // detail: the editable values listed with their keys (for answers that change them)
    function describe(detail) {
      const T = topo(), names = netNames(T), r = S.sim.result, out = [];
      const frame = S.comps.find(c => c.type === "frame");
      if (frame && (frame.params.title || frame.params.docno)) out.push(`Title: ${[frame.params.docno, frame.params.title].filter(Boolean).join(" · ")}`);
      const parts = S.comps.filter(c => !isDoc(c) && LIB[c.type]);
      if (!parts.length) return "The sheet is empty: there is no circuit yet.";
      out.push("Parts (designator, kind, values; pin=net):");
      parts.forEach(c => {
        if (c.type === "ground" || c.type === "offsheet" || c.type === "netlabel" || c.type === "bus") return;
        const vals = A.fields(c).map(fd => { const v = A.show(c, fd, !detail); return v === "" ? "" : detail ? `${fd.key}=${v}` : `${fd.label.toLowerCase()} ${v}`; }).filter(Boolean);
        const pins = compPins(c).map(p => `${p.id}=${names.get(T.pinNet.get(c.id + ":" + p.id)) || "open"}`);
        out.push(`- ${refOf(c)} ${LIB[c.type].name}${vals.length ? " [" + vals.join(", ") + "]" : ""}: ${pins.join(" ")}`);
      });
      const notes = S.comps.filter(c => c.type === "note" && c.params.text).map(c => String(c.params.text).replace(/\s+/g, " "));
      if (notes.length) out.push("Notes on the sheet: " + notes.join(" | "));
      if (!r) out.push(`\nSimulation: ${S.sim.error || (S.sim.busy ? "still running" : "no result (Live is off or the circuit has no ground)")}.`);
      else {
        out.push("\nSimulated net voltages (DC; ~AC rms where there is signal):");
        const lines = [];
        names.forEach((name, n) => { if (n === 0) return; const v = netDC(n); if (v === null) return; const ac = netAC(n); lines.push(`${name} ${fmtEng(v, "V", 3)}${ac ? ` ~${fmtEng(ac.rms, "Vrms", 3)}` : ""}`); });
        out.push(lines.join("; "));
        const f0 = signalFreq();
        if (f0) out.push(`Signal frequency ${fmtEng(f0, "Hz")}.`);
        const m = measurements();
        if (m.length) out.push("Operating point: " + m.map(x => `${x.label} ${fmtEng(x.v, x.unit, 3)}${x.max ? ` (max ${fmtEng(x.max, x.unit, 3)})` : ""}`).join("; "));
        const extra = [];
        S.comps.forEach(c => {
          if (c.type === "tube") { const d = tubeData(c); if (d && d.metrics) extra.push(`${refOf(c)} stage gain ${d.metrics.gain ? d.metrics.gain.toFixed(1) : "?"}${d.metrics.thd !== null ? `, THD at the anode ${d.metrics.thd.toFixed(2)} %` : ""}`); }
          if (c.type === "speaker" && f0 && r.tran) { const w = speakerWave(c); if (w) { const h = harmonics(w.v, f0, r.tran.dt, 8); extra.push(`${refOf(c)} THD ${(100 * Math.sqrt(h.slice(1).reduce((s, v) => s + v * v, 0)) / Math.max(h[0], 1e-12)).toFixed(2)} %`); } }
        });
        if (extra.length) out.push(extra.join("; "));
      }
      const issues = circuitIssues();
      out.push("\nChecks (the app's rating and wiring checks): " + (issues.length ? "\n" + issues.map(i => "- " + i).join("\n") : "no problems found."));
      return out.join("\n");
    }
    const refs = () => S.comps.filter(c => !isDoc(c) && c.type !== "ground" && c.type !== "offsheet" && c.type !== "netlabel" && c.type !== "bus").map(refOf).filter(t => t && t.length < 12);

    // -------------------------------------------------------------------------
    // The manual, for how-to questions: help.html as plain text, fetched once
    // -------------------------------------------------------------------------
    async function manual() {
      if (AI.manual) return AI.manual;
      try {
        const html = await (await fetch("help.html" + VERSION)).text();
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("script, style, nav").forEach(e => e.remove());
        const lines = [];
        doc.body.querySelectorAll("h1, h2, h3, h4, p, li, dt, dd, pre, tr").forEach(e => {
          if (e.closest("li") && e.tagName !== "LI") return;
          const t = e.textContent.replace(/\s+/g, " ").trim(); if (!t) return;
          lines.push(/^H\d$/.test(e.tagName) ? `\n## ${t}` : e.tagName === "LI" ? "- " + t : t);
        });
        AI.manual = lines.join("\n").slice(0, 240000);
      } catch (e) { AI.manual = "(The manual could not be loaded.)"; }
      return AI.manual;
    }
    const SYSTEM = "You are the assistant built into Tube Amp CAD, a browser schematic editor and circuit simulator for vacuum-tube amplifiers (and transistor, op-amp and 555 circuits). "
      + "You help the user understand and improve the circuit on their sheet and use the app. Each question comes with the current circuit: its parts with designators and values, which net each pin is on, "
      + "the simulated DC and AC voltages, each tube's and transistor's operating point against its ratings, and the app's Checks. Refer to parts by their designators (R7, VL1.1) and give values with units. "
      + "Be practical and concise: short paragraphs and lists, no filler. When a number comes from the simulation say so; when the simulation is missing, say what to do (add a ground, press Simulate). "
      + "For questions about using the app, rely on the manual below and name the exact menus, buttons and keys; do not invent features the manual does not describe.\n\n"
      + "The app draws circuits itself. When the user asks you to draw, design, build, create or make a circuit, stage or amplifier, never write steps for doing it by hand: answer with exactly one line, "
      + "[[DRAW]] followed by a complete description of the circuit to draw (tubes, supply, load, power, gain, what the user asked for), and nothing else. "
      + "When the user asks to change the circuit on the sheet by adding, removing or replacing stages or parts, answer with exactly one line, [[EDIT]] followed by the change to make, and nothing else. "
      + "The app then designs the circuit, draws it on the sheet and simulates it. Questions, explanations and small value changes are answered in prose as usual.";

    // -------------------------------------------------------------------------
    // Conversation
    // -------------------------------------------------------------------------
    function add(entry) { AI.log.push(entry); render(); return entry; }
    function show() { toggleBom(true, "ai"); }
    // a request to the provider in use; the Stop button aborts it
    // (live: the answer is prose, shown while it is written)
    // (live as a function: it gets the answer so far instead, e.g. the design drawn while it is written)
    let paint = 0, tick = 0;
    async function call(req, what, live) {
      AI.cfg = AiClient.load();
      if (typeof live === "function") req = Object.assign({}, req, { onText: t => { if (AI.busy) live(t); } });
      else if (live) req = Object.assign({}, req, { onText: t => { if (!AI.busy) return; AI.busy.partial = hidden(t) ? "" : t; if (!paint) paint = setTimeout(paintPartial, 200); } });
      if (needKey()) throw Object.assign(new Error("no key"), { quiet: true });
      const ctl = typeof AbortController === "function" ? new AbortController() : null;
      AI.busy = { what, ctl, t0: Date.now() }; render();
      // the seconds tick in the busy line: the page is alive while the model thinks
      clearInterval(tick); tick = setInterval(() => { const el = document.querySelector("#ai-log .ai-busy-t"); if (el && AI.busy) el.textContent = Math.round((Date.now() - AI.busy.t0) / 1000) + " s"; }, 1000);
      setStatus("busy", `${what} · asking ${AiClient.label(AI.cfg)}…`);
      try { const text = await AiClient.chat(AI.cfg, req, null, ctl && ctl.signal); setStatus("ok", `${what}: answered by ${AiClient.label(AI.cfg)} in ${((Date.now() - AI.busy.t0) / 1000).toFixed(1)} s`); return text; }
      catch (e) { if (e.name === "AbortError") { setStatus("idle", `${what}: stopped`); throw Object.assign(new Error("stopped"), { quiet: true }); } setStatus("error", `${what}: ${e.message}`); throw e; }
      finally { AI.busy = null; clearInterval(tick); clearTimeout(paint); paint = 0; render(); }
    }
    // the answer written so far: only its own block is drawn again, not the whole conversation
    function paintPartial() {
      paint = 0; if (!AI.busy) return;
      const log = $("ai-log"), el = log && log.querySelector(".ai-partial");
      if (!el || !AI.busy.partial) { render(); return; }
      const atEnd = log.scrollHeight - log.scrollTop - log.clientHeight < 40;
      el.innerHTML = A.markdown(AI.busy.partial, AI.busy.refs || (AI.busy.refs = refs()));
      const w = log.querySelector(".ai-busy-verb"); if (w) w.textContent = "writing";
      if (atEnd) log.scrollTop = log.scrollHeight;
    }
    // a line under the busy one: what the request is doing now (drawing 12 parts…)
    function progress(text) {
      if (!AI.busy) return;
      AI.busy.note = text;
      const el = document.querySelector("#ai-log .ai-busy-note"); if (el) el.textContent = text; else render();
    }
    function stop() { if (AI.busy && AI.busy.ctl) AI.busy.ctl.abort(); }
    // an answer that asks the CAD to draw: not shown as prose
    const DRAW_RX = /^\s*\[\[(DRAW|EDIT)\]\]\s*([\s\S]*)$/;
    const hidden = t => /^\s*\[\[?/.test(t) && (DRAW_RX.test(t) || /^\s*\[\[?[A-Z]{0,4}$/.test(t));
    let drawer = null;   // cad-design.js: draws what the assistant was asked to draw
    // no key for the provider in use: say how to add one (true), before anything is asked
    function needKey() {
      AI.cfg = AiClient.load();
      if (AiClient.ready(AI.cfg)) return false;
      show(); if (!AI.log.length || AI.log[AI.log.length - 1].kind !== "setup") add({ kind: "setup" });
      return true;
    }
    function fail(e) { if (!e.quiet) add({ kind: "error", text: e.message }); else if (e.message === "stopped") add({ kind: "note", text: "Stopped." }); }
    // the conversation so far as messages: the circuit goes with the newest question only
    function history(prompt) {
      const msgs = AI.log.filter(m => (m.kind === "user" || m.kind === "answer") && m.text).slice(-12).map(m => ({ role: m.kind === "user" ? "user" : "assistant", text: m.prompt || m.text }));
      while (msgs.length && msgs[0].role !== "user") msgs.shift();
      msgs.push({ role: "user", text: prompt });
      return msgs;
    }
    async function ask(question, shown) {
      question = String(question || "").trim(); if (!question || AI.busy || needKey()) return;
      show();
      const prompt = `The circuit on the sheet now:\n${describe(false)}\n\nQuestion: ${question}`;
      const msgs = history(prompt);
      add({ kind: "user", text: shown || question, prompt: question });
      try {
        const system = SYSTEM + (root.AiSkill ? root.AiSkill.pack("assistant", S.comps) : "") + "\n\n# The manual (help.html)\n" + await manual();
        const text = await call({ system, messages: msgs }, shown || "Assistant", true);
        // asked to draw: the assistant hands the job to Design, which draws it on the sheet
        const d = DRAW_RX.exec(text);
        if (d && drawer) { add({ kind: "note", text: `Drawing it on the sheet: ${d[2].trim()}` }); await drawer(d[2].trim(), { edit: d[1] === "EDIT", asked: question }); return; }
        add({ kind: "answer", text });
      } catch (e) { fail(e); }
    }
    const explain = () => ask("Explain this circuit for someone who builds amplifiers: first in two or three sentences what it is and what it does, then stage by stage (input, gain stages, phase splitter, output, power supply, feedback, whatever it has) what each part is for and why it has its value. Use the simulated voltages and the operating points to say how each stage is biased and how hard it works. End with anything that looks unusual or worth checking.", "Explain my circuit");

    // Why?: the result in the panel's open tab explained, with the circuit: what causes it and what would change it
    const WHY = {
      checks: ["Checks", "The Checks list these problems. For each, explain why it happens in this circuit (which parts, voltages and currents cause it) and what would cure it, most serious first."],
      tolerance: ["Tolerance", "Explain these tolerance results: which parts' spread moves the results most and why, whether the spread is acceptable for this kind of circuit, and how the design could be made less sensitive."],
      power: ["Power sweep", "Explain this power sweep: what limits the output power, where the distortion comes from at low and at high levels (which stage clips or runs out of current first, which harmonics and why), and what would give more clean power."],
      noise: ["Noise and hum", "Explain these noise and hum results: which source dominates and why (the stage, the part or the supply behind it), whether the signal-to-noise ratio is good for this kind of circuit, and what would lower the noise or hum most."],
      sweep: ["Parameter sweep", "Explain this parameter sweep: why the results change the way they do as the value is stepped, and which value is the best compromise and why."],
      transient: ["Transient", "Explain what this transient run shows: why the waveforms and measurements are as they are, and anything in them that looks wrong or worth checking."],
      listen: ["Listen", "Explain what this render says about how the circuit sounds: how hard it is driven, its distortion and compression, and what in the circuit causes them."]
    };
    const WHY_PANE = { checks: "checks-pane", tolerance: "tol-pane", power: "pw-pane", noise: "nz-pane", sweep: "sw-pane", transient: "tr-pane", listen: "ls-pane" };
    function why(tab) {
      tab = tab || (document.querySelector(".dock-tab[aria-selected=true]") || { dataset: {} }).dataset.tab;
      const w = WHY[tab], pane = $(WHY_PANE[tab]);
      if (!w || !pane) return;
      const text = String(pane.innerText || "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
      if (!text || (tab !== "checks" && !pane.querySelector("svg, table, canvas"))) { setStatus("warn", `${w[0]}: run it first (▶ Run), then ask why.`); return; }
      return ask(`${w[1]} Use the numbers, and name the parts by their designators.\n\nThe ${w[0]} tab shows:\n${text.slice(0, 8000)}`, `Why? · ${w[0]}`);
    }

    // Fix the checks: value changes that cure the Checks, as cards with Apply
    const FIX_SYSTEM = "You are an expert amplifier designer working inside Tube Amp CAD. The app's Checks list each part beyond its rating and each wiring problem. "
      + "Propose the smallest set of value changes to existing parts that cures them, keeping the circuit's purpose (gain, output power, bias class). Use standard values (E12/E24 resistors, common capacitors and voltage ratings) and only the value keys and options listed for each part. "
      + "A rating field (a resistor's w, a capacitor's v) is a valid fix when the part is simply under-rated. If a problem cannot be fixed by changing values (a missing part or wire), say so in the summary instead of inventing a change. "
      + 'Answer with JSON only, no prose around it: {"summary": "two or three sentences: what is wrong and what the changes do", "fixes": [{"part": "R7", "field": "r", "value": "1.5k", "why": "one sentence"}]}';
    async function fixChecks() {
      if (AI.busy) return;
      show();
      const issues = circuitIssues();
      if (issues.length && needKey()) return;
      if (!issues.length) { add({ kind: "note", text: S.sim.result ? "Checks finds no problems in this circuit, so there is nothing to fix. Ask the assistant for improvements instead." : "No simulation result yet: Checks cannot rate the parts. Press ▶ Simulate first." }); return; }
      const prompt = `The circuit, with each part's editable values as key=value:\n${describe(true)}\n\nPropose the value changes that fix these Checks.`;
      add({ kind: "user", text: `Fix the checks (${issues.length})`, prompt: "Fix the checks." });
      try {
        const text = await call({ system: FIX_SYSTEM + (root.AiSkill ? root.AiSkill.pack("fix", S.comps) : ""), messages: [{ role: "user", text: prompt }] }, "Fix the checks");
        const j = AiClient.extractJson(text);
        const fixes = (Array.isArray(j.fixes) ? j.fixes : []).map(f => Object.assign({ part: String(f.part || ""), field: String(f.field || ""), value: f.value, why: String(f.why || "") }, check(f)));
        add({ kind: "fixes", summary: String(j.summary || ""), fixes, before: issues });
      } catch (e) { fail(e); }
    }
    // a proposed change against the circuit as it is: the part, the current value, or why it cannot be applied
    function check(f) {
      const c = S.comps.find(k => refOf(k) === String(f.part) || k.label === String(f.part));
      if (!c) return { error: `there is no part ${f.part}` };
      const fd = A.fields(c).find(x => x.key === String(f.field));
      if (!fd) return { error: `${f.part} has no value "${f.field}"` };
      const trial = { type: c.type, params: Object.assign({}, c.params) }, r = A.setValue(trial, fd.key, f.value);
      if (!r.ok) return { error: r.error };
      return { id: c.id, label: fd.label, from: A.show(c, fd) || "(not set)", to: A.show(trial, fd) };
    }
    // apply some of a card's changes as one undo step, then simulate and compare the Checks
    async function apply(card, which) {
      const done = [];
      which.forEach(k => {
        const f = card.fixes[k], c = f && !f.error && !f.applied && S.comps.find(x => x.id === f.id);
        if (!c) return;
        const r = A.setValue(c, f.field, f.value);
        if (r.ok) { f.applied = true; done.push(`${f.part} ${f.label.toLowerCase()} ${f.from} → ${f.to}`); } else f.error = r.error;
      });
      if (!done.length) return;
      commit(); render();
      const at = S.history[S.hIndex];
      selectParts(card.fixes.filter(f => f.applied).map(f => f.id));
      if (!S.sim.live) runSim("live");
      const note = add({ kind: "note", text: `Applied: ${done.join("; ")}. Simulating…` });
      await whenSimulated();
      const after = circuitIssues();
      note.text = `Applied: ${done.join("; ")}. Checks: ${card.before.length} → ${after.length} problem${after.length === 1 ? "" : "s"}` + (after.length ? ":\n" + after.map(i => "- " + i).join("\n") : ". All clear.");
      note.undo = true; note.at = at;
      render();
    }

    // -------------------------------------------------------------------------
    // Drawing the tab
    // -------------------------------------------------------------------------
    function entryHTML(m, k) {
      if (m.kind === "user") return `<div class="ai-msg user">${esc(m.text)}</div>`;
      if (m.kind === "answer") return `<div class="ai-msg answer">${A.markdown(m.text, refs())}</div>`;
      if (m.kind === "error") return `<div class="ai-msg error">⚠ ${esc(m.text)}</div>`;
      if (m.kind === "note") return `<div class="ai-msg note">${A.markdown(m.text, refs())}${m.undo ? `<div class="ai-row"><button class="btn" data-undo="${k}" title="Take the change back (Ctrl+Z)">Undo</button></div>` : ""}</div>`;
      if (m.kind === "setup") return `<div class="ai-msg note"><b>Add an API key to use the assistant.</b> It works with your own key for Claude (Anthropic), ChatGPT (OpenAI) or Gemini (Google). The key stays in this browser and goes only to that provider; the provider bills your account for what you ask. <div class="ai-row"><button class="btn primary" data-settings="1">AI settings…</button></div></div>`;
      if (m.kind === "card") return `<div class="ai-msg answer">${m.html}</div>`;   // built by another AI feature from escaped parts
      if (m.kind === "fixes") {
        const ok = m.fixes.filter(f => !f.error && !f.applied);
        const rows = m.fixes.map((f, j) => `<tr class="${f.error ? "bad" : f.applied ? "done" : ""}"><td><a href="#" class="ai-ref" data-ref="${esc(f.part)}">${esc(f.part)}</a></td>`
          + (f.error ? `<td colspan="2" class="warn">${esc(f.error)}</td>` : `<td>${esc(f.label)}</td><td class="mono">${esc(f.from)} → <b>${esc(f.to)}</b></td>`)
          + `<td>${esc(f.why)}</td><td>${f.error ? "" : f.applied ? "✓" : `<button class="btn" data-apply="${k}:${j}">Apply</button>`}</td></tr>`).join("");
        return `<div class="ai-msg answer">${m.summary ? A.markdown(m.summary, refs()) : ""}${m.fixes.length ? `<table class="ai-fixes"><tr><th>Part</th><th>Value</th><th>Change</th><th>Why</th><th></th></tr>${rows}</table>` : "<p>No value changes proposed.</p>"}`
          + (ok.length > 1 ? `<div class="ai-row"><button class="btn primary" data-apply="${k}:all">Apply all ${ok.length}</button></div>` : "") + "</div>";
      }
      return "";
    }
    function render() {
      const log = $("ai-log"); if (!log) return;
      AI.cfg = AiClient.load();
      const who = $("ai-who"); if (who) { who.textContent = AiClient.ready(AI.cfg) ? AiClient.label(AI.cfg) : AI.cfg.provider === "compat" ? "No model set" : "No API key"; who.classList.toggle("warn", !AiClient.ready(AI.cfg)); }
      let h = AI.log.map(entryHTML).join("");
      if (!AI.log.length) {
        h = `<div class="ai-msg note"><b>AI assistant.</b> Ask about the circuit on the sheet or how to do something in the app. It sees the parts, the simulated voltages, the operating points and the Checks.`
          + (AiClient.ready(AI.cfg) ? "" : ` It needs your own API key for Claude, ChatGPT or Gemini, or any OpenAI-compatible model (OpenRouter, DeepSeek, Mistral, Groq, a local Ollama): <a href="#" data-settings="1">AI settings…</a>`) + `</div>`
          + `<div class="ai-chips">${["Explain my circuit", "Fix the checks", "Why does the output stage run so hot?", "How do I measure the output power at 1 % THD?", "How do I add a second sheet?"].map(q => `<button class="btn ai-chip" data-q="${esc(q)}">${esc(q)}</button>`).join("")}</div>`;
      }
      if (AI.busy) h += (AI.busy.partial ? `<div class="ai-msg answer ai-partial">${A.markdown(AI.busy.partial, AI.busy.refs || (AI.busy.refs = refs()))}</div>` : "")
        + `<div class="ai-msg busy"><span class="ai-dots"></span> ${esc(AI.busy.what)} · ${esc(AiClient.label(AI.cfg))} is <span class="ai-busy-verb">${AI.busy.partial ? "writing" : "thinking"}</span>… <span class="ai-busy-t">${Math.round((Date.now() - AI.busy.t0) / 1000)} s</span> <button class="btn" id="btn-ai-stop" title="Stop the request (Esc on the sheet while a design is drawn)">Stop</button>`
        + `<div class="ai-busy-note">${esc(AI.busy.note || "")}</div></div>`;
      log.innerHTML = h;
      log.scrollTop = log.scrollHeight;
      const send = $("btn-ai-send"); if (send) send.disabled = !!AI.busy;
      actions.forEach(a => { const b = $(a.id); if (b) b.disabled = !!AI.busy && !a.free; });
    }
    function onLogClick(e) {
      const t = e.target.closest("[data-ref], [data-apply], [data-settings], [data-undo], [data-act], .ai-chip, #btn-ai-stop"); if (!t) return;
      e.preventDefault();
      if (t.dataset.act) { const fn = cardActs[t.dataset.act]; if (fn) fn(t.dataset.arg, t); return; }
      if (t.id === "btn-ai-stop") { if (AI.busy && AI.busy.ctl) AI.busy.ctl.abort(); return; }
      if (t.dataset.settings) { openSettings(); return; }
      // the note's Undo takes back this change only: after other edits it would take back the last of those
      if (t.dataset.undo) {
        const m = AI.log[+t.dataset.undo]; if (!m) return;
        if (S.history[S.hIndex] === m.at) { undo(); m.text += "\n\n*Undone.*"; } else m.text += "\n\n*The circuit changed since: Edit ▾ → Undo steps back through the changes.*";
        m.undo = false; render(); return;
      }
      if (t.classList.contains("ai-chip")) { const q = t.dataset.q; if (q === "Explain my circuit") explain(); else if (q === "Fix the checks") fixChecks(); else ask(t.textContent); return; }
      if (t.dataset.ref) { const c = S.comps.find(k => refOf(k) === t.dataset.ref || k.label === t.dataset.ref); if (c) selectParts([c.id]); return; }
      if (t.dataset.apply) { const [k, j] = t.dataset.apply.split(":"), card = AI.log[+k]; if (card) apply(card, j === "all" ? card.fixes.map((f, i) => i) : [+j]); }
    }

    // -------------------------------------------------------------------------
    // AI settings: the provider, each provider's key and model
    // -------------------------------------------------------------------------
    let draft = null;
    function openSettings() {
      draft = AiClient.load();
      $("ai-modal").hidden = false;
      settingsTab(draft.provider);
    }
    function settingsTab(p) {
      draft.provider = p;
      const P = AiClient.PROVIDERS[p], compat = p === "compat";
      document.querySelectorAll("#ai-providers [data-p]").forEach(b => b.classList.toggle("active", b.dataset.p === p));
      document.querySelectorAll("#ai-modal .ai-compat").forEach(el => { el.hidden = !compat; });
      $("ai-key").value = draft.keys[p]; $("ai-key").placeholder = P.keyHint;
      if (compat) { $("ai-base").value = draft.baseUrl || ""; $("ai-services").innerHTML = AiClient.SERVICES.map(x => `<option value="${esc(x[1])}">${esc(x[0])}</option>`).join(""); }
      keyLink();
      $("ai-model").placeholder = compat ? "the model's name, e.g. deepseek/deepseek-chat or qwen3:32b" : "";
      const list = $("ai-models"); list.innerHTML = P.models.map(m => `<option value="${m[0]}">${esc(m[1])}</option>`).join("");
      $("ai-model").value = draft.models[p];
      $("ai-test-out").textContent = ""; $("ai-test-out").className = "insp-help";
    }
    // the "Get a key" link: the provider's key page, or the chosen service's (none for a local server)
    function keyLink() {
      const p = draft.provider, a = $("ai-key-link");
      if (p !== "compat") { const P = AiClient.PROVIDERS[p]; a.hidden = false; a.href = P.keyUrl; a.textContent = `Get a ${P.name} key ↗`; return; }
      const base = AiClient.cleanBase($("ai-base").value), s = AiClient.SERVICES.find(x => x[1] === base);
      a.hidden = !(s && s[2]); if (s && s[2]) { a.href = s[2]; a.textContent = `Get a key at ${s[0]} ↗`; }
    }
    function readDraft() {
      draft.keys[draft.provider] = $("ai-key").value.trim(); draft.models[draft.provider] = $("ai-model").value.trim() || AiClient.defaultModel(draft.provider);
      if (draft.provider === "compat") draft.baseUrl = AiClient.cleanBase($("ai-base").value);
    }
    async function testKey() {
      readDraft();
      const out = $("ai-test-out"); out.className = "insp-help"; out.textContent = "Asking…";
      try {
        const t = await AiClient.chat(draft, { messages: [{ role: "user", text: "Reply with the single word: ready" }], maxTokens: 200 });
        out.className = "insp-help ok"; out.textContent = `✓ ${AiClient.label(draft)} answered: ${t.trim().slice(0, 60)}`;
      } catch (e) { out.className = "insp-help warn"; out.textContent = "⚠ " + e.message; }
    }
    async function loadModels() {
      readDraft();
      const out = $("ai-test-out"), p = draft.provider;
      if (p === "compat" && !draft.baseUrl) { out.className = "insp-help warn"; out.textContent = "Pick a service or type its base URL first: the list comes from it."; return; }
      if (p !== "compat" && !draft.keys[p]) { out.className = "insp-help warn"; out.textContent = "Paste the key first: the list comes from the provider."; return; }
      out.className = "insp-help"; out.textContent = "Loading the models this key can use…";
      try {
        const ids = await AiClient.listModels(p, draft.keys[p], null, draft.baseUrl);
        const known = new Map(AiClient.PROVIDERS[p].models);
        $("ai-models").innerHTML = ids.map(id => `<option value="${esc(id)}">${esc(known.get(id) || id)}</option>`).join("");
        out.className = "insp-help ok"; out.textContent = `✓ ${ids.length} models: pick one in the Model box (type to filter).`;
      } catch (e) { out.className = "insp-help warn"; out.textContent = "⚠ " + e.message; }
    }
    function saveSettings() {
      readDraft();
      if (!AiClient.save(draft)) { $("ai-test-out").className = "insp-help warn"; $("ai-test-out").textContent = "⚠ This browser does not let the page store anything (private mode?): the key cannot be kept."; return; }
      $("ai-modal").hidden = true; AI.cfg = AiClient.load();
      AI.log = AI.log.filter(m => m.kind !== "setup");
      setStatus("ok", AiClient.ready(AI.cfg) ? `AI: ${AiClient.label(AI.cfg)}` : AI.cfg.provider === "compat" ? "AI settings saved (the OpenAI-compatible model needs a base URL and a model name)" : "AI settings saved (no key for the chosen provider yet)");
      render();
    }
    function forgetKeys() {
      if (!confirm("Forget every AI key stored in this browser?")) return;
      draft = AiClient.normalise({ provider: draft.provider, models: draft.models, baseUrl: draft.baseUrl }); AiClient.save(draft); settingsTab(draft.provider); AI.cfg = AiClient.load(); render();
    }

    function init() {
      const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
      $("ai-log").addEventListener("click", onLogClick);
      const input = $("ai-input");
      const send = () => { const q = input.value; if (!q.trim() || AI.busy) return; input.value = ""; ask(q); };
      bind("btn-ai-send", send);
      input.addEventListener("keydown", e => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } });
      bind("btn-ai-explain", explain); bind("btn-ai-fix", fixChecks); bind("btn-ai-why", () => why());
      // the tab's More ▾: the other AI tools, one button wide so the tab's tools stay on one row
      const more = $("ai-more-menu"); if (more && root.UiKit) UiKit.menus(more.parentElement);
      bind("ai-who", openSettings); bind("btn-ai-clear", () => { if (AI.busy && AI.busy.ctl) AI.busy.ctl.abort(); AI.log = []; render(); });
      const tuneTab = () => toggleBom(true, "tune");
      bind("menu-ai-tune", tuneTab);
      bind("menu-ai-chat", () => { show(); setTimeout(() => input.focus(), 0); }); bind("menu-ai-explain", explain); bind("menu-ai-fix", fixChecks); bind("menu-ai-settings", openSettings);
      document.querySelectorAll("#ai-providers [data-p]").forEach(b => b.addEventListener("click", () => { readDraft(); settingsTab(b.dataset.p); }));
      bind("btn-ai-test", testKey); bind("btn-ai-list", loadModels); bind("btn-ai-save", saveSettings); bind("btn-ai-forget", forgetKeys);
      bind("btn-ai-cancel", () => { $("ai-modal").hidden = true; });
      $("ai-base").addEventListener("input", keyLink);
      $("ai-show-key").addEventListener("change", e => { $("ai-key").type = e.target.checked ? "text" : "password"; });
      $("ai-modal").addEventListener("keydown", e => { if (e.key === "Escape") $("ai-modal").hidden = true; });
      render();
    }
    // another AI feature's button above the conversation and its menu item
    function addAction(a) { actions.push(a); }
    // a button's handler on another feature's card (data-act="name" data-arg="…")
    const cardActs = {};
    function cardAction(name, fn) { cardActs[name] = fn; }

    return { init, render, ask, explain, why, fixChecks, apply, check, describe, openSettings, show, call, add, fail, addAction, cardAction, refOf, netNames: () => netNames(topo()), progress, stop, setDrawer: fn => { drawer = fn; } };
  }
  root.CadAi = CadAi;
})(window);
