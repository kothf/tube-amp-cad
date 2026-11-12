/* Projects and revisions, kept on aerocat.tech for the site's owner only (server/share/revisions.mjs,
   behind a Cloudflare Access login): the client for that store, what changed between two designs,
   and the "#rev=<project>.<n>" address that opens a revision in the CAD. Used by the CAD's
   File › Revisions… dialog and by the project manager page (projects.html). */
(function (root) {
  "use strict";
  const SITE = "https://aerocat.tech", API = "/api/rev";
  const PID = /^[A-Za-z0-9_-]{10}$/;
  const local = origin => /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
  // the store's address from a page at `origin`, or null where there is none (another copy of the app)
  const base = origin => (origin === SITE || local(origin) ? origin + API : null);

  // a refusal of the login in front of the store: sign in first
  class SignIn extends Error { constructor() { super("sign in first"); this.signin = true; } }

  function client(origin) {
    const b = base(origin);
    async function call(path, { method = "GET", body } = {}) {
      if (!b) throw new Error("revisions are kept on aerocat.tech");
      let r;
      try {
        // the login answers with a redirect to its own page, which a fetch must not follow
        r = await fetch(b + path, { method, redirect: "manual", credentials: "same-origin", cache: "no-store", headers: body === undefined ? {} : { "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body) });
      } catch (e) { throw new Error("the store on aerocat.tech cannot be reached"); }
      if (r.type === "opaqueredirect" || r.status === 0) throw new SignIn();
      let j = null;
      try { j = await r.json(); } catch (e) { /* the login's page, not ours */ }
      if (r.status === 401 || (r.status === 403 && !j)) throw new SignIn();
      if (!j) throw new Error(`the store answered ${r.status}`);
      if (!r.ok) throw new Error(j.error || `the store answered ${r.status}`);
      return j;
    }
    const P = id => "/projects/" + encodeURIComponent(id);
    return {
      kind: "site", available: !!b,
      me: () => call("/me"),
      projects: () => call("/projects"),
      createProject: (name, notes) => call("/projects", { method: "POST", body: { name, notes } }),
      project: id => call(P(id)),
      updateProject: (id, fields) => call(P(id), { method: "PATCH", body: fields }),
      deleteProject: id => call(P(id), { method: "DELETE" }),
      saveRevision: (id, rev) => call(P(id) + "/revs", { method: "POST", body: rev }),
      revision: (id, n) => call(P(id) + "/revs/" + n),
      thumbUrl: (id, n) => b + P(id) + "/revs/" + n + "/thumb",
      bthumbUrl: (id, n) => b + P(id) + "/revs/" + n + "/bthumb",
      updateRevision: (id, n, fields) => call(P(id) + "/revs/" + n, { method: "PATCH", body: fields }),
      // deleting puts it in the trash; purge: out of the trash, for good
      deleteRevision: (id, n, purge) => call(P(id) + "/revs/" + n + (purge ? "?purge=1" : ""), { method: "DELETE" }),
      restoreRevision: (id, n) => call(P(id) + "/revs/" + n + "/restore", { method: "POST" }),
      purgeProject: id => call(P(id) + "?purge=1", { method: "DELETE" }),
      restoreProject: id => call(P(id) + "/restore", { method: "POST" }),
      trash: () => call("/trash"),
      search: q => call("/search?q=" + encodeURIComponent(q)),
      importProject: bundle => call("/import", { method: "POST", body: bundle }),
      // the release package kept with a revision: { name, type, data (base64) }
      addFile: (id, n, file) => call(P(id) + "/revs/" + n + "/files", { method: "POST", body: file }),
      deleteFile: (id, n, name) => call(P(id) + "/revs/" + n + "/files/" + encodeURIComponent(name), { method: "DELETE" }),
      fileUrl: (id, n, name) => b + P(id) + "/revs/" + n + "/files/" + encodeURIComponent(name),
      exportUrl: id => b + P(id) + "/export",
      exportBundle: id => call(P(id) + "/export"),
      shares: () => call("/shares"),
      deleteShare: id => call("/shares/" + encodeURIComponent(id), { method: "DELETE" }),
      // the login in a window of its own; resolves when it says it is done or is closed
      signIn() {
        const w = window.open(b + "/login", "tubecad-rev-login", "width=520,height=680");
        return new Promise(resolve => {
          const done = () => { window.removeEventListener("message", onMsg); clearInterval(t); resolve(); };
          const onMsg = e => { if (e.origin === origin && e.data && e.data.tubecadRev === "signed-in") done(); };
          window.addEventListener("message", onMsg);
          const t = setInterval(() => { if (!w || w.closed) done(); }, 700);
        });
      },
    };
  }

  // What changed from design a to design b (both as File › Save writes them): parts by their id
  // (added, removed, values or label changed, moved), wires, the board, imported tubes.
  const SKIP = new Set(["x", "y", "rot", "mirror"]);
  // numbers the way the sheet writes them: 4.7e-7 → 470n, 2200 → 2.2k, 0.5 → 0.5
  const SI = [[1e9, "G"], [1e6, "M"], [1e3, "k"], [1, ""], [1e-3, "m"], [1e-6, "µ"], [1e-9, "n"], [1e-12, "p"]];
  function num(v) {
    const a = Math.abs(v);
    if (!a || !isFinite(a)) return String(v);
    if (a >= 1e-3 && a < 1e3) return String(+v.toPrecision(4));
    const [m, u] = SI.find(([m]) => a >= m * 0.9995) || SI[SI.length - 1];
    return +(v / m).toPrecision(4) + u;
  }
  const show = v => (v === undefined || v === null || v === "" ? "–" : typeof v === "number" ? num(v) : typeof v === "object" ? JSON.stringify(v) : String(v));
  const name = c => c.label || c.type;
  const NOPIN = new Set(["frame", "note"]);
  // which pins share a net, part by part: opts.netsOf(design) → { net: Map("part:pin" → net), pins: Map("part:pin" → pin name) }
  // (cad-app.js computes it). A pin "rewired" is one whose net holds other pins than before, among
  // the parts in both designs; redrawing a wire without changing what it joins is no change.
  function rewired(a, b, A, B, netsOf) {
    let na, nb;
    try { na = netsOf(a); nb = netsOf(b); } catch (e) { return null; }
    if (!na || !nb) return null;
    const both = new Set([...A.keys()].filter(id => B.has(id) && !NOPIN.has(A.get(id).type)));
    const groups = n => { const g = new Map(); n.net.forEach((net, k) => { if (!both.has(k.slice(0, k.lastIndexOf(":")))) return; if (!g.has(net)) g.set(net, []); g.get(net).push(k); }); return g; };
    const ga = groups(na), gb = groups(nb);
    const label = (k, D) => { const i = k.lastIndexOf(":"), c = D.get(k.slice(0, i)); return name(c) + "." + ((nb.pins.get(k) || na.pins.get(k)) || k.slice(i + 1)); };
    const mates = (n, g, k) => { const net = n.net.get(k); return net === undefined ? [] : (g.get(net) || []).filter(x => x !== k).sort(); };
    const out = new Map();     // part id → [{ pin, now, was }]
    nb.net.forEach((net, k) => {
      const id = k.slice(0, k.lastIndexOf(":")); if (!both.has(id) || !na.net.has(k)) return;
      const now = mates(nb, gb, k), was = mates(na, ga, k);
      const gnd = (net === 0) !== (na.net.get(k) === 0);
      if (!gnd && now.join() === was.join()) return;
      const wasSet = new Set(was), nowSet = new Set(now);
      if (!out.has(id)) out.set(id, []);
      out.get(id).push({ pin: label(k, B), joins: now.filter(x => !wasSet.has(x)).map(x => label(x, B)), left: was.filter(x => !nowSet.has(x)).map(x => label(x, A)), ground: gnd ? (net === 0 ? "now on ground" : "off ground") : "" });
    });
    return out;
  }
  // what changed on the board (both as File › Save keeps them): parts placed, moved, turned or
  // flipped; tracks, vias, holes, texts, pours; the outline and the rules. Parts by their part id.
  const len = t => (t.pts || []).reduce((s, p, i, a) => (i ? s + Math.hypot(p[0] - a[i - 1][0], p[1] - a[i - 1][1]) : 0), 0);
  function boardDiff(a, b) {
    if (JSON.stringify(a || null) === JSON.stringify(b || null)) return null;
    if (!a || !b) return { whole: a ? "removed" : "added", parts: [], text: a ? "board removed" : "board added", tracksAdded: [], tracksRemoved: [], viasAdded: [], viasRemoved: [] };
    const pa = a.parts || {}, pb = b.parts || {}, parts = [];
    for (const id of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
      const o = pa[id], c = pb[id];
      if (!o || !c) { parts.push({ id, ref: (c || o).ref, kind: c ? "placed" : "taken off", x: (c || o).x, y: (c || o).y }); continue; }
      const what = [];
      if ((o.fp || "") !== (c.fp || "")) what.push(`footprint ${o.fp || "–"} → ${c.fp || "–"}`);
      if ((o.side || "F") !== (c.side || "F")) what.push(`to the ${c.side === "B" ? "bottom" : "top"}`);
      if ((o.rot || 0) !== (c.rot || 0)) what.push(`turned ${o.rot || 0}° → ${c.rot || 0}°`);
      if (o.x !== c.x || o.y !== c.y) what.push(`moved ${+Math.hypot(c.x - o.x, c.y - o.y).toFixed(1)} mm`);
      if (what.length) parts.push({ id, ref: c.ref || o.ref, kind: what.some(w => /^footprint/.test(w)) ? "changed" : "moved", what, x: c.x, y: c.y, from: { x: o.x, y: o.y } });
    }
    const set = (list, k) => new Set((list || []).map(k));
    const tk = t => t.layer + "|" + t.w + "|" + JSON.stringify(t.pts), vk = v => [v.x, v.y, v.drill, v.pad].join(",");
    const ta = set(a.tracks, tk), tb = set(b.tracks, tk), va = set(a.vias, vk), vb = set(b.vias, vk);
    const tracksAdded = (b.tracks || []).filter(t => !ta.has(tk(t))), tracksRemoved = (a.tracks || []).filter(t => !tb.has(tk(t)));
    const viasAdded = (b.vias || []).filter(v => !va.has(vk(v))), viasRemoved = (a.vias || []).filter(v => !vb.has(vk(v)));
    const same = k => JSON.stringify(a[k] || null) === JSON.stringify(b[k] || null);
    const out = [];
    const placed = parts.filter(p => p.kind === "placed"), off = parts.filter(p => p.kind === "taken off"), moved = parts.filter(p => p.kind === "moved" || p.kind === "changed");
    if (placed.length) out.push(`placed ${few(placed.map(p => p.ref))}`);
    if (off.length) out.push(`taken off ${few(off.map(p => p.ref))}`);
    if (moved.length) out.push(moved.length <= 3 ? moved.map(p => `${p.ref} ${p.what.join(", ")}`).join("; ") : `${moved.length} parts moved or turned`);
    if (tracksAdded.length || tracksRemoved.length) {
      const d = tracksAdded.reduce((s, t) => s + len(t), 0) - tracksRemoved.reduce((s, t) => s + len(t), 0);
      out.push(`tracks +${tracksAdded.length} −${tracksRemoved.length} (${d >= 0 ? "+" : "−"}${Math.abs(d).toFixed(0)} mm)`);
    }
    if (viasAdded.length || viasRemoved.length) out.push(`vias +${viasAdded.length} −${viasRemoved.length}`);
    if (!same("outline")) out.push(a.outline && b.outline && (a.outline.w !== b.outline.w || a.outline.h !== b.outline.h) ? `outline ${a.outline.w}×${a.outline.h} → ${b.outline.w}×${b.outline.h} mm` : "outline");
    const ch = [["holes", "holes"], ["texts", "texts"], ["zones", "pours"], ["keepouts", "keep-outs"], ["rules", "rules"], ["stackup", "stack-up"], ["dims", "dimensions"], ["cons", "construction"]].filter(([k]) => !same(k)).map(([, w]) => w);
    if (ch.length) out.push(ch.join(", ") + " changed");
    return { parts, tracksAdded, tracksRemoved, viasAdded, viasRemoved, text: out.join(" · ") || "board changed" };
  }
  // opts.netsOf: the connections of a design (cad-app.js); without it wires are compared as drawn
  function diff(a, b, opts) {
    const A = new Map((a && a.comps || []).map(c => [c.id, c])), B = new Map((b && b.comps || []).map(c => [c.id, c]));
    const added = [], removed = [], changed = [], moved = [];
    // for drawing on the sheet (b's parts, and a's for those taken out): { kind, comp, what? }
    const marks = [];
    B.forEach((c, id) => { if (!A.has(id) && c.type !== "frame") { added.push(name(c)); marks.push({ kind: "added", comp: c }); } });
    A.forEach((c, id) => { if (!B.has(id) && c.type !== "frame") { removed.push(name(c)); marks.push({ kind: "removed", comp: c }); } });
    const rw = opts && opts.netsOf ? rewired(a, b, A, B, opts.netsOf) : null;
    B.forEach((c, id) => {
      const o = A.get(id); if (!o) return;
      const what = [];
      if ((o.label || "") !== (c.label || "")) what.push(`label ${show(o.label)} → ${show(c.label)}`);
      if (o.type !== c.type) what.push(`type ${o.type} → ${c.type}`);
      const p = o.params || {}, q = c.params || {};
      // a field missing on one side and empty on the other (a newer app filling in its defaults) is no change
      new Set([...Object.keys(p), ...Object.keys(q)]).forEach(k => { if (show(p[k]) !== show(q[k]) || (typeof p[k] === "object" && JSON.stringify(p[k]) !== JSON.stringify(q[k]))) what.push(`${k} ${show(p[k])} → ${show(q[k])}`); });
      const pins = rw && rw.get(id) || [];
      pins.forEach(x => what.push(`pin ${x.pin.split(".").pop()} ` + [x.ground, x.joins.length ? "now to " + few(x.joins, 3) : "", x.left.length ? "off " + few(x.left, 3) : ""].filter(Boolean).join(", ")));
      if (what.length) { changed.push({ part: name(c), frame: c.type === "frame", what, rewired: pins.length > 0 }); if (c.type !== "frame") marks.push({ kind: "changed", comp: c, what }); }
      else if (["x", "y", "rot", "mirror"].some(k => SKIP.has(k) && JSON.stringify(o[k]) !== JSON.stringify(c[k])) || (o.params || {}).flip !== (c.params || {}).flip) { moved.push(name(c)); marks.push({ kind: "moved", comp: c, from: o }); }
    });
    const key = w => [w.x1, w.y1, w.x2, w.y2].join(",");
    const wa = new Set((a && a.wires || []).map(key)), wb = new Set((b && b.wires || []).map(key));
    let wiresAdded = (b && b.wires || []).filter(w => !wa.has(key(w))), wiresRemoved = (a && a.wires || []).filter(w => !wb.has(key(w)));
    // with the connections known: wires only redrawn (a part moved, a corner tidied) are no change
    const connections = rw ? [...rw.values()].reduce((n, l) => n + l.length, 0) : null;
    const redrawn = rw !== null && connections === 0 && (wiresAdded.length > 0 || wiresRemoved.length > 0);
    const wires = { added: wiresAdded.length, removed: wiresRemoved.length, redrawn };
    if (redrawn) { wiresAdded = []; wiresRemoved = []; }
    const bd = boardDiff(a && a.board, b && b.board);
    const board = !!bd;
    const tubes = JSON.stringify(a && a.tubes || []) !== JSON.stringify(b && b.tubes || []);
    const none = !added.length && !removed.length && !changed.length && !moved.length && !wires.added && !wires.removed && !board && !tubes;
    // top to bottom, then left to right (the CAD orders them by sheet as well)
    marks.sort((p, q) => (p.comp.y - q.comp.y) || (p.comp.x - q.comp.x));
    const d = { added, removed, changed, moved, wires, connections, board, boardDiff: bd, tubes, none, marks, wiresAdded, wiresRemoved };
    d.text = none ? "no changes" : summary(d);
    return d;
  }
  const few = (list, n = 6) => list.slice(0, n).join(", ") + (list.length > n ? ` and ${list.length - n} more` : "");
  function summary(d) {
    const out = [];
    if (d.added.length) out.push(`added ${few(d.added)}`);
    if (d.removed.length) out.push(`removed ${few(d.removed)}`);
    const parts = d.changed.filter(c => !c.frame);
    if (parts.length) out.push(parts.slice(0, 4).map(c => `${c.part}: ${c.what.slice(0, 2).join(", ")}${c.what.length > 2 ? " …" : ""}`).join("; ") + (parts.length > 4 ? `; ${parts.length - 4} more parts changed` : ""));
    if (d.changed.some(c => c.frame)) out.push("title block");
    if (d.moved.length) out.push(`moved ${d.moved.length} part${d.moved.length > 1 ? "s" : ""}`);
    if (d.wires.redrawn) out.push("wires redrawn, same connections");
    else if (d.wires.added || d.wires.removed) out.push(`wires +${d.wires.added} −${d.wires.removed}`);
    if (d.boardDiff) out.push("board: " + d.boardDiff.text);
    if (d.tubes) out.push("imported tubes changed");
    return out.join(" · ");
  }

  // a small picture of a board as the file keeps it (outline, pours' edges, tracks, vias, holes and
  // the parts' names), for a revision's preview: a data: URL, or null where there is no board
  function boardPicture(bd, maxW = 480) {
    const o = bd && bd.outline;
    if (!o || !(o.w > 0) || !(o.h > 0) || typeof document === "undefined") return null;
    try {
      const pad = 3, k = Math.min(maxW / (o.w + 2 * pad), 360 / (o.h + 2 * pad)), cv = document.createElement("canvas");
      cv.width = Math.round((o.w + 2 * pad) * k); cv.height = Math.round((o.h + 2 * pad) * k);
      const g = cv.getContext("2d");
      g.fillStyle = "#070b10"; g.fillRect(0, 0, cv.width, cv.height);
      g.setTransform(k, 0, 0, k, pad * k, pad * k);
      const r = Math.min(o.r || 0, o.w / 2, o.h / 2);
      g.beginPath(); if (g.roundRect) g.roundRect(0, 0, o.w, o.h, r); else g.rect(0, 0, o.w, o.h);
      g.fillStyle = "#0c1712"; g.fill(); g.strokeStyle = "#e3b341"; g.lineWidth = 0.5; g.stroke();
      g.lineCap = "round"; g.lineJoin = "round";
      const col = { "B.Cu": "#4f7fd8", "F.Cu": "#d85a4f" };
      ["B.Cu", "F.Cu"].forEach(L => (bd.tracks || []).filter(t => t.layer === L).forEach(t => {
        g.strokeStyle = col[L]; g.lineWidth = Math.max(t.w || 0.5, 0.4); g.beginPath();
        (t.pts || []).forEach((p, i) => (i ? g.lineTo(p[0], p[1]) : g.moveTo(p[0], p[1]))); g.stroke();
      }));
      g.fillStyle = "#c9d1d9";
      (bd.vias || []).forEach(v => { g.beginPath(); g.arc(v.x, v.y, (v.pad || 1.8) / 2, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = "#070b10";
      (bd.holes || []).forEach(h => { g.beginPath(); g.arc(h.x, h.y, (h.d || 3) / 2, 0, Math.PI * 2); g.fill(); });
      g.fillStyle = "#e6edf3"; g.font = "2.4px system-ui, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
      Object.values(bd.parts || {}).forEach(p => { if (p.x >= 0 && p.y >= 0 && p.x <= o.w && p.y <= o.h && p.ref) g.fillText(p.ref, p.x, p.y); });
      const webp = cv.toDataURL("image/webp", 0.82);
      return /^data:image\/webp/.test(webp) ? webp : cv.toDataURL("image/png");
    } catch (e) { return null; }
  }

  // "#rev=<project>.<n>" in an address → { project, n, vault }, or null; "&vault=<id>" after it: the
  // revision is in that folder vault (cad-vault.js; "1": the one in use), not on the site
  function fromHash(hash) {
    const parts = String(hash || "").replace(/^#/, "").split("&").map(p => p.split("=")), m = parts.find(p => p[0] === "rev");
    const v = m && /^([A-Za-z0-9_-]{10})\.(\d+)$/.exec(m[1] || "");
    const w = parts.find(p => p[0] === "vault" && /^[A-Za-z0-9_-]{1,20}$/.test(p[1] || ""));
    return v ? { project: v[1], n: +v[2], vault: w ? w[1] : false } : null;
  }
  // vault: the vault's id (cad-vault.js), or true for the one in use
  const hashOf = (project, n, vault) => `#rev=${project}.${n}${vault ? "&vault=" + (vault === true ? "1" : vault) : ""}`;

  // Where revisions are kept, chosen in the Revisions dialog and remembered in this browser:
  // "site" (aerocat.tech) or "vault" (a folder on this computer). Away from aerocat.tech, where the
  // site's store cannot be reached, it is the vault whenever the browser can open folders.
  const STORE_KEY = "tubecad.rev.store";
  function storeName(origin) {
    const V = root.CadVault;
    if (!V) return "site";
    let v = null; try { v = localStorage.getItem(STORE_KEY); } catch (e) { /* private window */ }
    if (v === "vault" || v === "site") return v;
    return !base(origin) && V.shared().writes ? "vault" : "site";
  }
  function setStore(v) { try { localStorage.setItem(STORE_KEY, v === "vault" ? "vault" : "site"); } catch (e) { /* private window */ } }
  // the client of the store chosen
  const active = origin => (storeName(origin) === "vault" ? root.CadVault.shared() : client(origin));

  root.CadRevisions = { SITE, base, client, diff, boardDiff, boardPicture, fromHash, hashOf, PID, storeName, setStore, active };
})(typeof window !== "undefined" ? window : globalThis);
