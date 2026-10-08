# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.25.0] - 2026-10-08

### Added
- While a simulation is running, the inspector's **Operating point** and
  **Checks** headings show its readiness (for example "◌ 48 %"). Values and
  warnings shown there during a run, such as a resistor beyond its rating,
  come from an unfinished, preliminary result and can still change. The
  marker goes away when the run finishes.

## [3.24.0] - 2026-10-08

### Added
- **Simulation readiness in percent.** While the circuit simulates in the
  background, the CAD status bar shows how far it has got (for example
  "Preliminary result shown · settling fully: 48 %"), with a thin progress bar
  under the text. The curve tracer, oscilloscope and spectrum analyzer show the
  same status and bar in their status pill until the result arrives. The
  percentage covers the DC operating point (5 %), settling to steady state
  (how far the cycle-to-cycle change has fallen towards the settling target,
  up to 88 %) and the capture of the display window (to 100 %). It only rises.
  A quick live run that runs out of time stops at its settling percentage
  instead of jumping ahead, and the full run that follows counts again from
  the start.

## [3.23.0] - 2026-10-08

### Added
- **dBV readouts:** the oscilloscope gives each channel's AC level in dBV next
  to Vrms. The spectrum analyzer shows the fundamental in dBV in the footer and
  the harmonic table, other components in dBV next to dBc, and markers read
  dBV as well when the screen is in dBc. In dBV mode the harmonic table lists
  the harmonics in dBV.
- **File → Save as…** (Ctrl+Shift+S) saves the circuit as JSON under a new
  name.
- **Save writes back to the opened file.** In browsers with the File System
  Access API (Chrome, Edge), Save (Ctrl+S) on a circuit opened from a file, or
  saved once with Save as, first asks "Overwrite name.json?" and then writes
  that file. You can choose Overwrite, Save as… or Cancel. The window title
  shows the current file name. In other browsers, Save asks for a file name
  and downloads the file.

## [3.22.0] - 2026-10-08

### Added
- The signal generator's amplitude can be typed in **Vrms** and **dBV**
  (0 dBV = 1 Vrms) as well as Vpk. The three fields stay in step, and the
  RMS value uses the waveform's crest factor (√2 for sine, 1 for square,
  √3 for triangle).

## [3.21.1] - 2026-10-08

### Added
- A **Zoom** chip in the top-right corner of the curve tracer, oscilloscope and
  spectrum analyzer graphs. Hovering it (or focusing it with Tab) lists the
  mouse controls for that graph: wheel, Ctrl+wheel, Shift+wheel, right-drag,
  how to reset the view, and click for markers.

## [3.21.0] - 2026-10-08

### Added
- Mouse zoom on the curve tracer: the wheel zooms the plate curves in and out
  at the pointer, Ctrl+wheel zooms the current axis only, and right-drag or
  Shift+drag pans. Grid, curves, Pa max lines and picked points follow the
  zoom; **Reset zoom** shows the whole plot again.
- Mouse zoom on the oscilloscope in steady state: the wheel steps Time/div and
  keeps the point under the pointer in place (the trigger point moves, shown as
  "Pos" in the readout). Ctrl+wheel steps Volts/div of the displayed channels,
  and Shift+wheel or right-drag moves along the time axis. Autoset resets the
  view. The power-on view also gets Ctrl+wheel and right-drag.
- Mouse zoom on the spectrum analyzer: the wheel zooms the frequency axis at
  the pointer, Ctrl+wheel the level axis, and Shift+wheel or right-drag moves.
  The grid follows round values of the zoomed window; **Reset zoom** (or a new
  span, unit or scale) shows the whole span.

## [3.20.1] - 2026-10-08

### Fixed
- Transformer secondaries (on the right of the symbol) no longer have a stray
  vertical line down the inside of the winding. Each turn was drawn bottom to
  top, so the path joined the top of one turn to the bottom of the next with a
  straight stroke. The schematic and the PDF are both fixed.

## [3.20.0] - 2026-10-08

