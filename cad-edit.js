/* AI ▾ → Edit by command…: a change to the circuit on the sheet said in words ("replace the 12AX7s with
   12AT7s and re-bias", "add a 100 kΩ grid stopper on VL2", "make the supply choke-input"), made in place.
   The AI answers with a list of edits against the circuit's designators and nets: set a value, delete a
   part, move a pin to another net, add parts with the nets of their pins. The CAD checks each edit and
   makes them on the sheet as one step to undo, keeping the drawing as it is: changed and added parts are
   selected (the diff), deleted parts take their dangling wires with them, and an added part's pins end in
   stubs to ground or a sheet connector named after its net, as Design from a description draws them. An
   existing net with no name gets a connector of its name at one of its pins. Then the circuit is
   simulated and the Checks compared. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadEdit(cad) {
    const { S, addSegment, circuitIssues, commit, compBBox, compPins, makeComp, render, runSim, selectParts, setStatus, topo, whenSimulated } = cad;
    const LIB = root.CadLib.LIB, A = root.AiCircuit;
    const E = S.edit = { busy: false };
    const $ = id => document.getElementById(id);
    const key = (x, y) => x + "," + y;
    const STUB = 20, GAP = 80;
    let ai = null;

    const SYSTEM = "You edit the circuit on the sheet of Tube Amp CAD, a tube and transistor amplifier CAD, as the user asks, changing as little as you can. "
      + "You get the circuit: each part's designator, its values as key=value and the net of each pin (GND is ground; other nets by their names, or N1, N2 … when unnamed). "
      + "Answer with JSON only:\n"
      + '{"summary": "what you changed and why, with the numbers you expect", "edits": ['
      + '{"op": "set", "part": "R10", "field": "r", "value": "1.2k"}, '
      + '{"op": "delete", "part": "C7"}, '
      + '{"op": "connect", "part": "R4", "pin": "2", "net": "N5"}, '
      + '{"op": "add", "ref": "R20", "type": "resistor", "values": {"r": "1k"}, "pins": {"1": "N3", "2": "G2"}}]}\n'
      + "Rules:\n"
      + "- set changes one value of a part (the keys listed with it; a tube's type is the field tube, a transistor's the field model).\n"
      + "- connect moves one pin of a part to another net (disconnecting it from its own).\n"
      + "- add puts a new part in: type and values as in the library below; pins maps EVERY pin id to a net: an existing net by its name, GND, or a new name for a new net (new nets join every pin that names them).\n"
      + "- To put a part in series (a grid stopper), move the pin it goes in front of to a new net with connect and add the part between the old net and the new one.\n"
      + "- Re-bias when a change moves the operating point: give the new cathode or bias resistor value as a set.\n"
      + "- Every tube and transistor must stay within its ratings; use parts from the library only. Do not touch parts the request does not need.\n";
    function system() {
      return SYSTEM + "\n# The part library (type: name. Pins. Values)\n" + A.catalogue({ skip: ["rail", "offsheet", "netlabel", "bus", "ground"] })
        + "\n\n# Tubes in the library (name, kind, max anode voltage, max anode dissipation)\n" + A.tubeList()
        + (root.AiSkill ? root.AiSkill.pack("edit", S.comps) : "");
    }

    // ---- the sheet's geometry: where a stub may go ----
    const onSeg = (w, x, y) => (w.x1 === w.x2 ? x === w.x1 && y >= Math.min(w.y1, w.y2) && y <= Math.max(w.y1, w.y2) : y === w.y1 && x >= Math.min(w.x1, w.x2) && x <= Math.max(w.x1, w.x2));
    function pinPoints() { const m = new Map(); S.comps.forEach(c => compPins(c).forEach(p => { const k = key(p.x, p.y); if (!m.has(k)) m.set(k, []); m.get(k).push({ c, p }); })); return m; }
    // a stub from (x, y) in direction (dx, dy): free when nothing but the start touches it
    function free(x, y, dx, dy, len, pins) {
      for (let s = 10; s <= len; s += 10) {
        const px = x + dx * s, py = y + dy * s;
        if (pins.has(key(px, py))) return false;
        if (S.wires.some(w => onSeg(w, px, py) && !(onSeg(w, x, y)))) return false;
      }
      return true;
    }
    // a pin's way out: away from its part's middle
    function outward(c, p) { const vx = p.x - c.x, vy = p.y - c.y; return Math.abs(vx) >= Math.abs(vy) && vx !== 0 ? [Math.sign(vx), 0] : [0, vy < 0 ? -1 : 1]; }
    // the end of a stub (ground hangs down; a connector points along the stub), added to the sheet
    function attach(px, py, dx, dy, net, added, len) {
      len = len === undefined ? STUB : len;
      const ex = px + dx * len, ey = py + dy * len;
      if (len) addSegment(px, py, ex, ey);
      if (net === "GND") {
        let gx = ex, gy = ey;
        if (dx || dy < 0) { addSegment(ex, ey, ex, ey + STUB); gy = ey + STUB; }
        added.push(put("ground", {}, gx, gy, 0));
      } else {
        const rot = dx > 0 ? 0 : dx < 0 ? 2 : dy > 0 ? 1 : 3;
        added.push(put("offsheet", { name: net }, ex, ey, rot));
      }
    }
    function put(type, params, x, y, rot, label) {
      const c = makeComp(type, params, x, y, rot);
      if (label !== undefined) c.label = label;
      S.comps.push(c); return c;
    }

    // ---- the nets by name ----
    function nets() {
      const T = topo(), names = ai.netNames(), byName = new Map(), named = new Set();
      names.forEach((n, id) => byName.set(String(n).toUpperCase(), id));
      S.comps.forEach(c => { if ((c.type === "offsheet" || c.type === "rail") && c.params.name) named.add(String(c.params.name).toUpperCase()); });
      return { T, names, byName, named };
    }
    // a net the new pins can join by a connector's name: an existing net without one gets a connector at a free pin
    function ensureName(net, N, added, log) {
      const u = String(net).toUpperCase();
      if (u === "GND" || N.named.has(u) || !N.byName.has(u)) return true;
      const id = N.byName.get(u), pins = pinPoints();
      const on = S.comps.filter(c => LIB[c.type] && !["ground", "offsheet", "rail", "netlabel", "frame", "note"].includes(c.type)).flatMap(c => compPins(c).filter(p => N.T.pinNet.get(c.id + ":" + p.id) === id).map(p => ({ c, p })));
      // a free stub from one of its pins: outward first, then the other ways, then longer
      const DIRS = [[1, 0], [-1, 0], [0, -1], [0, 1]];
      for (const len of [STUB, 2 * STUB, 3 * STUB]) for (const { c, p } of on) {
        const out = outward(c, p);
        for (const [dx, dy] of [out].concat(DIRS.filter(d => d[0] !== out[0] || d[1] !== out[1]))) {
          if (!free(p.x, p.y, dx, dy, len, pins)) continue;
          attach(p.x, p.y, dx, dy, net, added, len); N.named.add(u); log.push(`net ${net}: a connector of its name at ${ai.refOf(c)} pin ${p.id}`);
          return true;
        }
      }
      // no room anywhere: the connector sits on a pin itself (joined all the same)
      if (!on.length) return false;
      const { c, p } = on[0], [dx, dy] = outward(c, p);
      attach(p.x, p.y, dx, dy, net, added, 0); N.named.add(u); log.push(`net ${net}: a connector of its name on ${ai.refOf(c)} pin ${p.id}`);
      return true;
    }

    // ---- the edits ----
    function find(ref) { return S.comps.find(k => ai.refOf(k) === String(ref) || k.label === String(ref)); }
    // a deleted part's wires that lead nowhere now go too (and a ground or connector at their end)
    function prune(points) {
      const frontier = [...points];
      while (frontier.length) {
        const k = frontier.pop(), [x, y] = k.split(",").map(Number), pins = pinPoints();
        const at = S.wires.filter(w => key(w.x1, w.y1) === k || key(w.x2, w.y2) === k), here = pins.get(k) || [];
        const ends = here.filter(h => ["ground", "offsheet", "rail", "netlabel"].includes(h.c.type));
        if (at.length === 0 && ends.length && ends.length === here.length) { S.comps = S.comps.filter(c => !ends.some(h => h.c === c)); continue; }
        if (at.length !== 1 || here.length) continue;
        const w = at[0]; if (S.wires.some(o => o !== w && onSeg(o, x, y))) continue;
        S.wires = S.wires.filter(o => o !== w);
        frontier.push(key(w.x1, w.y1) === k ? key(w.x2, w.y2) : key(w.x1, w.y1));
      }
    }
    function remove(c) {
      const pts = compPins(c).map(p => key(p.x, p.y));
      S.comps = S.comps.filter(k => k !== c);
      prune(pts);
    }
    // a pin off its net: the one wire it ends, or the connector sitting on it
    function unhook(c, p) {
      const k = key(p.x, p.y), at = S.wires.filter(w => key(w.x1, w.y1) === k || key(w.x2, w.y2) === k), others = (pinPoints().get(k) || []).filter(h => h.c !== c);
      if (others.some(h => !["ground", "offsheet", "rail", "netlabel"].includes(h.c.type))) return "it touches another part's pin";
      if (at.length > 1) return "wires meet at it";
      if (S.wires.some(w => onSeg(w, p.x, p.y) && key(w.x1, w.y1) !== k && key(w.x2, w.y2) !== k)) return "a wire runs through it";
      others.forEach(h => { S.comps = S.comps.filter(x => x !== h.c); });
      if (at.length) { const w = at[0]; S.wires = S.wires.filter(o => o !== w); prune([key(w.x1, w.y1) === k ? key(w.x2, w.y2) : key(w.x1, w.y1)]); }
      return null;
    }

    // the answer's edits, checked; then made on the sheet: { done: [text], skipped: [text], touched: [id] }
    function make(j) {
      const list = Array.isArray(j && j.edits) ? j.edits : [], done = [], skipped = [], touched = new Set(), log = [];
      const N = nets(), order = { delete: 0, set: 1, connect: 2, add: 3 };
      const sorted = list.map((e, i) => ({ e, i })).sort((a, b) => (order[a.e.op] ?? 9) - (order[b.e.op] ?? 9) || a.i - b.i).map(x => x.e);
      const adds = [];
      sorted.forEach(e => {
        const op = String(e.op || "");
        if (op === "set") {
          const f = ai.check({ part: e.part, field: e.field, value: e.value });
          if (f.error) { skipped.push(`${e.part} ${e.field} → ${e.value}: ${f.error}`); return; }
          const c = S.comps.find(x => x.id === f.id), r = A.setValue(c, String(e.field), e.value);
          if (!r.ok) { skipped.push(`${e.part}: ${r.error}`); return; }
          done.push(`${e.part} ${f.label.toLowerCase()} ${f.from} → ${f.to}`); touched.add(c.id);
        } else if (op === "delete") {
          const c = find(e.part); if (!c || !LIB[c.type]) { skipped.push(`delete ${e.part}: there is no such part`); return; }
          remove(c); done.push(`${e.part} deleted`);
        } else if (op === "connect") {
          const c = find(e.part); if (!c) { skipped.push(`connect ${e.part}: there is no such part`); return; }
          const p = compPins(c).find(q => String(q.id) === String(e.pin)); if (!p) { skipped.push(`${e.part} has no pin ${e.pin} (its pins: ${compPins(c).map(q => q.id).join(" ")})`); return; }
          const net = root.AiDesign.isGnd(e.net) ? "GND" : String(e.net || "").trim();
          if (!net) { skipped.push(`connect ${e.part} pin ${e.pin}: no net`); return; }
          const why = unhook(c, p); if (why) { skipped.push(`${e.part} pin ${e.pin} not moved: ${why}`); return; }
          const added = [];
          if (!ensureName(net, N, added, log)) { skipped.push(`${e.part} pin ${e.pin} not moved: no free place for a connector on ${net}`); return; }
          const [dx, dy] = outward(c, p);
          attach(p.x, p.y, dx, dy, net, added);
          done.push(`${e.part} pin ${e.pin} → ${net}`); touched.add(c.id);
        } else if (op === "add") adds.push(e);
        else skipped.push(`an edit the CAD does not know: ${JSON.stringify(e).slice(0, 80)}`);
      });
      if (adds.length) {
        const checked = root.AiDesign.check({ parts: adds.map(e => ({ ref: e.ref, type: e.type, values: e.values, pins: e.pins })) });
        checked.problems.forEach(p => skipped.push(p));
        const ok = checked.parts.filter(p => Object.keys(p.pins).length);
        // the nets they join: an existing one needs a connector of its name
        const want = new Set(); ok.forEach(p => Object.values(p.pins).forEach(n => want.add(n)));
        const added = [];
        const bad = [...want].filter(n => !ensureName(n, N, added, log));
        bad.forEach(n => skipped.push(`net ${n}: no free place for a connector, so its new pins end in a connector of their own`));
        if (ok.length) {
          const out = root.AiDesign.layout({ parts: ok, rails: new Map() });
          const xs = out.comps.map(o => o.x).concat(out.wires.flatMap(w => [w.x1, w.x2])), ys = out.comps.map(o => o.y).concat(out.wires.flatMap(w => [w.y1, w.y2]));
          const [ox, oy] = room(Math.min(...xs) - 60, Math.min(...ys) - 30, Math.max(...xs) + 60, Math.max(...ys) + 30);
          const labels = new Set(S.comps.map(c => c.label));
          out.comps.forEach(o => {
            const c = put(o.type, o.params, o.x + ox, o.y + oy, o.rot, o.label && !labels.has(o.label) ? o.label : undefined);
            c.params = Object.assign({}, LIB[o.type].defaults, o.params);
            if (LIB[o.type] && !["ground", "offsheet", "rail"].includes(o.type)) { touched.add(c.id); done.push(`${c.label || o.label} ${LIB[o.type].name} added: ${Object.entries(ok.find(p => p.ref === o.label).pins).map(([k, n]) => `${k}=${n}`).join(" ")}`); }
          });
          out.wires.forEach(w => addSegment(w.x1 + ox, w.y1 + oy, w.x2 + ox, w.y2 + oy));
        }
      }
      return { done, skipped, touched: [...touched], log };
    }

    // where the new parts go: the first empty place on the sheet's frame (clear of the parts, the wires and
    // the title block), scanning from the top left; else to the right of the drawing, level with its top.
    // (x1, y1, x2, y2): the block as laid out, with room for the connectors' names; returns the shift
    function room(x1, y1, x2, y2) {
      const snap = v => Math.round(v / 10) * 10, w = x2 - x1, h = y2 - y1;
      const boxes = S.comps.filter(c => c.type !== "frame" && LIB[c.type]).map(c => compBBox(c))
        .concat(S.wires.map(q => ({ x1: Math.min(q.x1, q.x2), y1: Math.min(q.y1, q.y2), x2: Math.max(q.x1, q.x2), y2: Math.max(q.y1, q.y2) })));
      const f = S.comps.find(c => c.type === "frame");
      if (f) {
        const g = root.CadLib.sheetGeom(f);
        boxes.push({ x1: f.x + g.tb.x1, y1: f.y + g.tb.y1, x2: f.x + g.tb.x2, y2: f.y + g.tb.y2 });
        const ax1 = f.x + g.fx1 + 20, ay1 = f.y + g.fy1 + 20, ax2 = f.x + g.fx2 - 20, ay2 = f.y + g.fy2 - 20;
        const hit = (bx, by) => boxes.some(b => b.x1 - 10 < bx + w && b.x2 + 10 > bx && b.y1 - 10 < by + h && b.y2 + 10 > by);
        for (let by = snap(ay1); by + h <= ay2; by += 20) for (let bx = snap(ax1); bx + w <= ax2; bx += 20) if (!hit(bx, by)) return [snap(bx - x1), snap(by - y1)];
      }
      const bb = boxes.reduce((b, q) => ({ x2: Math.max(b.x2, q.x2), y1: Math.min(b.y1, q.y1) }), { x2: -Infinity, y1: Infinity });
      return isFinite(bb.x2) ? [snap(bb.x2 + GAP - x1), snap(bb.y1 - y1)] : [0, 0];
    }

    async function run(text) {
      text = String(text || "").trim();
      if (!text || E.busy || !ai) return;
      ai.show();
      if (!S.comps.some(c => LIB[c.type] && c.type !== "frame" && c.type !== "note")) { ai.add({ kind: "note", text: "The sheet is empty: Design from a description draws a new circuit." }); ai.render(); return; }
      if (!(root.AiClient && root.AiClient.ready(root.AiClient.load()))) { ai.add({ kind: "note", text: "Edit by command needs an AI key: add one in AI settings…" }); ai.render(); setStatus("warn", "Edit by command needs an AI key"); return; }
      E.busy = true;
      ai.add({ kind: "user", text: `Edit: ${text}`, prompt: `Edit: ${text}` });
      try {
        const before = circuitIssues();
        const answer = await ai.call({ system: system(), messages: [{ role: "user", text: `The circuit on the sheet now:\n${ai.describe(true)}\n\nThe change: ${text}` }], maxTokens: 16000 }, "Edit", true);
        const j = root.AiClient.extractJson(answer);
        if (!j || !Array.isArray(j.edits)) throw new Error("The answer has no list of edits.");
        const r = make(j);
        if (!r.done.length) { ai.add({ kind: "answer", text: `${j.summary || ""}\n\nNothing was changed: ${r.skipped.join("; ") || "no edits"}.` }); setStatus("warn", "Edit: nothing changed"); return; }
        commit(); render();
        selectParts(r.touched);
        if (!S.sim.live) runSim("live");
        await whenSimulated();
        const after = circuitIssues();
        ai.add({ kind: "answer", text: `${j.summary || ""}\n\n**Changed** (selected on the sheet):\n${r.done.map(t => "- " + t).join("\n")}`
          + (r.skipped.length ? `\n\n**Left out:**\n${r.skipped.map(t => "- " + t).join("\n")}` : "")
          + (r.log.length ? `\n\n${r.log.map(t => "- " + t).join("\n")}` : "")
          + `\n\nSimulated: the Checks list ${after.length} problem${after.length === 1 ? "" : "s"} (${before.length} before). Ctrl+Z takes the whole edit back.` });
        setStatus(r.skipped.length ? "warn" : "ok", `Edit: ${r.done.length} change${r.done.length === 1 ? "" : "s"} made${r.skipped.length ? `, ${r.skipped.length} left out` : ""}. Ctrl+Z takes it back.`);
      } catch (e) { ai.fail(e); }
      finally { E.busy = false; ai.render(); }
    }

    const EXAMPLES = ["Replace the 12AX7s with 12AT7s and re-bias them", "Add a 1 kΩ grid stopper in front of each output tube's grid", "Bypass the first stage's cathode resistor with 22 µF", "Lower the gain of the input stage by about 6 dB"];
    function open() {
      const m = $("edit-modal"); if (!m) return;
      m.hidden = false;
      $("edit-chips").innerHTML = EXAMPLES.map(t => `<button class="btn ai-chip" type="button">${A.esc(t)}</button>`).join("");
      setTimeout(() => $("edit-text").focus(), 0);
    }
    function go() {
      const t = $("edit-text").value; if (!t.trim()) { $("edit-text").focus(); return; }
      $("edit-modal").hidden = true;
      run(t);
    }
    function init(aiApi) {
      ai = aiApi;
      const bind = (id, fn) => { const el = $(id); if (el) el.addEventListener("click", fn); };
      bind("menu-ai-edit", open); bind("btn-ai-edit", open);
      bind("btn-edit-go", go); bind("btn-edit-cancel", () => { $("edit-modal").hidden = true; });
      const chips = $("edit-chips"); if (chips) chips.addEventListener("click", e => { const b = e.target.closest(".ai-chip"); if (b) { $("edit-text").value = b.textContent; $("edit-text").focus(); } });
      const m = $("edit-modal"); if (m) m.addEventListener("keydown", e => { if (e.key === "Escape") m.hidden = true; else if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) go(); });
    }
    return { init, open, run, make };
  }
  root.CadEdit = CadEdit;
})(window);
