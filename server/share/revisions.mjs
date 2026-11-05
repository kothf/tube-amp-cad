/* Projects and their revisions, private to the site's owner (Cloudflare Access in front, the token
   checked again in access.mjs). Each project is a folder in REVS:
     <id>/project.json   { id, name, notes, status?, tags?, created, updated, deleted?,
                           revs: [{ n, time, message, summary, size, hash, by, parent?, milestone?, thumb?, bthumb?, metrics?, files?, deleted? }] }
     <id>/<n>.json.gz    the design as File › Save writes it, gzipped
     <id>/<n>.thumb      a small picture of its first sheet (PNG, JPEG or WebP), when the app sent one
     <id>/<n>.bthumb     a small picture of its board, when it has one
     <id>/<n>.files/     the release package kept with a milestone (Gerbers, BOM, PDF…), when sent
   Deleting moves a project or a revision to the trash (it keeps its files and its room); the trash
   is emptied after TRASH_DAYS (30) or by hand. Revisions and the short links (server.mjs) share one
   disk budget: when a revision needs room, the oldest short links go first; when revisions alone
   fill their part, saving one is refused (507).
     GET    /api/rev/me                         who is signed in, and what the store holds
     GET    /api/rev/login                      a page that tells its opener the login is done
     GET    /api/rev/projects                   every project, newest first
     POST   /api/rev/projects                   { name, notes? } → the new project
     POST   /api/rev/import                     a project as /export writes it → a new project with all its revisions
     GET    /api/rev/search?q=                  projects and revisions whose name, notes, message, summary, milestone or tags hold q
     GET    /api/rev/trash                      what is in the trash, and for how long
     GET    /api/rev/projects/<id>              the project with its revisions
     PATCH  /api/rev/projects/<id>              { name?, notes?, status?, tags? }
     DELETE /api/rev/projects/<id>              to the trash (?purge=1: out of the trash, for good)
     POST   /api/rev/projects/<id>/restore      back from the trash
     GET    /api/rev/projects/<id>/export       the project with every revision's design, pictures and files, one JSON
     POST   /api/rev/projects/<id>/revs         { message, summary?, parent?, thumb?, bthumb?, metrics?, design } → the new revision
     GET    /api/rev/projects/<id>/revs/<n>     that revision's design
     GET    /api/rev/projects/<id>/revs/<n>/thumb    its picture (…/bthumb: its board's)
     PATCH  /api/rev/projects/<id>/revs/<n>     { message?, milestone?, metrics? }  (milestone: a short name, "" takes it off)
     DELETE /api/rev/projects/<id>/revs/<n>     to the trash (?purge=1: for good)
     POST   /api/rev/projects/<id>/revs/<n>/restore
     POST   /api/rev/projects/<id>/revs/<n>/files       { name, type, data (base64) } → kept with the revision
     GET    /api/rev/projects/<id>/revs/<n>/files/<name>
     DELETE /api/rev/projects/<id>/revs/<n>/files/<name>
     GET    /api/rev/shares                     every short link, newest first
     DELETE /api/rev/shares/<id>                one short link
   Requests that change something must come from one of ORIGINS (the browser's Origin header). */
import { createHash, randomBytes } from "node:crypto";
import { gunzipSync, gzipSync } from "node:zlib";
import { mkdir, readFile, readdir, rename, rm, stat, statfs, writeFile } from "node:fs/promises";
import { join } from "node:path";