### Changed
- The Transformers palette is split into two sections: **Generic** (single-ended
  output, push-pull / UL output, power transformer with mains: you set the
  impedances, inductance and resistances) and **Manufactured** (the Hammond
  125SE output and 300-series power transformers: you pick a model and tap).
  The parts are named the same way in the inspector.
- Model and tap lists in the inspector take the full panel width and use short
  labels, so they are no longer cut off (the details stay in the text below).
- Transformer symbols draw the magnetic core as one line between the windings
  (IEC 60617, as on the choke), not two. The push-pull UL taps are solid leads
  like the other terminals, not dashed.
- The DC supply (B+ and bias) is drawn as a cell (IEC 60617): long thin plate
  for the positive pole, short thick plate for the negative. Before, it was a
  circle with the conductor drawn straight through it, which reads like a short
  circuit. A negative supply (bias) shows its positive plate at the bottom pin.

## [3.19.1] - 2026-10-08

### Fixed
- A circuit restored from browser storage at start-up now goes through the same
  loading as File → Open (part defaults filled in, wires split where another
  wire or a pin ends on them). Before, a stored circuit with a wire ending on
  the middle of another wire (a T joint) came back with that joint open, and
  the simulation could fail ("Transient did not converge").

## [3.19.0] - 2026-10-08

### Added
- Tube symbols in the schematic show their pin numbers beside each terminal
  line: anode, grids and cathode, and the heater pins under the heater leads
  (IEC 61082-1 terminal designations). A dual tube's section follows its
  designation (VL1.1, VL1.2), triode-pentodes use the triode or pentode
  section, a top-cap anode reads "cap", and directly heated tubes show the
  filament pins at the cathode. The numbers are printed in the PDF too.

## [3.18.2] - 2026-10-08

### Added
- Pin connections for all 73 handbook tubes, read from the electrode drawing on
  each tube's page in Katsnelson & Larionov 1981 (the 56 tubes added in 3.18.0
  had none). Heater notes give the book's heater pins; directly heated
  rectifiers say which pin carries B+.

### Fixed
- Base types and pin counts come from the handbook's outline drawings instead
  of being guessed from the text: 5Ц8С and 5Ц9С (5 pins, numbered to 8), 6С41С
  (7), 6П36С (9 + anode top cap), 6П41С (9), 6Ж32П, 6С66П (noval), 6Ж4 and 6П9
  (octal, metal); subminiature and nuvistor tubes show their wire leads.
- Pinouts that disagreed with the handbook drawing: 6П1П, 6Ц4П (7-pin base,
  anodes 1 and 7), 6С3П, 6С19П, 6С45П-Е, 6С33С (heater in two halves, 1–2 and
  6–7), 6Н7С (heater 2–7, common cathode 8), 6Ф3П (pentode cathode 2, control
  grid 3) and 6П27С (no separate suppressor pin).
- Three book drawings are faulty and are noted in the tube's heater note: 6Ж5П
  (heater printed as 4–5; taken as 3–4), 6С7Б (grid lead unnumbered; lead 4)
  and 6Ж32П (control grid printed as 7, a shield pin; control and suppressor
  grid pins left out).

## [3.18.1] - 2026-10-08

### Fixed
- Curve tracer: a click right after the layout shifted (switching tubes changes
  the source line under the socket) is mapped through the plot as now shown;
  3.18.0 was not published because this failed in CI.

## [3.18.0] - 2026-10-08

### Added
- **Tube database from Katsnelson & Larionov, «Отечественные приёмно-
  усилительные лампы и их зарубежные аналоги» (Energoizdat, 1981)**: 56 more
  Soviet receiving tubes (99 in all), with the handbook's heater data, limits
  and Western analogs, the page in each entry, and Koren models fitted to the
  handbook's rated operating points (Ia, S, µ or Ri; cathode-biased points with
  Ug1 = −Ik·Rk). Triode-pentodes (6Ф1П, 6Ф3П, 6Ф4П, 6Ф5П) are two entries.
