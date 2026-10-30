/* The design assistant's drawing (no DOM, Node-testable): a circuit the model describes as a
   netlist (parts with values, and the net each pin is on) turned into a schematic the CAD can
   simulate. Connectivity never depends on wires crossing the right way: every pin gets a short
   stub ending in a ground symbol, a power-rail symbol (a supply net) or a sheet connector named
   after its net (every other net), and connectors of one name are one net. Parts stand in
   columns in signal order: the generator first, then each part one net further along. */
(function (root) {
  "use strict";
  const L = () => root.CadLib;
  const GRID = 10, STUB = 20;
  const isGnd = n => /^(gnd|ground|0|0v|com)$/i.test(String(n).trim());

  // design: { parts: [{ ref, type, values: { key: value }, pins: { pinId: net } }], rails?: { net: volts } }
  // → { parts: [{ ref, type, params, pins: { id: net } }], rails: Map(net → volts), problems: [text] }
  function check(design) {
    const LIB = L().LIB, problems = [], parts = [], rails = new Map(), A = root.AiCircuit;
    const list = Array.isArray(design && design.parts) ? design.parts : [];
    const refs = new Set();
    list.forEach((p, k) => {
      const type = String(p.type || "").trim(), ref = String(p.ref || p.label || `X${k + 1}`).trim();
      const def = LIB[type];
      if (!def || type === "frame" || type === "note") { problems.push(`${ref}: no part type "${type}" in the library`); return; }
      const pins = Object.assign({}, p.pins || {});
      // a supply rail: a source named after its net, drawn wherever the net is used
      if (type === "rail" || type === "offsheet" || type === "ground") {
        const net = String(Object.values(pins)[0] || (p.values && p.values.name) || "").trim();
        if (type === "rail") { const v = L().parseEng(String((p.values || {}).v)); if (net && isFinite(v)) rails.set(net, v); else problems.push(`${ref}: a power rail needs a net and a voltage`); }
        return;
      }
      if (refs.has(ref)) { problems.push(`${ref} is used twice: the second one is left out`); return; }
      refs.add(ref);
      const c = { type, params: Object.assign({}, def.defaults, def.newDefaults || {}) };
      if (type === "tube") c.params.connection = "triode";
      Object.entries(p.values || {}).forEach(([key, val]) => {
        if (key === "connection") { c.params.connection = String(val) === "pentode" ? "pentode" : "triode"; return; }
        const r = A.setValue(c, key, val);
        if (!r.ok) problems.push(`${ref}: ${r.error}`);
      });
      // a pentode's own connection follows its tube unless the model asked for triode
      if (type === "tube" && (p.values || {}).connection === undefined) c.params.connection = L().tubeKind(L().tubeByName(c.params.tube)) === "pentode" ? "pentode" : "triode";
      const ids = (typeof def.pins === "function" ? def.pins(c) : def.pins).map(q => q.id);
      // a pentode's control grid is G1, a triode's G: either name is taken for the other
      if (type === "tube" && ids.includes("G1") && pins.G !== undefined && pins.G1 === undefined) { pins.G1 = pins.G; delete pins.G; }
      if (type === "tube" && ids.includes("G") && pins.G1 !== undefined && pins.G === undefined) { pins.G = pins.G1; delete pins.G1; }
      Object.keys(pins).forEach(id => { if (!ids.includes(id)) { problems.push(`${ref} has no pin ${id} (its pins: ${ids.join(" ")})`); delete pins[id]; } });
      ids.forEach(id => { if (pins[id] === undefined || pins[id] === null || String(pins[id]).trim() === "") { if (!(type === "opamp" && (id === "1" || id === "8")) && type !== "scope") problems.push(`${ref} pin ${id} is not connected`); delete pins[id]; } else pins[id] = isGnd(pins[id]) ? "GND" : String(pins[id]).trim(); });
      parts.push({ ref, type, params: c.params, pins });
    });
    Object.entries((design && design.rails) || {}).forEach(([net, v]) => { const x = L().parseEng(String(v)); if (isFinite(x)) rails.set(String(net), x); });
    return { parts, rails, problems };
  }

  // the schematic: { comps: [{ type, params, x, y, rot, label }], wires: [{ x1, y1, x2, y2 }], frame: { size, orient } }
  function layout(checked, opts) {
    opts = opts || {};
    const LIB = L().LIB, { parts, rails } = checked;
    const pinsOf = p => (typeof LIB[p.type].pins === "function" ? LIB[p.type].pins({ type: p.type, params: p.params }) : LIB[p.type].pins);
    const bboxOf = p => { const b = LIB[p.type].bbox; return typeof b === "function" ? b({ type: p.type, params: p.params }) : b; };
    // signal order: from each source a part at a time along nets that are not ground or a supply
    const users = new Map();
    parts.forEach((p, i) => Object.values(p.pins).forEach(n => { if (!users.has(n)) users.set(n, new Set()); users.get(n).add(i); }));
    const supply = n => n === "GND" || rails.has(n) || users.get(n).size > 8;
    const depth = parts.map(() => -1), queue = [];
    parts.forEach((p, i) => { if (/^(siggen|pickup|phono)$/.test(p.type)) { depth[i] = 0; queue.push(i); } });
    if (!queue.length && parts.length) { depth[0] = 0; queue.push(0); }
    while (queue.length) {
      const i = queue.shift();
      Object.values(parts[i].pins).forEach(n => { if (supply(n)) return; users.get(n).forEach(j => { if (depth[j] < 0) { depth[j] = depth[i] + 1; queue.push(j); } }); });
    }
    // parts not reached (a power supply, a bias network on supply nets only): columns of their own after the rest
    const maxD = Math.max(0, ...depth);
    let extra = maxD + 1, inExtra = 0;
    parts.forEach((p, i) => { if (depth[i] < 0) { depth[i] = extra; if (++inExtra % 5 === 0) extra++; } });
    const cols = [];
    parts.forEach((p, i) => { (cols[depth[i]] = cols[depth[i]] || []).push(i); });
    // room for each column: the widest part plus its stubs and connector names
    const nameW = n => 34 + 7 * String(n).length;
    const out = { comps: [], wires: [] };
    let x = 0, colX = [], maxH = 0;
    const colW = cols.map(list => (list || []).reduce((w, i) => { const b = bboxOf(parts[i]), names = Object.values(parts[i].pins).map(nameW); return Math.max(w, (b[2] - b[0]) + 2 * (STUB + Math.max(0, ...names))); }, 120));
    cols.forEach((list, d) => { colX[d] = x + colW[d] / 2; x += colW[d] + 40; });
    const snap = v => Math.round(v / GRID) * GRID;
    const place = [];
    cols.forEach((list, d) => {
      let y = 0;
      (list || []).forEach(i => {
        const p = parts[i], b = bboxOf(p), top = y + STUB + 40 - b[1];
        place[i] = { x: snap(colX[d]), y: snap(top) };
        y = top + b[3] + STUB + 50;
      });
      maxH = Math.max(maxH, y);
    });
    // the sheet: the smallest frame the drawing fits in, landscape
    const g = L().sheetGeom, sizes = ["A3", "A2", "A1", "A0"];
    let size = sizes[sizes.length - 1], geo = null;
    for (const s of sizes) { const G = g({ params: { size: s, orient: "landscape" } }); if (x + 80 <= G.fx2 - G.fx1 && maxH + 80 <= G.tb.y1 - G.fy1) { size = s; geo = G; break; } }
    geo = geo || g({ params: { size, orient: "landscape" } });
    const ox = snap(geo.fx1 + 40), oy = snap(geo.fy1 + 40);
    parts.forEach((p, i) => {
      const at = place[i], cx = at.x + ox, cy = at.y + oy;
      out.comps.push({ type: p.type, params: p.params, x: cx, y: cy, rot: 0, label: p.ref });
      pinsOf(p).forEach(q => {
        const net = p.pins[q.id]; if (net === undefined) return;
        // the stub leaves the pin away from the part's middle
        const hor = Math.abs(q.x) >= Math.abs(q.y) && q.x !== 0, dx = hor ? Math.sign(q.x) : 0, dy = hor ? 0 : (q.y < 0 ? -1 : 1);
        const px = cx + q.x, py = cy + q.y, ex = px + dx * STUB, ey = py + dy * STUB;
        out.wires.push({ x1: px, y1: py, x2: ex, y2: ey });
        const dir = dx > 0 ? "r" : dx < 0 ? "l" : dy < 0 ? "u" : "d";
        // ground hangs down and a rail stands up, as drawn by hand: a sideways stub turns the corner
        const corner = (sy, cb) => { if (dx) { out.wires.push({ x1: ex, y1: ey, x2: ex, y2: ey + sy * STUB }); cb(ex, ey + sy * STUB, 0); } else cb(ex, ey, dir === (sy > 0 ? "d" : "u") ? 0 : 2); };
        if (net === "GND") corner(1, (gx, gy, rot) => out.comps.push({ type: "ground", params: {}, x: gx, y: gy, rot }));
        else if (rails.has(net)) corner(-1, (gx, gy, rot) => out.comps.push({ type: "rail", params: { name: net, v: rails.get(net), shown: "" }, x: gx, y: gy, rot }));
        else out.comps.push({ type: "offsheet", params: { name: net }, x: ex, y: ey, rot: { r: 0, d: 1, l: 2, u: 3 }[dir] });
      });
    });
    out.frame = { size, orient: "landscape", title: String(opts.title || "").slice(0, 80) };
    return out;
  }

  // the prompt's rules for a design, with the library: what the model must answer
  function rules() {
    return "Answer with JSON only, no prose around it:\n"
      + '{"title": "short title", "summary": "what you designed and the key numbers you expect (B+, bias, gain, power)", '
      + '"parts": [{"ref": "R1", "type": "resistor", "values": {"r": "100k", "w": "0.5"}, "pins": {"1": "IN", "2": "GND"}}], '
      + '"rails": {"B+": 300}}\n'
      + "Rules:\n"
      + "- type is one of the library's part types below; values use only that type's value keys, with SI prefixes (100k, 47u, 2.2M) or one of the listed options; a tube's values are {\"tube\": \"EL84\"} plus \"connection\": \"triode\" for a pentode wired as a triode.\n"
      + "- pins maps EVERY pin id of the part to a net name. Pins on the same net are connected. GND is ground. Use short net names (IN, G1, A1, K1, OUT, B+, B2).\n"
      + "- A DC supply is a net listed in rails with its voltage (an ideal source to ground, e.g. \"B+\": 300); use rails for every supply voltage instead of drawing a mains supply unless a supply is asked for.\n"
      + "- Put a signal generator (siggen) at the input with its + pin on the input net and - on GND, at a realistic level (amp is the peak in volts), and the load at the output (a speaker for a power amplifier, a resistor or the next stage's grid resistor for a preamp). Add an oscilloscope (scope, pins CH1 CH2 COM) with CH1 on the input, CH2 on the output and COM on GND.\n"
      + "- One tube part is one tube section: a 12AX7 with both triodes used is two parts (refs VL1.1 and VL1.2). Heaters are not drawn.\n"
      + "- Every tube and transistor must stay within its ratings; use parts from the library only (the tube list below).\n"
      + "- Prefer proven textbook topologies and standard values (E12/E24).";
  }

  root.AiDesign = { check, layout, rules, isGnd };
})(typeof window !== "undefined" ? window : globalThis);
