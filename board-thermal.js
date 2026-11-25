/* =============================================================================
   BOARD DESIGN — thermal estimate (no DOM, Node-testable). The board as a thin plate in two sheets
   (its top and bottom faces with their copper), every part a node on top of it, solved for the
   steady temperatures from what each part dissipates in the simulation (netlist.heat, the CAD's).
     settings(board) -> { ambient °C, enclosure: "open" | "vented" | "closed", orient: "up" | "down" | "vertical", point: "sim" | "idle" }
     sources(model, netlist, point) -> Map(part key -> { p W, heater W, tj, ts, sink })
     solve(board, model, netlist, opts) -> { ok, why?, nx, ny, step, top, bottom (Float32Array °C, NaN off the board),
        parts: [{ key, ref, value, type, p, heater, toBoard, toAir, toSink, byRadiation, t, tKind, tj, rjc (junction over case, °C/W), tCore (an electrolytic's core), ts, limit, mount, path, box }],
        ambient, tMin, tMax, hot: { x, y, t, side }, total W, balance (W in − W out), iterations }
     at(result, x, y, side) -> °C at a board point (bilinear), or null off the board
     color(u) -> [r, g, b] 0–1 for u 0–1 (an inferno-like scale: dark = cold, pale yellow = hot)
   The model (an estimate, about ±15 °C: the air in a chassis is not solved):
   - each sheet conducts by its copper (390 W/m·K × thickness × the share of the cell it covers; inner
     layers shared between the two sheets) and half the laminate (0.3 W/m·K); the sheets couple
     through the laminate and through every plated hole and its lead;
   - every surface loses heat to the air by natural convection worked out face by face as MöbiusCAD does
     it (its naturalH): h = C·(ΔT/L)^¼ with C 1.32 facing up and 0.59 facing down (L = the face's area
     over its perimeter), 1.42 upright (L = its height), times 1, 0.8 or 0.55 in the open, a vented or a
     closed chassis; and by radiation (ε 0.9 for the board, each solid its own material's for a part). The board's faces, edges and hole walls count, and every
     face of a part's 3D solids, its leads too;
   - a part's body is a node (a TO-220's tab and its moulding one each, joined where they touch): its heat leaves to the air from those faces, into the board through its
     leads (the 3D view's lead: its section over its length from the board to the body, spread over the
     pad's copper) or its SMD pads, and through the air gap under a body lying on the board;
   - a valve's bulb radiates onto the board round it (a line source on its axis: half of what it
     radiates sideways falls on an endless plane) and onto the parts standing next to it;
   - a transistor the engine heats itself (its Cooling field) keeps the engine's junction and heatsink
     temperatures; on a heatsink only its leads warm the board.
   Depends on: board-core.js, board-3d.js (the parts' bodies), board-outline.js (shaped boards)
   ============================================================================= */
