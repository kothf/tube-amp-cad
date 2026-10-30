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
  // the store holds 20 000 bytes here: a few designs fill it
  let full = false;
  for (const f of ["01-2n3904-ce-unbypassed.json", "02-2n3904-ce-bypassed.json", "03-12ax7-ccs-vs-resistor.json", "06-gubin-6n23p-6p14p.json", "07-gubin-5ts4s-stereo.json", "05-10w-mosfet-amplifier.json"]) {
    if ((await post(await CadShare.pack(example(f)))).status === 507) { full = true; break; }
  }
  assert.ok(full, "a full store refuses new designs");
});

test("unknown or malformed ids are 404", async () => {
  assert.equal((await fetch(`${base}/AAAAAAAAAA`)).status, 404);
  assert.equal((await fetch(`${base}/..%2F..%2Fetc`)).status, 404);
  assert.equal((await fetch(`${base}/health`)).status, 200);
});