- The curve tracer shows each tube's source: handbook page, analogs and limits.
- New kenotrons 5Ц8С, 5Ц9С, 6Ц5С, 6Ц13П.

### Changed
- The 21 Soviet tubes already in the library (6Н1П, 6Н2П, 6Н23П, 6Н6П, 6Н7С,
  6Н8С, 6Н9С, 6С3П, 6С19П, 6С33С, 6С45П, 6П1П, 6П3С-Е, 6П6С, 6П14П, 6П27С,
  6Ф3П, 5Ц3С, 5Ц4С, 6Ц4П …) now take their ratings and reference points from
  the handbook instead of Western equivalents' datasheets, and were refitted.
  Notably 6Ф3П pentode: Pa 8 W (ECL82: 7 W); 6П14П: Pa 14 W.
- Kenotron perveance from the handbook's guaranteed minimum anode current
  (a worst-case tube): each reproduces the handbook's minimum rectified current
  in its test circuit. 5Ц4С drops a little more than before.
- Tube fitter: finer grid steps for the triode-strapped fit of high-µ pentodes.

## [3.17.0] - 2026-10-08

### Added
- **6Ф3П / ECL82 / 6BM8** triode-pentode as two library entries, 6F3P-T
  (triode section) and 6F3P-P (pentode section), so one bulb is drawn as
  VL1.1 and VL1.2. Models fitted to the Philips ECL82 data (both sections,
  and class A at full drive: 3.3 W into 4.5 kΩ); limits from the same sheet
  (pentode 7 W, screen 2 W, 50 mA; triode 1 W).
- **Output transformer (SE catalog)**: the seven Hammond 125SE universal
  single-ended transformers (125ASE … 125GSE) with the primary resistance,
  inductance, secondary tap resistances and DC rating from Hammond's drawings.
  The secondary tap (ORG / GRN / YEL / WHT) sets the turns ratio. The
  inspector shows the primary DC current against the rating, and the checks
  flag it when it is exceeded.
- Tube fitter: an unbypassed screen resistor (`rg2`) in the published
  full-drive test circuit.

### Changed
- Tube fitter: the screen share `ks` is limited to 1.5. Larger values let the
  screen draw more than the whole space current near Va = 0, which the
  solver cannot follow at power-on.

## [3.16.4] - 2026-10-08

### Fixed
- Curve tracer legend: every line on the plot is explained, with a swatch in
  the same style (solid, dashed, ring, shaded) and a tooltip. Added: the
  70 % Pa line, the shaded area over Pa max, picked points A, B, the line
  through them, measured points of a model fit.
- Curve tracer: the plot is redrawn when it changes size without the window
  resizing (e.g. when the legend wraps to a second line), so clicks land on
  the point under the pointer.

## [3.16.3] - 2026-10-07

