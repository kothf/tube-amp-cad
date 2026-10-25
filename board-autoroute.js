/* The Board window's Auto-route: Freerouting's API server on this computer (BoardRoute). The button
   stays grey until it answers; the routes come back as tracks and vias, one step to undo. Also the
   Freerouting… dialog (its address, the commands to start it) and importing a .ses file by hand. */
(function (root) {
  "use strict";
  // app: what this part needs from board-app.js; returns what board-app.js uses of it
  root.BoardAutoroute = function (app) {
    const { $, B, S, analyse, appVersion, baseName, commit, dropResidue, msg } = app;
    const ROUTER_KEY = "tubecad_router_url";
    const router = { url: BoardRoute.DEFAULT_URL, up: false, why: "down", busy: false, timer: 0 };
    try { router.url = localStorage.getItem(ROUTER_KEY) || router.url; } catch (e) { /* no storage */ }
    const pageOrigin = () => /^https?:/.test(location.origin) ? location.origin : "*";
    // what a probe found, in words: what to change on Freerouting's side
    function routerWhy(url, p) {
      if (p.ok) return `Freerouting answers at ${url}.`;
      if (p.why === "cors") return `Freerouting runs at ${url} but does not let this page in: restart it with --api_server.cors_origins=${pageOrigin()} (the commands below have it).`;
      if (p.why === "status") return `Something answers at ${url} (${p.code}), but not Freerouting's API: check the address and port.`;
      return `No answer from ${url}. Is Freerouting's API server on? Started without --api_server.enabled=true (or with its window), it does not listen. In Docker, use the command below: the image's own command listens only inside the container. If the browser asked to reach devices on your network, allow it.`;
    }
    function routerUi() {
      const b = $("btn-autoroute"); if (!b) return;
      b.classList.toggle("off", !router.up || router.busy);
      b.querySelector(".lbl").textContent = router.busy ? "Routing…" : "Auto-route";
      b.title = router.busy ? "Freerouting is routing the board" : router.up ? `Route the open connections with Freerouting (${router.url}), within the design rules; Ctrl+Z takes it back`
        : routerWhy(router.url, router) + " Click for the address and the commands.";
    }
    async function pollRouter() {
      clearTimeout(router.timer);
      const p = await BoardRoute.probe(router.url, 3000), up = p.ok;
      router.why = p.why; router.code = p.code;
      if (up !== router.up) { router.up = up; routerUi(); }
      router.timer = setTimeout(pollRouter, up ? 15000 : 5000);
    }
    function dsnOf() { analyse(); return BoardRoute.toDsn(S.board, S.model, S.conn, S.clr, { hv: S.hv, amps: S.amps, title: baseName(), version: appVersion() }); }
    // the routes of a session on the board, one step in the history; a summary of what is left
    function takeRoutes(ses, d) {
      const got = BoardRoute.prune(BoardRoute.fromSes(ses, S.board, d, S.model.names), S.board, S.model.pads);
      S.board.tracks.push(...got.tracks); S.board.vias.push(...got.vias);
      return got;
    }
    function routedNote(todo, nt, nv) {
      const left = S.conn.unrouted, done = todo - left;
      return `${done} of ${todo} connection${todo === 1 ? "" : "s"} routed (${nt} track${nt === 1 ? "" : "s"}, ${nv} via${nv === 1 ? "" : "s"})` + (left ? `; ${left} left to route by hand` : "") + (S.drc.length ? `; ${S.drc.length} rule message${S.drc.length === 1 ? "" : "s"} to look at` : "");
    }
    function addRoutes(ses, d) {
      const todo = S.conn.unrouted, got = takeRoutes(ses, d);
      commit();
      return routedNote(todo, got.tracks.length, got.vias.length);
    }
    // the pads of a poured net its pour does not reach (cut off by tracks, or in a gap): net name -> "x,y" of
    // the pads at each end of its ratsnest lines, for a second Freerouting pass
    function pourGaps() {
      analyse();
      const poured = new Set((S.board.zones || []).map(z => z.net)), only = new Map(), key = (x, y) => `${+x.toFixed(4)},${+y.toFixed(4)}`;
      S.conn.rats.forEach(r => { const n = S.model.names[r.net] || r.net; if (!poured.has(n)) return; if (!only.has(n)) only.set(n, new Set()); only.get(n).add(key(r.x1, r.y1)).add(key(r.x2, r.y2)); });
      return only;
    }
    // before an auto-route: copper left over from an earlier layout (parts moved since) goes, so Freerouting
    // routes those connections afresh: loose ends and lone vias, copper reaching no pad, copper joining two nets,
    // and tracks breaking a clearance. Locked copper stays. Returns how many tracks and vias went
    function clearStale() {
      const b = S.board, n0 = b.tracks.length + b.vias.length;
      for (let pass = 0; pass < 20; pass++) {
        analyse();
        const bad = new Set();
        S.conn.items.forEach(it => { if ((it.kind === "track" || it.kind === "via") && (it.net === null || it.net === "short")) bad.add(it.kind === "track" ? b.tracks[it.ti] : b.vias[it.vi]); });
        S.drc.filter(d => d.kind === "clearance" && d.between).forEach(d => b.tracks.forEach(t => { if (t.pts.some((p, k) => k && B.segDist(t.pts[k - 1][0], t.pts[k - 1][1], p[0], p[1], d.x, d.y) <= t.w / 2 + 0.01)) bad.add(t); }));
        const go = [...bad].filter(o => o && !o.locked);
        if (!go.length) break;
        b.tracks = b.tracks.filter(t => !go.includes(t)); b.vias = b.vias.filter(v => !go.includes(v));
      }
      dropResidue(null);
      return n0 - b.tracks.length - b.vias.length;
    }
    async function autoRoute() {
      if (router.busy) return;
      if (!S.model) { msg("Open the Circuit CAD first: the board needs its parts"); return; }
      if (!router.up) { await pollRouter(); if (!router.up) { msg(`No Freerouting at ${router.url}: see Board ▾ → Freerouting…`); routerSetup(); return; } }
      const stale = clearStale(), staleNote = stale ? ` · ${stale} old piece${stale === 1 ? "" : "s"} of copper cleared first (left from where the parts were)` : "";
      if (!S.conn.unrouted) { if (stale) commit(); msg("Nothing to route: every connection is routed" + staleNote); return; }
      const d = dsnOf();
      router.busy = true; routerUi(); msg(`Freerouting is routing ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"}…`);
      try {
        const todo = S.conn.unrouted, r = await BoardRoute.route(router.url, d.text, { version: appVersion() }), got = takeRoutes(r.ses, d);
        let nt = got.tracks.length, nv = got.vias.length, pourNote = d.skipped.length ? ` · left to the pour: ${d.skipped.join(", ")}` : "";
        // the pours fill around the new tracks; pads of a pour's net it does not reach get tracks of their own
        const gaps = pourGaps();
        if (gaps.size) {
          const before = S.conn.unrouted, d2 = BoardRoute.toDsn(S.board, S.model, S.conn, S.clr, { hv: S.hv, amps: S.amps, title: baseName(), version: appVersion(), only: gaps });
          msg(`Freerouting joins the pads the ${[...gaps.keys()].join(", ")} pour does not reach…`);
          const g2 = takeRoutes((await BoardRoute.route(router.url, d2.text, { version: appVersion() })).ses, d2);
          nt += g2.tracks.length; nv += g2.vias.length; analyse();
          const joined = before - S.conn.unrouted;
          if (joined) pourNote += ` (${joined} pad${joined === 1 ? "" : "s"} it did not reach joined by tracks)`;
        }
        commit();
        msg(routedNote(todo, nt, nv) + pourNote + staleNote);
      } catch (e) { if (stale) commit(); msg(`Auto-route failed: ${e.message}` + staleNote); router.up = false; pollRouter(); }
      finally { router.busy = false; routerUi(); }
    }
    // Unroute: every track and via off the board (locked ones stay), one step to undo
    function unroute() {
      const b = S.board, n = b.tracks.length + b.vias.length;
      const tracks = b.tracks.filter(t => t.locked), vias = b.vias.filter(v => v.locked), kept = tracks.length + vias.length;
      if (n === kept) { msg(n ? "Every track and via is locked: nothing to remove" : "No tracks or vias to remove"); return; }
      const gone = b.tracks.length - tracks.length, vgone = b.vias.length - vias.length;
      b.tracks = tracks; b.vias = vias; S.sel = null; S.route = null;
      commit(`Removed ${gone} track${gone === 1 ? "" : "s"} and ${vgone} via${vgone === 1 ? "" : "s"}` + (kept ? `; ${kept} locked kept` : "") + "; Ctrl+Z brings them back");
    }
    // Board ▾ → Freerouting…: the address (this computer or another on the network) and how to start it
    function routerSetup() {
      const origin = pageOrigin();
      $("router-addr").value = router.url.replace(/^http:\/\//, "");
      $("router-cmd-java").textContent = BoardRoute.command(origin); $("router-cmd-docker").textContent = BoardRoute.dockerCommand(origin);
      $("router-state").textContent = routerWhy(router.url, router);
      $("router-modal").hidden = false; $("router-addr").focus();
    }
    async function routerTest() {
      const url = BoardRoute.address($("router-addr").value), st = $("router-state");
      if (!url) { st.textContent = "That is not an address: an IP or a name, and :port if not 37864"; return; }
      st.textContent = `Asking ${url}…`;
      st.textContent = routerWhy(url, await BoardRoute.probe(url, 3000));
    }
    function routerSave() {
      const url = BoardRoute.address($("router-addr").value);
      if (!url) { $("router-state").textContent = "That is not an address: an IP or a name, and :port if not 37864"; return; }
      router.url = url; router.up = false; $("router-modal").hidden = true;
      try { localStorage.setItem(ROUTER_KEY, router.url); } catch (e) { /* no storage */ }
      routerUi(); pollRouter().then(() => msg(router.up ? `Freerouting answers at ${router.url}` : `No Freerouting at ${router.url} yet: Auto-route stays grey until it answers`));
    }
    function importSes(file) {
      if (!file || !S.model) return;
      file.text().then(t => { try { msg(addRoutes(t, dsnOf())); } catch (e) { msg(`Not imported: ${e.message}`); } });
    }
    return { autoRoute, clearStale, dsnOf, importSes, pollRouter, router, routerSave, routerSetup, routerTest, routerUi, unroute };
  };
})(window);
