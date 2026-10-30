/* Projects and their revisions, private to the site's owner (Cloudflare Access in front, the token
   checked again in access.mjs). Each project is a folder in REVS:
     <id>/project.json   { id, name, notes, created, updated, revs: [{ n, time, message, summary, size, hash, by, parent?, milestone?, thumb? }] }
     <id>/<n>.json.gz    the design as File › Save writes it, gzipped
     <id>/<n>.thumb      a small picture of its first sheet (PNG, JPEG or WebP), when the app sent one
   Nothing here is ever deleted except by the owner. Revisions and the short links (server.mjs)
   share one disk budget: when a revision needs room, the oldest short links go first; when
   revisions alone fill their part, saving one is refused (507).
     GET    /api/rev/me                         who is signed in, and what the store holds
     GET    /api/rev/login                      a page that tells its opener the login is done
     GET    /api/rev/projects                   every project, newest first
     POST   /api/rev/projects                   { name, notes? } → the new project
     GET    /api/rev/projects/<id>              the project with its revisions
     PATCH  /api/rev/projects/<id>              { name?, notes? }
     DELETE /api/rev/projects/<id>              the project and all its revisions
     GET    /api/rev/projects/<id>/export       the project with every revision's design, one JSON
     POST   /api/rev/projects/<id>/revs         { message, summary?, parent?, thumb?, design } → the new revision
     GET    /api/rev/projects/<id>/revs/<n>     that revision's design
     GET    /api/rev/projects/<id>/revs/<n>/thumb   its picture
     PATCH  /api/rev/projects/<id>/revs/<n>     { message?, milestone? }  (milestone: a short name, "" takes it off)
     DELETE /api/rev/projects/<id>/revs/<n>
     GET    /api/rev/shares                     every short link, newest first
     DELETE /api/rev/shares/<id>                one short link
   Requests that change something must come from one of ORIGINS (the browser's Origin header). */
import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, readdir, rename, rm, stat, statfs, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PID = /^[A-Za-z0-9_-]{10}$/;
const MAX_THUMB = 200 * 1024;
// a picture sent as a data: URL → { type, bytes }, or null
function thumbOf(url) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ""));
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  return bytes.length && bytes.length <= MAX_THUMB ? { type: m[1], bytes } : null;
}
// text as given, without control characters (tabs and new lines stay), at most n characters
const clip = (s, n) => [...String(s == null ? "" : s)].filter(c => c >= " " || c === "\n" || c === "\t").join("").trim().slice(0, n);

