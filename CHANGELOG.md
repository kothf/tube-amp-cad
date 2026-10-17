# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.68.1] - 2026-10-17

### Fixed
- **Gubin example: the 5Ц4С within its peak anode current.** With 100 Ω anode resistors (R1, R2) each anode pulled 405 mA while the 6.8 µF reservoir charged, over the tube's 375 mA (datasheet: 125 mA average, 375 mA peak per anode). 180 Ω brings it to 359 mA; B+ 357 V instead of 372 V, output about 2 % lower. The board is unchanged (the same 5 W resistors).

## [3.68.0] - 2026-10-17

### Added
- **Plated mounting holes.** A mounting hole is not plated (as before) or plated: a copper ring on both sides (Ø 6 mm round an M3 hole unless set), bare of solder mask, in the plated drill file. It may take a net, GND for a grounded chassis screw, which a pour of that net joins; the check reports one its net does not reach, and a ring too thin for its hole. Set in the hole's inspector (Plating, Ring Ø, Net).

### Changed
- **Gerber export, checked by reading the files back with an independent Gerber library (gerbonara):**
  - X2 aperture functions on copper (ComponentPad, ViaPad, Conductor, WasherPad, NonConductor) and the profile, `TF.Part` and `TF.SameCoordinates`; a pad and a via of one size get their own apertures.
  - Excellon tools marked ComponentDrill, ViaDrill or MechanicalDrill.
  - The silkscreen is cut to the board outline and kept 0.1 mm off every pad, hole and bare via, as the board maker would otherwise clip it; a reference that would run off the board's top edge goes under its part instead (on the screen too).
  - Comments and attribute values are plain ASCII (Cyrillic transliterated, × as x).
  - The README gives the board's real track widths, not just the design minimum.

## [3.67.0] - 2026-10-17

### Added
- **Example: Gubin stereo amplifier with a 5Ц4С supply** (GUB-245-01, three sheets: supply and two 6N23P-EV + 6P14P channels), **with its board**: 230 × 130 mm, two layers, the supply on the left, the 6P14P output stages in the middle and the shared 6N23P with the inputs on the right, the channels mirrored; 41 parts, every connection routed, a ground pour on the bottom, eight mounting holes (one by each socket), and no rule violations at IPC-2221B B2 clearances (up to 3.26 mm on the 6P14P anodes, which swing to 651 V at full drive). The transformers and the choke are wired to pads.
- **Rectifier peak anode current** is checked against the tube's rating (5Ц4С 375 mA, 5Ц3С 750 mA, 6Ц4П 300 mA …), from the settled cycles: the current a capacitor-input filter pulls while the reservoir capacitor charges.

- **Board DRC: a mounting hole under a part.** A hole needs the board clear of parts round it for the screw head, washer and standoff (Ø 7 mm for an M3 hole); a part over that area is reported (Courtyard).

### Fixed
- **5Ц4С rectified current rating: 125 mA, not 62 mA.** The book's 62 mA is per anode (its own test passes 122 mA at 500 V into 4.7 kΩ). The checks compared the tube's total with it and reported a 5Ц4С at 115 mA as 186 % overloaded.

## [3.66.0] - 2026-10-17

### Added
- **Legend on the schematic.** A key in the bottom-left corner of the sheet says what the marks mean: the cyan glow (a wire carrying signal, AC at least 1 % of its DC), the yellow DC voltage, the cyan ~Vrms AC, the violet DC current. It lists only the marks that are showing; *View ▾ → Legend* hides it, and the browser remembers.

## [3.65.0] - 2026-10-17

### Added
- **Germanium leakage.** Every germanium transistor carries its typical collector-base leakage ICBO at 25 °C (a third of the datasheet maximum: AC128 4 µA, MP39B 5 µA, AD149 100 µA, P213B 300 µA). It flows from collector to base and the transistor amplifies it to about (hFE + 1)·ICBO, as in the real part, so fixed-bias stages sit where germanium ones do. The inspector shows the leakage and warns when it is half of IC or more.
- **Transistor temperature.** A *Temperature* field (°C, 25 by default) on every bipolar transistor. IS scales as SPICE does with the band gap (0.67 eV germanium, 1.11 eV silicon): VBE falls about 2 mV/°C; hFE rises as (T/T0)^1.5; germanium leakage doubles every 10 °C. An AC128 on fixed bias (1.5 MΩ, 4.7 kΩ, −9 V) sits at VCE 5.2 V at 0 °C, 2.9 V at 25 °C and is saturated by 45 °C. At 25 °C every model is exactly as before.
- **SPICE export** writes EG, XTI, XTB and TNOM in the transistor models, `temp=` on a part away from 25 °C, and the germanium leakage as a B source.

### Changed
- **The tools show the aerocat.tech icon** in the browser tab, bundled with the tool (they declared none, so the browser showed a stray one).

## [3.64.0] - 2026-10-17

### Added
- **20 germanium transistors.** USSR: MP39B, MP40A, MP41A, MP42B, MP25B, MP26B, MP38A (NPN), GT402G/GT404G, P213B. Western: AC127/AC128, AC187/AC188, OC71, NKT275, 2N404, AD149, AD161/AD162. Each has a Gummel-Poon model: VBE about 0.2 V at 1 mA, hFE inside the datasheet's range (tested at its test current), the slow transit frequency as base-emitter capacitance. USSR types are written in Latin letters with the Cyrillic name in the description, so a search for "МП39" finds them.
- **Board footprints for germanium cans:** TO-1, TO-5 and the USSR MP flanged can, with 3D bodies. P213B and AD149 (TO-3) and AD161/AD162 go on wires, for a chassis heatsink.

## [3.63.0] - 2026-10-17

### Added
- **AC marked apart from DC on the schematic.** With *View ▾ → Voltages* on, a net's sticker shows its DC in yellow and its AC in cyan as `~20.1Vrms` (`162V ~20.1Vrms` on a plate; `~353mVrms` alone on an input or after a coupling capacitor). The wires that carry the signal (AC at least 1 % of the DC) glow cyan, so the signal path stands out from supply and bias nets; a rail's ripple is shown in its sticker without the glow. The status bar's wire readout gives the AC in Vrms as well as Vpp.

## [3.62.2] - 2026-10-17

### Fixed
- **Spectrum analyzer: Auto span now marks all 10 harmonics.** Harmonics weaker than the bottom of the screen (often H6–H10 of a triode stage at 10 dB/div) used to vanish from the plot. They now get a short dim stub at the floor labelled "H7↓", so every harmonic's place is shown; the levels are in the harmonic table.

## [3.62.1] - 2026-10-17

