// Share by link: File → Share link… packs the design into the address (or, on aerocat.tech, stores
// it for a short link), and the link opens it
import { isDeepStrictEqual } from "node:util";
import { cad, check, ctx, open } from "./harness.mjs";

{
  await cad.bringToFront();
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^07-/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.board && /Gubin/.test(document.title));
  const shareText = () => cad.evaluate(() => ({ url: document.getElementById("share-text").value, info: document.getElementById("share-info").textContent, board: document.getElementById("share-board").checked }));

  // no link store here (the test server has none): the long link, with the design inside
  await cad.click("#btn-file"); await cad.click("#btn-share");
  await cad.waitForFunction(() => /#c=/.test(document.getElementById("share-text").value));
  const sh = await shareText();
  check(sh.board && /circuit_sandbox\.html#c=[A-Za-z0-9_-]+$/.test(sh.url) && /Long link/.test(sh.info), `without a link store, File → Share link… gives the long link, board included (${sh.info})`);
  await cad.click("#share-board");
  await cad.waitForFunction(n => { const v = document.getElementById("share-text").value; return v && v.length < n; }, sh.url.length);
  const short = (await shareText()).url.length;
  check(short < sh.url.length * 0.7, `without the board the link is shorter (${short} vs ${sh.url.length} characters)`);
  await cad.click("#btn-share-close");
  check(await cad.evaluate(() => document.getElementById("share-modal").hidden), "Close closes the Share dialog");

  // a link store (as on aerocat.tech, here played by a route): the short link /s/<id>
  const stored = new Map();
  await ctx.route(/\/api\/share(\/[^/]+)?$/, async route => {
    const req = route.request(), m = req.url().match(/\/api\/share\/([^/?]+)$/);
    if (req.method() === "POST") { const id = "Ab3xK9_qZ" + stored.size; stored.set(id, req.postData()); return route.fulfill({ status: 201, contentType: "application/json", body: JSON.stringify({ id }) }); }
    if (m && stored.has(m[1])) return route.fulfill({ status: 200, contentType: "text/plain", body: stored.get(m[1]) });
    return route.fulfill({ status: 404, contentType: "application/json", body: "{}" });
  });
  await cad.click("#btn-file"); await cad.click("#btn-share");
  await cad.waitForFunction(() => /\/s\//.test(document.getElementById("share-text").value));
  const sl = await shareText();
  check(/^http:\/\/localhost:\d+\/s\/Ab3xK9_qZ0$/.test(sl.url) && /Short link/.test(sl.info), `with the link store the dialog gives the short link (${sl.url})`);
  await cad.click("#btn-share-close");

  const want = await cad.evaluate(() => { const d = JSON.parse(TubeCAD.circuitJSON()); return { comps: d.comps, wires: d.wires, board: JSON.stringify(d.board) }; });
  const openIn = async (p, hash) => {
    let asked = "";
    p.once("dialog", d => { asked = d.message(); d.accept().catch(() => {}); });
    await p.evaluate(h => { location.hash = h; }, hash);
    // the status line is soon overwritten by the simulation, so wait for the circuit itself
    await p.waitForFunction(n => !location.hash && TubeCAD.state.comps.length === n, want.comps.length, { timeout: 30000 });
    const got = await p.evaluate(() => { const d = JSON.parse(TubeCAD.circuitJSON()); return { comps: d.comps, wires: d.wires, board: JSON.stringify(d.board) }; });
    return { asked, same: isDeepStrictEqual(got.comps, want.comps) && isDeepStrictEqual(got.wires, want.wires), board: got.board === want.board, n: got.comps.length };
  };
  const p = await open("shared", "circuit_sandbox.html");
  await p.waitForFunction(() => window.TubeCAD);
  // a circuit is on that sheet already (the one stored by the CAD page): the link asks before it replaces it
  const a = await openIn(p, sh.url.slice(sh.url.indexOf("#")));
  check(/design from this link/.test(a.asked), "opening a link over a circuit asks first");
  check(a.same && a.board, `the long link opens the same circuit and board (${a.n} parts)`);
  check(await p.evaluate(() => location.hash === ""), "the design is taken off the address once opened, so a reload keeps the edits");
  await p.evaluate(() => { const S = TubeCAD.state; S.comps = S.comps.filter(c => c.type === "frame"); TubeCAD.commit(); });
  const b = await openIn(p, "#s=Ab3xK9_qZ0");
  check(b.same && b.board && !b.asked, "the short link (#s=<id>, where /s/<id> leads) opens the same circuit and board from the store");
  await p.evaluate(() => { location.hash = "#s=NoSuchId00"; });
  await p.waitForFunction(() => /no design is stored/.test(document.body.textContent), null, { timeout: 15000 });
  check(true, "a short link to an unknown id says so");
  await p.close();
  await ctx.unroute(/\/api\/share(\/[^/]+)?$/);
}