(function (root) {
  "use strict";
  const B = () => root.BoardCore;
  const K_CU = 390, K_FR4 = 0.3, K_PIN = 30, K_AIR = 0.03, SIGMA = 5.670374e-8, EPS = 0.9;
  // a lead's conductivity and a solid's emissivity from its 3D material (Board3D's MATERIALS, the export's too)
  const MAT = () => (root.Board3D && root.Board3D.MATERIALS) || null;
  const kLead = () => { const M = MAT(); return M && M.lead ? M.lead.k : 385; };
  const emisOf = (s, type) => { const M = MAT(), B3 = root.Board3D; if (!M) return EPS; const key = s.mat && M[s.mat] ? s.mat : B3.matKey ? B3.matKey(s.color, type) : null; return key && M[key] && M[key].emis > 0 ? M[key].emis : EPS; };
  const SMD_G = 0.004;          // W/K per mm² of soldered SMD pad (a 2512's pads: about 26 K/W; a D2PAK's tab: 3 K/W)
  const ENCLOSURE = { open: 1, vented: 0.8, closed: 0.55 };   // how much of free convection is left inside a chassis (MöbiusCAD's factors)
  const LIMITS = { resistor: 155 };   // °C at the body (a metal film or wirewound resistor's full-derating point)
  const DEFAULTS = { ambient: 40, enclosure: "closed", orient: "up", point: "sim" };
  // semiconductors: the die sits on one lead (its frame); the others reach it by bond wires only
  const ONE_LEAD = new Set(["npn", "pnp", "nmos", "pmos", "njf", "pjf", "reg", "tl431", "chipamp", "opamp", "timer555", "logic"]);
  const TAB_CASE = /^TO-(126|220|247|3P|264)/;   // cases made to be bolted to a heatsink
  const SINK_WATTS = 2, SINK_RTH = 1.5;           // above this such a case is taken to be on a heatsink of 1.5 °C/W (the Cooling field's default)
  // an electrolytic with nothing said of it: a 105 °C part of 2000 h, the common general-purpose grade
  const CAP_TEMP = 105, CAP_LIFE = 2000, CAP_LIFE_MAX = 130000;
  // junction to case (°C/W) and the junction's limit, from the part's rated dissipation as the CAD's
  // transistors have it: a power part's rating is at a 25 °C case, rjc = (Tjmax − 25)/Ptot; a small
  // part's is in free air, about a third of that path inside the case
  function junction(g) {
    const L = root.CadLib, p = (g.members && g.members[0] && g.members[0].params) || {}; if (!L || !g.members) return null;
    // a SPICE or library part in a package: its own fields (Ptot, Rθjc, Tjmax: from DigiKey when it was
    // added by its number, else typical for the package)
    if ((g.type === "spice" || g.type === "part") && L.junctionData) { const j = L.junctionData(g.members[0]); return j && j.rjc > 0 ? { rjc: j.rjc, tjmax: j.tjmax || 150, src: j.src } : null; }
    let m = null, pt = 0;
    if (ONE_LEAD.has(g.type) && L.semiTable && L.isTransistor && L.isTransistor(g.type)) { m = (L.semiTable(g.type) || {})[p.model]; pt = m && m.p; }
    else if (g.type === "reg") { m = (L.REGS || {})[p.model]; pt = m && m.p; }
    else if (g.type === "chipamp") { m = (L.CHIPAMPS || {})[p.model]; pt = m && m.pmax; }
    else if (g.type === "zener") { m = (L.ZENERS || {})[p.model]; pt = m && m.p; }
    if (!m || !(pt > 0)) return null;
    const tjmax = m.ge ? 90 : 150, rth = (tjmax - 25) / pt;
    return { rjc: pt > 1 ? rth : rth / 3, tjmax };
  }
  const settings = board => Object.assign({}, DEFAULTS, (board && board.thermal) || {});

  /** Which way is down in the board's frame (x right, y up, z up from its bottom face), as the MöbiusCAD
      study has it: lying with its parts up = −z, parts down = +z, upright = down its shorter edge. */
  function down(board, orient) {
    if (orient === "down") return [0, 0, 1];
    if (orient === "vertical") return board.outline.h <= board.outline.w ? [0, -1, 0] : [-1, 0, 0];
    return [0, 0, -1];
  }

  // ---- natural convection, face by face, the way MöbiusCAD works it out (its naturalH, FR-TBC-004):
  // h = C·(ΔT/L)^¼ (L in m) for each point of a face by the way the point's normal looks: up (within 45°)
  // C 1.32 and L = the face's area / perimeter, down 0.59 with the same L, otherwise upright 1.42 and
  // L = the face's height (its extent along down); L at least 1 mm; a face cooler than the air acts as a
  // warm one turned over. The faces are those the export writes (board-brep.js): a polyhedron's planar
  // faces; a round solid's two ends, a plane per line and a cylinder per arc of its profile (a full
  // circle in two halves). Each face adds C·A/L^¼ (W/K^1.25, A in mm²) to `hot` or `cold`.
  const NAT_UP = Math.SQRT1_2;
  const v3 = { sub: (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot: (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2], cross: (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]] };
  const unit3 = a => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  function filmTerm(up, lv, lh) {
    const [C, L] = up > NAT_UP ? [1.32, lh] : up < -NAT_UP ? [0.59, lh] : [1.42, lv];
    return 1e-6 * C / Math.pow(Math.max(L, 1) * 1e-3, 0.25);
  }
  // one face: its area (mm²), perimeter, height along down, and its normals with their shares of the area
  function addFace(f, area, per, lv, normals, dn) {
    if (!(area > 0)) return;
    const lh = per > 0 ? area / per : Math.sqrt(area);
    let hot = 0, cold = 0;
    normals.forEach(([n, w]) => { const up = -v3.dot(n, dn); hot += w * filmTerm(up, lv, lh); cold += w * filmTerm(-up, lv, lh); });
    f.hot += hot * area; f.cold += cold * area; f.area += area;
    if (f.faces) f.faces.push({ n: normals[0][0], area, hot: hot * area, cold: cold * area });
  }
  const extent = (pts, dn) => { let lo = Infinity, hi = -Infinity; pts.forEach(p => { const d = v3.dot(p, dn); lo = Math.min(lo, d); hi = Math.max(hi, d); }); return hi - lo; };
  const FACE_KEYS = ["z1", "z2", "y1", "x2", "y2", "x1"];   // a box's faces in Board3D's prism order (its solids' `cover`)
  function polyFaces(s, dn, f) {
    // a box's faces by name; another prism's ends (z1, z2) and a holed prism's hole walls
    let hid = null;
    if (s.cover) {
      hid = new Set(s.cover.map(k => FACE_KEYS.indexOf(k)).filter(i => i >= 0 && (s.faces.length === 6 || i < 2)));
      if (s.cover.includes("holes") && s.holeFaces) for (let i = s.holeFaces[0]; i < s.holeFaces[1]; i++) hid.add(i);
    }
    s.faces.forEach((fc, i) => {
      if (hid && hid.has(i)) return;        // against another body of the part, not open to the air
      const n = unit3(fc.n);
      let a2 = 0, per = 0; const pts = [];
      fc.loops.forEach(loop => {
        let nx = 0, ny = 0, nz = 0;
        loop.forEach((vi, k) => {
          const p = s.verts[vi], q = s.verts[loop[(k + 1) % loop.length]];
          nx += (p[1] - q[1]) * (p[2] + q[2]); ny += (p[2] - q[2]) * (p[0] + q[0]); nz += (p[0] - q[0]) * (p[1] + q[1]);
          per += Math.hypot(q[0] - p[0], q[1] - p[1], q[2] - p[2]); pts.push(p);
        });
        a2 += nx * n[0] + ny * n[1] + nz * n[2];
      });
      addFace(f, Math.abs(a2) / 2, per, extent(pts, dn), [[n, 1]], dn);
    });
  }
  function roundFaces(g, dn, f, cover) {
    const cv = new Set(cover || []);
    const A = unit3(g.a), X = unit3(g.x), Y = v3.cross(A, X);
    const at = ([u, v], w) => [g.o[0] + X[0] * u + Y[0] * v + A[0] * w, g.o[1] + X[1] * u + Y[1] * v + A[1] * w, g.o[2] + X[2] * u + Y[2] * v + A[2] * w];
    const split = segs => segs.length === 1 && segs[0].c ? [segs[0], { ...segs[0], p: [2 * segs[0].c[0] - segs[0].p[0], 2 * segs[0].c[1] - segs[0].p[1]] }] : segs;
    let capArea = 0, capPer = 0; const capPts = [];
    const ring = (segs0, hole) => {
      const hid = cv.has(hole ? "holes" : "side");
      const segs = split(segs0), n = segs.length; let a2 = 0;
      segs.forEach((s, i) => {
        const q = segs[(i + 1) % n].p;
        if (s.c) {
          const a0 = Math.atan2(s.p[1] - s.c[1], s.p[0] - s.c[0]), a1 = Math.atan2(q[1] - s.c[1], q[0] - s.c[0]);
          let th = s.cw ? a0 - a1 : a1 - a0;
          while (th <= 1e-9) th += 2 * Math.PI;
          const K = Math.max(4, Math.ceil(th / (Math.PI / 48))), sg = s.cw ? -1 : 1, out = !!s.cw === !!hole ? 1 : -1, normals = [], pts = [];
          for (let k = 0; k <= K; k++) {
            const ang = a0 + sg * th * k / K, c = Math.cos(ang), sn = Math.sin(ang), uv = [s.c[0] + s.r * c, s.c[1] + s.r * sn];
            pts.push(at(uv, 0), at(uv, g.h)); capPts.push(at(uv, 0), at(uv, g.h));
            if (k < K) { const am = a0 + sg * th * (k + 0.5) / K, d = [X[0] * Math.cos(am) + Y[0] * Math.sin(am), X[1] * Math.cos(am) + Y[1] * Math.sin(am), X[2] * Math.cos(am) + Y[2] * Math.sin(am)]; normals.push([[d[0] * out, d[1] * out, d[2] * out], 1 / K]); }
          }
          // the profile's area: the chord's shoelace term plus the segment between chord and arc
          a2 += s.p[0] * q[1] - q[0] * s.p[1] + sg * s.r * s.r * (th - Math.sin(th));
          capPer += s.r * th;
          if (!hid) addFace(f, s.r * th * g.h, 2 * s.r * th + 2 * g.h, extent(pts, dn), normals, dn);
        } else {
          const len = Math.hypot(q[0] - s.p[0], q[1] - s.p[1]), d = unit3(v3.sub(at(q, 0), at(s.p, 0))), nrm = hole ? v3.cross(A, d) : v3.cross(d, A);
          a2 += s.p[0] * q[1] - q[0] * s.p[1]; capPer += len;
          const pts = [at(s.p, 0), at(s.p, g.h), at(q, 0), at(q, g.h)]; capPts.push(...pts);
          if (!hid) addFace(f, len * g.h, 2 * (len + g.h), extent(pts, dn), [[nrm, 1]], dn);
        }
      });
      capArea += (hole ? -1 : 1) * Math.abs(a2) / 2;
    };
    ring(g.outer, false);
    (g.holes || []).forEach(h => ring(h.segs || [{ p: [h.c[0] + h.r, h.c[1]], c: h.c, r: h.r }], true));
    const bot = capPts.filter((_, i) => i % 2 === 0), top = capPts.filter((_, i) => i % 2 === 1);
    if (!cv.has("z1")) addFace(f, capArea, capPer, extent(bot, dn), [[[-A[0], -A[1], -A[2]], 1]], dn);
    if (!cv.has("z2")) addFace(f, capArea, capPer, extent(top, dn), [[A, 1]], dn);
  }
  /** The film terms of some solids (Board3D's): { hot, cold } W/K^1.25 (h·A = enclosure × term × ΔT^¼), area mm²;
      with `faces` true also each face's own. */
  function films(solids, dn, faces) {
    const f = { hot: 0, cold: 0, area: 0, faces: faces ? [] : null };
    // a body inside the part (a die, a winding) has no face to the air
    solids.forEach(s => { if (!s.inner) (s.round ? roundFaces(s.round, dn, f, s.cover) : polyFaces(s, dn, f)); });
    return f;
  }

  // inferno-like colour scale (matplotlib's inferno at nine stops)
  const STOPS = [[0, 0, 4], [31, 12, 72], [85, 15, 109], [136, 34, 106], [186, 54, 85], [227, 89, 51], [249, 140, 10], [249, 201, 50], [252, 255, 164]];
  function color(u) {
    u = Math.max(0, Math.min(1, Number.isFinite(u) ? u : 0)) * (STOPS.length - 1);
    const i = Math.min(STOPS.length - 2, Math.floor(u)), f = u - i, a = STOPS[i], b = STOPS[i + 1];
    return [0, 1, 2].map(k => (a[k] + (b[k] - a[k]) * f) / 255);
  }

  // what each physical part dissipates: its members' heat (the CAD's), a valve's heater once per envelope
  function sources(model, netlist, point) {
    const heat = (netlist && netlist.heat) || {}, L = root.CadLib, out = new Map();
    (model.parts || []).forEach(g => {
      let p = 0, tj, ts, sink;
      g.members.forEach(m => { const e = heat[m.id]; if (!e) return; p += point === "idle" && e.idle !== undefined ? e.idle : e.p || 0; if (e.tj !== undefined) tj = Math.max(tj === undefined ? -Infinity : tj, e.tj); if (e.ts !== undefined) { ts = e.ts; sink = e.sink; } });
      let heater = 0;
      if (g.type === "tube" && L && L.tubeByName) { const t = L.tubeByName(g.members[0].params.tube); if (t && t.vh > 0 && t.ih > 0) heater = t.vh * t.ih; }
      if (p > 0 || heater > 0 || tj !== undefined) out.set(g.key, { p, heater, tj, ts, sink });
    });
    return out;
  }

  const offBoard = name => /^(WIRE|TERM|STAR|JACK)-/.test(name || "");
  const sameColor = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) + Math.abs(a[2] - b[2]) < 1e-6;
  const LEAD = [0.8, 0.8, 0.82];
  // a part's body from its 3D solids (board frame: x right, y down as the layout, z up from the board's
  // bottom face): the box round what is not a lead; glass: the box round its bulb (a valve)
  function bodyOf(solids) {
    const box = () => ({ x0: Infinity, y0: Infinity, z0: Infinity, x1: -Infinity, y1: -Infinity, z1: -Infinity, n: 0 });
    const grow = (b, s) => s.verts.forEach(v => { b.x0 = Math.min(b.x0, v[0]); b.x1 = Math.max(b.x1, v[0]); b.y0 = Math.min(b.y0, -v[1]); b.y1 = Math.max(b.y1, -v[1]); b.z0 = Math.min(b.z0, v[2]); b.z1 = Math.max(b.z1, v[2]); b.n++; });
    const all = box(), body = box(), glass = box();
    solids.forEach(s => { grow(all, s); if (!sameColor(s.color, LEAD)) grow(body, s); if (s.alpha < 1) grow(glass, s); });
    return { all, body: body.n ? body : all, glass: glass.n ? glass : null };
  }

  // the box round a solid in the board frame
  const aabb = s => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; s.verts.forEach(v => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], v[k]); hi[k] = Math.max(hi[k], v[k]); } }); return { lo, hi }; };
  // a planar face's area, centroid and a point-in-face test (outer loop less its holes), in its own plane
  function faceGeo(s, f) {
    const n = unit3(f.n), d = [0, 1, 2].reduce((m, k) => (Math.abs(n[k]) > Math.abs(n[m]) ? k : m), 0), iu = (d + 1) % 3, iv = (d + 2) % 3;
    const ring = l => l.map(i => [s.verts[i][iu], s.verts[i][iv]]);
    const shoe = r => r.reduce((a, p, i) => { const q = r[(i + 1) % r.length]; return a + p[0] * q[1] - q[0] * p[1]; }, 0) / 2;
    const rings = f.loops.map(ring), area = Math.abs(shoe(rings[0])) - rings.slice(1).reduce((a, r) => a + Math.abs(shoe(r)), 0);
    const pts = f.loops[0].map(i => s.verts[i]), c = [0, 1, 2].map(k => pts.reduce((a, p) => a + p[k], 0) / pts.length);
    const inRing = (r, u, v) => { let ins = false; for (let i = 0, j = r.length - 1; i < r.length; j = i++) { const [x1, y1] = r[i], [x2, y2] = r[j]; if ((y1 > v) !== (y2 > v) && u < (x2 - x1) * (v - y1) / (y2 - y1) + x1) ins = !ins; } return ins; };
    return { n, area: Math.abs(area), c, p0: pts[0], has: p => inRing(rings[0], p[iu], p[iv]) && !rings.slice(1).some(r => inRing(r, p[iu], p[iv])) };
  }
  /** the faces of two solids that lie on each other: [area mm², normal] each */
  function faceContact(a, b) {
    if (!a.faces || !b.faces) return [];
    const ga = a.faces.map(f => faceGeo(a, f)), gb = b.faces.map(f => faceGeo(b, f)), out = [];
    ga.forEach(f => gb.forEach(g => {
      if (v3.dot(f.n, g.n) > -0.999 || Math.abs(v3.dot(v3.sub(f.c, g.p0), g.n)) > 0.02) return;
      if (g.has(f.c)) out.push([Math.min(f.area, g.area), f.n]); else if (f.has(g.c)) out.push([Math.min(f.area, g.area), f.n]);
    }));
    return out;
  }
  /** conductance (W/K) between two sets of solids where they touch: each touching pair of boxes by the area
      they share, through half of each body's thickness at its own conductivity */
  function contactG(as, bs) {
    // the heat crosses half of each body as a whole (a moulding split round its die is one body)
    const M = MAT(), whole = xs => { const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity]; xs.forEach(x => { const q = aabb(x); for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], q.lo[k]); hi[k] = Math.max(hi[k], q.hi[k]); } }); return { lo, hi }; };
    const WA = whole(as), WB = whole(bs); let G = 0;
    const across = n => { const d = [0, 1, 2].reduce((m, k) => (Math.abs(n[k]) > Math.abs(n[m]) ? k : m), 0); return [Math.min(5, (WA.hi[d] - WA.lo[d]) / 2), Math.min(5, (WB.hi[d] - WB.lo[d]) / 2)]; };
    as.forEach(a => bs.forEach(b => {
      const A = aabb(a), B2 = aabb(b), ka = M && M[a.mat] ? M[a.mat].k : 1, kb = M && M[b.mat] ? M[b.mat].k : 1;
      // faces lying on each other (a paddle in the hole through its moulding, a body on another's face)
      const fc = faceContact(a, b);
      if (fc.length) { fc.forEach(([area, n]) => { const [la, lb] = across(n); G += area * 1e-6 / (la * 1e-3 / ka + lb * 1e-3 / kb); }); return; }
      for (let d = 0; d < 3; d++) {
        const gap = Math.max(A.lo[d], B2.lo[d]) - Math.min(A.hi[d], B2.hi[d]); if (Math.abs(gap) > 0.05) continue;
        let area = 1; for (let e = 0; e < 3; e++) if (e !== d) area *= Math.max(0, Math.min(A.hi[e], B2.hi[e]) - Math.max(A.lo[e], B2.lo[e]));
        if (area <= 0) continue;
        const la = Math.min(5, (WA.hi[d] - WA.lo[d]) / 2), lb = Math.min(5, (WB.hi[d] - WB.lo[d]) / 2);
        G += area * 1e-6 / (la * 1e-3 / ka + lb * 1e-3 / kb); break;
      }
    }));
    return G;
  }
  /** a part's bodies as nodes: the main one (where its heat is made, or what its die or winding sits in:
      a tab, a can, a bulb) with its leads, and each other body of a very different conductivity joined to it
      where they touch (a body touching nothing of the main one, such as a valve's socket under its bulb, has
      no heat of the part to give off and is left out) */
  function bodyNodes(sol, type, bulb) {
    const M = MAT(), groups = new Map(), leads = [];
    sol.forEach(x => {
      if (x.inner && !x.main) return;      // a body inside (a die, a winding); a lead-frame paddle inside its moulding still carries the part
      if (x.mat === "lead" || x.mat === "gold") { leads.push(x); return; }
      const k = M && M[x.mat] ? M[x.mat].k : 1, key = x.node || (bulb && x.glass ? "bulb" : k >= 10 ? x.mat : "low");
      if (!groups.has(key)) groups.set(key, []); groups.get(key).push(x);
    });
    if (groups.size < 2) return { main: sol.filter(x => !x.inner || x.main), extra: [] };
    const area = xs => xs.reduce((a, x) => { const { lo, hi } = aabb(x), e = [0, 1, 2].map(k => hi[k] - lo[k]); return a + 2 * (e[0] * e[1] + e[1] * e[2] + e[0] * e[2]); }, 0);
    let mainKey = null;
    for (const [k, xs] of groups) if (xs.some(x => x.main)) mainKey = k;
    if (!mainKey && bulb && groups.has("bulb")) mainKey = "bulb";
    if (!mainKey) { let best = -1; for (const [k, xs] of groups) if (xs.some(x => x.heat) && area(xs) > best) { best = area(xs); mainKey = k; } }
    if (!mainKey) mainKey = groups.keys().next().value;
    const main = groups.get(mainKey), extra = [];
    // a lead-frame paddle inside its moulding: the heat spreads out through the moulding all round it (the paddle
    // and its die in contact with it, out to the moulding's open surface): k·√(Ai·Ao)/t
    const embedded = main.every(x => x.inner), core = embedded ? main.concat(sol.filter(x => x.inner && x.heat)) : null;
    for (const [k, xs] of groups) if (k !== mainKey) {
      let G = contactG(xs, main);
      if (embedded) {
        const Ai = core.reduce((a, c) => a + xs.reduce((u, x) => u + faceContact(c, x).reduce((w, [ar]) => w + ar, 0), 0), 0), Ao = films(xs, [0, 0, -1]).area;
        const W = xs.map(aabb).reduce((w, q) => ({ lo: w.lo.map((v, i) => Math.min(v, q.lo[i])), hi: w.hi.map((v, i) => Math.max(v, q.hi[i])) })), I = core.map(aabb).reduce((w, q) => ({ lo: w.lo.map((v, i) => Math.min(v, q.lo[i])), hi: w.hi.map((v, i) => Math.max(v, q.hi[i])) }));
        const tt = Math.max(0.3, Math.min(...[0, 1, 2].map(i => (W.hi[i] - W.lo[i] - (I.hi[i] - I.lo[i])) / 2)));
        const kx = M && M[xs[0].mat] ? M[xs[0].mat].k : 1;
        if (Ai > 0 && Ao > 0) G = Math.max(G, kx * Math.sqrt(Ai * Ao) * 1e-3 / tt);
      }
      if (G > 1e-6) extra.push({ key: k, solids: xs, G });
    }
    return { main: main.concat(leads), extra };
  }
  // a through-hole lead as the 3D view draws it (a round wire up from the pad, and the piece over to the
  // body where one starts at its top): its radius and length from the board's face to the body, mm
  function leadOf(solids, pad, t, back) {
    const R = solids.filter(s => s.round && sameColor(s.color, LEAD) && s.round.outer.length === 1 && s.round.outer[0].c);
    const ends = s => { const g = s.round, a = unit3(g.a); return [g.o, [g.o[0] + a[0] * g.h, g.o[1] + a[1] * g.h, g.o[2] + a[2] * g.h]]; };
    const up = R.find(s => { const g = s.round; return Math.abs(unit3(g.a)[2]) > 0.99 && Math.hypot(g.o[0] - pad.x, g.o[1] + pad.y) < 0.05; });
    if (!up) return null;
    const r = up.round.outer[0].r, [e0, e1] = ends(up), tip = back ? (e0[2] < e1[2] ? e0 : e1) : (e0[2] > e1[2] ? e0 : e1);
    let len = back ? -tip[2] : tip[2] - t;
    R.forEach(s => { if (s === up) return; const [a, b] = ends(s); if ([a, b].some(e => Math.hypot(e[0] - tip[0], e[1] - tip[1], e[2] - tip[2]) < r + 0.05)) len += s.round.h; });
    return { r, len };
  }

  function solve(board, model, netlist, opts) {
    opts = Object.assign(settings(board), opts || {});
    if (!model || !board) return { ok: false, why: "no board" };
    if (!netlist || !netlist.heat) return { ok: false, why: "no simulation" };
    const C = B(), o = board.outline, OL = root.BoardOutline, shaped = OL && OL.isShape && OL.isShape(o);
    const Ta = +opts.ambient, t = board.stackup.thickness || 1.6;
    // ---- the grid
    let step = opts.step > 0 ? +opts.step : Math.max(o.w, o.h) > 60 ? 1 : 0.5;
    step = Math.max(step, Math.sqrt(o.w * o.h / 14000));
    const nx = Math.max(2, Math.ceil(o.w / step)), ny = Math.max(2, Math.ceil(o.h / step)), N = nx * ny;
    const poly = C.outlinePoly(o, 0), cuts = shaped ? OL.polys(o, 0.02).slice(1) : [];
    const inPoly = (P, x, y) => { let c = false; for (let i = 0, j = P.length - 1; i < P.length; j = i++) { const a = P[i], b = P[j]; if ((a[1] > y) !== (b[1] > y) && x < (b[0] - a[0]) * (y - a[1]) / (b[1] - a[1]) + a[0]) c = !c; } return c; };
    const idx = new Int32Array(N).fill(-1); let n1 = 0;
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const x = (i + 0.5) * step, y = (j + 0.5) * step; if (inPoly(poly, x, y) && !cuts.some(P => inPoly(P, x, y))) idx[j * nx + i] = n1++; }
    if (!n1) return { ok: false, why: "no board" };
    const cellOf = (x, y) => { const i = Math.floor(x / step), j = Math.floor(y / step); return i < 0 || j < 0 || i >= nx || j >= ny ? -1 : idx[j * nx + i]; };
    // the nearest cell of the board to a point (a pad at the edge)
    const cellNear = (x, y) => { let c = cellOf(x, y); if (c >= 0) return c; for (let r = 1; r <= 3 && c < 0; r++) for (let dj = -r; dj <= r && c < 0; dj++) for (let di = -r; di <= r && c < 0; di++) c = cellOf(x + di * step, y + dj * step); return c; };

    // ---- copper: the share of every cell each layer covers
    const CU = C.copperOf(board), cover = new Map(CU.map(Lr => [Lr, new Float32Array(N)]));
    const add = (Lr, x, y, mm2) => { const a = cover.get(Lr); if (!a) return; const i = Math.floor(x / step), j = Math.floor(y / step); if (i < 0 || j < 0 || i >= nx || j >= ny) return; a[j * nx + i] += mm2 / (step * step); };
    (board.tracks || []).forEach(tr => { const p = tr.pts || []; for (let k = 1; k < p.length; k++) { const len = Math.hypot(p[k][0] - p[k - 1][0], p[k][1] - p[k - 1][1]), m = Math.max(1, Math.ceil(len / (step / 4))); for (let q = 0; q < m; q++) { const u = (q + 0.5) / m; add(tr.layer, p[k - 1][0] + (p[k][0] - p[k - 1][0]) * u, p[k - 1][1] + (p[k][1] - p[k - 1][1]) * u, (tr.w || 0.6) * len / m); } } });
    (board.zones || []).forEach(z => { const a = cover.get(z.layer); if (!a) return; const P = z.pts && z.pts.length >= 3 ? z.pts : null; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (idx[j * nx + i] >= 0 && (!P || inPoly(P, (i + 0.5) * step, (j + 0.5) * step))) a[j * nx + i] += 0.85; });
    const spread = (Lr, x, y, w, h) => { const m = Math.max(1, Math.ceil(w / (step / 2))), q = Math.max(1, Math.ceil(h / (step / 2))); for (let a = 0; a < m; a++) for (let b = 0; b < q; b++) add(Lr, x - w / 2 + (a + 0.5) * w / m, y - h / 2 + (b + 0.5) * h / q, w * h / (m * q)); };
    (model.pads || []).forEach(p => (p.layers || CU).forEach(Lr => spread(Lr, p.x, p.y, p.w || 1.6, p.h || p.w || 1.6)));
    (board.vias || []).forEach(v => CU.forEach(Lr => spread(Lr, v.x, v.y, v.pad || 1.8, v.pad || 1.8)));
    // the two sheets' conductance per square (W/K): copper of their layers, half the laminate each
    const tCu = Lr => ((Lr === "F.Cu" || Lr === "B.Cu" ? board.stackup.copper : board.stackup.innerCopper || board.stackup.copper) || 35) * 1e-6;
    const gs = [new Float32Array(N), new Float32Array(N)];
    CU.forEach((Lr, k) => { const a = cover.get(Lr), wTop = CU.length < 2 ? 0.5 : 1 - k / (CU.length - 1), g = K_CU * tCu(Lr); for (let c = 0; c < N; c++) { const f = Math.min(1, a[c]) * g; gs[0][c] += f * wTop; gs[1][c] += f * (1 - wTop); } });
    const gFr = K_FR4 * t * 1e-3 / 2;
    for (let c = 0; c < N; c++) { gs[0][c] += gFr; gs[1][c] += gFr; }

    // ---- the parts: bodies, heat, how each sits on the board
    const scene = root.Board3D ? root.Board3D.scene(board, model, { tubes: true }) : { bodies: [] }, dn = down(board, opts.orient);
    const byRef = new Map(); scene.bodies.forEach(s => { if (!byRef.has(s.ref)) byRef.set(s.ref, []); byRef.get(s.ref).push(s); });
    const src = sources(model, netlist, opts.point), padsOf = new Map();
    (model.pads || []).forEach(p => { if (!padsOf.has(p.part)) padsOf.set(p.part, []); padsOf.get(p.part).push(p); });
    const parts = [];
    (model.parts || []).forEach(g => {
      if (!g.place || !g.fp || g.type === "heater" || g.type === "star") return;
      const s = src.get(g.key) || { p: 0, heater: 0 }, sol = byRef.get(g.ref), pads = (padsOf.get(g.key) || []).filter(p => cellNear(p.x, p.y) >= 0);
      const how = g.place.heat || "auto";
      if (!sol || offBoard(g.fp.name) || !pads.length) { if (s.p + s.heater > 0.01) parts.push({ key: g.key, ref: g.ref, value: g.value, type: g.type, p: s.p, heater: s.heater, off: true, tj: s.tj, ts: s.ts, mount: "wired", path: "chassis" }); return; }
      const bb = bodyOf(sol), bulb = g.type === "tube" || g.type === "hgrect" || g.type === "gasreg" || g.type === "eye" ? bb.glass : null, b = bulb || bb.body, back = g.place.side === "B";
      const w = Math.max(0.5, b.x1 - b.x0), l = Math.max(0.5, b.y1 - b.y0), zb = back ? -b.z1 : b.z0 - t, hgt = Math.max(0.5, b.z1 - b.z0), gap = Math.max(0, zb);
      const smd = pads.every(p => p.smd), vert = !!g.fp.vert, lifted = C.liftOf ? C.liftOf(g.place, g.fp.name) > 0 : false;
      // exposed surface (mm²): a bulb its cylinder and dome, another body its sides and top (and its underside when it stands clear)
      const area = bulb ? Math.PI * Math.min(w, l) * hgt + Math.PI * Math.min(w, l) * Math.min(w, l) / 4 : 2 * (w + l) * hgt + w * l * (gap > 1.5 ? 2 : 1);
      const P = { key: g.key, ref: g.ref, value: g.value, type: g.type, p: s.p, heater: s.heater, tj: s.tj, ts: s.ts, sink: s.sink, how, rth: g.place.rth, back, smd, vert, lifted, bulb: !!bulb,
        box: { x0: bb.all.x0, y0: bb.all.y0, z0: bb.all.z0, x1: bb.all.x1, y1: bb.all.y1, z1: bb.all.z1 }, body: b, w, l, hgt, gap, area, film: null, emis: EPS, pads: [], under: [] };
      // to the air: every face of every solid of the part, its leads too, as MöbiusCAD has them; a part of
      // bodies that conduct very differently (a TO-220's copper tab and its epoxy) is a node for each, joined
      // where they touch, so the moulding runs cooler than the tab as it does
      if (sol.every(x => x.verts && x.faces)) {
        const own = bodyNodes(sol, g.type, !!bulb), surf = xs => { const f = films(xs, dn); let eA = 0; xs.forEach(x => { eA += films([x], dn).area * emisOf(x, g.type); }); return { f, emis: f.area > 0 ? eA / f.area : EPS }; };
        const m = surf(own.main); if (m.f.area > 0) { P.film = m.f; P.area = m.f.area; P.emis = m.emis; }
        P.extra = own.extra.map(x => { const e = surf(x.solids); return { key: x.key, film: e.f, area: e.f.area, emis: e.emis, G: x.G }; }).filter(x => x.area > 0);
      }
      const cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2;
      pads.forEach(p => {
        const cell = cellNear(p.x, p.y); let G, lw;
        if (p.smd) G = Math.min(1, (p.w || 1) * (p.h || p.w || 1) * SMD_G);
        else if (bulb) G = K_PIN * 0.8e-6 / 12e-3;     // a valve's pin through its socket: thin, long, a poor conductor
        else if ((lw = leadOf(sol, p, t, back))) G = kLead() * Math.PI * lw.r * lw.r * 1e-6 / (Math.max(0.5, lw.len) * 1e-3);
        else {
          const d = Math.max(0.4, (p.drill || 0.9) - 0.3), A = Math.PI * d * d / 4 * 1e-6;
          // the lead's length from the body to the pad: sideways from the body's box, down its stand-off
          let len = Math.max(0, Math.max(b.x0 - p.x, p.x - b.x1)) + Math.max(0, Math.max(b.y0 - p.y, p.y - b.y1)) + gap + 1;
          if (vert) len = Math.hypot(p.x - cx, p.y - cy) < 0.6 ? g.fp.vert.d + 1 : g.fp.vert.L + g.fp.vert.P + g.fp.vert.d;   // standing: the body on pad 1, its top lead over and down to pad 2
          G = kLead() * A / (len * 1e-3);
        }
        // the heat goes in over the pad's copper, not at one point: every cell under the pad takes its share
        const cells = []; for (let y = p.y - (p.h || p.w || 1.6) / 2 + step / 2; y < p.y + (p.h || p.w || 1.6) / 2; y += step) for (let x = p.x - (p.w || 1.6) / 2 + step / 2; x < p.x + (p.w || 1.6) / 2; x += step) { const c = cellOf(x, y); if (c >= 0 && !cells.includes(c)) cells.push(c); }
        if (!cells.length) cells.push(cell);
        P.pads.push({ x: p.x, y: p.y, r: Math.max(p.w || 1.6, p.h || p.w || 1.6) / 2, cell, cells, G, side: p.smd ? (p.layers[0] === "B.Cu" ? 1 : 0) : 2 });
      });
      if (ONE_LEAD.has(g.type) && !smd && P.pads.length > 1) { const one = Math.max(...P.pads.map(q => q.G)) / P.pads.length; P.pads.forEach(q => { q.G = one; }); }
      P.jn = junction(g);
      // the bodies inside: a die makes the junction (through the silicon, its solder and the spreading into
      // the tab under it, a node on the case), an electrolytic's winding its core (a long cylinder making its
      // heat evenly: the axis is P / (4π·k·L) over the can)
      const M = MAT(), ext = x => { const e = [0, 1, 2].map(k => Math.max(...x.verts.map(v => v[k])) - Math.min(...x.verts.map(v => v[k]))).sort((a, b) => a - b); return e; };
      const dieS = M && sol.find(x => x.mat === "silicon" && x.heat), coreS = M && sol.find(x => x.mat === "ecore" && x.round);
      if (dieS) { const [, a, b] = ext(dieS), base = sol.find(x => x.main && M[x.mat]); P.rDie = root.Board3D.dieR(Math.sqrt(a * b), base ? M[base.mat].k : undefined); }
      if (coreS) P.gCore = 4 * Math.PI * M.ecore.k * coreS.round.h * 1e-3;
      // an electrolytic: its rated temperature is its limit, its rated life halves with every 10 °C above it
      if (g.type === "electrolytic") { const q = (g.members[0] && g.members[0].params) || {}; P.cap = { tr: +q.temp > 0 ? +q.temp : CAP_TEMP, l0: +q.life > 0 ? +q.life : CAP_LIFE }; }
      // a case made for a heatsink, dissipating more than it can in free air, with no cooling said: on a heatsink
      if (how === "auto" && s.ts === undefined && !smd && TAB_CASE.test(g.fp.name) && s.p >= SINK_WATTS) P.assumed = true;
      // a body lying on the board (within 1.5 mm): the air gap under it carries heat too
      // bent over with its tab on the copper (set by hand): the tab's 1.5 °C/W into the board where the body then lies
      if (!bulb && (gap <= 1.5 || how === "board")) {
        const ex = how === "board" ? Math.max(0, hgt - w) / 2 : 0, ey = how === "board" ? Math.max(0, hgt - l) / 2 : 0;
        const cells = new Set(); for (let y = b.y0 - ey + step / 2; y < b.y1 + ey + step / 2; y += step) for (let x = b.x0 - ex + step / 2; x < b.x1 + ex + step / 2; x += step) { const c = cellOf(x, y); if (c >= 0) cells.add(c); }
        const Gt = (gap <= 1.5 && !smd ? K_AIR * w * l * 1e-6 / ((gap + 0.5) * 1e-3) : 0) + (how === "board" ? 1 / 1.5 : 0);
        if (cells.size && Gt > 0) { cells.forEach(c => P.under.push({ cell: c, G: Gt / cells.size })); P.underRect = [b.x0 - ex, b.y0 - ey, b.x1 + ex, b.y1 + ey]; }
      }
      parts.push(P);
    });
    const on = parts.filter(p => !p.off);
    const total = parts.reduce((a, p) => a + p.p + p.heater, 0);

    // ---- unknowns: the top sheet's cells, the bottom sheet's, the parts' bodies
    let nb = 2 * n1 + on.length;
    on.forEach(p => (p.extra || []).forEach(x => { x.node = nb++; }));
    const n = nb, Q = new Float64Array(n);
    on.forEach((p, k) => { p.node = 2 * n1 + k; Q[p.node] = p.p + p.heater; });
    // fixed edges (conduction): [i, j, g]
    const E = [];
    const cellXY = new Float32Array(2 * n1);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i, a = idx[c]; if (a < 0) continue;
      cellXY[2 * a] = (i + 0.5) * step; cellXY[2 * a + 1] = (j + 0.5) * step;
      [[i + 1, j], [i, j + 1]].forEach(([i2, j2]) => { if (i2 >= nx || j2 >= ny) return; const c2 = j2 * nx + i2, b = idx[c2]; if (b < 0) return; for (let s = 0; s < 2; s++) { const g1 = gs[s][c], g2 = gs[s][c2]; E.push(a + s * n1, b + s * n1, 2 * g1 * g2 / (g1 + g2)); } });
      E.push(a, a + n1, K_FR4 * step * step * 1e-6 / (t * 1e-3));
    }
    // plated holes: the barrel (25 µm of copper) and the lead in it join the two sheets
    const barrel = (x, y, d) => { const c = cellNear(x, y); if (c >= 0) E.push(c, c + n1, K_CU * Math.PI * d * 1e-3 * 25e-6 / (t * 1e-3) + kLead() * Math.PI * d * d / 4 * 1e-6 * 0.5 / (t * 1e-3)); };
    (model.pads || []).forEach(p => { if (!p.smd && p.drill > 0) barrel(p.x, p.y, p.drill); });
    (board.vias || []).forEach(v => { const c = cellNear(v.x, v.y); if (c >= 0) E.push(c, c + n1, K_CU * Math.PI * (v.drill || 0.8) * 1e-3 * 25e-6 / (t * 1e-3)); });
    on.forEach(p => {
      p.pads.forEach(q => q.cells.forEach(c => { const g = q.G / q.cells.length; if (q.side === 2) { E.push(p.node, c, g / 2); E.push(p.node, c + n1, g / 2); } else E.push(p.node, c + q.side * n1, g); }));
      p.under.forEach(q => E.push(p.node, q.cell + (p.back ? n1 : 0), q.G));
      (p.extra || []).forEach(x => E.push(p.node, x.node, x.G));
    });
    const nFixed = E.length / 3;
    // radiation of the bulbs onto the board and the parts next to them: [bulb node, other, share of the bulb's radiation]
    const R = [];
    on.filter(p => p.bulb).forEach(p => {
      const b = p.body, ax = (b.x0 + b.x1) / 2, ay = (b.y0 + b.y1) / 2, r = Math.min(p.w, p.l) / 2, z0 = Math.max(1, p.gap), z1 = z0 + p.hgt, reach = r + 3 * p.hgt, off = p.back ? n1 : 0;
      const i0 = Math.max(0, Math.floor((ax - reach) / step)), i1 = Math.min(nx - 1, Math.floor((ax + reach) / step)), j0 = Math.max(0, Math.floor((ay - reach) / step)), j1 = Math.min(ny - 1, Math.floor((ay + reach) / step));
      for (let j = j0; j <= j1; j++) for (let i = i0; i <= i1; i++) {
        const a = idx[j * nx + i]; if (a < 0) continue;
        const d = Math.hypot((i + 0.5) * step - ax, (j + 0.5) * step - ay); if (d > reach) continue;
        const rho = Math.max(d, r), f = step * step / (4 * Math.PI * p.hgt) * (1 / Math.hypot(rho, z0) - 1 / Math.hypot(rho, z1)) * (d < r ? 0.5 : 1);
        if (f > 1e-7) R.push(p.node, a + off, f * EPS);
      }
      on.forEach(q => {
        if (q === p || q.back !== p.back || (q.bulb && q.node < p.node)) return;
        const c = q.body, d = Math.max(r + 1, Math.hypot((c.x0 + c.x1) / 2 - ax, (c.y0 + c.y1) / 2 - ay)); if (d > r + 4 * p.hgt) return;
        const ov = Math.max(0, Math.min(b.z1, c.z1) - Math.max(b.z0, c.z0)) / p.hgt, phi = 2 * Math.atan(Math.sqrt(q.w * q.l) / (2 * d));
        const f = phi / (2 * Math.PI) * Math.min(1, ov) * 0.8; if (f > 1e-4) R.push(p.node, q.node, f * EPS);
      });
    });

    // ---- solve: the film coefficients depend on the temperatures, so a few passes
    const T = new Float64Array(n).fill(Ta + 20), enc = ENCLOSURE[opts.enclosure] || 1, cellA = step * step * 1e-6;
    // the board's faces to the air (per mm² of each sheet): its top and bottom faces by their own sizes, the
    // edges and hole walls shared over both sheets
    const bf = scene.board ? films([scene.board], dn, true) : null, sheetF = [{ hot: 0, cold: 0 }, { hot: 0, cold: 0 }];
    if (bf) {
      const side = { hot: 0, cold: 0 }, fa = [0, 0];
      bf.faces.forEach(q => { const s = q.n[2] > 0.99 ? 0 : q.n[2] < -0.99 ? 1 : -1; const to = s < 0 ? side : sheetF[s]; to.hot += q.hot; to.cold += q.cold; if (s >= 0) fa[s] += q.area; });
      for (let s = 0; s < 2; s++) { const a = fa[s] || n1 * step * step; sheetF[s].hot = (sheetF[s].hot + side.hot / 2) / a; sheetF[s].cold = (sheetF[s].cold + side.cold / 2) / a; }
    } else {
      const lh = o.w * o.h / (2 * (o.w + o.h)), up = -dn[2];
      for (let s = 0; s < 2; s++) { const u = s ? -up : up; sheetF[s].hot = filmTerm(u, Math.max(1, t), lh); sheetF[s].cold = filmTerm(-u, Math.max(1, t), lh); }
    }
    const nat = (F, dT) => enc * (dT >= 0 ? F.hot : F.cold) * Math.pow(Math.max(Math.abs(dT), 0.05), 0.25);
    const cellMm2 = step * step;
    const hRad = (a, b) => { const x = a + 273.15, y = b + 273.15; return SIGMA * (x * x + y * y) * (x + y); };
    const gA = new Float64Array(n), tA = new Float64Array(n), diag = new Float64Array(n), rhs = new Float64Array(n);
    // the edges as arrays: the fixed ones (conduction), then the bulbs' radiation (its conductance set in each pass)
    const nR = R.length / 3, nAll = nFixed + nR, ei = new Int32Array(nAll), ej = new Int32Array(nAll), eg = new Float64Array(nAll);
    for (let k = 0; k < nFixed; k++) { ei[k] = E[3 * k]; ej[k] = E[3 * k + 1]; eg[k] = E[3 * k + 2]; }
    for (let k = 0; k < nR; k++) { ei[nFixed + k] = R[3 * k]; ej[nFixed + k] = R[3 * k + 1]; }
    let iterations = 0;
    const mul = (x, y) => { for (let i = 0; i < n; i++) y[i] = diag[i] * x[i]; for (let k = 0; k < nAll; k++) { const i = ei[k], j = ej[k], g = eg[k]; y[i] -= g * x[j]; y[j] -= g * x[i]; } };
    const fOutOf = new Float64Array(on.length); for (let k = 0; k < nR; k++) fOutOf[R[3 * k] - 2 * n1] += R[3 * k + 2] / EPS;
    const r = new Float64Array(n), z = new Float64Array(n), d = new Float64Array(n), q = new Float64Array(n), Tprev = new Float64Array(n);
    for (let pass = 0; pass < 8; pass++) {
      Tprev.set(T);
      // surfaces to the air
      for (let s = 0; s < 2; s++) for (let a = 0; a < n1; a++) { const i = a + s * n1; gA[i] = nat(sheetF[s], T[i] - Ta) * cellMm2 + EPS * hRad(T[i], Ta) * cellA; tA[i] = Ta; }
      on.forEach((p, kp) => {
        const i = p.node, dT = T[i] - Ta, hr = (p.emis || EPS) * hRad(T[i], Ta), A = p.area * 1e-6;
        const gc = p.film ? nat(p.film, dT) : enc * filmTerm(1, p.hgt, Math.min(p.w, p.l)) * p.area * Math.pow(Math.max(Math.abs(dT), 0.05), 0.25);
        p.hr = hr * A;
        const fOut = fOutOf[kp];
        gA[i] = gc + hr * A * Math.max(0.3, 1 - fOut); tA[i] = Ta; p.gSink = 0;
        // on a heatsink: the engine's heatsink temperature through the insulator (0.5 K/W); set by hand: its Rth to the air
        if (p.ts !== undefined && p.how === "auto") { p.gSink = 2; p.tSink = p.ts; }
        else if (p.how === "heatsink" || p.assumed) { p.gSink = 1 / ((+p.rth > 0 ? +p.rth : SINK_RTH) + 0.5); p.tSink = Ta; }
        else if (p.how === "chassis") { p.gSink = 1; p.tSink = Ta; }
        (p.extra || []).forEach(x => { const dx = T[x.node] - Ta; gA[x.node] = nat(x.film, dx) + x.emis * hRad(T[x.node], Ta) * x.area * 1e-6; tA[x.node] = Ta; });
      });
      for (let k = 0; k < nR; k++) eg[nFixed + k] = on[R[3 * k] - 2 * n1].hr * R[3 * k + 2];
      for (let i = 0; i < n; i++) { diag[i] = gA[i]; rhs[i] = Q[i] + gA[i] * tA[i]; }
      on.forEach(p => { if (p.gSink) { diag[p.node] += p.gSink; rhs[p.node] += p.gSink * p.tSink; } });
      for (let k = 0; k < nAll; k++) { diag[ei[k]] += eg[k]; diag[ej[k]] += eg[k]; }
      // conjugate gradients, Jacobi preconditioned, from the last pass's temperatures
      mul(T, q); let rz = 0, r0 = 0;
      for (let i = 0; i < n; i++) { r[i] = rhs[i] - q[i]; z[i] = r[i] / diag[i]; d[i] = z[i]; rz += r[i] * z[i]; r0 += rhs[i] * rhs[i]; }
      const tol = 1e-10 * Math.max(r0, 1e-30);
      for (let it = 0; it < 4000; it++) {
        let rr = 0; for (let i = 0; i < n; i++) rr += r[i] * r[i];
        if (rr <= tol) break;
        mul(d, q); let dq = 0; for (let i = 0; i < n; i++) dq += d[i] * q[i];
        const al = rz / dq; let rz2 = 0;
        for (let i = 0; i < n; i++) { T[i] += al * d[i]; r[i] -= al * q[i]; z[i] = r[i] / diag[i]; rz2 += r[i] * z[i]; }
        const be = rz2 / rz; rz = rz2;
        for (let i = 0; i < n; i++) d[i] = z[i] + be * d[i];
        iterations++;
      }
      // settled: no temperature moved by more than 0.05 °C since the last pass
      let moved = 0; for (let i = 0; i < n; i++) moved = Math.max(moved, Math.abs(T[i] - Tprev[i]));
      if (pass && moved < 0.05) break;
    }

    // ---- results
    const top = new Float32Array(N).fill(NaN), bottom = new Float32Array(N).fill(NaN), flux = [new Float32Array(N), new Float32Array(N)];   // flux: W/m² leaving each face to the air
    let tMin = Infinity, tMax = -Infinity, hot = null, out = 0;
    for (let c = 0; c < N; c++) { const a = idx[c]; if (a < 0) continue; top[c] = T[a]; bottom[c] = T[a + n1]; for (let s = 0; s < 2; s++) { const v = T[a + s * n1]; flux[s][c] = gA[a + s * n1] * (v - Ta) / cellA; out += gA[a + s * n1] * (v - Ta); if (v < tMin) tMin = v; if (v > tMax) { tMax = v; hot = { x: (c % nx + 0.5) * step, y: (Math.floor(c / nx) + 0.5) * step, t: v, side: s ? "bottom" : "top" }; } } }
    const boardMax = tMax;
    const flow = new Float64Array(n);     // heat leaving each part node by conduction into the board, and by radiation
    const rad = new Float64Array(n);
    for (let k = 0; k < nAll; k++) { const i = ei[k], j = ej[k], f = eg[k] * (T[i] - T[j]); if (k < nFixed && i >= 2 * n1 && j >= 2 * n1) continue; if (i >= 2 * n1) (k < nFixed ? flow : rad)[i] += f; if (j >= 2 * n1) (k < nFixed ? flow : rad)[j] -= f; }
    // where a part's board share goes in (MöbiusCAD's PackageHeat.into): a disc per pad, a rectangle under the
    // body, W each; in the board's frame (x right, y up: the layout's y turned over)
    const intoOf = (p, t0) => {
      const sheetT = (c, side) => (side === 2 ? (T[c] + T[c + n1]) / 2 : T[c + side * n1]), out = [];
      p.pads.forEach(q => { const w = q.cells.reduce((a, c) => a + q.G / q.cells.length * (t0 - sheetT(c, q.side)), 0); if (w > 1e-4) out.push({ disc: [q.x, -q.y, q.r], w }); });
      const wu = p.under.reduce((a, q) => a + q.G * (t0 - T[q.cell + (p.back ? n1 : 0)]), 0), u = p.underRect;
      if (u && wu > 1e-4) out.push({ rect: [u[0], -u[3], u[2], -u[1]], w: wu });
      return out;
    };
    const res = parts.map(p => {
      if (p.off) return { key: p.key, ref: p.ref, value: p.value, type: p.type, p: p.p, heater: p.heater, toBoard: 0, toAir: 0, toSink: p.p + p.heater, byRadiation: 0, t: null, tKind: null, tj: p.tj, ts: p.ts, mount: p.mount, path: p.path, box: null, off: true };
      const i = p.node, t0 = T[i], toSink = p.gSink ? p.gSink * (t0 - p.tSink) : 0, toAir = gA[i] * (t0 - Ta) + (p.extra || []).reduce((a, x) => a + gA[x.node] * (T[x.node] - Ta), 0);
      out += toAir + toSink;
      const mount = p.gSink ? (p.how === "chassis" ? "chassis" : "heatsink") : p.how === "board" ? "tab" : p.bulb ? "socket" : p.smd ? "smd" : p.vert ? "standing" : p.lifted ? "raised" : p.gap <= 1.5 && p.hgt < Math.max(p.w, p.l) ? "lying" : "upright";
      const sh = [["board", flow[i]], ["air", toAir + rad[i]], [p.how === "chassis" ? "chassis" : "heatsink", toSink]].sort((a, b) => b[1] - a[1]);
      const pw = p.p + p.heater;
      let lim = LIMITS[p.type], tj = p.how === "auto" ? p.tj : undefined;   // cooled another way than the simulation had it: its junction from this map
      const tKind = p.bulb ? "bulb" : p.tj !== undefined || p.jn || p.rDie !== undefined ? "case" : "body";
      const rjc = p.rDie !== undefined ? p.rDie : p.jn ? p.jn.rjc : undefined;
      if (rjc !== undefined && tj === undefined && (p.jn || p.p > 0.01)) tj = t0 + p.p * rjc;
      if (p.jn) lim = p.jn.tjmax;
      const tCore = p.gCore ? t0 + p.p / p.gCore : undefined;
      const life = p.cap ? capLife(p.cap.l0, p.cap.tr, tCore !== undefined ? tCore : t0) : undefined; if (p.cap) lim = p.cap.tr;
      p.tj = tj;
      if (t0 > tMax) tMax = t0; if (t0 < tMin) tMin = t0;
      if (p.tj !== undefined && p.tj > tMax) tMax = p.tj;
      if (tCore !== undefined && tCore > tMax) tMax = tCore;
      return { key: p.key, ref: p.ref, value: p.value, type: p.type, p: p.p, heater: p.heater, toBoard: flow[i], toAir, toSink, byRadiation: rad[i], t: t0, tKind, tj: p.tj, rjc, tCore, bodies: (p.extra || []).length ? (p.extra || []).map(x => ({ key: x.key, t: T[x.node] })) : undefined, ts: p.ts, limit: lim, life, lifeRated: p.cap ? p.cap.l0 : undefined, assumed: !!p.assumed, mount, path: pw > 0.01 ? sh[0][0] : "air", box: p.box, back: p.back,
        tPads: p.pads.length ? p.pads.reduce((a, q) => a + (q.side === 2 ? (T[q.cell] + T[q.cell + n1]) / 2 : T[q.cell + q.side * n1]), 0) / p.pads.length : t0, into: intoOf(p, t0) };
    });
    return { ok: true, nx, ny, step, top, bottom, flux, copper: CU.map(Lr => ({ layer: Lr, cover: cover.get(Lr) })), thickness: t, emissivity: EPS, parts: res, ambient: Ta, tMin: Math.min(tMin, Ta), tMax, boardMax, hot, total, balance: total - out - res.filter(p => p.off).reduce((a, p) => a + p.p + p.heater, 0), iterations, settings: { ambient: Ta, enclosure: opts.enclosure, orient: opts.orient, point: opts.point } };
  }

  // the temperature of the board at a point (bilinear between cell centres; null off the board)
  /** An electrolytic's life at t °C: its rated hours at its rated temperature, doubled for every 10 °C
      under it (the makers' rule), and no more than 15 years of running however cool it is */
  function capLife(l0, tr, t) { return Math.min(CAP_LIFE_MAX, l0 * Math.pow(2, (tr - t) / 10)); }

  /** What the map says is wrong, as notes for the board's check list: [{ kind: "thermal", x, y, msg }].
      rules: boardTmax (105 °C: FR-4 darkens and weakens above it), capLife (hours, 10 000) */
  function checks(res, rules) {
    const out = []; if (!res || !res.ok) return out;
    const R = rules || {}, tb = R.boardTmax > 0 ? +R.boardTmax : 105, lifeMin = R.capLife > 0 ? +R.capLife : 10000, deg = v => Math.round(v) + " °C";
    const on = res.parts.filter(p => p.box && p.t !== null), mid = p => [(p.box.x0 + p.box.x1) / 2, (p.box.y0 + p.box.y1) / 2];
    const at0 = `at ${res.ambient} °C ambient`;
    if (res.boardMax > tb && res.hot) {
      // the part the hot spot is under or beside: the nearest one giving off heat
      let near = null, nd = Infinity;
      on.forEach(p => { if (p.p + p.heater < 0.05) return; const d = Math.hypot(Math.max(p.box.x0 - res.hot.x, 0, res.hot.x - p.box.x1), Math.max(p.box.y0 - res.hot.y, 0, res.hot.y - p.box.y1)); if (d < nd) { nd = d; near = p; } });
      const by = near && nd < 15 ? (nd < 0.5 ? ` under ${near.ref}` : ` by ${near.ref}`) : "";
      const cure = near && near.mount === "lying" ? `raise ${near.ref} off the board (its Height above board) or stand it on end` : near && near.mount === "raised" ? `raise ${near.ref} higher, or give it more room` : "give the hot part more copper or a heatsink, or more room";
      out.push({ kind: "thermal", x: res.hot.x, y: res.hot.y, msg: `The board reaches ${deg(res.boardMax)}${by} (${res.hot.side} side, ${at0}): FR-4 darkens and weakens above ${tb} °C; ${cure}` });
    }
    on.forEach(p => {
      const [x, y] = mid(p);
      if (p.life !== undefined) {
        const tc = p.tCore !== undefined ? p.tCore : p.t, where = p.tCore !== undefined ? "its core reaches" : "sits at";
        if (tc > p.limit) out.push({ kind: "thermal", x, y, msg: `${p.ref} (electrolytic, rated ${p.limit} °C) ${where} ${deg(tc)} ${at0}: over its rating; move it away from the heat or fit a ${p.limit < 105 ? "105" : "125"} °C part` });
        else if (p.life < lifeMin) out.push({ kind: "thermal", x, y, msg: `${p.ref} (electrolytic, ${p.lifeRated} h at ${p.limit} °C) ${where} ${deg(tc)} ${at0}: about ${lifeText(p.life)} of life, under ${lifeText(lifeMin)}; every 10 °C cooler doubles it` });
        return;
      }
      if (!p.limit) return;
      const t = p.tj !== undefined ? p.tj : p.t;
      if (t > p.limit) out.push({ kind: "thermal", x, y, msg: `${p.ref}${p.value ? " (" + p.value + ")" : ""}: ${p.tj !== undefined ? "junction" : "body"} ${deg(t)} with ${fmtW(p.p + p.heater)} in it (${at0}), over its ${p.limit} °C${p.assumed ? " even on the assumed heatsink" : p.mount === "heatsink" || p.mount === "chassis" ? "" : p.tj !== undefined ? "; it needs a heatsink or more copper" : "; fit a larger part or share the heat between two"}` });
    });
    return out;
  }
  const fmtW = w => (w >= 1 ? +w.toFixed(1) + " W" : Math.round(w * 1000) + " mW");
  const lifeText = h => (h >= CAP_LIFE_MAX ? "over 130 000 h" : h >= 10000 ? Math.round(h / 1000) * 1000 + " h" : Math.round(h / 100) * 100 + " h").replace(/(\d)(?=(\d{3})+ h)/g, "$1 ");

  function at(res, x, y, side) {
    if (!res || !res.ok) return null;
    const a = side === "bottom" ? res.bottom : res.top, fx = x / res.step - 0.5, fy = y / res.step - 0.5, i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j;
    let s = 0, w = 0;
    [[i, j, (1 - u) * (1 - v)], [i + 1, j, u * (1 - v)], [i, j + 1, (1 - u) * v], [i + 1, j + 1, u * v]].forEach(([p, q, k]) => { if (p < 0 || q < 0 || p >= res.nx || q >= res.ny) return; const t = a[q * res.nx + p]; if (Number.isFinite(t)) { s += t * k; w += k; } });
    return w > 1e-6 ? s / w : null;
  }

  root.BoardThermal = { settings, down, films, junction, sources, solve, at, checks, capLife, lifeText, CAP_TEMP, CAP_LIFE, color, DEFAULTS, ENCLOSURE, LIMITS };
})(typeof window !== "undefined" ? window : globalThis);
