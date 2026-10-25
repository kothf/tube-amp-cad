// Editing with the real mouse and keyboard, files, the inspector
import { cad, check, clickAt, pin, sameNet, state, toScreen } from "./harness.mjs";

await cad.getByRole("button", { name: /^Resistor/ }).click();
const [mx, my] = await toScreen(300, 200);
await cad.mouse.move(mx, my); await cad.keyboard.press("Space"); await cad.mouse.click(mx, my);
await cad.getByRole("button", { name: /^Capacitor/ }).click();
await clickAt(500, 300);
let s = await state();
const R1 = s.comps.find(c => c.label === "R1"), C1 = s.comps.find(c => c.label === "C1");
check(R1 && R1.rot === 1 && C1 && C1.x === 500, "parts placed from the palette with letter codes (R1, C1), rotated with Space while placing, snapped to the grid");

const a = await pin(R1.id, "2"), b = await pin(C1.id, "1");
await clickAt(a.x, a.y); await clickAt(a.x, b.y); await clickAt(b.x, b.y);
check(await sameNet(`${R1.id}:2`, `${C1.id}:1`), "wire drawn pin → corner → pin connects R1 to C1");

const [cx, cy] = await toScreen(500, 300), [dx, dy] = await toScreen(540, 340);
await cad.mouse.move(cx, cy); await cad.mouse.down(); await cad.mouse.move(dx, dy, { steps: 5 }); await cad.mouse.up();
check(await sameNet(`${R1.id}:2`, `${C1.id}:1`), "wire follows a dragged part and stays connected");

await cad.keyboard.press("Control+a"); await cad.keyboard.press("Delete");
check((await state()).comps.length === 0, "Ctrl+A, Delete clears the sheet");
await cad.keyboard.press("Control+z");
check((await state()).comps.length === 2, "Ctrl+Z restores it");

