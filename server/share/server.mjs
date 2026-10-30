#!/usr/bin/env node
/* Short links for File ▾ → Share link…: a tiny store that keeps a packed design (the text the
   app puts after #c=, see cad-share.js) under a short id, so a link can be aerocat.tech/s/<id>.
     POST /api/share        body: the packed text   → 201 { "id": "Ab3xK9_qZw" }
     GET  /api/share/<id>                          → the packed text
   The id is the start of the text's SHA-256, so the same design always gets the same id and a
   stored design never changes. Only what unpacks to a Tube Amp CAD design is kept. No packages:
   Node's own http, zlib and crypto. Settings by environment variable, see below. */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { mkdir, readFile, readdir, rename, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PORT = +(process.env.PORT || 8080);
const DATA = process.env.DATA || "/data";
const MAX_TEXT = +(process.env.MAX_TEXT || 96 * 1024);          // one packed design, characters
const MAX_JSON = +(process.env.MAX_JSON || 4 * 1024 * 1024);     // what it may unpack to, bytes
const MAX_TOTAL = +(process.env.MAX_TOTAL || 512 * 1024 * 1024); // the whole store, bytes
// the sites whose pages may store designs (a browser sends Origin with every POST)
const ORIGINS = (process.env.ORIGINS || "https://aerocat.tech").split(",").map(s => s.trim()).filter(Boolean);
const ID_LEN = 10;
const ID = /^[A-Za-z0-9_-]{10}$/;

export const idOf = text => createHash("sha256").update(text).digest("base64url").slice(0, ID_LEN);
const pathOf = id => join(DATA, id.slice(0, 2), id);

// the packed text must unpack to a design: { s: 1, c, w } (the link's form) or { app: "TubeAmpCAD" } (3.135.0)
export function check(text) {
  if (!text || text.length > MAX_TEXT || !/^[A-Za-z0-9_-]+$/.test(text)) return "not a packed design";
  let d;
  try { d = JSON.parse(inflateRawSync(Buffer.from(text, "base64url"), { maxOutputLength: MAX_JSON }).toString("utf8")); }
  catch { return "does not unpack"; }
  const ok = d && ((d.s === 1 && Array.isArray(d.c) && Array.isArray(d.w)) || (d.app === "TubeAmpCAD" && Array.isArray(d.comps)));
  return ok ? null : "not a Tube Amp CAD design";
}

async function du(dir) {
  let n = 0;
  for (const e of await readdir(dir, { withFileTypes: true }).catch(() => [])) n += e.isDirectory() ? await du(join(dir, e.name)) : (await stat(join(dir, e.name))).size;
  return n;
}

export async function start({ port = PORT, log = console.log } = {}) {
  await mkdir(DATA, { recursive: true });
  let total = await du(DATA);
  const send = (res, code, body, headers = {}) => {
    res.writeHead(code, Object.assign({ "content-type": "application/json", "x-content-type-options": "nosniff" }, headers));
    res.end(typeof body === "string" ? body : JSON.stringify(body));
  };
  const server = createServer(async (req, res) => {
    const url = new URL(req.url, "http://x");
    try {
      if (req.method === "POST" && url.pathname === "/api/share") {
        const origin = req.headers.origin;
        if (origin && !ORIGINS.includes(origin)) return send(res, 403, { error: "origin not allowed" });
        let text = "", over = false;
        req.setEncoding("utf8");
        // past the limit the rest is read and dropped, so the client hears 413 rather than a cut connection
        for await (const chunk of req) { if (!over) text += chunk; if (text.length > MAX_TEXT) { over = true; text = ""; } }
        if (over) return send(res, 413, { error: "design too large" });
        text = text.trim();
        const bad = check(text);
        if (bad) return send(res, 400, { error: bad });
        const id = idOf(text), file = pathOf(id);
        const had = await stat(file).then(() => true, () => false);
        if (!had) {
          if (total + text.length > MAX_TOTAL) return send(res, 507, { error: "the store is full" });
          await mkdir(join(DATA, id.slice(0, 2)), { recursive: true });
          const tmp = file + ".tmp" + process.pid + Math.random().toString(36).slice(2);
          await writeFile(tmp, text); await rename(tmp, file);
          total += text.length;
          log(`stored ${id} (${text.length} chars)`);
        }
        return send(res, had ? 200 : 201, { id });
      }
      if (url.pathname === "/api/share/health") return send(res, 200, { ok: true, bytes: total });
      const m = url.pathname.match(/^\/api\/share\/([^/]+)$/);
      if (m && (req.method === "GET" || req.method === "HEAD")) {
        if (!ID.test(m[1])) return send(res, 404, { error: "no such design" });
        const text = await readFile(pathOf(m[1]), "utf8").catch(() => null);
        if (text === null) return send(res, 404, { error: "no such design" }, { "access-control-allow-origin": "*" });
        // a stored design never changes: cache it anywhere for good; any page may read it (local copies of the app)
        return send(res, 200, req.method === "HEAD" ? "" : text, { "content-type": "text/plain; charset=utf-8", "cache-control": "public, max-age=31536000, immutable", "access-control-allow-origin": "*" });
      }
      return send(res, 404, { error: "not found" });
    } catch (err) { log("error: " + err.message); if (!res.headersSent) send(res, 500, { error: "server error" }); }
  });
  await new Promise(r => server.listen(port, r));
  log(`share store on :${server.address().port}, data in ${DATA} (${total} bytes)`);
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) start();
