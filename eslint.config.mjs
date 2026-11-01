// Lint for the classic browser scripts (they share one global scope: a misspelt or missing
// name only shows at run time), the worker, the Node tests and the scripts. `npm run lint`;
// `npm test` runs it first.
import js from "@eslint/js";
import globals from "globals";

// what each script puts on window / globalThis for the others
const APP = ["Board3D", "BoardCore", "BoardFab", "BoardPathfinder", "BoardPlace", "BoardRoute", "BomLib", "CadAnalysis", "CadAnim", "CadBoardLink", "CadBom", "CadExport", "CadLib", "CadProbe",
  "AiCircuit", "AiClient", "CadAi", "CadTune", "AiDesign", "CadDesign", "KorenFit", "AiDatasheet", "CadDatasheet", "CadResults", "CadKicad", "KicadExport", "CadTolerance", "CadPower", "CadNoise", "CadListen", "CadSweep", "CadShare", "CadBlocks", "CadRevisions", "CadRevDialog", "CadRecent", "BoardAutoroute", "BoardPanels", "BoardDraw", "BoardMeasure", "BoardConstruct", "BoardCons", "Hints", "Icons", "MarkerPicker", "Panels", "PartNo", "PartSearch", "PdfExport", "PlotZoom", "ScopeMath", "SimPool", "SpiceImport", "SpiceModel", "ToolWindows",
  "TubeBias", "TubeAbout", "TubeSimEngine", "UiKit", "Viewer3D", "TUBE_CAPS", "TUBE_CAPS_LIKE", "TUBE_BULBS", "TUBE_BULBS_LIKE", "TUBE_DATABASE", "TUBE_RATINGS", "BoardApp", "FreeroutingStatus", "Instrument", "TubeCAD", "TubeTracer", "Bode", "Scope"];
const appGlobals = Object.fromEntries(APP.map(n => [n, "readonly"]));

export default [
  { ignores: ["dist/**", "node_modules/**", "wasm/**", ".mpn-cache/**"] },
  js.configs.recommended,
  {
    files: ["*.js"],
    languageOptions: { ecmaVersion: "latest", sourceType: "script", globals: { ...globals.browser, ...appGlobals } }
  },
  {
    files: ["sim-worker.js", "board-worker.js"],
    languageOptions: { globals: { ...globals.worker } }
  },
  {
    files: ["tests/**/*.mjs", "scripts/**/*.mjs", "eslint.config.mjs"],
    // browser code inside page.evaluate() callbacks runs in the page
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node, ...globals.browser, ...appGlobals } }
  },
  {
    files: ["server/**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", sourceType: "module", globals: { ...globals.node } }
  },
  {
    rules: {
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-unused-vars": ["error", { args: "none", caughtErrors: "none" }],
      // tube-db.js declares the globals it shares with `var`
      "no-redeclare": ["error", { builtinGlobals: false }]
    }
  },
  {
    // circuits built in the tests keep a name for each part they place, used or not
    files: ["tests/**/*.mjs"],
    rules: { "no-unused-vars": "off" }
  }
];
