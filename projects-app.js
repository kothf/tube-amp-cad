/* The project manager (projects.html): what the server on aerocat.tech keeps, for its owner only:
   the space taken by revisions and short links, every project with its revisions (open one in the
   CAD, download, rename, delete) and every short link (open, delete). The store and its login:
   cad-revisions.js, server/share/revisions.mjs. "Kept in" switches it to the vault, a folder on
   this computer (cad-vault.js): the same projects list and trash over the folder's files, and
   Copy takes a project with all its revisions from one store to the other. */
(function () {
  "use strict";
  const R = window.CadRevisions, site = R.client(location.origin), vault = window.CadVault ? window.CadVault.shared() : null;
  let api = R.active(location.origin), vaultName = "";
  const inVault = () => api.kind === "vault";
  // the other store, for Copy: null where there is none (another copy of the app, a browser without folders)
  const other = () => (inVault() ? (site.available ? site : null) : (vault && vault.supported ? vault : null));
  const $ = id => document.getElementById(id);
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const size = n => n >= 1073741824 ? (n / 1073741824).toFixed(1) + " GB" : n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : n >= 1024 ? Math.round(n / 1024) + " kB" : n + " B";
  const when = t => { const d = new Date(t); return isNaN(d) ? "" : d.toLocaleString(undefined, { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }); };
  const pct = (a, b) => (b ? Math.min(100, a / b * 100) : 0).toFixed(1) + "%";
  const LINKS_SHOWN = 100;
  let projects = [], links = [], allLinks = false, trash = null, hits = null, searchSeq = 0;
  const STATUS = { "": "–", idea: "Idea", design: "Design", building: "Building", done: "Done", archived: "Archived" };
  const open = new Map();          // project id → its revisions, for the projects shown open
  const say = (text, bad) => { $("say").textContent = text; $("say").className = bad ? "bad" : ""; $("msg-card").hidden = !text; };

  const CARDS = ["space-card", "projects-card", "links-card", "trash-card"];
  // the folder is not ready (cad-vault.js NeedFolder): say why, with the button that mends it
  async function needFolder(why) {
    CARDS.forEach(id => { $(id).hidden = true; });
    $("import").hidden = true; $("who").textContent = "";
    const st = await vault.status();
    $("folder-grant").hidden = why !== "permission"; $("folder-grant").textContent = `Allow ${st.name || "the folder"}`;
    $("folder-pick").hidden = why === "unsupported"; $("folder-pick").textContent = st.name ? "Add a folder…" : "Choose folder…";
    $("folder-forget").hidden = !st.name;
    say({
      none: "A vault is a folder on this computer that keeps your projects and their revisions as plain files. Press Choose folder… and pick an empty folder, or a vault made before; the browser asks once for leave to change the files in it.",
      permission: "The browser wants your leave again to use the vault's folder (it asks after a restart): press Allow.",
      gone: "The vault's folder cannot be found: it was moved, renamed, or is on a drive that is not connected. Connect the drive and press Refresh, or choose the folder again.",
      unsupported: "This browser cannot open a folder on the computer, which a vault needs: Chrome and Edge can.",
    }[why]);
  }
  async function load() {
    // Kept in: aerocat.tech and every vault folder this browser remembers
    const list = vault && vault.supported ? await vault.vaults() : [], now = list.find(v => v.current);
    $("store").innerHTML = `<option value="site">aerocat.tech</option>` + list.map(v => `<option value="vault:${esc(v.id)}">Folder: ${esc(v.name)}</option>`).join("") + (list.length ? "" : `<option value="vault"${vault ? "" : " disabled"}>A folder on this computer (vault)…</option>`);
    $("store").value = inVault() ? (now ? "vault:" + now.id : "vault") : "site";
    vaultName = now ? now.name : "";
    $("folder-forget").hidden = true;
    $("brand-where").textContent = inVault() ? "projects in the folder vault" : "projects on the server";
    $("signin").hidden = true; $("folder-pick").hidden = $("folder-grant").hidden = true;
    if (!api.available) {
      CARDS.forEach(id => { $(id).hidden = true; }); $("import").hidden = true; $("who").textContent = "";
      if (inVault()) needFolder("unsupported"); else say("The projects are kept on aerocat.tech: open this page there, or switch Kept in to a folder on this computer.");
      return;
    }
    const my = api;
    say(inVault() ? "Reading the folder…" : "Asking aerocat.tech…");
    try {
      const me = await api.me();
      if (my !== api) return;
      [projects, links, trash] = await Promise.all([api.projects(), api.shares(), api.trash().catch(e => { if (e.signin) throw e; return null; })]);
      for (const id of [...open.keys()]) { if (projects.some(p => p.id === id)) open.set(id, (await api.project(id)).revs.slice().reverse()); else open.delete(id); }
      if (my !== api) return;
      $("signin").hidden = true;
      $("who").textContent = me.vault ? `Folder ${me.folder} · ${size(me.revisions.bytes)}, ${me.revisions.count} revision${me.revisions.count === 1 ? "" : "s"} in ${me.revisions.projects} project${me.revisions.projects === 1 ? "" : "s"}` : "Signed in as " + me.email;
      if (!me.vault) space(me);
      showProjects(); showLinks(); showTrash();
      $("projects-card").hidden = false; $("space-card").hidden = $("links-card").hidden = !!me.vault;
      $("folder-pick").hidden = !me.vault; $("folder-pick").textContent = "Add a folder…"; $("folder-forget").hidden = !me.vault;
      $("import").hidden = false;
      if ($("p-filter").value.trim()) search();
      // a store older than this page has no trash (nor import, search, release files): say how to update it
      say(trash || me.vault ? "" : "The store on the server is older than this page: the trash, import, search and release files need it updated (run server/share/update.sh on the server).", !trash);
    } catch (err) {
      if (my !== api) return;
      if (err.folder) { needFolder(err.folder); return; }
      CARDS.forEach(id => { $(id).hidden = true; });
      $("import").hidden = true;
      if (err.signin) { $("signin").hidden = false; say("Only the owner of aerocat.tech sees this page: press Sign in ↗ (the site's Cloudflare login opens in its own window)."); }
      else say("Could not read the store: " + err.message, true);
    }
  }
  function space(me) {
    const t = me.total, r = me.revisions, s = me.shares;
    $("m-total").textContent = `${size(t.bytes)} of ${size(t.max)}`;
    $("b-revs").style.width = pct(r.bytes, t.max); $("b-links").style.width = pct(s.bytes, t.max);
    $("m-total-note").textContent = `${size(Math.max(0, t.max - t.bytes))} free`;
    $("m-revs").textContent = size(r.bytes);
    $("b-revs-own").style.width = pct(r.bytes, r.max);
    $("m-revs-note").textContent = `${r.count} revision${r.count === 1 ? "" : "s"} in ${r.projects} project${r.projects === 1 ? "" : "s"}` + (r.max < t.max ? ` · up to ${size(r.max)}` : "") + " · never deleted to make room";
    $("m-links").textContent = size(s.bytes);
    $("b-links-own").style.width = pct(s.bytes, Math.min(s.max, t.max));
    $("m-links-note").textContent = `${s.count} link${s.count === 1 ? "" : "s"} · the oldest go when space runs out`;
    if (me.disk) {
      $("m-disk").textContent = `${size(me.disk.free)} free`;
      $("b-disk").style.width = pct(me.disk.size - me.disk.free, me.disk.size);
      $("m-disk-note").textContent = `of ${size(me.disk.size)} on the drive the store is on`;
    } else { $("m-disk").textContent = "–"; $("m-disk-note").textContent = "the server did not say"; }
  }

  function showProjects() {
    const q = $("p-filter").value.trim().toLowerCase(), st = $("p-status").value;
    // the server's search finds revisions too: their projects stay in the list
    const hitIds = new Set((hits || []).map(h => h.project));
    const hit = p => (!st || (st === "active" ? p.status !== "archived" : p.status === st)) && (!q || hitIds.has(p.id) || [p.name, p.notes, p.last && p.last.message, (p.tags || []).join(" ")].some(s => String(s || "").toLowerCase().includes(q)));
    const by = $("p-sort").value, list = projects.filter(hit).sort(by === "name" ? (a, b) => a.name.localeCompare(b.name) : by === "size" ? (a, b) => b.bytes - a.bytes : (a, b) => String(b.updated).localeCompare(String(a.updated)));
    $("projects").innerHTML = list.length ? list.map(p => {
      const revs = open.get(p.id);
      const found = (hits || []).filter(h => h.project === p.id && h.n !== null);
      return `<tr class="proj${revs ? " open" : ""}" data-p="${esc(p.id)}">
        <td class="pic wide-only">${p.thumb ? `<img loading="lazy" alt="" src="${esc(api.thumbUrl(p.id, p.thumb))}">` : '<span class="nopic"></span>'}</td>
        <td class="name"><span class="caret">▸</span><b>${esc(p.name)}</b>${p.milestones ? ` <span class="star" title="Milestones">★${p.milestones}</span>` : ""}
          ${(p.tags || []).map(t => `<span class="tag">${esc(t)}</span>`).join("")}
          ${p.notes ? `<div class="notes">${esc(p.notes)}</div>` : ""}
          ${p.last && p.last.message ? `<div class="notes">r${p.last.n}: ${esc(p.last.message)}</div>` : ""}
          ${found.length ? `<div class="found">${found.slice(0, 4).map(h => `<a href="circuit_sandbox.html${R.hashOf(p.id, h.n, inVault() && (api.id() || true))}" target="_blank" rel="noopener">r${h.n}</a> ${mark(h.text, q)}`).join("<br>")}${found.length > 4 ? `<br>and ${found.length - 4} more` : ""}</div>` : ""}</td>
        <td><select class="status st-${esc(p.status || "none")}" data-act="status" aria-label="Status of ${esc(p.name)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === (p.status || "") ? " selected" : ""}>${v}</option>`).join("")}</select></td>
        <td class="num">${p.count}</td><td class="num wide-only">${size(p.bytes)}</td>
        <td class="t wide-only">${p.last ? `r${p.last.n} · ${esc(when(p.last.time))}` : esc(when(p.created))}</td>
        <td class="act">${p.last ? `<a class="btn active" href="circuit_sandbox.html${R.hashOf(p.id, p.last.n, inVault() && (api.id() || true))}" target="_blank" rel="noopener" title="Open the newest revision, r${p.last.n}, in the CAD">Open r${p.last.n} ↗</a> ` : ""}${api.exportUrl ? `<a class="btn" href="${esc(api.exportUrl(p.id))}" download title="Every revision, with pictures and release files, in one JSON file (Import project… brings it back)">Download</a>` : `<button class="btn" data-act="export" title="Every revision, with pictures and release files, in one JSON file (Import project… brings it back)">Download</button>`} ${other() && p.count ? `<button class="btn" data-act="copy" title="${inVault() ? "Copy this project with all its revisions, pictures and release files to aerocat.tech (sign in there first); the folder keeps its own" : `Copy this project with all its revisions, pictures and release files into the vault${vaultName ? ", the folder " + esc(vaultName) : ", a folder on this computer"} (Kept in picks which folder); the server keeps its own`}">${inVault() ? "Copy to aerocat.tech" : "Copy to folder"}</button> ` : ""}<button class="btn" data-act="rename" title="Name, notes and tags">Edit…</button> <button class="btn danger" data-act="del-project" title="To the trash, kept ${trash ? trash.days : 30} days">Delete</button></td></tr>`
        + (revs ? `<tr class="revs" data-p="${esc(p.id)}"><td colspan="7">${revTable(p, revs)}</td></tr>` : "");
    }).join("") : `<tr><td colspan="7" class="empty">${projects.length ? "No project matches." : "No projects yet. In the CAD, File ▾ → Revisions… makes one and saves its revisions; Import project… brings one in."}</td></tr>`;
  }
  function revTable(p, revs) {
    if (!revs.length) return `<div class="empty">No revisions in this project.</div>`;
    return `<table><thead><tr><th>Rev</th><th class="wide-only"></th><th class="wide-only">When</th><th>Message</th><th class="wide-only">Changes</th><th class="num wide-only">Size</th><th></th></tr></thead><tbody>` + revs.map(r => `<tr data-n="${r.n}"${r.milestone ? ' class="ms"' : ""}>
      <td class="n">r${r.n}</td>
      <td class="pic wide-only">${r.thumb ? `<img loading="lazy" alt="r${r.n}" src="${esc(api.thumbUrl(p.id, r.n))}">` : ""}</td>
      <td class="t wide-only">${esc(when(r.time))}${r.parent ? `<div class="muted">from r${r.parent}</div>` : ""}</td>
      <td>${r.milestone ? `<span class="star">★ ${esc(r.milestone)}</span><br>` : ""}${esc(r.message) || '<span class="muted">–</span>'}</td><td class="sum wide-only">${esc(r.summary)}${r.files ? `<div class="files">${r.files.map(f => `<a href="${esc(api.fileUrl(p.id, r.n, f.name))}" download="${esc(f.name)}">${esc(f.name)}</a>`).join(" · ")}</div>` : ""}${r.metrics && r.metrics["Output (W)"] !== undefined ? `<div class="muted">output ${(+r.metrics["Output (W)"]).toPrecision(3)} W</div>` : ""}</td><td class="num wide-only">${size(r.size)}</td>
      <td class="act"><a class="btn" href="circuit_sandbox.html${R.hashOf(p.id, r.n, inVault() && (api.id() || true))}" target="_blank" rel="noopener" title="Open this revision in the CAD">Open in CAD ↗</a> ${r !== revs[0] ? `<button class="btn" data-act="restore" title="Save it again as the newest revision (from r${r.n}); nothing is lost">Restore as new</button> ` : ""}<button class="btn" data-act="download">.json</button> <button class="btn" data-act="message" title="Its message and milestone">Edit…</button> <button class="btn danger" data-act="del-rev">Delete</button></td></tr>`).join("") + `</tbody></table>`;
  }
  function showLinks() {
    const list = allLinks ? links : links.slice(0, LINKS_SHOWN);
    $("links-count").textContent = `${links.length} link${links.length === 1 ? "" : "s"}`;
    $("links").innerHTML = list.length ? list.map(l => `<tr data-s="${esc(l.id)}"><td class="mono"><a href="/s/${esc(l.id)}" target="_blank" rel="noopener" style="color:var(--links)">aerocat.tech/s/${esc(l.id)}</a></td><td class="num wide-only">${size(l.size)}</td><td class="t wide-only">${esc(when(l.time))}</td>
      <td class="act"><a class="btn" href="circuit_sandbox.html#s=${esc(l.id)}" target="_blank" rel="noopener">Open in CAD ↗</a> <button class="btn danger" data-act="del-link">Delete</button></td></tr>`).join("")
      : `<tr><td colspan="4" class="empty">No short links stored.</td></tr>`;
    $("links-more").hidden = allLinks || links.length <= LINKS_SHOWN;
    $("links-more").textContent = `Show all ${links.length}`;
  }

  // the search words in bold within a found text
  function mark(text, q) {
    const t = String(text || ""), i = t.toLowerCase().indexOf(q);
    if (!q || i < 0) return esc(t.slice(0, 120));
    const from = Math.max(0, i - 40);
    return (from ? "…" : "") + esc(t.slice(from, i)) + "<b>" + esc(t.slice(i, i + q.length)) + "</b>" + esc(t.slice(i + q.length, i + q.length + 60));
  }
  // the server looks through every project and revision; the list then shows where it found them
  let searchTimer = 0;
  function search() {
    clearTimeout(searchTimer);
    const q = $("p-filter").value.trim(), my = ++searchSeq;
    if (!q) { hits = null; showProjects(); return; }
    searchTimer = setTimeout(async () => {
      try { const h = await api.search(q); if (my === searchSeq) { hits = h; showProjects(); } } catch (err) { if (err.signin || err.folder) load(); }
    }, 220);
    showProjects();
  }
  const until = t => new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  function showTrash() {
    const t = trash || { projects: [], revs: [], days: 30 }, n = t.projects.length + t.revs.length;
    $("trash-card").hidden = !n;
    $("trash-count").textContent = n ? `${n} item${n === 1 ? "" : "s"} · each kept ${t.days} days, then deleted for good` : "";
    $("trash").innerHTML = t.projects.map(p => `<tr data-tp="${esc(p.id)}"><td><b>${esc(p.name)}</b> <span class="muted">project, ${p.count} revision${p.count === 1 ? "" : "s"}</span></td><td class="num wide-only">${size(p.bytes)}</td><td class="t wide-only">deleted ${esc(when(p.deleted))}</td><td class="t">until ${esc(until(p.until))}</td>
        <td class="act"><button class="btn" data-act="restore-project">Restore</button> <button class="btn danger" data-act="purge-project">Delete for good</button></td></tr>`).join("")
      + t.revs.map(r => `<tr data-tp="${esc(r.project)}" data-n="${r.n}"><td><b>r${r.n}</b> of ${esc(r.name)} <span class="muted">${esc(r.message || "")}</span></td><td class="num wide-only">${size(r.size)}</td><td class="t wide-only">deleted ${esc(when(r.deleted))}</td><td class="t">until ${esc(until(r.until))}</td>
        <td class="act"><button class="btn" data-act="restore-rev">Restore</button> <button class="btn danger" data-act="purge-rev">Delete for good</button></td></tr>`).join("");
  }
  // Import project…: a "Download all" file, a design saved with File › Save (one revision), or a
  // project's folder from a backup (revisions/<id>/: project.json and <n>.json.gz)
  const readText = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsText(f); });
  const readDataUrl = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = () => rej(r.error); r.readAsDataURL(f); });
  async function gunzipText(f) {
    if (!window.DecompressionStream) throw new Error("this browser cannot unpack .gz files");
    return new Response(f.stream().pipeThrough(new DecompressionStream("gzip"))).text();
  }
  async function bundleOf(files) {
    if (files.length === 1 && /\.json$/i.test(files[0].name)) {
      const j = JSON.parse(await readText(files[0]));
      if (j && j.app === "TubeAmpCAD-project") return j;
      if (j && j.app === "TubeAmpCAD") return { app: "TubeAmpCAD-project", project: { name: files[0].name.replace(/\.json$/i, ""), revs: [{ n: 1, message: "Imported from " + files[0].name, design: j }] } };
      throw new Error("not a Tube Amp CAD file");
    }
    const by = new Map([...files].map(f => [f.name, f]));
    const metaFile = by.get("project.json");
    if (!metaFile) throw new Error("pick a project's folder from a backup: it holds project.json and the r<n>.json.gz files");
    const meta = JSON.parse(await readText(metaFile));
    const revs = [];
    for (const r of meta.revs || []) {
      if (r.deleted) continue;
      const gz = by.get(r.n + ".json.gz"); if (!gz) continue;
      const x = Object.assign({}, r, { design: JSON.parse(await gunzipText(gz)) });
      if (r.thumb && by.get(r.n + ".thumb")) x.thumbData = await readDataUrl(new Blob([by.get(r.n + ".thumb")], { type: r.thumb }));
      if (r.bthumb && by.get(r.n + ".bthumb")) x.bthumbData = await readDataUrl(new Blob([by.get(r.n + ".bthumb")], { type: r.bthumb }));
      if (r.files) {
        x.files = [];
        for (const f of r.files) {
          const file = [...files].find(g => g.name === f.name && (g.webkitRelativePath || "").includes(r.n + ".files/"));
          if (file) x.files.push(Object.assign({}, f, { data: (await readDataUrl(file)).split(",")[1] }));
        }
      }
      revs.push(x);
    }
    if (!revs.length) throw new Error("no revisions found in that folder");
    return { app: "TubeAmpCAD-project", project: Object.assign({}, meta, { revs }) };
  }
  async function importFiles(files) {
    if (!files || !files.length) return;
    say("Reading…");
    try {
      const b = await bundleOf(files);
      say(`Importing ${b.project.name} (${b.project.revs.length} revision${b.project.revs.length === 1 ? "" : "s"})…`);
      const p = await api.importProject(b);
      await load();
      say(`Imported ${p.name}: ${p.count} revision${p.count === 1 ? "" : "s"}.`);
    } catch (err) { if (err.signin || err.folder) load(); else say("Could not import: " + err.message, true); }
  }
  async function act(fn, done) {
    try { await fn(); await (done || load)(); } catch (err) { if (err.signin || err.folder) load(); else say(err.message, true); }
  }
  // the page's own dialog: a question, optional fields, and the button that does it → the fields' values, or null
  function ask({ title, text, fields = [], ok, danger }) {
    const m = $("ask"), body = $("ask-fields");
    $("ask-title").textContent = title; $("ask-text").textContent = text || ""; $("ask-text").hidden = !text;
    body.innerHTML = fields.map((f, i) => `<label>${esc(f.label)}${f.long ? `<textarea data-i="${i}" rows="3">${esc(f.value || "")}</textarea>` : `<input type="text" data-i="${i}" value="${esc(f.value || "")}"${f.list ? ` list="ask-list-${i}"` : ""} placeholder="${esc(f.placeholder || "")}">`}${f.list ? `<datalist id="ask-list-${i}">${f.list.map(o => `<option value="${esc(o)}">`).join("")}</datalist>` : ""}</label>`).join("");
    const okBtn = $("ask-ok"); okBtn.textContent = ok; okBtn.classList.toggle("danger-fill", !!danger);
    m.hidden = false;
    (body.querySelector("input, textarea") || okBtn).focus();
    return new Promise(resolve => {
      const done = v => { m.hidden = true; okBtn.onclick = $("ask-cancel").onclick = m.onkeydown = null; resolve(v); };
      okBtn.onclick = () => done([...body.querySelectorAll("[data-i]")].map(el => el.value));
      $("ask-cancel").onclick = () => done(null);
      m.onkeydown = e => { if (e.key === "Escape") done(null); if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") okBtn.click(); };
    });
  }
  $("projects").addEventListener("click", e => {
    const b = e.target.closest("[data-act]"), row = e.target.closest("tr[data-p]");
    if (!row) return;
    const id = row.dataset.p, p = projects.find(x => x.id === id);
    if (!b) {
      if (!row.classList.contains("proj") || e.target.closest("a")) return;
      if (open.has(id)) { open.delete(id); showProjects(); }
      else act(async () => { open.set(id, (await api.project(id)).revs.slice().reverse()); }, async () => showProjects());
      return;
    }
    const n = +((b.closest("tr[data-n]") || {}).dataset || {}).n;
    switch (b.dataset.act) {
      case "export":
        act(async () => {
          say(`Putting ${p.name} together…`);
          const a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([JSON.stringify(await api.exportBundle(id))], { type: "application/json" }));
          a.download = `${p.name.replace(/[^\w.-]+/g, "_").slice(0, 60) || id}-revisions.json`; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 60000);
          say("");
        }, async () => {});
        break;
      case "copy": {
        const to = other(), name = inVault() ? "aerocat.tech" : vaultName ? "the folder " + vaultName : "the folder vault";
        (async () => {
          say(`Copying ${p.name} to ${name}…`);
          try {
            const q = await to.importProject(await api.exportBundle(id));
            say(`Copied ${p.name} to ${name}: ${q.count} revision${q.count === 1 ? "" : "s"}. Switch Kept in to see it there.`);
          } catch (err) {
            say(err.signin ? "Sign in on aerocat.tech first: switch Kept in to aerocat.tech, sign in, then come back and copy." : err.folder ? "Choose the vault's folder first: switch Kept in to the folder on this computer, choose it, then come back and copy." : "Could not copy: " + err.message, true);
          }
        })();
        break;
      }
      case "rename":
        ask({ title: "Edit the project", fields: [{ label: "Name", value: p.name }, { label: "Notes", value: p.notes, long: true }, { label: "Tags (comma between them)", value: (p.tags || []).join(", "), placeholder: "SE, 2A3, guitar…" }], ok: "Save" }).then(v => {
          if (v && v[0].trim()) act(() => api.updateProject(id, { name: v[0].trim(), notes: v[1], tags: v[2] }));
        });
        break;
      case "del-project":
        ask({ title: `Delete ${p.name}?`, text: `It goes to the trash with its ${p.count} revisions, and can be restored there for ${trash ? trash.days : 30} days.`, ok: "Move to the trash", danger: true }).then(v => { if (v) act(() => api.deleteProject(id)); });
        break;
      case "message": {
        const r = open.get(id).find(x => x.n === n);
        ask({ title: `r${n} of ${p.name}`, fields: [{ label: "Message", value: r.message, long: true }, { label: "Milestone (empty: none)", value: r.milestone, list: ["Sent to fab", "Built", "Measured", "Released"], placeholder: "Sent to fab, Built…" }], ok: "Save" })
          .then(v => { if (v) act(() => api.updateRevision(id, n, { message: v[0], milestone: v[1] })); });
        break;
      }
      case "del-rev":
        ask({ title: `Delete r${n} of ${p.name}?`, text: `It goes to the trash and can be restored there for ${trash ? trash.days : 30} days. The other revisions keep their numbers.`, ok: "Move to the trash", danger: true }).then(v => { if (v) act(() => api.deleteRevision(id, n)); });
        break;
      case "restore": {
        const revs = open.get(id), r = revs.find(x => x.n === n);
        act(async () => {
          const [d, latest] = await Promise.all([api.revision(id, n), api.revision(id, revs[0].n)]);
          await api.saveRevision(id, { message: `Restored r${n}${r.message ? ": " + r.message : ""}`, summary: `restored r${n}: ` + R.diff(latest, d).text, parent: n, metrics: r.metrics, design: d, force: true });
          open.set(id, (await api.project(id)).revs.slice().reverse());
        });
        break;
      }
      case "download":
        act(async () => {
          const d = await api.revision(id, n), a = document.createElement("a");
          a.href = URL.createObjectURL(new Blob([JSON.stringify(d, null, 1)], { type: "application/json" }));
          a.download = `${p.name.replace(/[^\w.-]+/g, "_")}-r${n}.json`; document.body.appendChild(a); a.click(); a.remove();
          setTimeout(() => URL.revokeObjectURL(a.href), 1000);
        }, async () => {});
        break;
    }
  });
  $("projects").addEventListener("change", e => {
    const sel = e.target.closest("select[data-act=status]"); if (!sel) return;
    const id = sel.closest("tr[data-p]").dataset.p;
    act(() => api.updateProject(id, { status: sel.value }));
  });
  $("trash").addEventListener("click", e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const row = b.closest("tr"), id = row.dataset.tp, n = +row.dataset.n;
    const p = trash.projects.find(x => x.id === id), r = trash.revs.find(x => x.project === id && x.n === n);
    switch (b.dataset.act) {
      case "restore-project": act(() => api.restoreProject(id)); break;
      case "restore-rev": act(() => api.restoreRevision(id, n)); break;
      case "purge-project":
        ask({ title: `Delete ${p.name} for good?`, text: "It and all its revisions are gone for good. Only a backup still has them.", ok: "Delete for good", danger: true }).then(v => { if (v) act(() => api.purgeProject(id)); });
        break;
      case "purge-rev":
        ask({ title: `Delete r${n} of ${r.name} for good?`, text: "It is gone for good. Only a backup still has it.", ok: "Delete for good", danger: true }).then(v => { if (v) act(() => api.deleteRevision(id, n, true)); });
        break;
    }
  });
  $("import").addEventListener("click", () => {
    ask({ title: "Import a project", text: "A file from Download all (every revision), a design saved with File › Save (one revision), or a project's folder from a backup (revisions/<id>, with project.json in it).", ok: "Pick a file…" }).then(v => { if (v) $("import-file").click(); });
    $("ask-fields").innerHTML = '<button class="btn" id="ask-folder" style="margin-top:4px">Pick a backup folder…</button>';
    $("ask-folder").onclick = () => { $("ask-cancel").click(); $("import-folder").click(); };
  });
  $("import-file").addEventListener("change", e => { importFiles(e.target.files); e.target.value = ""; });
  $("import-folder").addEventListener("change", e => { importFiles(e.target.files); e.target.value = ""; });
  $("p-status").addEventListener("change", showProjects);
  $("links").addEventListener("click", e => {
    const b = e.target.closest("[data-act=del-link]"); if (!b) return;
    const id = b.closest("tr").dataset.s;
    ask({ title: `Delete aerocat.tech/s/${id}?`, text: "Whoever has this link can no longer open the design.", ok: "Delete the link", danger: true }).then(v => { if (v) act(() => api.deleteShare(id)); });
  });
  $("links-more").addEventListener("click", () => { allLinks = true; showLinks(); });
  $("p-filter").addEventListener("input", search);
  $("refresh").addEventListener("click", load);
  $("signin").addEventListener("click", async () => { say("Waiting for the login window…"); await api.signIn(); load(); });
  $("p-sort").addEventListener("change", showProjects);
  $("store").addEventListener("change", async e => {
    const v = e.target.value !== "site" && vault ? "vault" : "site";
    if (e.target.value.startsWith("vault:")) await vault.select(e.target.value.slice(6));
    R.setStore(v); api = v === "vault" ? vault : site;
    open.clear(); projects = []; links = []; trash = null; hits = null;
    load();
  });
  $("folder-pick").addEventListener("click", async () => { try { if (await vault.choose()) { open.clear(); load(); } } catch (err) { say(err.message, true); } });
  $("folder-forget").addEventListener("click", async () => {
    const st = await vault.status();
    if (!(await ask({ title: `Take the folder ${st.name} off the list?`, text: "Its files stay where they are; Add a folder… brings it back.", ok: "Forget folder" }))) return;
    await vault.disconnect(); open.clear(); load();
  });
  $("folder-grant").addEventListener("click", async () => { if (await vault.grant()) load(); else say("The browser did not give leave to use the folder.", true); });
  window.TubeProjects = { load, importFiles, state: () => ({ projects, links, open, trash, hits }) };
  load();
})();
