/* Runs the circuit engine off the UI thread.
   Message in:  { seq, netlist, options }                      steady state (simulate)
                { seq, netlist, options, kind: "startup" }      power-on transient
   Message out: { seq, result }, and { seq, progress } (0…1) along the way. */
importScripts("spice-model.js" + self.location.search, "sim-engine.js" + self.location.search);   // same ?v= as the page, so caches never mix versions

// the linear solver as WebAssembly (wasm/solver.ts); until it is in, or if it cannot load, the engine solves in JavaScript
const solverReady = fetch("sim-solver.wasm" + self.location.search).then(r => (r.ok ? r.arrayBuffer() : null))
  .then(b => (b ? TubeSimEngine.loadWasm(new Uint8Array(b)) : false)).catch(() => false);

self.onmessage = async (e) => {
  await solverReady;
  const { seq, netlist, options, kind } = e.data;
  let result;
  try {
    if (kind === "startup") result = TubeSimEngine.startup(netlist, Object.assign({}, options, { onProgress: f => self.postMessage({ seq, progress: f }) }));
    else result = TubeSimEngine.simulate(netlist, Object.assign({}, options, { onProgress: f => self.postMessage({ seq, progress: f }) }));
  } catch (err) {
    result = { ok: false, error: "Engine error: " + (err && err.message ? err.message : err) };
  }
  const transfer = [];
  if (result.tran) {
    result.tran.nodes.forEach(a => transfer.push(a.buffer));
    Object.values(result.tran.devices).forEach(d => { transfer.push(d.i.buffer); if (d.ig2) transfer.push(d.ig2.buffer); });
  }
  if (result.min) { result.min.forEach(a => transfer.push(a.buffer)); result.max.forEach(a => transfer.push(a.buffer)); }
  self.postMessage({ seq, result }, transfer);
};
