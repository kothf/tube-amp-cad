/* Listen, the Listen tab under the schematic: the circuit playing a recording, heard through the
   computer's speakers. The recording is a WAV or MP3 file, the generator's own tone or a guitar
   riff made here; it drives every signal generator (a stereo file: its left channel the first
   generator, its right the second), and the output is a speaker's voltage (two speakers: stereo) or
   a scope channel. The circuit first settles with its generators silent; then the clip is cut into
   pieces, one per core, each played from that settled state with a lead-in of the clip before it
   (so its coupling capacitors and supply have caught up) and joined to the next with a short
   crossfade. With the mains in the circuit the pieces start on whole mains periods, so the hum runs
   on in phase. Input and output play together, and A/B switches between them as they play. */
(function (root) {
  "use strict";
  const RATE = 48000;
  // The pieces of a clip of total samples for n cores: [{ from, to, start }], each kept from
  // `from` to `to`, simulated from `start` (pre samples before, the clip's start for the first) to
  // to + fade (the crossfade into the next). Boundaries fall on multiples of align (a mains period).
  function pieces(total, n, align, pre, fade) {
    align = Math.max(1, Math.round(align) || 1);
    const k = Math.max(1, Math.min(n, Math.floor(total / Math.max(pre, RATE / 2)) || 1)), out = [];
    let from = 0;
    for (let i = 0; i < k; i++) {
      let to = i === k - 1 ? total : Math.round(total * (i + 1) / k / align) * align;
      to = Math.min(total, Math.max(to, from + align));
      if (to <= from) break;
      out.push({ from, to, start: Math.max(0, from - Math.ceil(pre / align) * align) });
      from = to;
      if (from >= total) break;
    }
    return out;
  }
  // the pieces' outputs joined: part j holds samples start…to + fade of piece j; across the first
  // `fade` samples of a piece it blends in (raised cosine) as the one before it blends out
  function stitch(ps, parts, total, fade) {
    const out = new Float32Array(total);
    ps.forEach((p, j) => {
      const a = parts[j];
      for (let s = p.from; s < Math.min(p.to + (j < ps.length - 1 ? fade : 0), total); s++) {
        const v = a[s - p.start] || 0;
        // past p.to this piece writes the tail that the next one blends into
        if (j > 0 && s < p.from + fade) { const w = 0.5 - 0.5 * Math.cos(Math.PI * (s - p.from) / fade); out[s] = out[s] * (1 - w) + v * w; }
        else out[s] = v;
      }
    });
    return out;
  }
  // a first-order high-pass at fc (Hz): the output's DC (a coupling the circuit does not have) taken off
  function highpass(a, rate, fc) {
    const out = new Float32Array(a.length), r = 1 / (1 + 2 * Math.PI * fc / rate);
    let y = 0, x0 = a.length ? a[0] : 0;
    for (let i = 0; i < a.length; i++) { y = r * (y + a[i] - x0); x0 = a[i]; out[i] = y; }
    return out;
  }
  const peakOf = chs => chs.reduce((m, a) => { for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i])); return m; }, 0);
  const rmsOf = chs => { let s = 0, n = 0; chs.forEach(a => { for (let i = 0; i < a.length; i++) s += a[i] * a[i]; n += a.length; }); return n ? Math.sqrt(s / n) : 0; };
  // 16-bit PCM WAV of channels at rate, scaled by k (clipped at full scale)
  function wav(chs, rate, k) {
    const n = chs[0].length, c = chs.length, buf = new ArrayBuffer(44 + n * c * 2), v = new DataView(buf);
    const str = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    str(0, "RIFF"); v.setUint32(4, 36 + n * c * 2, true); str(8, "WAVE"); str(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, c, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate * c * 2, true); v.setUint16(32, c * 2, true); v.setUint16(34, 16, true); str(36, "data"); v.setUint32(40, n * c * 2, true);
    let o = 44;
    for (let i = 0; i < n; i++) for (let j = 0; j < c; j++) { v.setInt16(o, Math.round(Math.max(-1, Math.min(1, chs[j][i] * k)) * 32767), true); o += 2; }
    return buf;
  }
  // a test tone: the generator's waveform at its frequency, with 20 ms fades
  function tone(wave, freq, seconds) {
    const n = Math.round(seconds * RATE), a = new Float32Array(n), f = Math.max(freq, 1), ramp = 0.02 * RATE;
    for (let i = 0; i < n; i++) {
      const ph = 2 * Math.PI * f * i / RATE;
      let s = wave === "square" ? Math.max(-1, Math.min(1, 50 * (2 / Math.PI) * Math.asin(Math.sin(ph)))) : wave === "triangle" ? (2 / Math.PI) * Math.asin(Math.sin(ph)) : Math.sin(ph);
      s *= Math.min(1, i / ramp, (n - 1 - i) / ramp);
      a[i] = s;
    }
    return a;
  }
  // a guitar riff made here: plucked strings (Karplus–Strong), an E5 power chord, single notes and
  // an open A chord, as a pickup would give it, seeded so it is the same every time
  function riff(seconds) {
    const n = Math.round(seconds * RATE), a = new Float32Array(n);
    let seed = 7; const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647 * 2 - 1; };
    const pluck = (t, f, amp, len) => {
      const p = Math.round(RATE / f), buf = new Float32Array(p);
      for (let i = 0; i < p; i++) buf[i] = rnd();
      const i0 = Math.round(t * RATE), m = Math.min(n - i0, Math.round(len * RATE));
      let prev = 0;
      for (let i = 0; i < m; i++) {
        const k = i % p, v = buf[k];
        buf[k] = 0.4985 * (v + prev); prev = v;
        a[i0 + i] += amp * v * Math.min(1, (m - i) / (0.03 * RATE));
      }
    };
    const E2 = 82.41, B2 = 123.47, E3 = 164.81, G3 = 196, A2 = 110, Cs4 = 277.18, A3 = 220, E4 = 329.63;
    const chord = (t, fs, len) => fs.forEach((f, i) => pluck(t + i * 0.012, f, 0.5, len));
    const bar = 2;
    for (let b = 0; b * bar < seconds; b++) {
      const t = b * bar;
      chord(t, [E2, B2, E3], 0.9); chord(t + 0.5, [E2, B2, E3], 0.4); pluck(t + 1, G3, 0.7, 0.3); pluck(t + 1.25, A3, 0.7, 0.3);
      chord(t + 1.5, [A2, E3, A3, Cs4, E4], 0.5);
    }
    const pk = peakOf([a]) || 1;
    for (let i = 0; i < n; i++) a[i] /= pk;
    return a;
  }

  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadListen(cad) {
    const { S, buildNetlist, cmds, desig, esc, fmtEng, pool, setStatus, topo } = cad;
    const KEY = "tubecad_listen";
    const opts = { src: "riff", from: 0, len: 6, level: 0, out: "", loop: true, match: true, volume: 0.7 };
    try { Object.assign(opts, JSON.parse(localStorage.getItem(KEY)) || {}); } catch (e) {}
    const save = () => { try { localStorage.setItem(KEY, JSON.stringify(opts)); } catch (e) {} };
    // file: the decoded recording { name, chs, seconds }; job: the render under way; take: the last
    // render { inp: [ch], out: [ch], peak (V), label, seconds, ms }; ab: which one is heard
    const L = S.listen = { seq: 0, file: null, job: null, take: null, error: null, stale: false, ab: "out", playing: false, opts };
    let jobs = [], ac = null, play = null;
    const SOURCES = { siggen: "amp", pickup: "amp", phono: "mv" };
    const sources = () => S.comps.filter(c => SOURCES[c.type]);
    const RUN = { budgetMs: 120000, maxPeriods: 20000 };

    // what can be heard: each speaker, two speakers as stereo, each scope channel
    function outputs() {
      const T = topo(), out = [], sp = S.comps.filter(c => c.type === "speaker");
      const net = (c, p) => T.pinNet.get(c.id + ":" + p);
      if (sp.length >= 2) out.push({ id: "stereo", label: `${desig(sp[0])} + ${desig(sp[1])} (stereo)`, probes: [[net(sp[0], "+"), net(sp[0], "-")], [net(sp[1], "+"), net(sp[1], "-")]] });
      sp.forEach(c => out.push({ id: c.id, label: `${desig(c) || c.id} speaker`, probes: [[net(c, "+"), net(c, "-")]] }));
      S.comps.filter(c => c.type === "scope").forEach(c => ["CH1", "CH2"].forEach(ch => out.push({ id: c.id + ":" + ch, label: `${desig(c) || c.id} ${ch}`, probes: [[net(c, ch), net(c, "COM")]] })));
      return out.filter(o => o.probes.every(([a, b]) => a !== undefined && b !== undefined && a !== b));
    }
    const pick = () => { const o = outputs(); return o.find(x => x.id === opts.out) || o[0] || null; };
    // the clip, normalised to a peak of 1: [ch] at RATE
    function clip() {
      if (opts.src === "file") {
        if (!L.file) return null;
        const a = Math.max(0, Math.round(opts.from * RATE)), b = Math.min(L.file.chs[0].length, a + Math.round(opts.len * RATE));
        if (b - a < RATE / 20) return null;
        const chs = L.file.chs.map(c => c.slice(a, b)), pk = peakOf(chs) || 1;
        chs.forEach(c => { for (let i = 0; i < c.length; i++) c[i] /= pk; });
        return chs;
      }
      if (opts.src === "tone") { const g = sources()[0], p = g ? g.params : {}; return [tone(p.wave || "sine", +p.freq || 1000, Math.min(opts.len, 10))]; }
      return [riff(Math.min(opts.len, 30))];
    }
    const srcName = () => (opts.src === "file" ? (L.file ? L.file.name : "no file") : opts.src === "tone" ? "the generator's tone" : "guitar riff");

    function stop() {
      jobs.forEach(j => j.cancel()); jobs = [];
      if (L.job) { L.job = null; L.seq++; setStatus("idle", "Listen: stopped"); render(); cmds.sync(); }
    }
    function run() {
      stop(); halt();
      const T = topo(), o = pick(), chs = clip();
      L.error = !S.comps.length ? "Empty sheet" : !T.hasGround ? "Add a ground symbol to simulate"
        : !sources().length ? "The recording drives the circuit's signal generator (or guitar pickup, or phono cartridge): place one at the input."
        : !o ? "Nothing to hear: place a speaker as the load, or an oscilloscope on the output."
        : !chs ? (opts.src === "file" ? (L.file ? "The excerpt is empty: check From and Length." : "Open a WAV or MP3 file first.") : "No clip") : null;
      if (L.error) { render(); return; }
      const base = buildNetlist(), gains = 10 ** (opts.level / 20);
      const ids = new Set(sources().map(c => c.id)), gens = base.elements.filter(e => e.kind === "VSRC" && ids.has(e.id));
      const silent = { nodeCount: base.nodeCount, elements: base.elements.map(e => (gens.includes(e) ? Object.assign({}, e, { amp: 0 }) : e)) };
      const mains = base.elements.find(e => e.kind === "VSRC" && e.acMains && e.freq > 0);
      const total = chs[0].length, fade = Math.round(0.02 * RATE), pre = Math.round(0.4 * RATE);
      const ps = pieces(total, pool.ok ? pool.size : 1, mains ? RATE / mains.freq : 1, pre, fade);
      const seq = ++L.seq, job = L.job = { seq, done: [], f: ps.map(() => 0), parts: [], ps, total, t0: Date.now(), phase: "settle" };
      L.take = null; L.stale = false;
      const progress = () => {
        const f = job.phase === "settle" ? 0.05 * (job.settle || 0) : 0.05 + 0.95 * job.f.reduce((s, v) => s + v, 0) / ps.length;
        setStatus("busy", job.phase === "settle" ? "Listen: settling the circuit with the generators silent…" : `Listen: playing ${fmtEng(total / RATE, "s")} of ${srcName()} through the circuit on ${ps.length} core${ps.length > 1 ? "s" : ""} · ${Math.floor(f * 100)} %`, f);
        renderStrips();
      };
      const fail = err => { if (L.seq !== seq) return; jobs.forEach(j => j.cancel()); jobs = []; L.job = null; L.error = err; setStatus("error", "Listen: " + err); render(); cmds.sync(); };
      const finish = () => {
        jobs = []; L.job = null;
        const out = o.probes.map((_, j) => highpass(stitch(ps, job.parts.map(p => p[j]), total, fade), RATE, 3));
        L.take = { inp: chs, out, peak: peakOf(out), rms: rmsOf(out), label: o.label, source: srcName(), seconds: total / RATE, ms: Date.now() - job.t0, cores: ps.length, vin: gens.length ? gens[0].amp * gains : 0 };
        setStatus("ok", `Listen: ${fmtEng(total / RATE, "s")} rendered in ${fmtEng(L.take.ms / 1000, "s")} · output peak ${fmtEng(L.take.peak, "V")}`);
        render(); cmds.sync();
      };
      const piece = (j, warm) => {
        const p = ps[j], len = Math.min(total, p.to + (j < ps.length - 1 ? fade : 0)) - p.start;
        const elements = base.elements.map(e => {
          const g = gens.indexOf(e); if (g < 0) return e;
          const ch = chs[g % chs.length];
          return Object.assign({}, e, { amp: e.amp * gains, offset: e.offset || 0, samples: ch.slice(p.start, p.start + len), rate: RATE });
        });
        return runJob({ kind: "audio", netlist: { nodeCount: base.nodeCount, elements }, options: { warm, rate: RATE, sub: 1, seconds: len / RATE, probes: o.probes } }, {
          onResult: r => {
            if (L.seq !== seq) return;
            if (!r || !r.ok) { fail(`${(r && r.error) || "the engine stopped"}${r && r.at !== undefined ? ` (${fmtEng(p.start / RATE + r.at, "s")} into the clip)` : ""}`); return; }
            job.parts[j] = r.out; job.f[j] = 1; job.done.push(j);
            if (job.done.length === ps.length) finish(); else progress();
          },
          onProgress: f => { if (L.seq === seq) { job.f[j] = f; progress(); } }
        });
      };
      const go = r => {
        if (L.seq !== seq) return;
        if (!r || !r.ok) { fail(`the circuit did not settle (${(r && r.error) || "no result"})`); return; }
        job.phase = "play"; progress();
        jobs = ps.map((_, j) => piece(j, r.warm || null));
      };
      render(); cmds.sync(); progress();
      jobs = [runJob({ netlist: silent, options: RUN }, { onResult: go, onProgress: f => { if (L.seq === seq) { job.settle = f; progress(); } }, high: true })];
    }
    // a job on the engine's pool, or on the page where no worker can start
    function runJob(msg, o) {
      if (pool.ok) return pool.run(msg, o);
      const id = setTimeout(() => o.onResult(msg.kind === "audio" ? TubeSimEngine.audio(msg.netlist, msg.options) : TubeSimEngine.simulate(msg.netlist, msg.options)), 0);
      return { cancel: () => clearTimeout(id) };
    }

    // ---- playback (Web Audio): input and output start together, A/B sets which one is heard ----
    function scales(t) {
      // match: the output at the input's loudness; else each at its own peak. Both kept under full scale
      const pin = peakOf(t.inp) || 1, pout = t.peak || 1;
      let ki = 0.9 / pin, ko = opts.match && t.rms > 0 ? ki * rmsOf(t.inp) / t.rms : 0.9 / pout;
      if (ko * pout > 0.98) { const r = 0.98 / (ko * pout); ko *= r; if (opts.match) ki *= r; }
      return { ki, ko };
    }
    function buffer(chs, k) {
      const b = ac.createBuffer(chs.length, chs[0].length, RATE);
      chs.forEach((c, j) => { const d = new Float32Array(c.length); for (let i = 0; i < c.length; i++) d[i] = c[i] * k; b.copyToChannel(d, j); });
      return b;
    }
    function halt() {
      if (!play) return;
      try { play.a.stop(); play.b.stop(); } catch (e) {}
      play = null; L.playing = false; renderTransport();
    }
    function start(at) {
      const t = L.take; if (!t) return;
      halt();
      try { ac = ac || new (root.AudioContext || root.webkitAudioContext)(); } catch (e) { setStatus("error", "This browser cannot play audio"); return; }
      if (ac.state === "suspended") ac.resume();
      const { ki, ko } = scales(t), master = ac.createGain(); master.gain.value = opts.volume; master.connect(ac.destination);
      const mk = (chs, k, on) => { const s = ac.createBufferSource(), g = ac.createGain(); s.buffer = buffer(chs, k); s.loop = opts.loop; g.gain.value = on ? 1 : 0; s.connect(g); g.connect(master); return { s, g }; };
      const a = mk(t.inp, ki, L.ab === "in"), b = mk(t.out, ko, L.ab === "out");
      const off = Math.max(0, Math.min(t.seconds - 0.01, at || 0)), when = ac.currentTime + 0.03;
      a.s.start(when, off); b.s.start(when, off);
      play = { a: a.s, b: b.s, ga: a.g.gain, gb: b.g.gain, master, when, off, len: t.seconds };
      b.s.onended = () => { if (play && play.b === b.s) { play = null; L.playing = false; renderTransport(); } };
      L.playing = true; renderTransport(); tick();
    }
    function setAB(v) {
      L.ab = v;
      if (play) { const now = ac.currentTime; play.ga.setTargetAtTime(v === "in" ? 1 : 0, now, 0.008); play.gb.setTargetAtTime(v === "out" ? 1 : 0, now, 0.008); }
      renderTransport();
    }
    const position = () => { if (!play) return null; const e = ac.currentTime - play.when + play.off; return e < 0 ? play.off : opts.loop ? e % play.len : Math.min(e, play.len); };
    function tick() { if (!play) { renderStrips(); return; } renderStrips(); root.requestAnimationFrame(tick); }
    function saveWav() {
      const t = L.take; if (!t) return;
      const data = wav(t.out, RATE, 0.95 / (t.peak || 1));
      const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([data], { type: "audio/wav" }));
      a.download = `${(t.source || "listen").replace(/\.[a-z0-9]+$/i, "").replace(/[^\w.-]+/g, "_")}-through-circuit.wav`; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 4000);
      setStatus("ok", `Saved ${a.download} (normalised: peak ${fmtEng(t.peak, "V")} at full scale)`);
    }
    async function openFile(f) {
      if (!f) return;
      setStatus("busy", `Reading ${f.name}…`);
      try {
        const bytes = await f.arrayBuffer(), Ctx = root.OfflineAudioContext || root.webkitOfflineAudioContext;
        const b = await new Promise((res, rej) => { const p = new Ctx(2, 1, RATE).decodeAudioData(bytes, res, rej); if (p && p.catch) p.catch(rej); });
        const chs = []; for (let j = 0; j < Math.min(2, b.numberOfChannels); j++) chs.push(new Float32Array(b.getChannelData(j)));
        if (chs.length === 2 && chs[0].every((v, i) => v === chs[1][i])) chs.pop();
        L.file = { name: f.name, chs, seconds: chs[0].length / RATE };
        opts.src = "file"; if (opts.from >= L.file.seconds) opts.from = 0; save();
        L.error = null;
        setStatus("ok", `${f.name}: ${fmtEng(L.file.seconds, "s")}, ${chs.length > 1 ? "stereo" : "mono"}`);
      } catch (e) {
        setStatus("error", `Could not read ${f.name}: the browser does not decode it (WAV and MP3 work everywhere)`);
      }
      syncTools(); render();
    }
    function changed() { if (L.take && !L.stale) { L.stale = true; render(); } }

    // ---- drawing ----
    function strip(cv, chs, color, label, active, pending) {
      if (!cv) return;
      const dpr = root.devicePixelRatio || 1, w = cv.clientWidth, h = cv.clientHeight;
      if (!w || !h) return;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) { cv.width = Math.round(w * dpr); cv.height = Math.round(h * dpr); }
      const g = cv.getContext("2d"); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, w, h);
      g.fillStyle = active ? "#0f1c28" : "#0a0e14"; g.fillRect(0, 0, w, h);
      g.strokeStyle = "#223044"; g.beginPath(); g.moveTo(0, h / 2 + 0.5); g.lineTo(w, h / 2 + 0.5); g.stroke();
      if (pending) {
        const total = pending.total;
        pending.ps.forEach((p, j) => { const x0 = p.from / total * w, x1 = p.to / total * w; g.fillStyle = "#13293a"; g.fillRect(x0, 0, (x1 - x0) * pending.f[j], h); g.strokeStyle = "#223044"; g.strokeRect(x0 + 0.5, 0.5, x1 - x0 - 1, h - 1); });
      } else if (chs) {
        const n = chs[0].length, pk = peakOf(chs) || 1, rows = chs.length;
        g.fillStyle = color;
        chs.forEach((a, r) => {
          const hh = h / rows, y0 = hh * r + hh / 2;
          for (let x = 0; x < w; x++) {
            const i0 = Math.floor(x / w * n), i1 = Math.max(i0 + 1, Math.floor((x + 1) / w * n));
            let mn = Infinity, mx = -Infinity; for (let i = i0; i < i1; i++) { const v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; }
            g.fillRect(x, y0 - mx / pk * hh * 0.45, 1, Math.max(1, (mx - mn) / pk * hh * 0.45));
          }
        });
      }
      const pos = position();
      if (pos !== null && L.take) { const x = pos / L.take.seconds * w; g.fillStyle = "#ffffff"; g.fillRect(x, 0, 1.5, h); }
      g.font = "11px ui-monospace, Menlo, monospace";
      g.fillStyle = "rgba(10,14,20,0.8)"; g.fillRect(2, 2, g.measureText(label).width + 10, 16);
      g.fillStyle = active ? "#e6edf3" : "#8b949e"; g.fillText(label, 6, 14);
    }
    function renderStrips() {
      const t = L.take, j = L.job;
      const inLabel = `Input · ${t ? t.source : srcName()}${t ? ` · ${fmtEng(t.vin, "Vpk")} at the generator` : ""}`;
      const outLabel = j ? `Output · rendering ${Math.floor((0.05 + 0.95 * j.f.reduce((s, v) => s + v, 0) / j.ps.length) * 100)} %` : t ? `Output · ${t.label} · peak ${fmtEng(t.peak, "V")}` : "Output";
      strip(document.getElementById("ls-cv-in"), t ? t.inp : null, "#ffd54f", inLabel, L.ab === "in", null);
      strip(document.getElementById("ls-cv-out"), j ? null : t ? t.out : null, "#00e5ff", outLabel, L.ab === "out", j && j.phase === "play" ? j : null);
    }
    function renderTransport() {
      const host = document.getElementById("ls-pane"); if (!host) return;
      const pb = host.querySelector("#ls-play"); if (pb) { pb.textContent = L.playing ? "■ Stop" : "▶ Play"; pb.disabled = !L.take; }
      host.querySelectorAll("[data-ab]").forEach(b => { const on = b.dataset.ab === L.ab; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      const sv = host.querySelector("#ls-save"); if (sv) sv.disabled = !L.take;
    }
    function syncTools() {
      const src = document.getElementById("ls-src"); if (src && document.activeElement !== src) src.value = opts.src;
      const fn = document.getElementById("ls-file-name"); if (fn) fn.textContent = L.file ? `${L.file.name} · ${fmtEng(L.file.seconds, "s")}` : "";
      const fb = document.getElementById("ls-file-btn"); if (fb) fb.hidden = opts.src !== "file";
      const fr = document.getElementById("ls-from-lbl"); if (fr) fr.hidden = opts.src !== "file";
      ["from", "len", "level"].forEach(k => { const e = document.getElementById("ls-" + k); if (e && document.activeElement !== e) e.value = opts[k]; });
      const sel = document.getElementById("ls-out");
      if (sel && document.activeElement !== sel) {
        const o = outputs(), cur = pick();
        const html = o.length ? o.map(x => `<option value="${esc(x.id)}">${esc(x.label)}</option>`).join("") : `<option value="">No speaker or scope</option>`;
        if (sel.innerHTML !== html) sel.innerHTML = html;
        sel.value = cur ? cur.id : "";
      }
      const btn = document.getElementById("btn-ls-run");
      if (btn) btn.textContent = L.job ? "■ Stop" : "▶ Render";
    }
    function render() {
      syncTools();
      const host = document.getElementById("ls-pane");
      if (!host || host.hidden) return;
      if (!host.querySelector(".ls-wrap")) {
        host.innerHTML = `<div class="ls-note" id="ls-note"></div><div class="ls-wrap">
          <div class="ls-transport">
            <button class="btn ls-play" id="ls-play" title="Play the input and the circuit's output together; A and B pick which one you hear">▶ Play</button>
            <div class="seg-group ls-ab" role="group" aria-label="Which one you hear">
              <button class="btn" data-ab="in" title="Hear the recording as it goes in">A · Input</button><button class="btn" data-ab="out" title="Hear it through the circuit">B · Circuit</button>
            </div>
            <label title="Play over and over"><input type="checkbox" id="ls-loop"> Loop</label>
            <label title="The output played as loud as the input, so A/B compares the sound, not the level"><input type="checkbox" id="ls-match"> Match loudness</label>
            <label class="ls-vol" title="Playback volume">Volume <input type="range" id="ls-vol" min="0" max="1" step="0.01"></label>
            <button class="btn" id="ls-save" title="Save the circuit's output as a WAV file (16-bit, normalised to its peak)">Save WAV</button>
          </div>
          <div class="ls-strips"><canvas id="ls-cv-in" title="Click to play from here"></canvas><canvas id="ls-cv-out" title="Click to play from here"></canvas></div>
        </div>`;
        host.querySelector("#ls-play").addEventListener("click", () => (L.playing ? halt() : start(0)));
        host.querySelectorAll("[data-ab]").forEach(b => b.addEventListener("click", () => setAB(b.dataset.ab)));
        const lp = host.querySelector("#ls-loop"), mt = host.querySelector("#ls-match"), vol = host.querySelector("#ls-vol");
        lp.checked = opts.loop; mt.checked = opts.match; vol.value = opts.volume;
        lp.addEventListener("change", () => { opts.loop = lp.checked; save(); if (play) { play.a.loop = play.b.loop = opts.loop; } });
        mt.addEventListener("change", () => { opts.match = mt.checked; save(); if (play) start(position()); });
        vol.addEventListener("input", () => { opts.volume = +vol.value; save(); if (play) play.master.gain.setTargetAtTime(opts.volume, ac.currentTime, 0.01); });
        host.querySelector("#ls-save").addEventListener("click", saveWav);
        ["ls-cv-in", "ls-cv-out"].forEach(id => host.querySelector("#" + id).addEventListener("click", e => {
          if (!L.take) return;
          const r = e.currentTarget.getBoundingClientRect(); setAB(id === "ls-cv-in" ? "in" : "out"); start((e.clientX - r.left) / r.width * L.take.seconds);
        }));
      }
      const note = host.querySelector("#ls-note");
      const t = L.take;
      note.className = "ls-note" + (L.error || L.stale ? " warn" : "");
      note.textContent = L.error ? L.error : L.stale ? "The circuit changed since this render: press ▶ Render again."
        : L.job ? "Rendering: the circuit settles with the generators silent, then the clip plays through it, a piece per core."
          : t ? `${fmtEng(t.seconds, "s")} of ${t.source} rendered in ${fmtEng(t.ms / 1000, "s")} on ${t.cores} core${t.cores > 1 ? "s" : ""}. Output ${t.label}: peak ${fmtEng(t.peak, "V")}, ${fmtEng(t.rms, "Vrms")}. Click a strip to play from there; A/B switches as it plays.`
            : "Pick a recording (a guitar riff made here, the generator's own tone, or your WAV or MP3 file) and press ▶ Render: it drives the signal generator, and you hear the speaker.";
      renderTransport(); renderStrips();
    }
    function init() {
      const src = document.getElementById("ls-src");
      if (src) src.addEventListener("change", () => { opts.src = src.value; save(); if (opts.src === "file" && !L.file) document.getElementById("ls-file").click(); syncTools(); });
      const fi = document.getElementById("ls-file");
      if (fi) fi.addEventListener("change", () => { openFile(fi.files[0]); fi.value = ""; });
      const fb = document.getElementById("ls-file-btn");
      if (fb) fb.addEventListener("click", () => fi && fi.click());
      [["from", 0, 36000], ["len", 0.1, 30], ["level", -60, 40]].forEach(([k, lo, hi]) => {
        const el = document.getElementById("ls-" + k); if (!el) return;
        el.addEventListener("change", () => { const v = Math.round(+el.value * 100) / 100; if (isFinite(v) && v >= lo && v <= hi) { opts[k] = v; save(); } el.value = opts[k]; });
      });
      const sel = document.getElementById("ls-out");
      if (sel) sel.addEventListener("change", () => { opts.out = sel.value; save(); });
      const btn = document.getElementById("btn-ls-run");
      if (btn) btn.addEventListener("click", () => (L.job ? stop() : run()));
      // a file dropped on the tab
      const dock = document.getElementById("ls-pane");
      if (dock) {
        dock.addEventListener("dragover", e => { e.preventDefault(); });
        dock.addEventListener("drop", e => { e.preventDefault(); const f = e.dataTransfer.files[0]; if (f) openFile(f); });
      }
      root.addEventListener("resize", () => renderStrips());
      render();
    }
    return { changed, init, render, run, stop, start, halt, setAB, openFile, outputs, position: () => position() };
  }
  CadListen.RATE = RATE; CadListen.pieces = pieces; CadListen.stitch = stitch; CadListen.highpass = highpass; CadListen.wav = wav; CadListen.tone = tone; CadListen.riff = riff;
  root.CadListen = CadListen;
})(typeof window !== "undefined" ? window : globalThis);
