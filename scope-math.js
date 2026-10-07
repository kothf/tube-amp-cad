/* Oscilloscope auto-ranging shared by the oscilloscope window and the scope
   screens on the schematic: volts/div with automatic position (offset),
   timebase from the measured fundamental, and a hysteresis trigger.
   Captures are a whole number of periods, so sample i and sample i + P are
   the same point (P = length - 1); every function treats them as periodic. */
(function (root) {
  "use strict";
  const VDIV = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100, 200];
  const TDIV = [1e-6, 2e-6, 5e-6, 1e-5, 2e-5, 5e-5, 1e-4, 2e-4, 5e-4, 1e-3, 2e-3, 5e-3, 1e-2, 2e-2, 5e-2, 0.1, 0.2];
  const DIVS_V = 8, DIVS_T = 10;
  const FILL = 3.5;          // auto range: half the swing fills 3.5 of the 4 divisions above centre

  const pick = (list, need) => list.find(v => v >= need * 0.9999) || list[list.length - 1];
  const period = a => Math.max(1, a.length - 1);
  const at = (a, i) => { const P = period(a); return a[((i % P) + P) % P]; };

  function stats(a) {
    const P = period(a);
    let mn = Infinity, mx = -Infinity, s = 0;
    for (let i = 0; i < P; i++) { const v = a[i]; if (v < mn) mn = v; if (v > mx) mx = v; s += v; }
    const mean = s / P;
    let q = 0;
    for (let i = 0; i < P; i++) q += (a[i] - mean) ** 2;
    return { min: mn, max: mx, pp: mx - mn, mean, rms: Math.sqrt(q / P), mid: (mx + mn) / 2 };
  }

  /** Numerically constant (solver ripple far below anything visible)? */
  const isFlat = st => st.pp <= 1e-6 + 1e-6 * Math.max(Math.abs(st.max), Math.abs(st.min));

  /** Schmitt-trigger transitions (thresholds at mid ± 20 % of the swing), so
      harmonics or ripple near the level never count twice. Each edge is the
      index where the signal crosses the mid level. Periodic: counted once
      around the capture after a first pass has settled the state. */
  function edges(a, slope, st) {
    st = st || stats(a);
    if (isFlat(st)) return [];
    const P = period(a), hi = st.mid + 0.2 * st.pp, lo = st.mid - 0.2 * st.pp, out = [];
    const rising = slope !== "falling";
    let state = 0;                                // -1 below lo, +1 above hi
    for (let i = 0; i < 2 * P; i++) {
      const v = at(a, i);
      const next = v <= lo ? -1 : v >= hi ? 1 : state;
      if (i >= P && state !== 0 && next !== state && (next === 1) === rising) {
        let j = i;                                // step back to the mid crossing
        while (j > i - P && (rising ? at(a, j - 1) >= st.mid : at(a, j - 1) <= st.mid)) j--;
        out.push(((j % P) + P) % P);
      }
      state = next;
    }
    return out;
  }

  /** Fundamental frequency of a periodic capture, or null for DC. */
  function fundamental(a, dt) {
    const n = edges(a, "rising").length;
    return n ? n / (period(a) * dt) : null;
  }

  /** Index where the displayed trace starts (first trigger edge), 0 for DC. */
  function triggerIndex(a, slope) {
    const e = edges(a, slope);
    return e.length ? Math.min(...e) : 0;
  }

  /**
   * Vertical scaling of one channel.
   *   setting: "auto" or a volts/div number;  coupling: "dc" | "ac" | "gnd"
   * Returns { vdiv, off, st, offset } — screen value = (v - off) / vdiv.
   * `offset` is set when DC coupling needed a vertical position shift to keep
   * the waveform on screen (like turning the POSITION knob); it is a whole
   * number of divisions so the readout stays clean.
   */
  function channel(a, setting, coupling) {
    const st = stats(a);
    if (coupling === "gnd") return { st, vdiv: setting === "auto" ? 1 : +setting, off: 0, offset: 0 };
    const base = coupling === "ac" ? st.mean : 0;
    if (setting !== "auto") {
      const vdiv = +setting;
      const fits = st.max - base <= (DIVS_V / 2) * vdiv && base - st.min <= (DIVS_V / 2) * vdiv;
      if (fits || coupling === "ac") return { st, vdiv, off: base, offset: 0 };
      const off = Math.round(st.mid / vdiv) * vdiv;
      return { st, vdiv, off, offset: off };
    }
    if (isFlat(st)) {
      // a DC level: show it as a line at its true height
      const level = Math.abs(st.mean - base);
      return { st, vdiv: pick(VDIV, Math.max(level, 1e-3) / FILL), off: base, offset: 0 };
    }
    const plain = Math.max(Math.abs(st.max - base), Math.abs(st.min - base)) / FILL;
    const shifted = st.pp / 2 / FILL;
    if (coupling === "dc" && plain > 4 * shifted) {
      const vdiv = pick(VDIV, shifted), off = Math.round(st.mid / vdiv) * vdiv;
      return { st, vdiv, off, offset: off };
    }
    return { st, vdiv: pick(VDIV, plain), off: base, offset: 0 };
  }

  /** Auto time/div: 2 to 5 periods of the measured fundamental on 10 divisions. */
  function timebase(a, dt, fallbackF) {
    const f = (a && fundamental(a, dt)) || fallbackF || 1 / (period(a) * dt);
    return { f, tdiv: pick(TDIV, 2 / f / DIVS_T) };
  }

  root.ScopeMath = { VDIV, TDIV, DIVS_V, DIVS_T, stats, isFlat, at, period, fundamental, edges, triggerIndex, channel, timebase, pick };
})(typeof window !== "undefined" ? window : globalThis);
