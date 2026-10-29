/* Parts search: a part number looked up in DigiKey's product database, from the page itself
   (DigiKey's API answers browser pages). It needs the user's own free API credentials
   (developer.digikey.com: an app with Product Information, its Client ID and Client Secret),
   kept in this browser's storage only. What DigiKey says (package, size, height, lead spacing,
   ratings) goes through PartNo.fromSpecs into the part's saved record (params.part), so the
   circuit file keeps it and nothing is looked up again until the number changes. */
(function (root) {
  "use strict";
  const KEY = "tubecad_digikey", API = "https://api.digikey.com";
  let token = null;            // { value, until }
  const store = { get() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } },
    set(v) { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} } };
  const config = () => { const c = store.get(); return { clientId: c.clientId || "", clientSecret: c.clientSecret || "" }; };
  const ready = () => { const c = config(); return !!(c.clientId && c.clientSecret); };
  function setConfig(clientId, clientSecret) { store.set({ clientId: String(clientId || "").trim(), clientSecret: String(clientSecret || "").trim() }); token = null; }

  async function getToken(f) {
    if (token && token.until > Date.now() + 30e3) return token.value;
    const c = config();
    if (!c.clientId || !c.clientSecret) throw new Error("No DigiKey API key yet: BOM ▸ DigiKey key… sets it");
    const r = await f(API + "/v1/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, grant_type: "client_credentials" }).toString() });
    if (!r.ok) throw new Error(r.status === 401 || r.status === 400 ? "DigiKey refused the key: check the Client ID and Secret" : `DigiKey sign-in failed (${r.status})`);
    const j = await r.json();
    token = { value: j.access_token, until: Date.now() + (+j.expires_in || 600) * 1000 };
    return token.value;
  }
  async function call(f, path, opts) {
    const t = await getToken(f), c = config();
    const r = await f(API + path, { ...(opts || {}), headers: { Authorization: "Bearer " + t, "X-DIGIKEY-Client-Id": c.clientId, "X-DIGIKEY-Locale-Site": "US", "X-DIGIKEY-Locale-Language": "en", "X-DIGIKEY-Locale-Currency": "USD", Accept: "application/json", ...((opts && opts.headers) || {}) } });
    if (r.status === 404) return null;
    if (r.status === 429) throw new Error("DigiKey's daily limit is reached: try again tomorrow");
    if (!r.ok) throw new Error(`DigiKey answered ${r.status}`);
    return r.json();
  }
  // the product: its details by the number, else the keyword search's exact match
  async function product(partno, f) {
    f = f || root.fetch.bind(root);
    const no = root.PartNo.norm(partno), q = String(partno).trim();
    const d = await call(f, `/products/v4/search/${encodeURIComponent(q)}/productdetails`);
    if (d && d.Product) return d.Product;
    const s = await call(f, "/products/v4/search/keyword", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ Keywords: q, Limit: 10, Offset: 0 }) });
    const list = s ? [...(s.ExactMatches || []), ...(s.Products || [])] : [];
    return list.find(p => root.PartNo.norm(p.ManufacturerProductNumber) === no) || list.find(p => root.PartNo.norm(p.ManufacturerProductNumber).startsWith(no)) || null;
  }
  /** DigiKey's product -> the specs PartNo.fromSpecs reads */
  function specsOf(p) {
    const par = {};
    (p.Parameters || []).forEach(x => { if (x && x.ParameterText) par[x.ParameterText] = x.ValueText; });
    const pick = re => { const k = Object.keys(par).find(n => re.test(n)); return k ? par[k] : ""; };
    return { source: "DigiKey", maker: (p.Manufacturer && p.Manufacturer.Name) || "", series: p.Series && p.Series.Name && p.Series.Name !== "-" ? p.Series.Name : "", mpn: p.ManufacturerProductNumber || "",
      pkg: pick(/^Package \/ Case$/i), device: pick(/^Supplier Device Package$/i), size: pick(/^Size \/ Dimension$/i), height: pick(/^Height/i), lead: pick(/^Lead Spacing$/i),
      mount: pick(/^Mounting Type$/i), power: pick(/^Power \(Watts\)$|^Power$/i), voltage: pick(/^Voltage - Rated$|^Voltage Rating/i), capacitance: pick(/^Capacitance$/i) };
  }
  /** Look up part c (a schematic component, or several sharing a number): its params.part becomes
      what DigiKey says. Returns the PartNo result; throws with a message for the user. */
  async function lookUp(comps, f) {
    comps = [].concat(comps);
    const c = comps[0], no = root.PartNo.norm(c.params.partno);
    if (!no) throw new Error("Type the part number first");
    const p = await product(c.params.partno, f);
    if (!p) throw new Error(`DigiKey doesn't list ${c.params.partno}`);
    const specs = specsOf(p), r = root.PartNo.fromSpecs(specs, c.type, c.params);
    const rec = root.PartNo.record(no, r, { source: "DigiKey", url: p.ProductUrl || "", specs });
    if (!r.known) rec.text = r.text;
    comps.forEach(k => { k.params.part = JSON.parse(JSON.stringify(rec)); });
    return r;
  }
  root.PartSearch = { ready, config, setConfig, lookUp, product, specsOf, KEY };
})(typeof window !== "undefined" ? window : globalThis);
