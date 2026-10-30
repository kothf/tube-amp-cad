/* Runs the Board window's heavy placement and routing steps (board-place.js, board-pathfinder.js) off the page, so the
   window keeps drawing and answering while Route & nudge thinks.
   Message in:  { seq, fn, board, model, conn, rats, netlist, hv, amps, opts }   fn: "exact", "bridge", "access", …
                (one message, so model.pads and conn.items keep sharing their pads)
   Message out: { seq, result } or { seq, error } */
const V = self.location.search;   // same ?v= as the page, so caches never mix versions
importScripts("tube-db.js" + V, "spice-model.js" + V, "sim-engine.js" + V, "cad-components.js" + V, "mpn.js" + V, "board-core.js" + V, "board-sat.js" + V, "board-place.js" + V, "board-pathfinder.js" + V);

const FNS = new Set(["exact", "bridge", "escape", "passage", "access", "smooth", "design", "pathfinder"]);
self.onmessage = e => {
  const { seq, fn, board, model, conn, rats, netlist, hv, amps, opts } = e.data;
  try {
    if (!FNS.has(fn)) throw new Error(`no step ${fn}`);
    const clr = BoardCore.clearanceRules(board, model, hv, netlist);
    const o = Object.assign({}, opts, { clr, hv, amps, netlist, conn });
    self.postMessage({ seq, result: fn === "pathfinder" ? BoardPathfinder.route(board, model, conn, o) : BoardPlace[fn](board, model, conn, rats, o) });
  } catch (err) {
    self.postMessage({ seq, error: String(err && err.message ? err.message : err) });
  }
};
