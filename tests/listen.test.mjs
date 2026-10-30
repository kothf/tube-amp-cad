/**
 * Listen (cad-listen.js) and the engine's audio(): a recording played through a circuit, the
 * pieces a clip is cut into for the cores, and joining them again.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInThisContext } from "node:vm";

for (const f of ["tube-db.js", "sim-engine.js", "cad-listen.js"]) runInThisContext(readFileSync(new URL(`../${f}`, import.meta.url), "utf8"), { filename: f });
const { CadListen: L, TubeSimEngine: E } = globalThis;
const RATE = L.RATE;

test("audio: a recording through an RC low-pass follows the filter", () => {
  // 1 kHz into R = 1k, C = 159 nF (corner 1 kHz): 3 dB down and 45° behind
  const n = RATE / 10, s = new Float32Array(n);
  for (let i = 0; i < n; i++) s[i] = Math.sin(2 * Math.PI * 1000 * i / RATE);
  const net = { nodeCount: 3, elements: [
    { id: "G1", kind: "VSRC", nodes: [1, 0], wave: "sine", freq: 1000, amp: 2, samples: s, rate: RATE },
    { id: "R1", kind: "R", nodes: [1, 2], r: 1000 }, { id: "C1", kind: "C", nodes: [2, 0], c: 1 / (2 * Math.PI * 1000 * 1000) }
  ] };
  const r = E.audio(net, { rate: RATE, sub: 2, seconds: n / RATE, probes: [[2, 0], [1, 0]] });
  assert.ok(r.ok, r.error);
  const half = a => a.subarray(n / 2);
  const rms = a => Math.sqrt(half(a).reduce((q, v) => q + v * v, 0) / (n / 2));
  assert.ok(Math.abs(rms(r.out[1]) - Math.SQRT2) < 1e-3, `the source plays its samples times amp (${rms(r.out[1])})`);
  assert.ok(Math.abs(rms(r.out[0]) / rms(r.out[1]) - Math.SQRT1_2) < 0.01, `the filter's −3 dB at its corner (${rms(r.out[0]) / rms(r.out[1])})`);
});

test("audio: silent after the recording ends", () => {
  const net = { nodeCount: 2, elements: [{ id: "G1", kind: "VSRC", nodes: [1, 0], amp: 1, freq: 1, samples: new Float32Array([1, 1, 1, 1]), rate: RATE }, { id: "R1", kind: "R", nodes: [1, 0], r: 1e3 }] };
  const r = E.audio(net, { rate: RATE, sub: 1, seconds: 10 / RATE, probes: [[1, 0]] });
  assert.equal(r.out[0][1], 1); assert.equal(r.out[0][9], 0);
});

test("pieces: cover the clip once, on whole mains periods, with the lead-in before each", () => {
  const total = 5 * RATE + 123, ps = L.pieces(total, 4, RATE / 50, 0.4 * RATE, 960);
  assert.equal(ps.length, 4);
  assert.equal(ps[0].from, 0); assert.equal(ps[ps.length - 1].to, total);
  ps.forEach((p, j) => {
    if (j) assert.equal(p.from, ps[j - 1].to);
    assert.equal(p.start % (RATE / 50), 0, "starts on a mains period");
    assert.ok(p.start <= p.from && (j === 0 || p.from - p.start >= 0.4 * RATE));
  });
  assert.equal(L.pieces(RATE / 4, 8, 1, 0.4 * RATE, 960).length, 1, "a short clip stays one piece");
});

test("stitch: pieces of one signal join back into it", () => {
  const total = RATE, sig = Float32Array.from({ length: total }, (_, i) => Math.sin(i / 37)), fade = 960;
  const ps = L.pieces(total, 3, 1, 0.1 * RATE, fade);
  const parts = ps.map((p, j) => sig.slice(p.start, Math.min(total, p.to + (j < ps.length - 1 ? fade : 0))));
  const out = L.stitch(ps, parts, total, fade);
  assert.ok(out.every((v, i) => Math.abs(v - sig[i]) < 1e-6));
});

test("highpass takes the DC off and keeps the audio", () => {
  const a = Float32Array.from({ length: RATE }, (_, i) => 5 + Math.sin(2 * Math.PI * 440 * i / RATE)), y = L.highpass(a, RATE, 3);
  const tail = y.subarray(RATE / 2), m = tail.reduce((s, v) => s + v, 0) / tail.length;
  assert.ok(Math.abs(m) < 0.01, `mean ${m}`);
  assert.ok(Math.abs(Math.max(...tail) - 1) < 0.01);
});

test("wav: a 16-bit PCM file of the channels", () => {
  const buf = L.wav([new Float32Array([0, 0.5, -1]), new Float32Array([1, 0, 0])], RATE, 1), v = new DataView(buf);
  assert.equal(String.fromCharCode(...new Uint8Array(buf, 0, 4)), "RIFF");
  assert.equal(v.getUint16(22, true), 2); assert.equal(v.getUint32(24, true), RATE); assert.equal(buf.byteLength, 44 + 3 * 2 * 2);
  assert.equal(v.getInt16(44 + 2, true), 32767); assert.equal(v.getInt16(44 + 4, true), Math.round(0.5 * 32767)); assert.equal(v.getInt16(44 + 8, true), -32767);
});

test("the riff made here is the same every time, peaking at 1", () => {
  const a = L.riff(2), b = L.riff(2);
  assert.deepEqual(a, b);
  assert.ok(Math.abs(Math.max(...a.map(Math.abs)) - 1) < 1e-6);
});

test("radio: grab reads just enough of an endless stream, then lets it go", async () => {
  // an endless "stream" in 4 kB chunks; 2 s at 128 kbps is 32 kB (+10 % and 16 kB to spare)
  let pulled = 0, cancelled = false;
  const body = new ReadableStream({ pull(c) { pulled++; c.enqueue(new Uint8Array(4096).fill(pulled & 255)); }, cancel() { cancelled = true; } });
  const fetchFn = async () => ({ ok: true, status: 200, body });
  const seen = [];
  const b = await L.grab("https://example/stream", 128, 2, undefined, n => seen.push(n), fetchFn);
  const want = Math.round(2 * 128 * 125 * 1.1) + 16384;
  assert.ok(b.length >= want && b.length < want + 4096, `${b.length} bytes for ${want}`);
  assert.ok(cancelled, "the stream is cancelled once there is enough");
  assert.equal(seen[seen.length - 1], b.length);
  assert.equal(b[0], 1); assert.equal(b[4096], 2);
  await assert.rejects(L.grab("u", 128, 1, undefined, null, async () => ({ ok: false, status: 503 })), /503/);
  assert.ok(L.RADIO.streams.every(s => /^https:\/\//.test(s.url) && s.kbps > 0));
});
