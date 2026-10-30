/* Who is asking: the Cloudflare Access login in front of /api/rev/ signs every request it lets
   through with a JWT (header Cf-Access-Jwt-Assertion, also the CF_Authorization cookie). This
   checks that token itself, so the private part stays shut even if the Access rule in front of it
   were taken off: RS256 signed by one of the team's keys, issued by the team, not expired, and
   (when set) for this application (ACCESS_AUD) and one of these e-mails (ACCESS_EMAILS).
   Without ACCESS_TEAM (or ACCESS_CERTS) nobody gets in. No packages: Node's own crypto. */
import { createPublicKey, createVerify } from "node:crypto";

const list = s => String(s || "").split(",").map(x => x.trim()).filter(Boolean);

export function accessCheck(env = process.env, { fetchImpl = fetch, now = () => Date.now() } = {}) {
  const team = String(env.ACCESS_TEAM || "").replace(/^https?:\/\//, "").replace(/\.cloudflareaccess\.com.*$/, "");
  const iss = env.ACCESS_ISS || (team ? `https://${team}.cloudflareaccess.com` : "");
  const certs = env.ACCESS_CERTS || (iss ? iss + "/cdn-cgi/access/certs" : "");
  const auds = list(env.ACCESS_AUD), emails = list(env.ACCESS_EMAILS).map(e => e.toLowerCase());
  let keys = new Map(), fetched = 0;
  async function load(force) {
    if (!force && keys.size && now() - fetched < 3600e3) return;
    if (force && now() - fetched < 10e3) return;            // an unknown kid: ask again, but not on every request
    fetched = now();
    const r = await fetchImpl(certs);
    if (!r.ok) throw new Error(`the Access keys answered ${r.status}`);
    const next = new Map();
    for (const k of (await r.json()).keys || []) if (k.kid && k.kty === "RSA") next.set(k.kid, createPublicKey({ key: k, format: "jwk" }));
    keys = next;
  }
  const part = s => JSON.parse(Buffer.from(s, "base64url").toString("utf8"));
  // the request's token, or null
  function tokenOf(req) {
    const h = req.headers["cf-access-jwt-assertion"];
    if (h) return String(h);
    const m = String(req.headers.cookie || "").match(/(?:^|;\s*)CF_Authorization=([^;]+)/);
    return m ? m[1] : null;
  }
  // → { email } of whoever is signed in, or throws why not
  async function who(req) {
    if (!certs) throw new Error("the server has no Access team set (ACCESS_TEAM)");
    const t = tokenOf(req);
    if (!t) throw new Error("not signed in");
    const [h64, p64, s64] = t.split(".");
    if (!s64) throw new Error("not a token");
    let head, pay;
    try { head = part(h64); pay = part(p64); } catch { throw new Error("not a token"); }
    if (head.alg !== "RS256") throw new Error("wrong algorithm");
    await load(false);
    if (!keys.has(head.kid)) await load(true);
    const key = keys.get(head.kid);
    if (!key) throw new Error("signed by an unknown key");
    const ok = createVerify("RSA-SHA256").update(h64 + "." + p64).verify(key, Buffer.from(s64, "base64url"));
    if (!ok) throw new Error("bad signature");
    const sec = now() / 1000;
    if (iss && pay.iss !== iss) throw new Error("issued by someone else");
    if (typeof pay.exp !== "number" || pay.exp < sec - 30) throw new Error("expired");
    if (typeof pay.nbf === "number" && pay.nbf > sec + 30) throw new Error("not valid yet");
    if (auds.length && !(Array.isArray(pay.aud) ? pay.aud : [pay.aud]).some(a => auds.includes(a))) throw new Error("for another application");
    const email = String(pay.email || "").toLowerCase();
    if (emails.length && !emails.includes(email)) throw new Error("not allowed");
    return { email: email || String(pay.sub || "") };
  }
  return { who, configured: !!certs };
}
