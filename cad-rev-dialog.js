/* File ▾ → Revisions…: the design kept as numbered revisions of a project on aerocat.tech, for the
   site's owner only (cad-revisions.js talks to the store, server/share/revisions.mjs keeps it).
   The dialog lists a project's revisions with a preview of the one picked (its picture, message,
   changes and the revision it was made from). Save revision (Ctrl+Alt+S) keeps the sheet as it is
   now, board included, with a message, a summary of what changed and a picture of the first
   sheet; Open puts a revision on the sheet; Compare marks on the sheet itself what changed since
   it, change by change; a revision can be starred as a milestone ("Sent to fab"). The toolbar's
   chip says which revision the sheet came from and • when it has changed since. */
(function (root) {
  "use strict";
  const KEY = "tubecad.rev.project", AT = "tubecad.rev.at";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  function CadRevDialog(cad) {
    const { circuitJSON, openDesign, setStatus, sheetName, isDirty, showDiff, focusDiff, thumbnail } = cad;
    const R = root.CadRevisions, api = R.client(location.origin);
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const keep = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private window */ } };
    const designs = new Map();               // "<project>.<n>" → design, read once
    let projects = [], revs = [], pending = null, seq = 0, pick = null, starsOnly = false, nowHash = "";
    let cur = load(KEY) || "";
    // the revision the sheet came from (opened or saved): { project, name, n, hash }
    let at = (() => { try { return JSON.parse(load(AT)) || null; } catch (e) { return null; } })();
    let diff = null;                         // Compare on the sheet: { project, n, name }
    const remember = id => { cur = id; keep(KEY, id); };
    const info = (text, kind) => { const el = $("rev-info"); el.textContent = text || ""; el.className = "insp-help" + (kind ? " " + kind : ""); };
    const when = t => { const d = new Date(t); return isNaN(d) ? "" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
    // "just now", "5 min ago", "3 h ago", "yesterday", else the date
    function ago(t) {
      const s = (Date.now() - new Date(t)) / 1000;
      if (!(s >= 0)) return when(t);
      if (s < 60) return "just now";
      if (s < 3600) return Math.round(s / 60) + " min ago";
      if (s < 86400) return Math.round(s / 3600) + " h ago";
      if (s < 172800) return "yesterday";
      return new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric", year: new Date(t).getFullYear() === new Date().getFullYear() ? undefined : "numeric" });
    }
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
      if (err && err.signin) { $("rev-modal").hidden = false; view("signin"); info(""); }
      else info(err.message, "warn");
    }
    const mb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " kB";
    const projectName = id => (projects.find(p => p.id === (id || cur)) || {}).name || (at && at.project === (id || cur) ? at.name : "the project");

    // ---- the toolbar's chip: which revision the sheet came from, • when changed since ----
    function chip() {
      const el = $("rev-at"); if (!el) return;
      el.hidden = !at;
      if (!at) return;
      const changed = nowHash && nowHash !== at.hash;
      el.innerHTML = `r${at.n}${changed ? '<span class="dirty"> •</span>' : ""}`;
      el.title = `${at.name} · revision r${at.n}` + (changed ? " · the sheet has changed since: Ctrl+Alt+S saves the next revision" : " · the sheet is this revision") + " (click for the revisions)";
    }
    function attach(project, name, n, hash) { at = { project, name, n, hash }; keep(AT, JSON.stringify(at)); nowHash = hash; chip(); }
    function detach() { at = null; keep(AT, null); closeDiff(); chip(); }
    let tick = 0;
    // the sheet changed: the chip's •, and Compare follows the edits
    function changed() {
      clearTimeout(tick);
      tick = setTimeout(async () => {
        nowHash = await hashOf(sheet()); chip();
        if (diff) markDiff(false).catch(() => {});
      }, 350);
    }

    // ---- the dialog ----
    async function open(want) {
      $("rev-modal").hidden = false;
      info("");
      if (!api.available) { view("off"); $("rev-who").textContent = ""; return; }
      if (want) pending = want;
      info("Asking aerocat.tech…");
      try {
        const me = await api.me();
        $("rev-who").textContent = `${me.email} · ${mb(me.revisions.bytes)} in ${me.revisions.projects} project${me.revisions.projects === 1 ? "" : "s"}, ${mb(me.total.max - me.total.bytes)} free`;
        view("main"); info("");
        if (at && !pending && at.project !== cur) remember(at.project);
        await loadProjects();
        if (pending) { const p = pending; pending = null; await openRev(p.project, p.n, true); }
      } catch (err) { failed(err); }
    }
    async function loadProjects() {
      projects = await api.projects();
      const sel = $("rev-project");
      sel.innerHTML = projects.length ? projects.map(p => `<option value="${esc(p.id)}">${esc(p.name)} · ${p.count} rev${p.count === 1 ? "" : "s"}</option>`).join("") : `<option value="">No projects yet: make one with New project…</option>`;
      if (!projects.some(p => p.id === cur)) cur = projects.length ? projects[0].id : "";
      sel.value = cur; sel.disabled = !projects.length;
      $("rev-save").disabled = $("rev-export").disabled = !cur;
      if (!projects.length) showNew(true);
      await loadRevs();
    }
    async function loadRevs() {
      const my = ++seq;
      revs = [];
      if (!cur) { list(); preview(); $("rev-changes").textContent = ""; return; }
      const p = await api.project(cur);
      if (my !== seq) return;
      revs = p.revs.slice().reverse();
      nowHash = await hashOf(sheet()); chip();
      if (!revs.some(r => r.n === pick)) pick = at && at.project === cur && revs.some(r => r.n === at.n) ? at.n : revs.length ? revs[0].n : null;
      list(); preview();
      await showChanges(my);
    }
    function list() {
      const body = $("rev-list"), shown = revs.filter(r => !starsOnly || r.milestone);
      $("rev-stars").classList.toggle("active", starsOnly);
      $("rev-stars").textContent = `★ Milestones${revs.some(r => r.milestone) ? " (" + revs.filter(r => r.milestone).length + ")" : ""}`;
      if (!cur) { body.innerHTML = `<div class="rev-empty">Make a project, then Save revision keeps this design as its first revision.</div>`; return; }
      if (!revs.length) { body.innerHTML = `<div class="rev-empty">No revisions yet: Save revision keeps this design as r1.</div>`; return; }
      if (!shown.length) { body.innerHTML = `<div class="rev-empty">No milestones yet: pick a revision and press ☆ Milestone.</div>`; return; }
      body.innerHTML = shown.map(r => `<button class="rev-item${r.n === pick ? " on" : ""}${r.hash === nowHash ? " cur" : ""}" data-n="${r.n}" title="${esc(when(r.time))} · double-click opens it">
        <span class="rn">r${r.n}</span>
        <span class="rt">${r.milestone ? `<span class="star">★ ${esc(r.milestone)}</span> ` : ""}${esc(r.message) || '<span class="muted">No message</span>'}<small>${esc(r.summary)}</small></span>
        <span class="ra">${esc(ago(r.time))}${r.hash === nowHash ? '<b title="The sheet is this revision">● sheet</b>' : ""}</span></button>`).join("");
    }
    // the revision picked: its picture and what it holds, with its buttons
    function preview() {
      const r = revs.find(x => x.n === pick), el = $("rev-preview");
      if (!r) { el.innerHTML = `<div class="rev-empty">${cur ? "Pick a revision to see it here." : ""}</div>`; return; }
      el.innerHTML = `<div class="rev-pic">${r.thumb ? `<img alt="r${r.n}, first sheet" src="${esc(api.thumbUrl(cur, r.n))}">` : `<span>No picture (saved before 3.144.0)</span>`}</div>
        <div class="rev-meta"><b>r${r.n}</b>${r.milestone ? ` <span class="star">★ ${esc(r.milestone)}</span>` : ""} · ${esc(when(r.time))}${r.parent ? ` · from r${r.parent}` : ""}</div>
        <div class="rev-msg">${esc(r.message) || '<span class="muted">No message</span>'}</div>
        ${r.summary ? `<div class="rev-sum">${esc(r.summary)}</div>` : ""}
        <div class="rev-btns">
          <button class="btn active" data-act="open" title="Put this revision on the sheet (the next Save revision is made from it)">Open</button>
          <button class="btn" data-act="compare" title="Mark on the sheet what changed since this revision, and step through the changes">Compare on the sheet</button>
          <button class="btn" data-act="star" title="A milestone stands out in the list and can be shown alone">${r.milestone ? "★ Milestone…" : "☆ Milestone…"}</button>
        </div>`;
    }
    // what Save revision would keep: the changes since the revision the sheet came from (else the latest)
    async function showChanges(my) {
      const el = $("rev-changes");
      if (!revs.length) { el.textContent = "The first revision of this project."; return; }
      const base = baseRev();
      try {
        const d = R.diff(await design(cur, base.n), sheet());
        if (my !== seq) return;
        el.textContent = d.none ? `The sheet is the same as r${base.n}: nothing new to save.` : `Changes since r${base.n}: ${d.text}`;
      } catch (err) { el.textContent = ""; }
    }
    // the revision the next one is made from: the one the sheet came from, if it is in this project
    const baseRev = () => (at && at.project === cur && revs.find(r => r.n === at.n)) || revs[0];
    async function save() {
      if (!cur) return;
      const btn = $("rev-save"); btn.disabled = true;
      try {
        const d = sheet(), base = baseRev(), latest = revs[0];
        const summary = base ? (base !== latest ? `from r${base.n}: ` : "") + R.diff(await design(cur, base.n), d).text : "first revision";
        const r = await api.saveRevision(cur, { message: $("rev-message").value.trim(), summary, parent: base && base !== latest ? base.n : undefined, thumb: thumbnail ? thumbnail() : undefined, design: d });
        if (r.same) info(`The sheet is the same as r${r.n}: nothing new saved.`);
        else { designs.set(cur + "." + r.n, d); $("rev-message").value = ""; info(`Saved r${r.n} of ${projectName()}.`, "ok"); setStatus("ok", `Saved revision r${r.n} of ${projectName()}`); }
        attach(cur, projectName(), r.n, r.hash);
        pick = r.n;
        await loadProjects();
      } catch (err) { failed(err); } finally { btn.disabled = !cur; }
    }
    async function openRev(project, n, fromLink) {
      try {
        const d = await design(project, n);
        if (project !== cur) remember(project);
        if (!fromLink && isDirty() && !confirm(`Open r${n} of ${projectName(project)}?\n\nIt replaces the circuit on the sheet, which has changes not saved. Ctrl+Z brings the circuit back.`)) return;
        const name = projectName(project), r = revs.find(x => x.n === n);
        if (!openDesign(structuredClone(d), `revision r${n} of ${name}`, fromLink)) return;
        attach(project, name, n, r ? r.hash : await hashOf(d));
        $("rev-modal").hidden = true;
      } catch (err) { if (fromLink) open(); failed(err); }
    }

    // ---- Compare on the sheet ----
    async function markDiff(jump) {
      const old = await design(diff.project, diff.n), d = R.diff(old, sheet());
      const prev = S().revDiff, idx = prev && !jump ? Math.min(prev.idx, Math.max(0, d.marks.length - 1)) : 0;
      showDiff(Object.assign(d, { idx }));
      bar(d);
      if (jump && d.marks.length) focusDiff(0);
    }
    const S = () => (root.TubeCAD && root.TubeCAD.state) || {};
    async function compare(n) {
      diff = { project: cur, n, name: projectName() };
      $("rev-modal").hidden = true;
      try { await markDiff(true); } catch (err) { diff = null; failed(err); }
    }
    function bar(d) {
      const el = $("rev-diff-bar"); el.hidden = false;
      const count = (k, list) => list.length ? `<span class="k ${k}">${list.length} ${k}</span>` : "";
      const removed = d.marks.filter(m => m.kind === "removed"), cur = d.marks[d.idx];
      const label = m => m ? `<b>${esc(m.comp.label || m.comp.type)}</b> ${m.kind}${m.what ? ": " + esc(m.what.slice(0, 3).join(", ")) : ""}` : "";
      el.innerHTML = `<span class="t">Changes since <b>r${diff.n}</b> of ${esc(diff.name)}</span>
        ${count("added", d.marks.filter(m => m.kind === "added"))}${count("changed", d.marks.filter(m => m.kind === "changed"))}${count("moved", d.marks.filter(m => m.kind === "moved"))}${count("removed", removed)}
        ${d.wires.added || d.wires.removed ? `<span class="k wires">wires +${d.wires.added} −${d.wires.removed}</span>` : ""}${d.board ? '<span class="k board">board changed</span>' : ""}
        ${d.none ? '<span class="t">none: the sheet is this revision</span>' : ""}
        <span class="sp"></span>
        ${d.marks.length ? `<button class="btn" data-step="-1" title="The change before">‹</button><span class="pos">${d.idx + 1} / ${d.marks.length}</span><button class="btn" data-step="1" title="The next change">›</button><span class="cur">${label(cur)}</span>` : ""}
        <button class="btn active" data-act="done" title="Leave Compare (Esc)">Done</button>`;
    }
    function closeDiff() {
      if (!diff && !S().revDiff) return;
      diff = null; showDiff(null);
      const el = $("rev-diff-bar"); if (el) el.hidden = true;
    }
    function step(k) {
      const D = S().revDiff; if (!D) return;
      focusDiff(D.idx + k); bar(D);
    }

    // ---- milestones, new projects, export ----
    // the milestone's name, in place of the preview's buttons
    function star(n) {
      const r = revs.find(x => x.n === n), row = $("rev-preview").querySelector(".rev-btns"); if (!r || !row) return;
      row.innerHTML = `<input type="text" id="rev-star-name" list="rev-star-names" spellcheck="false" placeholder="Sent to fab, Built, Measured…" aria-label="Milestone name" value="${esc(r.milestone || "")}">
        <datalist id="rev-star-names"><option value="Sent to fab"><option value="Built"><option value="Measured"><option value="Released"></datalist>
        <button class="btn active" data-act="star-ok">Save</button>${r.milestone ? '<button class="btn" data-act="star-off">Take off</button>' : ""}<button class="btn" data-act="star-cancel">Cancel</button>`;
      const inp = $("rev-star-name"); inp.focus(); inp.select();
      inp.addEventListener("keydown", e => { if (e.key === "Enter") setStar(n, inp.value); if (e.key === "Escape") { e.stopPropagation(); preview(); } });
    }
    async function setStar(n, name) {
      try { await api.updateRevision(cur, n, { milestone: String(name || "").trim() }); await loadRevs(); } catch (err) { failed(err); }
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
    // Ctrl+Alt+S: the dialog, ready for the message
    async function quickSave() {
      await open();
      if (!$("rev-main").hidden && cur) { const m = $("rev-message"); m.focus(); m.select(); }
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
      $("rev-modal").addEventListener("keydown", e => {
        if (e.key === "Escape") close();
        if (e.key === "Enter" && e.target.id === "rev-message") save();
        if (e.key === "Enter" && e.target.id === "rev-new-name") create();
      });
      $("rev-signin-btn").addEventListener("click", async () => { info("Waiting for the login window…"); await api.signIn(); open(); });
      $("rev-project").addEventListener("change", e => { remember(e.target.value); pick = null; loadRevs().catch(failed); });
      $("rev-new").addEventListener("click", () => showNew($("rev-new-row").hidden));
      $("rev-new-ok").addEventListener("click", create);
      $("rev-new-cancel").addEventListener("click", () => showNew(false));
      $("rev-save").addEventListener("click", save);
      $("rev-export").addEventListener("click", download);
      $("rev-stars").addEventListener("click", () => { starsOnly = !starsOnly; list(); });
      $("rev-list").addEventListener("click", e => { const b = e.target.closest("[data-n]"); if (!b) return; pick = +b.dataset.n; list(); preview(); });
      $("rev-list").addEventListener("dblclick", e => { const b = e.target.closest("[data-n]"); if (b) openRev(cur, +b.dataset.n); });
      $("rev-preview").addEventListener("click", e => {
        const b = e.target.closest("button[data-act]"); if (!b || pick === null) return;
        const act = b.dataset.act;
        if (act === "open") openRev(cur, pick);
        else if (act === "compare") compare(pick);
        else if (act === "star") star(pick);
        else if (act === "star-ok") setStar(pick, $("rev-star-name").value);
        else if (act === "star-off") setStar(pick, "");
        else preview();
      });
      $("rev-diff-bar").addEventListener("click", e => {
        const b = e.target.closest("button"); if (!b) return;
        if (b.dataset.act === "done") closeDiff(); else step(+b.dataset.step);
      });
      const c = $("rev-at");
      if (c) c.addEventListener("click", () => open());
      if (at) hashOf(sheet()).then(h => { nowHash = h; chip(); }).catch(() => {}); else chip();
    }
    return { open, openFromLink, wire, quickSave, changed, detach, closeDiff, state: () => ({ cur, projects, revs, at, pick }) };
  }
  root.CadRevDialog = CadRevDialog;
})(typeof window !== "undefined" ? window : globalThis);
