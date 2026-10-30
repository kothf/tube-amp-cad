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
  // a design object → the text that goes after "#c="
  async function pack(design) {
    if (!supported()) throw new Error("this browser cannot compress (CompressionStream is missing)");
    return toB64u(await pipe(new TextEncoder().encode(JSON.stringify(design)), new CompressionStream("deflate-raw")));
  }
  // that text → the design object
  async function unpack(text) {
    if (!supported()) throw new Error("this browser cannot decompress (DecompressionStream is missing)");
    let bytes;
    try { bytes = fromB64u(text); } catch (e) { throw new Error("the link is damaged (not base64)"); }
    let json;
    try { json = new TextDecoder().decode(await pipe(bytes, new DecompressionStream("deflate-raw"))); }
    catch (e) { throw new Error("the link is damaged or cut short"); }
    return JSON.parse(json);
  }
  // the packed design in an address's #fragment ("#c=…", also among other #a=b&c=… pairs), or null
  function fromHash(hash) {
    const m = String(hash || "").replace(/^#/, "").split("&").map(p => p.split("=")).find(p => p[0] === KEY && p[1]);
    return m ? m.slice(1).join("=") : null;
  }
  // the link to the design: this page's address without its fragment, then #c=…
  const link = (href, packed) => String(href).replace(/#.*$/, "") + "#" + KEY + "=" + packed;

  root.CadShare = { KEY, supported, pack, unpack, fromHash, link };
})(typeof window !== "undefined" ? window : globalThis);
