/**
 * Projects and revisions (server/share/revisions.mjs, access.mjs): only a valid Cloudflare Access
 * token gets in, revisions are kept and never deleted to make room, the short links give way.
 */
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runInThisContext } from "node:vm";

// a stand-in for the team's Access keys
const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const other = generateKeyPairSync("rsa", { modulusLength: 2048 });
const certs = createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ keys: [Object.assign(publicKey.export({ format: "jwk" }), { kid: "k1", alg: "RS256" })] })); });
await new Promise(r => certs.listen(0, r));
const ISS = "https://team.cloudflareaccess.com", AUD = "aud-tag";
const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
function token({ key = privateKey, kid = "k1", email = "owner@example.com", iss = ISS, aud = [AUD], exp = Date.now() / 1000 + 600 } = {}) {
  const h = b64({ alg: "RS256", kid }), p = b64({ iss, aud, email, exp, sub: "u1" });
  return h + "." + p + "." + createSign("RSA-SHA256").update(h + "." + p).sign(key).toString("base64url");
}

const dir = mkdtempSync(join(tmpdir(), "rev-"));
Object.assign(process.env, {
  DATA: join(dir, "data"), REVS: join(dir, "revs"), MAX_TOTAL: "60000", MAX_REVISIONS: "57000",
  ACCESS_CERTS: `http://127.0.0.1:${certs.address().port}/certs`, ACCESS_ISS: ISS, ACCESS_AUD: AUD, ACCESS_EMAILS: "Owner@example.com",
});
const { start } = await import("../server/share/server.mjs");
runInThisContext(readFileSync(new URL("../cad-share.js", import.meta.url), "utf8"), { filename: "cad-share.js" });
let server = await start({ port: 0, log: () => {} });
const root = () => `http://127.0.0.1:${server.address().port}`;
after(() => { server.close(); certs.close(); rmSync(dir, { recursive: true, force: true }); });

const ORIGIN = "https://aerocat.tech";
const api = (path, { method = "GET", body, tok = token(), origin = method === "GET" ? null : ORIGIN, cookie } = {}) => fetch(root() + "/api/rev" + path, {
  method, body: body === undefined ? undefined : JSON.stringify(body),
  headers: Object.assign({}, tok && !cookie ? { "cf-access-jwt-assertion": tok } : {}, cookie ? { cookie: "x=1; CF_Authorization=" + tok } : {}, origin ? { origin } : {}),
});
const example = f => JSON.parse(readFileSync(new URL(`../examples/${f}`, import.meta.url), "utf8"));

test("nobody gets in without the owner's valid Access token", async () => {
  assert.equal((await api("/me", { tok: null })).status, 401, "no token");
  assert.equal((await api("/projects", { tok: "a.b.c" })).status, 401, "garbage");
  assert.equal((await api("/me", { tok: token({ key: other.privateKey }) })).status, 401, "signed by another key");
  assert.equal((await api("/me", { tok: token({ iss: "https://evil.cloudflareaccess.com" }) })).status, 401, "another team");
  assert.equal((await api("/me", { tok: token({ aud: ["other-app"] }) })).status, 401, "another application");
  assert.equal((await api("/me", { tok: token({ exp: Date.now() / 1000 - 3600 }) })).status, 401, "expired");
  assert.equal((await api("/me", { tok: token({ email: "someone@else.com" }) })).status, 401, "not the owner");
  const me = await api("/me");
  assert.equal(me.status, 200);
  assert.equal((await me.json()).email, "owner@example.com");
  assert.equal((await api("/me", { cookie: true })).status, 200, "the CF_Authorization cookie does as well");
  assert.match(await (await api("/login")).text(), /postMessage/);
  assert.equal((await api("/projects", { method: "POST", body: { name: "x" }, origin: "https://evil.example" })).status, 403, "changes only from the site's pages");
  assert.equal((await api("/projects", { method: "POST", body: { name: "x" }, origin: null })).status, 403);
});

