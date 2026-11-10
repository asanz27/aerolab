import { slider, labLayout, readout, segmented, button, toggle, L, tr, el, canvasBox, engineBadge } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { FlowView, cpColor, rgb } from "../js/core/field.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;
const K = 3; // vertical exaggeration of the 2D view
const FIELD = { x0: -0.12, x1: 1.18, y0: 0.0, y1: 0.22, nx: 120, ny: 46 };

// geometry shared between the 2D lab and the sensitivity map
const geo = { h: 0.03, h_inlet: 0.09, x_throat0: 0.25, x_diff0: 0.72, diffuser_deg: 7, rake_deg: 0, cp_base: -0.25, three_d: false, edge_vortex: 0.6, width: 0.35 };

function underbodyLab(host) {
  const ui = labLayout(host);
  const fv = new FlowView(ui.viz, { height: 300, world: { x0: FIELD.x0, x1: FIELD.x1, y0: -0.05, y1: FIELD.y1 * K }, particles: 1100, speed: 0.004, trail: 0.88 });
  const wait = engineBadge(fv.box);
  const plot = new Plot(ui.viz, { height: 260, invertY: true, xlabel: { es: "x / L (morro → cola)", en: "x / L (nose → tail)" }, ylabel: { es: "Cp", en: "Cp" } });
  const S = (key, label, o) => slider({ label, ...o, value: geo[key], onInput: (v) => ((geo[key] = v), run()) });
  const sH = S("h", { es: "Ride height (holgura mínima) h/L", en: "Ride height (minimum clearance) h/L" }, { min: 0.006, max: 0.12, log: true, format: (v) => v.toFixed(3) });
  const sIn = S("h_inlet", { es: "Altura de la entrada h_in/L (tobera convergente)", en: "Inlet height h_in/L (convergent nozzle)" }, { min: 0.03, max: 0.15, step: 0.005 });
  const sT0 = S("x_throat0", { es: "Fin de la entrada / inicio de la garganta x/L", en: "End of inlet / start of throat x/L" }, { min: 0.1, max: 0.5, step: 0.01 });
  const sD0 = S("x_diff0", { es: "Inicio del difusor x/L", en: "Diffuser start x/L" }, { min: 0.5, max: 0.92, step: 0.01 });
  const sAng = S("diffuser_deg", { es: "Ángulo del difusor [°]", en: "Diffuser angle [°]" }, { min: 1, max: 22, step: 0.5 });
  const sRk = S("rake_deg", { es: "Rake [°] (+ = morro abajo / trasera arriba)", en: "Rake [°] (+ = nose down / rear up)" }, { min: -0.5, max: 2, step: 0.05 });
  const sCb = S("cp_base", { es: "Cp de base (estela tras el coche)", en: "Base Cp (wake behind the car)" }, { min: -0.5, max: 0, step: 0.01 });
  const t3 = toggle({ label: { es: "Mejora: suelo quasi-3D (fugas laterales + vórtices de borde)", en: "Upgrade: quasi-3D floor (lateral leakage + edge vortices)" }, value: false, onInput: (v) => ((geo.three_d = v), run()) });
  const sEv = S("edge_vortex", { es: "Intensidad de los vórtices de borde (3D)", en: "Edge-vortex strength (3D)" }, { min: 0, max: 1, step: 0.05 });
  const sW = S("width", { es: "Anchura del suelo / longitud (3D)", en: "Floor width / length (3D)" }, { min: 0.2, max: 0.6, step: 0.01 });
  ui.controls.append(sH.el, sIn.el, sT0.el, sD0.el, sAng.el, sRk.el, sCb.el, t3.el, sEv.el, sW.el);
  const roF = readout({ es: "Carga del suelo C_L,suelo", en: "Floor downforce C_L,floor" });
  const roB = readout({ es: "Carga total del cuerpo 2D", en: "Total 2D body downforce" });
  const roT = readout({ es: "Cp en la garganta", en: "Throat Cp" });
  const roAR = readout({ es: "Relación de áreas del difusor", en: "Diffuser area ratio" });
  const roS = readout({ es: "Separación del difusor", en: "Diffuser separation" }, "x/L");
  const roBal = readout({ es: "Reparto delantero (suelo)", en: "Front share (floor)" });
  const roK = readout({ es: "Factor de fugas (3D/2D)", en: "Leakage factor (3D/2D)" });
  ui.readouts.append(roF.el, roB.el, roT.el, roAR.el, roS.el, roBal.el, roK.el);
  ui.note.innerHTML = L(
    "Paneles 2D + suelo móvil por imágenes + capa límite turbulenta en el suelo (Python). El caudal bajo el coche lo fija la <b>presión de base</b>: el difusor descarga a Cp_base en su salida o, si la capa límite no aguanta, en el punto de separación (el chorro ya no recupera presión). Escala vertical ×3. <b>Mejora quasi-3D</b>: el suelo tiene anchura finita y pierde succión cerca de los bordes (aire que entra lateralmente, franja de unas pocas alturas de hueco); los vórtices de borde la «sellan» y además aumentan la mezcla de la capa límite del difusor (entrainment de Head ×(1+b)), retrasando la separación: el ángulo óptimo de difusor sube, como en los ensayos. Modelo semiempírico: las tendencias son lo importante.",
    "2D panels + moving ground by images + turbulent boundary layer on the floor (Python). Underbody mass flow is set by the <b>base pressure</b>: the diffuser discharges at Cp_base at its exit or, if the boundary layer cannot cope, at the separation point (the jet no longer recovers pressure). Vertical scale ×3. <b>Quasi-3D upgrade</b>: the floor has a finite width and loses suction near its edges (lateral inflow over a strip of a few gap heights); edge vortices “seal” it and also increase mixing in the diffuser boundary layer (Head entrainment ×(1+b)), delaying separation: the optimum diffuser angle rises, as in experiments. Semi-empirical model: trends are what matter."
  );
  const call = liveCall("ub", "underbody.analyze", 90);
  function run() {
    if (geo.x_throat0 > geo.x_diff0 - 0.05) {
      geo.x_throat0 = geo.x_diff0 - 0.05;
      sT0.value = geo.x_throat0;
    }
    call({ ...geo, field: FIELD }, draw);
  }
  function draw(r) {
    wait.remove();
    const ys = (a) => a.map((v) => v * K);
    fv.setBodies([{ x: r.x, y: ys(r.y) }]);
    fv.setField({ x: r.field.x, y: ys(r.field.y), u: r.field.u, v: r.field.v.map((row) => row.map((v) => (v == null ? null : v * K))) }, { reseed: !fv.field });
    const f = r.floor;
    fv.setOverlays([
      (g, v) => {
        // road
        const Y0 = v.Y(0);
        g.fillStyle = "#1f2937";
        g.fillRect(0, Y0, v.W, v.H - Y0);
        g.strokeStyle = "#fbbf24";
        g.setLineDash([12, 10]);
        g.beginPath();
        g.moveTo(0, Y0 + 6);
        g.lineTo(v.W, Y0 + 6);
        g.stroke();
        g.setLineDash([]);
        // floor coloured by Cp
        g.lineWidth = 5;
        for (let i = 1; i < f.x.length; i++) {
          g.strokeStyle = rgb(cpColor(f.cp[i], -3, 1), 0.95);
          g.beginPath();
          g.moveTo(v.X(f.x[i - 1]), v.Y(f.y[i - 1] * K));
          g.lineTo(v.X(f.x[i]), v.Y(f.y[i] * K));
          g.stroke();
        }
        // region labels
        g.fillStyle = cssVar("--fg");
        g.font = "11px Inter";
        const lab = (x, t) => g.fillText(tr(t), v.X(x) - 22, Y0 + 20);
        lab(r.x_throat0 / 2, { es: "entrada", en: "inlet" });
        lab((r.x_throat0 + r.x_diff0) / 2, { es: "garganta", en: "throat" });
        lab((r.x_diff0 + 1) / 2, { es: "difusor", en: "diffuser" });
        // separation + jet
        if (r.x_sep != null) {
          const k = f.x.findIndex((x) => x >= r.x_sep);
          g.fillStyle = "rgba(244,63,94,0.25)";
          g.beginPath();
          g.moveTo(v.X(f.x[k]), v.Y(f.y[k] * K));
          for (let i = k; i < f.x.length; i++) g.lineTo(v.X(f.x[i]), v.Y(f.y[i] * K));
          for (let i = f.x.length - 1; i >= k; i--) g.lineTo(v.X(f.x[i]), v.Y(f.y[k] * K));
          g.fill();
          g.strokeStyle = cssVar("--bad");
          g.lineWidth = 2;
          g.beginPath();
          g.arc(v.X(f.x[k]), v.Y(f.y[k] * K), 6, 0, 7);
          g.stroke();
        }
        // centre of pressure of the floor load
        const xcp = r.x_cp;
        const yb = v.Y(Math.max(...r.y) * K) - 10;
        g.strokeStyle = cssVar("--good");
        g.fillStyle = cssVar("--good");
        g.lineWidth = 3;
        g.beginPath();
        g.moveTo(v.X(xcp), yb - 40);
        g.lineTo(v.X(xcp), yb);
        g.stroke();
        g.beginPath();
        g.moveTo(v.X(xcp), yb + 2);
        g.lineTo(v.X(xcp) - 6, yb - 10);
        g.lineTo(v.X(xcp) + 6, yb - 10);
        g.fill();
        g.font = "11px Inter";
        g.fillText(tr({ es: "centro de presión del suelo", en: "floor centre of pressure" }), v.X(xcp) + 8, yb - 30);
        // axles
        for (const xa of [0.15, 0.85]) {
          g.strokeStyle = cssVar("--contour");
          g.lineWidth = 1;
          g.setLineDash([3, 4]);
          g.beginPath();
          g.moveTo(v.X(xa), Y0);
          g.lineTo(v.X(xa), 8);
          g.stroke();
          g.setLineDash([]);
        }
        g.fillStyle = cssVar("--fg");
        g.fillText(tr({ es: "eje del.", en: "front axle" }), v.X(0.15) + 3, 16);
        g.fillText(tr({ es: "eje tras.", en: "rear axle" }), v.X(0.85) + 3, 16);
        g.fillText(tr({ es: "escala vertical ×3", en: "vertical scale ×3" }), v.W - 110, 16);
      },
    ]);
    const n = r.x.length;
    let ile = 0;
    for (let i = 1; i < n; i++) if (r.x[i] < r.x[ile]) ile = i;
    const ux = r.x.slice(ile), ucp = r.cp.slice(ile);
    plot.set([
      { x: f.x, y: f.cp, color: cssVar("--accent"), width: 2.8, label: { es: "suelo (cara inferior)", en: "floor (underside)" } },
      { x: ux, y: ucp, color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "carrocería (cara superior)", en: "bodywork (upper side)" } },
    ], [
      { type: "band", x0: 0, x1: r.x_throat0, color: "rgba(34,211,238,0.06)" },
      { type: "band", x0: r.x_diff0, x1: 1, color: "rgba(251,146,60,0.07)" },
      { type: "hline", y: geo.cp_base, color: cssVar("--accent-2"), label: { es: "Cp de base", en: "base Cp" } },
      ...(r.x_sep != null ? [{ type: "vline", x: r.x_sep, color: cssVar("--bad"), label: { es: "separación", en: "separation" } }] : []),
    ]);
    roF.set(r.floor_suction.toFixed(3));
    roB.set(r.downforce.toFixed(3));
    roT.set(r.throat_cp.toFixed(2));
    roAR.set(r.area_ratio.toFixed(2), r.area_ratio > 2.5 ? "warn" : "");
    roS.set(r.x_sep == null ? L("adherido", "attached") : r.x_sep.toFixed(2), r.x_sep == null ? "good" : "bad");
    roBal.set((100 * r.front_share).toFixed(1) + " %");
    roK.set(r.three_d ? r.leakage_factor.toFixed(2) : L("2D (1.00)", "2D (1.00)"), r.three_d ? "warn" : "");
  }
  run();
}

