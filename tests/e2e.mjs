#!/usr/bin/env node
/**
 * End-to-end test of the CAD, curve tracer and instruments in headless Chromium.
 *
 *   node tests/e2e.mjs                    # tests the source tree
 *   node tests/e2e.mjs dist/tube-amp-cad  # tests the packaged build
 *
 * Set CHROMIUM_PATH to use a specific browser binary.
 */
import { browser, check, errors, failures, server } from "./e2e/harness.mjs";

// the parts run in this order, each on the state the one before left (one browser, one CAD page)
const PARTS = ["01-editing", "02-instruments", "03-circuits", "04-windows", "05-sheets-files", "06-bom-semiconductors", "07-board", "08-ratings-spice-examples", "09-tolerance-ui"];
for (const p of PARTS) await import(`./e2e/${p}.mjs`);

check(errors.length === 0, `no page errors${errors.length ? `: ${errors.slice(0, 3).join(" | ")}` : ""}`);

await browser.close();
server.close();
const failed = failures();
console.log(failed ? `\n${failed} check(s) failed` : "\nAll checks passed");
process.exit(failed ? 1 : 0);
