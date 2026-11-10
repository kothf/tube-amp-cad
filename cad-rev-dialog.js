/* File ▾ → Revisions…: the design kept as numbered revisions of a project, either on aerocat.tech
   for the site's owner only (cad-revisions.js talks to the store, server/share/revisions.mjs keeps
   it) or in a folder on this computer that the user picks, a vault (cad-vault.js; "Kept in" at the
   top of the dialog chooses, and the choice is remembered).
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
    // the connections of a design (Compare goes by which pins share a net), the board window's
    // overlay, and what to redraw when the revision's label changes (title block, board texts)
    const DOPT = { netsOf: cad.netsOf };
    const sendBoardDiff = cad.boardDiff || (() => {}), relabel = cad.relabel || (() => {});
    const R = root.CadRevisions, site = R.client(location.origin), vault = root.CadVault ? root.CadVault.shared() : null;
    // where the revisions are kept: "site" (aerocat.tech) or "vault" (a folder on this computer)
    let store = R.storeName(location.origin), api = store === "vault" ? vault : site;
    const apiOf = st => (st === "vault" && vault ? vault : site);
    const $ = id => document.getElementById(id);
    const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
    const load = k => { try { return localStorage.getItem(k); } catch (e) { return null; } };
    const keep = (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch (e) { /* private window */ } };
    const designs = new Map();               // "<project>.<n>" → design, read once
    let projects = [], revs = [], pending = null, seq = 0, pick = null, starsOnly = false, nowHash = "";
    // the project last shown, kept for the site and for each vault
    const curKey = () => KEY + (store === "vault" ? ".vault" + (vault && vault.id() ? "." + vault.id() : "") : "");
    let cur = load(curKey()) || "";
    // the revision the sheet came from (opened or saved): { project, name, n, hash }
    // kept per tab (sessionStorage), so two tabs on two projects each keep theirs; a new tab starts
    // from the last one any tab had (the circuit it restores is that one too)
    const loadAt = () => { try { const v = sessionStorage.getItem(AT); if (v) return JSON.parse(v); } catch (e) { /* no session storage */ } try { return JSON.parse(load(AT)) || null; } catch (e) { return null; } };
    const keepAt = v => { keep(AT, v); try { if (v === null) sessionStorage.removeItem(AT); else sessionStorage.setItem(AT, v); } catch (e) { /* private window */ } };
    let at = loadAt();
    let diff = null;                         // Compare on the sheet: { project, n, name }
    const remember = id => { cur = id; keep(curKey(), id); };
    // the sheet's revision is one of the store now shown
    const atHere = () => !!at && (at.store || "site") === store && (store !== "vault" || !at.vault || at.vault === vault.id());
    function setStore(st) {
      st = st === "vault" && vault ? "vault" : "site";
      if (st === store) return;
      store = st; api = apiOf(st); R.setStore(st);
      cur = load(curKey()) || ""; projects = []; revs = []; pick = null; pair = null; seq++;
    }
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
    // the design as a revision keeps it: without the note of the revision it came from
    const sheet = () => { const d = JSON.parse(circuitJSON()); delete d.revLink; return d; };
    // the store's fingerprint of a design (server: SHA-256 of its JSON, base64url, 16 characters)
    async function hashOf(d) {
      if (!(root.crypto && crypto.subtle)) return "";
      const b = new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(d))));
      let s = ""; b.forEach(x => { s += String.fromCharCode(x); });
      return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "").slice(0, 16);
    }
    const dkey = (project, n, st) => (st || store) + ":" + project + "." + n;     // a project's id is its own in every store and vault
    async function design(project, n, st) {
      const k = dkey(project, n, st);
      if (!designs.has(k)) designs.set(k, await apiOf(st || store).revision(project, n));
      return designs.get(k);
    }
    function view(which) { ["off", "signin", "vault", "main"].forEach(w => { $("rev-" + w).hidden = w !== which; }); }
    // the folder is not ready (cad-vault.js NeedFolder): say why, with the button that mends it
    const VAULT_TEXT = {
      none: "A vault is a folder on this computer that keeps your projects and their revisions as plain files: a folder for each project, each revision a design that File ▾ → Open reads, with its pictures next to it. Choose a folder (an empty one, or a vault made before); the browser asks once for leave to change the files in it. Nothing is sent anywhere.",
      permission: "The browser wants your leave again to use the vault's folder (it asks after a restart). Press Allow, then answer its question.",
      gone: "The vault's folder cannot be found: it was moved, renamed, or is on a drive that is not connected. Connect the drive and open Revisions again, or choose the folder again.",
      unsupported: "This browser cannot open a folder on the computer, which a vault needs: Chrome and Edge can.",
      // Safari, Firefox: a folder can be read, not written
      reading: "This browser can read a vault's folder but cannot save into it. Choose the folder (a vault made in Chrome or Edge, or one project's folder) to list its revisions, open them and compare them; the browser asks for the folder again after the page is reloaded. Saving revisions into a folder needs Chrome or Edge.",
      readonly: "This browser can only read the vault's folder: saving into it needs Chrome or Edge.",
    };
    let readOnly = false;                    // the store shown cannot be written (a vault in Safari or Firefox)
    async function needFolder(why) {
      $("rev-modal").hidden = false; view("vault"); info(""); $("rev-who").textContent = "";
      const st = vault ? await vault.status() : { name: "" };
      if (why === "none" && vault && !vault.writes) why = "reading";
      $("rev-vault-text").textContent = VAULT_TEXT[why] || VAULT_TEXT.none;
      $("rev-vault-grant").hidden = why !== "permission";
      $("rev-vault-grant").textContent = `Allow ${st.name || "the folder"}`;
      $("rev-vault-pick").hidden = why === "unsupported";
      $("rev-vault-pick").textContent = why === "none" || why === "reading" ? "Choose folder…" : "Add another folder…";
      $("rev-vault-pick").classList.toggle("active", why !== "permission");
      await showStore();
    }
    // a failure: the login or the folder wants the user, or something to say
    function failed(err) {
      if (err && err.signin) { $("rev-modal").hidden = false; view("signin"); info(""); }
      else if (err && err.folder === "readonly") info(VAULT_TEXT.readonly, "warn");
      else if (err && err.folder) needFolder(err.folder);
      else info(err.message, "warn");
    }
    // "Kept in": aerocat.tech, every vault folder this browser remembers, and Add a folder…
    async function showStore() {
      const sel = $("rev-store"); if (!sel) return;
      const list = vault && vault.supported ? await vault.vaults() : [];
      sel.innerHTML = `<option value="site">aerocat.tech (the site's owner)</option>`
        + list.map(v => `<option value="vault:${esc(v.id)}">Folder: ${esc(v.name)}</option>`).join("")
        + (list.length ? `<option value="add">Add a folder…</option>` : `<option value="vault"${vault ? "" : " disabled"}>A folder on this computer (vault)…</option>`);
      const now = list.find(v => v.current);
      sel.value = store === "vault" ? (now ? "vault:" + now.id : "vault") : "site";
      $("rev-folder-forget").hidden = !(store === "vault" && now);
      $("rev-manager").title = store === "vault" ? "Every project and revision kept in the folder: rename, delete, restore, copy to and from aerocat.tech" : "Every project, revision and short link kept on the server, and the space they take";
    }
    // another vault of the list
    async function useVault(id) {
      if (vault.id() !== id) { await vault.select(id); projects = []; revs = []; pick = null; pair = null; seq++; }
    }
    const mb = n => n >= 1048576 ? (n / 1048576).toFixed(1) + " MB" : Math.max(1, Math.round(n / 1024)) + " kB";
    const projectName = id => (projects.find(p => p.id === (id || cur)) || {}).name || (atHere() && at.project === (id || cur) ? at.name : "the project");

    // ---- the toolbar's chip: which revision the sheet came from, • when changed since ----
    function chip() {
      const el = $("rev-at"); if (!el) return;
      el.hidden = !at;
      if (!at) { label(""); return; }
      const changed = nowHash && nowHash !== at.hash;
      label(`r${at.n}${changed ? "+" : ""}`);
      el.innerHTML = `r${at.n}${changed ? '<span class="dirty"> •</span>' : ""}`;
      el.title = `${at.name} · revision r${at.n}${at.store === "vault" ? " · kept in the folder vault" : ""}` + (changed ? " · the sheet has changed since: Ctrl+Alt+S saves the next revision" : " · the sheet is this revision") + " (click for the revisions)";
    }
    // the revision as the title block and board texts show it ("auto" in the frame's Rev. field,
    // ${REV} in a board text): r5, or r5+ once the sheet has changed since
    function label(t) {
      if ((root.CadRevLabel || "") === t) return;
      root.CadRevLabel = t; relabel();
    }
    function attach(project, name, n, hash) { at = Object.assign({ project, name, n, hash, store }, store === "vault" ? { vault: vault.id() } : {}); keepAt(JSON.stringify(at)); nowHash = hash; chip(); }
    // what a saved file keeps of it, so opening the file again knows its project and revision
    const link = () => (at ? Object.assign({ project: at.project, name: at.name, n: at.n, hash: at.hash }, at.store === "vault" ? { store: "vault", vault: at.vault } : {}) : null);
    function relink(l) {
      if (!l || !R.PID.test(String(l.project)) || !Number.isInteger(l.n) || typeof l.hash !== "string") return;
      at = { project: l.project, name: String(l.name || "the project").slice(0, 120), n: l.n, hash: l.hash, store: l.store === "vault" && vault ? "vault" : "site" };
      if (at.store === "vault" && typeof l.vault === "string") at.vault = l.vault.slice(0, 20);
      keepAt(JSON.stringify(at));
      setStore(at.store);
      // a file from another vault of this browser's list: that vault comes with it
      const there = at.vault && at.store === "vault" ? useVault(at.vault) : Promise.resolve();
      there.then(() => { cur = load(curKey()) || ""; if (atHere() && cur !== at.project) remember(at.project); }).catch(() => {});
      if (at.store !== "vault" && cur !== at.project) remember(at.project);
      hashOf(sheet()).then(h => { nowHash = h; chip(); }).catch(() => {});
    }
    function detach() { at = null; keepAt(null); closeDiff(); chip(); }
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
      if (want) { pending = want; setStore(want.vault ? "vault" : "site"); if (typeof want.vault === "string" && want.vault !== "1") await useVault(want.vault); }
      await showStore();
      if (!api.available) { $("rev-who").textContent = ""; if (store === "vault") needFolder("unsupported"); else view("off"); return; }
      info(store === "vault" ? "Reading the folder…" : "Asking aerocat.tech…");
      const my = store; readOnly = false;
      try {
        const me = await api.me();
        if (my !== store) return;
        const inProjects = `${mb(me.revisions.bytes)} in ${me.revisions.projects} project${me.revisions.projects === 1 ? "" : "s"}`;
        readOnly = !!me.readOnly;
        $("rev-who").textContent = me.vault ? `Folder ${me.folder} · ${inProjects}${readOnly ? " · read only" : ""}` : `${me.email} · ${inProjects}, ${mb(me.total.max - me.total.bytes)} free`;
        if (me.vault) cur = load(curKey()) || cur;      // the vault's id is known now: its own last project
        view("main"); info(""); await showStore();
        if (atHere() && !pending && at.project !== cur) remember(at.project);
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
      $("rev-export").disabled = !cur; $("rev-save").disabled = !cur || readOnly; $("rev-new").disabled = readOnly;
      $("rev-save").title = readOnly ? VAULT_TEXT.readonly : "Keep the design as it is now, board included, as the project's next revision (Ctrl+Alt+S)";
      showNew(!projects.length && !readOnly);
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
      if (!revs.some(r => r.n === pick)) pick = atHere() && at.project === cur && revs.some(r => r.n === at.n) ? at.n : revs.length ? revs[0].n : null;
      list(); preview();
      await showChanges(my);
    }
    function list() {
      const body = $("rev-list"), shown = revs.filter(r => !starsOnly || r.milestone);
      $("rev-stars").classList.toggle("active", starsOnly);
      $("rev-stars").textContent = `★ Milestones${revs.some(r => r.milestone) ? " (" + revs.filter(r => r.milestone).length + ")" : ""}`;
      if (!cur) { body.innerHTML = `<div class="rev-empty">${readOnly ? "No projects in this folder." : "Make a project, then Save revision keeps this design as its first revision."}</div>`; return; }
      if (!revs.length) { body.innerHTML = `<div class="rev-empty">No revisions yet: Save revision keeps this design as r1.</div>`; return; }
      if (!shown.length) { body.innerHTML = `<div class="rev-empty">No milestones yet: pick a revision and press ☆ Milestone.</div>`; return; }
      body.innerHTML = `<svg class="rev-tree" aria-hidden="true"></svg>` + shown.map(r => `<button class="rev-item${r.n === pick ? " on" : ""}${r.hash === nowHash ? " cur" : ""}" data-n="${r.n}" title="${esc(when(r.time))} · double-click opens it">
        <span class="rg"></span><span class="rn">r${r.n}</span>
        <span class="rt">${r.milestone ? `<span class="star">★ ${esc(r.milestone)}</span> ` : ""}${esc(r.message) || '<span class="muted">No message</span>'}<small>${esc(r.summary)}</small></span>
        <span class="ra">${esc(ago(r.time))}${r.hash === nowHash ? '<b title="The sheet is this revision">● sheet</b>' : ""}</span></button>`).join("");
      tree(body, shown);
    }
    // the history as a graph in the list's left edge: each revision joined to the one it was made
    // from (the one before it, or its "from rN"); a revision made from an older one branches off to
    // the right, so tries that went another way stand out
    function tree(body, shown) {
      const svg = body.querySelector(".rev-tree"); if (!svg) return;
      const rows = new Map([...body.querySelectorAll(".rev-item")].map(el => [+el.dataset.n, el]));
      const y = n => { const el = rows.get(n); return el ? el.offsetTop + el.offsetHeight / 2 : null; };
      const h = body.scrollHeight;
      svg.setAttribute("height", h); svg.style.height = h + "px";
      const X0 = 9, X1 = 19, lines = [], dots = [];
      const older = shown.slice().sort((a, b) => a.n - b.n);
      older.forEach((r, i) => {
        const base = r.parent && rows.has(r.parent) ? r.parent : i > 0 ? older[i - 1].n : null;
        const y1 = y(r.n);
        if (base !== null) {
          const y0 = y(base);
          if (r.parent && rows.has(r.parent) && (i === 0 || older[i - 1].n !== r.parent)) {
            // a branch: out of the older revision to the right, up, and in to this one
            lines.push(`<path class="br" d="M${X0} ${y0} C${X1} ${y0} ${X1} ${y0 - 8} ${X1} ${y0 - 14} L${X1} ${y1 + 14} C${X1} ${y1 + 8} ${X1} ${y1} ${X0} ${y1}"/>`);
          } else lines.push(`<path d="M${X0} ${y0} L${X0} ${y1}"/>`);
        }
        dots.push(`<circle cx="${X0}" cy="${y1}" r="${r.milestone ? 4.5 : 3.5}" class="${r.milestone ? "ms" : ""}${r.hash === nowHash ? " now" : ""}${r.parent ? " from" : ""}"><title>r${r.n}${r.parent ? " · made from r" + r.parent : ""}</title></circle>`);
      });
      svg.innerHTML = lines.join("") + dots.join("");
    }
    // the revision picked: its picture and what it holds, with its buttons
    let picKind = "sheet", pair = null, pairSeq = 0;     // the preview's picture (sheet | board); Compare with: the other revision's number
    const pics = r => [r.thumb ? ["sheet", "Sheet", api.thumbUrl(cur, r.n)] : null, r.bthumb ? ["board", "Board", api.bthumbUrl(cur, r.n)] : null].filter(Boolean);
    function picture(r, small) {
      const list = pics(r); if (!list.length) return `<div class="rev-pic${small ? " small" : ""}"><span>No picture${r.n && !r.thumb ? " (saved before 3.144.0)" : ""}</span></div>`;
      const p = list.find(x => x[0] === picKind) || list[0];
      return `<div class="rev-pic${small ? " small" : ""}"><img alt="r${r.n}, ${p[1].toLowerCase()}" src="${esc(p[2])}"></div>`;
    }
    // the revision picked: its picture and what it holds, with its buttons; or, with Compare with…,
    // what changed between it and another one
    function preview() {
      const r = revs.find(x => x.n === pick), el = $("rev-preview");
      if (!r) { el.innerHTML = `<div class="rev-empty">${cur ? "Pick a revision to see it here." : ""}</div>`; return; }
      if (pair !== null && pair !== r.n && revs.some(x => x.n === pair)) { comparePair(r, revs.find(x => x.n === pair)); return; }
      pair = null;
      const tabs = pics(r).length > 1 ? `<div class="rev-tabs">${pics(r).map(([k, t]) => `<button class="btn toggle${k === (pics(r).find(x => x[0] === picKind) || pics(r)[0])[0] ? " active" : ""}" data-pic="${k}">${t}</button>`).join("")}</div>` : "";
      const others = revs.filter(x => x.n !== r.n);
      el.innerHTML = `${tabs}${picture(r)}
        <div class="rev-meta"><b>r${r.n}</b>${r.milestone ? ` <span class="star">★ ${esc(r.milestone)}</span>` : ""} · ${esc(when(r.time))}${r.parent ? ` · from r${r.parent}` : ""}</div>
        <div class="rev-msg">${esc(r.message) || '<span class="muted">No message</span>'}</div>
        ${r.summary ? `<div class="rev-sum">${esc(r.summary)}</div>` : ""}
        ${r.files ? `<div class="rev-files"><span class="muted">Release package:</span> ${r.files.map(f => `<a href="${esc(api.fileUrl(cur, r.n, f.name))}" download="${esc(f.name)}" title="${Math.max(1, Math.round(f.size / 1024))} kB">${esc(f.name)}</a>`).join(" · ")}</div>` : ""}
        ${perf(r)}
        <div class="rev-btns">
          <button class="btn active" data-act="open" title="Put this revision on the sheet (the next Save revision is made from it)">Open</button>
          <button class="btn" data-act="compare" title="Mark on the sheet what changed since this revision, and step through the changes">Compare on the sheet</button>
          ${others.length ? `<select id="rev-pair" aria-label="Compare with another revision" title="What changed between this revision and another one, without opening either (Shift+click in the list does it too)"><option value="">Compare with…</option>${others.map(x => `<option value="${x.n}">r${x.n}${x.milestone ? " ★ " + esc(x.milestone) : ""}${x.message ? " · " + esc(x.message.slice(0, 40)) : ""}</option>`).join("")}</select>` : ""}
          <button class="btn" data-act="star" title="A milestone stands out in the list and can be shown alone">${r.milestone ? "★ Milestone…" : "☆ Milestone…"}</button>
          ${r !== revs[0] ? `<button class="btn" data-act="restore" title="Save this revision again as the newest one (r${revs[0].n + 1}, from r${r.n}), without touching the sheet; nothing is lost">Restore as r${revs[0].n + 1}</button>` : ""}
        </div>`;
    }
    // Performance: what the simulation gave when the revision was saved, against the revision before
    // it that has results, and how one reading went over the whole history
    let perfKey = null;
    const fmtV = v => { const a = Math.abs(v); return a >= 100 ? v.toFixed(0) : a >= 10 ? v.toFixed(1) : a >= 1 ? v.toFixed(2) : a >= 0.01 ? v.toFixed(3) : v.toPrecision(2); };
    function perfRows(m, o) {
      return Object.keys(m).map(k => {
        const v = m[k], w = o && o[k];
        const d = Number.isFinite(w) && w !== v ? v - w : null, pct = d !== null && w ? 100 * d / Math.abs(w) : null;
        return `<tr data-k="${esc(k)}"${k === perfKey ? ' class="on"' : ""}><td>${esc(k)}</td><td class="v">${fmtV(v)}</td><td class="d ${d === null ? "" : d > 0 ? "up" : "down"}">${d === null ? "" : (d > 0 ? "+" : "−") + fmtV(Math.abs(d)) + (pct !== null && Math.abs(pct) >= 0.1 ? ` (${pct > 0 ? "+" : "−"}${Math.abs(pct).toFixed(Math.abs(pct) < 10 ? 1 : 0)} %)` : "")}</td></tr>`;
      }).join("");
    }
    function perf(r) {
      if (!r.metrics) return revs.some(x => x.metrics) ? `<div class="rev-perf muted">No simulation results kept with r${r.n} (it was not simulated as saved).</div>` : "";
      const older = revs.filter(x => x.n < r.n && x.metrics)[0];
      if (!perfKey || !(perfKey in r.metrics)) perfKey = Object.keys(r.metrics)[0];
      return `<details class="rev-perf" open><summary>Performance${older ? ` <span class="muted">vs r${older.n}</span>` : ""}</summary>
        ${trend(perfKey)}<table>${perfRows(r.metrics, older && older.metrics)}</table></details>`;
    }
    // one reading over every revision that has it, oldest left (click a row for another reading)
    function trend(k) {
      const pts = revs.filter(x => x.metrics && Number.isFinite(x.metrics[k])).slice().reverse();
      if (pts.length < 2) return "";
      const W = 340, H = 64, P = 6, vs = pts.map(x => x.metrics[k]), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || Math.abs(hi) || 1;
      const X = i => P + i * (W - 2 * P) / (pts.length - 1), Y = v => H - P - (v - lo) / span * (H - 2 * P - 10);
      return `<svg class="rev-trend" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(k)} over the revisions">
        <text x="${P}" y="10">${esc(k)}: ${fmtV(lo)} … ${fmtV(hi)}</text>
        <polyline points="${pts.map((x, i) => X(i) + "," + Y(x.metrics[k])).join(" ")}"/>
        ${pts.map((x, i) => `<circle cx="${X(i)}" cy="${Y(x.metrics[k])}" r="${x.n === pick ? 3.6 : 2.4}" class="${x.n === pick ? "on" : ""}${x.milestone ? " ms" : ""}"><title>r${x.n}: ${fmtV(x.metrics[k])}</title></circle>`).join("")}</svg>`;
    }
    // two revisions side by side: their pictures, and every change from the older to the newer
    async function comparePair(r, o) {
      const el = $("rev-preview"), A = o.n < r.n ? o : r, B = o.n < r.n ? r : o, my = ++pairSeq;
      const row = (k, cls, items) => (items.length ? `<div class="rev-ch"><span class="k ${cls}">${k}</span> ${items.join(", ")}</div>` : "");
      el.innerHTML = `<div class="rev-pair-head"><b>r${A.n}</b> → <b>r${B.n}</b><span class="sp"></span><button class="btn" data-act="pair-off" title="Back to r${r.n} alone">✕</button></div>
        <div class="rev-two">${picture(A, true)}${picture(B, true)}</div>
        <div class="rev-sum" id="rev-pair-list">Comparing…</div>
        <div class="rev-btns"><button class="btn active" data-act="pair-open" data-a="${A.n}" data-b="${B.n}" title="Put r${B.n} on the sheet and mark on it what changed since r${A.n}">Open r${B.n}, mark changes since r${A.n}</button></div>`;
      try {
        const [da, db] = await Promise.all([design(cur, A.n), design(cur, B.n)]);
        if (my !== pairSeq) return;
        const d = R.diff(da, db, DOPT), parts = d.changed.filter(c => !c.frame);
        const out = d.none ? "No changes: the two are the same design." : [
          row("added", "added", d.added.map(esc)), row("removed", "removed", d.removed.map(esc)),
          parts.map(c => `<div class="rev-ch"><span class="k ${c.rewired ? "rewired" : "changed"}">${c.rewired ? "rewired" : "changed"}</span> <b>${esc(c.part)}</b> ${c.what.map(esc).join("; ")}</div>`).join(""),
          d.changed.some(c => c.frame) ? row("title", "changed", ["title block"]) : "",
          row("moved", "moved", d.moved.map(esc)),
          d.wires.redrawn ? row("wires", "moved", ["redrawn, same connections"]) : d.wires.added || d.wires.removed ? row("wires", "changed", [`+${d.wires.added} −${d.wires.removed}`]) : "",
          d.boardDiff ? row("board", "board", [esc(d.boardDiff.text)]) : "", d.tubes ? row("tubes", "changed", ["imported tubes changed"]) : "",
        ].join("");
        const perfA = A.metrics, perfB = B.metrics;
        $("rev-pair-list").innerHTML = out + (perfA && perfB ? `<div class="rev-ch"><span class="k board">results</span></div><table class="rev-perf-t">${perfRows(perfB, perfA)}</table>` : "");
      } catch (err) { if (my === pairSeq) $("rev-pair-list").textContent = err.message; }
    }
    // Open the newer one, then Compare on the sheet against the older one
    async function openPair(a, b) {
      pair = null;
      await openRev(cur, b);
      if (atHere() && at.n === b && at.project === cur) await compare(a);
    }
    // what Save revision would keep: the changes since the revision the sheet came from (else the latest)
    async function showChanges(my) {
      const el = $("rev-changes");
      if (!revs.length) { el.textContent = "The first revision of this project."; return; }
      const base = baseRev();
      try {
        const d = R.diff(await design(cur, base.n), sheet(), DOPT);
        if (my !== seq) return;
        el.textContent = d.none ? `The sheet is the same as r${base.n}: nothing new to save.` : `Changes since r${base.n}: ${d.text}`;
      } catch (err) { el.textContent = ""; }
    }
    // the revision the next one is made from: the one the sheet came from, if it is in this project
    const baseRev = () => (atHere() && at.project === cur && revs.find(r => r.n === at.n)) || revs[0];
    async function save() {
      if (!cur) return;
      const btn = $("rev-save"); btn.disabled = true;
      try {
        const d = sheet(), base = baseRev(), latest = revs[0];
        const summary = base ? (base !== latest ? `from r${base.n}: ` : "") + R.diff(await design(cur, base.n), d, DOPT).text : "first revision";
        // the pictures show the title block as the new revision will have it
        const was = root.CadRevLabel; label(`r${(latest ? latest.n : 0) + 1}`);
        const thumb = thumbnail ? thumbnail() : undefined; label(was || "");
        const metrics = cad.perfMetrics ? cad.perfMetrics() : null;
        const r = await api.saveRevision(cur, { message: $("rev-message").value.trim(), summary, parent: base && base !== latest ? base.n : undefined, thumb, bthumb: R.boardPicture(d.board) || undefined, metrics: metrics || undefined, design: d });
        if (r.same) info(`The sheet is the same as r${r.n}: nothing new saved.`);
        else { designs.set(dkey(cur, r.n), d); $("rev-message").value = ""; info(`Saved r${r.n} of ${projectName()}.`, "ok"); setStatus("ok", `Saved revision r${r.n} of ${projectName()}`); }
        attach(cur, projectName(), r.n, r.hash);
        pick = r.n;
        await loadProjects();
      } catch (err) { failed(err); } finally { btn.disabled = !cur || readOnly; }
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
      const old = await design(diff.project, diff.n, diff.store), d = R.diff(old, sheet(), DOPT);
      sendBoardDiff(d.boardDiff, `r${diff.n}`);
      const prev = S().revDiff, idx = prev && !jump ? Math.min(prev.idx, Math.max(0, d.marks.length - 1)) : 0;
      showDiff(Object.assign(d, { idx }));
      bar(d);
      if (jump && d.marks.length) focusDiff(0);
    }
    const S = () => (root.TubeCAD && root.TubeCAD.state) || {};
    async function compare(n) {
      diff = { project: cur, n, name: projectName(), store };
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
      diff = null; showDiff(null); sendBoardDiff(null);
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
        <button class="btn active" data-act="star-ok">Save</button>${r.milestone ? '<button class="btn" data-act="star-off">Take off</button>' : ""}<button class="btn" data-act="star-cancel">Cancel</button>
        ${cad.releasePackage ? `<label class="rev-pkg" title="${r.hash === nowHash ? "Made from the sheet, which is this revision" : `The package is made from the sheet: Open r${r.n} first`}"><input type="checkbox" id="rev-star-pkg"${r.hash === nowHash ? (r.files ? "" : " checked") : " disabled"}> Keep the release package with it: Gerbers, BOM, schematic PDF${r.hash === nowHash ? "" : ` (Open r${r.n} first)`}</label>` : ""}`;
      const inp = $("rev-star-name"); inp.focus(); inp.select();
      inp.addEventListener("keydown", e => { if (e.key === "Enter") setStar(n, inp.value); if (e.key === "Escape") { e.stopPropagation(); preview(); } });
    }
    async function setStar(n, name) {
      const pkg = $("rev-star-pkg") && $("rev-star-pkg").checked && String(name || "").trim();
      try {
        await api.updateRevision(cur, n, { milestone: String(name || "").trim() });
        // the release package: made from the sheet (which is this revision), kept with it on the server
        if (pkg) {
          info("Making the release package…");
          const files = cad.releasePackage();
          for (const f of files) { info(`Keeping ${f.name}…`); await api.addFile(cur, n, f); }
          info(`Kept with r${n}: ${files.map(f => f.name).join(", ")}.`, "ok");
        }
        await loadRevs();
      } catch (err) { failed(err); }
    }
    // Restore as new: the old revision becomes the newest one again (its own picture, "from rN"),
    // the ones after it stay in the history; the sheet is left as it is
    async function restore(n) {
      const r = revs.find(x => x.n === n), latest = revs[0]; if (!r || !latest) return;
      info(`Restoring r${n}…`);
      try {
        const d = await design(cur, n), now = await design(cur, latest.n);
        let thumb;
        if (r.thumb) thumb = await fetch(api.thumbUrl(cur, n), { credentials: "same-origin" }).then(x => (x.ok ? x.blob() : null)).then(b => b && new Promise(res => { const f = new FileReader(); f.onload = () => res(f.result); f.readAsDataURL(b); })).catch(() => undefined);
        const msg = $("rev-message").value.trim();
        const saved = await api.saveRevision(cur, { message: msg || `Restored r${n}${r.message ? ": " + r.message : ""}`, summary: `restored r${n}: ` + R.diff(now, d, DOPT).text, parent: n, thumb: thumb || undefined, bthumb: R.boardPicture(d.board) || undefined, metrics: r.metrics, design: d, force: true });
        designs.set(dkey(cur, saved.n), d); $("rev-message").value = "";
        pick = saved.n;
        info(`r${n} is the newest revision again, as r${saved.n}. The sheet is unchanged: Open puts it there.`, "ok");
        await loadProjects();
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
    async function download() {
      if (!cur) return;
      const a = document.createElement("a");
      if (api.exportUrl) { a.href = api.exportUrl(cur); a.download = ""; }
      else {
        // the vault: the file is put together here
        try { info("Putting the file together…"); a.href = URL.createObjectURL(new Blob([JSON.stringify(await api.exportBundle(cur))], { type: "application/json" })); info(""); } catch (err) { failed(err); return; }
        a.download = `${projectName().replace(/[^\w.-]+/g, "_").slice(0, 60) || cur}-revisions.json`;
        setTimeout(() => URL.revokeObjectURL(a.href), 60000);
      }
      document.body.appendChild(a); a.click(); a.remove();
    }
    // the folder for the vault (the browser's own dialog), then what it holds
    async function pickFolder() {
      try {
        const name = await vault.choose();
        if (name) { setStore("vault"); projects = []; revs = []; pick = null; pair = null; seq++; cur = load(curKey()) || ""; setStatus("ok", `Revisions are kept in the folder ${name}`); }
        await open();
      } catch (err) {
        // the browser wants a click of a button for its folder dialog: the vault's page has one
        if (err && (err.name === "SecurityError" || err.name === "NotAllowedError")) { setStore("vault"); needFolder("none"); } else failed(err);
      }
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
      setStore(want.vault ? "vault" : "site");
      if (!api.available) { setStatus("error", store === "vault" ? "The revision is kept in a folder on this computer, which this browser cannot open: use Chrome or Edge" : "Revisions are kept on aerocat.tech: open the link there"); return true; }
      (async () => {
        try {
          if (typeof want.vault === "string" && want.vault !== "1" && !(await vault.select(want.vault))) { setStatus("error", "The revision is in a vault folder this browser does not know: add the folder in File ▾ → Revisions… → Kept in"); return; }
          projects = await api.projects(); await openRev(want.project, want.n, true);
        }
        catch (err) { if (err.signin || err.folder) open(want); else setStatus("error", "Could not open the revision: " + err.message); }
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
      $("rev-store").addEventListener("change", async e => {
        const v = e.target.value;
        if (v === "add") { await pickFolder(); return; }
        setStore(v === "site" ? "site" : "vault");
        if (v.startsWith("vault:")) await useVault(v.slice(6));
        cur = load(curKey()) || "";
        open();
      });
      $("rev-folder-forget").addEventListener("click", async () => {
        const st = await vault.status();
        if (!confirm(`Take the folder ${st.name} off this list?\n\nIts files stay where they are; Add a folder… brings it back.`)) return;
        await vault.disconnect(); projects = []; revs = []; pick = null; seq++; cur = load(curKey()) || "";
        open();
      });
      $("rev-vault-pick").addEventListener("click", pickFolder);
      $("rev-vault-grant").addEventListener("click", async () => { if (await vault.grant()) open(); else info("The browser did not give leave to use the folder.", "warn"); });
      $("rev-project").addEventListener("change", e => { remember(e.target.value); pick = null; loadRevs().catch(failed); });
      $("rev-new").addEventListener("click", () => showNew($("rev-new-row").hidden));
      $("rev-new-ok").addEventListener("click", create);
      $("rev-new-cancel").addEventListener("click", () => showNew(false));
      $("rev-save").addEventListener("click", save);
      $("rev-export").addEventListener("click", download);
      $("rev-stars").addEventListener("click", () => { starsOnly = !starsOnly; list(); });
      $("rev-list").addEventListener("click", e => {
        const b = e.target.closest("[data-n]"); if (!b) return;
        // Shift+click: compare the one picked with this one
        if (e.shiftKey && pick !== null && +b.dataset.n !== pick) { pair = +b.dataset.n; preview(); return; }
        pick = +b.dataset.n; pair = null; list(); preview();
      });
      $("rev-preview").addEventListener("change", e => { if (e.target.id === "rev-pair" && e.target.value) { pair = +e.target.value; preview(); } });
      $("rev-list").addEventListener("dblclick", e => { const b = e.target.closest("[data-n]"); if (b) openRev(cur, +b.dataset.n); });
      $("rev-preview").addEventListener("click", e => {
        const row = e.target.closest(".rev-perf tr[data-k]");
        if (row) { perfKey = row.dataset.k; preview(); return; }
        const t = e.target.closest("button[data-pic]");
        if (t) { picKind = t.dataset.pic; preview(); return; }
        const b = e.target.closest("button[data-act]"); if (!b || pick === null) return;
        const act = b.dataset.act;
        if (act === "open") openRev(cur, pick);
        else if (act === "compare") compare(pick);
        else if (act === "star") star(pick);
        else if (act === "star-ok") setStar(pick, $("rev-star-name").value);
        else if (act === "star-off") setStar(pick, "");
        else if (act === "restore") restore(pick);
        else if (act === "pair-off") { pair = null; preview(); }
        else if (act === "pair-open") openPair(+b.dataset.a, +b.dataset.b);
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
    return { open, openFromLink, wire, quickSave, changed, detach, closeDiff, link, relink, state: () => ({ cur, projects, revs, at, pick, pair, store }), api: () => api, setStore };
  }
  root.CadRevDialog = CadRevDialog;
})(typeof window !== "undefined" ? window : globalThis);
