/**
 * The engine's worker pool (sim-pool.js), with a stand-in Worker that answers from the engine on a
 * timer: one job per worker, jobs beyond the pool wait, urgent jobs start at once, high ones go first,
 * cancel stops a job and frees its core; and a sweep in pieces (acSweep kFrom / kTo) is the whole sweep.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "sim-pool.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const { SimPool, TubeSimEngine: E } = globalThis;

// a worker that answers each message with { seq, result: { ok, n } } after msg.ms, or never (ms < 0)
let alive = 0, made = 0;
class FakeWorker {
  constructor() { alive++; made++; this.dead = false; }
  postMessage(m) {
    if (m.ms < 0) return;
    this.onmessage && setTimeout(() => { if (!this.dead && this.onmessage) { this.onmessage({ data: { seq: m.seq, progress: 0.5 } }); this.onmessage({ data: { seq: m.seq, result: { ok: true, n: m.n } } }); } }, m.ms);
  }
  terminate() { if (!this.dead) { this.dead = true; alive--; } }
}
globalThis.Worker = FakeWorker;
const wait = ms => new Promise(r => setTimeout(r, ms));

test("one job per worker; the rest wait for a free one and all finish", async () => {
  const pool = SimPool("w.js", 3), got = [], progress = [];
  assert.equal(pool.size, 3); assert.ok(pool.ok);
  for (let n = 0; n < 8; n++) pool.run({ n, ms: 10 }, { onResult: r => got.push(r.n), onProgress: f => progress.push(f) });
  assert.equal(pool.busy(), 3); assert.equal(pool.queued(), 5);
  await wait(120);
  assert.deepEqual(got.slice().sort((a, b) => a - b), [0, 1, 2, 3, 4, 5, 6, 7]);
  assert.equal(progress.length, 8);
  assert.equal(pool.busy(), 0);
  assert.ok(alive <= 3, `idle workers kept up to the pool's size (${alive})`);
});

test("urgent jobs start beside a full pool; high ones go ahead of the queue", async () => {
  const pool = SimPool("w.js", 2), order = [];
  for (let n = 0; n < 4; n++) pool.run({ n, ms: 20 }, { onResult: r => order.push(r.n) });
  pool.run({ n: "high", ms: 5 }, { high: true, onResult: r => order.push(r.n) });
  pool.run({ n: "urgent", ms: 5 }, { urgent: true, onResult: r => order.push(r.n) });
  assert.equal(pool.busy(), 3);
  await wait(150);
  assert.equal(order[0], "urgent");
  assert.ok(order.indexOf("high") < order.indexOf(2), order.join());
  assert.equal(order.length, 6);
});

test("cancel: a queued job never runs, a running one stops and frees its core", async () => {
  const pool = SimPool("w.js", 1), got = [];
  const a = pool.run({ n: "a", ms: -1 }, { onResult: r => got.push(r.n) });
  const b = pool.run({ n: "b", ms: 5 }, { onResult: r => got.push(r.n) });
  const c = pool.run({ n: "c", ms: 5 }, { onResult: r => got.push(r.n) });
  b.cancel();
  assert.equal(pool.queued(), 1);
  a.cancel();   // never answers: terminated, and c takes the core
  await wait(60);
  assert.deepEqual(got, ["c"]);
  c.cancel();   // already done: nothing happens
});

test("without Worker the pool says so", () => {
  const W = globalThis.Worker; delete globalThis.Worker;
  try { assert.equal(SimPool("w.js", 2).ok, false); } finally { globalThis.Worker = W; }
  assert.ok(SimPool.cores() >= 1);
});

test("a sweep in pieces is the whole sweep, point for point", () => {
  const nl = { nodeCount: 4, elements: [{ id: "G", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 1 }, { id: "R", kind: "R", nodes: [1, 2], r: 1000 },
    { id: "L", kind: "L", nodes: [2, 3], l: 0.1 }, { id: "C", kind: "C", nodes: [3, 0], c: 1e-7 }] };
  const o = { inputs: [{ id: "G", mag: 1 }], probes: [[3, 0]], fStart: 1, fStop: 1e6, perDecade: 40 };
  const K = E.acPoints(o), whole = E.acSweep(nl, o);
  assert.equal(K, 241); assert.equal(whole.freqs.length, K);
  const cuts = [0, 50, 51, 170, K], freqs = [], re = [];
  for (let i = 0; i + 1 < cuts.length; i++) { const p = E.acSweep(nl, Object.assign({}, o, { kFrom: cuts[i], kTo: cuts[i + 1] })); freqs.push(...p.freqs); re.push(...p.probes[0].re); }
  assert.deepEqual(freqs, Array.from(whole.freqs));
  assert.deepEqual(re, Array.from(whole.probes[0].re));
});
