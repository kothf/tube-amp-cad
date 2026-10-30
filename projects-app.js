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
  let projects = [], links = [], allLinks = false;
  const open = new Map();          // project id → its revisions, for the projects shown open
  const say = (text, bad) => { $("say").textContent = text; $("say").className = bad ? "bad" : ""; $("msg-card").hidden = !text; };

  async function load() {
    if (!api.available) { say("The projects are kept on aerocat.tech: open this page there."); return; }
    say("Asking aerocat.tech…");
    try {
      const me = await api.me();
      [projects, links] = await Promise.all([api.projects(), api.shares()]);
      for (const id of [...open.keys()]) { if (projects.some(p => p.id === id)) open.set(id, (await api.project(id)).revs.slice().reverse()); else open.delete(id); }
      $("signin").hidden = true;
      $("who").textContent = "Signed in as " + me.email;
      space(me); showProjects(); showLinks();
      ["space-card", "projects-card", "links-card"].forEach(id => { $(id).hidden = false; });
      say("");
    } catch (err) {
      ["space-card", "projects-card", "links-card"].forEach(id => { $(id).hidden = true; });
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
    const q = $("p-filter").value.trim().toLowerCase();
    const hit = p => !q || [p.name, p.notes, p.last && p.last.message].some(s => String(s || "").toLowerCase().includes(q)) || (open.get(p.id) || []).some(r => (r.message + " " + r.summary).toLowerCase().includes(q));
    const by = $("p-sort").value, list = projects.filter(hit).sort(by === "name" ? (a, b) => a.name.localeCompare(b.name) : by === "size" ? (a, b) => b.bytes - a.bytes : (a, b) => String(b.updated).localeCompare(String(a.updated)));
    $("projects").innerHTML = list.length ? list.map(p => {
      const revs = open.get(p.id);
      return `<tr class="proj${revs ? " open" : ""}" data-p="${esc(p.id)}">
        <td class="name"><span class="caret">▸</span><b>${esc(p.name)}</b>${p.notes ? `<div class="notes">${esc(p.notes)}</div>` : ""}</td>
        <td class="num">${p.count}</td><td class="num wide-only">${size(p.bytes)}</td>
        <td class="t wide-only">${p.last ? `r${p.last.n} · ${esc(when(p.last.time))}` : esc(when(p.created))}</td>
        <td class="act"><a class="btn" href="${esc(api.exportUrl(p.id))}" download title="Every revision in one JSON file">Download</a> <button class="btn" data-act="rename">Rename</button> <button class="btn danger" data-act="del-project">Delete</button></td></tr>`
        + (revs ? `<tr class="revs" data-p="${esc(p.id)}"><td colspan="5">${revTable(p, revs)}</td></tr>` : "");
    }).join("") : `<tr><td colspan="5" class="empty">${projects.length ? "No project matches." : "No projects yet. In the CAD, File ▾ → Revisions… makes one and saves its revisions."}</td></tr>`;
  }
  function revTable(p, revs) {
    if (!revs.length) return `<div class="empty">No revisions in this project.</div>`;
    return `<table><thead><tr><th>Rev</th><th class="wide-only"></th><th class="wide-only">When</th><th>Message</th><th class="wide-only">Changes</th><th class="num wide-only">Size</th><th></th></tr></thead><tbody>` + revs.map(r => `<tr data-n="${r.n}"${r.milestone ? ' class="ms"' : ""}>
      <td class="n">r${r.n}</td>
      <td class="pic wide-only">${r.thumb ? `<img loading="lazy" alt="r${r.n}" src="${esc(api.thumbUrl(p.id, r.n))}">` : ""}</td>
      <td class="t wide-only">${esc(when(r.time))}${r.parent ? `<div class="muted">from r${r.parent}</div>` : ""}</td>
      <td>${r.milestone ? `<span class="star">★ ${esc(r.milestone)}</span><br>` : ""}${esc(r.message) || '<span class="muted">–</span>'}</td><td class="sum wide-only">${esc(r.summary)}</td><td class="num wide-only">${size(r.size)}</td>
      <td class="act"><a class="btn" href="circuit_sandbox.html${R.hashOf(p.id, r.n)}" target="_blank" rel="noopener" title="Open this revision in the CAD">Open in CAD ↗</a> <button class="btn" data-act="download">.json</button> <button class="btn" data-act="message" title="Its message and milestone">Edit…</button> <button class="btn danger" data-act="del-rev">Delete</button></td></tr>`).join("") + `</tbody></table>`;
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
        ask({ title: "Rename the project", fields: [{ label: "Name", value: p.name }, { label: "Notes", value: p.notes, long: true }], ok: "Save" }).then(v => {
          if (v && v[0].trim()) act(() => api.updateProject(id, { name: v[0].trim(), notes: v[1] }));
        });
        break;
      case "del-project":
        ask({ title: `Delete ${p.name}?`, text: `All its ${p.count} revisions go with it. This cannot be undone: Download keeps a copy first.`, ok: "Delete the project", danger: true }).then(v => { if (v) act(() => api.deleteProject(id)); });
        break;
      case "message": {
        const r = open.get(id).find(x => x.n === n);
        ask({ title: `r${n} of ${p.name}`, fields: [{ label: "Message", value: r.message, long: true }, { label: "Milestone (empty: none)", value: r.milestone, list: ["Sent to fab", "Built", "Measured", "Released"], placeholder: "Sent to fab, Built…" }], ok: "Save" })
          .then(v => { if (v) act(() => api.updateRevision(id, n, { message: v[0], milestone: v[1] })); });
        break;
      }
      case "del-rev":
        ask({ title: `Delete r${n} of ${p.name}?`, text: "This cannot be undone. The other revisions keep their numbers.", ok: "Delete the revision", danger: true }).then(v => { if (v) act(() => api.deleteRevision(id, n)); });
        break;
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
  $("links").addEventListener("click", e => {
    const b = e.target.closest("[data-act=del-link]"); if (!b) return;
    const id = b.closest("tr").dataset.s;
    ask({ title: `Delete aerocat.tech/s/${id}?`, text: "Whoever has this link can no longer open the design.", ok: "Delete the link", danger: true }).then(v => { if (v) act(() => api.deleteShare(id)); });
  });
  $("links-more").addEventListener("click", () => { allLinks = true; showLinks(); });
  $("p-filter").addEventListener("input", showProjects);
  $("refresh").addEventListener("click", load);
  $("signin").addEventListener("click", async () => { say("Waiting for the login window…"); await api.signIn(); load(); });
  $("p-sort").addEventListener("change", showProjects);
  window.TubeProjects = { load, state: () => ({ projects, links, open }) };
  load();
})();