export async function revisionStore({ dir, maxJson, origins, access, budget, log }) {
  await mkdir(dir, { recursive: true });
  const projects = new Map();     // id → { meta, bytes }
  let bytes = 0;
  async function sizeOf(id) {
    let n = 0;
    for (const f of await readdir(join(dir, id)).catch(() => [])) { const st = await stat(join(dir, id, f)).catch(() => null); if (st && st.isFile()) n += st.size; }
    return n;
  }
  for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || !PID.test(d.name)) continue;
    const meta = await readFile(join(dir, d.name, "project.json"), "utf8").then(JSON.parse).catch(() => null);
    if (!meta) continue;
    const b = await sizeOf(d.name);
    projects.set(d.name, { meta, bytes: b }); bytes += b;
  }
  const used = () => bytes;
  async function put(file, data) {
    const tmp = file + ".tmp" + process.pid + randomBytes(4).toString("hex");
    await writeFile(tmp, data); await rename(tmp, file);
  }
  async function resize(id) {
    const p = projects.get(id); if (!p) return;
    const b = await sizeOf(id);
    bytes += b - p.bytes; p.bytes = b;
  }
  const saveMeta = (id, meta) => put(join(dir, id, "project.json"), JSON.stringify(meta));
  // room for `need` more bytes of revisions, or a reason why not
  async function room(need) {
    if (bytes + need > budget.maxRevisions) return `the revisions' part of the store is full (${budget.maxRevisions} bytes)`;
    await budget.makeRoom(need);
    if (budget.total() + need > budget.maxTotal) return "the store is full";
    return null;
  }
  // one write at a time: the budget and the project files stay in step
  let queue = Promise.resolve();
  const serial = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };

  const listItem = ({ meta, bytes: b }) => {
    const last = meta.revs[meta.revs.length - 1];
    return { id: meta.id, name: meta.name, notes: meta.notes, created: meta.created, updated: meta.updated, count: meta.revs.length, bytes: b, last: last ? { n: last.n, time: last.time, message: last.message } : null };
  };
  const loginPage = `<!doctype html><meta charset="utf-8"><title>Signed in</title>
<body style="background:#070b10;color:#e6edf3;font:15px system-ui;padding:40px;text-align:center">
<p>Signed in. You can close this tab and go back to Tube Amp CAD.</p>
<script>try{opener&&opener.postMessage({tubecadRev:"signed-in"},location.origin);setTimeout(function(){close()},400)}catch(e){}</script>`;

  async function readBody(req, limit) {
    let text = "", over = false;
    req.setEncoding("utf8");
    for await (const chunk of req) { if (!over) text += chunk; if (text.length > limit) { over = true; text = ""; } }
    if (over) { const e = new Error("too large"); e.code = 413; throw e; }
    try { return JSON.parse(text || "{}"); } catch { const e = new Error("not JSON"); e.code = 400; throw e; }
  }

  // → true when the request was one of ours (answered), false to let the caller go on
  async function handle(req, res, url, send) {
    if (!url.pathname.startsWith("/api/rev/") && url.pathname !== "/api/rev") return false;
    const priv = { "cache-control": "no-store" };
    let user;
    try { user = await access.who(req); }
    catch (e) { send(res, 401, { error: "sign in first: " + e.message, signin: "/api/rev/login" }, priv); return true; }
    const path = url.pathname.replace(/\/+$/, "").split("/").slice(3);     // after /api/rev
    const m = req.method;
    if (m !== "GET" && m !== "HEAD") {
      const origin = req.headers.origin;
      if (!origin || !origins.includes(origin)) { send(res, 403, { error: "origin not allowed" }, priv); return true; }
    }
    const fail = (code, error) => { send(res, code, { error }, priv); return true; };
    const ok = (body, code = 200) => { send(res, code, body, priv); return true; };
    try {
      if (path[0] === "login" && m === "GET") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...priv }); res.end(loginPage); return true; }
      if (path[0] === "me" && m === "GET") {
        const fs = await statfs(dir).catch(() => null);
        return ok({
          email: user.email,
          revisions: { bytes, projects: projects.size, count: [...projects.values()].reduce((n, p) => n + p.meta.revs.length, 0), max: budget.maxRevisions },
          shares: { bytes: budget.shares(), count: budget.shareCount(), max: budget.maxShares },
          total: { bytes: budget.total(), max: budget.maxTotal },
          disk: fs ? { free: fs.bavail * fs.bsize, size: fs.blocks * fs.bsize } : null,
        });
      }
      if (path[0] === "shares") {
        if (path.length === 1 && m === "GET") return ok(budget.listShares());
        if (path.length === 2 && m === "DELETE") return serial(async () => (await budget.deleteShare(path[1])) ? ok({ deleted: path[1] }) : fail(404, "no such link"));
        return fail(404, "not found");
      }
      if (path[0] !== "projects") return fail(404, "not found");
      if (path.length === 1) {
        if (m === "GET") return ok([...projects.values()].map(listItem).sort((a, b) => b.updated.localeCompare(a.updated)));
        if (m === "POST") {
          const b = await readBody(req, 16 * 1024);
          const name = clip(b.name, 120);
          if (!name) return fail(400, "a project needs a name");
          return serial(async () => {
            const why = await room(1024); if (why) return fail(507, why);
            let id; do id = randomBytes(8).toString("base64url").slice(0, 10); while (projects.has(id));
            const now = new Date().toISOString();
            const meta = { id, name, notes: clip(b.notes, 4000), created: now, updated: now, revs: [] };
            await mkdir(join(dir, id), { recursive: true });
            await saveMeta(id, meta);
            projects.set(id, { meta, bytes: 0 }); await resize(id);
            log(`project ${id} "${name}" created`);
            return ok(listItem(projects.get(id)), 201);
          });
        }
        return fail(405, "method not allowed");
      }
      const id = path[1], p = PID.test(id) && projects.get(id);
      if (!p) return fail(404, "no such project");
      if (path.length === 2) {
        if (m === "GET") return ok(Object.assign(listItem(p), { revs: p.meta.revs }));
        if (m === "PATCH") {
          const b = await readBody(req, 16 * 1024);
          return serial(async () => {
            if (b.name !== undefined) { const n = clip(b.name, 120); if (!n) return fail(400, "a project needs a name"); p.meta.name = n; }
            if (b.notes !== undefined) p.meta.notes = clip(b.notes, 4000);
            p.meta.updated = new Date().toISOString();
            await saveMeta(id, p.meta); await resize(id);
            return ok(listItem(p));
          });
        }
        if (m === "DELETE") return serial(async () => {
          await rm(join(dir, id), { recursive: true, force: true });
          bytes -= p.bytes; projects.delete(id);
          log(`project ${id} "${p.meta.name}" deleted by ${user.email}`);
          return ok({ deleted: id });
        });
        return fail(405, "method not allowed");
      }
      if (path.length === 3 && path[2] === "export" && m === "GET") {
        const revs = [];
        for (const r of p.meta.revs) revs.push(Object.assign({}, r, { design: JSON.parse(gunzipSync(await readFile(join(dir, id, r.n + ".json.gz"))).toString("utf8")) }));
        const name = p.meta.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || id;
        send(res, 200, { app: "TubeAmpCAD-project", project: Object.assign({}, p.meta, { revs }) }, Object.assign({ "content-disposition": `attachment; filename="${name}-revisions.json"` }, priv));
        return true;
      }
      if (path[2] !== "revs") return fail(404, "not found");
      if (path.length === 3) {
        if (m === "GET") return ok(p.meta.revs);
        if (m !== "POST") return fail(405, "method not allowed");
        const b = await readBody(req, maxJson + 64 * 1024);
        const d = b.design;
        if (!d || d.app !== "TubeAmpCAD" || !Array.isArray(d.comps) || !Array.isArray(d.wires)) return fail(400, "not a Tube Amp CAD design");
        const json = JSON.stringify(d);
        if (json.length > maxJson) return fail(413, "design too large");
        const hash = createHash("sha256").update(json).digest("base64url").slice(0, 16);
        return serial(async () => {
          const last = p.meta.revs[p.meta.revs.length - 1];
          if (last && last.hash === hash && !b.force) return ok(Object.assign({ same: true }, last));
          const gz = gzipSync(json, { level: 9 }), thumb = thumbOf(b.thumb);
          const why = await room(gz.length + (thumb ? thumb.bytes.length : 0) + 512); if (why) return fail(507, why);
          const n = (last ? last.n : 0) + 1;
          await put(join(dir, id, n + ".json.gz"), gz);
          if (thumb) await put(join(dir, id, n + ".thumb"), thumb.bytes);
          const rev = { n, time: new Date().toISOString(), message: clip(b.message, 2000), summary: clip(b.summary, 2000), size: gz.length, hash, by: user.email };
          // the revision it was made from, when that is not the latest (an earlier one opened, then changed)
          if (Number.isInteger(b.parent) && p.meta.revs.some(r => r.n === b.parent)) rev.parent = b.parent;
          if (thumb) rev.thumb = thumb.type;
          p.meta.revs.push(rev); p.meta.updated = rev.time;
          await saveMeta(id, p.meta); await resize(id);
          log(`project ${id} r${n} (${gz.length} bytes)`);
          return ok(rev, 201);
        });
      }
      const n = +path[3], i = /^\d+$/.test(path[3]) ? p.meta.revs.findIndex(r => r.n === n) : -1;
      if (i < 0) return fail(404, "no such revision");
      if (path.length === 5 && path[4] === "thumb" && m === "GET") {
        const t = p.meta.revs[i].thumb, bytes = t && await readFile(join(dir, id, n + ".thumb")).catch(() => null);
        if (!bytes) return fail(404, "no picture");
        // a revision never changes: the browser may keep its picture
        res.writeHead(200, { "content-type": t, "x-content-type-options": "nosniff", "cache-control": "private, max-age=31536000, immutable" });
        res.end(bytes);
        return true;
      }
      if (path.length !== 4) return fail(404, "not found");
      if (m === "GET") {
        const gz = await readFile(join(dir, id, n + ".json.gz"));
        res.writeHead(200, { "content-type": "application/json", "x-content-type-options": "nosniff", ...priv });
        res.end(gunzipSync(gz));
        return true;
      }
      if (m === "PATCH") {
        const b = await readBody(req, 16 * 1024);
        return serial(async () => {
          if (b.message !== undefined) p.meta.revs[i].message = clip(b.message, 2000);
          if (b.milestone !== undefined) { const t = clip(b.milestone, 60); if (t) p.meta.revs[i].milestone = t; else delete p.meta.revs[i].milestone; }
          await saveMeta(id, p.meta); await resize(id);
          return ok(p.meta.revs[i]);
        });
      }
      if (m === "DELETE") return serial(async () => {
        await unlink(join(dir, id, n + ".json.gz")).catch(() => {});
        await unlink(join(dir, id, n + ".thumb")).catch(() => {});
        p.meta.revs.splice(i, 1);
        await saveMeta(id, p.meta); await resize(id);
        log(`project ${id} r${n} deleted by ${user.email}`);
        return ok({ deleted: n });
      });
      return fail(405, "method not allowed");
    } catch (err) {
      if (err.code === 413 || err.code === 400) return fail(err.code, err.message);
      throw err;
    }
  }
  return { handle, used };
}
