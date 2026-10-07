/* Vector PDF export. PdfCanvas implements the part of the canvas 2D context the
   schematic drawing code uses (paths, arcs, rectangles, transforms, dashes,
   text), so the CAD draws a sheet into it exactly as it draws on screen.
   Output is black on white, as for a printed IEC 61082 document: dark fills
   (symbol interiors, the title block) become white, every line and text black.
   Text uses the PDF standard fonts Courier / Courier-Bold (WinAnsiEncoding);
   Ω and → are drawn as small vector glyphs, other characters outside the
   encoding print as "?". */
(function (root) {
  "use strict";
  const WIN = { "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c, "Ž": 0x8e,
    "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b, "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f };
  const SUBST = { "−": "-", "≈": "~", "·": "·", "▸": ">", "▴": "^", "▾": "v", "↗": "" };
  const ADV = 0.6;                                       // Courier advance, em
  const num = v => (Math.abs(v) < 1e-9 ? 0 : +v.toFixed(3));

  // luminance of a CSS colour: dark = paper (white), anything else = ink (black)
  function ink(css) {
    if (!css || typeof css !== "string") return 0;
    let r = 0, g = 0, b = 0, m;
    if ((m = css.match(/^#([0-9a-f]{3})$/i))) { [r, g, b] = m[1].split("").map(h => parseInt(h + h, 16)); }
    else if ((m = css.match(/^#([0-9a-f]{6})/i))) { r = parseInt(m[1].slice(0, 2), 16); g = parseInt(m[1].slice(2, 4), 16); b = parseInt(m[1].slice(4, 6), 16); }
    else if ((m = css.match(/rgba?\(([^)]+)\)/))) { [r, g, b] = m[1].split(",").map(parseFloat); }
    else return 0;
    return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.2 ? 1 : 0;   // 1 = white, 0 = black
  }

  class PdfCanvas {
    /** page: { widthPt, heightPt, k (pt per drawing unit), ox, oy (drawing point at the page's top left) } */
    constructor(page) {
      this.page = page; this.out = [];
      this.st = { m: [1, 0, 0, 1, 0, 0], lineWidth: 1, strokeStyle: "#000", fillStyle: "#000", font: "10px monospace", textAlign: "left", textBaseline: "alphabetic", dash: [], lineCap: "butt", globalAlpha: 1 };
      this.stack = []; this.path = [];
      ["lineWidth", "strokeStyle", "fillStyle", "font", "textAlign", "textBaseline", "lineCap", "globalAlpha", "lineJoin"].forEach(p =>
        Object.defineProperty(this, p, { get: () => this.st[p], set: v => { this.st[p] = v; } }));
    }
    // user point -> PDF point
    P(x, y) {
      const [a, b, c, d, e, f] = this.st.m, X = a * x + c * y + e, Y = b * x + d * y + f, p = this.page;
      return [(X - p.ox) * p.k, p.heightPt - (Y - p.oy) * p.k];
    }
    scaleOf() { const [a, b, c, d] = this.st.m; return Math.sqrt(Math.abs(a * d - b * c)) * this.page.k; }
    save() { this.stack.push(JSON.parse(JSON.stringify(this.st))); }
    restore() { if (this.stack.length) this.st = this.stack.pop(); }
    setTransform(a, b, c, d, e, f) { this.st.m = [a, b, c, d, e, f]; }
    transform(a2, b2, c2, d2, e2, f2) { const [a, b, c, d, e, f] = this.st.m; this.st.m = [a * a2 + c * b2, b * a2 + d * b2, a * c2 + c * d2, b * c2 + d * d2, a * e2 + c * f2 + e, b * e2 + d * f2 + f]; }
    translate(x, y) { this.transform(1, 0, 0, 1, x, y); }
    rotate(t) { const c = Math.cos(t), s = Math.sin(t); this.transform(c, s, -s, c, 0, 0); }
    scale(x, y) { this.transform(x, 0, 0, y, 0, 0); }
    setLineDash(d) { this.st.dash = (d || []).slice(); }
    getLineDash() { return this.st.dash.slice(); }
    beginPath() { this.path = []; this.cur = null; }
    moveTo(x, y) { const [X, Y] = this.P(x, y); this.path.push(`${num(X)} ${num(Y)} m`); this.cur = [x, y]; this.start = [x, y]; }
    lineTo(x, y) { if (!this.cur) return this.moveTo(x, y); const [X, Y] = this.P(x, y); this.path.push(`${num(X)} ${num(Y)} l`); this.cur = [x, y]; }
    bezierCurveTo(x1, y1, x2, y2, x, y) {
      if (!this.cur) this.moveTo(x1, y1);
      const a = this.P(x1, y1), b = this.P(x2, y2), c = this.P(x, y);
      this.path.push(`${num(a[0])} ${num(a[1])} ${num(b[0])} ${num(b[1])} ${num(c[0])} ${num(c[1])} c`); this.cur = [x, y];
    }
    closePath() { if (this.path.length) this.path.push("h"); if (this.start) this.cur = this.start.slice(); }
    rect(x, y, w, h) { this.moveTo(x, y); this.lineTo(x + w, y); this.lineTo(x + w, y + h); this.lineTo(x, y + h); this.closePath(); }
    arc(cx, cy, r, a0, a1, ccw) {
      const TAU = 2 * Math.PI;
      let sweep = ccw ? a0 - a1 : a1 - a0;
      if (sweep >= TAU - 1e-9 || sweep <= -(TAU - 1e-9)) sweep = TAU; else { sweep = ((sweep % TAU) + TAU) % TAU; }
      if (ccw) sweep = -sweep;
      const sx = cx + r * Math.cos(a0), sy = cy + r * Math.sin(a0);
      this.cur ? this.lineTo(sx, sy) : this.moveTo(sx, sy);
      const n = Math.max(1, Math.ceil(Math.abs(sweep) / (Math.PI / 2))), da = sweep / n, kk = 4 / 3 * Math.tan(da / 4);
      let a = a0;
      for (let i = 0; i < n; i++) {
        const c0 = Math.cos(a), s0 = Math.sin(a), c1 = Math.cos(a + da), s1 = Math.sin(a + da);
        this.bezierCurveTo(cx + r * (c0 - kk * s0), cy + r * (s0 + kk * c0), cx + r * (c1 + kk * s1), cy + r * (s1 - kk * c1), cx + r * c1, cy + r * s1);
        a += da;
      }
    }
    _style(stroke) {
      const s = this.scaleOf(), g = ink(stroke ? this.st.strokeStyle : this.st.fillStyle);
      let o = stroke ? `${g} G ${num(Math.max(0.1, this.st.lineWidth * s))} w ${this.st.lineCap === "round" ? 1 : this.st.lineCap === "square" ? 2 : 0} J 1 j` : `${g} g`;
      if (stroke) o += ` [${this.st.dash.map(v => num(v * s)).join(" ")}] 0 d`;
      return o;
    }
    stroke() { if (this.path.length && this.st.globalAlpha > 0.5) this.out.push(`${this._style(true)}\n${this.path.join("\n")}\nS`); }
    fill() { if (this.path.length && this.st.globalAlpha > 0.5) this.out.push(`${this._style(false)}\n${this.path.join("\n")}\nf`); }
    clip() {}
    fillRect(x, y, w, h) { const keep = [this.path, this.cur, this.start]; this.beginPath(); this.rect(x, y, w, h); this.fill(); [this.path, this.cur, this.start] = keep; }
    strokeRect(x, y, w, h) { const keep = [this.path, this.cur, this.start]; this.beginPath(); this.rect(x, y, w, h); this.stroke(); [this.path, this.cur, this.start] = keep; }
    clearRect() {}
    _font() { const m = String(this.st.font).match(/(bold\s+)?([\d.]+)px/); return { bold: !!(m && m[1]), size: m ? parseFloat(m[2]) : 10 }; }
    measureText(t) { return { width: String(t).length * ADV * this._font().size }; }
    fillText(text, x, y) {
      if (this.st.globalAlpha <= 0.5) return;
      text = String(text).replace(/[−≈▸▴▾↗]/g, ch => SUBST[ch]);
      const { bold, size } = this._font(), w = text.length * ADV * size;
      const dx = this.st.textAlign === "center" ? -w / 2 : (this.st.textAlign === "right" || this.st.textAlign === "end") ? -w : 0;
      const bl = { top: 0.78, hanging: 0.62, middle: 0.32, bottom: -0.22, ideographic: -0.22 }[this.st.textBaseline] || 0;
      const x0 = x + dx, y0 = y + bl * size;
      // split into runs the font can encode and glyphs drawn as paths
      let run = "", runX = x0;
      const flush = (endX) => { if (run) this._text(run, runX, y0, size, bold); run = ""; runX = endX; };
      [...text].forEach((ch, i) => {
        const cx = x0 + i * ADV * size;
        if (ch === "Ω" || ch === "→") { flush(cx); this._glyph(ch, cx, y0, size, bold); runX = cx + ADV * size; return; }
        if (!run) runX = cx;
        run += ch;
      });
      flush(0);
    }
    _text(t, x, y, size, bold) {
      let s = "";
      for (const ch of t) {
        let c = ch.codePointAt(0);
        if (WIN[ch]) c = WIN[ch]; else if (c > 0xff) c = 63;   // "?"
        s += c === 40 || c === 41 || c === 92 ? "\\" + ch : c < 32 || c > 126 ? "\\" + c.toString(8).padStart(3, "0") : ch;
      }
      const o = this.P(x, y), ux = this.P(x + 1, y), uy = this.P(x, y - 1);
      const a = ux[0] - o[0], b = ux[1] - o[1], c = uy[0] - o[0], d = uy[1] - o[1];
      this.out.push(`BT ${ink(this.st.fillStyle)} g /${bold ? "F2" : "F1"} ${num(size)} Tf ${num(a)} ${num(b)} ${num(c)} ${num(d)} ${num(o[0])} ${num(o[1])} Tm (${s}) Tj ET`);
    }
    _glyph(ch, x, y, size, bold) {
      const keep = [this.path, this.cur, this.start, this.st.strokeStyle, this.st.lineWidth, this.st.lineCap, this.st.dash];
      this.st.strokeStyle = this.st.fillStyle; this.st.lineWidth = size * (bold ? 0.11 : 0.08); this.st.lineCap = "butt"; this.st.dash = [];
      const s = size, w = ADV * s;
      this.beginPath();
      if (ch === "Ω") {
        const cx = x + w / 2, cy = y - 0.36 * s, r = 0.24 * s;
        this.arc(cx, cy, r, Math.PI * 0.72, Math.PI * 2.28, false);
        this.moveTo(cx - r * 0.62, y - 0.04 * s); this.lineTo(cx - r * 0.62, y - 0.17 * s); this.moveTo(x + 0.06 * s, y - 0.04 * s); this.lineTo(cx - r * 0.25, y - 0.04 * s);
        this.moveTo(cx + r * 0.62, y - 0.04 * s); this.lineTo(cx + r * 0.62, y - 0.17 * s); this.moveTo(cx + r * 0.25, y - 0.04 * s); this.lineTo(x + w - 0.06 * s, y - 0.04 * s);
      } else {   // →
        const ym = y - 0.3 * s;
        this.moveTo(x + 0.04 * s, ym); this.lineTo(x + w - 0.04 * s, ym);
        this.moveTo(x + w - 0.2 * s, ym - 0.14 * s); this.lineTo(x + w - 0.04 * s, ym); this.lineTo(x + w - 0.2 * s, ym + 0.14 * s);
      }
      this.stroke();
      [this.path, this.cur, this.start, this.st.strokeStyle, this.st.lineWidth, this.st.lineCap, this.st.dash] = keep;
    }
  }

  /** Assemble a one-page PDF. Returns a Uint8Array. */
  function buildPdf(page, draw, meta) {
    const c = new PdfCanvas(page);
    draw(c);
    const content = c.out.join("\n");
    // Info strings in PDFDocEncoding (Latin-1 range as octal escapes)
    const esc = t => [...String(t || "")].map(ch => { const c = ch.codePointAt(0); return ch === "(" || ch === ")" || ch === "\\" ? "\\" + ch : c >= 32 && c <= 126 ? ch : c <= 0xff ? "\\" + c.toString(8).padStart(3, "0") : "?"; }).join("");
    const objs = [
      "<< /Type /Catalog /Pages 2 0 R >>",
      "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${num(page.widthPt)} ${num(page.heightPt)}] /Resources << /Font << /F1 4 0 R /F2 5 0 R >> >> /Contents 6 0 R >>`,
      "<< /Type /Font /Subtype /Type1 /BaseFont /Courier /Encoding /WinAnsiEncoding >>",
      "<< /Type /Font /Subtype /Type1 /BaseFont /Courier-Bold /Encoding /WinAnsiEncoding >>",
      `<< /Length ${content.length} >>\nstream\n${content}\nendstream`,
      `<< /Title (${esc(meta && meta.title)}) /Creator (Tube Amp CAD) /Producer (Tube Amp CAD) >>`
    ];
    let pdf = "%PDF-1.4\n%âãÏÓ\n";
    const offs = [];
    objs.forEach((o, i) => { offs.push(pdf.length); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
    const xref = pdf.length;
    pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offs.map(o => String(o).padStart(10, "0") + " 00000 n \n").join("");
    pdf += `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R /Info 7 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(pdf.length);
    for (let i = 0; i < pdf.length; i++) bytes[i] = pdf.charCodeAt(i) & 0xff;
    return bytes;
  }

  root.PdfExport = { PdfCanvas, buildPdf, ink };
})(typeof window !== "undefined" ? window : globalThis);
