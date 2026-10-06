# Tube Amp CAD

Design and simulate vacuum-tube amplifiers in the browser. Draw a schematic,
and a circuit simulator computes the operating points and waveforms; a curve
tracer, oscilloscope and spectrum analyzer show the result like bench
instruments would.

**Live:** [kothf.github.io/tube-amp-cad](https://kothf.github.io/tube-amp-cad/) ·
also on [aerocat.tech/tools](https://aerocat.tech/tools/)

![Schematic editor with a 12AX7 gain stage, voltages annotated and a scope on the output](docs/cad.png)

No install, no account, no server: everything runs on your machine, and your
circuit is saved in the browser.

## What it does

- **Schematic editor** — place parts from the palette, wire them, drag parts or
  wire segments, zoom and pan. Every net shows its DC voltage; hover a wire to
  measure it. Save/open as JSON or export a SPICE netlist.
- **Real simulation** — not a lookup table. A nodal solver runs your circuit
  through DC and transient analysis, including power supplies with rectifier
  tubes, chokes and output transformers, until it reaches steady state.
- **Curve tracer** — select a tube in the schematic and see its plate curves
  with the simulated load line, operating point, dissipation, gain and THD.
- **Oscilloscope & spectrum analyzer** — drop a scope part on the schematic and
  open it full-window, or view harmonic distortion on the analyzer.
- **40 tubes** — Western and Soviet small-signal triodes (12AX7, 6N2P, 6SN7…),
  power tubes (EL84, EL34, 6V6, KT88, 300B, 845, GU-50…) and rectifiers
  (5U4G, GZ34, 5Ts3S…), with pinouts and ratings.

| Curve tracer | Oscilloscope |
|---|---|
| ![Curve tracer showing 12AX7 plate curves with the simulated load line](docs/curve-tracer.png) | ![Oscilloscope showing the stage input and inverted, amplified output](docs/oscilloscope.png) |

## How the simulator works

`sim-engine.js` is a small SPICE-style engine (no dependencies, ~500 lines):

- Modified nodal analysis; Newton-Raphson with source stepping for the DC
  operating point; backward-Euler transient.
- Tubes use [Koren's](https://www.normankoren.com/Audio/Tubemodspice_article.html)
  published triode and pentode equations, unmodified, so parameters and
  exported models are interchangeable with Koren-style SPICE models,, plus grid conduction and screen current.
  Rectifiers are vacuum diodes (Child–Langmuir, perveance from datasheet drops).
- Transformers are coupled inductors with a leakage factor; inductors and
  windings carry their current as an unknown, so a shorted winding is
  reported instead of crashing the solver.
- Supplies with large capacitors take seconds of circuit time to settle. The
  engine detects the slowly decaying response and extrapolates it to periodic
  steady state (minimal polynomial extrapolation), typically in tens of
  milliseconds of compute.

It runs in a Web Worker, so the editor stays responsive while it solves.

## Accuracy

The test suite checks the engine against independent results: a resistor
divider and RC/RL filters against closed-form answers, a 12AX7 stage against a
separate solve of the Koren equation and its small-signal gain, an output
transformer against its turns ratio, and a choke-input supply against an RK4
integration of the same circuit (agreement within 0.02 %).

Every amplifier tube is fitted to, and tested against, its published
datasheet operating points: plate current, and where the datasheet gives them,
transconductance, plate resistance and screen current. Sources are listed per
tube in [`tests/datasheets.mjs`](tests/datasheets.mjs). Fitted currents are
within a few percent of the datasheets; a triode-connected pentode is fitted to
the same tube's pentode model, so both modes agree. Full simulations of the
EL84 and 6V6GT datasheet test circuits (cathode-biased) land on the published
current and dissipation.

Limits worth knowing: a model is exact only near the points it was fitted to,
and production tubes vary ±20 % or more; the pentode plate equation cannot
match plate resistance at two different screen voltages (6L6GC and 6V6GT are
within ±35 %); and the 6P45S has only a pulse-current specification to fit.

## Run it locally

Any static web server works; the simulator needs `http://` (not `file://`)
for its Web Worker:

```sh
python3 -m http.server 8080   # then open http://localhost:8080/
```

## Development

```sh
npm ci
npx playwright install chromium
npm test            # engine accuracy tests + browser end-to-end tests
npm run package     # dist/tube-amp-cad/ and a versioned .tar.gz
```

Pages load their scripts with `?v=dev`; packaging stamps the release version
into every asset URL so browsers and CDNs never mix two versions.

### Releasing

1. Add the changes under a new version in `CHANGELOG.md`.
2. Bump `version` in `package.json`.
3. `git tag vX.Y.Z && git push origin main vX.Y.Z`

The Release workflow tests the source and the packaged build, publishes a
GitHub release with `tube-amp-cad-X.Y.Z.tar.gz` and its SHA-256 (the archive is
byte-for-byte reproducible), and deploys it to GitHub Pages.
[aerocat.tech](https://aerocat.tech) embeds released versions only, pinned by
version and checksum; a scheduled workflow there proposes upgrades as pull
requests.

## Contributing

Read [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first: it explains how the
files fit together and the rules that keep the engine, exports and viewers
consistent.

## License

[MIT](LICENSE)
