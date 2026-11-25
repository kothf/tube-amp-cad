/* Tube Amp CAD: the board as MöbiusCAD files, its geometry and its thermal study (no DOM, runs in Node for the tests).

   BoardMcad.pack(board, model, result, opts) → { files, asm, parts, name }
     result  BoardThermal.solve(...)'s, ok (the heat and the copper of the study); null = geometry only
     opts    { name (file stem), title, version, date, tubes (draw the valves, default true) }
     files   { "<name>.mcadasm": bytes, "<part>.mcadprt": bytes, … }: the folder MöbiusCAD reads, as
             its plan for assemblies that reference part files has it: every part its own file (equal
             parts share one), the assembly pointing at them by `link` { path, hash } with a copy of each
             part as the fallback. Names stay the same from one export to the next, so writing the
             folder again overwrites the same files and the references stay good.

   Geometry: each part is drawn in its footprint's own frame (BoardBrep, exact planes and cylinders) and
   placed by a rigid transform, so every 12AX7 or 1k resistor shares one part file. The board is one part
   in the frame of the STEP export (mm, x right, y up, z up from the board's bottom face).

   Thermal study ("Thermal 1"): MöbiusCAD's "Heat from package" load with every part's dissipation and
   where it goes (board, air, heatsink), limits, an electrolytic's rated life and a semiconductor's
   junction (Rjc from this map), the ambient, enclosure and which way is down, convection and radiation
   on every open surface, and the board as a "PCB (effective)" body whose conductivity follows its copper
   cell by cell (the same grid the map was solved on). */
