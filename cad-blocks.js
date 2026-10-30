/* Reusable blocks: a stage or a whole channel saved as a block and placed as many times as
   needed (the two channels of a stereo amplifier). Each copy is ordinary parts and wires on the
   sheet, so the simulation, the board, the BOM and every export see a flat circuit; the parts
   carry a tag, c.block = { i: copy, d: block, m: member }, and the circuit keeps the blocks
   themselves (S.blocks, saved in the file as `blocks`): each part's type, values, place and turn
   relative to the block's corner, and its wires.
   Editing once updates every copy: a value changed on a part of any copy goes to the same part
   of every other copy at the next commit (`sync`). A changed drawing (a part added, moved or
   rewired) goes to the others with Update block from selection: the selected copy becomes the
   block, and every other copy is drawn again from it where it stands, keeping its designators,
   its part ids (so the board keeps their places) and its own sheet-connector names.
   A sheet connector's name is each copy's own (PER_COPY): two channels must not join through
   their connectors, so rename them per copy. Blocks can also be kept in this browser's library
   (localStorage) for other circuits. */
(function (root) {
  "use strict";
  const LIB_KEY = "tubecad_blocks_v1";
  // values each copy keeps for itself: a sheet connector's signal name
  const PER_COPY = { offsheet: ["name"] };
  const clone = o => JSON.parse(JSON.stringify(o));
  const floor10 = v => Math.floor(v / 10) * 10;
  // JSON with sorted keys, so the same values always give the same text
  function canon(o) {
    if (Array.isArray(o)) return "[" + o.map(canon).join(",") + "]";
    if (o && typeof o === "object") return "{" + Object.keys(o).sort().map(k => JSON.stringify(k) + ":" + canon(o[k])).join(",") + "}";
    return JSON.stringify(o === undefined ? null : o);
  }
  // the values every copy shares
  function shared(type, params) {
    const p = clone(params || {});
    (PER_COPY[type] || []).forEach(k => delete p[k]);
    return p;
  }
  function own(type, params) {
    const p = {};
    (PER_COPY[type] || []).forEach(k => { if (params && k in params) p[k] = params[k]; });
    return p;
  }

  // A block from parts and wires: positions relative to the corner of what they cover (on the
  // grid). keyOf(c) names an existing member; others get m1, m2 … from the block's counter.
  //   → { def, ox, oy, keys: Map(part id → member) }
  function make(def, comps, wires, keyOf) {
    const xs = [], ys = [];
    comps.forEach(c => { xs.push(c.x); ys.push(c.y); });
    wires.forEach(w => { xs.push(w.x1, w.x2); ys.push(w.y1, w.y2); });
    const ox = xs.length ? floor10(Math.min(...xs)) : 0, oy = ys.length ? floor10(Math.min(...ys)) : 0;
    def.next = def.next || 1;
    const keys = new Map();
    def.comps = comps.map(c => {
      const m = (keyOf && keyOf(c)) || "m" + def.next++;
      keys.set(c.id, m);
      return { m, type: c.type, x: c.x - ox, y: c.y - oy, rot: c.rot || 0, label: c.label || "", params: clone(c.params || {}) };
    });
    def.wires = wires.map(w => ({ x1: w.x1 - ox, y1: w.y1 - oy, x2: w.x2 - ox, y2: w.y2 - oy }));
    return { def, ox, oy, keys };
  }
  // the block's size: { w, h } from its parts' places and its wires
  function extent(def) {
    let w = 0, h = 0;
    def.comps.forEach(c => { w = Math.max(w, c.x); h = Math.max(h, c.y); });
    def.wires.forEach(s => { w = Math.max(w, s.x1, s.x2); h = Math.max(h, s.y1, s.y2); });
    return { w, h };
  }
  // the copies on the sheet: Map(copy id → { d, comps }) in the order they first appear
  function copies(comps, defId) {
    const out = new Map();
    comps.forEach(c => {
      if (!c.block || (defId && c.block.d !== defId)) return;
      if (!out.has(c.block.i)) out.set(c.block.i, { d: c.block.d, comps: [] });
      out.get(c.block.i).comps.push(c);
    });
    return out;
  }
  // where a copy's corner is: the offset most of its parts agree on (one part moved on its own
  // does not move the copy)
  function origin(def, comps) {
    const votes = new Map();
    comps.forEach(c => {
      const dm = def.comps.find(k => k.m === c.block.m);
      if (!dm) return;
      const k = (c.x - dm.x) + "," + (c.y - dm.y);
      votes.set(k, (votes.get(k) || 0) + 1);
    });
    let best = null, n = 0;
    votes.forEach((v, k) => { if (v > n) { n = v; best = k; } });
    if (!best) return null;
    const [x, y] = best.split(",").map(Number);
    return { x, y };
  }
  // Values edited on one copy go to every copy: for each member, a part whose shared values
  // differ from the block's is the edit (the preferred one, the selection, when several do);
  // the block takes its values and every other copy of that member gets them.
  //   → the number of parts changed
  function sync(blocks, comps, preferred) {
    let n = 0;
    (blocks || []).forEach(def => {
      const byM = new Map();
      comps.forEach(c => { if (c.block && c.block.d === def.id) { if (!byM.has(c.block.m)) byM.set(c.block.m, []); byM.get(c.block.m).push(c); } });
      def.comps.forEach(dm => {
        const list = (byM.get(dm.m) || []).filter(c => c.type === dm.type);
        const ref = canon(shared(dm.type, dm.params));
        const changed = list.filter(c => canon(shared(c.type, c.params)) !== ref);
        if (!changed.length) return;
        const src = changed.find(c => preferred && preferred.has(c.id)) || changed[0];
        dm.params = clone(src.params);
        const sp = shared(src.type, src.params);
        list.forEach(c => {
          if (c === src || canon(shared(c.type, c.params)) === canon(sp)) return;
          c.params = Object.assign(clone(sp), own(c.type, c.params));
          n++;
        });
      });
    });
    return n;
  }
  // Wires with the stretches covered by segs taken out (the old drawing of a copy, which may
  // have been merged with or split by the wires around it); what is left keeps the wire's id.
  function subtract(wires, segs) {
    const out = [];
    wires.forEach(w => {
      const h = w.y1 === w.y2, v = w.x1 === w.x2;
      if (h === v) { out.push(w); return; }       // a point, or not orthogonal: untouched
      const at = h ? w.y1 : w.x1;
      let pieces = [[Math.min(h ? w.x1 : w.y1, h ? w.x2 : w.y2), Math.max(h ? w.x1 : w.y1, h ? w.x2 : w.y2)]];
      segs.forEach(s => {
        const sh = s.y1 === s.y2, sv = s.x1 === s.x2;
        if (sh === sv || sh !== h || (h ? s.y1 : s.x1) !== at) return;
        const a = Math.min(h ? s.x1 : s.y1, h ? s.x2 : s.y2), b = Math.max(h ? s.x1 : s.y1, h ? s.x2 : s.y2);
        const next = [];
        pieces.forEach(([lo, hi]) => {
          if (b <= lo || a >= hi) { next.push([lo, hi]); return; }
          if (a > lo) next.push([lo, a]);
          if (b < hi) next.push([b, hi]);
        });
        pieces = next;
      });
      pieces.forEach(([lo, hi], k) => {
        const id = k ? w.id + "_s" + k : w.id;
        out.push(h ? { id, x1: lo, y1: at, x2: hi, y2: at } : { id, x1: at, y1: lo, x2: at, y2: hi });
      });
    });
    return out;
  }
  // the library of blocks in this browser
  function loadLib() { try { const a = JSON.parse(localStorage.getItem(LIB_KEY) || "[]"); return Array.isArray(a) ? a : []; } catch (e) { return []; } }
  function saveLib(list) { try { localStorage.setItem(LIB_KEY, JSON.stringify(list)); return true; } catch (e) { return false; } }

  // ---------------------------------------------------------------------------
  // The CAD's side: commands, the Blocks dialog, placing, the outlines and the inspector
  // ---------------------------------------------------------------------------
  function CadBlocks(cad) {
    const { S, LIB, commit, compBBox, drawComp, esc, getCtx, makeComp, newId, render, setStatus, snap, updateInspector } = cad;
    const defOf = id => S.blocks.find(b => b.id === id);
    const selComps = () => S.comps.filter(c => S.sel.comps.has(c.id) && c.type !== "frame");
    let note = "";   // what the last copy placed said (the status line soon shows the simulation)
    const memberSel = () => { const c = S.comps.find(k => S.sel.comps.has(k.id) && k.block); return c || null; };

    // designators for a new copy: each designator base of the block (VL1 of VL1.1 and VL1.2) gets
    // the next free number of its letter code, so a dual triode's sections stay one tube
    function labeller() {
      const top = new Map(), bases = new Map();
      const next = prefix => {
        if (!top.has(prefix)) {
          let n = 0;
          const re = new RegExp("^" + prefix.replace(/[^A-Za-z]/g, "") + "(\\d+)(\\.|$)");
          S.comps.forEach(c => { const m = re.exec(c.label || ""); if (m) n = Math.max(n, +m[1]); });
          top.set(prefix, n);
        }
        top.set(prefix, top.get(prefix) + 1);
        return prefix + top.get(prefix);
      };
      return label => {
        const m = /^([A-Za-z]+)(\d+)(\..+)?$/.exec(label || "");
        if (!m) return null;
        const base = m[1] + m[2];
        if (!bases.has(base)) bases.set(base, next(m[1]));
        return bases.get(base) + (m[3] || "");
      };
    }
    // a copy of the block drawn with its corner at (ox, oy); reuse: Map(member → the part it
    // replaces), whose id, designator and own values the new part keeps
    function stamp(def, ox, oy, copyId, reuse) {
      const label = labeller(), comps = [], wires = [];
      def.comps.forEach(dm => {
        if (!LIB[dm.type]) return;
        const c = makeComp(dm.type, dm.params, ox + dm.x, oy + dm.y, dm.rot);
        c.params = Object.assign({}, LIB[dm.type].defaults, clone(dm.params));
        const old = reuse && reuse.get(dm.m);
        if (old) { c.id = old.id; c.label = old.label; Object.assign(c.params, own(c.type, old.params)); }
        else if (c.label) c.label = label(dm.label) || c.label;
        c.block = { i: copyId, d: def.id, m: dm.m };
        S.comps.push(c); comps.push(c);
      });
      def.wires.forEach(w => { const n = { id: newId("w"), x1: w.x1 + ox, y1: w.y1 + oy, x2: w.x2 + ox, y2: w.y2 + oy }; S.wires.push(n); wires.push(n); });
      return { comps, wires };
    }
    // the wires a set of parts encloses: both ends inside the box round them
    function wiresInside(comps, pad) {
      if (!comps.length) return [];
      const b = boxOf(comps, pad);
      return S.wires.filter(w => Math.min(w.x1, w.x2) >= b.x1 && Math.max(w.x1, w.x2) <= b.x2 && Math.min(w.y1, w.y2) >= b.y1 && Math.max(w.y1, w.y2) <= b.y2);
    }
    function boxOf(comps, pad) {
      const b = { x1: Infinity, y1: Infinity, x2: -Infinity, y2: -Infinity };
      comps.forEach(c => { const k = compBBox(c); b.x1 = Math.min(b.x1, k.x1); b.y1 = Math.min(b.y1, k.y1); b.x2 = Math.max(b.x2, k.x2); b.y2 = Math.max(b.y2, k.y2); });
      pad = pad || 0;
      return { x1: b.x1 - pad, y1: b.y1 - pad, x2: b.x2 + pad, y2: b.y2 + pad };
    }
    const selWires = comps => { const w = S.wires.filter(x => S.sel.wires.has(x.id)); return w.length ? w : wiresInside(comps, 10); };
    const uniqueName = base => { let n = base, k = 2; while (S.blocks.some(b => b.name === n)) n = base + " " + k++; return n; };
    const hasConnectors = def => def.comps.some(c => PER_COPY[c.type]);

    // Edit ▾ → Make block from selection: the selected parts (and their wires) become a block, and
    // they its first copy
    function make_(name) {
      const comps = selComps();
      if (!comps.length) { setStatus("warn", "Select the parts of the stage or channel first (drag a box round them), then make the block."); return null; }
      const wires = selWires(comps);
      const def = { id: newId("b"), name: uniqueName(String(name || "").trim() || "Block " + (S.blocks.length + 1)) };
      const { keys } = make(def, comps, wires);
      const copyId = newId("i");
      comps.forEach(c => { c.block = { i: copyId, d: def.id, m: keys.get(c.id) }; });
      S.blocks.push(def);
      commit();
      setStatus("ok", `Block “${def.name}”: ${comps.length} part(s), ${wires.length} wire(s). Place more copies from Edit ▾ → Blocks…; a value changed on any copy changes on all of them.`);
      return def;
    }
    // Edit ▾ → Update block from selection: the selected copy (with any parts and wires added to
    // it) becomes the block, and every other copy is drawn again from it
    function update() {
      const comps = selComps(), tagged = comps.filter(c => c.block);
      const ids = [...new Set(tagged.map(c => c.block.i))];
      if (ids.length !== 1) { setStatus("warn", ids.length ? "The selection holds parts of more than one copy: select one copy (Select this copy), with what you added to it." : "Select a copy of a block (right-click one of its parts → Select this copy), with what you added to it."); return false; }
      const copyId = ids[0], def = defOf(tagged[0].block.d);
      if (!def) return false;
      const oldDef = clone(def), all = copies(S.comps, def.id), origins = new Map();
      all.forEach((v, i) => origins.set(i, origin(oldDef, v.comps)));
      const was = origins.get(copyId) || { x: 0, y: 0 };
      const wires = selWires(comps);
      const { ox, oy } = make(def, comps, wires, c => (c.block && c.block.d === def.id ? c.block.m : null));
      const dx = ox - was.x, dy = oy - was.y;
      const inSel = new Set(comps.map(c => c.id));
      // parts of this copy left out of the selection leave the block; the selected ones join it
      all.get(copyId).comps.forEach(c => { if (!inSel.has(c.id)) delete c.block; });
      comps.forEach((c, k) => { c.block = { i: copyId, d: def.id, m: def.comps[k].m }; });
      let n = 0;
      all.forEach((v, i) => {
        if (i === copyId) return;
        const o = origins.get(i); if (!o) return;
        const reuse = new Map(v.comps.map(c => [c.block.m, c]));
        const gone = new Set(v.comps.map(c => c.id));
        S.comps = S.comps.filter(c => !gone.has(c.id));
        S.wires = subtract(S.wires, oldDef.wires.map(w => ({ x1: w.x1 + o.x, y1: w.y1 + o.y, x2: w.x2 + o.x, y2: w.y2 + o.y })));
        stamp(def, o.x + dx, o.y + dy, i, reuse);
        n++;
      });
      commit();
      setStatus("ok", `Block “${def.name}” updated from this copy: ${def.comps.length} part(s), ${def.wires.length} wire(s); ${n} other cop${n === 1 ? "y" : "ies"} redrawn.`);
      return true;
    }
    // right-click → Select this copy: its parts, the wires inside it and any loose part added in it
    function selectCopy(c) {
      c = c || memberSel();
      if (!c || !c.block) return;
      const members = S.comps.filter(k => k.block && k.block.i === c.block.i);
      const b = boxOf(members, 10);
      S.sel.comps.clear(); S.sel.wires.clear();
      members.forEach(k => S.sel.comps.add(k.id));
      S.comps.forEach(k => { if (k.block || k.type === "frame") return; const q = compBBox(k); if (q.x1 >= b.x1 && q.x2 <= b.x2 && q.y1 >= b.y1 && q.y2 <= b.y2) S.sel.comps.add(k.id); });
      wiresInside(members, 10).forEach(w => S.sel.wires.add(w.id));
      updateInspector(); render();
    }
    // right-click → Detach from block: this copy's parts become ordinary parts
    function detach(c) {
      c = c || memberSel();
      if (!c || !c.block) return;
      const i = c.block.i, def = defOf(c.block.d);
      S.comps.forEach(k => { if (k.block && k.block.i === i) delete k.block; });
      commit();
      setStatus("ok", `This copy is no longer part of “${def ? def.name : "the block"}”: its values are its own now.`);
    }

    // placing a copy: it follows the pointer (centred on it) until a click puts it down
    function startPlace(id) {
      const def = defOf(id); if (!def) return;
      S.placing = null; S.wiring = null;
      S.placingBlock = id;
      closeDialog();
      setStatus("ok", `Placing “${def.name}”: click where the copy goes (Esc cancels).`);
      render();
    }
    const corner = (def, wx, wy) => { const e = extent(def); return { x: snap(wx - e.w / 2), y: snap(wy - e.h / 2) }; };
    function drop(wx, wy) {
      const def = defOf(S.placingBlock);
      S.placingBlock = null;
      if (!def) return;
      const o = corner(def, wx, wy);
      const { comps, wires } = stamp(def, o.x, o.y, newId("i"));
      S.sel.comps.clear(); S.sel.wires.clear();
      comps.forEach(c => S.sel.comps.add(c.id)); wires.forEach(w => S.sel.wires.add(w.id));
      commit();
      const n = copies(S.comps, def.id).size;
      note = `Copy ${n} of “${def.name}” placed.` + (hasConnectors(def) ? " Its sheet connectors have the same names as the first copy's, so they join it: rename them in this copy (each copy keeps its own names)." : "");
      setStatus(hasConnectors(def) ? "warn" : "ok", note);
    }
    function cancelPlace() { if (!S.placingBlock) return false; S.placingBlock = null; setStatus("ok", "Placing cancelled."); render(); return true; }
    function drawGhost() {
      const def = S.placingBlock && defOf(S.placingBlock), ctx = getCtx();
      if (!def) return;
      const o = corner(def, S.mouse.wx, S.mouse.wy);
      ctx.save(); ctx.globalAlpha = 0.55;
      ctx.strokeStyle = "#3fb950"; ctx.lineWidth = 2; ctx.lineCap = "round";
      def.wires.forEach(w => { ctx.beginPath(); ctx.moveTo(w.x1 + o.x, w.y1 + o.y); ctx.lineTo(w.x2 + o.x, w.y2 + o.y); ctx.stroke(); });
      def.comps.forEach(dm => {
        if (!LIB[dm.type]) return;
        drawComp({ id: "ghost", type: dm.type, x: o.x + dm.x, y: o.y + dm.y, rot: dm.rot || 0, params: Object.assign({}, LIB[dm.type].defaults, dm.params), label: "" }, false, true);
      });
      ctx.restore();
    }
    // a dashed outline round each copy with the block's name, brighter when part of it is selected
    function drawOutlines() {
      if (!S.blocks.length) return;
      const ctx = getCtx(), k = 1 / S.view.scale;
      copies(S.comps).forEach(v => {
        const def = defOf(v.d); if (!def) return;
        const b = boxOf(v.comps, 8), on = v.comps.some(c => S.sel.comps.has(c.id));
        ctx.save();
        ctx.strokeStyle = on ? "rgba(121,192,255,0.85)" : "rgba(121,192,255,0.32)";
        ctx.lineWidth = k; ctx.setLineDash([6 * k, 4 * k]);
        ctx.strokeRect(b.x1, b.y1, b.x2 - b.x1, b.y2 - b.y1);
        ctx.setLineDash([]);
        ctx.fillStyle = ctx.strokeStyle; ctx.font = `${Math.max(9, 10 * k)}px system-ui, sans-serif`; ctx.textBaseline = "bottom";
        ctx.fillText(def.name, b.x1 + 2 * k, b.y1 - 2 * k);
        ctx.restore();
      });
    }

    // the inspector of a part in a copy: the block, its copies and what can be done
    function inspector(host, c) {
      if (!c.block) return;
      const def = defOf(c.block.d); if (!def) return;
      const all = [...copies(S.comps, def.id).keys()], no = all.indexOf(c.block.i) + 1;
      const box = document.createElement("div");
      box.className = "insp-block";
      box.innerHTML = `<div class="insp-sub">Block</div>
        <p class="insp-help"><b>${esc(def.name)}</b>, copy ${no} of ${all.length}. A value changed here changes in every copy${PER_COPY[c.type] ? " (the signal name stays this copy's own)" : ""}.</p>
        <div class="insp-block-btns"><button class="btn" data-a="select" title="Select this copy's parts and wires, to move it or to update the block from it">Select this copy</button><button class="btn" data-a="detach" title="This copy's parts become ordinary parts, with values of their own">Detach</button><button class="btn" data-a="list" title="Every block of the circuit and of your library">Blocks…</button></div>`;
      box.querySelector('[data-a="select"]').addEventListener("click", () => selectCopy(c));
      box.querySelector('[data-a="detach"]').addEventListener("click", () => detach(c));
      box.querySelector('[data-a="list"]').addEventListener("click", () => openDialog());
      host.appendChild(box);
    }
    // the inspector of a selection of several parts: make a block of it, or update one from it
    function selectionTools(host) {
      if (!selComps().length) return;
      const box = document.createElement("div");
      box.className = "insp-block-btns";
      const tagged = selComps().filter(c => c.block), ids = new Set(tagged.map(c => c.block.i));
      box.innerHTML = `<button class="btn" data-a="make" title="The selected parts and wires become a block you can place again (Edit ▾ → Blocks…)">Make block…</button>` +
        (ids.size === 1 ? `<button class="btn" data-a="update" title="This copy, with what you added to it or changed in its drawing, becomes the block; every other copy is drawn again from it">Update block from selection</button>` : "");
      box.querySelector('[data-a="make"]').addEventListener("click", () => openDialog("make"));
      const u = box.querySelector('[data-a="update"]'); if (u) u.addEventListener("click", update);
      host.appendChild(box);
    }

    // Edit ▾ → Blocks…: the circuit's blocks and the browser's library
    const modal = () => document.getElementById("block-modal");
    function closeDialog() { const m = modal(); if (m) m.hidden = true; }
    const isOpen = () => { const m = modal(); return !!m && !m.hidden; };
    function openDialog(mode) {
      const m = modal(); if (!m) return;
      m.hidden = false;
      renderDialog(mode);
      const f = m.querySelector(mode === "make" ? "#block-name" : "button"); if (f) f.focus();
    }
    function renderDialog(mode) {
      const host = document.getElementById("block-body"); if (!host) return;
      const n = selComps().length, lib = loadLib();
      const count = def => copies(S.comps, def.id).size;
      const rows = S.blocks.map(def => `<tr data-id="${esc(def.id)}"><td>${esc(def.name)}</td><td>${def.comps.length}</td><td>${count(def)}</td><td class="act">
        <button class="btn" data-a="place" title="Click on the sheet where the copy goes">Place</button>
        <button class="btn" data-a="rename">Rename</button>
        <button class="btn" data-a="keep" title="Keep a copy of this block in this browser, to place it in other circuits">${lib.some(b => b.id === def.id) ? "Update library" : "Save to library"}</button>
        <button class="btn" data-a="del" title="Forget the block; its copies stay as ordinary parts">Delete</button></td></tr>`).join("");
      const libRows = lib.map(def => `<tr data-lib="${esc(def.id)}"><td>${esc(def.name)}</td><td>${def.comps.length}</td><td></td><td class="act">
        <button class="btn" data-a="lplace" title="Add the block to this circuit and place a copy">Place</button>
        <button class="btn" data-a="ldel">Remove</button></td></tr>`).join("");
      host.innerHTML = `
        <div class="block-make">
          <span>New block from the ${n ? n + " selected part(s)" : "selection (select parts first)"}</span>
          <input type="text" id="block-name" placeholder="e.g. Channel, Phase splitter" ${n ? "" : "disabled"}>
          <button class="btn active" id="btn-block-create" ${n ? "" : "disabled"}>Make block</button>
        </div>
        <table class="block-table"><thead><tr><th>In this circuit</th><th>Parts</th><th>Copies</th><th></th></tr></thead>
          <tbody>${rows || `<tr><td colspan="4" class="muted">No blocks yet: select a stage or a channel and make one.</td></tr>`}</tbody>
          <thead><tr><th>My library (this browser)</th><th>Parts</th><th></th><th></th></tr></thead>
          <tbody>${libRows || `<tr><td colspan="4" class="muted">Empty: Save to library keeps a block here for other circuits.</td></tr>`}</tbody></table>`;
      const name = host.querySelector("#block-name");
      const doMake = () => { if (make_(name.value)) renderDialog(); };
      host.querySelector("#btn-block-create").addEventListener("click", doMake);
      name.addEventListener("keydown", e => { if (e.key === "Enter") { e.preventDefault(); doMake(); } });
      if (mode === "make" && n) setTimeout(() => name.focus(), 0);
      host.querySelectorAll("button[data-a]").forEach(b => b.addEventListener("click", () => {
        const tr = b.closest("tr"), def = tr.dataset.id && defOf(tr.dataset.id), a = b.dataset.a;
        if (a === "place" && def) startPlace(def.id);
        else if (a === "rename" && def) {
          const v = window.prompt("Block name", def.name);
          if (v && v.trim()) { def.name = v.trim(); commit(); renderDialog(); }
        } else if (a === "keep" && def) {
          const list = loadLib().filter(x => x.id !== def.id); list.push(clone(def));
          const ok = saveLib(list);
          setStatus(ok ? "ok" : "warn", ok ? `“${def.name}” is in your library: Edit ▾ → Blocks… in any circuit places it.` : "This browser would not store the library.");
          renderDialog();
        } else if (a === "del" && def) {
          S.comps.forEach(c => { if (c.block && c.block.d === def.id) delete c.block; });
          S.blocks = S.blocks.filter(x => x !== def);
          commit(); renderDialog();
        } else if (a === "lplace") {
          const d = loadLib().find(x => x.id === tr.dataset.lib); if (!d) return;
          if (!defOf(d.id)) { S.blocks.push(clone(d)); }
          startPlace(d.id);
        } else if (a === "ldel") { saveLib(loadLib().filter(x => x.id !== tr.dataset.lib)); renderDialog(); }
      }));
    }
    // Before every snapshot: values edited on one copy go to the others
    function beforeCommit() { if (S.blocks.length) sync(S.blocks, S.comps, S.sel.comps); }
    // a loaded circuit: its blocks, and no tag pointing to a block it does not have
    function load(d) {
      S.blocks = Array.isArray(d && d.blocks) ? d.blocks.filter(b => b && b.id && Array.isArray(b.comps) && Array.isArray(b.wires)) : [];
      S.comps.forEach(c => { if (c.block && !defOf(c.block.d)) delete c.block; });
    }
    function init() {
      const m = modal(); if (!m) return;
      const close = m.querySelector("#btn-block-close"); if (close) close.addEventListener("click", closeDialog);
      m.addEventListener("mousedown", e => { if (e.target === m) closeDialog(); });
    }
    return { make: make_, update, selectCopy, detach, startPlace, drop, cancelPlace, drawGhost, drawOutlines, inspector, selectionTools, openDialog, closeDialog, isOpen, beforeCommit, load, init, member: memberSel, note: () => note, canUpdate: () => new Set(selComps().filter(c => c.block).map(c => c.block.i)).size === 1 };
  }
  Object.assign(CadBlocks, { make, extent, copies, origin, sync, subtract, shared, canon, PER_COPY, LIB_KEY });
  root.CadBlocks = CadBlocks;
})(typeof window !== "undefined" ? window : globalThis);
