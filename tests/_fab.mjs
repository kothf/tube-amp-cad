import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { chromium } from "playwright";
const root = "/home/user/tube-amp-cad", out = process.argv[2];
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".wasm": "application/wasm", ".json": "application/json" };
createServer(async (req, res) => { const p = join(root, new URL(req.url, "http://x").pathname.replace(/\/$/, "/index.html")); try { const b = await readFile(p); res.writeHead(200, { "content-type": MIME[extname(p)] || "application/octet-stream" }); res.end(b); } catch { res.writeHead(404); res.end(); } }).listen(8765);
const b = await chromium.launch(); const ctx = await b.newContext({ viewport: { width: 1500, height: 900 } });
const cad = await ctx.newPage(); await cad.goto("http://localhost:8765/circuit_sandbox.html"); await cad.waitForTimeout(1500);
for (const e of process.argv.slice(3)) {
  const f = await cad.evaluate(p => TubeCAD.EXAMPLES.find(x => x.file.startsWith(p)).file, e);
  const s0 = await cad.evaluate(() => TubeCAD.state.sim.seq); cad.once("dialog", d => d.accept());
  await cad.evaluate(f => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => x.file === f)), f);
  await cad.waitForFunction(s0 => TubeCAD.state.sim.seq !== s0 && !TubeCAD.state.sim.busy && TubeCAD.state.sim.result, s0, { timeout: 60000 }).catch(() => {});
  await cad.waitForTimeout(500);
  const bd = await ctx.newPage(); bd.on("pageerror", x => console.log("  pageerror", x.message));
  await bd.goto("http://localhost:8765/board.html");
  await bd.waitForFunction(() => window.BoardApp && BoardApp.state.model, null, { timeout: 15000 }); await bd.waitForTimeout(1000);
  if (await bd.$("#btn-arrange")) { await bd.click("#btn-arrange"); await bd.waitForTimeout(500);
    await bd.waitForFunction(() => BoardApp.router.up, null, { timeout: 20000 }).catch(() => {});
    await bd.evaluate(async () => { const S = BoardApp.state; S.board.rules.ground = "plain"; if (!S.board.zones.length) BoardApp.groundPlane("B.Cu"); BoardApp.commit(); await BoardApp.autoRoute(); }); }
  const files = await bd.evaluate(() => BoardApp.fabFiles());
  const dir = join(out, e); await mkdir(dir, { recursive: true });
  for (const [n, t] of Object.entries(files)) await writeFile(join(dir, n), t);
  const info = await bd.evaluate(() => { const S = BoardApp.state; return { tracks: S.board.tracks.length, vias: S.board.vias.length, zones: S.board.zones.length, un: S.conn.unrouted, drc: S.drc.length }; });
  console.log(e, Object.keys(files).join(" "), JSON.stringify(info));
  await bd.close();
}
await b.close(); process.exit(0);
