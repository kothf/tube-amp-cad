/* AI ▾ → Build and power-up guide: the first switch-on of the amplifier as built, planned from the
   simulation. With no key: the voltage to expect at every test point (each tube's and transistor's
   pins, the supply nodes) with a band to accept, the heater load, the power drawn from the mains, the
   charge left in the filter capacitors and how long the bleeders take, and the steps of a safe first
   power-up (current-limited, heaters first, then B+, then signal into a dummy load); a printable
   sheet to take to the bench. With a key, the AI writes the build notes for this circuit: the order
   to build and test it in, its layout (grounding, heater wiring, lead dress) and what to watch for.
   Readings that differ go to Find a fault (cad-faults.js). */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadBuild(cad) {
    const { S, compPins, desig, faults, fmtEng, powerTotals, runSim, setStatus, topo, tubeByName, whenSimulated } = cad;
    // what a DC voltmeter reads on a net at idle (the cycle's average)
    const netDC = n => { const v = root.Faults.meter(S.sim.result, n); return isFinite(v) ? v : null; };
    const B = S.build = { busy: false, sheets: [] };
    const esc = s => root.AiCircuit.esc(s);
    let ai = null;
    const MAINS = ["mains", "ptx", "ptx_cat", "iec"];

    // what to expect: the test points with their bands, the heaters, the power, the stored charge
    function gather() {
      const T = topo(), pts = faults.points().map(p => {
        const v = netDC(p.net); if (v === null || !isFinite(v)) return null;
        // tubes and parts spread: ±10 % and half a volt (a rail or supply node ±5 %)
        const k = p.rank === 0 ? 0.1 : 0.05, d = Math.abs(v) * k + 0.5;
        return { label: p.label, v, lo: v - d, hi: v + d };
      }).filter(Boolean);
      const tubes = S.comps.filter(c => c.type === "tube"), seen = new Set(), heaters = [];
      tubes.forEach(c => {
        const t = tubeByName(c.params.tube); if (!t) return;
        // a dual triode's two sections share one envelope: its heater once
        const env = String(c.label || c.id).replace(/\.\d+$/, "") + "|" + t.commonName; if (seen.has(env)) return; seen.add(env);
        if (t.vh && t.ih) heaters.push({ ref: String(desig(c)).replace(/\.\d+$/, ""), tube: t.commonName, vh: +t.vh, ih: +t.ih });
      });
      const hv = {}; heaters.forEach(h => { hv[h.vh] = (hv[h.vh] || 0) + h.ih; });
      let pw = null; try { pw = powerTotals(); } catch (e) { pw = null; }
      const heat = heaters.reduce((s, h) => s + h.vh * h.ih, 0);
      const dissip = pw ? pw.tubes + pw.res + pw.semi + pw.ics + pw.out : 0, total = (dissip + heat) / 0.85;
      // filter capacitors on high voltage: their charge, and the slowest way to ground through resistors
      const caps = S.comps.filter(c => c.type === "electrolytic" || c.type === "capacitor").map(c => {
        const ps = compPins(c).map(p => T.pinNet.get(c.id + ":" + p.id)), vs = ps.map(n => (n > 0 ? netDC(n) || 0 : 0)), v = Math.max(...vs.map(Math.abs));
        return { c, v, nets: ps, cap: +c.params.c || 0 };
      }).filter(x => x.v >= 50 && x.cap >= 1e-6);
      const bleed = caps.map(x => {
        const n = x.nets.find(q => q > 0 && Math.abs(netDC(q) || 0) === x.v);
        // a resistor from that node straight to ground: a bleeder
        const r = S.comps.filter(c => c.type === "resistor").find(c => { const ns = compPins(c).map(p => T.pinNet.get(c.id + ":" + p.id)); return ns.includes(n) && ns.includes(0); });
        const tau = r ? +r.params.r * x.cap : null;
        return { ref: desig(x.c), v: x.v, cap: x.cap, energy: 0.5 * x.cap * x.v * x.v, bleeder: r ? desig(r) : null, t: tau ? tau * Math.log(x.v / 30) : null };
      });
      const mains = S.comps.some(c => MAINS.includes(c.type));
      return { pts, heaters, hv, heat, pw, total, bleed, mains, out: pw ? pw.out : 0 };
    }

    function sheetHTML(G) {
      const steps = [];
      if (G.mains) steps.push(`Before the first switch-on, with the plug out: check the mains wiring, the fuse (${G.total > 0 ? `about ${fmtEng(Math.max(0.5, G.total / 230 * 2), "A")} slow-blow at 230 V, from the ${fmtEng(G.total, "W")} it should draw` : "slow-blow, sized to the transformer"}) and the earth to the chassis; measure the resistance of each winding and from B+ to ground (it should read the bleeders, not a short).`);
      steps.push(G.mains ? `Power up through a current limiter: a dim-bulb tester (a ${G.total > 60 ? "100" : "60"} W incandescent lamp in series with the mains) or a variac brought up slowly. A lamp that stays bright means a short: switch off.` : "Power up from a current-limited bench supply, the limit a little above the current the simulation draws.");
      if (G.heaters.length) steps.push(`Heaters first, with the rectifier and output tubes out if you can: ${Object.entries(G.hv).map(([v, i]) => `${fmtEng(+v, "V")} at ${fmtEng(i, "A")}`).join(", ")} in all. Every heater should glow; measure the heater voltage at a socket.`);
      steps.push("Then the high voltage, with the tubes in: measure the test points below with the black lead on ground, one hand in your pocket. A reading outside its band: switch off, discharge, and type the readings into Find a fault.");
      if (G.out > 0) steps.push(`Last, signal into a dummy load of the speaker's impedance (never into an open output on a tube amplifier): at the generator's level the simulation gives ${fmtEng(G.out, "W")}. Watch the anodes for red plating and the parts for heat.`);
      const fv = (v, d) => (Math.abs(v) < 5e-3 ? "0 V" : fmtEng(v, "V", d));
      const pts = G.pts.map(p => `<tr><td>${esc(p.label)}</td><td class="mono">${esc(fv(p.v, 3))}</td><td class="mono">${esc(fv(p.lo, 1))} … ${esc(fv(p.hi, 1))}</td><td class="bg-blank"></td></tr>`).join("");
      const bl = G.bleed.map(b => `<tr><td>${esc(b.ref)}</td><td class="mono">${esc(fmtEng(b.cap, "F"))} at ${esc(fmtEng(b.v, "V"))}</td><td class="mono">${esc(fmtEng(b.energy, "J", 2))}</td><td>${b.bleeder ? `${esc(b.bleeder)}: below 30 V after ${esc(fmtEng(b.t, "s", 2))}` : `<span class="warn">no bleeder: discharge it by hand (a resistor on insulated leads)</span>`}</td></tr>`).join("");
      return `<h4>Build and first power-up · from the simulation</h4>`
        + `<p class="warn"><b>Lethal voltages.</b> The filter capacitors hold their charge after switch-off. Work with one hand, measure before you touch, and discharge before you solder.</p>`
        + `<ol class="bg-steps">${steps.map(t => `<li>${esc(t)}</li>`).join("")}</ol>`
        + (pts ? `<h4>Test points (DC, at idle, no signal)</h4><table class="ai-fixes bg-table"><tr><th>Where</th><th>Simulated</th><th>Accept</th><th>Measured</th></tr>${pts}</table>` : "<p>No test points: simulate the circuit first.</p>")
        + (bl ? `<h4>Stored charge</h4><table class="ai-fixes bg-table"><tr><th>Capacitor</th><th>Charged to</th><th>Energy</th><th>Discharge</th></tr>${bl}</table>` : "")
        + (G.total > 0 ? `<p class="muted">Power from the supply: about ${esc(fmtEng(G.total, "W"))} (${esc(fmtEng(G.heat, "W"))} of it heaters), at idle with the generator as set.</p>` : "");
    }

    const SYSTEM = "You are an experienced builder of tube and transistor amplifiers writing the build notes for the circuit on the sheet of Tube Amp CAD, for someone about to build it. "
      + "You get the circuit and the CAD's power-up sheet (simulated test-point voltages, heaters, stored charge). Write, in Markdown, short and specific to this circuit: "
      + "1) the order to build and test it in (power supply first, tested on its own with dummy loads, then stage by stage), 2) layout: where the grounds meet (star or bus), heater wiring (twisted, away from grids, elevated or referenced if it helps here), lead dress around high-gain stages, which parts get hot and need space, 3) what is most likely to go wrong in this circuit at the first power-up and how it shows on the test points, 4) safety points this circuit has (its highest voltage, the stored energy, a missing bleeder or fuse). "
      + "Name parts by their designators and use the sheet's numbers. No generic filler.";

    async function guide() {
      if (B.busy || !ai) return;
      B.busy = true;
      ai.show();
      try {
        if (!S.sim.result || S.sim.topo !== S.topo) { setStatus("busy", "Build guide: simulating the circuit…"); runSim("live"); await whenSimulated(); }
        const G = gather(), k = B.sheets.push(G) - 1;
        ai.add({ kind: "user", text: "Build and first power-up guide", prompt: "Build guide" });
        ai.add({ kind: "card", html: sheetHTML(G) + `<div class="ai-row"><button class="btn" data-act="bg-print" data-arg="${k}">Print the sheet</button></div>` });
        if (root.AiClient && root.AiClient.ready(root.AiClient.load())) {
          const sheet = (G.pts.map(p => `${p.label}: ${fmtEng(p.v, "V", 3)}`).join("; ")) + `\nHeaters: ${G.heaters.map(h => `${h.ref} ${h.tube} ${h.vh} V ${h.ih} A`).join(", ") || "none"}\nStored charge: ${G.bleed.map(b => `${b.ref} ${fmtEng(b.cap, "F")} at ${fmtEng(b.v, "V")}, bleeder ${b.bleeder || "none"}`).join("; ") || "none above 50 V"}\nPower from the supply ≈ ${fmtEng(G.total, "W")}`;
          const text = await ai.call({ system: SYSTEM, messages: [{ role: "user", text: `The circuit:\n${ai.describe(false)}\n\nThe power-up sheet:\n${sheet}` }], maxTokens: 4000 }, "Build guide", true);
          ai.add({ kind: "answer", text });
        } else ai.add({ kind: "note", text: "Add an AI key (AI settings…) and the AI also writes the build notes for this circuit: the order to build and test it in, its layout, and what to watch for at the first switch-on." });
        setStatus("ok", `Build guide: ${G.pts.length} test points with the voltages to expect. Print the sheet for the bench.`);
      } catch (e) { ai.fail(e); }
      finally { B.busy = false; ai.render(); }
    }
    // the sheet on its own page, to print: light colours, a column to write the readings in
    function print(k) {
      const G = B.sheets[+k]; if (!G) return;
      const w = root.open("", "_blank"); if (!w) { setStatus("warn", "The browser blocked the print window: allow pop-ups for this page."); return; }
      const frame = S.comps.find(c => c.type === "frame"), title = frame && frame.params.title ? frame.params.title : "Amplifier";
      w.document.write(`<!doctype html><meta charset="utf-8"><title>${esc(title)}: power-up sheet</title><style>body{font:12px/1.4 system-ui,sans-serif;margin:16mm;color:#000}table{border-collapse:collapse;width:100%;margin:6px 0 12px}td,th{border:1px solid #888;padding:3px 6px;text-align:left}.bg-blank{width:28mm}.mono{font-family:ui-monospace,monospace}.warn{color:#a00}h4{margin:14px 0 4px}button{display:none}</style><h3>${esc(title)}: build and first power-up</h3>${sheetHTML(G)}`);
      w.document.close(); w.focus(); w.print();
    }
    function init(aiApi) {
      ai = aiApi;
      ["menu-ai-build", "btn-ai-build"].forEach(id => { const el = document.getElementById(id); if (el) el.addEventListener("click", guide); });
      ai.cardAction("bg-print", print);
    }
    return { init, guide, gather };
  }
  root.CadBuild = CadBuild;
})(window);