let pid;
test("a project keeps its revisions: saved, listed, read back, renamed, deleted one by one", async () => {
  const c = await api("/projects", { method: "POST", body: { name: "  Gubin stereo  ", notes: "the 5Ц4С one" } });
  assert.equal(c.status, 201);
  const p = await c.json(); pid = p.id;
  assert.match(pid, /^[A-Za-z0-9_-]{10}$/); assert.equal(p.name, "Gubin stereo"); assert.equal(p.count, 0);
  assert.equal((await api("/projects", { method: "POST", body: { name: "  " } })).status, 400, "a name is needed");

  const d1 = example("06-gubin-6n23p-6p14p.json"), d2 = structuredClone(d1);
  d2.comps.find(x => x.type === "resistor").params.value = 12345;
  const r1 = await api(`/projects/${pid}/revs`, { method: "POST", body: { message: "first", design: d1 } });
  assert.equal(r1.status, 201);
  const rev1 = await r1.json();
  assert.equal(rev1.n, 1); assert.equal(rev1.by, "owner@example.com"); assert.ok(rev1.size < JSON.stringify(d1).length / 3, "kept gzipped");
  const same = await api(`/projects/${pid}/revs`, { method: "POST", body: { message: "again", design: d1 } });
  assert.equal(same.status, 200, "the same design as the last revision makes no new one");
  assert.equal((await same.json()).same, true);
  const r2 = await (await api(`/projects/${pid}/revs`, { method: "POST", body: { message: "R value", summary: "R1 changed", design: d2 } })).json();
  assert.equal(r2.n, 2);
  assert.equal((await api(`/projects/${pid}/revs`, { method: "POST", body: { design: { any: 1 } } })).status, 400, "only designs");

  const got = await api(`/projects/${pid}/revs/1`);
  assert.equal(got.headers.get("cache-control"), "no-store");
  assert.deepEqual(await got.json(), d1);
  assert.deepEqual(await (await api(`/projects/${pid}/revs/2`)).json(), d2);
  const full = await (await api(`/projects/${pid}`)).json();
  assert.deepEqual(full.revs.map(r => [r.n, r.message, r.summary]), [[1, "first", ""], [2, "R value", "R1 changed"]]);
  const list = await (await api("/projects")).json();
  assert.equal(list.length, 1); assert.equal(list[0].count, 2); assert.equal(list[0].last.n, 2);

  assert.equal((await (await api(`/projects/${pid}`, { method: "PATCH", body: { name: "Gubin GUB-245" } })).json()).name, "Gubin GUB-245");
  assert.equal((await (await api(`/projects/${pid}/revs/1`, { method: "PATCH", body: { message: "first draw" } })).json()).message, "first draw");
  const ex = await api(`/projects/${pid}/export`);
  assert.match(ex.headers.get("content-disposition"), /Gubin_GUB-245-revisions\.json/);
  const bundle = await ex.json();
  assert.equal(bundle.project.revs.length, 2); assert.deepEqual(bundle.project.revs[1].design, d2);

  assert.equal((await api(`/projects/${pid}/revs/1`, { method: "DELETE" })).status, 200);
  assert.equal((await api(`/projects/${pid}/revs/1`)).status, 404);
  const r3 = await (await api(`/projects/${pid}/revs`, { method: "POST", body: { message: "back", design: d1 } })).json();
  assert.equal(r3.n, 3, "numbers are never reused");
  assert.equal((await api("/projects/AAAAAAAAAA")).status, 404);
  assert.equal((await api("/projects/../../etc")).status, 404);
});

test("revisions and links share the store: links give way, revisions are refused past their part, never deleted", async () => {
  const post = t => fetch(root() + "/api/share", { method: "POST", body: t, headers: { origin: ORIGIN } });
  const ids = [];
  for (const f of ["01-2n3904-ce-unbypassed.json", "02-2n3904-ce-bypassed.json", "03-12ax7-ccs-vs-resistor.json", "08-555-astable.json"]) {
    const r = await post(await CadShare.pack(example(f)));
    ids.push((await r.json()).id);
  }
  let me = await (await api("/me")).json();
  assert.equal(me.shares.count, 4);
  assert.ok(me.total.bytes === me.shares.bytes + me.revisions.bytes);
  const shares = await (await api("/shares")).json();
  assert.deepEqual(shares.map(s => s.id), ids.slice().reverse(), "newest first");
  assert.equal((await api(`/shares/${ids[3]}`, { method: "DELETE" })).status, 200, "the owner deletes a link by hand");
  assert.equal((await fetch(root() + "/api/share/" + ids[3])).status, 404);

  // revisions until the store is full: the oldest links go first, then the revisions' own part runs out
  const p = await (await api("/projects", { method: "POST", body: { name: "filler" } })).json();
  const base = example("07-gubin-5ts4s-stereo.json");
  let code = 0, k = 0;
  const saved = [];
  while (k < 200) {
    const d = structuredClone(base); d.comps[0].params.title = "rev " + k + " " + Math.random();
    // noise that does not compress, so the store fills in a few steps
    d.noise = Array.from({ length: 300 }, () => Math.random().toString(36).slice(2)).join("");
    const r = await api(`/projects/${p.id}/revs`, { method: "POST", body: { design: d } });
    code = r.status; if (code !== 201) break;
    saved.push((await r.json()).n); k++;
  }
  assert.equal(code, 507, "past their part, revisions are refused");
  me = await (await api("/me")).json();
  assert.ok(me.revisions.bytes <= 57000 && me.total.bytes <= 60000, `within the budget (${me.revisions.bytes}, ${me.total.bytes})`);
  assert.ok(me.shares.count < 3, `links gave way (${me.shares.count} left)`);
  const all = await (await api(`/projects/${p.id}`)).json();
  assert.deepEqual(all.revs.map(r => r.n), saved, "every revision saved is still there");

  // a link now has only what the revisions leave
  const r = await post(await CadShare.pack(example("12-555-simplest-oscillator.json")));
  assert.ok(r.status === 201 || r.status === 507);
  me = await (await api("/me")).json();
  assert.ok(me.total.bytes <= 60000);

  // a fresh start reads the projects from disk
  server.close();
  server = await start({ port: 0, log: () => {} });
  const again = await (await api("/me")).json();
  assert.equal(again.revisions.bytes, me.revisions.bytes);
  assert.equal((await (await api("/projects")).json()).length, 2);
  assert.equal((await api(`/projects/${p.id}`, { method: "DELETE" })).status, 200, "the owner deletes a whole project");
  const left = (await (await api("/projects")).json());
  assert.deepEqual(left.map(x => x.id), [pid]);
  assert.equal((await (await api("/me")).json()).revisions.bytes, left[0].bytes, "its room is given back");
});