(function (root) {
  "use strict";
  const SCHEMA = 1, FORMAT = "mobiuscad";
  const B3 = () => root.Board3D, BR = () => root.BoardBrep, BC = () => root.BoardCore;

  const BOARD_MATERIAL = "PCB (effective)", K_CU = 390, K_FR4 = 0.3;
  /** What a body is made of, as MöbiusCAD keeps it (MatRef): the 3D model's own material (Board3D.MATERIALS), its
      emissivity too, so both apps take the same properties */
  function materialOf(solidOrColor, type) {
    const M = B3().MATERIALS, key = solidOrColor && solidOrColor.mat && M[solidOrColor.mat] ? solidOrColor.mat : B3().matKey(Array.isArray(solidOrColor) ? solidOrColor : solidOrColor && solidOrColor.color, type), m = M[key];
    return { name: m.name, density: m.density, cat: m.cat, k: m.k, cp: m.cp, emis: m.emis };
  }
  /** The board's effective material (MöbiusCAD's boardConductivity): copper layers in parallel along it */
  function boardMaterial(t, s) {
    const cu = Math.min(Math.max(t, 1e-6), s.layers * s.copper * 1e-3), full = Math.min(1, Math.max(0, s.cover)), share = (cu * full) / Math.max(t, 1e-6);
    const along = K_FR4 * (1 - share) + K_CU * share, density = 1.85 * (1 - share) + 8.96 * share, cp = (1.85 * (1 - share) * 1100 + 8.96 * share * 385) / density;
    return { name: BOARD_MATERIAL, density: Math.round(density * 1000) / 1000, k: Math.round(along * 100) / 100, cp: Math.round(cp), emis: 0.9 };
  }

  // ---- SHA-256 (hex) of bytes: the hash a link carries
  const K = new Uint32Array([0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da, 0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
  function sha256(bytes) {
    const n = bytes.length, total = ((n + 9 + 63) >> 6) << 6, m = new Uint8Array(total);
    m.set(bytes); m[n] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(total - 8, Math.floor(n / 0x20000000)); dv.setUint32(total - 4, (n << 3) >>> 0);
    const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]), W = new Uint32Array(64);
    const rotr = (x, k) => (x >>> k) | (x << (32 - k));
    for (let o = 0; o < total; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getUint32(o + 4 * i);
      for (let i = 16; i < 64; i++) { const a = W[i - 15], b = W[i - 2]; W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0; }
      let [a, b, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0, t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
      }
      H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
    }
    return Array.from(H, v => v.toString(16).padStart(8, "0")).join("");
  }
  const utf8 = s => new TextEncoder().encode(s);
  const b64 = a => { let s = ""; for (let i = 0; i < a.length; i += 0x8000) s += String.fromCharCode.apply(null, a.subarray(i, i + 0x8000)); return btoa(s); };
  // MöbiusCAD writes its JSON with sorted keys and two-space indents (files diff well)
  const stable = v => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" && !(v instanceof Uint8Array) ? Object.fromEntries(Object.keys(v).sort().map(k => [k, stable(v[k])])) : v;
  const toJson = v => JSON.stringify(stable(v), null, 2) + "\n";
  /** A file name from a part's name: no characters a file system refuses */
  const fileSafe = s => String(s).replace(/[\\/:*?"<>|]+/g, "-").replace(/\s+/g, " ").trim().replace(/^\.+/, "") || "part";

  // ---- placement: footprint frame → board, as the 3D scene does it (Board3D.partBodies)
  function frame(P, t) {
    const side = P.side === "B" ? "B" : "F";
    return q => { const [X, Y] = BC().place([q[0], q[1]], P); return [X, -Y, side === "B" ? -q[2] : t + q[2]]; };
  }
  /** The rigid transform (3 × 4, row-major) taking the part drawn at `P0` onto the part drawn at `P` */
  function placement(P, P0, t) {
    const f = frame(P, t), f0 = frame(P0, t), o = f([0, 0, 0]), o0 = f0([0, 0, 0]);
    const cols = g => [[1, 0, 0], [0, 1, 0], [0, 0, 1]].map(e => { const p = g(e), z = g([0, 0, 0]); return [p[0] - z[0], p[1] - z[1], p[2] - z[2]]; });
    const A = cols(f), A0 = cols(f0);   // columns: images of the unit vectors (orthonormal, so A0⁻¹ = A0ᵀ)
    const R = [0, 1, 2].map(i => [0, 1, 2].map(j => A.reduce((s, col, k) => s + col[i] * A0[k][j], 0)));
    const T = [0, 1, 2].map(i => o[i] - (R[i][0] * o0[0] + R[i][1] * o0[1] + R[i][2] * o0[2]));
    const r = v => (Math.abs(v) < 1e-12 ? 0 : +v.toFixed(9));
    return [R[0][0], R[0][1], R[0][2], T[0], R[1][0], R[1][1], R[1][2], T[1], R[2][0], R[2][1], R[2][2], T[2]].map(r);
  }
  /** A body's name inside its part */
  function bodyName(s, i, leads) {
    const C = B3().COLORS, c = s.color || [0, 0, 0], lead = Math.abs(c[0] - C.lead[0]) + Math.abs(c[1] - C.lead[1]) + Math.abs(c[2] - C.lead[2]) < 1e-6;
    const own = { silicon: "Die", ecore: "Core", rubber: "Bung", tab: "Tab" }[s.mat];
    return lead ? `Lead ${++leads.n}` : own && i ? own : i ? `Body ${i + 1}` : "Body";
  }

  /** A part document of solids (one Imported feature each, so every solid is a body with its own material) */
  function partDoc(id, name, solids, mats, names) {
    const features = solids.map((s, i) => ({ id: `b${i + 1}`, type: "import", name: `Imported${i + 1}`, file: `${name}.brep`, brep: BR().write([s]) }));
    const bodies = {};
    solids.forEach((s, i) => { bodies[`b${i + 1}`] = { name: names[i], material: mats[i], ...(s.color ? { color: s.color.map(v => +v.toFixed(4)) } : {}) }; });
    // the part's own material: its largest body's (the body, not a lead)
    return { schema: SCHEMA, kind: "part", id, name, units: { length: "mm", decimals: 2 }, props: {}, material: mats[0], ...(solids[0] && solids[0].color ? { color: solids[0].color.map(v => +v.toFixed(4)) } : {}), bodies, features, rollback: null, naming: 2 };
  }
  function container(kind, doc, app, date) {
    return root.BoardFab.zip({ "manifest.json": toJson({ format: FORMAT, schema: SCHEMA, kind, app, modified: date.toISOString(), units: doc.units.length }), "document.json": toJson(doc) }, date);
  }

  /** The copper of the board on the map's grid (MöbiusCAD's CopperMap): each layer's share of every cell, the plated barrels */
  function copperMap(board, model, res, name) {
    if (!res || !res.copper) return null;
    const { nx, ny, step } = res, n = nx * ny, PLATING = 0.025;
    // rows from the board's bottom edge up (y up), as MöbiusCAD keeps them; the layout's rows run down
    const cov = [], means = [], labels = [];
    res.copper.forEach(L => {
      const a = new Uint8Array(n); let sum = 0;
      for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = Math.round(Math.min(1, Math.max(0, L.cover[j * nx + i])) * 255); a[(ny - 1 - j) * nx + i] = v; sum += v; }
      cov.push(b64(a)); means.push(+(sum / (255 * n)).toFixed(4)); labels.push(L.layer);
    });
    const vias = new Float64Array(n), area = step * step; let holes = 0;
    const barrel = (x, y, d) => { const i = Math.floor(x / step), j = Math.floor(y / step); if (!(d > 0) || i < 0 || j < 0 || i >= nx || j >= ny) return; vias[(ny - 1 - j) * nx + i] += Math.PI * d * PLATING / area; holes++; };
    (model.pads || []).forEach(p => { if (!p.smd && p.drill > 0) barrel(p.x, p.y, p.drill); });
    (board.vias || []).forEach(v => barrel(v.x, v.y, v.drill || 0.8));
    const vb = Uint8Array.from(vias, v => Math.min(255, Math.round(v * 2550)));
    return { name, x0: 0, y0: -ny * step, cell: step, nu: nx, nv: ny, cov, vias: b64(vb), labels, means, holes, at: { u: nx * step / 2, v: -ny * step / 2, swap: false } };
  }

  /** The study's "Heat from package" rows from the map's parts */
  function heatRows(res, compsOf, bodiesOf) {
    const out = [];
    (res ? res.parts : []).forEach((p, i) => {
      const w = (p.p || 0) + (p.heater || 0), comps = compsOf(p.ref);
      if (w < 0.01 && !comps.length) return;
      const r4 = v => +(+v).toFixed(4), row = { id: i + 1, name: p.ref, comps, p: r4(w) };
      if (p.off) row.off = true;
      if (p.limit !== undefined) row.limit = p.limit;
      if (p.lifeRated !== undefined) { row.life = p.lifeRated; row.elyt = true; }
      // the bodies the part makes its heat in (its die, winding, bulb, resistive body), by name in its part file
      const hb = bodiesOf ? bodiesOf(p.ref) : null; if (hb && hb.length) row.bodies = hb;
      if (!p.off) { row.board = r4(Math.max(0, p.toBoard || 0)); row.sink = r4(Math.max(0, p.toSink || 0)); row.path = p.path === "chassis" || p.path === "heatsink" || p.path === "air" ? p.path : "board"; }
      // where the board share goes in: a disc per pad (the lead), a rectangle under the body (the air gap)
      if (!p.off && row.board > 0 && p.into && p.into.length) {
        const r3 = v => +(+v).toFixed(3);
        row.into = p.into.map(q => (q.disc ? { disc: q.disc.map(r3), w: r4(q.w) } : { rect: q.rect.map(r3), w: r4(q.w) }));
      }
      // a semiconductor: the limit is its junction's; Rjc from the map's junction over its case
      if (p.tj !== undefined && p.tj !== null && p.t !== null && p.t !== undefined && p.p > 0.01) { row.junction = true; row.rjc = Math.max(0, +((p.tj - p.t) / p.p).toFixed(3)); }
      out.push(row);
    });
    return out;
  }

  /** Which way is down (MöbiusCAD's boardDown): lying with its parts up = −z; parts down = +z; upright = down its shorter edge */
  function down(board, orient) {
    if (root.BoardThermal && root.BoardThermal.down) return root.BoardThermal.down(board, orient);
    if (orient === "down") return [0, 0, 1];
    if (orient === "vertical") return board.outline.h <= board.outline.w ? [0, -1, 0] : [-1, 0, 0];
    return [0, 0, -1];
  }

  function pack(board, model, res, opts) {
    opts = Object.assign({ name: "board", tubes: true }, opts || {});
    const date = opts.date || new Date(), app = "Tube Amp CAD" + (opts.version ? " " + opts.version : ""), design = opts.title || opts.name;
    const t = board.stackup.thickness || 1.6, keep = root.BoardFab ? root.BoardFab.placedParts(board, model) : new Set(model.parts.map(g => g.key));
    const scene = B3().scene(board, model, { tubes: opts.tubes !== false, parts: false });
    // ---- the parts, each drawn in its own frame; equal drawings share a part file
    const groups = new Map(), insts = [];
    model.parts.forEach(g => {
      if (!g.place || !g.fp || !keep.has(g.key)) return;
      const P0 = Object.assign({}, g.place, { x: 0, y: 0, rot: 0 });
      const solids = B3().partBodies(Object.assign({}, g, { place: P0 }), t, { tubes: opts.tubes !== false });
      if (!solids.length) return;
      const leads = { n: 0 }, names = solids.map((s, i) => bodyName(s, i, leads)), mats = solids.map(s => materialOf(s, g.type));
      const breps = solids.map(s => BR().write([s])), key = breps.join("\u0001") + JSON.stringify([solids.map(s => s.color), mats.map(m => m.name)]);
      if (!groups.has(key)) groups.set(key, { label: fileSafe([g.value, g.fp.name].filter(Boolean).join(" ")), solids, mats, names, refs: [] });
      const grp = groups.get(key);
      grp.refs.push(g.ref);
      insts.push({ ref: g.ref, grp, tf: placement(g.place, P0, t) });
    });
    // stable names: by label, then the first designator; a second drawing under one label gets " (2)"
    const sorted = [...groups.values()].sort((a, b) => (a.label < b.label ? -1 : a.label > b.label ? 1 : 0) || (a.refs[0] < b.refs[0] ? -1 : 1));
    const taken = new Map(), boardName = fileSafe(design + " board");
    taken.set(boardName.toLowerCase(), 1);
    sorted.forEach(grp => { let nm = grp.label, k = taken.get(nm.toLowerCase()) || 0; if (k) { while (taken.has(`${grp.label} (${k + 1})`.toLowerCase())) k++; nm = `${grp.label} (${k + 1})`; } taken.set(grp.label.toLowerCase(), (taken.get(grp.label.toLowerCase()) || 0) + 1); taken.set(nm.toLowerCase(), 1); grp.name = nm; });
    const docId = nm => "d_tc_" + sha256(utf8(nm)).slice(0, 16), files = {}, asmParts = {};
    const addPart = (key, nm, doc) => {
      const bytes = container("part", doc, app, date), file = `${nm}.mcadprt`;
      files[file] = bytes;
      asmParts[key] = { name: nm, file, link: { path: file, hash: sha256(bytes) }, doc };
    };
    // ---- the board
    const stack = { layers: (res && res.copper ? res.copper.length : 0) || board.stackup.layers || 2, copper: board.stackup.copper || 35, cover: 0.4 };
    const map = copperMap(board, model, res, design);
    if (map) stack.cover = +(map.means.reduce((s, v) => s + v, 0) / Math.max(1, map.means.length)).toFixed(4);
    const boardMat = boardMaterial(t, stack);
    addPart("p_board", boardName, partDoc(docId(boardName), boardName, [scene.board], [boardMat], ["Board"]));
    const components = [{ id: "c_board", name: "PCB", part: "p_board", tf: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0], fixed: true }];
    sorted.forEach((grp, k) => { grp.key = `p_${k + 1}`; addPart(grp.key, grp.name, partDoc(docId(grp.name), grp.name, grp.solids, grp.mats, grp.names)); });
    const used = new Set(["c_board"]), compsOf = new Map();
    insts.forEach(x => {
      let id = "c_" + x.ref.replace(/[^A-Za-z0-9_-]+/g, "_"), k = 1;
      while (used.has(id)) id = "c_" + x.ref.replace(/[^A-Za-z0-9_-]+/g, "_") + "_" + ++k;
      used.add(id); compsOf.set(x.ref, (compsOf.get(x.ref) || []).concat(id));
      components.push({ id, name: x.ref, part: x.grp.key, tf: x.tf, fixed: true });
    });
    // ---- the thermal study
    const studies = [];
    if (res && res.ok) {
      const st = res.settings || {}, emis = res.emissivity > 0 && res.emissivity <= 1 ? res.emissivity : 0.9;
      studies.push({
        id: "st1", name: "Thermal 1", kind: "thermal", auto: true,
        settings: { passes: 3, energyTol: 1, ambient: res.ambient, ...(["open", "vented", "closed"].includes(st.enclosure) ? { enclosure: st.enclosure } : {}), down: down(board, st.orient) },
        comps: { c_board: { board: Object.assign({}, stack, { t }, map ? { map } : {}) } },
        loads: [{ id: "l1", name: "Heat from package 1", type: "pkgheat", faces: [], parts: heatRows(res, ref => compsOf.get(ref) || [], ref => { const x = insts.find(q => q.ref === ref); return x ? x.grp.names.filter((_, i) => x.grp.solids[i].heat) : null; }), board: "c_board", split: true }],
        supports: [{ id: "s1", name: "Convection 1", type: "conv", faces: [], all: true, natural: true, h: 8 }, { id: "s2", name: "Radiation 1", type: "rad", faces: [], all: true, emis }]
      });
    }
    const asm = { schema: SCHEMA, kind: "assembly", id: "a_tc_" + sha256(utf8(design)).slice(0, 16), name: design, units: { length: "mm", decimals: 2 }, components, parts: asmParts, ...(studies.length ? { studies } : {}) };
    files[`${fileSafe(opts.name)}.mcadasm`] = container("assembly", asm, app, date);
    return { files, asm, parts: sorted.map(g => ({ name: g.name, refs: g.refs })), name: fileSafe(opts.name) };
  }

  root.BoardMcad = { pack, sha256, materialOf, boardMaterial, copperMap, placement };
})(typeof window !== "undefined" ? window : globalThis);
