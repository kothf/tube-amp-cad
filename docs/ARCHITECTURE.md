# Architecture & engineering rules

Notes for contributors (people and coding agents). User documentation is in the
[README](../README.md).

## Structure

Static, framework-free JS (classic `<script>` files, no build step). There are **no presets or templates**: the CAD starts empty and the user builds circuits from parts.

| File | Role |
|------|------|
| `tube-db.js` | `var TUBE_DATABASE` — the **single** tube database (40 tubes: Koren params per mode, ratings, pinouts). Shared by every page. |
| `sim-engine.js` | `TubeSimEngine`: circuit solver (MNA + Newton-Raphson, backward-Euler transient, periodic steady state with MPE extrapolation). Koren tube models, vacuum/silicon diodes, coupled-winding transformers. |
| `sim-worker.js` | Runs the engine in a Web Worker for the CAD. |
| `cad-components.js` | `CadLib`: part library (pins on a 10 px grid, symbols, inspector fields, `build()` → solver elements), `parseEng`/`fmtEng`. |
| `cad-app.js` + `circuit_sandbox.html` | **Tube Amp CAD**: editor, live simulation, inspector, on-canvas scope screens, SPICE export, broadcast of results. |
| `tracer-app.js` + `index.html` | **Curve Tracer** (viewer): plate curves, operating point + simulated load line of a circuit tube, tube library, pinout, Koren fitter, LTspice `.subckt`. |
| `instrument-common.js`, `oscilloscope.html`, `spectrum_analyzer.html` | Full instrument windows bound to an Oscilloscope *part* in the circuit (`?scope=<partId>`). |

**Data flow:** the CAD is the only place a circuit is edited. After each simulation it posts one `SIM_RESULT` message on `BroadcastChannel("tube_cad_v2")` (tubes with DC point + trajectory + metrics, scope channel arrays, speaker power). Other windows only listen and send `REQUEST_STATE` on load. Nothing ever broadcasts back, so there are no sync loops.

**Editor model:** wires are orthogonal segments between grid points; connectivity is geometric (coincident endpoints/pins). An endpoint or pin lying on a wire's interior connects (split + junction dot); plain crossings do not. `normalizeWires()` runs on every commit (split, dedupe, merge straight runs). The circuit autosaves to `localStorage["tubecad_circuit_v2"]`.

## Rules

1. **One tube database.** Edit tubes only in `tube-db.js`. Rectifier tubes are simulated as vacuum diodes with perveance from `RECTIFIER_PERVEANCE` in `sim-engine.js` (their Koren "triode" params in the DB are placeholders and give absurd currents).
2. **Koren equations must stay identical** in `sim-engine.js` (`Koren.*`) and in exported SPICE (`cad-app.js` `spiceNetlist`, `tracer-app.js` `subckt`). The plot in the tracer calls the engine's functions directly.
3. **Adding a part:** add an entry to `LIB` in `cad-components.js` (pins on multiples of 10, `bbox`, `defaults`, `fields`, `build`) and a symbol in `DRAW`; put it in `PALETTE`. `build()` may allocate internal nodes with `alloc()`. Inductive branches get a 1 µΩ series term in the engine so wiring shorts can't make the matrix singular.
4. **Steady state:** captures are a whole number of base periods (harmonic analysis relies on it). Settling uses per-node relative change with a 1 V floor plus a decay-rate estimate; don't loosen it — coupling-cap outputs otherwise keep a false DC offset.
5. **Rendering:** no `requestAnimationFrame` loops and no `shadowBlur` on traces. Pages redraw only on data/setting changes (instrument pages idle at 0% CPU).
6. **Cache busting:** every local `<script src>` in the four pages carries `?v=dev` in the source; `npm run package` stamps the release version into all of them (and fails if a page has none). `cad-app.js` passes its own `?v=` to `sim-worker.js`, which passes it to `importScripts("sim-engine.js")`, so the worker never mixes versions. Never hand-edit version strings.
7. **No duplicated controls across windows:** circuit edits, generator settings and probing (wiring a scope) live in the CAD only; viewers have display controls only.

## Tube model accuracy (known issue)

`Koren.triodeIa` / `pentodeIa` compute `E1^x / kg1` and omit the
`(1 + sgn(E1))` factor of Koren's published equations (= 2 for a conducting
tube). Parameter sets copied verbatim from Koren's tables (12AX7) therefore
give half the published current, while most other entries in `tube-db.js` were
tuned against this engine and err in both directions (6V6GT/6L6GC ~3× high).

`tests/engine.test.mjs` checks models against datasheet operating points and
lists the failing tubes in `KNOWN_OFF` (reported as `todo`). To fix a tube,
refit its parameters for the engine's equation against several points of the
datasheet plate curves (not a single bias point), confirm the SPICE export and
the tracer still agree (rule 2), remove it from `KNOWN_OFF`, and note the
change in `CHANGELOG.md` — saved circuits will simulate differently.

## Testing

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
