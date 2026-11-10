/* Lightweight canvas line-chart with bilingual axes, markers, bands and hover readout. */
import { tr, onLang } from "./i18n.js";

export function cssVar(name, fallback = "#888") {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

export function niceTicks(min, max, count = 6) {
  if (!isFinite(min) || !isFinite(max) || min === max) return [min];
  const span = max - min;
  const step0 = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(step0)));
  const err = step0 / mag;
  const step = (err >= 7.5 ? 10 : err >= 3.5 ? 5 : err >= 1.5 ? 2 : 1) * mag;
  const out = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-9; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

const SUP = { "-": "⁻", 0: "⁰", 1: "¹", 2: "²", 3: "³", 4: "⁴", 5: "⁵", 6: "⁶", 7: "⁷", 8: "⁸", 9: "⁹" };

function fmtTick(v, logAxis) {
  if (logAxis) {
    const e = Math.floor(Math.log10(v) + 1e-9);
    if (e >= -3 && e <= 4) return String(+v.toPrecision(3)); // 0.05, 0.1, 2, 1000
    const m = Math.round(v / Math.pow(10, e));
    const p = "10" + String(e).split("").map((ch) => SUP[ch]).join("");
    return m === 1 ? p : `${m}·${p}`;
  }
  const a = Math.abs(v);
  if (a === 0) return "0";
  if (a >= 1e5 || a < 1e-3) return v.toExponential(0);
  return String(+v.toPrecision(4));
}

export class Plot {
  constructor(parent, opts = {}) {
    this.opts = Object.assign({ height: 260, legend: true, grid: true, pad: [14, 16, 40, 54] }, opts);
    this.box = document.createElement("div");
    this.box.className = "plot";
    this.box.style.height = this.opts.height + "px";
    this.canvas = document.createElement("canvas");
    this.box.appendChild(this.canvas);
    parent.appendChild(this.box);
    this.series = [];
    this.markers = [];
    this.hover = null;
    this.ro = new ResizeObserver(() => this.draw());
    this.ro.observe(this.box);
    this.canvas.addEventListener("pointermove", (e) => {
      const r = this.canvas.getBoundingClientRect();
      this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
      this.draw();
    });
    this.canvas.addEventListener("pointerleave", () => {
      this.hover = null;
      this.draw();
    });
    // text alternative for screen readers: what the chart plots
    const label = () =>
      this.canvas.setAttribute("aria-label", [this.opts.ylabel && tr(this.opts.ylabel), this.opts.xlabel && tr(this.opts.xlabel)].filter(Boolean).join(" vs ") || "chart");
    this.canvas.setAttribute("role", "img");
    label();
    this._redraw = () => {
      label();
      this.draw();
    };
    this._offLang = onLang(this._redraw);
    this._mq = window.matchMedia("(prefers-color-scheme: dark)");
    this._mq.addEventListener("change", this._redraw);
    window.addEventListener("themechange", this._redraw);
    this._seen = false;
  }

