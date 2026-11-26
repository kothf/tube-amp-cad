/* AI ▾ → Design from a description: the model answers with a netlist (ai-design.js checks it and
   draws it), the CAD puts it on a new sheet and simulates it, and the Checks go back to the
   model for up to two revisions. Needs the user's AI key (cad-ai.js).
   The answer is drawn while it is written: each part goes on the sheet as soon as the model has
   finished writing it (a preview, not an undo step), with a bar over the sheet and Stop. Asking
   the assistant to draw something ("draw me a 2A3 amp") lands here too. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadDesign(cad) {
    const { S, circuitIssues, placeDesign, previewDesign, endPreview, runSim, setStatus, whenSimulated } = cad;
    const D = S.design = { busy: false, rounds: 2, live: false };
    const $ = id => document.getElementById(id);
    let ai = null;

    const SYSTEM = "You are an expert vacuum-tube amplifier designer working inside Tube Amp CAD, a schematic editor with a circuit simulator. "
      + "The user describes an amplifier or a stage; you design it as a netlist of the CAD's parts. The CAD draws it, simulates it and runs its Checks (each tube and transistor against its ratings, wiring problems), and may send the results back for a revision. "
      + "Design what a skilled builder would: proven topologies, bias points with margin inside the ratings, standard values. Keep it to what was asked; when the description leaves something open, choose sensibly and say so in the summary.\n\n";
    function system() {
      return SYSTEM + AiDesign.rules() + "\n\n# The part library (type: name. Pins. Values)\n" + AiCircuit.catalogue({ skip: ["rail", "offsheet", "netlabel", "bus", "ground"] })
        + "\nscope: Oscilloscope. Pins CH1 CH2 COM. Values: none needed."
        + "\n\n# Tubes in the library (name, kind, max anode voltage, max anode dissipation)\n" + AiCircuit.tubeList();
    }

    // drawing while the answer is written: the parts complete so far, laid out and shown on the
    // sheet a few times a second (only when a new part has arrived)
    const L = { text: "", n: -1, timer: 0, what: "", prev: null };
    const bar = (text) => { const b = $("design-live"); if (!b) return; b.hidden = text === null; if (text !== null) $("design-live-text").textContent = text; };
    function live(what) {
      L.text = ""; L.n = -1; L.what = what; L.prev = null; clearTimeout(L.timer); L.timer = 0;
      bar(`${what}: waiting for the AI…`);
      return t => { L.text = t; if (!L.timer) L.timer = setTimeout(drawLive, 250); };
    }
    function drawLive() {
      L.timer = 0;
      if (!D.busy) return;
      const pd = AiDesign.partial(L.text), kb = (L.text.length / 1000).toFixed(1);
      if (pd.parts.length !== L.n) {
        L.n = pd.parts.length;
        let checked = null;
        try { checked = AiDesign.check({ parts: pd.parts, rails: pd.rails }); } catch (e) { checked = null; }
        if (checked && checked.parts.length) {
          // the parts drawn so far stay where they are; the new ones find their places
          const out = AiDesign.layout(checked, { title: pd.title || "AI design", prev: L.prev, effort: 0.3 });
          L.prev = out.places;
          previewDesign(out);
          D.live = true;
        }
      }
      const text = L.n > 0 ? `${L.what}: drawing ${pd.title ? "“" + pd.title + "” · " : ""}${L.n} part${L.n === 1 ? "" : "s"} so far` : `${L.what}: the AI is writing (${kb} kB)…`;
      bar(text); ai.progress(text);
      setStatus("busy", text + "…");
    }
    function liveDone() { clearTimeout(L.timer); L.timer = 0; D.live = false; bar(null); }
    function stop() { ai.stop(); }

    // the answer: checked, and the problems sent back once for a corrected answer
    async function getDesign(msgs, what) {
      let text = await ai.call({ system: system(), messages: msgs, maxTokens: 24000 }, what, live(what));
      let j = AiClient.extractJson(text), checked = AiDesign.check(j);
      if (checked.problems.length) {
        msgs.push({ role: "assistant", text }, { role: "user", text: `The CAD could not use this as it is:\n${checked.problems.map(p => "- " + p).join("\n")}\n\nAnswer with the whole design again as JSON, corrected.` });
        ai.add({ kind: "note", text: `The design has ${checked.problems.length} problem${checked.problems.length === 1 ? "" : "s"} (${checked.problems.slice(0, 3).join("; ")}${checked.problems.length > 3 ? " …" : ""}): asking for a corrected one.` });
        text = await ai.call({ system: system(), messages: msgs, maxTokens: 24000 }, `${what} · corrected`, live(`${what} · corrected`));
        j = AiClient.extractJson(text); checked = AiDesign.check(j);
      }
      msgs.push({ role: "assistant", text });
      if (!checked.parts.length) throw new Error("The answer has no parts the CAD knows.");
      return { j, checked };
    }
    // on the sheet (one undo step), simulated; the Checks after
    async function place(j, checked) {
      const out = AiDesign.layout(checked, { title: j.title || "AI design" });
      liveDone();
      placeDesign(out);
      if (!S.sim.live) runSim("live");
      await whenSimulated();
      return circuitIssues();
    }

    // opts.edit: a change to the circuit on the sheet (the assistant was asked for one): the sheet's
    // circuit goes with the request and the answer is the whole circuit with the change
    async function design(text, rounds, opts) {
      opts = opts || {};
      text = String(text || "").trim();
      if (!text || D.busy || !ai) return;
      ai.show();
      if (S.comps.some(c => c.type !== "frame") && !confirm(opts.edit ? "Redraw the circuit with this change?\n\n" + text + "\n\nThe AI draws the whole circuit again on a new sheet. Ctrl+Z brings back the circuit you have now." : "Design a new circuit?\n\nIt replaces the circuit on the sheet. Ctrl+Z brings the circuit back.")) { ai.add({ kind: "note", text: "Not drawn: the circuit on the sheet is kept." }); return; }
      D.busy = true;
      if (opts.asked === undefined) ai.add({ kind: "user", text: `Design: ${text}`, prompt: `Design: ${text}` });
      const msgs = [{ role: "user", text: opts.edit ? `The circuit on the sheet now, each part with its values as key=value:\n${ai.describe(true)}\n\nDraw it again with this change, keeping everything else as it is:\n${text}` : `Design this:\n${text}` }];
      try {
        let { j, checked } = await getDesign(msgs, "Design");
        ai.add({ kind: "note", text: `**${j.title || "Design"}**: ${checked.parts.length} parts. Drawing and simulating…` });
        let issues = await place(j, checked), round = 0;
        const notes = [];
        while (issues.length && round < rounds) {
          round++;
          notes.push(`Round ${round}: ${issues.length} problem${issues.length === 1 ? "" : "s"} in the Checks, sent back for a revision.`);
          ai.add({ kind: "note", text: notes[notes.length - 1] });
          msgs.push({ role: "user", text: `The CAD drew and simulated your design. What it measured:\n${ai.describe(false)}\n\nThe Checks still list:\n${issues.map(i => "- " + i).join("\n")}\n\nRevise the design so the Checks are clear, keeping what was asked. Answer with the whole design again as JSON.` });
          ({ j, checked } = await getDesign(msgs, `Design · revision ${round}`));
          issues = await place(j, checked);
        }
        ai.add({ kind: "answer", text: `## ${j.title || "Design"}\n${j.summary || ""}\n\n` + (issues.length ? `The Checks still list ${issues.length} problem${issues.length === 1 ? "" : "s"}${round ? ` after ${round} revision${round === 1 ? "" : "s"}` : ""}:\n${issues.map(i => "- " + i).join("\n")}\n\n**Fix the checks** or Auto-tune can take it from here.` : `Simulated: the Checks find no problems${round ? ` (after ${round} revision${round === 1 ? "" : "s"})` : ""}.`)
          + "\n\nThe drawing is a starting point: parts are joined by wires in signal order, with supplies as rail symbols, one ground line and labels only for far connections. Read the operating points before you build it." });
        ai.add({ kind: "note", text: round ? `Ctrl+Z steps back through the ${round + 1} versions to the circuit you had before.` : "Ctrl+Z brings back the circuit you had before." });
        setStatus(issues.length ? "warn" : "ok", `Design: ${j.title || ""} · ${checked.parts.length} parts · ${issues.length ? issues.length + " problems in the Checks" : "no problems in the Checks"}`);
      } catch (e) {
        // stopped or failed while drawing: the sheet goes back to the circuit it had (the last round drawn, in a revision)
        if (D.live) { endPreview(); ai.add({ kind: "note", text: "The sheet is back as it was before the AI started drawing." }); }
        ai.fail(e);
      }
      finally { liveDone(); D.busy = false; ai.render(); }
    }

    // the dialog: a description, examples to start from, how many revisions
    const EXAMPLES = ["A single-ended EL84 amplifier, about 4 W into 8 Ω, with a 12AX7 driver and 300 V B+",
      "A two-stage 12AX7 preamp with a gain of about 30 dB for a 10 kΩ load",
      "A push-pull 2×EL34 amplifier, 30 W into 8 Ω, with an ECC83 long-tailed-pair phase splitter",
      "A 6N1P line stage with a cathode follower output, gain about 10"];
    function open() {
      const m = $("design-modal"); if (!m) return;
      m.hidden = false;
      $("design-chips").innerHTML = EXAMPLES.map(t => `<button class="btn ai-chip" type="button">${AiCircuit.esc(t)}</button>`).join("");
      setTimeout(() => $("design-text").focus(), 0);
    }
    function go() {
      const t = $("design-text").value; if (!t.trim()) { $("design-text").focus(); return; }
      $("design-modal").hidden = true;
      design(t, $("design-revise").checked ? D.rounds : 0);
    }
    function init(aiApi) {
      ai = aiApi;
      ai.setDrawer((text, o) => design(text, D.rounds, o));
      const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
      bind("menu-ai-design", open); bind("btn-ai-design", open);
      bind("btn-design-go", go); bind("btn-design-cancel", () => { $("design-modal").hidden = true; });
      bind("btn-design-stop", stop);
      const chips = $("design-chips"); if (chips) chips.addEventListener("click", e => { const b = e.target.closest(".ai-chip"); if (b) { $("design-text").value = b.textContent; $("design-text").focus(); } });
      const m = $("design-modal"); if (m) m.addEventListener("keydown", e => { if (e.key === "Escape") m.hidden = true; else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) go(); });
    }
    return { init, open, design, system, stop };
  }
  root.CadDesign = CadDesign;
})(window);
