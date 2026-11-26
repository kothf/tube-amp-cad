# Tube Amp CAD: the circuit formats and how to check a design

## The design netlist (what the AI features answer, ai-design.js)
```json
{"title": "12AX7 gain stage", "rails": {"B+": 250},
 "parts": [
  {"ref": "G1", "type": "siggen", "values": {"amp": "0.1", "freq": "1k"}, "pins": {"+": "IN", "-": "GND"}},
  {"ref": "C1", "type": "capacitor", "values": {"c": "100n", "v": "400"}, "pins": {"1": "IN", "2": "G"}},
  {"ref": "R1", "type": "resistor", "values": {"r": "1M"}, "pins": {"1": "G", "2": "GND"}},
  {"ref": "VL1", "type": "tube", "values": {"tube": "12AX7"}, "pins": {"A": "A", "G": "G", "K": "K"}},
  {"ref": "R2", "type": "resistor", "values": {"r": "100k", "w": "0.5"}, "pins": {"1": "B+", "2": "A"}},
  {"ref": "R3", "type": "resistor", "values": {"r": "1.5k"}, "pins": {"1": "K", "2": "GND"}},
  {"ref": "C2", "type": "electrolytic", "values": {"c": "22u", "v": "25"}, "pins": {"+": "K", "-": "GND"}},
  {"ref": "SC1", "type": "scope", "pins": {"CH1": "IN", "CH2": "A", "COM": "GND"}}],
 "summary": "expected numbers"}
```
- `type` is a key of `CadLib.LIB` (cad-components.js); values use the inspector's field keys (`AiCircuit.fields(c)`), SI prefixes allowed; select fields take one of the listed options. `AiCircuit.catalogue()` prints every type with pins and values.
- Every pin id maps to a net name; same name = same net; GND/0/ground = ground. `rails` lists ideal DC supplies to ground.
- One `tube` part is one tube section (a 12AX7 with both halves used is two parts, VL1.1 and VL1.2). A pentode's pins are A G1 G2 K; `connection: "triode"` straps it. Heaters are not drawn in the schematic.
- `AiDesign.check(design)` returns `{ parts, rails, problems }`; `AiDesign.layout(checked)` returns the sheet (`comps`, `wires`, `frame`).

## The project file (.json, File ▾ → Save)
`{ app, version, comps: [{ id, type, x, y, rot, params, label }], wires: [{ x1, y1, x2, y2 }], board }`. Coordinates on a 10-unit grid; pins come from `LIB[type].pins` (a function for parts whose pins depend on params). The first comp is usually the `frame` (title block).

## Checking a design in this repo
- `node scripts/design-check.mjs design.json` draws a design netlist in the CAD (headless Chromium), simulates it and prints the Checks (ratings, wiring, ERC) and each tube's and transistor's operating point. `--save out.json` writes the project file to open in the app. Run it on every design you write.
- Unit tests that need the library without a browser load `tube-db.js`, `sim-engine.js`, `cad-components.js`, `ai-circuit.js`, `ai-design.js` with `vm.runInThisContext` (see tests/design.test.mjs).
- In the page, `TubeCAD.circuitIssues()` is the Checks list, `TubeCAD.erc()` the ERC, `TubeCAD.measurements()` the measured values, `TubeCAD.ai.describe(true)` the circuit as the AI sees it.
- Examples to learn from: examples/01–20 (transistor stages, 12AX7, MOSFET amps, Gubin tube amps, 555 circuits, SE 2A3, PP EL84/6V6, SMD transistor power amps).

## The in-app AI knowledge pack
The reference files of this skill (except this file and schematic-style.md) are compiled into `ai-skill.js` by `node scripts/build-ai-skill.mjs`; the AI features put the sections they need into their system prompts (`AiSkill.pack(feature, circuit)`). After editing a reference file, run the script; `tests/ai-skill.test.mjs` fails when ai-skill.js is out of date.