### Fixed
- **A flaky browser test.** "Marker B reads H2 as the harmonic table" failed once in CI (−28.69 against −27.7 dBc).
  - **Cause:** the test before it switches the generator to a 100 kΩ source and back, and waited only for the CAD to finish. The analyzer, a background tab, drew the last run a moment later, so the marker read the 100 kΩ run's spectrum: H2 −28.7 dBc, with less swing because of the Miller roll-off. The table read the 50 Ω run's.
  - **Fix:** each result now carries its run number (`seq`). The test waits until the scope and the analyzer show the CAD's latest run, then reads the marker and the table from one drawing.
  - The app itself was right throughout: the analyzer always ends up showing the latest run.

## [3.62.0] - 2026-10-17

### Added
- **Board editor comfort:**
  - **Pointer card:** rest the pointer on a pad, part, track or via to see its net, class, voltage and current. While routing, the card follows the pointer with the net, width, layer, length so far and any clearance problem.
  - **W while routing** steps the track width: the class's, signal, power, the minimum, or what the net's current asks. Corners already placed keep their width.
  - **Right-click menu** for what is under the pointer:
    - a part: turn, flip side, lock, zoom to it, route from the pad or highlight its net;
    - a track: select all of it, width presets, other layer, lock, delete;
    - a pour: add a corner here, round the parts, over the whole board;
    - empty board: a via, hole or text right there, Fit.

    Right-drag still pans.
  - **Zoom:** a zoom bar (− % + ⌖), <kbd>+</kbd> / <kbd>−</kbd>, and <kbd>Z</kbd> to zoom to the selection or the highlighted net.
  - **Find** (<kbd>Ctrl</kbd>+<kbd>F</kbd>) filters the parts and nets. An exact reference comes first, and Enter selects and shows the first match.
  - **Side panels** hide with <kbd>\\</kbd> or *View ▾ → Side panels*.
  - The checks and the layers are sections that fold away and stay folded. Long check lists are grouped by kind.
  - The part under the pointer is outlined, and the cursor shows it can be moved. Tool buttons show their keys on wide screens.

### Changed
- Part values sit inside the part when they fit and are left out wherever they would cover a reference or another value. Before, they printed over neighbouring references.
- The parts list shows each part's value, with the footprint in its tooltip. The footprint list in the inspector is full width, so the names are readable.

## [3.61.0] - 2026-10-17

### Added
- **Star grounding** (*Design rules… → Ground scheme: Star point*).
  - A star terminal **XG1** (a plated M3 or M4 hole for a solder lug) joins every ground return.
  - Each part with a ground pad belongs to a return, worked out from the circuit:
    - *Supply*: sources, rectifiers, reservoir and filter capacitors;
    - *Output*: power valves, the output transformer's secondary, the speaker;
    - *Input*: the input jack;
    - otherwise the small-signal stage it serves (*VL1*: its cathode resistor, bypass and grid leak).

    A part's inspector shows its return and can move it to another.
  - The ratsnest runs each return to XG1 on its own.
  - The check reports ground copper that joins two returns anywhere else.
- **Teardrops** where tracks meet round pads and vias: on by default, and in the Gerbers, PDFs and SVG. One is left out where it would break a clearance, and pours keep clear of them.

### Changed
- **Place all on the board** puts each part where it sits in the schematic. Big parts go first, and each takes the free spot nearest its place. Electrolytics keep 10 mm from hot parts. The input ends up on the left and the output on the right, as on the sheet; before, parts were packed in rows in alphabetical order.
- **Output and power transformers and filter chokes** get wire pads by default, since they sit on the chassis. The board-mount EI footprint stays an option.
- **Net names say what a net is**: `B+` (`B+1`, `B+2` … by voltage), `+12V`, `VL1.1-A`, `VL2-G1`, `VL1.2-K`, `OUT`, `IN`, otherwise the parts it joins (`R8_C3`) instead of `Net-(R8-2)`. A board saved with the old names (its net classes, pours, stitching vias) moves over by itself.

## [3.60.0] - 2026-10-17

### Added
- **Heaters on the board.** Every indirectly heated valve's heater pins get copper:
  - one pair of heater nets per heater voltage (`HTR6.3_A`, `HTR6.3_B`), fed from a heater-supply connector **XH1** that carries the sum of the heater currents, so the current check sizes the heater tracks;
  - 12AX7-type valves at 6.3 V (pins 4 + 5 against 9) or, if chosen, 12.6 V (4 to 5);
  - a raised heater gets its own supply at its DC potential, and a heater joined to its cathode (GZ34) gets a winding of its own;
  - directly heated valves are left alone, since their filament is the cathode;
  - internal shield pins (6N23P pin 9) go to GND.

  Before, heater pins had no net at all, so a board could pass every check with no heater wiring. *Design rules…* can turn this off.
- **Clearance by voltage (IPC-2221B).** Two nets keep the gap table 6-1 asks for the largest voltage between them: B2 bare board by default, or B4, A6, or off.
  - The voltage comes from the simulated DC levels and the signal swing.
  - An output transformer's anode end counts at twice its DC level, its full-drive swing.
  - Routing, pours and the check all use it, and mounting holes count as chassis.
  - The net table shows each net's clearance to GND. A 375 V B+ next to ground now needs 2.5 mm instead of 2 mm.
- **Valve layout checks** (warnings, distances in the rules):
  - a grid stopper more than 10 mm from its grid pin;
  - a grid track running alongside an anode track (oscillation) or a heater track (hum);
  - an electrolytic near a power valve, a rectifier or a resistor dissipating 1 W or more;
  - a valve socket with no mounting hole within 40 mm.
- **Pours are shapes you edit.**
  - Drag the **+** in the middle of an edge to add a corner, and double-click a corner (or drop it onto its neighbour) to remove it.
  - Drag inside a selected pour to move it, and the copper refills as you drag.
  - *Round the parts* outlines every part on the board, and *+ GND pour round these parts* does the same for a selection.
  - The *GND plane* button now makes a rectangle with four corners to drag.
  - Pours are cut to the board outline, round corners included, instead of being squashed into a rectangle.

### Changed
- **Board toolbar on one row** down to 1280 px:
  - the tools are a joined group;
  - grid style, axes, the drawing sheet, Lock sheet and 3D moved into **View ▾**;
  - Board setup and Design rules moved into **Board ▾**.
- The status bar turns green only when the board is finished. Warnings show in amber, and an unrouted board is grey.

### Fixed
- The "High voltage" clearance hint quoted 0.6 mm at 300 V from IPC-2221; table B2 asks 1.25 mm.

## [3.59.0] - 2026-10-17

