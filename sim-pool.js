/* SimPool: the engine's workers (sim-worker.js), one per processor core, shared by every calculation
   of the CAD: the live and full simulations, the power-on transient, the Bode sweep and the tolerance
   runs. A finished worker stays loaded (engine and WebAssembly solver) for the next job, so a job
   starts at once instead of spawning a worker of its own. Independent jobs run side by side on
   different cores: tolerance runs fill every core, a Bode sweep is cut into pieces of its frequency
   range that run at the same time.
     pool.run(msg, { onResult, onProgress, urgent, high }) → { cancel() }
   msg is sim-worker.js's message ({ netlist, options, kind }); onResult(result) once, onProgress(f) along
   the way. An urgent job (what the user is waiting to see) starts at once even with every core busy,
   on a worker beyond the pool's size that is dropped when it is done; a high job goes ahead of the
   queued ones; the rest (tolerance runs) wait for a free core. cancel() drops a queued job or stops
   a running one (its worker is terminated). pool.ok is false where no worker can start (the callers
   then run the engine on the page). */
(function (root) {
  "use strict";
  // every logical core the browser reports; 4 where it does not say
  const cores = () => Math.max(1, Math.min(64, (typeof navigator !== "undefined" && navigator.hardwareConcurrency) || 4));

  function SimPool(url, size) {
    const N = size || cores();
    const idle = [], running = new Set(), queue = [];
    let seq = 0;
    const pool = { size: N, ok: typeof Worker !== "undefined", run, busy: () => running.size, queued: () => queue.length };

    function spawn() {
      try { return new Worker(url); } catch (e) { pool.ok = false; return null; }
    }
    // one loaded at once, for the first simulation; the others as jobs need them
    if (pool.ok) { const w = spawn(); if (w) idle.push(w); }
    function release(w) {
      w.onmessage = w.onerror = null;
      if (idle.length + running.size < N) idle.push(w); else w.terminate();
    }
    function start(job) {
      const w = idle.pop() || spawn();
      if (!w) { job.onResult({ ok: false, error: "Could not start a simulation worker" }); return false; }
      job.worker = w; running.add(job);
      w.onmessage = e => {
        const d = e.data;
        if (d.seq !== job.seq) return;
        if (d.result !== undefined) { running.delete(job); job.worker = null; release(w); pump(); job.onResult(d.result); }
        else if (job.onProgress) job.onProgress(d.progress);
      };
      w.onerror = e => {
        if (e && e.preventDefault) e.preventDefault();
        running.delete(job); job.worker = null; w.terminate(); pump();
        job.onResult({ ok: false, error: "Engine error: " + ((e && e.message) || "the worker stopped") });
      };
      w.postMessage(Object.assign({}, job.msg, { seq: job.seq }));
      return true;
    }
    function pump() {
      while (queue.length && running.size < N) start(queue.shift());
    }
    function run(msg, o) {
      o = o || {};
      const job = { seq: ++seq, msg, onResult: o.onResult || (() => {}), onProgress: o.onProgress, worker: null, done: false };
      const result = job.onResult;
      job.onResult = r => { if (!job.done) { job.done = true; result(r); } };
      if (o.urgent || running.size < N) start(job);
      else if (o.high) { const i = queue.findIndex(j => !j.high); job.high = true; queue.splice(i < 0 ? queue.length : i, 0, job); }
      else queue.push(job);
      return {
        cancel() {
          if (job.done) return;
          job.done = true;
          const i = queue.indexOf(job);
          if (i >= 0) queue.splice(i, 1);
          if (job.worker) { job.worker.onmessage = job.worker.onerror = null; job.worker.terminate(); running.delete(job); job.worker = null; pump(); }
        }
      };
    }
    return pool;
  }
  SimPool.cores = cores;
  root.SimPool = SimPool;
})(typeof window !== "undefined" ? window : globalThis);
