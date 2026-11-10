/* A vault: projects and their revisions kept in a folder on this computer that the user picks
   (File ▾ → Revisions… → Kept in: a folder on this computer), instead of on aerocat.tech. It
   answers the same calls as the site's store (cad-revisions.js client, server/share/revisions.mjs),
   so the Revisions dialog and the project manager work on either. The folder is opened with the
   browser's File System Access API (Chrome, Edge); its handle is remembered in IndexedDB, and the
   browser may ask again for leave to use it after a restart. In the folder, readable as it is:
     tubecad-vault.json            marks the folder as a vault
     <Project name>/project.json   { id, name, notes, status?, tags?, created, updated, deleted?,
                                     revs: [{ n, time, message, summary, size, hash, parent?, milestone?,
                                              thumb?, bthumb?, metrics?, files?, deleted? }] }
     <Project name>/r<n>.json      the design as File › Save writes it (File › Open opens it)
     <Project name>/r<n>.sheet.webp, r<n>.board.webp   its pictures (.png or .jpg where so made)
     <Project name>/r<n>.files/    the release package kept with a milestone
   A project is found by the id in its project.json, so its folder may be renamed or moved within
   the vault. There can be several vaults (a folder for each project, say): the browser remembers
   every folder added and "Kept in" switches between them; each vault has an id in its
   tubecad-vault.json, which a saved design and a #rev= address name. Deleting moves a project or revision to the trash (a mark in project.json; the files
   stay) for TRASH_DAYS, then it goes for good. */