{
  // shortcuts go by the physical key, so they work in a Cyrillic layout too (R types "к", M "ь", D "в", Z "я")
  const ru = (key, code, ctrl) => cad.evaluate(([key, code, ctrl]) => window.dispatchEvent(new KeyboardEvent("keydown", { key, code, ctrlKey: !!ctrl, bubbles: true })), [key, code, ctrl]);
  await cad.evaluate(id => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(id); }, C1.id);
  const r0 = (await state()).comps.find(c => c.id === C1.id).rot, n0 = (await state()).comps.length;
  await ru("к", "KeyR"); const r1 = (await state()).comps.find(c => c.id === C1.id).rot;
  await ru("ь", "KeyM"); const f1 = (await state()).comps.find(c => c.id === C1.id).params.flip;
  await ru("в", "KeyD"); const n1 = (await state()).comps.length;
  await ru("я", "KeyZ", true); await ru("я", "KeyZ", true); await ru("я", "KeyZ", true);
  const back = (await state()).comps.find(c => c.id === C1.id);
  check(r1 === ((r0 + 1) & 3) && f1 === "yes" && n1 === n0 + 1 && back.rot === r0 && back.params.flip !== "yes" && (await state()).comps.length === n0,
    "with a Russian keyboard layout R rotates, M mirrors, D duplicates and Ctrl+Z undoes (keys go by physical position)");
}
{
  // Space rotates: a tap turns the selection; held down while dragging it pans and turns nothing; pressed
  // while dragging a part it turns that part, one undo step with the move; it types in a field and does
  // not press a focused button
  const rotOf = async id => (await state()).comps.find(c => c.id === id).rot, view = () => cad.evaluate(() => [TubeCAD.state.view.ox, TubeCAD.state.view.oy]);
  await cad.evaluate(id => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(id); }, C1.id);
  const r0 = await rotOf(C1.id);
  await cad.keyboard.press("Space"); const r1 = await rotOf(C1.id);
  const v0 = await view(), [ex, ey] = await toScreen(800, 560);
  await cad.mouse.move(ex, ey); await cad.keyboard.down("Space"); await cad.mouse.down(); await cad.mouse.move(ex + 40, ey + 30, { steps: 4 }); await cad.mouse.up(); await cad.keyboard.up("Space");
  const v1 = await view(), r2 = await rotOf(C1.id);
  check(r1 === ((r0 + 1) & 3) && r2 === r1 && v1[0] !== v0[0] && v1[1] !== v0[1], `a tap of Space rotates the selection; Space held down while dragging pans and rotates nothing (rot ${r0} → ${r1} → ${r2})`);
  const c0 = (await state()).comps.find(c => c.id === C1.id), [px, py] = await toScreen(c0.x, c0.y), [qx, qy] = await toScreen(c0.x + 40, c0.y + 40);
  await cad.mouse.move(px, py); await cad.mouse.down(); await cad.mouse.move(qx, qy, { steps: 4 }); await cad.keyboard.press("Space"); await cad.mouse.move(qx + 1, qy + 1); await cad.mouse.up();
  const c1 = (await state()).comps.find(c => c.id === C1.id);
  await cad.keyboard.press("Control+z"); const c2 = (await state()).comps.find(c => c.id === C1.id);
  check(c1.rot === ((r1 + 1) & 3) && c1.x === c0.x + 40 && c2.rot === r1 && c2.x === c0.x && c2.y === c0.y, `Space while dragging a part rotates it; one Ctrl+Z takes back the move and the turn (rot ${c1.rot}, x ${c1.x} → ${c2.x})`);
  await cad.evaluate(id => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(id); }, C1.id);
  const live0 = await cad.evaluate(() => TubeCAD.state.sim.live);
  await cad.focus("#btn-live"); await cad.keyboard.press("Space");
  const live1 = await cad.evaluate(() => TubeCAD.state.sim.live), r3 = await rotOf(C1.id);
  await cad.evaluate(() => document.activeElement.blur());
  const field = cad.locator("#palette input").first(); await field.fill(""); await field.press("a"); await field.press("Space"); await field.press("b");
  const typed = await field.inputValue(), r4 = await rotOf(C1.id); await field.fill(""); await field.press("Escape"); await cad.evaluate(() => document.activeElement.blur());
  check(live1 === live0 && r3 === ((r1 + 1) & 3) && typed === "a b" && r4 === r3, `Space with a toolbar button focused rotates instead of pressing it; in a text field it types a space (${JSON.stringify(typed)})`);
  await cad.keyboard.press("Control+z"); await cad.keyboard.press("Control+z");
  check(await rotOf(C1.id) === r0, "Ctrl+Z after that is back where it started");
}
await cad.evaluate(id => { const S = TubeCAD.state; S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(id); TubeCAD.commit(); }, R1.id);
const field = cad.locator("#inspector .row", { hasText: "Resistance" }).locator("input");
await field.fill("4.7k"); await field.press("Enter");
check((await state()).comps.find(c => c.id === R1.id).params.r === 4700, 'inspector parses "4.7k" as 4700 Ω');
// signal generator: the amplitude can be typed as Vpk, Vrms or dBV and the other two follow
const GEN = await cad.evaluate(() => { const C = TubeCAD, S = C.state, g = C.makeComp("siggen", {}, 600, 300, 0); S.comps.push(g); S.sel.comps.clear(); S.sel.wires.clear(); S.sel.comps.add(g.id); C.commit(); return g.id; });
const genRow = t => cad.locator("#inspector .row", { hasText: t }).locator("input");
await genRow("dBV").fill("-20"); await genRow("dBV").press("Enter");
let gp = (await state()).comps.find(c => c.id === GEN).params;
check(Math.abs(gp.amp - 0.1 * Math.SQRT2) < 1e-9, "−20 dBV on a sine generator sets 141 mVpk");
check(/^100m/.test(await genRow("Vrms").inputValue()), "the Vrms field follows the dBV entry");
await genRow("Vrms").fill("2"); await genRow("Vrms").press("Enter");
check(await genRow("dBV").inputValue() === "6.02", "2 Vrms shows as 6.02 dBV");
await cad.locator("#inspector .row", { hasText: "Waveform" }).locator("select").selectOption("square");
check(await genRow("dBV").inputValue() === "9.03", "a square wave of the same peak reads 3 dB hotter");
await cad.evaluate(id => { const S = TubeCAD.state; S.comps = S.comps.filter(c => c.id !== id); TubeCAD.commit(); }, GEN);
// File → Open keeps the file, Save asks before it overwrites it, Save as writes a new one
await cad.evaluate(() => {
  const json = JSON.stringify({ app: "TubeAmpCAD", version: 2, comps: TubeCAD.state.comps, wires: TubeCAD.state.wires });
  window.__writes = [];
  const fake = name => ({ name, getFile: async () => new File([json], name, { type: "application/json" }),
    createWritable: async () => { let buf = ""; return { write: async t => { buf += t; }, close: async () => { window.__writes.push({ name, text: buf }); } }; } });
  window.showOpenFilePicker = async () => [fake("amp.json")];
  window.showSaveFilePicker = async o => { window.__saveAsSuggested = o.suggestedName; return fake("copy.json"); };
});
await cad.click("#btn-file"); await cad.click("#btn-open");
await cad.waitForFunction(() => /^amp\.json/.test(document.title));
const fileTag = () => cad.evaluate(() => { const el = document.getElementById("cur-file"); return { text: el.textContent, dirty: !!el.querySelector(".dirty"), title: document.title }; });
const ft0 = await fileTag();
// an edit marks the file as changed (•, in the toolbar and the tab title)
await cad.evaluate(() => { const c = TubeCAD.state.comps.find(c => c.type === "resistor"); c.params.r = c.params.r * 2; TubeCAD.commit(); });
const ft1 = await fileTag();
await cad.evaluate(() => { const c = TubeCAD.state.comps.find(c => c.type === "resistor"); c.params.r = c.params.r / 2; TubeCAD.commit(); });
const ft2 = await fileTag();
check(ft0.text === "amp.json" && !ft0.dirty && ft1.dirty && /^• amp\.json/.test(ft1.title) && !ft2.dirty, `the toolbar names the open file (${ft0.text}) and marks unsaved changes (${ft1.text}); back as saved, the mark goes`);
await cad.keyboard.press("Control+s");
check(await cad.isVisible("#save-modal") && /Overwrite amp\.json/.test(await cad.textContent("#save-msg")), "Save on an opened file asks before overwriting it");
await cad.click("#btn-save-cancel");
check((await cad.evaluate(() => window.__writes.length)) === 0, "Cancel leaves the file alone");
await cad.click("#btn-file"); await cad.click("#btn-save"); await cad.click("#btn-save-ok");
await cad.waitForFunction(() => window.__writes.length === 1);
const wr = await cad.evaluate(() => window.__writes[0]);
check(wr.name === "amp.json" && JSON.parse(wr.text).comps.length === (await state()).comps.length, "Overwrite writes the circuit back to the opened file");
check(!(await fileTag()).dirty, "after saving the file is no longer marked as changed");
// Save as through the File System Access API: Chromium only (Safari has no picker; Save as downloads there)
if (process.env.BROWSER !== "webkit") {
  await cad.keyboard.press("Control+Shift+s");
  await cad.waitForFunction(() => window.__writes.length === 2);
  check((await cad.evaluate(() => [window.__saveAsSuggested, window.__writes[1].name, document.title])).join("|").startsWith("amp.json|copy.json|copy.json"), "Save as (Ctrl+Shift+S) suggests the current name, writes the new file and makes it the current one");
}
await cad.reload(); await cad.waitForFunction(() => window.TubeCAD);
check((await state()).comps.some(c => c.params.r === 4700), "circuit survives a reload (autosave)");
check(/^(copy|amp)\.json$/.test((await fileTag()).text), `the file name comes back after a reload (${(await fileTag()).text})`);

