/* OpenCASCADE BREP text (the "CASCADE Topology V3" format that BRepTools reads and writes) for the
   solids Board3D.scene makes: the board and the parts' bodies. MöbiusCAD keeps an imported body as this
   text inside its .mcadprt parts (an "import" feature), so the export to it (board-mcad.js) writes the
   geometry here, exact, with no kernel in the browser.

   Two kinds of solid come in, as for the STEP export (board-3d.js):
   - a polyhedron { verts, faces: [{ n, loops: [[vertex index…]] }] }: planar faces, the outer loop
     counter-clockwise about the outward normal n, the others (holes) clockwise;
   - a round solid { round: { o, a, x, h, outer, holes } }: a profile in the plane (o; x, a × x) of lines
     and arcs, extruded h along a. Arcs become cylinders, the rest planes. A full circle is split in two
     halves, so no face needs a seam.

   Every face is written with its surface's normal and its wires counter-clockwise (outer) or clockwise
   (holes) in the surface's (u, v), and turned over in the shell where that normal looks into the solid.
   Edges on cylinders carry their curves on the cylinder (pcurves); edges on planes leave them out, as
   OpenCASCADE works them out from the plane. */
(function (root) {
  "use strict";
  const TOL = "1e-07";
  const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const len = a => Math.hypot(a[0], a[1], a[2]);
  const unit = a => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
  const num = v => { if (Math.abs(v) < 1e-12) return "0"; const s = String(+v.toPrecision(15)); return s; };
  const nums = a => a.map(num).join(" ");
  // a direction square to n, for the x of a plane's frame
  const perp = n => unit(Math.abs(n[0]) < 0.9 ? cross(n, [1, 0, 0]) : cross(n, [0, 1, 0]));

  function writer() {
    const curves = [], curves2 = [], surfs = [], shapes = [];
    const shape = s => { shapes.push(s); s.pos = shapes.length; return s; };
    const vkey = new Map();
    const vertex = p => {
      const k = p.map(v => Math.round(v * 1e6)).join(",");
      if (vkey.has(k)) return vkey.get(k);
      const v = shape({ t: "Ve", p }); vkey.set(k, v); return v;
    };
    const ekey = new Map();
    // a straight edge between two vertices, shared by the two faces that meet there (one per pair)
    const lineEdge = (va, vb) => {
      const k = va.pos < vb.pos ? `${va.pos}-${vb.pos}` : `${vb.pos}-${va.pos}`;
      if (ekey.has(k)) return ekey.get(k);
      const [a, b] = va.pos < vb.pos ? [va, vb] : [vb, va], d = sub(b.p, a.p), l = len(d);
      curves.push(`1 ${nums(a.p)} ${nums(unit(d))}`);
      const e = shape({ t: "Ed", c: curves.length, f: 0, l, va: a, vb: b, pc: [] });
      ekey.set(k, e); return e;
    };
    // an arc about the axis n (its circle turns counter-clockwise about n) from va through angle th
    const arcEdge = (va, vb, c, r, n, xdir, th, key) => {
      if (key && ekey.has(key)) return ekey.get(key);
      curves.push(`2 ${nums(c)} ${nums(n)} ${nums(xdir)} ${nums(cross(n, xdir))} ${num(r)}`);
      const e = shape({ t: "Ed", c: curves.length, f: 0, l: th, va, vb, pc: [], arc: { c, r, n, xdir } });
      if (key) ekey.set(key, e); return e;
    };
    const plane = (o, n, x) => { const X = unit(sub(x, mul(n, dot(x, n)))); surfs.push(`1 ${nums(o)} ${nums(n)} ${nums(X)} ${nums(cross(n, X))}`); return { i: surfs.length, kind: "plane", o, n, X, Y: cross(n, X) }; };
    const cylinder = (o, n, x, r) => { surfs.push(`2 ${nums(o)} ${nums(n)} ${nums(x)} ${nums(cross(n, x))} ${num(r)}`); return { i: surfs.length, kind: "cyl", o, n, X: x, Y: cross(n, x), r }; };
    const pcurve = (e, s, p, d) => { curves2.push(`1 ${num(p[0])} ${num(p[1])} ${num(d[0])} ${num(d[1])}`); e.pc.push({ c: curves2.length, s: s.i }); };
    // (u, v) of a point on a surface (u on a cylinder: the angle from x about n, kept near `near`)
    const uv = (s, p, near) => {
      const d = sub(p, s.o);
      if (s.kind === "plane") return [dot(d, s.X), dot(d, s.Y)];
      let u = Math.atan2(dot(d, s.Y), dot(d, s.X));
      if (near !== undefined) while (u < near - Math.PI) u += 2 * Math.PI;
      else if (u < -1e-9) u += 2 * Math.PI;
      return [u, dot(d, s.n)];
    };
    // points along an edge from its start to its end (arcs sampled), for the loop's turning sense
    const along = e => {
      if (!e.arc) return [e.va.p, e.vb.p];
      const { c, r, n, xdir } = e.arc, Y = cross(n, xdir), out = [];
      for (let k = 0; k <= 8; k++) { const a = e.l * k / 8; out.push(add(c, add(mul(xdir, r * Math.cos(a)), mul(Y, r * Math.sin(a))))); }
      return out;
    };
    // a face: its surface, loops of edges in travel order [[e, forward]], outer first; returns the face
    // and whether the shell takes it turned over (the surface's normal looks into the material)
    const face = (s, loops, reversed) => {
      const wires = loops.map((l, k) => {
        // the loop's points in (u, v): its area's sign says which way round it goes
        let pts = [], near;
        l.forEach(([e, fw]) => { const q = along(e); (fw ? q : q.slice().reverse()).forEach(p => { const w = uv(s, p, near); if (s.kind === "cyl") near = w[0]; pts.push(w); }); });
        let a = 0;
        for (let i = 0; i < pts.length; i++) { const p = pts[i], q = pts[(i + 1) % pts.length]; a += p[0] * q[1] - q[0] * p[1]; }
        const want = k === 0 ? a > 0 : a < 0, list = want ? l : l.slice().reverse().map(([e, fw]) => [e, !fw]);
        return shape({ t: "Wi", edges: list });
      });
      return { f: shape({ t: "Fa", s: s.i, wires }), rev: !!reversed };
    };

    // ---- a polyhedron ------------------------------------------------------------------------
    function poly(sol) {
      vkey.clear(); ekey.clear();
      const V = sol.verts.map(p => vertex(p));
      const faces = sol.faces.map(f => {
        const loops = f.loops.map(l => l.map((a, i) => { const b = l[(i + 1) % l.length], e = lineEdge(V[a], V[b]); return [e, e.va === V[a]]; }));
        const p0 = sol.verts[f.loops[0][0]], p1 = sol.verts[f.loops[0][1]];
        return face(plane(p0, unit(f.n), sub(p1, p0)), loops);
      });
      return shell(faces);
    }

    // ---- a round solid -----------------------------------------------------------------------
    function round(g) {
      vkey.clear(); ekey.clear();
      const A = unit(g.a), X = unit(g.x), Y = cross(A, X);
      const at = ([u, v], w) => add(add(g.o, add(mul(X, u), mul(Y, v))), mul(A, w));
      const faces = [];
      // a full circle (one arc back to its start) goes in two halves
      const split = segs => segs.length === 1 && segs[0].c ? (s => { const p2 = [2 * s.c[0] - s.p[0], 2 * s.c[1] - s.p[1]]; return [s, { ...s, p: p2 }]; })(segs[0]) : segs;
      // one closed profile: its edges at both ends, and its side faces
      const ring = (segs0, hole) => {
        const segs = split(segs0), n = segs.length;
        const vb = segs.map(s => vertex(at(s.p, 0))), vt = segs.map(s => vertex(at(s.p, g.h)));
        const up = segs.map((s, i) => lineEdge(vb[i], vt[i]));
        const eb = [], et = [];
        segs.forEach((s, i) => {
          const j = (i + 1) % n, q = segs[j].p;
          if (s.c) {
            // the arc's sweep from p to q about c, counter-clockwise about a (clockwise if cw)
            const a0 = Math.atan2(s.p[1] - s.c[1], s.p[0] - s.c[0]), a1 = Math.atan2(q[1] - s.c[1], q[0] - s.c[0]);
            let th = s.cw ? a0 - a1 : a1 - a0;
            while (th <= 1e-9) th += 2 * Math.PI;
            const N = s.cw ? mul(A, -1) : A, xd = unit(sub(at(s.p, 0), at(s.c, 0)));
            const bot = arcEdge(vb[i], vb[j], at(s.c, 0), s.r, N, xd, th), top = arcEdge(vt[i], vt[j], at(s.c, g.h), s.r, N, xd, th);
            // the cylinder: x at the arc's start, its normal away from the axis; v along N
            const cyl = cylinder(at(s.c, 0), N, xd, s.r), sg = dot(N, A);
            pcurve(bot, cyl, [0, 0], [1, 0]); pcurve(top, cyl, [0, sg * g.h], [1, 0]);
            pcurve(up[i], cyl, [0, 0], [0, sg]); pcurve(up[j], cyl, [th, 0], [0, sg]);
            eb.push([bot, true]); et.push([top, true]);
            // the material lies inside the outer profile's counter-clockwise arcs and outside a hole's (and the other way for clockwise ones)
            const inward = !!s.cw !== !!hole;
            faces.push(face(cyl, [[[bot, true], [up[j], up[j].va === vb[j]], [top, false], [up[i], up[i].va !== vb[i]]]], inward));
          } else {
            const b = lineEdge(vb[i], vb[j]), t = lineEdge(vt[i], vt[j]);
            eb.push([b, b.va === vb[i]]); et.push([t, t.va === vt[i]]);
            // outward: to the right of travel about a on the outer profile, to the left on a hole
            const d = unit(sub(at(q, 0), at(s.p, 0))), nrm = hole ? cross(A, d) : cross(d, A);
            faces.push(face(plane(at(s.p, 0), nrm, d), [[[b, b.va === vb[i]], [up[j], up[j].va === vb[j]], [t, t.va !== vt[i]], [up[i], up[i].va !== vb[i]]]]));
          }
        });
        return { eb, et };
      };
      const o = ring(g.outer, false), hs = (g.holes || []).map(h => ring(h.segs || [{ p: [h.c[0] + h.r, h.c[1]], c: h.c, r: h.r }], true));
      faces.push(face(plane(g.o, mul(A, -1), X), [o.eb].concat(hs.map(h => h.eb))));
      faces.push(face(plane(at([0, 0], g.h), A, X), [o.et].concat(hs.map(h => h.et))));
      return shell(faces);
    }
    const shell = faces => shape({ t: "So", sh: shape({ t: "Sh", faces }) });

    // ---- the text ----------------------------------------------------------------------------
    function text(top) {
      const N = shapes.length, ref = (s, fw) => `${fw ? "+" : "-"}${N - s.pos + 1} 0`;
      const out = ["DBRep_DrawableShape", "", "CASCADE Topology V3, (c) Open Cascade", "Locations 0",
        `Curve2ds ${curves2.length}`, ...curves2, `Curves ${curves.length}`, ...curves,
        "Polygon3D 0", "PolygonOnTriangulations 0", `Surfaces ${surfs.length}`, ...surfs, "Triangulations 0", "", `TShapes ${N}`];
      // OpenCASCADE writes a shape after everything it holds and refers back by count from the end
      for (const s of shapes) {
        if (s.t === "Ve") out.push("Ve", TOL, nums(s.p), "0 0", "", "0101101", "*");
        else if (s.t === "Ed") {
          out.push("Ed", ` ${TOL} 1 1 0`, `1  ${s.c} 0 0 ${num(s.l)}`);
          s.pc.forEach(p => out.push(`2  ${p.c} ${p.s} 0 0 ${num(s.l)}`));
          out.push("0", "", "0101000", `${ref(s.va, true)} ${ref(s.vb, false)} *`);
        } else if (s.t === "Wi") out.push("Wi", "", "0101100", s.edges.map(([e, fw]) => ref(e, fw)).join(" ") + " *");
        else if (s.t === "Fa") out.push("Fa", `0  ${TOL} ${s.s} 0`, "", "0111000", s.wires.map(w => ref(w, true)).join(" ") + " *");
        else if (s.t === "Sh") out.push("Sh", "", "0101100", s.faces.map(x => ref(x.f, !x.rev)).join(" ") + " *");
        else if (s.t === "So") out.push("So", "", "1100000", ref(s.sh, true) + " *");
        else if (s.t === "Co") out.push("Co", "", "1100000", s.items.map(x => ref(x, true)).join(" ") + " *");
      }
      out.push("", ref(top, true), "");
      return out.join("\n");
    }
    return { poly, round, text, compound: items => shape({ t: "Co", items }) };
  }

  /** BREP text of solids from Board3D.scene: one solid alone, or a compound of several. */
  function write(solids) {
    const w = writer(), made = solids.map(s => (s.round ? w.round(s.round) : w.poly(s)));
    return w.text(made.length === 1 ? made[0] : w.compound(made));
  }
  root.BoardBrep = { write, perp };
})(typeof window !== "undefined" ? window : globalThis);