const PID = /^[A-Za-z0-9_-]{10}$/;
const FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/;
const MAX_THUMB = 200 * 1024;
const MAX_FILE = 8 * 1024 * 1024;
const MAX_FILES = 12;
const STATUSES = ["", "idea", "design", "building", "done", "archived"];
const DAY = 86400e3;
// a picture sent as a data: URL → { type, bytes }, or null
function thumbOf(url) {
  const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ""));
  if (!m) return null;
  const bytes = Buffer.from(m[2], "base64");
  return bytes.length && bytes.length <= MAX_THUMB ? { type: m[1], bytes } : null;
}
// text as given, without control characters (tabs and new lines stay), at most n characters
const clip = (s, n) => [...String(s == null ? "" : s)].filter(c => c >= " " || c === "\n" || c === "\t").join("").trim().slice(0, n);
// simulation results kept with a revision: { name: number }, at most 40, names short
function metricsOf(m) {
  if (!m || typeof m !== "object" || Array.isArray(m)) return null;
  const out = {};
  for (const [k, v] of Object.entries(m).slice(0, 40)) {
    const key = clip(k, 40);
    if (key && typeof v === "number" && isFinite(v)) out[key] = +v.toPrecision(6);
  }
  return Object.keys(out).length ? out : null;
}
const tagsOf = t => [...new Set((Array.isArray(t) ? t : String(t || "").split(",")).map(x => clip(x, 30).toLowerCase()).filter(Boolean))].slice(0, 12);
const MIME = /^[a-z]+\/[a-z0-9.+-]{1,60}$/;

