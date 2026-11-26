/* The design assistant's drawing (no DOM, Node-testable): a circuit the model describes as a
   netlist (parts with values, the net each pin is on, the block each part belongs to) turned
   into a schematic the CAD can simulate, drawn as a person draws one (sch-layout.js): parts in
   signal order joined by real wires, supplies as rail symbols, one ground line, labels only
   where a wire would run far. */
(function (root) {
  "use strict";
  const L = () => root.CadLib;
  const GRID = 10;
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
      parts.push(Object.assign({ ref, type, params: c.params, pins }, p.block ? { block: String(p.block).slice(0, 40) } : {}));
    });
    Object.entries((design && design.rails) || {}).forEach(([net, v]) => { const x = L().parseEng(String(v)); if (isFinite(x)) rails.set(String(net), x); });
    return { parts, rails, problems };
  }

  // the schematic: { comps: [{ type, params, x, y, rot, label }], wires: [{ x1, y1, x2, y2 }], frame: { size, orient } }
  // drawn the way a person draws one (sch-layout.js): parts in signal order joined by wires,
  // ground and supplies as symbols, labels only for long connections; opts.prev: the places of
  // a drawing in progress (the parts drawn so far stay where they are); opts.external: nets already
  // on the sheet (parts added to a drawing), each pin on one ends in a sheet connector of its name
  function layout(checked, opts) {
    opts = opts || {};
    const out = root.SchLayout.draw(checked, { prev: opts.prev, effort: opts.effort, external: opts.external });
    // (out.places: where each part went, for the next drawing of a design in progress)
    // the extent: parts, their text and the wires
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const grow = (a, b, c, d) => { x1 = Math.min(x1, a); y1 = Math.min(y1, b); x2 = Math.max(x2, c); y2 = Math.max(y2, d); };
    out.comps.forEach(c => {
      const def = L().LIB[c.type];
      if (c.type === "netlabel") { const w = 7 * String(c.params.name).length + 10; grow((c.rot & 3) === 2 ? c.x - w : c.x, c.y - 16, (c.rot & 3) === 2 ? c.x : c.x + w, c.y); return; }
      if (c.type === "rail") { grow(c.x - 40, c.y - 50, c.x + 40, c.y + 50); return; }
      const s = root.SchLayout.shape({ type: c.type, params: c.params, ref: c.label || "" }, c.rot, c.params.flip === "yes");
      grow(c.x + s.box[0], c.y + s.box[1], c.x + s.box[2], c.y + s.box[3]);
      if (s.text) grow(c.x + s.text[0], c.y + s.text[1], c.x + s.text[2], c.y + s.text[3]);
      if (c.type === "scope") grow(c.x - 90, c.y - 70, c.x + 80, c.y + 50);
      void def;
    });
    out.wires.forEach(w => grow(Math.min(w.x1, w.x2), Math.min(w.y1, w.y2), Math.max(w.x1, w.x2), Math.max(w.y1, w.y2)));
    if (!isFinite(x1)) { x1 = y1 = 0; x2 = y2 = 100; }
    const W = x2 - x1, H = y2 - y1;
    // the sheet: the smallest frame the drawing fits in, landscape, above the title block
    const g = L().sheetGeom, sizes = ["A3", "A2", "A1", "A0"];
    let size = sizes[sizes.length - 1], geo = null;
    for (const s of sizes) { const G = g({ params: { size: s, orient: "landscape" } }); if (W + 80 <= G.fx2 - G.fx1 && H + 80 <= G.tb.y1 - G.fy1) { size = s; geo = G; break; } }
    geo = geo || g({ params: { size, orient: "landscape" } });
    const snap = v => Math.round(v / GRID) * GRID;
    // centred across the sheet, near its top
    const dx = snap(geo.fx1 + Math.max(40, (geo.fx2 - geo.fx1 - W) / 2) - x1), dy = snap(geo.fy1 + Math.max(40, Math.min(120, (geo.tb.y1 - geo.fy1 - H) / 2)) - y1);
    out.comps.forEach(c => { c.x += dx; c.y += dy; });
    out.wires.forEach(w => { w.x1 += dx; w.x2 += dx; w.y1 += dy; w.y2 += dy; });
    out.frame = { size, orient: "landscape", title: String(opts.title || "").slice(0, 80) };
    return out;
  }

  // the prompt's rules for a design, with the library: what the model must answer
  function rules() {
    return "Answer with JSON only, no prose around it:\n"
      + '{"title": "short title", "rails": {"B+": 300}, '
      + '"parts": [{"ref": "R1", "type": "resistor", "block": "Input stage", "values": {"r": "100k", "w": "0.5"}, "pins": {"1": "IN", "2": "GND"}}], '
      + '"summary": "what you designed and the key numbers you expect (B+, bias, gain, power)"}\n'
      + "Rules:\n"
      + "- Keep the keys in this order (title, rails, parts, summary) and the parts in signal order, input first: the CAD draws each part on the sheet as soon as it arrives.\n"
      + "- type is one of the library's part types below; values use only that type's value keys, with SI prefixes (100k, 47u, 2.2M) or one of the listed options; a tube's values are {\"tube\": \"EL84\"} plus \"connection\": \"triode\" for a pentode wired as a triode.\n"
      + "- pins maps EVERY pin id of the part to a net name. Pins on the same net are connected. GND is ground. Use short net names that say what the net is (IN, G1, A1, K1, OUT, FB, B+, B2): a net between parts far apart on the drawing (a feedback loop, a probe) is shown as two labels with its name.\n"
      + "- block names the functional block a part belongs to (\"Input stage\", \"Driver\", \"Phase splitter\", \"Output stage\", \"Power supply\"). List the parts block by block, in signal order. The CAD draws it as a person would: the blocks left to right, each stage in a column (the load above the tube or transistor, the cathode or emitter parts below it), joined by wires, supplies as rail symbols on top and one ground line along the bottom. Do not add net labels, rails or ground symbols as parts.\n"
      + "- A DC supply is a net listed in rails with its voltage (an ideal source to ground, e.g. \"B+\": 300); use rails for every supply voltage instead of drawing a mains supply unless a supply is asked for.\n"
      + "- Put a signal generator (siggen) at the input with its + pin on the input net and - on GND, at a realistic level (amp is the peak in volts), and the load at the output (a speaker for a power amplifier, a resistor or the next stage's grid resistor for a preamp). Add an oscilloscope (scope, pins CH1 CH2 COM) with CH1 on the input, CH2 on the output and COM on GND.\n"
      + "- One tube part is one tube section: a 12AX7 with both triodes used is two parts (refs VL1.1 and VL1.2). Heaters are not drawn.\n"
      + "- Every tube and transistor must stay within its ratings; use parts from the library only (the tube list below).\n"
      + "- Prefer proven textbook topologies and standard values (E12/E24).";
  }

  // a design while it is being written: the title, the rails and the parts complete so far, read
  // from the start of the JSON (the rest may be cut anywhere: in a string, a number, a part)
  function partial(text) {
    text = String(text || "");
    const out = { title: "", rails: {}, parts: [] };
    const start = text.indexOf("{"); if (start < 0) return out;
    const stack = [];        // "{" or "[" with the key it is the value of, at depth 1
    let inStr = false, esc = false, strAt = -1, key = null, expectKey = false, lastStr = null, valAt = -1;
    for (let i = start; i < text.length; i++) {
      const ch = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (ch === "\\") esc = true;
        else if (ch === '"') {
          inStr = false;
          if (stack.length === 1) {
            let s = null; try { s = JSON.parse(text.slice(strAt, i + 1)); } catch (e) { s = null; }
            if (expectKey) { lastStr = s; } else if (key === "title" && typeof s === "string") out.title = s;
          }
        }
        continue;
      }
      if (ch === '"') { inStr = true; strAt = i; continue; }
      if (ch === "{" || ch === "[") {
        stack.push({ ch, key: stack.length === 1 ? key : null, at: i });
        if (stack.length === 1) expectKey = true;
        if (stack.length === 3 && stack[1].key === "parts" && stack[1].ch === "[" && ch === "{") valAt = i;
        continue;
      }
      if (ch === "}" || ch === "]") {
        const top = stack.pop(); if (!top) break;
        if (stack.length === 2 && stack[1].key === "parts" && top.ch === "{" && valAt >= 0) {
          try { out.parts.push(JSON.parse(text.slice(valAt, i + 1))); } catch (e) { /* not a part */ }
          valAt = -1;
        } else if (stack.length === 1 && top.key === "rails" && top.ch === "{") {
          try { out.rails = JSON.parse(text.slice(top.at, i + 1)) || {}; } catch (e) { /* not rails */ }
        }
        if (!stack.length) { out.done = true; break; }
        continue;
      }
      if (stack.length === 1) {
        if (ch === ":" && expectKey) { key = lastStr; expectKey = false; }
        else if (ch === ",") expectKey = true;
      }
    }
    return out;
  }

  root.AiDesign = { check, layout, rules, isGnd, partial };
})(typeof window !== "undefined" ? window : globalThis);
