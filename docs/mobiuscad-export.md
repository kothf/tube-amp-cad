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
  `bodies`: leads and metal copper, bulbs glass, electrolytic cans aluminium,
  cores steel, resistors alumina, other bodies glass-filled nylon. A part is
  drawn in its footprint's own frame and placed by its component's transform,
  so equal parts (every 12AX7, every 1k 5 W resistor) share one file.
- **The board** is one part in the frame of the STEP export: millimetres,
  x right, y up, z up from the board's bottom face. Its material is
  "PCB (effective)" (copper layers in parallel along it).
- **The assembly.** One component per part, named by its designator, fixed,
  the board `c_board`. Every `parts` entry has `file`, `link: { path, hash }`
  (the file name and the SHA-256 of its bytes) and `doc`, the same part
  document as a fallback copy. Names stay the same from one export to the
  next, so writing the folder again overwrites the same files.
- **The thermal study** ("Thermal 1", needs a simulation): a "Heat from
  package" load with every part's dissipation (the map's operating point),
  its board/heatsink shares and path, its limit, an electrolytic's rated life
  and a semiconductor's Rjc (the map's junction over its case); the package's
  split kept (each part's board share enters the board under it); the map's
  ambient, chassis (open, vented, closed) and which way is down; convection
  and radiation on every open surface; and the board's copper stack with its
  copper map: each layer's share of every cell of the map's grid and the
  plated barrels, so the board's conductivity follows its copper.
- **The same physics on both sides.** The map in Tube Amp CAD works out
  natural convection the way the study does in MöbiusCAD (its `naturalH`):
  face by face, h = C·(ΔT/L)^¼ with C 1.32 for a face looking up and 0.59
  looking down (L = area / perimeter), 1.42 for an upright face (L = its
  height), times the chassis factor (open 1, vented 0.8, closed 0.55), over
  the same faces the export writes: the board's faces, edges and hole walls
  and every face of each part's bodies and leads. Radiation is ε 0.9 from
  every face to the ambient. The package's split is always kept: a part's
  board share (through its leads, as the 3D view draws them, and the air gap
  under its body) is a heat into the board, since MöbiusCAD does not mesh
  the solder joints or the air.

Chrome and Edge write the folder in place (a folder picker). Other browsers,
and the ZIP command, download `<name>-mobiuscad.zip` holding the folder.

The files are checked with MöbiusCAD's own reader and kernel (`unpackAsm`,
`unpackPart`, `Assembler`), and the thermal study solves in MöbiusCAD.
