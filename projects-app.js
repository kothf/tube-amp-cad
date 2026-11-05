/* The project manager (projects.html): what the server on aerocat.tech keeps, for its owner only:
   the space taken by revisions and short links, every project with its revisions (open one in the
   CAD, download, rename, delete) and every short link (open, delete). The store and its login:
   cad-revisions.js, server/share/revisions.mjs. */
(function () {
  "use strict";
  const R = window.CadRevisions, api = R.client(location.origin);
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

  async function load() {
    if (!api.available) { say("The projects are kept on aerocat.tech: open this page there."); return; }
    say("Asking aerocat.tech…");
    try {
      const me = await api.me();
      [projects, links, trash] = await Promise.all([api.projects(), api.shares(), api.trash()]);
      for (const id of [...open.keys()]) { if (projects.some(p => p.id === id)) open.set(id, (await api.project(id)).revs.slice().reverse()); else open.delete(id); }
      $("signin").hidden = true;
      $("who").textContent = "Signed in as " + me.email;
      space(me); showProjects(); showLinks(); showTrash();
      ["space-card", "projects-card", "links-card"].forEach(id => { $(id).hidden = false; });
      $("import").hidden = false;
      if ($("p-filter").value.trim()) search();
      say("");
    } catch (err) {
      ["space-card", "projects-card", "links-card", "trash-card"].forEach(id => { $(id).hidden = true; });
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
          ${found.length ? `<div class="found">${found.slice(0, 4).map(h => `<a href="circuit_sandbox.html${R.hashOf(p.id, h.n)}" target="_blank" rel="noopener">r${h.n}</a> ${mark(h.text, q)}`).join("<br>")}${found.length > 4 ? `<br>and ${found.length - 4} more` : ""}</div>` : ""}</td>
        <td><select class="status st-${esc(p.status || "none")}" data-act="status" aria-label="Status of ${esc(p.name)}">${Object.entries(STATUS).map(([k, v]) => `<option value="${k}"${k === (p.status || "") ? " selected" : ""}>${v}</option>`).join("")}</select></td>
        <td class="num">${p.count}</td><td class="num wide-only">${size(p.bytes)}</td>
        <td class="t wide-only">${p.last ? `r${p.last.n} · ${esc(when(p.last.time))}` : esc(when(p.created))}</td>
        <td class="act">${p.last ? `<a class="btn active" href="circuit_sandbox.html${R.hashOf(p.id, p.last.n)}" target="_blank" rel="noopener" title="Open the newest revision, r${p.last.n}, in the CAD">Open r${p.last.n} ↗</a> ` : ""}<a class="btn" href="${esc(api.exportUrl(p.id))}" download title="Every revision, with pictures and release files, in one JSON file (Import project… brings it back)">Download</a> <button class="btn" data-act="rename" title="Name, notes and tags">Edit…</button> <button class="btn danger" data-act="del-project" title="To the trash, kept ${trash ? trash.days : 30} days">Delete</button></td></tr>`
        + (revs ? `<tr class="revs" data-p="${esc(p.id)}"><td colspan="7">${revTable(p, revs)}</td></tr>` : "");
    }).join("") : `<tr><td colspan="7" class="empty">${projects.length ? "No project matches." : "No projects yet. In the CAD, File ▾ → Revisions… makes one and saves its revisions."}</td></tr>`;
  }
  function revTable(p, revs) {
    if (!revs.length) return `<div class="empty">No revisions in this project.</div>`;
    return `<table><thead><tr><th>Rev</th><th class="wide-only"></th><th class="wide-only">When</th><th>Message</th><th class="wide-only">Changes</th><th class="num wide-only">Size</th><th></th></tr></thead><tbody>` + revs.map(r => `<tr data-n="${r.n}"${r.milestone ? ' class="ms"' : ""}>
      <td class="n">r${r.n}</td>
      <td class="pic wide-only">${r.thumb ? `<img loading="lazy" alt="r${r.n}" src="${esc(api.thumbUrl(p.id, r.n))}">` : ""}</td>
      <td class="t wide-only">${esc(when(r.time))}${r.parent ? `<div class="muted">from r${r.parent}</div>` : ""}</td>
      <td>${r.milestone ? `<span class="star">★ ${esc(r.milestone)}</span><br>` : ""}${esc(r.message) || '<span class="muted">–</span>'}</td><td class="sum wide-only">${esc(r.summary)}</td><td class="num wide-only">${size(r.size)}</td>
      <td class="act"><a class="btn" href="circuit_sandbox.html${R.hashOf(p.id, r.n)}" target="_blank" rel="noopener" title="Open this revision in the CAD">Open in CAD ↗</a> ${r !== revs[0] ? `<button class="btn" data-act="restore" title="Save it again as the newest revision (from r${r.n}); nothing is lost">Restore as new</button> ` : ""}<button class="btn" data-act="download">.json</button> <button class="btn" data-act="message" title="Its message and milestone">Edit…</button> <button class="btn danger" data-act="del-rev">Delete</button></td></tr>`).join("") + `</tbody></table>`;
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
      try { const h = await api.search(q); if (my === searchSeq) { hits = h; showProjects(); } } catch (err) { if (err.signin) load(); }
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
    } catch (err) { if (err.signin) load(); else say("Could not import: " + err.message, true); }
  }
  async function act(fn, done) {
    try { await fn(); await (done || load)(); } catch (err) { if (err.signin) load(); else say(err.message, true); }
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
  window.TubeProjects = { load, importFiles, state: () => ({ projects, links, open, trash, hits }) };
  load();
})();
