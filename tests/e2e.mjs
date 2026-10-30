#!/usr/bin/env node
/**
 * End-to-end test of the CAD, curve tracer and instruments in headless Chromium.
 *
 *   node tests/e2e.mjs                    # tests the source tree
 *   node tests/e2e.mjs dist/tube-amp-cad  # tests the packaged build
 *   E2E_PARTS=01,08 node tests/e2e.mjs   # only the parts whose names start so (CI runs them in groups)
 *
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
import { browser, check, errors, failures, server } from "./e2e/harness.mjs";

// the parts run in this order, each on the state the one before left (one browser, one CAD page)
const PARTS = ["01-editing", "02-instruments", "03-circuits", "04-windows", "05-sheets-files", "06-bom-semiconductors", "07-board", "08-ratings-spice-examples", "09-tolerance-ui", "10-analysis", "11-share", "16-revisions", "12-ai", "13-tune", "14-design", "15-datasheet"];
const only = (process.env.E2E_PARTS || "").split(",").map(x => x.trim()).filter(Boolean);
for (const p of PARTS.filter(p => !only.length || only.some(o => p.startsWith(o)))) await import(`./e2e/${p}.mjs`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);

await browser.close();
server.close();
const failed = failures();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
