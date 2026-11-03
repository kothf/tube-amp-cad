/**
 * Real tube sockets (tube-db.js TUBE_SOCKETS, GoodComponent's): the list, the board footprints
 * from each socket's drawing (tails on their own circle, flange screws, outline), the Socket
 * field's choices, the footprint the board takes when a socket is picked, the 3D body and the
 * BOM's socket line (node --test).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-components.js", "mpn.js", "board-core.js", "board-3d.js", "pdf-export.js", "bom.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const B = globalThis.BoardCore, L = globalThis.CadLib, D3 = globalThis.Board3D, BOM = globalThis.BomLib, LIST = globalThis.TUBE_SOCKETS;
const part = (id, type, label, params, pins) => ({ id, type, label, params: Object.assign({}, L.LIB[type].defaults, params), pins: Object.entries(pins).map(([pid, net]) => ({ id: pid, net })) });
const amp = sock => ({ names: { 0: "GND" }, parts: [
  part("v1a", "tube", "VL1.1", { tube: "12AX7", sock }, { A: 2, G: 4, K: 3 }),
  part("v1b", "tube", "VL1.2", { tube: "12AX7" }, { A: 5, G: 6, K: 7 }),
  part("v2", "tube", "VL2", { tube: "EL34" }, { A: 8, G1: 5, G2: 9, K: 0 }),
  part("r1", "resistor", "R1", { r: 1e3 }, { 1: 3, 2: 0 })
] });

test("the list: unique numbers, a known base and mount for each; the board ones have their sizes", () => {
  const ids = LIST.flatMap(s => [s.id, s.gold].filter(Boolean));
  assert.equal(new Set(ids).size, ids.length, "item numbers are unique");
  assert.ok(LIST.length >= 90);
  for (const s of LIST) {
    assert.ok(["B9A", "B7G", "B9D", "OCTAL", "UX4", "UX6", "JUMBO", "GU50", "GM70", "B7A"].includes(s.base), s.id);
    assert.ok(["pcb", "chassis", "bottom", "panel"].includes(s.mount), s.id);
    assert.ok(s.p > 0, s.id);
    if (!s.body) continue;
    assert.equal(s.mount, "pcb", `${s.id}: a board footprint only for a PCB socket`);
    assert.equal(s.src, "drawing");
    assert.ok(s.tail > 8 && s.tail < 30 && (s.tw > 0 || s.pins), s.id);
    s.body.forEach(([d, z1, z2]) => assert.ok(d > 10 && z2 > z1 && z1 >= 0, s.id));
    if (s.flange && s.screw) assert.ok(s.flange.l > s.screw && s.flange.hole > 2, s.id);
  }
  assert.equal(LIST.filter(s => s.body).length, 20);
  assert.equal(globalThis.TUBE_SOCKET_URL(LIST[0]), "https://www.goodcomponent.com/products/vacuum-tube-soket/socket/1181.html");
});

test("footprints: the tails on the drawing's circle at the contacts' angles, screws in unplated holes", () => {
  // GZC9-Y: tails bent out to Ø21.5, pin 1 next to the gap (down), pins 36° apart
  const f = B.footprint("SOCKET-B9A.GZC9-Y"), g = B.footprint("SOCKET-B9A");
  assert.equal(f.pads.length, 9);
  f.pads.forEach((p, i) => {
    assert.ok(Math.abs(Math.hypot(p.x, p.y) - 10.75) < 0.01, `pad ${p.num} on Ø21.5`);
    assert.ok(Math.abs(Math.atan2(p.y, p.x) - Math.atan2(g.pads[i].y, g.pads[i].x)) < 1e-3, `pad ${p.num} at the contact's angle`);
  });
  assert.equal(f.pads[0].shape, "rect");
  assert.equal(f.holes.length, 0);
  // octal GZC8-Y-5: straight tails on the contacts' Ø17.5, screws 38.5 apart on the key's axis, Ø2.8
  const o = B.footprint("SOCKET-OCTAL.GZC8-Y-5");
  o.pads.forEach(p => assert.ok(Math.abs(Math.hypot(p.x, p.y) - 8.75) < 0.01));
  assert.deepEqual(o.holes.map(h => [Math.round(h.x * 100) / 100, Math.round(h.y * 100) / 100, h.d]).sort(), [[0, -19.25, 2.8], [0, 19.25, 2.8]].sort());
  // GZS9-F: screws 28 apart, 18° off the gap (the drawing's top view)
  const s = B.footprint("SOCKET-B9A.GZS9-F"), h = s.holes[0];
  const ang = Math.abs(Math.atan2(h.x, -h.y) * 180 / Math.PI);
  assert.ok(Math.abs(Math.hypot(h.x, h.y) - 14) < 0.01);
  assert.ok(Math.abs(ang - 18) < 0.01 || Math.abs(ang - 162) < 0.01, `${ang}°`);
  // UX4 GZC4-T-G: round pins on Ø16.25, the filament pins' holes for 3.2 mm pins
  const u = B.footprint("SOCKET-UX4.GZC4-T-G");
  u.pads.forEach(p => assert.ok(Math.abs(Math.hypot(p.x, p.y) - 8.125) < 0.01));
  assert.equal(u.pads.find(p => p.num === "1").drill, 3.5);
  assert.equal(u.pads.find(p => p.num === "2").drill, 2.8);
  // every board socket: holes for the tails, no pad on another, none on a screw hole
  for (const x of LIST.filter(q => q.body)) {
    const fp = B.footprint(`SOCKET-${x.base}.${x.id}`);
    assert.ok(fp && fp.name === `SOCKET-${x.base}.${x.id}`, x.id);
    fp.pads.forEach((a, i) => {
      assert.ok(a.drill >= 1.4 && a.w - a.drill >= 0.5, `${x.id} pad ${a.num}: ring`);
      fp.pads.slice(i + 1).forEach(b => assert.ok(Math.hypot(a.x - b.x, a.y - b.y) - a.w / 2 - b.w / 2 >= 0.5, `${x.id} pads ${a.num}/${b.num}`));
      fp.holes.forEach(q => assert.ok(Math.hypot(a.x - q.x, a.y - q.y) - a.w / 2 - q.d / 2 >= 0.9, `${x.id} pad ${a.num} vs screw`));
    });
  }
  assert.equal(B.footprint("SOCKET-OCTAL.GZC9-Y"), null, "a socket of another base is not a footprint");
});

test("the Socket field lists the board sockets of the valve's base first, then the chassis ones", () => {
  const opts = L.socketOptions("B9A");
  assert.deepEqual(opts[0], ["", "Any socket (generic footprint)"]);
  const groups = [...new Set(opts.slice(1).map(o => o[2]))];
  assert.deepEqual(groups, ["On the board: footprint and 3D model", "On the chassis or a panel: wired to the board"]);
  assert.ok(opts.some(o => o[0] === "GZC9-Y" && /ceramic, PCB mount/.test(o[1])));
  assert.equal(globalThis.tubeSocketBase(L.tubeByName("GU-50")), "GU50");
  assert.equal(globalThis.tubeSocketBase(L.tubeByName("845")), "JUMBO");
  assert.equal(globalThis.tubeSocketBase(L.tubeByName("6S33S-V")), "B7A");
  const field = L.LIB.tube.fields.find(f => f.key === "sock");
  assert.ok(field.when({ params: { tube: "EL34" } }));
  assert.ok(L.socketOptions("GM70").some(o => o[0] === "GZC7-4"));
});

test("a socket picked in the schematic sets the board footprint once; a chassis socket means wire pads", () => {
  const nl = amp("GZC9-Y"), parts = B.physicalParts(nl), v1 = parts.find(g => g.ref === "VL1");
  assert.equal(v1.sock, "GZC9-Y");
  assert.equal(v1.defaultFp, "SOCKET-B9A.GZC9-Y");
  assert.ok(parts.find(g => g.ref === "VL2").options.includes("SOCKET-OCTAL.GZC8-Y-5"), "the octal ones offered for an EL34");
  const board = B.newBoard();
  B.sync(board, nl);
  assert.equal(board.parts[v1.key].fp, "SOCKET-B9A.GZC9-Y");
  // picked by hand afterwards: stays
  board.parts[v1.key].fp = "SOCKET-B9A";
  assert.deepEqual(B.applyPartNumbers(board, nl), []);
  assert.equal(board.parts[v1.key].fp, "SOCKET-B9A");
  // another socket picked: the board follows
  const nl2 = amp("GZS9-F"), done = B.applyPartNumbers(board, nl2);
  assert.equal(board.parts[v1.key].fp, "SOCKET-B9A.GZS9-F");
  assert.equal(done[0].ref, "VL1");
  // a chassis-mount socket: the valve goes on wire pads
  const nl3 = amp("GZC9-T1-G");
  B.applyPartNumbers(board, nl3);
  assert.match(board.parts[v1.key].fp, /^WIRE-/);
  // the model: the screws' holes are the board's unplated holes
  board.parts[v1.key].fp = "SOCKET-B9A.GZS9-F";
  const m = B.model(board, nl2);
  assert.equal(m.holes.filter(h => h.ref === "VL1").length, 2);
});

test("3D: the socket's own body parts, its flange and shield, the valve seated on top", () => {
  const nl = amp("PCP9-Y-1"), [g] = B.physicalParts(nl).filter(q => q.ref === "VL1");
  const fp = B.footprint("SOCKET-B9A.PCP9-Y-1"), bodies = D3.partBodies({ ...g, fp, place: { x: 0, y: 0, rot: 0, side: "F" } }, 1.6, { tubes: true });
  const zTop = Math.max(...bodies.filter(b => !b.glass && !b.inner).flatMap(b => b.verts.map(v => v[2])));
  assert.ok(Math.abs(zTop - 1.6 - 21) < 0.01, `the shield's top 21 mm over the board (${zTop - 1.6})`);
  const glass = bodies.filter(b => b.glass), zGlass = Math.min(...glass.flatMap(b => b.verts.map(v => v[2])));
  assert.ok(Math.abs(zGlass - 1.6 - 9.15) < 0.01, "the valve sits on the socket's body (9 mm)");
  const f2 = B.footprint("SOCKET-OCTAL.GZC8-Y-7"), b2 = D3.partBodies({ ...g, fp: f2, place: { x: 0, y: 0, rot: 0, side: "F" } }, 1.6, { tubes: false });
  const flange = b2.find(b => b.verts.length > 60 && !b.round);
  assert.ok(flange, "the flange: its outline extruded");
  const xs = flange.verts.map(v => v[1]);
  assert.ok(Math.abs(Math.max(...xs) - Math.min(...xs) - 47) < 0.5, "the flange is 47 long");
});

test("BOM: a socket line per socket picked, with its number and the shop's page", () => {
  const rows = BOM.build(amp("GZC9-Y").parts, { sockets: true }), sock = rows.filter(r => r.socket);
  assert.equal(sock.length, 2);
  const nov = sock.find(r => /Noval/.test(r.value)), oct = sock.find(r => /Octal/.test(r.value));
  assert.equal(nov.partno, "GZC9-Y");
  assert.match(nov.rating, /^GoodComponent GZC9-Y \(gold pins: GZC9-Y-G\); for VL1/);
  assert.match(nov.desc, /ceramic, PCB mount/);
  assert.equal(nov.url, "https://www.goodcomponent.com/products/vacuum-tube-soket/socket/446.html");
  assert.equal(oct.partno, "");
  // no pick, but the board names a real socket: that one
  const nl = amp(""), [v2] = B.physicalParts(nl).filter(g => g.ref === "VL2");
  const board = { parts: { [v2.key]: { fp: "SOCKET-OCTAL.GZS8-F" } } };
  assert.equal(BOM.build(nl.parts, { sockets: true, board }).find(r => r.socket && /Octal/.test(r.value)).partno, "GZS8-F");
  // a pick that doesn't fit the valve's base is ignored
  const odd = amp("GZC8-Y-5");
  assert.equal(BOM.build(odd.parts, { sockets: true }).find(r => r.socket && /Noval/.test(r.value)).partno, "");
});
