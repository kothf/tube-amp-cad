# Grounding, hum and board layout (PCB)

## Grounding
- Ground is a set of return paths, not one node: keep the big charging currents (rectifier → first reservoir cap → transformer centre tap) in a short loop of their own and connect the rest of the ground to the reservoir cap's minus.
- Star or bus ground: the power-supply return first, then the output stage, then each earlier stage in turn, the input last; the signal ground joins the chassis at one point, near the input jacks (isolated jacks elsewhere).
- Protective earth to the chassis with its own bolt; a ground-lift (10 Ω ∥ 100 nF, or a diode bridge) between signal ground and chassis only where the safety rules allow it.
- Each stage's decoupling cap returns to that stage's cathode/emitter ground, not across the board.
- Hum sources: heater wiring near grids, the power transformer's field near the output transformer (turn their cores at 90°), the rectifier loop, ground loops between inputs. Shield high-impedance inputs (screened cable, ground the screen at one end).

## Placement (guidance for a person or for the app's own Design from scratch, not for AI placement)
- Follow the signal: input at one edge, output at the other; power supply and transformers away from the input stages.
- Put each stage's parts around its tube socket or transistor; grid stoppers and base/gate stoppers right at the pin; coupling caps between stages.
- Heat: power tubes and power resistors away from electrolytics (≥ 10 mm, every 10 °C halves a capacitor's life); lift resistors above ~1 W off the board; leave room for convection above tubes; power transistors on a heatsink at the board edge; the bias-sensing transistor on the same heatsink.
- Mechanical: a mounting hole and standoff near each tube socket (pulling a tube flexes the board), heavy parts (transformers, chokes) on the chassis, not the PCB; connectors at the edge.

## Routing
- Clearances by voltage: B+ and anode nets ≥ 2 mm from everything else (this app: 2.0 mm above 60 V by default; IPC-2221B B2: 0.6 mm to 150 V, 1.25 mm to 300 V, 2.5 mm to 500 V, +0.005 mm/V above), more for creepage on mains (≥ 3 mm basic, 6 mm reinforced, slots in the board between mains and low voltage).
- Track width from the current (IPC-2221, 10 °C rise, 35 µm outer copper: 0.5 A ≈ 0.12 mm, 1 A ≈ 0.3 mm, 2 A ≈ 0.8 mm, 3 A ≈ 1.4 mm, 4 A ≈ 2 mm; inner layers need about 2.5× the width; use at least 0.6 mm for signals and 1 mm for power anyway, as this app's default rules do); heater pairs and speaker returns are the high-current nets in a tube amp.
- Heater pairs run side by side (like a twisted pair) along the board edge or between socket rows, away from grid and input tracks; cross signal tracks at right angles.
- Keep grid and input tracks short and away from anode, output and heater tracks (parallel runs couple: oscillation or hum); a guard ground track or pour around very high-impedance inputs.
- Solid-state power amps: the output devices' decoupling right at their collectors, the feedback taken from the output terminal (Kelvin), the high-current ground (reservoir caps, Zobel, speaker return) separate from the signal ground and joined at one point.
- Ground pour/plane on the bottom for low-voltage circuits; with high-voltage tube boards a pour must keep the HV clearance from every B+ pad.
- SMD: thermal reliefs on pour connections, vias never in pads, paste and courtyard per footprint.

## Checks to run (in this app)
- Board → DRC: clearance (with HV classes), track width against current, edge clearance, annular ring, drill, stopper distance, track coupling, heat around electrolytics, socket support holes, enclosure height, star ground, unrouted nets.
- Schematic → Checks and ERC before the board: every pin connected, no shorted parts, ratings in range, supply pins fed.
