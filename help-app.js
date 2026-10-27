/* The help page (help.html): fills the parts reference, glossary and tube table from Hints,
   CadLib.LIB and TUBE_DATABASE, so the manual cannot drift from the app. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const hintHTML = t => t ? t.split("\n").map(l => /^= /.test(l) ? `<code>${esc(l.slice(2))}</code>` : /^- /.test(l) ? `<p>• ${esc(l.slice(2))}</p>` : `<p>${esc(l)}</p>`).join("") : "";

  // ---- parts reference, from the part library and the hints ----------------
  try {
    const L = window.CadLib, H = window.Hints, host = $("parts-ref");
    const order = [["Passive", ["resistor", "pot", "capacitor", "electrolytic", "inductor", "switch", "speaker", "fuse", "ntc", "mov"]],
      ["Transformers", ["opt_se", "opt_cat", "opt_pp", "ptx", "ptx_cat", "itx"]],
      ["Sources", ["vdc", "rail", "isrc", "siggen", "mains", "vcvs", "vccs"]], ["Ground & connectors", ["ground", "offsheet", "jack", "iec", "terminal", "header", "faston"]],
      ["Tubes", ["tube"]], ["Semiconductors", ["diode", "bridge", "zener", "led", "npn", "pnp", "nmos", "pmos", "njf", "pjf"]],
      ["Integrated circuits", ["opamp", "timer555", "reg", "tl431"]], ["Gas-discharge tubes", ["gasreg"]], ["Instruments", ["scope"]], ["Document", ["frame", "note"]]];
    let h = "";
    order.forEach(([g, types]) => {
      h += `<h4>${g}</h4>`;
      types.forEach(t => {
        const d = L.LIB[t]; if (!d) return;
        const seen = new Set();
        const rows = (d.fields || []).filter(f => { if (f.kind === "heading") return false; if (seen.has(f.key)) return f.key !== "amp"; seen.add(f.key); return true; }).map(f => {
          const opts = Array.isArray(f.options) ? f.options.map(o => Array.isArray(o) ? o[1] : (o && (o.label || o.v)) || o).filter(x => typeof x === "string") : [];
          const unit = f.key === "amp" && t === "siggen" ? "Vpk · Vrms · dBV" : f.unit;
          const text = H.field(t, f.key) || H.label(f.label) || "";
          return `<tr><td>${esc(f.label)}${unit ? ` <span class="opts">${esc(unit)}</span>` : ""}</td><td class="wrap hint-text">${hintHTML(text)}${opts.length ? `<span class="opts">Choices: ${opts.map(esc).join(" · ")}</span>` : ""}</td></tr>`;
        }).join("");
        h += `<div class="part" id="part-${t}"><h3>${esc(d.name)}<span class="tag">${t}</span></h3><p>${esc(H.parts[t] || "")}</p>${rows ? `<table><tr><th>Field</th><th>Meaning</th></tr>${rows}</table>` : ""}</div>`;
      });
    });
    host.innerHTML = h;
  } catch (e) { $("parts-ref").innerHTML = `<p class="warn">The parts list could not be built here (${esc(e.message)}).</p>`; }

  // ---- glossary of readouts -------------------------------------------------
  try {
    const groups = [
      ["Tube operating point", ["Va (anode–cathode)", "Vg1k (bias)", "Vg2k (screen)", "Ia (anode current)", "Ig2 (screen current)", "Pa (dissipation)", "Pg2 (screen dissipation)", "Ik (cathode current)", "Vhk (cathode above heater)", "Vhk (heater above cathode)", "Grid circuit R (cathode bias)", "Grid circuit R (fixed bias)", "Rectified current", "Peak inverse voltage"]],
      ["With signal", ["Plate swing", "Grid swing", "Plate/grid gain", "THD at plate", "Average Pa"]],
      ["Circuit summary", ["Parts · wires · nets", "From DC supplies", "Output (speakers)", "Tubes (anode + screen)", "Transistors", "Op-amps", "Resistors"]],
      ["Other parts", ["Voltage", "Current (DC)", "Current supplied", "DC drop", "DC voltage across", "Dissipation", "Power (avg)", "Wiper DC", "Primary DC current", "Voltage (A–K)", "Current (A→K)", "hFE (Ic/Ib)", "Ib"]],
      ["Ratings (curve tracer)", ["Va max", "Pa max", "Pg2 max", "Vg2 max", "Ik max", "Vhk max", "Rg max", "Heater", "Pins"]],
      ["Koren model coefficients", ["µ", "µ (g1–g2)", "kg1", "kp", "kvb", "x", "kg2", "knee vk", "slope λ", "screen share ks", "gm", "rp"]],
      ["Oscilloscope", ["Analysis", "Duration", "Volts/div", "Coupling", "Time/div", "Trigger source", "Slope", "Scope part"]],
      ["Spectrum analyzer", ["Span", "Units", "Frequency axis", "Scale", "Input", "Harmonic", "Other components"]],
      ["Bode plotter", ["Traces", "Gain", "Range", "Phase", "Generator", "Response"]],
      ["Board rules", ["Signal and power", "High voltage", "HV above", "To the board edge", "Signal width", "Power / HV width", "Minimum width", "Via drill", "Via pad", "Minimum drill", "Minimum annular ring", "Opening around pads", "Copper", "Board thickness", "Class"]],
    ];
    const H = window.Hints;
    $("glossary").innerHTML = groups.map(([g, keys]) => `<h3>${esc(g)}</h3><table><tr><th>Label</th><th>Meaning</th></tr>${keys.filter(k => H.labels[k]).map(k => `<tr><td>${esc(k)}</td><td class="wrap hint-text">${hintHTML(H.labels[k])}</td></tr>`).join("")}</table>`).join("");
  } catch (e) {}

  // ---- tube table -------------------------------------------------------------
  try {
    const DB = window.TUBE_DATABASE || [], kindOf = t => /rectifier/i.test(t.type) ? "rectifier" : t.koren && (t.koren.Pentode || t.koren.pentode) ? "pentode" : "triode";
    const pf = v => v == null ? "" : (v * 1e12 < 10 ? (v * 1e12).toFixed(1) : Math.round(v * 1e12));
    const caps = t => { const c = t.caps; if (!c) return ""; const s = c.pentode ? [c.pentode.cin, c.pentode.cga, c.pentode.cout] : c.triode ? [c.triode.cgk, c.triode.cga, c.triode.cak] : null; return s ? (c.estimated ? "≈ " : "") + s.map(pf).join(" / ") : ""; };
    const lim = (t, k) => t.limits && t.limits[k] != null ? t.limits[k] : "";
    const rows = DB.map(t => ({ t, cells: [t.commonName, t.nameGost || "", t.type || "", kindOf(t), t.socket || "", t.vaMax || "", t.paMax || "", t.vg2Max || lim(t, "vg2") || "", lim(t, "pg2"), t.ikMax || "", [lim(t, "vhk"), lim(t, "vhkNeg")].filter(x => x !== "").join(" / "), t.vh && t.ih ? `${t.vh} V ${t.ih} A` : "", caps(t), (t.book && t.book.source) || (t.limits && t.limits.source) || "datasheet"] }));
    const head = ["Tube", "ГОСТ", "Type", "Kind", "Socket", "Va max V", "Pa max W", "Vg2 max V", "Pg2 max W", "Ik max mA", "Vhk max V", "Heater", "Capacitances pF", "Source"];
    let sortCol = 0, asc = true;
    const draw = () => {
      const q = ($("tube-q").value || "").trim().toLowerCase();
      const list = rows.filter(r => !q || r.cells.join(" ").toLowerCase().includes(q)).sort((a, b) => { const x = a.cells[sortCol], y = b.cells[sortCol]; const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y), undefined, { numeric: true }); return asc ? c : -c; });
      $("tube-table").innerHTML = `<tr>${head.map((h, i) => `<th data-c="${i}" style="cursor:pointer" title="Sort">${h}${i === sortCol ? (asc ? " ▲" : " ▼") : ""}</th>`).join("")}</tr>` + list.map(r => `<tr>${r.cells.map(c => `<td>${esc(c)}</td>`).join("")}</tr>`).join("");
    };
    $("tube-table").addEventListener("click", e => { const th = e.target.closest("th"); if (!th) return; const c = +th.dataset.c; asc = c === sortCol ? !asc : true; sortCol = c; draw(); });
    $("tube-q").addEventListener("input", draw);
    draw();
  } catch (e) {}

  // ---- version --------------------------------------------------------------
  const m = /[?&]v=([^&]+)/.exec([...document.scripts].map(s => s.src).find(s => /hints\.js/.test(s)) || "");
  $("ver").textContent = m && m[1] !== "dev" ? "version " + m[1] : "development build";

  // ---- table of contents, scroll spy -----------------------------------------
  const heads = [...document.querySelectorAll("main h2, main h3")].filter(h => h.closest(".part") === null);
  heads.forEach((h, i) => { if (!h.id) h.id = "s-" + i; });
  $("toc-list").innerHTML = heads.map(h => `<li class="${h.tagName.toLowerCase()}"><a href="#${h.id}">${esc(h.textContent)}</a></li>`).join("");
  const links = [...$("toc-list").querySelectorAll("a")];
  const spy = () => { let cur = heads[0]; for (const h of heads) { if (h.getBoundingClientRect().top < 120) cur = h; else break; } links.forEach(a => a.classList.toggle("on", a.getAttribute("href") === "#" + cur.id)); };
  addEventListener("scroll", spy, { passive: true }); spy();
  $("toc-toggle").addEventListener("click", () => $("toc").classList.toggle("open"));

  // ---- search: hides the blocks that do not match, marks the words ----------
  const blocks = [...document.querySelectorAll("main > p, main > ul, main > ol, main > table, main > pre, main > div, main h4, .part, #glossary tr, #parts-ref h4")];
  const unmark = () => document.querySelectorAll("main mark").forEach(m => m.replaceWith(document.createTextNode(m.textContent)));
  const markIn = (el, re) => {
    const walk = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => n.parentNode.closest("script, style, mark, #tube-table") ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
    const nodes = []; while (walk.nextNode()) nodes.push(walk.currentNode);
    nodes.forEach(n => { if (!re.test(n.textContent)) return; re.lastIndex = 0; const span = document.createElement("span"); span.innerHTML = esc(n.textContent).replace(re, m => `<mark>${m}</mark>`); n.replaceWith(...span.childNodes); });
  };
  let tmr = 0;
  $("q").addEventListener("input", () => { clearTimeout(tmr); tmr = setTimeout(search, 150); });
  function search() {
    const q = $("q").value.trim(); unmark(); document.body.normalize();
    document.querySelectorAll(".hidden-by-search").forEach(e => e.classList.remove("hidden-by-search"));
    if (q.length < 2) { $("q-count").textContent = ""; document.querySelectorAll("#toc-list li").forEach(li => li.classList.remove("hide")); return; }
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const re = new RegExp(words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|"), "gi");
    let n = 0;
    blocks.forEach(b => { const t = b.textContent.toLowerCase(); const hit = words.every(w => t.includes(w)); if (!hit && !b.contains(document.getElementById("tube-q"))) b.classList.add("hidden-by-search"); else if (hit) { n++; markIn(b, re); } });
    // headings stay visible only where something under them matched
    heads.forEach(h => { let el = h.nextElementSibling, any = false; while (el && !/^H[23]$/.test(el.tagName)) { if (!el.classList.contains("hidden-by-search") && el.querySelector && (el.tagName === "MARK" || el.querySelector("mark"))) any = true; el = el.nextElementSibling; } h.classList.toggle("hidden-by-search", !any && !words.every(w => h.textContent.toLowerCase().includes(w))); });
    // a glossary table keeps its header row only when a row under it matched
    document.querySelectorAll("#glossary table").forEach(t => { const hit = t.querySelector("mark"); t.classList.toggle("hidden-by-search", !hit); });
    document.querySelectorAll("#toc-list li").forEach((li, i) => li.classList.toggle("hide", heads[i].classList.contains("hidden-by-search")));
    $("q-count").textContent = n ? `${n} match${n === 1 ? "" : "es"}` : "Nothing found";
    const first = document.querySelector("main mark"); if (first) first.scrollIntoView({ block: "center" });
  }
  addEventListener("keydown", e => { if (e.key === "/" && document.activeElement !== $("q") && document.activeElement !== $("tube-q")) { e.preventDefault(); $("q").focus(); } if (e.key === "Escape" && document.activeElement === $("q")) { $("q").value = ""; search(); } });
  // open at ?q=… or #section
  const qp = new URLSearchParams(location.search).get("q"); if (qp) { $("q").value = qp; search(); }
})();
