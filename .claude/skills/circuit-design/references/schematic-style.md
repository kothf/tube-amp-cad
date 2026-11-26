# Drawing a schematic so it looks hand-drawn

The drawing conventions (signal left to right, high voltage at the top and ground at the bottom, a column per stage, series parts flat and shunt parts upright, real wires between nearby parts, labels only for rails, far connections and other sheets, blocks grouped, nothing overlapping, instruments to the side) are kept in one place: the header comment of `sch-layout.js`, which also implements them for the AI's drawings (`SchLayout.draw`). Read it there and follow it when you draw or tidy a schematic by hand or in code; do not copy the list here.

The AI's side of it (signal order, a `block` per part, net names) lives in `AiDesign.rules()` in ai-design.js.

The hand-tidied examples (examples/13-, 14-, 03-) are the reference style: one power-rail symbol per supply net per sheet column, ground bars rather than a ground symbol per part, no wires through labels.
