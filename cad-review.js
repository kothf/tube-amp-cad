/* AI ▾ → Design review: the whole design read as an engineer reviews it before it is built. The
   CAD gathers what its windows know, all in one place: each tube's and transistor's margin to its
   ratings, each part's stress against its rating (capacitor voltages, diode PIV, fuse current,
   resistor power), the Checks, the ripple on every supply node, the power totals and, for a
   circuit run from the mains, the power-on run (capacitor peaks while the cathodes warm, surge,
   cold-cathode stripping), run first when there is none. That sheet shows at once and needs no
   key. With an AI key the model writes the review from it: the findings in priority order, each
   with its part and number, and the value changes it suggests as Apply cards, checked against
   the parts like Fix the checks'. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadReview(cad) {
    const { S, circuitIssues, desig, fmtEng, measurements, netAC, netDC, partStress, powerTotals, runSim, runTransient, setStatus, topo, whenSimulated } = cad;
    const LIB = CadLib.LIB, esc = s => root.AiCircuit.esc(s);
    const RV = S.review = { busy: false, last: null };
    let ai = null;
    const refOf = c => desig(c) || c.label || c.id;
    const hasMains = () => S.comps.some(c => c.type === "mains" || c.type === "ptx" || c.type === "ptx_cat" || c.type === "iec");
    const sleep = ms => new Promise(res => setTimeout(res, ms));

    // ---- the sheet: what the CAD measured, nothing judged by the AI ----
    function gather() {
      const out = { margins: [], stress: [], checks: circuitIssues(), ripple: [], power: null, powerOn: null };
      measurements().forEach(m => { if (m.max > 0 && isFinite(m.v)) out.margins.push({ label: m.label, v: m.v, max: m.max, unit: m.unit, pct: 100 * Math.abs(m.v) / m.max }); });
      out.margins.sort((a, b) => b.pct - a.pct);
      S.comps.forEach(c => {
        if (!LIB[c.type] || c.type === "tube" || c.type === "frame" || c.type === "note") return;
        let st = null; try { st = partStress(c); } catch (e) { st = null; }
        if (st && st.text) out.stress.push({ ref: refOf(c), part: LIB[c.type].name, text: st.text, warn: !!st.warn, note: st.warn ? st.note || "" : "" });
      });
      // ripple: the AC on each node that carries a supply (a rail, a filter capacitor's + pin)
      const T = topo(), seen = new Set();
      S.comps.forEach(c => {
        const pin = c.type === "electrolytic" ? "+" : c.type === "rail" ? "1" : null; if (!pin) return;
        const n = T.pinNet.get(c.id + ":" + pin); if (!(n > 0) || seen.has(n)) return; seen.add(n);
        const dc = netDC(n), ac = netAC(n); if (dc === null || Math.abs(dc) < 5) return;
        out.ripple.push({ at: c.type === "rail" && c.params.name ? String(c.params.name) : `${refOf(c)}+`, dc, ac: ac ? ac.rms : 0 });
      });
      try { out.power = powerTotals(); } catch (e) { out.power = null; }
      const tr = S.trans;
      if (tr && tr.ok && !tr.stale && !tr.running) out.powerOn = { tStop: tr.tStop, warmup: tr.warmup, events: (tr.events || []).filter(e => e.level !== "info").map(e => ({ level: e.level, t: e.t, text: `${e.who ? e.who + ": " : ""}${e.text}` })) };
      return out;
    }
    const pctCls = p => (p > 100 ? "rv-bad" : p >= 85 ? "rv-warn" : "rv-ok");
    function sheetHTML(G) {
      const rows = [];
      G.margins.slice(0, 14).forEach(m => rows.push(`<tr><td>${esc(m.label)}</td><td class="mono">${esc(fmtEng(m.v, m.unit, 3))}</td><td class="mono">${esc(fmtEng(m.max, m.unit, 3))}</td><td class="mono ${pctCls(m.pct)}">${m.pct.toFixed(0)} %</td></tr>`));
      const margins = rows.length ? `<h4>Ratings</h4><table class="ai-fixes rv-table"><tr><th>Quantity</th><th>Simulated</th><th>Rating</th><th>Of rating</th></tr>${rows.join("")}</table>` : "";
      const warns = G.stress.filter(s => s.warn);
      const stress = warns.length ? `<h4>Parts over their ratings</h4><ul>${warns.map(s => `<li><a href="#" class="ai-ref" data-ref="${esc(s.ref)}">${esc(s.ref)}</a> ${esc(s.text)}${s.note ? `: <span class="rv-bad">${esc(s.note)}</span>` : ""}</li>`).join("")}</ul>` : "";
      const ripple = G.ripple.length ? `<h4>Supply ripple</h4><table class="ai-fixes rv-table"><tr><th>Node</th><th>DC</th><th>Ripple (rms)</th><th>Of DC</th></tr>${G.ripple.map(r => `<tr><td>${esc(r.at)}</td><td class="mono">${esc(fmtEng(r.dc, "V", 3))}</td><td class="mono">${r.ac ? esc(fmtEng(r.ac, "V", 3)) : "under 1 mV"}</td><td class="mono">${(100 * r.ac / Math.abs(r.dc)).toFixed(r.ac / Math.abs(r.dc) < 0.001 ? 3 : 2)} %</td></tr>`).join("")}</table>` : "";
      const po = G.powerOn ? `<h4>Power-on (${esc(fmtEng(G.powerOn.tStop, "s"))}${G.powerOn.warmup ? ", cathodes warming" : ""})</h4>` + (G.powerOn.events.length ? `<ul>${G.powerOn.events.map(e => `<li class="${e.level === "critical" ? "rv-bad" : "rv-warn"}">${esc(fmtEng(e.t, "s"))}: ${esc(e.text)}</li>`).join("")}</ul>` : "<p>No capacitor past its rating, no surge or cold-cathode warning.</p>") : "";
      const checks = `<h4>Checks</h4>` + (G.checks.length ? `<ul>${G.checks.map(i => `<li>${esc(i)}</li>`).join("")}</ul>` : "<p>No problems found.</p>");
      return `<h4>Design review · what the CAD measured</h4>${margins}${stress}${ripple}${po}${checks}`;
    }
    function sheetText(G) {
      const L = [];
      if (G.margins.length) { L.push("Margins to ratings (simulated / rating, % of rating), highest first:"); G.margins.slice(0, 30).forEach(m => L.push(`- ${m.label}: ${fmtEng(m.v, m.unit, 3)} / ${fmtEng(m.max, m.unit, 3)} (${m.pct.toFixed(0)} %)`)); }
      if (G.stress.length) { L.push("\nEach part's stress against its rating (the BOM's Stress column):"); G.stress.slice(0, 60).forEach(s => L.push(`- ${s.ref} ${s.part}: ${s.text}${s.warn ? ` — OVER: ${s.note}` : ""}`)); }
      if (G.ripple.length) { L.push("\nRipple on the supply nodes (DC, AC rms):"); G.ripple.forEach(r => L.push(`- ${r.at}: ${fmtEng(r.dc, "V", 3)}, ${r.ac ? fmtEng(r.ac, "V", 3) : "< 1 mV"}`)); }
      if (G.power) L.push(`\nPower: output ${fmtEng(G.power.out || 0, "W", 3)}, tubes ${fmtEng(G.power.tubes || 0, "W", 3)}, transistors ${fmtEng(G.power.semi || 0, "W", 3)}, resistors ${fmtEng(G.power.res || 0, "W", 3)}${G.power.haveSup ? `, from the DC supplies ${fmtEng(G.power.sup, "W", 3)}` : ""}.`);
      if (G.powerOn) { L.push(`\nPower-on run (${fmtEng(G.powerOn.tStop, "s")}, ${G.powerOn.warmup ? "cold cathodes warming" : "hot cathodes"}): ` + (G.powerOn.events.length ? "" : "no warnings.")); G.powerOn.events.forEach(e => L.push(`- ${e.level} at ${fmtEng(e.t, "s")}: ${e.text}`)); }
      else if (hasMains()) L.push("\nPower-on run: not run.");
      return L.join("\n");
    }

    const SYSTEM = "You are a senior amplifier design engineer reviewing a design before it is built (tube amplifiers, transistor amplifiers and their power supplies), the way a datasheet application engineer or a seasoned builder would. "
      + "You get the circuit with each part's editable values as key=value, its simulated operating point, and a sheet of what the CAD measured: margins to ratings, each part's stress against its rating, the Checks, ripple on the supply nodes, power totals and, for mains-powered circuits, a power-on run. "
      + "Review for: parts at or near their ratings (plate and screen dissipation, voltages, heater-to-cathode voltage, capacitor voltages including the surge at switch-on while the cathodes are cold, diode PIV, resistor power with margin, fuse sizing), hum and ripple, grounding and layout risks visible in the schematic, missing protection (bleeder resistors and the time to discharge B+, grid stoppers, screen resistors, fuses, a rectifier's surge limits), bias stability (fixed bias with too large a grid leak, thermal runaway in transistor output stages), stability (feedback, missing Zobel or output inductor), and which parts are likely to fail first. "
      + "Use the numbers you are given and say where each comes from (the simulation, the ratings). Do not repeat a finding. Prefer what matters for safety and reliability over style. "
      + 'Answer with JSON only, no prose around it: {"summary": "two or three sentences: the overall verdict", "findings": [{"level": "critical" | "warning" | "advice", "part": "R7 or empty", "title": "short", "detail": "one to three sentences with the number"}], "fixes": [{"part": "R7", "field": "r", "value": "1.5k", "why": "one sentence"}]}. '
      + "Order findings critical first. fixes: only value changes to existing parts using the keys listed for each part (a rating field such as a resistor's w or a capacitor's v is a valid fix); leave out what needs a new part or wire, and describe that in a finding instead.";

    async function review() {
      if (RV.busy || !ai) return;
      ai.show();
      if (!S.comps.some(c => LIB[c.type] && c.type !== "frame" && c.type !== "note")) { ai.add({ kind: "note", text: "The sheet is empty: there is nothing to review." }); return; }
      RV.busy = true;
      ai.add({ kind: "user", text: "Design review", prompt: "Review this design." });
      const note = ai.add({ kind: "note", text: "Simulating the circuit…" });
      try {
        if (!S.sim.result || S.sim.busy || S.sim.topo !== S.topo) { if (!S.sim.live) runSim("live"); await whenSimulated(); }
        if (!S.sim.result) { note.text = `There is no simulation to review: ${S.sim.error || "press ▶ Simulate"}.`; ai.render(); return; }
        // the power-on run of a mains-powered circuit, unless one for the circuit as it is exists
        if (hasMains() && !(S.trans && S.trans.ok && !S.trans.stale)) {
          note.text = "Running the power-on transient (cathodes warming from cold) for the switch-on surge…"; ai.render();
          runTransient("auto", true);
          const t0 = Date.now();
          while (S.trans && S.trans.running && Date.now() - t0 < 240000) { await sleep(400); note.text = `Running the power-on transient for the switch-on surge: ${Math.floor((S.trans.progress || 0) * 100)} %`; ai.render(); }
        }
        const G = RV.last = gather();
        const k = S.ai.log.indexOf(note); if (k >= 0) S.ai.log.splice(k, 1);
        ai.add({ kind: "card", html: sheetHTML(G) });
        setStatus(G.checks.length || G.stress.some(s => s.warn) ? "warn" : "ok", `Design review: ${G.margins.filter(m => m.pct >= 85).length} quantities at 85 % of a rating or more, ${G.checks.length} in the Checks`);
        if (!AiClient.ready(AiClient.load())) { ai.add({ kind: "note", text: "Add an AI key (AI settings…) and the AI also writes the review from this sheet: the findings in priority order, each with its part and number, and value changes you can apply." }); return; }
        const prompt = `The circuit, with each part's editable values as key=value:\n${ai.describe(true)}\n\nWhat the CAD measured:\n${sheetText(G)}\n\nReview this design.`;
        const text = await ai.call({ system: SYSTEM, messages: [{ role: "user", text: prompt }], maxTokens: 16000 }, "Design review");
        const j = AiClient.extractJson(text);
        const findings = (Array.isArray(j.findings) ? j.findings : []).map(f => ({ level: /^(critical|warning|advice)$/.test(f.level) ? f.level : "advice", part: String(f.part || ""), title: String(f.title || ""), detail: String(f.detail || "") }));
        const order = { critical: 0, warning: 1, advice: 2 };
        findings.sort((a, b) => order[a.level] - order[b.level]);
        ai.add({ kind: "card", html: findingsHTML(String(j.summary || ""), findings) });
        const fixes = (Array.isArray(j.fixes) ? j.fixes : []).map(f => Object.assign({ part: String(f.part || ""), field: String(f.field || ""), value: f.value, why: String(f.why || "") }, ai.check(f)));
        if (fixes.length) ai.add({ kind: "fixes", summary: "Value changes the review suggests: Apply simulates the circuit again and compares the Checks.", fixes, before: circuitIssues() });
        setStatus(findings.some(f => f.level === "critical") ? "warn" : "ok", `Design review: ${findings.filter(f => f.level === "critical").length} critical, ${findings.filter(f => f.level === "warning").length} warnings, ${findings.filter(f => f.level === "advice").length} advice`);
      } catch (e) { ai.fail(e); }
      finally { RV.busy = false; ai.render(); }
    }
    function findingsHTML(summary, findings) {
      const A = root.AiCircuit, refs = S.comps.map(refOf);
      const lv = { critical: "Critical", warning: "Warning", advice: "Advice" };
      const ref = p => (p && S.comps.some(c => refOf(c) === p || c.label === p) ? `<a href="#" class="ai-ref" data-ref="${esc(p)}">${esc(p)}</a>` : esc(p));
      return `<h4>Design review</h4>${summary ? A.markdown(summary, refs) : ""}`
        + (findings.length ? `<table class="ai-fixes rv-table"><tr><th></th><th>Part</th><th>Finding</th></tr>${findings.map(f => `<tr><td><span class="rv-chip rv-${f.level}">${lv[f.level]}</span></td><td>${ref(f.part)}</td><td><b>${esc(f.title)}</b><br>${A.markdown(f.detail, refs).replace(/^<p>|<\/p>$/g, "")}</td></tr>`).join("")}</table>` : "<p>No findings.</p>");
    }
    function init(aiApi) {
      ai = aiApi;
      const bind = (id, fn) => { const el = document.getElementById(id); if (el) el.addEventListener("click", fn); };
      bind("menu-ai-review", review); bind("btn-ai-review", review);
      ai.addAction({ id: "btn-ai-review" });
    }
    return { init, review, gather, sheetText };
  }
  root.CadReview = CadReview;
})(window);
