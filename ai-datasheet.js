/* The datasheet import's side without a model or the DOM: what the model is asked to read from a
   tube's datasheet (PDF), its answer turned into a tube-database entry, and the Koren model fitted
   to the plate-curve points it read (koren-fit.js). The entry is a custom tube like an imported
   SPICE model: kept in this browser and in the circuit files that use it. */
(function (root) {
  "use strict";
  const num = v => { const x = typeof v === "number" ? v : parseFloat(String(v === undefined || v === null ? "" : v).replace(",", ".")); return isFinite(x) ? x : NaN; };

  const SYSTEM = "You read vacuum-tube datasheets for Tube Amp CAD, a circuit simulator. From the attached datasheet, extract the tube's data exactly as published; do not invent values. "
    + "Read the plate (anode) characteristic curves: for each grid-voltage curve, read 5 to 10 points along it (anode voltage in V, anode current in mA), spread over the drawn range, avoiding the region beyond the anode dissipation limit only if it is not drawn. "
    + "For a pentode or beam tetrode, read the curves at one screen voltage and give it as vg2. If the datasheet has no plate curves, give an empty list.\n"
    + "Answer with JSON only, no prose around it:\n"
    + '{"name": "EL84", "kind": "triode" | "pentode", "type": "Power output pentode", "socket": "Noval B9A", "pinCount": 9, '
    + '"heater": {"v": 6.3, "a": 0.76}, '
    + '"ratings": {"vaMax": 300, "paMax": 12, "ikMax": 65, "vg2Max": 300, "pg2Max": 2, "vhkMax": 100}, '
    + '"pinout": [{"pin": 1, "sym": "NC"}, {"pin": 2, "sym": "G1"}, {"pin": 3, "sym": "K"}, {"pin": 4, "sym": "H"}, {"pin": 5, "sym": "H"}, {"pin": 7, "sym": "A"}, {"pin": 9, "sym": "G2"}], '
    + '"curves": {"vg2": 250, "points": [{"vg": 0, "va": 50, "ia": 40}, {"vg": 0, "va": 100, "ia": 48}]}, '
    + '"similar": "the closest common tube in this list, for anything not in the datasheet", "notes": "one or two sentences: anything uncertain"}\n'
    + "Pin symbols: A (anode), G or G1 (control grid), G2 (screen), G3 (suppressor), K (cathode), H (heater), HCT (heater centre tap), NC; for a double triode A1 G1 K1 and A2 G2 K2, and in that case kind is triode and the curves are for one section. "
    + "A beam tetrode is kind pentode. Omit a rating the datasheet does not give.";

  // the answer → { tube, points, kind, problems }
  function read(j, db) {
    db = db || root.TUBE_DATABASE || [];
    const problems = [];
    const name = String(j.name || "").trim().slice(0, 40);
    if (!name) problems.push("no tube name");
    const kind = /pent|tetrode|beam/i.test(String(j.kind || "")) ? "pentode" : "triode";
    const R = j.ratings || {}, H = j.heater || {};
    const vg2 = num(j.curves && j.curves.vg2);
    const points = ((j.curves && j.curves.points) || []).map(p => ({ va: num(p.va), vg: num(p.vg), iaMa: num(p.ia !== undefined ? p.ia : p.iaMa), vg2: kind === "pentode" && isFinite(vg2) ? vg2 : undefined }))
      .filter(p => isFinite(p.va) && isFinite(p.vg) && isFinite(p.iaMa) && p.va >= 0 && p.iaMa >= 0);
    if (points.length < 6) problems.push(`only ${points.length} plate-curve points: the model is the similar tube's`);
    if (kind === "pentode" && !isFinite(vg2)) problems.push("no screen voltage for the curves: 250 V assumed");
    const like = db.find(t => !t.custom && t.commonName.toLowerCase() === String(j.similar || "").trim().toLowerCase())
      || db.find(t => !t.custom && t.commonName === (kind === "pentode" ? "EL34" : "12AX7"));
    const role = s => (/^A\d?$/.test(s) ? ["Plate", "isPlate"] : /^G2$/.test(s) && kind === "pentode" ? ["Screen Grid", "isScreen"] : /^G3$/.test(s) ? ["Suppressor", null]
      : /^G\d?$/.test(s) ? ["Grid", "isGrid"] : /^K\d?$/.test(s) ? ["Cathode", "isCathode"] : /^H/.test(s) ? ["Heater", "isHeater"] : ["No Connection", null]);
    const pinout = (Array.isArray(j.pinout) ? j.pinout : []).map(p => { const sym = String(p.sym || "NC").trim().toUpperCase().slice(0, 4), r = role(sym), o = { pin: num(p.pin), sym, role: r[0] }; if (r[1]) o[r[1]] = true; return o; })
      .filter(p => isFinite(p.pin)).sort((a, b) => a.pin - b.pin);
    if (!pinout.length) problems.push("no pinout: the similar tube's is used");
    const limits = {};
    if (isFinite(num(R.pg2Max))) limits.pg2 = num(R.pg2Max);
    if (isFinite(num(R.vg2Max))) limits.vg2 = num(R.vg2Max);
    if (isFinite(num(R.vhkMax))) limits.vhk = num(R.vhkMax);
    const tube = {
      nameGost: name, nameWestern: name, commonName: name,
      type: String(j.type || (kind === "pentode" ? "Pentode" : "Triode")).slice(0, 60) + " (from a datasheet)",
      category: like && like.category !== "rectifier" ? like.category : kind === "pentode" ? "power" : "small_signal", origin: "Datasheet import",
      socket: String(j.socket || (like && like.socket) || ""), pinCount: num(j.pinCount) || (pinout.length ? Math.max(...pinout.map(p => p.pin)) : like ? like.pinCount : 0),
      vh: num(H.v) || (like ? like.vh : 6.3), ih: num(H.a) || (like ? like.ih : 0), heaterWarning: "",
      vaMax: num(R.vaMax) || (like ? like.vaMax : 300), paMax: num(R.paMax) || (like ? like.paMax : 1), ikMax: num(R.ikMax) || 0, vg2Max: num(R.vg2Max) || 0,
      limits, directlyHeated: false, caps: null,
      pinout: pinout.length ? pinout : like ? like.pinout.map(p => Object.assign({}, p)) : [],
      koren: {},
      custom: { source: "datasheet", sub: "datasheet", kind, like: like ? like.commonName : "", notes: String(j.notes || "").slice(0, 400) }
    };
    if (!(num(R.vaMax) > 0)) problems.push(`no Va max: ${tube.vaMax} V from the ${like ? like.commonName : "default"}`);
    if (!(num(R.paMax) > 0)) problems.push(`no Pa max: ${tube.paMax} W from the ${like ? like.commonName : "default"}`);
    return { tube, points, kind, vg2: isFinite(vg2) ? vg2 : 250, like, problems };
  }

  // the Koren model: fitted to the points from the similar tube's model, else the similar tube's own
  function model(r) {
    const base = r.like && (r.kind === "pentode" ? r.like.koren.Pentode : r.like.koren.Triode);
    const init = Object.assign({}, base || (r.kind === "pentode" ? { vk: 31, ks: 1, mu: 11, kg: 650, kp: 60, lam: 2000, x: 1.35, kg2: 4200 } : { mu: 100, kg: 1060, kp: 600, kvb: 300, x: 1.4 }));
    let fit = null, params = init;
    if (r.points.length >= 6) { fit = root.KorenFit.fit(r.points, init, r.kind, r.vg2); params = fit.params; }
    const round = o => { const out = {}; Object.keys(o).forEach(k => { out[k] = isFinite(o[k]) ? +(+o[k]).toPrecision(5) : o[k]; }); return out; };
    r.tube.koren = r.kind === "pentode" ? { Pentode: round(params) } : { Triode: round(params) };
    r.tube.custom.fit = fit ? { r2: +fit.r2.toFixed(4), rmse: +fit.rmse.toFixed(3), points: r.points.length } : null;
    return fit;
  }

  root.AiDatasheet = { SYSTEM, read, model, num };
})(typeof window !== "undefined" ? window : globalThis);
