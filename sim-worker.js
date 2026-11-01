/* Runs the circuit engine off the UI thread; the CAD keeps one per processor core (sim-pool.js).
   Message in:  { seq, netlist, options }                      steady state (simulate)
                { seq, netlist, options, kind: "startup" }      power-on transient
                { seq, netlist, options, kind: "op" }           the operating point a frequency response is linearized at:
                                                                 a mains-fed circuit's averaged steady state ({ ok, op, opIm: transformers' magnetising currents })
                { seq, netlist, options, kind: "audio" }        the circuit playing a recording (audio: a source carries
                                                                 samples), from options.warm: { ok, rate, out: [Float32Array] }
                { seq, netlist, options, kind: "ac" }           frequency response (acSweep; options.op, and options.kFrom /
                                                                 kTo for a piece of the sweep, so several workers share it)
                { seq, netlist, options, kind: "loop" }         loop gain (loopGain; options.at, options.op)
                { seq, netlist, options, kind: "noise" }        noise at an output (noiseSweep; options.out, options.op)
   Message out: { seq, result }, and { seq, progress } (0…1) along the way; a startup run with
   options.partial also sends { seq, partial } (the engine's onPartial snapshots). */
importScripts("spice-model.js" + self.location.search, "sim-engine.js" + self.location.search);   // same ?v= as the page, so caches never mix versions

// the linear solver as WebAssembly (wasm/solver.ts); until it is in, or if it cannot load, the engine solves in JavaScript
const solverReady = fetch("sim-solver.wasm" + self.location.search).then(r => (r.ok ? r.arrayBuffer() : null))
  .then(b => (b ? TubeSimEngine.loadWasm(new Uint8Array(b)) : false)).catch(() => false);

self.onmessage = async (e) => {
  await solverReady;
  const { seq, netlist, options, kind } = e.data;
  const onProgress = f => self.postMessage({ seq, progress: f });
  let result;
  try {
    if (kind === "op") {
      const r = TubeSimEngine.simulate(netlist, Object.assign({}, options, { onProgress }));
      result = r.ok ? { ok: true, op: r.dc.nodes, opIm: TubeSimEngine.opMagnetising(r) } : { ok: false, error: r.error };
    } else if (kind === "ac") {
      const ac = TubeSimEngine.acSweep(netlist, options);
      result = ac.ok ? { ok: true, freqs: ac.freqs, probes: ac.probes, elapsedMs: ac.elapsedMs } : ac;
    } else if (kind === "loop") result = TubeSimEngine.loopGain(netlist, options);
    else if (kind === "noise") result = TubeSimEngine.noiseSweep(netlist, options);
    else if (kind === "audio") result = TubeSimEngine.audio(netlist, Object.assign({}, options, { onProgress }));
    else if (kind === "startup") result = TubeSimEngine.startup(netlist, Object.assign({}, options, { onProgress, onPartial: options.partial ? p => self.postMessage({ seq, partial: p }) : undefined }));
    else result = TubeSimEngine.simulate(netlist, Object.assign({}, options, { onProgress }));
  } catch (err) {
    result = { ok: false, error: "Engine error: " + (err && err.message ? err.message : err) };
  }
  const transfer = [];
  if (result.tran) {
    result.tran.nodes.forEach(a => transfer.push(a.buffer));
    Object.values(result.tran.devices).forEach(d => { transfer.push(d.i.buffer); if (d.ig2) transfer.push(d.ig2.buffer); });
  }
  if (result.out) result.out.forEach(a => transfer.push(a.buffer));
  if (result.min) { result.min.forEach(a => transfer.push(a.buffer)); result.max.forEach(a => transfer.push(a.buffer)); }
  if (result.probes && result.freqs) { transfer.push(result.freqs.buffer); result.probes.forEach(p => { transfer.push(p.re.buffer, p.im.buffer); }); }
  self.postMessage({ seq, result }, transfer);
};
