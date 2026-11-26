# Feedback, stability and protection against oscillation

## Global negative feedback
- Amount: tube power amps 6–20 dB, solid-state power amps 20–40 dB at 1 kHz, op-amp circuits whatever the noise gain gives. Feedback lowers gain, distortion and output impedance by the same factor (1 + Aβ).
- Phase: the feedback must be negative. With an output transformer the secondary's polarity decides it; if the amp oscillates hard (or the gain rises) when the loop is closed, swap the secondary wires (S1/S2) or take the feedback to the other point.
- Tube amp feedback point: from the OT secondary (speaker hot) to the cathode of the first stage (unbypassed part of Rk) or to the LTP's second grid. Feedback resistor sized for the wanted gain reduction: β ≈ Rk1 / (Rk1 + Rfb).
- Stability margins: phase margin ≥ 45° (≥ 60° preferred), gain margin ≥ 10 dB. The output transformer adds poles at both ends of the band: keep the coupling-cap poles staggered (one dominant low pole) and add a phase-lead cap across the feedback resistor (100 pF–2 nF) or a step network (R + C) at a stage's anode to set a dominant high pole.
- Check with the loop gain (Bode → Loop gain in this app) and a square wave into 8 Ω, open circuit and 8 Ω ∥ 1–2 µF: ringing should die in one or two cycles.

## Local feedback
- Unbypassed cathode or emitter resistor (current feedback), ultralinear screen taps, Schade feedback (anode to anode of the driver), cathode feedback windings.

## Parasitic oscillation
- Grid stoppers right at the socket (1–10 kΩ signal grids, 100 Ω–1 kΩ screens), base/gate stoppers 47–470 Ω at the pin, short leads, ferrite beads on power-tube grids when needed.
- Followers into capacitive loads, high-gm devices (6922/ECC88, 6S45P, MOSFETs) and paralleled parts are the usual oscillators; give each paralleled device its own stopper.
- Solid-state power amps: Zobel + output inductor, VAS dominant pole, local decoupling at each output device (100 nF + 100–470 µF).
- Op-amps: isolation resistor before capacitive loads; decoupling at the pins; a small cap (10–100 pF) across Rf to limit bandwidth when the source or wiring adds phase shift.
- Motorboating (slow oscillation through the supply): enough decoupling between stages (separate RC nodes), larger reservoir caps, or less low-frequency gain.

## Things that go wrong at turn-on and in use
- Cold-cathode B+ surge: with silicon rectifiers the B+ rises to its no-load peak before the tubes conduct; caps and Vhk must take it, or delay HT (standby switch, tube rectifier, relay).
- Open-output protection for tube amps: a 47–100 Ω resistor across the secondary or a shorting jack, so a missing speaker cannot flash over the output transformer. Speaker DC protection (relay) for direct-coupled solid-state amps.
- Thermal runaway: fixed-bias tubes with too large a grid leak; BJT output stages without emitter resistors or with the bias transistor off the heatsink; vertical MOSFETs biased in the negative-tempco region.
