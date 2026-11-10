import { slider, labLayout, readout, toggle, button, L, tr, engineBadge, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { FlowView, cpColor, contourSegments } from "../js/core/field.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function kuttaLab(host) {
  const ui = labLayout(host);
  const fv = new FlowView(ui.viz, { height: 320, world: { x0: -2.6, x1: 2.9, y0: -1.2, y1: 1.2 }, particles: 1000, speed: 0.004 });
  const wait = engineBadge(fv.box);
  const plot = new Plot(ui.viz, { height: 220, invertY: true, xlabel: { es: "x (cuerda de −2 a 2)", en: "x (chord from −2 to 2)" }, ylabel: { es: "Cp", en: "Cp" }, ylim: [-6, 1.2] });
  let gK = 2.2;
  const sA = slider({ label: { es: "Ángulo de ataque α [°]", en: "Angle of attack α [°]" }, min: -5, max: 15, step: 0.5, value: 6, onInput: run });
  const sF = slider({ label: { es: "Circulación impuesta Γ / Γ_Kutta", en: "Imposed circulation Γ / Γ_Kutta" }, min: -0.5, max: 2, step: 0.01, value: 0, onInput: run });
  const kbtn = button({ es: "Aplicar condición de Kutta", en: "Apply the Kutta condition" }, () => {
    sF.value = 1;
    run();
  }, "primary");
  const tPsi = toggle({ label: { es: "Líneas de corriente exactas (ψ)", en: "Exact streamlines (ψ)" }, value: true, onInput: run });
  ui.controls.append(sA.el, sF.el, kbtn, tPsi.el);
  const roCl = readout({ es: "Cl = 2Γ/(V c)", en: "Cl = 2Γ/(V c)" });
  const roTE = readout({ es: "Velocidad en el borde de salida", en: "Trailing-edge speed" }, "V∞");
  ui.readouts.append(roCl.el, roTE.el);
  ui.note.innerHTML = L(
    R`Perfil de Joukowski (solución exacta por transformación conforme). Con cualquier Γ distinta de Γ<sub>Kutta</sub> el flujo rodea el borde de salida afilado con velocidad <b>infinita</b> y el punto de remanso trasero no está en el borde. La condición de Kutta elige la única Γ con velocidad finita y salida suave: \(\Gamma_K = 4\pi V_\infty R\sin(\alpha+\beta)\).`,
    R`Joukowski airfoil (exact conformal-map solution). With any Γ other than Γ<sub>Kutta</sub> the flow wraps around the sharp trailing edge at <b>infinite</b> speed and the rear stagnation point is not at the edge. The Kutta condition picks the only Γ with finite speed and smooth flow-off: \(\Gamma_K = 4\pi V_\infty R\sin(\alpha+\beta)\).`
  );
  const call = liveCall("kutta", "joukowski.solve", 40);
  function run() {
    // first query Γ_K for this α, then impose fraction of it
    physics.latest("kutta-k", "joukowski.solve", { eps: 0.1, camber: 0.08, alpha: sA.value, nx: 10, ny: 6 }).then((k) => {
      if (!k) return;
      gK = k.gamma_kutta;
      call({ eps: 0.1, camber: 0.08, alpha: sA.value, gamma: sF.value * gK, x0: -2.6, x1: 2.9, y0: -1.2, y1: 1.2, nx: 130, ny: 64 }, draw);
    });
  }
  function draw(r) {
    wait.remove();
    fv.setBodies([{ x: r.surface.x, y: r.surface.y }]);
    fv.setField(r.field, { reseed: !fv.field });
    if (tPsi.value) {
      const segs = [];
      for (let k = -24; k <= 24; k++) segs.push(...contourSegments(r.field.x, r.field.y, r.field.psi, k * 0.12 + 1e-4));
      fv.setContours([{ segments: segs, color: cssVar("--contour") }]);
    } else fv.setContours([]);
    fv.setOverlays([
      (g, v) => {
        for (const p of r.surface.stagnation) {
          g.fillStyle = "#fbbf24";
          g.beginPath();
          g.arc(v.X(p[0]), v.Y(p[1]), 6, 0, 7);
          g.fill();
        }
        g.fillStyle = cssVar("--fg");
        g.font = "12px Inter";
        g.fillText(tr({ es: "● puntos de remanso", en: "● stagnation points" }), 10, 18);
      },
    ]);
    const n = r.surface.x.length;
    const sp = r.surface.speed;
    // trailing-edge speed: surface point closest to the TE (theta = -beta), excluding exact singular node
    let ite = 0;
    for (let i = 0; i < n; i++) if (r.surface.x[i] > r.surface.x[ite]) ite = i;
    const teSpeed = Math.max(sp[(ite + 2) % n], sp[(ite - 2 + n) % n]);
    roTE.set(teSpeed >= 7.9 ? "→ ∞" : teSpeed.toFixed(2), Math.abs(sF.value - 1) < 0.02 ? "good" : "bad");
    roCl.set(r.cl.toFixed(3));
    plot.set([{ x: r.surface.x, y: r.surface.cp, color: cssVar("--accent"), label: { es: "Cp en la superficie", en: "surface Cp" }, width: 2 }]);
  }
  run();
}

