/* =============================================================================
   BOARD DESIGN — 3D (no DOM, Node-testable). The board and every part as closed solids
   (polyhedra with planar faces), in millimetres, world axes x right, y up (board y
   flipped), z up from the board's bottom face. From them: STEP (ISO 10303-21, AP214,
   advanced B-rep with shared edges and colours) and the meshes of the 3D view.
   A solid: { name, ref, color: [r, g, b], alpha, verts: [[x, y, z]...], faces: [{ loops: [[i...]...], n: [nx, ny, nz] }] }
   (loops[0] outer, counter-clockwise about the outward normal n; further loops are holes).
   Depends on: board-core.js
   ============================================================================= */
(function (root) {
  "use strict";
  const B = () => root.BoardCore;
  const C = {
    board: [0.09, 0.38, 0.2], lead: [0.8, 0.8, 0.82], metal: [0.78, 0.78, 0.8], black: [0.12, 0.12, 0.13], resistor: [0.42, 0.6, 0.86], diode: [0.1, 0.1, 0.1],
    band: [0.75, 0.75, 0.75], film: [0.82, 0.22, 0.14], disc: [0.9, 0.6, 0.25], ecap: [0.12, 0.2, 0.45], ecapTop: [0.7, 0.72, 0.75], snapin: [0.13, 0.13, 0.15],
    glass: [0.78, 0.88, 0.95], plate: [0.3, 0.3, 0.32], getter: [0.62, 0.62, 0.66], ceramic: [0.9, 0.87, 0.78], bakelite: [0.16, 0.13, 0.11], core: [0.36, 0.36, 0.39],
    coil: [0.86, 0.55, 0.2], terminal: [0.1, 0.55, 0.28], jack: [0.15, 0.15, 0.16], pot: [0.25, 0.27, 0.32], trim: [0.2, 0.35, 0.75], led: [0.9, 0.15, 0.1],
    wireRed: [0.8, 0.12, 0.1], wireBlack: [0.08, 0.08, 0.08], generic: [0.55, 0.55, 0.58], chipCap: [0.66, 0.52, 0.34], glassRed: [0.7, 0.2, 0.15]
  };
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const avg = pts => { const s = [0, 0, 0]; pts.forEach(p => { s[0] += p[0]; s[1] += p[1]; s[2] += p[2]; }); return s.map(v => v / pts.length); };
  function newell(V, loop) { const n = [0, 0, 0]; for (let i = 0; i < loop.length; i++) { const a = V[loop[i]], b = V[loop[(i + 1) % loop.length]]; n[0] += (a[1] - b[1]) * (a[2] + b[2]); n[1] += (a[2] - b[2]) * (a[0] + b[0]); n[2] += (a[0] - b[0]) * (a[1] + b[1]); } return n; }
  const unit = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return v.map(c => c / l); };
  // a face whose outer loop turns counter-clockwise about `want`, holes the other way
  function face(V, loops, want) {
    const L = loops.map((l, k) => { const n = newell(V, l), good = k === 0 ? dot(n, want) > 0 : dot(n, want) < 0; return good ? l : l.slice().reverse(); });
    return { loops: L, n: unit(newell(V, L[0])) };
  }
  const circle = (r, n) => Array.from({ length: n }, (_, k) => { const a = 2 * Math.PI * k / n; return [r * Math.cos(a), r * Math.sin(a)]; });
  const sides = r => (r < 1 ? 12 : r < 4 ? 20 : 32);

  // ---------------------------------------------------------------------------
  // Prisms in a part's own frame (footprint x, y with y down, z up from the board surface);
  // `to` maps a local point to the world. axis z: poly in (x, y); x: in (y, z); y: in (x, z).
  // ---------------------------------------------------------------------------
  function prism(axis, poly, a1, a2, color, to, extra) {
    if (Math.abs(a2 - a1) < 0.02) return null;                 // nothing to draw (a lead of no length)
    const P = (u, v, w) => (axis === "z" ? [u, v, w] : axis === "x" ? [w, u, v] : [u, w, v]);
    const V = [], n = poly.length;
    poly.forEach(([u, v]) => V.push(to(P(u, v, a1))));
    poly.forEach(([u, v]) => V.push(to(P(u, v, a2))));
    const cb = avg(V.slice(0, n)), ct = avg(V.slice(n)), axisW = sub(ct, cb), mid = avg([cb, ct]), F = [];
    F.push(face(V, [poly.map((_, i) => i)], axisW.map(c => -c)), face(V, [poly.map((_, i) => n + i)], axisW));
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, q = [i, j, n + j, n + i]; F.push(face(V, [q], sub(avg(q.map(k => V[k])), mid))); }
    return { color, alpha: 1, verts: V, faces: F, ...(extra || {}) };
  }
  const rect = (x1, y1, x2, y2) => [[x1, y1], [x2, y1], [x2, y2], [x1, y2]];
  const box = (x1, y1, x2, y2, z1, z2, color, to, ex) => prism("z", rect(x1, y1, x2, y2), z1, z2, color, to, ex);
  const cylZ = (x, y, r, z1, z2, color, to, ex) => prism("z", circle(r, sides(r)).map(([a, b]) => [x + a, y + b]), z1, z2, color, to, ex);
  const cylX = (y, z, r, x1, x2, color, to, ex) => prism("x", circle(r, sides(r)).map(([a, b]) => [y + a, z + b]), x1, x2, color, to, ex);
  const cylY = (x, z, r, y1, y2, color, to, ex) => prism("y", circle(r, sides(r)).map(([a, b]) => [x + a, z + b]), y1, y2, color, to, ex);

  // ---------------------------------------------------------------------------
  // A part's body, from its footprint (typical sizes: a model of the part, not its datasheet)
  // ---------------------------------------------------------------------------
  const RADIAL_H = { 5: 11, 6.3: 11, 8: 12, 10: 16, 12.5: 20, 16: 25, 18: 31, 22: 35, 25: 40, 30: 45, 35: 50 };
  const SNAPIN_H = { 22: 30, 25: 35, 30: 40, 35: 50 };
  // the valve on its socket: diameter and seated height
  const TUBE = { B9A: [22.2, 49], B7G: [19, 44], B9D: [30, 78], OCTAL: [33, 95], UX4: [52, 130] };
  function partBodies(g, t, opts) {
    const fp = g.fp, name = fp.name, P = g.place, out = [], side = P.side === "B" ? "B" : "F";
    const to = ([x, y, z]) => { const [X, Y] = B().place([x, y], P); return [X, -Y, side === "B" ? -z : t + z]; };
    const pads = fp.pads, lead = (x, y, ztop) => out.push(cylZ(x, y, 0.3, -1.2 - t, ztop, C.lead, to));
    const D = B().FPDATA;
    let m;
    if ((m = /^(AXIAL|DIODE)-([\d.]+)$/.exec(name))) {
      const [L, Dm] = D.AXIAL[m[2]], h = +m[2] / 2, zc = Dm / 2 + 0.4;
      out.push(cylX(0, zc, Dm / 2, -L / 2, L / 2, m[1] === "DIODE" ? C.diode : C.resistor, to));
      if (m[1] === "DIODE") out.push(cylX(0, zc, Dm / 2 + 0.05, -L / 2 + 0.1 * L, -L / 2 + 0.22 * L, C.band, to));
      [-1, 1].forEach(sg => { out.push(cylX(0, zc, 0.3, sg < 0 ? -h : L / 2, sg < 0 ? -L / 2 : h, C.lead, to)); lead(sg * h, 0, zc); });
    } else if ((m = /^BOX-([\d.]+)$/.exec(name))) {
      const [L, W] = D.BOX[m[1]], H = W * 1.5 + 3; out.push(box(-L / 2, -W / 2, L / 2, W / 2, 0.3, H, C.film, to)); pads.forEach(p => lead(p.x, p.y, 0.5));
    } else if ((m = /^DISC-([\d.]+)$/.exec(name))) {
      const r = (+m[1] + 3.2) / 2, zc = r + 2; out.push(cylY(0, zc, r, -1, 1, C.disc, to)); pads.forEach(p => lead(p.x, p.y, zc - r * 0.5));
    } else if ((m = /^RADIAL-D([\d.]+)-P([\d.]+)$/.exec(name)) || (m = /^SNAPIN-D(\d+)$/.exec(name))) {
      const d = +m[1], H = (/^SNAPIN/.test(name) ? SNAPIN_H : RADIAL_H)[d] || d * 1.6, r = d / 2;
      out.push(cylZ(0, 0, r, 0.3, H - 0.4, /^SNAPIN/.test(name) ? C.snapin : C.ecap, to), cylZ(0, 0, r * 0.92, H - 0.4, H, C.ecapTop, to));
      pads.forEach(p => lead(p.x, p.y, 0.5));
    } else if ((m = /^ECAP-AXIAL-([\d.]+)$/.exec(name))) {
      const [L, Dm] = D.ECAP_AXIAL[m[1]], h = +m[1] / 2, zc = Dm / 2 + 0.4;
      out.push(cylX(0, zc, Dm / 2, -L / 2, L / 2, C.ecap, to));
      [-1, 1].forEach(sg => { out.push(cylX(0, zc, 0.4, sg < 0 ? -h : L / 2, sg < 0 ? -L / 2 : h, C.lead, to)); lead(sg * h, 0, zc); });
    } else if ((m = /^TO-92-/.exec(name))) {
      const arc = Array.from({ length: 13 }, (_, k) => { const a = Math.PI + Math.PI * k / 12; return [2.4 * Math.cos(a), 1.6 + 2.4 * Math.sin(a) * 1.15]; });
      out.push(prism("z", arc, 2, 6.8, C.black, to)); pads.forEach(p => lead(p.x, p.y, 2));
    } else if ((m = /^TO-18-/.exec(name))) {
      out.push(cylZ(0, 0, 2.75, 1.5, 1.9, C.metal, to), cylZ(0, 0, 2.35, 1.9, 6.6, C.metal, to)); pads.forEach(p => lead(p.x, p.y, 1.5));
    } else if ((m = /^(TO-1|TO-5|MP)-/.exec(name))) {
      // germanium cans: TO-1 tall and slim, TO-5 low and wide, the USSR MP can on its flange
      const r = fp.silk.find(t => t.t === "circle").r, H = { "TO-1": 9, "TO-5": 6.4, MP: 9.5 }[m[1]];
      if (m[1] === "MP") out.push(cylZ(0, 0, r, 1.5, 2.1, C.metal, to), cylZ(0, 0, r * 0.68, 2.1, 1.5 + H, C.metal, to));
      else out.push(cylZ(0, 0, r, 1.5, 2, C.metal, to), cylZ(0, 0, r * 0.88, 2, 1.5 + H, C.metal, to));
      pads.forEach(p => lead(p.x, p.y, 1.5));
    } else if ((m = /^TO-(126|220|247|3P|264)-/.exec(name))) {
      const r = fp.silk.find(s => s.t === "rect"), tab = m[1] !== "126", H = { 126: 11, 220: 9.2, 247: 20.5, "3P": 20, 264: 26 }[m[1]], zb = 2.5;
      out.push(box(r.x, r.y, r.x + r.w, r.y + r.h, zb, zb + H, C.black, to));
      if (tab) out.push(box(r.x, r.y, r.x + r.w, r.y + 1.3, zb, zb + H + (m[1] === "220" ? 6.3 : 0.1), C.metal, to));
      pads.forEach(p => { lead(p.x, p.y, 1.2); out.push(cylY(p.x, 1.2, 0.3, Math.min(p.y, r.y + r.h / 2), Math.max(p.y, r.y + r.h / 2), C.lead, to)); out.push(cylZ(p.x, r.y + r.h / 2, 0.3, 1.2, zb, C.lead, to)); });
    } else if ((m = /^LED-(\d)MM$/.exec(name))) {
      const r = +m[1] / 2, H = m[1] === "5" ? 8.6 : 5.3, col = C.led;
      out.push(cylZ(0, 0, r + 0.4, 1.5, 2.5, col, to, { alpha: 0.75 }), cylZ(0, 0, r, 2.5, 1.5 + H - r * 0.6, col, to, { alpha: 0.75 }), cylZ(0, 0, r * 0.7, 1.5 + H - r * 0.6, 1.5 + H - r * 0.2, col, to, { alpha: 0.75 }), cylZ(0, 0, r * 0.35, 1.5 + H - r * 0.2, 1.5 + H, col, to, { alpha: 0.75 }));
      pads.forEach(p => lead(p.x, p.y, 1.5));
    } else if ((m = /^POT-(\w+)$/.exec(name))) {
      const r = fp.silk.find(s => s.t === "rect"), c = fp.silk.find(s => s.t === "circle"), H = { "9MM": 6.5, "16MM": 9, "24MM": 12 }[m[1]] || 9;
      out.push(box(r.x, r.y, r.x + r.w, r.y + r.h, 0.5, H, C.pot, to), cylZ(c.x, c.y, 3.5, H, H + 2, C.metal, to), cylZ(c.x, c.y, 3, H + 2, H + 17, C.metal, to));
      pads.forEach(p => { lead(p.x, p.y, 3); out.push(cylY(p.x, 3, 0.4, Math.min(p.y, r.y + r.h), Math.max(p.y, r.y + r.h), C.lead, to)); });
    } else if (name === "TRIM-3296W") {
      out.push(box(-4.75, -2.4, 4.75, 2.4, 0.5, 10, C.trim, to), cylZ(-3.9, -1.5, 0.9, 10, 11, C.metal, to)); pads.forEach(p => lead(p.x, p.y, 0.5));
    } else if ((m = /^SOCKET-([A-Z0-9]+)$/.exec(name))) {
      const k = m[1], S = D.SOCKETS[k] || { body: 26 }, [td, th] = TUBE[k] || [22, 50], dark = k === "OCTAL" || k === "UX4", zs = 6;
      out.push(cylZ(0, 0, S.body / 2, 0, zs, dark ? C.bakelite : C.ceramic, to));
      pads.forEach(p => lead(p.x, p.y, 1));
      if (opts.tubes !== false) {
        const rr = td / 2;
        out.push(cylZ(0, 0, rr, zs + 0.15, zs + th * 0.86, C.glass, to, { alpha: 0.3, glass: true }), cylZ(0, 0, rr * 0.82, zs + th * 0.86, zs + th * 0.95, C.glass, to, { alpha: 0.3, glass: true }),
          cylZ(0, 0, rr * 0.45, zs + th * 0.95, zs + th, C.glass, to, { alpha: 0.3, glass: true }),
          box(-rr * 0.55, -rr * 0.25, rr * 0.55, rr * 0.25, zs + th * 0.2, zs + th * 0.7, C.plate, to, { inner: true }),
          cylZ(0, 0, rr * 0.6, zs + th * 0.8, zs + th * 0.82, C.getter, to, { inner: true }));
      }
    } else if ((m = /^(?:XFMR-EI(\d+)-\w+|CHOKE-EI(\d+))$/.exec(name))) {
      const s = +(m[1] || m[2]), W = s, Dd = Math.round(s * 0.85), H = s * 0.82;
      out.push(box(-W / 2, -Dd * 0.27, W / 2, Dd * 0.27, 0, H, C.core, to), box(-W * 0.31, -Dd / 2 + 1.5, W * 0.31, Dd / 2 - 1.5, H * 0.14, H * 0.86, C.coil, to));
      pads.forEach(p => lead(p.x, p.y, 0.5));
    } else if ((m = /^TERM-([\d.]+)-(\d+)$/.exec(name))) {
      const p0 = +m[1], n = +m[2], W = n * p0, Hh = p0 >= 7 ? 10 : 8, Z = p0 >= 7 ? 12 : 10;
      out.push(box(-W / 2, -Hh / 2, W / 2, Hh / 2, 0, Z, C.terminal, to));
      pads.forEach(p => { lead(p.x, p.y, 0.5); out.push(cylZ(p.x, 1, p0 * 0.28, Z, Z + 0.4, C.metal, to)); out.push(box(p.x - p0 * 0.3, -Hh / 2 - 0.01, p.x + p0 * 0.3, -Hh / 2 + 1.5, 2, Z - 4, C.black, to)); });
    } else if ((m = /^JACK-(RCA|3\.5|6\.35)$/.exec(name))) {
      const r = fp.silk.find(s => s.t === "rect"), front = r.y + r.h, [H, sr, sl] = { RCA: [12, 4.2, 8], "3.5": [5.5, 2.5, 2.5], "6.35": [15, 4.6, 5] }[m[1]];
      out.push(box(r.x, r.y, r.x + r.w, front, 0.3, H, C.jack, to), cylY(0, H / 2, sr, front, front + sl, C.metal, to)); pads.forEach(p => lead(p.x, p.y, 0.5));
    } else if ((m = /^TOGGLE-/.exec(name))) {
      const r = fp.silk.find(s => s.t === "rect");
      out.push(box(r.x, r.y, r.x + r.w, r.y + r.h, 0.5, 10, C.black, to), cylZ(0, 0, 3, 10, 19, C.metal, to), cylZ(0, 0, 1.1, 19, 30, C.metal, to)); pads.forEach(p => lead(p.x, p.y, 0.5));
    } else if (/^DIP-\d+$/.test(name)) {
      // the moulded body (7.62 mm row pitch: 6.35 mm wide, 3.3 mm thick) standing on its leads
      const r = fp.silk.find(q => q.t === "rect");
      out.push(box(-3.2, r.y, 3.2, r.y + r.h, 0.5, 3.8, C.black, to)); pads.forEach(p => lead(p.x, p.y, 1));
    } else if (fp.smd) {
      smdBody(g, fp, out, to);
    } else if (/^WIRE-/.test(name)) {
      pads.forEach((p, i) => out.push(cylZ(p.x, p.y, 0.8, 0, 8, i % 2 ? C.wireBlack : C.wireRed, to)));
    } else {
      const b = fp.box; out.push(box(b[0], b[1], b[2], b[3], 0, 5, C.generic, to)); pads.forEach(p => lead(p.x, p.y, 0.5));
    }
    const res = out.filter(Boolean);
    res.forEach((s, i) => { s.ref = g.ref; s.name = `${g.ref}${res.length > 1 ? "-" + (i + 1) : ""}`; });
    return res;
  }

  // Surface-mount bodies, standing on the board's surface (z = 0) between their pads
  function smdBody(g, fp, out, to) {
    const D = B().FPDATA, name = fp.name, pads = fp.pads;
    let m;
    if ((m = /^(CHIP|LED)-(\d{4})$/.exec(name))) {
      // a chip: the body between two tinned end caps; a resistor black on top, a capacitor tan, an LED a clear lens
      const [L, W, H] = D.CHIPS[m[2]], e = Math.min(0.5, L * 0.2), led = m[1] === "LED";
      const col = led ? C.ceramic : g.type === "resistor" ? C.black : g.type === "inductor" ? C.core : C.chipCap;
      out.push(box(-L / 2 + e, -W / 2, L / 2 - e, W / 2, 0, H, col, to), box(-L / 2, -W / 2, -L / 2 + e, W / 2, 0, H, C.metal, to), box(L / 2 - e, -W / 2, L / 2, W / 2, 0, H, C.metal, to));
      if (led) out.push(box(-L / 2 + e, -W / 2 + 0.1, L / 2 - e, W / 2 - 0.1, H, H + 0.25, C.led, to, { alpha: 0.75 }));
    } else if (D.SMD_DIODES[name]) {
      const [L, W, H] = D.SMD_DIODES[name];
      if (name === "MINIMELF") out.push(cylX(0, W / 2, W / 2, -L / 2, L / 2, C.glassRed, to), cylX(0, W / 2 + 0.02, W / 2 + 0.02, -L / 2, -L / 2 + 0.6, C.diode, to));
      else {
        out.push(box(-L / 2, -W / 2, L / 2, W / 2, 0.1, H, C.black, to), box(-L / 2 + 0.3, -W / 2, -L / 2 + 0.3 + L * 0.12, W / 2, H, H + 0.02, C.band, to));
        // the terminals: from under the body's end out over the pad
        pads.forEach(p => { const sg = Math.sign(p.x), a = sg * (L / 2 - 0.6), b = p.x + sg * Math.max(0.3, p.w / 2 - 0.3), hw = Math.min(W, p.h) / 2 * 0.7; out.push(box(Math.min(a, b), -hw, Math.max(a, b), hw, 0, 0.15, C.lead, to)); });
      }
    } else if ((m = /^CP-SMD-D([\d.]+)$/.exec(name))) {
      const d = +m[1], H = D.SMD_ECAP[m[1]][3], b = d / 2 + 0.15, r = d / 2;
      out.push(box(-b, -b, b, b, 0, 1, C.black, to), cylZ(0, 0, r, 1, H - 0.3, C.metal, to), cylZ(0, 0, r * 0.94, H - 0.3, H, C.ecapTop, to));
      pads.forEach(p => out.push(box(p.x - Math.sign(p.x) * 0.3 - 0.6, -0.35, p.x - Math.sign(p.x) * 0.3 + 0.6, 0.35, 0, 0.1, C.lead, to)));
    } else if ((m = /^SOT-23-/.exec(name))) {
      out.push(box(-1.45, -0.65, 1.45, 0.65, 0.1, 1.0, C.black, to));
      pads.forEach(p => out.push(box(p.x - 0.2, Math.min(p.y, Math.sign(p.y) * 0.65), p.x + 0.2, Math.max(p.y, Math.sign(p.y) * 0.65), 0, 0.12, C.lead, to)));
    } else if ((m = /^(SOT-89|SOT-223|DPAK|D2PAK)-/.exec(name))) {
      const T = D.TABBED[m[1]], [L, W, H] = T.body, yb = T.py - T.ph / 2 - 0.3, y0 = yb - W;
      out.push(box(-L / 2, y0, L / 2, yb, 0.1, H, C.black, to));
      // the tab, soldered flat under and behind the body; the leads out of the body's front
      out.push(box(-T.tw / 2 + 0.3, T.ty - T.th / 2 + 0.2, T.tw / 2 - 0.3, Math.min(yb, Math.max(T.ty + T.th / 2 - 0.2, y0 + 0.5)), 0, 0.15, C.metal, to));
      pads.slice(0, T.pins).forEach(p => out.push(box(p.x - 0.3, yb, p.x + 0.3, p.y + T.ph / 2 - 0.3, 0, 0.15, C.lead, to)));
    } else if ((m = /^SOIC-(\d+)$/.exec(name))) {
      const n = +m[1], L = (n / 2 - 1) * 1.27 + 1.1 + 0.6;
      out.push(box(-1.95, -L / 2, 1.95, L / 2, 0.15, 1.6, C.black, to));
      pads.forEach(p => out.push(box(Math.min(p.x, Math.sign(p.x) * 1.95), p.y - 0.2, Math.max(p.x, Math.sign(p.x) * 1.95) - Math.sign(p.x) * 0.2, p.y + 0.2, 0, 0.15, C.lead, to)));
    } else if (name === "TRIM-TC33") {
      out.push(box(-1.9, -1.8, 1.9, 1.8, 0, 1.2, C.trim, to), cylZ(0, 0, 1.2, 1.2, 1.9, C.ceramic, to));
    } else {
      const b = fp.box; out.push(box(b[0] + 0.25, b[1] + 0.25, b[2] - 0.25, b[3] - 0.25, 0, 1, C.generic, to));
    }
  }

  // ---------------------------------------------------------------------------
  // The board: the outline extruded to its thickness, with every drilled hole through it
  // ---------------------------------------------------------------------------
  function boardSolid(board, model, keep) {
    const o = board.outline, t = board.stackup.thickness || 1.6, R = board.rules;
    let ring = B().outlinePoly(o, 0).map(([x, y]) => [x, -y]);
    const area = ring.reduce((s, p, i) => { const q = ring[(i + 1) % ring.length]; return s + p[0] * q[1] - q[0] * p[1]; }, 0);
    if (area < 0) ring = ring.reverse();                       // counter-clockwise seen from above
    ring = ring.filter((p, i) => { const q = ring[(i + 1) % ring.length]; return Math.hypot(p[0] - q[0], p[1] - q[1]) > 1e-6; });
    const holes = [];
    model.pads.forEach(p => { if (keep.has(p.part) && !p.smd && B().edgeDist(p.x, p.y, o) > p.drill / 2) holes.push([p.x, p.y, p.drill / 2]); });
    board.vias.forEach(v => holes.push([v.x, v.y, (v.drill || R.viaDrill) / 2]));
    (board.holes || []).forEach(h => holes.push([h.x, h.y, h.d / 2]));
    const V = [], F = [], n = ring.length;
    ring.forEach(([x, y]) => V.push([x, y, 0])); ring.forEach(([x, y]) => V.push([x, y, t]));
    const topLoops = [ring.map((_, i) => n + i)], botLoops = [ring.map((_, i) => i)];
    for (let i = 0; i < n; i++) { const j = (i + 1) % n, a = ring[i], b = ring[j]; F.push(face(V, [[i, j, n + j, n + i]], [b[1] - a[1], a[0] - b[0], 0])); }
    holes.forEach(([x, y, r]) => {
      const k = sides(r), c = circle(r, k), base = V.length;
      c.forEach(([u, v]) => V.push([x + u, -y + v, 0])); c.forEach(([u, v]) => V.push([x + u, -y + v, t]));
      botLoops.push(c.map((_, i) => base + i)); topLoops.push(c.map((_, i) => base + k + i));
      for (let i = 0; i < k; i++) { const j = (i + 1) % k, q = [base + i, base + j, base + k + j, base + k + i]; F.push(face(V, [q], sub([x, -y, t / 2], avg(q.map(e => V[e]))))); }
    });
    F.push(face(V, topLoops, [0, 0, 1]), face(V, botLoops, [0, 0, -1]));
    return { name: "Board", ref: "", color: C.board, alpha: 1, verts: V, faces: F, board: true, uv: { w: o.w, h: o.h } };
  }

  /** The whole board in 3D: { board, bodies } (opts.tubes: draw the valves on their sockets) */
  function scene(board, model, opts) {
    opts = opts || {};
    const keep = root.BoardFab ? root.BoardFab.placedParts(board, model) : new Set(model.parts.map(g => g.key)), t = board.stackup.thickness || 1.6;
    const bodies = [];
    if (opts.parts !== false) model.parts.forEach(g => { if (g.place && g.fp && keep.has(g.key)) bodies.push(...partBodies(g, t, opts)); });
    return { board: boardSolid(board, model, keep), bodies, t };
  }

  // ---------------------------------------------------------------------------
  // STEP AP214 (ISO 10303-21): each solid a MANIFOLD_SOLID_BREP of planar ADVANCED_FACEs whose
  // edges are shared (each edge used once in each direction), coloured with STYLED_ITEMs
  // ---------------------------------------------------------------------------
  function step(sc, meta) {
    const L = [];
    let id = 0;
    const E = s => { L.push(`#${++id}=${s};`); return `#${id}`; };
    const R = v => { let s = (Math.abs(v) < 5e-7 ? 0 : +v.toFixed(6)).toString(); if (!/[.eE]/.test(s)) s += "."; return s; };
    const str = t => `'${String(t || "").replace(/[^\x20-\x7e]/g, "?").replace(/'/g, "''")}'`;
    const pt = p => E(`CARTESIAN_POINT('',(${p.map(R).join(",")}))`), dir = d => E(`DIRECTION('',(${d.map(R).join(",")}))`);
    const title = (meta && meta.title) || "board";
    const ctxApp = E("APPLICATION_CONTEXT('core data for automotive mechanical design processes')");
    E(`APPLICATION_PROTOCOL_DEFINITION('international standard','automotive_design',2000,${ctxApp})`);
    const pc = E(`PRODUCT_CONTEXT('',${ctxApp},'mechanical')`);
    const prod = E(`PRODUCT(${str(title)},${str(title)},'',(${pc}))`);
    E(`PRODUCT_RELATED_PRODUCT_CATEGORY('part',$,(${prod}))`);
    const pdf = E(`PRODUCT_DEFINITION_FORMATION('','',${prod})`), pdc = E(`PRODUCT_DEFINITION_CONTEXT('part definition',${ctxApp},'design')`);
    const pd = E(`PRODUCT_DEFINITION('design','',${pdf},${pdc})`), pds = E(`PRODUCT_DEFINITION_SHAPE('','',${pd})`);
    const mm = E("( LENGTH_UNIT() NAMED_UNIT(*) SI_UNIT(.MILLI.,.METRE.) )"), rad = E("( NAMED_UNIT(*) PLANE_ANGLE_UNIT() SI_UNIT($,.RADIAN.) )"), sr = E("( NAMED_UNIT(*) SI_UNIT($,.STERADIAN.) SOLID_ANGLE_UNIT() )");
    const unc = E(`UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),${mm},'distance_accuracy_value','confusion accuracy')`);
    const ctx = E(`( GEOMETRIC_REPRESENTATION_CONTEXT(3) GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((${unc})) GLOBAL_UNIT_ASSIGNED_CONTEXT((${mm},${rad},${sr})) REPRESENTATION_CONTEXT('Context #1','3D Context with UNIT and UNCERTAINTY') )`);
    const origin = E(`AXIS2_PLACEMENT_3D('',${pt([0, 0, 0])},${dir([0, 0, 1])},${dir([1, 0, 0])})`);
    const solids = [], styles = [], styleCache = new Map();
    const style = (c, alpha) => {
      const k = c.join(",") + "/" + (alpha || 1); if (styleCache.has(k)) return styleCache.get(k);
      const col = E(`COLOUR_RGB('',${c.map(R).join(",")})`), fill = E(`FILL_AREA_STYLE('',(${E(`FILL_AREA_STYLE_COLOUR('',${col})`)}))`);
      const parts = [E(`SURFACE_STYLE_FILL_AREA(${fill})`)]; if (alpha < 1) parts.push(E(`SURFACE_STYLE_TRANSPARENT(${R(1 - alpha)})`));
      const psa = E(`PRESENTATION_STYLE_ASSIGNMENT((${E(`SURFACE_STYLE_USAGE(.BOTH.,${E(`SURFACE_SIDE_STYLE('',(${parts.join(",")}))`)})`)}))`);
      styleCache.set(k, psa); return psa;
    };
    [sc.board].concat(sc.bodies).forEach(s => {
      const V = s.verts, vp = V.map(p => E(`VERTEX_POINT('',${pt(p)})`)), edges = new Map();
      const edge = (a, b) => {
        const k = a < b ? `${a}-${b}` : `${b}-${a}`;
        if (!edges.has(k)) { const lo = Math.min(a, b), hi = Math.max(a, b), d = sub(V[hi], V[lo]), len = Math.hypot(...d); edges.set(k, { lo, e: E(`EDGE_CURVE('',${vp[lo]},${vp[hi]},${E(`LINE('',${pt(V[lo])},${E(`VECTOR('',${dir(unit(d))},${R(len)})`)})`)},.T.)`) }); }
        const ed = edges.get(k); return E(`ORIENTED_EDGE('',*,*,${ed.e},${a === ed.lo ? ".T." : ".F."})`);
      };
      const faces = s.faces.map(f => {
        const bounds = f.loops.map((l, k) => { const loop = E(`EDGE_LOOP('',(${l.map((a, i) => edge(a, l[(i + 1) % l.length])).join(",")}))`); return E(`${k ? "FACE_BOUND" : "FACE_OUTER_BOUND"}('',${loop},.T.)`); });
        const p0 = V[f.loops[0][0]], ref = unit(sub(V[f.loops[0][1]], p0));
        const plane = E(`PLANE('',${E(`AXIS2_PLACEMENT_3D('',${pt(p0)},${dir(f.n)},${dir(ref)})`)})`);
        return E(`ADVANCED_FACE('',(${bounds.join(",")}),${plane},.T.)`);
      });
      const solid = E(`MANIFOLD_SOLID_BREP(${str(s.name)},${E(`CLOSED_SHELL('',(${faces.join(",")}))`)})`);
      solids.push(solid); styles.push(E(`STYLED_ITEM('color',(${style(s.color, s.alpha)}),${solid})`));
    });
    const rep = E(`ADVANCED_BREP_SHAPE_REPRESENTATION(${str(title)},(${[origin].concat(solids).join(",")}),${ctx})`);
    E(`SHAPE_DEFINITION_REPRESENTATION(${pds},${rep})`);
    E(`MECHANICAL_DESIGN_GEOMETRIC_PRESENTATION_REPRESENTATION('',(${styles.join(",")}),${ctx})`);
    const stamp = (meta && meta.date) || new Date().toISOString().slice(0, 19);
    return ["ISO-10303-21;", "HEADER;", `FILE_DESCRIPTION((${str(title + " - printed circuit board with parts")}),'2;1');`,
      `FILE_NAME(${str((meta && meta.file) || "board.step")},${str(stamp)},('Tube Amp CAD'),(''),${str("Tube Amp CAD " + ((meta && meta.version) || ""))},'Tube Amp CAD','');`,
      "FILE_SCHEMA(('AUTOMOTIVE_DESIGN { 1 0 10303 214 1 1 1 1 }'));", "ENDSEC;", "DATA;", ...L, "ENDSEC;", "END-ISO-10303-21;", ""].join("\n");
  }

  /** One part on a small piece of board, for the inspector's preview: solids, centred on the part */
  function preview(g, opts) {
    const t = 1.6, fp = g.fp, G = { ...g, place: { x: 0, y: 0, rot: 0, side: "F" } }, to = ([x, y, z]) => [x, -y, z], b = fp.box, m = 2;
    const solids = [box(b[0] - m, b[1] - m, b[2] + m, b[3] + m, 0, t, C.board, to)];
    fp.pads.forEach(p => {
      const ring = p.shape === "rect" ? box(p.x - p.w / 2, p.y - p.h / 2, p.x + p.w / 2, p.y + p.h / 2, t, t + 0.05, [0.83, 0.65, 0.17], to) : cylZ(p.x, p.y, Math.min(p.w, p.h) / 2, t, t + 0.05, [0.83, 0.65, 0.17], to);
      solids.push(ring, p.smd ? null : cylZ(p.x, p.y, p.drill / 2, t + 0.05, t + 0.06, [0.02, 0.02, 0.02], to));
    });
    return solids.filter(Boolean).concat(partBodies(G, t, opts || {}));
  }
  root.Board3D = { scene, step, partBodies, boardSolid, preview, COLORS: C, TUBE };
})(typeof window !== "undefined" ? window : globalThis);
