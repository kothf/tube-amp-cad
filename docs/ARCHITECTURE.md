# Architecture & engineering rules

Notes for contributors (people and coding agents). User documentation is in the
[README](../README.md).

## Structure

Static, framework-free JS (classic `<script>` files, no build step). There are **no presets or templates**: the CAD starts empty and the user builds circuits from parts.

| File | Role |
|------|------|
| `tube-db.js` | `var TUBE_DATABASE` — the **single** tube database (99 tubes: Koren params per mode, ratings, pinouts; Soviet tubes from Katsnelson & Larionov 1981 (pinouts from each page's electrode drawing, bases from its outline drawings), with the page in each entry's `book` field). Shared by every page. |
| `sim-engine.js` | `TubeSimEngine`: circuit solver (MNA + Newton-Raphson, backward-Euler transient, periodic steady state with MPE extrapolation). Koren tube models, vacuum/silicon diodes, BJTs (`Semi.bjt`, Gummel-Poon) and MOSFETs (`Semi.mos`, square law), coupled-winding transformers. Junction voltages are limited per iteration (`pnjlim`), and a limited iteration never counts as converged. `result.dc.currents` is a flat `[id, node, A, …]` list of every element's terminal currents (averaged with `dc` when that is averaged); the CAD sums them per pin (`pinCurrents`) and passes them along the wiring (`wireCurrents`) for the current stickers. With a rectified supply (sources with `dcValue`) the DC pass is only an estimate, so `result.dc` holds the averages over the settled capture window (`dcAveraged`, estimate kept in `dcEstimate`). `startup(netlist, { tStop, probes: [[node, ref]], maxPoints })` is the power-on transient from a cold start, returning min/max envelopes per probe (the CAD runs it in a second worker for the oscilloscope). Options of `simulate`: `budgetMs`, `maxPeriods`, `onProgress(f)` (readiness 0…1, rising only; `progressMs` sets its throttle, default 100 ms); the CAD runs a short "live" budget and continues unsettled runs as a "full" one. |
| `sim-worker.js` | Runs the engine in a Web Worker for the CAD; posts `{ seq, progress }` along the way, which the CAD shows in its status and relays to the tool windows as `SIM_STATUS.progress`. |
| `cad-components.js` | `CadLib`: part library (pins on a 10 px grid, symbols, inspector fields, `build()` → solver elements), `parseEng`/`fmtEng`. |
| `cad-app.js` + `circuit_sandbox.html` | **Tube Amp CAD**: editor, live simulation, inspector, on-canvas scope screens, SPICE export, broadcast of results. |
| `tracer-app.js` + `index.html` | **Curve Tracer** (viewer): plate curves, operating point + simulated load line of a circuit tube, tube library, pinout, Koren fitter, LTspice `.subckt`. |
| `scope-math.js` | `ScopeMath`: oscilloscope auto-ranging shared by the scope window and the on-canvas scope screens — volts/div with automatic position offset, timebase from the measured fundamental, Schmitt-trigger edges. Pure functions, unit-tested in `tests/scope.test.mjs`. |
| `markers.js` | `MarkerPicker`: markers A and B on a canvas graph (click, drag, double-click, Esc) and the cursor readout box, shared by the oscilloscope, spectrum analyzer and curve tracer. Each page supplies `snap` (pointer → marker in its own data coordinates) and `pos` (marker → screen), so markers follow the trace as results update. `PlotZoom`: wheel / Ctrl+wheel / Shift+wheel and right- or Shift+drag on the same canvases; the page supplies `inside`, `zoom(x, y, k, vertical)`, `pan(dx, dy)` and optionally `scroll(dir)` and keeps its own view window. |
| `instrument-common.js`, `oscilloscope.html`, `spectrum_analyzer.html` | Full instrument windows bound to an Oscilloscope *part* in the circuit (`?scope=<partId>`). |
| `pdf-export.js` | `PdfExport`: `PdfCanvas`, a canvas-2D-compatible recorder that writes PDF operators (black on white, Courier text), and `buildPdf(page, draw)`. The CAD's `drawSheet()` draws the frame, wires, junctions and parts into it with the same code as on screen. |
| `bom.js` | `BomLib`: bill of materials. `build(comps, { sockets, bench, stress })` groups parts into lines (type, value, rating and `params.partno` alike; sections VL1.1 / VL1.2 are one part; parts with `noLabel` never appear), and `toTxt` / `toCsv` / `toXlsx` (stored zip of minimal SpreadsheetML, no library) / `toPdf` (A4 landscape through `PdfExport`) write it. The CAD shows it in a panel under the canvas and supplies the simulated stress per part. |
| `panels.js` | `Panels.columns(grid, opts)`: draggable edges for the side columns of a page's grid (CAD palette and inspector, tracer columns, instrument control panels), widths in `localStorage`, off below each page's narrow-layout breakpoint. Pages redraw on the `resize` event it sends. |
| `windows.js` | One window per tool: names each page's window and brings an open one to the front (`ToolWindows.open(page, { scope })`), switching an instrument to the requested scope part. |

**Data flow:** the CAD is the only place a circuit is edited. After each simulation it posts one `SIM_RESULT` message on `BroadcastChannel("tube_cad_v2")` (tubes with DC point + trajectory + metrics, scope channel arrays, speaker power). Other windows only listen and send `REQUEST_STATE` on load. Nothing ever broadcasts back, so there are no sync loops.

**Editor model:** wires are orthogonal segments between grid points; connectivity is geometric (coincident endpoints/pins). An endpoint or pin lying on a wire's interior connects (split + junction dot); plain crossings do not. `normalizeWires()` runs on every commit (split, dedupe, merge straight runs). The circuit autosaves to `localStorage["tubecad_circuit_v2"]`.

## Rules

1. **One tube database.** Edit tubes only in `tube-db.js` (Koren parameters via `scripts/fit-tubes.mjs`, see below). Rectifier tubes are simulated as vacuum diodes with perveance from `RECTIFIER_PERVEANCE` in `sim-engine.js` (their Koren "triode" params in the DB are placeholders and give absurd currents).
2. **Koren equations must stay identical** in `sim-engine.js` (`Koren.*`) and in exported SPICE (`cad-app.js` `spiceNetlist`, `tracer-app.js` `subckt`). The plot in the tracer calls the engine's functions directly.
3. **Real power transformers** live in `HAMMOND` / `POWER_TX` in `cad-components.js` (no-load volts, DCRs and excitation current from each drawing); `powerTx()` turns the primary tap into the windings of an `XFMR` element for the `ptx_cat` part, which is fed by a `mains` source (`acMains` marks the circuit for averaged DC readouts).
4. **Drawings follow IEC standards:** symbols in `DRAW` follow IEC 60617; each part's `prefix` (or `prefixFor(c)`) is its IEC 81346-2:2009 subclass code; labels are placed per IEC 61082-1 7.1.6.1 (left of vertical symbols, above horizontal ones), shown with the "-" prefix by `desig()`; `renumber()` numbers parts in reading order. `frame` and `note` are document-only parts (no pins, empty `build`); `frame` uses a function `bbox` and its own `hit` test.
5. **Adding a part:** add an entry to `LIB` in `cad-components.js` (pins on multiples of 10, `bbox`, `defaults`, `fields`, `build`) and a symbol in `DRAW`; put it in `PALETTE`. Mirroring comes for free: every part without `noRotate` gets the Mirror field and `params.flip`, applied left to right before the rotation (`flipX` in `compPins`, `compBBox`, `drawComp`); text a symbol draws itself is un-mirrored automatically. `build()` may allocate internal nodes with `alloc()`. Inductive branches get a 1 µΩ series term in the engine so wiring shorts can't make the matrix singular.
6. **Steady state:** captures are a whole number of base periods (harmonic analysis relies on it). Settling uses per-node relative change with a 1 V floor plus a decay-rate estimate; don't loosen it — coupling-cap outputs otherwise keep a false DC offset.
7. **Rendering:** no `requestAnimationFrame` loops and no `shadowBlur` on traces. Pages redraw only on data/setting changes (instrument pages idle at 0% CPU).
8. **Cache busting:** every local `<script src>` in the four pages carries `?v=dev` in the source; `npm run package` stamps the release version into all of them (and fails if a page has none). `cad-app.js` passes its own `?v=` to `sim-worker.js`, which passes it to `importScripts("sim-engine.js")`, so the worker never mixes versions. Never hand-edit version strings.
9. **No duplicated controls across windows:** circuit edits, generator settings and probing (wiring a scope) live in the CAD only; viewers have display controls only.

## Tube models

Triodes: `Koren.triodeIa` is Norman Koren's published equation exactly,
including the `(1 + sgn(E1))` factor (= 2 while conducting), so triode
parameters are interchangeable with Koren-style SPICE models.

Pentodes and beam tetrodes keep Koren's space-charge term but replace how the
current divides between plate and screen:

    Is  = 2·E1^x / kg,  E1 = (Vg2/kp)·ln(1 + exp(kp·(1/µ + Vg1/Vg2)))
    Ia  = Is · tanh(Va/vk) · (1 + Va/lam)
    Ig2 = (Vg1 + Vg2/µ)^x / kg2 + ks · Is · (1 − tanh(Va/vk))

Koren's `atan(Va/kvb)` ties the knee to the plate resistance: fitted to a
datasheet rp it gives a knee so soft that single-ended stages lost ~20 % of
their output power, and his screen current ignores the plate voltage. Here
`vk` (knee) and `lam` (slope, hence rp) are independent, and part (`ks`) of
the current the plate cannot take in the knee goes to the screen, as in real
tubes. `TubeSimEngine.Spice` emits these same equations for both SPICE
exports. Grid conduction is `gridI`.

Parameters come from `scripts/fit-tubes.mjs`, which fits each tube to its
datasheet points in `tests/datasheets.mjs` (Ia, gm, rp, Ig2; bias solved from
Ia where only cathode-bias conditions are published), with weak priors for
what the data cannot pin down (x ≈ 1.35, pentode µ(g1-g2), Ig2 ≈ 10 % of Ia
well above the knee, kg2 ≥ kg). For pentodes with published single-ended
full-drive results (`largeSignal`: EL84, 6V6GT, 6L6GC) the knee `vk` and
screen share `ks` are fitted by simulating that circuit in the engine and
matching output power, THD and average currents; the other pentodes use the
median of those fits. A full refit takes about five minutes.
The triode-connected model of a pentode is fitted to that pentode with g2
strapped to the anode.

To add or correct a tube: add its datasheet entry (with the source), run
`node scripts/fit-tubes.mjs <name>` to review, then `--write`, and run
`npm test` (every tube is checked against its entry). Note the change in
`CHANGELOG.md`: saved circuits will simulate differently.

## Testing

- `npm run test:reference` — reference circuits built through the editor and
  measured through the instrument windows (oscilloscope `#meas`, analyzer
  harmonic table) against datasheet and textbook values. Circuits are wired by
  a small router that puts every stub and track on the half grid (5 mod 10),
  where no pin can be, and each net is verified from the CAD's topology before
  anything is measured.

- `npm run test:engine` — Node's test runner loads `tube-db.js` and
  `sim-engine.js` with `vm.runInThisContext` (they are browser scripts that
  attach to `globalThis`) and compares against independent results.
- `npm run test:e2e` — headless Chromium via Playwright. Circuits are built
  through `window.TubeCAD` (`makeComp`, `compPins`, `lRoute`, `addSegment`,
  `commit`); wait for `state.sim.seq` to advance and `state.sim.busy` to clear
  (commits debounce the solver), and fail on any `pageerror`. On distributions
  where Playwright's bundled Chromium is unsupported, install
  `npx @puppeteer/browsers install chrome-headless-shell@stable` and set
  `CHROMIUM_PATH`. The test server must serve `.js` as `text/javascript`
  (Web Workers refuse other types).
