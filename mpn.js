/* Manufacturer part numbers. PartNo.lookup(text, type, params) reads a part number typed in
   the BOM (or the inspector) and says what it can from the number alone: chip sizes, a size
   written in it, a few resistor series, packages from order-code suffixes. PartNo.fromSpecs()
   turns what a parts database says about the part (its package, size, height, lead spacing:
   mpn-online.js asks DigiKey) into the same result: the board footprint that fits it and the
   body for the silkscreen and the 3D model. keep() / resolve() save it with the part in the
   circuit file. No dependencies; Node-testable. */
(function (root) {
  "use strict";
  // a part number as typed, upper case, without spaces, dashes, dots or slashes: the makers print
  // "EEU-FC1H101", catalogues "EEUFC1H101"
  const norm = s => String(s || "").toUpperCase().replace(/[\s\-./_]+/g, "");
  const mm = x => String(+(+x).toFixed(2));

  // ---------------------------------------------------------------------------
  // Leaded resistors: body length, diameter, lead diameter (mm, the datasheets' nominal or
  // maximum), the rating (W) when the series fixes it
  // ---------------------------------------------------------------------------
  // Yageo MFR (datasheet "MFR series", DIMENSIONS table); the miniature MFRxxS have the
  // next smaller body. Vishay Beyschlag MBA / MBB / MBE and SMA 0204 / 0207 / 0414 (doc 28766,
  // Dmax / Lmax / dnom), the Dale CMF50 / 55 / 60 the same bodies (doc 31018). Vishay PR01 /
  // PR02 / PR03 (doc 28729, straight leads). Yageo CFR-25: the distributors' listing (Ø2.4 × 6.3).
  const RES = [
    [/^MFR12/, "Yageo MFR-12", 3.4, 1.9, 0.45, 1 / 6], [/^MFR25S/, "Yageo MFR25S", 3.4, 1.9, 0.45, 0.25],
    [/^MFR25/, "Yageo MFR-25", 6.3, 2.4, 0.55, 0.25], [/^MFR50S/, "Yageo MFR50S", 6.3, 2.4, 0.55, 0.5],
    [/^MFR50/, "Yageo MFR-50", 9.0, 3.3, 0.55, 0.5], [/^MFR1WS/, "Yageo MFR1WS", 9.0, 3.3, 0.55, 1],
    [/^MFR100/, "Yageo MFR100", 11.5, 4.5, 0.8, 1], [/^MFR2WS/, "Yageo MFR2WS", 11.5, 4.5, 0.8, 2],
    [/^MFR200/, "Yageo MFR200", 15.5, 5.0, 0.8, 2], [/^MFR3WS/, "Yageo MFR3WS", 15.5, 5.0, 0.8, 3],
    [/^CFR25/, "Yageo CFR-25", 6.3, 2.4, 0, 0.25],
    [/^(MBA|SMA)0204/, "Vishay $1 0204", 3.6, 1.6, 0.5, 0], [/^(MBB|SMA)0207/, "Vishay $1 0207", 6.5, 2.5, 0.6, 0], [/^(MBE|SMA)0414/, "Vishay $1 0414", 11.9, 4.2, 0.8, 0],
    [/^CMF50/, "Vishay Dale CMF50", 3.6, 1.6, 0.5, 0], [/^CMF55/, "Vishay Dale CMF55", 6.5, 2.5, 0.6, 0], [/^CMF60/, "Vishay Dale CMF60", 11.9, 4.2, 0.8, 0],
    [/^PR01/, "Vishay PR01", 6.5, 2.5, 0.58, 1], [/^PR02/, "Vishay PR02", 10.0, 3.9, 0.78, 2], [/^PR03/, "Vishay PR03", 16.7, 5.2, 0.78, 3]
  ];
  // the DIN size code in any other leaded resistor's number (MF0207…, 0414…): Ø and length in tenths
  // of a millimetre nominal; the sizes as Vishay's (0617 as the PR03)
  const DIN = { "0204": [3.6, 1.6, 0.5], "0207": [6.5, 2.5, 0.6], "0414": [11.9, 4.2, 0.8], "0617": [16.7, 5.2, 0.78] };
  // the board's axial lead spacings; a body takes the first with room for the bends (Vishay's
  // Mmin: 5 mm for an 0204, 10 for an 0207, 15 for an 0414)
  const AXIAL_PITCH = [7.62, 10.16, 12.7, 15.24, 20.32, 25.4, 30.48, 40.64, 50.8];
  const axialPitch = L => AXIAL_PITCH.find(p => p >= L + 3.2) || null;

  // ---------------------------------------------------------------------------
  // Surface-mount chips: the inch size code from the makers' order codes
  // ---------------------------------------------------------------------------
  const CHIP_CODES = ["0402", "0603", "0805", "1206", "1210", "1812", "2010", "2220", "2512"];
  const METRIC = { 1005: "0402", 1608: "0603", 2012: "0805", 3216: "1206", 3225: "1210", 4532: "1812", 5025: "2010", 5750: "2220", 6332: "2512" };
  const CHIP_RULES = [
    // Murata GRM / GCM / GRT…: 15 0402, 18 0603, 21 0805, 31 1206, 32 1210, 43 1812, 55 2220
    [/^G(?:RM|CM|RT|CJ|CQ|JM)(15|18|21|31|32|43|55)/, m => ({ 15: "0402", 18: "0603", 21: "0805", 31: "1206", 32: "1210", 43: "1812", 55: "2220" })[m[1]], "Murata"],
    // Samsung CL10 0603, CL21 0805, CL31 1206, CL32 1210, CL43 1812, CL55 2220
    [/^CL(05|10|21|31|32|43|55)[A-Z]/, m => ({ "05": "0402", 10: "0603", 21: "0805", 31: "1206", 32: "1210", 43: "1812", 55: "2220" })[m[1]], "Samsung"],
    // TDK C / CGA / CGJ with the metric size
    [/^(?:C|CGA\d|CGJ\d)(1005|1608|2012|3216|3225|4532|5750)/, m => METRIC[m[1]], "TDK"],
    // Panasonic ERJ thick film: 2 0402, 3 0603, 6 0805, 8 1206, 14 1210, 12 1812, 12Z 2010, 1T 2512; ERJ-P anti-surge
    [/^ERJ(?:P|PA|PB|U|H|A)?(1T|12Z|12|14|2|3|6|8)/, m => ({ 2: "0402", 3: "0603", 6: "0805", 8: "1206", 14: "1210", 12: "1812", "12Z": "2010", "1T": "2512" })[m[1]], "Panasonic"],
    [/^ERJP(03|06|08|14)/, m => ({ "03": "0603", "06": "0805", "08": "1206", 14: "1210" })[m[1]], "Panasonic"],
    // KOA RK73 / RN73: 1E 0402, 1J 0603, 2A 0805, 2B 1206, 2E 1210, 2H 2010, 3A 2512
    [/^R[KN]73[A-Z]?(1E|1J|2A|2B|2E|2H|3A)/, m => ({ "1E": "0402", "1J": "0603", "2A": "0805", "2B": "1206", "2E": "1210", "2H": "2010", "3A": "2512" })[m[1]], "KOA"],
    // the others print the inch code itself: Yageo RC / RT / AC / CC, Vishay CRCW / TNPW / VJ,
    // Stackpole RMCF / RNCP, Bourns CR, Kemet C0805…, AVX 0805…, Walsin, Uniroyal…
    [/^(?:RC|RT|AC|AF|CC|CQ|CRCW|TNPW|VJ|RMCF|RNCP|RNCF|CRGCQ|CRG|CR|CRM|ERA|C|WR|WF)?(0402|0603|0805|1206|1210|1812|2010|2220|2512)/, m => m[1], ""]
  ];

  // ---------------------------------------------------------------------------
  // Aluminium electrolytics
  // ---------------------------------------------------------------------------
  // the lead spacing of a radial can (the makers' tables: Nichicon, Panasonic)
  const RADIAL_P = { 5: 2, 6.3: 2.5, 8: 3.5, 10: 5, 12.5: 5, 16: 7.5, 18: 7.5 };
  const LEAD_D = D => (D <= 6.3 ? 0.5 : D <= 12.5 ? 0.6 : 0.8);
  const SNAPIN_D = [20, 22, 25, 30, 35, 40];
  // a size written in the number itself (Rubycon …MEFC8X11.5, most makers' catalogue names): ØD × L
  const DIAMS = [4, 5, 6.3, 8, 10, 12.5, 13, 16, 18, 20, 22, 25, 30, 35, 40, 50];
  function writtenSize(t) {
    const m = /(?<![\d.])(\d{1,2}(?:\.\d)?)[X*×](\d{1,3}(?:\.\d+)?)(?![\d])/.exec(String(t || "").toUpperCase().replace(/\s+/g, ""));
    return m && DIAMS.includes(+m[1]) && +m[2] >= 5 && +m[2] <= 150 ? [+m[1], +m[2]] : null;
  }

  // ---------------------------------------------------------------------------
  // Semiconductors: the package a maker's order code names; the board picks that package's
  // footprint with the part's own pinout
  // ---------------------------------------------------------------------------
  const SEMI = [
    // small-signal SMD transistors and MOSFETs
    [/^(MMBT|MMBF|BC8[0-9]{2}|BCW|BSS|2N7002|BSN|MMBFJ|PMBT|FMMT)/, "SOT-23", "SOT-23 transistor"],
    [/^(BCX5[1-6]|BCP5[1-6]?|PBSS)/, "SOT-89", "SOT-89"], [/^(PZT|BCP|NZT)/, "SOT-223", "SOT-223"],
    [/^(MJD|NJD)/, "DPAK", "DPAK (TO-252)"],
    // IR / Infineon MOSFETs: IRFR… DPAK, IRF…S / …STRL D²PAK, the rest TO-220
    [/^IRFR/, "DPAK", "DPAK (TO-252)"], [/^IRF[A-Z]?\d+[A-Z]*S(TRL|TRR|PBF)?$|^IRF\d+NS/, "D2PAK", "D²PAK (TO-263)"],
    // diodes
    [/^LL4148|^LL41|^LL4448/, "MINIMELF", "MiniMELF (SOD-80)"], [/^1N4148WS|^1N4448WS/, "SOD-323", "SOD-323"], [/^1N4148W|^1N4448W|^B5819W|^BAT54W/, "SOD-123", "SOD-123"],
    [/^(S1[A-M]|US1[A-M]|ES1[A-J]|RS1[A-M]|SS1[2-9]|M[1-7]$|GS1[A-M])/, "SMA", "SMA (DO-214AC)"], [/^(S2[A-M]|US2|ES2|SS2[2-9])/, "SMB", "SMB (DO-214AA)"], [/^(S3[A-M]|US3|ES3|SS3[2-9]|S5|SS5)/, "SMC", "SMC (DO-214AB)"],
    [/^(MMSZ|BZT52)/, "SOD-123", "SOD-123 zener"], [/^BZV55|^ZMM/, "MINIMELF", "MiniMELF zener"], [/^(BZX55|BZX79|1N52|1N9)/, "DIODE-7.62", "DO-35"], [/^(1N47|1N40|1N54|BZX85|UF40|1N53)/, "DIODE-10.16", "DO-41"]
  ];
  // order-code suffixes after the base number: TI / ST / onsemi / ADI conventions
  const IC_SUFFIX = [
    [/(?:D|DR|DT|DG|DR2G|DRG4|DT2G|M|MA|MX|MAX|UA|U|SO|S8)(?:E4|G4|NOPB)?$/, "SOIC"], [/(?:P|N|NA|NE4|PA|PG|NG|CP|CN|IN|PE4|N1)(?:E4|G4|NOPB)?$/, "DIP"]
  ];
  // regulators and references: the case from the suffix (T, CV TO-220; LZ, ACZ, LP TO-92; MDT, DT
  // DPAK; D2T, S D²PAK; EMP, IMP SOT-223; DBZ SOT-23; PK SOT-89)
  const REG_SUFFIX = [[/(?:D2T|D2TR|S|SX|D2PAK)$/, "D2PAK"], [/(?:MDT|DT|DTR|CDT|DPAK)$/, "DPAK"], [/(?:EMP|IMP|DCY|DCYR)$/, "SOT-223"], [/(?:DBZ|DBZR|DBZT)$/, "SOT-23"], [/(?:PK|ACUTR|PKR)$/, "SOT-89"],
    [/(?:LZ|ACZ|LP|LPR|CLP|ILP|Z|ZTR)$/, "TO-92"], [/(?:T|CV|CT|ACT|AT)$/, "TO-220"]];

  const MAKER_WORD = /^(?:Nichicon|Panasonic|Vishay(?: Dale| Beyschlag)?|Dale|Yageo|Kemet|TDK(?: EPCOS)?|EPCOS|Murata|Samsung|KOA(?: Speer)?|Bourns|Rubycon|AVX|KYOCERA AVX|Stackpole|Elna|TI|Texas Instruments|ST|STMicro(?:electronics)?|onsemi|ON Semi(?:conductor)?|Fairchild|NXP|Nexperia|Infineon|IR|Diodes(?: Inc)?|Vishay General Semiconductor)[\s:,]+/i;
  /** What a part number says about the part: null when empty, else
      { maker, text, fp?, pkg?, body?: { kind, l, d, w, h, lead }, warn: [], known: bool }.
      fp: the exact board footprint (passives); pkg: a package family whose footprint with the
      part's pinout the board takes (semiconductors, ICs). */
  function lookup(text, type, params) {
    // a maker's name typed before the number ("Nichicon UKW1H101MPD") is not part of it
    const raw = String(text || "").trim().replace(MAKER_WORD, ""), pn = norm(raw), p = params || {}, warn = [];
    if (!pn) return null;
    const out = (o) => ({ maker: "", warn, known: true, ...o });
    if (type === "resistor") {
      const r = RES.find(([re]) => re.test(pn));
      const chip = chipCode(pn);
      if (chip && !r) return chipResult(chip, out);
      let name = "", L, D, lead, w = 0;
      if (r) { const m = r[0].exec(pn); name = r[1].replace("$1", m[1] || ""); [, , L, D, lead, w] = r; }
      else { const k = Object.keys(DIN).find(c => pn.includes(c)); if (!k) return unknown(raw); [L, D, lead] = DIN[k]; name = "DIN " + k; }
      const P = axialPitch(L);
      if (w && +p.w > w + 1e-9) warn.push(`rated ${fmtW(w)}, the schematic asks for ${fmtW(+p.w)}`);
      return out({ maker: name, fp: P ? "AXIAL-" + P : null, body: { kind: "axial", l: L, d: D, lead }, text: `axial Ø${mm(D)} × ${mm(L)} mm${lead ? `, ${mm(lead)} mm leads` : ""}${P ? `, ${mm(P)} mm spacing` : ""}${w ? `, ${fmtW(w)}` : ""}` });
    }
    if (type === "capacitor") {
      const chip = chipCode(pn);
      if (chip) return chipResult(chip, out);
      // film: TDK (EPCOS) B3252x MKT, the last digit the spacing; Kemet R82 and WIMA's "2" series: 5 mm
      let m = /^B3252([0-46-9])/.exec(pn), P = m ? { 9: 5, 0: 7.5, 1: 10, 2: 15, 3: 22.5, 4: 27.5, 6: 37.5 }[m[1]] : null, maker = m ? "TDK B3252" + m[1] : "";
      if (!P && /^R82/.test(pn)) { P = 5; maker = "Kemet R82"; }
      if (!P && (m = /^(?:WIMA)?(MKS2|FKP2|FKS2|MKP2)/.exec(pn))) { P = 5; maker = "WIMA " + m[1]; }
      if (P) return out({ maker, fp: P <= 27.5 ? "BOX-" + P : null, body: { kind: "box" }, text: `film, ${mm(P)} mm lead spacing` + (P > 27.5 ? " (no board footprint that wide: wire it)" : "") });
      return unknown(raw);
    }
    if (type === "electrolytic") {
      // the case is in the number only when the maker writes it there (Rubycon …MEFC8X11.5);
      // the others' numbers need a look in a parts database
      const ws = writtenSize(raw);
      return ws ? can(ws[0], ws[1], 0, ws[0] >= 22, "", out) : unknown(raw, "the case size isn't in the number: Look up finds it");
    }
    if (/^(diode|zener|npn|pnp|nmos|pmos|njf|pjf)$/.test(type)) {
      const s = SEMI.find(([re]) => re.test(pn));
      return s ? out({ maker: "", pkg: s[1], text: s[2] }) : unknown(raw, "no package code in it: the model's own case");
    }
    if (type === "opamp" || type === "timer555" || type === "chipamp") {
      const model = norm(p.model || (type === "timer555" ? "555" : "")), i = model ? pn.indexOf(model.replace(/^NE|^LM/, "")) : -1;
      const tail = i >= 0 ? pn.slice(i + model.replace(/^NE|^LM/, "").length) : pn.replace(/^[A-Z]*\d+[A-Z]?/, "");
      const s = IC_SUFFIX.find(([re]) => re.test(tail.replace(/-?\d$/, "")));
      if (!s) return unknown(raw);
      const units = (p.model && root.CadLib && root.CadLib.OPAMPS && (root.CadLib.OPAMPS[p.model] || {}).units) || 2, n = type === "opamp" && units === 4 ? 14 : 8;
      return out({ pkg: `${s[1]}-${n}`, text: `${s[1]}-${n} (the order code's “${tail || "?"}”)` });
    }
    if (type === "reg" || type === "tl431") {
      const s = REG_SUFFIX.find(([re]) => re.test(pn.replace(/(G|PBF|NOPB|E4|G4|TR|R)$/, "")) || re.test(pn));
      return s ? out({ pkg: s[1], text: s[1] }) : unknown(raw);
    }
    return null;
  }
  // an electrolytic's can: radial on the board's pattern for its diameter (the makers' spacing
  // unless the database gives one), snap-in from Ø20 mm, screw-terminal cans off the board
  function can(D, L, P, snap, extra, out) {
    const ex = extra ? ", " + extra : "";
    if (D >= 50) return out({ fp: null, body: { kind: "can", d: D, h: L }, text: `screw-terminal can Ø${mm(D)} × ${mm(L)} mm: on the chassis, wired${ex}` });
    if (snap || D >= 20) {
      const sd = SNAPIN_D.find(x => x >= D - 1e-9);
      return out({ fp: sd ? "SNAPIN-D" + sd : null, body: { kind: "radial", d: D, h: L }, text: `snap-in Ø${mm(D)} × ${mm(L)} mm, 10 mm pins${ex}` });
    }
    const Df = RADIAL_P[D] ? D : [5, 6.3, 8, 10, 12.5, 16, 18].find(x => x >= D - 0.05) || 18, Pf = P > 0 ? P : RADIAL_P[Df];
    const r = out({ fp: `RADIAL-D${Df}-P${Pf}`, body: { kind: "radial", d: D, h: L, lead: LEAD_D(D) }, text: `radial Ø${mm(D)} × ${mm(L)} mm, ${mm(Pf)} mm spacing${ex}` });
    if (Math.abs(Df - D) > 0.05) r.warn.push(`no Ø${mm(D)} mm pattern: the Ø${mm(Df)} one`);
    return r;
  }

  // ---------------------------------------------------------------------------
  // What a parts database says about a part (DigiKey's parameters, read by mpn-online.js):
  // specs = { maker, series, pkg ("Package / Case"), device (the supplier's package name), size
  // ("Size / Dimension"), height, lead ("Lead Spacing"), mount, power, voltage, capacitance,
  // source }. The sizes are read from the millimetres the database prints.
  // ---------------------------------------------------------------------------
  const mmOf = t => { const m = String(t || "").match(/\(([^)]*mm[^)]*)\)/), s = m ? m[1] : String(t || ""); return (s.match(/[\d.]+(?=\s*mm)/g) || []).map(Number); };
  const PKG = [[/SOT-?23|TO-236/i, "SOT-23"], [/SOT-?89|TO-243/i, "SOT-89"], [/SOT-?223|TO-261/i, "SOT-223"], [/TO-?252|DPAK(?!\w)/i, "DPAK"], [/TO-?263|D2PAK|D²PAK/i, "D2PAK"],
    [/TO-?220/i, "TO-220"], [/TO-?92|TO-226/i, "TO-92"], [/TO-?126|TO-225/i, "TO-126"], [/TO-?247/i, "TO-247"], [/TO-?3P/i, "TO-3P"], [/TO-?264/i, "TO-264"], [/TO-?18|TO-206AA/i, "TO-18"],
    [/SOD-?123/i, "SOD-123"], [/SOD-?323/i, "SOD-323"], [/MiniMELF|SOD-?80|LL-?34/i, "MINIMELF"], [/DO-?214AC|\bSMA\b/i, "SMA"], [/DO-?214AA|\bSMB\b/i, "SMB"], [/DO-?214AB|\bSMC\b/i, "SMC"],
    [/DO-?35|DO-?204AH/i, "DIODE-7.62"], [/DO-?41|DO-?204AL/i, "DIODE-10.16"], [/DO-?201/i, "DO-201AD"]];
  function fromSpecs(sp, type, params) {
    sp = sp || {}; const p = params || {}, warn = [];
    const out = o => ({ maker: [sp.maker, sp.series].filter(Boolean).join(" "), warn, known: true, source: sp.source || "", ...o });
    const all = [sp.pkg, sp.device].join(" "), size = mmOf(sp.size), H = mmOf(sp.height)[0], P = mmOf(sp.lead)[0];
    const watts = parseFloat(String(sp.power || "").replace(/.*?([\d.]+)\s*W.*/i, "$1")), volts = parseFloat(String(sp.voltage || "").replace(/.*?([\d.]+)\s*V.*/i, "$1"));
    if (type === "resistor" && watts > 0 && +p.w > watts + 1e-9) warn.push(`rated ${fmtW(watts)}, the schematic asks for ${fmtW(+p.w)}`);
    if ((type === "electrolytic" || type === "capacitor") && volts > 0 && +p.v > volts + 1e-9) warn.push(`rated ${mm(volts)} V, the schematic asks for ${mm(+p.v)} V`);
    // "100 µF", "0.1 µF", "470 pF": the schematic's value checked against the part's
    const cm = /([\d.]+)\s*([pnuµm]?)F\b/.exec(String(sp.capacitance || "")), farads = cm ? +cm[1] * ({ p: 1e-12, n: 1e-9, u: 1e-6, "µ": 1e-6, m: 1e-3 }[cm[2]] || 1) : 0;
    if (/capacitor|electrolytic/.test(type) && farads > 0 && +p.c > 0 && Math.abs(+p.c / farads - 1) > 0.01) warn.push(`a ${capText(farads)} part, the schematic has ${capText(+p.c)}`);
    const ratings = [watts > 0 && type === "resistor" ? fmtW(watts) : "", volts > 0 && /capacitor|electrolytic/.test(type) ? mm(volts) + " V" : ""].filter(Boolean).join(", ");
    // a chip, by its inch code ("0805 (2012 Metric)")
    const chip = /\b(0402|0603|0805|1206|1210|1812|2010|2220|2512)\b/.exec(all);
    if (chip && /resistor|capacitor|inductor/.test(type)) { const r = chipResult({ code: chip[1], maker: "" }, out); if (ratings) r.text += ", " + ratings; return r; }
    if (type === "electrolytic") {
      if (!size.length) return out({ known: false, text: "the database gives no size" });
      return can(size[0], H || size[1] || size[0] * 1.6, P, /snap/i.test(all + " " + sp.mount), ratings, out);
    }
    if (type === "resistor" || (type === "capacitor" && /axial/i.test(all))) {
      // "0.091\" Dia x 0.248\" L (2.30mm x 6.30mm)": Ø, then length
      if (size.length < 2) return out({ known: false, text: "the database gives no body size" });
      const [D, L] = size, Pa = axialPitch(L);
      return out({ fp: Pa ? "AXIAL-" + Pa : null, body: { kind: "axial", l: L, d: D }, text: `axial Ø${mm(D)} × ${mm(L)} mm${Pa ? `, ${mm(Pa)} mm spacing` : ""}${ratings ? ", " + ratings : ""}` });
    }
    if (type === "capacitor") {
      const pitches = [5, 7.5, 10, 15, 22.5, 27.5], Pb = P > 0 ? pitches.find(x => Math.abs(x - P) < 0.3) : null;
      // a disc: its Ø, on the nearest of the board's disc spacings
      if (/disc/i.test(all) || (size.length === 1 && P > 0)) {
        const Pd = [2.54, 5.08, 7.62].reduce((a, b) => (Math.abs(b - P) < Math.abs(a - P) ? b : a), 5.08);
        return out({ fp: `DISC-${Pd}`, body: size[0] ? { kind: "disc", d: size[0] } : null, text: `disc${size[0] ? ` Ø${mm(size[0])} mm` : ""}, ${mm(P || Pd)} mm spacing${ratings ? ", " + ratings : ""}` });
      }
      if (Pb) return out({ fp: `BOX-${Pb}`, body: { kind: "box", l: size[0], w: size[1], h: H }, text: `box ${size.length >= 2 ? `${mm(size[0])} × ${mm(size[1])}${H ? ` × ${mm(H)}` : ""} mm, ` : ""}${mm(Pb)} mm spacing${ratings ? ", " + ratings : ""}` });
      return out({ known: false, text: `${sp.pkg || "a package"} with ${P ? mm(P) + " mm" : "no"} lead spacing: no pattern for it here` });
    }
    // ICs: DIP / SOIC with the pin count
    let m = /(\d+)-(?:DIP|PDIP)|DIP-?(\d+)/i.exec(all);
    if (m) return out({ pkg: `DIP-${m[1] || m[2]}`, text: `DIP-${m[1] || m[2]}` });
    if ((m = /(\d+)-SOIC|SOIC-?(\d+)|(\d+)-SO\b/i.exec(all))) return out({ pkg: `SOIC-${m[1] || m[2] || m[3]}`, text: `SOIC-${m[1] || m[2] || m[3]}` });
    const k = PKG.find(([re]) => re.test(all));
    return k ? out({ pkg: k[1], text: sp.pkg || k[1] }) : out({ known: false, text: `${sp.pkg || "its package"}: no pattern for it here` });
  }
  const unknown = (raw, text) => ({ maker: "", warn: [], known: false, text: text || "not recognised: the footprint stays as chosen" });
  function chipCode(pn) {
    for (const [re, f, maker] of CHIP_RULES) { const m = re.exec(pn); if (m) { const code = f(m); if (code) return { code, maker }; } }
    return null;
  }
  function chipResult(c, out) {
    if (c.code === "0402") return out({ maker: c.maker, fp: null, body: { kind: "chip" }, text: "0402 chip: too small for this board's patterns (0603 and up)", warn: ["no 0402 pattern"] });
    return out({ maker: c.maker, fp: "CHIP-" + c.code, body: { kind: "chip" }, text: `${c.code} chip` });
  }
  const capText = f => (f >= 1e-6 ? mm(f * 1e6) + " µF" : f >= 1e-9 ? mm(f * 1e9) + " nF" : mm(f * 1e12) + " pF");
  const fmtW = w => (w >= 1 ? mm(w) + " W" : w === 1 / 6 ? "1/6 W" : `1/${Math.round(1 / w)} W`);
  // one line for the BOM and the inspector: "Nichicon UKW · radial Ø8 × 11.5 mm, 3.5 mm spacing"
  const describe = r => (r ? [r.maker, r.text].filter(Boolean).join(" · ") : "");
  // the footprint a part number picks among a part's options; null to leave the part as it is
  function footprintFor(r, options) {
    if (!r || !r.known) return null;
    if (r.fp) return r.fp;
    if (!r.pkg) return null;
    return (options || []).find(o => o === r.pkg || o.startsWith(r.pkg + "-")) || null;
  }

  // The part a number names, saved with the circuit (params.part = { no, maker, text, fp | pkg,
  // body }): the file keeps the real part's package and size, whatever later tables say. keep(c)
  // brings the record up to date with the part number (true when it changed); resolve() reads the
  // record over the tables, the disagreements with the schematic worked out afresh.
  // record(no, result): the part as the file keeps it ({ no, maker, text, fp | pkg, body, source,
  // url, specs }: specs the database's own words, so the warnings can be worked out again)
  function record(no, r, extra) {
    const rec = { no, maker: r.maker || "", text: r.text };
    if (r.fp) rec.fp = r.fp;
    if (r.pkg) rec.pkg = r.pkg;
    if (r.body) rec.body = { ...r.body };
    return Object.assign(rec, extra || {});
  }
  function keep(c) {
    const p = c && c.params; if (!p) return false;
    const no = norm(p.partno);
    if (no && p.part && p.part.no === no) return false;
    const r = no ? lookup(p.partno, c.type, p) : null;
    if (r && r.known) { p.part = record(no, r); return true; }
    if (!p.part) return false;
    delete p.part; return true;
  }
  function resolve(params, type) {
    const p = params || {}, r = lookup(p.partno, type, p), s = p.part;
    if (!s || !r || s.no !== norm(p.partno)) return r;
    const warn = s.specs ? fromSpecs(s.specs, type, p).warn : r.known ? r.warn : [];
    return { maker: s.maker || "", text: s.text || "", fp: s.fp || null, pkg: s.pkg || null, body: s.body || null, warn, known: true, saved: true, source: s.source || "", url: s.url || "" };
  }

  root.PartNo = { lookup, fromSpecs, record, resolve, keep, describe, mmOf, footprintFor, norm, writtenSize, axialPitch, CHIP_CODES };
})(typeof window !== "undefined" ? window : globalThis);