function mapLab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pF = new Plot(row, { height: 250, xlabel: { es: "variable", en: "variable" }, ylabel: { es: "C_L,suelo", en: "C_L,floor" } });
  const pB = new Plot(row, { height: 250, xlabel: { es: "variable", en: "variable" }, ylabel: { es: "reparto delantero [%]", en: "front share [%]" } });
  const pS = new Plot(ui.viz, { height: 170, xlabel: { es: "variable", en: "variable" }, ylabel: { es: "x_sep / L (1 = adherido)", en: "x_sep / L (1 = attached)" }, ylim: [0.5, 1.02] });
  const sV = segmented({ label: { es: "Barrer", en: "Sweep" }, value: "h", options: [{ value: "h", label: { es: "Ride height", en: "Ride height" } }, { value: "rake", label: { es: "Rake", en: "Rake" } }, { value: "diffuser", label: { es: "Ángulo de difusor", en: "Diffuser angle" } }] });
  const status = el("div", { class: "lab-note" });
  const go = button({ es: "▶ Calcular con la geometría del laboratorio anterior", en: "▶ Compute with the previous lab's geometry" }, run, "primary");
  ui.controls.append(sV.el, go, status);
  ui.note.innerHTML = L(
    "Cada punto es un cálculo completo (paneles + capa límite + condición de base) con la geometría actual del laboratorio 1. Busca el máximo de carga frente a la altura (por debajo, el difusor se «ahoga»), cómo el rake añade carga y adelanta el reparto, y el ángulo óptimo de difusor.",
    "Each point is a full computation (panels + boundary layer + base condition) with the current geometry of lab 1. Look for the downforce peak versus height (below it the diffuser “chokes”), how rake adds downforce and moves the balance forward, and the optimum diffuser angle."
  );
  const labels = { h: { es: "ride height h/L", en: "ride height h/L" }, rake: { es: "rake [°]", en: "rake [°]" }, diffuser: { es: "ángulo del difusor [°]", en: "diffuser angle [°]" } };
  async function run() {
    const v = sV.value;
    status.innerHTML = L("Calculando 12 casos en Python…", "Computing 12 cases in Python…");
    const r = await physics.call("underbody.sweep", { var: v, ...geo, n: 12 });
    status.innerHTML = "";
    const cur = v === "h" ? geo.h : v === "rake" ? geo.rake_deg : geo.diffuser_deg;
    for (const p of [pF, pB, pS]) {
      p.opts.xlabel = labels[v];
      p.opts.logX = v === "h";
    }
    const mk = [{ type: "vline", x: cur, color: cssVar("--accent-2"), label: { es: "actual", en: "current" } }];
    pF.set([
      { x: r.values, y: r.floor, color: cssVar("--accent"), width: 2.8, points: true, label: { es: "suelo", en: "floor" } },
      { x: r.values, y: r.body, color: cssVar("--fg-dim"), dash: [5, 4], points: true, label: { es: "cuerpo 2D total", en: "total 2D body" } },
    ], mk);
    pB.set([{ x: r.values, y: r.front_share.map((f) => 100 * f), color: cssVar("--good"), width: 2.6, points: true, label: { es: "reparto delantero", en: "front share" } }], mk);
    pS.set([{ x: r.values, y: r.x_sep.map((s) => (s == null ? 1 : s)), color: cssVar("--bad"), points: true, label: { es: "separación del difusor", en: "diffuser separation" } }], mk);
  }
  run();
}

function floorLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 200 });
  const wait = engineBadge(box);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pCp = new Plot(row, { height: 230, xlabel: { es: "x / L (suelo del coche)", en: "x / L (car floor)" }, ylabel: { es: "Cp bajo el suelo", en: "underfloor Cp" }, invertY: true });
  const pH = new Plot(row, { height: 230, xlabel: { es: "altura de la garganta h/L (ride height)", en: "throat height h/L (ride height)" }, ylabel: { es: "carga del suelo C_L,f", en: "floor downforce C_L,f" } });
  const sH = slider({ label: { es: "Ride height (garganta) h/L", en: "Ride height (throat) h/L" }, min: 0.006, max: 0.08, step: 0.001, value: 0.025, onInput: run });
  const sD = slider({ label: { es: "Ángulo del difusor [°]", en: "Diffuser angle [°]" }, min: 2, max: 18, step: 0.5, value: 8, onInput: () => ((sweepKey = null), run()) });
  const sB = slider({ label: { es: "Cp de base (estela tras el difusor)", en: "Base Cp (wake behind diffuser)" }, min: -0.5, max: 0, step: 0.01, value: -0.25, onInput: () => ((sweepKey = null), run()) });
  ui.controls.append(sH.el, sD.el, sB.el);
  const roC = readout({ es: "Carga del suelo", en: "Floor downforce" });
  const roS = readout({ es: "Separación del difusor", en: "Diffuser separation" }, "x/L");
  const roAR = readout({ es: "Relación de áreas del difusor", en: "Diffuser area ratio" });
  ui.readouts.append(roC.el, roS.el, roAR.el);
  ui.note.innerHTML = L(
    "Modelo cuasi-1D del canal suelo–asfalto (suelo móvil): continuidad + Bernoulli, salida fijada por la presión de base, capa límite turbulenta en el suelo y difusor que deja de recuperar presión al separar. Reproduce la forma clásica: la carga crece al bajar el coche hasta que el difusor «se ahoga» y cae (origen del porpoising).",
    "Quasi-1D model of the floor–road channel (moving ground): continuity + Bernoulli, exit set by base pressure, turbulent boundary layer on the floor and a diffuser that stops recovering pressure when it separates. Reproduces the classic shape: downforce grows as the car is lowered until the diffuser “chokes” and it drops (origin of porpoising)."
  );
  let sweepKey = null, sweep = null, last = null;
  const call = liveCall("floor", "floor.solve", 50);
  function run() {
    call({ h_throat: sH.value, diffuser_deg: sD.value, cp_base: sB.value }, (r) => {
      wait.remove();
      last = r;
      drawChannel(r);
      pCp.set([
        { x: r.x, y: r.cp_ideal, color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "ideal (sin separación)", en: "ideal (no separation)" } },
        { x: r.x, y: r.cp, color: cssVar("--accent"), width: 2.6, label: { es: "con capa límite", en: "with boundary layer" } },
      ], r.x_sep != null ? [{ type: "vline", x: r.x_sep, color: cssVar("--bad"), label: { es: "separación", en: "separation" } }] : []);
      roC.set(r.downforce.toFixed(3));
      roS.set(r.x_sep == null ? L("adherido", "attached") : r.x_sep.toFixed(2), r.x_sep == null ? "good" : "bad");
      roAR.set(r.area_ratio.toFixed(2));
      const key = `${sD.value}|${sB.value}`;
      const plotSweep = () => pH.set([{ x: sweep.h, y: sweep.downforce, color: cssVar("--accent"), width: 2.6, points: true, label: { es: "con separación", en: "with separation" } }, { x: sweep.h, y: sweep.downforce_ideal, color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "ideal", en: "ideal" } }], [{ type: "vline", x: sH.value, color: cssVar("--accent-2") }]);
      if (key === sweepKey && sweep) plotSweep();
      else {
        sweepKey = key;
        physics.latest("floor-sw", "floor.sweep", { diffuser_deg: sD.value, cp_base: sB.value, n: 28 }).then((s) => {
          if (!s) return;
          sweep = s;
          pH.opts.ylim = [0, Math.min(6, Math.max(...s.downforce) * 1.6)];
          plotSweep();
        });
      }
    });
  }
  function drawChannel(r) {
    const dpr = window.devicePixelRatio || 1;
    const W = box.clientWidth, H = box.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssVar("--flow-bg");
    g.fillRect(0, 0, W, H);
    const yG = H - 26;
    const sy = (H - 60) / Math.max(...r.h);
    const X = (x) => 20 + x * (W - 40);
    // road
    g.fillStyle = "#1f2937";
    g.fillRect(0, yG, W, H - yG);
    g.strokeStyle = "#fbbf24";
    g.setLineDash([14, 10]);
    g.lineDashOffset = -performance.now() / 20;
    g.beginPath();
    g.moveTo(0, yG + 10);
    g.lineTo(W, yG + 10);
    g.stroke();
    g.setLineDash([]);
    // underfloor coloured by Cp
    for (let i = 1; i < r.x.length; i++) {
      const cp = r.cp[i];
      const t = Math.min(1, Math.max(0, -cp / 4));
      g.fillStyle = `rgba(${Math.round(34 + 100 * (1 - t))},${Math.round(150 + 60 * t)},${Math.round(238)},${0.15 + 0.6 * t})`;
      g.fillRect(X(r.x[i - 1]), yG - r.h[i] * sy, X(r.x[i]) - X(r.x[i - 1]) + 1, r.h[i] * sy);
    }
    // floor surface
    g.strokeStyle = cssVar("--body-stroke");
    g.lineWidth = 3;
    g.beginPath();
    r.x.forEach((x, i) => (i ? g.lineTo(X(x), yG - r.h[i] * sy) : g.moveTo(X(x), yG - r.h[i] * sy)));
    g.stroke();
    // displacement thickness
    g.strokeStyle = "rgba(244,114,182,0.7)";
    g.lineWidth = 1.2;
    g.beginPath();
    r.x.forEach((x, i) => (i ? g.lineTo(X(x), yG - r.h_eff[i] * sy) : g.moveTo(X(x), yG - r.h_eff[i] * sy)));
    g.stroke();
    if (r.x_sep != null) {
      g.fillStyle = "rgba(244,63,94,0.25)";
      g.beginPath();
      const k = r.x.findIndex((x) => x >= r.x_sep);
      g.moveTo(X(r.x[k]), yG - r.h[k] * sy);
      for (let i = k; i < r.x.length; i++) g.lineTo(X(r.x[i]), yG - r.h[i] * sy);
      for (let i = r.x.length - 1; i >= k; i--) g.lineTo(X(r.x[i]), yG - r.h[k] * sy);
      g.fill();
    }
    g.fillStyle = cssVar("--fg-muted");
    g.font = "11px Inter";
    g.fillText(tr({ es: "suelo del coche (altura exagerada) · rosa: espesor de desplazamiento · rojo: zona separada", en: "car floor (height exaggerated) · pink: displacement thickness · red: separated region" }), 10, 16);
  }
  (function anim() {
    if (!document.body.contains(box)) return;
    if (last) drawChannel(last);
    setTimeout(() => requestAnimationFrame(anim), 60);
  })();
  run();
}


