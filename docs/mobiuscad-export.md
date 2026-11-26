# Export to MöbiusCAD

**Board → Export ▾ → MöbiusCAD assembly…** (or **Export to MöbiusCAD** under
the 3D view's thermal scale) writes the board and every part as MöbiusCAD
files, so the board can go into a chassis or heatsink assembly in MöbiusCAD
and the whole thing can be simulated. **MöbiusCAD assembly (ZIP)** gives the
same folder as one ZIP.

The layout follows MöbiusCAD's plan for assemblies that reference part files:

```
<name>.mcadasm                  the assembly: components, links to the part files, the thermal study
<design> board.mcadprt          the board (outline, cut-outs, drilled holes)
12AX7 NOVAL-9.mcadprt           a part, one file for every part drawn the same way
1kΩ 5W AXIAL-30.48.mcadprt
…
```

- **Parts.** Each distinct part is one `.mcadprt` named `<value> <footprint>`
  (a second drawing under one name gets ` (2)`). Every solid is its own
  Imported feature, with BREP text written by `board-brep.js` (exact planes
  and cylinders), so every solid is its own body with its own material in
  `bodies`: leads tinned copper, tabs nickel-plated copper, TO-18 cans
  Kovar, bulbs glass, electrolytic cans aluminium (sleeved, the bare top
  apart), cores steel, resistors lacquered alumina, packages epoxy, other
  bodies glass-filled nylon. Each material carries `k` (W/m·K), `density`
  (g/cm³), `cp` (J/kg·K) and `emis` (0–1); they come from the 3D view's own
  table (`Board3D.MATERIALS`), the one the thermal map uses. Inside the
  parts: a power semiconductor in TO-126/220/247/3P/264, SOT-89, SOT-223,
  DPAK or D2PAK has a body "Die" (silicon, 0.25 mm thick) on its "Tab",
  with its middle lead (drain, collector) joined to the tab as in the real part,
  sized so its junction to case (through the silicon, 25 µm of solder and
  the spreading into the tab) is the datasheet's, and its moulding is split
  into boxes round it so no two bodies overlap; an electrolytic (radial,
  snap-in, SMD) is its can as a tube round a "Core" (wound foil and paper,
  k 1 W/m·K) over a "Bung" (rubber), an axial one the same lying down; a
  TO-92, SOT-23, SOIC or DIP has a "Frame" (the copper lead-frame paddle)
  with the "Die" on it inside its moulding, and a metal can (TO-18, TO-1,
  TO-5, MP) is hollow with the "Die" on its header, on a "Die attach" layer
  (silver epoxy, k 2 W/m·K) as thick as makes the junction to case the
  datasheet's (none when the part has no rating; since 3.261.0). In
  SOT-89/SOT-223/DPAK/D2PAK the tab's frame runs on under the moulding past
  its middle, so the die sits on copper, not epoxy (3.261.0); a transformer's winding sits beside its
  core, not through it. A part is
  drawn in its footprint's own frame and placed by its component's transform,
  so equal parts (every 12AX7, every 1k 5 W resistor) share one file; a part drawn the same but of
  another value (an IRF9540 beside an IRF540) gets its own.
- **The board** is one part in the frame of the STEP export: millimetres,
  x right, y up, z up from the board's bottom face. Its material is
  "PCB (effective)" (copper layers in parallel along it).
- **The assembly.** One component per part, named by its designator, fixed,
  the board `c_board`. Every `parts` entry has `file`, `link: { path, hash }`
  (the file name and the SHA-256 of its bytes) and `doc`, the same part
  document as a fallback copy. Names stay the same from one export to the
  next, so writing the folder again overwrites the same files.
- **The thermal study** ("Thermal 1", needs a simulation): a "Heat from
  package" load with every part's dissipation (the map's operating point)
  and only that: no `board`, `sink`, `path`, `into` or `split` (since
  3.260.0), so MöbiusCAD treats each part as a plain heat source and finds
  every path itself, through the solder joints into the board, by
  convection and radiation, and into any heatsink or chassis put in the
  assembly there; its limit, an electrolytic's rated life
  and a semiconductor's Rjc (the map's junction over its case); `bodies`:
  the names of the bodies in the part's file that make its heat (the die,
  the core, a valve's bulb, otherwise every body but the leads), so
  MöbiusCAD can inject the heat there and read the junction off the die;
  and the board's copper stack with its
  copper map: each layer's share of every cell of the map's grid and the
  plated barrels, so the board's conductivity follows its copper.
- **No surroundings** (since 3.262.0): the ambient, the chassis (open,
  vented, closed), which way is down and the cooling (convection and
  radiation) are not written: they belong to the assembly the board goes
  into. The study has no supports, so MöbiusCAD (1.762.0 and later) shows
  **Add surroundings** under Cooling: still air and radiation on every open
  surface in one click, then the ambient and enclosure beside it.
- **The same physics on both sides.** The map in Tube Amp CAD works out
  natural convection the way the study does in MöbiusCAD (its `naturalH`):
  face by face, h = C·(ΔT/L)^¼ with C 1.32 for a face looking up and 0.59
  looking down (L = area / perimeter), 1.42 for an upright face (L = its
  height), times the chassis factor (open 1, vented 0.8, closed 0.55), over
  the same faces the export writes: the board's faces, edges and hole walls
  and every face of each part's bodies and leads. Radiation goes from every
  face to the ambient at its body's emissivity (the board 0.9), and a lead
  conducts at its material's k (tinned copper, 385 W/m·K) in both apps.
- **Solder joints** (since 3.260.0): every lead standing in a drilled pad
  gets two "Solder n" bodies in its part file (Solder SAC305, k 58 W/m·K):
  a tube filling the hole from the lead to the hole wall through the board,
  and a fillet 0.4 mm thick under the board on the pad (at least 0.25 mm
  past the hole). They touch the lead, the hole wall and the board's bottom
  face, so the lead's heat reaches the board by conduction and no fixed
  board share is needed. Since MöbiusCAD 1.761.0 the still air under a part
  lying close to the board conducts too (gaps up to 2 mm), as on the map.

Chrome and Edge write the folder in place (a folder picker). Other browsers,
and the ZIP command, download `<name>-mobiuscad.zip` holding the folder.

The files are checked with MöbiusCAD's own reader and kernel (`unpackAsm`,
`unpackPart`, `Assembler`), and the thermal study solves in MöbiusCAD.
