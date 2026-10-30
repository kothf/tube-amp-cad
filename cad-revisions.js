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
      available: !!b,
      me: () => call("/me"),
      projects: () => call("/projects"),
      createProject: (name, notes) => call("/projects", { method: "POST", body: { name, notes } }),
      project: id => call(P(id)),
      updateProject: (id, fields) => call(P(id), { method: "PATCH", body: fields }),
      deleteProject: id => call(P(id), { method: "DELETE" }),
      saveRevision: (id, rev) => call(P(id) + "/revs", { method: "POST", body: rev }),
      revision: (id, n) => call(P(id) + "/revs/" + n),
      updateRevision: (id, n, fields) => call(P(id) + "/revs/" + n, { method: "PATCH", body: fields }),
      deleteRevision: (id, n) => call(P(id) + "/revs/" + n, { method: "DELETE" }),
      exportUrl: id => b + P(id) + "/export",
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
  function diff(a, b) {
    const A = new Map((a && a.comps || []).map(c => [c.id, c])), B = new Map((b && b.comps || []).map(c => [c.id, c]));
    const added = [], removed = [], changed = [], moved = [];
    B.forEach((c, id) => { if (!A.has(id) && c.type !== "frame") added.push(name(c)); });
    A.forEach((c, id) => { if (!B.has(id) && c.type !== "frame") removed.push(name(c)); });
    B.forEach((c, id) => {
      const o = A.get(id); if (!o) return;
      const what = [];
      if ((o.label || "") !== (c.label || "")) what.push(`label ${show(o.label)} → ${show(c.label)}`);
      if (o.type !== c.type) what.push(`type ${o.type} → ${c.type}`);
      const p = o.params || {}, q = c.params || {};
      // a field missing on one side and empty on the other (a newer app filling in its defaults) is no change
      new Set([...Object.keys(p), ...Object.keys(q)]).forEach(k => { if (show(p[k]) !== show(q[k]) || (typeof p[k] === "object" && JSON.stringify(p[k]) !== JSON.stringify(q[k]))) what.push(`${k} ${show(p[k])} → ${show(q[k])}`); });
      if (what.length) changed.push({ part: name(c), frame: c.type === "frame", what });
      else if (["x", "y", "rot", "mirror"].some(k => SKIP.has(k) && JSON.stringify(o[k]) !== JSON.stringify(c[k]))) moved.push(name(c));
    });
    const key = w => [w.x1, w.y1, w.x2, w.y2].join(",");
    const wa = new Set((a && a.wires || []).map(key)), wb = new Set((b && b.wires || []).map(key));
    const wires = { added: [...wb].filter(k => !wa.has(k)).length, removed: [...wa].filter(k => !wb.has(k)).length };
    const board = JSON.stringify(a && a.board || null) !== JSON.stringify(b && b.board || null);
    const tubes = JSON.stringify(a && a.tubes || []) !== JSON.stringify(b && b.tubes || []);
    const none = !added.length && !removed.length && !changed.length && !moved.length && !wires.added && !wires.removed && !board && !tubes;
    return { added, removed, changed, moved, wires, board, tubes, none, text: none ? "no changes" : summary({ added, removed, changed, moved, wires, board, tubes }) };
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
    if (d.wires.added || d.wires.removed) out.push(`wires +${d.wires.added} −${d.wires.removed}`);
    if (d.board) out.push("board changed");
    if (d.tubes) out.push("imported tubes changed");
    return out.join(" · ");
  }

  // "#rev=<project>.<n>" in an address → { project, n }, or null
  function fromHash(hash) {
    const m = String(hash || "").replace(/^#/, "").split("&").map(p => p.split("=")).find(p => p[0] === "rev");
    const v = m && /^([A-Za-z0-9_-]{10})\.(\d+)$/.exec(m[1] || "");
    return v ? { project: v[1], n: +v[2] } : null;
  }
  const hashOf = (project, n) => `#rev=${project}.${n}`;

  root.CadRevisions = { SITE, base, client, diff, fromHash, hashOf, PID };
})(typeof window !== "undefined" ? window : globalThis);
