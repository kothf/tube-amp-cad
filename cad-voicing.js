/* AI ▾ → Voicing…: say how the amplifier should sound ("warmer, less fizz", "more headroom") and the
   AI proposes value changes to its tone-shaping parts (tone stack, coupling and bypass capacitors,
   cathode and anode resistors, feedback, bright caps, supply sag), each checked against the part
   (cad-ai.js check) with Apply. Hear before and after renders the Listen clip through the circuit as
   it is, keeps it as Before, applies the changes and renders again, so Listen's A/B compares the
   two by ear. Needs the user's AI key. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadVoicing(cad) {
    const { S, circuitIssues, fmtEng, harmonics, listen, setStatus, signalFreq, speakerWave, toggleBom, desig } = cad;
    const V = S.voicing = { busy: false, cards: [] };
    const $ = id => document.getElementById(id);
    let ai = null;

    const SYSTEM = "You are an expert in voicing amplifiers (guitar and bass amps, hi-fi and studio tube and transistor amplifiers) working inside Tube Amp CAD, a schematic editor with a circuit simulator. "
      + "The user says how the amplifier on the sheet should sound. Propose the smallest set of value changes to its existing parts that moves the sound that way: tone stack, coupling and bypass capacitors (corner frequencies), cathode resistors (gain, bias, how early a stage breaks up), anode loads, global feedback, bright and treble-bleed caps, grid stoppers, supply sag (rectifier resistance, filter values). "
      + "Keep its purpose and every part within its ratings; prefer changes that are easy to hear. For each change say in one sentence what it does to the sound and why, with the number that moves (a corner from 720 Hz to 340 Hz, a stage's gain from 60 to 35, feedback from 12 dB to 6 dB). "
      + "Use standard values (E12/E24 resistors, common capacitors) and only the value keys listed for each part. If the sound asked for needs a part or wire that is not there, say so in the summary instead of inventing a change. "
      + 'Answer with JSON only, no prose around it: {"summary": "two or three sentences: how it sounds now and what the changes do", "fixes": [{"part": "C4", "field": "c", "value": "4.7n", "why": "one sentence"}]}';

    // the output's harmonics at the generator's level, for each speaker: what the ear hears as the circuit's colour
    function colour() {
      const r = S.sim.result, f0 = signalFreq(), out = [];
      if (!r || !r.tran || !f0) return "";
      S.comps.filter(c => c.type === "speaker").forEach(c => {
        const w = speakerWave(c); if (!w) return;
        const h = harmonics(w.v, f0, r.tran.dt, 7), h1 = Math.max(h[0], 1e-12);
        out.push(`${desig(c)} at ${fmtEng(f0, "Hz")}: fundamental ${fmtEng(h1 / Math.SQRT2, "Vrms", 3)}, ` + h.slice(1, 6).map((v, i) => `H${i + 2} ${(100 * v / h1).toFixed(2)} %`).join(", "));
      });
      return out.length ? "\n\nThe output's harmonics at the generator's level now (the simulator's):\n" + out.join("\n") : "";
    }

    async function ask(want) {
      want = String(want || "").trim(); if (!want || V.busy || !ai) return;
      ai.show();
      V.busy = true;
      ai.add({ kind: "user", text: `Voicing: ${want}`, prompt: want });
      try {
        const prompt = `The circuit on the sheet now (each part's values with their keys):\n${ai.describe(true)}${colour()}\n\nHow it should sound: ${want}`;
        const text = await ai.call({ system: SYSTEM + (root.AiSkill ? root.AiSkill.pack("voicing", S.comps) : ""), messages: [{ role: "user", text: prompt }], maxTokens: 16000 }, "Voicing", true);
        const j = root.AiClient.extractJson(text);
        const fixes = (Array.isArray(j.fixes) ? j.fixes : []).map(f => Object.assign({ part: String(f.part || ""), field: String(f.field || ""), value: f.value, why: String(f.why || "") }, ai.check(f)));
        const entry = ai.add({ kind: "fixes", summary: String(j.summary || ""), fixes, before: circuitIssues() });
        V.cards.push(entry);
        const k = V.cards.length - 1, hear = !!listen.outputs().length && S.comps.some(c => c.type === "siggen" || c.type === "pickup" || c.type === "phono");
        if (fixes.some(f => !f.error)) {
          ai.add({ kind: "card", html: `<p>${hear ? "<b>Hear before and after</b> renders the Listen clip through the circuit as it is, keeps it as <b>Before</b>, applies these changes and renders it again: then play it in the Listen tab and switch <b>Before</b> and <b>B · Circuit</b> as it plays." : "To hear the difference, put a signal generator at the input and a speaker as the load: Hear before and after then plays both in the Listen tab."}</p>`
            + `<div class="ai-row"><button class="btn primary" data-act="vo-hear" data-arg="${k}"${hear ? "" : " disabled"}>Hear before and after</button></div>` });
        }
        setStatus("ok", `Voicing: ${fixes.filter(f => !f.error).length} value change${fixes.filter(f => !f.error).length === 1 ? "" : "s"} proposed. Apply them in the AI tab, or hear before and after.`);
      } catch (e) { ai.fail(e); }
      finally { V.busy = false; ai.render(); }
    }

    // render as it is → keep as Before → apply the card's changes → render again; Listen's A/B compares them
    async function hear(k) {
      const card = V.cards[+k]; if (!card || V.busy) return;
      const todo = card.fixes.map((f, i) => (!f.error && !f.applied ? i : -1)).filter(i => i >= 0);
      V.busy = true;
      try {
        toggleBom(true, "listen");
        if (todo.length) {
          setStatus("busy", "Voicing: rendering the circuit as it is (Before)…");
          if (!await listen.renderNow()) { ai.show(); ai.add({ kind: "error", text: `Listen could not render the circuit: ${S.listen.error || "stopped"}.` }); return; }
          listen.keepBefore("before the voicing changes");
          await ai.apply(card, todo);
        }
        toggleBom(true, "listen");
        setStatus("busy", "Voicing: rendering the circuit with the changes…");
        if (!await listen.renderNow()) { ai.show(); ai.add({ kind: "error", text: `Listen could not render the changed circuit: ${S.listen.error || "stopped"}.` }); return; }
        listen.setAB("before");
        setStatus("ok", "Voicing: before and after rendered. ▶ Play in the Listen tab, then switch Before and B · Circuit as it plays.");
      } finally { V.busy = false; }
    }

    function open() {
      const m = $("voice-modal"); if (!m) return;
      m.hidden = false;
      setTimeout(() => $("voice-text").focus(), 0);
    }
    function go() {
      const t = $("voice-text").value.trim(); if (!t) { $("voice-text").focus(); return; }
      $("voice-modal").hidden = true;
      ask(t);
    }
    function init(aiApi) {
      ai = aiApi;
      const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
      bind("menu-ai-voice", open); bind("btn-ai-voice", open); bind("btn-voice-go", go); bind("btn-voice-cancel", () => { $("voice-modal").hidden = true; });
      const m = $("voice-modal");
      if (m) {
        m.addEventListener("keydown", e => { if (e.key === "Escape") m.hidden = true; if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) go(); });
        m.querySelectorAll("[data-voice]").forEach(b => b.addEventListener("click", () => { const t = $("voice-text"); t.value = (t.value.trim() ? t.value.trim().replace(/[,.]?$/, ", ") : "") + b.dataset.voice; t.focus(); }));
      }
      ai.cardAction("vo-hear", hear);
    }
    return { init, open, ask, hear };
  }
  root.CadVoicing = CadVoicing;
})(window);
