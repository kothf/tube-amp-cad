# Tube circuits

## Choosing the operating point
- Draw the load line on the anode curves: B+ at Ia = 0, B+/(Ra + Rk) at Va = 0. For a transformer load the DC line is almost vertical (winding resistance) and the AC line has slope −1/Zaa through the idle point.
- Bias in the straight middle of the curves: the grid stays negative over the whole swing (Vg peak < |Vgk|, with ~0.5 V spare, or grid current flows and the stage clips softly).
- Keep the idle anode dissipation inside the rating with margin: small-signal triodes ≤ 50–70 % of Pa max; single-ended class A output ≤ 70–85 %; push-pull class AB idle 50–70 % (the tubes heat up further with signal). Same for screen dissipation (Pg2) and cathode current (Ik max).
- Anode voltage with an inductive load swings to about twice the DC level: Va max must cover it, and the off-state B+ (cold tubes, no current) must not exceed Va max of the capacitors or the tube's cold rating.
- Heater-to-cathode voltage (Vhk) is a real limit: about 90–200 V for most small triodes (12AX7 180 V, 12AU7/6SN7/6V6/6L6GC 200 V, 12AT7/6SL7/6P3S 90 V, EL84/EL34/6N1P 100 V, 6N23P 150 V). Cathode followers, the upper tube of an SRPP, mu-follower or cascode, and DC-coupled stages often exceed it: elevate the heater supply (a divider from B+ to about 1/4–1/3 of the highest cathode voltage, bypassed) or give that tube its own heater winding.
- Maximum grid-leak resistance (Rg1 max) from the datasheet: smaller with fixed bias than cathode bias (EL84 1 MΩ / 0.3 MΩ, EL34 0.7 / 0.5 MΩ, 6V6 0.5 / 0.1 MΩ, 6L6GC 0.5 / 0.1 MΩ, KT88 0.47 / 0.22 MΩ, 2A3 0.5 / 0.05 MΩ, 300B 0.25 / 0.05 MΩ). Too large a leak lets grid gas current run the tube away.

## Common-cathode triode
- Gain A = µ·Ra / (ra + Ra + (µ+1)·Rk) unbypassed; with Rk fully bypassed A = µ·Ra/(ra + Ra). Output impedance ≈ ra ∥ Ra (bypassed).
- Typical: 12AX7 Ra 100 kΩ, Rk 1.5 kΩ bypassed, B+ 250–300 V → Ia ≈ 0.8–1.2 mA, gain ≈ 55–65; 12AU7 Ra 22–47 kΩ, Rk 1–2.2 kΩ → gain ≈ 13–15; 6SN7 Ra 47–100 kΩ, Rk 1–2.7 kΩ; 12AT7 Ra 47–100 kΩ, Rk 1–1.2 kΩ.
- Rk = Vgk/Ia. Bypass cap: f−3dB ≈ 1/(2π·Ck·Rk∥((ra+Ra)/(µ+1))); a few µF for 1 kHz shelving, 22–100 µF for full bass.
- Coupling: f−3dB = 1/(2π·C·(Rout + Rg)). Put it around 2–10 Hz; in a power amp with feedback, stagger the poles (one stage clearly lower than the others) and avoid very large caps that cause blocking.
- Miller input capacitance Cin ≈ Cgk + Cga·(1 + A): a 12AX7 at gain 60 shows ~100 pF; a high source impedance before it rolls off the treble.
- Grid stopper: 1–10 kΩ (power tubes 1–4.7 kΩ, high-µ inputs 10–68 kΩ) right at the grid pin, against RF and parasitic oscillation.

## Other stages
- Cathode follower: gain ≈ µ·Rk/(ra + (µ+1)·Rk) < 1, Zout ≈ 1/gm. Bias the grid from a divider or bootstrapped leak; watch Vhk (cathode sits near B+/2). A constant-current sink in the cathode improves linearity.
- SRPP / mu-follower: two triodes in series; the upper cathode is at about B+/2 (Vhk!). Gain ≈ µ/2 (SRPP) to ≈ µ (mu-follower).
- Cascode: high gain with low Miller capacitance; upper grid fixed from a divider ~ upper cathode + bias; Vhk of the upper tube.
- Long-tailed-pair phase splitter: two triodes with a common tail (resistor or CCS); balance is better with a large tail or CCS; the plate loads differ by ~5–10 % to balance a resistor tail. Gain ≈ µ·Ra/(2(ra + Ra)) per side.
- Concertina (cathodyne): equal Ra and Rk, gain just under 1 per side, unequal output impedances; headroom about B+/4 per side.
- Pentode voltage amp (EF86, 6J32P): Ra 100–220 kΩ, screen resistor 0.5–1.5 MΩ with 0.1–1 µF screen bypass; gain 100–200. Triode-strapped pentode: G2 to anode through 100 Ω.
- Constant-current source in a cathode or as anode load: DN2540 or LND150 depletion MOSFET with a source resistor, or a cascoded pair; keep the MOSFET within its Vds rating and dissipation.

