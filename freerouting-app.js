/* The Freerouting server page (freerouting.html): what the Freerouting the Board window routes with
   says about itself, in words. The address: ?url=… (the Freerouting dialog passes it), else the one the
   Board window saved, else the site's own server, else this computer. Status every 5 s, the routes
   this browser sent every 30 s. */
(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const esc = s => String(s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const BR = window.BoardRoute;
  const VERSION = (() => { const sc = [...document.scripts].find(x => /freerouting-app\.js/.test(x.src)); return (sc && new URL(sc.src).searchParams.get("v")) || "dev"; })();
  let saved = null; try { saved = localStorage.getItem("tubecad_router_url"); } catch (e) { /* no storage */ }
  const asked = new URLSearchParams(location.search).get("url");
  const url = BR.address(asked || saved || BR.serverUrl() || "") || BR.DEFAULT_URL;
  const isServer = url === BR.serverUrl();
  const name = isServer ? "This site's Freerouting server" : `Freerouting at ${url}`;
  const cpu = [], seen = { n: null, last: NaN, kept: null, at: null };

  const num = (v, d) => typeof v === "number" && isFinite(v) ? v.toFixed(d) : "–";
  const mb = v => typeof v !== "number" ? "–" : v >= 1024 ? `${(v / 1024).toFixed(v >= 10240 ? 0 : 1)} GB` : `${Math.round(v)} MB`;
  function ago(t) {
    const ms = Date.now() - t; if (!isFinite(ms) || ms < 0) return "";
    const m = Math.round(ms / 60000);
    return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
  }
  const when = v => { const t = typeof v === "number" ? (v < 1e12 ? v * 1000 : v) : Date.parse(v); return isFinite(t) ? t : NaN; };
  const stamp = t => isFinite(t) ? new Date(t).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" }) : "–";
  const kv = rows => rows.filter(r => r && r[1] != null && r[1] !== "").map(([k, v]) => `<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`).join("");

  $("addr").textContent = isServer ? url.replace(/^https?:\/\//, "") : url;
  $("limits-card").hidden = !isServer; $("lim-time").textContent = BR.PROXY_TIMEOUT;
  $("signin").href = url + "/v1/system/status";
  document.title = `${isServer ? "Freerouting Server" : "Freerouting"} — Tube Amp CAD`;

  function pill(text, cls) { const p = $("pill"); p.textContent = text; p.className = "status " + cls; }
  function spark() {
    const n = cpu.length; $("cpu-spark").hidden = n < 2; if (n < 2) return;
    const top = Math.max(10, ...cpu);
    $("cpu-spark").firstElementChild.setAttribute("d", cpu.map((v, i) => `${i ? "L" : "M"}${(i / (n - 1) * 100).toFixed(1)} ${(32 - v / top * 30).toFixed(1)}`).join(" "));
  }

  async function status() {
    const p = await BR.probe(url, 4000);
    $("signin").hidden = p.why !== "signin";
    if (!p.ok) {
      const why = p.why === "signin" ? `${name} wants you to sign in first (once per browser): press Sign in ↗, then Refresh.`
        : p.why === "cors" ? `${name} runs but does not let this page in: start it with --api_server.cors_origins=${location.origin}.`
        : p.why === "status" ? `Something answers at ${url} (${p.code}), but not Freerouting's API.`
        : `${name} does not answer. It may be stopped, or this browser cannot reach that address.`;
      pill(p.why === "signin" ? "Sign in" : "Not answering", p.why === "signin" ? "idle" : "bad");
      $("say").textContent = why; $("say").className = p.why === "signin" ? "" : "bad";
      return false;
    }
    const s = await BR.get(url, "/v1/system/status", 4000, VERSION);
    if (!s) return false;
    const load = typeof s.cpu_load === "number" ? s.cpu_load : NaN;
    if (isFinite(load)) { cpu.push(load); if (cpu.length > 120) cpu.shift(); }
    const busy = load > 20;
    pill(busy ? "Up · busy" : "Up · idle", busy ? "busy" : "ok");
    $("say").className = "";
    $("say").textContent = `${name} is up and ${busy ? "working: a board is probably being routed right now" : "idle: ready to route"}.`;
    $("cpu").textContent = `${num(load, load < 10 ? 1 : 0)} %`; $("cpu-bar").style.width = `${Math.min(100, Math.max(0, load || 0))}%`; spark();
    const used = s.ram_used, heap = (s.ram_used || 0) + (s.ram_available || 0);
    $("ram").textContent = `${mb(used)} of ${mb(heap)}`; $("ram-bar").style.width = heap ? `${Math.min(100, used / heap * 100)}%` : "0";
    $("disk").textContent = mb(s.storage_available);
    seen.kept = s.session_count; seen.at = new Date(); routing();
    return true;
  }

  async function environment() {
    const e = await BR.get(url, "/v1/system/environment", 5000, VERSION); if (!e) return;
    const started = when(e.app_started_at || e.started_at);
    const pick = (...ks) => { for (const k of ks) if (e[k] != null && typeof e[k] !== "object") return String(e[k]); return null; };
    $("env").innerHTML = kv([
      ["Address", url],
      ["Freerouting", pick("freerouting_version", "version")],
      ["Running since", isFinite(started) ? `${stamp(started)} (${ago(started).replace(" ago", "")})` : null],
      ["Java", pick("java", "java_version")],
      ["System", [pick("host", "os"), pick("architecture", "arch")].filter(Boolean).join(", ") || null],
      ["Processors", pick("cpu_cores", "processors")],
      ["Memory cap", typeof e.ram === "number" ? mb(e.ram) : null]
    ]);
  }

  function routing() {
    $("routing").innerHTML = kv([
      ["From this browser", seen.n == null ? "–" : `${seen.n} route${seen.n === 1 ? "" : "s"}`],
      ["Last route", isFinite(seen.last) ? `${stamp(seen.last)} (${ago(seen.last)})` : seen.n === 0 ? "none yet" : "–"],
      ["Sessions kept", seen.kept],
      ["Checked", seen.at && seen.at.toLocaleTimeString()]]);
  }
  // the routes this browser sent (Freerouting keeps them by the profile the Board window sends)
  async function jobs() {
    const ls = await BR.get(url, "/v1/sessions/list", 8000, VERSION);
    const sessions = Array.isArray(ls) ? ls : ls && Array.isArray(ls.sessions) ? ls.sessions : null;
    if (!sessions) { $("jobs").textContent = "The server does not list the routes this browser sent (it may be older than Freerouting 2.5)."; return; }
    const ids = sessions.map(x => typeof x === "string" ? x : x && (x.id || x.session_id)).filter(Boolean).slice(-15);
    const all = (await Promise.all(ids.map(id => BR.get(url, `/v1/jobs/list/${encodeURIComponent(id)}`, 8000, VERSION)))).flatMap(j => Array.isArray(j) ? j : j && Array.isArray(j.jobs) ? j.jobs : []);
    seen.n = all.length; seen.last = Math.max(...all.map(j => when(j.created_at) || when(j.started_at)).filter(isFinite)); routing();
    if (!all.length) { $("jobs").textContent = "No routes from this browser yet. Auto-route in the Board window sends one."; return; }
    const rows = all.map(j => {
      const t0 = when(j.started_at || j.created_at), t1 = when(j.finished_at), file = j.input && (j.input.filename || j.input.name);
      const secs = isFinite(t0) && isFinite(t1) ? (t1 - t0) / 1000 : j.duration_seconds;
      const left = j.statistics && (j.statistics.connections && j.statistics.connections.incomplete_count);
      return { t: when(j.created_at) || t0, name: j.name || file || "board", state: String(j.state || "–").toUpperCase(), secs, left };
    }).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 12);
    $("jobs").className = "";
    $("jobs").innerHTML = `<table><tr><th>Sent</th><th>Board</th><th>State</th><th>Took</th><th>Left open</th></tr>${rows.map(r =>
      `<tr><td>${esc(stamp(r.t))}</td><td>${esc(r.name)}</td><td class="st-${esc(r.state)}">${esc(r.state.toLowerCase())}</td><td>${typeof r.secs === "number" ? `${r.secs.toFixed(1)} s` : "–"}</td><td>${r.left != null ? esc(r.left) : "–"}</td></tr>`).join("")}</table>`;
  }

  let first = true, tick = 0;
  async function round(force) {
    const up = await status();
    if (up && (first || force)) { first = false; environment(); }
    if (up && (force || tick % 6 === 0)) jobs();
    tick++;
  }
  $("refresh").onclick = () => round(true);
  round(true); setInterval(() => { if (!document.hidden) round(false); }, 5000);
  window.FreeroutingStatus = { url, isServer, round };
})();
