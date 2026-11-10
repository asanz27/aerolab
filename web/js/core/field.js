/* 2D flow-field renderer: colour maps, bodies, iso-lines (marching squares),
   animated tracer particles advected through the velocity grid computed in Python.
   All physics comes from the engine; this file only interpolates and draws. */
import { cssVar } from "./plot.js";
import { onLang } from "./i18n.js";

/* ---------- colour maps ---------- */
const lerp = (a, b, t) => a + (b - a) * t;
function ramp(stops, t) {
  t = Math.min(1, Math.max(0, t));
  for (let i = 1; i < stops.length; i++) {
    if (t <= stops[i][0]) {
      const [t0, c0] = stops[i - 1];
      const [t1, c1] = stops[i];
      const f = (t - t0) / (t1 - t0 || 1);
      return [lerp(c0[0], c1[0], f), lerp(c0[1], c1[1], f), lerp(c0[2], c1[2], f)];
    }
  }
  return stops[stops.length - 1][1];
}
/* Cp: suction (negative) -> cyan/blue/violet, stagnation (positive) -> orange/red */
const CP_STOPS = [
  [0, [120, 60, 220]],
  [0.25, [40, 110, 245]],
  [0.5, [34, 211, 238]],
  [0.75, [20, 40, 60]],
  [0.85, [251, 146, 60]],
  [1, [244, 63, 94]],
];
export function cpColor(cp, cpMin = -3, cpMax = 1) {
  // piecewise: [cpMin,0] -> [0,0.75], [0,cpMax] -> [0.75,1]
  const t = cp < 0 ? 0.75 * (1 - cp / cpMin) : 0.75 + 0.25 * (cp / cpMax);
  return ramp(CP_STOPS, t);
}
const SPEED_STOPS = [
  [0, [10, 20, 50]],
  [0.3, [30, 90, 200]],
  [0.55, [34, 211, 238]],
  [0.8, [250, 250, 210]],
  [1, [251, 146, 60]],
];
export function speedColor(s, sMax = 2) {
  return ramp(SPEED_STOPS, s / sMax);
}
const DIV_STOPS = [
  [0, [59, 130, 246]],
  [0.5, [24, 30, 42]],
  [1, [244, 63, 94]],
];
export function divColor(v, vMax = 1) {
  return ramp(DIV_STOPS, 0.5 + 0.5 * v / vMax);
}
export const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
/* Flow viewports follow the theme: on the light background the bright tracer colours are
   darkened so particles keep their contrast. */
export const isLight = () => document.documentElement.getAttribute("data-theme") === "light";
export const tracer = (c) => (isLight() ? c.map((v) => v * 0.55) : c);

/* ---------- marching squares ---------- */
export function contourSegments(xs, ys, F, level) {
  const segs = [];
  const ny = F.length, nx = F[0].length;
  for (let j = 0; j < ny - 1; j++) {
    for (let i = 0; i < nx - 1; i++) {
      const a = F[j][i], b = F[j][i + 1], c = F[j + 1][i + 1], d = F[j + 1][i];
      if (a == null || b == null || c == null || d == null) continue;
      const idx = (a > level ? 1 : 0) | (b > level ? 2 : 0) | (c > level ? 4 : 0) | (d > level ? 8 : 0);
      if (idx === 0 || idx === 15) continue;
      const x0 = xs[i], x1 = xs[i + 1], y0 = ys[j], y1 = ys[j + 1];
      const e = [
        [x0 + (x1 - x0) * (level - a) / (b - a), y0],
        [x1, y0 + (y1 - y0) * (level - b) / (c - b)],
        [x0 + (x1 - x0) * (level - d) / (c - d), y1],
        [x0, y0 + (y1 - y0) * (level - a) / (d - a)],
      ];
      const T = {
        1: [[3, 0]], 2: [[0, 1]], 3: [[3, 1]], 4: [[1, 2]], 5: [[3, 2], [0, 1]], 6: [[0, 2]], 7: [[3, 2]],
        8: [[2, 3]], 9: [[0, 2]], 10: [[0, 3], [1, 2]], 11: [[1, 2]], 12: [[1, 3]], 13: [[0, 1]], 14: [[0, 3]],
      }[idx];
      for (const [p, q] of T) segs.push([e[p][0], e[p][1], e[q][0], e[q][1]]);
    }
  }
  return segs;
}

/* ---------- FlowView ---------- */
export class FlowView {
  constructor(parent, opts = {}) {
    this.opts = Object.assign({ height: 340, world: { x0: -1, x1: 2, y0: -0.8, y1: 0.8 }, particles: 900, speed: 0.012, trail: 0.88, particleColor: null }, opts);
    this.box = document.createElement("div");
    this.box.className = "flowview";
    this.box.style.height = this.opts.height + "px";
    this.base = document.createElement("canvas");
    this.top = document.createElement("canvas");
    this.box.append(this.base, this.top);
    this.top.setAttribute("role", "img");
    this.top.setAttribute("aria-label", "Visualización del flujo con partículas trazadoras / Flow visualisation with tracer particles");
    this.base.setAttribute("aria-hidden", "true");
    parent.appendChild(this.box);
    this.field = null;
    this.scalar = null;
    this.bodies = [];
    this.contours = [];
    this.overlays = [];
    this.parts = [];
    this.running = true;
    this.visible = true;
    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(this.box);
    this.io = new IntersectionObserver((ents) => {
      this.visible = ents[0].isIntersecting;
    });
    this.io.observe(this.box);
    this._offLang = onLang(() => this.drawBase());
    this._onTheme = () => this.drawBase();
    window.addEventListener("themechange", this._onTheme);
    this._loop = this._loop.bind(this);
    this._seen = false;
    requestAnimationFrame(this._loop);
  }