## Power stages
- Single-ended: the output transformer carries the full DC (check its DC rating and air gap). Primary impedance: triodes ≈ 2–4·ra (2A3/300B 2.5–3.5 kΩ, 6S4S 2.5–4 kΩ), pentodes from the datasheet (EL84 5.2 kΩ, 6V6 5 kΩ, EL34 2–3 kΩ, KT88 1.25–2.5 kΩ). Power ≈ 20–25 % of Pa idle (triode) or 30–40 % (pentode).
- Push-pull class AB: plate-to-plate impedance from the datasheet (2×EL84 8 kΩ, 2×6V6 8 kΩ, 2×EL34 3.4–4.5 kΩ, 2×6L6GC 4.2–6.6 kΩ, 2×KT88 3–4.5 kΩ); ultralinear taps 33–43 %. Balanced idle currents (separate cathode resistors or a bias pot per tube).
- Fixed bias: negative supply with a pot per tube or per pair, a resistor in series so the pot can never leave the grids open; bias check points (1–10 Ω cathode resistors). Cathode bias: Rk = Vgk/Ik, bypass ≥ 100 µF, its wattage ≥ 2× Ik²·Rk; the cap's voltage ≥ the cold-start cathode voltage.
- Ultralinear: the screens sit at nearly the full B+ (the tap's DC drop is a few volts), so B+ must stay under Vg2 max (EL34 425 V, 6L6GC 450 V, EL84/6P14P 300 V, 6V6GT 310 V) or the screens are over-rated; with a higher B+ use pentode operation with a lower screen supply. Size the idle so the average Pa with full signal stays inside the rating too, not only at idle.
- Screen: grid stopper 100 Ω–1 kΩ at G2 (EL34 ~1 kΩ, KT88 ~470 Ω); screen supply from a lower, well-filtered node for pentodes; Vg2 ≤ Vg2 max.
- Output transformer load always connected: an open secondary under drive flashes over the transformer and the sockets. Add a fixed load resistor 47–100 Ω across the secondary or a switching jack.
- Directly heated triodes (2A3, 300B, 45): filament as the cathode; use DC filament supplies or a humdinger pot; filament return to the bias resistor at the centre tap.

## Output transformers in this app (wiring and phase)
- Push-pull `opt_pp` pins run along the primary P1 – U1 – CT – U2 – P2. CT goes to B+; P1 to the anode of one output tube and P2 to the other; U1 feeds the screen (through its screen stopper) of the tube on P1, U2 the screen of the tube on P2. Never join a UL tap to CT or B+, and never cross them (U1 to the P2 tube): that unbalances the stage and the tubes run away. For plain pentode or tetrode operation leave U1/U2 unconnected and feed both screens from a separate, lower supply node.
- Phase: with S1 grounded, the voltage at S2 is in phase with the anode on P2 and opposite to the anode on P1 (example 14 wires its feedback this way). Global feedback to the first stage's cathode must be in phase with the input there, so count the inversions: a grounded-cathode stage inverts (grid → anode); a cathodyne's anode inverts and its cathode does not; in a long-tailed pair the driven grid's own anode inverts and the other anode does not; each output tube inverts grid → anode. Choose S1/S2 (or which splitter output drives which tube) from that count, so the loop is negative the first time.
- Single-ended `opt_se`/`opt_cat`: P1 to B+, P2 to the anode, S1/S2 to the speaker.

## Rectifiers and regulators (tube)
- Tube rectifiers (5U4G, 5Y3, GZ34/5AR4, EZ81, 6X4, 5Ts3S): obey the datasheet's maximum first-filter capacitor (GZ34 60 µF) and minimum plate resistance per anode; the drop under load is 15–60 V (GZ34 lowest, 5Y3/5U4 highest). They warm up slowly, so B+ comes up gently.
- Gas regulators (0A2 150 V, 0B2 108 V, 0D3 150 V, 0C3 105 V): 5–30 mA, series resistor sized so current stays in range at both load extremes; no capacitor > 0.1 µF directly across them (relaxation oscillation).

## Quick numbers
- 12AX7: µ ≈ 100, ra ≈ 62 kΩ, gm ≈ 1.6 mA/V at 1.2 mA. 12AU7: µ ≈ 17, ra ≈ 7.7 kΩ, gm ≈ 2.2 mA/V. 12AT7: µ ≈ 60, ra ≈ 10.9 kΩ, gm ≈ 5.5 mA/V. 6SN7: µ ≈ 20, ra ≈ 7.7 kΩ. 6N1P: µ ≈ 35, ra ≈ 11 kΩ. 6N23P/6922: µ ≈ 33, ra ≈ 2.6 kΩ at 15 mA.
- Power tubes (Pa max): EL84 12 W, 6V6GT 14 W, 6L6GC 30 W, EL34 25 W, KT88 42 W, 2A3 15 W, 300B 40 W, 6P14P 14 W, 6S4S 15 W, 6P3S 20.5 W, GU-50 40 W.
