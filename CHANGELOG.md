# Changelog

All notable changes to this project are documented here.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and the project uses [Semantic Versioning](https://semver.org/).

## [Unreleased]

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
