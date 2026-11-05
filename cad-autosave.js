/* Autosaves (File ▾ → Autosaves…): while you edit, the CAD keeps a copy of the circuit in this
   browser every few minutes, so an afternoon's work is never one mistake away from gone. Nothing
   goes to a server and it works on any copy of the app, signed in or not. A copy is made when the
   circuit has changed since the last one and EVERY minutes of editing have passed, and when the tab
   is hidden or closed; the newest MAX are kept (IndexedDB "tubecad-autosave"). The dialog lists
   them newest first with the file's name and what changed since the copy before; Open puts one on
   the sheet (Ctrl+Z brings the circuit back), and from there Save or Save revision keeps it. */
(function (root) {
  "use strict";
  const DB = "tubecad-autosave", STORE = "copies", MAX = 60, EVERY = 5 * 60e3;

  // cad: { circuitJSON, openDesign, fileName, isDirty, setStatus, diff? (CadRevisions.diff with the connections), now? }
  function CadAutosave(cad) {
    const now = cad.now || (() => Date.now());
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    let dbp = null;
    function db() {
      if (!dbp) dbp = new Promise((res, rej) => {
        if (!root.indexedDB) { rej(new Error("no IndexedDB")); return; }
        const r = root.indexedDB.open(DB, 1);
        r.onupgradeneeded = () => r.result.createObjectStore(STORE, { keyPath: "id", autoIncrement: true });
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
    const all = () => tx("readonly", st => st.getAll()).then(l => (l || []).sort((a, b) => b.time - a.time)).catch(() => []);

    // the design without what changes on every save (the revision note), for "the same as before"
    const plain = () => { const d = JSON.parse(cad.circuitJSON()); delete d.revLink; return d; };
    let edited = 0, lastText = "", busy = false;
    // the sheet changed (cad-app.js calls it on every edit)
    function changed() { if (!edited) edited = now(); }
    // a copy, when there is something new: force (the tab going away) skips the wait
    async function keep(force) {
      if (busy || !edited || (!force && now() - edited < EVERY)) return false;
      busy = true;
      try {
        const d = plain();
        if (!(d.comps || []).some(c => c.type !== "frame")) { edited = 0; return false; }
        const text = JSON.stringify(d);
        if (!lastText) { const l = await all(); lastText = l.length ? l[0].text : ""; }
        if (text === lastText) { edited = 0; return false; }
        const prev = lastText ? JSON.parse(lastText) : null;
        const what = prev && cad.diff ? cad.diff(prev, d).text : "";
        await tx("readwrite", st => st.add({ time: now(), name: cad.fileName() || "Untitled", text, size: text.length, what, parts: d.comps.filter(c => !["frame", "note", "ground", "offsheet", "rail"].includes(c.type)).length }));
        lastText = text; edited = 0;
        // the oldest go past MAX
        const l = await all();
        if (l.length > MAX) await tx("readwrite", st => l.slice(MAX).forEach(x => st.delete(x.id)));
        return true;
      } catch (e) { return false; } finally { busy = false; }
    }
    const timer = setInterval(() => { keep(false); }, 60e3);
    if (timer.unref) timer.unref();
    document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") keep(true); });
    root.addEventListener("pagehide", () => { keep(true); });

    const when = t => new Date(t).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    function ago(t) {
      const s = (now() - t) / 1000;
      if (s < 60) return "just now";
      if (s < 3600) return Math.round(s / 60) + " min ago";
      if (s < 86400) return Math.round(s / 3600) + " h ago";
      return when(t);
    }
    let list = [];
    async function open() {
      $("autosave-modal").hidden = false;
      await keep(true);
      list = await all();
      const el = $("autosave-list");
      el.innerHTML = list.length ? list.map(c => `<button class="rev-item" data-id="${c.id}" title="${esc(when(c.time))} · double-click opens it">
          <span></span><span class="rn">${esc(ago(c.time))}</span>
          <span class="rt">${esc(c.name)} <span class="muted">· ${c.parts} parts</span><small>${esc(c.what || (c === list[list.length - 1] ? "the oldest kept" : ""))}</small></span>
          <span class="ra"><span class="btn" data-open="${c.id}">Open</span></span></button>`).join("")
        : `<div class="rev-empty">No copies yet: one is kept every ${EVERY / 60e3} minutes while you edit, and when the tab is closed.</div>`;
    }
    function openCopy(id) {
      const c = list.find(x => x.id === id); if (!c) return;
      if (cad.isDirty() && !confirm(`Open the copy from ${when(c.time)}?\n\nIt replaces the circuit on the sheet, which has changes not saved. Ctrl+Z brings the circuit back.`)) return;
      if (cad.openDesign(JSON.parse(c.text), `the copy of ${c.name} from ${when(c.time)}`, false)) {
        $("autosave-modal").hidden = true;
        cad.setStatus("ok", `Opened the copy of ${c.name} from ${when(c.time)}: File ▾ → Save keeps it`);
      }
    }
    function wire() {
      const close = () => { $("autosave-modal").hidden = true; };
      $("autosave-close").addEventListener("click", close);
      $("autosave-modal").addEventListener("keydown", e => { if (e.key === "Escape") close(); });
      $("autosave-list").addEventListener("click", e => { const b = e.target.closest("[data-open]"); if (b) openCopy(+b.dataset.open); });
      $("autosave-list").addEventListener("dblclick", e => { const b = e.target.closest("[data-id]"); if (b) openCopy(+b.dataset.id); });
    }
    return { open, wire, changed, keep, all };
  }
  root.CadAutosave = CadAutosave;
})(typeof window !== "undefined" ? window : globalThis);
