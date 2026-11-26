# Transistor circuits (BJT, JFET, MOSFET, power stages)

## Small-signal BJT
- VBE ≈ 0.6–0.7 V (silicon, falls ~2 mV/°C), germanium ≈ 0.15–0.3 V with high leakage. re = 26 mV / Ic.
- Common emitter with divider bias: divider current ≥ 10× base current; 1–2 V across RE for a stable point; Ic sets re; gain ≈ RC / (re + RE unbypassed). Centre the collector at about half the headroom between the emitter and the supply for maximum swing.
- Emitter follower: gain ≈ 1, Zin ≈ β·(RE ∥ RL), Zout ≈ re + Rsource/β. A follower driving a capacitive load can oscillate: base stopper 47–220 Ω.
- Long-tailed pair: current-source tail (two-transistor or LED/zener reference), matched devices, degeneration resistors 22–220 Ω in the emitters for linearity; current mirror load doubles the gain and balances the pair.
- Pick transistors for the job: low noise (BC549C/BC559C, 2SC2240-class), high voltage (MPSA42/92 300 V, MJE340/350 300 V), drivers (BD139/140, MJE15032/33, 2SC4793/2SA1837), outputs (MJL3281A/1302A, 2SC5200/2SA1943, MJL21193/94, TIP35C/36C).
- Ratings with margin: Vce ≤ 70–80 % of VCEO (include the swing and supply sag/surge), Pd at the real case temperature, Ic peak.

## JFET
- Self-bias: RS sets ID on the device's curve (Idss and Vp spread 2–3×: design for the spread or add a trimmer). Gain ≈ gm·RD (bypassed RS). J201/2SK30A for low current, 2SK170/LSK170 for low noise, J310 for RF.
- As a current source: gate to source through RS; as a switch/mute: Vgs beyond Vp.

## MOSFET
- Vertical (IRF/IRFP): Vgs(th) 2–4 V spread, large Ciss: gate stopper 100–470 Ω at the gate, a 12–15 V zener gate-source when the gate can be overdriven. Negative tempco of ID at low current means thermal runaway in linear use unless the bias is tracked from a sensor on the heatsink. Lateral (2SK1058/2SJ162, ECX10N20/P20): zero tempco near 100 mA, self-protecting, need ~1 V more drive.
- Small signal: 2N7000/BS170 (switches, logic level ≈ 2–3 V), DN2540/LND150 depletion (current sources, high-voltage followers in tube circuits).

## Power amplifiers
- Topology: input LTP (with CCS tail) → VAS with current source load and dominant-pole Miller cap (Cdom 47–150 pF) → class AB output (emitter followers or CFP) → global feedback set by two resistors.
- Bias spreader: VBE multiplier transistor mounted on the main heatsink (or on an output device), with a trimmer that fails safe (at its end the idle current falls, never rises).
- Idle current: BJT EF output 50–150 mA per pair with emitter resistors 0.1–0.47 Ω (Vre ≈ 26 mV optimum per Oliver for EF); MOSFET 100–250 mA. Each paralleled device has its own emitter/source resistor.
- Zobel at the output (5–10 Ω + 47–100 nF) and an output inductor 1–3 µH with a 1–10 Ω resistor in parallel for capacitive loads.
- Output power: P = Vpk² / (2·RL); supply = Vpk + 3–6 V drop (drivers + Vce sat + Re); each rail's capacitor ≥ 4.7–10 mF per 50 W at 8 Ω.
- Safe operating area: at Tc 25 °C the full rating; it derates linearly to zero at Tj max. A TO-3P/TO-264 device on a real heatsink is good for about 50–60 % of its rating. Reactive loads double the stress (current at full Vce).
- Protection: rail fuses, DC-offset detection with a relay or a speaker-delay relay, current limiters for public use.
- DC offset at the output < 50 mV (servo or a DC-blocking cap in the feedback leg with a matching input bias path).
- Quasi-complementary outputs: add a Baxandall diode to even out the halves.
- Class A: idle current ≥ peak load current / 2 (push-pull); heatsink must handle the full idle power all the time.

## Driving and loads
- Speakers: nominal 4/8 Ω with impedance peaks and dips; design current for the lowest dip.
- Headphones: 32–600 Ω; a 0–10 Ω output impedance (an op-amp + buffer or a small class AB pair).
- Relays and inductive loads: flyback diode across the coil; transistor current ≥ coil current with margin; base drive Ib ≥ Ic / 10 for saturation.