export async function revisionStore({ dir, maxJson, origins, access, budget, log, trashDays = +(process.env.TRASH_DAYS || 30), now = () => Date.now() }) {
  await mkdir(dir, { recursive: true });
  const projects = new Map();     // id → { meta, bytes }
  let bytes = 0;
  async function sizeOf(path) {
    let n = 0;
    for (const d of await readdir(path, { withFileTypes: true }).catch(() => [])) {
      if (d.isDirectory()) n += await sizeOf(join(path, d.name));
      else { const st = await stat(join(path, d.name)).catch(() => null); if (st && st.isFile()) n += st.size; }
    }
    return n;
  }
  for (const d of await readdir(dir, { withFileTypes: true }).catch(() => [])) {
    if (!d.isDirectory() || !PID.test(d.name)) continue;
    const meta = await readFile(join(dir, d.name, "project.json"), "utf8").then(JSON.parse).catch(() => null);
    if (!meta) continue;
    const b = await sizeOf(join(dir, d.name));
    projects.set(d.name, { meta, bytes: b }); bytes += b;
  }
  const used = () => bytes;
  async function put(file, data) {
    const tmp = file + ".tmp" + process.pid + randomBytes(4).toString("hex");
    await writeFile(tmp, data); await rename(tmp, file);
  }
  async function resize(id) {
    const p = projects.get(id); if (!p) return;
    const b = await sizeOf(join(dir, id));
    bytes += b - p.bytes; p.bytes = b;
  }
  const saveMeta = (id, meta) => put(join(dir, id, "project.json"), JSON.stringify(meta));
  // room for `need` more bytes of revisions, or a reason why not
  async function room(need) {
    if (bytes + need > budget.maxRevisions) return `the revisions' part of the store is full (${budget.maxRevisions} bytes): empty the trash or delete some`;
    await budget.makeRoom(need);
    if (budget.total() + need > budget.maxTotal) return "the store is full";
    return null;
  }
  // one write at a time: the budget and the project files stay in step
  let queue = Promise.resolve();
  const serial = fn => { const p = queue.then(fn); queue = p.catch(() => {}); return p; };

  const live = meta => meta.revs.filter(r => !r.deleted);
  const revFiles = (id, n) => [join(dir, id, n + ".json.gz"), join(dir, id, n + ".thumb"), join(dir, id, n + ".bthumb"), join(dir, id, n + ".files")];
  async function dropRev(id, meta, i) {
    const n = meta.revs[i].n;
    for (const f of revFiles(id, n)) await rm(f, { recursive: true, force: true });
    meta.revs.splice(i, 1);
  }
  // the trash: what was deleted longer ago than trashDays goes for good
  async function purgeOld() {
    const limit = now() - trashDays * DAY;
    for (const [id, p] of [...projects]) {
      if (p.meta.deleted && Date.parse(p.meta.deleted) < limit) {
        await rm(join(dir, id), { recursive: true, force: true });
        bytes -= p.bytes; projects.delete(id);
        log(`project ${id} "${p.meta.name}" emptied from the trash`);
        continue;
      }
      let changed = false;
      for (let i = p.meta.revs.length - 1; i >= 0; i--) {
        const r = p.meta.revs[i];
        if (r.deleted && Date.parse(r.deleted) < limit) { await dropRev(id, p.meta, i); changed = true; }
      }
      if (changed) { await saveMeta(id, p.meta); await resize(id); }
    }
  }
  await purgeOld();
  const timer = setInterval(() => { serial(purgeOld).catch(e => log("trash: " + e.message)); }, 6 * 3600e3);
  if (timer.unref) timer.unref();

  const listItem = ({ meta, bytes: b }) => {
    const revs = live(meta), last = revs[revs.length - 1];
    const pic = [...revs].reverse().find(r => r.thumb);
    return {
      id: meta.id, name: meta.name, notes: meta.notes, status: meta.status || "", tags: meta.tags || [], created: meta.created, updated: meta.updated,
      count: revs.length, milestones: revs.filter(r => r.milestone).length, bytes: b,
      last: last ? { n: last.n, time: last.time, message: last.message, milestone: last.milestone } : null,
      thumb: pic ? pic.n : null,
    };
  };
  const loginPage = `<!doctype html><meta charset="utf-8"><title>Signed in</title>
<body style="background:#070b10;color:#e6edf3;font:15px system-ui;padding:40px;text-align:center">
<p>Signed in. You can close this tab and go back to Tube Amp CAD.</p>
<script>try{opener&&opener.postMessage({tubecadRev:"signed-in"},location.origin);setTimeout(function(){close()},400)}catch(e){}</script>`;

  async function readBody(req, limit) {
    const chunks = []; let len = 0, over = false;
    for await (const chunk of req) { if (!over) { chunks.push(chunk); len += chunk.length; } if (len > limit) { over = true; chunks.length = 0; } }
    if (over) { const e = new Error("too large"); e.code = 413; throw e; }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}"); } catch { const e = new Error("not JSON"); e.code = 400; throw e; }
  }
  const isDesign = d => d && d.app === "TubeAmpCAD" && Array.isArray(d.comps) && Array.isArray(d.wires);
  const hashOf = json => createHash("sha256").update(json).digest("base64url").slice(0, 16);
  const newId = () => { let id; do id = randomBytes(8).toString("base64url").slice(0, 10); while (projects.has(id)); return id; };
  const dataUrl = (type, buf) => `data:${type};base64,${buf.toString("base64")}`;

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
    const purge = url.searchParams.get("purge") === "1";
    const fail = (code, error) => { send(res, code, { error }, priv); return true; };
    const ok = (body, code = 200) => { send(res, code, body, priv); return true; };
    try {
      if (path[0] === "login" && m === "GET") { res.writeHead(200, { "content-type": "text/html; charset=utf-8", ...priv }); res.end(loginPage); return true; }
      if (path[0] === "me" && m === "GET") {
        const fs = await statfs(dir).catch(() => null);
        const all = [...projects.values()];
        return ok({
          email: user.email,
          revisions: { bytes, projects: all.filter(p => !p.meta.deleted).length, count: all.filter(p => !p.meta.deleted).reduce((n, p) => n + live(p.meta).length, 0), max: budget.maxRevisions },
          trash: { projects: all.filter(p => p.meta.deleted).length, revisions: all.filter(p => !p.meta.deleted).reduce((n, p) => n + p.meta.revs.filter(r => r.deleted).length, 0), days: trashDays },
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
      if (path[0] === "trash" && path.length === 1 && m === "GET") {
        const until = t => new Date(Date.parse(t) + trashDays * DAY).toISOString();
        const out = { days: trashDays, projects: [], revs: [] };
        for (const p of projects.values()) {
          if (p.meta.deleted) out.projects.push({ id: p.meta.id, name: p.meta.name, deleted: p.meta.deleted, until: until(p.meta.deleted), count: live(p.meta).length + p.meta.revs.filter(r => r.deleted).length, bytes: p.bytes });
          else for (const r of p.meta.revs) if (r.deleted) out.revs.push({ project: p.meta.id, name: p.meta.name, n: r.n, message: r.message, time: r.time, deleted: r.deleted, until: until(r.deleted), size: r.size });
        }
        out.projects.sort((a, b) => b.deleted.localeCompare(a.deleted)); out.revs.sort((a, b) => b.deleted.localeCompare(a.deleted));
        return ok(out);
      }
      if (path[0] === "search" && path.length === 1 && m === "GET") {
        const q = clip(url.searchParams.get("q"), 100).toLowerCase();
        if (!q) return ok([]);
        const hits = [], has = s => String(s || "").toLowerCase().includes(q);
        for (const p of projects.values()) {
          if (p.meta.deleted) continue;
          const pm = p.meta;
          if (has(pm.name) || has(pm.notes) || (pm.tags || []).some(has)) hits.push({ project: pm.id, name: pm.name, n: null, text: has(pm.name) ? pm.name : has(pm.notes) ? pm.notes : (pm.tags || []).join(", ") });
          for (const r of live(pm)) {
            const f = [r.message, r.summary, r.milestone].find(has);
            if (f !== undefined) hits.push({ project: pm.id, name: pm.name, n: r.n, time: r.time, milestone: r.milestone, text: f });
          }
          if (hits.length >= 300) break;
        }
        return ok(hits.slice(0, 300));
      }
      if (path[0] === "import" && path.length === 1 && m === "POST") {
        const b = await readBody(req, 4 * maxJson + 32 * 1024 * 1024);
        const src = b && b.app === "TubeAmpCAD-project" && b.project;
        if (!src || !Array.isArray(src.revs) || !src.revs.length) return fail(400, "not a Tube Amp CAD project (File ▾ → Revisions… → Download all writes one)");
        const name = clip(src.name, 120) || "Imported project";
        // check every revision before anything is written
        const revs = [];
        for (const r of src.revs) {
          if (!isDesign(r.design) || !Number.isInteger(r.n) || r.n < 1) return fail(400, `revision ${r.n} is not a Tube Amp CAD design`);
          const json = JSON.stringify(r.design);
          if (json.length > maxJson) return fail(413, `revision r${r.n} is too large`);
          revs.push({ r, json });
        }
        revs.sort((a, b) => a.r.n - b.r.n);
        if (new Set(revs.map(x => x.r.n)).size !== revs.length) return fail(400, "two revisions with one number");
        return serial(async () => {
          const gz = revs.map(x => gzipSync(x.json, { level: 9 }));
          const why = await room(gz.reduce((n, g) => n + g.length, 0) + 4096); if (why) return fail(507, why);
          const id = PID.test(src.id) && !projects.has(src.id) ? src.id : newId();
          await mkdir(join(dir, id), { recursive: true });
          const time = s => (isNaN(Date.parse(s)) ? new Date(now()).toISOString() : new Date(Date.parse(s)).toISOString());
          const meta = { id, name, notes: clip(src.notes, 4000), status: STATUSES.includes(src.status) ? src.status : "", tags: tagsOf(src.tags), created: time(src.created), updated: time(src.updated), revs: [] };
          const nums = new Set(revs.map(x => x.r.n));
          for (let i = 0; i < revs.length; i++) {
            const { r, json } = revs[i], n = r.n;
            await put(join(dir, id, n + ".json.gz"), gz[i]);
            const rev = { n, time: time(r.time), message: clip(r.message, 2000), summary: clip(r.summary, 2000), size: gz[i].length, hash: hashOf(json), by: clip(r.by, 200) || user.email };
            if (Number.isInteger(r.parent) && nums.has(r.parent)) rev.parent = r.parent;
            const ms = clip(r.milestone, 60); if (ms) rev.milestone = ms;
            const met = metricsOf(r.metrics); if (met) rev.metrics = met;
            const t = thumbOf(r.thumbData); if (t) { await put(join(dir, id, n + ".thumb"), t.bytes); rev.thumb = t.type; }
            const bt = thumbOf(r.bthumbData); if (bt) { await put(join(dir, id, n + ".bthumb"), bt.bytes); rev.bthumb = bt.type; }
            if (Array.isArray(r.files)) {
              const kept = [];
              for (const f of r.files.slice(0, MAX_FILES)) {
                const fname = String(f && f.name || ""), buf = f && typeof f.data === "string" ? Buffer.from(f.data, "base64") : null;
                if (!FILE.test(fname) || !buf || !buf.length || buf.length > MAX_FILE || !MIME.test(String(f.type))) continue;
                await mkdir(join(dir, id, n + ".files"), { recursive: true });
                await put(join(dir, id, n + ".files", fname), buf);
                kept.push({ name: fname, type: f.type, size: buf.length });
              }
              if (kept.length) rev.files = kept;
            }
            meta.revs.push(rev);
          }
          await saveMeta(id, meta);
          projects.set(id, { meta, bytes: 0 }); await resize(id);
          log(`project ${id} "${name}" imported (${meta.revs.length} revisions) by ${user.email}`);
          return ok(listItem(projects.get(id)), 201);
        });
      }
      if (path[0] !== "projects") return fail(404, "not found");
      if (path.length === 1) {
        if (m === "GET") return ok([...projects.values()].filter(p => !p.meta.deleted).map(listItem).sort((a, b) => b.updated.localeCompare(a.updated)));
        if (m === "POST") {
          const b = await readBody(req, 16 * 1024);
          const name = clip(b.name, 120);
          if (!name) return fail(400, "a project needs a name");
          return serial(async () => {
            const why = await room(1024); if (why) return fail(507, why);
            const id = newId();
            const t = new Date(now()).toISOString();
            const meta = { id, name, notes: clip(b.notes, 4000), created: t, updated: t, revs: [] };
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
      // a project in the trash: only restoring it, or emptying it for good
      if (p.meta.deleted) {
        if (path.length === 3 && path[2] === "restore" && m === "POST") return serial(async () => {
          delete p.meta.deleted; await saveMeta(id, p.meta);
          log(`project ${id} "${p.meta.name}" restored by ${user.email}`);
          return ok(listItem(p));
        });
        if (path.length === 2 && m === "DELETE" && purge) return serial(async () => {
          await rm(join(dir, id), { recursive: true, force: true });
          bytes -= p.bytes; projects.delete(id);
          log(`project ${id} "${p.meta.name}" emptied from the trash by ${user.email}`);
          return ok({ deleted: id, purged: true });
        });
        return fail(404, "the project is in the trash");
      }
      if (path.length === 2) {
        if (m === "GET") return ok(Object.assign(listItem(p), { revs: live(p.meta) }));
        if (m === "PATCH") {
          const b = await readBody(req, 16 * 1024);
          return serial(async () => {
            if (b.name !== undefined) { const n = clip(b.name, 120); if (!n) return fail(400, "a project needs a name"); p.meta.name = n; }
            if (b.notes !== undefined) p.meta.notes = clip(b.notes, 4000);
            if (b.status !== undefined) { if (!STATUSES.includes(b.status)) return fail(400, "status: one of " + STATUSES.filter(Boolean).join(", ")); p.meta.status = b.status; }
            if (b.tags !== undefined) p.meta.tags = tagsOf(b.tags);
            p.meta.updated = new Date(now()).toISOString();
            await saveMeta(id, p.meta); await resize(id);
            return ok(listItem(p));
          });
        }
        if (m === "DELETE") return serial(async () => {
          p.meta.deleted = new Date(now()).toISOString();
          await saveMeta(id, p.meta);
          log(`project ${id} "${p.meta.name}" moved to the trash by ${user.email}`);
          return ok({ deleted: id, trash: true });
        });
        return fail(405, "method not allowed");
      }
      if (path.length === 3 && path[2] === "export" && m === "GET") {
        const revs = [];
        for (const r of live(p.meta)) {
          const x = Object.assign({}, r, { design: JSON.parse(gunzipSync(await readFile(join(dir, id, r.n + ".json.gz"))).toString("utf8")) });
          if (r.thumb) { const b = await readFile(join(dir, id, r.n + ".thumb")).catch(() => null); if (b) x.thumbData = dataUrl(r.thumb, b); }
          if (r.bthumb) { const b = await readFile(join(dir, id, r.n + ".bthumb")).catch(() => null); if (b) x.bthumbData = dataUrl(r.bthumb, b); }
          if (r.files) {
            x.files = [];
            for (const f of r.files) { const b = await readFile(join(dir, id, r.n + ".files", f.name)).catch(() => null); if (b) x.files.push(Object.assign({}, f, { data: b.toString("base64") })); }
          }
          revs.push(x);
        }
        const name = p.meta.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || id;
        send(res, 200, { app: "TubeAmpCAD-project", project: Object.assign({}, p.meta, { revs }) }, Object.assign({ "content-disposition": `attachment; filename="${name}-revisions.json"` }, priv));
        return true;
      }
      if (path[2] !== "revs") return fail(404, "not found");
      if (path.length === 3) {
        if (m === "GET") return ok(live(p.meta));
        if (m !== "POST") return fail(405, "method not allowed");
        const b = await readBody(req, maxJson + 512 * 1024);
        const d = b.design;
        if (!isDesign(d)) return fail(400, "not a Tube Amp CAD design");
        const json = JSON.stringify(d);
        if (json.length > maxJson) return fail(413, "design too large");
        const hash = hashOf(json);
        return serial(async () => {
          const revs = live(p.meta), last = revs[revs.length - 1];
          if (last && last.hash === hash && !b.force) return ok(Object.assign({ same: true }, last));
          const gz = gzipSync(json, { level: 9 }), thumb = thumbOf(b.thumb), bthumb = thumbOf(b.bthumb);
          const why = await room(gz.length + (thumb ? thumb.bytes.length : 0) + (bthumb ? bthumb.bytes.length : 0) + 512); if (why) return fail(507, why);
          // numbers are never reused, not even those in the trash
          const n = p.meta.revs.reduce((x, r) => Math.max(x, r.n), 0) + 1;
          await put(join(dir, id, n + ".json.gz"), gz);
          if (thumb) await put(join(dir, id, n + ".thumb"), thumb.bytes);
          if (bthumb) await put(join(dir, id, n + ".bthumb"), bthumb.bytes);
          const rev = { n, time: new Date(now()).toISOString(), message: clip(b.message, 2000), summary: clip(b.summary, 2000), size: gz.length, hash, by: user.email };
          // the revision it was made from, when that is not the latest (an earlier one opened, then changed, or restored)
          if (Number.isInteger(b.parent) && revs.some(r => r.n === b.parent)) rev.parent = b.parent;
          if (thumb) rev.thumb = thumb.type;
          if (bthumb) rev.bthumb = bthumb.type;
          const met = metricsOf(b.metrics); if (met) rev.metrics = met;
          p.meta.revs.push(rev); p.meta.updated = rev.time;
          await saveMeta(id, p.meta); await resize(id);
          log(`project ${id} r${n} (${gz.length} bytes)`);
          return ok(rev, 201);
        });
      }
      const n = +path[3], i = /^\d+$/.test(path[3]) ? p.meta.revs.findIndex(r => r.n === n) : -1;
      if (i < 0) return fail(404, "no such revision");
      const rev = p.meta.revs[i];
      if (rev.deleted) {
        if (path.length === 5 && path[4] === "restore" && m === "POST") return serial(async () => {
          delete rev.deleted; await saveMeta(id, p.meta);
          log(`project ${id} r${n} restored by ${user.email}`);
          return ok(rev);
        });
        if (path.length === 4 && m === "DELETE" && purge) return serial(async () => {
          await dropRev(id, p.meta, p.meta.revs.indexOf(rev));
          await saveMeta(id, p.meta); await resize(id);
          log(`project ${id} r${n} emptied from the trash by ${user.email}`);
          return ok({ deleted: n, purged: true });
        });
        return fail(404, "the revision is in the trash");
      }
      if (path.length === 5 && (path[4] === "thumb" || path[4] === "bthumb") && m === "GET") {
        const t = rev[path[4]], data = t && await readFile(join(dir, id, n + "." + path[4])).catch(() => null);
        if (!data) return fail(404, "no picture");
        // a revision never changes: the browser may keep its picture
        res.writeHead(200, { "content-type": t, "x-content-type-options": "nosniff", "cache-control": "private, max-age=31536000, immutable" });
        res.end(data);
        return true;
      }
      if (path[4] === "files") {
        const files = rev.files || [];
        if (path.length === 5 && m === "GET") return ok(files);
        if (path.length === 5 && m === "POST") {
          const b = await readBody(req, Math.ceil(MAX_FILE * 4 / 3) + 4096);
          const fname = String(b.name || ""), type = String(b.type || "application/octet-stream");
          if (!FILE.test(fname)) return fail(400, "a file name of letters, digits, . _ -");
          if (!MIME.test(type)) return fail(400, "not a media type");
          const buf = typeof b.data === "string" ? Buffer.from(b.data, "base64") : null;
          if (!buf || !buf.length) return fail(400, "no data");
          if (buf.length > MAX_FILE) return fail(413, "file too large");
          return serial(async () => {
            const old = files.find(f => f.name === fname);
            if (!old && files.length >= MAX_FILES) return fail(400, `at most ${MAX_FILES} files a revision`);
            const why = await room(buf.length - (old ? old.size : 0)); if (why) return fail(507, why);
            await mkdir(join(dir, id, n + ".files"), { recursive: true });
            await put(join(dir, id, n + ".files", fname), buf);
            rev.files = files.filter(f => f.name !== fname).concat({ name: fname, type, size: buf.length });
            await saveMeta(id, p.meta); await resize(id);
            return ok(rev.files, 201);
          });
        }
        if (path.length === 6) {
          const f = files.find(x => x.name === path[5]);
          if (!f) return fail(404, "no such file");
          if (m === "GET") {
            const data = await readFile(join(dir, id, n + ".files", f.name)).catch(() => null);
            if (!data) return fail(404, "no such file");
            res.writeHead(200, { "content-type": f.type, "content-disposition": `attachment; filename="${f.name}"`, "x-content-type-options": "nosniff", "content-security-policy": "sandbox", ...priv });
            res.end(data);
            return true;
          }
          if (m === "DELETE") return serial(async () => {
            await rm(join(dir, id, n + ".files", f.name), { force: true });
            rev.files = files.filter(x => x !== f); if (!rev.files.length) delete rev.files;
            await saveMeta(id, p.meta); await resize(id);
            return ok(rev.files || []);
          });
        }
        return fail(404, "not found");
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
          if (b.message !== undefined) rev.message = clip(b.message, 2000);
          if (b.milestone !== undefined) { const t = clip(b.milestone, 60); if (t) rev.milestone = t; else delete rev.milestone; }
          if (b.metrics !== undefined) { const met = metricsOf(b.metrics); if (met) rev.metrics = met; else delete rev.metrics; }
          await saveMeta(id, p.meta); await resize(id);
          return ok(rev);
        });
      }
      if (m === "DELETE") return serial(async () => {
        if (purge) {
          await dropRev(id, p.meta, i);
          await saveMeta(id, p.meta); await resize(id);
          log(`project ${id} r${n} deleted for good by ${user.email}`);
          return ok({ deleted: n, purged: true });
        }
        rev.deleted = new Date(now()).toISOString();
        await saveMeta(id, p.meta);
        log(`project ${id} r${n} moved to the trash by ${user.email}`);
        return ok({ deleted: n, trash: true });
      });
      return fail(405, "method not allowed");
    } catch (err) {
      if (err.code === 413 || err.code === 400) return fail(err.code, err.message);
      throw err;
    }
  }
  return { handle, used, close: () => clearInterval(timer) };
}
