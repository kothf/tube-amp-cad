#!/usr/bin/env node
/**
 * Builds the circuit engine's linear solver, wasm/solver.ts (AssemblyScript), into
 * sim-solver.wasm, which the simulation worker loads (sim-worker.js) and the tests read.
 *
 *   npm run build:wasm            build it
 *   npm run build:wasm -- --check fail when the committed sim-solver.wasm differs from its source (CI)
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";

const root = new URL("..", import.meta.url).pathname, target = join(root, "sim-solver.wasm"), check = process.argv.includes("--check");
const dir = mkdtempSync(join(tmpdir(), "tubecad-wasm-")), out = join(dir, "solver.wasm");
try {
  execFileSync(join(root, "node_modules/.bin/asc"), [join(root, "wasm/solver.ts"), "-O3", "--noAssert", "--runtime", "stub", "--enable", "simd", "--initialMemory", "2", "-o", out], { stdio: "inherit" });
  const bytes = readFileSync(out), sha = b => createHash("sha256").update(b).digest("hex").slice(0, 16);
  if (check) {
    const cur = existsSync(target) ? readFileSync(target) : Buffer.alloc(0);
    if (!cur.equals(bytes)) { console.error(`sim-solver.wasm (${sha(cur)}) is not built from wasm/solver.ts (${sha(bytes)}): run npm run build:wasm`); process.exit(1); }
    console.log(`sim-solver.wasm matches wasm/solver.ts (${bytes.length} bytes, sha256 ${sha(bytes)})`);
  } else {
    writeFileSync(target, bytes);
    console.log(`sim-solver.wasm: ${bytes.length} bytes (sha256 ${sha(bytes)})`);
  }
} finally { rmSync(dir, { recursive: true, force: true }); }
