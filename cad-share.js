/* Share by link: the whole design (the circuit, the imported tubes it uses and its board) as
   compact JSON, deflated and written in base64url after "#c=" in the address. The part after
   # never goes to the server, so the link works on any copy of the app (aerocat.tech, a local
   folder) and the design is not stored anywhere but in the link itself. Opening such a link
   loads the design, as File › Open does. */
(function (root) {
  "use strict";
  const KEY = "c";
  const supported = () => typeof CompressionStream === "function" && typeof DecompressionStream === "function";

  async function pipe(bytes, stream) {
    const out = new Blob([bytes]).stream().pipeThrough(stream);
    return new Uint8Array(await new Response(out).arrayBuffer());
  }
  function toB64u(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  function fromB64u(text) {
    const s = atob(text.replace(/-/g, "+").replace(/_/g, "/").replace(/\s+/g, ""));
    const b = new Uint8Array(s.length);
    for (let i = 0; i < s.length; i++) b[i] = s.charCodeAt(i);
    return b;
  }
  // The link's own form of a design, shorter than the file's: each part and wire is an array
  // instead of an object with named fields (any field beyond these rides along at the end)
  //   { s: 1, c: [[id, type, x, y, rot, label, params, extra?]…], w: [[id, x1, y1, x2, y2, extra?]…], t: tubes?, b: board? }
  const C_KEYS = ["id", "type", "x", "y", "rot", "label", "params"], W_KEYS = ["id", "x1", "y1", "x2", "y2"];
  function toRows(list, keys) {
    return (list || []).map(o => {
      const row = keys.map(k => o[k]), extra = {};
      Object.keys(o).forEach(k => { if (!keys.includes(k)) extra[k] = o[k]; });
      if (Object.keys(extra).length) row.push(extra);
      return row;
    });
  }
  function fromRows(rows, keys) {
    return (rows || []).map(r => {
      const o = {};
      keys.forEach((k, i) => { if (r[i] !== undefined && r[i] !== null) o[k] = r[i]; });
      return Object.assign(o, r[keys.length] || {});
    });
  }
  function compact(d) {
    const o = { s: 1, c: toRows(d.comps, C_KEYS), w: toRows(d.wires, W_KEYS) };
    if (d.tubes && d.tubes.length) o.t = d.tubes;
    if (d.board) o.b = d.board;
    return o;
  }
  // the link's form (or the file's form, as links from 3.135.0 carry) → the file's form
  function expand(o) {
    if (!o || o.app === "TubeAmpCAD" || o.s !== 1) return o;
    const d = { app: "TubeAmpCAD", version: 2, comps: fromRows(o.c, C_KEYS), wires: fromRows(o.w, W_KEYS) };
    if (o.t) d.tubes = o.t;
    if (o.b) d.board = o.b;
    return d;
  }
  // a design object → the text that goes after "#c="
  async function pack(design) {
    if (!supported()) throw new Error("this browser cannot compress (CompressionStream is missing)");
    return toB64u(await pipe(new TextEncoder().encode(JSON.stringify(compact(design))), new CompressionStream("deflate-raw")));
  }
  // that text → the design object
  async function unpack(text) {
    if (!supported()) throw new Error("this browser cannot decompress (DecompressionStream is missing)");
    let bytes;
    try { bytes = fromB64u(text); } catch (e) { throw new Error("the link is damaged (not base64)"); }
    let json;
    try { json = new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate-raw"))); }
    catch (e) { throw new Error("the link is damaged or cut short"); }
    return expand(JSON.parse(json));
  }
  // the packed design in an address's #fragment ("#c=…", also among other #a=b&c=… pairs), or null
  function fromHash(hash) {
    const m = String(hash || "").replace(/^#/, "").split("&").map(p => p.split("=")).find(p => p[0] === KEY && p[1]);
    return m ? m.slice(1).join("=") : null;
  }
  // the link to the design: this page's address without its fragment, then #c=…
  const link = (href, packed) => String(href).replace(/#.*$/, "") + "#" + KEY + "=" + packed;

  root.CadShare = { KEY, supported, pack, unpack, fromHash, link, compact, expand };
})(typeof window !== "undefined" ? window : globalThis);
