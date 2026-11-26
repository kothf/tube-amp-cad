# Design method and parts (every kind of circuit)

## How to design
1. Write down the spec in numbers: input level and impedance, output level/power and load, gain, bandwidth, noise or hum, supply, and what the circuit must survive (no load, short, power-on).
2. Pick a proven topology for that spec. Prefer textbook and datasheet application circuits over clever ones.
3. Work from the output backwards: the output stage sets the supply and the drive; each earlier stage must deliver that drive with headroom (≥ 2× the needed swing, 6 dB).
4. Set every operating point by hand (load lines, bias currents), then the coupling, bypass and filter values from the wanted corner frequencies.
5. Check every part against its ratings with margin (table below), at power-on and with signal, at high mains.
6. Simulate: the DC operating point first (does every device sit where you set it?), then gain and frequency response, clipping, distortion, transients at power-on. Compare with the hand numbers: a large difference means a mistake in one of them.
7. Fix what the checks find with the smallest change that keeps the purpose.

## Margins (derating) a careful designer keeps
| Part | Keep under |
|---|---|
| Resistor power | 50 % of the rating (60 % at most); lift or space parts above 1 W |
| Resistor voltage | element limit: 1/4 W axial ≈ 250 V, 1/2 W ≈ 350 V, 1 W ≈ 500 V, 0805 ≈ 150 V, 1206 ≈ 200 V: use several in series for B+ dividers and bleeders |
| Capacitor voltage | 80 % for film and ceramic, the highest voltage it ever sees (cold start, high mains) for electrolytics with ≥ 10 % spare |
| Electrolytic ripple current and temperature | its rating at the real temperature; 105 °C types near heat |
| Tube | Va, Pa, Pg2, Vg2, Ik, Vhk, Rg max from the datasheet (Pa per the table in tube circuits) |
| Transistor | 70–80 % of VCEO/VDS, SOA at the real case temperature, Tj ≤ 125 °C |
| Diode | PIV × 1.5–2, average and surge current |
| Transformer | VA and DC current (single-ended OT), heater windings with 10–20 % spare |
| Fuse | slow-blow 1.5–2× the normal current on the primary |

## Standard values and parts
- Resistors E12/E24 (1 %, metal film for signal, metal oxide or wirewound for power). Capacitors E6/E12: film (polypropylene, polyester) for coupling, C0G for small values in filters, electrolytics for supplies and bypass, X7R only for decoupling.
- Coupling capacitors in tube circuits: film rated ≥ 400–630 V. Cathode bypass: electrolytic 25–100 V. Reservoir caps: 450–500 V types for B+ to ~420 V.
- Use parts from the library you are given; never invent a part number, a footprint or a datasheet value.

## Saying what you did
- Give the numbers you expect (supply voltages, bias currents, dissipations against ratings, gain, output power, bandwidth) so they can be compared with the simulation.
- When the request leaves something open, choose sensibly and say so.
