# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.2.0] - 2026-10-07

### Added
- Scope probe setting: 10× (10 MΩ load, the new default) or 1× (1 MΩ). The
  fixed 1 MΩ input used to pull a 12AX7 plate down by 14 V and cost 3 % gain.
- Reference-circuit tests (`npm run test:reference`): a 12AX7 stage, a 12AU7
  cathode follower, EL84 / 6V6GT / 2A3 single-ended stages, an RC filter, a
  full-wave rectifier and generator waveforms, measured through the scope and
  spectrum analyzer and compared with datasheet and textbook results.

### Fixed
- Spectrum analyzer: the fundamental is measured on the analysed input, not
  taken from the signal generator (power-supply ripple was analysed as if the
  fundamental were 50 Hz instead of 100 Hz).
- Square-wave generator: edges now have a 1 % rise time; an ideal step let
  floating-point rounding put the two captured periods' edges at different
  samples, producing spurious half-harmonic lines at −43 dBc.
- Analyzer shows absent harmonics as "< −120 dBc" instead of −240.0.

## [3.1.1] - 2026-10-07

### Fixed
- Oscilloscope auto mode: a signal riding on a DC level (a plate, a supply
  rail) no longer collapses to a flat line. Auto volts/div now fits the swing
  and shifts the trace with a position offset (shown as "offset 150V" in the
  window, "+" on the schematic screens); manual volts/div repositions the
  same way when the trace would leave the screen.
- Auto time/div follows the frequency measured on the probed signal instead
  of always the signal generator's (e.g. 100 Hz supply ripple next to a 1 kHz
  generator).
- Frequency readout and trigger use a Schmitt trigger, so harmonics, ripple
  or noise near the level no longer cause extra edges or a jumping trace.
- DC levels are shown as a line at their real height instead of magnifying
  solver noise to full screen; the schematic scope screens trigger correctly
  across the whole capture.

### Changed
- The scope window and the scope screens on the schematic share one
  auto-ranging module (`scope-math.js`); time/div now ranges 1 µs - 200 ms.

## [3.1.0] - 2026-10-07

### Fixed
- Tube currents and dissipation now match the datasheets. Every amplifier
  tube was refitted to its published operating points; previously many were
  far off, e.g. 845 15× too high, 6S19P 8×, 6V6GT/6L6GC 3×, 300B 2.4×, while
  12AX7, 12AT7, 6N2P and ECC88 ran at about half current and the GM-70 had
  µ 11.5 instead of 6.
- Triode-connected pentodes are fitted to the same tube's pentode model, so
  switching a pentode to triode mode no longer changes the tube.
- Ratings: 12AU7 Va max 330 V; 6P45S Va max 400 V, Ik max 500 mA.

### Changed
- The engine and both SPICE exports use Koren's published equations exactly
  (the `(1 + sgn(E1))` factor was missing, and the pentode plate term was
  normalised by 2/π). Koren parameters are now interchangeable with other
  Koren-style SPICE models. Saved circuits will show different, correct,
  operating points.

### Added
- `tests/datasheets.mjs`: reference operating points with sources for all
  35 amplifier tubes; `scripts/fit-tubes.mjs` fits the models to them.
- Tests: every tube against its datasheet; triode/pentode mode consistency;
  EL84 and 6V6GT datasheet cathode-bias circuits simulated end to end.

## [3.0.0] - 2026-10-07

First release as a standalone project (previously developed inside
[aerocat.tech](https://aerocat.tech/tools/)).

### Added
- Schematic editor (`circuit_sandbox.html`): zoomable sheet, grid snapping,
  drag-to-move parts and wire segments, box select, undo/redo, autosave,
  JSON save/open and SPICE netlist export.
- Parts: resistor, potentiometer, capacitors, choke, SE and push-pull/UL output
  transformers, power transformer, B+ and bias supplies, signal generator,
  silicon diode, speaker, ground, oscilloscope probe, and 40 tubes
  (triodes, pentodes/beam tetrodes, rectifiers).
- Circuit simulator (`sim-engine.js`, in a Web Worker): modified nodal
  analysis with Newton-Raphson, Koren triode/pentode models with grid and
  screen current, vacuum-diode rectifiers, coupled transformer windings, and
  periodic steady state with extrapolation so supplies settle in milliseconds.
- Curve tracer (`index.html`) follows the tube selected in the editor: plate
  curves, simulated load line, operating point, gain and THD.
- Oscilloscope and spectrum analyzer pages fed live from the editor's probes.
- Design-rule checks: missing ground, unconnected pins, shorted windings.
- Engine accuracy tests against closed-form results, an independent Koren
  solve and an RK4 reference; browser end-to-end tests of every page.

### Known issues
- Several tube models deviate from datasheet operating points by more than
  20 % (fixed in 3.1.0).

[Unreleased]: https://github.com/kothf/tube-amp-cad/compare/v3.2.0...HEAD
[3.2.0]: https://github.com/kothf/tube-amp-cad/compare/v3.1.1...v3.2.0
[3.1.1]: https://github.com/kothf/tube-amp-cad/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/kothf/tube-amp-cad/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/kothf/tube-amp-cad/releases/tag/v3.0.0
