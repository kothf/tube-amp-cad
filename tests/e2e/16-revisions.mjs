// Revisions: File → Revisions… keeps the design as numbered revisions of a project on the site's
// store (server/share, here the real one with a stand-in for Cloudflare Access), and the project
// manager (projects.html) shows and changes what is stored
import { createServer } from "node:http";
import { createSign, generateKeyPairSync } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
  check(await cad.evaluate(() => document.querySelectorAll("#rev-list .rev-tree path.br").length === 1 && document.querySelectorAll("#rev-list .rev-tree circle").length === 3), "the history graph branches r3 off r1");
  // Restore as new: r2 becomes the newest again as r4, the sheet stays as it is
  await cad.click("#rev-list .rev-item[data-n='2']");
  await cad.click("#rev-preview button[data-act=restore]");
  await cad.waitForFunction(() => document.querySelectorAll("#rev-list .rev-item").length === 4);
  const r4 = (await items())[0];
  check(r4.n === 4 && /Restored r2/.test(r4.text) && /from r2|restored r2/.test(r4.text) && /^r3/.test(await $("rev-at").textContent()), `Restore as r4 saves r2 again as the newest, the sheet untouched (${r4.text})`);
  // Compare with…: two revisions side by side, every change between them, no sheet touched
  await cad.click("#rev-list .rev-item[data-n='3']");
  await cad.selectOption("#rev-pair", "2");
  await cad.waitForFunction(() => /r2 → r3/.test(document.querySelector(".rev-pair-head").textContent) && /changed/i.test(document.getElementById("rev-pair-list").textContent));
  check(new RegExp(r.label + ".*3\\.3k → 4\\.7k").test(await $("rev-pair-list").textContent()), `Compare with… lists what changed between r2 and r3 (${(await $("rev-pair-list").textContent()).trim()})`);
  await cad.click("#rev-preview button[data-act=pair-off]");
  await cad.click("#rev-close");
  // connections, not wire drawings: a part moved with its wires is no change of connections
  const moved = await cad.evaluate(() => {
    const T = TubeCAD, a = JSON.parse(T.circuitJSON()), b = structuredClone(a);
    const c = b.comps.find(x => x.type === "resistor");
    const pins = T.compPins(a.comps.find(x => x.id === c.id)).map(p => p.x + "," + p.y);
    c.x += 20;
    b.wires.forEach(w => { if (pins.includes(w.x1 + "," + w.y1)) w.x1 += 20; if (pins.includes(w.x2 + "," + w.y2)) w.x2 += 20; });
    const d = CadRevisions.diff(a, b, { netsOf: T.netsOf });
    // and a wire end taken off a pin is a rewiring
    const e = structuredClone(a), w = e.wires.find(x => pins.includes(x.x1 + "," + x.y1)); w.x1 += 5; w.x2 += 5;
    const f = CadRevisions.diff(a, e, { netsOf: T.netsOf });
    return { text: d.text, redrawn: d.wires.redrawn, rewired: f.changed.filter(x => x.rewired).map(x => x.part + ": " + x.what.join("; ")).join(" | ") };
  });
  check(moved.redrawn && /moved 1 part · wires redrawn, same connections/.test(moved.text), `a part moved with its wires: "${moved.text}"`);
  check(/pin .*off/.test(moved.rewired), `a wire taken off a pin shows as rewired (${moved.rewired})`);
  // the title block's Rev. auto, and a saved file that remembers its revision
  const rl = await cad.evaluate(() => {
    const f = TubeCAD.frames()[0]; f.params.rev = "auto"; TubeCAD.commit();
    const j = JSON.parse(TubeCAD.circuitJSON());
    return { label: window.CadRevLabel, link: j.revLink, text: JSON.stringify(j) };
  });
  check(/^r3\+?$/.test(rl.label) && rl.link && rl.link.n === 3, `Rev. "auto" shows ${rl.label}, and a saved file keeps its project and revision (r${rl.link && rl.link.n})`);
  await cad.evaluate(() => TubeCAD.revisions().detach());
  await cad.waitForFunction(() => document.getElementById("rev-at").hidden);
  await cad.evaluate(t => TubeCAD.openText(t, "saved.json"), rl.text);
  await cad.waitForFunction(() => /^r3/.test(document.getElementById("rev-at").textContent) && !document.getElementById("rev-at").hidden);
  check(true, "opening that file again brings its revision back (the r3 chip)");

  // Performance: a revision saved after a simulation keeps its results, shown against the one before
  await cad.evaluate(() => { const c = TubeCAD.state.comps.find(x => x.type === "resistor"); c.params.r = 5600; TubeCAD.commit(); TubeCAD.runSim(); });
  await cad.waitForFunction(() => TubeCAD.perfMetrics(), null, { timeout: 20000 });
  await cad.keyboard.press("Control+Alt+KeyS");
  await cad.waitForFunction(() => document.activeElement.id === "rev-message");
  await cad.keyboard.type("with results"); await cad.keyboard.press("Enter");
  await cad.waitForFunction(() => document.querySelectorAll("#rev-list .rev-item").length === 5 && document.querySelector("#rev-preview .rev-perf tr"));
  const perfRows = await cad.evaluate(() => [...document.querySelectorAll("#rev-preview .rev-perf tr")].map(t => t.textContent.trim()).slice(0, 3).join(" | "));
  check(perfRows.length > 0, `r5 keeps the simulation's results (${perfRows})`);
  // a milestone with its release package (BOM and schematic PDF; the Gerbers when the board has parts)
  await cad.click("#rev-preview button[data-act=star]");
  check(await cad.evaluate(() => document.getElementById("rev-star-pkg").checked), "starring the revision on the sheet offers to keep the release package");
  await $("rev-star-name").fill("Sent to fab");
  await $("rev-star-name").press("Enter");
  await cad.waitForFunction(() => /BOM\.csv/.test((document.querySelector("#rev-preview .rev-files") || {}).textContent || ""), null, { timeout: 20000 });
  check(/schematic\.pdf/.test(await cad.locator("#rev-preview .rev-files").textContent()), `the release package is kept with it (${(await cad.locator("#rev-preview .rev-files").textContent()).trim()})`);
  await cad.click("#rev-close");
  // Autosaves: copies kept in this browser
  await cad.evaluate(() => { const c = TubeCAD.state.comps.find(x => x.type === "resistor"); c.params.r = 6800; TubeCAD.commit(); return TubeCAD.autosave().keep(true); });
  await cad.click("#btn-file"); await cad.click("#btn-autosaves");
  await cad.waitForFunction(() => !document.getElementById("autosave-modal").hidden && document.querySelectorAll("#autosave-list [data-open]").length >= 1);
  check(true, "File → Autosaves… lists the copies this browser kept");
  await cad.click("#autosave-close");
  // the start screen shows the projects
  await cad.evaluate(() => TubeCAD.openStart());
  await cad.waitForFunction(() => !document.getElementById("start-projects").hidden && /Gubin stereo/.test(document.getElementById("start-projects").textContent));
  check(true, "the start screen shows your projects over the examples");
  await cad.evaluate(() => { document.getElementById("start-modal").hidden = true; });

  // the manager page: space, projects with their revisions, the short links
  await fetch(`http://127.0.0.1:${store.address().port}/api/share`, { method: "POST", body: (await cad.evaluate(() => TubeCAD.shareLink())).long.split("#c=")[1] });
  const m = await open("projects", "projects.html");
  await m.waitForFunction(() => !document.getElementById("projects-card").hidden && document.querySelectorAll("#links tr[data-s]").length === 1);
  check(/Gubin stereo/.test(await m.locator("#projects").textContent()) && /of 100\.0 MB/.test(await m.locator("#m-total").textContent()), "the manager lists the project and the space taken of 100 MB, and the short link");
  await m.click("tr.proj td.name");
  await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 5);
  check(await m.evaluate(() => document.querySelectorAll("tr.revs td.pic img").length === 5 && /★ Sent to fab/.test(document.querySelector("tr.revs tr[data-n='2']").textContent)), "each revision shows its picture, and the milestone");
  check(await m.evaluate(() => /Open r5/.test(document.querySelector("tr.proj").textContent) && !!document.querySelector("tr.proj td.pic img")), "a project shows its newest picture and opens its newest revision");
  const href = await m.locator("tr.revs tr[data-n='2'] a.btn[href^='circuit_sandbox']").getAttribute("href");
  check(/^circuit_sandbox\.html#rev=[A-Za-z0-9_-]{10}\.2$/.test(href), `each revision opens in the CAD (${href})`);
  await m.click("tr.revs tr[data-n='1'] button[data-act=del-rev]");
  await m.waitForFunction(() => !document.getElementById("ask").hidden);
  check(/trash/.test(await m.locator("#ask").textContent()), "deleting asks first, in the page's own dialog");
  await m.click("#ask-ok");
  await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 4 && !document.getElementById("trash-card").hidden);
  check(/r1 of Gubin stereo/.test(await m.locator("#trash").textContent()), "a deleted revision goes to the trash");
  await m.click("#trash button[data-act=restore-rev]");
  await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 5 && document.getElementById("trash-card").hidden);
  check(true, "and comes back with Restore");
  await m.selectOption("tr.proj select[data-act=status]", "building");
  await m.waitForFunction(() => document.querySelector("tr.proj select").value === "building" && /building/.test(document.querySelector("tr.proj select").className));
  check(true, "a project's status is set in the list");
  await m.fill("#p-filter", "another");
  await m.waitForFunction(() => /r3/.test((document.querySelector("tr.proj .found") || {}).textContent || ""));
  check(true, "the search finds a revision's message across projects (r3 \"another way\")");
  await m.fill("#p-filter", "");
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
  await c2.close();
  // Import project…: a Download all file comes back as a new project
  const bundle = await m.evaluate(async () => (await fetch(document.querySelector("tr.proj a[download]").href)).text());
  await m.locator("#import-file").setInputFiles({ name: "gubin-revisions.json", mimeType: "application/json", buffer: Buffer.from(bundle) });
  await m.waitForFunction(() => document.querySelectorAll("tr.proj").length === 2 && /Imported Gubin stereo: 5 revisions/.test(document.getElementById("say").textContent));
  check(true, "Import project… brings a Download all file back as a project with all its revisions");

  // The vault: the same revisions kept in a folder on this computer (cad-vault.js). The browser's
  // folder dialog cannot be driven here, so it is played by a folder of the browser's own storage,
  // which answers the same calls.
  if (process.env.BROWSER !== "webkit") {
    const picker = () => {
      window.showDirectoryPicker = async () => (await navigator.storage.getDirectory()).getDirectoryHandle(window.PICK || "My vault", { create: true });
      // this browser falls over reading such a stand-in folder back from IndexedDB: the list is kept by name instead
      window.CadVaultKeep = {
        load: async () => Promise.all(JSON.parse(localStorage.getItem("test.vaults") || "[]").map(async v => Object.assign(v, { handle: await (await navigator.storage.getDirectory()).getDirectoryHandle(v.name) }))),
        save: async list => localStorage.setItem("test.vaults", JSON.stringify(list.map(v => ({ id: v.id, name: v.name })))),
      };
    };
    await ctx.addInitScript(picker);
    await m.reload();
    await m.waitForFunction(() => document.querySelectorAll("tr.proj").length === 2);
    await m.selectOption("#store", "vault");
    await m.waitForFunction(() => /A vault is a folder on this computer/.test(document.getElementById("say").textContent) && !document.getElementById("folder-pick").hidden);
    check(await m.evaluate(() => document.getElementById("projects-card").hidden), "the manager's Kept in switch goes to the vault, which asks for a folder first");
    await m.click("#folder-pick");
    await m.waitForFunction(() => !document.getElementById("projects-card").hidden && /Folder My vault/.test(document.getElementById("who").textContent));
    check(/No projects yet/.test(await m.locator("#projects").textContent()) && await m.evaluate(() => document.getElementById("links-card").hidden), "Choose folder… makes the folder a vault: no projects yet, and no server cards");
    await m.selectOption("#store", "site");
    await m.waitForFunction(() => document.querySelectorAll("tr.proj").length === 2 && !document.getElementById("space-card").hidden);
    await m.click("tr.proj:last-of-type button[data-act=copy], tr.proj button[data-act=copy]");
    await m.waitForFunction(() => /Copied .* to the folder My vault: 5 revisions/.test(document.getElementById("say").textContent), null, { timeout: 20000 });
    check(true, "Copy to folder takes a project with all its revisions from the server into the vault");
    await m.selectOption("#store", { label: "Folder: My vault" });
    await m.waitForFunction(() => document.querySelectorAll("tr.proj").length === 1 && /5/.test(document.querySelector("tr.proj td.num").textContent));
    await m.click("tr.proj td.name");
    await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 5 && [...document.querySelectorAll("tr.revs td.pic img")].every(i => i.complete && i.naturalWidth > 50));
    check(await m.evaluate(() => document.querySelectorAll("tr.revs td.pic img").length === 5 && /BOM\.csv/.test(document.querySelector("tr.revs").textContent)), "the vault's project lists its revisions with their pictures and release files, read from the folder");
    const vhref = await m.locator("tr.revs tr[data-n='2'] a.btn[href^='circuit_sandbox']").getAttribute("href");
    check(/#rev=[A-Za-z0-9_-]{10}\.2&vault=[A-Za-z0-9]{10}$/.test(vhref), `a vault revision's address says it is in the vault (${vhref})`);
    const files = await m.evaluate(async () => {
      const out = [], walk = async (d, pre) => { for await (const [n, h] of d.entries()) { out.push(pre + n); if (h.kind === "directory") await walk(h, pre + n + "/"); } };
      await walk(await (await navigator.storage.getDirectory()).getDirectoryHandle("My vault"), "");
      const f = await (await (await (await (await navigator.storage.getDirectory()).getDirectoryHandle("My vault")).getDirectoryHandle(out.find(x => !x.includes("/") && !x.endsWith(".json")))).getFileHandle("r2.json")).getFile();
      return { out, app: JSON.parse(await f.text()).app };
    });
    check(files.out.includes("tubecad-vault.json") && files.out.some(f => /^[^/]+\/project\.json$/.test(f)) && files.out.some(f => /\/r2\.sheet\.(webp|png|jpg)$/.test(f)) && files.out.some(f => /\/r5\.files\/.*BOM\.csv$/.test(f)) && files.app === "TubeAmpCAD",
      "in the folder: a folder for the project, r<n>.json designs that File → Open reads, their pictures and release files");
    await m.click("tr.revs tr[data-n='1'] button[data-act=del-rev]");
    await m.click("#ask-ok");
    await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 4 && /r1 of/.test(document.getElementById("trash").textContent));
    await m.click("#trash button[data-act=restore-rev]");
    await m.waitForFunction(() => document.querySelectorAll("tr.revs tr[data-n]").length === 5 && document.getElementById("trash-card").hidden);
    check(true, "the vault has its trash too: a deleted revision comes back with Restore");

    // the CAD on the vault: a #rev=…&vault=1 address, then the dialog
    const c3 = await open("cad-vault", vhref);
    c3.on("dialog", d => d.accept().catch(() => {}));
    // the revision is on the sheet once the chip names it (the circuit restored at load may look the same)
    await c3.waitForFunction(() => window.TubeCAD && !location.hash && (TubeCAD.state.comps.find(x => x.type === "resistor") || {}).params?.r === 3300 && TubeCAD.revisions().state().at?.store === "vault" && TubeCAD.revisions().state().at.n === 2 && document.getElementById("rev-modal").hidden, null, { timeout: 30000 });
    check(await c3.evaluate(() => TubeCAD.revisions().state().store === "vault" && /^r2/.test(document.getElementById("rev-at").textContent)), "a vault address opens that revision from the folder (the r2 chip)");
    await c3.evaluate(() => { const c = TubeCAD.state.comps.find(x => x.type === "resistor"); c.params.r = 4700; TubeCAD.commit(); });
    await c3.bringToFront();
    await c3.evaluate(() => TubeCAD.revisions().quickSave());
    await c3.waitForFunction(() => document.activeElement.id === "rev-message" && document.querySelectorAll("#rev-list .rev-item").length === 5);
    check(await c3.evaluate(() => /^vault:/.test(document.getElementById("rev-store").value) && /Folder My vault/.test(document.getElementById("rev-who").textContent) && !document.getElementById("rev-folder-forget").hidden && /Changes since r2/.test(document.getElementById("rev-changes").textContent)),
      "the Revisions dialog says it is kept in the folder, and what changed since r2");
    await c3.keyboard.type("4.7 k, in the vault"); await c3.keyboard.press("Enter");
    await c3.waitForFunction(() => document.querySelectorAll("#rev-list .rev-item").length === 6 && /^r6$/.test(document.getElementById("rev-at").textContent));
    await c3.waitForFunction(() => { const i = document.querySelector("#rev-preview img"); return i && i.complete && i.naturalWidth > 100; });
    check(/from r2/.test(await c3.locator("#rev-list .rev-item[data-n='6']").textContent()), "Save revision writes r6 into the folder, made from r2, with its picture");
    await c3.click("#rev-list .rev-item[data-n='5']");
    await c3.click("#rev-preview button[data-act=compare]");
    await c3.waitForFunction(() => !document.getElementById("rev-diff-bar").hidden && /Changes since r5/.test(document.getElementById("rev-diff-bar").textContent));
    check(/changed/.test(await c3.locator("#rev-diff-bar").textContent()), "Compare on the sheet works against a revision in the folder");
    await c3.click("#rev-diff-bar button[data-act=done]");
    const [dl] = await Promise.all([c3.waitForEvent("download"), c3.evaluate(() => TubeCAD.revisions().open().then(() => document.getElementById("rev-export").click()))]);
    const all = JSON.parse(await (await import("node:fs/promises")).readFile(await dl.path(), "utf8"));
    check(all.app === "TubeAmpCAD-project" && all.project.revs.length === 6 && /^data:image/.test(all.project.revs[5].thumbData), `Download all puts the vault's project in one file (${dl.suggestedFilename()})`);
    // a second vault: Add a folder… in Kept in, with projects of its own; the first is one pick away
    await c3.evaluate(() => { window.PICK = "Second amp"; });
    await c3.selectOption("#rev-store", "add");
    await c3.waitForFunction(() => /Folder Second amp/.test(document.getElementById("rev-who").textContent) && !document.getElementById("rev-new-row").hidden);
    check(await c3.evaluate(() => [...document.getElementById("rev-store").options].map(o => o.textContent).join("|")) === "aerocat.tech (the site's owner)|Folder: My vault|Folder: Second amp|Add a folder…", "Add a folder… makes a second vault, empty, and Kept in lists both folders");
    await c3.locator("#rev-new-name").fill("Second"); await c3.click("#rev-new-ok");
    await c3.waitForFunction(() => /first revision/.test(document.getElementById("rev-changes").textContent));
    await c3.click("#rev-save");
    await c3.waitForFunction(() => document.querySelectorAll("#rev-list .rev-item").length === 1 && /^r1$/.test(document.getElementById("rev-at").textContent));
    const saved2 = JSON.parse(await c3.evaluate(() => TubeCAD.circuitJSON())).revLink;
    await c3.selectOption("#rev-store", { label: "Folder: My vault" });
    await c3.waitForFunction(() => /Folder My vault/.test(document.getElementById("rev-who").textContent) && document.querySelectorAll("#rev-list .rev-item").length === 6);
    check(saved2.store === "vault" && /^[A-Za-z0-9]{10}$/.test(saved2.vault), "each vault keeps its own projects, and a saved file names the vault its revision is in");
    // back to the site's store: the choice is remembered, so the pages after this one find it as before
    await c3.selectOption("#rev-store", "site");
    await c3.waitForFunction(() => /owner@example\.com/.test(document.getElementById("rev-who").textContent) && document.getElementById("rev-folder-forget").hidden && document.querySelectorAll("#rev-list .rev-item").length === 5);
    check(await c3.evaluate(() => localStorage.getItem("tubecad.rev.store") === "site" && document.querySelectorAll("#rev-project option").length === 2), "Kept in switches back to aerocat.tech, with its own projects");
    await c3.close();

    // A browser that cannot write into folders (Safari, Firefox; here Chromium without its folder
    // dialog): a vault's folder is picked with a folder <input> and only read
    const vdir = join(dir, "Old vault"), pdir = join(vdir, "Preamp");
    mkdirSync(pdir, { recursive: true });
    const design = await cad.evaluate(() => { const d = JSON.parse(TubeCAD.circuitJSON()); delete d.revLink; return d; });
    writeFileSync(join(vdir, "tubecad-vault.json"), JSON.stringify({ app: "TubeAmpCAD-vault", version: 1, id: "OldVault01" }));
    writeFileSync(join(pdir, "project.json"), JSON.stringify({ id: "Preamp0001", name: "Preamp", created: "2026-01-02T10:00:00Z", updated: "2026-01-02T10:00:00Z", revs: [{ n: 1, time: "2026-01-02T10:00:00Z", message: "from the other computer", summary: "first revision", size: 1, hash: "x" }] }));
    writeFileSync(join(pdir, "r1.json"), JSON.stringify(design));
    const s4 = await ctx.newPage();
    s4.on("dialog", d => d.accept().catch(() => {}));
    await s4.addInitScript(() => { window.showDirectoryPicker = undefined; try { localStorage.removeItem("test.vaults"); } catch (e) { /* no storage */ } });
    await s4.goto(U("circuit_sandbox.html"));
    await s4.waitForFunction(() => window.TubeCAD && TubeCAD.revisions());
    await s4.evaluate(() => TubeCAD.revisions().open());
    await s4.waitForFunction(() => /owner@example\.com/.test(document.getElementById("rev-who").textContent));
    await s4.selectOption("#rev-store", "vault");
    await s4.waitForFunction(() => !document.getElementById("rev-vault").hidden);
    check(/can read a vault's folder but cannot save into it/.test(await s4.locator("#rev-vault-text").textContent()), "a browser that cannot write into folders says a vault is read only there");
    const [chooser] = await Promise.all([s4.waitForEvent("filechooser"), s4.click("#rev-vault-pick")]);
    await chooser.setFiles(vdir);
    await s4.waitForFunction(() => !document.getElementById("rev-main").hidden && document.querySelectorAll("#rev-list .rev-item").length === 1);
    check(await s4.evaluate(() => /Folder Old vault .* read only/.test(document.getElementById("rev-who").textContent) && document.getElementById("rev-save").disabled && document.getElementById("rev-new").disabled && /from the other computer/.test(document.getElementById("rev-list").textContent)),
      "the folder picked is listed, read only: its project and revision show, Save revision and New project are off");
    await s4.click("#rev-preview button[data-act=open]");
    await s4.waitForFunction(() => document.getElementById("rev-modal").hidden && /^r1/.test(document.getElementById("rev-at").textContent) && TubeCAD.revisions().state().at.vault === "OldVault01");
    check(true, "Open puts a revision of the read-only vault on the sheet");
    await s4.evaluate(() => { localStorage.setItem("tubecad.rev.store", "site"); localStorage.removeItem("tubecad.rev.at"); });
    await s4.close();
  }
  await m.close();
  await ctx.unroute(/\/api\/rev\//);
  store.close(); certs.close(); rmSync(dir, { recursive: true, force: true });
}