(function (root) {
  "use strict";
  const PID = /^[A-Za-z0-9_-]{10}$/, FILE = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,79}$/, MIME = /^[a-z]+\/[a-z0-9.+-]{1,60}$/;
  const MARK = "tubecad-vault.json", DB = "tubecad-vault", STORE = "kv", DAY = 86400e3, TRASH_DAYS = 30;
  const MAX_THUMB = 2 * 1024 * 1024, MAX_FILES = 40;
  const STATUSES = ["", "idea", "design", "building", "done", "archived"];
  const EXT = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };

  // the folder is not usable yet: why = "unsupported" (this browser cannot open folders), "none"
  // (no folder picked), "permission" (the browser wants leave again), "gone" (moved or deleted)
  class NeedFolder extends Error {
    constructor(why, name) {
      super({ unsupported: "this browser cannot open a folder: use Chrome or Edge", none: "choose a folder for the vault first", permission: `allow the browser to use the folder ${name || ""} again`.replace("  ", " "), gone: `the folder ${name || ""} cannot be found: choose it again`.replace("  ", " ") }[why]);
      this.folder = why;
    }
  }

  const clip = (s, n) => [...String(s == null ? "" : s)].filter(c => c >= " " || c === "\n" || c === "\t").join("").trim().slice(0, n);
  function metricsOf(m) {
    if (!m || typeof m !== "object" || Array.isArray(m)) return null;
    const out = {};
    for (const [k, v] of Object.entries(m).slice(0, 40)) { const key = clip(k, 40); if (key && typeof v === "number" && isFinite(v)) out[key] = +v.toPrecision(6); }
    return Object.keys(out).length ? out : null;
  }
  const tagsOf = t => [...new Set((Array.isArray(t) ? t : String(t || "").split(",")).map(x => clip(x, 30).toLowerCase()).filter(Boolean))].slice(0, 12);
  const isDesign = d => d && d.app === "TubeAmpCAD" && Array.isArray(d.comps) && Array.isArray(d.wires);
  function bytesOf(b64) { const s = atob(b64), out = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i); return out; }
  function b64Of(bytes) { let s = ""; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }
  // a picture sent as a data: URL → { type, bytes }, or null
  function thumbOf(url) {
    const m = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(url || ""));
    if (!m) return null;
    const bytes = bytesOf(m[2]);
    return bytes.length && bytes.length <= MAX_THUMB ? { type: m[1], bytes } : null;
  }
  // the same fingerprint as the site's store: SHA-256 of the design's JSON, base64url, 16 characters
  async function hashOf(json) {
    const b = new Uint8Array(await root.crypto.subtle.digest("SHA-256", new TextEncoder().encode(json)));
    return b64Of(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 16);
  }
  const newId = () => { const A = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789", r = root.crypto.getRandomValues(new Uint8Array(10)); return [...r].map(x => A[x % A.length]).join(""); };
  // a project's name as a folder's: nothing a file system refuses
  const folderName = name => (String(name).replace(/[\\/:*?"<>|\x00-\x1f]+/g, "_").replace(/^[\s.]+|[\s.]+$/g, "").slice(0, 60) || "Project"); // eslint-disable-line no-control-regex

  // ---- the folder's files ----
  const fileOf = async (dir, name) => (await dir.getFileHandle(name)).getFile();
  const readText = async (dir, name) => (await fileOf(dir, name)).text();
  const readJSON = async (dir, name) => JSON.parse(await readText(dir, name));
  async function write(dir, name, data) {
    const w = await (await dir.getFileHandle(name, { create: true })).createWritable();
    await w.write(data); await w.close();
  }
  const drop = (dir, name) => dir.removeEntry(name, { recursive: true }).catch(() => {});
  async function names(dir) { const out = []; for await (const [name, h] of dir.entries()) out.push([name, h]); return out; }
  async function sizeOf(dir) {
    let n = 0;
    for (const [, h] of await names(dir)) n += h.kind === "directory" ? await sizeOf(h) : (await h.getFile()).size;
    return n;
  }

  // ---- the handle, remembered between visits ----
  function idb(mode, fn) {
    return new Promise((res, rej) => {
      if (!root.indexedDB) { rej(new Error("no IndexedDB")); return; }
      const r = root.indexedDB.open(DB, 1);
      r.onupgradeneeded = () => r.result.createObjectStore(STORE);
      r.onerror = () => rej(r.error);
      r.onsuccess = () => {
        const t = r.result.transaction(STORE, mode), q = fn(t.objectStore(STORE));
        t.oncomplete = () => { r.result.close(); res(q && q.result); };
        t.onerror = t.onabort = () => { r.result.close(); rej(t.error); };
      };
    });
  }

  // o.handle: a folder given outright (tests); o.now: the clock; o.trashDays
  function client(o = {}) {
    const now = o.now || (() => Date.now()), trashDays = o.trashDays || TRASH_DAYS;
    const supported = !!o.handle || typeof root.showDirectoryPicker === "function";
    // the folders remembered: [{ id (from the folder's tubecad-vault.json, "" until read), handle, name }], and the one in use
    let vaults = o.handle ? [{ id: "", handle: o.handle, name: o.handle.name }] : [], cur = vaults[0] || null, asked = !!o.handle, checked = false;
    const CUR = "tubecad.vault.cur";
    const keepCur = () => { try { if (cur && cur.id) root.localStorage.setItem(CUR, cur.id); else root.localStorage.removeItem(CUR); } catch (e) { /* no storage */ } };
    // the list of folders is kept in IndexedDB, which can hold a folder's handle; o.keep or
    // window.CadVaultKeep ({ load, save }) keeps it elsewhere (the tests' stand-in folders)
    const kept = o.keep || root.CadVaultKeep || { load: () => idb("readonly", s => s.get("vaults")), save: list => idb("readwrite", s => s.put(list, "vaults")) };
    const persist = async () => { try { await kept.save(vaults.map(v => ({ id: v.id, handle: v.handle, name: v.name }))); } catch (e) { /* no IndexedDB: the folders are asked for again next time */ } };
    const reset = () => { checked = false; where.clear(); forget(); };
    const urls = new Map();          // "<project>/<n>/thumb" → object URL of the picture or file
    const where = new Map();         // project id → its folder's name, as last seen

    async function remembered() {
      if (!asked) {
        asked = true;
        try { vaults = ((await kept.load()) || []).filter(v => v && v.handle); } catch (e) { vaults = []; }
        let id = ""; try { id = root.localStorage.getItem(CUR) || ""; } catch (e) { /* no storage */ }
        cur = vaults.find(v => v.id === id) || vaults[0] || null;
      }
      return cur && cur.handle;
    }
    // the folder's mark, written when it has none: → the vault's id
    async function mark(h) {
      let m = await readJSON(h, MARK).catch(() => null);
      if (!m || m.app !== "TubeAmpCAD-vault" || !PID.test(String(m.id))) {
        m = { app: "TubeAmpCAD-vault", version: 1, id: newId(), created: (m && m.created) || new Date(now()).toISOString(), note: "Tube Amp CAD keeps projects and their revisions in this folder (File > Revisions). Each project is a folder; r<n>.json is a design that File > Open opens." };
        await write(h, MARK, JSON.stringify(m, null, 1));
      }
      return m.id;
    }
    // the folder, ready to read and write, or NeedFolder
    async function folder() {
      if (!supported) throw new NeedFolder("unsupported");
      const h = await remembered();
      if (!h) throw new NeedFolder("none");
      if (h.queryPermission && (await h.queryPermission({ mode: "readwrite" })) !== "granted") throw new NeedFolder("permission", h.name);
      if (!checked) {
        let id;
        try { id = await mark(h); } catch (e) { throw gone(e, h); }
        if (cur.id !== id) { cur.id = id; keepCur(); if (!o.handle) await persist(); }
        checked = true;
        await purgeOld(h);
      }
      return h;
    }
    const gone = (e, h) => (e && e.name === "NotFoundError" ? new NeedFolder("gone", (h || (cur && cur.handle) || {}).name) : e && (e.name === "NotAllowedError" || e.name === "SecurityError") ? new NeedFolder("permission", (h || (cur && cur.handle) || {}).name) : e);
    // one change at a time, in this tab and the others
    let queue = Promise.resolve();
    function serial(fn) {
      const run = () => (root.navigator && root.navigator.locks ? root.navigator.locks.request("tubecad-vault", fn) : fn());
      const p = queue.then(run); queue = p.catch(() => {}); return p;
    }
    const guard = fn => async (...a) => { try { return await fn(...a); } catch (e) { if (e && (e.name === "NotFoundError" || e.name === "NotAllowedError") && !e.folder) checked = false; throw gone(e); } };
    const change = fn => guard((...a) => serial(() => fn(...a)));

    // every project in the folder: id → { dir, meta, name }
    async function scan(h) {
      const out = new Map();
      for (const [name, d] of await names(h)) {
        if (d.kind !== "directory") continue;
        const meta = await readJSON(d, "project.json").catch(() => null);
        if (!meta || !PID.test(meta.id) || !Array.isArray(meta.revs) || out.has(meta.id)) continue;
        out.set(meta.id, { dir: d, meta, name }); where.set(meta.id, name);
      }
      return out;
    }
    async function find(id, inTrash) {
      const h = await folder();
      let p = null;
      if (PID.test(String(id))) {
        if (where.has(id)) {
          const d = await h.getDirectoryHandle(where.get(id)).catch(() => null), meta = d && await readJSON(d, "project.json").catch(() => null);
          if (meta && meta.id === id && Array.isArray(meta.revs)) p = { dir: d, meta, name: where.get(id) };
        }
        if (!p) p = (await scan(h)).get(id) || null;
      }
      if (!p) throw new Error("no such project");
      if (p.meta.deleted && !inTrash) throw new Error("the project is in the trash");
      p.root = h;
      return p;
    }
    const saveMeta = p => write(p.dir, "project.json", JSON.stringify(p.meta, null, 1));
    const live = meta => meta.revs.filter(r => !r.deleted);
    const pic = (n, kind, type) => `r${n}.${kind === "thumb" ? "sheet" : "board"}.${EXT[type] || "png"}`;
    function forget(id, n) { const pre = id === undefined ? "" : id + "/" + (n === undefined ? "" : n + "/"); for (const [k, u] of [...urls]) if (k.startsWith(pre)) { URL.revokeObjectURL(u); urls.delete(k); } }
    async function dropRev(p, i) {
      const r = p.meta.revs[i];
      await drop(p.dir, `r${r.n}.json`); await drop(p.dir, `r${r.n}.files`);
      if (r.thumb) await drop(p.dir, pic(r.n, "thumb", r.thumb));
      if (r.bthumb) await drop(p.dir, pic(r.n, "bthumb", r.bthumb));
      forget(p.meta.id, r.n);
      p.meta.revs.splice(i, 1);
    }
    // the trash: what was deleted longer ago than trashDays goes for good
    async function purgeOld(h) {
      const limit = now() - trashDays * DAY;
      for (const p of (await scan(h)).values()) {
        if (p.meta.deleted && Date.parse(p.meta.deleted) < limit) { await drop(h, p.name); where.delete(p.meta.id); forget(p.meta.id); continue; }
        let changed = false;
        for (let i = p.meta.revs.length - 1; i >= 0; i--) { const r = p.meta.revs[i]; if (r.deleted && Date.parse(r.deleted) < limit) { await dropRev(p, i); changed = true; } }
        if (changed) await saveMeta(p);
      }
    }
    // a picture or file of the folder as an address the page can show (kept until the revision goes)
    async function url(key, dir, name) {
      if (urls.has(key)) return;
      try { urls.set(key, URL.createObjectURL(await fileOf(dir, name))); } catch (e) { /* the picture is missing: none shown */ }
    }
    async function listItem(p) {
      const revs = live(p.meta), last = revs[revs.length - 1], shot = [...revs].reverse().find(r => r.thumb);
      if (shot) await url(`${p.meta.id}/${shot.n}/thumb`, p.dir, pic(shot.n, "thumb", shot.thumb));
      return {
        id: p.meta.id, name: p.meta.name, notes: p.meta.notes || "", status: p.meta.status || "", tags: p.meta.tags || [], created: p.meta.created, updated: p.meta.updated,
        count: revs.length, milestones: revs.filter(r => r.milestone).length, bytes: await sizeOf(p.dir), folder: p.name,
        last: last ? { n: last.n, time: last.time, message: last.message, milestone: last.milestone } : null,
        thumb: shot ? shot.n : null,
      };
    }
    // a new folder for a project, named after it ("Name", "Name 2"… when taken)
    async function makeDir(h, name) {
      const base = folderName(name);
      for (let i = 1; ; i++) {
        const nm = i === 1 ? base : `${base} ${i}`;
        const there = await h.getDirectoryHandle(nm).then(() => true, () => false) || await h.getFileHandle(nm).then(() => true, () => false);
        if (!there) return { dir: await h.getDirectoryHandle(nm, { create: true }), name: nm };
      }
    }
    function rev(p, n, inTrash) {
      const i = Number.isInteger(n) ? p.meta.revs.findIndex(r => r.n === n) : -1;
      if (i < 0) throw new Error("no such revision");
      if (p.meta.revs[i].deleted && !inTrash) throw new Error("the revision is in the trash");
      return i;
    }
    // one revision written into a project's folder (import, save): → its entry for project.json
    async function putRev(p, n, json, b) {
      await write(p.dir, `r${n}.json`, json);
      const r = { n, time: b.time, message: clip(b.message, 2000), summary: clip(b.summary, 2000), size: new TextEncoder().encode(json).length, hash: await hashOf(JSON.stringify(JSON.parse(json))) };
      const t = thumbOf(b.thumb), bt = thumbOf(b.bthumb);
      if (t) { await write(p.dir, pic(n, "thumb", t.type), t.bytes); r.thumb = t.type; }
      if (bt) { await write(p.dir, pic(n, "bthumb", bt.type), bt.bytes); r.bthumb = bt.type; }
      const met = metricsOf(b.metrics); if (met) r.metrics = met;
      const ms = clip(b.milestone, 60); if (ms) r.milestone = ms;
      return r;
    }
    async function putFile(p, r, f) {
      const fname = String(f && f.name || ""), type = String(f && f.type || "application/octet-stream");
      if (!FILE.test(fname)) throw new Error("a file name of letters, digits, . _ -");
      if (!MIME.test(type)) throw new Error("not a media type");
      const buf = f && typeof f.data === "string" ? bytesOf(f.data) : null;
      if (!buf || !buf.length) throw new Error("no data");
      const files = r.files || [];
      if (!files.some(x => x.name === fname) && files.length >= MAX_FILES) throw new Error(`at most ${MAX_FILES} files a revision`);
      await write(await p.dir.getDirectoryHandle(`r${r.n}.files`, { create: true }), fname, buf);
      forget(p.meta.id, r.n);
      r.files = files.filter(x => x.name !== fname).concat({ name: fname, type, size: buf.length });
    }
    const stamp = () => new Date(now()).toISOString();

    const api = {
      kind: "vault", supported,
      get available() { return supported; },
      // what is known of the folder in use without touching it: { supported, id, name, granted, count (folders remembered) }
      async status() {
        if (!supported) return { supported: false, id: "", name: "", granted: false, count: 0 };
        const h = await remembered();
        if (!h) return { supported: true, id: "", name: "", granted: false, count: 0 };
        let granted = true;
        try { if (h.queryPermission) granted = (await h.queryPermission({ mode: "readwrite" })) === "granted"; } catch (e) { granted = false; }
        return { supported: true, id: cur.id, name: h.name, granted, count: vaults.length };
      },
      // the id of the vault in use ("" before its folder was read)
      id: () => (cur ? cur.id : ""),
      // every folder remembered: [{ id, name, current }]
      async vaults() { await remembered(); return vaults.map(v => ({ id: v.id, name: v.name, current: v === cur })); },
      // the browser's folder dialog (needs a click): the folder picked joins the list and is the one
      // in use; → its name, or null when cancelled
      async choose() {
        if (!supported) throw new NeedFolder("unsupported");
        let h;
        try { h = await root.showDirectoryPicker({ id: "tubecad-vault", mode: "readwrite" }); }
        catch (e) { if (e && e.name === "AbortError") return null; throw e; }
        await api.use(h);
        return h.name;
      },
      async use(h) {
        await remembered();
        const id = await mark(h);
        // the same vault again (by its id, or the very folder): its place in the list, with the new handle
        let v = null;
        for (const x of vaults) if (x.id === id || (x.handle.isSameEntry && await x.handle.isSameEntry(h).catch(() => false))) { v = x; break; }
        if (v) Object.assign(v, { id, handle: h, name: h.name }); else vaults.push(v = { id, handle: h, name: h.name });
        cur = v; reset(); keepCur();
        await persist();
        await folder();
      },
      // switch to another folder of the list → false when it is not there
      async select(id) {
        await remembered();
        const v = vaults.find(x => x.id === id);
        if (!v) return false;
        if (v !== cur) { cur = v; reset(); keepCur(); }
        return true;
      },
      // ask the browser for leave again (needs a click) → true when given
      async grant() {
        const h = await remembered();
        if (!h) return false;
        if (!h.requestPermission) return true;
        try { return (await h.requestPermission({ mode: "readwrite" })) === "granted"; } catch (e) { return false; }
      },
      // take a folder off the list (the one in use when none is named); its files stay where they are
      async disconnect(id) {
        await remembered();
        const v = id === undefined ? cur : vaults.find(x => x.id === id);
        if (!v) return;
        vaults = vaults.filter(x => x !== v);
        if (v === cur) { cur = vaults[0] || null; reset(); keepCur(); }
        await persist();
      },
      signIn: async () => {},

      me: guard(async () => {
        const h = await folder(), all = [...(await scan(h)).values()];
        let bytes = 0; for (const p of all) bytes += await sizeOf(p.dir);
        const on = all.filter(p => !p.meta.deleted);
        return {
          vault: true, id: cur.id, folder: h.name, email: "",
          revisions: { bytes, projects: on.length, count: on.reduce((n, p) => n + live(p.meta).length, 0), max: null },
          trash: { projects: all.length - on.length, revisions: on.reduce((n, p) => n + p.meta.revs.filter(r => r.deleted).length, 0), days: trashDays },
        };
      }),
      projects: guard(async () => {
        const out = [];
        for (const p of (await scan(await folder())).values()) if (!p.meta.deleted) out.push(await listItem(p));
        return out.sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
      }),
      createProject: change(async (name, notes) => {
        const h = await folder(), nm = clip(name, 120);
        if (!nm) throw new Error("a project needs a name");
        const all = await scan(h);
        let id; do id = newId(); while (all.has(id));
        const d = await makeDir(h, nm), t = stamp();
        const p = { dir: d.dir, name: d.name, meta: { id, name: nm, notes: clip(notes, 4000), created: t, updated: t, revs: [] } };
        await saveMeta(p); where.set(id, d.name);
        return listItem(p);
      }),
      project: guard(async id => {
        const p = await find(id), revs = live(p.meta);
        for (const r of revs) {
          if (r.thumb) await url(`${id}/${r.n}/thumb`, p.dir, pic(r.n, "thumb", r.thumb));
          if (r.bthumb) await url(`${id}/${r.n}/bthumb`, p.dir, pic(r.n, "bthumb", r.bthumb));
          if (r.files) { const fd = await p.dir.getDirectoryHandle(`r${r.n}.files`).catch(() => null); if (fd) for (const f of r.files) await url(`${id}/${r.n}/file/${f.name}`, fd, f.name); }
        }
        return Object.assign(await listItem(p), { revs });
      }),
      updateProject: change(async (id, b) => {
        const p = await find(id);
        if (b.name !== undefined) { const n = clip(b.name, 120); if (!n) throw new Error("a project needs a name"); p.meta.name = n; }
        if (b.notes !== undefined) p.meta.notes = clip(b.notes, 4000);
        if (b.status !== undefined) { if (!STATUSES.includes(b.status)) throw new Error("status: one of " + STATUSES.filter(Boolean).join(", ")); p.meta.status = b.status; }
        if (b.tags !== undefined) p.meta.tags = tagsOf(b.tags);
        p.meta.updated = stamp();
        await saveMeta(p);
        return listItem(p);
      }),
      deleteProject: change(async id => { const p = await find(id); p.meta.deleted = stamp(); await saveMeta(p); return { deleted: id, trash: true }; }),
      restoreProject: change(async id => { const p = await find(id, true); delete p.meta.deleted; await saveMeta(p); return listItem(p); }),
      purgeProject: change(async id => { const p = await find(id, true); await drop(p.root, p.name); where.delete(id); forget(id); return { deleted: id, purged: true }; }),
      saveRevision: change(async (id, b) => {
        const p = await find(id), d = b && b.design;
        if (!isDesign(d)) throw new Error("not a Tube Amp CAD design");
        const hash = await hashOf(JSON.stringify(d)), revs = live(p.meta), last = revs[revs.length - 1];
        if (last && last.hash === hash && !b.force) return Object.assign({ same: true }, last);
        // numbers are never reused, not even those in the trash
        const n = p.meta.revs.reduce((x, r) => Math.max(x, r.n), 0) + 1;
        const r = await putRev(p, n, JSON.stringify(d, null, 1), { time: stamp(), message: b.message, summary: b.summary, thumb: b.thumb, bthumb: b.bthumb, metrics: b.metrics });
        if (Number.isInteger(b.parent) && revs.some(x => x.n === b.parent)) r.parent = b.parent;
        p.meta.revs.push(r); p.meta.updated = r.time;
        await saveMeta(p);
        return r;
      }),
      revision: guard(async (id, n) => { const p = await find(id); rev(p, n); return readJSON(p.dir, `r${n}.json`); }),
      thumbUrl: (id, n) => urls.get(`${id}/${n}/thumb`) || "",
      bthumbUrl: (id, n) => urls.get(`${id}/${n}/bthumb`) || "",
      fileUrl: (id, n, name) => urls.get(`${id}/${n}/file/${name}`) || "",
      updateRevision: change(async (id, n, b) => {
        const p = await find(id), r = p.meta.revs[rev(p, n)];
        if (b.message !== undefined) r.message = clip(b.message, 2000);
        if (b.milestone !== undefined) { const t = clip(b.milestone, 60); if (t) r.milestone = t; else delete r.milestone; }
        if (b.metrics !== undefined) { const met = metricsOf(b.metrics); if (met) r.metrics = met; else delete r.metrics; }
        await saveMeta(p);
        return r;
      }),
      // deleting puts it in the trash; purge: out of the trash (or straight out), for good
      deleteRevision: change(async (id, n, purge) => {
        const p = await find(id), i = rev(p, n, true);
        if (purge) { await dropRev(p, i); await saveMeta(p); return { deleted: n, purged: true }; }
        if (p.meta.revs[i].deleted) throw new Error("the revision is in the trash");
        p.meta.revs[i].deleted = stamp(); await saveMeta(p);
        return { deleted: n, trash: true };
      }),
      restoreRevision: change(async (id, n) => { const p = await find(id), r = p.meta.revs[rev(p, n, true)]; delete r.deleted; await saveMeta(p); return r; }),
      trash: guard(async () => {
        const until = t => new Date(Date.parse(t) + trashDays * DAY).toISOString(), out = { days: trashDays, projects: [], revs: [] };
        for (const p of (await scan(await folder())).values()) {
          if (p.meta.deleted) out.projects.push({ id: p.meta.id, name: p.meta.name, deleted: p.meta.deleted, until: until(p.meta.deleted), count: p.meta.revs.length, bytes: await sizeOf(p.dir) });
          else for (const r of p.meta.revs) if (r.deleted) out.revs.push({ project: p.meta.id, name: p.meta.name, n: r.n, message: r.message, time: r.time, deleted: r.deleted, until: until(r.deleted), size: r.size });
        }
        out.projects.sort((a, b) => b.deleted.localeCompare(a.deleted)); out.revs.sort((a, b) => b.deleted.localeCompare(a.deleted));
        return out;
      }),
      search: guard(async text => {
        const q = clip(text, 100).toLowerCase(), hits = [], has = s => String(s || "").toLowerCase().includes(q);
        if (!q) return hits;
        for (const { meta: pm } of (await scan(await folder())).values()) {
          if (pm.deleted) continue;
          if (has(pm.name) || has(pm.notes) || (pm.tags || []).some(has)) hits.push({ project: pm.id, name: pm.name, n: null, text: has(pm.name) ? pm.name : has(pm.notes) ? pm.notes : (pm.tags || []).join(", ") });
          for (const r of live(pm)) { const f = [r.message, r.summary, r.milestone].find(has); if (f !== undefined) hits.push({ project: pm.id, name: pm.name, n: r.n, time: r.time, milestone: r.milestone, text: f }); }
        }
        return hits.slice(0, 300);
      }),
      // a project as exportBundle (or the site's Download all) writes it → a new project with all its revisions
      importProject: change(async b => {
        const src = b && b.app === "TubeAmpCAD-project" && b.project;
        if (!src || !Array.isArray(src.revs) || !src.revs.length) throw new Error("not a Tube Amp CAD project (File ▾ → Revisions… → Download all writes one)");
        const revs = src.revs.slice().sort((x, y) => x.n - y.n);
        for (const r of revs) if (!isDesign(r.design) || !Number.isInteger(r.n) || r.n < 1) throw new Error(`revision ${r.n} is not a Tube Amp CAD design`);
        if (new Set(revs.map(r => r.n)).size !== revs.length) throw new Error("two revisions with one number");
        const h = await folder(), all = await scan(h), name = clip(src.name, 120) || "Imported project";
        let id = PID.test(String(src.id)) && !all.has(src.id) ? src.id : null;
        if (!id) do id = newId(); while (all.has(id));
        const time = s => (isNaN(Date.parse(s)) ? stamp() : new Date(Date.parse(s)).toISOString());
        const d = await makeDir(h, name), nums = new Set(revs.map(r => r.n));
        const p = { dir: d.dir, name: d.name, meta: { id, name, notes: clip(src.notes, 4000), status: STATUSES.includes(src.status) ? src.status : "", tags: tagsOf(src.tags), created: time(src.created), updated: time(src.updated), revs: [] } };
        for (const r of revs) {
          const x = await putRev(p, r.n, JSON.stringify(r.design, null, 1), { time: time(r.time), message: r.message, summary: r.summary, thumb: r.thumbData, bthumb: r.bthumbData, metrics: r.metrics, milestone: r.milestone });
          if (r.by) x.by = clip(r.by, 200);
          if (Number.isInteger(r.parent) && nums.has(r.parent)) x.parent = r.parent;
          for (const f of Array.isArray(r.files) ? r.files.slice(0, MAX_FILES) : []) { try { await putFile(p, x, f); } catch (e) { /* a file that cannot be kept is left out */ } }
          p.meta.revs.push(x);
        }
        await saveMeta(p); where.set(id, d.name);
        return listItem(p);
      }),
      // the project with every revision's design, pictures and files, as the site's Download all
      exportBundle: guard(async id => {
        const p = await find(id), revs = [];
        const data = async (dir, name, type) => { const f = await fileOf(dir, name).catch(() => null); return f ? `data:${type};base64,` + b64Of(new Uint8Array(await f.arrayBuffer())) : null; };
        for (const r of live(p.meta)) {
          const x = Object.assign({}, r, { design: await readJSON(p.dir, `r${r.n}.json`) });
          if (r.thumb) { const u = await data(p.dir, pic(r.n, "thumb", r.thumb), r.thumb); if (u) x.thumbData = u; }
          if (r.bthumb) { const u = await data(p.dir, pic(r.n, "bthumb", r.bthumb), r.bthumb); if (u) x.bthumbData = u; }
          if (r.files) {
            const fd = await p.dir.getDirectoryHandle(`r${r.n}.files`).catch(() => null);
            x.files = [];
            for (const f of fd ? r.files : []) { const u = await data(fd, f.name, f.type); if (u) x.files.push(Object.assign({}, f, { data: u.slice(u.indexOf(",") + 1) })); }
          }
          revs.push(x);
        }
        return { app: "TubeAmpCAD-project", project: Object.assign({}, p.meta, { revs }) };
      }),
      addFile: change(async (id, n, f) => { const p = await find(id), r = p.meta.revs[rev(p, n)]; await putFile(p, r, f); await saveMeta(p); return r.files; }),
      deleteFile: change(async (id, n, name) => {
        const p = await find(id), r = p.meta.revs[rev(p, n)], f = (r.files || []).find(x => x.name === name);
        if (!f) throw new Error("no such file");
        const fd = await p.dir.getDirectoryHandle(`r${n}.files`).catch(() => null); if (fd) await drop(fd, name);
        r.files = r.files.filter(x => x !== f); if (!r.files.length) { delete r.files; await drop(p.dir, `r${n}.files`); }
        forget(id, n); await saveMeta(p);
        return r.files || [];
      }),
      // the site's short links have no place in a folder
      shares: async () => [],
      deleteShare: async () => { throw new Error("short links are kept on aerocat.tech"); },
    };
    return api;
  }

  let one = null;
  // the vault of this browser (one for the page)
  const shared = () => one || (one = client());
  root.CadVault = { client, shared, NeedFolder, MARK };
})(typeof window !== "undefined" ? window : globalThis);
