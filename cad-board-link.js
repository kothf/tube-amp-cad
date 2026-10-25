/* The CAD's side of Board Design: the board window (or the board as a tab of this window), the
   netlist it gets (BOARD_NETLIST), the board document the CAD keeps with the circuit (BOARD_SAVE
   stores it without echoing, so nothing loops), and cross-probing of parts and nets both ways. */
(function (root) {
  "use strict";
  // cad: what this part of the CAD needs from cad-app.js; returns what cad-app.js uses of it
  root.CadBoardLink = function (cad) {
    const { S, VERSION, channel, compBBox, compPins, frames, getCanvas, netDC, netWave, pinCurrents, render, selSig, showFile, topo, updateInspector, usedCustomTubes } = cad;
    // The board as a tab of this window (Windows ▾ → Board in this window): board.html in a frame
    // over the whole page, shown by Board and hidden by the Schematic button in its own toolbar.
    // Off (the default), the board has a window of its own, for a second monitor; in Safari, which
    // will not let the Board window bring this one back, on unless it was unticked.
    const BOARD_TAB_KEY = "tubecad_board_tab";
    let boardTab = !!ToolWindows.cantRaise;
    try { const v = localStorage.getItem(BOARD_TAB_KEY); if (v !== null) boardTab = v === "1"; } catch (e) {}
    const boardFrame = () => document.getElementById("board-tab");
    function showBoard() {
      if (!boardTab) { ToolWindows.open("board.html"); return; }
      let f = boardFrame();
      if (!f) { f = document.createElement("iframe"); f.id = "board-tab"; f.title = "Board Design"; f.src = "board.html" + VERSION; document.body.appendChild(f); f.addEventListener("load", () => { if (!f.hidden) f.contentWindow.focus(); }); }
      f.hidden = false; document.body.classList.add("board-tab-on");
      try { f.contentWindow.focus(); } catch (e) {}
    }
    function showSchematic() {
      const f = boardFrame(); if (f) f.hidden = true;
      document.body.classList.remove("board-tab-on");
      window.focus(); getCanvas().focus();
    }
    function setBoardTab(on) {
      boardTab = !!on;
      try { localStorage.setItem(BOARD_TAB_KEY, boardTab ? "1" : "0"); } catch (e) {}
      const f = boardFrame();
      if (!boardTab && f) { const was = !f.hidden; f.remove(); document.body.classList.remove("board-tab-on"); if (was) ToolWindows.open("board.html"); }
    }
    // the framed board's Schematic button (windows.js) asks for the schematic
    window.addEventListener("message", e => { if (e.origin === location.origin && e.data && e.data.type === "SHOW_PAGE" && e.data.page === "circuit_sandbox.html") showSchematic(); });

    // Board Design: the board window takes the netlist from here; the CAD keeps the board
    // document with the circuit (file and browser storage). The board window sends its
    // document back (BOARD_SAVE); the CAD stores it without echoing, so nothing loops.
    const BOARD_KEY = "tubecad_board_v1";
    S.board = null;
    function boardNetlist() {
      const T = topo(), skip = new Set(["frame", "note", "ground", "offsheet", "scope"]);
      // DC current into each pin from the last result (the board sizes tracks by it)
      const PI = S.sim.result && S.sim.topo === T ? pinCurrents() : null;
      const parts = S.comps.filter(c => !skip.has(c.type)).map(c => ({ id: c.id, type: c.type, label: c.label, params: c.params, x: c.x, y: c.y,
        pins: compPins(c).map(p => { const k = c.id + ":" + p.id, i = PI && PI.get(k); return { id: p.id, name: p.name || p.id, net: T.pinNet.get(k), i: Number.isFinite(i) ? +i.toPrecision(4) : undefined }; }) }));
      const names = {};
      if (T.hasGround) names[0] = "GND";
      S.comps.forEach(c => { if (c.type === "offsheet" && String(c.params.name || "").trim()) { const n = T.pinNet.get(c.id + ":1"); if (n !== 0) names[n] = String(c.params.name).trim(); } });
      // DC level per net from the last result, for the high-voltage clearance rule
      const volts = {};
      if (S.sim.result && S.sim.topo === T) Object.keys(names).concat([...new Set([...T.pinNet.values()])]).forEach(n => { const v = netDC(+n); if (v !== null) volts[n] = v; });
      // the swing of each net in the simulation (min, max), for the clearance by voltage
      const ranges = {};
      if (S.sim.result && S.sim.topo === T && S.sim.result.tran) Object.keys(volts).forEach(n => {
        const w = netWave(+n); if (!w || !w.length) return;
        let lo = Infinity, hi = -Infinity; for (const v of w) { if (v < lo) lo = v; if (v > hi) hi = v; }
        if (hi - lo > 1e-3) ranges[n] = [+lo.toPrecision(4), +hi.toPrecision(4)];
      });
      const f = frames()[0];
      return { parts, names, volts, ranges, title: f ? f.params.title || "" : "", docno: f ? f.params.docno || "" : "", frame: f ? { ...f.params } : null, tubes: usedCustomTubes() };
    }
    let boardTimer = 0;
    function sendBoardNetlist(withBoard) {
      if (!channel) return;
      try { channel.postMessage({ type: "BOARD_NETLIST", version: VERSION, netlist: boardNetlist(), board: withBoard ? S.board : undefined, replace: !!withBoard }); } catch (e) {}
    }
    const scheduleBoardNetlist = () => { clearTimeout(boardTimer); boardTimer = setTimeout(() => sendBoardNetlist(false), 250); };
    function storeBoard(doc) {
      S.board = doc || null;
      try { if (S.board) localStorage.setItem(BOARD_KEY, JSON.stringify(S.board)); else localStorage.removeItem(BOARD_KEY); } catch (e) {}
      showFile();
    }

    // Cross-probing with the Board window: a part selected there is selected (and shown) here;
    // a selection made here goes to the board. probeSig keeps a selection from echoing back.
    let probeSig = "";
    function selectFromBoard(ids) {
      const canvas = getCanvas();
      const want = new Set(ids || []), cs = S.comps.filter(c => want.has(c.id));
      if (!cs.length) return;
      S.sel.comps.clear(); S.sel.wires.clear(); cs.forEach(c => S.sel.comps.add(c.id));
      probeSig = selSig();
      const b = compBBox(cs[0]), cx = (b.x1 + b.x2) / 2, cy = (b.y1 + b.y2) / 2, sx = cx * S.view.scale + S.view.ox, sy = cy * S.view.scale + S.view.oy;
      if (sx < 40 || sy < 40 || sx > canvas.clientWidth - 40 || sy > canvas.clientHeight - 40) { S.view.ox = canvas.clientWidth / 2 - cx * S.view.scale; S.view.oy = canvas.clientHeight / 2 - cy * S.view.scale; }
      updateInspector(); render();
    }
    function probeBoard() {
      const sig = selSig(); if (sig === probeSig) return;
      probeSig = sig;
      // wires only: their net, so the board highlights its pads and tracks
      let net;
      if (!S.sel.comps.size && S.sel.wires.size) { const T = topo(), nets = new Set([...S.sel.wires].map(id => T.wireNet.get(id))); if (nets.size === 1) net = [...nets][0]; }
      if (channel) { try { channel.postMessage({ type: "CAD_SELECT", ids: [...S.sel.comps], net }); } catch (e) {} }
    }
    // the board highlights a net: select its wires here (without echoing it back)
    function selectNetFromBoard(net) {
      if (net === null || net === undefined) return;
      const T = topo(), ws = S.wires.filter(w => T.wireNet.get(w.id) === net);
      if (!ws.length) return;
      S.sel.comps.clear(); S.sel.wires.clear(); ws.forEach(w => S.sel.wires.add(w.id));
      probeSig = selSig();
      updateInspector(); render();
    }
    const isBoardTab = () => boardTab;
    return { BOARD_KEY, boardNetlist, isBoardTab, probeBoard, scheduleBoardNetlist, selectFromBoard, selectNetFromBoard, sendBoardNetlist, setBoardTab, showBoard, storeBoard };
  };
})(window);
