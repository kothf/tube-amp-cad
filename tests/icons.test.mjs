/**
 * The line icons (icons.js): every data-ico on the pages names an icon there, and each icon is
 * well-formed SVG drawn inside its 16 × 16 box.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

const read = f => readFileSync(new URL("../" + f, import.meta.url), "utf8");
runInThisContext(read("icons.js"), { filename: "icons.js" });
const { Icons } = globalThis;
const PAGES = ["circuit_sandbox.html", "board.html", "oscilloscope.html", "spectrum_analyzer.html", "bode.html", "index.html"];

test("every data-ico on the pages names an icon", () => {
  let n = 0;
  for (const page of PAGES) {
    const html = read(page);
    for (const m of html.matchAll(/data-ico="([^"]+)"/g)) { n++; assert.ok(Icons.svg(m[1]), `${page}: no icon "${m[1]}"`); }
    if (/data-ico=/.test(html)) assert.match(html, /<script src="icons\.js/, `${page} uses data-ico without loading icons.js`);
  }
  assert.ok(n > 50, `only ${n} icons on the pages`);
});

test("the scripts' icons exist", () => {
  for (const m of read("cad-app.js").matchAll(/Object\.fromEntries\((\["rotate"[^\]]*\])/g)) for (const name of JSON.parse(m[1])) assert.ok(Icons.svg(name), name);
});

test("each icon is one svg of the house style, its numbers inside the box", () => {
  for (const name of Icons.names()) {
    const s = Icons.svg(name);
    assert.match(s, /^<svg class="ico" viewBox="0 0 16 16" aria-hidden="true">.*<\/svg>$/, name);
    assert.ok(!/fill="(?!none)/.test(s) && !/style=/.test(s), `${name}: drawn in the text colour only`);
    const opens = (s.match(/<(path|rect|circle)\b/g) || []).length, closes = (s.match(/\/>/g) || []).length;
    assert.equal(opens, closes, `${name}: every shape closed`);
    for (const v of s.replace(/^<svg[^>]*>/, "").match(/-?\d*\.?\d+/g) || []) assert.ok(Math.abs(+v) <= 16, `${name}: ${v} outside the box`);
  }
  assert.equal(Icons.svg("no-such-icon"), "");
});