### Added
- **Hints on hover.** Every inspector field, every readout, and every instrument setting has a short explanation, with its formula where one helps. This covers the Koren coefficients and the board rules, in all windows. Labels with a hint are underlined with dots; the hint shows after a quarter second. Palette parts say what they model.
- **The manual** (`help.html`; *Windows ▾ → Manual*, the help dialog, or **?** in each instrument). It has 18 chapters, a contents list that follows your scrolling, and search. It covers:
  - a ten-minute first amplifier;
  - every toolbar control;
  - drawing and the drawing standards;
  - a reference for every part and field;
  - a sortable table of all 99 tubes, with their ratings and capacitances;
  - simulation, the readouts glossary, checks and ratings, and the bias finder;
  - every instrument, and the board layout;
  - files, and the keyboard shortcuts;
  - a design cookbook: preamp, single-ended, push-pull, power supply, feedback;
  - the engine's equations, accuracy and limits, and troubleshooting.

  The parts reference and the glossary are built from the same texts as the hints, so the two always agree.

### Changed
- **Toolbar on one row.** Down to 1000 px wide, the editor's toolbar fits on one row; before, it wrapped onto two rows below about 1500 px.
  - *Voltages*, *Currents*, *Bias markers* and the *Bill of materials* moved into a **View ▾** menu with ticks. The menu stays open while you tick.
  - The five window buttons moved into a **Windows ▾** menu.
  - *Select | Wire*, the zoom controls and *Live | ▶ Simulate* are joined button groups.
  - *Live* has an on/off lamp, so it no longer looks like the selected tool.
  - *Simulate* is the primary button.
- In a scope's inspector, the three "Open … ↗" buttons became one row: *Oscilloscope ↗ · Spectrum ↗ · Bode ↗*.
- The inspector's Rotate / Mirror / Delete buttons use the toolbar's icons.
- A value's share of its rating ("64% of 2.2W") now goes on a second, quieter line, so long rows no longer wrap mid-number.

### Fixed
- The toolbar's HTML had a doubled File-menu container.

## [3.58.0] - 2026-10-17

