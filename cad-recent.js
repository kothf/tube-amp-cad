/* Recent files (File ▾ → Recent files): the circuits opened or saved lately, newest first, to
   open again with one click. The list (names, kinds, times) is kept in localStorage; for each
   file the browser's file handle (where the File System Access API exists, so Save writes the
   same file again) and a copy of its contents at the last open or save are kept in IndexedDB.
   Reopening reads the file itself when it can; when it cannot (moved, deleted, permission
   refused, or a browser without the API) the kept copy opens instead, untitled, and the status
   line says so. An example in the list opens the example again. */
(function (root) {
  "use strict";
  const KEY = "tubecad_recent", DB = "tubecad-recent", STORE = "files", MAX = 8, MAX_COPY = 5e6;

  function CadRecent(o) {
    // o: { host (the menu's list element), openText(text, name, handle), openExample(file), examples, setStatus, notice (a status kept past the simulation) }
    const read = () => { try { const l = JSON.parse(localStorage.getItem(KEY)); return Array.isArray(l) ? l.filter(e => e && e.id && e.name) : []; } catch (e) { return []; } };
    const write = l => { try { localStorage.setItem(KEY, JSON.stringify(l.slice(0, MAX))); } catch (e) { /* storage full or off: the list stays as it was */ } };

    // IndexedDB: { id → { handle, text } }; any failure (private window, no IndexedDB) just means nothing kept
    let dbp = null;
    function db() {
      if (!dbp) dbp = new Promise((res, rej) => {
        if (!root.indexedDB) { rej(new Error("no IndexedDB")); return; }
        const r = root.indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE);
        r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
      });
      return dbp;
    }
    async function tx(mode, fn) {
      const d = await db();
      return new Promise((res, rej) => {
        const t = d.transaction(STORE, mode), st = t.objectStore(STORE), r = fn(st);
        t.oncomplete = () => res(r && r.result); t.onerror = () => rej(t.error); t.onabort = () => rej(t.error);
      });
    }
    const getData = id => tx("readonly", st => st.get(id)).catch(() => null);
    const delData = id => tx("readwrite", st => st.delete(id)).catch(() => {});

    // the same file is one entry: by its handle where both have one, else by its name
    async function sameFile(e, handle, name) {
      if (e.kind !== "file") return false;
      if (handle && e.handle) {
        const d = await getData(e.id);
        if (d && d.handle && typeof d.handle.isSameEntry === "function") { try { return await d.handle.isSameEntry(handle); } catch (err) { return false; } }
      }
      return e.name === name;
    }
    // a file opened or saved: to the top of the list, with its handle and a copy of its contents
    async function addFile(name, handle, text) {
      let list = read(), old = null;
      for (const e of list) if (await sameFile(e, handle, name)) { old = e; break; }
      const id = old ? old.id : "f" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
      const copy = typeof text === "string" && text.length <= MAX_COPY;
      list = [{ id, kind: "file", name, time: Date.now(), handle: !!handle, copy }].concat(list.filter(e => e.id !== id));
      const gone = list.slice(MAX); write(list); gone.forEach(e => delData(e.id));
      let kept = await tx("readwrite", st => st.put({ handle: handle || null, text: copy ? text : null }, id)).then(() => true, () => false);
      if (!kept && handle) {                   // a handle this browser cannot keep: the copy alone
        kept = await tx("readwrite", st => st.put({ handle: null, text: copy ? text : null }, id)).then(() => true, () => false);
        write(read().map(e => e.id === id ? Object.assign(e, { handle: false }) : e));
      }
      if (!kept) write(read().map(e => e.id === id ? Object.assign(e, { handle: false, copy: false }) : e));
      build();
    }
    function addExample(file) {
      const ex = o.examples.find(x => x.file === file); if (!ex) return;
      let list = read().filter(e => !(e.kind === "example" && e.file === file));
      list = [{ id: "x" + file, kind: "example", file, name: ex.title, time: Date.now() }].concat(list);
      const gone = list.slice(MAX); write(list); gone.forEach(e => delData(e.id));
      build();
    }
    function remove(id) { write(read().filter(e => e.id !== id)); delData(id); build(); }
    function clear() { read().forEach(e => delData(e.id)); write([]); build(); }

    const when = t => {
      const d = new Date(t), now = new Date(), p = n => String(n).padStart(2, "0");
      return d.toDateString() === now.toDateString() ? `${p(d.getHours())}:${p(d.getMinutes())}` : `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    };
    async function reopen(e) {
      if (e.kind === "example") { o.openExample(e.file); return; }
      const d = await getData(e.id);
      let why = "";
      if (d && d.handle) {
        try {
          const h = d.handle;
          if (h.queryPermission && (await h.queryPermission({ mode: "readwrite" })) !== "granted" && h.requestPermission && (await h.requestPermission({ mode: "readwrite" })) !== "granted") throw new Error("permission refused");
          const text = await (await h.getFile()).text();
          if (o.openText(text, h.name, h)) addFile(h.name, h, text);
          return;
        } catch (err) { why = err.name === "NotFoundError" ? "the file is no longer there" : err.message || String(err); }
      } else why = typeof root.showOpenFilePicker === "function" ? "the browser kept no link to the file" : "this browser cannot open a file by itself";
      if (d && typeof d.text === "string") {
        if (o.openText(d.text, e.name, null)) {
          // where files can be read again this is news, so it stays on the status line past the simulation
          (typeof root.showOpenFilePicker === "function" && o.notice ? o.notice : o.setStatus)("warn", `Could not read ${e.name} (${why}). Opened the copy kept from ${when(e.time)} · Save as… writes it to a file`);
          addFile(e.name, null, d.text);        // the file is gone or refused: from now on the copy stands in for it
        }
        return;
      }
      o.setStatus("error", `Could not reopen ${e.name} (${why}) and no copy of it is kept: removed from Recent files. File ▾ → Open… finds it`);
      remove(e.id);
    }

    function build() {
      const host = o.host; if (!host) return;
      host.textContent = "";
      const list = read();
      if (!list.length) {
        const n = document.createElement("div"); n.className = "menu-note"; n.textContent = "No recent files yet"; host.appendChild(n); return;
      }
      list.forEach(e => {
        const b = document.createElement("button"); b.className = "menu-item"; b.setAttribute("role", "menuitem"); b.dataset.recent = e.id;
        b.dataset.ico = e.kind === "example" ? "gallery" : "open";
        b.title = e.kind === "example" ? `Open the example again · ${e.name}` : `Open ${e.name} again · ${e.handle ? "read from its file" : "from the copy kept in this browser"} · last opened or saved ${when(e.time)}`;
        const name = document.createElement("span"); name.className = "recent-name"; name.textContent = e.name;
        const k = document.createElement("kbd"); k.textContent = e.kind === "example" ? "example" : when(e.time);
        b.append(name, k);
        b.addEventListener("click", () => reopen(e));
        host.appendChild(b);
      });
      const c = document.createElement("button"); c.className = "menu-item recent-clear"; c.setAttribute("role", "menuitem"); c.id = "btn-recent-clear";
      c.dataset.ico = "delete"; c.title = "Empty the list; the files themselves stay where they are"; c.textContent = "Clear recent files";
      c.addEventListener("click", clear);
      host.appendChild(c);
      if (root.Icons && root.Icons.decorate) root.Icons.decorate(host);
    }
    root.addEventListener("storage", ev => { if (ev.key === KEY) build(); });   // another window's list
    build();
    return { addFile, addExample, remove, clear, list: read, build, reopen: id => { const e = read().find(x => x.id === id); return e ? reopen(e) : null; } };
  }
  root.CadRecent = CadRecent;
})(typeof window !== "undefined" ? window : globalThis);
