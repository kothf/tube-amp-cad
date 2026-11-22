/* Hierarchical sheets, built on the reusable blocks (cad-blocks.js).
   A block can be a sheet (def.sheet): its parts and wires are drawn on a sheet of their own,
   and on the sheet above it stands as a symbol, a box whose pins are the sheet's ports. Each
   symbol is one instance: it has a sheet (a drawing frame tagged frame.sheetOf = { i, d })
   holding that instance's own parts (tagged c.block = { i, d, m } like a block's copy), so the
   simulation, the board, the BOM and every export still see one flat circuit, each instance
   with designators of its own. A port (part `hport`) joins the pin of its name on its own
   instance's symbol (computeTopology in cad-app.js), so two channels stay apart.
   Everything on an instance's sheet belongs to it: a part dropped there joins it, a part
   dragged off leaves it. At every commit (beforeCommit, after the blocks' value sync):
     - the sheet that differs from the block (values, parts, places, wires, its frame's size)
       becomes the block, and every other instance's sheet is drawn again from it, keeping its
       part ids, designators and own values (a nested symbol's instance, a connector's name);
     - a symbol with no instance (just placed, pasted, or its sheet lost) gets a new sheet; a
       symbol with no block (placed from the parts panel) gets a new, empty one;
     - a sheet whose symbol is gone is deleted with what is on it (Undo brings both back);
     - each block's pins are worked out from its ports (def.sheet.pins: side and place along it,
       kept when a port moves, so the wires on the sheet above stay on their pins), and every
       symbol of the block gets them, with the box's size.
   Make sheet from selection turns a drawn stage into a sheet: the box round the selected parts
   becomes the symbol, each wire crossing the box's edge a port inside and a pin on the edge
   where the wire met it, so the wiring outside stays connected. */