### Added
- **Bode plotter.** A new instrument window (*Bode ↗*, or *Open Bode plotter* in a scope's inspector) shows gain and phase from 1 Hz to 1 MHz at a scope's channels, or between them. It lists:
  - gain and phase at 1 kHz;
  - the −3 dB points;
  - the level at 20 Hz and 20 kHz;
  - any resonant peak.

  It has markers and frequency zoom.
- **AC analysis in the engine** (`acSweep`): the small-signal response, linearized at the idle operating point. For a mains-fed amplifier that is its averaged steady state.
- **Tube interelectrode capacitances** from the datasheets, or a Soviet tube's Western analog, else typical values. The Miller effect now sets a stage's high-frequency corner in every simulation.

## [3.57.0] - 2026-10-17

### Added
- **More tube ratings checked.** Besides Pa and Va, the checks and each tube's inspector now cover:
  - screen dissipation (Pg2, averaged over the signal cycle) and screen voltage;
  - cathode current;
  - heater-to-cathode voltage, against the rating for each direction, with the heater grounded or at the tube's new *Heater DC potential*;
  - the grid circuit resistance against the largest allowed with cathode or with fixed bias;
  - a rectifier's rectified current and peak inverse voltage.

  Soviet tubes take their ratings from Katsnelson & Larionov; Western tubes from their datasheets. The curve tracer lists Pg2, Vhk and Rg max with the other ratings.

## [3.56.1] - 2026-10-16

### Changed
- **Bias finder: an anode current target starts from the simulated current.** Choosing "Anode current" as a tube's bias target fills in the current the stage draws now (two digits), so it suits a 12AX7 or an EL34 alike; edit it from there. With the field empty, the hint shows the present current.

## [3.56.0] - 2026-10-16

### Changed
- **Bias finder: a measured tube is fitted by a grid shift.** The model's plate and screen currents are moved along the grid axis until it reads what you measured (grid conduction still starts at 0 V), instead of all its currents being scaled. The tube's inspector shows the shift in volts. The pot check against weaker and stronger tubes still uses 30 % less or more current.
- **Pentode model: the currents fade in below 2 V on the screen**, smoothly to zero at 0 V. With the grid above the cathode, Koren's terms jumped from zero to a finite current as the screen passed 0 V; a cold start of a mains-fed circuit with a positive grid shift stalled on that jump ("Transient did not converge"). Above 2 V nothing changes; the exported SPICE models carry the same fade (a test compares them with the engine).


## [3.55.0] - 2026-10-16

### Added
- **Bias finder: a target as a share of Pa max.** *Bias target* in the tube's inspector is an anode current or a share of Pa max (70 % to start), solved on the idle anode dissipation Va·Ia. A target above Pa max, or a bias that leaves the anode above it at idle, is flagged in the inspector and on the status line, as is a target the part cannot reach.
- **Bias finder: measure what the amp lets you measure.** *Measured on the amp* takes the anode current, the cathode current, or the voltage across any resistor on the cathode (a 1 Ω sense resistor, or Rk). The tube's inspector now also gives the cathode current and the anode dissipation at the bias found.
- **Bias pots: range, spread and mid-travel.** The pot's inspector gives the anode current over its whole travel, whether the travel still covers a tube with 30 % less or more emission, and the divider resistor that puts the target at mid-travel, with a button that puts both in.

### Changed
- **The bias finder solves all parts together** (Newton's method with Broyden updates, the first Jacobian by one simulation per part). Bias parts that pull on each other converge now: two bias pots on one bias winding, as in a stereo fixed-bias amp, went round in circles before.
- Circuits saved with 3.54 keep their target and measured anode current.


## [3.54.0] - 2026-10-16

### Added
- **Bias finder: the resistor that sets each tube's bias, and the value that gives the anode current you want.** After every simulation the part that sets a tube's bias is drawn in violet. That is the cathode resistor for cathode bias (also a split cathode resistor's upper part, a cathodyne's bias resistor, or one resistor shared by a pair), or the pot or divider resistor that feeds a fixed-bias line. Give the tube a *Target anode current* in its inspector and a worker of its own simulates again with the signal off until the tube draws it. The value appears by the part ("→ 680Ω", a pot's "→ 65%"), rounded to E24 and checked by one more simulation, with the power it will dissipate. *Use 680 Ω* in the part's inspector puts it in. The *Bias* button in the toolbar hides the marking, and exports never show it.
- **Measured anode current.** Enter what your real tube draws in the circuit as drawn, and the model's emission is fitted to it first: the value found is for that tube. The engine's tube elements take an `iScale` factor for this.


## [3.53.0] - 2026-10-13

### Added
- **Power transistors for amplifier output stages, with their models**, as complementary pairs:
  - bipolar drivers 2SD669A/2SB649A, 2SC4793/2SA1837, MJE15032/MJE15033, TIP41C/TIP42C;
  - bipolar outputs 2SC5200/2SA1943, MJL3281A/MJL1302A, MJL21194/MJL21193, and in TO-3 MJ15003/MJ15004, MJ15024/MJ15025, 2N3055/MJ2955;
  - MOSFETs IRFP240/IRFP9240, IRFP250, IRFP460, and the laterals 2SK1058/2SJ162 and ECX10N20/ECX10P20.
  The models are fitted to the datasheets: hFE and its fall at high current (a test checks each part's hFE inside its datasheet range at the datasheet's own test point), VBE(on), output capacitance; for MOSFETs threshold and gfs (laterals: about 3 A at 4–5 V). The bipolar model has no emitter or base resistance, so VBE at several amperes reads somewhat low.
- **Board footprints TO-3P and TO-264** (5.45 mm pitch, larger pads), with 3D bodies; each new part gets its package and pinout (B-C-E for the TO-264 and TO-220 pairs, G-S-D for the Hitachi laterals). TO-3 parts default to three wire pads: the can is the collector and sits on the chassis heatsink.

## [3.52.1] - 2026-10-13

### Fixed
- **The status line and its progress bar no longer flicker when two simulations run at once.** A steady-state run and the oscilloscope's power-on transient each wrote their own progress to the CAD's status line in turn, so the text and the bar jumped between the two (and the oscilloscope's status, which mirrors it, with them). Both now share one line ("Simulating until settled: 40 % · Power-on transient, first 1 s: 25 %") with one bar for the lower readiness; when one finishes, the other carries on alone.

## [3.52.0] - 2026-10-13

### Changed
- **Simulation is several times faster: the steady state is found by shooting, and the matrix solves are sparse.** The 10-tube stereo EL84 amplifier settles in 1.6 s in the browser (13 s in 3.51.0, 36 s before it); two of them in one circuit in 4.7 s in Node (29 s).
  - **Shooting.** The steady state is the state that one period maps onto itself; Newton's method (Newton–GMRES on the one-period map, each direction one simulated period; Levenberg–Marquardt damping) finds it in a few dozen periods where repeating periods took hundreds (10-tube amplifier: 42 periods, was 128). Each part of the state is weighed by its size over a period. The old settling (vector extrapolation) remains as the fallback. That extrapolation's result swung with rounding (the same circuit took 128 or 230 periods); shooting does not.
  - **Sparse solver.** The engine stamps into a sparse matrix and solves with a sparse LU (Gilbert–Peierls left-looking, minimum-degree column order on the pattern seen, partial pivoting). Its numeric part is the WebAssembly kernel now (`wasm/solver.ts` → `sim-solver.wasm`), bit for bit the same as its JavaScript fallback. Work grows about linearly with the circuit, not with its cube.
  - **Live mode** (while editing) now settles the 10-tube amplifier within its 2.5 s, which it never did.
- Results agree with 3.51.0 to within 0.1 % (the largest difference: 0.03 V on a 340 V node); all 76 reference comparisons pass.
- When the settling hands over to the full-resolution steps, Gear-2's previous step is interpolated along the last coarse step instead of restarting with a backward-Euler step.

## [3.51.0] - 2026-10-13

### Changed
- **The simulator's linear solver runs as WebAssembly: about 2.7 times faster on a big circuit.** The dense LU solve on every Newton iteration took about three quarters of a run's time. It is now `wasm/solver.ts` (AssemblyScript), built into `sim-solver.wasm` by `npm run build:wasm`, which the simulation worker loads. Same steps in the same order, row updates two elements at a time with SIMD, so results are bit for bit the same as before. The 10-tube stereo EL84 amplifier settles in 13 s instead of 36 s. Where WebAssembly SIMD is missing, or the file does not load, the JavaScript solver does the work as before. CI checks that the committed `.wasm` is the one its source builds.

## [3.50.0] - 2026-10-13

### Added
- **The open file's name in the toolbar**, next to the logo, and in the browser tab's title. A yellow • marks changes not saved yet (the board's too, since it is saved with the circuit); it goes when the file is saved, or when the circuit is back as it was. A new circuit or an example reads "Untitled". The name and the mark come back after a reload.

## [3.49.0] - 2026-10-13

### Changed
- **Sheet connectors: shorter zone references.** The zones where a connector's partners lie are written one row letter per group with its columns after it: "B2, A3, A5, B5, D2, E2, D3, D5, E5, B8" becomes "A3,5 B2,5,8 D2,3,5 E2,5" (on several sheets: "1/A3,5 2/C1,4").
- **Supply rails show no zone list.** A connector name used five times or more (B+, a filtered rail, a bias line) reads as a rail; listing every other place it is used on every one of its connectors only cluttered the drawing. Hovering a connector shows all its partners' zones in the status bar.

## [3.48.3] - 2026-10-13

### Fixed
- **Board Design: a route can go on from its own via.** After V (via, other layer), the next segment was refused as "too close to a via on no net": the new via is not joined to its net until the route ends, so the check took it for foreign copper. The route now ignores its own vias.
- **Board Design: Esc right after V removes the unused via**, unless it already joins copper or a pour on the new layer (a via down to the ground plane stays). Before, it stayed on the board, and when nothing had been routed yet it was not even in the undo history.
- **Board Design: a via that joins nothing, or copper on one layer only, is reported** by the design-rule check (as loose track ends already were).
- **Board Design: the first corner of a route no longer ends it on the route's own copper.** Clicking a corner over a track already joined to the start ended the route there, joining nothing. Later in the route such a click still ends it (a deliberate loop back onto the net).
- **Board Design: small electrolytics (Ø5 mm / 2 mm and Ø6.3 mm / 2.5 mm pitch) take 1.6 mm pads with a 0.8 mm drill**, as KiCad's CP_Radial do; the 1.8 mm pads left only 0.2 mm between them. The footprint test now asks every footprint for more than 0.2 mm between pads.

## [3.48.2] - 2026-10-13

### Fixed
- **Capacitors below 1 nF showed as "0F"**, on the schematic and on the board (a 100 pF compensation capacitor read 0F). The formatter's zero cut-off for solver round-off now applies only to other units, so picofarads (and small inductances) show their value.
- **Board Design: tracks into neighbouring pins of a small transistor.** Two 1 mm tracks ending in adjacent TO-92 pins are 0.27 mm apart where they enter the pads, so the router refused the second one and the check reported a clearance error, even though the pads themselves are only 0.22 mm apart. Now only the parts of the tracks outside their pads must keep the clearance; inside, the limit is the pads' own spacing. Tracks that leave adjacent pins side by side are still reported.

## [3.48.1] - 2026-10-13

### Fixed
- **Board Design: TO-92 transistors no longer short their own pins.** The footprint's round 1.4 mm pads sat on the 1.27 mm pin pitch, so neighbouring pads overlapped; a track to the base also joined the emitter and the check reported a short. The pads are now 1.05 × 1.5 mm ovals (as in KiCad's TO-92_Inline), 0.22 mm apart. The pitch leaves a 0.15 mm ring across the oval, so the annular-ring rule skips these pads. A unit test now checks that no footprint has touching pads.
- **Board Design: dragged parts land exactly on the grid** (no more positions like 41.910000000000004 mm in the inspector).

## [3.48.0] - 2026-10-13

### Fixed
- **Board Design: routed tracks join up where they should.**
  - **Pads off the grid.** Tracks used to get a small 45° jog next to pads
    off the 1.27 mm grid (tube sockets, 15 mm and 7.5 mm lead spacings).
    Corners now line up with the net's pads and vias when within half a grid
    step, so tracks run straight in.
  - **Starting on a track or via.** A route started on a track began at the
    nearest grid point, which could miss the track. It now starts on the
    track's centre line (or at its corner) or at the via's centre.
  - **Ending on a track or via.** A route ended only on a pad. A click on the
    net's own track or via now ends it there, on the track's centre line,
    where a straight or 45° line from the last corner meets it.
  - **Ctrl+Z while routing** takes back the last corner. It used to undo an
    earlier, finished track while the route stayed open.

### Added
- **Board Design: track ends follow a moved part** (drag, arrows, several at
  once), so its connections hold.
- **Board Design: the route bends the other way by itself** (diagonal first)
  when straight-first would come too close to something. <kbd>/</kbd>
  switches between the two by hand.

## [3.47.1] - 2026-10-13

### Fixed
- **Board Design: the board would not move on the sheet once it had a
  whole-board copper pour** (such as the GND plane). The pour's outline, 0.5 mm
  inside the edge, took the click. The board's edge now wins on the line and
  just outside it; the pour is picked a little further in.

## [3.47.0] - 2026-10-13

### Added
- **Board Design: move the board on the drawing sheet.** Drag the board's
  edge: the board slides over the sheet, which stays still and is locked.
  The board inspector shows the origin's position from the sheet's bottom-left
  corner, takes new X / Y values, and has *Centre on the sheet* to put the
  board back above the title block.

## [3.46.0] - 2026-10-13

### Added
- **Board Design: the drawing sheet's format on the toolbar:** auto, A4–A0
  landscape or portrait, or no sheet.
- **Board Design: Lock sheet.** A locked sheet keeps its format and its place
  when the board grows or shrinks; unlocked, it follows the board as before.
  A new format re-centres a locked sheet round the board, and it stays locked.

### Changed
- **Board Design: the origin is now the board's bottom-left corner, X to the
  right and Y up**, as in the Gerbers and the drill file. This applies to:
  - the status bar, the inspector's X / Y fields and Measure's Δy;
  - the axes, and the grid, which runs from the origin.

  The resize handle is now the top-right corner, so the origin and everything
  on the board stay put when the board is resized (in Setup… too). Saved
  boards open unchanged.

## [3.45.0] - 2026-10-12

### Added
- **Board Design: Measure sticks to the board.** Its ends snap to:
  - the centres of pads, vias and holes;
  - track corners and ends;
  - the board's corners, edge middles and centre;
  - pour and keep-out corners, texts and part origins;
  - failing those, the nearest point of a track, a hole's rim or the board
    edge.

  A marker shows the snap point and its name. The readout adds the angle and
  says what each end stuck to. <kbd>Shift</kbd>+click measures on the grid
  only.
- **Board Design: X / Y axes** through the board's origin, with a millimetre
  scale that stays at the screen edge when the origin is off screen
  (<kbd>A</kbd> or the Axes button).
- **Board Design: a screen grid** of lines, with every tenth line stronger.
  Dots or off are the other choices (<kbd>G</kbd> or the toolbar). The choice
  is kept in the browser.
- **Board Design: a drawing sheet** round the board, with the Circuit CAD's
  ISO 5457 frame, reference grid and ISO 7200 title block:
  - the title block's fields come from the schematic's first frame, with
    document type "PCB layout";
  - *Setup…* sets the size (Auto picks the smallest sheet that fits; A4–A0;
    None) and the orientation;
  - the status bar shows the pointer's grid zone (e.g. B3);
  - <kbd>Shift</kbd>+<kbd>F</kbd> fits the whole sheet.

## [3.44.0] - 2026-10-12

### Added
- **Mirror for the oscilloscope** (M, the toolbar button or the inspector's
  Mirror field). Its CH1, CH2 and COM inputs and their names move to the
  right-hand side, so the scope can sit left of what it measures. The screen
  stays upright and readable, and the scope still does not rotate.

## [3.43.0] - 2026-10-12

### Added
- **Example: Gubin's three-tube amplifier** (File → Examples), drawn from
  Igor Gubin's article on radionic.ru:
  - stereo single-ended, 6N23P-EV (one triode per channel) direct-coupled to
    6P14P;
  - the two-section pentode / triode switch;
  - feedback from the output transformer's secondary to the first cathode;
  - the +350 V and +275 V supply rails.

  Simulated into 4 Ω: 3.4 W at 1.9 % THD, 5 W at 10 %. Notes on the sheet
  give the supply, the output transformer's data, and how the simulation
  compares with the article's operating points.

## [3.42.0] - 2026-10-12

### Added
- **File → Examples**: the five circuits drawn from published sources and
  checked against them:
  - 12AX7 with a plate resistor vs a current source (Broskie);
  - 12AX7 stage with an IRF820 follower (GE data sheet);
  - the 10 W MOSFET amplifier;
  - the 2N3904 stages with RE unbypassed and bypassed (University of
    Washington).

  An example opens untitled, so *Save* asks for a new name, and Ctrl+Z
  brings back the previous circuit.

## [3.41.0] - 2026-10-12

### Added
- **Import SPICE model…** (a tube's inspector) adds any tube model as a tube
  of your own: Koren, Ayumi, Duncan, Reefman or a maker's library.
  - Paste the subcircuit or open the file; it runs as written, behavioural
    sources and all, with `.PARAM`, `.FUNC`, internal nodes (grid-current
    networks) and the usual functions.
  - Pin roles come from the model's comment, or from how it behaves; the
    dialog draws its curves with µ, gm and rp as you set them.
  - Each imported tube is "like" an existing one (socket, pinout, heater)
    with its own Pa and Va maximums.
  - It is kept in the browser and inside every circuit file that uses it;
    the curve tracer, the Board window and the SPICE netlist export know it.
  - Koren's published 12AX7 model reproduces the built-in Koren equations;
    imported models simulate about half as fast as the built-in ones.
- **Loudspeaker model:** the speaker can be a Thiele–Small driver (Re, Le,
  fs, Qms, Qes) instead of an ideal resistor, with typical guitar and hi-fi
  drivers to start from and its impedance and phase curve in the inspector.
  A speaker placed now starts as a typical 8 Ω 12″ guitar speaker; circuits
  saved before keep their resistor.

### Changed
- **Transient simulation uses Gear's second-order method (BDF2)** instead of
  backward Euler (which stays for a first step and for rescue sub-steps).
  - Backward Euler damped resonances: a loudspeaker's impedance peak came
    out 9 % low.
  - BDF2 keeps them at their true Q and still does not ring at a rectifier's
    switching.
  - The 76 comparisons with published circuits all still pass; an RC
    filter's gain now comes out at exactly 0.707.
- Output power into a speaker is now the average of voltage times current
  (true power into a reactive load).
- The tube dissipation warning uses the plate's average dissipation over the
  signal cycle when a signal runs, the figure that matters with a reactive
  load. Before, it used the DC operating point only.

## [3.40.0] - 2026-10-12

### Added
- **3D view of the board** (*3D* button, or <kbd>3</kbd>):
  - every part has a body: resistors and diodes with their leads, film,
    disc and electrolytic capacitors, transistors, LEDs, pots, valves in
    glass on their sockets, EI transformers and chokes, terminal blocks,
    jacks, switches;
  - the board's top and bottom faces carry the real copper, tinned pads,
    silkscreen and holes;
  - drag to turn, right-drag to move, wheel to zoom; Iso, Top, Bottom, Front
    and Side views; parts and valves can be hidden; *Save PNG*.
- **3D view of each part:** the inspector shows the selected part in 3D on a
  piece of board with its pads, turning slowly (drag to turn it), and
  follows a footprint change.
- **Export → 3D model (STEP)** (and *Export STEP* in the 3D view): STEP AP214
  of the board with its holes and every part, in colour, for a chassis in
  FreeCAD, KiCad or any mechanical CAD. Each body is a closed B-rep;
  OpenCascade reads every solid as valid, with its colour.

### Changed
- The Board window's title is shortened to "Board", and the status text
  shrinks, so the toolbar with its new 3D button stays on one row.

## [3.39.0] - 2026-10-09

### Added
- **Board Design — several things at once:**
  - box selection (left to right: what lies inside; right to left: what it
    touches), and Shift+click to add or remove;
  - drag any selected item to move them all;
  - R turns the group 90° about its middle (bottom-side parts turn the right
    way);
  - the arrow keys nudge (Shift: ten grid steps);
  - Align left / centre / right / top / middle / bottom, and Spread across /
    down, for the selected parts.
- **Locking** (L): locked parts, tracks, vias, texts, holes, pours and
  keep-outs cannot be dragged, nudged, turned or deleted, and show a
  padlock. The mounting holes from Board setup come locked.
- **Keep-out areas** (K): per layer, forbidding tracks, vias, copper pour and
  optionally parts. Routing refuses to enter them, pours leave them empty,
  and the check reports anything inside.
- **Track width for the current:**
  - the CAD sends each pin's DC current from the simulation, and the check
    reports tracks narrower than IPC-2221 asks (outer layer, the board's
    copper weight, an allowed warming set in the rules, 10 °C by default);
  - routing starts wide enough on its own;
  - the Nets tab and the track inspector show the current.
- More checks: overlapping parts (courtyards), silkscreen over pads and
  unconnected track ends (warnings).

### Changed
- Pours and keep-outs are picked by their outline, so a click inside a
  ground plane can start a selection box.
- The Board window's link back to the schematic is now "CAD ↗", so the
  toolbar fits on one row at 1600 px.

### Fixed
- Seven footprints had silkscreen over their own pads: TRIM-3296W, LED-3MM,
  TO-220 and TO-247 (the body is now drawn behind the pins, as on the real
  part), and JACK-3.5. A test now checks all 117 footprints.

## [3.38.0] - 2026-10-09

### Added
- **Gerber + drill files** for a board maker, as one ZIP:
  - copper, solder mask and silkscreen of both sides, and the outline
    (RS-274X with X2 attributes);
  - plated and non-plated Excellon drill files;
  - a README with the board's specification.

  Checked with an independent Gerber reader (pygerber).
- **Print set (PDF)**: assembly drawing, top and bottom copper at 1:1, and a
  drill map with its table. A 50 mm bar on each page checks the printer's
  scale.
- **Toner transfer (PDF)**: the top copper mirrored, the bottom copper
  unmirrored.
- **Copper pours** (*Pour* tool, *+ GND plane* for the whole bottom layer):
  - clearance by net class to everything else, the edge and mounting holes;
  - thermal reliefs on the pour's own pads;
  - islands removed;
  - real connectivity (the ratsnest counts what the pour reaches);
  - stitching vias take the pour's net;
  - corners can be dragged.
- **Nets** tab: class, connections left to route and track length per net.
  Click a net to highlight it (or press <kbd>`</kbd>).
- **Cross-probing** between the board and the schematic: selecting a part in
  one selects it in the other.
- **Live clearance while routing:** a halo shows the needed clearance. A
  segment that would come too close is refused (Shift+click places it
  anyway).
- **Track editing:**
  - drag a segment sideways and its neighbours keep their 45° directions;
  - <kbd>U</kbd> selects the whole connected track;
  - Shift+click adds tracks to the selection;
  - set the width of all selected tracks at once.
- Solder-mask rules: the opening around pads, and covered vias.
- Silkscreen and copper text use a stroke font, so the screen shows what the
  Gerbers contain (Ω and µ included).

### Changed
- A track entering a tube pin may pass that socket's other pins as closely as
  the pin itself does. The high-voltage clearance is otherwise impossible to
  meet between noval pins, which are 1.3 mm apart.

### Fixed
- The old "bottom copper, mirrored, for transfer" SVG had toner transfer the
  wrong way round. For toner transfer the top copper must be mirrored and the
  bottom copper not. The Toner transfer PDF does it right; the separate
  top/bottom copper SVGs are replaced by the PDFs.

## [3.37.0] - 2026-10-09

### Added
- **Through-hole footprints for every part** in Board Design. Before, the
  transformers, chokes, switches, speaker, mains, supplies and the signal
  generator only got wire pads. Now each part has a real footprint by
  default:
  - board-mount EI transformers and chokes, EI30–EI96, pins named as in the
    schematic;
  - toggle switches SPDT / DPDT;
  - screw terminals 5.08 mm and 7.5 mm (mains);
  - RCA, 3.5 mm and 6.35 mm jacks.
- More choices for the other parts: pots 9 and 24 mm, a 3296W trimmer,
  ceramic disc / silver mica and axial film capacitors, snap-in and axial
  electrolytics, DO-201 diodes, 3 mm LEDs, TO-247.
- Wire pads and screw terminals stay available for parts mounted on the
  chassis.

## [3.36.0] - 2026-10-09

### Added
- **Board Design** (PCB) window, opened with *Board ↗* in the CAD. It takes
  its parts and nets from the schematic and is saved inside the circuit file.
  - Through-hole footprints: axial resistors by power rating, film boxes,
    radial electrolytics, TO-92/18/126/220 with each part's pinout, LEDs,
    pots, tube sockets (B9A, B7G, Magnoval, octal, UX4) with dual-tube
    sections sharing one socket, and wire pads for chassis parts.
  - Placement with rotate and bottom side, *Place all on the board*, and an
    update banner when the schematic changes.
  - 45° routing on two copper layers with vias, ratsnest, net highlight.
  - Tools: Select, Route, Via, Text, Mounting hole, Measure; corner handle
    resizes the board.
  - **Design rules** window: clearances (separate high-voltage clearance),
    edge clearance, track widths, via and drill sizes, annular ring, which
    checks run, and **net classes** (Signal / Power / HV, automatic from the
    simulated DC voltage or set per net).
  - Live design-rule check: clearance (also to mounting holes), shorts,
    board edge, annular ring, drill, minimum and class track width,
    unplaced parts, pinouts to verify.
  - **Board setup** window: size, corner radius, mounting holes in the
    corners, board thickness and copper weight.
  - **Layers** panel: show, hide or solo each layer, pick the active copper
    layer, dim the inactive copper.
  - Export: board SVG at 1:1, top copper, mirrored bottom copper, board JSON.

## [3.35.1] - 2026-10-09

3.35.0 was tagged but never published: a timing-dependent test failed on the
release machine. 3.35.1 makes that test independent of timing and contains
the same changes:

### Added
- **Logarithmic frequency axis** in the spectrum analyzer (*Frequency axis*
  setting). Decade lines at 1…9 × 10ⁿ, with labels placed where they fit.
  Wheel zoom and dragging work in decades, and the frequency under the
  pointer stays put. Mains hum (50/100 Hz) and the harmonics are now
  readable in one view.
- **Progress on ▶ Simulate:** the button shows how far a run has got
  ("■ Stop · 48 %" for a full run, "▶ Simulate · 8 %" for a live one), with
  a bar along its bottom edge.

### Changed
- **A circuit with several sheets opens on sheet 1** instead of showing all
  sheets small. The Sheet list, or pressing F a second time, still shows
  them all.
- **Curve tracer:** the simulated load line is the last whole cycle of the
  signal, drawn thin with three direction arrows. Before, it showed every
  cycle of the capture, and with a rectified supply the ripple moved each
  one slightly, so they smeared into a thick band.
- **Oscilloscope:** an unconnected channel's settings are greyed out and
  its title says "not connected".

### Fixed
- Oscilloscope: the empty strip under the screen in steady state is gone.
  The hidden power-on overview had still taken its 50 px.

## [3.34.0] - 2026-10-09

### Added
- **One search box for every part** at the top of the palette. It finds
  part names, part numbers (2N3904, IRF540, 1N4742A, 125ESE, 373BX …),
  tubes (EL84, 6N2P, 300B …) and values: "47k" offers a 47 kΩ resistor or
  potentiometer, "100n" a 100 nF capacitor, "47u" a capacitor or
  electrolytic, "5H" a choke, "300V" a supply. Enter picks the first match,
  Esc clears the search.
- **Collapsible palette groups:** click a group title to fold it, and the
  browser remembers the state. Transformers, Semiconductors, Instruments,
  Document and Tubes start folded, so the palette fits a Full HD screen.
  The Tubes group lists the popular tubes, with *Show all 99 tubes*.
- **Help window** (F1, ? or the ? button): how-to and every keyboard
  shortcut. It replaces the long how-to text in the inspector.
- **Power summary** in the inspector when nothing is selected: output into
  the speakers, tube, transistor and resistor dissipation, and the power the
  DC supplies deliver.
- **Mirror button in the toolbar**, and drawn icons for undo, redo, rotate,
  mirror and delete in place of characters and emoji that looked different
  on every OS.

### Fixed
- **Safari:** every dropdown (tube type, model, sheet list, all scope and
  analyzer settings) showed white boxes with near-invisible text. The pages
  now draw their own dark dropdowns, the same in every browser.
- The Mirror field was blank for parts saved before Mirror existed. It now
  shows "No", and a dropdown whose saved value isn't in its list shows the
  default.
- The inspector's Rotate / Mirror / Delete buttons no longer overflow its
  default width.

## [3.33.0] - 2026-10-09

### Added
- **Resizable side panels in every window:** the CAD's parts palette and
  inspector, the curve tracer's tube list and readout, and the oscilloscope's
  and spectrum analyzer's control panels. Drag a panel's edge to resize it,
  or double-click the edge to reset it. Each window remembers its widths. A
  panel stops before the schematic or screen gets too narrow (360 px). On
  narrow screens, where the panels stack, the layout stays as before.
- **D** duplicates the selection, like Ctrl+D.

### Fixed
- **Keyboard shortcuts work in any keyboard layout.** With a Russian (or
  other non-Latin) layout active, R, M, W, V, F, B and the Ctrl shortcuts
  (Z, Y, S, O, C, V, D, A) did nothing, because they were matched on the
  typed character ("к" instead of "r"). They now go by the key's position,
  as printed on a US keyboard.

## [3.32.0] - 2026-10-09

### Added
- **Mirror (M) for every part that can be rotated:** resistors,
  capacitors, chokes, switches, transformers, tubes, sources, diodes,
  transistors and any part added later. Only the oscilloscope, the drawing
  frame and text notes can't be mirrored. Use the *M* key (also while
  placing), the *⇋ Mirror* button or the *Mirror* field in the inspector.
  Text inside a symbol (the switch's A/B, the generator's G) stays readable,
  and tube pin numbers and polarity marks move with their pins. A mirrored
  tube's designation moves above the control grid, which is now on the
  right.

## [3.31.0] - 2026-10-09

### Changed
- **Voltage and current stickers no longer cover anything.** Each sticker
  goes where it covers no text, no part symbol and no other sticker. The
  drawing records every text it prints (designations, values, pin numbers,
  connector names, notes, the title block), and the placement tries every
  wire of the net, or every segment of the current's run, at several points
  and on both sides. A sticker crosses a wire only when nothing else is
  free. When there is no free spot at all, it is left out: hovering the wire
  still shows its voltage and current. Placement is recomputed only when the
  circuit or the result changes, so panning and zooming stay fast.

### Added
- **Mirror (M)** for transistors and MOSFETs: flips the symbol left to
  right, so a part can take its base or gate from either side with the
  collector or drain up or down. It's also a field in the inspector. A
  complementary output pair can then be drawn without crossing wires.
- Parts: BC107 (NPN) and BC177 (PNP), and the IRF540 / IRF9540 power
  MOSFETs. MOSFET thresholds are the middle of each datasheet range, and Kp
  comes from its gfs (IRF540 2.2, IRF9540 1.75 A/V²).

## [3.30.0] - 2026-10-09

### Added
- **Scale labels on the oscilloscope screen.** The time axis runs below the
  graticule: time from the trigger point in steady state, time after
  power-on in the power-on view. CH1's volts are on the left and CH2's on
  the right, each with its own volts/div and offset. In AC coupling they
  show volts around the mean. In X-Y mode CH1 is along the bottom and CH2 up
  the side. The labels follow zoom and position:
  - wheel, Ctrl+wheel, dragging, the Time/div and Volts/div lists and
    Autoset all move them;
  - they always sit on round values, whole multiples of the time/div or
    volts/div, so after zooming at the pointer they shift with the trace
    rather than showing odd numbers;
  - all labels on one axis share one unit prefix.
- The power-on overview strip lines up with the screen's grid.

### Fixed
- The channel level markers (1▸, 2▸) on the left of the scope screen are
  visible again in steady state. The screen's clipping had hidden them.

## [3.29.1] - 2026-10-09

### Changed
- **MOSFET models follow their datasheets more closely.** The threshold is
  now the middle of the datasheet's min–max range (IRF510/820/840 3.0 V,
  IRF9610/9640 −3.0 V, BS250 −2.25 V). Kp comes from the forward
  transconductance at the datasheet's test current, Kp = gfs² / 2·Id
  (IRF510 0.25, IRF820 0.75, IRF9640 1.27, 2N7000 0.26, BS170 0.1,
  BS250 0.056 A/V²). Saved circuits with these parts simulate differently.
  Checked against a published IRF820 follower: 3.5 mA and 0.47 W, as in the
  source.

### Fixed
- Transistor and MOSFET designations sit beside the symbol, on the side away
  from the base or gate lead. Above the symbol, the collector or drain lead
  ran through the text.

## [3.29.0] - 2026-10-09

### Added
- **Locked sheet frames.** A drawing frame can no longer be dragged or
  deleted by accident. You can still click it to edit the title block. The
  status bar says why it stays put, and a padlock in the filing margin shows
  the lock. To move or delete a frame, set *Position* to *Unlocked* in its
  inspector. Frames are locked by default, including those in older files.
- **File → Export sheet… (PDF / PNG).** Export *this sheet* (the selected,
  last clicked or most visible one), *each sheet as its own file*
  (`name-sheet1.pdf`, `name-sheet2.pdf` …), or all sheets in one PDF as
  before.
- **PNG export** at 150, 300 or 600 dpi, black on white like the PDF or in
  the editor's colours, one image per sheet. Very large sheets are reduced
  to fit the browser's canvas limit, and the status bar says so.

## [3.28.0] - 2026-10-09

### Added
- **Transistors and more semiconductors** in the Semiconductors palette, all
  simulated with the rest of the circuit (DC, transient, steady state):
  - NPN: 2N2222A, 2N3904, BC547B, BD139, MPSA42, MJE340. PNP: 2N2907A,
    2N3906, BC557B, BD140, MPSA92, MJE350. Gummel-Poon model (gain, Early
    voltage, high-current knee) with junction capacitances. The models for
    2N2222A, 2N3904, 2N3906 and 2N2907A use the published SPICE parameters;
    the others are set to their datasheet's typical gain.
  - N-channel MOSFETs: 2N7000, BS170, IRF510, IRF820, IRF840, and the
    depletion DN2540 and LND150 for current sources. P-channel: BS250,
    IRF9610, IRF9640. Square-law model with body diode and gate
    capacitances.
  - Zener diodes 1N4733A … 1N5388B (5.1–200 V, 1 W and 5 W), and LEDs
    (red, yellow, green, blue) for cathode bias.
  - IEC 60617 symbols. The letter codes are VT for transistors, VD for
    zeners and HL for LEDs.
  - The inspector shows each transistor's operating point (Vce/Vds, Vbe/Vgs,
    Ic/Id, Ib, hFE) and its dissipation against the rating. The checks flag
    over-dissipation and voltage beyond Vceo / Vds. SPICE export writes Q
    and M elements with their `.model` lines. The BOM lists the ratings and
    the simulated dissipation.
- **Current stickers on the wires.** Each run of wire shows its DC current
  and direction (for example "↓1.38mA") next to the voltage tag. The
  *Currents* button turns them on and off, and hovering a wire shows its
  current in the status bar. Currents come from every part's terminal
  currents, averaged over the window for rectified supplies, and are passed
  along the wiring, so a junction shows how the current splits.

### Fixed
- The solver could accept an iteration in which a diode's junction voltage
  had just been limited as converged. A diode could then stay off when it
  should conduct (seen with LEDs).

## [3.27.1] - 2026-10-09

### Changed
- **The BOM follows the selection.** Selecting a part on the schematic
  scrolls the bill of materials to its line, which is highlighted and flashes
  briefly. Opening the panel with a part selected shows its line too.

## [3.27.0] - 2026-10-09

### Added
- **Bill of materials.** The *BOM* button in the toolbar (also File → Bill of
  materials, or the `B` key) opens a parts list in a panel under the
  schematic; drag its top edge to resize it. Equal parts share a line with
  their designators as ranges (R1-R4, R7), the sections of a dual tube or a
  ganged switch (VL1.1, VL1.2) count as one part, and a line per tube base
  lists the sockets. Columns: item, quantity, designators, description, value,
  rating / data (resistor wattage, choke DCR, transformer rating, tube base),
  the simulated worst case (resistor dissipation, flagged beyond its rating;
  capacitor peak voltage; a reversed electrolytic is flagged) and a part
  number. Type the part number in the list or in the inspector; it is saved
  with the circuit, and parts with different numbers get separate lines.
  Clicking a line selects its parts. Sources and instruments are left out
  unless *Sources & instruments* is ticked.
- **BOM export** as TXT (aligned table), CSV (UTF-8, opens in Excel), XLSX
  (Excel workbook with frozen header and filter) or PDF (A4 landscape), named
  after the title block's identification number.

## [3.26.0] - 2026-10-08

### Changed
- **Fit (button or F) fits the sheet you are working on**, without choosing
  it in the Sheet list first. It picks the sheet with the selected part or
  wire, else the sheet you clicked last (while it is on screen), else the sheet
  that fills most of the view. Pressing Fit again when that sheet already
  fills the view shows all sheets, and so does Fit with no sheet on screen.

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
