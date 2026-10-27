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
      b.classList.toggle("off", !router.up || (router.busy && !router.nudge));
      b.querySelector(".lbl").textContent = router.busy ? (router.nudge ? "Stop" : "Routing…") : "Auto-route";
      b.title = router.busy ? (router.nudge ? "Stop Route & nudge after this pass; the best layout so far stays" : "Freerouting is routing the board") : router.up ? `Route the open connections with Freerouting (${router.url}), within the design rules; Ctrl+Z takes it back`
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
    // one Freerouting pass over what is open, then the pads of poured nets their pour does not reach;
    // the routes go on the board (not committed). first: names of nets to route on their own first
    // (the ones a pass before could not finish get the board before the rest). Returns { todo, nt, nv, pourNote }
    async function routePass(first) {
      if (first && first.size) { analyse(); const d1 = BoardRoute.toDsn(S.board, S.model, S.conn, S.clr, { hv: S.hv, amps: S.amps, title: baseName(), version: appVersion(), only: new Map([...first].map(n => [n, null])) }); takeRoutes((await BoardRoute.route(router.url, d1.text, { version: appVersion() })).ses, d1); analyse(); }
      const d = dsnOf(), todo = S.conn.unrouted, r = await BoardRoute.route(router.url, d.text, { version: appVersion() }), got = takeRoutes(r.ses, d);
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
      const own = finish(); nt += own;
      if (own) pourNote += ` · ${own} joined on a grid where Freerouting left a way`;
      return { todo, nt, nv, pourNote };
    }
    const checkOpts = () => ({ clr: S.clr, hv: S.hv, amps: S.amps });
    // the open connections routed as tracks (not a pour's, not the star ground)
    const routable = () => { const f = failed(S.conn.rats); return S.conn.rats.filter(r => f.has(S.model.names[r.net] || String(r.net))); };
    // what Freerouting left that a grid path still reaches (BoardPlace.bridge, Lee's maze routing):
    // each track stays only if it closes a connection and adds no rule message. Returns how many
    function finish() {
      analyse();
      const tried = new Set(), key = r => [r.x1, r.y1, r.x2, r.y2].map(v => v.toFixed(3)).join(","), bad = () => S.drc.filter(d => d.kind !== "unplaced").length;
      let n = 0;
      for (let k = 0; k < 60; k++) {
        const rats = routable().filter(r => !tried.has(key(r)));
        const b = rats.length && BoardPlace.bridge(S.board, S.model, S.conn, rats, checkOpts()); if (!b) break;
        const un = S.conn.unrouted, d = bad();
        S.board.tracks.push(b.track); analyse();
        if (S.conn.unrouted < un && bad() <= d) n++;
        else { S.board.tracks.pop(); analyse(); tried.add(key(rats[b.i])); }
      }
      // then each one left, routed exactly in a window round it with whatever copper is there (BoardPlace.exact)
      const done = new Set();
      for (let k = 0; k < 20; k++) {
        const rats = routable().filter(r => !done.has(key(r))); if (!rats.length) break;
        done.add(key(rats[0]));
        for (const margin of [4, 8]) {
          const r = BoardPlace.exact(S.board, S.model, S.conn, rats, { ...checkOpts(), margin });
          if (!r || !r.sat) continue;
          const keep = JSON.stringify(S.board), un = S.conn.unrouted, d = bad();
          S.board.tracks = S.board.tracks.filter((_, i) => !r.cut.tracks.has(i)).concat(r.add.tracks);
          S.board.vias = S.board.vias.filter((_, i) => !r.cut.vias.has(i)).concat(r.add.vias);
          analyse();
          if (S.conn.unrouted < un && bad() <= d) { n += un - S.conn.unrouted; break; }
          S.board = JSON.parse(keep); analyse();
        }
      }
      return n;
    }
    // the pins still shut in, in words ("" when none)
    function shutIn() {
      const rats = routable(); if (!rats.length) return "";
      const s = BoardPlace.describeEscape(BoardPlace.escape(S.board, S.model, S.conn, rats, checkOpts()));
      return s ? `; shut in: ${s}` : "";
    }
    async function ready() {
      if (router.busy) return false;
      if (!S.model) { msg("Open the Circuit CAD first: the board needs its parts"); return false; }
      if (!router.up) { await pollRouter(); if (!router.up) { msg(`No Freerouting at ${router.url}: see Board ▾ → Freerouting…`); routerSetup(); return false; } }
      return true;
    }
    async function autoRoute() {
      if (router.busy && router.nudge) { router.stop = true; msg("Stopping after this pass: the best layout so far stays"); return; }
      if (!await ready()) return;
      const stale = clearStale(), staleNote = stale ? ` · ${stale} old piece${stale === 1 ? "" : "s"} of copper cleared first (left from where the parts were)` : "";
      if (!S.conn.unrouted) { if (stale) commit(); msg("Nothing to route: every connection is routed" + staleNote); return; }
      router.busy = true; routerUi(); msg(`Freerouting is routing ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"}…`);
      try {
        const p = await routePass();
        commit();
        msg(routedNote(p.todo, p.nt, p.nv) + (S.conn.unrouted ? shutIn() + "; Board ▾ → Route & nudge moves parts to make room" : "") + p.pourNote + staleNote);
      } catch (e) { if (stale) commit(); msg(`Auto-route failed: ${e.message}` + staleNote); router.up = false; pollRouter(); }
      finally { router.busy = false; routerUi(); }
    }
    // Route & nudge: route; while connections are left, move the parts near them a little
    // (BoardPlace.nudge), take up the copper round them, route again, keep the round if it helped.
    // Up to 5 rounds, stopping after 2 that gain nothing; the whole run is one step to undo
    const ROUNDS = 5;
    const trackLen = () => S.board.tracks.reduce((s, t) => s + t.pts.reduce((a, p, k) => a + (k ? Math.hypot(p[0] - t.pts[k - 1][0], p[1] - t.pts[k - 1][1]) : 0), 0), 0);
    const score = () => ({ un: S.conn.unrouted, bad: S.drc.filter(d => d.kind !== "unplaced").length, len: trackLen() });
    const better = (a, b) => a.bad <= b.bad && (a.un < b.un || (a.un === b.un && (a.bad < b.bad || a.len < b.len * 0.99)));
    // the unlocked copper of the nets on the moved parts and of the open connections, and any that
    // passes within reach of an open connection: Freerouting keeps what is routed as it is
    function ripUp(rats, moved, reach, walls) {
      const b = S.board, keys = new Set(moved.map(m => m.key)), nets = new Set(rats.map(r => r.net)), W = walls || { tracks: new Set(), vias: new Set() };
      S.model.pads.forEach(p => { if (keys.has(p.part) && p.net !== null) nets.add(p.net); });
      const near = s => rats.some(r => B.segSeg(s, [r.x1, r.y1, r.x2, r.y2]) <= reach);
      const goT = new Set(), goV = new Set();
      S.conn.items.forEach(it => {
        if (it.kind === "track" && !b.tracks[it.ti].locked && (nets.has(it.net) || near(it.s) || W.tracks.has(b.tracks[it.ti]))) goT.add(it.ti);
        if (it.kind === "via" && !b.vias[it.vi].locked && (nets.has(it.net) || near(it.s) || W.vias.has(b.vias[it.vi]))) goV.add(it.vi);
      });
      b.tracks = b.tracks.filter((_, i) => !goT.has(i)); b.vias = b.vias.filter((_, i) => !goV.has(i));
      analyse(); clearStale();
      return goT.size + goV.size;
    }
    // the nets of open connections that are routed as tracks (not a pour's, not the star ground)
    function failed(rats) {
      const poured = new Set((S.board.zones || []).map(z => z.net)), star = S.board.rules.ground === "star";
      return new Set(rats.map(x => S.model.names[x.net] || String(x.net)).filter(n => !poured.has(n) && !(star && n === "GND")));
    }
    // spread every part that may move over the whole board (how: BoardPlace.spread's wire and anchor);
    // the ones with shut-in pins count twice their size, the others at the ends of open connections half as much again
    const SPREADS = [{}, { wire: 0.3, anchor: 0.5 }];
    function spreadAll(how) {
      const open = routable(), infl = new Map(), all = new Set(S.model.parts.map(g => g.key));
      S.model.pads.forEach(p => { if (open.some(r => (Math.hypot(r.x1 - p.x, r.y1 - p.y) < 1e-3 || Math.hypot(r.x2 - p.x, r.y2 - p.y) < 1e-3))) infl.set(p.part, 1.5); });
      BoardPlace.escape(S.board, S.model, S.conn, open, checkOpts()).forEach(e => { if (!e.ok) infl.set(e.key, 2); });
      const keys = BoardPlace.movable(S.board, S.model, [], { also: all });
      return keys.length ? BoardPlace.spread(S.board, S.model, keys, { clr: S.clr, hv: S.hv, netlist: S.netlist, conn: S.conn, inflate: infl, ...how }) : { moved: [] };
    }
    async function routeNudge() {
      if (router.busy && router.nudge) { router.stop = true; return; }
      if (!await ready()) return;
      const off = S.drc.filter(d => d.kind === "unplaced").length;
      if (off) { msg(`${off} part${off === 1 ? " is" : "s are"} not on the board yet: place ${off === 1 ? "it" : "them"} first, then Route & nudge`); return; }
      const start = JSON.stringify(S.board), parts0 = JSON.parse(start).parts, stale = clearStale();
      router.busy = true; router.nudge = true; router.stop = false; routerUi();
      try {
        if (S.conn.unrouted) { msg(`Freerouting is routing ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"}…`); await routePass(); }
        const first = score();
        let best = JSON.stringify(S.board), bestScore = first, reach = 8, fails = 0, round = 0, broke = "";
        while (S.conn.unrouted && round < ROUNDS && fails < 2 && !router.stop) {
          round++;
          // what walls in the open connections (BoardPlace.escape, passage): those parts may move, that copper comes up
          const rats = S.conn.rats.slice(), open = routable(), walls = { parts: new Set(), tracks: new Set(), vias: new Set() };
          BoardPlace.escape(S.board, S.model, S.conn, open, checkOpts()).filter(e => !e.ok).map(e => (walls.parts.add(e.key), e.walls))
            .concat(BoardPlace.passage(S.board, S.model, S.conn, open, checkOpts()).filter(p => !p.ok).map(p => p.walls))
            .forEach(ws => ws.slice(0, 6).forEach(w => { if (w.kind === "part") walls.parts.add(w.key); if (w.kind === "track") walls.tracks.add(S.board.tracks[w.ti]); if (w.kind === "via") walls.vias.add(S.board.vias[w.vi]); }));
          const keys = BoardPlace.movable(S.board, S.model, rats, { radius: reach, also: walls.parts });
          msg(`Round ${round} of ${ROUNDS}: ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"} left; moving ${keys.length} part${keys.length === 1 ? "" : "s"} near them…`);
          await new Promise(r => setTimeout(r, 0));
          const r = keys.length ? BoardPlace.nudge(S.board, S.model, keys, { clr: S.clr, hv: S.hv, netlist: S.netlist, conn: S.conn, seed: round, reach }) : { moved: [] };
          // nothing moved: still take up the copper that walls them in, once per reach, and route again
          if (!r.moved.length && !walls.tracks.size && !walls.vias.size) { reach *= 1.5; fails++; continue; }
          analyse(); ripUp(rats, r.moved, reach, walls);
          msg(`Round ${round} of ${ROUNDS}: ${r.moved.length} part${r.moved.length === 1 ? "" : "s"} moved; Freerouting routes ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"}…`);
          // a pass that fails ends the run with the best layout so far
          try { await routePass(failed(rats)); } catch (e) { S.board = JSON.parse(best); analyse(); broke = e.message; break; }
          const sc = score();
          if (better(sc, bestScore)) { best = JSON.stringify(S.board); bestScore = sc; fails = 0; }
          else { S.board = JSON.parse(best); analyse(); reach *= 1.5; fails++; }
        }
        // a last round over the whole board: the parts spread where there is room (BoardPlace.spread),
        // the shut-in ones counting bigger; every unlocked track comes up and the board is routed afresh
        // two ways: by wire length (the parts may go anywhere), and held near where they are
        for (const how of SPREADS) {
          if (!bestScore.un || router.stop || broke) break;
          S.board = JSON.parse(best); analyse(); round++;
          const r = spreadAll(how);
          if (!r.moved.length) continue;
          msg(`Round ${round}: ${r.moved.length} part${r.moved.length === 1 ? "" : "s"} spread over the board; Freerouting routes it afresh…`);
          S.board.tracks = S.board.tracks.filter(t => t.locked); S.board.vias = S.board.vias.filter(v => v.locked); analyse(); clearStale();
          try { await routePass(); const sc = score(); if (better(sc, bestScore)) { best = JSON.stringify(S.board); bestScore = sc; } }
          catch (e) { broke = e.message; }
        }
        S.board = JSON.parse(best); S.sel = null;
        const moved = Object.keys(parts0).filter(k => S.board.parts[k]).map(k => ({ key: k, ref: S.board.parts[k].ref, from: parts0[k], to: S.board.parts[k] }))
          .filter(m => Math.abs(m.from.x - m.to.x) > 1e-6 || Math.abs(m.from.y - m.to.y) > 1e-6 || ((m.from.rot || 0) & 3) !== ((m.to.rot || 0) & 3))
          .map(m => ({ ...m, from: { x: m.from.x, y: m.from.y, rot: m.from.rot || 0 }, to: { x: m.to.x, y: m.to.y, rot: m.to.rot || 0 } }));
        const left = bestScore.un, changed = JSON.stringify(S.board) !== start || stale;
        if (changed) commit(); else analyse();
        const what = moved.length ? `moved ${BoardPlace.describe(moved)}` : "no part moved", stuck = left ? shutIn() : "";
        msg((left ? `${left} connection${left === 1 ? "" : "s"} still open after ${round} round${round === 1 ? "" : "s"}` : `Everything routed${round ? ` after ${round} round${round === 1 ? "" : "s"}` : ""}`) +
          (round || moved.length ? `: ${what}` : "") + stuck + (router.stop ? " (stopped)" : "") + (broke ? ` (Freerouting failed in round ${round}: ${broke})` : "") + (changed ? "; Ctrl+Z takes it all back" : ""));
        return { left, rounds: round, moved };
      } catch (e) { S.board = JSON.parse(start); analyse(); msg(`Route & nudge failed: ${e.message}; the board is as it was`); router.up = false; pollRouter(); }
      finally { router.busy = false; router.nudge = false; routerUi(); }
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
    return { autoRoute, clearStale, dsnOf, importSes, pollRouter, routeNudge, router, routerSave, routerSetup, routerTest, routerUi, unroute };
  };
})(window);
