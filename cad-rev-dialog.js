/* File ▾ → Revisions…: the design kept as numbered revisions of a project on aerocat.tech, for the
   site's owner only (cad-revisions.js talks to the store, server/share/revisions.mjs keeps it).
   Save revision keeps the sheet as it is now, board included, with a message and a summary of
   what changed since the last one; Open puts an earlier revision on the sheet; Compare says what
   differs from the sheet. The project chosen last is remembered in this browser. */
(function (root) {
  "use strict";
  const KEY = "tubecad.rev.project";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadRevDialog(cad) {
    const { circuitJSON, openDesign, setStatus, sheetName, isDirty } = cad;
    const R = root.CadRevisions, api = R.client(location.origin);
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const designs = new Map();               // "<project>.<n>" → design, read once
    let projects = [], revs = [], pending = null, seq = 0;
    let cur = (() => { try { return localStorage.getItem(KEY) || ""; } catch (e) { return ""; } })();
    const remember = id => { cur = id; try { localStorage.setItem(KEY, id); } catch (e) { /* private window */ } };
    const info = (text, kind) => { const el = $("rev-info"); el.textContent = text || ""; el.className = "insp-help" + (kind ? " " + kind : ""); };
    const when = t => { const d = new Date(t); return isNaN(d) ? "" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
    const sheet = () => JSON.parse(circuitJSON());
    // the store's fingerprint of a design (server: SHA-256 of its JSON, base64url, 16 characters)
    async function hashOf(d) {
      if (!(root.crypto && crypto.subtle)) return "";
      const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(d))));
      let s = ""; b.forEach(x => { s += String.fromCharCode(x); });
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 16);
    }
    async function design(project, n) {
      const k = project + "." + n;
      if (!designs.has(k)) designs.set(k, await api.revision(project, n));
      return designs.get(k);
    }
    function view(which) { ["off", "signin", "main"].forEach(w => { $("rev-" + w).hidden = w !== which; }); }
    // a failure: the login wants the user, or something to say
    function failed(err) {
      if (err && err.signin) { view("signin"); info(""); }
      else info(err.message, "warn");
    }

    async function open(want) {
      $("rev-modal").hidden = false;
      $("rev-compare").hidden = true; info("");
      if (!api.available) { view("off"); $("rev-who").textContent = ""; return; }
      if (want) pending = want;
      info("Asking aerocat.tech…");
      try {
        const me = await api.me();
        $("rev-who").textContent = `${me.email} · ${mb(me.revisions.bytes)} in ${me.revisions.projects} project${me.revisions.projects === 1 ? "" : "s"}, ${mb(me.total.max - me.total.bytes)} free`;
        view("main"); info("");
        await loadProjects();
        if (pending) { const p = pending; pending = null; await openRev(p.project, p.n, true); }
      } catch (err) { failed(err); }
    }
    const mb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " kB";
    async function loadProjects() {
      projects = await api.projects();
      const sel = $("rev-project");
      sel.innerHTML = projects.length ? projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${p.count} rev${p.count === 1 ? "" : "s"}</option>`).join("") : `<option value="">No projects yet: make one with New project…</option>`;
      if (!projects.some(p => p.id === cur)) cur = projects.length ? projects[0].id : "";
      sel.value = cur; sel.disabled = !projects.length;
      $("rev-save").disabled = $("rev-export").disabled = !cur;
      if (!projects.length) { showNew(true); }
      await loadRevs();
    }
    async function loadRevs() {
      const my = ++seq, body = $("rev-list");
      revs = [];
      if (!cur) { body.innerHTML = `<tr><td colspan="5" class="empty">Make a project, then Save revision keeps this design as its first revision.</td></tr>`; $("rev-changes").textContent = ""; return; }
      const p = await api.project(cur);
      if (my !== seq) return;
      revs = p.revs.slice().reverse();
      const now = await hashOf(sheet());
      body.innerHTML = revs.length ? revs.map(r => `<tr data-n="${r.n}"${r.hash === now ? ' class="cur" title="The sheet is this revision"' : ""}>
        <td class="n">r${r.n}</td><td class="t">${esc(when(r.time))}</td><td>${esc(r.message) || '<span class="insp-help">–</span>'}</td><td class="sum">${esc(r.summary)}</td>
        <td class="act"><button class="btn" data-act="open" title="Put this revision on the sheet">Open</button> <button class="btn" data-act="compare" title="What differs between this revision and the sheet">Compare</button></td></tr>`).join("")
        : `<tr><td colspan="5" class="empty">No revisions yet: Save revision keeps this design as r1.</td></tr>`;
      await showChanges(my);
    }
    // what Save revision would keep: the changes since the latest revision
    async function showChanges(my) {
      const el = $("rev-changes");
      if (!revs.length) { el.textContent = "The first revision of this project."; return; }
      const last = revs[0];
      try {
        const d = R.diff(await design(cur, last.n), sheet());
        if (my !== seq) return;
        el.textContent = d.none ? `The sheet is the same as r${last.n}: nothing new to save.` : `Changes since r${last.n}: ${d.text}`;
      } catch (err) { el.textContent = ""; }
    }
    async function save() {
      if (!cur) return;
      const btn = $("rev-save"); btn.disabled = true;
      try {
        const d = sheet(), last = revs[0];
        const summary = last ? R.diff(await design(cur, last.n), d).text : "first revision";
        const r = await api.saveRevision(cur, { message: $("rev-message").value.trim(), summary, design: d });
        if (r.same) info(`The sheet is the same as r${r.n}: nothing new saved.`);
        else { designs.set(cur + "." + r.n, d); $("rev-message").value = ""; info(`Saved r${r.n} of ${projectName()}.`, "ok"); setStatus("ok", `Saved revision r${r.n} of ${projectName()}`); }
        await loadProjects();
      } catch (err) { failed(err); } finally { btn.disabled = !cur; }
    }
    const projectName = () => (projects.find(p => p.id === cur) || {}).name || "the project";
    async function openRev(project, n, fromLink) {
      try {
        const d = await design(project, n);
        if (project !== cur) { remember(project); }
        if (!fromLink && isDirty() && !confirm(`Open r${n} of ${projectName()}?\n\nIt replaces the circuit on the sheet, which has changes not saved. Ctrl+Z brings the circuit back.`)) return;
        const p = projects.find(x => x.id === project);
        openDesign(structuredClone(d), `revision r${n} of ${p ? p.name : "the project"}`, fromLink);
        $("rev-modal").hidden = true;
      } catch (err) { if (fromLink) { open(); } failed(err); }
    }
    async function compare(n) {
      try {
        const d = R.diff(await design(cur, n), sheet()), el = $("rev-compare");
        el.hidden = false;
        el.textContent = d.none ? `r${n} and the sheet are the same.` : `From r${n} to the sheet: ${d.text}`;
      } catch (err) { failed(err); }
    }
    function showNew(on) {
      $("rev-new-row").hidden = !on;
      if (on) { const n = $("rev-new-name"); n.value = sheetName().name || ""; n.focus(); n.select(); }
    }
    async function create() {
      const name = $("rev-new-name").value.trim();
      if (!name) { $("rev-new-name").focus(); return; }
      try {
        const p = await api.createProject(name);
        remember(p.id); showNew(false);
        info(`Made the project ${p.name}. Save revision keeps the design as its first revision.`, "ok");
        await loadProjects();
        $("rev-message").focus();
      } catch (err) { failed(err); }
    }
    function download() {
      if (!cur) return;
      const a = document.createElement("a"); a.href = api.exportUrl(cur); a.download = ""; document.body.appendChild(a); a.click(); a.remove();
    }

    // an address with #rev=<project>.<n> (the manager's Open in CAD) opens that revision
    function openFromLink() {
      const want = R.fromHash(location.hash);
      if (!want) return false;
      try { history.replaceState(null, "", location.pathname + location.search); } catch (e) { /* file:// */ }
      if (!api.available) { setStatus("error", "Revisions are kept on aerocat.tech: open the link there"); return true; }
      (async () => {
        try { projects = await api.projects(); await openRev(want.project, want.n, true); }
        catch (err) { if (err.signin) open(want); else setStatus("error", "Could not open the revision: " + err.message); }
      })();
      return true;
    }

    function wire() {
      const close = () => { $("rev-modal").hidden = true; };
      $("rev-close").addEventListener("click", close);
      $("rev-modal").addEventListener("keydown", e => { if (e.key === "Escape") close(); if (e.key === "Enter" && e.target.id === "rev-message") save(); if (e.key === "Enter" && e.target.id === "rev-new-name") create(); });
      $("rev-signin-btn").addEventListener("click", async () => { info("Waiting for the login window…"); await api.signIn(); open(); });
      $("rev-project").addEventListener("change", e => { remember(e.target.value); $("rev-compare").hidden = true; loadRevs().catch(failed); });
      $("rev-new").addEventListener("click", () => showNew($("rev-new-row").hidden));
      $("rev-new-ok").addEventListener("click", create);
      $("rev-new-cancel").addEventListener("click", () => showNew(false));
      $("rev-save").addEventListener("click", save);
      $("rev-export").addEventListener("click", download);
      $("rev-list").addEventListener("click", e => {
        const b = e.target.closest("button[data-act]"); if (!b) return;
        const n = +b.closest("tr").dataset.n;
        if (b.dataset.act === "open") openRev(cur, n); else compare(n);
      });
    }
    return { open, openFromLink, wire, state: () => ({ cur, projects, revs }) };
  }
  root.CadRevDialog = CadRevDialog;
})(typeof window !== "undefined" ? window : globalThis);
