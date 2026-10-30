/**
 * The Russian interface: every hover hint has its Russian twin, the dictionary has no key twice,
 * and the patterns turn the numbers of the instruments and the board into Russian.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const src = f => readFileSync(new URL("../" + f, import.meta.url), "utf8");
const win = { document: undefined };
win.window = win;
for (const f of ["hints.js", "i18n-ru.js", "i18n-hints-ru.js"]) runInNewContext(src(f), { window: win, setTimeout, console }, { filename: f });
const { Hints, I18N_RU, I18N_HINTS_RU } = win;

test("every hint of hints.js has a Russian one, by the same key", () => {
  for (const cat of ["parts", "fields", "labels"]) {
    const missing = Object.keys(Hints[cat]).filter(k => !I18N_HINTS_RU[cat][k]);
    assert.deepEqual(missing, [], `${cat} without Russian`);
    const stray = Object.keys(I18N_HINTS_RU[cat]).filter(k => !(k in Hints[cat]));
    assert.deepEqual(stray, [], `${cat} in Russian that hints.js no longer has`);
  }
});

test("a formula line of a hint stays a formula line in Russian", () => {
  for (const cat of ["fields", "labels"])
    for (const [k, en] of Object.entries(Hints[cat])) {
      const f = l => l.split("\n").filter(x => x.startsWith("= ")).length;
      assert.equal(f(I18N_HINTS_RU[cat][k]), f(en), `${cat} ${k}`);
    }
});

test("the dictionary has no English text twice", () => {
  const keys = [...src("i18n-ru.js").matchAll(/^ {4}("(?:[^"\\]|\\.)*"): "/gm)].map(m => JSON.parse(m[1]));
  const seen = new Set(), twice = keys.filter(k => seen.has(k) || !seen.add(k));
  assert.deepEqual(twice, []);
  assert.ok(Object.keys(I18N_RU.text).length > 1500);
});

test("numbers of the instruments and the board", () => {
  const ru = t => { for (const [re, to] of I18N_RU.patterns) if (to && re.test(t)) return t.replace(re, to); return null; };
  assert.equal(ru("500µs/div"), "500 мкс/дел");
  assert.equal(ru("20mV/div"), "20 мВ/дел");
  assert.equal(ru("THD 0.304 %"), "КНИ 0.304 %");
  assert.equal(ru("0 – 20 kHz"), "0 – 20 кГц");
  assert.equal(ru("4 pads, 93.8 mm of track, 5.10 mA DC"), "площадок: 4, дорожек 93.8 мм, 5.10 мА пост.");
  assert.equal(ru("15 placed of 15"), "поставлено 15 из 15");
  assert.equal(ru("Tube socket, Noval (B9A), top view"), "Ламповая панель, новал (B9A), вид сверху");
  assert.equal(ru("Axial, 10.16 mm lead spacing"), "Аксиальный, шаг выводов 10.16 мм");
});
