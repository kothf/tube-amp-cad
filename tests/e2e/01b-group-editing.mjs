// Group editing with the real mouse and keyboard: box selection (inside / touching), Shift and
// Ctrl+click, dragging a group, Shift+drag (Ctrl+drag) copies, a group turns and mirrors as one
// drawing with its wires, Esc during a drag puts things back
import { cad, check, sameNet, toScreen } from "./harness.mjs";

// three resistors in a row, R1–R2 wired, R2–R3 wired; R4 off to the side, wired to R3
const ids = await cad.evaluate(() => {
  const C = TubeCAD, S = C.state;
  S.comps = []; S.wires = []; S.view = { scale: 1, ox: 0, oy: 0 }; S.sel.comps.clear(); S.sel.wires.clear();
  const r = x => { const c = C.makeComp("resistor", { r: 1000 }, x, 200, 0); S.comps.push(c); return c; };
  const a = r(200), b = r(320), c = r(440), d = C.makeComp("resistor", { r: 2200 }, 560, 400, 1); S.comps.push(d);
  const p = (k, n) => C.compPins(k).find(q => q.id === n);
  C.addSegment(p(a, "2").x, 200, p(b, "1").x, 200); C.addSegment(p(b, "2").x, 200, p(c, "1").x, 200);
  const e = p(c, "2"), f = p(d, "1"); C.lRoute(e.x, e.y, f.x, f.y, true).forEach(s => C.addSegment(...s));
  C.commit(); return { a: a.id, b: b.id, c: c.id, d: d.id };
});
const sel = () => cad.evaluate(() => ({ comps: [...TubeCAD.state.sel.comps], wires: [...TubeCAD.state.sel.wires] }));
const comps = () => cad.evaluate(() => TubeCAD.state.comps.map(c => ({ id: c.id, x: c.x, y: c.y, rot: c.rot, label: c.label, flip: c.params.flip })));
const drag = async (x0, y0, x1, y1, mods = []) => {
  const [a, b] = await toScreen(x0, y0), [c, d] = await toScreen(x1, y1);
  for (const k of mods) await cad.keyboard.down(k);
  await cad.mouse.move(a, b); await cad.mouse.down(); await cad.mouse.move(c, d, { steps: 6 }); await cad.mouse.up();
  for (const k of mods) await cad.keyboard.up(k);
};
const click = async (x, y, mods = []) => { const [a, b] = await toScreen(x, y); for (const k of mods) await cad.keyboard.down(k); await cad.mouse.click(a, b); for (const k of mods) await cad.keyboard.up(k); };
const empty = async () => { await cad.keyboard.press("Escape"); await cad.evaluate(() => { TubeCAD.state.sel.comps.clear(); TubeCAD.state.sel.wires.clear(); }); };

// a box dragged left to right takes what lies wholly inside it: R1, R2 and the wire between them
await empty(); await drag(150, 150, 370, 250);
let s = await sel();
check(s.comps.length === 2 && s.comps.includes(ids.a) && s.comps.includes(ids.b) && s.wires.length === 1, `a box dragged left to right selects what lies inside (${s.comps.length} parts, ${s.wires.length} wire)`);
// right to left: everything it touches
await empty(); await drag(330, 260, 225, 150);
s = await sel();
check(s.comps.length === 2 && s.comps.includes(ids.a) && s.comps.includes(ids.b), `a box dragged right to left selects what it touches (${s.comps.length} parts)`);
// Shift+box and Ctrl+click add, Ctrl+click again takes out
await click(440, 200, ["Control"]);
s = await sel();
check(s.comps.includes(ids.c), "Ctrl+click adds a part to the selection");
await click(440, 200, ["Shift"]);
s = await sel();
check(!s.comps.includes(ids.c) && s.comps.includes(ids.a), "Shift+click on a selected part takes it out, the rest stay selected");
await drag(400, 150, 480, 250, ["Shift"]);
s = await sel();
check(s.comps.includes(ids.c) && s.comps.includes(ids.a) && s.comps.length === 3, `Shift+box adds to the selection (${s.comps.length} parts)`);

// drag one of the group: all move, the wire to R4 (not selected) stays on its pin
const before = await comps();
await drag(320, 200, 320, 100);
let after = await comps();
const moved = id => { const a = before.find(c => c.id === id), b = after.find(c => c.id === id); return [b.x - a.x, b.y - a.y].join(","); };
check(moved(ids.a) === "0,-100" && moved(ids.b) === "0,-100" && moved(ids.c) === "0,-100" && moved(ids.d) === "0,0" && await sameNet(`${ids.c}:2`, `${ids.d}:1`) && await sameNet(`${ids.a}:2`, `${ids.b}:1`),
  "dragging one part of a group moves them all; the wire to a part left out stretches and stays connected");
await cad.keyboard.press("Control+z");
check((await comps()).find(c => c.id === ids.a).y === 200, "Ctrl+Z puts the group back in one step");

