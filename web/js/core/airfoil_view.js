/* Reusable airfoil visual: flow field + bodies + surface markers, and a Cp(x) plot
   with favourable/adverse pressure-gradient colouring. Data come from airfoil.analyze. */
import { FlowView, cpColor, rgb } from "./field.js";
import { Plot, cssVar } from "./plot.js";
import { tr } from "./i18n.js";
import { engineBadge } from "./ui.js";

const EL_COLORS = ["--accent", "--accent-3", "--accent-2", "--good"];

export function splitSurfaces(e) {
  const n = e.x.length;
  let ile = 0;
  for (let i = 1; i < n; i++) if (e.x[i] < e.x[ile]) ile = i;
  const lower = { x: [], y: [], cp: [] };
  const upper = { x: [], y: [], cp: [] };
  // Cp > 1 is impossible in incompressible flow: it only appears at a sharp trailing-edge node
  // squeezed by a nearby element (panel singularity), so it is clipped for display.
  const cpv = (i) => Math.min(e.cp[i], 1);
  for (let i = ile; i >= 0; i--) {
    lower.x.push(e.x[i]);
    lower.y.push(e.y[i]);
    lower.cp.push(cpv(i));
  }
  for (let i = ile; i < n; i++) {
    upper.x.push(e.x[i]);
    upper.y.push(e.y[i]);
    upper.cp.push(cpv(i));
  }
  return { upper, lower };
}

/* Split a surface into contiguous favourable / adverse runs (dCp/dx along the flow). */
function gradientRuns(srf, x0 = 0.002) {
  const runs = [];
  let cur = null;
  for (let i = 1; i < srf.x.length; i++) {
    if (srf.x[i] < x0) continue;
    const dcp = srf.cp[i] - srf.cp[i - 1];
    const kind = dcp > 0 ? "adv" : "fav";
    if (!cur || cur.kind !== kind) {
      cur = { kind, idx: [i - 1] };
      runs.push(cur);
    }
    cur.idx.push(i);
  }
  return runs;
}

