#!/usr/bin/env node
/* Short links for File ▾ → Share link…: a tiny store that keeps a packed design (the text the
   app puts after #c=, see cad-share.js) under a short id, so a link can be aerocat.tech/s/<id>.
     POST /api/share        body: the packed text   → 201 { "id": "Ab3xK9_qZw" }
     GET  /api/share/<id>                          → the packed text
   The id is the start of the text's SHA-256, so the same design always gets the same id and a
   stored design never changes. Only what unpacks to a Tube Amp CAD design is kept. When the store
   would grow past MAX_TOTAL, the designs shared longest ago are deleted to make room (sharing a
   design again counts as new). The same server keeps the owner's private projects and their
   revisions under /api/rev/ (revisions.mjs, behind Cloudflare Access); they share the disk budget
   with the links but are never deleted to make room. No packages: Node's own http, zlib and
   crypto. Settings by environment variable, see below. */
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { inflateRawSync } from "node:zlib";
import { mkdir, readFile, readdir, rename, stat, unlink, utimes, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { accessCheck } from "./access.mjs";
import { revisionStore } from "./revisions.mjs";

const PORT = +(process.env.PORT || 8080);
const DATA = process.env.DATA || "/data";
const MAX_TEXT = +(process.env.MAX_TEXT || 96 * 1024);          // one packed design, characters
const MAX_JSON = +(process.env.MAX_JSON || 4 * 1024 * 1024);     // what it may unpack to, bytes
const MAX_TOTAL = +(process.env.MAX_TOTAL || 100 * 1024 * 1024); // links and revisions together, bytes: past it the oldest links go
const MAX_SHARES = +(process.env.MAX_SHARES || MAX_TOTAL);        // the links alone
const MAX_REVISIONS = +(process.env.MAX_REVISIONS || MAX_TOTAL);  // the revisions alone: past it no new ones (never deleted)
const REVS = process.env.REVS || "/revs";
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

// every stored design, oldest first: id → [size, time] (a Map keeps the order designs were put in)
async function scan() {
  const found = [];
  for (const d of await readdir(DATA, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory()) continue;
    for (const f of await readdir(join(DATA, d.name)).catch(() => [])) {
      if (!ID.test(f)) continue;                 // a .tmp left by a crash mid-write
      const st = await stat(join(DATA, d.name, f)).catch(() => null);
      if (st) found.push([f, st.size, st.mtimeMs]);
    }
  }
  found.sort((a, b) => a[2] - b[2]);
  return new Map(found.map(([id, size, t]) => [id, [size, t]]));
}

export async function start({ port = PORT, log = console.log, access = accessCheck() } = {}) {
  await mkdir(DATA, { recursive: true });
  const index = await scan();
  let total = 0;
  for (const [n] of index.values()) total += n;
  let revs = { used: () => 0 };
  // make room for `need` more bytes by deleting the oldest designs; `forRevision`: the room is for a
  // revision, which counts only against the whole store
  async function evict(need, forRevision) {
    for (const [id, [size]] of index) {
      if ((forRevision || total + need <= MAX_SHARES) && total + revs.used() + need <= MAX_TOTAL) break;
      await unlink(pathOf(id)).catch(() => {});
      index.delete(id); total -= size;
      log(`deleted ${id}, the oldest, to make room`);
    }
  }
  const budget = {
    maxTotal: MAX_TOTAL, maxShares: MAX_SHARES, maxRevisions: MAX_REVISIONS,
    total: () => total + revs.used(), shares: () => total, shareCount: () => index.size,
    makeRoom: need => evict(need, true),
    listShares: () => [...index].map(([id, [size, t]]) => ({ id, size, time: new Date(t).toISOString() })).reverse(),
    async deleteShare(id) {
      if (!ID.test(id) || !index.has(id)) return false;
      await unlink(pathOf(id)).catch(() => {});
      total -= index.get(id)[0]; index.delete(id);
      log(`deleted ${id} by hand`);
      return true;
    },
  };
  revs = await revisionStore({ dir: REVS, maxJson: MAX_JSON, origins: ORIGINS, access, budget, log });
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
        const had = index.has(id);
        if (had) {
          // shared again: it becomes the newest, so it is kept longest
          const now = new Date();
          await utimes(file, now, now).catch(() => {});
          index.delete(id); index.set(id, [text.length, now.getTime()]);
        } else {
          if (text.length > MAX_SHARES) return send(res, 507, { error: "the store is too small" });
          await evict(text.length);
          if (total + revs.used() + text.length > MAX_TOTAL) return send(res, 507, { error: "the store is full" });
          await mkdir(join(DATA, id.slice(0, 2)), { recursive: true });
          const tmp = file + ".tmp" + process.pid + Math.random().toString(36).slice(2);
          await writeFile(tmp, text); await rename(tmp, file);
          index.set(id, [text.length, Date.now()]); total += text.length;
          log(`stored ${id} (${text.length} chars)`);
        }
        return send(res, had ? 200 : 201, { id });
      }
      if (await revs.handle(req, res, url, send)) return;
      if (url.pathname === "/api/share/health") return send(res, 200, { ok: true, bytes: total, designs: index.size, max: MAX_TOTAL });
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
  log(`share store on :${server.address().port}, data in ${DATA} (${total} bytes), revisions in ${REVS} (${revs.used()} bytes)` + (access.configured ? "" : "; no ACCESS_TEAM: /api/rev/ refuses everyone"));
  return server;
}

if (import.meta.url === `file://${process.argv[1]}`) start();
