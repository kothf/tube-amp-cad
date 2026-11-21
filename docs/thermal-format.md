# The thermal package (`tubecad-thermal`, version 1)

Board → Export ▾ → **Thermal map (ZIP)** writes `<name>-thermal.zip`. It holds the thermal map of
the board for other programs: a viewer (ParaView, PyVista), a FEM program that will simulate the
board properly, or a CAD that wants to show the map on the STEP model.

| File | What |
|---|---|
| `<name>-thermal.json` | The manifest. Read it first. |
| `<name>-thermal.vtu` | The surfaces with a temperature at every point (VTK XML UnstructuredGrid, ASCII). |
| `<name>-heat-sources.csv` | One row per part: heat, where it goes, temperatures. |
| `<name>-thermal.png` | The 3D view with its scale (absent without WebGL). |
| `<name>.step` | The board and the parts as solids, exported at the same moment. |
| `README-thermal.txt` | The conditions and the units, for a person. |

The numbers are an estimate, about ±15 °C (`accuracy_C`). The air inside a chassis is not
simulated.

## Frame and units

Millimetres, °C, W, W/m². x to the right, y up, z up from the board's bottom face. It is the frame
of the STEP file, so a point has the same coordinates in the mesh, the CSV, the manifest and the
STEP. (The layout's own y runs down: `y_step = -y_layout`.) Leads reach below z = 0.

## The manifest

```json
{
  "format": "tubecad-thermal",
  "version": 1,
  "app": "Tube Amp CAD 3.241.0",
  "created": "2026-11-21T20:00:00Z",
  "design": "EL84 push-pull",
  "units": { "length": "mm", "temperature": "C", "power": "W", "flux": "W/m2" },
  "frame": "same as the STEP export: x right, y up, z up from the board's bottom face",
  "files": { "manifest": "amp-thermal.json", "mesh": "amp-thermal.vtu", "sources": "amp-heat-sources.csv",
             "readme": "README-thermal.txt", "picture": "amp-thermal.png", "step": "amp.step" },
  "settings": { "ambient_C": 40, "enclosure": "closed", "orientation": "horizontal-up", "operating_point": "simulated",
                "grid_mm": 1.3, "emissivity": 0.9, "board_thickness_mm": 1.6, "copper_um": 35, "layers": 2 },
  "board": { "size_mm": [170, 105], "hottest_C": 87.2, "hottest_at_mm": [113.1, -75.4, 1.6] },
  "accuracy_C": 15,
  "range_C": [45, 156.7],
  "total_W": 24.96,
  "mesh": { "points": 34912, "cells": 36770, "encoding": "ascii", "arrays": ["Points", "Temperature_C", "PartId", "..."] },
  "parts": [
    { "part_id": 1, "designator": "VL3", "step_bodies": ["VL3-1", "VL3-2"], "part": "EL84",
      "heat_path": "air", "mount": "socket", "bbox_mm": [102.9, -87.1, -1.2, 125.1, -64.9, 79], "volume_mm3": 30390,
      "p_total_W": 10.645, "p_board_W": 1.2687, "p_air_W": 9.3763, "p_sink_W": 0,
      "t_body_C": 155.9, "t_kind": "bulb", "t_junction_C": null, "t_pads_C": 85.4,
      "t_limit_C": null, "margin_C": null, "life_h": null, "source": "simulated",
      "assumed_heatsink": false, "off_board": false }
  ]
}
```

- `enclosure`: `open`, `vented`, `closed`. `orientation`: `horizontal-up` (parts up),
  `horizontal-down`, `vertical`. `operating_point`: `simulated` (the signal's average where the run
  had a signal) or `idle`.
- `range_C` is the lowest and highest `Temperature_C` of the mesh: the range for a colour scale.
- `parts` holds every part drawn on the board or giving off heat, the largest heat first.
  `part_id` is the `PartId` of its cells in the mesh. `bbox_mm` is min x, y, z then max x, y, z.
  `step_bodies` are the names of its solids in the STEP (`MANIFOLD_SOLID_BREP('VL3-1', …)`).
  A part wired off the board has `off_board: true`, no solids, no box and no temperature.
- `heat_path` is where most of the heat goes: `board`, `air`, `heatsink`, `chassis`.
  `mount`: `lying`, `standing`, `upright`, `smd`, `socket`, `ra-on-copper` (a tab bent over onto
  the board's copper), `on-heatsink`, `on-chassis`, `wired`.
- `t_body_C` is the part's surface, the value its solids carry in the mesh; `t_kind` says what it
  is: `body`, `case`, `bulb`, or `board` (a part with no heat of its own takes the board's
  temperature under it). `t_junction_C` is given for semiconductors, `t_pads_C` is the board at
  the part's pads (its leads carry it in the mesh). `margin_C` = limit − junction (or body);
  negative means over the limit. `assumed_heatsink`: the heatsink is the app's guess (a TO-220 or
  larger case over 2 W with no cooling set).

**Compatibility.** A reader refuses a `format` other than `tubecad-thermal`, accepts `version` 1
and ignores keys and arrays it does not know. New keys and arrays may appear within version 1. A
change to a required one makes version 2. Required in the mesh: `Points`, `Temperature_C`,
`PartId`.

## The mesh

One `<Piece>` of a VTK XML `UnstructuredGrid`, every `DataArray` in `format="ascii"` (numbers
separated by white space).

| Array | Where | Type | Meaning |
|---|---|---|---|
| `Points` | points | Float32 × 3 | x, y, z in mm |
| `Temperature_C` | PointData | Float32 | the surface's temperature |
| `connectivity`, `offsets`, `types` | Cells | Int32, Int32, UInt8 | VTK's cells: type 9 = quad, 5 = triangle |
| `PartId` | CellData | Int32 | 0 = the board, else `part_id` |
| `Face` | CellData | Int8 | 0 part, 1 board top, 2 board bottom, 3 board edge and cut-out walls |
| `Power_W` | CellData | Float32 | the whole part's dissipation, the same on all its cells; 0 on the board |
| `HeatFlux_W_m2` | CellData | Float32 | heat leaving the board's face to the air; 0 elsewhere |
| `Ambient_C`, `GridStep_mm` | FieldData | Float32 | the ambient and the board grid's size |

- The board's top (z = thickness) and bottom (z = 0) are quads at the solver's grid, one per cell,
  with shared corner points; a cut-out has no cells. Drilled holes are not cut out of the mesh.
- A part's solids are triangles. Points are not shared between solids, so `computeVertexNormals`
  keeps their edges sharp. Every point of a solid has the same temperature.
- `offsets[i]` is where cell `i` ends in `connectivity`; its points are
  `connectivity[offsets[i-1] .. offsets[i])`.

### Reading it (TypeScript, three.js)

```ts
const man = JSON.parse(text(zip[`${name}-thermal.json`]));
if (man.format !== "tubecad-thermal" || man.version !== 1) throw new Error("not a thermal package I know");
const xml = new DOMParser().parseFromString(text(zip[man.files.mesh]), "application/xml");
const arr = (n: string) => xml.querySelector(`DataArray[Name="${n}"]`)!.textContent!.trim().split(/\s+/).map(Number);
const P = arr("Points"), T = arr("Temperature_C"), conn = arr("connectivity"), offs = arr("offsets"), types = arr("types"), partId = arr("PartId");
const index: number[] = [], triPart: number[] = [];
for (let c = 0, a = 0; c < offs.length; a = offs[c++]) {
  const q = conn.slice(a, offs[c]);
  index.push(q[0], q[1], q[2]); triPart.push(partId[c]);
  if (types[c] === 9) { index.push(q[0], q[2], q[3]); triPart.push(partId[c]); }
}
const g = new THREE.BufferGeometry();
g.setAttribute("position", new THREE.Float32BufferAttribute(P, 3));
g.setAttribute("temperature", new THREE.Float32BufferAttribute(T, 1));
g.setIndex(index); g.computeVertexNormals();
// shader: colour = palette((temperature - man.range_C[0]) / (man.range_C[1] - man.range_C[0]))
// picking: the hit triangle's triPart → man.parts[id - 1] for the card (0 = the board)
```

Draw this mesh in place of the STEP's shaded bodies: it is the same geometry in the same frame, so
nothing has to be matched. To colour the STEP's own faces instead, match each solid to a part by
its name (`step_bodies`; OCCT's XCAF reader gives the names with `read.stepcaf.subshapes.name` = 1)
or by `bbox_mm`, and give each vertex the temperature of the nearest mesh point.

### Python

```python
import pyvista
m = pyvista.read("amp-thermal.vtu")
m.plot(scalars="Temperature_C")
print(m.point_data["Temperature_C"].max())
```

## The CSV

UTF-8, commas, dot decimals, CRLF, one header row. The columns are the manifest's `parts` keys,
with `step_bodies` joined by `;` and the box given as its centre and size:

```
part_id,designator,step_bodies,part,heat_path,mount,x_mm,y_mm,z_mm,dx_mm,dy_mm,dz_mm,volume_mm3,p_total_W,p_board_W,p_air_W,p_sink_W,t_body_C,t_kind,t_limit_C,margin_C,life_h,source,t_junction_C,t_pads_C
```

`p_total_W = p_board_W + p_air_W + p_sink_W`. For a FEM run on the STEP: give each body in
`step_bodies` a heat source of `p_total_W` (or `p_total_W / volume_mm3 × 1e9` W/m³ over its
solids), set FR-4 and copper as in the README, and the ambient. For `heatsink` and `chassis`
paths, model the heatsink or take `p_sink_W` out at that face.