export function airfoilPanel(host, opts = {}) {
  const o = Object.assign({ height: 280, plotHeight: 240, world: { x0: -0.35, x1: 1.35, y0: -0.45, y1: 0.45 }, particles: 800, field: true, cpRange: null }, opts);
  const fv = new FlowView(host, { height: o.height, world: o.world, particles: o.particles, speed: 0.004, trail: 0.86 });
  const wait = engineBadge(fv.box);
  const plot = new Plot(host, { height: o.plotHeight, invertY: true, xlabel: { es: "x / c", en: "x / c" }, ylabel: { es: "Cp  (succión hacia arriba)", en: "Cp  (suction up)" }, ylim: o.cpRange });
  let compare = null;

  function update(r, u = {}) {
    wait.remove();
    const gradients = u.gradients ?? false;
    const showBL = u.bl ?? true;
    const els = r.elements;
    fv.setBodies(els.map((e) => ({ x: e.x, y: e.y })));
    if (r.field && o.field) fv.setField(r.field, { reseed: !fv.field || u.reseed });
    const overlays = [];
    if (r.ground_y != null) {
      overlays.push((g, v) => {
        const Y = v.Y(r.ground_y);
        g.fillStyle = "rgba(148,163,184,0.18)";
        g.fillRect(0, Y, v.W, v.H - Y);
        g.strokeStyle = cssVar("--fg-muted");
        g.lineWidth = 2;
        g.beginPath();
        g.moveTo(0, Y);
        g.lineTo(v.W, Y);
        g.stroke();
        g.fillStyle = cssVar("--fg-muted");
        g.font = "11px Inter";
        g.fillText(tr({ es: "suelo (móvil)", en: "ground (moving)" }), 8, Y + 14);
      });
    }
    if (gradients) {
      overlays.push((g, v) => {
        for (const e of els) {
          const { upper, lower } = splitSurfaces(e);
          for (const srf of [upper, lower]) {
            for (const run of gradientRuns(srf)) {
              g.strokeStyle = run.kind === "adv" ? "rgba(244,63,94,0.95)" : "rgba(52,211,153,0.95)";
              g.lineWidth = 4;
              g.beginPath();
              run.idx.forEach((k, j) => (j ? g.lineTo(v.X(srf.x[k]), v.Y(srf.y[k])) : g.moveTo(v.X(srf.x[k]), v.Y(srf.y[k]))));
              g.stroke();
            }
          }
        }
      });
    }
    if (showBL) {
      overlays.push((g, v) => {
        for (const e of els) {
          if (e.stag) {
            g.fillStyle = "#fbbf24";
            g.beginPath();
            g.arc(v.X(e.stag[0]), v.Y(e.stag[1]), 4, 0, 7);
            g.fill();
          }
          if (!e.bl) continue;
          for (const side of ["upper", "lower"]) {
            const b = e.bl[side];
            const at = (xq) => {
              // first BL station at/after xq along the marching direction
              let k = b.x.findIndex((xx) => xx >= xq - 1e-9);
              if (k < 0) k = b.x.length - 1;
              return [b.x[k], b.y[k]];
            };
            if (b.x_tr != null) {
              const [X, Y] = at(b.x_tr);
              g.strokeStyle = cssVar("--c-turb");
              g.lineWidth = 2;
              g.beginPath();
              g.arc(v.X(X), v.Y(Y), 5, 0, 7);
              g.stroke();
            }
            if (b.x_sep != null) {
              const [X, Y] = at(b.x_sep);
              g.strokeStyle = cssVar("--bad");
              g.lineWidth = 2.5;
              const s = 5;
              g.beginPath();
              g.moveTo(v.X(X) - s, v.Y(Y) - s);
              g.lineTo(v.X(X) + s, v.Y(Y) + s);
              g.moveTo(v.X(X) + s, v.Y(Y) - s);
              g.lineTo(v.X(X) - s, v.Y(Y) + s);
              g.stroke();
              // shade the separated region
              g.fillStyle = "rgba(244,63,94,0.18)";
              g.beginPath();
              let first = true;
              for (let k = 0; k < b.x.length; k++) {
                if (b.x[k] < b.x_sep) continue;
                const X2 = v.X(b.x[k]), Y2 = v.Y(b.y[k]);
                first ? g.moveTo(X2, Y2) : g.lineTo(X2, Y2);
                first = false;
              }
              const xe = b.x[b.x.length - 1], ye = b.y[b.y.length - 1];
              const dir = side === "upper" ? 1 : -1;
              const flip = e.suction === side ? 1 : 1;
              g.lineTo(v.X(xe + 0.05), v.Y(ye + dir * 0.04 * flip));
              g.closePath();
              g.fill();
            }
          }
        }
      });
    }
    if (u.overlays) overlays.push(...u.overlays);
    fv.setOverlays(overlays);

    // Cp plot
    const series = [];
    if (compare) {
      for (const e of compare.elements) {
        const { upper, lower } = splitSurfaces(e);
        series.push({ x: upper.x, y: upper.cp, color: cssVar("--fg-dim"), width: 1.5, dash: [4, 3], label: series.length ? null : compare.label, noFit: false });
        series.push({ x: lower.x, y: lower.cp, color: cssVar("--fg-dim"), width: 1.5, dash: [4, 3] });
      }
    }
    els.forEach((e, k) => {
      const col = cssVar(EL_COLORS[k % EL_COLORS.length]);
      const { upper, lower } = splitSurfaces(e);
      const name = { main: { es: "principal", en: "main" }, flap: { es: "flap", en: "flap" }, slat: { es: "slat", en: "slat" } }[e.name] || { es: e.name, en: e.name };
      if (gradients) {
        for (const srf of [upper, lower]) {
          for (const run of gradientRuns(srf)) {
            series.push({ x: run.idx.map((i) => srf.x[i]), y: run.idx.map((i) => srf.cp[i]), color: run.kind === "adv" ? "#f43f5e" : "#34d399", width: 2.6 });
          }
        }
        series.push({ x: [], y: [], color: "#34d399", label: { es: "gradiente favorable (dp/dx<0)", en: "favourable gradient (dp/dx<0)" } });
        series.push({ x: [], y: [], color: "#f43f5e", label: { es: "gradiente adverso (dp/dx>0)", en: "adverse gradient (dp/dx>0)" } });
      } else {
        series.push({ x: upper.x, y: upper.cp, color: col, width: 2.4, label: els.length > 1 ? { es: name.es + " (superior)", en: name.en + " (upper)" } : { es: "superficie superior", en: "upper surface" } });
        series.push({ x: lower.x, y: lower.cp, color: col, width: 2, dash: [6, 4], label: els.length > 1 ? null : { es: "superficie inferior", en: "lower surface" } });
      }
    });
    const markers = [];
    const main = els.find((e) => e.name === "main") || els[0];
    if (main && main.bl && showBL) {
      const s = main.bl[main.suction];
      if (s.x_tr != null) markers.push({ type: "vline", x: s.x_tr, color: cssVar("--c-turb"), label: { es: "transición", en: "transition" } });
      if (s.x_sep != null) markers.push({ type: "vline", x: s.x_sep, color: cssVar("--bad"), label: { es: "separación", en: "separation" }, labelOffset: 14 });
    }
    plot.set(series, markers);
  }

  return {
    fv,
    plot,
    update,
    setCompare(r, label) {
      compare = r ? { ...r, label } : null;
    },
  };
}

export { cpColor, rgb };
