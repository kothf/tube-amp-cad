/* AI ▾ → Find a fault…: what is wrong with an amplifier that is built. The user types the DC
   voltages measured on the real amplifier at idle (tube pins, transistor pins, supply nodes);
   the CAD simulates the circuit as drawn and once with each common fault (faults.js: a resistor
   open or drifted, a capacitor shorted or leaky, a tube weak or dead…), and ranks the faults by
   how well their voltages match the readings. The ranking and the test point to measure next
   need no key; with an AI key the model reads the ranking and writes the diagnosis: the likely
   fault, how to confirm it with the power off, and what to measure next.
   The readings are kept with the circuit (each on a part's pin: c.meas), so they are saved and
   come back with the file. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadFaults(cad) {
    const { S, buildNetlist, commit, compPins, desig, fmtEng, pool, setStatus, topo, tubeByName, tubeKind } = cad;
    const LIB = CadLib.LIB, F = root.Faults, esc = s => root.AiCircuit.esc(s);
    const $ = id => document.getElementById(id);
    const FS = S.faults = { job: null, seq: 0, last: null };
    const RUN = { budgetMs: 60000, maxPeriods: 20000 };
    const TOP = 6;
    let ai = null;

    // ---- test points: the nets worth measuring, each named as a builder finds it ----
    const NAMED = ["rail", "offsheet", "netlabel"];
    const ACTIVE = c => c.type === "tube" || CadLib.isTransistor(c.type);
    const SUPPLY = c => c.type === "electrolytic" || c.type === "inductor" || c.type === "diode" || c.type === "zener";
    const refOf = c => desig(c) || c.label || c.id;
    // within a part: the anode or collector first, then the screen, the cathode or emitter, the grid or base
    const PIN_ORDER = { A: 0, P: 0, C: 0, D: 0, G2: 1, K: 2, E: 2, S: 2, G: 3, G1: 3, B: 3 };
    const pinOrder = p => (PIN_ORDER[p.id] !== undefined ? PIN_ORDER[p.id] : 4);
    const pinName = (c, p) => (p.name ? p.name.replace(/^(triode plate|plate)$/, "anode") : p.id);
    // → [{ net, label, key: "compId:pinId" where the reading is kept, rank }]
    function points() {
      const T = topo(), by = new Map();
      S.comps.forEach(c => {
        if (!LIB[c.type] || c.type === "frame" || c.type === "note" || c.type === "ground" || c.type === "scope") return;
        compPins(c).forEach(p => {
          const n = T.pinNet.get(c.id + ":" + p.id); if (!(n > 0)) return;
          if (!by.has(n)) by.set(n, []); by.get(n).push({ c, p });
        });
      });
      const out = [];
      by.forEach((list, net) => {
        const named = list.find(x => NAMED.includes(x.c.type) && x.c.params.name);
        const act = list.filter(x => ACTIVE(x.c)).sort((a, b) => refOf(a.c).localeCompare(refOf(b.c), undefined, { numeric: true }) || pinOrder(a.p) - pinOrder(b.p));
        const real = list.filter(x => !NAMED.includes(x.c.type) && x.c.type !== "siggen");
        if (!named && !act.length && !real.some(x => SUPPLY(x.c))) return;
        if (!real.length) return;
        const label = act.length ? act.slice(0, 2).map(x => `${refOf(x.c)} ${pinName(x.c, x.p)}`).join(" · ") + (named ? ` (${named.c.params.name})` : "")
          : named ? String(named.c.params.name) : real.slice(0, 3).map(x => refOf(x.c)).join(" · ");
        const anchor = act[0] || real[0];
        out.push({ net, label, key: anchor.c.id + ":" + anchor.p.id, rank: act.length ? 0 : named ? 1 : 2, sortKey: act.length ? refOf(act[0].c) : label, pin: act.length ? pinOrder(act[0].p) : 0 });
      });
      return out.sort((a, b) => a.rank - b.rank || a.sortKey.localeCompare(b.sortKey, undefined, { numeric: true }) || a.pin - b.pin);
    }
    const compById = id => S.comps.find(c => c.id === id);
    function readingOf(pt) { const [id, pid] = pt.key.split(":"), c = compById(id); return c && c.meas && isFinite(c.meas[pid]) ? +c.meas[pid] : null; }
    function setReading(pt, v) {
      const [id, pid] = pt.key.split(":"), c = compById(id); if (!c) return false;
      const old = c.meas && c.meas[pid];
      if (v === null) { if (c.meas) { delete c.meas[pid]; if (!Object.keys(c.meas).length) delete c.meas; } }
      else { c.meas = Object.assign({}, c.meas, { [pid]: v }); }
      return old !== (v === null ? undefined : v);
    }
    const parseV = t => { t = String(t || "").trim().replace(",", ".").replace(/\s*v$/i, ""); if (!t) return null; const v = CadLib.parseEng(t); return isFinite(v) ? v : NaN; };
    const simNow = () => (S.sim.result && S.sim.topo === S.topo ? S.sim.result : null);
    const fmtV = v => (isFinite(v) ? (Math.abs(v) < 5e-3 ? "0 V" : fmtEng(v, "V", 3)) : "—");

    // ---- the dialog: a reading per test point ----
    let shown = [];
    function open() {
      const m = $("fault-modal"); if (!m) return;
      if (!S.comps.some(c => ACTIVE(c))) { if (ai) { ai.show(); ai.add({ kind: "note", text: "The fault finder needs a circuit with tubes or transistors on the sheet: their pins are where you measure." }); } return; }
      shown = points();
      const r = simNow();
      $("fault-rows").innerHTML = shown.map((pt, k) => {
        const v = readingOf(pt);
        return `<tr><td>${esc(pt.label)}</td><td class="mono n">${r ? fmtV(F.meter(r, pt.net)) : "—"}</td>`
          + `<td><input type="text" class="fault-in" id="fault-in-${k}" data-k="${k}" inputmode="decimal" autocomplete="off" spellcheck="false" value="${v === null ? "" : esc(String(+v.toPrecision(4)))}" placeholder="V"></td></tr>`;
      }).join("");
      $("fault-out").textContent = ""; $("fault-out").className = "insp-help";
      m.hidden = false;
      const first = shown.findIndex(pt => readingOf(pt) === null);
      setTimeout(() => { const el = $("fault-in-" + Math.max(0, first)); if (el) el.focus(); }, 0);
    }
    // the dialog's readings onto the parts (one undo step); → the readings or null (a bad entry)
    function take() {
      let changed = false, bad = null;
      shown.forEach((pt, k) => {
        const el = $("fault-in-" + k); if (!el) return;
        const v = parseV(el.value);
        if (Number.isNaN(v)) { bad = bad || el; el.classList.add("bad"); return; }
        el.classList.remove("bad");
        if (setReading(pt, v)) changed = true;
      });
      if (bad) { $("fault-out").className = "insp-help warn"; $("fault-out").textContent = "⚠ A reading is not a number: type volts, as 250 or 1.6."; bad.focus(); return null; }
      if (changed) commit();
      return readings();
    }
    // the readings kept on the circuit, on the test points they belong to now
    function readings() { return points().map(pt => ({ pt, v: readingOf(pt) })).filter(x => x.v !== null).map(x => ({ net: x.pt.net, v: x.v, label: x.pt.label, key: x.pt.key })); }
    function go() {
      const rs = take(); if (!rs) return;
      if (!rs.length) { $("fault-out").className = "insp-help warn"; $("fault-out").textContent = "⚠ Type at least one reading: the more test points, the surer the answer (anodes and cathodes, B+ at each filter cap)."; return; }
      $("fault-modal").hidden = true;
      find(rs);
    }
    function clearAll() { shown.forEach((pt, k) => { const el = $("fault-in-" + k); if (el) el.value = ""; }); }

    // ---- the search: the circuit as drawn and each fault, simulated at idle ----
    function stop() {
      if (!FS.job) return;
      FS.job.jobs.forEach(j => j.cancel()); FS.job = null; FS.seq++;
      setStatus("idle", "Fault finder stopped");
      if (ai) ai.render();
    }
    // the netlist with every signal generator silent (a voltmeter reading is taken at idle)
    function idleNetlist() {
      const gens = S.comps.filter(c => c.type === "siggen"), keep = gens.map(c => c.params);
      gens.forEach(c => { c.params = Object.assign({}, c.params, { wave: "sine", amp: 0 }); });
      try { return buildNetlist(); } finally { gens.forEach((c, k) => { c.params = keep[k]; }); }
    }
    function parts() {
      const T = topo();
      return S.comps.filter(c => LIB[c.type]).map(c => {
        const pins = {}; compPins(c).forEach(p => { pins[p.id] = T.pinNet.get(c.id + ":" + p.id); });
        const t = c.type === "tube" ? tubeByName(c.params.tube) : null;
        return { id: c.id, ref: refOf(c), type: c.type, kind: t ? tubeKind(t) : undefined, pins };
      });
    }
    const warmOf = r => (r && r.ok && r.warm && r.shooting && !r.shooting.converged ? r.warm : null);
    function find(rs) {
      stop();
      if (!ai) return;
      ai.show();
      const T = topo();
      if (!T.hasGround) { ai.add({ kind: "error", text: "Add a ground symbol: the circuit cannot be simulated without one." }); return; }
      const pts = points(), cands = F.candidates(parts(), CadLib.isTransistor), base = idleNetlist();
      const nets = [base].concat(cands.map(c => c.apply(base)));
      const seq = ++FS.seq, job = FS.job = { jobs: [], done: 0, total: nets.length, values: new Array(nets.length), failed: 0, t0: Date.now() };
      const valuesOf = r => { const v = {}; pts.forEach(pt => { v[pt.net] = F.meter(r, pt.net); }); return v; };
      ai.add({ kind: "user", text: `Find a fault: ${rs.length} reading${rs.length === 1 ? "" : "s"}`, prompt: "Find the fault." });
      const busy = ai.add({ kind: "card", html: "" });
      const paintBusy = () => { busy.html = `<p><span class="ai-dots"></span> Simulating the circuit at idle and ${cands.length} possible faults: ${job.done} of ${job.total} done. <button class="btn" data-act="fault-stop">Stop</button></p>`; ai.render(); };
      paintBusy();
      const progress = () => setStatus("busy", `Fault finder: ${job.done} of ${job.total} simulations`, job.done / job.total);
      const takeRun = (k, r) => {
        if (FS.seq !== seq) return;
        if (r && r.ok) job.values[k] = valuesOf(r); else job.failed++;
        job.done++; progress(); paintBusy();
        if (job.done === job.total) { FS.job = null; busy.html = ""; AI_log_remove(busy); finish(rs, pts, cands, job); }
      };
      progress();
      if (!pool.ok) {
        let warm = null;
        const nextRun = k => setTimeout(() => {
          if (FS.seq !== seq) return;
          const r = TubeSimEngine.simulate(nets[k], k && warm ? Object.assign({ warm }, RUN) : RUN);
          if (k === 0) warm = warmOf(r);
          takeRun(k, r);
          if (k + 1 < nets.length) nextRun(k + 1);
        }, 0);
        nextRun(0); return;
      }
      const send = (k, warm) => pool.run({ netlist: nets[k], options: warm ? Object.assign({ warm }, RUN) : RUN }, {
        onResult: r => {
          if (k === 0 && FS.seq === seq) for (let i = 1; i < nets.length; i++) job.jobs.push(send(i, warmOf(r)));
          takeRun(k, r);
        }
      });
      job.jobs.push(send(0));
    }
    function AI_log_remove(entry) { const k = S.ai.log.indexOf(entry); if (k >= 0) S.ai.log.splice(k, 1); }

    // ---- the answer: the ranking (no key needed), then the AI's diagnosis ----
    function finish(rs, pts, cands, job) {
      const secs = ((Date.now() - job.t0) / 1000).toFixed(0);
      if (!job.values[0]) { ai.add({ kind: "error", text: "The circuit as drawn did not simulate, so there is nothing to compare the readings with. Press ▶ Simulate to see why." }); setStatus("error", "Fault finder: the circuit did not simulate"); return; }
      const runs = cands.map((cand, k) => (job.values[k + 1] ? { cand, values: job.values[k + 1] } : null)).filter(Boolean);
      const res = F.rank(rs, job.values[0], runs);
      const top = res.ranked.slice(0, TOP);
      const nx = F.next(pts, rs, top.slice(0, 4).length > 1 ? top.slice(0, 4) : [{ values: job.values[0] }].concat(top.slice(0, 3)));
      const last = FS.last = { rs, nominal: job.values[0], top, next: nx, count: cands.length, failed: job.failed, nominalScore: res.nominal, nominalWorst: res.nominalWorst, fits: res.nominalWorst <= 1 };
      ai.add({ kind: "card", html: card(last, secs) });
      const best = top[0];
      setStatus(last.fits ? "ok" : "warn", last.fits ? "Fault finder: the readings match the circuit as drawn" : best ? `Fault finder: most likely ${best.cand.ref} ${best.cand.text}` : "Fault finder: no fault matches");
      diagnose(last);
    }
    const ok = (v, m) => isFinite(v) && Math.abs(v - m) <= F.slack(m);
    function card(L, secs) {
      const head = L.rs.map(r => `<th title="${esc(r.label)}">${esc(r.label)}<br><span class="mono">${esc(fmtV(r.v))}</span></th>`).join("");
      const cells = values => L.rs.map(r => { const v = values[r.net]; return `<td class="mono${ok(v, r.v) ? " fault-ok" : ""}">${esc(fmtV(v))}</td>`; }).join("");
      // by the largest miss: every reading within its slack is a good match, within 2.5 slacks a fair one
      const match = w => `<span class="fault-${w <= 1 ? "good" : w <= 2.5 ? "fair" : "poor"}">${w <= 1 ? "good" : w <= 2.5 ? "fair" : "poor"}</span>`;
      const rows = `<tr class="fault-nominal"><td>As drawn (no fault)</td><td>${match(L.nominalWorst)}</td>${cells(L.nominal)}</tr>`
        + L.top.map(t => `<tr><td><a href="#" class="ai-ref" data-ref="${esc(t.cand.ref)}">${esc(t.cand.ref)}</a> <span>${esc(t.cand.text)}</span></td><td>${match(t.worst)}</td>${cells(t.values)}</tr>`).join("");
      const verdict = L.fits
        ? "<p>The readings match the circuit as drawn (each within 5 % + 0.2 V): no DC fault shows at these points. If it still misbehaves, the fault is in the signal path or a part that sets no DC voltage (a coupling capacitor open, a bad connection, a microphonic tube): measure the other test points too, or follow a signal through it.</p>"
        : L.top.length ? `<p>Most likely: <b>${esc(L.top[0].cand.ref)} ${esc(L.top[0].cand.text)}</b>${L.top[1] && L.top[1].score - L.top[0].score < 0.3 ? `, or ${esc(L.top[1].cand.ref)} ${esc(L.top[1].cand.text)} (they read alike at these points)` : ""}.</p>` : "<p>None of the simulated faults matches the readings.</p>";
      const sure = L.top[0] && L.top[0].worst <= 1 && (!L.top[1] || L.top[1].worst > 2.5);
      const nx = sure ? "<p>Only this fault matches every reading; the others miss at least one by far.</p>" : L.next && !L.fits ? `<p><b>Measure next:</b> ${esc(L.next.point.label)}. There the leading faults read ${L.next.values.map(v => esc(fmtV(v))).join(", ")}.</p>` : "";
      return `<h4>Fault finder · ${L.rs.length} reading${L.rs.length === 1 ? "" : "s"} · ${L.count} faults simulated in ${secs} s</h4>${verdict}`
        + `<div class="fault-wrap"><table class="ai-fixes fault-table"><tr><th>Fault</th><th>Match</th>${head}</tr>${rows}</table></div>${nx}`
        + (L.failed ? `<p class="muted">${L.failed} simulation${L.failed === 1 ? "" : "s"} did not settle and ${L.failed === 1 ? "is" : "are"} left out.</p>` : "")
        + `<p class="muted">Green: within 5 % + 0.2 V of your reading. Voltages are DC at idle (no signal), measured to ground.</p>`
        + `<div class="ai-row"><button class="btn" data-act="fault-more">Enter more readings…</button></div>`;
    }
    const SYSTEM = "You are an experienced amplifier service technician helping someone repair an amplifier they built from the circuit below (tube amplifiers, transistor amplifiers and their power supplies). "
      + "They measured DC voltages at idle on the real amplifier. The CAD simulated the circuit as drawn and once with each common fault and ranked the faults by how well their simulated voltages match the readings; you get that ranking. "
      + "Write a short diagnosis: the most likely fault and why the readings point to it (name the readings), what else could cause the same readings (including faults the CAD does not simulate: a wiring mistake against the schematic, a part of the wrong value, a bad solder joint, a socket contact, a wrong tube), how to confirm it safely with the power off (resistance checks, a substitute tube, a visual check for burnt parts), and which test point to measure next if it is not certain. "
      + "Refer to parts by their designators. Start with one line in bold with the most likely fault. Remind once, briefly, that the filter capacitors hold a lethal charge and must be discharged before touching anything inside a tube amplifier. Be concise: short paragraphs and lists, no filler.";
    async function diagnose(L) {
      if (!AiClient.ready(AiClient.load())) { ai.add({ kind: "note", text: "Add an AI key (AI settings…) and the AI also writes the diagnosis: why the readings point to this fault, how to confirm it with the power off and what else could cause them." }); return; }
      const lines = [];
      lines.push("Readings (measured on the amplifier, DC volts to ground at idle) against the circuit as drawn (simulated):");
      L.rs.forEach(r => lines.push(`- ${r.label}: measured ${fmtV(r.v)}, as drawn ${fmtV(L.nominal[r.net])}`));
      lines.push(`\nFit of the circuit as drawn: rms miss ${L.nominalScore.toFixed(2)}, largest miss ${L.nominalWorst.toFixed(2)} (in units of 5 % + 0.2 V; 1 or less matches).`);
      lines.push(`\nThe ${L.top.length} best-matching of ${L.count} simulated faults (best first), with their simulated voltages at the same points:`);
      L.top.forEach((t, k) => lines.push(`${k + 1}. ${t.cand.ref} ${t.cand.text} (rms miss ${t.score.toFixed(2)}, largest ${t.worst.toFixed(2)}): ` + L.rs.map(r => `${r.label} ${fmtV(t.values[r.net])}`).join("; ")));
      if (L.next) lines.push(`\nThe unmeasured test point where these faults differ most: ${L.next.point.label} (${L.next.values.map(fmtV).join(", ")}).`);
      const prompt = `The circuit:\n${ai.describe(false)}\n\n${lines.join("\n")}\n\nWhat is most likely wrong, and what should I check?`;
      try {
        const text = await ai.call({ system: SYSTEM, messages: [{ role: "user", text: prompt }] }, "Fault finder", true);
        ai.add({ kind: "answer", text });
      } catch (e) { ai.fail(e); }
    }

    function init(aiApi) {
      ai = aiApi;
      const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
      bind("menu-ai-fault", open); bind("btn-ai-fault", open);
      bind("btn-fault-go", go); bind("btn-fault-clear", clearAll);
      bind("btn-fault-cancel", () => { $("fault-modal").hidden = true; });
      const m = $("fault-modal");
      if (m) m.addEventListener("keydown", e => {
        if (e.key === "Escape") m.hidden = true;
        else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) go();
        else if (e.key === "Enter" && e.target.classList.contains("fault-in")) { e.preventDefault(); const nx = $("fault-in-" + (+e.target.dataset.k + 1)); if (nx) nx.focus(); else go(); }
      });
      ai.addAction({ id: "btn-ai-fault" });
      ai.cardAction("fault-stop", stop);
      ai.cardAction("fault-more", open);
    }
    return { init, open, find, stop, points, readings, setReading };
  }
  root.CadFaults = CadFaults;
})(window);
