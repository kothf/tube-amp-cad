/* The CAD's KiCad export (File ▾ → Export KiCad project): the schematic, the board when it has
   parts on it, the project file with the net classes, and the libraries their symbols and
   footprints come from, in one ZIP. The files are written by kicad-export.js; this part
   gathers the circuit: which sheet each part is on, each symbol as the CAD draws it, the
   footprint pad behind every pin (BoardCore's mapping, as the board has it). */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadKicad = function (cad) {
    const { S, VERSION, baseName, boardNetlist, compBBox, compPins, drawSymbol, frames, setStatus, topo } = cad;
    const { LIB } = CadLib;
    const POWER = new Set(["ground", "rail", "offsheet"]);
    const snap = v => Math.round(v / 10) * 10;

    // The board side: the netlist as the board sees it, the model of the board (null without
    // parts on it) and a model with every part on its footprint, which gives each pin its pad
    function boardSide() {
      const BC = BoardCore, board = BC.normaliseBoard(S.board), netlist = BC.withHeaters(boardNetlist(), board.rules);
      const groups = BC.physicalParts(netlist), all = { ...board, parts: { ...board.parts } };
      groups.forEach(g => { if (!all.parts[g.key]) all.parts[g.key] = { ref: g.ref, fp: g.defaultFp, x: 0, y: 0, rot: 0 }; });
      const full = BC.model(all, netlist);
      const placed = S.board && Object.keys(board.parts).length ? BC.model(board, netlist) : null;
      return { board, netlist, full, placed };
    }

    // Sheets: a drawing frame each when there are two or more (parts outside every frame go to
    // the nearest), else the whole drawing on one sheet
    function sheetsOf() {
      const list = frames(), K = KicadExport;
      if (list.length < 2) {
        let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
        S.comps.forEach(c => { if (c.type === "frame") return; const b = compBBox(c); x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); });
        S.wires.forEach(w => { x1 = Math.min(x1, w.x1, w.x2); y1 = Math.min(y1, w.y1, w.y2); x2 = Math.max(x2, w.x1, w.x2); y2 = Math.max(y2, w.y1, w.y2); });
        if (!isFinite(x1)) { x1 = y1 = 0; x2 = y2 = 100; }
        const f = list[0], paper = K.paperFor((x2 - x1) * K.UNIT, (y2 - y1) * K.UNIT, 25.4);
        return [{ frame: f || null, box: { x1: -Infinity, y1: -Infinity, x2: Infinity, y2: Infinity }, ox: snap(x1), oy: snap(y1),
          paper, offX: Math.round((paper.w - (x2 - x1) * K.UNIT) / 2 / 2.54) * 2.54, offY: Math.round((paper.h - (y2 - y1) * K.UNIT) / 2 / 2.54) * 2.54 }];
      }
      return list.map(f => {
        const b = compBBox(f), p = f.params || {}, sz = /^A[0-4]$/.test(p.size) ? p.size : "A3", portrait = p.orient === "portrait";
        const [, W, H] = [["A4", 297, 210], ["A3", 420, 297], ["A2", 594, 420], ["A1", 841, 594], ["A0", 1189, 841]].find(a => a[0] === sz);
        const paper = { size: sz, portrait, w: portrait ? H : W, h: portrait ? W : H };
        // the frame drawn at 0.254 mm a unit is 1.6 % larger than its paper: centred on it
        return { frame: f, box: b, ox: snap(b.x1), oy: snap(b.y1), paper,
          offX: Math.round((paper.w - (b.x2 - b.x1) * KicadExport.UNIT) / 2 / 1.27) * 1.27, offY: Math.round((paper.h - (b.y2 - b.y1) * KicadExport.UNIT) / 2 / 1.27) * 1.27 };
      });
    }
    function sheetIndex(sheets, x, y) {
      if (sheets.length === 1) return 0;
      let best = 0, bd = Infinity;
      sheets.forEach((s, i) => { const b = s.box, d = Math.hypot(Math.max(b.x1 - x, 0, x - b.x2), Math.max(b.y1 - y, 0, y - b.y2)); if (d < bd) { bd = d; best = i; } });
      return best;
    }

    /** Every file of the KiCad project: { path: text } (paths inside the project's folder) */
    function kicadFiles() {
      const K = KicadExport, name = baseName(), T = topo(), side = boardSide(), M = side.full;
      const sheets = sheetsOf(), multi = sheets.length > 1;
      sheets.forEach((s, i) => {
        const f = s.frame, p = (f && f.params) || {};
        s.uuid = K.uuid("sheet:" + name + ":" + (f ? f.id : i)); s.file = multi ? `${name}-${i + 1}.kicad_sch` : name + ".kicad_sch";
        // the sheet's name: what its title adds to the others' ("…: power supply" → power supply)
        const sub = /:\s*([^:]+)$/.exec(p.title || ""), nm = (sub ? sub[1] : "").replace(/[/\\]/g, "-").trim();
        s.name = nm && !sheets.slice(0, i).some(o => o.name === nm) ? nm : "Sheet" + (i + 1); s.symbols = []; s.wires = []; s.junctions = []; s.labels = []; s.notes = [];
        s.title = { title: p.title || name, date: p.date, rev: p.rev, company: p.owner, comments: [p.docno, p.reference, p.creator ? "Drawn: " + p.creator : ""] };
      });
      const mm = (s, x, y) => [(x - s.ox) * K.UNIT + s.offX, (y - s.oy) * K.UNIT + s.offY];
      // pins to pads, and the board's parts by member id
      const padsOfPin = new Map(), groupOf = new Map();
      M.parts.forEach(g => g.members.forEach(m => groupOf.set(m.id, g)));
      M.pads.forEach(p => p.pins.forEach(c => { const k = c.comp + ":" + c.pin; if (!padsOfPin.has(k)) padsOfPin.set(k, []); padsOfPin.get(k).push(p); }));
      const netName = net => (net === 0 ? "GND" : M.names[net] || "N" + net);

      const symbols = [], libUsed = new Set();
      const uniqueLib = base => { let nm = K.libName(base), k = 2; while (libUsed.has(nm)) nm = K.libName(base) + "_" + k++; libUsed.add(nm); return nm; };
      const drawn = c => { const rec = new K.ShapeCanvas([K.UNIT, 0, 0, K.UNIT, -c.x * K.UNIT, -c.y * K.UNIT]); drawSymbol(rec, c); return rec; };
      // reference and value where the sheet writes them (cad-app.js drawComp): left of a mainly
      // vertical symbol, above a horizontal one, beside a valve's grid and a transistor's envelope
      const label = (c, b) => {
        if (c.type === "tube" && (c.rot & 1) === 0) {
          const side = ((c.rot & 2) ? -1 : 1) * (c.params.flip === "yes" ? -1 : 1), h = side > 0 ? "right" : "left";
          return { ref: [c.x - 30 * side, c.y - 28, h], value: [c.x - 30 * side, c.y - 15, h] };
        }
        if (CadLib.isTransistor(c.type)) {
          const bp = compPins(c).find(p => p.id === "B" || p.id === "G"), right = bp && bp.x < c.x - 5, tx = right ? b.x2 + 5 : b.x1 - 5, h = right ? "left" : "right";
          return { ref: [tx, c.y - 2, h], value: [tx, c.y + 11, h] };
        }
        const vertical = (b.y2 - b.y1) > (b.x2 - b.x1) * 1.2 && c.type !== "tube";
        return vertical ? { ref: [b.x1 - 5, c.y - 2, "right"], value: [b.x1 - 5, c.y + 11, "right"] } : { ref: [c.x, b.y1 - 17, "center"], value: [c.x, b.y1 - 5, "center"] };
      };
      // a box with a pin for each pad, a wire and its net's label (a valve's heater, a part only the
      // board has), in a row along the bottom of the sheet
      function boxUnit(s, pads, title) {
        // room on the left for the longest label (about 1.1 mm a character)
        const W = 15.24, h = Math.max(1, pads.length) * 2.54, room = 7.62 + Math.ceil(Math.max(0, ...pads.map(p => String(p.netName || "").length)) * 1.1 / 2.54 + 2) * 2.54;
        const x = (s.boxX || 12.7) + room, y = Math.round((s.paper.h - 38.1 - h) / 2.54) * 2.54;
        s.boxX = x + W + 7.62;
        const u = { shapes: [{ t: "poly", pts: [[0, -2.54], [W, -2.54], [W, h], [0, h], [0, -2.54]], fill: false }],
          texts: [{ x: W / 2, y: h / 2 - 1.27, text: title, size: 1.016, angle: 0, h: "center", v: "center" }], pins: [] };
        pads.forEach((pd, k) => {
          u.pins.push({ x: 0, y: k * 2.54, num: pd.num, name: pd.name });
          s.wires.push([x - 7.62, y + k * 2.54, x, y + k * 2.54]);
          if (pd.netName) { s.labels.push({ x: x - 7.62, y: y + k * 2.54, text: pd.netName, angle: 180, global: true }); globalNames.add(pd.netName); }
        });
        return { u, x, y, ref: { x: x + W / 2, y: y - 3.81, h: "center", v: "bottom" } };
      }
      const libOfGroup = new Map(), firstOf = new Map(), globalNames = new Set();
      let pwr = 0;
      S.comps.forEach(c => {
        const def = LIB[c.type]; if (!def || c.type === "frame") return;
        const b = compBBox(c), si = sheetIndex(sheets, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2), s = sheets[si], [x, y] = mm(s, c.x, c.y);
        if (c.type === "note") { const t = String(c.params.text || "").trim(); if (t) s.notes.push({ x, y, text: t, size: (+c.params.size || 12) * K.UNIT * 0.72 }); return; }
        const rec = drawn(c), pins = compPins(c), u = { shapes: rec.shapes, texts: rec.texts, pins: [] };
        const at = (px, py) => [(px - c.x) * K.UNIT, (py - c.y) * K.UNIT];
        if (POWER.has(c.type)) {
          // ground, rails and sheet connectors: power symbols, one net by name across the sheets
          const net = T.pinNet.get(c.id + ":" + pins[0].id), nm = c.type === "ground" ? "GND" : String(c.params.name || "").trim() || netName(net);
          pins.forEach(p => u.pins.push({ x: at(p.x, p.y)[0], y: at(p.x, p.y)[1], num: "1", name: nm, type: "power_in", hidden: true }));
          const lib = uniqueLib("PWR_" + nm + "_" + c.id), d = c.type === "ground" ? null : c.type === "rail" ? [[0, -1], [1, 0], [0, 1], [-1, 0]][c.rot & 3] : [[1, 0], [0, 1], [-1, 0], [0, -1]][c.rot & 3];
          symbols.push({ name: lib, power: true, ref: "#PWR", value: nm, inBom: false, onBoard: false, units: [u] });
          const vp = d ? mm(s, c.x + d[0] * 26, c.y + d[1] * 26 + (d[1] ? d[1] * 4 : 4)) : [x, y];
          s.symbols.push({ lib, unit: 1, x, y, uuid: K.uuid("pwr:" + c.id), ref: "#PWR" + String(++pwr).padStart(3, "0"), value: nm, inBom: false, onBoard: false,
            props: { ref: { x, y, hide: true }, value: { x: vp[0], y: vp[1], h: d && d[0] < 0 ? "right" : d && d[0] > 0 ? "left" : "center", hide: c.type === "ground" } }, pins: ["1"] });
          return;
        }
        const g = groupOf.get(c.id), members = g ? g.members : [{ id: c.id }], k = Math.max(0, members.findIndex(m => m.id === c.id));
        const lab = String(c.label || "").trim(), ref = g ? g.ref : (lab.replace(/\.\d+$/, "") || (def.prefix || "U") + "?");
        // the pins: the pads behind them (a pin on two pads is two pins on the same spot)
        pins.forEach(p => {
          const pads = padsOfPin.get(c.id + ":" + p.id) || [], [px, py] = at(p.x, p.y);
          if (pads.length) pads.forEach(pd => u.pins.push({ x: px, y: py, num: pd.num, name: p.name || p.id }));
          else u.pins.push({ x: px, y: py, num: members.length > 1 ? `${k + 1}.${p.id}` : p.id, name: p.name || p.id });
        });
        // one library symbol per part; the sections of a dual valve are its units
        let lib = g && libOfGroup.get(g.key);
        if (!lib) {
          lib = { name: uniqueLib(ref), ref: ref.replace(/\d+$/, "") || ref, value: g ? g.value : def.value ? def.value(c) : "", footprint: g && g.fp ? K.LIBNAME + ":" + K.fpName(g.fp) : "",
            inBom: !!g, onBoard: !!g, units: members.map(() => ({ shapes: [], texts: [], pins: [] })), description: def.name };
          symbols.push(lib); if (g) { libOfGroup.set(g.key, lib); firstOf.set(g.key, si); }
        }
        lib.units[k] = u;
        const L = label(c, b), P = ([px, py, h]) => { const [X, Y] = mm(s, px, py); return { x: X, y: Y, h, v: "bottom" }; };
        s.symbols.push({ lib: lib.name, unit: k + 1, x, y, uuid: K.symbolUuid(c.id), ref, value: lib.value || "~", footprint: lib.footprint, inBom: lib.inBom, onBoard: lib.onBoard,
          props: { ref: P(L.ref), value: P(L.value) }, pins: [...new Set(u.pins.map(p => p.num))] });
      });
      // pads the board wires that no symbol has a pin for (a valve's heater and internal shield):
      // one more unit of the part, as KiCad's own valve symbols keep the heater apart
      const pinIds = new Map(S.comps.map(c => [c.id, LIB[c.type] ? new Set(compPins(c).map(p => p.id)) : new Set()]));
      M.parts.forEach(g => {
        const lib = libOfGroup.get(g.key); if (!lib) return;
        const more = M.pads.filter(pd => pd.part === g.key && pd.pins.length && pd.pins.every(q => pinIds.has(q.comp) && !pinIds.get(q.comp).has(q.pin)));
        if (!more.length) return;
        const s = sheets[firstOf.get(g.key)], box = boxUnit(s, more.map(pd => ({ num: pd.num, name: pd.pins[0].pin, netName: pd.netName })), g.members.length > 1 ? "heaters" : "heater");
        lib.units.push(box.u);
        s.symbols.push({ lib: lib.name, unit: lib.units.length, x: box.x, y: box.y, uuid: K.uuid("sym:" + g.key + ":heater"), ref: g.ref, value: lib.value || "~", footprint: lib.footprint, inBom: true, onBoard: true,
          props: { ref: box.ref, value: { x: box.x, y: box.y, hide: true } }, pins: more.map(pd => pd.num) });
      });
      // parts only the board has (the heater supplies XH…, the star point XG…)
      const ids = new Set(S.comps.map(c => c.id));
      M.parts.filter(g => !g.members.some(m => ids.has(m.id)) && g.fp).forEach(g => {
        const s = sheets[0], box = boxUnit(s, g.fp.pads.map(pd => ({ num: pd.num, name: pd.name, netName: (M.pads.find(q => q.part === g.key && q.num === pd.num) || {}).netName })), g.value || g.ref);
        const lib = { name: uniqueLib(g.ref), ref: g.ref.replace(/\d+$/, ""), value: g.value, footprint: K.LIBNAME + ":" + K.fpName(g.fp), inBom: true, onBoard: true, units: [box.u], description: "On the board only (Board Design adds it)" };
        symbols.push(lib);
        s.symbols.push({ lib: lib.name, unit: 1, x: box.x, y: box.y, uuid: K.symbolUuid(g.members[0].id), ref: g.ref, value: g.value, footprint: lib.footprint, inBom: true, onBoard: true,
          props: { ref: box.ref, value: { x: box.x, y: box.y, hide: true } }, pins: g.fp.pads.map(pd => pd.num) });
      });
      // the nets the net classes name (power and high voltage): their board name on a label at one
      // of their pins, so the classes hold in KiCad. A label names a net on its own sheet only, so
      // KiCad calls it /<sheet>/<name> (/<name> on a single sheet): the board takes those names too
      const R = side.board.rules, hvSet = BoardCore.hvNets(side.netlist.volts, R.hvVolts), named = new Set(), rename = {};
      S.comps.forEach(c => { if (POWER.has(c.type)) compPins(c).forEach(p => named.add(T.pinNet.get(c.id + ":" + p.id))); });
      S.comps.forEach(c => {
        if (POWER.has(c.type) || !groupOf.has(c.id)) return;
        const b = compBBox(c), cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, s = sheets[sheetIndex(sheets, cx, cy)];
        compPins(c).forEach(p => {
          const net = T.pinNet.get(c.id + ":" + p.id);
          if (net === undefined || named.has(net)) return;
          // a net a board-only part or a heater box joins by its global label takes the same label here
          const nm = netName(net), glob = globalNames.has(nm);
          if (!glob && BoardCore.netClassOf(net, M.names, hvSet, R) === "Signal") return;
          named.add(net);
          const dx = p.x - cx, dy = p.y - cy, a = Math.abs(dx) >= Math.abs(dy) ? (dx > 0 ? 0 : 180) : (dy > 0 ? 270 : 90), [X, Y] = mm(s, p.x, p.y);
          s.labels.push({ x: X, y: Y, text: nm, angle: a, global: glob });
          if (glob) return;
          rename[nm] = (multi ? "/" + s.name + "/" : "/") + nm;
        });
      });
      S.wires.forEach(w => { const s = sheets[sheetIndex(sheets, (w.x1 + w.x2) / 2, (w.y1 + w.y2) / 2)]; s.wires.push([...mm(s, w.x1, w.y1), ...mm(s, w.x2, w.y2)]); });
      T.junctions.forEach(j => { const s = sheets[sheetIndex(sheets, j.x, j.y)]; s.junctions.push(mm(s, j.x, j.y)); });

      const files = {}, f0 = sheets[0].title;
      Object.assign(files, K.schematic({ name, title: { ...f0, title: multi ? String(f0.title).replace(/:\s*[^:]+$/, "") || name : f0.title }, symbols, sheets }));
      files[K.LIBNAME + ".kicad_sym"] = K.symbolLib(symbols);
      files["sym-lib-table"] = K.SYM_TABLE;
      if (side.placed) {
        const BC = BoardCore, model = side.placed, c0 = BC.connectivity(side.board, model.pads);
        const fills = (side.board.zones || []).length ? BC.fillZones(side.board, model, c0, hvSet, side.netlist, []) : [];
        const conn = fills.length ? BC.connectivity(side.board, model.pads, fills) : c0;
        const sheetOf = id => { if (!multi) return ""; const c = S.comps.find(x => x.id === id), b = c ? compBBox(c) : null; return b ? sheets[sheetIndex(sheets, (b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2)].uuid + "/" : ""; };
        files[name + ".kicad_pcb"] = K.pcb(side.board, model, conn, { title: f0.title, date: f0.date, rev: f0.rev, company: f0.company, version: String(VERSION).replace(/^\?v=/, ""), sheetOf, rename });
        files[name + ".kicad_dru"] = K.rules(side.board, model, hvSet, side.netlist, rename);
        Object.assign(files, K.footprintLib(model, side.board));
        files["fp-lib-table"] = K.FP_TABLE;
      }
      files[name + ".kicad_pro"] = K.project(name, side.board, side.placed || M, hvSet, rename);
      return files;
    }
    function exportKicad() {
      try {
        const files = kicadFiles(), name = baseName(), zipped = {};
        Object.entries(files).forEach(([p, t]) => { zipped[name + "/" + p] = t; });
        const bytes = BoardFab.zip(zipped), a = document.createElement("a");
        a.href = URL.createObjectURL(new Blob([bytes], { type: "application/zip" })); a.download = name + "-kicad.zip"; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
        const pcb = files[name + ".kicad_pcb"];
        setStatus("ok", `Saved ${name}-kicad.zip: the schematic${pcb ? " and the board" : " (no board yet: place the parts in Board Design to get a .kicad_pcb too)"}, ready to open in KiCad 7 or later`);
        return files;
      } catch (err) { setStatus("error", "KiCad export failed: " + err.message); throw err; }
    }
    return { exportKicad, kicadFiles };
  };
})(window);
