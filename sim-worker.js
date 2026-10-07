/* Runs the circuit engine off the UI thread.
   Message in:  { seq, netlist, options }                      steady state (simulate)
                { seq, netlist, options, kind: "startup" }      power-on transient
   Message out: { seq, result }, and for a transient also { seq, progress } along the way. */
importScripts("sim-engine.js" + self.location.search);   // same ?v= as the page, so caches never mix versions

self.onmessage = (e) => {
  const { seq, netlist, options, kind } = e.data;
  let result;
  try {
    if (kind === "startup") result = TubeSimEngine.startup(netlist, Object.assign({}, options, { onProgress: f => self.postMessage({ seq, progress: f }) }));
    else result = TubeSimEngine.simulate(netlist, options || {});
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
