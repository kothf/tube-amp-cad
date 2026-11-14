# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [3.220.0] - 2026-11-14

General-purpose simulation, part 2: the Transient tab's waveform viewer.

### Added
- **Currents and expressions as traces.** The box next to *+ Plot a net* takes `I(R3)` (into a two-pin part's first pin), `I(Q1.C)` (into one pin), `V(OUT,IN)`, and arithmetic over the run: `+ − * / ^`, SPICE number suffixes, `abs sqrt exp ln log10 db sin cos tan atan sgn min max pow`, `d()` (derivative), `integ()` (running integral), `time`, `pi`. Units follow (V·A = W, V/A = Ω, d(V) = V/s, ∫A = C) and label the axes, the readout, the table and the CSV. A mistake is named before it becomes a trace. The list offers every net and every part's current.
- **Panes.** *+ Pane* adds a chart with its own scale under the others; traces go to the pane picked, ⇅ moves one, × removes a pane. The panes share the time axis, zoom and cursors.
- **FFT.** A pane shows its traces as a spectrum (dB, log frequency) over the time shown or from cursor A to B, Hann-windowed so a sine reads its own amplitude; the strongest line of each trace is named.
- **Cursors A and B.** Click for A, Shift+click for B: their times, Δt and 1/Δt; the table adds each trace at A, at B and B − A, and its figures cover A to B.
- **Reference run.** *Keep as reference* keeps the traces; later runs draw them dashed under the new ones.
- The engine's free transient records every part's terminal current when asked (`opts.currents`, `result.pinI`; a capacitor's from its charge over the step).

### Tests
- `tests/wavemath.test.mjs`: parsing, units, d/integ, error messages, the FFT against a sine and a square's harmonics, and recorded currents against an RC's exact current.
- e2e (Transient tab on example 08): a second pane with a resistor's current and an expression of it, a typo refused, the FFT's peak at the 555's frequency, cursors A/B with Δt and their columns, a reference run drawn dashed.

## [3.219.0] - 2026-11-14

Board design plan, phase B4: impedance, differential pairs and matched lengths.

### Added
- **Impedance calculator** (Board ▾): a track's Z₀ and a pair's Zdiff on each copper layer from the layer stack (microstrip outside, stripline inside; Hammerstad-Jensen and IPC-2141A), delay per mm, and the width for a Z₀ or the gap for a Zdiff.
- **Board setup → Dielectric εr and Dielectric (mm)**: the thickness of each dielectric between copper layers as the fab lists it (empty: the board's thickness shared out); the KiCad stackup uses them.
- **Differential pairs** in Design rules: two nets with width, gap (allowed between the two even below their class's clearance) and skew, with the pair's Zdiff on the top layer; nets named like pairs are offered first. The pair's width goes before its class's; the check reports skew beyond the limit.
- **Length groups** in Design rules: nets whose routed lengths must match within a tolerance of the longest or of a target; the check reports the short ones, the Nets tab shows the lengths.
- A track's right-click menu: **Route the partner alongside** (the pair's other track at the gap, from and to its nearest pads) and **Add a meander** (a serpentine adding just the missing length, clear of other copper).
- KiCad export: pair width, gap and skew, and length groups (skew or a length window) as custom rules; the first pair's width and gap on the net classes.
- `board-hs.js` (no DOM) with `tests/hs.test.mjs`.

## [3.218.0] - 2026-11-14

Board design plan, phase B3: push and shove.

### Added
- **Push and shove while routing** (Route ▾ → *Push and shove*, Shift+X, on by default). When only other nets' tracks are in the way of the track being placed, they step aside instead of refusing the click: the part beside the new track moves out by just the clearance it lacks, with a 45° jog in and out, its ends staying put; a jog that would run past a bend moves the bend. Pushed tracks push the next ones in turn (a chain).
- Pads, vias, holes, keep-outs, locked tracks and track ends never move; a push that would need them to, or would cross two tracks, moves nothing, and the status line says why. The pushed tracks are drawn where they would go while the pointer moves (their old place faint); Backspace past that corner puts them back, and the whole route is one Ctrl+Z step.
- `board-shove.js`: the shove itself, deterministic and tested on its own (`tests/shove.test.mjs`).

## [3.217.0] - 2026-11-14

General-purpose simulation, part 1: a free transient analysis with time sources.

### Added
- **Transient tab** (*Analyze ▾ → Transient*): the circuit run in time with its own stop time, maximum step and record start, from the operating point or from zero (`uic`), with initial conditions (`out=4 C3.1=0`).
  - Traces by net, connector, scope channel or part pin; a chart with min/max per pixel, cursor readout, drag zoom and double-click to show all; min, max, p-p, average, RMS and end value per trace; *CSV* export of every trace.
  - Runs in a worker, with a progress line and *Stop*.
- **Signal generator waves for the time domain**: pulse (low and pulsed level, delay, rise, fall, width, period), piecewise linear (time-value pairs, repeating or not), exponential (SPICE EXP) and FM (SPICE SFFM). The SPICE export writes them as PULSE, PWL, EXP and SFFM.
- **SPICE part sources**: `PULSE`, `SIN`, `EXP`, `SFFM` and `PWL` (with `r=` and `td=`) on V and I lines, and `time` in B-source expressions. They play in the Transient tab; the other analyses take their DC value, and the part says so.

### Changed
- The engine's transient takes variable steps: the error of each step is estimated from a predictor through the last three states, steps grow at most ×2, and the corners of every source are breakpoints (the step restarts small after each). Linear capacitors and inductors are integrated by the trapezoid rule (an LC ring keeps its amplitude), the rest by variable-step Gear-2.

### Tests
- `tests/transient.test.mjs`: source shapes and corners, RC and LC against the closed form, `.ic`, `uic`, record start and thinning, SPICE source lines and `time`, generator waves, the tab's helpers.
- `tests/transient-ngspice.mjs` (in `npm run test:ngspice`): ten benches against ngspice's `.tran`, every probe within 1 % of its swing at 400 instants (2 % for an RLC ring of Q 30 and a BJT switch).
- e2e: the Transient tab on example 08 (the 555's frequency from the edges, initial-condition errors, traces, zoom, CSV, the pulse fields and the export).

## [3.216.0] - 2026-11-14

Board design plan, phase B2: 4 and 6 layers.

### Added
- **4- and 6-layer boards.** Board ▾ → Board setup… → *Copper layers* 2, 4 or 6. Each inner layer (In1.Cu next to the top) is a signal layer or a plane of one net (In1 starts as a GND plane, the others as signal layers), with its own inner copper weight.
- **Planes and split planes.** A plane is a whole-layer pour of its net: through-hole pads and vias of that net join it by thermal spokes, everything else is cleared. Draw a smaller pour of another net on the same layer with a higher *Priority* (zone inspector) for a split plane; the plane is cut round it with the clearance.
- **Routing on inner layers.** Picking an inner signal layer in the layer bar while routing places a via and carries on there; the grid router and Freerouting use the inner signal layers and treat planes as power layers; inner tracks carry less current per width (IPC-2221 k = 0.024), so heavy nets stay outside.
- **Layer bar, inspector and check** know the inner layers: tracks, zones and keep-outs can go on them (keep-outs on *Every copper layer*), and the check flags copper on a missing or plane layer.
- **Gerber** writes one file per inner layer (`In1_Cu.gbr`, X2 `Copper,L2,Inr,Plane|Signal`); **KiCad export** writes the layers and a stackup with dielectrics; **KiCad import** keeps inner tracks and zones of boards up to 6 layers.

## [3.215.0] - 2026-11-14

Board design plan, phase B1: your own design rules.

### Added
- **Your own net classes.** Board ▾ → Design rules… → *+ Add class*: a class with its own track width, clearance and via drill and pad, beside the built-in Signal, Power and HV. Nets are given to it in the net table. The routers drop vias of the class's size on its nets.
- **Clearance between classes.** A matrix in the same window: empty, two classes keep the larger of their clearances; a value there holds between those two classes instead (more or less).
- **A net's own width and clearance**, in the net table (empty: its class's). The order is the net's own clearance, then the matrix, then the classes; the clearance by voltage (IPC-2221B) is always the floor.
- **Rule areas.** Board ▾ → *Draw a rule area* (also in More tools, or a keep-out's *Kind* in the inspector): copper inside keeps the area's own clearance, track width and minimum width: a neck-down between fine-pitch pins, more room round a mains entry. A pair of pieces takes the area's clearance when either lies in it; a track wholly inside takes its widths. While routing, *W* offers the area's widths. Drawn dotted violet with its values.
- The live check, interactive routing, the grid router (per-net via size; an area's larger clearance round routes passing through it), Freerouting (a via padstack per size), pours and teardrops follow all of it.
- **KiCad export:** your classes go into the project file with their vias; the matrix, each net's own rule and the rule areas (named KiCad rule areas with `insideArea` conditions) into the custom rules, before the voltage rules so those stay the floor.

### Tests
- `tests/board.test.mjs`: classes, matrix, net rules and their order; rule areas lowering and raising the clearance, the width inside and outside an area; cleaning of saved rules; the Specctra via padstack; the KiCad project classes and custom rules.
- `tests/pathfinder.test.mjs`: the grid router keeps a wide class's clearance, width and vias and a rule area's larger clearance, with no clearance error after.
- e2e (Board): a class of your own with a net in it, a matrix entry and a net's own width through the Design rules window; a rule area drawn from the Board menu.

## [3.214.0] - 2026-11-14

Phase 5 of the simulation engine plan, item 2: lossless transmission lines.

### Added
- **Lossless transmission lines in a SPICE part.** `T a1 b1 a2 b2 Z0=… TD=…` is simulated, and so are `F=` with `NL=` (a quarter wave when NL is left out) and PSpice's per-length `L`, `C` and `LEN`.
  - The engine's new TLINE element follows Branin's method: each port is Z0 in series with the wave that left the other port TD earlier. The waves of the solved steps are kept, and a time between two steps is interpolated.
  - A line shorter than the time step still works: the delay lands inside the step and is solved with it.
  - At DC the line is a wire. In the frequency response, the noise and the loop gain the delay is exact (e^(−jωTD)).
  - The steady-state search (shooting) runs as before for a line shorter than a step, with the line's currents as part of the state. A longer line keeps waves no state holds, so that circuit settles by plain stepping instead.
  - Refused, with the reason: lossy lines (`O`, `U`, and `T` with R or G).

### Tests
- `tests/fixtures/tlinedev.lib`: a 50 Ω line of 100 µs between mismatched ends, a 600 Ω quarter wave at 50 kHz given by F and NL into a resistor and a capacitor, and a matched 75 Ω line of 1 µs, shorter than a time step. `tests/models.mjs` checks them against ngspice:
  - the operating points, exactly;
  - the response from 10 Hz to 1 MHz, within 0.0001 dB;
  - a 1 kHz square wave through them, within 0.83 % of its swing.
- `tests/spicenet.test.mjs`: the three spellings, a matched line delaying a sine by TD (waveform and AC), and the refusals.
- The ngspice waveform harness deletes the last bench's data before each run, so a run that gives none cannot pass on old data. A bench can settle for fewer periods in ngspice (`settle`).

## [3.213.0] - 2026-11-14

Phase 5 of the simulation engine plan, item 1: LAPLACE sources and FREQ tables.

### Added
- **LAPLACE sources in a SPICE part.** PSpice's `E` or `G … LAPLACE {input} = {H(s)}` and LTspice's `Laplace=` on `E`, `G` and `B` (`B … V=expr Laplace=…` filters the expression) are simulated.
  - H(s) can be any ratio of polynomials in s, written with the model's parameters and functions.
  - It becomes a small state-space circuit of its own: states on capacitors, scaled to the poles' frequency so they keep sensible sizes. The response is therefore exact in the waveform, the frequency response and the operating point (H(0)).
  - Refused, with the reason: anything that is not a ratio of polynomials (a delay `exp(-s·T)`, a root of s), and a numerator of higher degree than the denominator (an ideal differentiator).
- **FREQ tables** (`E` or `G … FREQ {input} = [DB|MAG] [DEG|RAD] [R_I] (f, a, b) …`) are fitted by a ratio of polynomials and then run as a LAPLACE source.
  - The fit is Gustavsen's vector fitting. It is deterministic: the starting poles are spread over the table's decades, then relocated ten times per order, and the order rises in pairs until the fit is within 0.05 dB and 0.5° (16 at most).
  - The fitted order and how close it comes are listed with the model's notes.
  - A table's `DELAY` is refused.

### Tests
- `tests/fixtures/lapdev.lib`: a second-order low-pass, a high-pass, a band-pass on a behavioural input with an offset, a transconductance with a zero and a pole, and a FREQ table of a third-order Butterworth. `tests/models.mjs` checks them against ngspice's XSPICE `s_xfer`:
  - the response from 10 Hz to 100 kHz, within 0.003 dB and 0.1°;
  - a 300 Hz square wave, within 1.1 % of its swing (the transconductance's 100 kHz pole on the edges);
  - the operating points, against H(0). ngspice's `s_xfer` does not give its own operating point right.
- `tests/spicenet.test.mjs`: every LAPLACE spelling's response against H(jω) computed directly (to 1 ppm), the FREQ fit against the Butterworth's (0.01 dB), and the refusals.

## [3.212.0] - 2026-11-14

Phase 5 of the simulation engine plan, item 3: MOSFET levels 2 and 3.

### Changed
- **A SPICE part's MOSFETs run by their own level's equations.** Levels 1, 2 and 3 are ported from ngspice (mos1load.c, mos2load.c, mos3load.c), and each model card is set up the way ngspice sets it up: KP from UO and TOX, PHI, GAMMA and VTO from NSUB. Before, levels 2 and 3 ran as level 1 and lost their mobility and short-channel terms; makers' power MOSFET subcircuits are often level 3. What the levels add:
  - level 2: mobility falling with the gate field (UCRIT, UEXP), Baum's velocity saturation (VMAX, NEFF), Grove-Frohman saturation voltage, short- and narrow-channel thresholds (XJ, DELTA), weak inversion (NFS), channel length modulation from LAMBDA or from the depletion width;
  - level 3: THETA, VMAX, ETA (the drain lowering the threshold), KAPPA, XJ, LD, DELTA, NFS.
- **The bulk is a fourth pin, and all levels have the body effect** (GAMMA, or NSUB). A line with three nodes takes the source as the bulk. The drain and source junctions to the bulk are diodes (IS, or JS by AD/AS) with their capacitances: CBD/CBS or CJ by the area, CJSW by the perimeter, each with its grading (MJ, MJSW).
- **Gate capacitances by Meyer's model** come from the oxide (TOX), on top of the overlaps (CGSO, CGDO, and now CGBO). They act in the waveform and the frequency response as ngspice's do. Level 1 has them only when TOX is given, as in ngspice.
- Level 1 keeps its turn-on rounded over 2 mV, as before, and each bulk junction has SPICE's gmin (1 TΩ) across it: makers' CMOS op-amps tie their output switches' bulks to a node of their own through 1 TΩ, and with a sharp threshold the operating point of the TLV2461 and OPA301 stalled.
- The drain current agrees with ngspice's to 0.002 % on a grid of gate, drain and bulk voltages, forward and reversed, for N and P devices of each level.

### Tests
- `tests/fixtures/mosdev.lib` (own model cards): a level 3 power follower, a level 2 stage on a level 2 mirror, a level 1 stage with its bulk 5 V below the source, a level 3 P-channel stage. `tests/models.mjs` checks it against ngspice: operating points within 0.001 %, 10 Hz to 10 MHz within 0.03 dB and 0.07°. Two waveforms join the transient benches: a level 3 power switch and a level 2 CMOS inverter, both within 1.6 % of ngspice.
- `tests/opamp-survey.mjs` takes ONLY=NAME,NAME to run just those models. All 3798 readable makers' op-amp models: 3764 within 2 % of ngspice (3763 before; the OPA211 now solves), none lost.
- `tests/spicenet.test.mjs` keeps ngspice's numbers for the fixture, the reversed drain and the body effect.
- ngspice's own gm for a level 3 device with VMAX in saturation is about 6 % off the slope of its own current, so its gain there is no reference; the fixture leaves VMAX off the stage whose gain is compared (the drain current is still compared with VMAX).

## [3.211.0] - 2026-11-14

Phase 4 of the simulation engine plan, item 3: grid current.

### Changed
- **Grid current follows a better law, for every tube.** The space current toward the grid is Child's law on the tube's own perveance (2/kg1 · Vg^1.5), and the plate (a pentode's screen) takes the larger share as its voltage rises, by Spangenberg's and Porter's current division: Ig = 2/kg1 · Vg^1.5 / (1 + 40·√(Vacc / (µ·Vg))). With the plate at the cathode the grid takes it all; at a working plate voltage a small share. It starts softly below 0 V, as a real grid does. Its constants are fitted to the grid current starting points (Ig = +0.3 µA) that Philips prints in the ECC83 and ECC82 amplifier tables: 36 points, within 0.14 V rms, the worst 0.35 V. Before, grid current started at exactly 0 V and did not depend on the plate. An ECC83 at 150 V now draws about 0.3 µA at −0.5 V, 80 µA at +1 V and 0.3 mA at +2 V (before: none, 0.29 mA and 0.8 mA); with its plate at 5 V, five times as much. Overdriven stages block a little later, and a stage with its plate low in the swing (a cathode follower, a starved preamp) clamps harder.
- A zero-bias stage gets its grid-leak bias (a few tenths of a volt through 1 MΩ), and the bias finder still names it zero bias.
- The SPICE export writes the same law.
- **The steady-state search retries a stalled Newton step with a tighter inner solve** (GMRES to a hundredth of the residual instead of a tenth) before leaving the rest to plain settling. A lightly damped slow pair, as the EL84 push-pull example's coupling capacitors, grid leaks and feedback make once its output grids reach the grid current, has an all but singular period map: the search stalled just short of its target, and the plain settling then ran to its 20 000-period limit (90 s instead of 0.2 s). It now settles in 28 periods. ngspice, run for 3 s on the same circuit, shows the same slow ring dying away at about 0.5 Hz.

### Added
- The inspector shows a tube's **Ig (grid current)** once it is above 1 nA, in amber above 1 µA.

### Tests
- `tests/bench.mjs`: a settled run that takes more than twice its baseline's steps fails (the per-step check alone let a 400 times longer run pass).
- `tests/engine.test.mjs`: the 36 Philips points (rms under 0.15 V, none over 0.4 V); all the space current reaching the grid with the plate at the cathode, less as the plate rises; the analytic slopes against differences.

## [3.210.0] - 2026-11-14

Phase 4 of the simulation engine plan, item 2: output transformer core hysteresis.

### Added
- **Core material** on every output transformer: *Silicon steel (GOSS)* (a new transformer's), *Nickel (permalloy)*, *Amorphous / nanocrystalline*, or *Ideal (no hysteresis)*, which transformers in files saved before 3.210 keep, so their results do not change. The core's flux now lags its magnetising current in a loop (a Prandtl–Ishlinskii model: four plays carrying 30 % of the flux, the widest 8 % of the knee's magnetising current for silicon steel, 1.5 % nickel, 2 % amorphous, 40 % of that in a gapped single-ended core). The loop's area is the core's hysteresis loss. It does not depend on the frequency, and for small swings it grows as the cube of the swing (Rayleigh's law). It gives a real transformer's bass distortion: a push-pull silicon-steel core driven from 3 kΩ shows about 0.2 % THD at 20 Hz, 0.07 % at 50 Hz and nothing at 1 kHz. In the 2A3 single-ended example at 30 Hz, THD goes from 5.3 % to 5.7 %.
- The plays' states are unknowns of the circuit, carried from step to step by every run (the steady-state search, the power-on run, Listen). The Bode plotter keeps the full primary inductance.

### Tests
- `tests/thermal.test.mjs`: an ideal core loses nothing; a silicon-steel loop loses the same per cycle at 20 and 40 Hz for the same flux, and its loss grows faster than the square of a small swing; new transformers default to silicon steel and old ones stay ideal.

## [3.209.0] - 2026-11-14

Phase 4 of the simulation engine plan, item 4: makers' transistor models at any temperature.

### Added
- **A SPICE part's transistors follow its Temperature** by their own temperature terms: IS by XTI and EG, BF and BR by XTB, ISE and ISC by their emission coefficients, all from the model's TNOM (on the simulator's scale, where SPICE's nominal 27 °C is 25 °C). The field shows on any SPICE part or library part whose model has transistors in it. Checked against ngspice at −20, 75 and 125 °C: within 0.04 %.
- **A lone NPN or PNP model can heat itself**: Cooling, Case and Ptot (its thermal path, as the library's transistors get theirs from their datasheet) and Heatsink Rth, on the same heatsinks as the library's parts. Its readout shows VCE, VBE, IC, IB, the dissipation and the junction temperature.
- The SPICE export writes a lone transistor's temperature on its line (`temp=`), the simulated junction temperature when it heats itself.

### Fixed
- **The band gap's share of a transistor's temperature drift** now uses SPICE's temperature scale, as the thermal voltage already did (25.852 mV is kT/q at SPICE's 27 °C). A transistor at 125 °C sat 2.7 mV off ngspice in VBE; it now agrees within 0.3 mV.

### Tests
- `tests/models.mjs`: three transistor models (silicon NPN with ISE, PNP with ISC and TNOM=25, germanium) at −20, 75 and 125 °C against ngspice.
- `tests/thermal.test.mjs`: a SPICE part at 75 °C, self-heated in a TO-220, and which fields it shows.

## [3.208.0] - 2026-11-14

Phase 4 of the simulation engine plan, part 1: transistors that heat themselves.

### Added
- **Cooling** on every bipolar transistor: *Fixed temperature* (as before), *Self-heating, free air*, or *Self-heating, heatsink 1–4*. A self-heated junction runs at the temperature its own dissipation gives through its package (junction to case (150 − 25)/Ptot for a power part, the package's free-air resistance beyond it; a small part's whole path from its Ptot), and Temperature becomes the air around it. Parts with the same heatsink number share it (**Heatsink Rth**, 1.5 °C/W by default, plus 0.5 °C/W of insulating pad each), so a VBE multiplier on the output transistors' heatsink tracks them, and one left in free air shows the idle current climbing as they warm. In the 50 W CFP example with the multiplier on the heatsink, the idle current goes from 54 mA cold to 74 mA warm and about 110 mA warmed by its test signal (9 W average in each output transistor).
- The operating point is solved again at each set of temperatures until they settle (damped where they swing). With a signal, the run is repeated with the extra heat the signal brings, averaged over the capture.
- **Overheating warning**: a junction that would pass 250 °C (thermal runaway, or more heat than its cooling takes) is held there and flagged; a junction past its 150 °C maximum is flagged too.
- **Warm-up in the power-on run**: every part starts at the air temperature; the case (in free air) and the heatsink warm with their time constants, the junction rides Rjc·P above its case.
- The transistor's readout shows the junction at idle and with the signal, and its heatsink's temperature.
- Bode, loop gain and noise linearize self-heated parts at the temperatures the run settled at. The SPICE export writes each self-heated part at its simulated junction temperature.

### Tests
- `tests/thermal.test.mjs`: the junction at ta + (Rjc + Rca)·P, a shared heatsink, runaway held at 250 °C, the power-on warm-up against 1 − e^(−t/τ), AC at the run's temperatures, and the CAD fields.

## [3.207.0] - 2026-11-14

Phase 3 of the simulation engine plan: never stuck. The two circuits that would not solve now do, and a run that still fails says where.

### Fixed
- **Example 17's power-on run** (the 50 W CFP amplifier switched on from cold) no longer stops at its first step. Its ±30 V rails jump across empty capacitors and drive every junction at once, and Newton wandered off to absurd voltages. A time step that fails at its smallest subdivision is now also solved by source stepping, the sources brought up from nothing within the step. The run now settles to the same operating point the DC solve finds.
- A source written `I1 4 99 DC=62.66U` (DC=value, as in some makers' files) is read; before, the model was refused.
- **Maxim's MAX406/MAX407 models** solve. Their gain node sits at about 1.7 MV and feeds a product of two voltages. Newton's 25 V step limit held it back, so the solve ran out of iterations. A node that only behavioural sources read is now free of the limit, as other linear inner nodes already were. MAX407 agrees with ngspice within 0.00 %, and its "known" mark is gone.

### Added
- **Pseudo-transient for the operating point** (as ngspice's optran), tried when gain, gmin and source stepping all fail. It puts a conductance on every node toward the last state, starting at 1 S and falling fourfold a step (less after a step that fails), and lets the circuit run to rest from nothing. A plain solve from there must then agree.
- **The stuck parts are named.** When a solve or a run fails, the status line names the parts on the nodes Newton was still moving most (devices first) and selects them on the sheet: "… · stuck near Q3, R12 (selected)".

### Tests
- `tests/opamp-survey.mjs` (not in CI) runs any number of the library's five-pin models as ×11 amplifiers here and in ngspice. In a seeded sample of 400, 256 are op-amps that ngspice can run (124 it cannot read, 20 are other parts). Of those 256, 254 agree within 2 %, one transimpedance model is 2 % off, and one uses a single-argument GAUSS() that is not supported.
- An engine test checks that the pseudo-transient finds the same operating point as the ladder, and that a stuck solve names the transistor before its resistors.

## [3.206.0] - 2026-11-13

Phase 1 of the simulation engine plan: fast edges right. Every waveform bench against ngspice now agrees within 2 % of its swing (a diode's reverse recovery was 22 % off, a saturating switch 2.9 %, a switch with transit times 92 %).

### Added
- **Fine steps inside fast edges.** A time step whose third difference over the steps before (Gear-2's error) passes 0.25 V plus 1 % of the node's voltage and ¾ of those steps' own changes held an edge or a sharp kink, and is run again as 8 finer Gear-2 steps (any of them again as 8); a smooth waveform is left alone, even at a power-on run's coarse step. The time grid is kept, so a period still ends on its last step and the harmonics stay exact; the full run, the power-on run and Listen all use it.
- **A transistor's transit times in the waveform.** An imported SPICE BJT's TF stores TF · If/qb between base and emitter and its TR stores TR · Ir between base and collector, so a saturated switch keeps conducting for its storage time, as in ngspice. TR now counts in Bode and noise too.
- **A power MOSFET's Miller capacitance.** An imported VDMOS's gate-drain capacitance follows its CGDMIN … CGDMAX law (with A) in the gate-drain voltage, growing as the drain falls; its drain-source capacitance follows the body diode's junction law (CJO, VJ, M).

### Changed
- **Junction capacitors step their charge,** not their capacitance at the step before, as SPICE does: nothing is lost or gained however far the voltage swings in one step.

### Tests
- `tests/models.mjs`: a VDMOS switch bench; every waveform bench held to 2 %; ngspice's waveform read at a sixteenth of a step so an edge shorter than a step is matched where it is.

## [3.205.0] - 2026-11-13

Phase 2 of the simulation engine plan: faster. On one core, against 3.204.0, the full run of every example is 2.1× faster (the stereo amplifier, example 07, 2.3×; the 50 W amplifier, example 17, 1.8×) and the one-second power-on runs 2.1×; results are unchanged within the solver's tolerance, and every check against ngspice still passes.

### Changed
- **Linear parts stamped once per time step.** Resistors, capacitors at the step, inductors, transformers below saturation, sources, controlled sources and held relays stamp the same numbers on every Newton iteration; they are stamped on the first and copied back on the rest.
- **The LU refactors on the last pivots.** After the first solve, Newton iterations reuse its pattern and pivot order and only redo the numbers (as KLU's refactor), in WebAssembly and in JavaScript alike; a pivot that falls below 10⁻³ of its column brings a fresh factorisation.
- **Worked-out Jacobians** for tubes (Koren's triode and pentode, with grid current, screen current and its knee share, grid shift and current scale), BJTs (Gummel–Poon with Early effect, high injection, leakage and recombination currents) and MOSFETs: one evaluation per Newton iteration instead of one per terminal. Imported SPICE tubes, a warming cathode, op-amps and regulators are still differenced, now one evaluation per terminal but the last (their currents depend only on voltage differences and sum to zero). A test holds every worked-out derivative to its finite difference over a spread of operating points.

### Fixed
- A Newton iteration caught in a two-step cycle (long and short updates in turn, as a floating bridge rectifier's input can be) is now damped and converges; before, such a step could stop the transient ("Transient did not converge").
- A time step that fails at its smallest subdivision is solved by gmin stepping, from 1 S to 1 pS, as the DC operating point is. Example 20's power-on run needs it.

### Tests
- `tests/bench.mjs` holds a full run to its Newton iterations per time step (how many periods the steady-state search takes swings with the last digits of the arithmetic) and a power-on run to its total.

## [3.204.0] - 2026-11-13

Phase 0 of the simulation engine plan: measure before changing.

### Added
- **Speed benchmark** (`tests/bench.mjs`, in `npm run test:ngspice`): the live run, the full run, the Bode sweep and the power-on run of every example, timed, with the engine's own work counters (Newton solves at DC and per time step, their iterations, the model evaluations the Jacobians took, the solves that failed) in each result's `stats`. The counts, which do not depend on the machine, are held to within 20 % of `tests/bench-baseline.json`, so a change that makes the engine work harder fails CI.
- **Waveforms against ngspice** (`tests/fixtures/trandev.lib`): a diode's reverse recovery, a saturating transistor switch (with and without transit time), a CMOS inverter, a class-B follower clipping into 8 Ω and a varactor swung hard, each settled period compared with ngspice's point by point. The class-B stage and the varactor agree within 0.2 % of their swing; fast edges are held at today's error until the error-controlled time step (phase 1).
- **The 555 in the SPICE export.** An NE555 is written as `NE555_SIM`, a behavioural subcircuit with the simulator's own equations, so an exported 555 circuit runs in ngspice and LTspice as it is (a maker's NE555 model with the same pins can still replace it). The five 555 examples are now compared with ngspice instead of skipped: the astable, the flashing LED and the simplest oscillator agree (the period within 0.03 %); the metronome and the tachometer are listed as known differences with the reason.

### Fixed
- The exported op-amp subcircuit used `limit()`, which ngspice's B sources do not have (it read as 0, so in ngspice the op-amp's output and stage currents came half from each supply rail instead of from the rail that sources them); it uses `min`/`max` now.

### Found (for the next phases)
- Example 17's one-second power-on run does not converge at 25 µs with hot cathodes.
- A diode's recovery overshoots for a step after its stored charge runs out when the step is long against the recovery.

## [3.203.0] - 2026-11-13

Found by building six known circuits (a CMoy headphone amplifier, a Distortion+, a silicon Fuzz Face, an LPB-1 booster, a MOSFET headphone follower and a state-variable filter) with *Add part…*, simulating them and designing their boards.

### Added
- **Add part… offers the app's own part first.** A number the program has built in (2N3904, TL072CP, LM317T, LM7805CT, NE555P, OPA2134PA, LM386N-1 …) is offered as the built-in part, whose model and pinout are checked against the datasheet; the maker's SPICE model stays in the *Model* list. This also covers numbers the public library has no usable model for (OPA2134, NE555).
- **Makers' transistors and diodes written as subcircuits are drawn as what they are.** A power MOSFET, a Darlington (TIP120) or a zener whose model is a small subcircuit comes as a transistor or a diode with its usual packages, not as a box on wire pads. A diode subcircuit's anode is found by trying the model both ways.

### Fixed
- A P-channel power MOSFET model (VDMOS with `pchan`) was drawn as an N-channel one.
- Models that use LTspice's lateral PNP (`LPNP`, as the LM386's) could not be read.
- Metal-can transistors (2N2222A, BC108, 2N2907A) are offered in TO-18, not TO-92.

## [3.202.0] - 2026-11-13

### Added
- **Add part… by part number.** *+ Add part…* in *My library*: type the maker's part number (TL072CP, 2N3904, IRF540N, 1N4148), choose the package, place it. The part's SPICE model is looked up in the public KiCad-Spice-Library (an index of about 49,000 names ships with the app) and that one model is downloaded; the drawing follows from what the model is (op-amp, transistor, diode, else a box with the model's pins). The usual package and, for a transistor, the usual pin order of the number's family are offered first. A dual or quad op-amp goes into *My library* with a unit per amplifier and all its units are placed together (DA1.1, DA1.2, DA1.3). The chosen package goes to the board with the part. A number the library does not have is said plainly, with *I have the model file…* as the way on. The parts panel's search offers the dialog for a number it does not know.

### Fixed
- A part number with a saved package is honoured on the board even when no lookup knows the number.
- The Board window no longer throws an error when the Circuit CAD sends it the circuit while it is still loading (the message now waits until the window is ready).
- A new part's designator counts the units already on the sheet (DA1.1 … makes the next one DA2).

## [3.201.0] - 2026-11-13

### Added
- **Library parts of several units are simulated.** A dual or quad op-amp placed unit by unit from *My library* (DA1.1, DA1.2 and the supply unit DA1.3) now runs in the simulation instead of being left out.
  - **A model of one amplifier:** in the Parts library, *Model…* lists the package's pins unit by unit (A, B, C). Give the model's inputs and output to unit A and its supply pins to the pins where they are drawn; every unit drawn like A gets its own copy of the model, and the supply pins are shared.
  - **A model of the whole package** (its pins on all the units) is used once.
  - The dialog says which it is ("one for each of units A, B" or "one model for the whole package"), and an op-amp's usual pin names (inp, inn, vcc, vee, out) find the pins drawn +, −, V+, V− and the output by themselves.
  - The supply unit has to be on the sheet and wired: the checks name a unit whose model needs pins of a unit that is not there. The SPICE export writes one subcircuit call per simulated unit.
- For developers: `PartLib.unitMaps`, `LIB.part.model`, a unit's `net()` reaching its package's other units in `buildNetlist`; tests in `tests/partlib.test.mjs` and `tests/e2e/08c-parts-library.mjs`.

## [3.200.0] - 2026-11-13

### Added
- **Parts on the sheet follow your library when you ask.** A part placed from *My library* carries its own copy, so a circuit never changes behind your back; now it can be brought up to date after you change the library part's drawing, footprint, model or name.
  - **In the Parts library** a part says how many of it are on the sheet and how many were placed before your changes; *Update them* brings all of them up to date.
  - **In the inspector** a placed part whose library part has changed says what has changed (drawing, footprint, SPICE model, name); *Update from the library* updates it, all the units of its package together.
  - The value you typed, the part number and the wires stay. A model set on the sheet stays unless the library part has one of its own. A wire to a pin that moved has to be joined again. One Undo takes the update back.
- For developers: `PartLib.differs` / `refreshed`, `updateFromLibrary` in `cad-app.js`; tests in `tests/partlib.test.mjs` and `tests/e2e/08c-parts-library.mjs`.

## [3.199.0] - 2026-11-13

### Added
- **Footprint editor: draw your own footprints.** In the Parts library, next to a part's *Footprint* list, *Draw…* starts a footprint for the part, with pads already numbered as its pins, and *Edit…* changes the one it has, one taken from KiCad included. Every part that uses the footprint follows the change, a new name too.
  - **Usual packages from a few numbers:** *Make a usual package* lays out two drilled rows (DIP), one row (a header), two rows of surface pads (SOIC, SOT), four sides (QFP) or two pads, from the number of pads, the pitch, the distance between the rows, the pad and the hole. Centred, pad 1 at the top left, counted anticlockwise, with a silkscreen outline and a mark at pad 1.
  - **By hand:** *Pad*, *Hole* (a mounting hole with no copper), *Line*, *Rectangle* and *Circle* (silkscreen) tools; *Select* moves and deletes, the arrow keys nudge by a grid step, Undo (Ctrl+Z). The pointer snaps to a grid of 2.54 down to 0.1 mm; numbers typed at the right or in the table of pads are kept as typed (a comma works as the decimal point).
  - **Pads:** through-hole or surface (top or bottom), round or rectangular, with width, height and hole. A new pad takes the first pin number of the part that has no pad yet; a pin left without a pad, and a hole that leaves no copper round it, are named at the bottom.
  - **View:** the wheel zooms, dragging the empty board moves the view, *Fit* shows it all; *Centre on the pads* puts the footprint's centre, about which the part turns, in the middle of the pads.
- For developers: `cad-fpedit.js` (`FootprintEditor`), `PartLib.fpPattern` / `fpFor` / `fpTidy` / `fpStore`; tests in `tests/partlib.test.mjs` and `tests/e2e/08c-parts-library.mjs`.

## [3.198.0] - 2026-11-13

### Added
- **Symbol editor: draw your own parts.** In the Parts library, *New part…* starts a part of your own and *Edit drawing…* changes the drawing of any part, one taken from KiCad included; *Duplicate* makes a copy to change.
  - **Tools:** Line (point after point), Rectangle, Circle, Text and Pin, Select to move and delete, Undo (Ctrl+Z). The drawing sits on half the sheet's grid, pins on the grid itself, so wires meet them.
  - **Pins:** each has a number (its pad on the footprint), a name, a side of the body and a length, set at the right or in the table of the unit's pins. New pins are numbered on from the highest. A pin number used twice in the package is refused, with the number named.
  - **Make a box from a list of pins:** one line per pin, number then name, makes an IC's box with the pins round it as on a DIP; `left`, `right`, `top` or `bottom` after a pin puts it on that side.
  - **Units:** *+ Unit* adds another unit of the same package (a second amplifier, the supply pins), each with its own drawing and pins.
  - Parts already on a sheet keep the drawing they were placed with. After a drawing changes, a SPICE model keeps the pins that still exist, and the footprint is chosen again if the old one no longer has every pad.
- For developers: `cad-symedit.js` (`SymbolEditor`), `PartLib.boxSymbol` / `pinList` / `tidy` / `bounds`.

## [3.197.0] - 2026-11-13

### Added
- **Your own parts library.** Parts are no longer only the ones built into the program: *My library* at the top of the parts panel holds your own, and each of them is data (a drawing with pins, a footprint, a SPICE model), not code. *Parts library…* in the panel opens it.
  - **From KiCad's libraries:** *Add from KiCad files…* reads symbol libraries (`.kicad_sym`) and footprint files (`.kicad_mod`), several at once. A symbol library lists its symbols with a Find box: tick the ones to add, or take all. Derived symbols come with their parent's drawing; power symbols are left out. KiCad's reference letters become the program's designators (U → DA, Q → VT, D → VD).
  - **Footprint:** a part takes by itself the footprint its symbol names or its KiCad footprint filters allow, once it is in the library. The list offers the footprints that have a pad for every pin first, and a warning names pins the chosen footprint has no pad for. On the board the part has its own footprint, each pin on the pad of its number; it is routed, checked and exported to Gerber and KiCad like any other.
  - **SPICE model:** *Model…* puts a maker's `.SUBCKT` or `.MODEL` on the part's own pins (the model dialog of the SPICE part, with the part's drawing kept). The part is then simulated as written.
  - **Units:** a part of several units (a dual op-amp, a double triode as KiCad draws it) is placed unit by unit with *Unit of the package* in the inspector; units under one designator (DA1.1, DA1.2, DA1.3) share one footprint. Such parts are not simulated yet.
  - **Kept** in this browser, and as a file: *Save as a file* writes `my-parts.tubelib`, *Open a library file…* adds one. A part on the sheet carries its drawing, footprint and model in the circuit file, so a circuit opens on a computer that does not have the library.
- For developers: `part-lib.js` (the library as data, no DOM), `cad-library.js` (store and dialog), `KicadImport.readSymbols` / `readFootprint`, the part type `part`; tests in `tests/partlib.test.mjs` and `tests/e2e/08c-parts-library.mjs`.

## [3.196.0] - 2026-11-13

### Added
- **SPICE parts: the frequency response is checked against ngspice.** `npm run test:ngspice` now compares gain and phase from 10 Hz to 1 MHz for each of the 64 makers' op-amp models (as a ×11 amplifier), after the output voltage: all agree within 0.1 dB and 1° up to 20 kHz and within 0.3 dB and 3° up to 1 MHz. A bench of small amplifiers (`tests/fixtures/acdev.lib`) holds a diode's, a transistor's and a JFET's capacitances to ngspice within 0.02 dB up to 10 MHz.
- **Junction capacitances in a SPICE model follow the voltage across them** (CJO / VJ / M, CJE, CJC, a JFET's CGS and CGD, with FC), in the waveform and in the Bode and Noise windows. They used to stay at their zero-bias values, which made a reverse-biased junction several times too large.
- **A transistor's transit time (TF)** in a SPICE model counts in the frequency response (Bode, noise) with its collector-voltage term, as in SPICE. It is still left out of the waveform, and the dialog says so.

### Fixed
- **JFET and MOSFET inputs in makers' models had the wrong gain near pinch-off.** The simulator rounds a FET's turn-on over 50 mV, which is right for a power stage but changed the gain of an input pair biased at a few tens of millivolts of overdrive: the LM833 and MC33078 came out 0.8 dB off at 1 MHz, the LT1113 1.3 dB. A SPICE part's FETs now keep the model's sharp square law. The library's own FETs are unchanged.

## [3.195.0] - 2026-11-13

### Added
- **Pin rules in the Checks (ERC).** Every pin now has a role: an input (a grid, a gate, a base, an op-amp's inputs, a regulator's ADJ, a 555's trigger and threshold), an output (an op-amp's, a regulator's, a 555's), a supply pin, a source, or a plain terminal. The Checks hold the wiring to the roles:
  - **an input with no DC path**: a grid behind its coupling capacitor with no grid leak, a gate, a base or an op-amp input with nothing but capacitors and other inputs on it. The path is followed through resistors, pots, chokes, transformer windings, switches, fuses and lamps, however far, so a grid stopper leading to a leak, a bias supply or the stage before (DC coupling) is fine;
  - **a supply pin fed by nothing**, or an IC's two supply pins on one net;
  - **outputs wired together** (two op-amps, two regulators), an output wired to ground or straight to a rail or a supply;
  - **a supply shorted** by its own wiring.
- A SPICE part takes the roles of its symbol (an op-amp's, a transistor's); a box only where the model's pin names are plain (`IN+`, `OUT`, `VCC`), every other pin is left alone, so there are no guesses.
- All 20 examples pass the rules without a message. The rules are in a file of their own, `cad-erc.js`, with no drawing code, and tested in `tests/erc.test.mjs`.

## [3.194.0] - 2026-11-13

### Added
- **Dimensions drive the board's outline.** With the Dimension tool (D), click one edge of the board and then another: the dimension between them is the board's width or height, and the value typed moves the edge clicked second, with everything on the board staying in its place. One edge clicked twice (or two of its corners) gives its length.
- **On a sketched outline** every edge, corner and arc centre can be dimensioned; a click on an arc gives its radius (R), on a circle (a round board, a round cut-out) its diameter (⌀). Each line keeps its direction and each arc its angle, so a dimension changes sizes and never the kind of shape; a rounded corner or a round cut-out keeps its radius unless its own dimension changes it.
- A part or a hole dimensioned from an edge moves as before (the edge does not come to it) and follows the edge when the board's size changes.
- A size held by a dimension cannot be changed by Board setup, by dragging the board's edge or by the sketch: the status line says so. A value that would make the outline cross itself or leave a cut-out outside the board is refused. A sketch that removes an edge removes the dimensions on it and says how many.

### Changed
- Two lines clicked in the Dimension tool (two board edges, an edge and a construction line) now give the distance between them; it used to ask for a point.

## [3.193.0] - 2026-11-13

### Added
- **SPICE part: any part from its maker's SPICE model.** A part the library does not have (another op-amp, a regulator, a power MOSFET, a driver IC, a transistor, a diode) now runs on the model its maker publishes. Place **SPICE part** (Parts → Integrated circuits), press **Model…** in its inspector and paste the model or open the file (`.lib`, `.mod`, `.cir` …). The model is turned into the simulator's own elements, so the part runs together with the valves in everything the program does: live simulation, steady state, tolerance runs, Tune, the instruments. No second simulator, no setting to choose.
- **What a model may hold:** `.SUBCKT … .ENDS` with subcircuits inside subcircuits, `PARAMS:`, `.PARAM`, `.FUNC`, or a lone `.MODEL`. Elements: R, C, L and coupled inductors (`K`), DC sources, diodes (series resistance, breakdown), bipolar transistors (Gummel-Poon with the leakage terms ISE / ISC and base, emitter and collector resistance), MOSFETs (levels 1 to 3 as the square law, LTspice's `VDMOS`), JFETs, the controlled sources `E G F H` (linear, `VALUE={…}`, `TABLE`, `POLY`), behavioural `B` sources with `V()` and `I()`, and the switches `S` and `W`. PSpice, LTspice and ngspice spellings are read.
- **The dialog:** a file of many parts lists them (with a Find box for long files) and keeps only the one picked and what it needs. A lone transistor or diode model takes that device's symbol; a subcircuit of five pins is offered as an op-amp in the usual pin order; anything else is a box with the model's pins, whose names can be changed. Each pin of the model is set to a pin of the symbol, to ground or to nothing. What the model leaves out is listed (junction capacitances at their zero-bias values, transit times).
- **What is refused, with the reason:** `LAPLACE` and frequency tables, transmission lines, digital (`A`) devices, BSIM MOSFETs (level 4 and up), expressions of time. A part without a model, or with one that cannot be simulated, shows in the Checks and is left out of the run.
- **Board, files, export:** the model is saved inside the circuit file with the part. The SPICE export writes the part as one line and its model as it came. On the board the part takes a DIP-8 or SOIC-8 with the single op-amp's pinout (an op-amp), the usual transistor and diode cases, or a DIP in the model's pin order (a box); wire pads are always offered.
- **The simulator's behavioural source** (element kind `B` in `sim-engine.js`): a current or a voltage that is any expression of node voltages and branch currents, in the operating point, the transient and the small-signal (Bode, noise) analyses.
- **Checked against ngspice:** a bench of device models, sources, a switch, a table and a polynomial gives ngspice's operating point within 0.1 % (`tests/spicenet.test.mjs`). `npm run test:ngspice` now also runs 64 makers' op-amp models (Texas Instruments, Linear Technology, Analog Devices, Burr-Brown, Maxim, Motorola, Philips, JRC, National) as ×11 amplifiers in both simulators: 63 agree within 2 %, one (MAX407) is not solved yet and is marked so. The model files are not in this repository: the test reads them from the KiCad-Spice-Library project at a fixed commit. Of 283 well-known op-amp models tried while building this, 245 agree with ngspice, none gives a different answer, and ngspice itself cannot read the other 38.

### Fixed
- **Operating point of circuits with very steep linear stages.** Newton's step limit (25 V a step) was taken from every node, also from nodes that only resistors, capacitors and linear sources are on. Inside a maker's macromodel such a node can sit behind a gain of a million, and its huge first step held all the other nodes still, so the operating point was not found. The limit now looks only at nodes a nonlinear part is on. Circuits made of the program's own parts solve as before.
- A diode model with a very large saturation current (IS of 0.1 A, as some macromodels use for ideal clamps) made the junction-voltage limiter take the logarithm of a negative number.
- SPICE libraries: `$` inside a node name (PSpice's `$N_0001`) is no longer read as a comment; `|` and `&` in expressions, `.MODEL name (TYPE …)` and stray control characters in old files are read.

## [3.192.0] - 2026-11-12

### Added
- **Board outline sketch**: the board no longer has to be a rectangle. Construct ▾ → Board outline sketch… (or Board setup → Sketch the outline…, or a double-click on the board's edge) opens the outline as a sketch on the board. Tools: Select (S), Line (L), Arc through three points (A), Circle (C), Rectangle (R), regular Polygon (P), Slot (O) and Fillet (F); lengths, radii, angles and the number of sides can be typed while drawing. Corners drag with the lines that meet there, the mark in the middle of an arc bends it, a double-click on a line adds a corner, Del removes what is selected. The sketch has its own Undo and Redo; Finish makes it the board, Cancel leaves the board as it was.
- **Cut-outs**: a closed shape drawn inside the edge is a cut-out (a window, a slot for a transformer's lugs, a round opening). Any number of them.
- **Round board** in Board setup: Shape → Round and a diameter.
- The sketch is checked as it is drawn: an open end, lines that cross or touch, a cut-out inside another one are named in the bar (a loose end is red), and Finish waits until the shape closes.
- **Everything follows the shape**: the copper pours and their clearance to the edge and to each cut-out, the design-rule check (copper, holes and parts by the real edge), both routers (cut-outs are closed to tracks in the built-in one and in Freerouting), snapping and construction geometry (each edge and arc of the outline can be offset and referenced), the silkscreen, the 3D view and the STEP model (true arcs and cylinders), the printed and SVG drawings.
- **Gerber**: the Edge_Cuts file has one closed contour for the edge and one per cut-out; pours are cut back from them; silkscreen is clipped to the board. **KiCad**: the outline is exported as lines and arcs on Edge.Cuts, and a KiCad board with a shaped outline opens with its shape and cut-outs.
- Tests of the Gerber export for round, polygon and cut-out boards: the outline contours close and lie on the true edge, no copper or silkscreen outside the board or inside a cut-out, drills inside the board; the same files pass the Gerber fabrication check.

### Changed
- A rectangular board, with or without rounded corners, is written and exported exactly as before.

## [3.191.0] - 2026-11-12

### Added
- **Vaults in Safari and Firefox, read only.** These browsers cannot write into a folder, but they can read one you pick. In File ▾ → Revisions… → Kept in → A folder on this computer, **Choose folder…** now opens the browser's folder picker there: pick a vault made in Chrome or Edge (or one project's folder) and its projects and revisions are listed with their pictures, opened, compared on the sheet and with each other, and downloaded. Save revision, New project, milestones, Restore and Delete are off or say that saving needs Chrome or Edge. The folder is asked for again after the page is reloaded. The project manager reads a vault the same way.

## [3.190.0] - 2026-11-11

### Changed
- **More realistic 3D and STEP models of the XT power connectors.** The housing now has its chamfered end (the − side) along its whole length, as on Amass's drawings; a male has its shroud, a hollow mouth with a wall of 0.8 / 1.0 / 1.2 mm (XT30 / XT60 / XT90), round its gold pins with rounded tips; a female has its insert with a gold socket for each pin, open into the mouth; the + and − are moulded on top; the XT30's pegs stand in their ears and the XT60 / XT90's tabs go down into the board; the legs bend down into their holes. Upright ones (XT30UPB, XT60 solder cups) get the same shroud or insert on top and their cups down into the board. The STEP export writes these faces with their holes (inner bounds), checked valid in OpenCascade.
- The 3D view splits a face with holes, or a concave one, into triangles properly (it used to fan from one corner, which only suits a convex face without holes).

## [3.189.0] - 2026-11-11

### Added
- **Open KiCad project** (File ▾ → Open KiCad project…): a KiCad schematic and its board open as a circuit. Select the project's `.kicad_sch` sheets, its `.kicad_pcb` and `.kicad_pro` together in the file dialog (or a ZIP of the project's folder); a schematic or a board alone opens too, and File ▾ → Open… takes the same files. KiCad 6 and later.
- **Symbols become the program's own parts where it has them**, and simulate: resistors, potentiometers, capacitors, chokes, diodes, zeners, LEDs, transistors, MOSFETs and JFETs (told by their pin names), op-amps, the 555, connectors, and valves under any of their names (ECC83, 12AX7, 6Н2П), a dual valve's units as its sections. A type with no model here simulates as the nearest one and the list says so.
- **Imported part**: any other symbol is kept as KiCad draws it, with its pins, value and footprint. It is wired on the sheet and on the board and listed in the bill of materials, but left out of the simulation.
- **KiCad's nets**: wires and junctions, local, global and hierarchical labels, power symbols (GND becomes ground, +12V-like supplies power rails, other names sheet connectors), hierarchical sheets (each a sheet with its frame; a sheet used twice comes twice), buses by the names of their members. Compared with KiCad 7.0.11's own netlist on KiCad's demo projects: 13 of 14 agree pin for pin; the last has wires drawn over each other, which the list points out.
- **The board comes too**: outline, each footprint as the board file has it (pads, silkscreen, holes) in its place and on its side, tracks, vias, copper pours, keep-outs, mounting holes and texts. Top and bottom copper only. The board's rules are set from the layout so that it passes its own check.
- **Round trip**: a project exported with Export KiCad project opens again as the circuit and board it was (all 20 examples do).
- A list after opening says what came over (sheets, parts simulated and kept, tracks, vias) and what to check; **Show the board** opens the board.

### Fixed
- Opening or editing a very large circuit no longer stalls: joining wires at their crossings took time growing with the square of the sheet (87 s on a 2,400-wire sheet), now a fraction of a second.
## [3.188.0] - 2026-11-11

### Added
- **XT power connectors** (Ground & connectors → Power connectors (XT)): the Amass connectors of drone and RC batteries, chargers and controllers. XT30 (20 A), XT60 (35 A) and XT90 (45 A), each male (pins, designator XP) and female (sockets, XS): right-angle on the board (XT30PW, XT60PW, XT90PW), vertical on the board (XT30UPB), the XT60's solder cups upright in the board (XT60-M / -F), on a lead (XT30U, XT90H), and the XT90-S anti-spark female. Pick the model in the inspector's Model list; the parts search finds them by series, "drone", "lipo", "male", "female" and so on.
- **Their footprints and 3D bodies from Amass's spec sheets**: pin pitch (5, 7.2, 10.9 mm) and holes, the plated mounting tabs and pegs (MP pads, no net; the tabs' slots drilled round), the housing's outline on the silkscreen with + and − beside the pins, the yellow housing with its mouth and gold contacts in 3D at its real height. − is the contact at the housing's chamfered end, so a series' male and female are mirror images, as they mate. A right-angle one lies with its mouth at the bottom and can sit flush with the board's edge (no courtyard margin beyond the mouth). Cable versions get wire pads.
- **BOM**: an XT connector's line carries the Amass order code (XT60PW-M30.G.Y …) and its rating (35 A, 500 V DC) unless you type another part number; the inspector shows the code in the Part number field.

## [3.187.1] - 2026-11-10

### Fixed
- **Zooming and panning a big circuit no longer stutters.** With the voltages, currents and the animation on, a large schematic (the 50 W CFP amplifier, example 17) took longer to draw than a wheel notch lasts, so the view froze and jumped. Now the wheel (and dragging the view with the middle button or Space) stretches and moves the picture last drawn, and the sheet is drawn sharp again once the view rests (160 ms; on a long zoom it is redrawn on the way when the picture runs out). On a CPU slowed four times, a wheel step went from 66 ms to 17 ms.
- The sheet draws only what is on screen (parts, wires, stickers, animated dots); the grid, junctions and each wire's dots are filled in one go; the zoom readout no longer makes the hover hints rescan the page on every notch; dragging the view no longer places the stickers anew on every move.

## [3.187.0] - 2026-11-10

### Added
- **Vaults: revisions kept in a folder on your computer.** In File ▾ → Revisions…, the new **Kept in** list chooses where projects and their revisions live: on aerocat.tech as before (the site's owner only), or in a vault, a folder on this computer that you choose with the browser's folder dialog. Everything in the dialog works on the folder: New project, Save revision (Ctrl+Alt+S), the list with its history graph, Open, Compare on the sheet, Compare with…, milestones and their release package, Restore as rN, Download all, the toolbar's r5 chip and Rev. auto. Nothing is sent anywhere and no login is needed, so revisions now work on any copy of the app.
- **Several vaults.** Add a folder… in Kept in adds another vault (one folder for each project, for example), the list switches between them and Forget folder takes one off the list, leaving its files. Each vault has an id in its `tubecad-vault.json`; a circuit saved with File ▾ → Save names the vault its revision is in and switches to it when opened, and a `#rev=…&vault=<id>` address opens a revision from that vault.
- **Plain files in the folder**: a folder for each project, named after it, with `project.json`; each revision as `r<n>.json`, a design that File ▾ → Open reads, with `r<n>.sheet.webp`, `r<n>.board.webp` and its release files in `r<n>.files`. A project's folder may be renamed or moved within the vault (it is found by its id).
- **The project manager on a vault**: `projects.html` has the same Kept in switch; on a vault it lists the folder's projects with status, tags and search, their revisions with pictures and release files, the Trash (30 days) and Import project…. **Copy to folder** and **Copy to aerocat.tech** copy a project with all its revisions, pictures and release files from one store to the other.
- The start screen's **Your projects** shows the projects of the store chosen, the vault's included.

### Notes
- Folders need the File System Access API: Chrome, Edge and other Chromium browsers. Firefox and Safari keep the site's store only. After a browser restart the browser may ask again for leave to use the folder (Allow).

## [3.186.0] - 2026-11-08

### Added
- **Noval magic eyes** from their datasheets: EM84 and the Soviet 6Е3П, bar indicators whose two green bars grow together as the grid goes to −22 V (Philips data), and 6Е1П, a noval fan whose shadow widens from 7° at 0 V to about 55° at −15 V (its datasheet curve). Both move under Animate.
- **Mercury-vapour rectifiers** 83 (full-wave) and 866A (half-wave, top cap): a near constant 15 V arc drop at any current; the vapour glows blue with each conduction pulse under Animate and the filament glows. Checks compare the DC current and each anode's peak inverse voltage with the ratings.
- **Incandescent lamps** #47, #44, #1869, #327 and a 60 W 230 V bulb: the filament's resistance follows its rms current (cold about a twelfth of hot), so a lamp limits current softly (dim-bulb tester); it glows on the sheet from dull red to warm white.
- **Nixie tube** ИН-14: the digit whose cathode is pulled down glows orange; a rotary selector on its cathodes steps the digit with a click under Animate.
- **Panel meters**: a moving-coil ammeter or voltmeter and a VU meter (0 VU at +4 or 0 dBu), the needle drawn on the sheet and moving with a meter's ballistics under Animate; Checks warn when it pins.
- **Batteries**: 9 V PP3, AA cells and packs, Li-ion 18650 cells and packs, 12 V lead-acid, with *Charge left* setting the voltage and internal resistance; the inspector estimates how long it lasts.
- **Potentiometers**: reverse-log taper, dual-gang (stereo) pots by naming sections R1.1 / R1.2 (they turn together on the sheet and in the inspector), and switched pots (an on–off switch at the start of the travel).

## [3.185.0] - 2026-11-08

### Added
- **Glowing tube heaters.** Once a circuit is simulated every tube's heater glows orange on the schematic (a directly heated filament, as on a 2A3, 300B or 5U4G, brighter and yellower). Pressing ∿ Animate switches the amp on: each heater starts cold and warms up over its own warm-up time (the oscilloscope's power-on model), dull red first, orange when hot.
- **Play the circuit live under ∿ Animate.** The sheet becomes the amp's front panel: drag a potentiometer's wiper along its body (or turn it with the mouse wheel, 2 % a notch; Ctrl+wheel still zooms) and a single click flips a switch, presses a button, steps a rotary selector or plugs a switched jack. The circuit runs again as you turn (a quick run, even with Live off), so dots, stickers, LEDs, eyes and the scope parts follow; letting go is one undo step.

## [3.184.0] - 2026-11-08

### Added
- **Window tabs at the bottom of the CAD**, like the part / assembly / drawing tabs of a mechanical CAD: Schematic, Board, the instruments (oscilloscope, spectrum analyzer, Bode plotter, curve tracer) and the manual switch inside one browser tab instead of separate browser windows. **+** opens a tool in a tab, × closes one, ⧉ moves one to a window of its own (for a second monitor; its tab then brings that window up), a reload keeps the open tabs, Alt+S / Alt+B still jump. A tool window of its own (Board or Schematic button) brings up the CAD showing that tab.

### Changed
- *View ▾ → Board in this window* is now **Windows as tabs**, on by default and covering every tool, not only the board; untick it for a window per tool as before.

## [3.183.1] - 2026-11-05

### Fixed
- The project manager no longer stops at *Could not read the store: not found* when the store on the server is older than the page (no trash yet): it lists the projects and says to run `server/share/update.sh`.

## [3.183.0] - 2026-11-05

### Added
- **Performance history.** A revision saved right after a simulation keeps its results (output power, efficiency, dissipation, measurements); the Revisions preview lists them with the change since the revision before and charts one over every revision (click a row). *Compare with…* shows both revisions' results side by side; the manager shows each revision's output power.
- **Release package with a milestone.** Starring the revision on the sheet offers to keep its Gerbers, BOM and schematic PDF with it on the server, listed for download in the preview and the manager and carried in *Download all*.
- **File ▾ → Autosaves…**: copies kept in this browser while you edit (every 5 minutes of editing and when the tab is hidden or closed, the newest 60), each with what changed; Open puts one on the sheet, Ctrl+Z undoes it.
- **Your projects on the start screen** (signed in on aerocat.tech): up to 8 projects with their pictures, revision, status and milestones over the examples; a click opens the newest revision.

## [3.182.0] - 2026-11-05

### Added
- **Compare any two revisions.** *Compare with…* in File ▾ → Revisions… (or Shift+click in the list) shows two revisions side by side with every change between them, without opening either; *Open rB, mark changes since rA* puts the newer one on the sheet with Compare on.
- **Compare by connections.** What a pin is connected to is compared, not how the wires are drawn: a part moved with its wires says *wires redrawn, same connections* instead of a count of wires; a pin that now joins other pins is listed as rewired, with what it joins and leaves.
- **The board in Compare.** Parts placed, taken off, moved or turned, footprints, tracks (with their length), vias, the outline and the rest are listed, and the Board window draws them over the board while Compare is on. Each revision keeps a picture of its board (Sheet | Board in the preview).
- **A saved file remembers its revision**: File ▾ → Save keeps the project and revision the sheet came from, and opening the file again brings the r5 chip back. Each browser tab keeps its own revision.
- **Revision in the title block and on the board**: *auto* in the title block's Rev. field shows r5 (r5+ once changed since) on the sheet, in prints, PDFs and the KiCad export; `${REV}` in a board text puts it on the silkscreen and in the Gerbers.

## [3.181.0] - 2026-11-05

### Added
- **Trash for projects and revisions.** Deleting a project or a revision (in the project manager) moves it to a **Trash** card at the bottom of `projects.html`, where *Restore* brings it back for 30 days; after that it is deleted for good, or at once with *Delete for good*. Revision numbers are never reused.
- **Import project…** in the manager: a *Download all* file, a design saved with File ▾ → Save (as one revision), or a project's folder from a backup (`revisions/<id>/`) becomes a project again, with its numbers, messages, milestones and pictures. *Download all* now also carries the pictures, so nothing is lost on the way out and back.
- **Restore as new.** An older revision can be saved again as the newest one (*Restore as rN* in File ▾ → Revisions…, *Restore as new* in the manager), marked *from rN*, without touching the sheet; the revisions after it stay.
- **History graph** in the Revisions list: each revision is joined to the one before it, and one saved after opening an older revision branches off from that one, so tries that went another way stand out; milestones are gold dots.
- **The manager shows more and finds more**: each project's newest picture, milestones, a **status** (Idea, Design, Building, Done, Archived) picked in the list and a status filter (archived ones hidden by default), **tags** (Edit…), *Open rN ↗* for the newest revision, and a search that looks through every project and revision on the server (names, notes, tags, messages, changes, milestones), listing the revisions it found with the words in bold.
- **Nightly backup of the server's store** (projects, revisions, short links) to the desktop, with a copy kept where the NUC cannot reach it, and restore instructions next to the backups (see `server/share/README.md`).
- The store also keeps a board picture, simulation results and release files with a revision (used by the next versions).

### Changed
- The store accepts up to 48 MB a request under `/api/rev/` (an imported project) and has 256 MB of memory; `update.sh` raises the nginx limit once.

## [3.180.0] - 2026-11-04

### Changed
- **A transformer shows its model when you select it.** The output transformers' *Model* and the interstage's *Kind* are now kept with the part, so the type you picked stays in the inspector (and on the schematic label) when you type your own value over a field: the list marks it *(edited)* and the inspector names each value that differs from the datasheet. *Custom (your datasheet values)* is a transformer of your own. Circuits saved before are recognised by their values, as before.

### Fixed
- **Examples 13 and 14 showed "Your datasheet values" instead of their transformer.** Example 13's 1627SEA had a leakage of 16.2 mH against the model's 20.2 mH, and the 1608's primary DCR of 101.7 Ω (from Hammond's drawing) was rounded to 102 Ω in the catalogue, so neither matched. Example 13 now has the model's leakage (no change at 1 kHz), the catalogue keeps the drawing's 101.7 Ω, and examples 04, 13, 14 and 15 name their transformer (1627SEA, 1608, 1750H). The Gubin examples' output transformers are their own, so they show *Custom*.
- **Capacitances under 1 nF showed as 0 in the inspector** (a transformer's 200 pF winding capacitance, a 100 pF capacitor): the field now shows them in pico (200p). The value itself was always kept and simulated.

## [3.179.1] - 2026-11-03

### Removed
- **Board sockets with no drawing of their tails are no longer offered** (GZC7-Y-B, GZC8-Y-4, GZC9-F-Y-55, GZC9-Y-3, ПЛ9-4К, ПЛ7-4К): no shop, maker or catalogue publishes where their tails come down, and a footprint guessed from photos would not fit. The *Tube socket* list now has 88 GoodComponent and 29 Soviet sockets; chassis sockets stay, as they are wired to the board. A circuit saved with one of them shows *Any socket*.

## [3.179.0] - 2026-11-03

### Added
- **Soviet tube sockets.** The *Tube socket* list also has 31 Soviet sockets (ПЛК, ПЛ, ПП and the Chinese ones made to them), as sold by tec.org.ru, under their designations.
  - **ПЛК9-2П** (noval, tails bent out to Ø20), **ПЛК7-1П** (B7G, tails straight down on Ø9.5) and **ПЛК8-ПО** (octal, straight down on Ø17.5) solder into the board: their footprints and 3D models are taken from the shop's drawings.
  - ПЛ9-4К and ПЛ7-4К (board sockets with no drawing of their tails) and the chassis ones, with mounting screws and cut-outs where the drawings give them (ПЛК9-Ф, ПЛК9-Д40/55/60, ПЛК9-Э46/75, ПЛ9-3ПЭ-55, ПЛК7-Ф, ПЛК7-Д55, ПЛК7-Э46/55/60, ПЛ7-2КЭ-46/55, ПЛ7-1К, ПП-7, ПЛ8-1П, ПЛ8-3П, ПЛ8-1К, ПЛК8-2в, ПЛ24Ш-2К, ПЛКМ-2, ПЛКМ-4/1, ПЛК-300B, ПЛК-ГУ50, ПЛК-6С33С-Gold), go on the BOM.
  - The BOM's socket line gives the designation, its Latin spelling (the PDF fonts have no Cyrillic) and a link to the shop's page.
- **GZC7-Y** (GoodComponent's ceramic B7G board socket) has its footprint and 3D model now, from Parts Connexion's drawing of it (tails straight down on Ø9.5). The other board sockets still without one were looked for elsewhere too (Parts Connexion, the maker Dongxin's pages, the KiCad library work, Russian shops): no drawing of their tails is published, so GZC7-Y-B, GZC8-Y-4, GZC9-F-Y-55, ПЛ9-4К and ПЛ7-4К stay BOM only; Dongxin's GZC9-Y-3 drawing gives its body but not its tail circle.

## [3.178.2] - 2026-11-03

### Fixed
- **The generic UX4 socket footprint (2A3, 300B and other 4-pin valves on *Any socket*) has its pins on a 16.25 mm circle**, as real UX4 sockets do (GoodComponent's GZC4-T-G drawing); it had them on 22.2 mm, so a board made with it would not take a real socket. Example 13's board is re-routed for it (0 to route, 0 rule violations). The other generic sockets were checked against their standards and are right.

## [3.178.1] - 2026-11-03

### Fixed
- **A dual valve's sections share their socket.** Picking a *Tube socket* for one section of a dual triode (VL2.1 in the Gubin amplifier) now sets it on the other section too, and either section's inspector shows it; before, the other section kept *Any socket* and a pick made there was ignored.

## [3.178.0] - 2026-11-03

### Added
- **Real tube sockets from GoodComponent.** The tube's inspector has a **Tube socket** field listing GoodComponent's sockets for the valve's base (92 in all: noval, B7G, Magnoval, octal, UX4, jumbo 4-pin, ГУ-50, ГМ-70, 6С33С), the board ones first.
  - The 20 PCB-mount sockets with a published drawing get their own **board footprint**, measured from the drawing: tails on their own circle (bent-out tails on Ø21.5 for GZC9-Y, for example), drill per tail size, flange screw holes as unplated holes, the flange outline in silk. Picking a socket sets the board footprint once; a footprint picked by hand afterwards stays.
  - Each of them gets its **3D model**: ceramic, bakelite or PTFE body to its heights, the metal flange with its screws, the shield can (PCP9-Y-1, GZS9-B-1), and the valve seated on top of the socket.
  - Chassis, under-chassis and panel sockets put the valve on wire pads.
  - The **BOM** socket line shows the picked socket's item number (and its gold-pin version) with a link to its shop page.

## [3.177.0] - 2026-11-02

### Changed
- **No more Windows menu: the CAD's menus are arranged the way other simulators arrange them.** LTspice, Multisim, Altium and KiCad keep their Window menu for tiling and switching open windows, and put the instruments and analyses with simulation (Multisim's *Simulate → Instruments / Analyses*, LTspice's and Qucs's Simulate menu), the PCB behind a switch (KiCad's *Switch to PCB editor*, Proteus's module tabs) and the manual under Help. So:
  - **Analyze ▾**, next to *▶ Simulate*: *Instruments* (Oscilloscope, Spectrum analyzer, Bode plotter, Curve tracer, each in its own window ↗) and *Analyses* (Tolerance runs, Power sweep, Noise and hum, Parameter sweep, Listen, each a tab under the schematic; they were in *View ▾*). Below 1080 px it shows only its icon, so the toolbar stays one row down to 940 px in English and Russian.
  - **View ▾** keeps what the schematic shows (Voltages, Currents, Legend, Bill of materials, Checks) and takes *Board in this window*, with the interface language.
  - **?** is now the **Help menu**: *Quick help and shortcuts* (F1 or ? still open it straight away), *Manual* ↗ and *About & credits*.
  - *Board layout* left the menus: the *Schematic | Board* switch at the left of the toolbar (Alt+B) is the one way to the board, as before.

## [3.176.0] - 2026-11-02

### Changed
- **A new parts panel**, after the part choosers of KiCad and Altium. Each part is a compact row with a small picture of its own schematic symbol (drawn by the sheet's code), its name and its value in a quieter colour; group titles have line icons and part counts and stay at the top while their parts scroll; sub-groups are small captions instead of bright blue text.
- **Preview card** under the list: point at a part (or reach it with ↓ ↑ from the search box) to see its symbol large, its value and what it is (a tube's type, names, ratings and heater). Its title folds it away. The hover tooltip on palette parts is gone: the card says the same, without covering the sheet.
- **Search**: a search icon and a fold-all button beside the box; the typed text is marked in the names; ↓ ↑ walk the results and Enter picks the marked one.

### Added
- **Drag a part onto the sheet** to place it: its symbol follows the pointer and lands where you let go.
- **Favorites and Recent** at the top of the panel: right-click a part (or ☆ in the preview) to keep it in Favorites; Recent lists the last 8 parts picked. Kept in the browser.
- The palette is 240 px wide by default (was 210).

## [3.175.0] - 2026-11-02

### Changed
- **Example 04 now plays into a speaker.** The IRF820 source follower runs at ~29 mA (R7 5.6 kΩ 10 W, VT1 ~4 W on a heatsink) and feeds a Hammond 1627SEA (2.5 kΩ:8 Ω) through a 10 µF parafeed capacitor (no DC in the transformer), with an 8 Ω speaker on the secondary: about 0.5 W at 1 Vpk in. The board grows to 110 × 96 mm with the transformer's wire pads and a speaker terminal on the right edge, the 10 W resistor along the bottom; 0 to route, no rule violations. Every other amplifier example already drives a speaker.

## [3.174.1] - 2026-11-01

### Changed
- **A dimension's value goes wherever it is dragged**, up, down, left or right, in the Board: the dimension line moves nearer or further and its extension lines follow, still on the things it measures; dragged past an end, the line runs on to the value (it snaps back to the middle near it). A point-to-line dimension can now be moved sideways along its line too. The grab point stays under the pointer.

## [3.174.0] - 2026-11-01

### Changed
- **Board dimensions work like Smart Dimension in SolidWorks.** A **Dimension** button on the toolbar and the **D** key (Smart measure moves to Shift+D). Placing a dimension pops up a **Modify** box on its value with the distance selected: type, Enter or ✓ moves the second thing, Esc or ✗ keeps it, ⇄ flips the side, ↑ ↓ step 0.1 mm (Shift 1 mm). The tool stays on for the next dimension until Esc.
- In the Dimension tool a drag on a dimension's value moves it and a click opens its Modify box; with Select a double-click opens the box (it used to send you to the inspector). A pointer twitch during a click no longer counts as a drag.
- Smart measure's **Pin** is now **Keep** (Enter): a centre-to-centre measurement between pads, part origins, holes, vias, texts or corners becomes a reference dimension that is saved and can be dragged; typing a value into it makes it drive. Other measurements are pinned as before.

## [3.173.0] - 2026-11-01

### Added
- **Oscilloscope power-on scenarios.** *Scenario* replaces the Cathodes warm up box: **Cold start** (heaters and B+ at t = 0), **Hot restart** (hot cathodes, the mains onto empty capacitors), **Standby switch** (the heaters for a set delay, 30 s by default, then B+; time counts from the switch) and **Soft start** (the mains through a set resistor, 47 Ω, or the circuit's NTC inrush limiters, until a relay shorts it at a set time, 2 s; the report lists the relay). Auto duration follows the scenario.
- **The power-on run as it goes.** The record draws left to right every half second while the run goes on, with a line where it has got to and *12.4 s of 30 s · about 15 s left* in the status line. **■ Stop** keeps what has been computed as a shorter run, with its report. The Run button's hint gives the last run's speed and the time to expect.

## [3.172.0] - 2026-11-01

### Added
- **Oscilloscope power-on: warm-up lanes.** Under the record strip, one lane per heated tube on the screen's time axis (linear or log): a bar filling with the cathode's emission, a mark and *warm at* where it reaches 90 %, orange spans where the run found it overdrawn with a cold cathode, and its emission at the cursor on the right.
- **Capacitors plotted without a probe.** *Show…* in the power-on report plots any capacitor's voltage from the run's record (no new run), in its own colour with its own volts/div and rating line; clicking a capacitor's event plots it too. With no probe on the scope, B+ (the first reservoir capacitor) is plotted by itself.

## [3.171.0] - 2026-11-01

### Added
- **Oscilloscope power-on mode: report strip, time presets and log time.** In Power-on mode the controls sit above the screen (Duration, Cathodes warm up, ▶ Run) with time presets **Inrush** (0–200 ms), **Warm-up** (to three time constants of the slowest cathode), **Settled** (the last 200 ms) and **Whole**, keys 1–4, a **Log time** axis (log<sub>10</sub>(t + 1 ms), labelled 1-2-5) so the inrush and the warm-up show on one screen, and **Rating lines** on or off. Under the screen the **Power-on report** replaces the notes in the side panel: every event in time order with its time, part, value against its rating and a tag, **Critical** (a capacitor over 1.15 × its rating, a rectifier surge over its peak rating), **Warning** (a capacitor over its rating, a tube overdrawn while cold) or **Info** (a capacitor within 10 % of its rating, B+ settled to ±1 %), a verdict and **Copy**. Clicking an event zooms the screen to it with marker A on it; the overview strip and the screen's time axis carry a tick per event with its text on hover. On a narrow window the controls, presets, screen and report stack; at medium widths Display fits one row.
- The power-on run keeps a coarser min/max record of every capacitor's voltage (engine `watchPoints`), for B+ settling now and for plotting a capacitor without a probe next.

## [3.170.0] - 2026-11-01

### Changed
- **Cathode warm-up time constants from the heater's power and the kind of cathode.** τ now comes from P<sub>h</sub> = V<sub>h</sub> · I<sub>h</sub>: a directly heated filament 0.8 + 0.25 · I<sub>h</sub> (1–2 s); a standard indirectly heated cathode 4 + 1.2 · √P<sub>h</sub> (5–8 s: 12AX7 5.6 s, 6V6 6 s, EL84 6.6 s); a heavy one, a power tube or rectifier with 5 W of heater or more, 5 + 0.5 · P<sub>h</sub> (8–12 s: 6L6GC 8 s, EL34 9.7 s, KT88 10 s); a slow-start rectifier or damper (GZ34 / 5AR4) 5 + 0.5 · P<sub>h</sub> (10–15 s). The tube's inspector names the class and heater power.

### Added
- **Warm-up time constant** in the tube's inspector: a datasheet or measured value for the power-on run (0 keeps the automatic one).

## [3.169.0] - 2026-11-01

### Added
- **Driving dimensions in the Board window** (Construct ▾ → Dimension, Shift+D), the way a mechanical 2D sketcher does it. Click two things — a pad or a part's origin, a mounting hole, a via, a text, a keep-out corner or edge, a board corner, edge or centre, a construction point or line — place the dimension (above or below: horizontal; to the side: vertical; between: aligned; or H, V, A; a point and a line: the distance square to it), type the value and press Enter: the second thing moves there, the tracks on its pads following. They stay that far apart: drag either and the other follows, and a thing held in one direction only slides in the other; what cannot move goes back and the status line names the dimension that holds it. Locked things never move.
- **Align horizontally / vertically** (Construct ▾) for two or more selected parts, holes, vias or texts: the others line up with the first and stay lined up.
- **Reference dimensions and how defined a thing is.** A dimension that would over-constrain the board becomes a reference one (grey, in brackets: it only reads the distance); one that can no longer be met is drawn red. The inspector of a dimension edits its value and role; a part's, hole's, via's, text's or keep-out's inspector says how many dimensions hold it and whether it is fully defined or still free to move sideways or up and down, with Remove its dimensions. Show and Clear dimensions are in the menu. Our own least-change solver (Newton steps of the smallest move, the thing just dragged held still; the rank of the equations tells redundant dimensions and what is fully defined) solves 100 dimensions in a few milliseconds to 0.001 mm.
- Dimensions are notes for the designer: saved with the board, never exported (silkscreen, Gerbers, drill files, PDFs, KiCad, STEP, SVG). Help, README, hover hints and Russian included.

## [3.168.0] - 2026-11-01

### Added
- **Cathode warm-up in the power-on transient** (oscilloscope → *Power-on*, *Cathodes warm up*, on by default). The tubes' cathodes start cold and heat with their own time constant, typical for their heater: a directly heated filament (5U4G, 5Ц3С, 2A3, 300B) in 1–2 s, an indirectly heated cathode in 5–10 s (12AX7 about 6 s, EL84 7 s, EL34 and GZ34 about 10 s; the tube's inspector shows it). What a cathode can emit follows Richardson's law for an oxide cathode, so a cold tube draws nothing and the current comes up as it warms. The run shows what that does: B+ overshooting on silicon diodes or a fast directly heated rectifier until the amplifier's tubes conduct, a slow indirectly heated rectifier bringing it up gently.
- **Capacitor ratings on the power-on record.** A dashed line marks the voltage rating of every capacitor a channel reads across (its own, or the one the BOM picks from the settled peak), red when the trace goes over it; capacitors over 90 % of their rating during the run are listed under the controls.
- **Cold-cathode and surge warnings.** The power-on run lists a tube overdrawn while its cathode is still cold (below 90 % of its working temperature, the circuit asking 1.5 times or more what it can emit, more than it passes once settled and near its rating: for a rectifier 70 % of its peak current per anode, the handbook's or about 3 × its rated current), which strips a cathode's coating; and a rectifier's switch-on surge over its peak rating (hot cathodes onto empty capacitors, as with a standby switch).
- **Longer power-on runs.** *Duration* has *Auto* (three time constants of the slowest cathode, 5–60 s, opening on the whole record; 1 s with hot cathodes) and 5, 10, 20, 30 and 60 s. A run over 2 s takes at most 600,000 steps.

### Fixed
- The oscilloscope's time axis rounded labels at 2.5 s/div (and other steps with a fraction) to whole numbers (3 s, 8 s, 13 s for 2.5, 7.5, 12.5 s).

## [3.167.0] - 2026-11-01

### Added
- **The manual in Russian** (`help-ru.html`). With the interface in Russian, every way into the manual (*Windows ▾ → Manual*, the help dialog's link, **?** in the instruments and the Board) opens the Russian translation, all 19 sections, using the interface's own Russian names for menus and buttons. The parts reference, the glossary of readouts, the tube table and *About & credits* are built in Russian too, from the same Russian texts as the hover hints. An **RU / EN** button at the top of the manual's contents switches the manual and the interface together, and switching the language in any other window brings an open manual along. A test keeps the two manuals in step (the same sections, anchors, links, lists, tables and code).
- Russian names for the inspector fields and parts that still showed in English (pickup, cartridge, relay, rotary switch, vactrol, interstage transformer, speaker driver fields and others), in the inspector and the manual alike.

## [3.166.0] - 2026-11-01

### Added
- **About & credits** (Help → *About & credits*, and section 19 of the manual): the app's version, who made it and links to the blog post, the source and this changelog; the models and data it is built on (Norman Koren's tube equations, Katsnelson & Larionov's handbook for the Soviet tubes, the makers' datasheets, SPICE's device models, Thiele–Small, ngspice as the test reference, the drawing standards); the software (AssemblyScript, which compiles the solver, and the optional Freerouting); and, under *Show all credits*, the sources of the example circuits, the optional online services (the AI providers, DigiKey, RADIO BOB!) and the fonts and icons. It ends with the MIT licence and a safety note: a simulation is an estimate, not a safety check, and tube amplifiers run at lethal voltages. The dialog is in Russian too, with the Russian blog post.

## [3.165.1] - 2026-10-31

### Changed
- **The 3D view is for looking, not editing.** While it is open, the Board toolbar hides what does nothing there: undo and redo, the tools (Select, Route, Via, Text, Hole, Pour, Keep-out, Measure), the layer and grid, Construct ▾, Fit, Update, Auto-route, Route ▾ and Board ▾. The Schematic | Board switch, View ▾ (to go back), Export ▾, the language and help stay; the tools come back with the layout.

### Fixed
- The construction input box (the small purple frame) showed as an empty pill at the board's top-left corner, also over the 3D view, when it should have been hidden.

### Removed
- **Measure in the 3D view** (added in 3.162.0): the button, D in the 3D view and its readout. Smart measure in the layout (D) stays.

## [3.165.0] - 2026-10-31

### Changed
- **All example schematics tidied for reading (examples 01–20).** One ground bar with a single ground symbol per area instead of a symbol at every part; each supply rail of the transistor amplifiers (16–20) a single bus with one rail symbol, and their supply terminal with its decoupling capacitors in one block; parts moved a grid step or two so that no wire runs through a part, a designator or a value, and no label sits on another; square corners, fewer crossings and zig-zags; notes and the signal generator inside the frame. Nothing electrical changed: every example was checked in the app before and after for the same parts and values, the same nets pin for pin, the same named supplies and board net names, and the same DC operating point at every pin. The boards are untouched (still 0 open, 0 rule messages). Example 07 was already clean and stays as it was. Gallery pictures redrawn.

### Fixed
- **Title block text running into the next cell.** A value too long for its cell (the 555 examples' and the Hammond examples' technical reference) was squeezed into one line and overflowed; it now wraps onto two or three lines.

## [3.164.0] - 2026-10-31

### Added
- **Five transistor power amplifiers with SMD boards (examples 16–20).** The app's own designs, 7 to 12 transistors each, simulated and with a finished two-layer board placed part by part as a board designer would (input jack on the left, outputs and speaker terminal on the right, supply terminal beside the output devices with their decoupling capacitors, M3 holes in the corners, ground pour on the bottom), routed by the grid router to 0 connections open and 0 rule messages: a 12 W amplifier with complementary feedback pairs at ±15 V, all SMD (12 W at 1 % THD); a 50 W amplifier with MJL4281A / MJL4302A outputs on the board edge at ±30 V (51 W); a 14 W single-ended class-A amplifier with a 1.8 A current sink, 4 × TIP36C on heatsinks along two edges (14 W, 64 W of heat at idle); a 30 W quasi-complementary amplifier with a bootstrapped VAS and TIP41C outputs in D²PAK (32 W); a 40 W amplifier with IRF540N / IRF9540N followers in D²PAK (38 W at 1 %, 47 W at 10 %). Each one's Gerber and drill files were checked against its design (drills, copper, the netlist read back from the copper, clearances, mask, paste, placement file): no differences. Gallery pictures, Russian titles and descriptions.
- **Transistor models:** BC546B, BC549C, BC556B, BC559C; TIP35C / TIP36C (TO-247, 25 A); MJL4281A / MJL4302A (TO-264, 230 W), fitted to their data sheets' hFE and V<sub>BE</sub> curves, with pinouts.
- **Rule check: vias in SMD pads.** A via in or touching a surface-mount pad is an error: the mask opens over it and the solder paste runs down the hole, starving the joint (*Design rules → Vias in SMD pads*).

### Fixed
- **The grid router no longer drops vias into SMD pads.** It treated its own net's SMD pads as free copper and put a via in the pad (a ground pad down to the bottom pour, for one); the Gerber check of the new boards found 4 to 7 per board. Vias now keep 0.15 mm or more off every SMD pad, and the track leaves the pad to drop through beside it.
- **DC operating point of circuits with steep bias networks.** The solver's gmin stepping gave up at the first failed step and its source stepping went in fixed twentieths; a CFP output stage with a Vbe-multiplier servo failed to find its bias at some trimmer settings ("singular matrix"). Both now step adaptively (smaller steps where it struggles, larger where it is easy).
- **Silkscreen references on dense SMD boards.** A part's reference went above its body even when a neighbour's pad was there (the maker clips it); it now takes the first spot of above, below, right or left that stays on the board and clear of the pads nearby, in the board view, Gerbers and KiCad export alike.
- **Latch-up found in simulation and designed out (example 17).** Overdriven into clipping, a VAS current sink that shared its LED reference with the input pair saturated, robbed the reference and held the output at the negative rail; a 4.7 kΩ base resistor stops it.

## [3.163.0] - 2026-10-31

### Added
- **Construction geometry for placing mounting holes (Board, Construct ▾).** Dashed construction lines through two points or one point at an angle θ (C; endless, ray or segment; the angle from the X axis, a board edge or another line), offsets of a board edge, a keep-out edge, a construction line or circle, or the whole outline contour with its corners rounded smaller (O; d > 0 into the board), circles and arcs round holes, pads and points with R from the centre or from the hole's rim (Shift+C; also a hole's right-click menu), reference points (Shift+P), and linear and polar arrays by step or total span. Drawn dashed in their own colour, saved with the board, and never in any export (Gerber, drill, PDF, KiCad, STEP, SVG).
- **Snapping and typed numbers.** Clicks stick to construction points, crossings (line–line, line–circle, construction–board edge), circle centres and quarter points, the rounded corners' centres, segment midpoints and ends, tangent points while drawing a line, and onto construction; Construct ▾ → Snap to turns each kind on or off, Alt snaps to the grid only. Smart measure snaps to them too. With a construction tool or the hole tool on, digits go into a box by the pointer (θ, d, R, Δx Δy Ø; Tab, Enter, Esc) and the dashed preview follows.
- **Tied, so it follows.** Every item keeps what it was drawn from: resizing the board or moving a hole, pad or part moves the construction and the mounting holes placed on it. The hole tool ties a hole to the point it snaps to, Δx Δy from a hole, pad, corner or crossing; a hole dragged by hand keeps its tie with the new offset; Detach (inspector, right-click) turns an item or hole into plain coordinates, and deleting an item detaches what was drawn from it. The inspector shows each tie in words (e.g. "Offset = 5.00 mm from board bottom edge") with fields to change it. Board setup's corner holes are now tied to their corners. Holes on all of an item's points, or on every construction point, at once; several selected holes take one diameter and plating. Show, Lock and Clear construction in the menu.
- **Hole tolerance and finish.** A mounting hole takes a diameter tolerance (+/−) and a counterbore (Ø, depth) or countersink (Ø, 82°/90°/100°/120°), drawn on the board and listed for the board maker in the Gerber ZIP's README.
- **Hole to the board edge design rule** (Design rules → Hole to the board edge, 1 mm by default): a mounting hole's wall too near the edge, or cutting it, is reported; the hole tool's ghost turns red there. Help, README, hover hints and Russian included.
## [3.162.0] - 2026-10-31

### Added
- **Smart measure in the Board window** (from the STEP viewer, the parts that fit a board). The Measure tool (D) now knows what it stuck to. One click gives the thing's size in a card at the bottom left: a pad's size, shape, drill, annular ring, side and net; a via's pad, drill and ring; a hole's diameter, copper ring and distance to the nearest board edge; a track segment's length, angle and width with the whole track's length, layer and net; the board's size and area. A second click gives what relates them, and before it the card follows the pointer: two pads, vias or holes give the pitch centre to centre (Δx, Δy, direction), the copper edge to edge checked against the clearance rule for those two nets (high-voltage classes and IPC-2221B included), drill wall to wall and the outer span, with Centre / Edge / Outer (or C) choosing the one drawn; a centre or a point against a track or the board edge gives the distance square to it, where the foot falls and the copper gap against the clearance or edge-clearance rule; parallel tracks or edges give their gap and offset, others the angle and where their lines cross. Copper closer than the rules is red. Pin (Enter) keeps measurements on the board (Del takes the last off, Clear all), Copy puts the details on the clipboard, units mm, mil or inch. A pad now wins over the track end on its centre when snapping.
- **Measuring in the 3D view.** Measure (or D in the 3D view): click a point on the board or a part for its height above the board, a second for the distance in 3D with ΔX, ΔY, ΔZ and along the board; a click sticks to the nearest corner of the surface it hits. Help, README, tooltips and Russian included.

## [3.161.1] - 2026-10-31

### Fixed
- **Square pads' corners in the board's checks.** The design-rule check, teardrops, pour spokes and the grid router measured a square pad (pin 1 of a socket, an IC, a TO-92, a transformer) as a rounded capsule, which reaches past the square's sides but misses its corners by up to 0.26 mm. Copper could pass a corner closer than the rule and still show 0 rule messages: a Gerber check of every example found a track 0.09 mm from the 2N3904's emitter pin (examples 1 and 2) and two teardrops inside their clearance (examples 3 and 10). Square pads are now measured as their rectangle, corners included, everywhere the clearance is checked or kept; the 27 places this showed on 10 example boards were re-routed by hand or by the grid router, and every example again opens with 0 connections open and 0 rule messages. The Gerber and drill files of all 15 examples were checked against their designs (drills, copper, the netlist read back from the copper, clearances, solder mask, silkscreen, outline): no differences. Help, README and the rule-check hover hint (English and Russian) say it.

## [3.161.0] - 2026-10-31

### Changed
- **Every example's board laid out again, by hand, as a board designer would.** All 15 example boards were placed part by part instead of by the automatic placer: the signal flows from the input jack across to the output transformer leads, with the input kept away from the output and the supply; grid leaks and coupling capacitors sit at their socket pins, cathode resistors and bypass capacitors under their valve, anode loads beside it; the heaters are hand-routed as a pair (one wire on each layer, side by side) along an edge or a corridor between the valves instead of wandering across the board; B+ runs along the edge (2A3); 5 W cathode resistors are kept 10 mm or more from electrolytics and hot valves; the MOSFETs of the 10 W amplifier stand on the heatsink edge with the bias trimmer between their gates; the rectifier's anodes face their resistors (5Ц4С supply); jacks, pots and terminals are on the board edges; each board has M3 screw holes in the corners and within 40 mm of every valve socket, and a ground pour on the bottom. Board sizes were changed where the layout needed it, and the 12AX7 / MPSA92 board's high-voltage floor set to 0.6 mm (IPC-2221B still gives each net its own by voltage). The rest is routed by the grid router: every board opens with 0 connections open and 0 rule messages. Help and README describe it.

## [3.160.0] - 2026-10-31

### Added
- **Standing resistors (vertical mounting) on the board.** An axial resistor gets a *Mounting* property in the Board inspector, Horizontal | Vertical (one part or a whole selection), also on the right mouse button and on Shift+V with it selected or while dragging it (with nothing that can stand up selected, Shift+V is still the via tool). Standing, the body sits upright on pad 1 and the top lead bends over in a hairpin down to pad 2. No stored variants: lead spacing = max(D + d + 2R rounded up to 0.05 mm, 2.54 mm and the pads 0.4 mm apart), height = L + R + 2d, from the body length and diameter (part number, standard size or set by hand), the lead diameter and the least bend radius (IPC-A-610 by lead diameter, or set by hand: *Body (mm)* offers lead Ø and bend R while standing). A ¼ W resistor stands on 4.3 mm and is 8.1 mm tall. Silkscreen: the body's circle round pad 1 with a pin 1 notch mark and the hairpin lead; the courtyard grows with the height for a 5° lean when soldered. The track ends on its pads follow when it is stood up or laid down, so nets and routing stay joined. The 3D view and STEP show it standing with the top lead folded over; Gerber, drill, KiCad and Freerouting exports use the worked-out pads (footprint named by its sizes, e.g. `AXIAL-V-D2.5-L6.3-P4.3`).
- **Enclosure height check.** *Design rules → Enclosure height above the board* (0: no limit, the default) and a *Part height under the lid* check: a top-side axial resistor taller than it (standing L + R + 2d, lying Ø + 0.4 mm) is a Z-axis clearance error. Help, README, hover hints and Russian included.

## [3.159.0] - 2026-10-31

### Changed
- **File ▾ → Recent files instead of the examples list.** The File menu no longer lists every example (they are all on the start screen, *File ▾ → Gallery…*, with their pictures); in their place it lists the last 8 circuits opened or saved in this browser, and the examples opened, newest first with the time or date. A click opens one again: Chrome and Edge read the file itself again (asking once for permission) so Save keeps writing to it; if the file was moved or deleted, permission is refused, or the browser cannot open files by itself (Safari, Firefox), the copy kept in the browser at the last open or save opens instead and the status line says so. A file with no copy leaves the list. *Clear recent files* empties it. Hover hints and Russian included.

## [3.158.0] - 2026-10-31

### Added
- **Icons on the buttons and in the menus.** The CAD's Select, Wire, Probe, Fit and Inspector buttons and every item of File ▾, View ▾, Edit ▾, AI ▾ and Windows ▾ have a line icon before their name; so have Board Design's View ▾, Route ▾, Board ▾ and Export ▾ items and its 3D view buttons, the curve tracer's model, CSV and PNG buttons and the oscilloscope's Autoset. They come from one set of 70-odd icons in the app's own style (`icons.js`, 16 px lines in the text colour, no icon font or outside host), and the names stay. A narrower window shows the toolbar buttons by their icon alone (the tooltip names each), so the CAD toolbar now keeps one row from 940 px up in English and Russian, with a sheet list shown too.

## [3.157.0] - 2026-10-30

### Changed
- **STEP export: round parts and holes are really round.** Capacitor cans, resistor and diode bodies, pot shafts and knobs, valve envelopes, leads, every drilled hole and the board's rounded corners now go into the STEP file as circles and cylindrical surfaces instead of 12–32 flat facets, so FreeCAD, KiCad or any MCAD shows them smooth and can snap to a hole's centre or measure a can's diameter. Checked with OpenCascade: all solids valid, volumes right. The 3D view shades the round sides smooth as well. The Export STEP buttons say so in their hover hint (RU and EN).

## [3.156.0] - 2026-10-30

### Added
- **Russian interface, all windows and the hints.** The Board window, the oscilloscope, the spectrum analyzer, the Bode plotter and the curve tracer now follow the RU / EN choice too, and each has its own **RU / EN** button; switching in any window switches every open one. Board covers the toolbar, the Route ▾, Board ▾ and Export ▾ menus, the panels, the design-rule check, Board setup, Design rules, Freerouting and Print dialogs, the footprint descriptions and the status line; the instruments their controls, readouts and tables.
- **Hover hints in Russian.** Every hint (the palette parts, the inspector fields, the readouts and settings of every window, 433 in all) has its Russian text, and an inspector label shown in Russian still finds its hint. Formulas stay as they are.
- Russian toolbars keep one row: the Board tools show as icons below 1880 px in Russian, the Bode plotter's subtitle and the Schematic | Board names give way sooner.

## [3.155.0] - 2026-10-30

### Added
- **Russian interface.** The **RU** button at the right of the CAD toolbar (and *View ▾ → Interface → Русский*) puts the CAD in Russian: the toolbar, the menus, the parts palette, the inspector, the panels under the schematic (BOM, Checks, Tolerance, Power, Noise, Sweep, Listen, Tune), the dialogs, the start screen with every example's description, reusable blocks, and the tooltips. **EN** switches back. Every open CAD window follows, and the browser remembers the choice. Part numbers, values and units are not translated, and neither is the drawing. A text not translated yet stays in English. The Board window, the instruments and the manual come next.

## [3.154.1] - 2026-10-30

### Fixed
- **Noise tab: the mains hum says where it comes from.** The Hum table's ripple lines now sit under "From G1 (230 V 50 Hz mains), through the supply", and the *Noise from* list ends with a "G1 (…mains): hum, see below" line with its A-weighted total. The mains was already counted (as ripple) but was not named, so it looked missing from the list of sources.

## [3.154.0] - 2026-10-30

### Added
- **Reusable blocks.** Select a stage or a whole channel and choose *Edit ▾ → Make block from selection…*; then *Edit ▾ → Blocks… → Place* and a click puts another copy on the sheet (the second channel of a stereo amplifier). Each copy is ordinary parts and wires, so the simulation, the board, the BOM and every export see the flat circuit.
  - **Edit once:** a value changed on a part of any copy changes on the same part of every copy, in one undo step. After adding, moving or rewiring parts in one copy, *Select this copy* (right mouse button) and *Update block from selection* make it the block and redraw every other copy where it stands, keeping its designators, its parts' identities (the board keeps their places) and its own sheet-connector names.
  - Each copy gets its own designators (a dual triode's sections stay one tube); sheet connectors keep each copy's own name, so the channels stay apart (the status bar reminds you to rename a new copy's connectors); power rails are shared.
  - A dashed outline with the block's name marks every copy on screen; the inspector of a part in a copy names the block and the copy and offers *Select this copy*, *Detach* and *Blocks…*; *Make block…* and *Update block from selection* in the inspector of a selection.
  - *Blocks…* lists the circuit's blocks (Place, Rename, Save to library, Delete) and **My library**, kept in the browser, to place a block in any other circuit. Blocks are saved in the circuit file (`blocks`) and travel in share links, revisions and undo.

## [3.152.0] - 2026-10-30

### Added
- **Start screen.** When the CAD opens on an empty sheet (a first visit, or after the sheet was cleared) it shows **New circuit…**, **Open file…** and every example with a picture of its first sheet, in four groups: tube amplifiers, tubes with transistors, transistor amplifiers and the 555 timer. A click opens the example. *File ▾ → Gallery…* brings it up at any time; clear its tick box and it shows only from there. It fits a phone screen too. The pictures are in `examples/thumbs`; `node scripts/example-thumbs.mjs` draws them again after an example changes.

### Changed
- Opening an example asks first only when there is a circuit on the sheet (an empty drawing frame no longer counts as one).
- The legend in the corner of the schematic fades while the pointer is over it, so the drawing under it shows.
- Parameter sweep: with nothing picked yet it steps a resistor (before a capacitor, then the rest) instead of the part whose name sorts first (often the speaker's impedance), and plots the speaker's output (else a scope channel) instead of the first tube's current.
- Auto-tune: with no goal yet, one button adds the usual pair: the speaker's power a quarter above what it gives now, at no more than 1 % THD.

## [3.151.1] - 2026-10-30

### Fixed
- **Every example now comes with a finished board.** Examples 13, 14 and 15 opened with their parts below an empty board, example 06 with 4 connections open and 7 rule violations, example 03 with one open, examples 04 and 05 with a track too close to another. The board's own router has laid out and routed them: every example's board is placed and fully routed with no rule violations (the mounting-hole warnings stay). Example 03's high-voltage clearance is 1.25 mm, as IPC-2221B asks at its voltages: at 2 mm the MPSA92's middle pin could not be reached between its neighbours. A browser test now opens every example's board and checks it.
- Board: when Design from scratch or Finish routing kept the board as it was, the board was not drawn again: it showed the last layout tried, without its tracks, and "67 connections to route" beside "everything routed" until the mouse moved.
- CAD toolbar: on a circuit with several sheets it took two rows below about 1700 px, as the sheet selector kept its full width. The selector now takes the room left over (like the file name) and gives way below 1240 px, where the scroll bar under the drawing and Page Up / Page Down still step through the sheets. One row from 960 px up.
- Escape closes every CAD dialog (Revisions, Share link, Save, Export, Print, SPICE netlist, AI settings and the rest) wherever the focus is; before, most closed only with the focus inside them, and the Revisions dialog not even then, so it stayed over the toolbar.
- The curve tracer has the **Schematic | Board** switch at the left of its toolbar, as the oscilloscope, spectrum analyzer and Bode plotter do, in place of the Circuit CAD ↗ button.
- Board: the help, the Route ▾ menu and the README said Auto-route sends the board to Freerouting and stays grey until Freerouting answers; since 3.140.0 it uses the board's own grid router, Freerouting only when ticked.
- On a phone the CAD no longer scrolls sideways (the closed inspector drawer waiting off the right edge made the page 710 px wide on a 390 px screen).

## [3.151.0] - 2026-10-30

### Added
- **KiCad export.** *File ▾ → Export KiCad project* in the Circuit CAD writes a ZIP with a KiCad 7 project (KiCad 8 and 9 open it too); *Export ▾ → KiCad board (ZIP)* in the Board window writes the board part of it.
  - **Schematic** (`.kicad_sch`): every symbol is the one on the sheet, drawn by the CAD's own code, with its reference and value where the sheet has them; a dual valve's sections are units of one symbol; each drawing frame is a sheet under a root sheet (one frame or none: a single sheet), with its title block. Ground, rails and sheet connectors are power symbols. Valve heaters and internal shields, which the board wires but the schematic does not draw, are an extra unit of their valve; the heater supplies (XH) and the star point (XG) are boxes of their own; both join their nets by global labels.
  - **Board** (`.kicad_pcb`, when its parts are placed): footprints with pads, silkscreen and courtyard (parts on the bottom flipped as KiCad flips them), tracks, vias, mounting holes, texts, the rounded outline, copper pours (KiCad fills them) and keep-out areas. Each footprint names its symbol and each pin carries its pad's number, so *Update PCB from Schematic* pairs the two; net names are the Board window's, and the power and high-voltage nets get a label on the schematic so the names (and their classes) survive an update.
  - **Rules**: the net classes (Signal, Power, HV, with their widths and clearances) in the `.kicad_pro`; in the `.kicad_dru`, the clearance by voltage (IPC-2221B) for each pair of nets that needs more than its classes give, and each part's own pin spacing (a noval socket, a TO-92) and thin rings inside its courtyard, as the Board window's rule check allows them.
  - **Libraries**: the symbols (`TubeAmpCAD.kicad_sym`) and footprints (`TubeAmpCAD.pretty`) the project uses, with the project's library tables.
  - Checked with KiCad 7.0.11 on all fifteen examples: every file loads; KiCad's netlist of the schematic joins exactly the pads the board joins; after KiCad fills the pours the unrouted connections are the Board window's; KiCad's DRC finds the clearance problems the Board window finds, give or take a few near misses.

## [3.150.1] - 2026-10-30

### Fixed
- The Bode plotter no longer waits forever on "No response yet" when the CAD answered its opening before the window's own script had loaded (it asked for the response only when the next simulation came in). This hung CI once on 3.149.0.
- Browser tests: the flashing-LED check waits for a result of the 555's own circuit (a run of the example before it could still land after the switch, read as OUT stuck at 29.39 V), and brings the CAD to the front before Animate (a background tab gets no animation frames, so the LED never blinked). The Bode check reports why when no response arrives instead of stopping the whole run.

## [3.150.0] - 2026-10-30

### Added
- **Loop gain and phase margin** in the Bode plotter: *Measure → Loop gain* answers "will my feedback amplifier oscillate?". The loop is broken at one end of a part (*Break at*; the feedback resistor from the speaker or output transformer is found and listed first, then anode-to-grid and op-amp feedback, then every other resistor and capacitor) and measured by Middlebrook's double injection, exact whatever the impedances either side of the break. The plot shows |T| and its phase with 0 dB and ±180° marked; the panel gives the loop gain and the feedback (|1 + T|) at 1 kHz, the unity-gain frequency, phase margin and gain margin at the high and the low end, and a verdict (stable, ringing, likely to oscillate, oscillates, positive feedback). Example 06: 4.1 dB of loop gain, 8.3 dB of feedback, 46° of margin at 122 kHz and 116° at 37 Hz.
- **Noise and hum**, a *Noise* tab under the schematic (*View ▾ → Noise and hum*). With the generators quiet: every resistor's thermal noise, each tube's (an equivalent noise resistance of 2.5/gm, a pentode's partition noise, a 1/f corner you set), transistor shot noise and FET channel noise, carried to the output by the adjoint of the linearized circuit; the output noise flat and A-weighted over 20 Hz – 20 kHz, the input noise and its density at 1 kHz, a density chart, and each part's share. The supply's ripple at the output, at every harmonic of the mains, from the steady state with the generators quiet; and an estimate of AC heater hum (one side grounded, centre-tapped or DC; 5 pF and 100 MΩ heater to cathode, a directly heated filament in series with its cathode). The signal-to-noise ratio in dB(A), noise and hum together, re 1 W into the speaker. Example 07: 2.1 µV (A) of noise and 47 µV of 100 Hz ripple at the speaker, 109.7 dB(A) re 1 W.
- Engine: `loopGain` and `noiseSweep`; `acSweep` now drives current sources and returns branch currents on request.

### Fixed
- The BOM's line count no longer grows a long note while a simulation runs (now "simulating…", the detail in its tooltip), so the dock's head stops wrapping to another line and back. A line selected on the sheet stays where it was scrolled to when lines above it change height.

## [3.149.0] - 2026-10-30

### Added
- Every example is checked against ngspice on each build: `npm run test:ngspice` opens each example, runs "Simulate until settled", runs the circuit's SPICE export through ngspice and compares the DC operating point (within 0.3 %) and the signal at every node (within 3 %). A circuit on a mains supply is compared averaged over the same window after 8 s of ngspice transient. CI runs it as its own job. The five 555 examples are skipped, since the export leaves the NE555 to the maker's macro model.

### Fixed
- DC operating point: the solve left a 1 nS conductance from every node to ground, which a node fed through a megohm feels: in the new EL84 and 6V6 push-pull examples 50 nA through the cathodyne's 1 MΩ grid resistor put its cathode 0.8 V (1.6 %) low. A last pass at 1 pS, the transient's and ngspice's value, now takes it away; the examples agree with ngspice within 0.01 %.
- SPICE export: transistors ran 2 °C warmer in ngspice than in the CAD, about 7 mV less VBE, so a 2N3904 stage's collector sat 40 mV lower in ngspice. The CAD's thermal voltage at 25 °C (25.85 mV) is SPICE's at its nominal 27 °C, but the models went out with TNOM=25 and ngspice runs at 27 °C. Models now go out with TNOM=27 and a part's temperature on that scale (45 °C is `temp=47.13`); the curve tracer's model export too. The DC operating points of examples 01–05 now match ngspice within 0.1 %.

## [3.148.0] - 2026-10-30

### Changed
- **Auto-tune's progress chart says what it shows.** The Tune tab's chart now has axes with values: the try number across, and how far the circuit is off its goals up the side, in % on a log scale (the rms of each goal's miss; 0 when every goal is met). Each try is a dot (× when it did not settle), the best so far is a line, the best try is marked ("best · try 37"), a dotted line follows the try running now, and a green band at the foot is where every goal is met. Hover a dot for that try's miss and goals met. A line above it reads "Try 17 / 120 · 1 of 2 goals met · best at try 9 · off by 4.2 %", a legend explains the marks, and the goals table has an **Off by** column per goal.

## [3.147.4] - 2026-10-30

### Fixed
- **Release used CI's result only by luck.** It looked at CI three times per round (passed? failed? still running?); when the run finished between the first and the last look, it saw none passed and none running and tested everything again by itself (the 3.147.3 release took 6½ minutes so). It now reads all three from one look.

## [3.147.3] - 2026-10-30

### Changed
- **CI on main starts at once.** Each commit on main gets its own CI run straight away instead of queueing behind the run before it (the first release of the faster CI waited 4 minutes so), and the browser test groups are rebalanced: part 08 alone, every other part in the other group. The browser test of Board in the oscilloscope (Safari) waits up to 15 s for the board, not 3 s: on a busy CI runner it once came later and failed the run.

## [3.147.2] - 2026-10-30

### Changed
- **Faster checks and releases.** CI runs the browser tests in four jobs side by side (source and packaged build, each in two groups of parts; `E2E_PARTS=01,08 node tests/e2e.mjs` runs only some parts), lint and the engine tests in a fifth: about 3½ minutes instead of 10½. The release no longer runs the tests a second time: it waits for CI on the same commit and uses its result (it still tests by itself when that commit has no finished CI run), and CI on main no longer cancels a commit's run when the next one is merged. The browser test of Design from scratch locks all but six resistors, so it routes a few connections per layout instead of the whole board (about 2 minutes less per run).

## [3.147.1] - 2026-10-30

### Fixed
- **Undo button.** The toolbar's Undo and Redo buttons did nothing, and Edit ▾ → Undo / Redo went two steps at a time: the menu items had the same names as the buttons, so both clicks were wired to the menu item. Each now steps once.
- **Ctrl+Z after picking from a list.** With the focus still on a drop-down list, tick box or slider (the Listen source, a Tune goal), Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z did nothing; they now undo and redo the circuit. In a text or number field they still undo the typing.
- **Auto-tune after Undo.** Undoing applied values left the button at "✓ Applied", so the values could not be set again; Apply also showed "the circuit changed since this run" right after it. The tab now follows undo and redo: back at the run's start, Apply is offered again; back at the applied values, they show as applied.
- **AI: the Undo under an applied fix** takes back only that fix. After other edits it says so instead of undoing the last of those.

## [3.147.0] - 2026-10-30

### Added
- **Listen: 70s rock radio (live).** A new choice in Play tunes in to RADIO BOB! 70s Rock, catches the next few seconds of the live broadcast (as long as Length) and plays them through the circuit in stereo, like a file. **↻ Tune in again** catches a fresh piece and renders it; ▶ Render while tuning in stops it. The 192 kbps stream is tried when the 128 kbps one fails, and a station that cannot be reached is said so in the tab.

### Fixed
- **Listen: From** shows only for a file again (it showed for the riff and the tone too, where it does nothing).

## [3.146.0] - 2026-10-30

### Fixed
- **Board: Design from scratch on a fresh board.** Panel parts (pots, jacks, switches, the heater connector) stayed in the row below the board, so the layouts could never reach their pins: a 24-part 6F5P amplifier took 4½ minutes and left 9 connections open. They now go on the board first, where they sit in the schematic (as Place all puts them), and the same board is designed and fully routed in 13 s. Parts still below the board are named as not on the board yet, not as shut in by the board edge.
- **Board: grid stopper check.** The 10 mm now counts from the socket's edge, not from the pin: a grid pin sits about 9 mm inside an octal socket's body, so no stopper outside it could pass. A grid fed directly by the other section's anode (a Williamson's cathodyne) is no longer taken for a stopper's net with its anode resistor as the stopper.

### Changed
- **Board: Design from scratch pulls grid stoppers to their sockets**, and a layout with a stopper far from its socket scores worse.

## [3.145.0] - 2026-10-30

### Added
- **Board: the status line follows the grid router.** While it routes, the status line shows its pass, the crossings (nets too close to each other) it still has to sort out and the connections not joined yet, with a small graph of the crossings falling pass by pass and a thin line under the bar for how far the passes have gone. On Auto-route the bar fills as the crossings go.
- **Stop** in the status line ends any routing run at once (the grid router's background step too); what is routed so far stays.

### Changed
- Without Freerouting, Auto-route, Finish routing and Design from scratch let the grid router go first and the maze search after it, on what it left (before, the maze search laid most tracks one by one, then the grid router took many of them up again). Example 06 from a bare board: routed fully in 8 s instead of 21 s.

## [3.144.1] - 2026-10-30

### Fixed
- **Board: zigzag tracks.** Tidying tracks (pulling the grid finishers' staircases into straight and 45° runs) never ran since 3.131.0: the step was handed an empty list of tracks. It runs again after every Auto-route, Finish routing and Design from scratch, and when one track's new shape would break a rule, only that track keeps its old shape (before, one such track kept them all as they were).
- **Board: tracks laid twice.** When the grid router took up part of an old track that was in the way, the pieces of it left at the pads stayed beside the new route, so a connection was laid twice, side by side (it looked like a short; no two nets touched). The router now takes up a leftover piece whose pads stay joined without it, and cuts a loose end back to where it meets copper instead of dropping the whole segment, which could leave a connection open. Tidying also takes off any doubled copper left on a board, and Auto-route on a fully routed board now tidies it.

## [3.144.0] - 2026-10-30

### Added
- Revisions: **Compare on the sheet** marks on the drawing what changed since a revision (parts added green, changed amber, moved blue; parts and wires taken out drawn faintly in red where they were), with a bar that counts them and steps from one change to the next; it follows your edits; Esc or Done leaves it.
- Revisions: a **preview** of the revision picked, with a picture of its first sheet (saved with each revision), its message, changes and the revision it was made from (**from rN**, when saved after opening an older one).
- Revisions: **milestones** (☆ Milestone…: Sent to fab, Built, Measured…) and a ★ Milestones filter.
- The toolbar's **r5** chip: the revision the sheet came from, with • once it has changed since; click it for the dialog. **Ctrl+Alt+S** opens the dialog ready for the message.
- Project manager: revision pictures (point at one to enlarge), milestones, sorting by last change, name or size, and the page's own dialogs instead of the browser's for editing and deleting.
- Server: each revision may keep a picture (`<n>.thumb`, PNG/JPEG/WebP up to 200 kB), the revision it came from and a milestone name.

## [3.143.0] - 2026-10-30

### Added
- **Revisions** (File ▾ → Revisions…, on aerocat.tech for the site's owner only, behind its Cloudflare Access login): each circuit/board project keeps numbered revisions on the site. **Save revision** keeps the whole design (imported tubes and board included) with a message and a summary of what changed since the last one (parts added, removed, changed with old → new values, moved, wires, board); **Open** puts an earlier revision on the sheet; **Compare** says what differs from the sheet; **Download all** saves a project's revisions in one JSON file. `#rev=<project>.<n>` opens a revision in the CAD.
- **Project manager** (`projects.html`, same login): the space taken by revisions and short links against the 100 MB, and the server's free disk; every project with its revisions (open in the CAD, download, edit the message, delete; rename, download, delete a project) and every short link (open, delete).
- Server (`server/share`): the link store also keeps the projects (`/api/rev/`, in `./revisions`), checks the Cloudflare Access token itself (RS256 against the team's keys, issuer, expiry; optionally the application's AUD tag and e-mails), and refuses changes from other sites' pages. Revisions and links share one budget (`MAX_TOTAL`, 100 MB): a revision makes room by deleting the oldest links, and revisions are never deleted to make room (`MAX_REVISIONS`, `MAX_SHARES` cap each). `update.sh` updates the NUC install in one command.

## [3.142.0] - 2026-10-30

### Added
- **Design from a description** (AI ▾, with your AI key): describe an amplifier or a stage and the model designs it from the library's parts as a netlist. The CAD checks it against the library (a design it cannot use goes back once), draws it on a new sheet in signal order (each pin's stub ends in a ground, a supply rail or a sheet connector named after its net), simulates it, and sends the Checks back with the operating points for up to two revisions. Ctrl+Z brings back the circuit you had.
- **Tube from a datasheet** (AI ▾, with your AI key): a tube's datasheet PDF goes to the model, which reads the type, socket, heater, ratings, pinout and points along the plate curves. A Koren model is fitted to the points (from the most similar library tube), and the AI tab shows what was read, the fit's R² and RMS error, and the model's curves over the datasheet's points. **Add to the library** makes it a custom tube, kept in this browser and in the circuit files that use it.

### Changed
- The curve tracer's Koren fitter is now `koren-fit.js`, shared with the datasheet import.

## [3.141.0] - 2026-10-30

### Added
- **Auto-tune**: a **Tune** tab under the schematic (also AI ▾ → Auto-tune) that changes part values until the simulated circuit meets your goals, with no API key needed.
  - Goals are any measurement (operating points, stage gains, a speaker's power and THD, a scope channel's THD) with ≥, ≤ or = a target, plus "keep every tube and transistor within its ratings".
  - Values to change are any editable values with a range; **Suggest** adds the resistors at the tubes' and transistors' pins. A pattern-search optimizer proposes tries, the simulator runs them on all workers, and the best values are rounded to E24/E12 and simulated once more. A chart shows the progress; **Stop** keeps the best so far; **Apply these values** is one undo step.
  - **AI start** (with an API key): the model picks the values to change, their ranges and starting values for your goals.

### Changed
- The Bill of materials tab under the schematic is labelled **BOM**, so the panel's tabs and tools keep to two rows with the new Tune tab (the list under them stayed too short to show a line at narrow widths).

### Fixed
- AI assistant: answers are now streamed from all three providers and appear in the AI tab while they are written. A long answer (Explain my circuit takes a minute or more on the strongest models) no longer fails with "Could not reach Claude (Failed to fetch)" behind a proxy or firewall that drops a connection after 30 quiet seconds.

## [3.140.0] - 2026-10-30

### Added
- **Board: its own grid router.** Boards that Freerouting could not finish now route to the end. The new router (negotiated congestion, rip-up and reroute, as most FPGA routers work: McMurchie and Ebeling's PathFinder) lays every net on a 0.25 mm grid on both layers in straight and 45° runs, with vias where needed, keeping each net's clearance by voltage from pads, locked copper, holes, keep-outs and the edge. Other nets' tracks are a price, not a wall: nets that come too close are taken up and routed again while that price rises, until none conflict. Freerouting's copper stays except the pieces a new route must pass; those come up and their nets are routed again. Tracks enter pads by a straight run to the middle, which may pass the footprint's own pins as close as they are to each other; grid nets keep off anode and heater tracks on both sides of the board (the coupling check).
  - **Auto-route, Finish routing and Design from scratch use it by default**, with no Freerouting server: the button no longer waits for one. Freerouting runs first only when **Use Freerouting** is ticked in Route ▾ → Freerouting… (the choice is kept in each browser); the grid router then routes whatever it leaves open, round the copper there and, if connections are still open, the whole board afresh, before the older grid finishers. A result stays only if it closes connections and adds no rule message. The tooltip and status line say which router ran.
  - Example 06 (Gubin 6N23P/6P14P), which kept 4 to 6 connections open, now routes fully as it is and from a bare board. On 109 test boards laid out 9 ways each (the layouts from the placement study), the grid router alone, from bare boards, left 131 connections open where Freerouting with the earlier finishers left 736, and routed 98 boards completely within the rules in their best layout (91 before); about 1 s per board on average, 24 s at most.

## [3.139.0] - 2026-10-30

### Changed
- Board: the toolbar stays one row down to 1000 px (it took two rows at 1100 px and below). Below 1180 px Text, Hole, Keep-out and Measure fold into one **More tools ▾** button, which shows the tool last picked from it and is lit while that tool is on; and Fit is hidden (the zoom percentage at the bottom right and F fit the board too). The keys T, H, K and D work as before.
- The oscilloscope, spectrum analyzer and Bode plotter have the same **Schematic | Board** switch as the CAD and the Board, at the left of the toolbar, in place of the single Schematic button; neither is lit, since the instrument is neither. Board brings up the Board window, or, when the CAD keeps the board in its own window (Windows ▾ → Board in this window, the default in Safari), shows it there. Alt+B from an instrument does the same. Below 1240 px the switch shows its icons only, so the Bode plotter's toolbar stays one row down to 1000 px.
- CAD: with the new AI ▾ menu the toolbar took two rows between 1000 and 1120 px. Below 1140 px the separators between its groups give way (the gaps still part them), so it is one row again from about 960 px up.

## [3.138.0] - 2026-10-30

### Added
- **AI assistant**: a new **AI ▾** menu and an **AI** tab under the schematic, with your own API key for **Claude** (Anthropic), **ChatGPT** (OpenAI) or **Gemini** (Google).
  - **AI settings…**: pick the provider, paste its key (a link goes to the provider's key page) and choose a model; **Test** checks them, **Load list** asks the provider which models your key can use. The defaults are Claude Opus 5.5, GPT-6.1 Sol and Gemini 3.1 Pro. Keys stay in this browser and go only to their provider, straight from the page; **Forget keys** removes them.
  - **Ask**: type a question about the circuit or the app. The model gets the circuit (every part with its values and pin nets, the simulated DC and AC voltages, the operating points against their ratings, stage gains and THD, the Checks) and the manual for how-to questions. Answers are formatted, and part designators in them are links that select the part. Follow-up questions keep the conversation; **Clear** starts a new one, **Stop** abandons a question.
  - **Explain my circuit**: what the circuit is, then stage by stage what each part does and why it has its value, how each stage is biased, and what looks unusual.
  - **Fix the checks**: the Checks list turned into value changes, each checked against the part before it is offered (the part exists, the value is one it can take). **Apply** or **Apply all** makes them as one undo step, re-simulates and reports how the Checks changed ("Checks: 6 → 0 problems"), with an **Undo** button.

## [3.137.0] - 2026-10-30

### Added
- **Short share links.** On aerocat.tech, File ▾ → Share link… now gives a link like `aerocat.tech/s/Ab3xK9_qZw`: the packed design is kept by a small link store on the site and found again by its id. The id is the start of the design's SHA-256, so sharing the same design twice gives the same link, and a stored design never changes. Other copies of the app (a local folder) still give the long link with the design inside, and open short links from the site. If the store can't be reached, the dialog gives the long link and says why.
- `server/share/`: the link store (Node, no packages), its Dockerfile and compose file, and the nginx lines for `/s/<id>` and `/api/share` with a rate limit. It keeps only text that unpacks to a Tube Amp CAD design, at most 96k characters each and 512 MB in all.

### Changed
- Share link: the design is packed shorter (parts and wires as rows instead of named fields), so the long link of example 07 is about 3 800 characters without its board and 8 500 with it, instead of 4 200 and 8 900. Links made by 3.135.0 still open.

## [3.136.0] - 2026-10-30

### Added
- **Output transformers modelled as real ones.** Bass power and treble roll-off now look the way they do on a real amplifier, not only a DC warning in Checks.
  - **Leakage inductance** on every winding (the treble roll-off, in series with the source and the load) and a **winding capacitance** across the primary (the leakage resonance above the audio band). In a push-pull transformer each half carries half the leakage, so class B sees half of it.
  - **A core that saturates.** The flux linkage against the magnetising current is straight up to a knee, bends over and leaves only 1 % of the inductance past it. *Rated power* and *Full power down to* (plus *Max DC current* for single-ended) place the knee: at the rated power and that frequency, the rated DC included, the core stands at 75 % of saturation. Below it the power the transformer passes falls with the square of the frequency; past it the bass distorts and the primary current peaks. An ungapped push-pull core with its halves' DC out of balance saturates sooner.
  - The inspector says where the bass and treble fall (−3 dB from a source of the primary impedance), where the leakage resonates, and after a run the **core flux** at its peak as a share of saturation; **Checks** warn when it passes 95 %, and when a single-ended part's DC passes its rating. The BOM's Sim. max shows the DC as a share of the rating.
  - The **Bode plotter** linearises the core at its operating point: DC in a single-ended primary lowers the inductance the bass sees (for a mains-fed circuit, at its averaged magnetising current).
- **Transformer catalogue.** The single-ended and push-pull output transformers have a **Model** list that fills in real parts: Hammond 1608, 1609, 1615, 1620, 1645, 1650F, 1650H, 1650K, 1650N, 1650P, 1650R, 1650T, 1650W and the 1750H guitar replacement (push-pull); Hammond 1627SEA, 1628SEA, 1629SEA and 1640SEA (single-ended); Edcor XSE15-5K, GXSE15-5K, CXSE25-3K, CXSE25-5K, XPP15-8K, GXPP15-8K, CXPP25-6.6K, CXPP30-6.6K and CXPP50-5K. Hammond values come from each part's drawing (inductance and leakage measured at 60 Hz, 10 V; the 16xxSEA inductance and DC rating from Hammond's catalogue). The newer drawings' 1 kHz, 1 V leakage figures (1650E 337 mH, 1620A 550 mH) would put the treble 1 dB down at 2–4 kHz on parts sold for 30 kHz, so those models are left out. Edcor publishes only the power, impedance, DC rating, ±1 dB band and insertion loss, so their inductance, leakage and resistances are worked out from those (the inspector says so); no maker gives the winding capacitance (typical 200 pF single-ended, 300 pF push-pull). Change the secondary impedance to use another tap and the part keeps its model's name; change anything else and it shows your own values. The models are in the part search too (type "1650" or "Edcor").
- The Hammond 125SE part gets the same core (saturating past its rated power below 100 Hz, from its rated DC) and a leakage of 54 mH (1 dB down at 15 kHz, its rated band; not on its drawing).
- **Three classic amplifiers** in File → Examples, each on a real output transformer: a single-ended **2A3** with a 6SN7 driver on a Hammond 1627SEA (RCA's 250 V, −45 V, 60 mA, 2.5 kΩ; 3.6 W at 1.8 % THD at 1 kHz); a Mullard-style push-pull **EL84 ultralinear** amplifier on a Hammond 1608 (12AX7 stage and split-load phase splitter, 14 dB of feedback; 11 W at 0.9 %, 9.4 W at 30 Hz, and at 15 Hz the core saturates: 15 % THD); a tweed-style push-pull **6V6** guitar amplifier, cathode biased, no feedback, on a Hammond 1750H (7.7 W at 2 %, its 21 H primary putting 40 Hz 4 dB down). They come as schematics, without a board.

### Changed
- Output transformers in files saved before this version get the new fields' defaults: 15 mH (single-ended) or 20 mH (push-pull) of leakage, 200 or 300 pF, and a core rated 10 W down to 40 Hz with 100 mA DC (single-ended) or 30 W down to 30 Hz (push-pull). Until now each winding had 0.1 % of its inductance uncoupled (about 40–60 mH of leakage) and the core never saturated. Set *Rated power* to 0 for the old linear core.
- SPICE export writes a transformer's leakage as coupling below 1 between its windings; the saturation is not exported (a comment says so).

### Fixed
- The BOM's Sim. max for a push-pull output transformer showed twice the DC per half: it divided the drop across a half by half of *DCR per half*.

## [3.135.0] - 2026-10-30

### Added
- **File ▾ → Share link…**: the whole design packed into a link. The circuit, the imported SPICE tubes it uses and (ticked by default) its board layout are compressed into the address after `#c=`; Copy link and send it, and whoever opens it on aerocat.tech gets the same circuit with one click. The part after `#` never reaches the server, so nothing is uploaded and the design lives only in the link. Example 07 with its board makes a link of about 9 000 characters, 4 000 without. Opening a link over a circuit on the sheet asks first (Ctrl+Z brings the old one back), and the design is then taken off the address so a reload keeps your edits.

## [3.134.1] - 2026-10-30

### Fixed
- The Board window could crash ("Aw, Snap", out of memory) during Auto-route, Finish routing or Design from scratch. The grid finisher that routes the last open connections exactly in a window round each (a SAT formula) had no limit on its formula's size: a wide window with many connections and high-voltage clearances built more than ten million clauses and took gigabytes. The formula now stops at a million clauses and that window is left to the other finishers. On 2 800 routed test layouts no formula over a million clauses was ever solved in its 3 s, so nothing that used to route is lost; the nine boards that crashed now route to the end.

## [3.134.0] - 2026-10-29

### Removed
- Board: **Route ▾ → Tidy tracks** is gone from the menu. Tidying is part of routing: Auto-route, Finish routing and Design from scratch pull the tracks straight after every pass by themselves.

## [3.133.1] - 2026-10-29

### Fixed
- Example 05 (10 W MOSFET amplifier) kept its 28 mA idle current only without a signal: under signal the transient settled with about 4 A through both output MOSFETs. The simulator was right (ngspice gives the same 4.2 A); the circuit was not. The article feeds the bootstrap capacitor C5 from +30 V through a 1N4148 (to isolate the bootstrapped node from the rail); the diode let C5 charge to the output's negative peaks and never discharge, so the bootstrap node climbed from 29.4 V to 33.2 V, the driver's current rose by a third and the gate-to-gate bias grew from 6.2 V to 8.3 V. A 680 Ω resistor (R9) now takes the diode's place: the idle point is the same, it stays at about 30 mA under signal, and the supply draws 0.46 A at 7.8 W instead of 31 A. A note on the sheet says why. The power sweep now finds about 10 W at 1 % THD from the ideal 30 V supply (the article's 6–7 W is from a loaded supply).

## [3.133.0] - 2026-10-29

### Added
- **Curve tracer for transistors.** The curve tracer draws every BJT, MOSFET and JFET of the library, silicon and germanium, from the simulator's own models (the part built as the CAD builds it: Gummel-Poon with the fitted IS, RB and RE, its temperature and a germanium part's leakage; the square-law FET channel), so a circuit's operating point lies on the tracer's curve. A *Tubes | Transistors* switch above the library; the transistors grouped as the palette groups them, with search and BJT / MOSFET / JFET / Germanium filters.
  - Three plots: **IC–VCE** output curves per base current from IB = 0 (ID–VDS per gate voltage for FETs) with Pd max, 70 % and the VCEO and IC max lines; **IC–VBE** (ID–VGS) transfer curve, a BJT's with a dashed one 25 °C warmer; **hFE–IC** static and small-signal gain on a log axis (gm–ID for FETs).
  - A transistor in the circuit shows its operating point, the curve at its bias and the simulated load line (also along the transfer curve), on axes scaled round them; the CAD now sends the tracer its transistors and selecting one in the schematic shows it.
  - Settings: number of curves, IB / VGS step, VCE axis, VCE for the transfer and gain plots, and a library BJT's temperature (automatic when blank).
  - Click points: IB or VGS, Pd, hFE, gm and ro (FET: gm, rds, µ), the load line through two points, gm between two points of the transfer curve.
  - The package drawn with its pin order from the board footprints; the SPICE `.model` under *Transistor model*.
- Curve tracer: **CSV** saves the curves shown (tubes too).

### Changed
- The simulation's transient now records each transistor's collector or drain current (for the tracer's load line).

## [3.132.0] - 2026-10-29

### Added
- Board: **stitching vias**. When a pad of a poured net (GND) is cut off from its pour, by other copper round it or by a high-voltage pin's wide clearance, Auto-route, Finish routing and Design from scratch now give it a short track on the other layer and a via down into the pour. The track finds its own way out (a small maze, so it can turn corners), the via spots nearest the pad are tried first, and a via stays only if it joins the pad with no new rule violation. A track leaving a pad may pass the footprint's other pads as closely as the pads themselves sit, as the rule check allows. On the stripped Gubin board (example 07) this joins the two transformer GND pins next to the 6P14P anodes that the pour could not reach.
- Board: a click on a pour's copper (where no part, track or via lies under the pointer) selects the pour, so a whole-board GND plane, whose outline sits under the board edge, can be picked and deleted with Del or the right-click menu. Before, only the outline picked it. Dragging from empty space still draws a selection box.

## [3.131.0] - 2026-10-29

### Added
- Board: **Design from scratch** (was Rearrange board) is now an automatic layout of the whole board. It makes nine layouts in the background. Each starts from the schematic's places and spreads the parts over the board, choosing every part's quarter turn as it goes: each part leans to the turn that gives its nets the shortest wiring and the fewest crossings with other nets (orientation-aware placement as in Cypress, ISPD 2025). Annealing (shifts, turns, swaps) then polishes the layout. Valves count as 1.6 times their size and parts with a high-voltage pin as 1.2 times, so their clearances get room. Each layout is scored without routing (shut-in pins, ratsnest crossings with high-voltage ones counting triple, ratsnest length). The best of each kind, three in all, are routed, the best routed one stays, and Finish routing's rounds then work on what is left. While connections stay open, up to three more layouts are routed. The outline, holes, keep-outs, locked parts and locked copper hold throughout.
- Board: **Route ▾ → Tidy tracks** pulls tracks tight. The grid finishers lay tracks along a grid, so a diagonal run came out as a staircase. Now each track is pulled into straight and 45° runs wherever every clearance still holds, and points where other copper of its net joins stay. Auto-route does this after every pass.
- Board: a **progress bar** in the status line while Auto-route, Finish routing, Design from scratch or Tidy tracks runs. It shows the step, what is going on (Freerouting, grid finishers, spreading…) and the time so far.

- Board: **To finish routing** hints in the checks panel (and the status line) when connections stay open: rules stricter than the board needs (track widths, clearance, a high-voltage floor above what IPC-2221B asks at the nets' voltages), pads the ground pour cannot reach, a crowded board, parts shut in against the board edge.
- Board: the grid finishers now also join a poured net's pads the pour cannot reach (behind other copper or the board edge) with a track.

### Changed
- Example 07 (Gubin): board rules 0.6 mm signal and 1 mm power tracks, 0.4 mm clearance and a 1.25 mm high-voltage floor (was 1, 1.25, 0.6 and 2 mm; clearance by voltage from IPC-2221B still applies above that). With the old rules Auto-route left 7 connections open on the stripped board; Design from scratch now leaves one ground pad.
- Board: Route & nudge is now called **Finish routing** (it keeps your layout and moves only a few parts), and Rearrange board is now **Design from scratch**.

### Fixed
- Board: the Route ▾ menu's descriptions no longer wrap under the item names.

## [3.130.0] - 2026-10-29

### Added
- **Look up a part number on DigiKey.** The BOM's Package cell has a *Look up* button (and *Look up all* above the table) that asks DigiKey's parts database for the part's package, case size, height, lead spacing and ratings. The board footprint, silkscreen and 3D body follow what it says, and a *DigiKey ↗* link opens the part's page. Values that disagree with the schematic (capacitance, voltage, power) are flagged in amber.
- It uses your own free DigiKey API key (Client ID and Secret from developer.digikey.com), asked for once in a short dialog (*DigiKey key…* changes it). The key stays in this browser only; the circuit file keeps what was found, never the key, so nothing is looked up again until the number changes.

### Changed
- The built-in table of some 3,000 Nichicon and Panasonic electrolytic numbers is gone (`mpn-data.js`, `scripts/mpn-tables.mjs`): an electrolytic's case size now comes from Look up, or from a size written in the number. The small offline rules stay (resistor series, chip codes, film spacing, package suffixes). Parts already saved in a circuit file keep their size.

## [3.129.0] - 2026-10-29

### Added
- **Manufacturer part numbers set the real part's size.** Type the maker's number in the BOM's *Part number* cell (or the inspector) and the new *Package* column says what it is, built in with nothing fetched: "Nichicon UKW · radial Ø8 × 11.5 mm, 3.5 mm spacing, 50 V 100 µF". It is amber where the number disagrees with the schematic (another capacitance or voltage, a lower power rating, a short number that fits several cases).
  - Electrolytics: about 3,000 Nichicon and Panasonic numbers with their case sizes, read from the makers' dimension tables (`scripts/mpn-tables.mjs` builds `mpn-data.js`), plus any size written in the number (Rubycon's …8X11.5).
  - Leaded resistors: Yageo MFR / CFR-25, Vishay MBA / MBB / MBE, Dale CMF, PR01–PR03 and DIN size codes, with body, lead diameter and the axial spacing that fits. Chips: the size from Murata, Samsung, TDK, Panasonic ERJ, KOA, Yageo, Vishay, Kemet and AVX codes. Film: TDK B3252x, Kemet R82, WIMA MKS2 / FKP2 spacing.
  - Semiconductors and ICs: the package from the order code (SOT-23, SOD-123, MiniMELF, SMA/SMB/SMC, DPAK, D²PAK, SOT-223, TO-92, TO-220, DIP or SOIC from TI / ST / onsemi suffixes).
- **Board Design follows the part number.** A part takes the footprint its number names when the number is typed or changed; the silkscreen outline, the holes (a thicker lead gets a bigger one) and the 3D model and STEP body follow the real size. The board inspector shows the number's result (*Use it* when the footprint was changed by hand) and a *Body (mm)* row to set the size by hand. Snap-in footprints for Ø20 and Ø40 mm cans.
- The part a number names (maker, package, footprint, body size) is saved with the part in the circuit file and read back from there; a new number looks it up again.
- The BOM exports (TXT, CSV, XLSX, PDF) have the Package column.

## [3.128.1] - 2026-10-29

### Changed
- **The manual caught up.** It now lists the examples (*File ▾ → Examples*) with what each one is; every circuit check (capacitor voltage ratings, diode VRRM, regulators and ICs, fuses, varistors, relays, neons and gas regulators, interstage transformers, mismatched rails); the rectifier's peak anode current and the anode temperature among the tube ratings; all six tabs under the sheet; and the Board toolbar's *Route ▾* menu, which still read as if Route & nudge were under *Board ▾*.

## [3.128.0] - 2026-10-29

### Added
- **Parameter sweep** (*View ▾ → Parameter sweep*, the *Sweep* tab under the schematic): one numeric value of one part (resistance, capacitance, a pot's wiper, a supply's voltage, a generator's frequency or amplitude…) stepped from one value to another, log or linear, with the circuit simulated at each step on all cores.
  - From/To default to half and twice the present value. The circuit itself is left unchanged.
  - The table lists every tube's Ia, Va and Pa, every transistor's current and dissipation, every speaker's power and THD, and every scope channel's AC and THD. Each row has a trend line, the first and last values, the range, and how many steps went over the rating.
  - Click a row to plot it against the swept value, with the present value and the rating marked. A scope channel's row also overlays one AC-coupled cycle of its wave at every step, coloured from amber to cyan.
  - The step buttons light their point and wave on hover. Clicking one sets the part to that value (one undo step).
  - `tests/sweep.test.mjs` and the Sweep checks in e2e part `10-analysis` cover it. Example 03's R2 from 100k to 220k: anode current falls step by step.

## [3.127.0] - 2026-10-29

### Added
- **Listen** (*View ▾ → Listen*, the *Listen* tab under the schematic): a recording played through the simulated circuit and heard through the computer's speakers.
  - Sources: a guitar riff made here (Karplus–Strong plucked strings), the generator's own tone, or your WAV or MP3 file (Open file… or drop it on the tab; FLAC, OGG and M4A where the browser decodes them). A stereo file drives the first two generators, and two speakers play in stereo.
  - Settings: From, Length (up to 30 s) and Level (0 dB puts the recording's peak at the generator's amplitude).
  - You can hear a speaker, two speakers in stereo, or a scope channel.
  - ▶ Play runs input and output together. A · Input / B · Circuit switches between them while playing. Match loudness, Loop, Volume, click-to-seek on the waveform strips, and Save WAV (16-bit) of the output.
  - Engine: `TubeSimEngine.audio()` is a fixed-step transient at 48 kHz from the settled state, with a source that plays samples (`VSRC` with `samples`/`rate`). The worker takes `kind: "audio"`.
  - The clip is cut into one piece per core, each with a 0.4 s lead-in from the circuit settled with its generators silent, and joined with 20 ms crossfades on whole mains periods. The joined result matches a single run to within 4e-7. Example 07 renders 3 s in under 5 s on 4 cores.
  - `tests/listen.test.mjs`, an MP3 fixture, and Listen checks in e2e part `10-analysis` (riff, tone against the steady state, MP3 and WAV decoding, A/B, Save WAV) cover it.

## [3.126.0] - 2026-10-29

### Added
- **Power sweep** (*View ▾ → Power sweep*, the *Power* tab under the schematic): the circuit simulated at a row of input levels, from −24 to +12 dB of the generator's level by default, on all cores. Every signal generator, guitar pickup and phono cartridge is scaled together; the mains is not.
  - Cards read the output at 1 %, 5 % and 10 % THD and the small-signal gain. A log–log chart plots THD and the 2nd and 3rd harmonics against the output, with the generator's present level marked. The table lists every level (input, output, THD, H2 and H3 in dBc), and *Use* sets the generator to that level (one undo step).
  - The output is a speaker's power or a scope channel's AC. Where THD jumps past a mark between two levels (a clipping output stage), the sweep adds three levels between them, up to twice.
  - Example 07 reads 1.71 W at 1 % THD, as the study script measured by hand. `tests/power.test.mjs` and e2e part `10-analysis` cover it.

## [3.125.0] - 2026-10-29

### Fixed
- Power and driver transistors: VBE now follows each datasheet's typical VBE curve at 25 °C. IS, base resistance (RB) and emitter resistance (RE) are fitted to the curve for 2SD669A/2SB649A, 2SC4793/2SA1837, MJE15032/MJE15033, TIP41C/TIP42C, 2SC5200/2SA1943, MJL3281A/MJL1302A, MJL21194/MJL21193, MJ15003/MJ15004, MJ15024/MJ15025, 2N3055/MJ2955 and BD139/BD140. The model follows the curve within 0.03 V for most parts and 0.07 V at worst.
  - Before, only six of these parts had RB/RE, set so that VBE read 0.7 × the datasheet's maximum at one test point. That rule was up to 0.2 V off the typical curve (MJL21194 read 1.54 V at 8 A; typical is 1.3 V). The other parts had none, so their VBE at several amperes read low.
  - `tests/transistor.test.mjs` checks every point of every curve.

## [3.124.0] - 2026-10-29

### Fixed
- Every non-valve, non-transistor part checked against its datasheet, and its model against ngspice (resistors, capacitors, inductors, pots, all transformers, sources, diodes, zeners, bridges, LEDs, regulators, TL431, op-amps, chip amps, 555, fuses, NTCs, varistors, gas regulators, neons, relays, vactrols, speaker, pickup, RIAA). These were wrong:
  - **Simulation**: a mains source into a Hammond 300 power transformer with silicon rectifiers stopped with "Transient did not converge at t=0.100 ms" (the mains start at their peak and charge the reservoir through the winding in more Newton steps than a step allowed). The last subdivided step now gets more iterations; the supply settles to ngspice's 463.0 V.
  - **SPICE export**: sine sources carry their phase (the mains start at the peak) and their DC start (without it ngspice's operating point put 40 A of DC through a mains transformer's primary); square and triangle waves go out as the simulator makes them; a transformer's coupling as pairwise K lines (ngspice takes two inductors per K); gas regulators and neons as their lit curve (the breakdown diode conducted forward); the op-amp subcircuit without `if()`; `.tran` with a nonzero time step (ngspice refused 0).
  - **Fuses**: the cold resistance of every rating from the Littelfuse 218 table (the interpolation was up to 58 % off, e.g. 160 mA 3.85 Ω for 2.44 Ω).
  - **Varistors**: capacitance from TDK's SIOV sheet (13–28 % low: S10K275 220 pF, not 195) and the discs' thickness.
  - **NTC inrush limiters**: SL32 10015 is Ø 31 mm on 7.8 mm leads, SL10 5R003 4 mm thick on 0.5 mm leads, SL22 10005 5 mm thick. Boards saved with the old sizes keep them.
  - **UF4007** and **UF5408**: forward voltage refitted to Vishay's curves (UF4007 1.27 V at 1 A, was 0.96 V); junction capacitance 17 and 36 pF. 1N5404/5408 30 pF, 1N5817 125 pF.
  - **LEDs**: the colour's forward voltage at 10 mA is now across the part's pins (the 5 Ω series resistance added 50 mV).
  - **LM386**: gain 200 with pins 1 and 8 bypassed (was 191), 20 open.
  - **Interstage transformer, centre-tapped**: the secondary's resistance is split between its halves (it was all on S1, unbalancing the grids).
  - **TDA2050 / LM3886 footprints**: the odd leads are the ones bent forward, away from the tab (ST's Pentawatt V and TI's NDA0011B drawings); the rows were swapped.
  - **Footprint holes** as KiCad's: DO-41 diodes 1.1 mm, 1 W and larger resistors and 5 W zeners 1.2 mm, DO-201AD 1.6 mm, film capacitors 1.0 mm at 7.5–10 mm and 1.2 mm from 15 mm, radial electrolytics Ø10 1.0 mm and Ø12.5–18 1.2 mm, 7.62 mm discs 1.0 mm. Example 07's board has one track moved 0.25 mm for the larger pads.
  - The negative DC supply's note named its pins the wrong way round for the symbol: the pin by the + mark goes to ground.

## [3.123.1] - 2026-10-29

### Fixed
- Every valve's pinout checked against its datasheet (all 111 of them, not a sample); these were still wrong:
  - **6С41С**: anode on pins 2, 4 and 6 (only 4 was there).
  - **6С15П**: cathode on pins 1, 3, 6 and 9 (pin 1 was missing).
  - **6П15П**: pins 1 and 6 are the suppressor grid and internal screen (they were marked cathode; they still join the cathode on the board).
  - **6П33П**: screen grid on pins 6 and 9, pin 8 unused (it had 6 and 8). It is not pin-compatible with EL86, which it is often listed against.
  - **6С4П** shared the 6С3П entry, but its base is different: grid 1, 2, 7, 8, cathode 3, 6, anode 9. It is now its own tube (same handbook data as the 6С3П).
  - **5Ц8С**, **5Ц9С** and **6Ц13П** are indirectly heated, their cathode joined to a heater pin (1 and 2 on the 5Ц8С/5Ц9С, 5 on the 6Ц13П); the library had them as directly heated filaments.
- Board: 5Ц4С, 5Ц8С and 5Ц9С now get their heater winding like GZ34 and 6Ц13П: a terminal (XH…) from the free heater pin to the cathode's B+ net. Before, the free heater pin had no copper. The shared 6.3 V supply keeps the number XH1.
- Gubin example (07): the 5Ц4С's 5 V heater terminal XH2 is placed and routed.

## [3.123.0] - 2026-10-29

### Fixed
- Every transistor in the library checked against its datasheet (simulation model, ratings, pinout, footprint, 3D); `tests/transistor.test.mjs` now holds the datasheet points for all of them. These were wrong:
  - **TO-18 and the germanium cans (TO-1, TO-5, МП)** were drawn as the makers' bottom view, so on the board emitter and collector were swapped. They are now seen from the top: pin 1 at the right with the tab beside it at the lower right, and the 3D can has its tab. Example 05's BC107/BC177 were turned and their base tracks re-routed.
  - **J175** pin order is D-G-S (was D-S-G), **2N5460** S-D-G (was D-S-G), **2SK30A** S-G-D (was D-S-G). ECX10N20/ECX10P20 G-S-D confirmed, no longer flagged.
  - **MOSFETs** conducted about 0.5–1 V early: threshold and KP now follow the typical transfer curve (IRF510, IRF540, IRF820, IRF840, IRF9540, IRF9610, IRF9640, IRFP240, IRFP250, IRFP460, IRFP9240, DN2540, and the lateral 2SK1058/2SJ162, ECX10N20/ECX10P20, which start near 0.1 V). Gate capacitances from Ciss and Crss (IRFP460's Crss was 60 pF, the datasheet says 350).
  - **JFETs**: J113 on-resistance under its 100 Ω maximum and its capacitances (Ciss was 23 pF, 7 pF is right); 2N5457 at the typical IDSS 3 mA; J310, J175, 2N5460, 2SJ74 capacitances; MPF102 350 mW.
  - **BJTs**: 2N3904's gain at 10 mA was over the 300 maximum (BF 416 → 300); TIP41C/TIP42C, MJL21194/MJL21193, MJL3281A/MJL1302A follow the typical hFE curve (MJL3281A was under its 75 minimum at 5 A), with RB/RE refitted; 2SD669A/2SB649A are 160 V (180 was VCBO) with the datasheet's Cob; Cob of MJL21193, MJ15004, MJ15025 at most the datasheet's; 2N2222A 800 mA, BC107/BC177 200 mA, BC547B/BC557B 625 mW.
  - **Germanium**: МП40А, МП41А, МП42Б, МП25Б, МП26Б gain inside the reference books' h21э range; МП25Б/МП26Б collector capacitance 20/15 pF (was 70); МП42Б 150 mA, МП38А fT 2 MHz, П213Б 10 W; AC128 gain flat to 1 A and fT 1.5 MHz; AD161/AD162 VBE 0.13 V at 5 mA as Siemens gives it; 2N404 100 mA; OC71 20 V, 10 mA, in its black glass body with inline leads (it was a TO-1 can).

## [3.122.0] - 2026-10-28

### Fixed
- Valve pinouts checked against the datasheets; these were wrong:
  - **ГУ-50**: cathode 1, g1 2, g2 3, heater 4 and 8, g3 5, anode 6, internal screen 7 (was heater 1 and 7, anode 5). The heater note said pins 1 & 7.
  - **211** and **845** (RCA basing 4AZ): grid 1, filament 2 and 4, plate 3 (plate and grid were on 2 and 3).
  - **ГМ-70**: filament 2 and 3, anode 5, grid 7, on its own 25 mm base (was a 4-pin layout).
  - **WE417A / 5842** (RCA 9V): plate 1, heater 3 and 9, grids 4, 5, 7, 8, cathode 6 (heater was on 4 and 5, which are grids).
  - **6П45С** (= EL509): grids 1 and 8, beam plates 2 and 7, screen 3 and 6, cathode 9, the anode on the top cap. Its anode had no pin at all, and it got a noval footprint for its magnoval base.
  - **6Ж32П** (= EF86): the control grid (9) and suppressor (8) were missing, so its grid went on no pad.
  - **5Ц4С**: indirectly heated, its cathode joined to heater pin 8 (the note said the filament is the cathode).
- Board: a valve whose anode is on a top cap (6П45С, 6Ц13П) gets a socket with a **cap** pad for the lead to it (`SOCKET-B9D-CAP` …); before, the anode was on no pad.
- Board: the suppressor grid or beam plates (EL34 pin 1, EF86 pin 8, EL509 pins 2 and 7 …) join the cathode, as the symbol draws them, and a triode-connected pentode's screen joins its anode. Before, those pins were left unconnected on the board.
- Board: subminiature valves with wire leads got a B7G socket ("Subminiature" matched "miniature"). They, the nuvistors and the valves on bases with no board socket here (211, 845, ГМ-70, ГУ-50, 6С33С, the glass-base types) now go on wire pads to a chassis socket instead of a made-up round footprint.
- Schematic: directly heated valves (300B, 2A3, 211, 845, ГМ-70, 6С4С, 5U4G …) are drawn with a filament, not an indirectly heated cathode.
- Curve tracer: the socket view says it is the bottom view, places a B7G base's 7 pins on its 8 places with the gap (they were spread evenly), and marks a top-cap anode.

### Added
- 3D board: valves are drawn at their datasheet size where it is known (EL84, 6П1П, EL34, 6L6GC, KT88, 6V6GT, 6AS7G, GZ34, 300B, 2A3/6С4С, 6П45С and their analogs), with the top cap where there is one.

## [3.121.2] - 2026-10-28

### Fixed
- Board: dragging the board outline's corner taller no longer leaves stray bits of copper behind (teardrops and pours stayed where the tracks had been until the mouse stopped). They now move with the tracks while you drag.

## [3.121.1] - 2026-10-28

### Fixed
- Freerouting server page: "Routes from this browser" now names this app to Freerouting (the Freerouting-Environment-Host header). Freerouting 2.5 refused the listing without it ("does not list routes") and logged a warning every 30 s.

## [3.121.0] - 2026-10-28

### Added
- Board: **Status ↗** in Route ▾ → Freerouting… opens a page on the chosen Freerouting (the site's server or your own) instead of its bare JSON. It says in words whether it is up, idle or busy, its version, how long it has run, Java and system, processor load (with a trace while the page is open), Java memory and free disk, and the routes this browser sent: when, which board, done or failed, how long. On the site's server it also lists the limits (sign-in, two boards at once, 90 s per pass, 5 MB). It refreshes every 5 s.

## [3.120.0] - 2026-10-28

### Added
- Board: on aerocat.tech, **Route ▾ → Freerouting…** offers the site's own Freerouting server (at `/freerouting`, behind a login) beside an address of your own. A login the server wants first reads as "sign in", with a **Sign in ↗** button; the choice is kept per browser. A route through an https address asks Freerouting for at most 90 s, under the 100 s a proxy such as Cloudflare allows, and a busy server or one that took too long says so.

### Changed
- Board: a Freerouting address keeps its path (`https://host/freerouting`), and an https address keeps its own port instead of getting 37864.

## [3.119.0] - 2026-10-28

### Added
- Board: Route & nudge first tries **pin-access moves** in each round. For a pin that is shut in, it tries the smallest shift (up to 5 mm on the 1.27 mm grid) or quarter turn of that part, or of a part walling it in. A move is taken when the pin's way out then holds (max-flow check) and a track can run on to the other end, counting the copper in the way as taken up. Only otherwise does the annealing nudge run.

### Fixed
- Board: the exact finisher now knows the valve-socket rule (under a socket's body a track may pass its pins at their own spacing). It checks every grid step at its middle instead of keeping a blanket margin round each cell, which was too strict beside pins. A track it took up and cannot lay again is left whole and the window tried again, so one walled-in cut end no longer makes the whole window fail.

## [3.118.0] - 2026-10-27

### Added
- Board: **Route ▾** menu for everything about routing: Auto-route, Route & nudge, Rearrange board, Unroute, Import routes (SES), Freerouting…. These items left the Board ▾ menu, and Unroute left the toolbar. The Auto-route button stays on the toolbar.
- Board: **Rearrange board** places the board again from scratch. Every unlocked part moves, valves and transformers too; pots, switches, jacks, connectors and fuses stay. The parts go where they sit in the schematic, then spread over the board three ways (held near those places, for the shortest wiring, and with more room round each part). Each layout is routed afresh, and the best one stays, the board as it was included.

## [3.117.0] - 2026-10-27

### Changed
- Board: Auto-route and Route & nudge no longer freeze the window. The exact finisher runs in a background worker (board-worker.js), each solve is capped at 3 s, and the page gets a breath between the other steps. On example 07 the longest freeze went from 15 s to under 1 s.
- Route & nudge says when it tried a layout with the parts spread over the board and went back to the earlier one, because the spread one left more connections open or had longer tracks.

## [3.116.0] - 2026-10-27

### Added
- Board: after Freerouting and the grid pass, each connection still open gets an **exact finisher**. A small window round it is written as a yes/no puzzle (SAT, after Luo and Wong's exact router): each grid cell carries at most one connection, a used cell joins exactly two neighbours, a pad or cut track end one, and cells of different nets keep their clearance (vias too). A small solver in the page (conflict-driven clause learning, as in MiniSat) answers it in well under a second. It may take up the unlocked tracks of the connection's own net and of the nets walling it in, and lay them again. It tries without vias first, then shortens each new track. A result is kept only if it closes connections and adds no rule message. When it proves there is no way, only moving parts can help.
- On example 07 routed from scratch, the finisher joined 6 of the 13 connections Freerouting left, with no rule messages.
- Board: **Place all on the board** now spreads the placed parts into the room the board has, held near their places from the schematic, then puts each on the nearest legal grid place.

## [3.115.0] - 2026-10-27

### Added
- Board: Route & nudge ends with two rounds over the **whole board** when connections are still open. The parts that may move are spread wherever there is room: once for the shortest wiring, once held near where they are. Each part is then put on the nearest grid place that keeps every rule, keeping its turn, and the board is routed afresh. A round is kept only if it is better. Parts with a shut-in pin count as twice their size, and parts at the end of an open connection as one and a half times, so they get room round their pins. The method is analytic placement as chip and board placers do it (ePlace, RePlAce, Cypress): wire length (weighted-average model) against the electrostatic energy of the parts' area, solved on 2.54 mm bins by a cosine transform. Legalization is biggest part first.
- On boards laid out by Place all, spreading and then routing left fewer connections open than routing alone (open connections, Place all → spread): 03 2 → 1, 05 1 → 0, 07 13 → 7. On the examples' own layouts the whole-board rounds didn't beat the rounds near the open connections, so Route & nudge keeps those results.

### Changed
- Route & nudge also moves parts that hang over the board edge, back onto it.

## [3.114.0] - 2026-10-27

### Added
- Board: **pin-escape check**. When connections stay open after Auto-route or Route & nudge, the status line names the pins that are shut in and what walls them in, for example *VT1 pin 2 (shut in by a track on B.Cu, R3)*. All of a part's open pins are counted at once, as a maximum flow from the pins to free space through cells one track apart on both layers (escape routing as network flow).
- Board: what Freerouting leaves is tried once more on a grid (Lee's maze search). A track of the net's width that still fits from end to end past the existing copper is added, and kept only if it closes the connection and adds no rule message.

### Changed
- Route & nudge also moves the parts that wall in a shut-in pin or block the way between an open connection's ends, wherever they are. It takes up the tracks and vias that wall them in, even when no part can move.
- Examples 02, 04 and 06 re-routed. Stripped and routed again with Route & nudge (open connections, was → now): 02 1 → 0, 04 2 → 0, 06 6 → 4, 07 8 → 6.

## [3.113.0] - 2026-10-27

### Changed
- Board: new boards start with narrower design rules: 0.6 mm signal tracks (was 1 mm), 1 mm power and high-voltage tracks (was 2 mm; a net still widens for its DC current) and 0.4 mm clearance (was 0.6 mm). High-voltage clearance stays 2 mm, and IPC-2221B still adds more by voltage, so a 31–150 V net keeps 0.6 mm. With the old rules a track could not get out of crowded pins such as a TO-92's or a DIP's, so Auto-route left the same connections open however large the board was. Boards saved with other rules keep them.
- The example boards were routed again with the new rules (07 keeps its own):

  | Example | Board (mm) | Open connections (was) |
  | --- | --- | --- |
  | 01 | 80 × 50 | 0 (1) |
  | 02 | 64 × 40 | 1 (2) |
  | 03 | 160 × 100 | 1 (4) |
  | 04 | 120 × 75 | 2 (2) |
  | 05 | 96 × 60 | 0 (4) |
  | 06 | 160 × 100 | 6 (28) |
  | 09 | 80 × 50 | 0 (2) |
  | 11 | 120 × 75 | 0 (1) |

## [3.112.1] - 2026-10-27

### Changed
- Every example now comes with a board, made with Place all on the board and Route & nudge. Each board was set to the size that left the fewest connections open, and the open ones are left to finish by hand:

  | Example | Board (mm) | Open connections | Rule messages |
  | --- | --- | --- | --- |
  | 01 | 80 × 50 | 1 | none |
  | 02 | 64 × 40 | 2 | none |
  | 03 | 160 × 100 | 4 | no mounting hole near VL1 and VL2 |
  | 04 | 96 × 60 | 2 | no mounting hole near VL1 |
  | 05 | 96 × 60 | 4 | R8's reference over a pad |
  | 06 | 160 × 100 | 28 | no mounting holes near the valves |
  | 09 | 80 × 50 | 2 | none |
  | 11 | 120 × 75 | 1 | none |

## [3.112.0] - 2026-10-27

### Added
- Board: **Route & nudge** (Board ▾). When Auto-route leaves connections it can't fit, the parts near them are moved a little and the board is routed again, up to 5 rounds. Each round keeps the layout only if it helps. Moves are chosen by simulated annealing on wire length, ratsnest crossings, crowding (RUDY wire density) and how far parts go, and every move keeps the design rules. Locked parts, valves, transformers, controls and connectors stay put. The status line lists what moved, Ctrl+Z takes the whole run back, and the Auto-route button stops it. On example 07 with its tracks removed, Freerouting alone leaves 13 of 59 connections open; Route & nudge leaves 8.
- Auto-route's status line points to Route & nudge when connections are left.
- Examples 08 (555 astable), 10 (metronome) and 12 (simplest oscillator) now come with a board: 64 × 40 mm, placed with Place all on the board and routed with Route & nudge, with every connection routed and no rule violations.

## [3.111.0] - 2026-10-27

### Changed
- Board routing: the bend follows the mouse, as in KiCad. Leave the last corner along the grid and the straight run comes first; leave it at about 45° and the diagonal comes first. Once the pointer is well away (40 px) the bend stays put until you bring the pointer back near the corner. <kbd>/</kbd> turns it the other way by hand until the next corner.

## [3.110.0] - 2026-10-27

### Added
- Neon lamps NE-2, NE-2H and ИН-3 (Gas-discharge tubes › Indicators). A neon strikes at its striking voltage, holds about 60 V, lights either way round, and goes out below its extinction current. Through 330 kΩ on the mains it glows on both half-cycles. With a capacitor across it, it flashes at RC·ln((E − Vm)/(E − Vs)). Checks warn over twice its design current. On the board it is the bulb standing on its leads.
- Magic eyes 6E5, 6Е5С and 6U5: the triode fitted to RCA's data (checked against ngspice), the target, and the shadow worked out from the ray-control voltage. The inspector shows the shadow angle. On the board they get a 6-pin (UX6) or octal socket.
- Glow like the LED: under Animate a neon glows orange with its current, flickering dark at each zero crossing on AC and blinking in a flasher. A magic eye's green fan opens and closes with its grid. A lit gas regulator glows violet. Settled (no Animate) they show their average.
- Power amplifier ICs (Integrated circuits › Power amplifiers):
  - LM386 with its internal gain network: gain 20, or 191 with pins 1 and 8 bypassed; output at half the supply; 0.65 W into 8 Ω from 9 V.
  - TDA2050 (Pentawatt) and LM3886 (TO-220-11): 38 W into 8 Ω and 68 W into 4 Ω from ±28 V, as the datasheet.
  - Checks for the supply range, the package's dissipation, and an LM3886 left muted (no current drawn from its mute pin).
  - On the board: DIP-8 / SOIC-8, and new staggered TO-220-5 and TO-220-11 footprints.
- Headphone loads (speaker Driver presets, also in the parts search): 32, 250, 300 and 600 Ω, each with its impedance peak at resonance.
- Anode temperature: from a tube's average dissipation, radiation-cooled (about 400 °C at the rated Pa). From about twice the rating the anode glows red on the schematic (red-plating), and Checks warn. The inspector shows the temperature and its time constant.

## [3.109.0] - 2026-10-27

### Added
- A new palette group, Switches & relays, holds the changeover switch and these new parts:
  - an on–off switch: a toggle, or a push button that is normally open or normally closed (6 × 6 mm tactile on the board);
  - a rotary selector of 2 to 12 ways, whose sections SA1.1, SA1.2 … turn together.
  Double-click any of them on the sheet to move it on.
- Relays: Omron G5LE-1 (SPDT, 10 A) and G5V-2 (DPDT signal), each with a 5, 12 or 24 V coil.
  - The coil is its resistance and inductance. The relay pulls in at 75 % of the rated voltage and drops out at 10 % (G5LE-1) or 5 % (G5V-2).
  - The inductance gives the operate delay, and a freewheel diode slows the release, both matching ngspice.
  - The schematic shows the contacts pulled in when the simulation has them so.
  - Checks warn about a coil over 130 % of its rating, or under its must-operate voltage.
  - The SPICE export writes the contacts as switches with the relay's hysteresis.
  - On the board the relays use KiCad's patterns, with the datasheet pin numbers.
- Vactrols VTL5C3 and VTL5C1: an LED lighting a CdS cell. The cell's resistance follows the LED's current, using the datasheet's figures at 1 mA and 10 mA and its dark resistance. It brightens within the turn-on time and dims slowly (35 ms to 100 kΩ), so a vactrol tremolo throbs as a real one does. The LED lights up under Animate like an LED part. Checks warn over 40 mA in the LED. On the board it uses KiCad's VTL5C pattern.
- Guitar pickup source with these settings:
  - single-coil, P-90 and humbucker presets;
  - the EMF behind the coil's resistance and inductance;
  - its self-capacitance and an optional cable.
  Into an amp's input it peaks where a real pickup does.
- Phono cartridge source for moving-magnet and moving-coil presets (Ortofon 2M Red, Denon DL-103). It plays a tone at its rated output, cut with the RIAA curve as on a record, or flat. A correct RIAA preamp swept with the Bode plotter comes out level. The cut is exact to the IEC curve, with the 3.18 µs pole.
- The pickup and the cartridge stand for the instrument, so they get no part on the board and are left off the BOM, as the other bench sources are.
- The engine has two new elements: RELAY, a latch on a sensed coil current with its contacts, and LDR, a resistor whose light is an extra unknown that relaxes toward the LED's current.

## [3.108.0] - 2026-10-27

### Added
- Board footprints can have unplated holes of their own, such as the pegs that locate a part. A part's holes move and turn with it and show with the mounting holes. They go into the NPTH drill file as component holes, with the solder mask open over them, and are drilled through the 3D board and the STEP. Pours, tracks being routed, teardrops, the Freerouting export and the design-rule check keep the net class's clearance from them. That clearance is not the chassis clearance, because a peg is not a screw.
- Neutrik NJ2FD-V, NJ3FD-V and NJ5FD-V vertical 6.35 mm jacks, each with its two locating pegs in unplated holes. The switched jack's normalling contact goes on the NJ5FD-V's TN pin.

## [3.107.0] - 2026-10-27

### Added
- Gas voltage regulators 0A2, 0B2, 0A3, 0C3, 0D3 (palette: Gas-discharge tubes). Each is dark until its striking voltage. Once lit it holds its maintaining voltage plus its regulation, and it goes out below about 2 mA, so a capacitor across one makes a relaxation oscillator. The inspector shows whether it is lit. Checks warn when it does not strike or runs outside its current range. On the board it sits in a B7G or octal socket (anode pin 5, cathode pin 2). The SPICE export writes it as a breakdown diode.
- Interstage and input transformers (Transformers) with:
  - a turns ratio and an optional centre-tapped secondary;
  - primary and leakage inductance, winding capacitance and DCRs;
  - the primary DC the core is gapped for (Checks warn above it, or at any DC when ungapped);
  - presets for 1:1 and 1:2 CT interstages, a microphone 1:10, a moving-coil step-up and a line input;
  - EI board footprints.
- Controlled sources (Sources): a voltage-controlled voltage source (SPICE E) and current source (SPICE G), exported as E and G.
- Op-amps NE5532, OPA134, OPA2134 and LM4562.

### Changed
- An op-amp's second stage scales with its gain-bandwidth above 3 MHz, so fast types keep the datasheet's bandwidth.
- A free-running latch (a 555, or a glow tube relaxing) is timed from its second fall to its third, at the instants it flips. Before, the first cycle could start from the DC state, and a strike and an extinction within one step went unseen. A latch that chatters every step is not taken for an oscillator.

### QA
- E, G and the transformer agree with ngspice's E, G and coupled inductors to 1 ppm over 1 Hz–1 MHz. The relaxation oscillator's period matches RC·ln((E − Vm)/(E − Vs)) within 1 %. The op-amps' gain, bandwidth, slew rate, swing and currents match their datasheets.

## [3.106.0] - 2026-10-27

### Added
- Fuse part (Passive › Protection): 100 mA to 10 A, time-lag or fast, 5 × 20 mm, 6.3 × 32 mm (both in PCB clips) or TR5; it simulates at its cold resistance from the makers' tables. Checks: over its rating it blows, above 75 % it warns.
- Inrush limiter NTC (Ametherm SL10/SL22/SL32): the simulation finds its self-heated resistance from the rms current through it, so a loaded supply runs it hot (a fraction of an ohm) and a light one leaves it near cold. The inspector shows the hot resistance, current and dissipation; Checks warn above its Imax.
- Varistor (TDK SIOV S07K275 … S20K275, S10K150, S14K385): 1 mA at the varistor voltage and the clamp voltage at the surge current, both ways; microamps of leakage at the mains peak. Checks: over its rms or DC rating.
- Connectors (Ground & connectors): jack (6.35 mm switched mono, stereo, 3.5 mm, RCA; double-click plugs a plug in or out and the switched jack's tip-to-SW contact follows), IEC mains inlet, terminal blocks (2–8 ways, 5.08 or 7.5 mm), pin headers (2–10), Faston tabs (6.3 and 4.8 mm).
- Capacitor voltage rating: capacitors and electrolytics take a rating (shown in the value and the BOM). Checks warn above 80 % of it, over it, and on a reversed electrolytic.
- Bridges GBU4J, GBU8K (inline), KBU8K and W04G/W10G (round WOB).
- Board: Neutrik NMJ4HCD2/NMJ6HCD2 jack, pin header, Faston, fuse clip, TR5, MOV and NTC disc footprints, and GBU/KBU/WOB bridges, all with 3D bodies.

### Changed
- The SPICE export writes an NTC at its simulated hot resistance (with a comment) and a varistor as two opposed diodes.
- The Newton convergence floor now scales with the largest node voltage, so circuits with high-voltage floating nodes (a bridge on a mains source) settle.

## [3.105.0] - 2026-10-27

### Added
- Twenty diodes in the Model list: standard rectifiers 1N4001, 1N4004, 1N4007, 1N5404, 1N5408; fast and ultrafast UF4007, UF5408, MUR160, MUR460, HER108, FR107; Schottky BAT85, 1N5817, 1N5819, 1N5822, SB1100; SiC Schottky C3D02060A, C3D04060A, C4D02120A; and the 1N4148. Each has its forward curve fitted under the datasheet maximum, its junction capacitance and its ratings; Schottky and SiC diodes draw with the hooked cathode bar.
- Reverse recovery: a diode now stores charge while it conducts (SPICE TT) and keeps conducting backwards until it is gone, a few microseconds for a 1N4007, the datasheet trr for a fast one, none for a Schottky or SiC diode. The trr test reproduces the datasheets (FR107 500 ns, MUR160 50 ns) and agrees with ngspice within a few per cent.
- Bridge rectifier part (Semiconductors): DF04M and DF10M (DIP-4), B250C2300-1500A (inline), KBPC2510 and KBPC3510 (chassis, Faston, wired on the board). The inspector shows the output, its current and the peak reverse voltage.
- Checks: a diode or bridge whose peak reverse voltage over the capture exceeds its VRRM, or whose average current exceeds its rating.
- The whole 1 W zener series 1N4728A … 1N4764A (3.3–100 V) and the 5 W 1N5349B, 1N5352B, 1N5359B, 1N5363B.
- Board: DO-201AD (3 A diodes, 1.5 mm holes), TO-220-2 for SiC diodes, DIP-4 and SIL-4 bridge footprints with 3D bodies; 3 A diodes go to SMC in SMD.

### Changed
- The SPICE export writes each diode's TT and CJO.

## [3.104.0] - 2026-10-27

### Added
- Eleven classic tubes, now 110 in the library: 12BH7A and 6CG7 (drivers and phase splitters), 6AS7G / 6080 (regulators, OTL), KT66, 6AQ5A (the B7G 6V6), ECL82 as triode and pentode sections, the 211 power triode, and the rectifiers 5Y3GT, EZ81 and 6X4. Each has its Koren model fitted to the datasheet's operating point (within 1–3 % of Ia, gm and rp; the 6CG7, 6AQ5A and ECL82 share the models of their electrical twins 6SN7GT, 6V6GT and 6Ф3П), its ratings, socket, pinout and heater, so the board gives it the right socket footprint and 3D valve. The rectifiers' drops follow their datasheets (5Y3GT about 45 V at 100 mA, EZ81 28 V at 150 mA, 6X4 22 V at 70 mA).

### Changed
- The SPICE export writes the tubes' grid current and screen fade-in with min/max instead of if(), so the netlist now runs in ngspice as well as LTspice. The new tubes' DC operating points agree with ngspice within 0.01 %.

## [3.103.0] - 2026-10-27

### Added
- JFETs (Semiconductors › JFETs): N-channel J201, J113, J310, 2N5457, MPF102, 2SK170, LSK170B, 2SK30A and P-channel J175, 2N5460, 2SJ74. Square-law model with channel-length modulation and gate diodes; the inspector shows Id against IDSS and warns when the gate conducts. SPICE export writes native NJF/PJF models. Footprints TO-92, TO-18 and SOT-23; pinouts that vary between makers are marked for checking in DRC.
- Voltage regulators (Integrated circuits › Regulators): LM317, LM317L, LM338, LM337, 7805, 7809, 7812, 7815, 7824, 78L05, 78L12, 7905, 7912, 7915. The model has the reference, adjust-pin current, quiescent current, line regulation, dropout, current limit and ripple rejection; the inspector shows Vin, Vout, the headroom and the dissipation. Checks reports input over the rating, dropout, a missing minimum load on an LM317/337 and dissipation that needs a heatsink. Footprints TO-220, TO-92, SOT-89, SOT-223, DPAK and D2PAK.
- TL431 shunt reference (Integrated circuits › Regulators): Vref 2.495 V, 2.5–36 V, 1–100 mA, with Checks for the cathode current and voltage. TO-92, SOT-23 and SOT-89.
- Simulation checked against ngspice: DC operating points agree within 0.05 %, JFET AC gain matches.

## [3.102.0] - 2026-10-25

### Added
- Power rail (Sources › DC supplies): the one-pin VCC arrow with the rail's name and voltage beside its tip, drawn upright in any rotation. It simulates as an ideal DC supply from its pin to ground. Rails and sheet connectors with the same name (in any case) are one net, fed by one source, so a rail can be placed at every part that needs it; the inspector shows the rail's voltage, current and power. *Shown as* puts your own text next to the arrow ("5V to 9V") while the simulation uses the voltage. Checks reports rails of one net with different voltages and a rail wired to ground. The rail has no footprint; on the Board its net takes the rail's name.

## [3.101.0] - 2026-10-25

### Fixed
- The flashing-LED example showed only a frozen moment: a 555 running freely with no source to follow was simulated for 5 ms, so its slow cycle never appeared and the scope, the probe and the stickers read a flat 0 V. The simulation now finds such a 555's own period after power-on, however slow (1.51 Hz here, 1.53 Hz by the formula), and captures three or more whole cycles; the DC values are averages over the cycle. The oscilloscope shows the square wave, ∿ Animate runs the wire animation (AC and DC dots, node tints) over the 555's cycle, and the LED blinks with it.

### Changed
- An LED lights inside its triangle only, no glow around it.
- ∿ Animate plays a cycle of a quarter second or longer in real time (a flasher blinks at its own rate); faster cycles are still slowed to 3 s. The power-on playback is left for circuits with LEDs but no cycle at all.

## [3.100.0] - 2026-10-25

### Added
- LEDs light up on the schematic: a glow in the LED's colour, brighter with more current (full at 10 mA), from the simulated operating point, and with ∿ Animate on, from the current at the animation's moment.
- ∿ Animate on a circuit with LEDs but no signal generator or mains (a flasher) plays its first 4 seconds after power-on in real time, looping, so the LEDs blink as they would on the bench; the time line at the top left shows the moment. Before, Animate showed a few milliseconds of the settled state and the flashing-LED example's LED never visibly flashed.

### Changed
- The flashing-LED example's note now points to ∿ Animate.

## [3.99.0] - 2026-10-25

### Changed
- Space rotates parts, in the schematic and on the Board: the part being placed, the parts being dragged (letting go commits the move and the turn as one undo step) and the selection. Space held down while dragging still pans, so a quick tap rotates and a hold pans. R still rotates too. Space never scrolls the page or presses a toolbar button that kept the focus, types a space in a text field, and leaves the buttons of a dialog or menu alone. Edit ▾, the Board's right-click menu, tooltips, the help and the README show Space.

## [3.98.6] - 2026-10-25

### Fixed
- Picking Bottom copper (the layer list, the Layers panel or "only") while a track was already being placed left the track on the top, so it was drawn in the top's red while the bottom showed as active. The layer picked now carries the track with it: before its first corner the track simply starts on the new side; after a corner a via goes in, as V does. A track starting on an SMD pad stays on that pad's side and says so.

## [3.98.5] - 2026-10-25

### Fixed
- A Board window left open from an older release kept its old toolbar (a "CAD ↗" button on the right instead of the Schematic | Board switch at the left): the Board button only brought that window forward. A tool window from another release is now reloaded when a button brings it up, and the pages the CAD opens (the Board window and the Board in this window, the instruments) carry the release stamp in their address, so a browser cannot answer with an old cached page.

## [3.98.4] - 2026-10-25

### Fixed
- The Schematic | Board switch worked only once in Safari: Safari lets a page bring forward only a window it opened itself, so the Board window's Schematic button could not raise the CAD's tab. In Safari the board now opens inside the CAD window by default (Windows ▾ → Board in this window, still untickable), so the switch flips both ways every time. With separate windows, a button in Safari that cannot bring its window up (Schematic in the Board window or an instrument) now says so instead of doing nothing.

## [3.98.3] - 2026-10-25

### Changed
- Code structure only, no change in behaviour: the oscilloscope, spectrum analyzer, Bode plotter and help pages keep only their markup and styles; their scripts, until now written into the pages, are files of their own (`scope-app.js`, `spectrum-app.js`, `bode-app.js`, `help-app.js`), so the lint checks them too.

## [3.98.2] - 2026-10-25

### Changed
- Tests only: the 2,245-line end-to-end test is split into nine parts in `tests/e2e/` (editing, instruments, circuits, windows, sheets and files, BOM and semiconductors, board, ratings/SPICE/examples, tolerance UI) with the shared setup in `tests/e2e/harness.mjs`. `npm run test:e2e` runs them in the same order with the same 360 checks.

## [3.98.1] - 2026-10-25

### Changed
- Code structure only, no change in behaviour: the Board window's script is split like the CAD's. Auto-route (`board-autoroute.js`), the side panels (`board-panels.js`) and the drawing (`board-draw.js`) are files of their own; `board-app.js` is down from 2,082 to 1,420 lines. Every example board's Gerbers, SVG, rule check, panels and on-screen drawing were compared with 3.98.0 and are identical.

## [3.98.0] - 2026-10-25

### Added
- **Lint.** `npm run lint` runs ESLint over every script, test and build script, and `npm test` runs it first, so a name a code change forgets (the scripts share one global scope) fails the tests instead of the app.

### Fixed
- The hint for an op-amp's *Output current* readout showed the NE555's text (the hints held the label twice, and the second won). One text now covers both parts.

### Changed
- Dead code the lint found is gone: unused helpers in the bias solver, the CAD (an inline confirm, a counter and a topology call in the SPICE export), the Board window and the packaging script.

## [3.97.6] - 2026-10-25

### Changed
- Code structure only, no change in behaviour: what the CAD reads from a simulation result (node voltages, pin and wire currents, power, tube data and ratings) moved out of `cad-app.js` into `cad-results.js`. `cad-app.js` is now about 2,470 lines, down from 3,176.

## [3.97.5] - 2026-10-25

### Fixed
- **The placement file puts every SMD part at its real centre.** `pos.csv` gave the mean of a part's pads, which is not its centre on parts whose pads are not symmetric: 0.38 mm off on an SOT-23, 0.5 mm on the TC33 trimmer, 1.6 mm on an SOT-223 and 2.4 mm on a D²PAK, enough for the assembly machine to set it beside its pads. It now gives the centre of the land pattern (the pads' extents), as IPC-7351 does.
- **Solder paste on a DPAK's or D²PAK's tab in windowpanes.** The stencil opened the whole tab, which floats the part on the molten solder and traps voids. The tab now gets a grid of openings, about 3 mm apart, on 70 % of it; the pins keep their full openings.
- Checked with an independent Gerber reader on four example boards made SMD (also with parts on the bottom): paste only on SMD pads and inside them, none on plated holes, every SMD pad opened in the mask, every placement within 0.001 mm of its land pattern's centre, on the right side.

## [3.97.4] - 2026-10-25

### Changed
- Code structure only, no change in behaviour: the CAD's side of Board Design (the board window or tab, the netlist and board it shares, cross-probing) moved out of `cad-app.js` into `cad-board-link.js`.

## [3.97.3] - 2026-10-25

### Changed
- Code structure only, no change in behaviour: Save as PDF, the Export dialog and Print moved out of `cad-app.js` into `cad-export.js`. Every example's PDF, PNG and on-screen drawing was compared byte for byte with 3.97.2.

## [3.97.2] - 2026-10-25

### Changed
- Code structure only, no change in behaviour: the voltmeter probe (P) moved out of `cad-app.js` into `cad-probe.js`.

## [3.97.1] - 2026-10-25

### Changed
- Code structure only, no change in behaviour: the current animation (View ▾ → Animate) moved out of `cad-app.js` into its own file, `cad-anim.js`, the first step of splitting the CAD's 3,000-line script into parts.

## [3.97.0] - 2026-10-25

### Changed
- **Auto-route finishes what the pour leaves.** A net with a copper pour (a ground plane) is left to the pour, which fills again around the new tracks. Pads of that net the pour does not reach (cut off by tracks, or in a gap of the pour) now get a second Freerouting pass that joins just those pads with tracks; the status line says how many. Ctrl+Z still takes the whole run back in one step.

### Fixed
- **No loose crumbs of copper in a pour.** Where two clearances nearly touch, or beside a removed island, a pour could leave specks of copper narrower than 0.1 mm, cut off from everything (up to 18 on the Gubin board's ground plane). A board maker's check flags such slivers, and they can flake off and short. A pour now keeps another 0.075 mm off everything and its own outline at the end, which takes them all; every pad it joined stays joined. Checked with an independent Gerber reader on seven example boards: no slivers, spacing, annular ring, edge, mask and silkscreen all within common 2-layer fab rules.

## [3.96.0] - 2026-10-25

### Added
- **Print (Ctrl+P) in the Circuit CAD.** *File ▾ → Print…* prints the sheet in view, all sheets or the bill of materials through the browser's print dialog. The pages are the same vector, black-on-white pages as *Save as PDF*, each sheet at its own paper size (A4…A1, 1:1); the dialog can also save them as a PDF.
- **Print (Ctrl+P) in the Board window.** *Export ▾ → Print…* picks the pages: assembly drawing, top and bottom copper, drill map, and the two toner-transfer pages (top copper mirrored, bottom copper). *Print set* and *Toner transfer* tick the usual sets. The copper prints at 1:1 on A4 or A3 with the 50 mm check bar; choose *Actual size* in the print dialog.
- Chromium-based browsers open their print dialog straight away; Firefox and Safari open the PDF in a new tab to print from there.

## [3.95.0] - 2026-10-25

### Added
- **The board as a tab of the CAD window.** *Windows ▾ → Board in this window* (off by default): the Schematic | Board switch then flips one window between the schematic and the board layout, which suits a single screen. Untick it to give the board a window of its own again, for a second monitor.
- **Alt+B and Alt+S** go to the board and back to the schematic from any window (the CAD, the Board, the instruments).
- **Nets cross-probe.** Highlighting a net on the board (the Nets tab or the backtick key) selects its wires in the schematic; selecting wires of one net in the schematic highlights that net on the board until the selection is cleared. Parts already cross-probed.
- **A Schematic button in the instruments.** The oscilloscope, spectrum analyzer and Bode plotter have it at the left of the toolbar, as in the Board window, in place of *Circuit CAD ↗* at the right; their help button uses the same icon as the CAD's.

### Changed
- **The Board toolbar stays one row down to 1100 px.** Below 1450 px the tools (Select, Route, Via, Text, Hole, Pour, Keep-out, Measure) show as icons, and below 1250 px so do Update, Auto-route and Unroute; their tooltips name them and their keys.
- **The CAD toolbar stays one row down to 1000 px**: below 1080 px *Windows ▾* becomes an icon.

## [3.94.0] - 2026-10-25

### Added
- **Schematic | Board switch.** The same two-button switch sits at the left of the Circuit CAD's toolbar and of the Board window's toolbar: the lit one is the window you are in, the other brings its window up (the CAD's *Board* opens the layout the first time; the Board's *Schematic* replaces the old *CAD ↗* button at the far right). On narrow screens it shows only its two icons. *Windows ▾ → Board layout* still works.

### Fixed
- **The Board toolbar no longer runs off the window.** Below about 1340 px its right end (Board ▾, Export ▾, help and the way back to the schematic) was cut off and out of reach; now a narrow window gets a second toolbar row. The status pill shows its full text on hover when it is cut short.
- **The CAD's toolbar stays one row from 1100 px up** (it took two rows between about 1180 and 1300 px): the file name gives way before the toolbar wraps, and the compact layout starts at 1300 px.

### Changed
- The Board window's undo, redo and help buttons use the same icons as the CAD's.

## [3.93.1] - 2026-10-25

### Changed
- **The manual and the README catch up with 3.86–3.93.** The manual gains the NE555 (its model, the five examples, its DIP-8 or SOIC-8), Auto-route set out step by step (starting Freerouting, `cors_origins` and the API key flag, Docker's `endpoints` flag, another computer on the network and the browser's local-network prompt, the SSH tunnel), deleting a track taking its loose ends, and the paste layers and placement file in the Gerbers. The README gains the voltmeter probe, the faster tolerance runs, capacitor voltage ratings and SMD packages in the BOM, the toolbar naming an example by its title, the SMD footprints, Auto-route and Unroute, the socket-body clearance rule and the SMD assembly files; it no longer says the bipolar model has no base or emitter resistance.

## [3.93.0] - 2026-10-25

### Added
- **SMD versions of the board's small parts.** An **SMD** checkbox in the Board window's inspector switches a part to its surface-mount footprint, or a whole selection at once (each part that has one). Resistors become 0603–2512 chips by power, capacitors 0603–2220 chips by value, electrolytics V-chip cans up to Ø18 mm; signal diodes SOD-123, SOD-323 or MiniMELF, rectifiers and zeners SMA, SMB or SMC, LEDs 0805 or 1206; small transistors SOT-23 (or SOT-89), TO-126 parts SOT-223 or DPAK, TO-220 parts D²PAK or DPAK; the NE555 and the op-amps SOIC-8 or SOIC-14; a trimmer TC33. The footprint list then shows the SMD choices. Valves, transformers, panel pots, jacks and big power transistors stay through-hole (the checkbox is greyed for them).
- **SMD pads are on one side only.** They sit on the copper of the part's side (the bottom copper for a part on the bottom), with no hole. Connectivity, the ratsnest, the design-rule check (no drill or ring rule for them; silkscreen checked against the pads of its own side), pours, Auto-route (each SMD pad a padstack on its own layer, its escape lead on that layer) and manual routing follow it: a track started on an SMD pad starts on its layer, and one ending on an SMD pad of the other side asks for a via first.
- **Gerbers for SMD assembly.** Copper and solder mask carry each SMD pad on its own side only; new solder paste layers (`F_Paste`, `B_Paste`) and a placement file (`-pos.csv`: reference, value, package, centre, rotation, side) come with the files when the board has SMD parts. No drill holes for them, in the drill file, the drill map, the 3D board or the PDFs.
- **3D models of the SMD packages**: chips with their end caps (resistors black, capacitors tan), diodes with the cathode band, V-chip cans on their base, SOT-23, SOT-89, SOT-223, DPAK and D²PAK with their leads and tab, SOIC, the trimmer. In the 3D view, the part preview and STEP.
- **The BOM names SMD parts.** A part made SMD on the board shows its package in the Circuit CAD's bill of materials ("Resistor, SMD 1206"), on a line apart from the through-hole parts of the same value.

## [3.92.0] - 2026-10-25

### Added
- **Unroute.** A toolbar button beside Auto-route removes every track and via from the board, to route again from scratch. Locked tracks and vias stay. One step: **Ctrl+Z** brings them all back.

### Changed
- **Deleting a track takes the loose ends of its route with it.** Removing one track of a route used to leave the rest of it hanging: stubs and vias touching nothing, which still counted against the clearances (on the Gubin board one such stub broke the 2 mm high-voltage rule). Now the copper of that route left unconnected where it met the deleted piece goes too, up to the pads, a pour or copper still in use. Locked copper stays, and **Ctrl+Z** brings everything back.
- **Auto-route clears the copper left from where the parts were.** After parts moved, the old tracks stayed where they had been: ends in the air, across other nets' pads, too close to them. Auto-route kept them and routed around them, and they piled up with each run. Now it first removes the copper that hangs loose, reaches no pad, joins two nets or breaks a clearance, then routes those connections afresh; the status line says how many old pieces went. Locked copper stays, and one **Ctrl+Z** takes the whole run back.

## [3.91.0] - 2026-10-25

### Changed
- **An example (or a new circuit) shows its name in the toolbar.** A circuit not saved to a file yet went by "Untitled" in the toolbar and the tab title, even when its title block had a title. It now shows the title block's title (or, without one, its identification number), in grey italics until it is saved to a file; the tooltip gives both. Opening an example shows, for instance, "NE555 metronome: astable into a speaker". "Untitled" stays for a circuit whose title block is empty.

## [3.90.1] - 2026-10-25

### Fixed
- **Auto-route no longer pushes the Board view off to the side.** Pressed while Freerouting did not answer, it wrote the whole start command into the status bar, and that one long line made the window wider than the screen: the board slid away and the toolbar was cut off. Long status messages now end in "…" (the full text is in the tooltip), and the window keeps its width.
- **Auto-route tells you why it cannot reach Freerouting.** Pressed while Freerouting does not answer, it opens **Board ▾ → Freerouting…**, which now tells the cases apart: Freerouting runs but does not let this page in (it was started without this page's address after `--api_server.cors_origins`), something else answers at that address, or nothing answers (the API server is off, Freerouting listens only inside Docker or on its own computer, or the browser refused the address). An API key demand is named too. The first answer of a freshly started Freerouting can be slow, so the check waits 3 s.

## [3.90.0] - 2026-10-25

### Added
- **Auto-route with Freerouting.** A new **Auto-route** button in the Board window sends the open connections to [Freerouting](https://www.freerouting.app) (free, GPL-3) and adds the tracks and vias it finds. Freerouting runs on your own computer, or another one on your network: start its API server with Java 25 and `freerouting.jar`, or its Docker image. The button stays grey until Freerouting answers. **Board ▾ → Freerouting…** sets the address (an IP, and `:port` if not 37864), tests it, and shows both start commands ready to copy. The board goes out with its design rules: each net's track width (its class, or its DC current), and the clearance between every two nets, by voltage (IPC-2221B) too. Pour nets, and GND with star grounding, are left to the pour. A pad crowded by its footprint's neighbours first gets a short straight lead to where the full clearance holds. Wires Freerouting leaves unfinished are dropped. What it cannot route within the rules stays in the ratsnest, and **Ctrl+Z** takes the whole route back. The Gubin board (07), routed from scratch, gets 46 of its 59 connections in about 7 s, with no rule violations.
- **Freerouting by hand.** **Export ▾ → Freerouting design (DSN)** and **Board ▾ → Import routes (SES)…** for routing in Freerouting's own window or its command line.
- **Design rule: under a socket's body, tracks may pass its pins at their own spacing** (on by default). A noval socket's pins are 1.27 mm apart, closer than any HV clearance. Under the socket's body, a track or via may now pass a pin as close as that pin's nearest neighbour is; the socket fixes that spacing anyway. Everywhere else the full clearance still holds. The check, manual routing and Auto-route all follow it; turn it off in Design rules.

## [3.89.0] - 2026-10-25

### Added
- **Voltmeter probe.** A *Probe* tool beside Select and Wire (key <kbd>P</kbd>). Point at any wire or pin after a simulation and a card beside the pointer reads the node like a bench meter: DC voltage, AC rms, peak-to-peak and frequency, with a small oscilloscope trace of the waveform (DC coupled with automatic position, triggered, 2–5 periods; the same auto-ranging as the scope parts). The node's wires glow yellow. A click leaves the probe on that node: its card stays on the sheet and keeps reading through edits and new simulations (handy with Live while turning a value in the inspector), also after you go back to Select. <kbd>Esc</kbd>, the card's × or a click on empty sheet with the probe removes it.

## [3.88.0] - 2026-10-24

### Added
- **NE555 timer.** A new *Integrated circuits* group in the parts list holds the NE555, pins numbered as on the chip. The simulator models what is inside: the 5k–5k–5k divider (CV at ⅔ VCC), the trigger and threshold comparators, the latch, reset below 0.7 V with a weak pull-up (an open RESET reads high), the output stage from TI's data (high VCC − 1.4 V less 3 Ω, sourcing only, about 13.3 V at 100 mA from 15 V; low 8 Ω, 0.4 V at 50 mA), the discharge transistor (12 Ω) and the chip's own supply current. The latch switches at the instant a comparator crosses its level, found inside the time step, so the timing does not depend on the step; the latch is part of the circuit's state, so a 555 triggered by a signal generator settles to its steady state like any other circuit. The inspector reads the output's frequency and duty cycle, or its level and load at rest. A free-running 555 is captured after one window, past its first, longer cycle; the oscilloscope's power-on transient (now 20000 steps when a 555 is in the circuit) shows slow timers. The SPICE export writes it as an `NE555` subcircuit on pins 1–8.
- The 555 goes on the board in the DIP-8 footprint by default (or on wires).
- **Five 555 examples** from 555-timer-circuits.com, each checked against its formula: astable multivibrator (1k / 10k / 100 nF: 678 Hz at 51.8 %, formula 686 Hz at 52.4 %; the discharge transistor's 0.1 V with R1's 9 mA makes the difference), flashing LED (1.51 Hz, formula 1.53 Hz), metronome (0.641 Hz, formula 0.648 Hz), car tachometer one-shot (5.16 ms pulses, 1.1 RC = 5.17 ms; meter current proportional to the spark rate within 3 %), simplest oscillator (572 Hz at 60 % high: the output reaching only VCC − 1.4 V makes it slower than the 721 Hz of the ideal formula).
- 1N4739A (9.1 V) zener.

## [3.87.0] - 2026-10-25

### Added
- **Op-amps: TL071, TL072, TL074, LM741, LM301A and LM324.** A new *Integrated circuits* group in the palette. Each op-amp has its datasheet's open-loop gain, gain-bandwidth (TL07x 3 MHz, LM741 and LM301A 1 MHz, LM324 1.2 MHz), slew rate (13 V/µs for the JFET TL07x, 0.5 V/µs for the others), output swing (within 1–1.5 V of the rails; the LM324 down to V−), output resistance, short-circuit current, input bias current and supply current, all drawn from the V+ and V− pins. The LM301A has no compensation of its own: its pins 1 and 8 are on the symbol for your capacitor (30 pF for unity gain). Checked in the textbook circuits against the datasheets: inverting ×10 to 0.1 %, a follower's bandwidth at the gain-bandwidth, ×101 at a hundredth of it, the slew rate on a square wave, clipping into 10 kΩ, the short-circuit current into 10 Ω, plus single-supply followers, comparators and Schmitt triggers. The inspector shows the output, its current and swing (amber when it clips), the voltage between the inputs and the dissipation; the checks flag a supply over the type's maximum. The SPICE export writes each type as a subcircuit of behavioural sources.
- **Op-amps on the board.** DIP-8 and DIP-14 footprints (and their 3D bodies). The amplifiers of a dual or quad named DA1.1 … DA1.4 share one package, each on its own pins from the maker's pinout, the supply pins shared. The schematic shows the package's pin numbers beside each lead.

## [3.86.0] - 2026-10-24

### Changed
- **Faster tolerance runs on circuits slow to settle.** When the circuit as drawn takes long to settle (its shooting method does not converge, as with the stereo Gubin example's valve-rectified supply), each varied run starts from that settled state instead of from cold, and has only a short way to go: the stereo Gubin example's 10 runs take 5.4 s instead of 11 s on 4 cores, with the same table (means within 0.01 %). The runs still settle to the same test, so where they end does not change. The state comes from the last simulation when it was of the same circuit, so all the runs start at once; otherwise the varied runs wait for the run of the circuit as drawn. Circuits that settle in a few cycles start cold as before. The engine's `simulate` takes it as `opts.warm` and returns its settled state as `result.warm`.

## [3.85.0] - 2026-10-22

### Added
- **Horizontal scroll bar in the schematic editor.** A bar under the drawing shows which part of it is on screen, with every sheet marked on its track by number. Drag the bar to scroll left and right, click a sheet's mark to show that sheet, click the bare track to move a screen's width; the ‹ › buttons at its ends, and Page Up / Page Down, step to the previous and next sheet. It appears with two or more sheets, or when the drawing runs past the sides of the view. A sideways swipe on a touchpad now scrolls the drawing too, instead of being ignored.

## [3.84.0] - 2026-10-21

### Changed
- **Gubin 5Ц4С example gives more power.** The 6P14P's grid swing was the limit: the direct coupling left it 72 V on the cathode, 247 V across the tube and only −6.6 V of bias, and the 1.5 kΩ feedback kept a phone well short of even that. R7 and R9 are now 47 kΩ (the 6P14P's grid, and so its cathode, sit lower), R13 and R14 1.6 kΩ, R3 100 Ω (B+ 327 → 351 V) and R11 and R12 2.2 kΩ: the 6P14P runs at 276 V, 39 mA, −8.5 V bias (10.5 W of 12 W), the 5Ц4С still delivers 106 mA. Triode position: 1.1 W from a phone at full volume (−5.6 dBV, 0.32 % THD, was 0.72 W), 1.7 W at 1 % THD and 2.0 W at 3 % (were 1.07 W and 1.27 W). Pentode position: 2.05 W from a phone (was 1.2 W), 3.7 W at 3 % THD; up to clipping the distortion is mostly second harmonic. The board keeps its layout: with the anode swinging to about 700 V the output transformers' ground pads lost their pour, so each gets a short ground stub, and one VL3 anode track moves clear of the socket's pin 6.

## [3.83.0] - 2026-10-20

### Fixed
- **Animate picks DC or AC by the node's voltage.** Each wire's dots now follow its node: where the DC voltage is at least the AC rms the violet DC dots flow, elsewhere the pale AC dots swing. The choice is made over the whole settled capture, so the mains, a power transformer's windings and a rectifier's anodes show AC (before, against a 1 kHz signal the 50 Hz mains barely moved in the one animated cycle and passed for DC). Ground wires still go by their current, and a filter capacitor on a DC rail, which passes only the ripple, shows AC.

## [3.82.0] - 2026-10-20

### Changed
- **Animate shows each wire's main current.** Each wire's dots now show only the part of its current that carries most of it. Where the DC is at least the AC (rms), violet dots flow steadily in the DC's direction, so a plate's supply lead or a cathode resistor shows its standing current instead of a small ripple; elsewhere the pale dots swing with the AC as before, as at a grid or through a coupling capacitor. The legend explains both.

## [3.81.0] - 2026-10-19

### Added
- **Capacitor voltage ratings in the bill of materials.** After a simulation the Rating / data column gives each capacitor the first standard voltage its makers build at or above 1.25 × the peak voltage across it (it runs at 80 % of its rating or less): electrolytics 6.3, 10, 16, 25, 35, 50, 63, 100, 160, 200, 250, 350, 400, 450, 500, 550 V; film and ceramic 50, 63, 100, 160, 200, 250, 400, 630 V, 1, 1.25, 1.6, 2, 3 kV. Above 550 V an electrolytic line asks for a series string of 450 V parts. Capacitors of one value that need different ratings get lines of their own, in the panel and in every export.
- **Release from GitHub's website.** *Actions → Release → Run workflow* on main releases `package.json`'s version (or the version typed in): the same tests and package as a pushed tag, then it tags main itself and publishes the release. Pushing a tag works as before.

## [3.80.0] - 2026-10-19

### Changed
- **The engine uses every processor core.** The CAD keeps one simulation worker per core (all of them, as the browser reports), loaded once and shared by every calculation, instead of a new worker per run. The live simulation, the power-on transient and the Bode sweep run side by side on cores of their own; tolerance runs fill all the cores (before: one per core less one, at most 8), and a simulation started meanwhile still begins at once beside them. The Bode plotter's sweep is cut into pieces of its frequency range that run on all the cores at once and are joined point for point, so its curves are exactly what one worker computed. One steady-state run steps through time, each step built on the one before, so it stays on one core.

## [3.79.0] - 2026-10-19

### Changed
- **Tolerance runs use several cores.** The runs go to one simulation worker per core (less one for the page, up to 8) instead of one after another, so a slow circuit's runs finish several times sooner: the stereo Gubin example's 10 runs took 50 s, now 22 s on a 4-core computer (3 workers). All runs are drawn before any starts, so a seed gives the same table as before.

## [3.78.0] - 2026-10-19

### Changed
- **One DC supply for B+ and bias.** The palette's *B+ supply*, *Bias supply* and *Low-voltage supply* are now a single *DC supply* (300 V by default). Its inspector has a *Polarity* switch, positive (the + pin is the rail) or negative (the - pin is the bias rail, the + pin to ground), and the *Voltage* field shows the size of the voltage; typing a minus sign still makes it negative. Circuits saved before open unchanged: a supply saved at −20 V shows as Negative, 20 V.

## [3.77.0] - 2026-10-19

### Added
- **Current source** (*Sources → DC supplies*): a constant DC current with a parallel output resistance (10 mA and 10 MΩ by default), drawn as a circle with the arrow of the current. A quick stand-in for a transistor or MOSFET current source as a plate load, a long-tail or cathode sink. The inspector reads the voltage across it and its dissipation, and warns when it is driving current uphill (delivering power, which a real transistor source cannot). It simulates in DC, transient and AC analysis (open circuit), exports to SPICE as an `I` element, goes to the BOM with the bench parts and to the board as a two-pin terminal.
- *Low-voltage supply* (12 V) in the palette, for transistor and LED rails.

### Changed
- **The Sources group is organized**: *DC supplies* (B+, bias, low-voltage, current source) and *AC sources* (signal generator, AC mains) under their own headings. Ground and the sheet connector, which are not sources, moved to a new *Ground & connectors* group.
- The signal generator's inspector is in three sections, *Signal* (waveform, frequency, phase), *Level* (Vpk, Vrms, dBV, DC offset) and *Output* (output impedance). Inspector fields can now carry a heading (`kind: "heading"` in `cad-components.js`).
- The DC supply and the signal generator explain their pins in the inspector; the DC supply says whether it is an ideal regulated rail or sags by its internal resistance.

## [3.76.0] - 2026-10-18

### Added
- **Base and emitter resistance (RB, RE) in the transistor model**, set for the 2N3055 / MJ2955, TIP41C / TIP42C and MJL21194 / MJL21193 from their datasheets' VBE(on) maxima: VBE now rises with the current as a real power transistor's does (2N3055: 1.05 V at 4 A, was 0.71 V), so emitter-follower output stages and their bias show the drop they have on the bench. The junctions sit on inner nodes behind the resistances; VBE, VCE and the dissipation in the inspector, the checks and the BOM are read at the pins.

## [3.75.0] - 2026-10-18

### Added
- **Tolerance runs (Monte Carlo).** *View ▾ → Tolerance runs* opens a *Tolerance* tab under the sheet that simulates the circuit as drawn and then once per run with every resistor, pot and capacitor at a random value within its tolerance and every tube drawing more or less current than its model (R ±5 %, C ±20 %, tubes ±20 % by default; normally distributed with the tolerance as 2σ, seeded). For each tube's Ia, Va and Pa, each transistor's current and dissipation, each speaker's output and each scope channel's AC it shows the nominal value, min, mean, max and spread, and how many runs took the part over its rating (`cad-tolerance.js`).

## [3.74.0] - 2026-10-18

### Added
- **Germanium transistors in the parts list.** Semiconductors → Transistors has *PNP, germanium* (AC128), *NPN, germanium* (AC127) and *PNP, germanium (USSR)* (MP39B). Until now the 20 germanium parts were only reachable through the search or a transistor's Type list.
- **Silicon and Germanium headings in a transistor's Type list**, so the germanium parts no longer hide among the silicon ones. The search finds the silicon ones by "silicon" too.
- A catalog transistor in the parts list (MJE340, AC128 …) shows once in the search, not twice.

## [3.73.0] - 2026-10-18

### Added
- **The version under the name** in the CAD's toolbar (*v3.73.0*; *dev* when run from the source), so a screenshot or a bug report shows which release it came from.

## [3.72.0] - 2026-10-18

### Added
- **Edit ▾ menu and a right-click menu on the sheet.** The right mouse button on a part or wire selects it (unless it already is) and offers Rotate, Mirror, Duplicate, Delete, Copy and Paste; on empty sheet Paste, Select all, Fit, Undo and Redo. Edit ▾ has all of them plus Renumber designations. A right-click while placing or wiring still cancels it. Rotate, Mirror and Delete left the toolbar to make room; they are also in the part's inspector, as before.
- **Checks tab** next to the bill of materials in the panel under the sheet (View ▾ → Checks): the inspector's Checks list, wider, with the number of problems on its tab.
- **The inspector on narrow windows** (900 px and below), where it used to be hidden: a drawer over the right of the sheet that slides in when something is selected and out when the selection is cleared; the toolbar's *Inspector* button shows or hides it.

### Changed
- **Each part's inspector comes from the part library.** Its live readout, its line of text and its panel (the loudspeaker's impedance plot, the scope's Open in buttons) are defined with the part in `cad-components.js`; the inspector shows exactly what it did before.
- **The CAD's bill of materials and its runs for the instrument windows** (power-on transient, Bode) are in their own files, `cad-bom.js` and `cad-analysis.js`.
- **One table of commands in the CAD.** Its keyboard shortcuts, the toolbar and View-menu buttons that do the same and the help's *Keyboard* list now come from one table (`ui-kit.js`), so a new feature is one entry and the help lists every shortcut by itself. The keys are unchanged; the help now has one row per shortcut (Ctrl+Shift+S, Ctrl+O and Esc were in shared rows before).
- **Shared menus and styles.** The CAD and the Board window use one implementation of the toolbar menus (the Board's menu buttons now also tell screen readers whether they are open); the rules every window repeated (buttons, drop-downs, page reset) are in one stylesheet, `ui.css`. Nothing looks different.

## [3.71.1] - 2026-10-18

### Changed
- **BOM Sim. max, worked out when each simulation finishes**, whether the BOM is open or not, and kept until the next one: an edit no longer shows the new part value with the old run's voltages (a resistor changed from 330 to 470 Ω showed 2.59 W, neither run's figure). The BOM's line says when a new simulation is on its way.
- **Sim. max for every kind of part:** loudspeakers (power), chokes (DC current), output transformers (primary DC current, against the rating of a catalog part), power transformers (HT DC current against the rating), pots (power in both halves), diodes (PIV, average and peak current, against the 1N4007 / UF4007 / 1N4148 ratings), tubes (the most-used of their ratings: Pa, Pg2, Ik, Vhk, the rectifier's currents and PIV).

## [3.70.0] - 2026-10-18

### Added
- **∿ Animate** (toolbar): one cycle of the signal, slowed to 3 s, on the schematic. Dots run along each wire with its AC current, reversing each half cycle (brighter: more current); each node's wires turn orange as it swings above its DC level and blue below, so a stage's inversion, the signal current returning through the supply and through bypass capacitors can be seen. Every wire and node is scaled to its own peak. A time line shows the moment in the cycle; the legend explains the marks.
- The simulator records every part's terminal currents at 120 instants over one signal period for it (a capacitor's as C·dV/dt).

## [3.69.0] - 2026-10-18

### Removed
- **The bias finder.** No more violet marking of the parts that set each tube's bias, no *Bias target* / *Measured on the amp* fields on tubes, no "→ 680Ω" values by the parts or *Use …* buttons, and no *View ▾ → Bias markers*: it was more confusing than useful. Circuits saved with bias targets open as before; the targets are ignored. What stays is the check that needs it: whether a tube is cathode or fixed biased, for the largest grid resistor its datasheet allows.

## [3.68.2] - 2026-10-18

### Changed
- **Gubin example takes a phone's line output.** An iPhone's USB-C to 3.5 mm adapter at full volume gives −5.6 dBV (0.525 Vrms); with the 6.2 kΩ feedback resistors that drove the 6P14P's grid past its bias (grid current, then cut-off): 14 % THD, the output no longer a sine. R11 and R12 are now 1.5 kΩ: about 9 dB of feedback instead of 4, gain 3.2 instead of 5.9, 0.07 % THD at −5.6 dBV, clipping (3 % THD) only from −3 dBV, response 6.7 Hz – 150 kHz (1 dB rise at 12 Hz). The generators are set to −5.6 dBV. The board is unchanged.

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
