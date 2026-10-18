/**
 * Keyboard shortcuts of the command table (ui-kit.js), with synthetic keydown events.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../ui-kit.js", import.meta.url), "utf8"), { filename: "ui-kit.js" });
const { UiKit } = globalThis;

/** A keydown as the browser sends it; prevented tells whether preventDefault() was called. */
function key(k, code, mods = {}, tag = "CANVAS") {
  return { key: k, code, ctrlKey: !!mods.ctrl, metaKey: !!mods.meta, shiftKey: !!mods.shift, target: { tagName: tag }, prevented: false, preventDefault() { this.prevented = true; } };
}
function table() {
  const ran = [], cmds = UiKit.commands(), run = id => () => ran.push(id);
  let helpOpen = false;
  cmds
    .add({ id: "help-close", keys: ["Escape"], anyCtrl: true, when: () => helpOpen, run: () => { helpOpen = false; ran.push("help-close"); } })
    .add({ id: "rotate", keys: ["R"], run: run("rotate"), help: "rotate" })
    .add({ id: "duplicate", keys: ["D", "Ctrl+D"], prevent: true, run: run("duplicate"), help: "duplicate" })
    .add({ id: "delete", keys: ["Delete", "Backspace"], anyCtrl: true, prevent: true, run: run("delete"), help: "delete" })
    .add({ id: "escape", keys: ["Escape"], anyCtrl: true, run: run("escape") })
    .add({ id: "zoom-in", keys: ["+", "=", "NumpadAdd", "Equal"], anyCtrl: true, run: run("zoom-in"), helpKeys: ["+"], help: "zoom in" })
    .add({ id: "zoom-out", keys: ["-", "NumpadSubtract", "Minus"], anyCtrl: true, run: run("zoom-out"), helpKeys: ["-"], help: "zoom out" })
    .add({ id: "undo", keys: ["Ctrl+Z"], prevent: true, run: run("undo") })
    .add({ id: "redo", keys: ["Ctrl+Y", "Ctrl+Shift+Z"], prevent: true, run: run("redo") })
    .add({ id: "copy", keys: ["Ctrl+C"], run: run("copy") })
    .add({ id: "save", keys: ["Ctrl+S"], prevent: true, run: run("save") })
    .add({ id: "save-as", keys: ["Ctrl+Shift+S"], prevent: true, run: run("save-as") })
    .add({ id: "simulate", keys: ["Ctrl+Enter"], prevent: true, run: run("simulate") })
    .add({ id: "help", keys: ["F1"], inInputs: true, prevent: true, run: () => { helpOpen = !helpOpen; ran.push("help"); } })
    .add({ id: "help-alt", keys: ["?"], prevent: true, run: () => { helpOpen = !helpOpen; ran.push("help-alt"); } });
  return { cmds, ran, last: () => ran[ran.length - 1] };
}

test("letters go by the physical key, so a Cyrillic layout works", () => {
  const t = table();
  assert.ok(t.cmds.key(key("к", "KeyR"))); assert.equal(t.last(), "rotate");
  assert.ok(t.cmds.key(key("R", "KeyR", { shift: true }))); assert.equal(t.last(), "rotate");
});

test("Ctrl must match: Ctrl+R is the browser's, D and Ctrl+D both duplicate", () => {
  const t = table();
  assert.equal(t.cmds.key(key("r", "KeyR", { ctrl: true })), false);
  const e = key("d", "KeyD", { ctrl: true }); t.cmds.key(e); assert.equal(t.last(), "duplicate"); assert.ok(e.prevented);
  t.cmds.key(key("d", "KeyD")); assert.equal(t.ran.length, 2);
  t.cmds.key(key("z", "KeyZ", { meta: true })); assert.equal(t.last(), "undo");
});

test("Shift picks the Shift variant when there is one, else the plain key", () => {
  const t = table();
  t.cmds.key(key("Z", "KeyZ", { ctrl: true, shift: true })); assert.equal(t.last(), "redo");
  t.cmds.key(key("S", "KeyS", { ctrl: true, shift: true })); assert.equal(t.last(), "save-as");
  t.cmds.key(key("s", "KeyS", { ctrl: true })); assert.equal(t.last(), "save");
  t.cmds.key(key("+", "Equal", { shift: true })); assert.equal(t.last(), "zoom-in");
  t.cmds.key(key("?", "Slash", { shift: true })); assert.equal(t.last(), "help-alt");
});

test("named keys, key codes and anyCtrl", () => {
  const t = table();
  t.cmds.key(key("Backspace", "Backspace")); assert.equal(t.last(), "delete");
  t.cmds.key(key("Delete", "Delete", { ctrl: true })); assert.equal(t.last(), "delete");
  t.cmds.key(key("+", "NumpadAdd")); assert.equal(t.last(), "zoom-in");
  t.cmds.key(key("=", "Equal", { ctrl: true })); assert.equal(t.last(), "zoom-in");
  t.cmds.key(key("-", "Minus")); assert.equal(t.last(), "zoom-out");
  const e = key("Enter", "Enter", { ctrl: true }); t.cmds.key(e); assert.equal(t.last(), "simulate"); assert.ok(e.prevented);
  assert.equal(t.cmds.key(key("Enter", "Enter")), false);
  const c = key("c", "KeyC", { ctrl: true }); t.cmds.key(c); assert.equal(t.last(), "copy"); assert.equal(c.prevented, false);
});

test("when(): Esc closes the help first, then clears", () => {
  const t = table();
  t.cmds.key(key("F1", "F1")); t.cmds.key(key("Escape", "Escape")); assert.deepEqual(t.ran, ["help", "help-close"]);
  t.cmds.key(key("Escape", "Escape")); assert.equal(t.last(), "escape");
});

test("while typing in a field only inInputs commands run", () => {
  const t = table();
  assert.equal(t.cmds.key(key("r", "KeyR", {}, "INPUT")), false);
  assert.equal(t.cmds.key(key("Delete", "Delete", {}, "TEXTAREA")), false);
  assert.ok(t.cmds.key(key("F1", "F1", {}, "SELECT"))); assert.equal(t.last(), "help");
});

test("check(): bound elements show the setting's state after any command", () => {
  const cmds = UiKit.commands(); let on = false;
  const el = { classes: new Set(), classList: { toggle(c, v) { v ? el.classes.add(c) : el.classes.delete(c); } }, addEventListener(t, f) { el.click = f; } };
  cmds.add({ id: "volts", run: () => { on = !on; }, check: () => on }).bind(el, "volts");
  el.click({}); assert.ok(el.classes.has("active"));
  el.click({}); assert.ok(!el.classes.has("active"));
});

test("the help's key list comes from the commands that have a help text", () => {
  const t = table(), cells = [];
  const mk = tag => ({ tag, kids: [], style: {}, textContent: "", appendChild(c) { this.kids.push(c); } });
  globalThis.document = { createElement: mk, createTextNode: s => ({ textContent: s }) };
  const host = { innerHTML: "x", appendChild: c => cells.push(c) };
  t.cmds.helpRows(host);
  delete globalThis.document;
  const rows = [];
  for (let i = 0; i < cells.length; i += 2) rows.push([cells[i].kids.map(k => k.textContent).join(""), cells[i + 1].textContent]);
  assert.deepEqual(rows, [["R", "rotate"], ["D", "duplicate"], ["Del", "delete"], ["+", "zoom in"], ["−", "zoom out"]]);
});