  /* Drop observers and global listeners once the plot has left the page (module change). */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.ro.disconnect();
    this._offLang();
    this._mq.removeEventListener("change", this._redraw);
    window.removeEventListener("themechange", this._redraw);
    this.series = [];
    this.markers = [];
  }

  set(series, markers) {
    this.series = series || [];
    if (markers) this.markers = markers;
    this.draw();
  }

  setMarkers(m) {
    this.markers = m || [];
    this.draw();
  }

  _limits() {
    const o = this.opts;
    let [x0, x1] = o.xlim || [Infinity, -Infinity];
    let [y0, y1] = o.ylim || [Infinity, -Infinity];
    if (!o.xlim || !o.ylim) {
      for (const s of this.series) {
        if (s.noFit) continue;
        for (let i = 0; i < s.x.length; i++) {
          const xv = s.x[i];
          const yv = s.y[i];
          if (xv == null || yv == null || !isFinite(xv) || !isFinite(yv)) continue;
          if (o.logX && xv <= 0) continue;
          if (o.logY && yv <= 0) continue;
          if (!o.xlim) {
            x0 = Math.min(x0, xv);
            x1 = Math.max(x1, xv);
          }
          if (!o.ylim) {
            y0 = Math.min(y0, yv);
            y1 = Math.max(y1, yv);
          }
        }
      }
      if (!o.ylim && isFinite(y0)) {
        if (o.yIncludeZero) {
          y0 = Math.min(y0, 0);
          y1 = Math.max(y1, 0);
        }
        const pad = (y1 - y0 || Math.abs(y1) || 1) * 0.08;
        if (!o.logY) {
          y0 -= pad;
          y1 += pad;
        }
      }
    }
    if (!isFinite(x0)) [x0, x1] = o.logX ? [1, 10] : [0, 1];
    if (!isFinite(y0)) [y0, y1] = o.logY ? [1, 10] : [0, 1];
    if (x0 === x1) x1 = x0 + 1;
    if (y0 === y1) y1 = y0 + 1;
    return { x0, x1, y0, y1 };
  }

  draw() {
    if (this.box.isConnected) this._seen = true;
    else if (this._seen) return this.destroy();
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const W = this.box.clientWidth;
    const H = this.box.clientHeight;
    if (!W || !H) return;
    c.width = W * dpr;
    c.height = H * dpr;
    c.style.width = W + "px";
    c.style.height = H + "px";
    const g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, W, H);
    const o = this.opts;
    const [pt, pr, pb, pl] = o.pad;
    const fg = cssVar("--fg-muted", "#9aa4b2");
    const gridC = cssVar("--grid", "rgba(255,255,255,0.07)");
    const axisC = cssVar("--axis", "rgba(255,255,255,0.25)");
    const font = "11px 'JetBrains Mono', ui-monospace, monospace";
    const { x0, x1, y0, y1 } = this._limits();
    const lx = (v) => (o.logX ? Math.log10(Math.max(v, 1e-300)) : v);
    const ly = (v) => (o.logY ? Math.log10(Math.max(v, 1e-300)) : v);
    const X0 = lx(x0), X1 = lx(x1), Y0 = ly(y0), Y1 = ly(y1);
    const pw = W - pl - pr;
    const ph = H - pt - pb;
    const sx = (v) => pl + ((lx(v) - X0) / (X1 - X0)) * pw;
    const sy = (v) => (o.invertY ? pt + ((ly(v) - Y0) / (Y1 - Y0)) * ph : pt + ph - ((ly(v) - Y0) / (Y1 - Y0)) * ph);
    this._map = { sx, sy, pl, pt, pw, ph, x0, x1, y0, y1, X0, X1, Y0, Y1 };

    // bands
    for (const m of this.markers) {
      if (m.type === "band") {
        g.fillStyle = m.color;
        const a = sx(Math.max(m.x0, x0)), b = sx(Math.min(m.x1, x1));
        if (b > a) g.fillRect(a, pt, b - a, ph);
      } else if (m.type === "hband") {
        g.fillStyle = m.color;
        const a = sy(m.y0), b = sy(m.y1);
        g.fillRect(pl, Math.min(a, b), pw, Math.abs(b - a));
      }
    }

    // grid + ticks
    g.font = font;
    g.fillStyle = fg;
    g.strokeStyle = gridC;
    g.lineWidth = 1;
    const ticks = (a, b, log) => {
      if (!log) return niceTicks(a, b, 6);
      const out = [];
      // a log axis needs positive, finite limits (data may briefly be linear-range on a switch)
      if (!(a > 0) || !(b > 0) || !isFinite(a) || !isFinite(b)) return out;
      const decades = Math.log10(b / a);
      // short ranges get 2 and 5 sub-ticks so the axis is readable (0.05, 0.1, 0.2, 0.5, 1)
      const mult = decades <= 1.2 ? [1, 2, 3, 5] : decades <= 2.5 ? [1, 2, 5] : [1];
      for (let e = Math.floor(Math.log10(a)); e <= Math.ceil(Math.log10(b)); e++) for (const k of mult) out.push(k * Math.pow(10, e));
      return out.filter((v) => v >= a * 0.999 && v <= b * 1.001);
    };
    const xt = ticks(x0, x1, o.logX);
    const yt = ticks(y0, y1, o.logY);
    g.textAlign = "center";
    g.textBaseline = "top";
    for (const t of xt) {
      const X = sx(t);
      if (o.grid) {
        g.beginPath();
        g.moveTo(X, pt);
        g.lineTo(X, pt + ph);
        g.stroke();
      }
      g.fillText(fmtTick(t, o.logX), X, pt + ph + 6);
    }
    g.textAlign = "right";
    g.textBaseline = "middle";
    for (const t of yt) {
      const Y = sy(t);
      if (o.grid) {
        g.beginPath();
        g.moveTo(pl, Y);
        g.lineTo(pl + pw, Y);
        g.stroke();
      }
      g.fillText(fmtTick(t, o.logY), pl - 6, Y);
    }
    // zero axes
    g.strokeStyle = axisC;
    g.lineWidth = 1;
    if (!o.logY && y0 < 0 && y1 > 0) {
      g.beginPath();
      g.moveTo(pl, sy(0));
      g.lineTo(pl + pw, sy(0));
      g.stroke();
    }
    if (!o.logX && x0 < 0 && x1 > 0) {
      g.beginPath();
      g.moveTo(sx(0), pt);
      g.lineTo(sx(0), pt + ph);
      g.stroke();
    }
    g.strokeRect(pl, pt, pw, ph);

    // labels
    g.fillStyle = fg;
    g.font = "12px Inter, system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "bottom";
    if (o.xlabel) g.fillText(tr(o.xlabel), pl + pw / 2, H - 4);
    if (o.ylabel) {
      g.save();
      g.translate(13, pt + ph / 2);
      g.rotate(-Math.PI / 2);
      g.textBaseline = "middle";
      g.fillText(tr(o.ylabel), 0, 0);
      g.restore();
    }

    // series
    g.save();
    g.beginPath();
    g.rect(pl, pt, pw, ph);
    g.clip();
    for (const s of this.series) {
      const col = s.color || cssVar("--accent");
      if (s.fill) {
        g.fillStyle = s.fillColor || col.replace(")", ",0.15)").replace("rgb(", "rgba(");
        g.globalAlpha = s.fillAlpha ?? 0.18;
        g.fillStyle = col;
        g.beginPath();
        let started = false;
        let lastX = null;
        const base = s.fill === "zero" ? 0 : s.fill;
        for (let i = 0; i < s.x.length; i++) {
          if (s.y[i] == null || !isFinite(s.y[i])) continue;
          const X = sx(s.x[i]), Y = sy(s.y[i]);
          if (!started) {
            g.moveTo(X, sy(base));
            started = true;
          }
          g.lineTo(X, Y);
          lastX = X;
        }
        if (started) {
          g.lineTo(lastX, sy(base));
          g.closePath();
          g.fill();
        }
        g.globalAlpha = 1;
      }
      g.strokeStyle = col;
      g.lineWidth = s.width || 2;
      g.setLineDash(s.dash || []);
      g.globalAlpha = s.alpha ?? 1;
      if (!s.pointsOnly) {
        g.beginPath();
        let pen = false;
        for (let i = 0; i < s.x.length; i++) {
          const yv = s.y[i], xv = s.x[i];
          if (yv == null || xv == null || !isFinite(yv) || !isFinite(xv)) {
            pen = false;
            continue;
          }
          const X = sx(xv), Y = sy(yv);
          if (!pen) {
            g.moveTo(X, Y);
            pen = true;
          } else g.lineTo(X, Y);
        }
        g.stroke();
      }
      if (s.points || s.pointsOnly) {
        g.fillStyle = col;
        for (let i = 0; i < s.x.length; i++) {
          if (s.y[i] == null || !isFinite(s.y[i])) continue;
          g.beginPath();
          g.arc(sx(s.x[i]), sy(s.y[i]), s.r || 3, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.setLineDash([]);
      g.globalAlpha = 1;
    }
    // line markers and points
    for (const m of this.markers) {
      g.strokeStyle = m.color || fg;
      g.fillStyle = m.color || fg;
      g.lineWidth = m.width || 1.5;
      g.setLineDash(m.dash || [5, 4]);
      if (m.type === "vline" && m.x != null && isFinite(m.x)) {
        g.beginPath();
        g.moveTo(sx(m.x), pt);
        g.lineTo(sx(m.x), pt + ph);
        g.stroke();
        if (m.label) {
          g.setLineDash([]);
          g.font = "11px Inter, sans-serif";
          g.textAlign = "left";
          g.textBaseline = "bottom";
          g.fillText(tr(m.label), sx(m.x) + 4, pt + ph - 4 - (m.labelOffset || 0));
        }
      } else if (m.type === "hline" && m.y != null) {
        g.beginPath();
        g.moveTo(pl, sy(m.y));
        g.lineTo(pl + pw, sy(m.y));
        g.stroke();
        if (m.label) {
          g.setLineDash([]);
          g.font = "11px Inter, sans-serif";
          g.textAlign = "right";
          g.textBaseline = "bottom";
          g.fillText(tr(m.label), pl + pw - 4, sy(m.y) - 2);
        }
      } else if (m.type === "point" && m.x != null && m.y != null) {
        g.setLineDash([]);
        g.beginPath();
        g.arc(sx(m.x), sy(m.y), m.r || 5, 0, Math.PI * 2);
        g.fill();
        if (m.label) {
          g.font = "11px Inter, sans-serif";
          g.textAlign = "left";
          g.textBaseline = "bottom";
          g.fillText(tr(m.label), sx(m.x) + 7, sy(m.y) - 4);
        }
      } else if (m.type === "text") {
        g.setLineDash([]);
        g.font = m.font || "11px Inter, sans-serif";
        g.textAlign = m.align || "left";
        g.textBaseline = "middle";
        g.fillText(tr(m.text), sx(m.x), sy(m.y));
      }
      g.setLineDash([]);
    }
    g.restore();

    // legend
    if (o.legend) {
      const items = this.series.filter((s) => s.label);
      g.font = "11px Inter, sans-serif";
      g.textAlign = "left";
      g.textBaseline = "middle";
      let x = pl + 10;
      let y = pt + 12;
      const maxX = pl + pw - 10;
      // translucent backing so curves and labels underneath do not clash with the text
      let rows = 1, xx = x, wmax = 0;
      for (const s of items) {
        const w = g.measureText(tr(s.label)).width + 30;
        if (xx + w > maxX) {
          xx = pl + 10;
          rows++;
        }
        xx += w;
        wmax = Math.max(wmax, xx - pl - 10);
      }
      if (items.length) {
        g.fillStyle = cssVar("--legend-bg", "rgba(10,14,22,0.72)");
        g.fillRect(pl + 4, pt + 3, Math.min(wmax + 8, pw - 8), rows * 16 + 2);
      }
      for (const s of items) {
        const txt = tr(s.label);
        const w = g.measureText(txt).width + 30;
        if (x + w > maxX) {
          x = pl + 10;
          y += 16;
        }
        g.strokeStyle = s.color || cssVar("--accent");
        g.lineWidth = 2.5;
        g.setLineDash(s.dash || []);
        g.beginPath();
        g.moveTo(x, y);
        g.lineTo(x + 18, y);
        g.stroke();
        g.setLineDash([]);
        g.fillStyle = cssVar("--fg", "#e6edf3");
        g.fillText(txt, x + 22, y);
        x += w;
      }
    }

    // hover
    if (this.hover && this.hover.x > pl && this.hover.x < pl + pw && this.hover.y > pt && this.hover.y < pt + ph) {
      const hx = this.hover.x;
      g.strokeStyle = axisC;
      g.setLineDash([2, 3]);
      g.beginPath();
      g.moveTo(hx, pt);
      g.lineTo(hx, pt + ph);
      g.stroke();
      g.setLineDash([]);
      const xv = o.logX ? Math.pow(10, X0 + ((hx - pl) / pw) * (X1 - X0)) : X0 + ((hx - pl) / pw) * (X1 - X0);
      const lines = [`x = ${fmtTick(+xv.toPrecision(4))}`];
      for (const s of this.series) {
        if (!s.label || s.x.length < 2 || s.noHover) continue;
        let best = -1, bd = Infinity;
        for (let i = 0; i < s.x.length; i++) {
          const d = Math.abs(sx(s.x[i]) - hx);
          if (d < bd && s.y[i] != null && isFinite(s.y[i])) {
            bd = d;
            best = i;
          }
        }
        if (best >= 0 && bd < 30) {
          lines.push(`${tr(s.label)}: ${(+s.y[best]).toPrecision(4)}`);
          g.fillStyle = s.color || cssVar("--accent");
          g.beginPath();
          g.arc(sx(s.x[best]), sy(s.y[best]), 3.5, 0, Math.PI * 2);
          g.fill();
        }
      }
      g.font = "11px 'JetBrains Mono', monospace";
      const w = Math.max(...lines.map((l) => g.measureText(l).width)) + 14;
      const h = lines.length * 15 + 8;
      let bx = hx + 10;
      if (bx + w > W) bx = hx - w - 10;
      const by = pt + 6;
      g.fillStyle = cssVar("--tooltip-bg", "rgba(10,14,22,0.92)");
      g.fillRect(bx, by, w, h);
      g.fillStyle = cssVar("--fg", "#e6edf3");
      g.textAlign = "left";
      g.textBaseline = "top";
      lines.forEach((l, i) => g.fillText(l, bx + 7, by + 5 + i * 15));
    }
  }
}