function startingVortexLab(host) {
  const ui = labLayout(host);
  const box = el("div", { class: "cbox", style: "height:280px" });
  const canvas = el("canvas");
  box.appendChild(canvas);
  ui.viz.appendChild(box);
  const wait = engineBadge(box);
  const plot = new Plot(ui.viz, { height: 220, xlabel: { es: "s = 2Vt/c (semicuerdas recorridas)", en: "s = 2Vt/c (semi-chords travelled)" }, ylabel: { es: "Γ / Γ_estacionaria  ·  Cl / Cl_est", en: "Γ / Γ_steady  ·  Cl / Cl_steady" }, ylim: [-1.05, 1.15] });
  const tU = toggle({ label: { es: "Mejora: panel no estacionario con estela libre", en: "Upgrade: unsteady panel method with free wake" }, value: true, onInput: restart });
  const sA = slider({ label: { es: "α del arranque [°]", en: "Start-up α [°]" }, min: 2, max: 12, step: 1, value: 6, onInput: restart });
  const play = button({ es: "▶ Arrancar de nuevo", en: "▶ Restart" }, () => (t0 = performance.now()), "primary");
  ui.controls.append(tU.el, sA.el, play);
  const roB = readout({ es: "Γ ligada", en: "bound Γ" });
  const roW = readout({ es: "Σ Γ en la estela", en: "Σ Γ in the wake" });
  const roT = readout({ es: "Γ total (Kelvin)", en: "total Γ (Kelvin)" });
  ui.readouts.append(roB.el, roW.el, roT.el);
  ui.note.innerHTML = L(
    R`<b>Sin la mejora</b>: función de Wagner (aprox. de R.T. Jones) para una placa delgada y una estela plana dibujada de forma esquemática. <b>Con la mejora</b>: método de paneles no estacionario en Python. En cada paso se desprende un vórtice en el borde de salida, se imponen Kutta y <b>Kelvin</b> (circulación total nula) y la estela se convecta libremente, de modo que se ve <b>enrollarse el vórtice de arranque</b>. El Cl sale de la derivada del impulso de vorticidad y se compara con Wagner (curva discontinua).`,
    R`<b>Without the upgrade</b>: Wagner's function (R.T. Jones approximation) for a thin plate and a schematically drawn flat wake. <b>With the upgrade</b>: unsteady panel method in Python. Each step sheds a vortex at the trailing edge, imposes Kutta and <b>Kelvin</b> (zero total circulation), and the wake convects freely, so you see the <b>starting vortex roll up</b>. Cl comes from the time derivative of the vortex impulse and is compared with Wagner (dashed curve).`
  );
  let wag = null, sim = null, t0 = performance.now();
  physics.call("lift.wagner", { s_max: 24, n: 241 }).then((r) => {
    wag = r;
    wait.remove();
    if (!tU.value) {
      roB.set(wag.phi[0].toFixed(3));
      roW.set(wag.shed[0].toFixed(3));
      roT.set((wag.phi[0] + wag.shed[0]).toFixed(3), "good");
    }
    drawPlot();
  });
  function restart() {
    sim = null;
    t0 = performance.now();
    if (tU.value) {
      box.appendChild(wait);
      physics.latest("unst", "unsteady.simulate", { motion: "step", alpha0: sA.value, t_end: 10, dt: 0.05, save_every: 2 }).then((r) => {
        if (!r) return;
        sim = r;
        wait.remove();
        t0 = performance.now();
        // initial values right away (the animation updates them frame by frame)
        const f0 = sim.frames[0];
        const gb0 = sim.gamma_bound[Math.max(0, Math.min(sim.gamma_bound.length - 1, Math.round(f0.t / 0.05) - 1))];
        const w0 = f0.g.reduce((a, b) => a + b, 0);
        roB.set(gb0.toFixed(4));
        roW.set(w0.toFixed(4));
        roT.set((gb0 + w0).toExponential(1), "good");
        drawPlot();
      });
    } else drawPlot();
  }
  function drawPlot(k) {
    if (!wag) return;
    const s = [{ x: wag.s, y: wag.phi, color: cssVar(sim && tU.value ? "--fg-dim" : "--accent"), dash: sim && tU.value ? [5, 4] : [], label: { es: "Wagner (teoría)", en: "Wagner (theory)" } }];
    if (sim && tU.value) {
      const gss = -sim.cl_steady / 2;
      s.push({ x: sim.s, y: sim.cl.map((c) => c / sim.cl_steady), color: cssVar("--accent"), width: 2.4, label: { es: "Cl/Cl_est (panel + estela libre)", en: "Cl/Cl_steady (panel + free wake)" } });
      s.push({ x: sim.s, y: sim.gamma_bound.map((g) => g / gss), color: cssVar("--accent-3"), label: { es: "Γ ligada (panel)", en: "bound Γ (panel)" } });
    } else s.push({ x: wag.s, y: wag.phi.map((p) => -p), color: cssVar("--accent-2"), label: { es: "Γ desprendida acumulada", en: "accumulated shed Γ" } });
    plot.set(s, k != null ? [{ type: "vline", x: k, color: cssVar("--fg-dim") }] : []);
  }
  function frame() {
    if (!document.body.contains(box)) return;
    requestAnimationFrame(frame);
    if (!wag) return;
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
    if (tU.value && sim) {
      const fr = sim.frames;
      const k = Math.min(fr.length - 1, Math.floor(((performance.now() - t0) / 1000) * 12));
      const f = fr[k];
      const sc = Math.min(W / 7.5, H / 1.6);
      const X = (x) => 30 + x * sc, Y = (y) => H * 0.42 - y * sc;
      g.fillStyle = cssVar("--body-fill");
      g.strokeStyle = cssVar("--body-stroke");
      g.beginPath();
      sim.body.x.forEach((x, i) => (i ? g.lineTo(X(x), Y(sim.body.y[i])) : g.moveTo(X(x), Y(sim.body.y[i]))));
      g.closePath();
      g.fill();
      g.stroke();
      const gmax = Math.max(...f.g.map(Math.abs), 1e-9);
      for (let i = 0; i < f.x.length; i++) {
        const a = Math.min(1, 0.25 + Math.abs(f.g[i]) / gmax);
        g.fillStyle = f.g[i] > 0 ? `rgba(251,146,60,${a})` : `rgba(34,211,238,${a})`;
        g.beginPath();
        g.arc(X(f.x[i]), Y(f.y[i]), 2 + 3 * Math.sqrt(Math.abs(f.g[i]) / gmax), 0, 7);
        g.fill();
      }
      const wake = f.g.reduce((a, b) => a + b, 0);
      const idx = Math.min(sim.gamma_bound.length - 1, Math.round(f.t / 0.05) - 1);
      const gb = sim.gamma_bound[idx];
      roB.set(gb.toFixed(4));
      roW.set(wake.toFixed(4));
      roT.set((gb + wake).toExponential(1), "good");
      g.fillStyle = cssVar("--fg-muted");
      g.font = "12px Inter";
      g.fillText(`s = ${(2 * f.t).toFixed(1)}`, 10, 18);
      g.fillText(tr({ es: "naranja: vorticidad antihoraria (vórtice de arranque) · cian: horaria", en: "orange: anticlockwise vorticity (starting vortex) · cyan: clockwise" }), 10, H - 10);
      if (k % 6 === 0) drawPlot(2 * f.t);
      return;
    }
    // Wagner mode (schematic flat wake)
    const sNow = Math.min(24, ((performance.now() - t0) / 1000) * 3);
    const k = Math.min(wag.s.length - 1, Math.round((sNow / 24) * (wag.s.length - 1)));
    const semi = Math.min(40, W / 34);
    const xTE = W * 0.18 + 2 * semi;
    const yc = H * 0.45;
    g.fillStyle = cssVar("--body-fill");
    g.strokeStyle = cssVar("--body-stroke");
    g.beginPath();
    g.ellipse(xTE - semi, yc, semi, semi * 0.16, -0.08, 0, 7);
    g.fill();
    g.stroke();
    const phi = wag.phi[k];
    let wake = 0;
    for (let i = 0; i <= k; i++) {
      wake += wag.shed[i];
      const x = xTE + (wag.s[k] - wag.s[i]) * semi;
      if (x > W) continue;
      g.fillStyle = `rgba(251,146,60,${Math.min(0.9, 0.15 + Math.abs(wag.shed[i]) * 3)})`;
      g.beginPath();
      g.arc(x, yc + 4 * Math.sin(i * 0.7), Math.max(1.5, Math.sqrt(Math.abs(wag.shed[i])) * 28), 0, 7);
      g.fill();
    }
    g.fillStyle = cssVar("--fg-muted");
    g.font = "12px Inter";
    g.fillText(`s = ${wag.s[k].toFixed(1)}`, 10, 18);
    roB.set(phi.toFixed(3));
    roW.set(wake.toFixed(3));
    roT.set((phi + wake).toFixed(3), "good");
    if (k % 6 === 0) drawPlot(wag.s[k]);
  }
  requestAnimationFrame(frame);
  restart();
}

