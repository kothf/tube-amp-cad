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
  const items = () => cad.evaluate(() => [...document.querySelectorAll("#rev-list .rev-item")].map(e => ({ n: +e.dataset.n, cur: e.classList.contains("cur"), on: e.classList.contains("on"), text: e.textContent.replace(/\s+/g, " ").trim() })));
  await cad.waitForFunction(() => document.querySelectorAll("#rev-list .rev-item").length === 1);
  check((await items())[0].cur, "Save revision keeps r1, marked as what the sheet is now");
  check(await cad.evaluate(() => /^r1$/.test(document.getElementById("rev-at").textContent) && !document.getElementById("rev-at").hidden), "the toolbar's chip says the sheet is r1");
  await cad.waitForFunction(() => { const i = document.querySelector("#rev-preview img"); return i && i.complete && i.naturalWidth > 100; });
  check(true, "the preview shows the revision's picture (the first sheet, kept with it)");

  // a value changes: the chip gets its •, the dialog says what changed since r1, and r2 keeps that as its summary
  const r = await cad.evaluate(() => { const c = TubeCAD.state.comps.find(x => x.type === "resistor"); const was = c.params.r; c.params.r = 3300; TubeCAD.commit(); return { label: c.label, was }; });
  await cad.click("#rev-close");
  await cad.waitForFunction(() => /r1 •/.test(document.getElementById("rev-at").textContent));
  check(true, "after an edit the chip shows r1 • (changed since)");
  await cad.keyboard.press("Control+Alt+KeyS");
  await cad.waitForFunction(([l, w]) => new RegExp("Changes since r1: " + l + ": r " + w + " → 3.3k").test(document.getElementById("rev-changes").textContent) && document.activeElement.id === "rev-message", [r.label, r.was]);
  check(true, `Ctrl+Alt+S opens the dialog ready for the message, saying what changed since r1 (${r.label}: r ${r.was} → 3.3k)`);
  await cad.keyboard.type("R to 3.3 k");
  await cad.keyboard.press("Enter");
  await cad.waitForFunction(() => document.querySelectorAll("#rev-list .rev-item").length === 2);
  const row2 = (await items()).find(x => x.n === 2);
  check(/R to 3\.3 k/.test(row2.text) && new RegExp(r.label + ": r ").test(row2.text) && row2.cur && row2.on, `r2 keeps its message and what changed, and is picked (${row2.text})`);
  await $("rev-message").press("Enter");
  await cad.waitForFunction(() => /same as r2/.test(document.getElementById("rev-info").textContent));
  check((await items()).length === 2, "saving the same design again makes no new revision");

  // a milestone
  await cad.click("#rev-preview button[data-act=star]");
  await $("rev-star-name").fill("Sent to fab");
  await $("rev-star-name").press("Enter");
  await cad.waitForFunction(() => /★ Sent to fab/.test(document.getElementById("rev-list").textContent));
  await cad.click("#rev-stars");
  check((await items()).map(x => x.n).join() === "2", "a revision starred as a milestone stands out, and ★ Milestones shows only those");
  await cad.click("#rev-stars");

  // Compare on the sheet: r1 against the sheet marks the resistor, and Done (or Esc) leaves it
  await cad.click("#rev-list .rev-item[data-n='1']");
  await cad.click("#rev-preview button[data-act=compare]");
  await cad.waitForFunction(() => !document.getElementById("rev-diff-bar").hidden && TubeCAD.state.revDiff);
  const dd = await cad.evaluate(() => ({ bar: document.getElementById("rev-diff-bar").textContent.replace(/\s+/g, " "), marks: TubeCAD.state.revDiff.marks.map(m => m.kind + " " + m.comp.label), modal: document.getElementById("rev-modal").hidden }));
  check(dd.modal && dd.marks.join() === "changed " + r.label && /1 changed/.test(dd.bar) && /1 \/ 1/.test(dd.bar), `Compare marks on the sheet what changed since r1 (${dd.marks.join()}; ${dd.bar.trim()})`);
  const gone = await cad.evaluate(() => { const S = TubeCAD.state, c = S.comps.find(x => x.type === "capacitor"); S.comps = S.comps.filter(x => x !== c); TubeCAD.commit(); return c.label; });
  await cad.waitForFunction(g => TubeCAD.state.revDiff && TubeCAD.state.revDiff.marks.some(m => m.kind === "removed" && m.comp.label === g), gone);
  check(/removed/.test(await $("rev-diff-bar").textContent()), `it follows the edits: a part deleted now is drawn faintly where it was (${gone})`);
  await cad.keyboard.press("Escape");
  await cad.waitForFunction(() => !TubeCAD.state.revDiff && document.getElementById("rev-diff-bar").hidden);
  check(true, "Esc leaves Compare");
  await cad.evaluate(() => TubeCAD.undo());

  await cad.click("#btn-file"); await cad.click("#btn-revisions");
  await cad.waitForFunction(() => document.querySelectorAll("#rev-list .rev-item").length === 2);
  await cad.click("#rev-list .rev-item[data-n='1']");
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.click("#rev-preview button[data-act=open]");
  await cad.waitForFunction(was => TubeCAD.state.comps.find(x => x.type === "resistor").params.r === was && document.getElementById("rev-modal").hidden, r.was);
  check(/^r1$/.test(await $("rev-at").textContent()), "Open puts r1 back on the sheet, and the chip says r1");
  // a change from r1, saved: r3 is made from r1
  await cad.evaluate(() => { const c = TubeCAD.state.comps.find(x => x.type === "resistor"); c.params.r = 4700; TubeCAD.commit(); });
  await cad.keyboard.press("Control+Alt+KeyS");
  await cad.waitForFunction(() => /Changes since r1/.test(document.getElementById("rev-changes").textContent));
  await $("rev-message").fill("another way"); await $("rev-message").press("Enter");
  await cad.waitForFunction(() => document.querySelectorAll("#rev-list .rev-item").length === 3);
  check(/from r1/.test(await $("rev-preview").textContent()) && /from r1:/.test((await items())[0].text), "a revision saved after opening an older one says which it came from (r3 from r1)");
  await cad.click("#rev-close");

  // the manager page: space, projects with their revisions, the short links
  await fetch(`http://127.0.0.1:${store.address().port}/api/share`, { method: "POST", body: (await cad.evaluate(() => TubeCAD.shareLink())).long.split("#c=")[1] });
  const m = await open("projects", "projects.html");
  await m.waitForFunction(() => !document.getElementById("projects-card").hidden && document.querySelectorAll("#links tr[data-s]").length === 1);
  check(/Gubin stereo/.test(await m.locator("#projects").textContent()) && /of 100\.0 MB/.test(await m.locator("#m-total").textContent()), "the manager lists the project and the space taken of 100 MB, and the short link");
  await m.click("tr.proj td.name");
  await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 3);
  check(await m.evaluate(() => document.querySelectorAll("tr.revs td.pic img").length === 3 && /★ Sent to fab/.test(document.querySelector("tr.revs tr[data-n='2']").textContent)), "each revision shows its picture, and the milestone");
  const href = await m.locator("tr.revs tr[data-n='2'] a").getAttribute("href");
  check(/^circuit_sandbox\.html#rev=[A-Za-z0-9_-]{10}\.2$/.test(href), `each revision opens in the CAD (${href})`);
  await m.click("tr.revs tr[data-n='1'] button[data-act=del-rev]");
  await m.waitForFunction(() => !document.getElementById("ask").hidden);
  check(/cannot be undone/.test(await m.locator("#ask").textContent()), "deleting asks first, in the page's own dialog");
  await m.click("#ask-ok");
  await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 2);
  check(true, "the manager deletes a revision");
  await m.click("tr.revs tr[data-n='3'] button[data-act=message]");
  await m.locator("#ask-fields input").fill("Built");
  await m.click("#ask-ok");
  await m.waitForFunction(() => /★ Built/.test(document.querySelector("tr.revs tr[data-n='3']").textContent));
  check(true, "and sets a revision's milestone");
  await m.click("#links button[data-act=del-link]");
  await m.click("#ask-ok");
  await m.waitForFunction(() => document.querySelectorAll("#links tr[data-s]").length === 0);
  check(true, "and deletes a short link");

  // #rev=<project>.<n>: the CAD opens that revision
  const c2 = await open("cad-rev", href);
  c2.on("dialog", d => d.accept().catch(() => {}));
  await c2.waitForFunction(() => window.TubeCAD && !location.hash && (TubeCAD.state.comps.find(x => x.type === "resistor") || {}).params?.r === 3300, null, { timeout: 30000 });
  check(true, "a #rev= address opens that revision in the CAD");
  await c2.close(); await m.close();
  await ctx.unroute(/\/api\/rev\//);
  store.close(); certs.close(); rmSync(dir, { recursive: true, force: true });
}
