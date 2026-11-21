/* Tube Amp CAD: the thermal map as files (no DOM, runs in Node for the tests).

   BoardThermalExport.pack(board, model, result, opts) → { files, manifest, rows, mesh }
     result  BoardThermal.solve(...)'s, ok
     opts    { name, title, version, date, tubes (the valves drawn, default true), picture, step }
     files   { "<name>-thermal.vtu", "<name>-heat-sources.csv", "<name>-thermal.json", "README-thermal.txt" }:
             the texts of the package; the caller adds the picture and the STEP and zips them

   Everything is in the frame of the STEP export (Board3D.scene): millimetres, x to the right, y up
   (the layout's y turned over), z up from the board's bottom face, the same origin. The format
   ("tubecad-thermal", version 1) is a contract with other programs: a new array or key may be
   added, a required one may not change without a new version. */
(function (root) {
  "use strict";
  const FORMAT = "tubecad-thermal", VERSION = 1, ACCURACY = 15;
  const COLUMNS = ["part_id", "designator", "step_bodies", "part", "heat_path", "mount", "x_mm", "y_mm", "z_mm", "dx_mm", "dy_mm", "dz_mm", "volume_mm3",
    "p_total_W", "p_board_W", "p_air_W", "p_sink_W", "t_body_C", "t_kind", "t_limit_C", "margin_C", "life_h", "source", "t_junction_C", "t_pads_C"];
  const MOUNT = { tab: "ra-on-copper", heatsink: "on-heatsink", chassis: "on-chassis" };
  const ORIENT = { up: "horizontal-up", down: "horizontal-down", vertical: "vertical" };
  const r3 = v => +(+v).toFixed(3), r2 = v => +(+v).toFixed(2);
  const num = (v, d) => (v === null || v === undefined || !Number.isFinite(+v) ? "" : String(+(+v).toFixed(d === undefined ? 3 : d)));

  // the volume of a closed solid of planar faces (the sum of the tetrahedra its triangles make with the origin)
  function volume(s, tri) {
    let v = 0;
    s.faces.forEach(f => tri(s.verts, f).forEach(([a, b, c]) => { const A = s.verts[a], Bv = s.verts[b], Cv = s.verts[c]; v += A[0] * (Bv[1] * Cv[2] - Bv[2] * Cv[1]) + A[1] * (Bv[2] * Cv[0] - Bv[0] * Cv[2]) + A[2] * (Bv[0] * Cv[1] - Bv[1] * Cv[0]); }));
    return Math.abs(v) / 6;
  }

  /** The rows of the package: every part drawn on the board or giving off heat, the hottest first */
  function rows(result, scene, opts) {
    const B3 = root.Board3D, bodies = new Map();
    scene.bodies.forEach(s => { if (!bodies.has(s.ref)) bodies.set(s.ref, []); bodies.get(s.ref).push(s); });
    const BT = root.BoardThermal, out = [], seen = new Set();
    const row = (ref, p) => {
      const sol = bodies.get(ref) || [], bb = [Infinity, Infinity, Infinity, -Infinity, -Infinity, -Infinity];
      let vol = 0;
      sol.forEach(s => { s.verts.forEach(v => { for (let k = 0; k < 3; k++) { if (v[k] < bb[k]) bb[k] = v[k]; if (v[k] > bb[k + 3]) bb[k + 3] = v[k]; } }); vol += volume(s, B3.triangles); });
      const has = sol.length > 0, total = p ? p.p + p.heater : 0;
      // a part with no node of its own (a terminal, a wire pad): the board's temperature under it
      let t = p && p.t !== null && p.t !== undefined ? p.t : null, kind = p ? p.tKind : null;
      if (t === null && has) { const side = bb[2] < 0 ? "bottom" : "top", tb = BT.at(result, (bb[0] + bb[3]) / 2, -(bb[1] + bb[4]) / 2, side); t = tb === null ? result.ambient : tb; kind = "board"; }
      const tj = p && p.tj !== undefined ? p.tj : null, lim = p && p.limit !== undefined ? p.limit : null, worst = tj !== null ? tj : t;
      return {
        part_id: 0, designator: ref, step_bodies: sol.map(s => s.name), part: (p && p.value) || "",
        heat_path: p ? p.path : "air", mount: p ? MOUNT[p.mount] || p.mount : "",
        bbox_mm: has ? bb.map(r3) : null, volume_mm3: has ? r2(vol) : null,
        p_total_W: total, p_board_W: p ? p.toBoard : 0, p_air_W: p ? p.toAir + p.byRadiation : 0, p_sink_W: p ? p.toSink : 0,
        t_body_C: t, t_kind: kind, t_limit_C: lim, margin_C: lim !== null && worst !== null ? lim - worst : null, life_h: p && p.life !== undefined ? p.life : null,
        source: opts.point === "idle" ? "idle" : "simulated", t_junction_C: tj, t_pads_C: p && p.tPads !== undefined ? p.tPads : null, assumed_heatsink: !!(p && p.assumed), off_board: !!(p && p.off)
      };
    };
    result.parts.forEach(p => { seen.add(p.ref); out.push(row(p.ref, p)); });
    bodies.forEach((_, ref) => { if (!seen.has(ref)) out.push(row(ref, null)); });
    out.sort((a, b) => b.p_total_W - a.p_total_W || (a.designator < b.designator ? -1 : a.designator > b.designator ? 1 : 0));
    out.forEach((r, i) => { r.part_id = i + 1; });
    return out;
  }

  /** The surfaces as one mesh: { points: [x, y, z...], temp: [...], conn, offsets, types, partId, face, power, flux } */
  function mesh(board, result, scene, rws) {
    const B3 = root.Board3D, o = board.outline, { nx, ny, step } = result, t = result.thickness || board.stackup.thickness || 1.6;
    const pts = [], temp = [], conn = [], offsets = [], types = [], partId = [], face = [], power = [], flux = [];
    const cell = (ids, type, id, fc, pw, fl) => { ids.forEach(i => conn.push(i)); offsets.push(conn.length); types.push(type); partId.push(id); face.push(fc); power.push(pw); flux.push(fl); };
    // ---- the board: its two faces as the solver's cells, a point at every corner of a cell with the mean of the cells round it
    const sides = [result.top, result.bottom], has = c => Number.isFinite(result.top[c]);
    const corner = [new Int32Array((nx + 1) * (ny + 1)).fill(-1), new Int32Array((nx + 1) * (ny + 1)).fill(-1)];
    const cornerT = (s, i, j) => { let sum = 0, n = 0; for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) { const p = i + di, q = j + dj; if (p < 0 || q < 0 || p >= nx || q >= ny) continue; const v = sides[s][q * nx + p]; if (Number.isFinite(v)) { sum += v; n++; } } return n ? sum / n : result.ambient; };
    // the last column and row of cells end at the board's edge (the grid's step does not divide its size)
    let iMax = 0, jMax = 0; for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) if (has(j * nx + i)) { if (i > iMax) iMax = i; if (j > jMax) jMax = j; }
    const X = i => (i > iMax ? o.w : Math.min(i * step, o.w)), Y = j => -(j > jMax ? o.h : Math.min(j * step, o.h));
    const point = (s, i, j) => { const k = j * (nx + 1) + i; if (corner[s][k] < 0) { corner[s][k] = temp.length; pts.push(X(i), Y(j), s ? 0 : t); temp.push(cornerT(s, i, j)); } return corner[s][k]; };
    for (let s = 0; s < 2; s++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const c = j * nx + i; if (!has(c)) continue;
      // counter-clockwise seen from outside: the top from above, the bottom from below
      const q = [point(s, i, j + 1), point(s, i + 1, j + 1), point(s, i + 1, j), point(s, i, j)];
      cell(s ? q.reverse() : q, 9, 0, s + 1, 0, result.flux ? result.flux[s][c] : 0);
    }
    // its edge (and the walls of its cut-outs): a quad wherever a cell has no neighbour
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      if (!has(j * nx + i)) continue;
      [[0, -1, i, j, i + 1, j], [1, 0, i + 1, j, i + 1, j + 1], [0, 1, i + 1, j + 1, i, j + 1], [-1, 0, i, j + 1, i, j]].forEach(([di, dj, i1, j1, i2, j2]) => {
        const p = i + di, q = j + dj; if (p >= 0 && q >= 0 && p < nx && q < ny && has(q * nx + p)) return;
        const b = temp.length;
        pts.push(X(i1), Y(j1), 0, X(i2), Y(j2), 0, X(i2), Y(j2), t, X(i1), Y(j1), t);
        temp.push(cornerT(1, i1, j1), cornerT(1, i2, j2), cornerT(0, i2, j2), cornerT(0, i1, j1));
        cell([b, b + 1, b + 2, b + 3], 9, 0, 3, 0, 0);
      });
    }
    // ---- the parts: every solid's faces as triangles, the body at the part's temperature, its leads at its pads'
    const byRef = new Map(rws.map(r => [r.designator, r])), LEAD = B3.COLORS.lead, isLead = c => Math.abs(c[0] - LEAD[0]) + Math.abs(c[1] - LEAD[1]) + Math.abs(c[2] - LEAD[2]) < 1e-6;
    scene.bodies.forEach(s => {
      const r = byRef.get(s.ref); if (!r) return;
      const tv = isLead(s.color) && r.t_pads_C !== null ? r.t_pads_C : r.t_body_C, b = temp.length;
      s.verts.forEach(v => { pts.push(v[0], v[1], v[2]); temp.push(tv); });
      s.faces.forEach(f => B3.triangles(s.verts, f).forEach(tr => cell(tr.map(i => b + i), 5, r.part_id, 0, r.p_total_W, 0)));
    });
    return { points: pts, temp, conn, offsets, types, partId, face, power, flux };
  }

  /** The mesh as a VTK XML UnstructuredGrid (.vtu), ASCII */
  function vtu(m, result, meta) {
    const nP = m.temp.length, nC = m.types.length, L = [];
    const arr = (type, name, vals, fmt, comps) => { L.push(`        <DataArray type="${type}" Name="${name}"${comps ? ` NumberOfComponents="${comps}"` : ""} format="ascii">`); for (let i = 0; i < vals.length; i += 12) { let s = "         "; const e = Math.min(vals.length, i + 12); for (let k = i; k < e; k++) s += " " + fmt(vals[k]); L.push(s); } L.push("        </DataArray>"); };
    const f3 = v => String(+v.toFixed(3)), f2 = v => String(+v.toFixed(2)), int = v => String(v | 0);
    L.push('<?xml version="1.0"?>');
    L.push(`<!-- ${meta.app}: thermal map of "${String(meta.design || "").replace(/[<>&"-]+/g, " ")}" (${FORMAT} ${VERSION}). An estimate, about +/-${ACCURACY} C. Millimetres, the frame of the STEP export. -->`);
    L.push('<VTKFile type="UnstructuredGrid" version="1.0" byte_order="LittleEndian" header_type="UInt64">', "  <UnstructuredGrid>", "    <FieldData>");
    L.push(`      <DataArray type="Float32" Name="Ambient_C" NumberOfTuples="1" format="ascii">${f2(result.ambient)}</DataArray>`);
    L.push(`      <DataArray type="Float32" Name="GridStep_mm" NumberOfTuples="1" format="ascii">${f3(result.step)}</DataArray>`);
    L.push("    </FieldData>", `    <Piece NumberOfPoints="${nP}" NumberOfCells="${nC}">`, "      <Points>");
    arr("Float32", "Points", m.points, f3, 3);
    L.push("      </Points>", "      <Cells>");
    arr("Int32", "connectivity", m.conn, int); arr("Int32", "offsets", m.offsets, int); arr("UInt8", "types", m.types, int);
    L.push("      </Cells>", '      <PointData Scalars="Temperature_C">');
    arr("Float32", "Temperature_C", m.temp, f2);
    L.push("      </PointData>", '      <CellData Scalars="PartId">');
    arr("Int32", "PartId", m.partId, int); arr("Int8", "Face", m.face, int); arr("Float32", "Power_W", m.power, f3); arr("Float32", "HeatFlux_W_m2", m.flux, v => String(+v.toFixed(1)));
    L.push("      </CellData>", "    </Piece>", "  </UnstructuredGrid>", "</VTKFile>", "");
    return L.join("\n");
  }

  function csv(rws) {
    const q = v => (/[",\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
    const line = r => {
      const b = r.bbox_mm, c = b ? [(b[0] + b[3]) / 2, (b[1] + b[4]) / 2, (b[2] + b[5]) / 2, b[3] - b[0], b[4] - b[1], b[5] - b[2]] : [null, null, null, null, null, null];
      return [String(r.part_id), q(r.designator), q(r.step_bodies.join(";")), q(r.part), r.heat_path, r.mount, ...c.map(v => num(v, 2)), num(r.volume_mm3, 1),
        num(r.p_total_W, 4), num(r.p_board_W, 4), num(r.p_air_W, 4), num(r.p_sink_W, 4), num(r.t_body_C, 1), r.t_kind || "", num(r.t_limit_C, 0), num(r.margin_C, 1), num(r.life_h, 0), r.source, num(r.t_junction_C, 1), num(r.t_pads_C, 1)].join(",");
    };
    return [COLUMNS.join(","), ...rws.map(line)].join("\r\n") + "\r\n";
  }

  function manifest(board, result, rws, m, opts) {
    const name = opts.name, st = result.settings, files = { manifest: `${name}-thermal.json`, mesh: `${name}-thermal.vtu`, sources: `${name}-heat-sources.csv`, readme: "README-thermal.txt" };
    if (opts.picture) files.picture = `${name}-thermal.png`;
    if (opts.step) files.step = `${name}.step`;
    let lo = Infinity, hi = -Infinity; m.temp.forEach(v => { if (v < lo) lo = v; if (v > hi) hi = v; });
    const n1 = v => (v === null || v === undefined ? null : +(+v).toFixed(1)), n4 = v => +(+v).toFixed(4);
    return {
      format: FORMAT, version: VERSION, app: opts.app, created: (opts.date || new Date()).toISOString().replace(/\.\d+Z$/, "Z"), design: opts.title || name,
      units: { length: "mm", temperature: "C", power: "W", flux: "W/m2" },
      frame: "same as the STEP export: x right, y up, z up from the board's bottom face",
      files,
      settings: { ambient_C: st.ambient, enclosure: st.enclosure, orientation: ORIENT[st.orient] || st.orient, operating_point: st.point === "idle" ? "idle" : "simulated", grid_mm: r3(result.step), emissivity: result.emissivity || 0.9, board_thickness_mm: result.thickness || board.stackup.thickness || 1.6, copper_um: board.stackup.copper || 35, layers: board.stackup.layers || 2 },
      board: { size_mm: [board.outline.w, board.outline.h], hottest_C: n1(result.boardMax), hottest_at_mm: result.hot ? [r2(result.hot.x), r2(-result.hot.y), result.hot.side === "bottom" ? 0 : result.thickness || 1.6] : null },
      accuracy_C: ACCURACY, range_C: [n1(lo), n1(hi)], total_W: n4(result.total),
      mesh: { points: m.temp.length, cells: m.types.length, encoding: "ascii", arrays: ["Points", "Temperature_C", "PartId", "Face", "Power_W", "HeatFlux_W_m2", "Ambient_C", "GridStep_mm"] },
      parts: rws.map(r => ({ part_id: r.part_id, designator: r.designator, step_bodies: r.step_bodies, part: r.part, heat_path: r.heat_path, mount: r.mount, bbox_mm: r.bbox_mm, volume_mm3: r.volume_mm3,
        p_total_W: n4(r.p_total_W), p_board_W: n4(r.p_board_W), p_air_W: n4(r.p_air_W), p_sink_W: n4(r.p_sink_W), t_body_C: n1(r.t_body_C), t_kind: r.t_kind, t_junction_C: n1(r.t_junction_C), t_pads_C: n1(r.t_pads_C),
        t_limit_C: r.t_limit_C, margin_C: n1(r.margin_C), life_h: r.life_h, source: r.source, assumed_heatsink: r.assumed_heatsink, off_board: r.off_board }))
    };
  }

  function readme(man) {
    const s = man.settings, f = man.files;
    return [
      `Thermal map of "${man.design}"`,
      `${man.app}, ${man.created}. Format ${man.format}, version ${man.version}.`,
      "",
      `This is an ESTIMATE, good to about +/-${man.accuracy_C} C. The air inside a chassis is not simulated: the`,
      "ambient below is taken as the air round the board. Use it to find hot spots and compare layouts,",
      "not to sign off a design.",
      "",
      "CONDITIONS",
      `  Ambient                ${s.ambient_C} C`,
      `  Enclosure              ${s.enclosure}`,
      `  Board                  ${s.orientation}, ${man.board.size_mm[0]} x ${man.board.size_mm[1]} mm, ${s.board_thickness_mm} mm FR-4 (0.3 W/m.K), ${s.layers} layers, ${s.copper_um} um copper (390 W/m.K)`,
      `  Operating point        ${s.operating_point === "idle" ? "idle (no signal)" : "as simulated (signal average where the run had a signal)"}`,
      `  Grid                   ${s.grid_mm} mm`,
      `  Emissivity             ${s.emissivity}`,
      `  Heat on the board      ${man.total_W} W`,
      `  Board, hottest         ${man.board.hottest_C} C${man.board.hottest_at_mm ? ` at x ${man.board.hottest_at_mm[0]}, y ${man.board.hottest_at_mm[1]} mm` : ""}`,
      `  Range of the mesh      ${man.range_C[0]} to ${man.range_C[1]} C`,
      "",
      "FRAME AND UNITS",
      "  Millimetres, degrees Celsius, watts, W/m2. x to the right, y up, z up from the board's bottom",
      "  face: the frame of the STEP export, so a point has the same numbers in every file here.",
      "",
      "FILES",
      `  ${f.mesh}`,
      "      VTK XML UnstructuredGrid, ASCII. The board's two faces and edge as quads (VTK type 9) at the",
      "      grid above, every part's solids as triangles (type 5).",
      "        Points            mm",
      "        Temperature_C     point data, C: the surface's estimated temperature",
      `        PartId            cell data: 0 the board, else part_id in ${f.sources}`,
      "        Face              cell data: 0 part, 1 board top, 2 board bottom, 3 board edge",
      "        Power_W           cell data: the whole part's dissipation (0 on the board)",
      "        HeatFlux_W_m2     cell data: heat leaving the board's face to the air (0 on parts)",
      "        Ambient_C, GridStep_mm   field data",
      `  ${f.sources}`,
      "      One row per part, the largest heat first. UTF-8, commas, dot decimals.",
      "        step_bodies       the names of the part's solids in the STEP file, separated by ;",
      "        heat_path         where most of its heat goes: board, air, heatsink, chassis",
      "        mount             lying, standing, upright, smd, socket, ra-on-copper, on-heatsink, on-chassis, wired",
      "        x/y/z, dx/dy/dz   centre and size of its bounding box, mm; volume_mm3 of its solids",
      "        p_total_W         dissipation used = p_board_W + p_air_W + p_sink_W (where it went)",
      "        t_body_C          its surface: t_kind says body, case, bulb or board (a part with no heat of its own)",
      "        t_junction_C      semiconductors; t_pads_C: the board at its pads",
      "        t_limit_C         its rating; margin_C = limit - junction (or body); negative = over",
      "        life_h            electrolytics, when estimated",
      "        source            idle or simulated",
      `  ${f.manifest}`,
      "      The manifest: this information for a program. Read it first; refuse another format,",
      "      accept version 1, ignore keys and arrays you do not know.",
      ...(f.picture ? [`  ${f.picture}`, "      The 3D view with its scale."] : []),
      ...(f.step ? [`  ${f.step}`, "      The board and parts as solids (STEP AP214), exported at the same moment."] : []),
      "",
      "LOOKING AT IT",
      `  ParaView: File > Open ${f.mesh}, Apply, colour by Temperature_C. Threshold on PartId isolates a`,
      "  part; Plot Over Line gives a profile across the board.",
      "  Python:   import pyvista; m = pyvista.read('" + f.mesh + "'); m.plot(scalars='Temperature_C')",
      "  FreeCAD:  FEM workbench, import the .vtu as a result next to the STEP.",
      "",
      "SIMULATING IT PROPERLY (FreeCAD FEM + Elmer, SimScale, SolidWorks Flow Simulation, Ansys)",
      "  Import the STEP, find each body by step_bodies, give it a heat source of p_total_W (or",
      "  p_total_W / volume_mm3 x 1e9 for W/m3), set the board material and the ambient above, and run.",
      "  For heat_path heatsink or chassis, model the heatsink or take p_sink_W out at that face.",
      ""
    ].join("\r\n");
  }

  function pack(board, model, result, opts) {
    opts = Object.assign({ name: "board", tubes: true }, opts || {});
    if (!result || !result.ok) return null;
    opts.app = "Tube Amp CAD" + (opts.version ? " " + opts.version : "");
    opts.point = result.settings.point;
    const scene = root.Board3D.scene(board, model, { tubes: opts.tubes !== false });
    const rws = rows(result, scene, opts), m = mesh(board, result, scene, rws), man = manifest(board, result, rws, m, opts);
    const files = {};
    files[man.files.mesh] = vtu(m, result, man);
    files[man.files.sources] = csv(rws);
    files[man.files.manifest] = JSON.stringify(man, null, 1) + "\n";
    files[man.files.readme] = readme(man);
    return { files, manifest: man, rows: rws, mesh: m };
  }

  root.BoardThermalExport = { pack, rows, mesh, vtu, csv, manifest, readme, FORMAT, VERSION, COLUMNS };
})(typeof window !== "undefined" ? window : globalThis);
