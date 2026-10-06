/* Runs the circuit engine off the UI thread. Message in: { seq, netlist }. */
importScripts("sim-engine.js" + self.location.search);   // same ?v= as the page, so caches never mix versions

self.onmessage = (e) => {
  const { seq, netlist, options } = e.data;
  let result;
  try {
    result = TubeSimEngine.simulate(netlist, options || {});
  } catch (err) {
    result = { ok: false, error: "Engine error: " + (err && err.message ? err.message : err) };
  }
  const transfer = [];
  if (result.tran) {
    result.tran.nodes.forEach(a => transfer.push(a.buffer));
    Object.values(result.tran.devices).forEach(d => { transfer.push(d.i.buffer); if (d.ig2) transfer.push(d.ig2.buffer); });
  }
  self.postMessage({ seq, result }, transfer);
};
