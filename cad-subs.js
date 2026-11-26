/* AI ▾ → Substitutes for the selected part: what else fits in place of a tube or a transistor. The CAD
   takes the library's parts of the same kind (a triode for a triode, an output pentode for an output
   pentode, an NPN for an NPN), ranks them by how close they are (µ and the anode current for triodes,
   the rated dissipation for output tubes, hFE and ratings for transistors) and by how they fit (plugs
   in, the socket rewired, another socket, another heater voltage), simulates the circuit with each in
   place of every part of that type, and lists the bias, the stress against the rating, the output and
   its THD beside the circuit as drawn. Use puts one in (one Undo takes it back). With a key, the AI
   writes what to re-bias for each, the sound people report and the risks. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadSubs(cad) {
    const { S, buildNetlist, commit, desig, fmtEng, pool, quantities, runSim, setStatus, topo, tubeByName, tubeKind, withResult } = cad;
    const U = S.subs = { busy: false, seq: 0, sets: [] };
    const esc = s => root.AiCircuit.esc(s);
    const RUN = { budgetMs: 120000, maxPeriods: 20000 };
    const MAX = 8;
    let ai = null, jobs = [];

    // ---- the candidates ----
    const ln = (a, b) => (a > 0 && b > 0 ? Math.abs(Math.log(a / b)) : 2);
    // the socket's wiring by electrode (no-connection pins left out; a dual triode's sections by their pins, so
    // 12AX7 and 6N2P compare equal at the anodes, grids and cathodes)
    const pinSig = t => { const po = (t.pinout || []).filter(p => p.sym !== "NC"), dual = po.some(p => p.sym === "A1");
      return po.map(p => `${p.pin}:${dual ? p.sym.replace(/^([AGK])\d$/, "$1") : p.sym}`).sort().join(","); };
    const names = t => [t.commonName, t.nameWestern, t.nameGost].filter(Boolean).join(" / ").toUpperCase();
    // a tube's analog, as the handbook lists it (6П14П for EL84): either way round
    const analog = (a, b) => { const la = (a.book && a.book.analogs) || [], lb = (b.book && b.book.analogs) || [], nb = names(b), na = names(a);
      return la.some(x => nb.includes(String(x).toUpperCase())) || lb.some(x => na.includes(String(x).toUpperCase())); };
    // two sections in one envelope (a dual triode): only a dual takes its place
    const dual = t => (t.pinout || []).some(p => p.sym === "A2");
    function tubeCands(t) {
      const kind = tubeKind(t), pow = t.category === "power", sig = pinSig(t), section = /-[PT]$/.test(t.commonName);
      const k0 = t.koren[kind === "pentode" ? "Pentode" : "Triode"] || {};
      return (root.TUBE_DATABASE || []).filter(u => u !== t && u.koren && tubeKind(u) === kind && (u.category === "power") === pow && /-[PT]$/.test(u.commonName) === section && dual(u) === dual(t))
        .map(u => {
          const k1 = u.koren[kind === "pentode" ? "Pentode" : "Triode"] || {};
          const fit = u.socket === t.socket ? (pinSig(u) === sig ? "plug" : "rewire") : "socket";
          // triodes by µ and the current (kg); output tubes by their rated dissipation and voltage
          const dist = kind === "triode" && !pow ? ln(k1.mu, k0.mu) + 0.5 * ln(k1.kg, k0.kg) : ln(u.paMax, t.paMax) + 0.3 * ln(u.vaMax, t.vaMax) + 0.3 * ln(k1.mu, k0.mu);
          const heat = +u.vh === +t.vh ? 0 : 1, an = analog(t, u);
          return { name: u.commonName, fit, socket: u.socket, vh: +u.vh, ih: +u.ih, an, rating: u.paMax, score: dist + { plug: 0, rewire: 0.4, socket: 0.8 }[fit] + heat - (an ? 0.6 : 0) };
        }).sort((a, b) => a.score - b.score).slice(0, MAX);
    }
    // the library's transistors of the same type: rated for the circuit's voltage, closest in gain and power
    function semiCands(c) {
      const tab = CadLib.semiTable(c.type), m0 = tab[c.params.model] || {}, bip = !CadLib.isFet(c.type);
      return Object.entries(tab).filter(([k, m]) => k !== c.params.model && m.pol === m0.pol && (!m0.v || m.v >= 0.8 * m0.v))
        .map(([k, m]) => {
          const dist = (bip ? ln(m.bf, m0.bf) : c.type === "njf" || c.type === "pjf" ? ln(Math.abs(m.vto), Math.abs(m0.vto)) + ln(m.beta, m0.beta) : Math.abs((m.vto || 0) - (m0.vto || 0)) / 2 + 0.5 * ln(m.kp, m0.kp)) + 0.5 * ln(m.p, m0.p);
          const fit = m.pkg === m0.pkg ? "plug" : "socket";
          return { name: k, fit, socket: m.pkg, rating: m.p, use: m.use, score: dist + (fit === "plug" ? 0 : 0.5) + (m.i < 0.5 * (m0.i || 0) ? 1 : 0) };
        }).sort((a, b) => a.score - b.score).slice(0, MAX);
    }
    // the parts swapped: every part of that type in the circuit (both sections, both sides of a push-pull)
    function partsLike(c) { return c.type === "tube" ? S.comps.filter(x => x.type === "tube" && x.params.tube === c.params.tube) : S.comps.filter(x => x.type === c.type && x.params.model === c.params.model); }
    const KEY = c => (c.type === "tube" ? "tube" : "model");
    // the parts with the substitute in for the time fn takes (their values come back at once)
    function withSub(parts, name, fn) {
      const keep = parts.map(c => c.params);
      parts.forEach(c => { c.params = Object.assign({}, c.params, { [KEY(c)]: name }); });
      try { return fn(); } finally { parts.forEach((c, k) => { c.params = keep[k]; }); }
    }

    // ---- what each run gives: the swapped parts' bias and stress, the output and its THD ----
    function measure(parts) {
      const q = quantities(), by = k => q.find(x => x.key === k), ids = new Set(parts.map(c => c.id));
      const tube = parts[0].type === "tube", ia = [], st = [];
      parts.forEach(c => {
        const i = by(c.id + (tube ? ":ia" : ":i")), p = by(c.id + (tube ? ":pa" : ":pd"));
        if (i && isFinite(i.v)) ia.push(i.v);
        if (p && isFinite(p.v)) st.push({ v: p.v, max: p.max });
      });
      const worst = st.reduce((w, s) => (s.max > 0 && (!w || s.v / s.max > w.v / w.max) ? s : w), null) || st[0] || null;
      const out = q.find(x => /:p$/.test(x.key) && x.unit === "W") || q.find(x => /:ch1$/.test(x.key));
      const thd = out ? by(out.key.replace(/:p$/, ":thd").replace(/:ch1$/, ":ch1thd")) : null;
      return { i: ia.length ? ia.reduce((s, v) => s + v, 0) / ia.length : null, stress: worst, out: out ? { v: out.v, unit: out.unit, label: out.label } : null, thd: thd && isFinite(thd.v) ? thd.v : null, ids };
    }

    function stop() { jobs.forEach(j => j.cancel && j.cancel()); jobs = []; if (U.busy) { U.busy = false; U.seq++; setStatus("idle", "Substitutes stopped"); } }
    function selected() { const ids = [...S.sel.comps]; return ids.map(id => S.comps.find(c => c.id === id)).find(c => c && ((c.type === "tube" && tubeKind(tubeByName(c.params.tube)) !== "rectifier") || CadLib.isTransistor(c.type))) || null; }

    function advise(c) {
      if (!ai) return;
      ai.show();
      c = c || selected();
      if (!c) { ai.add({ kind: "note", text: "Select a tube or a transistor on the sheet first: the substitutes are found for the part you select (and every part of the same type in the circuit)." }); ai.render(); setStatus("warn", "Substitutes: select a tube or a transistor first"); return; }
      if (!topo().hasGround) { ai.add({ kind: "error", text: "Add a ground symbol: the circuit cannot be simulated without one." }); ai.render(); return; }
      stop();
      const tube = c.type === "tube", t = tube ? tubeByName(c.params.tube) : null, was = tube ? c.params.tube : c.params.model;
      const cands = tube ? (t ? tubeCands(t) : []) : semiCands(c), parts = partsLike(c);
      const refs = parts.map(desig).join(", ");
      ai.add({ kind: "user", text: `Substitutes for ${was} (${refs})`, prompt: "Substitutes" });
      if (!cands.length) { ai.add({ kind: "note", text: `The library has no other ${tube ? "tube" : "part"} of the same kind as ${was}.` }); ai.render(); return; }
      const T = topo(), nets = [buildNetlist()].concat(cands.map(x => withSub(parts, x.name, buildNetlist)));
      const seq = ++U.seq, job = { done: 0, total: nets.length, res: new Array(nets.length), t0: Date.now() };
      U.busy = true;
      const busy = ai.add({ kind: "card", html: "" });
      const paint = () => { busy.html = `<p><span class="ai-dots"></span> Simulating ${esc(was)} and ${cands.length} substitutes in its place: ${job.done} of ${job.total} done. <button class="btn" data-act="sub-stop">Stop</button></p>`; ai.render(); };
      paint();
      const take = (k, r) => {
        if (U.seq !== seq) return;
        job.res[k] = r && r.ok ? withSub(parts, k ? cands[k - 1].name : was, () => withResult(r, nets[k], T, () => measure(parts))) : null;
        job.done++; setStatus("busy", `Substitutes: ${job.done} of ${job.total} simulations`, job.done / job.total); paint();
        if (job.done === job.total) { U.busy = false; jobs = []; const i = S.ai.log.indexOf(busy); if (i >= 0) S.ai.log.splice(i, 1); finish(c, was, parts, cands, job); }
      };
      nets.forEach((net, k) => {
        if (!pool.ok) { setTimeout(() => { if (U.seq === seq) take(k, TubeSimEngine.simulate(net, RUN)); }, 0); return; }
        jobs.push(pool.run({ netlist: net, options: RUN }, { onResult: r => take(k, r) }));
      });
    }

    const fmtI = v => (v === null ? "—" : fmtEng(v, "A", 2));
    const pct = s => (s && s.max > 0 ? `${fmtEng(s.v, "W", 2)} (${Math.round(100 * s.v / s.max)} %)` : s ? fmtEng(s.v, "W", 2) : "—");
    const FIT = { plug: "plugs in", rewire: "rewire the socket", socket: "another socket" };
    function finish(c, was, parts, cands, job) {
      const base = job.res[0], tube = c.type === "tube", t0 = tube ? tubeByName(was) : null;
      if (!base) { ai.add({ kind: "error", text: "The circuit as drawn did not simulate, so there is nothing to compare with. Press ▶ Simulate to see why." }); setStatus("error", "Substitutes: the circuit did not simulate"); ai.render(); return; }
      const rows = cands.map((x, k) => ({ x, m: job.res[k + 1] }));
      const k = U.sets.push({ c: c.id, was, parts: parts.map(p => p.id), rows }) - 1;
      const head = `<tr><th>Part</th><th>Fits</th>${tube ? "<th>Heater</th>" : ""}<th>${tube ? "Ia" : "I"}</th><th>${tube ? "Pa" : "Pd"} (of max)</th><th>Output</th><th>THD</th><th></th></tr>`;
      const outOf = m => (m && m.out && isFinite(m.out.v) ? fmtEng(m.out.v, m.out.unit === "W" ? "W" : "V", 2) : "—");
      const thdOf = m => (m && m.thd !== null ? `${m.thd.toFixed(2)} %` : "—");
      const heat = x => (x.vh ? `${fmtEng(x.vh, "V")} ${fmtEng(x.ih, "A")}${t0 && x.vh !== +t0.vh ? ' <span class="warn">other voltage</span>' : ""}` : "—");
      const over = m => m && m.stress && m.stress.max > 0 && m.stress.v > m.stress.max;
      const row = (name, fit, x, m, act) => `<tr><td><b>${esc(name)}</b>${x && x.an ? ' <span class="muted">(analog)</span>' : ""}</td><td>${fit}</td>${tube ? `<td class="mono">${x ? heat(x) : t0 ? esc(`${fmtEng(+t0.vh, "V")} ${fmtEng(+t0.ih, "A")}`) : "—"}</td>` : ""}`
        + `<td class="mono">${esc(m ? fmtI(m.i) : "did not simulate")}</td><td class="mono${over(m) ? " warn" : ""}">${esc(m ? pct(m.stress) : "—")}</td><td class="mono">${esc(outOf(m))}</td><td class="mono">${esc(thdOf(m))}</td><td>${act}</td></tr>`;
      const body = row(`${was} (as drawn)`, "—", null, base, "")
        + rows.map((r, i) => row(r.x.name, esc(FIT[r.x.fit] + (r.x.fit === "socket" && r.x.socket ? ` (${r.x.socket})` : "")), r.x, r.m, r.m ? `<button class="btn" data-act="sub-use" data-arg="${k}:${i}">Use</button>` : "")).join("");
      const note = `<p class="muted">${parts.length > 1 ? `Each substitute replaces all ${parts.length} ${esc(was)} (${esc(parts.map(desig).join(", "))}). ` : ""}Simulated with the bias parts as drawn: a different current is what would need re-biasing. ${tube ? "Check the heater winding's current with each." : "Check the package's pin order on the board."}</p>`;
      ai.add({ kind: "card", html: `<h4>Substitutes for ${esc(was)}</h4><table class="ai-fixes sub-table">${head}${body}</table>${note}` });
      const okN = rows.filter(r => r.m).length;
      setStatus("ok", `Substitutes: ${okN} parts simulated in place of ${was}. Use one from the AI tab.`);
      ai.render();
      notes(was, parts, base, rows);
    }
    const SYSTEM = "You are an experienced tube and transistor amplifier designer advising on part substitutes for the circuit on the sheet of Tube Amp CAD. "
      + "You get the circuit and a table the CAD simulated: each candidate put in place of the part, with its fit (plugs in, rewired socket, other socket), heater, the current, the dissipation against its rating, the output and THD. "
      + "Write, in Markdown, short and specific to this circuit: the best two or three substitutes and why; for each candidate worth using, what to re-bias (which designator, to what value, to bring the current back) and what changes at the socket or heater; the sound character builders report for it where it is well known (say so when it is folklore); and which candidates to avoid (over-rated dissipation, a heater the transformer can't feed, a different pinout). Use the table's numbers. No generic filler.";
    async function notes(was, parts, base, rows) {
      if (!(root.AiClient && root.AiClient.ready(root.AiClient.load()))) { ai.add({ kind: "note", text: "Add an AI key (AI settings…) and the AI also writes what to re-bias for each substitute, the sound builders report and which to avoid." }); ai.render(); return; }
      const line = (n, f, m) => `${n} | ${f} | ${m ? `I ${fmtI(m.i)}, P ${pct(m.stress)}, output ${m.out ? fmtEng(m.out.v, m.out.unit === "W" ? "W" : "V", 2) : "—"}, THD ${m.thd !== null ? m.thd.toFixed(2) + " %" : "—"}` : "did not simulate"}`;
      const table = [line(`${was} (as drawn)`, "—", base)].concat(rows.map(r => line(r.x.name, FIT[r.x.fit] + (r.x.vh ? `, heater ${r.x.vh} V ${r.x.ih} A` : "") + (r.x.an ? ", listed analog" : "") + (r.x.use ? `, ${r.x.use}` : ""), r.m))).join("\n");
      try {
        U.busy = true;
        const text = await ai.call({ system: SYSTEM + (root.AiSkill ? root.AiSkill.pack("subs", S.comps) : ""), messages: [{ role: "user", text: `The circuit:\n${ai.describe(false)}\n\nThe part: ${was} (${parts.map(desig).join(", ")})\nThe simulated substitutes:\n${table}` }], maxTokens: 16000 }, "Substitutes", true);
        ai.add({ kind: "answer", text });
      } catch (e) { ai.fail(e); } finally { U.busy = false; ai.render(); }
    }
    // Use: the substitute in for every part of that type, as one step to undo
    function use(arg) {
      const [k, i] = String(arg).split(":").map(Number), set = U.sets[k], r = set && set.rows[i]; if (!r) return;
      const parts = set.parts.map(id => S.comps.find(c => c.id === id)).filter(Boolean);
      if (!parts.length) { setStatus("warn", "Substitutes: those parts are no longer on the sheet"); return; }
      parts.forEach(c => { c.params[KEY(c)] = r.x.name; if (r.x.fit === "socket" && c.params.sock) c.params.sock = ""; });
      commit();
      if (!S.sim.live) runSim("live");
      setStatus("ok", `Substitutes: ${r.x.name} in place of ${set.was} (${parts.map(desig).join(", ")}). Undo takes it back.`);
    }
    function init(aiApi) {
      ai = aiApi;
      ["menu-ai-subs", "btn-ai-subs"].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener("click", () => advise()); });
      ai.cardAction("sub-use", use);
      ai.cardAction("sub-stop", stop);
    }
    return { init, advise, tubeCands, semiCands, stop };
  }
  root.CadSubs = CadSubs;
})(window);
