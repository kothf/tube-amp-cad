// Share by link: File → Share link… packs the design into the address, and the link opens it
import { cad, check, open } from "./harness.mjs";

{
  await cad.bringToFront();
  cad.once("dialog", d => d.accept().catch(() => {}));
  await cad.evaluate(() => TubeCAD.openExample(TubeCAD.EXAMPLES.find(x => /^07-/.test(x.file))));
  await cad.waitForFunction(() => TubeCAD.state.board && /Gubin/.test(document.title));
  await cad.click("#btn-file"); await cad.click("#btn-share");
  await cad.waitForFunction(() => /#c=/.test(document.getElementById("share-text").value));
  const sh = await cad.evaluate(() => ({ url: document.getElementById("share-text").value, info: document.getElementById("share-info").textContent, board: document.getElementById("share-board").checked }));
  check(sh.board && /circuit_sandbox\.html#c=[A-Za-z0-9_-]+$/.test(sh.url) && /characters/.test(sh.info), `File → Share link… shows the link with the board (${sh.info})`);
  await cad.click("#share-board");
  await cad.waitForFunction(n => document.getElementById("share-text").value.length < n, sh.url.length);
  const short = await cad.evaluate(() => document.getElementById("share-text").value.length);
  check(short < sh.url.length * 0.7, `without the board the link is shorter (${short} vs ${sh.url.length} characters)`);
  await cad.click("#btn-share-close");
  check(await cad.evaluate(() => document.getElementById("share-modal").hidden), "Close closes the Share dialog");

  const want = await cad.evaluate(() => { const d = JSON.parse(TubeCAD.circuitJSON()); return { comps: d.comps, wires: d.wires, board: JSON.stringify(d.board) }; });
  const p = await open("shared", "circuit_sandbox.html");
  await p.waitForFunction(() => window.TubeCAD);
  // a circuit is on that sheet already (the one stored by the CAD page): the link asks before it replaces it
  let asked = "";
  p.once("dialog", d => { asked = d.message(); d.accept().catch(() => {}); });
  await p.evaluate(u => { location.hash = u.slice(u.indexOf("#")); }, sh.url);
  // the status line is soon overwritten by the simulation, so wait for the circuit itself
  await p.waitForFunction(n => !location.hash && TubeCAD.state.comps.length === n, want.comps.length, { timeout: 30000 });
  const got = await p.evaluate(() => { const d = JSON.parse(TubeCAD.circuitJSON()); return { comps: d.comps, wires: d.wires, board: JSON.stringify(d.board), hash: location.hash }; });
  check(/design from this link/.test(asked), "opening a link over a circuit asks first");
  check(JSON.stringify(got.comps) === JSON.stringify(want.comps) && JSON.stringify(got.wires) === JSON.stringify(want.wires), `the link opens the same circuit (${got.comps.length} parts, ${got.wires.length} wires)`);
  check(got.board === want.board, "and the same board layout");
  check(got.hash === "", "the design is taken off the address once opened, so a reload keeps the edits");
  await p.close();
}
