/**
 * The short-link store (server/share/server.mjs): what it keeps, what it refuses, how it answers.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInThisContext } from "node:vm";

const dir = mkdtempSync(join(tmpdir(), "share-"));
process.env.DATA = dir; process.env.MAX_TOTAL = "20000";
const { start, idOf } = await import("../server/share/server.mjs");
runInThisContext(readFileSync(new URL("../cad-share.js", import.meta.url), "utf8"), { filename: "cad-share.js" });
const server = await start({ port: 0, log: () => {} });
const base = `http://127.0.0.1:${server.address().port}/api/share`;
after(() => { server.close(); rmSync(dir, { recursive: true, force: true }); });

const example = f => JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url), "utf8"));
const post = (body, origin = "https://aerocat.tech") => fetch(base, { method: "POST", body, headers: origin ? { origin } : {} });

test("a design is stored once under the start of its SHA-256 and read back as it was", async () => {
  const text = await CadShare.pack(example("08-555-astable.json"));
  const r = await post(text);
  assert.equal(r.status, 201);
  const { id } = await r.json();
  assert.equal(id, idOf(text)); assert.match(id, /^[A-Za-z0-9_-]{10}$/);
  const again = await post(text);
  assert.equal(again.status, 200, "the same design again: the same id, nothing new written");
  assert.equal((await again.json()).id, id);
  const g = await fetch(`${base}/${id}`);
  assert.equal(g.status, 200);
  assert.equal(g.headers.get("access-control-allow-origin"), "*");
  assert.match(g.headers.get("cache-control"), /immutable/);
  assert.deepEqual(await CadShare.unpack(await g.text()), await CadShare.unpack(text));
});

test("only Tube Amp CAD designs, only from the site, only up to the limits", async () => {
  const z = async o => Buffer.from(await new Response(new Blob([JSON.stringify(o)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()).toString("base64url");
  assert.equal((await post("hello world")).status, 400, "not base64url");
  assert.equal((await post(await z({ any: "json" }))).status, 400, "not a design");
  assert.equal((await post("AAAA")).status, 400, "does not unpack");
  const ok = await CadShare.pack(example("12-555-simplest-oscillator.json"));
  assert.equal((await post(ok, "https://evil.example")).status, 403, "another site's page may not store");
  assert.equal((await post(ok, null)).status < 300, true, "a client without Origin (curl) may");
  assert.equal((await post("A".repeat(200 * 1024))).status, 413);
});

test("unknown or malformed ids are 404", async () => {
  assert.equal((await fetch(`${base}/AAAAAAAAAA`)).status, 404);
  assert.equal((await fetch(`${base}/..%2F..%2Fetc`)).status, 404);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});

test("past its size the store deletes the designs shared longest ago, a design shared again counting as new", async () => {
  // the store's order, oldest first, played alongside: [id, size]
  const order = [], MAX = 20000;
  // what the tests above left, oldest first: the 555 astable, then the simplest oscillator
  for (const f of ["08-555-astable.json", "12-555-simplest-oscillator.json"]) { const t = await CadShare.pack(example(f)); order.push([idOf(t), t.length]); }
  assert.equal((await (await fetch(`${base}/health`)).json()).bytes, order.reduce((n, e) => n + e[1], 0));
  const share = async f => {
    const t = await CadShare.pack(example(f)), r = await post(t);
    assert.ok(r.status < 300, f);
    const id = (await r.json()).id, k = order.findIndex(e => e[0] === id);
    if (k >= 0) order.splice(k, 1);
    else while (order.reduce((n, e) => n + e[1], 0) + t.length > MAX) order.shift();
    order.push([id, t.length]);
    return id;
  };
  const files = ["01-2n3904-ce-unbypassed.json", "02-2n3904-ce-bypassed.json", "03-12ax7-ccs-vs-resistor.json", "04-12ax7-irf820-follower.json", "05-10w-mosfet-amplifier.json", "06-gubin-6n23p-6p14p.json", "07-gubin-5ts4s-stereo.json", "09-555-flashing-led.json", "10-555-metronome.json"];
  const first = [];
  for (const f of files) first.push(await share(f));
  await new Promise(r => setTimeout(r, 20));
  await share(files.find((f, i) => order.some(e => e[0] === first[i])));   // the oldest still kept, shared again
  for (const f of ["01-2n3904-ce-unbypassed.json", "02-2n3904-ce-bypassed.json", "03-12ax7-ccs-vs-resistor.json"]) await share(f);
  const h = await (await fetch(`${base}/health`)).json();
  assert.ok(h.bytes <= MAX, `the store stays within its size (${h.bytes} bytes)`);
  const kept = new Set(order.map(e => e[0]));
  for (const id of new Set(first)) assert.equal((await fetch(`${base}/${id}`)).status, kept.has(id) ? 200 : 404, `${id} ${kept.has(id) ? "kept" : "deleted"}, oldest first`);
  assert.ok(kept.size < new Set(first).size, "some were deleted");
  assert.equal(h.designs, kept.size);
  // a fresh start reads what is on disk, oldest first, with the same total
  server.close();
  const again = await start({ port: 0, log: () => {} });
  const h2 = await (await fetch(`http://127.0.0.1:${again.address().port}/api/share/health`)).json();
  again.close();
  assert.equal(h2.bytes, h.bytes); assert.equal(h2.designs, h.designs);
});