// a stored circuit whose wire ends on another wire's middle (a T joint) loads with the joint
// connected, as File → Open does: a cap teed onto the line between two resistors
const saved = await cad.evaluate(() => localStorage.getItem("tubecad_circuit_v2"));
await cad.evaluate(() => localStorage.setItem("tubecad_circuit_v2", JSON.stringify({
  comps: [{ id: "ra", type: "resistor", x: 100, y: 100, rot: 0, params: { r: 1000 }, label: "R1" },
    { id: "rb", type: "resistor", x: 300, y: 100, rot: 0, params: { r: 1000 }, label: "R2" },
    { id: "ca", type: "capacitor", x: 200, y: 200, rot: 1, params: { c: 1e-6 }, label: "C1" }],
  wires: [{ id: "w1", x1: 130, y1: 100, x2: 270, y2: 100 }, { id: "w2", x1: 200, y1: 100, x2: 200, y2: 180 }] })));
await cad.reload(); await cad.waitForFunction(() => window.TubeCAD);
check(await sameNet("ra:2", "ca:1") && await sameNet("rb:1", "ca:1"), "a stored circuit with a T joint loads connected (same as File → Open)");
await cad.evaluate(s => { localStorage.setItem("tubecad_circuit_v2", s); }, saved);
await cad.reload(); await cad.waitForFunction(() => window.TubeCAD);