function transitLab(host) {
  const ui = labLayout(host);
  const fv = new FlowView(ui.viz, { height: 330, world: { x0: -3.6, x1: 3.4, y0: -1.3, y1: 1.3 }, particles: 0, speed: 0 });
  const wait = engineBadge(fv.box);
  const sA = slider({ label: { es: "Ángulo de ataque α [°]", en: "Angle of attack α [°]" }, min: 0, max: 12, step: 1, value: 6, onInput: run });
  const play = button({ es: "▶ Soltar partículas", en: "▶ Release particles" }, () => (t0 = performance.now()), "primary");
  ui.controls.append(sA.el, play);
  const roDt = readout({ es: "Adelanto de la partícula superior en el BS", en: "Upper particle lead at TE" }, "c/V∞");
  ui.readouts.append(roDt.el);
  ui.note.innerHTML = L(
    "Una fila vertical de partículas se suelta a la vez. Las que pasan por encima llegan al borde de salida <b>mucho antes</b> que sus vecinas de abajo, que no las alcanzan nunca. El argumento del «tiempo de tránsito igual» es falso: la velocidad mayor arriba es consecuencia de la circulación, no de una cita a ciegas en el borde de salida.",
    "A vertical row of particles is released at once. Those passing over the top reach the trailing edge <b>much earlier</b> than their lower neighbours, which never catch up. The “equal transit time” argument is false: the higher speed on top is a consequence of circulation, not of a blind date at the trailing edge."
  );
  let tr_ = null;
  let t0 = performance.now();
  function run() {
    const starts = [];
    for (let i = 0; i < 31; i++) starts.push([-3.4, -0.75 + (1.5 * i) / 30]);
    physics.latest("transit", "joukowski.trace", { eps: 0.1, camber: 0.08, alpha: sA.value, starts, t_end: 7, dt: 0.01 }).then((r) => {
      if (!r) return;
      wait.remove();
      tr_ = r;
      t0 = performance.now();
      fv.setBodies([{ x: r.surface.x, y: r.surface.y }]);
      // arrival time at x = TE for the two particles straddling the stagnation streamline
      const xte = Math.max(...r.surface.x);
      const arrive = r.x.map((xs) => {
        const k = xs.findIndex((x) => x >= xte);
        return k < 0 ? Infinity : r.t[k];
      });
      // first particle passing above the body vs first below
      let up = Infinity, lo = Infinity;
      r.y.forEach((ys, i) => {
        const k = r.x[i].findIndex((x) => x >= 0);
        if (k < 0) return;
        if (ys[k] > 0) up = Math.min(up, arrive[i]);
        else lo = Math.min(lo, isFinite(arrive[i]) ? arrive[i] : Infinity);
      });
      roDt.set(isFinite(lo - up) ? ((lo - up) / 4).toFixed(2) : "∞");
    });
  }
  fv.setOverlays([
    (g, v) => {
      if (!tr_) return;
      const sec = (performance.now() - t0) / 1000;
      const k = Math.min(tr_.t.length - 1, Math.floor(sec * 12));
      g.lineWidth = 1.5;
      // timeline polyline
      g.strokeStyle = "rgba(251,191,36,0.9)";
      g.beginPath();
      tr_.x.forEach((xs, i) => {
        const X = v.X(xs[k]), Y = v.Y(tr_.y[i][k]);
        i ? g.lineTo(X, Y) : g.moveTo(X, Y);
      });
      g.stroke();
      tr_.x.forEach((xs, i) => {
        const above = tr_.y[i][0] > -0.06;
        g.fillStyle = above ? cssVar("--accent") : cssVar("--accent-2");
        g.beginPath();
        g.arc(v.X(xs[k]), v.Y(tr_.y[i][k]), 3.5, 0, 7);
        g.fill();
      });
    },
  ]);
  (function anim() {
    if (!document.body.contains(fv.box)) return;
    fv.redraw();
    requestAnimationFrame(anim);
  })();
  run();
}