(function (root) {
  "use strict";
  const clone = o => JSON.parse(JSON.stringify(o));
  const G = 20;                               // pins stand on a 20-unit pitch
  const up = v => Math.ceil(v / G) * G, down = v => Math.floor(v / G) * G;
  const SIDE_ROT = { L: 2, R: 0, T: 3, B: 1 };  // a port's rotation that points its flag out of that side

  function CadHier(cad) {
    const { S, LIB, compBBox, makeComp, newId, frames, fitSheet, setStatus, render, updateInspector, esc } = cad;
    const B = root.CadBlocks;
    const defOf = id => S.blocks.find(b => b.id === id);
    const isSheetDef = def => !!(def && def.sheet);
    const frameOf = inst => S.comps.find(c => c.type === "frame" && c.sheetOf && c.sheetOf.i === inst);
    const symOf = inst => S.comps.find(c => c.type === "sheetsym" && c.params.inst === inst);
    const instFrames = defId => S.comps.filter(c => c.type === "frame" && c.sheetOf && (!defId || c.sheetOf.d === defId));
    const portName = c => String((c && c.params.name) || "").trim();
    const upName = n => String(n || "").trim().toUpperCase();
    const uniqueName = base => { let n = base, k = 2; while (S.blocks.some(b => b.name === n)) n = base + " " + k++; return n; };

    // what lies on a frame: parts whose middle is inside it (not frames), wires with both ends inside
    function onFrame(f, comps, wires) {
      const b = compBBox(f), at = (x, y) => x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2;
      return {
        comps: (comps || S.comps).filter(c => c.type !== "frame" && (() => { const k = compBBox(c); return at((k.x1 + k.x2) / 2, (k.y1 + k.y2) / 2); })()),
        wires: (wires || S.wires).filter(w => at(w.x1, w.y1) && at(w.x2, w.y2))
      };
    }
    // the sheet sizes, smallest first, for a drawing of a given size (units)
    function frameFor(w, h) {
      for (const size of ["A4", "A3", "A2", "A1", "A0"]) {
        const g = CadLib.sheetGeom({ params: { size, orient: "landscape" } });
        if (w + 80 <= g.fx2 - g.fx1 && h + 80 <= g.tb.y1 - g.fy1) return { size, orient: "landscape", g };
      }
      return { size: "A0", orient: "landscape", g: CadLib.sheetGeom({ params: { size: "A0", orient: "landscape" } }) };
    }
    // a new frame for an instance, right of the last frame, with the first sheet's title block
    function newFrame(def, inst, title) {
      const list = frames(), last = list[list.length - 1], first = list.find(f => !f.sheetOf) || list[0];
      const base = first ? String(first.params.title || "").replace(/:\s*[^:]*$/, "") : "";
      const p = Object.assign({}, first ? first.params : { date: new Date().toISOString().slice(0, 10) }, { size: def.sheet.size || "A4", orient: def.sheet.orient || "landscape", sheet: "", locked: "yes", title: (base ? base + ": " : "") + title });
      let x = 0, y = 0;
      if (last) { const b = compBBox(last); x = Math.ceil((b.x2 + 100) / 100) * 100; y = first ? first.y : last.y; }
      const f = makeComp("frame", p, x, y, 0); f.x = x; f.y = y; f.sheetOf = { i: inst, d: def.id };
      S.comps.push(f);
      return f;
    }
    // designators for a new instance: each base (VL1 of VL1.1 and VL1.2) the next free number of its letters
    function labeller() {
      const top = new Map(), bases = new Map();
      const next = prefix => {
        if (!top.has(prefix)) { let n = 0; const re = new RegExp("^" + prefix + "(\\d+)(\\.|$)"); S.comps.forEach(c => { const m = re.exec(c.label || ""); if (m) n = Math.max(n, +m[1]); }); top.set(prefix, n); }
        top.set(prefix, top.get(prefix) + 1); return prefix + top.get(prefix);
      };
      return label => { const m = /^([A-Za-z]+)(\d+)(\..+)?$/.exec(label || ""); if (!m) return null; const base = m[1] + m[2]; if (!bases.has(base)) bases.set(base, next(m[1])); return bases.get(base) + (m[3] || ""); };
    }
    // an instance's sheet drawn from its block at the frame; reuse: member → the part it replaces
    function stamp(def, inst, f, reuse, k) {
      const label = labeller(), renames = new Map();
      def.comps.forEach(dm => {
        if (!LIB[dm.type]) return;
        const c = makeComp(dm.type, dm.params, f.x + dm.x, f.y + dm.y, dm.rot);
        c.params = Object.assign({}, LIB[dm.type].defaults, clone(dm.params));
        const old = reuse && reuse.get(dm.m);
        if (old && old.type === dm.type) { c.id = old.id; c.label = old.label; Object.assign(c.params, B.ownOf(c.type, old.params)); }
        else {
          if (c.label) c.label = label(dm.label) || c.label;
          if (c.type === "sheetsym") c.params.inst = "";
          // a new instance's sheet connectors get names of their own (NFB → NFB_2), supplies stay shared
          if (c.type === "offsheet" && k) c.params.name = B.copyName(renames, c.params.name, k, S.comps);
        }
        c.block = { i: inst, d: def.id, m: dm.m };
        S.comps.push(c);
      });
      def.wires.forEach(w => S.wires.push({ id: newId("w"), x1: w.x1 + f.x, y1: w.y1 + f.y, x2: w.x2 + f.x, y2: w.y2 + f.y }));
    }
    // the sheet's drawing as text, to tell instances apart from their block: parts by member,
    // place (from the frame's corner), turn and shared values; wires as unit pieces of the grid
    function wireKey(ws, ox, oy) {
      const out = [];
      ws.forEach(w => {
        const x1 = w.x1 - ox, y1 = w.y1 - oy, x2 = w.x2 - ox, y2 = w.y2 - oy;
        if ((x1 === x2 || y1 === y2) && [x1, y1, x2, y2].every(v => v % 10 === 0)) {
          const n = Math.abs(x2 - x1 + y2 - y1) / 10, sx = Math.sign(x2 - x1), sy = Math.sign(y2 - y1);
          for (let k = 0; k < n; k++) { const a = [x1 + sx * k * 10, y1 + sy * k * 10], b = [x1 + sx * (k + 1) * 10, y1 + sy * (k + 1) * 10]; out.push(a < b ? a + ";" + b : b + ";" + a); }
        } else out.push([x1, y1, x2, y2].join(","));
      });
      return [...new Set(out)].sort().join("|");
    }
    const compKey = (m, type, x, y, rot, params) => `${m}|${type}|${x}|${y}|${rot || 0}|${B.canon(B.shared(type, params))}`;
    function sigOfDef(def) {
      return def.comps.map(dm => compKey(dm.m, dm.type, dm.x, dm.y, dm.rot, Object.assign({}, (LIB[dm.type] || {}).defaults, dm.params))).sort().join("\n") + "\n#" + wireKey(def.wires, 0, 0) + "\n@" + (def.sheet.size || "A4") + (def.sheet.orient || "landscape");
    }
    function sigOfInst(f, on) {
      return on.comps.filter(c => c.block && c.block.i === f.sheetOf.i).map(c => compKey(c.block.m, c.type, c.x - f.x, c.y - f.y, c.rot, c.params)).sort().join("\n") + "\n#" + wireKey(on.wires, f.x, f.y) + "\n@" + (f.params.size || "A4") + (f.params.orient || "landscape");
    }

    // ---------------------------------------------------------------------------
    // The work at every commit
    // ---------------------------------------------------------------------------
    // a symbol's chain of sheets up to the top: the blocks it lies inside
    function ancestors(c) {
      const out = []; let cur = c, n = 0;
      while (cur && cur.block && n++ < 20) {
        const def = defOf(cur.block.d); if (!isSheetDef(def)) break;
        out.push(def.id);
        cur = symOf(cur.block.i);
      }
      return out;
    }
    // symbols without a block or an instance get them; a symbol inside its own sheet is refused
    function ensure() {
      let changed = false, guard = 0, refused = "";
      for (let k = 0; k < S.comps.length && guard < 500; k++) {
        const c = S.comps[k];
        if (c.type !== "sheetsym") continue;
        let def = defOf(c.params.def);
        if (!isSheetDef(def)) {
          def = { id: newId("b"), name: uniqueName(String(c.params.name || "").trim() || "Sheet"), comps: [], wires: [], next: 1, sheet: { w: +c.params.w || 160, h: +c.params.h || 100, pins: [], size: "A4", orient: "landscape" } };
          S.blocks.push(def); c.params.def = def.id; c.params.name = def.name; changed = true;
        }
        if (ancestors(c).includes(def.id)) { refused = def.name; S.comps.splice(k, 1); k--; changed = true; continue; }
        const inst = c.params.inst, f = inst && frameOf(inst);
        const dup = inst && S.comps.some((o, j) => j < k && o.type === "sheetsym" && o.params.inst === inst);
        if (!f || dup) {
          const ni = newId("i"), nf = newFrame(def, ni, `${def.name}${c.params.title ? " (" + c.params.title + ")" : ""}`);
          stamp(def, ni, nf, null, instFrames(def.id).length);
          c.params.inst = ni; changed = true; guard++;
        }
      }
      if (refused) setStatus("warn", `A sheet cannot hold its own symbol (“${refused}” inside itself): that symbol was taken out.`);
      return changed;
    }
    // sheets whose symbol is gone go, with what is on them
    function collect() {
      let any = true, n = 0;
      while (any && n++ < 20) {
        any = false;
        instFrames().forEach(f => {
          if (symOf(f.sheetOf.i)) return;
          const on = onFrame(f), gone = new Set(on.comps.map(c => c.id).concat([f.id])), gw = new Set(on.wires.map(w => w.id));
          S.comps = S.comps.filter(c => !gone.has(c.id)); S.wires = S.wires.filter(w => !gw.has(w.id));
          any = true;
        });
      }
    }
    // what is on an instance's sheet belongs to it
    function tag() {
      instFrames().forEach(f => {
        const def = defOf(f.sheetOf.d); if (!isSheetDef(def)) return;
        const inst = f.sheetOf.i, on = onFrame(f), here = new Set(on.comps.map(c => c.id));
        on.comps.forEach(c => {
          if (c.block && c.block.i === inst) return;
          const other = c.block && defOf(c.block.d);
          if (other && !isSheetDef(other)) return;          // a copy of a plain block placed here keeps its own block
          def.next = def.next || 1;
          c.block = { i: inst, d: def.id, m: "m" + def.next++ };
        });
        S.comps.forEach(c => { if (c.block && c.block.i === inst && !here.has(c.id)) delete c.block; });
      });
    }
    // the instance that changed becomes the block; the others are drawn again from it
    function structure(preferred) {
      let changed = false;
      S.blocks.filter(isSheetDef).forEach(def => {
        const list = instFrames(def.id); if (!list.length) return;
        const ref = sigOfDef(def), ons = new Map(list.map(f => [f.id, onFrame(f)]));
        const differ = list.filter(f => sigOfInst(f, ons.get(f.id)) !== ref);
        if (!differ.length) return;
        const holds = f => { const on = ons.get(f.id); return on.comps.some(c => preferred.comps.has(c.id)) || on.wires.some(w => preferred.wires.has(w.id)); };
        const src = differ.find(holds) || differ[0], on = ons.get(src.id), inst = src.sheetOf.i;
        def.comps = on.comps.filter(c => c.block && c.block.i === inst).map(c => ({ m: c.block.m, type: c.type, x: c.x - src.x, y: c.y - src.y, rot: c.rot || 0, label: c.label || "", params: clone(c.params) }));
        def.wires = on.wires.map(w => ({ x1: w.x1 - src.x, y1: w.y1 - src.y, x2: w.x2 - src.x, y2: w.y2 - src.y }));
        def.sheet.size = src.params.size; def.sheet.orient = src.params.orient;
        const now = sigOfDef(def);
        list.forEach(f => {
          if (f === src || sigOfInst(f, ons.get(f.id)) === now) return;
          const o = ons.get(f.id), mine = o.comps.filter(c => c.block && c.block.i === f.sheetOf.i);
          const reuse = new Map(mine.map(c => [c.block.m, c])), gone = new Set(o.comps.map(c => c.id)), gw = new Set(o.wires.map(w => w.id));
          S.comps = S.comps.filter(c => !gone.has(c.id)); S.wires = S.wires.filter(w => !gw.has(w.id));
          f.params.size = def.sheet.size; f.params.orient = def.sheet.orient;
          stamp(def, f.sheetOf.i, f, reuse);
        });
        changed = true;
      });
      return changed;
    }
    // each block's pins from its ports, and every symbol of it brought up to date
    function pins() {
      S.blocks.filter(isSheetDef).forEach(def => {
        const sh = def.sheet;
        sh.pins = Array.isArray(sh.pins) ? sh.pins : [];
        const ports = def.comps.filter(c => c.type === "hport");
        // a pin made by Make sheet names its port by part id until the port has its member key
        sh.pins.forEach(p => { if (!p.m && p.cid) { const c = S.comps.find(k => k.id === p.cid && k.block && k.block.d === def.id); if (c) { p.m = c.block.m; delete p.cid; } } });
        const seen = new Set(), keep = [];
        ports.forEach(pt => {
          const n = upName(pt.params.name); if (!n || seen.has(n)) return; seen.add(n);
          const want = pt.params.side && pt.params.side !== "auto" ? pt.params.side : null;
          let p = sh.pins.find(q => q.m === pt.m);
          if (p && want && p.s !== want) p = null;
          keep.push(p ? { ...p } : { m: pt.m, s: want || (pt.params.dir === "out" ? "R" : "L"), a: null });
        });
        // a new pin takes the next free place on its side (a 20-unit pitch, from the top or the left)
        keep.forEach(p => {
          if (p.a !== null && p.a !== undefined) return;
          const used = new Set(keep.filter(q => q !== p && q.s === p.s && q.a !== null).map(q => q.a));
          let a = G; while (used.has(a)) a += G;
          p.a = a;
        });
        sh.pins = keep;
        // the box: room for every pin and for the names beside them
        const longest = Math.max(0, ...ports.map(pt => portName(pt).length));
        const side = s => Math.max(0, ...keep.filter(p => p.s === s).map(p => p.a));
        sh.h = Math.max(+sh.h || 0, up(Math.max(side("L"), side("R")) + G), sh.fixed ? 0 : 60);
        // (the names widen only a box drawn empty: one made from a drawing keeps its pins where the wires are)
        sh.w = Math.max(+sh.w || 0, up(Math.max(side("T"), side("B")) + G), sh.fixed ? 0 : up(longest * 6 * (keep.some(p => p.s === "L") && keep.some(p => p.s === "R") ? 2 : 1) + 40), sh.fixed ? 0 : 100);
        const list = keep.map(p => { const pt = ports.find(q => q.m === p.m); return { n: portName(pt), s: p.s, a: p.a, d: pt.params.dir }; });
        S.comps.forEach(c => {
          if (c.type !== "sheetsym" || c.params.def !== def.id) return;
          c.params.name = def.name; c.params.w = sh.w; c.params.h = sh.h; c.params.pins = clone(list);
        });
        def.comps.forEach(dm => { if (dm.type === "sheetsym") { const d2 = defOf(dm.params.def); if (isSheetDef(d2)) Object.assign(dm.params, { name: d2.name, w: d2.sheet.w, h: d2.sheet.h }); } });
      });
    }
    /** Before every snapshot (cad-app.js commit, after the blocks' value sync) */
    function beforeCommit(preferred) {
      if (!S.comps.some(c => c.type === "sheetsym") && !instFrames().length) return false;
      const pref = preferred || { comps: S.sel.comps, wires: S.sel.wires };
      for (let pass = 0; pass < 4; pass++) {
        collect();
        tag();
        if (S.blocks.length) B.sync(S.blocks.filter(isSheetDef), S.comps, pref.comps);
        const a = structure(pref), b = ensure();
        pins();
        if (!a && !b) break;
      }
      // a sheet's frame says where it sits: "Sheet 3 · Channel (L) in sheet 1"
      instFrames().forEach(f => { const def = defOf(f.sheetOf.d), sym = symOf(f.sheetOf.i); if (def && sym) f.sheetOf.t = def.name + (sym.params.title ? " (" + sym.params.title + ")" : ""); });
      return true;
    }

    // ---------------------------------------------------------------------------
    // Commands
    // ---------------------------------------------------------------------------
    // the frame a point or part is on
    const frameAt = (x, y) => frames().find(f => { const b = compBBox(f); return x >= b.x1 && x <= b.x2 && y >= b.y1 && y <= b.y2; });
    const frameOfComp = c => { const b = compBBox(c); return frameAt((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2); };
    /** Step into a symbol's sheet (double-click, Open sheet) */
    function enter(c) {
      if (!c || c.type !== "sheetsym") return false;
      const f = frameOf(c.params.inst); if (!f) return false;
      S.sel.comps.clear(); S.sel.wires.clear();
      fitSheet(f); updateInspector(); render();
      const n = instFrames(c.params.def).length;
      setStatus("ok", `Sheet “${c.params.name}”${c.params.title ? " (" + c.params.title + ")" : ""}${n > 1 ? `, instance ${instFrames(c.params.def).indexOf(f) + 1} of ${n}: a change here goes to every instance` : ""}. Alt+Backspace goes back up.`);
      return true;
    }
    /** Step out to the sheet holding this sheet's symbol (Alt+Backspace) */
    function leave(f) {
      f = f || cad.currentSheet();
      if (!f || !f.sheetOf) { setStatus("warn", "This is a top sheet: there is no sheet above it."); return false; }
      const sym = symOf(f.sheetOf.i), pf = sym && frameOfComp(sym);
      if (!sym) return false;
      S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(sym.id);
      if (pf) fitSheet(pf); updateInspector(); render();
      setStatus("ok", `Back on the sheet above, at “${sym.params.name}”${sym.params.title ? " (" + sym.params.title + ")" : ""}.`);
      return true;
    }
    // the sheet a part of an instance is on, from any of its parts
    const instOfComp = c => (c && c.block && isSheetDef(defOf(c.block.d)) ? c.block.i : null);
    /** Make sheet from selection: the selected parts and their wires move to a sheet of their own;
        a symbol takes their place, with a pin wherever a wire crossed the box round them */
    function makeFromSelection(name) {
      const comps = S.comps.filter(c => S.sel.comps.has(c.id) && c.type !== "frame");
      if (!comps.length) { setStatus("warn", "Select the parts of the stage first (drag a box round them), then make a sheet of them."); return null; }
      let x1, y1, x2, y2;
      const inBox = (x, y) => x > x1 && x < x2 && y > y1 && y < y2;
      // the box round the selection; a part standing in it (its middle inside) goes along, and
      // the box grows round it, until nothing more is under it
      for (let pass = 0; pass < 10; pass++) {
        x1 = Infinity; y1 = Infinity; x2 = -Infinity; y2 = -Infinity;
        comps.forEach(c => { const b = compBBox(c); x1 = Math.min(x1, b.x1); y1 = Math.min(y1, b.y1); x2 = Math.max(x2, b.x2); y2 = Math.max(y2, b.y2); });
        x1 = down(x1 - 10); y1 = down(y1 - 10); x2 = up(x2 + 10); y2 = up(y2 + 10);
        const more = S.comps.filter(c => c.type !== "frame" && !comps.includes(c) && (() => { const b = compBBox(c); return inBox((b.x1 + b.x2) / 2, (b.y1 + b.y2) / 2); })());
        if (!more.length) break;
        comps.push(...more);
      }
      // a part left outside with a pin inside the box would lose its wires: say which, change nothing
      const caught = S.comps.filter(c => c.type !== "frame" && !comps.includes(c) && cad.compPins(c).some(p => inBox(p.x, p.y)));
      if (caught.length) { setStatus("warn", `${caught.map(c => c.label || (c.params && c.params.name ? `${LIB[c.type].name} ${c.params.name}` : LIB[c.type].name)).slice(0, 4).join(", ")}${caught.length > 4 ? "…" : ""} reach${caught.length === 1 ? "es" : ""} into the box round the selection: select ${caught.length === 1 ? "it" : "them"} too, or move ${caught.length === 1 ? "it" : "them"} clear, then make the sheet.`); return null; }
      const T = cad.topo(), crossings = [], inner = [], keepW = [];
      // every wire cut where it crosses the box's edge (one passing right through, a ground bus
      // with the stage's wires tapping it, is cut twice); a piece inside goes to the sheet, and
      // where it meets the edge it gets a port
      const onEdge = (x, y) => (x === x1 || x === x2) && y >= y1 && y <= y2 || (y === y1 || y === y2) && x >= x1 && x <= x2;
      S.wires.forEach(w => {
        const h = w.y1 === w.y2, v = w.x1 === w.x2;
        let pts = [[w.x1, w.y1], [w.x2, w.y2]];
        if (h && !v && w.y1 > y1 && w.y1 < y2) { const lo = Math.min(w.x1, w.x2), hi = Math.max(w.x1, w.x2); pts = [[lo, w.y1]].concat([x1, x2].filter(x => x > lo && x < hi).map(x => [x, w.y1]), [[hi, w.y1]]); }
        else if (v && !h && w.x1 > x1 && w.x1 < x2) { const lo = Math.min(w.y1, w.y2), hi = Math.max(w.y1, w.y2); pts = [[w.x1, lo]].concat([y1, y2].filter(y => y > lo && y < hi).map(y => [w.x1, y]), [[w.x1, hi]]); }
        for (let k = 1; k < pts.length; k++) {
          const a = pts[k - 1], b = pts[k], piece = { id: k === 1 ? w.id : newId("w"), x1: a[0], y1: a[1], x2: b[0], y2: b[1] };
          if (inBox((a[0] + b[0]) / 2, (a[1] + b[1]) / 2)) {
            inner.push(piece);
            [a, b].forEach(P => { if (onEdge(P[0], P[1]) && !crossings.some(c => c.P[0] === P[0] && c.P[1] === P[1])) crossings.push({ P, s: P[0] === x1 ? "L" : P[0] === x2 ? "R" : P[1] === y1 ? "T" : "B", net: T.wireNet.get(w.id) }); });
          } else keepW.push(piece);
        }
      });
      // which crossings need a port: the pieces inside (and outside) are grouped by what joins
      // them on their own side; a group already tied to ground, or to a connector name, on both
      // sides needs none (those join everywhere), and one group needs one port however many
      // times its wires cross the edge
      const groups = (ws, cs) => {
        const up = new Map(), find = k => { let r = k; while (up.has(r) && up.get(r) !== r) r = up.get(r); if (!up.has(k)) up.set(k, k); return r; }, join = (a, b) => { const ra = find(a), rb = find(b); if (ra !== rb) up.set(ra, rb); };
        const K = (x, y) => x + "," + y, tags = new Map(), tag = (k, t) => { const r = find(k); if (!tags.has(r)) tags.set(r, new Set()); tags.get(r).add(t); };
        ws.forEach(w => join(K(w.x1, w.y1), K(w.x2, w.y2)));
        cs.forEach(c => cad.compPins(c).forEach(p => find(K(p.x, p.y))));
        const T2 = new Map();
        cs.forEach(c => { const p = cad.compPins(c)[0]; if (!p) return; if (c.type === "ground") T2.set(K(p.x, p.y), "\u0000gnd"); else if (c.type === "offsheet" && String(c.params.name || "").trim()) T2.set(K(p.x, p.y), "\u0000os:" + upName(c.params.name)); else if (c.type === "netlabel" && String(c.params.name || "").trim()) T2.set(K(p.x, p.y), "\u0000nl:" + upName(c.params.name)); });
        T2.forEach((t, k) => tag(k, t));
        return { root: (x, y) => find(K(x, y)), tags: (x, y) => { const r = find(K(x, y)); const out = new Set(); tags.forEach((v, k) => { if (find(k) === r) v.forEach(t => out.add(t)); }); return out; } };
      };
      const gndNets = new Set(S.comps.filter(c => c.type === "ground").map(c => T.pinNet.get(c.id + ":G")));
      const gin = groups(inner, comps), gout = groups(keepW, S.comps.filter(c => c.type !== "frame" && !comps.includes(c)));
      const seenGroup = new Map(), dropped = [], outerPinAt = new Set(S.comps.filter(c => c.type !== "frame" && !comps.includes(c)).flatMap(c => cad.compPins(c).map(p => p.x + "," + p.y)));
      for (let k = crossings.length - 1; k >= 0; k--) {
        const cr = crossings[k], ti = gin.tags(cr.P[0], cr.P[1]), to = gout.tags(cr.P[0], cr.P[1]);
        // a wire inside that merely ends on the edge, with nothing outside, crosses nothing
        if (!keepW.some(w => (w.x1 === cr.P[0] && w.y1 === cr.P[1]) || (w.x2 === cr.P[0] && w.y2 === cr.P[1])) && !outerPinAt.has(cr.P[0] + "," + cr.P[1])) { crossings.splice(k, 1); continue; }
        if ([...ti].some(t => to.has(t))) { dropped.push([cr.P, true, true]); crossings.splice(k, 1); continue; }
        // a piece of the ground net is tied to ground by a ground symbol of its own, not a port
        if (gndNets.has(cr.net)) { cr.gnd = true; cr.gin = !ti.has("\u0000gnd"); cr.gout = !to.has("\u0000gnd"); continue; }
        cr.group = gin.root(cr.P[0], cr.P[1]) + "|" + gout.root(cr.P[0], cr.P[1]);
      }
      const extra = [];
      const grounds = crossings.filter(cr => cr.gnd);
      grounds.forEach(cr => dropped.push([cr.P, !cr.gin, !cr.gout]));
      grounds.forEach(cr => crossings.splice(crossings.indexOf(cr), 1));
      crossings.forEach(cr => { if (seenGroup.has(cr.group)) extra.push(cr); else seenGroup.set(cr.group, cr); });
      extra.forEach(cr => { dropped.push([cr.P, true, true]); crossings.splice(crossings.indexOf(cr), 1); });
      // where no port is made, the wire running up to the edge now ends in nothing: take it away
      // back to where it meets something (a dead end carries nothing, so this is always safe)
      const pinsAt = cs => new Set(cs.flatMap(c => cad.compPins(c).map(p => p.x + "," + p.y)));
      const trim = (list, pins, P) => {
        let at = P[0] + "," + P[1];
        const touching = pt => list.filter(w => w.x1 + "," + w.y1 === pt || w.x2 + "," + w.y2 === pt);
        for (let n = 0; n < 50 && !pins.has(at); n++) {
          const ends = touching(at); if (ends.length !== 1) break;
          const w = ends[0]; list.splice(list.indexOf(w), 1);
          at = w.x1 + "," + w.y1 === at ? w.x2 + "," + w.y2 : w.x1 + "," + w.y1;
        }
        if (pins.has(at)) stops.push([list, at]);
      };
      const stops = [];
      const pinsIn = pinsAt(comps), pinsOut = pinsAt(S.comps.filter(c => c.type !== "frame" && !comps.includes(c)));
      dropped.forEach(([P, tin, tout]) => { if (tin) trim(inner, pinsIn, P); if (tout) trim(keepW, pinsOut, P); });
      // a ground symbol whose wires were all taken away goes too
      stops.forEach(([list, at]) => {
        if (list.some(w => w.x1 + "," + w.y1 === at || w.x2 + "," + w.y2 === at)) return;
        const here = S.comps.filter(c => c.type !== "frame" && cad.compPins(c).some(p => p.x + "," + p.y === at));
        if (here.length === 1 && here[0].type === "ground") { S.comps.splice(S.comps.indexOf(here[0]), 1); const i = comps.indexOf(here[0]); if (i >= 0) comps.splice(i, 1); }
      });
      // port names: the net's own name, else the pin it reaches inside, else P1, P2…
      const named = new Map();
      S.comps.forEach(c => { if ((c.type === "offsheet" || c.type === "rail") && String(c.params.name || "").trim()) named.set(T.pinNet.get(c.id + ":1"), String(c.params.name).trim()); });
      S.comps.forEach(c => { const n = T.pinNet.get(c.id + ":1"); if (c.type === "netlabel" && String(c.params.name || "").trim() && !named.has(n)) named.set(n, String(c.params.name).trim()); });
      const used = new Set(), nameFor = (cr, k) => {
        let n = named.get(cr.net);
        if (!n) {
          const pin = comps.flatMap(c => cad.compPins(c).map(p => ({ c, p }))).find(q => T.pinNet.get(q.c.id + ":" + q.p.id) === cr.net);
          n = pin ? `${pin.c.label || LIB[pin.c.type].name}.${pin.p.name || pin.p.id}` : "P" + (k + 1);
        }
        n = n.replace(/\s+/g, "_"); let u = n, j = 2; while (used.has(upName(u))) u = n + "_" + j++; used.add(upName(u));
        return u;
      };
      // the new sheet: big enough for the stage, the stage in its middle
      const fit = frameFor(x2 - x1, y2 - y1);
      const def = { id: newId("b"), name: uniqueName(String(name || "").trim() || "Sheet"), comps: [], wires: [], next: 1, sheet: { w: x2 - x1, h: y2 - y1, pins: [], size: fit.size, orient: fit.orient, fixed: true } };
      const inst = newId("i"), f = newFrame(def, inst, def.name);
      const g = fit.g, dx = Math.round((f.x + (g.fx1 + g.fx2) / 2 - (x1 + x2) / 2) / G) * G, dy = Math.round((f.y + (g.fy1 + g.tb.y1) / 2 - (y1 + y2) / 2) / G) * G;
      S.blocks.push(def);
      comps.forEach(c => { c.x += dx; c.y += dy; });
      inner.forEach(w => { w.x1 += dx; w.y1 += dy; w.x2 += dx; w.y2 += dy; });
      S.wires = keepW.concat(inner);
      crossings.forEach((cr, k) => {
        const n = nameFor(cr, k);
        const port = makeComp("hport", { name: n, dir: cr.s === "R" ? "out" : cr.s === "L" ? "in" : "bi", side: cr.s }, cr.P[0] + dx, cr.P[1] + dy, SIDE_ROT[cr.s]);
        port.x = cr.P[0] + dx; port.y = cr.P[1] + dy;
        S.comps.push(port);
        def.sheet.pins.push({ cid: port.id, s: cr.s, a: cr.s === "L" || cr.s === "R" ? cr.P[1] - y1 : cr.P[0] - x1 });
      });
      const gseen = new Set();
      const ground = (x, y) => { const g = makeComp("ground", {}, 0, 0, 0), p0 = cad.compPins(g)[0]; g.x += x - p0.x; g.y += y - p0.y; S.comps.push(g); };
      grounds.forEach(cr => {
        const ki = "i" + gin.root(cr.P[0], cr.P[1]), ko = "o" + gout.root(cr.P[0], cr.P[1]);
        if (cr.gin && !gseen.has(ki)) { gseen.add(ki); ground(cr.P[0] + dx, cr.P[1] + dy); }
        if (cr.gout && !gseen.has(ko)) { gseen.add(ko); ground(cr.P[0], cr.P[1]); }
      });
      const sym = makeComp("sheetsym", { def: def.id, inst, name: def.name, title: "", w: x2 - x1, h: y2 - y1, pins: [] }, x1, y1, 0);
      sym.x = x1; sym.y = y1;
      // inside another instance's sheet the symbol belongs to that instance (a nested sheet)
      S.comps.push(sym);
      S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(sym.id);
      cad.commit();
      const through = keepW.filter(w => { const lo = [Math.min(w.x1, w.x2), Math.min(w.y1, w.y2)], hi = [Math.max(w.x1, w.x2), Math.max(w.y1, w.y2)]; return hi[0] > x1 && lo[0] < x2 && hi[1] > y1 && lo[1] < y2; }).length;
      setStatus(through ? "warn" : "ok", `Sheet “${def.name}”: ${comps.length} part(s) on a sheet of their own, ${crossings.length} port(s) where wires crossed its edge${grounds.length ? ", ground tied by ground symbols on the sheet" : ""}. Double-click the symbol to step in; Edit ▾ → Blocks… places more instances.` + (through ? ` ${through} wire(s) pass under the symbol without joining it: move them clear.` : ""));
      return def;
    }
    /** Place another instance: a symbol of the block where the pointer clicks */
    function dropSymbol(def, wx, wy) {
      const w = def.sheet.w || 160, h = def.sheet.h || 100, x = Math.round((wx - w / 2) / G) * G, y = Math.round((wy - h / 2) / G) * G;
      const n = instFrames(def.id).length;
      const sym = makeComp("sheetsym", { def: def.id, inst: "", name: def.name, title: n ? String.fromCharCode(65 + n) : "", w, h, pins: [] }, x, y, 0);
      sym.x = x; sym.y = y;
      S.comps.push(sym);
      S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(sym.id);
      cad.commit();
      setStatus("ok", `Instance ${n + 1} of “${def.name}” placed, with a sheet of its own (designators numbered on). Name it in the inspector (Left, Right…).`);
    }
    function drawGhost(def, ctx, wx, wy) {
      const w = def.sheet.w || 160, h = def.sheet.h || 100, x = Math.round((wx - w / 2) / G) * G, y = Math.round((wy - h / 2) / G) * G;
      ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = "#3fb950"; ctx.lineWidth = 2; ctx.strokeRect(x, y, w, h);
      ctx.fillStyle = "#3fb950"; ctx.font = "11px system-ui, sans-serif"; ctx.fillText(def.name, x, y - 4); ctx.restore();
    }

    // ---------------------------------------------------------------------------
    // Inspector and sheet list
    // ---------------------------------------------------------------------------
    function inspector(host, c) {
      const box = document.createElement("div");
      box.className = "insp-block";
      if (c.type === "sheetsym") {
        const def = defOf(c.params.def), all = def ? instFrames(def.id) : [], f = frameOf(c.params.inst), no = all.indexOf(f) + 1;
        box.innerHTML = `<div class="insp-sub">Hierarchical sheet</div>
          <p class="insp-help"><b>${esc(c.params.name || "")}</b>${all.length > 1 ? ` · <span>instance ${no} of ${all.length}</span>` : ""} · <span>${(c.params.pins || []).length} pin(s)</span></p>
          <p class="insp-help">One pin for each port on its sheet. Its parts have designators of their own; a change on any instance's sheet changes every instance.</p>
          <div class="insp-block-btns"><button class="btn" data-a="open" title="Show this instance's sheet (double-click the symbol; Alt+Backspace comes back)">Open sheet</button><button class="btn" data-a="more" title="One more symbol of this sheet, with a sheet and parts of its own (a second channel)">Place another instance</button><button class="btn" data-a="list" title="Every block and sheet of the circuit">Blocks…</button></div>`;
        box.querySelector('[data-a="open"]').addEventListener("click", () => enter(c));
        box.querySelector('[data-a="more"]').addEventListener("click", () => { if (def) cad.startPlace(def.id); });
        box.querySelector('[data-a="list"]').addEventListener("click", () => cad.openBlocks());
      } else {
        const inst = instOfComp(c); if (!inst) return false;
        const def = defOf(c.block.d), all = instFrames(def.id), no = all.indexOf(frameOf(inst)) + 1, sym = symOf(inst);
        box.innerHTML = `<div class="insp-sub">Hierarchical sheet</div>
          <p class="insp-help"><b>${esc(def.name)}</b>${sym && sym.params.title ? " (" + esc(sym.params.title) + ")" : ""}${all.length > 1 ? ` · <span>instance ${no} of ${all.length}</span>` : ""}</p>
          <p class="insp-help">A value, part or wire changed here changes on every instance's sheet; the designator is this instance's own.</p>
          <div class="insp-block-btns"><button class="btn" data-a="up" title="The sheet above, with this sheet's symbol selected (Alt+Backspace)">Up to the sheet above</button></div>`;
        box.querySelector('[data-a="up"]').addEventListener("click", () => leave(frameOf(inst)));
      }
      host.appendChild(box);
      return true;
    }
    // how deep a frame sits: 0 for a top sheet
    function depth(f) { let d = 0, cur = f; while (cur && cur.sheetOf && d < 10) { const s = symOf(cur.sheetOf.i); cur = s && frameOfComp(s); d++; } return d; }
    return { beforeCommit, enter, leave, makeFromSelection, dropSymbol, drawGhost, inspector, depth, isSheetDef, instFrames, frameOf, symOf, instOfComp, onFrame, sigOfDef, sigOfInst };
  }
  root.CadHier = CadHier;
})(typeof window !== "undefined" ? window : globalThis);