  /* Release the animation loop, observers and listeners once the view has left the page
     (module change). Called automatically by the loop. */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ro.disconnect();
    this.io.disconnect();
    this._offLang();
    window.removeEventListener("themechange", this._onTheme);
    this.field = this.scalar = null;
    this.parts = [];
  }

  setWorld(w) {
    this.opts.world = w;
    this.resize();
  }

  resize() {
    const dpr = window.devicePixelRatio || 1;
    const W = this.box.clientWidth, H = this.box.clientHeight;
    if (!W || !H) return;
    for (const c of [this.base, this.top]) {
      c.width = W * dpr;
      c.height = H * dpr;
      c.style.width = W + "px";
      c.style.height = H + "px";
    }
    this.W = W;
    this.H = H;
    this.dpr = dpr;
    const w = this.opts.world;
    const s = Math.min(W / (w.x1 - w.x0), H / (w.y1 - w.y0));
    this.scale = s;
    this.ox = (W - s * (w.x1 - w.x0)) / 2 - s * w.x0;
    this.oy = (H + s * (w.y1 - w.y0)) / 2 + s * w.y0;
    if (this.field) this.seed(); // the visible area changed
    this.drawBase();
  }

  X(x) {
    return this.ox + this.scale * x;
  }
  Y(y) {
    return this.oy - this.scale * y;
  }
  toWorld(px, py) {
    return [(px - this.ox) / this.scale, (this.oy - py) / this.scale];
  }
  /* World rectangle actually visible: wider or taller than opts.world when the box aspect differs
     (the world is fitted with equal axes). Particles live in this whole area. */
  view() {
    if (!this.W || !this.scale) return this.opts.world;
    const [x0, y1] = this.toWorld(0, 0);
    const [x1, y0] = this.toWorld(this.W, this.H);
    return { x0, x1, y0, y1 };
  }

  /* field: {x:[nx], y:[ny], u:[[ny][nx]], v:[[ny][nx]]} */
  setField(field, { reseed = false } = {}) {
    this.field = field;
    if (reseed || this.parts.length === 0) this.seed();
  }
  setScalar(sc) {
    this.scalar = sc;
    this.drawBase();
  }
  setBodies(b) {
    this.bodies = b || [];
    this.drawBase();
  }
  setContours(c) {
    this.contours = c || [];
    this.drawBase();
  }
  setOverlays(list) {
    this.overlays = list || [];
    this.drawBase();
  }
  redraw() {
    this.drawBase();
  }

  velocity(x, y) {
    const f = this.field;
    if (!f) return null;
    const nx = f.x.length, ny = f.y.length;
    const fx = ((x - f.x[0]) / (f.x[nx - 1] - f.x[0])) * (nx - 1);
    const fy = ((y - f.y[0]) / (f.y[ny - 1] - f.y[0])) * (ny - 1);
    if (fx < 0 || fy < 0 || fx > nx - 1 || fy > ny - 1) return null;
    const i = Math.min(nx - 2, Math.floor(fx)), j = Math.min(ny - 2, Math.floor(fy));
    const tx = fx - i, ty = fy - j;
    const U = f.u, V = f.v;
    const a = U[j][i], b = U[j][i + 1], c = U[j + 1][i], d = U[j + 1][i + 1];
    const e = V[j][i], g = V[j][i + 1], h = V[j + 1][i], k = V[j + 1][i + 1];
    if (a == null || b == null || c == null || d == null || e == null || g == null || h == null || k == null) return null;
    return [lerp(lerp(a, b, tx), lerp(c, d, tx), ty), lerp(lerp(e, g, tx), lerp(h, k, tx), ty)];
  }

  seed() {
    const w = this.view();
    const o = this.opts.world;
    const ratio = Math.min(2.5, Math.max(1, ((w.x1 - w.x0) * (w.y1 - w.y0)) / ((o.x1 - o.x0) * (o.y1 - o.y0))));
    this._nParts = Math.round(this.opts.particles * ratio);
    this.parts = [];
    for (let n = 0; n < this._nParts; n++) this.parts.push(this._newParticle(w, true));
  }
  _newParticle(w, anywhere) {
    const x = anywhere ? w.x0 + Math.random() * (w.x1 - w.x0) : w.x0 + Math.random() * (w.x1 - w.x0) * 0.15;
    return { x, y: w.y0 + Math.random() * (w.y1 - w.y0), age: 0, life: 60 + Math.random() * 140 };
  }

  drawBase() {
    if (!this.W) return;
    const g = this.base.getContext("2d");
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.clearRect(0, 0, this.W, this.H);
    g.fillStyle = cssVar("--flow-bg", "#070b12");
    g.fillRect(0, 0, this.W, this.H);
    const sc = this.scalar;
    if (sc && sc.values) {
      const nx = sc.x.length, ny = sc.y.length;
      const off = document.createElement("canvas");
      off.width = nx;
      off.height = ny;
      const og = off.getContext("2d");
      const img = og.createImageData(nx, ny);
      for (let j = 0; j < ny; j++) {
        for (let i = 0; i < nx; i++) {
          const v = sc.values[j][i];
          const p = ((ny - 1 - j) * nx + i) * 4;
          if (v == null || !isFinite(v)) {
            img.data[p + 3] = 0;
            continue;
          }
          const c = sc.map(v);
          img.data[p] = c[0];
          img.data[p + 1] = c[1];
          img.data[p + 2] = c[2];
          img.data[p + 3] = sc.alpha ?? 200;
        }
      }
      og.putImageData(img, 0, 0);
      g.imageSmoothingEnabled = true;
      const x0 = this.X(sc.x[0]), x1 = this.X(sc.x[nx - 1]);
      const y0 = this.Y(sc.y[ny - 1]), y1 = this.Y(sc.y[0]);
      g.drawImage(off, x0, y0, x1 - x0, y1 - y0);
    }
    for (const ct of this.contours) {
      g.strokeStyle = ct.color || cssVar("--contour", "rgba(255,255,255,0.5)");
      g.lineWidth = ct.width || 1;
      g.setLineDash(ct.dash || []);
      g.beginPath();
      for (const s of ct.segments) {
        g.moveTo(this.X(s[0]), this.Y(s[1]));
        g.lineTo(this.X(s[2]), this.Y(s[3]));
      }
      g.stroke();
      g.setLineDash([]);
    }
    for (const b of this.bodies) {
      g.beginPath();
      for (let i = 0; i < b.x.length; i++) {
        const X = this.X(b.x[i]), Y = this.Y(b.y[i]);
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      }
      if (b.close !== false) g.closePath();
      if (b.fill !== null) {
        g.fillStyle = b.fill || cssVar("--body-fill", "#1d2433");
        g.fill();
      }
      g.strokeStyle = b.stroke || cssVar("--body-stroke", "#cbd5e1");
      g.lineWidth = b.width || 1.5;
      g.stroke();
    }
    for (const fn of this.overlays) fn(g, this);
  }

  _loop() {
    if (this.box.isConnected) this._seen = true;
    else if (this._seen) {
      this.destroy();
      return;
    }
    requestAnimationFrame(this._loop);
    if (!this.visible || !this.running || !this.field || !this.W) return;
    const g = this.top.getContext("2d");
    g.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    g.globalCompositeOperation = "destination-out";
    g.fillStyle = `rgba(0,0,0,${1 - this.opts.trail})`;
    g.fillRect(0, 0, this.W, this.H);
    g.globalCompositeOperation = "source-over";
    const w = this.view();
    const dt = this.opts.speed * (w.x1 - w.x0);
    g.lineWidth = 1.3;
    const pc = this.opts.particleColor;
    for (const p of this.parts) {
      const v = this.velocity(p.x, p.y);
      p.age++;
      if (!v || p.age > p.life || p.x > w.x1 || p.x < w.x0 || p.y < w.y0 || p.y > w.y1) {
        Object.assign(p, this._newParticle(w, Math.random() < 0.6));
        continue;
      }
      // RK2 step
      const xm = p.x + 0.5 * dt * v[0], ym = p.y + 0.5 * dt * v[1];
      const vm = this.velocity(xm, ym) || v;
      const nxp = p.x + dt * vm[0], nyp = p.y + dt * vm[1];
      const sp = Math.hypot(vm[0], vm[1]);
      g.strokeStyle = pc ? pc : rgb(tracer(speedColor(sp, 2.2)), 0.9);
      g.beginPath();
      g.moveTo(this.X(p.x), this.Y(p.y));
      g.lineTo(this.X(nxp), this.Y(nyp));
      g.stroke();
      p.x = nxp;
      p.y = nyp;
    }
  }

  /* Integrate a streamline from a seed (for static streamline drawing). */
  streamline(x, y, steps = 400, h = 0.01, dir = 1) {
    const pts = [[x, y]];
    for (let k = 0; k < steps; k++) {
      const v = this.velocity(x, y);
      if (!v) break;
      const s = Math.hypot(v[0], v[1]) || 1e-9;
      const vm = this.velocity(x + 0.5 * h * dir * v[0] / s, y + 0.5 * h * dir * v[1] / s) || v;
      const sm = Math.hypot(vm[0], vm[1]) || 1e-9;
      x += h * dir * vm[0] / sm;
      y += h * dir * vm[1] / sm;
      pts.push([x, y]);
    }
    return pts;
  }
}