### Fixed
- 6П14П limits taken from the Soviet handbook table (Предельные
  эксплуатационные данные): anode dissipation **14 W** (3.16.1 wrongly used
  the Philips EL84's 12 W), screen 2.2 W, cathode–heater 100 V. The 6П14П-ЕВ
  entry notes its own limits (14 W, cathode–heater 200 V).

## [3.16.2] - 2026-10-07

### Fixed
- **Fit** (button or F) fits the sheet chosen in the Sheet list; with "All
  sheets" chosen it fits every sheet. It used to always fit everything.

## [3.16.1] - 2026-10-07

### Fixed
- The 6П14П had one database entry shared with the military 6П14П-ЕВ, with
  the -ЕВ's 14 W anode dissipation limit. The ordinary **6П14П** now has its
  own entry with the handbook limits (Pa 12 W, Va 300 V, as the EL84), so the
  dissipation readout and the checks judge it against 12 W.

## [3.16.0] - 2026-10-07

### Added
- **Power rating for resistors** (0.125 … 20 W, or not specified). The symbol
  shows it inside the body as in ГОСТ 2.728 (// 0.125 W, / 0.25 W, — 0.5 W,
  | 1 W, || 2 W, Roman numerals from 3 W), and the value text repeats it from
  1 W up. The inspector gives the simulated average power as a share of the
  rating (amber above 60 %, red above 100 %), and the circuit checks list every
  resistor run beyond its rating.

## [3.15.0] - 2026-10-07

### Added
- **Several sheets in one circuit.** File → Add sheet… places a further
  drawing frame (any format) to the right of the last one, with the same title
  block data. Sheets are numbered automatically (1/3, 2/3 …), a Sheet list in
  the toolbar zooms to one, and Save as PDF writes one page per sheet, each
  with only its own parts.
- **Sheet connector** (Sources): joins every connector of the same signal name,
  on any sheet, into one net, so supply rails and signals can continue on
  another sheet and the simulation still sees one circuit. Each connector shows
  the sheet and grid zone of its partners (IEC 61082-1 cross-reference); one
  without a partner is flagged.

## [3.14.0] - 2026-10-07

### Changed
- Reference designations use the classic letter codes instead of the
  IEC 81346-2 class codes: R resistors and potentiometers, C capacitors,
  L chokes, T transformers, VL tubes (rectifiers too), VD diodes, SA
  switches, BA speakers, G sources, P oscilloscopes. New parts get them, and
  "Renumber designations" converts an existing circuit.

## [3.13.1] - 2026-10-07

### Changed
- Designations on the diagram and in the PDF no longer get the IEC 81346
  "-" prefix: parts show as RA1, CA1, KF1.2. A prefix typed into a label
  (-, = or +) is still shown as typed.

## [3.13.0] - 2026-10-07

### Added
- **File menu** in the toolbar: New…, Open… (Ctrl+O), Save (Ctrl+S), Save as
  PDF and Export SPICE netlist.
- **Save as PDF**: the sheet as a vector PDF, black on white like a printed
  IEC 61082 document: one page the size of the drawing frame (A4 to A1,
  landscape or portrait, at 1:1), or the drawing's bounds without a frame.
  Lines, symbols and the title block stay vector; text is real text (Courier),
  Ω and → are drawn as glyphs. (`pdf-export.js`)
- **New…** asks for the sheet: format A4, A3, A2 or A1 and landscape or
  portrait, plus a title; every new circuit starts with that drawing frame.
  A first visit opens an A3 landscape sheet. The drawing frame part has a
  portrait option; on A4 portrait its title block spans the 180 mm width.
- Saved files take their name from the title block (identification number,
  or title).

### Changed
- A sheet with only a frame and notes counts as empty: no "No ground symbol"
  warning before the first part is placed.

## [3.12.0] - 2026-10-07

### Added
- Power-on view in the oscilloscope is zoomable: it opens a few periods wide
  (the circuit's own timebase) at power-on, keeping every simulation step, so
  waveforms show as waveforms instead of a solid envelope. Zoom with the mouse
  wheel or Time/div (up to the whole record), scroll with the overview strip
  under the screen (the whole record with the visible window marked; click or
  drag), Shift+wheel, ← → by a division, Home/End. Markers keep their absolute
  time while scrolling.

### Changed
- One window per tool: the Oscilloscope, Spectrum, Curve tracer and Circuit
  CAD buttons bring an already open window to the front instead of opening
  another; asking for a different scope part switches the open oscilloscope
  or analyzer to it. (`windows.js`)

## [3.11.1] - 2026-10-07

### Fixed
- The oscilloscope's ▶ Simulate and Power-on did nothing, without saying why,
  when the Circuit CAD tab had been opened before the update: the older CAD
  ignores requests it does not know. The CAD now acknowledges every request
  and reports its version; the oscilloscope says when no CAD answers within
  2 s or when the CAD tab runs another version, and asks to reload it.
- ▶ Simulate in steady state showed no feedback: the scope now shows what the
  CAD is doing ("CAD: Simulating until settled…") and the result ("Simulated
  in 3.1 s").

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
