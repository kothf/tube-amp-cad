# 555, logic and mixed-signal circuits

## NE555
- Astable: f ≈ 1.44 / ((R1 + 2·R2)·C), high time 0.693·(R1 + R2)·C, low time 0.693·R2·C; duty > 50 % unless R2 is bypassed by a diode. R1 ≥ 1 kΩ (the discharge transistor), total R ≤ ~1 MΩ (threshold current).
- Monostable: t = 1.1·R·C, trigger pulse shorter than t (AC-couple the trigger).
- Pin 5 (CONT) to ground through 10 nF; pin 4 (RESET) to Vcc when unused; 100 nF + 10 µF at the supply pins (it draws current spikes at each edge). Supply 4.5–16 V (NE555), output sinks/sources up to 200 mA.
- Driving a speaker, relay or LED: series resistor or coupling cap; flyback diode on coils.

## Logic
- Families: 74HC 2–6 V, CMOS 4000 3–15 V (slow, weak outputs), 74HCT for TTL-level inputs. Unused inputs tied high or low, never left floating; unused gates' inputs grounded.
- Decouple every package with 100 nF at its supply pins; a 10 µF bulk cap per board.
- Schmitt inputs (74HC14, CD40106, CD4093) for slow edges, RC oscillators and debouncing (10 kΩ + 100 nF and a Schmitt gate).
- Pull-ups for open-drain and switches 4.7–47 kΩ; I²C 2.2–4.7 kΩ.
- Counters/dividers (74HC393, CD4040, CD4017): clock edges clean (Schmitt), reset lines defined at power-up (RC + diode).
- Output current: 74HC ~4–6 mA at proper levels (25 mA absolute), CD4000 ~1 mA at 5 V: drive LEDs and relays through a transistor.

## Interfaces between domains
- Logic to a load: NPN low-side (base resistor for Ib ≥ Ic/10), logic-level N-MOSFET (2N7000, BS170) with a 100 Ω gate resistor and a 100 kΩ pull-down; flyback diodes on inductive loads.
- Analog to logic: comparator or Schmitt input with hysteresis; clamp inputs (series resistor + diodes) to the logic supply.
- Mains/high voltage to logic: optocouplers, relays with proper creepage; never share a ground with mains-live circuits.
- Mixed-signal grounding: one ground plane, analog and digital parts kept in their own areas so the return currents do not cross; never split the plane under a trace that crosses domains.
- Clocks and fast edges: series termination 22–47 Ω on long traces; keep the loop of each fast signal and its return small.

## Microcontroller boards (general practice)
- Supply decoupling at each VDD pin, a ferrite or RC into the analog supply (AVDD/VREF), reset pull-up + 100 nF, programming header, crystal close to its pins with the load caps' ground to the chip's ground pin.
- Protect inputs from the outside world (ESD diodes, series resistors), and outputs from shorts.
