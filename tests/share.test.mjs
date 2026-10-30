/**
 * Share by link (cad-share.js): a design packed into the address and unpacked again, unchanged.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { runInThisContext } from "node:vm";

runInThisContext(readFileSync(new URL("../cad-share.js", import.meta.url), "utf8"), { filename: "cad-share.js" });
const { CadShare: Sh } = globalThis;
const dir = new URL("../examples/", import.meta.url);

test("every example, board included, comes back unchanged from a link of at most 16 000 characters", async () => {
  for (const f of readdirSync(dir).filter(n => n.endsWith(".json"))) {
    const d = JSON.parse(readFileSync(new URL(f, dir), "utf8"));
    const url = Sh.link("https://aerocat.tech/tools/tube-curve-tracer/circuit_sandbox.html#old", await Sh.pack(d));
    assert.match(url, /^https:\/\/aerocat\.tech\/tools\/tube-curve-tracer\/circuit_sandbox\.html#c=[A-Za-z0-9_-]+$/, f);
    assert.ok(url.length < 16000, `${f}: ${url.length} characters`);
    assert.deepEqual(await Sh.unpack(Sh.fromHash(url.slice(url.indexOf("#")))), d, f);
  }
});

test("links from 3.135.0, which carry the file's form, still open", async () => {
  const d = JSON.parse(readFileSync(new URL("08-555-astable.json", dir), "utf8"));
  const old = Buffer.from(await new Response(new Blob([JSON.stringify(d)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()).toString("base64url");
  assert.deepEqual(await Sh.unpack(old), d);
  const nb = { app: d.app, version: d.version, comps: d.comps, wires: d.wires }, oldNb = Buffer.from(await new Response(new Blob([JSON.stringify(nb)]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer()).toString("base64url");
  assert.ok((await Sh.pack(nb)).length < oldNb.length * 0.95, "the link's own form is shorter");
});

test("fromHash: the packed text after c=, alone or among other pairs; null without it", () => {
  assert.equal(Sh.fromHash("#c=abc-_"), "abc-_");
  assert.equal(Sh.fromHash("#x=1&c=abc"), "abc");
  assert.equal(Sh.fromHash("#board"), null);
  assert.equal(Sh.fromHash(""), null);
  assert.equal(Sh.fromHash("#c="), null);
});

test("a damaged or cut-short link is an error, not a broken circuit", async () => {
  const packed = await Sh.pack({ app: "TubeAmpCAD", version: 2, comps: [{ id: "r1", type: "resistor", params: { r: 1000 } }], wires: [] });
  await assert.rejects(Sh.unpack(packed.slice(0, packed.length >> 1)), /damaged|cut short|JSON/);
  await assert.rejects(Sh.unpack("!!!"), /damaged/);
});
