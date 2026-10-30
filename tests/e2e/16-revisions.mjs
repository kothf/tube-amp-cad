// Revisions: File → Revisions… keeps the design as numbered revisions of a project on the site's
// store (server/share, here the real one with a stand-in for Cloudflare Access), and the project
// manager (projects.html) shows and changes what is stored
import { createServer } from "node:http";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { U, cad, check, ctx, open } from "./harness.mjs";

{
  // the store, its Access keys, and a token for the owner
  const { publicKey, privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const certs = createServer((req, res) => { res.writeHead(200, { "content-type": "application/json" }); res.end(JSON.stringify({ keys: [Object.assign(publicKey.export({ format: "jwk" }), { kid: "k", alg: "RS256" })] })); });
  await new Promise(r => certs.listen(0, r));
  const dir = mkdtempSync(join(tmpdir(), "rev-e2e-")), origin = new URL(U("")).origin;
  Object.assign(process.env, { DATA: join(dir, "data"), REVS: join(dir, "revs"), ORIGINS: origin, ACCESS_CERTS: `http://127.0.0.1:${certs.address().port}/`, ACCESS_ISS: "https://t.cloudflareaccess.com" });
  const { start } = await import("../../server/share/server.mjs");
  const store = await start({ port: 0, log: () => {} });
  const b64 = o => Buffer.from(JSON.stringify(o)).toString("base64url");
  const h = b64({ alg: "RS256", kid: "k" }), p = b64({ iss: "https://t.cloudflareaccess.com", email: "owner@example.com", exp: Date.now() / 1000 + 3600 });
  const token = h + "." + p + "." + createSign("RSA-SHA256").update(h + "." + p).sign(privateKey).toString("base64url");
  // Cloudflare Access, played: before the login nothing gets the token; the login page gives it
  let signedIn = false;
  await ctx.route(/\/api\/rev\//, async route => {
    const req = route.request(), u = new URL(req.url());
    if (u.pathname === "/api/rev/login") signedIn = true;
    const headers = Object.assign({}, req.headers(), signedIn ? { "cf-access-jwt-assertion": token } : {});
    const r = await route.fetch({ url: `http://127.0.0.1:${store.address().port}${u.pathname}${u.search}`, headers });
    return route.fulfill({ response: r });
  });

  await cad.bringToFront();
  const $ = id => cad.locator("#" + id);
  const shown = id => cad.evaluate(i => !document.getElementById(i).hidden, id);
  await cad.click("#btn-file"); await cad.click("#btn-revisions");
  await cad.waitForFunction(() => !document.getElementById("rev-signin").hidden);
  check(!(await shown("rev-main")), "File → Revisions… before the login asks to sign in, and shows nothing");

  const popup = ctx.waitForEvent("page");
  await cad.click("#rev-signin-btn");
  await (await popup).waitForEvent("close", { timeout: 10000 }).catch(() => {});
  await cad.waitForFunction(() => !document.getElementById("rev-main").hidden, null, { timeout: 10000 });
  check(/owner@example\.com/.test(await $("rev-who").textContent()), "after the login (its window closes by itself) the dialog shows who is signed in");
  check(await shown("rev-new-row") && (await $("rev-new-name").inputValue()).length > 0, "with no projects yet it offers a new one, named after the sheet's title");

  await $("rev-new-name").fill("Gubin stereo");
  await cad.click("#rev-new-ok");
  await cad.waitForFunction(() => /Gubin stereo/.test(document.getElementById("rev-project").textContent) && /first revision/.test(document.getElementById("rev-changes").textContent));
  await $("rev-message").fill("as published");
  await cad.click("#rev-save");
  await cad.waitForFunction(() => document.querySelectorAll("#rev-list tr[data-n]").length === 1);
  check(await cad.evaluate(() => document.querySelector("#rev-list tr[data-n='1']").classList.contains("cur")), "Save revision keeps r1, marked as what the sheet is now");

  // a value changes: the dialog says what changed since r1, and r2 keeps that as its summary
  const r = await cad.evaluate(() => { const c = TubeCAD.state.comps.find(x => x.type === "resistor"); const was = c.params.r; c.params.r = 3300; TubeCAD.commit(); return { label: c.label, was }; });
  await cad.click("#rev-close"); await cad.click("#btn-file"); await cad.click("#btn-revisions");
  await cad.waitForFunction(([l, w]) => new RegExp("Changes since r1: " + l + ": r " + w + " → 3.3k").test(document.getElementById("rev-changes").textContent), [r.label, r.was]);
  check(true, `the dialog says what changed since the last revision (${r.label}: r ${r.was} → 3.3k)`);
  await $("rev-message").fill("R to 3.3 k");
  await $("rev-message").press("Enter");
  await cad.waitForFunction(() => document.querySelectorAll("#rev-list tr[data-n]").length === 2);
  const row2 = await cad.locator("#rev-list tr[data-n='2']").textContent();
  check(/R to 3\.3 k/.test(row2) && new RegExp(r.label + ": r ").test(row2), `r2 keeps its message and what changed (${row2.replace(/\s+/g, " ").trim()})`);
  await $("rev-message").press("Enter");
  await cad.waitForFunction(() => /same as r2/.test(document.getElementById("rev-info").textContent));
  check(await cad.evaluate(() => document.querySelectorAll("#rev-list tr[data-n]").length === 2), "saving the same design again makes no new revision");

  await cad.click("#rev-list tr[data-n='1'] button[data-act=compare]");
  await cad.waitForFunction(() => /From r1 to the sheet/.test(document.getElementById("rev-compare").textContent));
  check(true, "Compare says what differs between a revision and the sheet");
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.click("#rev-list tr[data-n='1'] button[data-act=open]");
  await cad.waitForFunction(was => TubeCAD.state.comps.find(x => x.type === "resistor").params.r === was && document.getElementById("rev-modal").hidden, r.was);
  check(true, "Open puts r1 back on the sheet");

  // the manager page: space, projects with their revisions, the short links
  await fetch(`http://127.0.0.1:${store.address().port}/api/share`, { method: "POST", body: (await cad.evaluate(() => TubeCAD.shareLink())).long.split("#c=")[1] });
  const m = await open("projects", "projects.html");
  await m.waitForFunction(() => !document.getElementById("projects-card").hidden && document.querySelectorAll("#links tr[data-s]").length === 1);
  check(/Gubin stereo/.test(await m.locator("#projects").textContent()) && /of 100\.0 MB/.test(await m.locator("#m-total").textContent()), "the manager lists the project and the space taken of 100 MB, and the short link");
  await m.click("tr.proj td.name");
  await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 2);
  const href = await m.locator("tr.revs tr[data-n='2'] a").getAttribute("href");
  check(/^circuit_sandbox\.html#rev=[A-Za-z0-9_-]{10}\.2$/.test(href), `each revision opens in the CAD (${href})`);
  m.once("dialog", d => d.accept().catch(() => {}));
  await m.click("tr.revs tr[data-n='1'] button[data-act=del-rev]");
  await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 1);
  check(true, "the manager deletes a revision, after asking");
  m.once("dialog", d => d.accept().catch(() => {}));
  await m.click("#links button[data-act=del-link]");
  await m.waitForFunction(() => document.querySelectorAll("#links tr[data-s]").length === 0);
  check(true, "and a short link");

  // #rev=<project>.<n>: the CAD opens that revision
  const c2 = await open("cad-rev", href);
  c2.on("dialog", d => d.accept().catch(() => {}));
  await c2.waitForFunction(() => window.TubeCAD && !location.hash && (TubeCAD.state.comps.find(x => x.type === "resistor") || {}).params?.r === 3300, null, { timeout: 30000 });
  check(true, "a #rev= address opens that revision in the CAD");
  await c2.close(); await m.close();
  await ctx.unroute(/\/api\/rev\//);
  store.close(); certs.close(); rmSync(dir, { recursive: true, force: true });
}
