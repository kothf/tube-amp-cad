# Op-amp and general analog circuits

## Op-amp basics
- Supplies: within the device's rating (TL07x ±18 V max, NE5532 ±22 V, OPA134 ±18 V, LM4562 ±17 V, LM741 ±22 V, LM324 32 V single). Decouple each package with 100 nF ceramic at the pins plus 10–100 µF per board rail.
- Every input needs a DC path to ground (or a reference): an AC-coupled input gets a resistor to ground/Vref, or the output drifts to a rail.
- Non-inverting gain 1 + Rf/Rg; inverting −Rf/Rin (Zin = Rin). Keep Rf 1–100 kΩ (low noise: 1–10 kΩ; NE5532 drives 600 Ω, TL07x ≥ 2 kΩ).
- Gain-bandwidth: closed-loop bandwidth ≈ GBW / noise gain; slew rate limits full-power bandwidth f = SR / (2π·Vpk).
- Output swing: 1–2 V short of each rail for classic parts (LM324 swings to the negative rail only); rail-to-rail parts when the supply is low.
- Capacitive loads (cables, MOSFET gates): 47–100 Ω isolation resistor at the output, inside or outside the feedback.
- Single-supply: bias the inputs at Vcc/2 with a divider + 10–47 µF, AC-couple in and out.
- Unity-gain stability: decompensated parts (OPA37, LM301A without its cap) need noise gain above their minimum.
- LM741/LM301A/LM324 are old and noisy: prefer NE5532, OPA2134, TL072 for audio.

## Filters and tone
- RC pole: f = 1/(2πRC). Sallen-Key low/high pass: unity-gain, equal R, C2 = 2·C1 for Butterworth (Q = 0.707). Multiple feedback for band-pass. State-variable for tunable filters.
- Use E24 resistors and E6/E12 capacitors (C0G/NP0 or film in the signal path; never X7R/Y5V where distortion matters).
- RIAA: 75 µs / 318 µs / 3180 µs time constants (passive, active or split), plus an IEC 7950 µs rolloff if wanted. Moving-magnet input 47 kΩ ∥ 100–200 pF, gain ≈ 35–40 dB at 1 kHz.
- Tone stacks (Fender/Marshall/Vox TMB, Baxandall, James): passive stacks lose 10–20 dB; Baxandall needs a low-impedance drive and a recovery stage.

## References, sensing, oscillators
- Zeners: low-noise only from ~6 V (avalanche); bypass with 10–100 µF and feed from a current source or resistor; TL431 as an adjustable shunt (cathode current ≥ 1 mA, Vref 2.495 V, needs a capacitor value that keeps it stable, or none).
- Wien-bridge oscillator: gain 3 at the bridge frequency with amplitude control (lamp, JFET, diodes). Phase-shift and LC oscillators need loop gain slightly > 1 at start.
- Comparators: hysteresis 10–100 mV via positive feedback; open-collector outputs need a pull-up.
- Current sense: shunt + difference amp; Kelvin connection at the shunt.

## Noise and impedance
- Thermal noise of R: √(4kTRB) ≈ 0.13 µV·√(R/1kΩ) over 20 kHz. Source impedance sets the best device: BJTs for low Z (< 1 kΩ), JFET/FET op-amps for high Z (> 10 kΩ, guitar pickups, piezos).
- Input of a guitar amp: 1 MΩ grid/input impedance; pickups are inductive (2–8 H), cable capacitance 300–600 pF shapes the treble.
- Line level: consumer −10 dBV (0.316 V rms), pro +4 dBu (1.23 V rms); output impedance ≤ 1/10 of the next input.
