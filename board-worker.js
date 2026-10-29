/* Runs the Board window's heavy placement and routing steps (board-place.js) off the page, so the
   window keeps drawing and answering while Route & nudge thinks.
   Message in:  { seq, fn, board, model, conn, rats, netlist, hv, amps, opts }   fn: "exact", "bridge", "access", …
                (one message, so model.pads and conn.items keep sharing their pads)
   Message out: { seq, result } or { seq, error } */
const V = self.location.search;   // same ?v= as the page, so caches never mix versions
importScripts("tube-db.js" + V, "spice-model.js" + V, "sim-engine.js" + V, "cad-components.js" + V, "mpn-data.js" + V, "mpn.js" + V, "board-core.js" + V, "board-sat.js" + V, "board-place.js" + V);

const FNS = new Set(["exact", "bridge", "escape", "passage", "access"]);
self.onmessage = e => {
  const { seq, fn, board, model, conn, rats, netlist, hv, amps, opts } = e.data;
  try {
    if (!FNS.has(fn)) throw new Error(`no step ${fn}`);
    const clr = BoardCore.clearanceRules(board, model, hv, netlist);
    self.postMessage({ seq, result: BoardPlace[fn](board, model, conn, rats, Object.assign({}, opts, { clr, hv, amps, netlist, conn })) });
  } catch (err) {
    self.postMessage({ seq, error: String(err && err.message ? err.message : err) });
  }
};
