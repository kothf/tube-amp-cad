/* The Board window's Auto-route: Freerouting's API server on this computer, another one, or the site's own
   (BoardRoute). The button stays grey until it answers; the routes come back as tracks and vias, one step
   to undo. Also the Freerouting… dialog (the site's server or an address of your own, the commands to
   start one) and importing a .ses file by hand. */
(function (root) {
  "use strict";
  // app: what this part needs from board-app.js; returns what board-app.js uses of it
  root.BoardAutoroute = function (app) {
    const { $, B, S, analyse, appVersion, baseName, commit, dropResidue, msg, render, renderPanels } = app;
    const ROUTER_KEY = "tubecad_router_url", USE_KEY = "tubecad_router_use";
    // server: the site's own Freerouting (null where the page has none); a user's own address wins once saved
    const router = { url: BoardRoute.DEFAULT_URL, up: false, why: "down", busy: false, timer: 0, server: BoardRoute.serverUrl() };
    router.url = router.server || router.url;
    try { router.url = localStorage.getItem(ROUTER_KEY) || router.url; } catch (e) { /* no storage */ }
    // use: Freerouting routes first (ticked in its dialog); otherwise the board's own grid router does it all
    router.use = false;
    try { router.use = localStorage.getItem(USE_KEY) === "1"; } catch (e) { /* no storage */ }
    const viaFr = () => router.use && router.up, who = () => (viaFr() ? "Freerouting" : "the grid router");
    // the heavy steps of board-place.js run in a worker (board-worker.js), so the window keeps drawing and
    // answering; where none starts (a page opened from a file), on the page, after a breath for the screen
    const VQ = (() => { const sc = [...document.scripts].find(s => /board-autoroute\.js/.test(s.src)); const q = sc && sc.src.split("?")[1]; return q ? "?" + q : ""; })();
    const off = { worker: null, ok: typeof Worker !== "undefined", seq: 0, wait: new Map() };
    function offPage(fn, rats, opts) {
      if (off.ok && !off.worker) {
        try {
          off.worker = new Worker("board-worker.js" + VQ);
          off.worker.onmessage = e => { const w = off.wait.get(e.data.seq); if (w) { off.wait.delete(e.data.seq); w(e.data); } };
          off.worker.onerror = e => { if (e && e.preventDefault) e.preventDefault(); off.ok = false; off.worker.terminate(); off.worker = null; const ws = [...off.wait.values()]; off.wait.clear(); ws.forEach(w => w({ lost: true })); };
        } catch (e) { off.ok = false; off.worker = null; }
      }
      const here = () => new Promise(r => setTimeout(r, 0)).then(() => { const o = { ...checkOpts(), netlist: S.netlist, conn: S.conn, ...opts }; return fn === "pathfinder" ? BoardPathfinder.route(S.board, S.model, S.conn, o) : BoardPlace[fn](S.board, S.model, S.conn, rats, o); });
      if (!off.worker) return here();
      const seq = ++off.seq;
      return new Promise(res => {
        off.wait.set(seq, d => res(d.lost ? here() : d.error ? Promise.reject(new Error(d.error)) : d.result));
        off.worker.postMessage({ seq, fn, board: S.board, model: S.model, conn: S.conn, rats, netlist: S.netlist, hv: S.hv, amps: S.amps, opts });
      });
    }
    const breath = () => new Promise(r => setTimeout(r, 0));
    // the progress bar in the status line: progress(done, of, what) while a run goes on, progress() when it ends;
    // the bar fills by steps, its stripes move and the clock runs while a step (a Freerouting pass) is under way
    const prog = { t0: 0, timer: 0, what: "", sub: "" };
    function progress(done, of, what) {
      const box = $("st-prog"); if (!box) return;
      if (done === undefined) { box.hidden = true; clearInterval(prog.timer); prog.timer = 0; prog.t0 = 0; return; }
      if (!prog.t0) prog.t0 = Date.now();
      prog.what = `${what ? what + " · " : ""}${of ? `step ${Math.min(done + 1, of)} of ${of}` : ""}`; prog.sub = "";
      box.querySelector(".bar i").style.width = of ? `${Math.round(100 * Math.min(1, done / of))}%` : "0%";
      tick(); box.hidden = false;
      if (!prog.timer) prog.timer = setInterval(tick, 1000);
    }
    function tick() { const sec = Math.round((Date.now() - prog.t0) / 1000); $("st-step").textContent = [prog.what, prog.sub, `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`].filter(Boolean).join(" · "); }
    // what the step is doing now ("Freerouting", "grid finishers"…)
    function stage(t) { if (!prog.t0) return; prog.sub = t; tick(); }
    const pageOrigin = () => /^https?:/.test(location.origin) ? location.origin : "*";
    // what a probe found, in words: what to change on Freerouting's side
    function routerWhy(url, p) {
      if (p.ok) return url === router.server ? "The site's Freerouting server answers." : `Freerouting answers at ${url}.`;
      if (url === router.server) {
        if (p.why === "signin") return "The site's Freerouting server wants you to sign in first (once per browser, with your e-mail): press Sign in, then Test.";
        return `The site's Freerouting server does not answer${p.why === "status" ? ` (${p.code})` : ""}: it may be down for now, or use your own below.`;
      }
      if (p.why === "signin") return `${url} wants you to sign in first: open it in this browser and log in, then Test.`;
      if (p.why === "cors") return `Freerouting runs at ${url} but does not let this page in: restart it with --api_server.cors_origins=${pageOrigin()} (the commands below have it).`;
      if (p.why === "status") return `Something answers at ${url} (${p.code}), but not Freerouting's API: check the address and port.`;
      return `No answer from ${url}. Is Freerouting's API server on? Started without --api_server.enabled=true (or with its window), it does not listen. In Docker, use the command below: the image's own command listens only inside the container. If the browser asked to reach devices on your network, allow it.`;
    }
    function routerUi() {
      if (!router.busy) progress();
      const b = $("btn-autoroute"); if (!b) return;
      b.classList.toggle("off", router.busy && !router.nudge);
      b.querySelector(".lbl").textContent = router.busy ? (router.nudge ? "Stop" : "Routing…") : "Auto-route";
      b.title = router.busy ? (router.nudge ? "Stop after this pass; the best layout so far stays" : "Routing the board") : viaFr() ? `Route the open connections with Freerouting (${router.url}) and the board's own grid router, within the design rules; Ctrl+Z takes it back`
        : `Route the open connections with the board's own grid router, within the design rules; Ctrl+Z takes it back.` + (router.use ? ` ${routerWhy(router.url, router)} Route ▾ → Freerouting… for the address and the commands.` : " Route ▾ → Freerouting… to let Freerouting route first.");
    }
    async function pollRouter() {
      clearTimeout(router.timer);
      if (!router.use) { if (router.up) { router.up = false; routerUi(); } return; }
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
      if (!viaFr()) {
        stage("grid router");
        const todo = S.conn.unrouted, was = new Set([...S.board.tracks, ...S.board.vias].map(o => JSON.stringify(o)));
        await finish();
        const fresh = list => list.filter(o => !was.has(JSON.stringify(o))).length;
        return { todo, nt: fresh(S.board.tracks), nv: fresh(S.board.vias), pourNote: router.use ? " · by the board's own grid router (Freerouting does not answer: Route ▾ → Freerouting…)" : " · by the board's own grid router" };
      }
      if (first && first.size) { analyse(); const d1 = BoardRoute.toDsn(S.board, S.model, S.conn, S.clr, { hv: S.hv, amps: S.amps, title: baseName(), version: appVersion(), only: new Map([...first].map(n => [n, null])) }); takeRoutes((await BoardRoute.route(router.url, d1.text, { version: appVersion() })).ses, d1); analyse(); }
      stage("Freerouting");
      const d = dsnOf(), todo = S.conn.unrouted, r = await BoardRoute.route(router.url, d.text, { version: appVersion() }), got = takeRoutes(r.ses, d);
      await breath();
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
      await breath(); stage("grid finishers");
      const own = await finish(); nt += own;
      if (own) pourNote += ` · ${own} joined on a grid where Freerouting left a way`;
      return { todo, nt, nv, pourNote };
    }
    const checkOpts = () => ({ clr: S.clr, hv: S.hv, amps: S.amps });
    // the open connections routed as tracks (not a pour's, not the star ground)
    const routable = () => { const f = failed(S.conn.rats); return S.conn.rats.filter(r => f.has(S.model.names[r.net] || String(r.net))); };
    // what the grid finishers try: the same, and a poured net's pads its pour does not reach (an island the
    // pour cannot get to, behind other copper or the board edge) joined by a track; not the star ground
    const finishable = () => { const star = S.board.rules.ground === "star"; return S.conn.rats.filter(r => !(star && (S.model.names[r.net] || String(r.net)) === "GND")); };
    // what Freerouting left that a grid path still reaches (BoardPlace.bridge, Lee's maze routing):
    // each track stays only if it closes a connection and adds no rule message. Returns how many
    async function finish() {
      analyse();
      const tried = new Set(), key = r => [r.x1, r.y1, r.x2, r.y2].map(v => v.toFixed(3)).join(","), bad = () => S.drc.filter(d => d.kind !== "unplaced").length;
      let n = 0;
      for (let k = 0; k < 60; k++) {
        const rats = finishable().filter(r => !tried.has(key(r)));
        await breath();
        const b = rats.length && BoardPlace.bridge(S.board, S.model, S.conn, rats, checkOpts()); if (!b) break;
        const un = S.conn.unrouted, d = bad();
        S.board.tracks.push(b.track); analyse();
        if (S.conn.unrouted < un && bad() <= d) n++;
        else { S.board.tracks.pop(); analyse(); tried.add(key(rats[b.i])); }
      }
      // then the board's own grid router over what is left: round the copper there, again while that helps (a pour
      // its tracks cut leaves pads to join), then the whole board afresh
      for (let k = 0; k < 3 && finishable().length && !router.stop; k++) {
        stage("grid router"); await breath();
        const got = await grid(false); n += got; if (!got) break;
      }
      if (finishable().length && !router.stop) { stage("grid router, whole board"); await breath(); n += await grid(true); }
      // then each one left, routed exactly in a window round it with whatever copper is there (BoardPlace.exact)
      // (at most 20 of them, and 30 s in all: a board Freerouting left wide open is its job, not this)
      const done = new Set(), until = Date.now() + 30000;
      for (let k = 0; k < 20 && Date.now() < until; k++) {
        const rats = finishable().filter(r => !done.has(key(r))); if (!rats.length) break;
        done.add(key(rats[0]));
        for (const margin of [4, 8]) {
          if (router.stop) return n;
          const was = [S.board, S.board.tracks.length, S.board.vias.length], r = await offPage("exact", rats, { margin }).catch(() => null);
          if (!r || !r.sat || was[0] !== S.board || was[1] !== S.board.tracks.length || was[2] !== S.board.vias.length) continue;   // (the board changed meanwhile)
          const keep = JSON.stringify(S.board), un = S.conn.unrouted, d = bad();
          S.board.tracks = S.board.tracks.filter((_, i) => !r.cut.tracks.has(i)).concat(r.add.tracks);
          S.board.vias = S.board.vias.filter((_, i) => !r.cut.vias.has(i)).concat(r.add.vias);
          analyse();
          if (S.conn.unrouted < un && bad() <= d) { n += un - S.conn.unrouted; break; }
          S.board = JSON.parse(keep); analyse(); await breath();
        }
      }
      // last, a poured net's pad its pour still does not reach: a short track to a via down into the pour
      // (BoardPlace.stitch), the nearest that the pour then reaches and that adds no rule message
      const poured = new Set((S.board.zones || []).map(z => z.net)), sewn = new Set();
      for (let k = 0; k < 12; k++) {
        analyse();
        const rats = finishable().filter(r => poured.has(S.model.names[r.net] || String(r.net)) && !sewn.has(key(r))); if (!rats.length) break;
        sewn.add(key(rats[0])); stage("stitching vias");
        const tries = BoardPlace.stitch(S.board, S.model, S.conn, rats, { clr: S.clr }), un = S.conn.unrouted, d = bad();
        for (const t of tries) {
          if (router.stop) break;
          S.board.tracks.push(t.track); S.board.vias.push(t.via); analyse();
          if (S.conn.unrouted < un && bad() <= d) { n++; break; }
          S.board.tracks.pop(); S.board.vias.pop(); analyse();
          await breath();
        }
      }
      await tidy();
      return n;
    }
    // the board's own grid router (BoardPathfinder: negotiated congestion, rip-up and reroute) over the open
    // connections: Freerouting's copper stays where it is not in the way (fresh: every unlocked track of the
    // routed nets comes up and the board is routed afresh). New copper a new rule message points at comes off
    // again; the result stays only if it closes connections and adds no rule message. Returns how many it closed
    async function grid(fresh) {
      analyse();
      const keep = JSON.stringify(S.board), un = S.conn.unrouted, bad = () => S.drc.filter(d => d.kind !== "unplaced"), at = d => `${d.kind}|${d.msg}|${d.x.toFixed(2)},${d.y.toFixed(2)}`;
      const old = new Set(bad().map(at)), d0 = old.size;
      // a route that cuts a pour can leave pads it joined apart: the router then goes again over those
      for (let step = 0; step < 3; step++) {
        const was = [S.board, S.board.tracks.length, S.board.vias.length], r = await offPage("pathfinder", [], { fresh: fresh && !step, time: 20000 }).catch(() => null);
        if (!r || was[0] !== S.board || was[1] !== S.board.tracks.length || was[2] !== S.board.vias.length) break;
        S.board.tracks = S.board.tracks.filter((_, i) => !r.cut.tracks.has(i)).concat(r.add.tracks);
        S.board.vias = S.board.vias.filter((_, i) => !r.cut.vias.has(i)).concat(r.add.vias);
        analyse();
        const added = new Set([...r.add.tracks, ...r.add.vias]);
        for (let pass = 0; pass < 10; pass++) {
          const fresh2 = bad().filter(d => !old.has(at(d))); if (!fresh2.length) break;
          const near = (o, d) => o.pts ? o.pts.some((q, k) => k && B.segDist(o.pts[k - 1][0], o.pts[k - 1][1], q[0], q[1], d.x, d.y) <= o.w / 2 + 0.05) : Math.hypot(o.x - d.x, o.y - d.y) <= (o.pad || S.board.rules.viaPad) / 2 + 0.05;
          const go = new Set([...added].filter(o => fresh2.some(d => near(o, d)))); if (!go.size) break;
          S.board.tracks = S.board.tracks.filter(t => !go.has(t)); S.board.vias = S.board.vias.filter(v => !go.has(v)); go.forEach(o => added.delete(o));
          analyse();
        }
        if (S.conn.unrouted < un && bad().length <= d0) return un - S.conn.unrouted;
        if (r.open || !S.conn.unrouted || bad().length > d0 || router.stop) break;
      }
      S.board = JSON.parse(keep); analyse(); await breath();
      return 0;
    }
    // grid paths step along the grid: their diagonal runs pulled straight (BoardPlace.smooth), kept
    // only if nothing comes apart and no rule message is added. Returns how many tracks changed
    async function tidy() {
      analyse();
      // doubled copper first: a track laid beside its own net's track that already joins the same pads comes off
      // (BoardPlace.redundant), kept off only if nothing comes apart and no rule message is added
      const dup = BoardPlace.redundant(S.board, S.model, S.conn);
      if (dup.tracks.length) {
        const keep = JSON.stringify(S.board), un = S.conn.unrouted, d = S.drc.filter(x => x.kind !== "unplaced").length, tt = new Set(dup.tracks), vv = new Set(dup.vias);
        S.board.tracks = S.board.tracks.filter((_, i) => !tt.has(i)); S.board.vias = S.board.vias.filter((_, i) => !vv.has(i)); analyse();
        if (S.conn.unrouted > un || S.drc.filter(x => x.kind !== "unplaced").length > d) { S.board = JSON.parse(keep); analyse(); }
      }
      const was = [S.board, S.board.tracks.length], r = await offPage("smooth", null, {}).catch(() => null);
      if (!r || !r.length || was[0] !== S.board || was[1] !== S.board.tracks.length) return 0;
      const un = S.conn.unrouted, d = S.drc.filter(x => x.kind !== "unplaced").length, ok = () => S.conn.unrouted <= un && S.drc.filter(x => x.kind !== "unplaced").length <= d;
      const set = cs => { cs.forEach(c => { S.board.tracks[c.ti] = { ...S.board.tracks[c.ti], pts: c.pts }; }); analyse(); };
      const keep = S.board.tracks.map(t => t.pts);
      set(r);
      if (ok()) return r.length;
      // one of them breaks something: each on its own then, kept where it does not
      S.board.tracks.forEach((t, i) => { t.pts = keep[i]; }); analyse();
      let n = 0;
      for (const c of r) {
        const old = S.board.tracks[c.ti].pts; set([c]);
        if (ok()) n++; else { S.board.tracks[c.ti].pts = old; analyse(); }
        if (n % 8 === 0) await breath();
      }
      return n;
    }
    // the pins still shut in, in words ("" when none)
    // and what to change for routing to finish (BoardPlace.advise: rules stricter than needed, pour islands,
    // crowding, parts against the edge), kept in S.tips for the status line's tooltip
    function shutIn() {
      const all = finishable(); if (!all.length) { S.tips = []; if (renderPanels) renderPanels(); return ""; }
      const rats = routable(), s = rats.length ? BoardPlace.describeEscape(BoardPlace.escape(S.board, S.model, S.conn, rats, checkOpts())) : "";
      S.tips = BoardPlace.advise(S.board, S.model, S.conn, all, { ...checkOpts(), netlist: S.netlist });
      if (renderPanels) renderPanels();
      return (s ? `; shut in: ${s}` : "") + (S.tips.length ? `; to help: ${S.tips.join("; ")}` : "");
    }
    async function ready() {
      if (router.busy) return false;
      if (!S.model) { msg("Open the Circuit CAD first: the board needs its parts"); return false; }
      // Freerouting not answering: the board's own grid router does it all
      if (router.use && !router.up) await pollRouter();
      return true;
    }
    async function autoRoute() {
      if (router.busy && router.nudge) { router.stop = true; msg("Stopping after this pass: the best layout so far stays"); return; }
      if (!await ready()) return;
      const stale = clearStale(), staleNote = stale ? ` · ${stale} old piece${stale === 1 ? "" : "s"} of copper cleared first (left from where the parts were)` : "";
      if (!S.conn.unrouted) {
        // all routed: the tracks are tidied instead (doubled copper off, stairs pulled straight)
        const t0 = JSON.stringify(S.board.tracks) + JSON.stringify(S.board.vias), was = S.board.tracks.length;
        await tidy();
        const tidied = JSON.stringify(S.board.tracks) + JSON.stringify(S.board.vias) !== t0;
        if (stale || tidied) commit();
        msg("Nothing to route: every connection is routed" + (tidied ? `; tracks tidied (${Math.max(0, was - S.board.tracks.length)} doubled taken off, bends pulled straight)` : "") + staleNote);
        return;
      }
      router.busy = true; routerUi(); progress(0, 0, "Auto-route"); msg(`${viaFr() ? "Freerouting" : "The grid router"} is routing ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"}…`);
      try {
        const p = await routePass();
        commit();
        msg(routedNote(p.todo, p.nt, p.nv) + (S.conn.unrouted ? shutIn() + "; Route ▾ → Finish routing moves parts to make room" : "") + p.pourNote + staleNote);
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
    // (inner: Rearrange's last step; the board is routed, no spreading, no undo step or message of its own)
    async function routeNudge(inner) {
      inner = inner === true;
      if (!inner) {
        if (router.busy && router.nudge) { router.stop = true; return; }
        if (!await ready()) return;
        const off = S.drc.filter(d => d.kind === "unplaced").length;
        if (off) { msg(`${off} part${off === 1 ? " is" : "s are"} not on the board yet: place ${off === 1 ? "it" : "them"} first, then Finish routing`); return; }
      }
      const start = JSON.stringify(S.board), parts0 = JSON.parse(start).parts, stale = inner ? 0 : clearStale();
      const STEPS = 1 + ROUNDS + SPREADS.length;
      if (!inner) { router.busy = true; router.nudge = true; router.stop = false; routerUi(); progress(0, STEPS, "Finish routing"); }
      try {
        if (S.conn.unrouted) { msg(`${viaFr() ? "Freerouting" : "The grid router"} is routing ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"}…`); await routePass(); }
        const first = score();
        let best = JSON.stringify(S.board), bestScore = first, reach = 8, fails = 0, round = 0, broke = "", spreadNo = false;
        while (S.conn.unrouted && round < ROUNDS && fails < 2 && !router.stop) {
          round++; if (inner) stage(`nudge round ${round} of ${ROUNDS}`); else progress(round, STEPS, `Finish routing · round ${round}`);
          // what walls in the open connections (BoardPlace.escape, passage): those parts may move, that copper comes up
          const rats = S.conn.rats.slice(), open = routable(), walls = { parts: new Set(), tracks: new Set(), vias: new Set() };
          BoardPlace.escape(S.board, S.model, S.conn, open, checkOpts()).filter(e => !e.ok).map(e => (walls.parts.add(e.key), e.walls))
            .concat(BoardPlace.passage(S.board, S.model, S.conn, open, checkOpts()).filter(p => !p.ok).map(p => p.walls))
            .forEach(ws => ws.slice(0, 6).forEach(w => { if (w.kind === "part") walls.parts.add(w.key); if (w.kind === "track") walls.tracks.add(S.board.tracks[w.ti]); if (w.kind === "via") walls.vias.add(S.board.vias[w.vi]); }));
          const keys = BoardPlace.movable(S.board, S.model, rats, { radius: reach, also: walls.parts });
          msg(`Round ${round} of ${ROUNDS}: ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"} left; moving ${keys.length} part${keys.length === 1 ? "" : "s"} near them…`);
          await breath();
          // first the smallest shift or turn that lets a shut-in pin out (BoardPlace.access); else the annealing nudge
          const acc = ((await offPage("access", open, {}).catch(() => [])) || []).filter(m => S.board.parts[m.key]);
          if (acc.length) { acc.forEach(m => Object.assign(S.board.parts[m.key], m.to)); analyse(); msg(`Round ${round} of ${ROUNDS}: ${BoardPlace.describe(acc)} to free ${acc.map(m => m.frees).join(", ")}…`); await breath(); }
          const r = acc.length ? { moved: acc } : keys.length ? BoardPlace.nudge(S.board, S.model, keys, { clr: S.clr, hv: S.hv, netlist: S.netlist, conn: S.conn, seed: round, reach }) : { moved: [] };
          // nothing moved: still take up the copper that walls them in, once per reach, and route again
          if (!r.moved.length && !walls.tracks.size && !walls.vias.size) { reach *= 1.5; fails++; continue; }
          await breath(); analyse(); ripUp(rats, r.moved, reach, walls); await breath();
          msg(`Round ${round} of ${ROUNDS}: ${r.moved.length} part${r.moved.length === 1 ? "" : "s"} moved; ${who()} routes ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"}…`);
          // a pass that fails ends the run with the best layout so far
          try { await routePass(failed(rats)); } catch (e) { S.board = JSON.parse(best); analyse(); broke = e.message; break; }
          await breath(); const sc = score();
          if (better(sc, bestScore)) { best = JSON.stringify(S.board); bestScore = sc; fails = 0; }
          else { S.board = JSON.parse(best); analyse(); reach *= 1.5; fails++; }
          await breath();
        }
        // a last round over the whole board: the parts spread where there is room (BoardPlace.spread),
        // the shut-in ones counting bigger; every unlocked track comes up and the board is routed afresh
        // two ways: by wire length (the parts may go anywhere), and held near where they are
        for (const how of inner ? [] : SPREADS) {
          if (!bestScore.un || router.stop || broke) break;
          S.board = JSON.parse(best); analyse(); round++; progress(1 + ROUNDS + SPREADS.indexOf(how), STEPS, "Finish routing · spread over the board"); stage("spreading"); await breath();
          const r = spreadAll(how); await breath();
          if (!r.moved.length) continue;
          msg(`Round ${round}: ${r.moved.length} part${r.moved.length === 1 ? "" : "s"} spread over the board; ${who()} routes it afresh…`);
          S.board.tracks = S.board.tracks.filter(t => t.locked); S.board.vias = S.board.vias.filter(v => v.locked); analyse(); clearStale(); await breath();
          try {
            await routePass(); const sc = score();
            if (better(sc, bestScore)) { best = JSON.stringify(S.board); bestScore = sc; }
            else { spreadNo = true; msg(`Round ${round}: the spread layout left ${sc.un} open${sc.un === bestScore.un ? " with longer tracks" : ""}; the earlier layout stays`); }
          }
          catch (e) { broke = e.message; }
        }
        S.board = JSON.parse(best); S.sel = null;
        if (inner) { analyse(); return { left: bestScore.un, rounds: round, broke }; }
        const moved = Object.keys(parts0).filter(k => S.board.parts[k]).map(k => ({ key: k, ref: S.board.parts[k].ref, from: parts0[k], to: S.board.parts[k] }))
          .filter(m => Math.abs(m.from.x - m.to.x) > 1e-6 || Math.abs(m.from.y - m.to.y) > 1e-6 || ((m.from.rot || 0) & 3) !== ((m.to.rot || 0) & 3))
          .map(m => ({ ...m, from: { x: m.from.x, y: m.from.y, rot: m.from.rot || 0 }, to: { x: m.to.x, y: m.to.y, rot: m.to.rot || 0 } }));
        const left = bestScore.un, changed = JSON.stringify(S.board) !== start || stale;
        if (changed) commit(); else analyse();
        const what = moved.length ? `moved ${BoardPlace.describe(moved)}` : "no part moved", stuck = left ? shutIn() : "";
        msg((left ? `${left} connection${left === 1 ? "" : "s"} still open after ${round} round${round === 1 ? "" : "s"}` : `Everything routed${round ? ` after ${round} round${round === 1 ? "" : "s"}` : ""}`) +
          (round || moved.length ? `: ${what}` : "") + (spreadNo ? " (spreading the parts over the board did not help)" : "") + stuck + (router.stop ? " (stopped)" : "") + (broke ? ` (Freerouting failed in round ${round}: ${broke})` : "") + (changed ? "; Ctrl+Z takes it all back" : ""));
        return { left, rounds: round, moved };
      } catch (e) { S.board = JSON.parse(start); analyse(); if (inner) throw e; msg(`Finish routing failed: ${e.message}; the board is as it was`); router.up = false; pollRouter(); }
      finally { if (!inner) { router.busy = false; router.nudge = false; routerUi(); } }
    }
    // Rearrange board: an automatic layout of the whole board. Every unlocked part except the panel ones
    // (pots, switches, jacks, connectors, fuses) comes off and goes back from scratch, valves and
    // transformers too, turned as suits their wiring (BoardPlace.design: from the schematic's places,
    // spread over the board with the turns chosen as it goes, then refined by annealing). Many layouts
    // are made off the page and scored without routing (shut-in pins, ratsnest crossings, length); the
    // best few are routed by Freerouting and the grid finishers, the board as it was counting as one
    // more; the best routed one stays (fewest open connections, then rule messages, then track length),
    // and Route & nudge's rounds then work on what it left open. The board's outline, holes, keep-outs,
    // locked parts and locked copper hold throughout.
    const PANEL = new Set(["pot", "switch", "spst", "rotary", "jack", "iec", "terminal", "header", "faston", "fuse", "heater", "star"]);
    const HOWS = [{ wire: 0.3, anchor: 0.5, what: "near the schematic's places" }, { what: "for the shortest wiring" }, { wire: 0.5, anchor: 0.2, roomy: 1.4, what: "with more room round each part" },
      { roomy: 1.2, what: "short wiring, a little more room" }, { wire: 0.3, anchor: 0.5, turn: false, what: "near the schematic's places, turns kept" }];
    const SEEDS = [1, 2], TOP = 3, MORE = 3;
    async function rearrange() {
      if (router.busy && router.nudge) { router.stop = true; return; }
      if (!await ready()) return;
      const keys = S.model.parts.filter(g => g.fp && !PANEL.has(g.type) && !(S.board.parts[g.key] || {}).locked).map(g => g.key);
      if (!keys.length) { msg("Every part is locked or a panel part: nothing to rearrange"); return; }
      const start = JSON.stringify(S.board), parts0 = JSON.parse(start).parts;
      const cands = HOWS.flatMap(how => (how.turn === false ? [1] : SEEDS).map(seed => ({ how, seed }))), STEPS = 1 + cands.length + TOP + MORE + 1;
      router.busy = true; router.nudge = true; router.stop = false; routerUi();
      let step = 0;
      const next = what => progress(step++, STEPS, `Design from scratch · ${what}`);
      try {
        // the board as it is, routed, is the one to beat
        next("the board as it is");
        if (S.conn.unrouted) { msg(`Design from scratch: routing the board as it is first (${S.conn.unrouted} open)…`); clearStale(); await routePass(); }
        let best = JSON.stringify(S.board), bestScore = score(), won = "", broke = "", routed = 0;
        // many layouts, scored without routing
        const made = [];
        for (const c of cands) {
          if (router.stop) break;
          next(`layout ${made.length + 1} of ${cands.length}`); stage(c.how.what);
          msg(`Design from scratch: laying out the board ${c.how.what} (${made.length + 1} of ${cands.length})…`);
          const r = await offPage("design", [], { keys, how: c.how, seed: c.seed }).catch(e => ({ failed: e.message }));
          if (r && r.places) made.push({ ...c, ...r });
        }
        if (!made.length) { msg(`Design from scratch: no layout fitted the board (${keys.length} parts); the parts stay where they were`); return { left: bestScore.un, won: "", tried: 0, moved: 0 }; }
        made.sort((a, b) => a.score - b.score);
        // the best few, routed
        // (the best of each way first, so the routed ones differ; then the next best)
        const pick = [];
        made.forEach(c => { if (pick.length < TOP && !pick.some(q => q.how === c.how)) pick.push(c); });
        made.forEach(c => { if (pick.length < TOP && !pick.includes(c)) pick.push(c); });
        // while connections stay open, up to MORE of the next best are routed too
        const more = made.filter(c => !pick.includes(c)).slice(0, MORE);
        step = 1 + cands.length;
        for (const c of [...pick, ...more]) {
          if (router.stop) break;
          if (!pick.includes(c) && !bestScore.un) break;
          next(`routing layout ${routed + 1}${pick.includes(c) ? ` of ${pick.length}` : ", one more as connections are open"}`);
          S.board = JSON.parse(start);
          Object.entries(c.places).forEach(([k, p]) => { if (S.board.parts[k]) Object.assign(S.board.parts[k], p); });
          S.board.tracks = S.board.tracks.filter(t => t.locked); S.board.vias = S.board.vias.filter(v => v.locked);
          analyse(); clearStale(); render(); await breath();
          msg(`Design from scratch: layout ${routed + 1} of ${pick.length + (routed >= pick.length ? more.length : 0)} (${c.how.what}${c.turned ? `, ${c.turned} turn${c.turned === 1 ? "" : "s"}` : ""}); ${who()} routes ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"}…`);
          try { await routePass(); } catch (e) { broke = e.message; break; }
          routed++; await breath();
          const sc = score();
          if (sc.un < bestScore.un || (sc.un === bestScore.un && (sc.bad < bestScore.bad || (sc.bad === bestScore.bad && sc.len < bestScore.len * 0.99)))) { best = JSON.stringify(S.board); bestScore = sc; won = c.how.what; }
        }
        // what is left open: Route & nudge's rounds on the best layout
        S.board = JSON.parse(best); analyse();
        step = STEPS - 1;
        if (S.conn.unrouted && !router.stop && !broke) {
          next("nudging what is left"); msg(`Design from scratch: ${S.conn.unrouted} connection${S.conn.unrouted === 1 ? "" : "s"} open; moving the parts near them…`);
          try { const n = await routeNudge(true); if (n && n.broke) broke = n.broke; const sc = score(); if (sc.un < bestScore.un || (sc.un === bestScore.un && sc.bad < bestScore.bad)) { best = JSON.stringify(S.board); bestScore = sc; } }
          catch (e) { broke = e.message; }
        }
        S.board = JSON.parse(best); S.sel = null;
        analyse(); await tidy(); best = JSON.stringify(S.board);
        const moved = Object.keys(parts0).filter(k => S.board.parts[k] && (Math.abs(parts0[k].x - S.board.parts[k].x) > 1e-6 || Math.abs(parts0[k].y - S.board.parts[k].y) > 1e-6 || ((parts0[k].rot || 0) & 3) !== ((S.board.parts[k].rot || 0) & 3))).length;
        const changed = best !== start;
        if (changed) commit(); else analyse();
        const left = bestScore.un, stuck = left ? shutIn() : "";
        msg((won ? `Designed the board: ${moved} part${moved === 1 ? "" : "s"} placed (best of ${made.length} layouts, ${routed} routed: ${won}); ` : `Made ${made.length} layout${made.length === 1 ? "" : "s"}, routed ${routed}: none routed better, the parts stay where they were; `) +
          (left ? `${left} connection${left === 1 ? "" : "s"} open${stuck}` : "everything routed") + (router.stop ? " (stopped)" : "") + (broke ? ` (Freerouting failed: ${broke})` : "") + (changed ? "; Ctrl+Z takes it all back" : ""));
        return { left, won, tried: routed, made: made.length, moved };
      } catch (e) { S.board = JSON.parse(start); analyse(); msg(`Design from scratch failed: ${e.message}; the board is as it was`); router.up = false; pollRouter(); }
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
    // Route ▾ → Freerouting…: the site's server, or an address of your own (this computer or another on the
    // network) and how to start it
    const useServer = () => !!router.server && $("router-use-server").checked;
    const chosen = () => useServer() ? router.server : BoardRoute.address($("router-addr").value);
    function routerWhere() {
      const srv = useServer();
      $("router-own").hidden = srv; $("router-own-help").hidden = srv;
      $("router-signin").hidden = !srv; $("router-signin").href = (router.server || "") + "/v1/system/status";
      routerStatusLink();
    }
    // Status ↗: the server page for the address chosen in the dialog
    function routerStatusLink() { $("router-status").href = "freerouting.html" + VQ + (VQ ? "&" : "?") + "url=" + encodeURIComponent(chosen() || router.url); }
    function routerSetup() {
      const origin = pageOrigin(), srv = !!router.server && router.url === router.server;
      $("router-use-fr").checked = router.use;
      $("router-where").hidden = !router.server;
      $("router-use-server").checked = srv; $("router-use-own").checked = !srv;
      $("router-addr").value = srv ? "" : router.url.replace(/^http:\/\//, "");
      $("router-cmd-java").textContent = BoardRoute.command(origin); $("router-cmd-docker").textContent = BoardRoute.dockerCommand(origin);
      $("router-state").textContent = routerWhy(router.url, router);
      routerWhere();
      $("router-modal").hidden = false; (srv ? $("router-use-server") : $("router-addr")).focus();
    }
    async function routerTest() {
      const url = chosen(), st = $("router-state");
      if (!url) { st.textContent = "That is not an address: an IP or a name, and :port if not 37864"; return; }
      st.textContent = `Asking ${url === router.server ? "the site's Freerouting server" : url}…`;
      st.textContent = routerWhy(url, await BoardRoute.probe(url, 3000));
    }
    function routerSave() {
      const url = chosen();
      if (!url) { $("router-state").textContent = "That is not an address: an IP or a name, and :port if not 37864"; return; }
      router.url = url; router.up = false; router.use = $("router-use-fr").checked; $("router-modal").hidden = true;
      try { localStorage.setItem(ROUTER_KEY, router.url); localStorage.setItem(USE_KEY, router.use ? "1" : "0"); } catch (e) { /* no storage */ }
      if (!router.use) { routerUi(); msg("Auto-route uses the board's own grid router; tick Use Freerouting in Route ▾ → Freerouting… to let Freerouting route first"); return; }
      const name = url === router.server ? "the site's Freerouting server" : url;
      routerUi(); pollRouter().then(() => msg(router.up ? `Freerouting answers at ${name}` : `No Freerouting at ${name} yet: until it answers, Auto-route uses the board's own grid router (Route ▾ → Freerouting… says why)`));
    }
    function importSes(file) {
      if (!file || !S.model) return;
      file.text().then(t => { try { msg(addRoutes(t, dsnOf())); } catch (e) { msg(`Not imported: ${e.message}`); } });
    }
    return { autoRoute, clearStale, dsnOf, importSes, pollRouter, rearrange, routeNudge, router, routerSave, routerSetup, routerTest, routerUi, routerStatusLink, routerWhere, unroute };
  };
})(window);
