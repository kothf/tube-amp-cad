# Power supplies (mains, linear, switching)

## Mains side and safety
- IEC inlet → fuse → switch → transformer primary. Fuse slow-blow (T) at about 1.5–2× the primary's full-load current (inrush of big transformers and capacitors); a fast fuse only on secondaries. Protective earth to the chassis with its own bolt, never shared with signal ground hardware.
- Inrush: NTC thermistor in the primary (or a soft-start relay) for transformers above ~300 VA or capacitor banks above ~20 mF.
- MOV across the primary after the fuse; an X2 capacitor across L–N for interference.
- In this app: with `mains` + a transformer that has a primary (`ptx_cat`, P1 P2), draw the fuse (part `fuse`, slow T) between the mains L and the primary. The generic `ptx` has the mains built in and no primary pins: then put an HT fuse in the secondary (between the centre tap and ground, or after the rectifier) at 1.5–2× the DC load current, so the circuit still shows its protection.
- A regulator in a TO-220 dissipating more than ~2 W needs a heatsink: keep the input only as high as the dropout needs at the ripple trough and low mains (a lower secondary voltage), or say that it needs one.
- Mains tolerance: design for +10 % (230 → 253 V): cold, unloaded secondaries are higher still (regulation 5–15 %).

## Rectifiers and filters
- Peak DC from a capacitor-input filter ≈ √2·Vrms − diode drops; under load about 1.2–1.3·Vrms (silicon) for full-wave; transformer winding resistance and rectifier tube drop lower it further.
- Choke-input filter: DC ≈ 0.9·Vrms (full-wave) with the choke above its critical inductance L ≥ Rload / 940 (50 Hz) or Rload / 1130 (60 Hz) in henries, else it rises toward the peak at light load. Needs a bleeder for minimum current.
- Ripple (full-wave, capacitor input) ΔVpp ≈ I / (2·f·C); half-wave I / (f·C). Each CRC or CLC section divides the ripple by about 2π·2f·RC (or (2π·2f)²·LC).
- Diode ratings: PIV ≥ 2.83·Vrms (full-wave centre tap) or 1.41·Vrms (bridge) plus margin (×1.5–2); repetitive peak current; 1N4007 1000 V 1 A, UF4007 for less switching noise, 1N5408 3 A. A 10–100 nF snubber across each diode or the secondary.
- Tube rectifiers: obey max first capacitor and min plate resistance; cold-start inrush through silicon is higher.
- Capacitor voltage rating ≥ the highest voltage it ever sees: the unloaded, cold-cathode B+ at high mains (√2·Vrms·1.1). Electrolytics: 105 °C parts, life halves for every 10 °C; series pairs need balancing resistors (100–220 kΩ each, sized for ~1 mA).
- Bleeder resistor across the last big capacitor: brings B+ below 50 V within ~30 s (R ≤ 30 s / (C·ln(V/50))), at ≤ 50 % of its power rating.
- Decoupling of stages: a separate RC (or RL) filter node per stage, from the output stage backwards: B1 → B2 → B3, preamp nodes have ≤ 1 mV ripple; the dropping resistor's power and voltage rating.

## Heaters
- Total heater current from the tube data (12AX7 0.3 A at 6.3 V or 0.15 A at 12.6 V; EL34 1.5 A; KT88 1.6 A; 300B 1.2 A at 5 V; 6S4S 1 A at 6.3 V). Transformer heater winding with 10–20 % margin.
- AC heaters: twisted pair, referenced to ground through a centre tap or two 100 Ω resistors (humdinger), or elevated to +30–80 V DC to quiet heater-cathode leakage and protect Vhk.
- DC heaters for low-level stages and DHTs: a rectifier + CRC + LM317/LM338 (dropout ~2–3 V); the regulator's dissipation and heatsink; soft start.

## Linear regulators
- 78xx/79xx: input ≥ output + 2–2.5 V at the ripple trough; 330 nF at the input, 100 nF at the output; LM317: Vout = 1.25·(1 + R2/R1), R1 = 120–240 Ω, 10 µF on ADJ for less ripple, protection diodes with large output caps.
- Dissipation (Vin − Vout)·I: TO-220 without a heatsink ≈ 1–1.5 W; otherwise heatsink θ.
- High-voltage regulation (B+): a MOSFET follower (IRF820, IRF840) with a zener or reference string on its gate, gate stopper and gate-source zener; a gas tube or a tube series regulator for vintage designs.

## Switching regulators (DC-DC)
- Buck: D = Vout/Vin; inductor ripple 20–40 % of Iout: L = (Vin − Vout)·D / (f·ΔI); output ripple ΔI / (8·f·C) + ΔI·ESR. Low-ESR caps; Schottky catch diode (1N5817–1N5822, SB1100) or a synchronous switch.
- Boost: D = 1 − Vin/Vout; peak switch current I·Vout/Vin + ΔI/2; the diode carries the load at the output voltage.
- Keep the hot loop (switch, diode, input cap) tiny; sense and feedback away from the switch node. Snubbers and soft start where needed.
- Mains SMPS: isolation, creepage, Y capacitors, mains-rated parts; outside a simulator's comfort zone, so check every rating twice.

## Batteries
- Li-ion 3.0–4.2 V per cell (protection board, charger), PP3 9 V ~500 mAh with a steep sag, AA 1.0–1.6 V, SLA 12 V float 13.6 V. Reverse-polarity protection with a series diode or P-MOSFET.
