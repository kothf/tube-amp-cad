/* Bill of materials. BomLib.build() groups the circuit's parts into BOM lines
   (same kind, value, rating and part number on one line; sections of a dual
   tube or a ganged switch, VL1.1 / VL1.2, count as one part), and the writers
   turn a BOM into TXT, CSV, XLSX (a minimal Office Open XML workbook in a
   stored zip) or PDF (through PdfExport). No dependencies besides CadLib and
   PdfExport, which the CAD page loads first. */
(function (root) {
  "use strict";
  const COLUMNS = [
    { key: "item", title: "Item" }, { key: "qty", title: "Qty" }, { key: "refs", title: "Designators" },
    { key: "desc", title: "Description" }, { key: "value", title: "Value" }, { key: "rating", title: "Rating / data" },
    { key: "sim", title: "Sim. max" }, { key: "partno", title: "Part number" }
  ];
  // parts without a designator (frame, note, ground, sheet connector) never appear;
  // sources and instruments only when asked for
  const BENCH = new Set(["vdc", "siggen", "mains", "scope"]);

  // what a part is on the bill: [description, value, rating]
  function describe(c, n) {
    const L = root.CadLib, f = L.fmtEng, p = c.params;
    switch (c.type) {
      case "resistor": return ["Resistor", f(p.r, "Ω"), +p.w ? p.w + " W" : ""];
      case "pot": return ["Potentiometer, " + (p.taper === "log" ? "audio (log)" : "linear"), f(p.r, "Ω"), ""];
      case "capacitor": return ["Capacitor", f(p.c, "F"), ""];
      case "electrolytic": return ["Capacitor, electrolytic", f(p.c, "F"), ""];
      case "inductor": return ["Choke", f(p.l, "H"), "DCR " + f(p.dcr, "Ω")];
      case "switch": return ["Changeover switch" + (n > 1 ? ", " + n + " poles" : ""), "", ""];
      case "speaker": return ["Loudspeaker", f(p.r, "Ω"), ""];
      case "opt_se": return ["Output transformer, single-ended", f(p.zp, "") + ":" + f(p.zs, "Ω"), "Lp " + f(p.lp, "H") + ", DCR " + f(p.dcrp, "Ω")];
      case "opt_cat": { const m = L.OUTPUT_TX[p.model] || {}; return ["Output transformer, single-ended", m.name || p.model, m.w + " W, " + m.ma + " mA DC"]; }
      case "opt_pp": return ["Output transformer, push-pull", f(p.zaa, "") + ":" + f(p.zs, "Ω"), "UL tap " + p.tap + " %, Lp " + f(p.lp, "H")];
      case "ptx": return ["Power transformer", p.vrms + "-0-" + p.vrms + " V", p.freq + " Hz"];
      case "ptx_cat": { const m = L.POWER_TX[p.model] || {}; return ["Power transformer", m.name || p.model, m.rated + "; heaters " + m.heaters]; }
      case "tube": { const t = L.tubeByName(p.tube); return ["Vacuum tube" + (t && t.type ? ", " + t.type.toLowerCase() : ""), p.tube, t && t.socket ? t.socket : ""]; }
      case "diode": return ["Diode", p.model, ""];
      case "zener": { const z = L.ZENERS[p.model] || {}; return ["Zener diode", p.model, z.bv + " V, " + z.p + " W"]; }
      case "led": { const l = L.LEDS[p.color] || {}; return ["LED, " + p.color, "", l.vf + " V at 10 mA, " + l.i * 1000 + " mA max"]; }
      case "npn": case "pnp": { const m = L.BJTS[p.model]; return ["Transistor, " + c.type.toUpperCase(), p.model, m ? L.semiRating(m) : ""]; }
      case "nmos": case "pmos": { const m = L.MOSFETS[p.model], dep = m && (c.type === "nmos" ? m.vto < 0 : m.vto > 0); return ["MOSFET, " + (c.type === "nmos" ? "N" : "P") + "-channel" + (dep ? ", depletion" : ""), p.model, m ? L.semiRating(m) : ""]; }
      case "vdc": return ["DC supply (bench)", f(p.v, "V"), ""];
      case "siggen": return ["Signal generator (bench)", "", ""];
      case "mains": return ["AC mains", p.vrms + " V " + p.freq + " Hz", ""];
      case "scope": return ["Oscilloscope (bench)", "", ""];
      default: { const d = L.LIB[c.type]; return [d ? d.name : c.type, d && d.value ? d.value(c) : "", ""]; }
    }
  }

  // natural order of designators: R2 before R10, VL1.2 after VL1.1
  const refParts = r => { const m = /^([A-Za-z]*)(\d*)(.*)$/.exec(r || ""); return [m[1], m[2] ? +m[2] : Infinity, m[3]]; };
  function refCmp(a, b) {
    const [pa, na, ra] = refParts(a), [pb, nb, rb] = refParts(b);
    return pa < pb ? -1 : pa > pb ? 1 : na - nb || (ra < rb ? -1 : ra > rb ? 1 : 0);
  }
  // R1, R2, R3, R5 -> "R1-R3, R5" (ASCII hyphen: it prints in every format)
  function compressRefs(refs) {
    const out = [];
    for (let i = 0; i < refs.length;) {
      const [p, n, rest] = refParts(refs[i]);
      let j = i;
      while (j + 1 < refs.length && !rest && isFinite(n)) {
        const [p2, n2, r2] = refParts(refs[j + 1]);
        if (p2 !== p || r2 || n2 !== n + (j + 1 - i)) break;
        j++;
      }
      out.push(j - i >= 2 ? refs[i] + "-" + refs[j] : refs.slice(i, j + 1).join(", "));
      i = j + 1;
    }
    return out.join(", ");
  }

  /** Group parts into BOM lines.
      opts.bench: include sources and instruments; opts.sockets: add a socket line per tube base;
      opts.stress(c) -> { v, text, warn, note } | null: the simulated worst case of one part. */
  function build(comps, opts) {
    opts = opts || {};
    // physical parts: sections sharing the name before the dot are one part
    const phys = new Map();
    comps.forEach(c => {
      const def = root.CadLib.LIB[c.type];
      if (!def || def.noLabel || (!opts.bench && BENCH.has(c.type))) return;
      const l = String(c.label || "").trim(), i = l.lastIndexOf(".");
      const base = i > 0 ? l.slice(0, i) : l, k = base ? c.type + "|" + base : c.id;
      if (!phys.has(k)) phys.set(k, { ref: base || "?", members: [] });
      phys.get(k).members.push(c);
    });
    const lines = new Map();
    const add = (key, ref, members, desc, value, rating, partno) => {
      if (!lines.has(key)) lines.set(key, { refs: [], comps: [], desc, value, rating, partno });
      const L = lines.get(key);
      L.refs.push(ref); L.comps.push(...members);
    };
    const sockets = new Map();
    phys.forEach(({ ref, members }) => {
      const c = members[0], [desc, value, rating] = describe(c, members.length);
      const partno = String(c.params.partno || "").trim();
      add([c.type, desc, value, rating, partno].join("\u0001"), ref, members, desc, value, rating, partno);
      if (opts.sockets && c.type === "tube" && rating && !/wire leads/i.test(rating)) {
        if (!sockets.has(rating)) sockets.set(rating, []);
        sockets.get(rating).push(ref);
      }
    });
    sockets.forEach((refs, socket) => lines.set("socket\u0001" + socket, { refs, comps: [], desc: "Tube socket", value: socket, rating: "for " + compressRefs(refs.slice().sort(refCmp)), partno: "", socket: true }));
    const rows = [...lines.values()].map(L => {
      L.refs.sort(refCmp);
      // the worst case of the line; a warning on any of its parts shows
      const st = opts.stress ? L.comps.map(opts.stress).filter(Boolean) : [];
      const top = st.reduce((a, b) => (!a || b.v > a.v ? b : a), null), bad = st.find(x => x.warn);
      return { qty: L.refs.length, refs: L.socket ? "" : compressRefs(L.refs), refList: L.refs, desc: L.desc, value: L.value, rating: L.rating, partno: L.partno,
        sim: top ? top.text + (bad ? " (" + (bad.note || "over rating") + ")" : "") : "", warn: !!bad, ids: L.comps.map(c => c.id), socket: !!L.socket };
    });
    // by designator, sockets after the parts
    rows.sort((a, b) => (a.socket - b.socket) || refCmp(a.refList[0], b.refList[0]) || (a.value < b.value ? -1 : 1));
    rows.forEach((r, i) => { r.item = i + 1; });
    return rows;
  }

  // ---------------------------------------------------------------------------
  // Writers. bom = { rows, title, docno, rev, date }
  // ---------------------------------------------------------------------------
  const cell = (r, k) => String(r[k] === undefined || r[k] === null ? "" : r[k]);
  const header = bom => [bom.title || "Untitled circuit", [bom.docno, bom.rev ? "rev. " + bom.rev : "", bom.date].filter(Boolean).join(" · ")].filter(Boolean);
  const totalParts = rows => rows.reduce((s, r) => s + r.qty, 0);

  function toTxt(bom) {
    const rows = bom.rows, w = COLUMNS.map(c => Math.max(c.title.length, ...rows.map(r => [...cell(r, c.key)].length)));
    const pad = (s, n, right) => { const k = n - [...s].length; return right ? " ".repeat(k) + s : s + " ".repeat(k); };
    const line = vals => vals.map((v, i) => pad(v, w[i], i < 2)).join("  ").replace(/\s+$/, "");
    const out = ["BILL OF MATERIALS", ...header(bom), ""];
    out.push(line(COLUMNS.map(c => c.title)), w.map(n => "-".repeat(n)).join("  "));
    rows.forEach(r => out.push(line(COLUMNS.map(c => cell(r, c.key)))));
    out.push("", `${rows.length} lines, ${totalParts(rows)} parts`);
    return out.join("\r\n") + "\r\n";
  }

  function toCsv(bom) {
    const q = s => (/[",\r\n]/.test(s) || /^\s|\s$/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s);
    const out = [COLUMNS.map(c => q(c.title)).join(",")];
    bom.rows.forEach(r => out.push(COLUMNS.map(c => q(cell(r, c.key))).join(",")));
    return "﻿" + out.join("\r\n") + "\r\n";     // the BOM mark makes Excel read UTF-8 (Ω, µ)
  }

  // --- XLSX: stored (uncompressed) zip of the minimal SpreadsheetML parts ---
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
  function crc32(b) { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
  function zip(files, when) {
    const enc = new TextEncoder(), d = when || new Date();
    const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), date = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
    const parts = [], central = [];
    let off = 0;
    files.forEach(([name, text]) => {
      const nb = enc.encode(name), data = typeof text === "string" ? enc.encode(text) : text, crc = crc32(data);
      const h = new DataView(new ArrayBuffer(30));
      [[0, 0x04034b50, 4], [4, 20, 2], [6, 0x0800, 2], [8, 0, 2], [10, time, 2], [12, date, 2], [14, crc, 4], [18, data.length, 4], [22, data.length, 4], [26, nb.length, 2], [28, 0, 2]]
        .forEach(([o, v, n]) => (n === 4 ? h.setUint32(o, v, true) : h.setUint16(o, v, true)));
      const cd = new DataView(new ArrayBuffer(46));
      [[0, 0x02014b50, 4], [4, 20, 2], [6, 20, 2], [8, 0x0800, 2], [10, 0, 2], [12, time, 2], [14, date, 2], [16, crc, 4], [20, data.length, 4], [24, data.length, 4], [28, nb.length, 2],
        [30, 0, 2], [32, 0, 2], [34, 0, 2], [36, 0, 2], [38, 0, 4], [42, off, 4]].forEach(([o, v, n]) => (n === 4 ? cd.setUint32(o, v, true) : cd.setUint16(o, v, true)));
      parts.push(new Uint8Array(h.buffer), nb, data); central.push(new Uint8Array(cd.buffer), nb);
      off += 30 + nb.length + data.length;
    });
    const cdSize = central.reduce((s, a) => s + a.length, 0), end = new DataView(new ArrayBuffer(22));
    [[0, 0x06054b50, 4], [4, 0, 2], [6, 0, 2], [8, files.length, 2], [10, files.length, 2], [12, cdSize, 4], [16, off, 4], [20, 0, 2]]
      .forEach(([o, v, n]) => (n === 4 ? end.setUint32(o, v, true) : end.setUint16(o, v, true)));
    const all = [...parts, ...central, new Uint8Array(end.buffer)], out = new Uint8Array(all.reduce((s, a) => s + a.length, 0));
    let p = 0; all.forEach(a => { out.set(a, p); p += a.length; });
    return out;
  }
  const xml = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "");
  const colName = i => String.fromCharCode(65 + i);
  function toXlsx(bom) {
    const head = header(bom), first = head.length + 2;          // header lines, a blank row, then the table
    const rowsXml = [];
    const strCell = (ref, v, s) => `<c r="${ref}" t="inlineStr"${s ? ` s="${s}"` : ""}><is><t xml:space="preserve">${xml(v)}</t></is></c>`;
    rowsXml.push(`<row r="1">${strCell("A1", "Bill of materials", 2)}</row>`);
    head.forEach((h, i) => rowsXml.push(`<row r="${i + 2}">${strCell("A" + (i + 2), h, i ? 0 : 1)}</row>`));
    rowsXml.push(`<row r="${first}">${COLUMNS.map((c, i) => strCell(colName(i) + first, c.title, 3)).join("")}</row>`);
    bom.rows.forEach((r, k) => {
      const n = first + 1 + k;
      rowsXml.push(`<row r="${n}">` + COLUMNS.map((c, i) => {
        const ref = colName(i) + n, v = r[c.key];
        return typeof v === "number" ? `<c r="${ref}" s="4"><v>${v}</v></c>` : strCell(ref, cell(r, c.key), c.key === "sim" && r.warn ? 5 : 4);
      }).join("") + `</row>`);
    });
    const last = first + bom.rows.length, widths = [6, 6, 22, 34, 18, 30, 16, 22];
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${first}" topLeftCell="A${first + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>
<sheetData>${rowsXml.join("")}</sheetData>
${bom.rows.length ? `<autoFilter ref="A${first}:${colName(COLUMNS.length - 1)}${last}"/>` : ""}
<pageMargins left="0.5" right="0.5" top="0.75" bottom="0.75" header="0.3" footer="0.3"/>
<pageSetup orientation="landscape" paperSize="9"/>
</worksheet>`;
    const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><sz val="11"/><color rgb="FFC00000"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FFD9E1F2"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border><border><left style="thin"><color rgb="FF999999"/></left><right style="thin"><color rgb="FF999999"/></right><top style="thin"><color rgb="FF999999"/></top><bottom style="thin"><color rgb="FF999999"/></bottom><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1"/><xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf></cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;
    const X = "http://schemas.openxmlformats.org";
    return zip([
      ["[Content_Types].xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="${X}/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/></Types>`],
      ["_rels/.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${X}/package/2006/relationships"><Relationship Id="rId1" Type="${X}/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/><Relationship Id="rId2" Type="${X}/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/></Relationships>`],
      ["docProps/core.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<cp:coreProperties xmlns:cp="${X}/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>${xml("Bill of materials · " + (bom.title || "circuit"))}</dc:title><dc:creator>Tube Amp CAD</dc:creator></cp:coreProperties>`],
      ["xl/workbook.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="${X}/spreadsheetml/2006/main" xmlns:r="${X}/officeDocument/2006/relationships"><sheets><sheet name="BOM" sheetId="1" r:id="rId1"/></sheets>${bom.rows.length ? `<definedNames><definedName name="_xlnm._FilterDatabase" localSheetId="0" hidden="1">BOM!$A$${first}:$${colName(COLUMNS.length - 1)}$${last}</definedName></definedNames>` : ""}</workbook>`],
      ["xl/_rels/workbook.xml.rels", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${X}/package/2006/relationships"><Relationship Id="rId1" Type="${X}/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="${X}/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`],
      ["xl/styles.xml", styles],
      ["xl/worksheets/sheet1.xml", sheet]
    ]);
  }

  // --- PDF: A4 landscape table in Courier, wrapped cells, header repeated per page ---
  function toPdf(bom) {
    const W = 842, H = 595, M = 36, FS = 8, ADV = 0.6 * FS, LH = FS * 1.35;
    const chars = [4, 4, 20, 34, 18, 34, 16, 20], GAP = 2;          // column widths in characters
    const xs = []; chars.reduce((x, n, i) => { xs[i] = x; return x + (n + GAP) * ADV; }, M);
    const wrap = (s, n) => {
      const out = []; let cur = "";
      String(s).split(/(?<=[\s,;/])/).forEach(word => {
        while ([...word].length > n) { if (cur) { out.push(cur.trimEnd()); cur = ""; } out.push([...word].slice(0, n).join("")); word = [...word].slice(n).join(""); }
        if ([...(cur + word).trimEnd()].length > n) { out.push(cur.trimEnd()); cur = word.trimStart(); } else cur += word;
      });
      if (cur.trim() || !out.length) out.push(cur.trimEnd());
      return out;
    };
    const laid = bom.rows.map(r => { const cells = COLUMNS.map((c, i) => wrap(cell(r, c.key), chars[i])); return { r, cells, h: Math.max(...cells.map(c => c.length)) * LH + 3 }; });
    const top0 = M + 52, top = M + 18, bottom = H - M - 14;
    const pages = [[]];
    let y = top0 + LH + 4;
    laid.forEach(L => { if (y + L.h > bottom && pages[pages.length - 1].length) { pages.push([]); y = top + LH + 4; } pages[pages.length - 1].push(L); y += L.h; });
    const head = header(bom), INK = "#e6edf3";            // light colours print black (see PdfExport.ink)
    return root.PdfExport.buildPdf(pages.map(() => ({ widthPt: W, heightPt: H, k: 1, ox: 0, oy: 0 })), (pc, pi) => {
      pc.fillStyle = INK; pc.strokeStyle = INK; pc.textBaseline = "alphabetic";
      let y = top;
      if (pi === 0) {
        pc.font = "bold 14px monospace"; pc.fillText("BILL OF MATERIALS", M, M + 10);
        pc.font = "9px monospace"; head.forEach((h, i) => pc.fillText(h, M, M + 26 + i * 11));
        y = top0;
      }
      pc.font = `bold ${FS}px monospace`;
      COLUMNS.forEach((c, i) => pc.fillText(c.title, xs[i], y + FS));
      pc.lineWidth = 0.8; pc.beginPath(); pc.moveTo(M, y + LH + 1); pc.lineTo(W - M, y + LH + 1); pc.stroke();
      y += LH + 4;
      pc.font = `${FS}px monospace`; pc.lineWidth = 0.3;
      pages[pi].forEach(L => {
        L.cells.forEach((lines, i) => lines.forEach((t, k) => pc.fillText(t, xs[i], y + FS + k * LH)));
        y += L.h;
        pc.beginPath(); pc.moveTo(M, y - 1.5); pc.lineTo(W - M, y - 1.5); pc.stroke();
      });
      pc.font = `${FS}px monospace`;
      if (pi === pages.length - 1) pc.fillText(`${bom.rows.length} lines, ${totalParts(bom.rows)} parts`, M, Math.min(y + LH + 2, H - M - 2));
      pc.textAlign = "right"; pc.fillText(`Tube Amp CAD · page ${pi + 1} of ${pages.length}`, W - M, H - M + 6); pc.textAlign = "left";
    }, { title: "Bill of materials" + (bom.title ? " - " + bom.title : "") });
  }

  root.BomLib = { COLUMNS, build, describe, compressRefs, refCmp, toTxt, toCsv, toXlsx, toPdf, zip, crc32 };
})(typeof window !== "undefined" ? window : globalThis);