export default {
  subtitle: {
    es: "La explicación completa y correcta: curvatura del flujo, gradientes de presión, circulación y la condición de Kutta. Sin mitos.",
    en: "The complete, correct explanation: flow curvature, pressure gradients, circulation and the Kutta condition. No myths.",
  },
  heroParams: { eps: 0.1, camber: 0.1, alpha: 8 },
  intuition: {
    es: R`<p>Un perfil a incidencia (o con curvatura) <b>desvía</b> el flujo hacia abajo. Para curvar las líneas de corriente hace falta un gradiente de presión normal a ellas: sobre el extradós las líneas se curvan alrededor del perfil y la presión <b>baja</b> hacia la superficie (succión); bajo el intradós el flujo se frena y la presión sube. La integral de esa diferencia de presiones es la sustentación. Por la 3ª ley de Newton, el aire recibe una cantidad de movimiento hacia abajo (<span class="term">downwash</span>) igual a la fuerza: las dos explicaciones (presiones y Newton) son la misma física vista desde dos sitios.</p>
    <p>Pero el flujo potencial alrededor de un perfil admite <b>infinitas soluciones</b>, una por cada circulación \(\Gamma\). ¿Cuál elige la naturaleza? La que hace que el flujo abandone el <b>borde de salida afilado</b> suavemente, con velocidad finita: la <span class="term">condición de Kutta</span>. Físicamente la impone la viscosidad: al arrancar, el flujo intenta rodear el borde de salida, la capa límite no puede soportar esa enorme deceleración, separa y enrolla un <span class="term">vórtice de arranque</span> que se va con la estela. Por Kelvin, alrededor del perfil queda una circulación igual y opuesta: la que da la sustentación.</p>`,
    en: R`<p>An airfoil at incidence (or with camber) <b>deflects</b> the flow downwards. Curving streamlines requires a pressure gradient normal to them: over the upper surface streamlines curve around the airfoil and pressure <b>drops</b> towards the surface (suction); under the lower surface the flow slows and pressure rises. Integrating that pressure difference gives lift. By Newton's 3rd law the air receives downward momentum (<span class="term">downwash</span>) equal to the force: pressure and Newton explanations are the same physics seen from two places.</p>
    <p>However, potential flow around an airfoil admits <b>infinitely many solutions</b>, one for each circulation \(\Gamma\). Which one does nature choose? The one where the flow leaves the <b>sharp trailing edge</b> smoothly, with finite velocity: the <span class="term">Kutta condition</span>. Physically viscosity enforces it: at start-up the flow tries to wrap around the trailing edge, the boundary layer cannot withstand that huge deceleration, separates and rolls up a <span class="term">starting vortex</span> that leaves with the wake. By Kelvin, an equal and opposite circulation remains around the airfoil: the one producing lift.</p>`,
  },
  physics: {
    es: R`<p><b>Condición de Kutta</b> (formulaciones equivalentes para un borde de salida afilado):</p>
    <ul><li>El flujo abandona el perfil de forma suave en el borde de salida (bisectriz del ángulo de salida).</li>
    <li>La velocidad en el borde de salida es <b>finita</b> (cero si el ángulo es finito, igual arriba y abajo si es una cúspide).</li>
    <li>Presiones iguales en extradós e intradós en el borde de salida: \(p_{u,TE}=p_{l,TE}\). En un método de paneles de vórtices: \(\gamma(TE)=0\) ⇔ \(\gamma_{u}+\gamma_{l}=0\).</li></ul>
    <p>Para el perfil de Joukowski (círculo de radio \(R\) por \(\zeta=1\), \(z=\zeta+1/\zeta\)) la condición da $$\Gamma_K = 4\pi V_\infty R\,\sin(\alpha+\beta),\qquad C_l=\frac{2\Gamma_K}{V_\infty c}\approx 2\pi(\alpha+\beta)\frac{4R}{c}$$ donde \(\beta\) es el ángulo de sustentación nula (curvatura).</p>
    <p><b>Teoría del perfil delgado</b>: \(C_l = 2\pi(\alpha-\alpha_{L0})\) por radián, centro aerodinámico en \(c/4\).</p>
    <p><b>Kelvin y vórtice de arranque</b>: \(D\Gamma/Dt=0\) para un contorno material ⇒ \(\Gamma_{ligada}+\Gamma_{estela}=0\). La sustentación transitoria tras un arranque brusco sigue la función de Wagner \(\Phi(s)\), \(s=2Vt/c\): \(\Phi(0)=0.5\), \(\Phi\to1\).</p>
    <p><b>Visión de cantidad de movimiento</b>: en 3D, la sustentación es igual al flujo de cantidad de movimiento vertical comunicado a la estela; en 2D no hay una masa "lanzada hacia abajo" bien definida en el infinito (el upwash delante compensa el downwash detrás), por eso la explicación por presiones + circulación es la rigurosa.</p>
    <div class="callout key"><div class="ct">Frase de entrevista</div>“El perfil curva el flujo; la curvatura exige un gradiente de presión normal, que crea succión arriba y sobrepresión abajo. En flujo potencial hay infinitas soluciones; la condición de Kutta, impuesta físicamente por la viscosidad en el borde de salida afilado, fija la circulación y por Kutta-Joukowski \(L'=\rho V\Gamma\). El vórtice de arranque conserva la circulación total (Kelvin).”</div>`,
    en: R`<p><b>Kutta condition</b> (equivalent statements for a sharp trailing edge):</p>
    <ul><li>The flow leaves the airfoil smoothly at the trailing edge (along the bisector of the TE angle).</li>
    <li>Velocity at the trailing edge is <b>finite</b> (zero for a finite angle, equal top and bottom for a cusp).</li>
    <li>Equal upper and lower pressures at the trailing edge: \(p_{u,TE}=p_{l,TE}\). In a vortex panel method: \(\gamma(TE)=0\) ⇔ \(\gamma_{u}+\gamma_{l}=0\).</li></ul>
    <p>For the Joukowski airfoil (circle of radius \(R\) through \(\zeta=1\), \(z=\zeta+1/\zeta\)) it gives $$\Gamma_K = 4\pi V_\infty R\,\sin(\alpha+\beta),\qquad C_l=\frac{2\Gamma_K}{V_\infty c}\approx 2\pi(\alpha+\beta)\frac{4R}{c}$$ with \(\beta\) the zero-lift angle (camber).</p>
    <p><b>Thin-airfoil theory</b>: \(C_l = 2\pi(\alpha-\alpha_{L0})\) per radian, aerodynamic centre at \(c/4\).</p>
    <p><b>Kelvin and the starting vortex</b>: \(D\Gamma/Dt=0\) for a material contour ⇒ \(\Gamma_{bound}+\Gamma_{wake}=0\). The transient lift after an impulsive start follows Wagner's function \(\Phi(s)\), \(s=2Vt/c\): \(\Phi(0)=0.5\), \(\Phi\to1\).</p>
    <p><b>Momentum view</b>: in 3D lift equals the vertical momentum flux imparted to the wake; in 2D there is no well-defined "mass thrown down" at infinity (upwash ahead balances downwash behind), which is why the pressure + circulation explanation is the rigorous one.</p>
    <div class="callout key"><div class="ct">Interview sentence</div>“The airfoil turns the flow; streamline curvature requires a normal pressure gradient, giving suction on top and overpressure below. Potential flow has infinitely many solutions; the Kutta condition, physically imposed by viscosity at the sharp trailing edge, fixes the circulation, and Kutta-Joukowski gives \(L'=\rho V\Gamma\). The starting vortex conserves total circulation (Kelvin).”</div>`,
  },
  labs: [
    { title: { es: "Busca la circulación de Kutta", en: "Find the Kutta circulation" }, desc: { es: "Empieza con Γ = 0 y aumenta. Mira el punto de remanso trasero y la velocidad en el borde de salida.", en: "Start with Γ = 0 and increase it. Watch the rear stagnation point and the trailing-edge speed." }, mount: kuttaLab },
    { title: { es: "Vórtice de arranque y teorema de Kelvin", en: "Starting vortex and Kelvin's theorem" }, desc: { es: "Arranque impulsivo: la circulación ligada crece según Wagner mientras la estela acumula la opuesta.", en: "Impulsive start: bound circulation grows following Wagner while the wake accumulates the opposite." }, mount: startingVortexLab },
    { title: { es: "Adiós al «tiempo de tránsito igual»", en: "Goodbye “equal transit time”" }, desc: { es: "Partículas soltadas simultáneamente en el flujo exacto alrededor del perfil.", en: "Particles released simultaneously in the exact flow around the airfoil." }, mount: transitLab },
  ],
  interview: [
    { q: { es: "¿Cómo genera sustentación un perfil? (pregunta casi segura)", en: "How does an airfoil generate lift? (almost certain question)" }, a: { es: R`<p>1) El perfil, por incidencia y curvatura, desvía el flujo hacia abajo. 2) Curvar las líneas de corriente requiere \(\partial p/\partial n=\rho V^2/R\): la presión cae sobre el extradós y sube en el intradós. 3) En flujo potencial hay infinitas soluciones; la <b>condición de Kutta</b> (salida suave y velocidad finita en el borde de salida afilado, consecuencia de la viscosidad) fija una única circulación. 4) Kutta-Joukowski: \(L'=\rho V_\infty\Gamma\). 5) Al arrancar se desprende un vórtice de arranque de \(-\Gamma\) (Kelvin). 6) Equivalentemente, el perfil comunica cantidad de movimiento hacia abajo a la corriente (downwash).</p>`, en: R`<p>1) Through incidence and camber the airfoil turns the flow downwards. 2) Curving streamlines requires \(\partial p/\partial n=\rho V^2/R\): pressure drops over the upper surface and rises on the lower. 3) Potential flow has infinitely many solutions; the <b>Kutta condition</b> (smooth flow-off and finite velocity at the sharp trailing edge, a consequence of viscosity) selects a single circulation. 4) Kutta-Joukowski: \(L'=\rho V_\infty\Gamma\). 5) At start-up a starting vortex of \(-\Gamma\) is shed (Kelvin). 6) Equivalently, the airfoil imparts downward momentum to the stream (downwash).</p>` } },
    { q: { es: "¿Qué es la condición de Kutta y por qué es necesaria?", en: "What is the Kutta condition and why is it needed?" }, a: { es: R`<p>El problema potencial (Laplace + no penetración) no tiene solución única para un cuerpo 2D sustentador: cualquier \(\Gamma\) satisface las condiciones de contorno. Kutta añade la condición física: con borde de salida afilado, el flujo sale suavemente y la velocidad allí es finita (presiones iguales arriba y abajo). Es un modelo de un efecto viscoso dentro de una teoría no viscosa. Sin borde afilado (cilindro), la circulación queda indeterminada en teoría potencial.</p>`, en: R`<p>The potential problem (Laplace + no penetration) has no unique solution for a lifting 2D body: any \(\Gamma\) satisfies the boundary conditions. Kutta adds the physical condition: with a sharp trailing edge the flow leaves smoothly and the velocity there is finite (equal pressures top and bottom). It models a viscous effect inside an inviscid theory. Without a sharp edge (cylinder) circulation is undetermined in potential theory.</p>` } },
    { q: { es: "¿Por qué es incorrecta la explicación del «tiempo de tránsito igual»?", en: "Why is the “equal transit time” explanation wrong?" }, a: { es: R`<p>No hay ninguna ley física que obligue a las partículas separadas en el borde de ataque a reencontrarse en el de salida. Medidas y cálculos muestran que las de arriba llegan <b>antes</b>. Además, la explicación predice una sustentación muy inferior a la real y no explica que una placa plana (mismo recorrido arriba y abajo) sustente.</p>`, en: R`<p>No physical law forces particles split at the leading edge to meet again at the trailing edge. Measurements and calculations show the upper ones arrive <b>earlier</b>. Moreover the argument predicts far less lift than observed and cannot explain why a flat plate (same path length top and bottom) lifts.</p>` } },
    { q: { es: "¿Qué pasaría con un perfil de borde de salida redondeado?", en: "What would happen with a rounded trailing edge?" }, a: { es: R`<p>La posición de la separación en el borde de salida ya no está fijada geométricamente: depende del Reynolds y de la capa límite. La circulación (y por tanto Cl) sería menor y menos predecible, con posible histéresis. Por eso los perfiles tienen bordes de salida finos; un Gurney flap, en cambio, fija la separación en una posición que <i>aumenta</i> la circulación.</p>`, en: R`<p>The separation location at the trailing edge is no longer fixed by geometry: it depends on Reynolds number and the boundary layer. Circulation (hence Cl) would be lower and less predictable, possibly with hysteresis. That is why airfoils have thin trailing edges; a Gurney flap instead fixes separation at a location that <i>increases</i> circulation.</p>` } },
  ],
  myths: [
    { es: "«Tiempo de tránsito igual»: las partículas de arriba NO esperan a las de abajo; llegan antes.", en: "“Equal transit time”: upper particles do NOT wait for the lower ones; they arrive earlier." },
    { es: "«Bernoulli explica la sustentación y Newton es otra teoría». Son la misma física: el campo de presión que acelera el flujo es el que actúa sobre el perfil.", en: "“Bernoulli explains lift and Newton is a different theory”. Same physics: the pressure field accelerating the flow is the one acting on the airfoil." },
    { es: "«El efecto Coandă explica la sustentación». El Coandă es un fenómeno de chorros sobre superficies curvas; un perfil en corriente libre se explica con el campo de presiones y la condición de Kutta.", en: "“The Coandă effect explains lift”. Coandă is about jets on curved surfaces; an airfoil in a free stream is explained by the pressure field and the Kutta condition." },
    { es: "«La sustentación es solo el aire golpeando el intradós». La mayor parte la aporta la succión del extradós.", en: "“Lift is just air hitting the lower surface”. Most of it comes from upper-surface suction." },
  ],
  quiz: [
    { q: { es: "Sin condición de Kutta, el flujo potencial alrededor de un perfil…", en: "Without the Kutta condition, potential flow around an airfoil…" }, options: [{ es: "no tiene solución", en: "has no solution" }, { es: "tiene infinitas soluciones (una por Γ)", en: "has infinitely many solutions (one per Γ)" }, { es: "da siempre Γ = 0", en: "always gives Γ = 0" }, { es: "da resistencia", en: "gives drag" }], correct: 1, explain: { es: "Laplace con no-penetración admite añadir cualquier vórtice: falta una condición.", en: "Laplace with no penetration admits adding any vortex: one condition is missing." } },
    { q: { es: "En el instante del arranque impulsivo, la circulación ligada es…", en: "At the instant of an impulsive start, bound circulation is…" }, options: [{ es: "0 %", en: "0 %" }, { es: "50 % de la estacionaria", en: "50 % of steady" }, { es: "100 %", en: "100 %" }, { es: "150 %", en: "150 %" }], correct: 1, explain: { es: "Φ(0) = 0.5 en la función de Wagner.", en: "Φ(0) = 0.5 in Wagner's function." } },
    { q: { es: "Una placa plana a 5° en flujo potencial con Kutta tiene Cl ≈", en: "A flat plate at 5° in potential flow with Kutta has Cl ≈" }, options: [{ es: "0", en: "0" }, { es: "0.27", en: "0.27" }, { es: "0.55", en: "0.55" }, { es: "1.1", en: "1.1" }], correct: 2, explain: { es: "2π·(5π/180) ≈ 0.548.", en: "2π·(5π/180) ≈ 0.548." } },
    { q: { es: "La condición de Kutta la impone físicamente…", en: "The Kutta condition is physically imposed by…" }, options: [{ es: "la compresibilidad", en: "compressibility" }, { es: "la viscosidad (capa límite en el borde de salida)", en: "viscosity (boundary layer at the trailing edge)" }, { es: "la gravedad", en: "gravity" }, { es: "la turbulencia de la corriente libre", en: "free-stream turbulence" }], correct: 1, explain: { es: "La capa límite no puede rodear el borde afilado: separa, se forma el vórtice de arranque y el flujo se ajusta hasta salir suavemente.", en: "The boundary layer cannot turn around the sharp edge: it separates, the starting vortex forms and the flow adjusts to leave smoothly." } },
  ],
  refs: [
    "J.D. Anderson, <i>Fundamentals of Aerodynamics</i>, §4.5–4.7 (Kutta condition, Kelvin, starting vortex).",
    "D. McLean, <i>Understanding Aerodynamics: Arguing from the Real Physics</i>, Wiley, 2012, ch. 7 (lift explanations and myths).",
    "H. Wagner (1925); R.T. Jones, NACA Rep. 681 (1940) — indicial lift approximation.",
    "J. Katz & A. Plotkin, <i>Low-Speed Aerodynamics</i>, ch. 6 & 13.",
  ],
};
