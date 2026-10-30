/* =============================================================================
   hints.js — what every field, readout and coefficient means, shown on hover.

   One dictionary for all windows (Circuit CAD, instruments, curve tracer, board)
   and for the manual (help.html), so the hover hint and the manual never differ.

   - Hints.parts[type]        a palette part
   - Hints.fields[type.key]   an inspector field of that part (by its field key)
   - Hints.labels[text]       a readout or setting, matched by its label text;
                              "Va (anode–cathode)" also matches as "Va"
   Any element with data-hint gets the tooltip; labels in .kv / .row rows and
   section titles are matched automatically as pages render them.
   Lines in a hint: "\n" breaks; a line starting with "= " is a formula.
   ============================================================================= */
(function (root) {
  "use strict";

  const parts = {
    resistor: "A fixed resistor. Its power rating sets the symbol's marking and the check: the simulated dissipation is compared with it.",
    pot: "A potentiometer: two resistors either side of the wiper. Linear or audio (log) taper. Volume control, bias adjustment, balance.",
    capacitor: "A film or ceramic capacitor: coupling, bypass, tone networks, Miller compensation.",
    electrolytic: "A polarised electrolytic: reservoir and smoothing capacitors, cathode bypass. Set its voltage rating for Checks, or the BOM picks one from the peak voltage it sees.",
    inductor: "A choke or inductor with its winding resistance: a supply filter choke, a plate choke load.",
    switch: "A changeover switch (SPDT). Double-click it on the sheet to flip it. Sections named SA1.1, SA1.2 … flip together as one ganged switch.",
    speaker: "A loudspeaker. Either an ideal resistor, or a real driver from its Thiele–Small parameters, whose impedance rises at resonance and with frequency, as an amplifier really sees it.",
    opt_se: "A single-ended output transformer: impedance ratio, primary inductance (bass), leakage and winding capacitance (treble), winding resistances, and a core that saturates past its rated power at low frequencies. Pick a Hammond or Edcor model, or type your own datasheet values.",
    opt_cat: "A Hammond 125SE single-ended output transformer, modelled from the maker's data: windings, inductance, DCR and rated DC current, with leakage and a core that saturates past the rated power below 100 Hz.",
    opt_pp: "A push-pull output transformer with ultralinear taps on the primary: primary inductance, leakage and winding capacitance, and a core that saturates past its rated power at low frequencies (or with DC out of balance). Pick a Hammond or Edcor model, or type your own datasheet values.",
    ptx: "A generic power transformer with its mains inlet: centre-tapped secondary for a full-wave rectifier.",
    ptx_cat: "A Hammond 300-series power transformer, modelled from the maker's drawings: no-load voltages, winding resistances, magnetising current and ratings.",
    mains: "The AC mains outlet: feeds a power transformer's primary.",
    tube: "A vacuum tube (one section). 110 types: Soviet receiving tubes from the Katsnelson & Larionov handbook and Western tubes from makers' datasheets, with ratings, pinouts and interelectrode capacitances. Your own SPICE models can be imported.",
    diode: "A diode: standard, fast and ultrafast rectifiers (1N400x, 1N540x, UF4007, MUR160, FR107…), Schottky (1N5817…1N5822, BAT85) and SiC Schottky (C3D02060A…), the 1N4148 signal diode. Reverse recovery simulated; Checks compares the peak reverse voltage with VRRM.",
    bridge: "A bridge rectifier: four diodes in one package (DF-M DIP-4, round W-series, inline B250C, GBU and KBU, chassis KBPC). AC in on the ~ pins, DC out on + and −.",
    fuse: "A cartridge fuse (5 × 20 mm, 6.3 × 32 mm or TR5), time-lag or fast-acting, at its cold resistance. Checks warns from 75 % of its rating.",
    ntc: "An inrush current limiter (NTC thermistor): cold it limits the switch-on surge into the reservoir capacitors, warmed by the current its resistance falls to a fraction of an ohm.",
    mov: "A metal oxide varistor across the mains after the fuse: it barely conducts at the mains voltage and clamps surges.",
    jack: "A jack socket: 6.35 mm mono (switched or not) or stereo, 3.5 mm stereo, RCA. Tip +, ring R, sleeve −; the switched jack's SW contact rests on the tip until a plug goes in.",
    iec: "An IEC C14 mains inlet: line, neutral and protective earth, on the chassis.",
    terminal: "A screw terminal block on the board, 2 to 8 ways, 5.08 or 7.5 mm pitch: where wires from the chassis land.",
    header: "A straight 2.54 mm pin header for a plug-on lead.",
    faston: "A board-mounted quick-connect tab (6.3 or 4.8 mm) for one wire.",
    zener: "A zener diode, 3.3 to 200 V: the whole 1 W 1N4728A–1N4764A series and 5 W 1N53xxB, for screen regulators, shunt references, cathode bias.",
    led: "An LED: as a cathode-bias element (≈1.6–3 V, nearly independent of current) or an indicator.",
    npn: "An NPN bipolar transistor (Gummel-Poon model): current sources, followers, drivers, solid-state output stages.",
    pnp: "A PNP bipolar transistor (Gummel-Poon model): current sources on the plate (MPSA92), complementary stages.",
    nmos: "An N-channel MOSFET: source followers after a tube stage, current sources (DN2540, LND150), power output.",
    pmos: "A P-channel MOSFET: complementary output stages, high-side current sources.",
    njf: "An N-channel JFET (SPICE JFET model): low-noise input stages (2SK170, LSK170), phono and mic preamps, boosters (J201), current sources, the lower device of a hybrid cascode.",
    pjf: "A P-channel JFET: the complement of the N-channel types (2SJ74 to the 2SK170), current sources from the positive rail, analogue switches (J175).",
    reg: "A three-terminal voltage regulator: LM317 / LM338 adjustable (1.25 V between OUT and ADJ), LM337 negative, 78xx / 79xx fixed. Error amplifier, current limit, dropout, line regulation and minimum load are modelled: regulated heaters, bias and op-amp rails.",
    tl431: "A TL431 shunt reference: an adjustable zener (2.5–36 V) set by two resistors, or the reference of a regulator. The cathode sinks whatever holds REF at 2.495 V.",
    timer555: "An NE555 timer (DIP-8): astable oscillators, one-shots, LED flashers, PWM. The latch, comparators, output and discharge stages are modelled; the readout gives its frequency and duty cycle.",
    opamp: "An op-amp (LM741, LM301A, LM324, TL071/072/074): a two-stage model with the datasheet's gain, gain-bandwidth, slew rate, output swing and current limit. Wire V+ and V− to the rails; the amplifiers of a dual or quad (DA1.1, DA1.2 …) share one package on the board.",
    vdc: "A DC supply with an internal resistance, positive or negative: B+, a grid-bias supply, a low-voltage rail.",
    rail: "A power rail, the VCC arrow: an ideal DC supply from its pin to ground, without drawing the supply or its ground. Rails and sheet connectors with the same name are one net.",
    spst: "An on–off switch: a toggle that stays where it is put, or a push button that makes (normally open) or breaks (normally closed) while pressed. Double-click it on the sheet to flip or press it.",
    rotary: "A rotary selector, one pole of 2 to 12 ways: an input selector, a tone or bias switch. Double-click it to turn it on a way; sections SA1.1, SA1.2 … turn together as one multi-pole switch.",
    relay: "A relay (Omron G5LE-1 SPDT, G5V-2 DPDT): its coil's resistance and inductance, pulling in at 75 % of the rated voltage and dropping out at 5–10 %. Muting, standby delay, channel switching. Put a diode across the coil.",
    vactrol: "A vactrol (VTL5C3, VTL5C1): an LED shining on a CdS photoresistor. The cell's resistance follows the LED's current, quickly brightening and slowly dimming: tremolo, compressors, soft switching without clicks.",
    pickup: "A guitar pickup as a source: the strings' EMF behind the coil's resistance and inductance, with its own and the cable's capacitance. An amp's input and tone stack see it as a resonant source, peaking at a few kHz.",
    phono: "A phono cartridge playing a record: a tone at its rated output, cut with the RIAA curve (or flat), behind the coil's resistance and inductance. Sweep it with the Bode plotter: a correct RIAA preamp comes out flat.",
    chipamp: "A power amplifier IC: LM386 (a few volts, gain 20–200, headphones and small speakers), TDA2050 (32 W), LM3886 (68 W). The op-amp model with the datasheet's limits; wire it non-inverting with its minimum gain or more.",
    neon: "A neon indicator lamp (NE-2, ИН-3): dark until its striking voltage (about 70–110 V), then it holds about 60 V and glows. It needs a series resistor (330 kΩ on mains); with a capacitor across it, it flashes. Animate lights it orange.",
    eye: "A magic eye (6E5, 6U5): a tuning indicator. The triode's grid closes the shadow on the green target as it goes negative (AGC, a rectified signal). Target and plate (through 1 MΩ) go to about 250 V. Animate opens and closes the eye.",
    gasreg: "A glow-discharge voltage regulator (0A2, 0D3 …): fed through a resistor, it holds its maintaining voltage over its current range. It must see its striking voltage to light, and goes out below a couple of milliamps.",
    itx: "An interstage or input transformer: turns ratio, primary inductance (bass), leakage inductance and winding capacitance (treble), winding resistances, and the DC its core is gapped for.",
    vcvs: "An ideal voltage amplifier (SPICE E): output voltage = gain × control voltage, at any load; the control pins draw nothing.",
    vccs: "An ideal transconductor (SPICE G): current out of the + pin = gm × control voltage, with an output resistance in parallel. With ra as the output resistance it is a tube's small-signal model.",
    isrc: "A constant DC current source with an output resistance: a quick stand-in for a transistor or MOSFET current source as a plate load, a long-tail or cathode current sink.",
    siggen: "A signal generator: sine, square or triangle, with its own output impedance. The Bode plotter drives the circuit from it too.",
    ground: "The 0 V reference. Every circuit needs one.",
    offsheet: "A sheet connector: joins every connector with the same signal name, on this sheet and the others, without drawing the wire.",
    scope: "A two-channel oscilloscope with its probes. Its screen is live on the schematic; double-click for the full instrument, the spectrum analyzer and the Bode plotter.",
    note: "A text note on the drawing.",
    frame: "An ISO 5457 drawing frame with reference grid and an ISO 7200 title block. Locked against moving unless unlocked.",
  };

  const fields = {
    "resistor.r": "Resistance. Type values with SI prefixes: 4.7k, 1M, 220, 0.47.",
    "resistor.w": "The power rating of the part you will buy. Checks compare the simulated dissipation with it; the symbol is marked per ГОСТ 2.728. Rate a resistor at about twice what it dissipates.",
    "pot.r": "End-to-end resistance of the track.",
    "pot.taper": "Linear: resistance proportional to rotation (bias, balance).\nAudio (log): about 10 % at mid-rotation, for volume controls.",
    "pot.pos": "Wiper position, 0 % (counter-clockwise end) to 100 %. With an audio taper the resistance follows the log law.",
    "capacitor.c": "Capacitance: 100n, 22n, 470p, 1u.",
    "electrolytic.c": "Capacitance: 47u, 220u. The BOM shows the simulated peak voltage across it, to choose its voltage rating.",
    "inductor.l": "Inductance in henries. A supply choke is typically 5–20 H; a plate choke 100 H or more.",
    "inductor.dcr": "DC resistance of the winding: it drops voltage and, in a supply filter, dissipates power.",
    "switch.pos": "Which throw is closed: A (upper) or B (lower). Double-click the switch on the sheet to flip it.",
    "speaker.model": "Loudspeaker (Thiele–Small): the real impedance curve, which rises at the bass resonance and with frequency (voice-coil inductance).\nResistor: an ideal, constant load, as on a test bench.",
    "speaker.r": "Nominal impedance: 4, 8 or 16 Ω. As a resistor, the load itself.",
    "speaker.preset": "A typical guitar or hi-fi driver to start from; it fills the Thiele–Small parameters below.",
    "speaker.re": "Re: the DC resistance of the voice coil, usually 0.7–0.85 × the nominal impedance.",
    "speaker.le": "Le: voice-coil inductance. It makes the impedance rise at high frequencies.",
    "speaker.fs": "fs: the free-air resonance of the cone. The impedance peaks here.",
    "speaker.qms": "Qms: mechanical Q, the losses of the suspension. Higher means a taller, narrower impedance peak.",
    "speaker.qes": "Qes: electrical Q, the damping by the motor (magnet and coil). With the amplifier's output impedance it sets how well the cone is controlled at resonance.",
    "opt_se.zp": "Primary impedance: the load the tube sees with the rated speaker on the secondary.\n= Zp = Zs · (Np / Ns)²",
    "opt_se.zs": "Secondary impedance: the speaker impedance the transformer is designed for.",
    "opt_se.lp": "Primary inductance. It sets the bass corner with the tube's plate resistance:\n= f−3dB ≈ (rp ‖ Zp) / (2π · Lp)\nIn single-ended transformers the air gap keeps it lower than in push-pull ones.",
    "opt_se.dcrp": "DC resistance of the primary: drops voltage at the idle current and costs some output power.",
    "opt_se.dcrs": "DC resistance of the secondary: part of the amplifier's output impedance.",
    "opt_se.model": "A real transformer from Hammond's drawings or Edcor's specifications: it fills in the fields below. Values a maker does not publish are worked out from the frequency band and insertion loss (the inspector says which). Change the secondary impedance to use another tap; change anything else and it becomes your own values.",
    "opt_se.llk": "Leakage inductance, referred to the primary (measured with the secondary shorted). In series with the source and the load it sets the treble roll-off:\n= f−3dB ≈ (rp + Zp) / (2π · Llk)",
    "opt_se.cw": "Capacitance across the primary (the windings' own). With the leakage it makes the treble resonance; makers do not publish it, 100–300 pF is typical.",
    "opt_se.idc": "The primary's DC the core's gap is made for. More moves the core towards saturation and Checks warn.",
    "opt_se.pw": "Rated power: with Full power down to it sets where the core saturates (its flux there is 75 % of the knee, the rated DC included). 0: a linear core that never saturates.",
    "opt_se.flo": "The lowest frequency at which the transformer passes its rated power. Below it the power it can pass falls with the square of the frequency before the core saturates.",
    "opt_cat.model": "The Hammond 125SE model: each has its own primary impedance, rated DC current and power.",
    "opt_cat.tap": "Which secondary wire carries the speaker. The same tap gives different primary impedances for different speakers: a 4 Ω speaker on the 8 Ω tap halves the primary impedance.",
    "opt_pp.zaa": "Plate-to-plate impedance: the load across the whole primary in class A. In class B each tube sees a quarter of it.",
    "opt_pp.zs": "Secondary impedance: the speaker impedance the transformer is designed for.",
    "opt_pp.lp": "Primary inductance of the whole winding: sets the bass corner.",
    "opt_pp.tap": "Ultralinear tap, as a percentage of each half-primary's turns from the B+ end. Connect it to the screens: about 40 % (KT88, EL34) or 20–25 % gives most of the pentode's power with nearly a triode's distortion and output impedance.",
    "opt_pp.dcrp": "DC resistance of each half of the primary.",
    "opt_pp.dcrs": "DC resistance of the secondary.",
    "opt_pp.model": "A real transformer from Hammond's drawings or Edcor's specifications: it fills in the fields below. Values a maker does not publish are worked out from the frequency band and insertion loss (the inspector says which). Change the secondary impedance to use another tap; change anything else and it becomes your own values.",
    "opt_pp.llk": "Leakage inductance of the whole primary, plate to plate, with the secondary shorted; half of it in each half. It sets the treble roll-off:\n= f−3dB ≈ (Rsource + Zaa) / (2π · Llk)\nIn class B only one half works, with half the leakage.",
    "opt_pp.cw": "Capacitance between the plates (the windings' own). With the leakage it makes the treble resonance; makers do not publish it, 200–500 pF is typical.",
    "opt_pp.pw": "Rated power: with Full power down to it sets where the core saturates (its flux there is 75 % of the knee). 0: a linear core that never saturates. An ungapped push-pull core has no room for DC: a few mA out of balance between the halves takes much of it.",
    "opt_pp.flo": "The lowest frequency at which the transformer passes its rated power. Below it the power it can pass falls with the square of the frequency before the core saturates.",
    "ptx.vrms": "No-load secondary voltage of each half, in Vrms. A full-wave rectifier with a capacitor input gives about 1.3–1.4 × this at light load.",
    "ptx.freq": "Mains frequency. Ripple is at twice it after a full-wave rectifier.",
    "ptx.rw": "Resistance of each secondary half (and the primary referred to it): why the DC sags as the load draws more.",
    "ptx_cat.model": "The Hammond 300-series model, with its secondaries, ratings and no-load voltages from the maker's drawing.",
    "ptx_cat.tap": "The mains primary tap in use: a higher tap gives lower secondary voltages.",
    "ptx_cat.bias": "Show the bias tap pin (about 50 V) for a negative bias supply.",
    "mains.vrms": "Mains voltage, Vrms: 230 V in Europe, 120 V in North America. Change it to see how the amplifier copes with high or low mains.",
    "mains.freq": "50 Hz or 60 Hz.",
    "mains.rs": "Source resistance of the mains wiring.",
    "tube.tube": "The tube type. Ratings, pinout, heater and interelectrode capacitances come with it.",
    "tube.connection": "Pentode / beam: plate, control grid, screen, cathode.\nTriode-connected: the screen tied to the plate (through its stopper), giving lower gain, lower rp and lower distortion. Uses a separate fit that agrees with the pentode model.",
    "tube.heaterV": "The DC potential of the heater winding against ground. 0 for a grounded heater. Raise it (to, say, a quarter of B+) when a cathode sits high above ground, as in a cathode follower or a cascode, so the heater-to-cathode voltage (Vhk) stays within its rating.",
    "diode.model": "Standard rectifiers (1N400x, 1N540x) recover slowly (a few µs): the snap at each conduction end can ring in the transformer. Fast and ultrafast ones (FR107, UF4007, MUR160, HER108) recover in 50–500 ns, Schottky and SiC ones not at all (SiC up to 1200 V). 1N4148: small signal diode.",
    "bridge.model": "The bridge's package and ratings: VRRM of each diode, the average output current. A KBPC is chassis-mounted and wired by its tabs; a GBU or KBU above a few amperes wants a heatsink.",
    "fuse.a": "The fuse's current rating. Run it at 75 % or less of this in normal use, or it ages and blows; the rms current, not the average, heats it.",
    "fuse.speed": "Time-lag (T) rides through the switch-on surge of a transformer and reservoir capacitors: the usual mains fuse. Fast-acting (F) for HT lines and outputs.",
    "fuse.size": "The cartridge: 5 × 20 mm (the common one), 6.3 × 32 mm (US, larger currents) or the TR5 subminiature on the board. The footprint follows it.",
    "ntc.model": "Ametherm SL series: cold resistance and the largest steady current. Pick one whose current your supply nearly reaches: then it runs hot (a fraction of an ohm) and wastes little.",
    "mov.model": "TDK SIOV: the K275 types for 230 V mains, K150 for 120 V, K385 with margin. The bigger the disc, the bigger the surge it takes.",
    "jack.kind": "TS-SW: mono with a switch on the tip (a guitar input: the SW contact grounds the open input). TS: mono. TRS: stereo (headphones). RCA: a phono socket.",
    "jack.plug": "With no plug the tip rests on SW; a plug lifts it. Double-click the jack on the sheet to plug in or pull out.",
    "terminal.ways": "How many wires it takes.",
    "terminal.pitch": "5.08 mm for signal and supply wiring; 7.5 mm, with more creepage, for mains and HT.",
    "header.ways": "Pins in the row.",
    "faston.size": "6.3 mm (0.250\") for mains and heater current, 4.8 mm (0.187\") for lighter wires.",
    "capacitor.v": "The capacitor's voltage rating. Checks warns once the peak voltage across it passes 80 % of it. Left unset, the BOM picks one from the simulated peak.",
    "electrolytic.v": "The capacitor's voltage rating. Checks warns once the peak voltage across it passes 80 % of it, and when it sits the wrong way round. Left unset, the BOM picks one from the simulated peak.",
    "zener.model": "Zener voltage and power rating (1 W or 5 W). The check compares the dissipation with it.",
    "led.color": "Each colour has a different forward voltage: red ≈ 1.8 V, yellow ≈ 2 V, green ≈ 2.1 V, blue ≈ 3 V. As cathode bias it acts like a low-noise battery.",
    "npn.model": "The transistor type, with its own gain (hFE), Early voltage, capacitances and ratings (Vceo, Ic, Ptot).",
    "pnp.model": "The transistor type, with its own gain (hFE), Early voltage, capacitances and ratings (Vceo, Ic, Ptot).",
    "nmos.model": "The MOSFET type: threshold voltage, transconductance, capacitances and ratings. DN2540 and LND150 are depletion types, conducting at 0 V gate–source: one resistor makes a current source.",
    "pmos.model": "The MOSFET type: threshold voltage, transconductance, capacitances and ratings.",
    "opamp.model": "The op-amp type. TL07x: JFET inputs, 3 MHz, 13 V/µs, for audio. LM741: the classic, 1 MHz, 0.5 V/µs. LM301A: a 741 that takes its compensation capacitor between pins 1 and 8. LM324: four amplifiers on a single supply, inputs and output down to V−. Single, dual or quad sets the package.",
    "vdc.pol": "Positive: the + pin is the rail and the - pin goes to ground (B+, a screen or low-voltage rail). Negative: the symbol turns round, and the pin by its + mark goes to ground while the other is the rail (fixed grid bias, a negative supply).",
    "vdc.v": "Supply voltage, its size; Polarity sets its sign. Typing a minus sign also makes it negative.",
    "vdc.rs": "Internal resistance: the supply's sag under load. 0 is an ideal regulated supply.",
    "njf.model": "The JFET type: IDSS (the current at 0 V gate–source), the pinch-off Vgs(off), capacitances and ratings. Real parts spread several times either way, so leave room in the bias.",
    "pjf.model": "The JFET type: IDSS, the pinch-off Vgs(off) (positive for P-channel), capacitances and ratings.",
    "reg.model": "The regulator type. Adjustable (LM317, LM338, LM337): set by R1 from OUT to ADJ and R2 from ADJ to ground. Fixed (78xx, 79xx): ground pin to ground. The 'L' types are the 100 mA TO-92 parts.",
    "tl431.model": "The shunt reference type. TL431: 2.495 V reference, cathode up to 36 V, 1–100 mA.",
    "timer555.model": "The timer type. NE555: the bipolar original, 4.5–16 V; its output rises only to about VCC − 1.4 V.",
    "rail.name": "The rail's name (VCC, +12V, B+). Every rail and sheet connector with this name is one net, on any sheet.",
    "rail.v": "The rail's voltage against ground, negative for a negative rail (VEE, bias). Rails with one name should have one voltage; Checks reports a mismatch.",
    "rail.shown": "Text shown next to the arrow instead of the voltage, such as \"5V to 9V\" for a circuit that runs on a range. Empty shows the voltage. The simulation uses Voltage.",
    "spst.kind": "Toggle: stays on or off. Push button, normally open: closes only while pressed (a mute, a reset). Normally closed: opens while pressed.",
    "spst.pos": "On or off for a toggle; pressed or released for a push button. Double-click the switch on the sheet to change it.",
    "rotary.ways": "The number of positions (ways) of this pole, 2 to 12.",
    "rotary.pos": "The way the wiper is on: the common C is joined to this pin only. Double-click the switch on the sheet to turn it on.",
    "relay.model": "The relay: G5LE-1, a sugar-cube power relay (SPDT, 10 A) for mains, standby and speaker muting; G5V-2, a small DPDT signal relay for input and channel switching.",
    "relay.v": "The coil's rated voltage. It pulls in from 75 % of it, and drops out below 10 % (G5LE-1) or 5 % (G5V-2); Checks warns outside that.",
    "vactrol.model": "The vactrol: VTL5C3, the tremolo classic (1 kΩ at 10 mA, 10 MΩ dark); VTL5C1, lower on-resistance and darker off (50 MΩ), for switching. Turn-on 2.5 ms, turn-off 35 ms to 100 kΩ.",
    "pickup.preset": "Typical values of each kind of pickup, to start from: measure yours (DC resistance with a meter, inductance with an LCR meter) and type them over.",
    "pickup.r": "The coil's DC resistance, as a meter reads it across the pickup's leads.",
    "pickup.l": "The coil's inductance (2–3 H a single coil, 4–8 H a humbucker): with the capacitance it sets the resonant peak.\n= f ≈ 1 / (2π · √(L · C))",
    "pickup.c": "The coil's own capacitance between its turns, about 100–200 pF.",
    "pickup.cable": "The guitar cable's capacitance across the pickup: more cable, a lower and duller peak.",
    "pickup.amp": "The peak EMF the strings induce: about 100–200 mV for a single coil, up to 1 V for a hot humbucker played hard.",
    "phono.preset": "Typical values for each kind of cartridge, to start from: type your cartridge's datasheet values over them.",
    "phono.mv": "The rated output, rms at 1 kHz and 5 cm/s: about 5 mV a moving magnet, 0.2–0.5 mV a low-output moving coil.",
    "phono.r": "The coil's DC resistance: about 1 kΩ a moving magnet, 5–40 Ω a moving coil.",
    "phono.l": "The coil's inductance: a moving magnet's 0.5 H works with the load's capacitance to set its treble; a moving coil's tens of µH do not count at audio.",
    "phono.cable": "The tonearm cable's capacitance: part of a moving magnet's load (100–300 pF in all, with the preamp's input).",
    "phono.record": "A record: the tone cut with the RIAA curve, so that a correct RIAA preamp plays it flat. Flat: the cartridge's level at every frequency, to measure the preamp's own curve.",
    "phono.freq": "The tone's frequency. The Bode plotter sweeps it whatever is set here.",
    "chipamp.model": "The chip: LM386 (DIP-8, 4–12 V, gain set by pins 1 and 8), TDA2050 (Pentawatt, ±4.5–±25 V, gain ≥ 16), LM3886 (TO-220-11, ±10–±42 V, gain ≥ 10, mute pin to V−).",
    "neon.model": "The lamp: NE-2 (standard, 0.5 mA), NE-2H (bright, 1.9 mA), ИН-3. Each strikes at its striking voltage and then holds about 60 V.",
    "eye.model": "The tube: 6E5 and 6Е5С (sharp cutoff, the shadow shut at −8 V), 6U5 (remote cutoff, shut at −22 V: a wider range of signal).",
    "gasreg.model": "The regulator: its maintaining voltage, its current range and its base (B7G miniature or octal). Choose the series resistor for the middle of the range at the normal load.",
    "itx.preset": "Typical values for each use, to start from: then type your transformer's datasheet values over them.",
    "itx.ratio": "Secondary turns per primary turn: 2 for a 1:2 step-up. The voltage rises n times, the impedance n² times.",
    "itx.ct": "A centre-tapped secondary (pin SC) drives the two grids of a push-pull pair in antiphase.",
    "itx.lp": "Primary inductance. The bass corner is where its reactance meets the source:\n= f−3dB ≈ (rp ‖ R reflected) / (2π · Lp)\nA gapped core (DC in the primary) has far less than an ungapped one.",
    "itx.llk": "Leakage inductance, referred to the primary: with the secondary's capacitance it sets the treble resonance.\n= f ≈ 1 / (2π · √(Llk · Cs · n²))",
    "itx.cs": "Capacitance across the secondary (the winding's own, plus the load's and the grid's Miller capacitance). Seen at the primary it is n² times larger.",
    "itx.dcrp": "DC resistance of the primary.",
    "itx.dcrs": "DC resistance of the secondary.",
    "itx.idc": "The primary's DC the core is gapped for. 0: ungapped (an input transformer, a push-pull or parafeed interstage): Checks warn at any DC.",
    "vcvs.gain": "Output volts per control volt. Negative inverts. Type it with SI prefixes: 100, 1k, -10.",
    "vccs.gm": "Output amperes per control volt (siemens): 1.6m for a 12AX7's gm, 5m for a 12AU7's … Type it with SI prefixes.",
    "vccs.rout": "Resistance in parallel with the output: a tube's plate resistance ra (62.5k for a 12AX7), or a large value for an ideal source.",
    "isrc.i": "The current it forces, from the - pin to the + pin. Type it with SI prefixes: 10m, 2.5m, 500u.",
    "isrc.rout": "Output resistance in parallel with the ideal source: 1–10 MΩ for a cascoded transistor source, about 100 kΩ for a single transistor. Lower values let the current change with the voltage across it.",
    "pickup.wave": "Sine to see the pickup's frequency response and the amp's gain; square or triangle for a richer test tone.",
    "pickup.freq": "The note: 82 Hz the low E string, 110 Hz the A, 330 Hz the high E. The simulation follows it.",
    "siggen.wave": "Sine for gain, distortion and frequency response; square to see slew, ringing and tilt; triangle for clipping onset.",
    "siggen.freq": "Signal frequency. The simulation window is a whole number of its periods.",
    "siggen.amp": "Level, in whichever unit is easier: Vpk (peak), Vrms (= Vpk / √2 for a sine) or dBV (0 dBV = 1 Vrms). The three fields are the same setting.",
    "siggen.offset": "A DC offset added to the signal.",
    "siggen.phase": "Starting phase. Two generators at 0° and 180° drive a push-pull stage without a phase splitter.",
    "siggen.rs": "Output impedance of the generator: 50 or 600 Ω for a lab generator, about 10–50 kΩ for a guitar pickup. Together with the stage's input (Miller) capacitance it sets the treble corner.",
    "note.text": "The note's text, shown on the sheet and in exports.",
    "note.size": "Letter height, per ISO 3098.",
    "frame.locked": "A locked frame cannot be dragged or deleted by accident.",
    "frame.size": "Sheet format (ISO 216).",
    "frame.orient": "Landscape or portrait.",
    "offsheet.name": "Every connector with this name is the same net. Five or more with one name read as a supply rail (B+, bias).",
    "scope.ch1": "Volts per division on CH1. Auto picks a round value that shows the whole signal.",
    "scope.ch2": "Volts per division on CH2. Auto picks a round value that shows the whole signal.",
    "scope.coupling1": "DC shows the full voltage, including the DC level of a plate. AC removes the DC average, to see a small signal riding on a high voltage.",
    "scope.coupling2": "DC shows the full voltage, including the DC level of a plate. AC removes the DC average, to see a small signal riding on a high voltage.",
    "scope.probe": "The probe's load on the circuit, like a real probe: 10× is 10 MΩ, 1× is 1 MΩ. A 1× probe on a high-impedance grid circuit changes what you measure.",
    "scope.time": "Time per division. Auto shows two cycles of the signal.",
  };

  const labels = {
    // --- tube operating point (inspector, curve tracer) ---
    "Va (anode–cathode)": "Plate voltage: anode to cathode, at idle (DC).",
    "Va (plate–cathode)": "Plate voltage: anode to cathode, at idle (DC).",
    "Vg1k (bias)": "Grid bias: control grid to cathode, DC. Negative in normal operation; how negative sets the idle current.",
    "Vg2k (screen)": "Screen voltage: screen grid to cathode. Its rating (Vg2 max) is often lower than the plate's.",
    "Vg2 (screen)": "Screen voltage used for these curves.",
    "Ia (anode current)": "Idle anode (plate) current, DC.",
    "Ia": "Anode current at the operating point.",
    "Ig2 (screen current)": "Screen current. It rises sharply when the plate swings below the screen voltage (in the knee).",
    "Ig2": "Screen current at the operating point.",
    "Pa (dissipation)": "Anode dissipation, averaged over the signal cycle: the heat on the plate. Keep it under Pa max; 70 % is a common design target for long life.",
    "Pa (DC)": "Idle anode dissipation: Va × Ia.",
    "Pg2 (screen dissipation)": "Screen dissipation, averaged over the signal cycle. Screens are thin wires: exceeding Pg2 max glows them and ruins the tube quickly.",
    "Ik (cathode current)": "Cathode current: anode + screen + grid current. Rated because the cathode can only emit so much.",
    "Vhk (cathode above heater)": "Heater-to-cathode voltage, cathode positive, at its worst instant. The thin insulation between heater and cathode breaks down above the rating. Raise the heater's DC potential (the tube's Heater DC potential field) to cut it.",
    "Vhk (heater above cathode)": "Heater-to-cathode voltage, heater positive, at its worst instant. Usually a lower rating than cathode-positive.",
    "Grid circuit R (cathode bias)": "Total DC resistance from grid to ground (stopper + leak + pot). Too high and gas or grid emission current shifts the bias positive: the tube runs away as it warms. Cathode bias allows more than fixed bias because it self-corrects.",
    "Grid circuit R (fixed bias)": "Total DC resistance from grid to the bias supply. Fixed bias has no self-correction, so the datasheet's limit is lower than with cathode bias.",
    "Rectified current": "DC output current of the rectifier tube, against its rating for this capacitor input.",
    "Peak inverse voltage": "The highest reverse voltage across the rectifier in a cycle, against its PIV rating.",
    "Plate swing": "Peak-to-peak AC voltage at the plate with the signal on.",
    "Grid swing": "Peak-to-peak AC voltage between grid and cathode with the signal on.",
    "Plate/grid gain": "Plate swing ÷ grid swing: the stage's voltage gain from its own grid (not counting the input network or feedback).",
    "Plate / grid gain": "Plate swing ÷ grid swing: the stage's voltage gain from its own grid.",
    "THD at plate": "Total harmonic distortion of the plate voltage: the rms sum of harmonics 2–10 over the fundamental.\n= THD = √(H2² + H3² + … ) / H1",
    "Average Pa": "Anode dissipation averaged over a signal cycle. In class A it falls as output power rises; in class AB it rises.",
    "Anode temperature": "The anode's temperature from its (average) dissipation, cooled by radiation: about 400 °C at the rated Pa. From about twice the rating it glows red (red-plating) and fails within hours.",
    "Shadow": "A magic eye's shadow angle: 90° with its grid at the cathode, closing as the grid goes negative.",
    "Target": "The magic eye's target (the green screen) over its cathode: about 250 V.",
    "Triode plate": "The magic eye triode's plate over its cathode; inside it is also the ray-control electrode, which casts the shadow the lower it sits below the target.",
    "Anode 1 current": "Current in the first anode of the rectifier.",
    "Anode 2 current": "Current in the second anode of the rectifier.",
    "Tubes (anode + screen)": "Total anode and screen dissipation of every tube in the circuit.",
    "Output (speakers)": "Average power into the speakers: the mean of voltage × current over the signal cycle.",
    "Output power": "Average power into this load.",
    "From DC supplies": "Power taken from the DC supplies.",
    "Transistors": "Total dissipation of the transistors.",
    "Op-amps": "Total dissipation of the op-amps: their supply current times the supply, plus what the outputs drive.",
    "Resistors": "Total dissipation of the resistors.",
    "Parts · wires · nets": "Parts, wire segments and electrical nets in the circuit.",
    // passive readouts
    "Voltage": "Voltage across the part.",
    "Voltage (DC)": "DC voltage across the part.",
    "Voltage (A–K)": "Voltage from anode to cathode of the diode.",
    "Current (A→K)": "Forward current through the diode.",
    "Current (DC)": "DC current through the part.",
    "DC current": "DC current through the part.",
    "Current supplied": "Current the supply delivers into the circuit.",
    "Voltage across (+ to -)": "The current source's + pin against its - pin. Negative in normal use (current flows downhill through it); a real transistor source needs some volts across it to work.",
    "DC drop": "DC voltage lost across the part's winding resistance.",
    "DC voltage across": "DC voltage between the part's terminals: what a capacitor must be rated for, plus the signal peaks.",
    "Dissipation": "Average power turned into heat in the part, against its rating.",
    "Supply (V+ − V−)": "The op-amp's total supply: ±15 V is 30 V. It must stay under the type's maximum (32 or 36 V) and above a few volts.",
    "Output (DC)": "The op-amp's output with no signal. Marked when it sits at one of its limits.",
    "IN+ − IN−": "The voltage between the inputs. With negative feedback working it is microvolts (the offset from bias currents aside); volts mean the loop is open or the output is at a limit.",
    "Output swing": "The output's lowest and highest voltage over the capture. Marked when it reaches the limit the supply allows: the amplifier clips.",
    "Power": "Average power in the part.",
    "Power (avg)": "Average power in the part over the signal cycle, against its rating.",
    "Wiper DC": "DC voltage at the wiper.",
    "Wiper position": "Wiper position, 0–100 % of the travel.",
    "Primary DC current": "DC current in the output transformer's primary. A single-ended transformer's air gap is sized for a rated current; above it the core saturates and the bass collapses.",
    "Secondary": "Voltage and current on the secondary.",
    "hFE (Ic/Ib)": "DC current gain of the transistor at this operating point.",
    "Ib": "Base current.",
    "Supply (VCC–GND)": "The 555's supply, pin 8 against pin 1: 4.5 to 16 V for an NE555.",
    "Output frequency": "The output's frequency over the simulated window (from its mid-level crossings, the first cycle left out).",
    "Duty cycle (high)": "The share of each cycle the output spends high.",
    "Output": "The 555's output (pin 3) at rest: high or low, and its voltage.",
    "Output current": "Current out of the output pin into the load (negative: sunk into the pin). An op-amp's is checked against its short-circuit limit; a 555's output sags well below its rail above 100 mA.",
    // curve tracer: ratings
    "Va max": "Maximum plate voltage at idle (design-centre or absolute, as the datasheet gives it).",
    "Pa max": "Maximum anode dissipation. The red hyperbola on the curves: Ia = Pa max / Va.",
    "Pg2 max": "Maximum screen dissipation.",
    "Vg2 max": "Maximum screen voltage.",
    "Ik max": "Maximum cathode current.",
    "Vhk max": "Maximum heater-to-cathode voltage.",
    "Rg max": "Maximum grid circuit resistance: cathode bias / fixed bias.",
    "Heater": "Heater voltage and current. Not simulated: the cathode is always hot.",
    "Pins": "Socket pin numbers of each electrode.",
    "Socket and ratings like": "An imported SPICE model takes its socket, pinout and heater from this tube.",
    "Subcircuit": "The .SUBCKT name of the imported SPICE model.",
    // curve tracer: Koren model coefficients
    "µ": "Amplification factor µ: how many volts of plate voltage one volt on the grid is worth.\n= µ = gm · rp\n12AX7 ≈ 100, 12AU7 ≈ 17, 300B ≈ 3.9.",
    "µ (estimated)": "Amplification factor, estimated from the curves.",
    "µ (g1–g2)": "For a pentode: how many volts of screen voltage one volt on the control grid is worth (Koren's µ in the space-charge term).",
    "kg1": "Koren kg1: scales the current. Larger kg1, smaller current at the same voltages.\n= Ia = 2 · E1^x / kg1",
    "kp": "Koren kp: shapes the curves at strongly negative grid, where they bend over (the remote cut-off region).\n= E1 = (Va / kp) · ln(1 + exp(kp · (1/µ + Vg / √(kvb + Va²))))",
    "kvb": "Koren kvb: shapes the curves at low plate voltage (the triode's knee near the origin).",
    "x": "Koren x: the exponent of the space-charge law. Ideally 1.5 (Child–Langmuir); real tubes fit 1.2–1.5.",
    "kg2": "Pentode screen-current scale: larger kg2, smaller screen current.\n= Ig2 = (Vg + Vg2/µ)^x / kg2",
    "knee vk": "Pentode knee voltage: below about this plate voltage the plate current falls away and the screen takes it.\n= Ia = Is · tanh(Va / vk) · (1 + Va / λ)",
    "slope λ": "Pentode slope voltage: how much the plate current still rises with plate voltage above the knee. Sets the pentode's plate resistance: larger λ, flatter curves, higher rp.",
    "screen share ks": "Share of the space current the screen takes when the plate swings into the knee: why screen current, and screen dissipation, rise at full drive.",
    "Screen voltage for curves": "Pentode plate curves depend on the screen voltage: they are drawn at this one.",
    "gm": "Transconductance: change of the output current (plate, collector or drain) per volt on the grid, base or gate, at constant output voltage.",
    "rp": "Plate resistance: change of plate voltage per mA of plate current, at constant grid.",
    "Load line": "The simulated load line: the plate voltage and current over the last whole signal cycle. An ellipse means a reactive load (speaker, transformer).",
    "Bias curve": "The plate curve at the circuit's own grid bias.",
    "70% Pa": "Dashed: 70 % of Pa max, a common limit for long tube life.",
    // curve tracer: transistors (a PNP's or P-channel part's names carry a minus: the same hints)
    "VCE": "Collector–emitter voltage at the operating point (DC).",
    "IC": "Collector current at the operating point (DC).",
    "IB": "Base current at the operating point (DC): the curve tracer's output curves are drawn per base current.",
    "VBE": "Base–emitter voltage at the pins, DC: about 0.6–0.7 V for silicon, 0.15–0.3 V for germanium, falling about 2 mV per °C.",
    "VDS": "Drain–source voltage at the operating point (DC).",
    "ID": "Drain current at the operating point (DC).",
    "VGS": "Gate–source voltage at the operating point (DC): the output curves are drawn per gate voltage.",
    "hFE (IC / IB)": "Static current gain at the operating point: collector current ÷ base current. It varies several times between samples of one type.",
    "ro": "Output resistance: change of collector voltage per change of collector current at a fixed base current (the Early effect).\n= ro ≈ (VAF + VCE) / IC",
    "rds": "Drain resistance: change of drain voltage per change of drain current at a fixed gate voltage.\n= rds ≈ 1 / (λ · ID)",
    "Pd (DC)": "Idle dissipation: VCE × IC (VDS × ID), against Ptot.",
    "Pd max": "The power rating Ptot: VCE × IC = Ptot. Power parts are rated with the case at 25 °C; on a real heatsink they take less.",
    "70% Pd": "Dashed: 70 % of Ptot, a comfortable limit: the junction stays cooler and the part lasts.",
    "Average Pd": "Dissipation averaged over the signal cycle.",
    "Curves": "How many output curves to draw.",
    "IB step": "The base current between two output curves. Blank: chosen so the top curve reaches the current the part is meant for (in a circuit, round the operating point).",
    "VGS step": "The gate voltage between two output curves. Blank: automatic.",
    "VCE max": "The voltage axis of the output curves. Blank: from the part's ratings, or round the operating point in a circuit.",
    "VDS max": "The voltage axis of the output curves, or the part's drain–source rating. Blank: automatic.",
    "VCE for IC–VBE, hFE": "The collector voltage the transfer and gain curves are drawn at. Blank: the operating point's, or 5 V.",
    "VDS for ID–VGS, gm": "The drain voltage the transfer and transconductance curves are drawn at. Blank: the operating point's, or 10 V.",
    "Temperature": "Junction temperature of the part. The model scales IS, BF and BR as SPICE does; a germanium part's leakage doubles every 10 °C.",
    "VCEO": "Maximum collector–emitter voltage with the base open.",
    "IC max": "Maximum continuous collector current.",
    "ID max": "Maximum continuous drain current.",
    "IG max": "Maximum forward gate current of the JFET.",
    "V(BR)GSS": "Gate–source breakdown voltage of the JFET.",
    "Ptot": "Total power rating at 25 °C (case for power parts, free air for small ones).",
    "Package": "The transistor's case; the pin order is the maker's drawing.",
    "IS": "Gummel-Poon saturation current: sets VBE at a given current. Fitted to the datasheet's typical VBE curve.",
    "BF": "Forward current gain of the model (the ideal hFE before the high-current fall-off).",
    "BR": "Reverse current gain of the model.",
    "VAF (Early)": "Early voltage: how much the collector current rises with VCE at a fixed base current; the slope of the output curves.",
    "IKF": "High-injection knee current: above it hFE falls.",
    "RB": "Base spreading resistance of the model.",
    "RE": "Emitter resistance of the model.",
    "IDSS (model)": "Drain current at VGS = 0 (the JFET's zero-gate current). Real samples spread several times.",
    "VGS(off)": "Gate voltage at which the JFET's channel closes (pinch-off).",
    "VTO (threshold)": "Gate threshold: the MOSFET starts to conduct above it (square-law model).",
    "VTO (depletion)": "A depletion MOSFET conducts at VGS = 0; this is the gate voltage that turns it off.",
    "VTO (pinch-off)": "The JFET's pinch-off voltage in the SPICE model.",
    "KP": "Square-law gain of the MOSFET.\n= ID = KP / 2 · (VGS − VTO)² in saturation",
    "BETA": "SPICE JFET gain.\n= IDSS = BETA · VTO²",
    "λ": "Channel-length modulation: how much the drain current rises with VDS.",
    // oscilloscope
    "Volts/div": "Vertical scale of the channel. Auto picks a round value. Ctrl+wheel on the screen zooms it.",
    "Coupling": "DC: the full voltage. AC: the DC average removed, to see a small signal on a high DC level.",
    "Time/div": "Horizontal scale. Auto shows two cycles. The wheel on the screen zooms it.",
    "Trigger source": "The channel whose edge starts the sweep, so a repeating signal stands still.",
    "Slope": "Trigger on the rising or the falling edge.",
    "Duration": "How long after switch-on the power-on run simulates.",
    "Analysis": "Steady state: the settled circuit, one window repeated as a triggered scope shows it.\nPower-on: the first moments after switch-on, capacitors empty, every source switched on at t = 0.",
    "Display": "Which channels show, and how.",
    "Scope part": "Which oscilloscope part in the circuit this window reads (a circuit can have several).",
    // spectrum
    "Span": "Frequency range shown. Auto: up to the 10th harmonic.",
    "Units": "dBc: relative to the fundamental (harmonics read directly as distortion).\ndBV: absolute, 0 dBV = 1 Vrms.",
    "Frequency axis": "Linear, or logarithmic so mains ripple (50/100 Hz) and audio harmonics read in one view.",
    "Scale": "Decibels per vertical division.",
    "Input": "Which scope channel the analyzer reads.",
    "Harmonic distortion": "Each harmonic's frequency and level, and the THD. The FFT covers a whole number of cycles, so there is no windowing error.",
    "Other components": "Anything that is not a harmonic: mains hum, its harmonics, intermodulation products.",
    "Harmonic": "Harmonic number: H2 is twice the signal frequency. Even harmonics come from asymmetry (single-ended stages), odd ones from symmetrical clipping (push-pull).",
    "Freq": "Frequency of the component.",
    "Level": "Level of the component, in the chosen unit.",
    // Bode
    "Traces": "CH1, CH2, or CH2 ÷ CH1: the gain between the probes, one stage of a chain.",
    "Gain": "dB re the generator: the gain from the generator's EMF.\ndB re 1 kHz: normalised so 1 kHz reads 0 dB, to read the shape of the response.",
    "Range": "Frequency range of the plot. The sweep itself always covers 1 Hz – 1 MHz.",
    "Phase": "Show the phase (dashed) under the magnitude. An inverting stage starts at ±180°.",
    "Generator": "The signal generator that drives the sweep; other generators are switched off.",
    "Response": "Gain and phase at 1 kHz, the −3 dB points either side, the level at 20 Hz and 20 kHz, and any peak above the 1 kHz gain.",
    "How it is computed": "Small-signal (AC) analysis: every part linearised at the idle operating point, then the complex circuit equations solved at 40 frequencies per decade.",
    // board
    "Signal and power": "Minimum gap between copper of different nets (signal and power classes).",
    "High voltage": "Minimum gap around high-voltage nets (above the HV threshold). The clearance by voltage (IPC-2221B) can ask more: on a bare outer layer 1.25 mm up to 300 V and 2.5 mm up to 500 V.",
    "By voltage": "Clearance from the voltage between the two nets, per IPC-2221B table 6-1, on top of the class clearances. The voltage is the worst case of the simulated DC levels and swings; an output transformer's anode end counts at twice its DC level (full drive).\n= B2 bare board: 0.6 mm to 150 V, 1.25 mm to 300 V, 2.5 mm to 500 V, +0.005 mm/V above\n- B4: under a permanent polymer coating\n- A6: assembly with conformal coating\n- Off: the class clearances only",
    "Wire the heaters on the board": "Give every indirectly heated valve its heater pins on heater nets (HTR6.3_A / HTR6.3_B per heater voltage), fed from a heater-supply connector XH1 that carries the sum of the heater currents; the track-width check then sizes the heater tracks. A heater joined to its cathode (GZ34) gets a winding of its own. Off: the heaters are wired by hand off the board.",
    "Internal shields to GND": "Connect a valve's internal shield pin (6N23P pin 9, 6S45P …) to GND on the board.",
    "12AX7-type heaters": "Valves with a centre-tapped heater (12AX7, 12AU7, 12AT7): 6.3 V with pins 4 and 5 joined against pin 9 (twice the current), or 12.6 V from pin 4 to pin 5.",
    "Grid stopper to its pin, max": "A grid stopper (the only resistor on a grid net) further than this from its grid pin is reported: the track before the stopper is an antenna, and a stopper away from the socket can let the stage oscillate.",
    "Grid alongside anode / heater, max": "A grid track that runs alongside an anode or heater track for longer than this, closer than the distance below, is reported: anode to grid coupling makes a stage oscillate, heater to grid coupling makes it hum.",
    "… when closer than": "Grid and anode or heater tracks closer than this (edge to edge, either side of the board) count as running alongside.",
    "Electrolytic to hot parts, min": "An electrolytic closer than this (courtyard to courtyard) to a power valve, a rectifier or a hot resistor is reported: an electrolytic's life halves for every 10 °C.",
    "A resistor is hot from": "Resistors dissipating at least this much (from the simulation) count as hot parts for the electrolytic check.",
    "Socket to a mounting hole, max": "A board-mounted valve socket with no mounting hole this close is reported: pulling a valve flexes the board and cracks the joints.",
    "Ground scheme": "Free: GND is one net, routed any way (a ground plane is fine).\nStar point: a star terminal XG1 joins every ground return, and nothing else may:\n- Supply: sources, rectifiers, reservoir and filter capacitors\n- Output: power valves, output transformer secondary, speaker\n- Input: the input jack\n- each small-signal stage (VL1 …): its cathode resistor, bypass and grid leak\nThe ratsnest runs each return to XG1 on its own, and copper that joins two returns elsewhere is reported. A part's inspector can move it to another return.",
    "Teardrops at pads and vias": "Copper widens from a track into its pad or via over about a pad's length, so the joint survives drilling slop, soldering heat and a heavy part's leverage. One is left out where it would break a clearance.",
    "Ground return": "Which ground return this part's GND pads belong to in a star-grounded board. Auto picks it from the circuit: Supply for sources, rectifiers and reservoir capacitors, Output for the power stage, Input for the input jack, else the small-signal stage it serves.",
    "Corners": "Corners of the pour's outline. Drag a corner to move it, drag the + on an edge to add one, double-click a corner to remove it.",
    "To GND": "The clearance this net needs to 0 V copper: its class's clearance, or IPC-2221B's for its voltage when that is more.",
    "HV above": "Nets whose simulated DC voltage is above this are in the HV class.",
    "To the board edge": "Minimum gap between copper and the board edge.",
    "Signal width": "Default track width for signal nets.",
    "Power / HV width": "Default track width for power and HV nets.",
    "Minimum width": "The narrowest track the board maker can make.",
    "Via drill": "Drill diameter of a via.",
    "Via pad": "Copper ring diameter of a via.",
    "Minimum drill": "The smallest drill the board maker offers.",
    "Minimum annular ring": "Minimum copper ring left round a drilled hole: (pad − drill) / 2.",
    "Opening around pads": "Solder-mask expansion: the gap between a pad and the mask.",
    "Copper layers": "One or two copper layers.",
    "Copper": "Copper thickness: 35 µm (1 oz) or 70 µm (2 oz). Thicker copper carries more current per track width.",
    "Board thickness": "Board thickness, usually 1.6 mm.",
    "Corner radius": "Radius of the board's corners.",
    "Hole diameter": "Mounting hole diameter: 3.2 mm for M3.",
    "Inset from the edges": "Distance of each mounting hole's centre from the board edges.",
    "Clearance · HV": "Clearance between nets, and the larger one for HV nets.",
    "Tracks: signal · power": "Default track widths for signal and power nets.",
    "To route": "Connections not yet routed.",
    "Track length": "Total length of the net's tracks.",
    "Class": "Net class: Signal, Power or HV, which sets the clearance and track width.",
    "Size": "Outline size of the board.",
    "Stack": "Copper layers, board thickness and copper weight.",
    "High-voltage nets": "Nets in the HV class: their simulated DC voltage is above the threshold, so they get the larger clearance.",
    "X": "Position of the board's origin (bottom-left corner) from the sheet's bottom-left corner.",
    "Y": "Position of the board's origin (bottom-left corner) from the sheet's bottom-left corner.",
    "Allowed warming at DC current": "How much a track may warm above ambient at its simulated DC current. The current check uses IPC-2221 with this and the copper weight: a track narrower than that is an error. 10 °C is conservative, 20 °C usual.",
    "Width": "Width of the board outline (or of the selected track).",
    "Height": "Height of the board outline.",
    "Sheet size": "Drawing sheet format around the board: Auto, A4–A0, or none.",
    "Orientation": "Landscape or portrait sheet.",
    "Widths": "Track widths used on this net.",
    "Rule violations": "Design-rule check results for this item.",
    "Pieces": "Separate copper areas of the pour after islands are removed.",
    "Tracks · vias · holes": "How many tracks, vias and holes are on the board.",
    "Net": "The electrical net, named from the schematic.",
    "Length": "Total track length of this net.",
    "Inactive copper": "Dim the copper layer you are not working on.",
    "Block": "This part belongs to a copy of a reusable block (Edit ▾ → Blocks…). A value changed on it changes on the same part of every copy; a sheet connector's name stays each copy's own. Select this copy, then Update block from selection, carries a changed drawing to the other copies; Detach makes the copy ordinary parts.",
    "Designator": "The part's reference designation: classic letter code and number (R1, C3, VL1.2), as in ГОСТ 2.710. Renumber designations (inspector, nothing selected) numbers every part in reading order.",
    "Mirror": "Mirror the symbol left to right, so a signal can come from the other side without crossing wires (M).",
    "Part number": "The part number to buy, for the bill of materials. Saved with the circuit.",
    "Tube type": "The tube type. Ratings, pinout, heater and interelectrode capacitances come with it.",
    // section titles
    "Open in": "This scope's channels in the full instrument windows.",
    "Operating point": "The circuit at rest (DC) and the averages over the signal cycle, from the latest simulation. A spinning percentage means the run is still settling.",
    "With signal": "What the signal does at this part: swings, gain, distortion and average dissipation over a cycle.",
    "Checks": "Problems found in the circuit: unconnected pins, shorted parts, a missing ground, and every part beyond its ratings.",
    "Ratings": "The tube's maximum ratings from its datasheet or the Katsnelson & Larionov handbook.",
  };

  // ---------------------------------------------------------------------------
  const norm = t => String(t).replace(/\s+/g, " ").replace(/[:：]\s*$/, "").trim().toLowerCase();
  const LBL = new Map(Object.entries(labels).map(([k, v]) => [norm(k), v]));
  function label(text) {
    let t = norm(text).replace(/^−(?=\S)/, "");           // a P-type part's −VCE: as VCE
    if (!t) return null;
    if (LBL.has(t)) return LBL.get(t);
    t = t.replace(/\s*\([^()]*\)$/, "");                  // "Height (mm)" → "height"
    if (LBL.has(t)) return LBL.get(t);
    // a label shown in Russian (i18n.js): look it up by its English
    const en = root.I18n && root.I18n.en(text);
    return en && en !== text ? label(en) : null;
  }
  // the hint in the interface's language: Russian from i18n-hints-ru.js where there is one
  let RU = null;
  function inLang(text) {
    if (!root.I18n || root.I18n.lang !== "ru" || !root.I18N_HINTS_RU) return text;
    if (!RU) {
      RU = new Map();
      const T = root.I18N_HINTS_RU;
      for (const [cat, o] of [["parts", parts], ["fields", fields], ["labels", labels]])
        for (const [k, en] of Object.entries(o)) if (T[cat] && T[cat][k]) RU.set(en, T[cat][k]);
      for (const [en, ru] of Object.entries(T.text || {})) RU.set(en, ru);
    }
    if (RU.has(text)) return RU.get(text);
    // a hint put together from several (a palette button: the part, then how to place it)
    return String(text).split("\n").map(l => RU.get(l) || root.I18n.ru(l) || l).join("\n");
  }
  const field = (type, key) => fields[type + "." + key] || null;

  // ---------------------------------------------------------------------------
  // the tooltip: one floating box, shown 250 ms after the pointer settles on a hinted element
  let tip = null, timer = 0, cur = null;
  function css() {
    if (document.getElementById("hint-css")) return;
    const s = document.createElement("style"); s.id = "hint-css";
    s.textContent = `
      a.btn { text-decoration: none; color: inherit; display: inline-block; }
      .has-hint { cursor: help; text-decoration: underline dotted rgba(139,148,158,.55); text-underline-offset: 3px; }
      #hint-tip { position: fixed; z-index: 1000; max-width: 360px; padding: 8px 10px; border-radius: 8px; pointer-events: none;
        background: #1a2433; color: #e6edf3; border: 1px solid #3a5170; box-shadow: 0 8px 24px rgba(0,0,0,.5);
        font: 12px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; opacity: 0; transition: opacity .12s; }
      #hint-tip.on { opacity: 1; }
      #hint-tip b { color: #00e5ff; display: block; margin-bottom: 2px; font-size: 12px; }
      #hint-tip p { margin: 0 0 4px; } #hint-tip p:last-child { margin-bottom: 0; }
      #hint-tip code { display: block; font: 11.5px ui-monospace, Menlo, monospace; color: #ffd54f; margin: 3px 0 5px; white-space: pre-wrap; }
      #hint-tip ul { margin: 2px 0 4px; padding-left: 16px; }`;
    document.head.appendChild(s);
  }
  const esc = s => s.replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  function render(title, text) {
    let h = title ? `<b>${esc(title)}</b>` : "", list = false;
    text.split("\n").forEach(line => {
      if (/^- /.test(line)) { if (!list) { h += "<ul>"; list = true; } h += `<li>${esc(line.slice(2))}</li>`; return; }
      if (list) { h += "</ul>"; list = false; }
      h += /^= /.test(line) ? `<code>${esc(line.slice(2))}</code>` : `<p>${esc(line)}</p>`;
    });
    return h + (list ? "</ul>" : "");
  }
  function show(el) {
    if (!tip) { tip = document.createElement("div"); tip.id = "hint-tip"; tip.setAttribute("role", "tooltip"); document.body.appendChild(tip); }
    let title = el.dataset.hintTitle || (el.classList.contains("has-hint") ? el.textContent.trim() : "");
    if (el.dataset.hintTitle && root.I18n && root.I18n.lang === "ru") title = root.I18n.ru(title) || title;
    tip.innerHTML = render(title.length > 60 ? "" : title, inLang(el.dataset.hint));
    tip.style.left = "0px"; tip.style.top = "0px"; tip.classList.add("on");
    const r = el.getBoundingClientRect(), t = tip.getBoundingClientRect(), W = innerWidth, H = innerHeight;
    let x = Math.min(Math.max(8, r.left), W - t.width - 8), y = r.bottom + 6;
    if (y + t.height > H - 8) y = Math.max(8, r.top - t.height - 6);
    tip.style.left = x + "px"; tip.style.top = y + "px";
  }
  function hide() { clearTimeout(timer); cur = null; if (tip) tip.classList.remove("on"); }
  function bindTip() {
    document.addEventListener("mouseover", e => {
      const el = e.target.closest && e.target.closest("[data-hint]");
      if (el === cur) return;
      hide(); if (!el || !el.dataset.hint) return;
      cur = el; timer = setTimeout(() => { if (cur === el && el.isConnected) show(el); }, 250);
    });
    document.addEventListener("mousedown", hide, true);
    document.addEventListener("wheel", hide, { passive: true, capture: true });
    document.addEventListener("keydown", hide, true);
    window.addEventListener("blur", hide);
  }

  // ---------------------------------------------------------------------------
  // labels in rows, readouts and section titles get their hint as pages draw them
  const SCAN = ".kv > span:first-child, .row > span:first-child, .insp-sub, .panel h3, .card h3, .side h3, h3, label, th";
  function scan(rootEl) {
    (rootEl || document).querySelectorAll(SCAN).forEach(el => {
      if (el.dataset.hint !== undefined || el.closest("#hint-tip, #help-modal")) return;
      const own = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent).join(" ");
      const h = label(own) || label(el.textContent);
      el.dataset.hint = h || "";
      if (h) el.classList.add("has-hint");
    });
  }
  let pending = false;
  function watch() {
    if (document.body.dataset.hintScan === "off") return;   // the manual: its tables are the hints already
    scan();
    new MutationObserver(() => {
      if (pending) return; pending = true;
      requestAnimationFrame(() => { pending = false; scan(); });
    }).observe(document.body, { childList: true, subtree: true });
  }
  function init() { css(); bindTip(); watch(); }
  if (typeof document !== "undefined") {
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
  }

  // mark an element by hand: Hints.attach(el, text, title)
  function attach(el, text, title) {
    if (!el || !text) return el;
    el.dataset.hint = text; if (title) el.dataset.hintTitle = title;
    el.classList.add("has-hint"); return el;
  }

  root.Hints = { parts, fields, labels, label, field, attach, scan, inLang };
})(typeof window !== "undefined" ? window : globalThis);
