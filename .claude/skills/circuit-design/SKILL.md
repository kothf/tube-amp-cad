---
name: circuit-design
description: Design, review or fix electronic circuits and PCBs in Tube Amp CAD (tube and transistor amps, op-amp/analog, power supplies, 555/logic/mixed-signal), checked by the app's simulator and ERC.
---

# Circuit and PCB design for Tube Amp CAD

Use this when you design a circuit, review or fix one, write an example, change the in-app AI prompts, or give board-layout advice in this repository. The same knowledge is compiled into the app's AI features (`ai-skill.js`), so improving a reference file improves both.

## Workflow
1. **Spec in numbers** (levels, impedances, gain, power, load, supply, bandwidth). Read `references/design-method.md`.
2. **Topology and hand design** from the reference that fits:
   - `references/tube-circuits.md`: triode/pentode stages, followers, SRPP, phase splitters, SE/PP output, bias, Vhk, Rg max, rectifiers, quick tube numbers.
   - `references/transistor-circuits.md`: BJT/JFET/MOSFET stages, power amp topology, bias spreader, idle current, SOA, Zobel.
   - `references/analog-opamp.md`: op-amp rules, filters, RIAA, tone stacks, references, oscillators, noise.
   - `references/power-supplies.md`: mains side, rectifiers, filters, bleeders, heaters, linear and switching regulators, batteries.
   - `references/digital-mixed.md`: 555, logic families, interfaces, mixed-signal grounding.
   - `references/feedback-stability.md`: global/local feedback, margins, parasitics, turn-on problems.
   - `references/grounding-layout.md`: grounding, hum, PCB placement and routing rules, the app's DRC.
3. **Write it in the app's format** (`references/app-format.md`): the design netlist JSON, or the project file.
4. **Check it in the simulator**: `node scripts/design-check.mjs design.json` prints the Checks, ERC and operating points. Fix until the Checks are clear and the numbers match your hand design. Never claim a circuit works without this run.
5. **Draw it tidily** (`references/schematic-style.md`) when it goes into examples or a screenshot.

## Rules that always apply
- Use only parts in the app's library (`AiCircuit.catalogue()`, `TUBE_DATABASE`); never invent part numbers, footprints or datasheet values.
- Keep every part inside its ratings with the margins in design-method.md, at power-on (cold cathodes, high mains) as well as idle and full signal.
- Board work is guidance and checks: the app places and routes with its own deterministic tools (Design from scratch, its grid router). Do not add AI placement or routing; that idea was dropped for good.
- When you change a reference file, run `node scripts/build-ai-skill.mjs` so the app's AI gets the same text, and keep help.html/help-ru.html in step with any user-visible change.
