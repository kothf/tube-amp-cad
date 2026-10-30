/* What the AI features need of the part library, without the DOM (Node-testable):
   - fields(c): a part's editable values, as the inspector shows them (key, label, unit, kind, options);
   - setValue(c, key, value): one value set the way the inspector would set it, or why not;
   - catalogue(): the part library as text for a prompt (types, pins, values, models);
   - markdown(text, refs): a model's answer as safe HTML, part designators as links. */
(function (root) {
  "use strict";
  const esc = t => String(t).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  const L = () => root.CadLib;

  // the select options of a field: [[value, text], …]
  const optionsOf = (f, c) => (typeof f.options === "function" ? f.options(c) : f.options || []).map(o => [String(o[0]), String(o[1])]);
  function fields(c) {
    const def = L().LIB[c.type]; if (!def || !def.fields) return [];
    const seen = new Set();
    return def.fields.filter(f => f.key && f.kind !== "heading" && f.kind !== "level" && (!f.when || f.when(c)) && !seen.has(f.key) && seen.add(f.key))
      .map(f => ({ key: f.key, label: f.label, unit: f.unit || "", kind: f.kind, min: f.min, max: f.max, options: f.kind === "select" ? optionsOf(f, c) : null, f }));
  }
  const tubeNames = () => (root.TUBE_DATABASE || []).map(t => t.commonName);
  // value as typed by a person or a model ("1.5k", "47u", "2.2 MΩ", 0.5, "EL84") → what params hold
  function setValue(c, key, value) {
    const fd = fields(c).find(x => x.key === key);
    if (!fd) return { ok: false, error: `${key} is not a value of a ${L().LIB[c.type] ? L().LIB[c.type].name.toLowerCase() : c.type}` };
    const s = String(value).trim().replace(/\s*(Ω|ohms?|F|H|V|A|W|Hz)$/i, "").replace(/\s+/g, "").replace(/µ/g, "u").replace(/(\d)M(eg)?$/, "$1M");
    let v;
    if (fd.kind === "eng") {
      v = typeof value === "number" ? value : L().parseEng(s);
      if (!isFinite(v)) return { ok: false, error: `"${value}" is not a number` };
      if (v < 0 && key !== "v" && key !== "offset") return { ok: false, error: `${fd.label} cannot be negative` };
    } else if (fd.kind === "number" || fd.kind === "range") {
      v = typeof value === "number" ? value : parseFloat(s);
      if (!isFinite(v)) return { ok: false, error: `"${value}" is not a number` };
      if (fd.min !== undefined) v = Math.max(fd.min, v);
      if (fd.max !== undefined) v = Math.min(fd.max, v);
    } else if (fd.kind === "select") {
      const want = String(value).trim(), o = fd.options.find(q => q[0] === want) || fd.options.find(q => q[0].toLowerCase() === want.toLowerCase() || q[1].toLowerCase() === want.toLowerCase());
      if (!o) return { ok: false, error: `${fd.label} has no option "${value}" (${fd.options.slice(0, 12).map(q => q[0] || "blank").join(", ")}${fd.options.length > 12 ? " …" : ""})` };
      v = o[0];
    } else if (fd.kind === "tube") {
      const want = String(value).trim(), t = tubeNames().find(n => n === want) || tubeNames().find(n => n.toLowerCase() === want.toLowerCase());
      if (!t) return { ok: false, error: `the tube library has no ${value}` };
      v = t;
    } else if (fd.kind === "text") v = String(value);
    else return { ok: false, error: `${fd.label} cannot be set this way` };
    c.params[key] = v;
    // a tube's connection follows its kind, as the inspector does it
    if (fd.kind === "tube") c.params.connection = L().tubeKind(L().tubeByName(v)) === "pentode" ? "pentode" : "triode";
    return { ok: true, value: v };
  }
  // a value as text with its unit (100 kΩ, 47 µF, EL84); text: a select's option as the inspector names it
  function show(c, fd, text) {
    const v = c.params[fd.key];
    if (v === undefined || v === "") return "";
    if (fd.kind === "eng" && isFinite(+v)) return L().fmtEng(+v, fd.unit || "");
    if (fd.kind === "select") { const o = (fd.options || []).find(q => q[0] === String(v)); return o ? (text ? o[1] : o[0]) : String(v); }
    return String(v) + (fd.unit && fd.kind !== "text" ? " " + fd.unit : "");
  }

  // the library in a prompt: every part type with its pins and values (select values listed,
  // long model lists cut to their names). skip: types left out (document-only parts).
  function catalogue(opts) {
    opts = opts || {};
    const LIB = L().LIB, out = [], skip = new Set(["frame", "note", "scope"].concat(opts.skip || []));
    Object.keys(LIB).forEach(type => {
      if (skip.has(type)) return;
      const def = LIB[type], c = { type, params: Object.assign({}, def.defaults), x: 0, y: 0, rot: 0 };
      let pins = []; try { pins = (typeof def.pins === "function" ? def.pins(c) : def.pins) || []; } catch (e) { pins = []; }
      const fs = fields(c).map(fd => {
        if (fd.kind === "select") return `${fd.key}=${fd.options.length > 40 ? fd.options.slice(0, 40).map(o => o[0]).join("|") + "|…" : fd.options.map(o => o[0] || '""').join("|")}`;
        if (fd.kind === "tube") return `${fd.key}=<tube name>`;
        return `${fd.key} (${fd.label}${fd.unit ? ", " + fd.unit : ""}${fd.kind === "range" ? `, ${fd.min}…${fd.max}` : ""})`;
      });
      const pentode = type === "tube" ? " Pins with connection=pentode: A G1 G2 K (G1 the control grid, G2 the screen; a beam tetrode too). One part is one tube section: two triodes of a 12AX7 are two parts." : "";
      out.push(`${type}: ${def.name}. Pins ${pins.map(p => p.id).join(" ")}. Values: ${fs.join("; ") || "none"}. Defaults ${JSON.stringify(def.defaults)}.${pentode}`);
    });
    return out.join("\n");
  }
  const tubeList = () => (root.TUBE_DATABASE || []).map(t => `${t.commonName} (${L().tubeKind(t)}, Va ${t.vaMax} V, Pa ${t.paMax} W)`).join("; ");

  // ---------------------------------------------------------------------------
  // Markdown → HTML for answers: headings, lists, bold, italic, code, tables; nothing else gets
  // through as markup. refs: part designators (R7, VL1.1) that become links to the part.
  // ---------------------------------------------------------------------------
  function inline(text, refRx) {
    const keep = [];
    const hold = h => { keep.push(h); return `\u2060${keep.length - 1}\u2061`; };
    let s = esc(text).replace(/`([^`]+)`/g, (m, code) => hold(`<code>${code}</code>`));
    if (refRx) s = s.replace(refRx, (m, pre, ref) => pre + hold(`<a href="#" class="ai-ref" data-ref="${ref}">${ref}</a>`));
    s = s.replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>").replace(/(^|[\s(])\*([^*\s][^*]*)\*/g, "$1<i>$2</i>");
    return s.replace(/\u2060(\d+)\u2061/g, (m, k) => keep[+k]);
  }
  function markdown(text, refs) {
    const list = (refs || []).filter(Boolean).sort((a, b) => b.length - a.length).map(r => r.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
    const refRx = list.length ? new RegExp(`(^|[^\\w.])(${list.join("|")})(?![\\w]|\\.\\d)`, "g") : null;
    const lines = String(text || "").replace(/\r/g, "").split("\n"), out = [];
    let i = 0;
    while (i < lines.length) {
      const l = lines[i];
      if (/^```/.test(l)) {
        const body = []; i++;
        while (i < lines.length && !/^```/.test(lines[i])) body.push(lines[i++]);
        i++; out.push(`<pre>${esc(body.join("\n"))}</pre>`); continue;
      }
      let m;
      if ((m = /^(#{1,4})\s+(.*)$/.exec(l))) { out.push(`<h4>${inline(m[2], refRx)}</h4>`); i++; continue; }
      if (/^\s*([-*•]|\d+[.)])\s+/.test(l)) {
        const ordered = /^\s*\d/.test(l), items = [];
        while (i < lines.length && /^\s*([-*•]|\d+[.)])\s+/.test(lines[i])) items.push(lines[i++].replace(/^\s*([-*•]|\d+[.)])\s+/, ""));
        out.push(`<${ordered ? "ol" : "ul"}>${items.map(t => `<li>${inline(t, refRx)}</li>`).join("")}</${ordered ? "ol" : "ul"}>`); continue;
      }
      if (/^\s*\|.*\|\s*$/.test(l)) {
        const rows = [];
        while (i < lines.length && /^\s*\|.*\|\s*$/.test(lines[i])) rows.push(lines[i++]);
        const cells = r => r.trim().replace(/^\||\|$/g, "").split("|").map(x => x.trim());
        const body = rows.filter(r => !/^\s*\|[\s:|-]+\|\s*$/.test(r)).map(cells);
        out.push(`<table>${body.map((r, k) => `<tr>${r.map(x => (k === 0 && rows.length > 1 ? `<th>${inline(x, refRx)}</th>` : `<td>${inline(x, refRx)}</td>`)).join("")}</tr>`).join("")}</table>`); continue;
      }
      if (!l.trim()) { i++; continue; }
      const para = [];
      while (i < lines.length && lines[i].trim() && !/^(```|#{1,4}\s|\s*([-*•]|\d+[.)])\s+|\s*\|)/.test(lines[i])) para.push(lines[i++]);
      out.push(`<p>${inline(para.join(" "), refRx)}</p>`);
    }
    return out.join("");
  }

  root.AiCircuit = { esc, fields, setValue, show, catalogue, tubeList, markdown };
})(typeof window !== "undefined" ? window : globalThis);
