# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.11.0] - 2026-10-07

### Added
- **▶ Simulate** button in the oscilloscope window. In steady state it asks the
  CAD for a full run until the circuit has settled.
- **Power-on** analysis in the oscilloscope: the circuit starts cold (every
  node at 0 V, capacitors empty) and every source switches on at t = 0; the
  scope shows the first 0.1, 0.2, 0.5, 1 or 2 s. Traces are drawn as the
  envelope of each signal (min and max per time bucket), so an audio signal
  stays readable while the supply charges. Readouts give the final level and
  swing, the peak and when the signal settles within ±2 %; markers read time,
  voltage and the envelope range. The run happens in its own worker with a
  progress bar and can be stopped; editing the circuit marks the record as
  changed. Engine: `TubeSimEngine.startup(netlist, { tStop, probes, maxPoints })`
  with differential probes.

## [3.10.0] - 2026-10-07

### Changed
- Reference designations use the two-letter subclass codes of IEC 81346-2:2009
  (Table 2): RA resistor, potentiometer, diode and inductor ("limiting a flow
  of electrical energy"), CA capacitor, TA transformer, TB rectifier tube, KF
  amplifying tube ("electronic tube"), GF signal generator, PJ loudspeaker,
  PH oscilloscope, SF selector switch; ideal supplies and mains keep the main
  class G. The "-" prefix is the product aspect sign of IEC 81346-1 rule 7.
- Labels are placed as IEC 61082-1 7.1.6.1 and 7.1.2.5 require: designation
  and technical data to the left of symbols with mainly vertical terminal
  lines, above those with mainly horizontal ones, data below the designation.
- Electron tubes drawn as IEC 60617 S00746: envelope S00063 as a capsule,
  indirectly heated cathode S00696 (hook with its lead down) and heater S00698,
  suppressor grid tied to the cathode inside the envelope.
- The oscilloscope carries the IEC 60617 S00922 symbol next to its name.

## [3.9.0] - 2026-10-07

### Added
- Drawings to IEC standards:
  - **IEC 61082-1 sheet:** a *Drawing frame* part (A4 to A0 landscape, 4 drawing
    units per mm) with an ISO 5457 frame, a reference grid of 50 mm zones
    (columns 1…n, rows A…, without I and O) and an ISO 7200 title block whose
    fields are edited in the inspector. Only its frame lines and title block
    are clickable, so parts drawn inside stay selectable.
  - *Text note* part for notes and supply-line markings.
  - **IEC 81346 reference designations:** parts are named with the entry class
    codes of IEC 81346-2:2019 (R, CA capacitor, CB inductor, T transformer and
    rectifier tube, K amplifying tube, G sources, P loudspeaker and
    oscilloscope, S switch) and shown with the product-aspect prefix, e.g.
    -R1, -K1.2. *Renumber designations* numbers every part in reading order,
    keeping the sections of one object together (-K1.1/-K1.2, -S1.1/-S1.2).

### Changed
- Symbols redrawn to IEC 60617: polarized capacitor with two straight plates
  and "+", inductor core as one line, change-over contact without contact
  circles, ideal voltage source with the conductor through the circle,
  signal generator as a static generator (square with G and a sine), AC mains
  as a voltage source with "~".
- New parts get IEC 81346 class codes instead of R/C/L/V/SA/TP/GEN/XSC
  prefixes; saved circuits keep their labels until renumbered.
- The AC mains source's neutral is earthed solidly (TN) instead of through
  100 MΩ.

### Fixed
- A transient could fail with "did not converge" depending only on how the
  parts were numbered: Newton's last updates stalled at a few microvolts of
  round-off and never met the 1 µV test, or bounced across a rectifier's
  turn-on. A stalled update below 100 µV now counts as converged, a bouncing
  iteration takes half a step, and a failing step is retried in 1/8 and then
  1/64 sub-steps. A floating mains primary made this worse and is now earthed.

## [3.8.0] - 2026-10-07

### Added
- **AC mains** source part (voltage, 50/60 Hz, source resistance) to feed a
  power transformer's primary. Its neutral is tied to ground through 100 MΩ,
  so the primary circuit needs no ground symbol.
- The catalog power transformer now offers 25 Hammond 300-series models,
  369AX to 374BX (125-0-125 V to 375-0-375 V, 58 to 460 mA), each with the
  no-load voltages, winding resistances and excitation current from its
  drawing.

### Changed
- The catalog power transformer is a real transformer with primary pins
  instead of containing its own mains supply: wire an AC mains source to P1
  and P2. The primary tap (100-120 V with the primaries in parallel, 200-240 V
  in series) sets the turns ratio; primary and HV winding resistances and the
  magnetizing inductance are simulated. Circuits saved with 3.7.0 need an AC
  mains source wired to the primary.

## [3.7.0] - 2026-10-07

### Added
- Catalog power transformer part, starting with the Hammond 373BX
  (350-0-350 V 201 mA, 50 V bias tap). Pick the mains voltage and the primary
  tap (100-240 V); the part derives each HV half's no-load voltage and source
  resistance (winding plus the reflected primary) from Hammond's drawing:
  740.6 V CT no-load at 120 V, 89.10 Ω HV, 3.687 / 4.007 Ω primaries. The
  50 V bias tap can be shown as a pin. Leakage inductance is not modelled.

## [3.6.0] - 2026-10-07

### Added
- **Simulate** button and a **Live** switch in the toolbar. Live (the
  default) re-simulates after every edit; with Live off, edits wait for
  ▶ Simulate (Ctrl+Enter). ▶ Simulate always runs until the circuit has
  settled, with a two-minute limit; click it again to stop.

### Fixed
- Circuits with a rectified supply now show real DC values. A rectifier has no
  true DC solution, and the node voltages and tube operating points used to
  come from a rough estimate (each transformer half held at 0.95 of its peak):
  a supply that settles at 351 V could read 431 V. They are now the averages
  over the settled waveform, the values a meter reads.
- Slow supplies (a choke and large capacitors ringing at a few hertz) now
  settle fully. When a live run runs out of time, the preliminary result is
  shown and the simulation continues in the background until it has settled;
  the next edit cancels it. An unsettled supply made distortion readings too
  high and inconsistent from run to run.

## [3.5.0] - 2026-10-07

### Added
- Changeover switch part (SPDT): a common contact and two throws, A and B.
  Double-click it on the sheet, or pick the position in the inspector, to
  flip it. Sections named like SA1.1 and SA1.2 are one ganged switch and
  always flip together, so a single circuit can hold both configurations of
  an amplifier, e.g. triode and pentode connection of the output tubes.

## [3.4.0] - 2026-10-07

### Added
- Markers on every graph: click to place marker A, then B; drag to move,
  double-click to remove, Esc to clear. A hover cursor shows the values under
  the pointer.
  - Oscilloscope: markers sit on a trace and read time and voltage, with ΔT,
    1/ΔT and ΔV between them (X and Y in X-Y mode).
  - Spectrum analyzer: markers snap to a spectral line and read its
    frequency, harmonic number and level, with the difference between them.
  - Curve tracer: a picked point reads Va, Ia, the grid voltage that puts the
    tube there (the model solved for Vg), plate dissipation, and gm, rp and µ
    at that point. Points snap to the operating point and the simulated load
    line. Two points draw the load line through them and give its resistance.

### Changed
- The hover readouts of the curve tracer now sit on the plot, so the plot no
  longer changes size while the pointer moves.

## [3.3.0] - 2026-10-07

### Fixed
- Pentodes and beam tetrodes now deliver their datasheet output power. In
  single-ended class A at full drive: EL84 5.9 W (Philips 5.7 W), 6V6GT
  4.5 W and 5.3 W (RCA 4.5 W and 5.5 W), 6L6GC 6.4 W (RCA 6.5 W), with THD
  and full-drive currents close to the published values. Previously power
  was 15-21 % low and screen current did not rise at full drive.
- Pentode plate resistance now matches the datasheets at every published
  operating point (within 4 %, previously up to ±35 %).

### Changed
- New pentode model: Koren's space-charge term with a separate knee (`vk`)
  and slope (`lam`) for the plate, and current conservation in the knee (a
  share `ks` of what the plate cannot take goes to the screen). Pentode
  parameters therefore differ from Koren's; triodes are unchanged. Both
  SPICE exports use the new equations (`TubeSimEngine.Spice`), and the curve
  tracer's fitter fits the slope `lam` for pentodes. Saved circuits with
  pentodes will show different, more accurate, results.
- `tests/datasheets.mjs` gains published full-drive results, which the fitter
  simulates; pentode rp tolerance in the tests tightened to ±15 %.

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

[Unreleased]: https://github.com/kothf/tube-amp-cad/compare/v3.4.0...HEAD
[3.4.0]: https://github.com/kothf/tube-amp-cad/compare/v3.3.0...v3.4.0
[3.3.0]: https://github.com/kothf/tube-amp-cad/compare/v3.2.0...v3.3.0
[3.2.0]: https://github.com/kothf/tube-amp-cad/compare/v3.1.1...v3.2.0
[3.1.1]: https://github.com/kothf/tube-amp-cad/compare/v3.1.0...v3.1.1
[3.1.0]: https://github.com/kothf/tube-amp-cad/compare/v3.0.0...v3.1.0
[3.0.0]: https://github.com/kothf/tube-amp-cad/releases/tag/v3.0.0