export default {
  subtitle: {
    es: "El suelo de un F1 como tobera convergente, garganta plana y difusor: de dónde sale la carga, por qué el difusor «se ahoga» al bajar el coche y cómo influyen ride height, rake y presión de base.",
    en: "An F1 floor as a convergent nozzle, flat throat and diffuser: where the downforce comes from, why the diffuser “chokes” as the car is lowered, and the role of ride height, rake and base pressure.",
  },
  heroParams: { eps: 0.1, camber: 0.08, alpha: 5 },
  intuition: {
    es: R`<p>El suelo de un F1 forma con el asfalto un <b>conducto</b>: una <span class="term">entrada convergente</span> que acelera el aire, una <span class="term">garganta</span> plana (la zona de mínima altura, donde la velocidad es máxima y la presión mínima) y un <span class="term">difusor</span> que vuelve a abrir la sección en la parte trasera. La carga sale de la succión de toda esa superficie: \(F\approx\int(-C_p)\,q\,dA\).</p>
    <p>La clave es el <b>difusor</b>. El aire tiene que salir por detrás a la presión de la estela del coche (la <span class="term">presión de base</span>, ligeramente negativa). Si el difusor desacelera el flujo de forma eficiente, la garganta puede estar a una presión mucho más baja que la salida: el difusor "tira" del aire bajo el coche (bombeo). Cuanto mayor la relación de áreas difusor/garganta, más velocidad en la garganta… mientras la capa límite aguante el gradiente adverso. Si separa, el chorro sale sin recuperar presión, el caudal cae y se pierde carga.</p>
    <p>Por eso al <b>bajar el coche</b> la carga sube (más velocidad en la garganta) hasta un máximo y luego <b>cae</b>: la relación de áreas se hace enorme, el difusor separa y "se ahoga". Esa pérdida brusca, acoplada a la suspensión, es el origen del <b>porpoising</b>. El <b>rake</b> (trasera más alta) cierra la entrada, abre el difusor y adelanta el centro de presión. En un coche real, los <b>vórtices de los bordes del suelo</b> sellan el canal lateralmente y energizan la capa límite del difusor; en 2D no existen, así que aquí el difusor separa antes que en la realidad.</p>`,
    en: R`<p>An F1 floor and the road form a <b>duct</b>: a <span class="term">convergent inlet</span> that accelerates the air, a flat <span class="term">throat</span> (the minimum-height region, where velocity is highest and pressure lowest) and a <span class="term">diffuser</span> that reopens the section at the rear. Downforce comes from the suction over that whole surface: \(F\approx\int(-C_p)\,q\,dA\).</p>
    <p>The key is the <b>diffuser</b>. Air must leave at the rear at the pressure of the car's wake (the <span class="term">base pressure</span>, slightly negative). If the diffuser decelerates the flow efficiently, the throat can sit at a much lower pressure than the exit: the diffuser "pulls" air under the car (pumping). The larger the diffuser/throat area ratio, the faster the throat flow… as long as the boundary layer withstands the adverse gradient. If it separates, the jet leaves without recovering pressure, mass flow drops and downforce is lost.</p>
    <p>That is why <b>lowering the car</b> raises downforce (faster throat flow) up to a peak and then it <b>drops</b>: the area ratio becomes huge, the diffuser separates and "chokes". That sudden loss, coupled with the suspension, is the origin of <b>porpoising</b>. <b>Rake</b> (rear higher) closes the inlet, opens the diffuser and moves the centre of pressure forward. On a real car, <b>floor-edge vortices</b> seal the channel laterally and energise the diffuser boundary layer; they do not exist in 2D, so here the diffuser separates earlier than in reality.</p>`,
  },
  physics: {
    es: R`<p><b>Canal cuasi-1D</b>: continuidad \(u(x)h(x)=u_e h_e\) y Bernoulli \(C_p(x)=1-(u/U_\infty)^2\). La salida descarga a la presión de base: $$\frac{u_e}{U_\infty}=\sqrt{1-C_{p,base}}\quad\Rightarrow\quad C_{p,garganta}=1-(1-C_{p,base})\left(\frac{A_e}{A_t}\right)^2$$ (si no hay separación). Con \(C_{p,base}=-0.25\) y \(A_e/A_t=2\): \(C_{p,t}=-4\). La relación de áreas efectiva es la del punto de separación si el difusor separa.</p>
    <p><b>Recuperación del difusor</b>: ideal \(C_{p,rec}=1-(A_t/A_e)^2\); real \(\eta_D=C_{p,rec,real}/C_{p,rec,ideal}<1\). Límite por separación de la capa límite turbulenta (criterio tipo Stratford/Head; mapas de Kline: semiángulos 2D por encima de ~7–10° entran en pérdida si no hay control de capa límite).</p>
    <p><b>Modelo 2D del laboratorio</b>: cuerpo 2D (paneles de vórtice lineales) con suelo móvil por imágenes. En lugar de una condición de Kutta en una cola afilada (que tan cerca del suelo da succiones irreales, \(C_p\sim-100\)), la circulación se elige para que el flujo del suelo salga a \(C_{p,base}\) en el punto de descarga \(x_m\): la salida del difusor o, si la capa límite (Thwaites → Head) no aguanta, el punto más aguas abajo hasta el que sigue adherida (bisección). Aguas abajo de \(x_m\), chorro a presión de base.</p>
    <p><b>Datos experimentales</b> (Ruhrmann & Zhang 2003; Cooper et al. 1998; Zhang, Toet & Zerihan 2006): en un cuerpo romo con difusor, la carga frente a la altura muestra aumento, máximo y reducción; el ángulo óptimo de difusor está en torno a 10–15° gracias a los vórtices laterales (en 2D, sin ellos, el óptimo es mucho menor). La carga puede presentar histéresis y comportamiento inestable cerca del máximo.</p>
    <p><b>Balance aerodinámico</b>: el centro de presión del suelo se mueve con altura y rake; un coche que cambia de altura en frenada/aceleración cambia de balance (sensibilidad que los ingenieros intentan minimizar: "plataforma estable").</p>`,
    en: R`<p><b>Quasi-1D channel</b>: continuity \(u(x)h(x)=u_e h_e\) and Bernoulli \(C_p(x)=1-(u/U_\infty)^2\). The exit discharges at base pressure: $$\frac{u_e}{U_\infty}=\sqrt{1-C_{p,base}}\quad\Rightarrow\quad C_{p,throat}=1-(1-C_{p,base})\left(\frac{A_e}{A_t}\right)^2$$ (without separation). With \(C_{p,base}=-0.25\) and \(A_e/A_t=2\): \(C_{p,t}=-4\). The effective area ratio is that of the separation point if the diffuser separates.</p>
    <p><b>Diffuser recovery</b>: ideal \(C_{p,rec}=1-(A_t/A_e)^2\); real \(\eta_D=C_{p,rec,real}/C_{p,rec,ideal}<1\). Limited by turbulent boundary-layer separation (Stratford/Head-type criterion; Kline maps: 2D half-angles above ~7–10° stall without boundary-layer control).</p>
    <p><b>The lab's 2D model</b>: 2D body (linear vortex panels) with a moving ground by images. Instead of a Kutta condition at a sharp tail (which this close to the ground gives unphysical suction, \(C_p\sim-100\)), circulation is chosen so that the floor flow leaves at \(C_{p,base}\) at the discharge point \(x_m\): the diffuser exit or, if the boundary layer (Thwaites → Head) cannot cope, the furthest point up to which it stays attached (bisection). Downstream of \(x_m\), a jet at base pressure.</p>
    <p><b>Experimental data</b> (Ruhrmann & Zhang 2003; Cooper et al. 1998; Zhang, Toet & Zerihan 2006): a bluff body with a diffuser shows force enhancement, a maximum and force reduction versus height; the optimum diffuser angle is around 10–15° thanks to the side vortices (in 2D, without them, the optimum is much lower). Downforce can show hysteresis and unsteady behaviour near the maximum.</p>
    <p><b>Aero balance</b>: the floor centre of pressure moves with ride height and rake; a car that changes height under braking/acceleration changes balance (a sensitivity engineers try to minimise: "stable platform").</p>`,
  },
  labs: [
    { title: { es: "Suelo Venturi 2D: entrada convergente, garganta y difusor", en: "2D Venturi floor: convergent inlet, throat and diffuser" }, desc: { es: "Baja el ride height y observa cómo la separación (rojo) avanza por el difusor; abre el ángulo del difusor; añade rake y mira moverse el centro de presión.", en: "Lower the ride height and watch separation (red) creep up the diffuser; open the diffuser angle; add rake and watch the centre of pressure move." }, mount: underbodyLab },
    { title: { es: "Mapa de sensibilidad: ride height, rake y ángulo de difusor", en: "Sensitivity map: ride height, rake and diffuser angle" }, mount: mapLab },
    { title: { es: "Modelo 1D del canal: por qué el difusor «se ahoga»", en: "1D channel model: why the diffuser “chokes”" }, desc: { es: "La misma física reducida a continuidad + Bernoulli + capa límite: útil para razonar en una pizarra.", en: "The same physics reduced to continuity + Bernoulli + boundary layer: handy for whiteboard reasoning." }, mount: floorLab },
  ],
  interview: [
    { q: { es: "¿Cómo genera carga el suelo de un F1 y qué papel tiene el difusor?", en: "How does an F1 floor generate downforce and what does the diffuser do?" }, a: { es: R`<p>El suelo y el asfalto forman un canal Venturi: la entrada convergente acelera el aire, la garganta (mínima altura) está a muy baja presión y el difusor desacelera el flujo para que salga a la presión de la estela. Gracias a la recuperación de presión del difusor, la garganta puede estar a una presión mucho menor que la de salida: aumenta el caudal y la succión bajo todo el suelo. El límite lo pone la separación de la capa límite en el difusor; los vórtices de los bordes sellan el canal y energizan esa capa límite.</p>`, en: R`<p>Floor and road form a Venturi channel: the convergent inlet accelerates the air, the throat (minimum height) sits at very low pressure and the diffuser decelerates the flow so it leaves at wake pressure. Thanks to the diffuser's pressure recovery, the throat can be at a much lower pressure than the exit: mass flow and suction under the whole floor increase. The limit is boundary-layer separation in the diffuser; floor-edge vortices seal the channel and energise that boundary layer.</p>` } },
    { q: { es: "¿Por qué la carga cae si bajas demasiado el coche? ¿Qué tiene que ver con el porpoising?", en: "Why does downforce fall if the car is too low? How is that related to porpoising?" }, a: { es: R`<p>Al bajar la garganta crece la relación de áreas del difusor y su gradiente adverso; llega un punto en que la capa límite separa (y los vórtices de borde pueden estallar o perder el sellado): el difusor deja de recuperar presión, cae el caudal y la carga. Si el coche baja por la carga a alta velocidad, entra en esa zona, pierde carga, sube, la recupera y vuelve a bajar: oscilación acoplada aerodinámica-suspensión, el porpoising. Se combate con suspensión más rígida, más altura, geometría del suelo menos sensible (bordes, difusor) y plataforma estable.</p>`, en: R`<p>As the throat lowers, the diffuser area ratio and its adverse gradient grow; at some point the boundary layer separates (and edge vortices may burst or lose sealing): the diffuser stops recovering pressure, mass flow and downforce drop. If downforce pulls the car down at high speed into that region, it loses downforce, rises, regains it and goes down again: an aero-suspension coupled oscillation, porpoising. It is fought with stiffer suspension, more ride height, less sensitive floor geometry (edges, diffuser) and a stable platform.</p>` } },
    { q: { es: "¿Qué efecto tiene el rake?", en: "What does rake do?" }, a: { es: R`<p>Subir la trasera respecto al morro cierra la entrada y la garganta delanteras y aumenta el volumen/relación de áreas del difusor: más carga del suelo (si el difusor aguanta, ayudado por vórtices) y centro de presión más adelantado. Concepto de "alto rake" en la era pre-2022; con el suelo de efecto suelo de 2022 los coches van más bajos y planos por la sensibilidad a la altura.</p>`, en: R`<p>Raising the rear relative to the nose closes the front inlet/throat and increases the diffuser volume/area ratio: more floor downforce (if the diffuser copes, helped by vortices) and a more forward centre of pressure. The "high rake" concept of the pre-2022 era; with the 2022 ground-effect floors cars run lower and flatter because of ride-height sensitivity.</p>` } },
    { q: { es: "¿Qué es la presión de base y por qué importa para el difusor?", en: "What is base pressure and why does it matter for the diffuser?" }, a: { es: R`<p>Es la presión en la estela detrás del coche, ligeramente por debajo de la ambiente. El difusor descarga ahí: cuanto más baja (estela más "succionante", p. ej. por el beam wing o el alerón trasero que inducen upwash/extracción), más caudal saca del suelo y más carga se obtiene. Por eso alerón trasero, beam wing y difusor se diseñan juntos.</p>`, en: R`<p>It is the pressure in the wake behind the car, slightly below ambient. The diffuser discharges there: the lower it is (a more "sucking" wake, e.g. thanks to the beam wing or rear wing inducing upwash/extraction), the more flow it pulls from the floor and the more downforce. That is why rear wing, beam wing and diffuser are designed together.</p>` } },
  ],
  myths: [
    { es: "«Más ángulo de difusor = más carga». Solo hasta que la capa límite separa; a partir de ahí la carga cae.", en: "“More diffuser angle = more downforce”. Only until the boundary layer separates; beyond that downforce falls." },
    { es: "«El suelo funciona como un ala invertida aislada». Funciona como un conducto: el caudal lo fijan la garganta, el difusor y la presión de base; el suelo y el asfalto son las dos paredes.", en: "“The floor works like an isolated inverted wing”. It works like a duct: mass flow is set by the throat, the diffuser and the base pressure; floor and road are the two walls." },
    { es: "«Cuanto más bajo, siempre mejor». Hay un óptimo; por debajo el difusor se ahoga y aparece el porpoising.", en: "“The lower, always the better”. There is an optimum; below it the diffuser chokes and porpoising appears." },
  ],
  quiz: [
    { q: { es: "Con Cp_base = −0.25 y relación de áreas difusor/garganta 2, sin separación, Cp en la garganta ≈", en: "With Cp_base = −0.25 and diffuser/throat area ratio 2, without separation, throat Cp ≈" }, options: [{ es: "−1", en: "−1" }, { es: "−2", en: "−2" }, { es: "−4", en: "−4" }, { es: "−8", en: "−8" }], correct: 2, explain: { es: "1 − 1.25·2² = −4.", en: "1 − 1.25·2² = −4." } },
    { q: { es: "Si el difusor separa, el punto que fija el caudal pasa a ser…", en: "If the diffuser separates, the point that sets the mass flow becomes…" }, options: [{ es: "la entrada", en: "the inlet" }, { es: "el punto de separación (descarga a presión de base)", en: "the separation point (discharge at base pressure)" }, { es: "el morro", en: "the nose" }, { es: "nada cambia", en: "nothing changes" }], correct: 1, explain: { es: "Aguas abajo el chorro ya no recupera presión: la relación de áreas efectiva es la de la separación.", en: "Downstream the jet no longer recovers pressure: the effective area ratio is that of separation." } },
    { q: { es: "Aumentar el rake normalmente…", en: "Increasing rake normally…" }, options: [{ es: "retrasa el centro de presión", en: "moves the centre of pressure rearward" }, { es: "adelanta el centro de presión y aumenta la carga del suelo", en: "moves the centre of pressure forward and increases floor downforce" }, { es: "no cambia nada", en: "changes nothing" }, { es: "elimina el difusor", en: "removes the diffuser" }], correct: 1, explain: { es: "Entrada más cerrada delante y difusor más abierto detrás.", en: "Tighter inlet at the front and more open diffuser at the rear." } },
  ],
  refs: [
    "X. Zhang, W. Toet & J. Zerihan, “Ground effect aerodynamics of race cars”, <i>Appl. Mech. Rev.</i> 59, 2006.",
    "A. Ruhrmann & X. Zhang, “Influence of diffuser angle on a bluff body in ground effect”, <i>J. Fluids Eng.</i> 125, 2003.",
    "K.R. Cooper, T. Bertényi, G. Dutil, J. Syms & G. Sovran, “The aerodynamic performance of automotive underbody diffusers”, SAE 980030, 1998.",
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 7 (underbody and diffusers).",
    "S.J. Kline, D.E. Abbott, R.W. Fox, “Optimum design of straight-walled diffusers”, <i>J. Basic Eng.</i> 81, 1959.",
  ],
};