// Shift+drag copies: the originals stay, a copy with new letter codes comes along, wired the same inside
await empty(); await drag(150, 150, 370, 250);
const n0 = (await comps()).length;
await drag(200, 200, 200, 520, ["Shift"]);
after = await comps();
const copies = after.filter(c => !before.some(b => b.id === c.id));
s = await sel();
check(after.length === n0 + 2 && copies.every(c => c.y === 520) && after.find(c => c.id === ids.a).y === 200 && s.comps.length === 2 && s.comps.every(id => copies.some(c => c.id === id)),
  `Shift+drag copies the selection and moves the copy; the originals stay; the copy is selected (${copies.map(c => c.label).join(", ")})`);
check(copies.every(c => !before.some(b => b.label === c.label)) && await sameNet(`${copies[0].id}:2`, `${copies[1].id}:1`) && !(await sameNet(`${copies[0].id}:2`, `${ids.a}:2`)),
  "the copy gets letter codes of its own and its own wire, not joined to the originals");
await cad.keyboard.press("Control+z");
check((await comps()).length === n0, "one Ctrl+Z takes the copy back");
// Ctrl+drag on one unselected part copies just it (Ctrl adds it to an empty selection)
await empty();
await drag(440, 200, 440, 600, ["Control"]);
after = await comps();
check(after.length === n0 + 1 && after.find(c => c.id === ids.c).y === 200 && after.some(c => c.y === 600 && c.x === 440), "Ctrl+drag on a part copies it too");
await cad.keyboard.press("Control+z");
// a copy dragged back onto the originals is dropped
await empty(); await click(200, 200);
await (async () => { const [a, b] = await toScreen(200, 200), [c, d] = await toScreen(200, 320); await cad.keyboard.down("Shift"); await cad.mouse.move(a, b); await cad.mouse.down(); await cad.mouse.move(c, d, { steps: 4 }); await cad.mouse.move(a, b, { steps: 4 }); await cad.mouse.up(); await cad.keyboard.up("Shift"); })();
check((await comps()).length === n0, "a copy dropped back where it started is not added");

// Esc during a drag puts the parts back
await empty(); await click(200, 200);
{
  const [a, b] = await toScreen(200, 200), [c, d] = await toScreen(260, 300);
  await cad.mouse.move(a, b); await cad.mouse.down(); await cad.mouse.move(c, d, { steps: 4 });
  await cad.keyboard.press("Escape"); await cad.mouse.up();
  const r = (await comps()).find(k => k.id === ids.a);
  check(r.x === 200 && r.y === 200, `Esc while dragging puts the part back (${r.x}, ${r.y})`);
}

// a group turns about its middle with its wires; the wire to R4 stays connected
await empty(); await drag(150, 150, 500, 250);
await cad.keyboard.press("Space");
after = await comps();
const A = after.find(c => c.id === ids.a), Bc = after.find(c => c.id === ids.b), Cc = after.find(c => c.id === ids.c);
check(A.rot === 1 && Bc.rot === 1 && Cc.rot === 1 && A.x === Bc.x && Bc.x === Cc.x && A.y < Bc.y && Bc.y < Cc.y,
  `Space turns a group as one drawing: the row of parts becomes a column (${[A, Bc, Cc].map(c => `${c.x},${c.y}`).join(" ")})`);
check(await sameNet(`${ids.a}:2`, `${ids.b}:1`) && await sameNet(`${ids.b}:2`, `${ids.c}:1`) && await sameNet(`${ids.c}:2`, `${ids.d}:1`), "after the turn every connection holds, inside the group and out to R4");
await cad.keyboard.press("m");
after = await comps();
check(await sameNet(`${ids.a}:2`, `${ids.b}:1`) && await sameNet(`${ids.c}:2`, `${ids.d}:1`) && after.find(c => c.id === ids.a).flip === "yes", "M mirrors the group as one drawing, connections kept");
await cad.keyboard.press("Control+z"); await cad.keyboard.press("Control+z");
check((await comps()).find(c => c.id === ids.a).rot === 0, "two Ctrl+Z undo the mirror and the turn");
await cad.keyboard.press("Control+y");
check((await comps()).find(c => c.id === ids.a).rot === 1, "Ctrl+Y redoes");
// a group deletes, copies and pastes as one
await cad.keyboard.press("Control+z");
await empty(); await drag(150, 150, 370, 250);
const n1 = (await comps()).length;
await cad.keyboard.press("Control+c"); await cad.keyboard.press("Control+v");
check((await comps()).length === n1 + 2 && (await sel()).comps.length === 2 && (await sel()).wires.length === 1, "Ctrl+C, Ctrl+V pastes a copy of the group with its wire, selected");
await cad.keyboard.press("Delete");
check((await comps()).length === n1, "Delete removes the selected group");
await cad.evaluate(() => { const S = TubeCAD.state; S.comps = []; S.wires = []; S.sel.comps.clear(); S.sel.wires.clear(); TubeCAD.commit(); });
