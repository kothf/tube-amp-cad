/* =============================================================================
   BOARD DESIGN — the 3D viewer: a small WebGL renderer for Board3D solids (flat faces,
   round sides shaded smooth, the board's top and bottom carrying the copper, mask and silkscreen as a
   texture, glass drawn last and see-through), with an orbit camera: drag to turn,
   right- or middle-drag to pan, wheel to zoom. Used for the whole board and for the
   preview of one part in the inspector. Measuring (measure = true): a click without a drag
   picks the nearest surface under the pointer (a ray against the triangles), sticking to a
   corner of the triangle it hits when one is within 10 px; two picks give the distance in 3D.
   The picks, their line and value are drawn on the overlay canvas; onMeasure(picks) is told.
   Depends on: board-3d.js
   ============================================================================= */
(function (root) {
  "use strict";
  const VS = `attribute vec3 p; attribute vec3 n; attribute vec4 c; attribute vec2 uv;
    uniform mat4 mvp; varying vec3 vn; varying vec4 vc; varying vec2 vuv;
    void main() { vn = n; vc = c; vuv = uv; gl_Position = mvp * vec4(p, 1.0); }`;
  const FS = `precision mediump float; uniform sampler2D tex; uniform float useTex; uniform vec3 eye;
    varying vec3 vn; varying vec4 vc; varying vec2 vuv;
    void main() {
      vec3 N = normalize(vn);
      vec4 col = vc;
      if (useTex > 0.5) { vec4 t = texture2D(tex, vuv); if (t.a < 0.5) discard; col = vec4(t.rgb, 1.0); }
      float l = 0.38 + 0.55 * max(dot(N, normalize(vec3(0.35, -0.45, 0.82))), 0.0) + 0.22 * max(dot(N, normalize(vec3(-0.6, 0.5, 0.3))), 0.0);
      float rim = col.a < 0.99 ? 0.25 * pow(1.0 - abs(dot(N, normalize(eye))), 2.0) : 0.0;
      gl_FragColor = vec4(col.rgb * l + rim, max(col.a, rim));
    }`;
  // 4×4 matrices, column-major
  function persp(fov, asp, n, f) { const t = 1 / Math.tan(fov / 2); return [t / asp, 0, 0, 0, 0, t, 0, 0, 0, 0, (f + n) / (n - f), -1, 0, 0, 2 * f * n / (n - f), 0]; }
  function lookAt(e, c, up) {
    const z = norm([e[0] - c[0], e[1] - c[1], e[2] - c[2]]), x = norm(cross(up, z)), y = cross(z, x);
    return [x[0], y[0], z[0], 0, x[1], y[1], z[1], 0, x[2], y[2], z[2], 0, -dot(x, e), -dot(y, e), -dot(z, e), 1];
  }
  function mul(a, b) { const o = new Array(16).fill(0); for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) o[j * 4 + i] += a[k * 4 + i] * b[j * 4 + k]; return o; }
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]], dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
  const norm = v => { const l = Math.hypot(v[0], v[1], v[2]) || 1; return [v[0] / l, v[1] / l, v[2] / l]; };

  class Viewer3D {
    constructor(canvas, opts) {
      this.canvas = canvas; this.opts = opts || {};
      const gl = canvas.getContext("webgl", { antialias: true, preserveDrawingBuffer: true, alpha: false });
      this.gl = gl; if (!gl) return;
      const sh = (t, src) => { const s = gl.createShader(t); gl.shaderSource(s, src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s)); return s; };
      const pr = gl.createProgram(); gl.attachShader(pr, sh(gl.VERTEX_SHADER, VS)); gl.attachShader(pr, sh(gl.FRAGMENT_SHADER, FS)); gl.linkProgram(pr); gl.useProgram(pr);
      this.pr = pr; this.loc = { p: gl.getAttribLocation(pr, "p"), n: gl.getAttribLocation(pr, "n"), c: gl.getAttribLocation(pr, "c"), uv: gl.getAttribLocation(pr, "uv"), mvp: gl.getUniformLocation(pr, "mvp"), useTex: gl.getUniformLocation(pr, "useTex"), eye: gl.getUniformLocation(pr, "eye"), tex: gl.getUniformLocation(pr, "tex") };
      this.batches = []; this.picks = []; this.cam = { yaw: -Math.PI / 2 - 0.5, pitch: 0.75, dist: 200, target: [0, 0, 0] }; this.spin = !!this.opts.spin;
      this.bind();
    }
    get ok() { return !!this.gl; }
    // solids -> batches: { buf, count, tex, glass }. textures: { top, bottom } canvases for the board's faces
    setScene(solids, textures, frame) {
      const gl = this.gl; if (!gl) return;
      this.batches.forEach(b => gl.deleteBuffer(b.buf)); (this.texs || []).forEach(t => gl.deleteTexture(t));
      this.batches = []; this.texs = [];
      const groups = { solid: [], glass: [], top: [], bottom: [] };
      let lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
      solids.forEach(s => {
        const V = s.verts, uvOf = p => (s.uv ? [p[0] / s.uv.w, -p[1] / s.uv.h] : [0, 0]);
        V.forEach(p => { for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k], p[k]); hi[k] = Math.max(hi[k], p[k]); } });
        s.faces.forEach(f => {
          const top = s.board && f.n[2] > 0.99, bottom = s.board && f.n[2] < -0.99, g = top && textures && textures.top ? "top" : bottom && textures && textures.bottom ? "bottom" : s.alpha < 1 ? "glass" : "solid";
          const L = f.loops[0], col = [...s.color, s.alpha < 1 ? s.alpha : 1];
          for (let i = 1; i + 1 < L.length; i++) [0, i, i + 1].forEach(j => { const p = V[L[j]]; groups[g].push(...p, ...(f.vn ? f.vn[j] : f.n), ...col, ...uvOf(p)); });
        });
      });
      // the triangles' corners for picking (12 floats per corner: position, normal, colour, uv)
      const n = Object.values(groups).reduce((s, a) => s + a.length / 12, 0), T = new Float32Array(n * 3); let w = 0;
      Object.values(groups).forEach(a => { for (let i = 0; i < a.length; i += 12) { T[w++] = a[i]; T[w++] = a[i + 1]; T[w++] = a[i + 2]; } });
      this.tris = T;
      Object.entries(groups).forEach(([k, a]) => {
        if (!a.length) return;
        const buf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(a), gl.STATIC_DRAW);
        let tex = null;
        if ((k === "top" || k === "bottom") && textures[k]) {
          tex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, tex); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, textures[k]);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
          gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
          this.texs.push(tex);
        }
        this.batches.push({ k, buf, count: a.length / 12, tex });
      });
      this.bounds = { lo, hi };
      if (frame !== false) this.view(this.lastView || "iso");
      this.draw();
    }
    // camera presets: iso, top, bottom, front, side
    view(name) {
      this.lastView = name;
      const b = this.bounds; if (!b) return;
      const c = [(b.lo[0] + b.hi[0]) / 2, (b.lo[1] + b.hi[1]) / 2, (b.lo[2] + b.hi[2]) / 2], size = Math.max(b.hi[0] - b.lo[0], b.hi[1] - b.lo[1], b.hi[2] - b.lo[2], 5);
      const V = { iso: [-Math.PI / 2 - 0.5, 0.72], top: [-Math.PI / 2, Math.PI / 2 - 0.001], bottom: [-Math.PI / 2, -Math.PI / 2 + 0.001], front: [-Math.PI / 2, 0.12], side: [0, 0.12] }[name] || [-Math.PI / 2 - 0.5, 0.72];
      Object.assign(this.cam, { yaw: V[0], pitch: V[1], dist: size * 1.8, target: c });
      this.draw();
    }
    eye() { const c = this.cam; return [c.target[0] + c.dist * Math.cos(c.pitch) * Math.cos(c.yaw), c.target[1] + c.dist * Math.cos(c.pitch) * Math.sin(c.yaw), c.target[2] + c.dist * Math.sin(c.pitch)]; }
    draw() {
      const gl = this.gl, cv = this.canvas; if (!gl || !cv.isConnected) return;
      const dpr = root.devicePixelRatio || 1, W = Math.max(1, Math.round(cv.clientWidth * dpr)), H = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
      gl.viewport(0, 0, W, H); gl.clearColor(...(this.opts.bg || [0.03, 0.045, 0.065]), 1); gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
      gl.enable(gl.DEPTH_TEST);
      const e = this.eye(), up = Math.abs(Math.cos(this.cam.pitch)) < 0.01 ? [0, 1, 0] : [0, 0, 1];
      const mvp = mul(persp(0.6, W / H, Math.max(0.1, this.cam.dist / 200), this.cam.dist * 10), lookAt(e, this.cam.target, up));
      this.mvp = mvp;
      gl.uniformMatrix4fv(this.loc.mvp, false, new Float32Array(mvp)); gl.uniform3fv(this.loc.eye, new Float32Array(norm([e[0] - this.cam.target[0], e[1] - this.cam.target[1], e[2] - this.cam.target[2]])));
      const L = this.loc, order = ["solid", "top", "bottom", "glass"];
      order.forEach(k => this.batches.filter(b => b.k === k).forEach(b => {
        gl.bindBuffer(gl.ARRAY_BUFFER, b.buf);
        const st = 48; gl.enableVertexAttribArray(L.p); gl.vertexAttribPointer(L.p, 3, gl.FLOAT, false, st, 0);
        gl.enableVertexAttribArray(L.n); gl.vertexAttribPointer(L.n, 3, gl.FLOAT, false, st, 12);
        gl.enableVertexAttribArray(L.c); gl.vertexAttribPointer(L.c, 4, gl.FLOAT, false, st, 24);
        gl.enableVertexAttribArray(L.uv); gl.vertexAttribPointer(L.uv, 2, gl.FLOAT, false, st, 40);
        gl.uniform1f(L.useTex, b.tex ? 1 : 0);
        if (b.tex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, b.tex); gl.uniform1i(L.tex, 0); }
        if (k === "glass") { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); gl.disable(gl.CULL_FACE); }
        else { gl.disable(gl.BLEND); gl.depthMask(true); }
        gl.drawArrays(gl.TRIANGLES, 0, b.count);
      }));
      gl.depthMask(true); gl.disable(gl.BLEND);
      this.drawOverlay();
    }
    // a model point on the screen (css px), or null behind the camera
    project(p) {
      const m = this.mvp, cv = this.canvas; if (!m) return null;
      const x = m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12], y = m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13], w = m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15];
      if (w <= 1e-9) return null;
      return [(x / w + 1) / 2 * cv.clientWidth, (1 - y / w) / 2 * cv.clientHeight];
    }
    // the surface under a screen point (css px): { p: [x, y, z], what: corner | surface } or null
    pick(sx, sy) {
      const T = this.tris, cv = this.canvas; if (!T || !T.length) return null;
      const Wc = cv.clientWidth || 1, Hc = cv.clientHeight || 1, e = this.eye(), up = Math.abs(Math.cos(this.cam.pitch)) < 0.01 ? [0, 1, 0] : [0, 0, 1];
      const f = norm([this.cam.target[0] - e[0], this.cam.target[1] - e[1], this.cam.target[2] - e[2]]), r = norm(cross(f, up)), u = cross(r, f), k = Math.tan(0.3);
      const nx = (sx / Wc) * 2 - 1, ny = 1 - (sy / Hc) * 2, d = norm([0, 1, 2].map(i => f[i] + nx * k * (Wc / Hc) * r[i] + ny * k * u[i]));
      let best = Infinity, hit = -1;
      for (let i = 0; i < T.length; i += 9) {
        // Möller–Trumbore
        const e1x = T[i + 3] - T[i], e1y = T[i + 4] - T[i + 1], e1z = T[i + 5] - T[i + 2], e2x = T[i + 6] - T[i], e2y = T[i + 7] - T[i + 1], e2z = T[i + 8] - T[i + 2];
        const px = d[1] * e2z - d[2] * e2y, py = d[2] * e2x - d[0] * e2z, pz = d[0] * e2y - d[1] * e2x, det = e1x * px + e1y * py + e1z * pz;
        if (Math.abs(det) < 1e-12) continue;
        const inv = 1 / det, tx = e[0] - T[i], ty = e[1] - T[i + 1], tz = e[2] - T[i + 2], uu = (tx * px + ty * py + tz * pz) * inv; if (uu < 0 || uu > 1) continue;
        const qx = ty * e1z - tz * e1y, qy = tz * e1x - tx * e1z, qz = tx * e1y - ty * e1x, vv = (d[0] * qx + d[1] * qy + d[2] * qz) * inv; if (vv < 0 || uu + vv > 1) continue;
        const t = (e2x * qx + e2y * qy + e2z * qz) * inv; if (t > 1e-6 && t < best) { best = t; hit = i; }
      }
      if (hit < 0) return null;
      const p = [0, 1, 2].map(i => e[i] + d[i] * best);
      // stick to a corner of the triangle hit when one is near on the screen
      let snapD = 10, snapP = null;
      for (let j = 0; j < 3; j++) { const q = [T[hit + j * 3], T[hit + j * 3 + 1], T[hit + j * 3 + 2]], s = this.project(q); if (s && Math.hypot(s[0] - sx, s[1] - sy) < snapD) { snapD = Math.hypot(s[0] - sx, s[1] - sy); snapP = q; } }
      return snapP ? { p: snapP, what: "corner" } : { p, what: "surface" };
    }
    setMeasure(on) { this.measure = !!on; this.picks = []; this.canvas.style.cursor = on ? "crosshair" : ""; if (this.onMeasure) this.onMeasure(this.picks); this.draw(); }
    clearPicks() { this.picks = []; if (this.onMeasure) this.onMeasure(this.picks); this.draw(); }
    // the picks, the line between them and its length, on the overlay canvas
    drawOverlay() {
      const ov = this.overlay; if (!ov) return;
      const dpr = root.devicePixelRatio || 1, W = Math.round(ov.clientWidth * dpr), H = Math.round(ov.clientHeight * dpr);
      if (ov.width !== W || ov.height !== H) { ov.width = W; ov.height = H; }
      const c = ov.getContext("2d"); c.setTransform(dpr, 0, 0, dpr, 0, 0); c.clearRect(0, 0, W, H);
      const P = (this.picks || []).map(q => this.project(q.p)); if (!P.length) return;
      c.strokeStyle = "#00e5ff"; c.fillStyle = "#00e5ff"; c.lineWidth = 1.5;
      if (P.length === 2 && P[0] && P[1]) {
        c.setLineDash([5, 4]); c.beginPath(); c.moveTo(P[0][0], P[0][1]); c.lineTo(P[1][0], P[1][1]); c.stroke(); c.setLineDash([]);
        if (this.label) {
          const mx = (P[0][0] + P[1][0]) / 2, my = (P[0][1] + P[1][1]) / 2; c.font = "12px ui-monospace, monospace";
          const tw = c.measureText(this.label).width; c.fillStyle = "rgba(7,11,16,0.85)"; c.fillRect(mx + 6, my - 18, tw + 8, 16); c.fillStyle = "#00e5ff"; c.fillText(this.label, mx + 10, my - 6);
        }
      }
      P.forEach((s, i) => { if (!s) return; c.strokeStyle = this.picks[i].what === "corner" ? "#ffe680" : "#00e5ff"; c.beginPath(); c.arc(s[0], s[1], 5, 0, Math.PI * 2); c.stroke(); });
    }
    bind() {
      const cv = this.canvas; let drag = null;
      cv.addEventListener("contextmenu", e => e.preventDefault());
      cv.addEventListener("mousedown", e => { this.spin = false; drag = { x: e.clientX, y: e.clientY, button: e.button, pan: e.button !== 0 || e.shiftKey, cam: { ...this.cam, target: this.cam.target.slice() } }; e.preventDefault(); });
      root.addEventListener("mousemove", e => {
        if (!drag) return;
        const dx = e.clientX - drag.x, dy = e.clientY - drag.y, c = this.cam;
        if (drag.pan) {
          const k = c.dist / Math.max(200, cv.clientHeight) * 1.1, right = [-Math.sin(c.yaw), Math.cos(c.yaw), 0], up = [-Math.sin(c.pitch) * Math.cos(c.yaw), -Math.sin(c.pitch) * Math.sin(c.yaw), Math.cos(c.pitch)];
          c.target = drag.cam.target.map((v, i) => v + (dx * right[i] - dy * up[i]) * -k);
        } else { c.yaw = drag.cam.yaw - dx * 0.008; c.pitch = Math.max(-1.55, Math.min(1.55, drag.cam.pitch + dy * 0.008)); }
        this.draw();
      });
      root.addEventListener("mouseup", e => {
        // a click that did not turn the view: a measure pick (a third starts again)
        if (drag && this.measure && drag.button === 0 && !e.shiftKey && Math.hypot(e.clientX - drag.x, e.clientY - drag.y) < 4) {
          const b = cv.getBoundingClientRect(), q = this.pick(e.clientX - b.left, e.clientY - b.top);
          if (q) { if (this.picks.length >= 2) this.picks = []; this.picks.push(q); if (this.onMeasure) this.onMeasure(this.picks); this.draw(); }
        }
        drag = null;
      });
      cv.addEventListener("wheel", e => { e.preventDefault(); this.cam.dist = Math.max(2, this.cam.dist * Math.exp(e.deltaY * 0.0012)); this.draw(); }, { passive: false });
      const tick = () => { if (this.spin && this.canvas.isConnected) { this.cam.yaw += 0.006; this.draw(); } this.raf = requestAnimationFrame(tick); };
      if (this.opts.spin) this.raf = requestAnimationFrame(tick);
    }
    png() { this.draw(); return this.canvas.toDataURL("image/png"); }
  }
  root.Viewer3D = Viewer3D;
})(typeof window !== "undefined" ? window : globalThis);
