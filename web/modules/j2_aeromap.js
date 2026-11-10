import { slider, labLayout, readout, segmented, button, L, tr, el, canvasBox, engineBadge } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function heat(t) {
  t = Math.max(0, Math.min(1, t));
  const s = [[0, [30, 64, 175]], [0.5, [34, 211, 238]], [0.8, [250, 250, 210]], [1, [251, 146, 60]]];
  for (let i = 1; i < s.length; i++)
    if (t <= s[i][0]) {
      const f = (t - s[i - 1][0]) / (s[i][0] - s[i - 1][0]);
      return `rgb(${s[i - 1][1].map((c, k) => Math.round(c + (s[i][1][k] - c) * f)).join(",")})`;
    }
  return "rgb(251,146,60)";
}

function mapLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 360 });
  const wait = engineBadge(box);
  const sW = slider({ label: { es: "Nivel de alerón trasero", en: "Rear-wing level" }, min: 0.4, max: 1.8, step: 0.1, value: 1.0 });
  const status = el("div", { class: "lab-note" });
  const go = button({ es: "▶ Calcular mapa aero (≈ 25 casos en Python)", en: "▶ Compute aero map (≈ 25 cases in Python)" }, compute, "primary");
  ui.controls.append(sW.el, go, status);
  const roC = readout({ es: "C_L·A [m²]", en: "C_L·A [m²]" });
  const roF = readout({ es: "Reparto delantero", en: "Front share" });
  const roD = readout({ es: "C_D·A [m²]", en: "C_D·A [m²]" });
  const roE = readout({ es: "Eficiencia L/D", en: "Efficiency L/D" });
  ui.readouts.append(roC.el, roF.el, roD.el, roE.el);
  ui.note.innerHTML = L(
    "Mapa construido con los modelos de AeroLab: alerón delantero invertido en efecto suelo (altura delantera), suelo quasi-3D con rake (alturas delantera y trasera, batalla 3.6 m) y alerón trasero fijo. Color = C_L·A; líneas = reparto delantero (balance). Haz clic en el mapa para elegir un punto de funcionamiento. Las áreas de referencia están ajustadas para dar valores típicos; las <b>tendencias</b> (sensibilidad a alturas, movimiento del balance) son lo que enseña.",
    "Map built from AeroLab's models: inverted front wing in ground effect (front ride height), quasi-3D floor with rake (front and rear heights, 3.6 m wheelbase) and a fixed rear wing. Colour = C_L·A; lines = front share (balance). Click on the map to pick an operating point. Reference areas are tuned to typical values; the <b>trends</b> (ride-height sensitivity, balance movement) are the lesson."
  );
  let m = null, sel = null;
  async function compute() {
    status.innerHTML = L("Calculando… (alerón delantero + 25 suelos)", "Computing… (front wing + 25 floors)");
    m = await physics.call("car.aero_map", { wing_level: sW.value, n: 5 });
    status.innerHTML = "";
    wait.remove();
    sel = sel || [2, 2];
    draw();
  }
  const geom = () => ({ x0: 70, y0: 20, w: box.clientWidth - 110, h: box.clientHeight - 70 });
  canvas.addEventListener("click", (e) => {
    if (!m) return;
    const r = canvas.getBoundingClientRect();
    const g = geom();
    const i = Math.round(((e.clientX - r.left - g.x0) / g.w) * (m.hf.length - 1));
    const j = Math.round((1 - (e.clientY - r.top - g.y0) / g.h) * (m.hr.length - 1));
    if (i >= 0 && j >= 0 && i < m.hf.length && j < m.hr.length) {
      sel = [i, j];
      draw();
    }
  });
  function draw() {
    if (!m) return;
    const dpr = window.devicePixelRatio || 1;
    const W = box.clientWidth, H = box.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = cssVar("--panel-2");
    c.fillRect(0, 0, W, H);
    const g = geom();
    const n = m.hf.length;
    const all = m.CLA.flat();
    const mn = Math.min(...all), mx = Math.max(...all);
    const cw = g.w / n, ch = g.h / n;
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        c.fillStyle = heat((m.CLA[j][i] - mn) / (mx - mn + 1e-9));
        c.fillRect(g.x0 + i * cw, g.y0 + g.h - (j + 1) * ch, cw + 1, ch + 1);
        c.fillStyle = "rgba(0,0,0,0.65)";
        c.font = "11px 'JetBrains Mono'";
        c.fillText(`${m.CLA[j][i].toFixed(2)}`, g.x0 + i * cw + 6, g.y0 + g.h - (j + 1) * ch + 16);
        c.fillText(`${(100 * m.front[j][i]).toFixed(0)}%`, g.x0 + i * cw + 6, g.y0 + g.h - (j + 1) * ch + 30);
      }
    if (sel) {
      c.strokeStyle = cssVar("--fg");
      c.lineWidth = 3;
      c.strokeRect(g.x0 + sel[0] * cw + 2, g.y0 + g.h - (sel[1] + 1) * ch + 2, cw - 4, ch - 4);
      const cla = m.CLA[sel[1]][sel[0]], cda = m.CDA[sel[1]][sel[0]];
      roC.set(cla.toFixed(2));
      roF.set((100 * m.front[sel[1]][sel[0]]).toFixed(1) + " %");
      roD.set(cda.toFixed(2));
      roE.set((cla / cda).toFixed(2));
    }
    c.fillStyle = cssVar("--fg-muted");
    c.font = "12px Inter";
    c.fillText(tr({ es: "altura delantera [mm] →", en: "front ride height [mm] →" }), g.x0, H - 10);
    m.hf.forEach((h, i) => c.fillText((h * 1000).toFixed(0), g.x0 + (i + 0.4) * cw, g.y0 + g.h + 16));
    m.hr.forEach((h, j) => c.fillText((h * 1000).toFixed(0), 30, g.y0 + g.h - (j + 0.5) * ch));
    c.save();
    c.translate(14, g.y0 + g.h / 2 + 60);
    c.rotate(-Math.PI / 2);
    c.fillText(tr({ es: "altura trasera [mm] →", en: "rear ride height [mm] →" }), 0, 0);
    c.restore();
    c.fillText(tr({ es: "celda: C_L·A [m²] / % delantero", en: "cell: C_L·A [m²] / % front" }), W - 230, 14);
  }
  new ResizeObserver(draw).observe(box);
  compute();
}

function lapLab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pT = new Plot(row, { height: 250, xlabel: { es: "nivel de alerón trasero", en: "rear-wing level" }, ylabel: { es: "tiempo por vuelta [s]", en: "lap time [s]" } });
  const pV = new Plot(row, { height: 250, xlabel: { es: "distancia [m]", en: "distance [m]" }, ylabel: { es: "velocidad [km/h]", en: "speed [km/h]" } });
  const sC = segmented({ label: { es: "Circuito (simplificado)", en: "Circuit (simplified)" }, value: "monaco", onInput: run, options: [{ value: "monaco", label: { es: "Tipo Mónaco (lento)", en: "Monaco-like (slow)" } }, { value: "monza", label: { es: "Tipo Monza (rápido)", en: "Monza-like (fast)" } }] });
  const sL = slider({ label: { es: "Nivel de alerón para la traza", en: "Wing level for the speed trace" }, min: 0, max: 2.4, step: 0.2, value: 1.0, onInput: run });
  ui.controls.append(sC.el, sL.el);
  const roB = readout({ es: "Nivel óptimo", en: "Optimum level" });
  const roT = readout({ es: "Tiempo con el nivel elegido", en: "Time at chosen level" }, "s");
  const roV = readout({ es: "Velocidad punta", en: "Top speed" }, "km/h");
  ui.readouts.append(roB.el, roT.el, roV.el);
  ui.note.innerHTML = L(
    R`Simulación de vuelta cuasi-estática de masa puntual (800 kg, 750 kW, μ = 1.7). En curva: \(\mu(mg+\tfrac12\rho v^2C_LA)=mv^2/R\). En recta: tracción limitada por potencia menos resistencia; frenada limitada por adherencia. Cada nivel de alerón añade carga y su coste en resistencia (perfil + inducida).`,
    R`Quasi-steady point-mass lap simulation (800 kg, 750 kW, μ = 1.7). Corners: \(\mu(mg+\tfrac12\rho v^2C_LA)=mv^2/R\). Straights: power-limited traction minus drag; grip-limited braking. Each wing level adds downforce and its drag cost (profile + induced).`
  );
  const callT = liveCall("lapT", "car.wing_tradeoff", 40);
  const callL = liveCall("lapL", "car.lap", 40);
  function run() {
    callT({ circuit: sC.value }, (r) => {
      pT.set([{ x: r.level, y: r.time, color: cssVar("--accent"), width: 2.6, points: true, label: { es: "tiempo por vuelta", en: "lap time" } }], [{ type: "vline", x: r.best_level, color: cssVar("--good"), label: { es: "óptimo", en: "optimum" } }, { type: "vline", x: sL.value, color: cssVar("--accent-2") }]);
      roB.set(r.best_level.toFixed(1));
      const cla = 3.2 + 1.4 * sL.value, cda = 0.85 + 0.32 * sL.value + 0.03 * sL.value ** 2;
      callL({ cla, cda, circuit: sC.value }, (l) => {
        pV.set([{ x: l.x, y: l.v.map((v) => v * 3.6), color: cssVar("--accent-2"), width: 2, label: { es: `nivel ${sL.value.toFixed(1)}`, en: `level ${sL.value.toFixed(1)}` } }]);
        roT.set(l.time.toFixed(2));
        roV.set((l.v_max * 3.6).toFixed(0));
      });
    });
  }
  run();
}

export default {
  subtitle: {
    es: "El mapa aerodinámico (carga y balance frente a alturas), la eficiencia L/D y el compromiso carga–resistencia en el tiempo por vuelta según el circuito.",
    en: "The aero map (downforce and balance versus ride heights), L/D efficiency and the downforce–drag compromise on lap time depending on the circuit.",
  },
  heroParams: { eps: 0.1, camber: 0.08, alpha: 5 },
  intuition: {
    es: R`<p>Un F1 no tiene "una" carga: tiene un <span class="term">mapa aerodinámico</span>. La carga total (\(C_L A\)) y el <span class="term">balance</span> (qué porcentaje cae sobre el eje delantero) dependen de la altura delantera y trasera, que cambian continuamente con la velocidad, la frenada, la aceleración y el combustible. El ingeniero quiere carga alta, balance estable (para que el coche no pase de sobreviraje a subviraje entre frenada y aceleración) y poca sensibilidad: una "plataforma" estable.</p>
    <p>La otra cara es la <b>resistencia</b>. Más alerón da más velocidad en curva pero menos en recta. Qué compensa depende del circuito: en uno lento con curvas cerradas (tipo Mónaco) se pone toda la carga posible; en uno de rectas largas (tipo Monza) se sacrifica carga por velocidad punta. La métrica que lo resume es la <b>eficiencia</b> \(L/D=C_LA/C_DA\).</p>`,
    en: R`<p>An F1 car does not have "a" downforce: it has an <span class="term">aero map</span>. Total downforce (\(C_L A\)) and <span class="term">balance</span> (the percentage on the front axle) depend on front and rear ride heights, which change continuously with speed, braking, acceleration and fuel. Engineers want high downforce, stable balance (so the car does not go from oversteer to understeer between braking and acceleration) and low sensitivity: a stable "platform".</p>
    <p>The other side is <b>drag</b>. More wing gives more cornering speed but less straight-line speed. What pays off depends on the circuit: on a slow, tight track (Monaco-like) you run all the downforce you can; on one with long straights (Monza-like) you trade downforce for top speed. The summarising metric is <b>efficiency</b> \(L/D=C_LA/C_DA\).</p>`,
  },
  physics: {
    es: R`<p><b>Velocidad en curva</b> (masa puntual, adherencia \(\mu\)): $$v_c^2=\frac{\mu g R}{1-\mu\rho C_LA\,R/(2m)}$$ la carga aerodinámica aumenta la fuerza normal con \(v^2\).</p>
    <p><b>Velocidad punta</b>: \(P=\tfrac12\rho C_DA\,v^3\Rightarrow v_{max}=(2P/\rho C_DA)^{1/3}\).</p>
    <p><b>Balance</b>: \(\%_{del}=\dfrac{F_{z,del}}{F_{z,del}+F_{z,tras}}\); se compara con el reparto de pesos para fijar el comportamiento. Un centro de presión que se mueve con la altura produce cambios de balance en frenada (morro abajo) y aceleración.</p>
    <p><b>Mapa</b>: en la práctica se mide en túnel con barridos de altura delantera/trasera, guiñada, balanceo y giro de dirección, y se usa en simulación de vuelta y en el reglaje.</p>`,
    en: R`<p><b>Cornering speed</b> (point mass, grip \(\mu\)): $$v_c^2=\frac{\mu g R}{1-\mu\rho C_LA\,R/(2m)}$$ downforce raises the normal force with \(v^2\).</p>
    <p><b>Top speed</b>: \(P=\tfrac12\rho C_DA\,v^3\Rightarrow v_{max}=(2P/\rho C_DA)^{1/3}\).</p>
    <p><b>Balance</b>: \(\%_{front}=\dfrac{F_{z,f}}{F_{z,f}+F_{z,r}}\); compared with the weight distribution to set the handling. A centre of pressure moving with ride height produces balance changes under braking (nose down) and acceleration.</p>
    <p><b>Map</b>: in practice it is measured in the tunnel with front/rear ride-height, yaw, roll and steer sweeps, and used in lap simulation and set-up.</p>`,
  },
  labs: [
    { title: { es: "Mapa aero: carga y balance frente a alturas", en: "Aero map: downforce and balance versus ride heights" }, mount: mapLab },
    { title: { es: "Compromiso carga–resistencia y tiempo por vuelta", en: "Downforce–drag compromise and lap time" }, mount: lapLab },
  ],
  interview: [
    { q: { es: "¿Qué es el balance aerodinámico y por qué preocupa su sensibilidad a la altura?", en: "What is aero balance and why does its ride-height sensitivity matter?" }, a: { es: R`<p>El porcentaje de la carga sobre el eje delantero. Si cambia mucho con la altura, el coche cambia de comportamiento entre frenada (morro abajo, más carga delantera) y aceleración/curva rápida: el piloto no puede confiar en él. Se busca carga alta con un balance estable en todo el rango de alturas (plataforma estable).</p>`, en: R`<p>The percentage of downforce on the front axle. If it changes a lot with ride height the car's behaviour changes between braking (nose down, more front load) and acceleration/fast corners: the driver cannot trust it. The goal is high downforce with a stable balance across the ride-height range (stable platform).</p>` } },
    { q: { es: "¿Más carga siempre es más rápido?", en: "Is more downforce always faster?" }, a: { es: R`<p>No: hay un compromiso con la resistencia. En circuitos lentos la carga gana (más velocidad en curva), en circuitos de rectas largas pesa más la velocidad punta. Por eso hay alerones de baja carga para Monza y de alta carga para Mónaco; la eficiencia L/D mide cuánto cuesta cada punto de carga.</p>`, en: R`<p>No: there is a compromise with drag. On slow circuits downforce wins (more cornering speed), on circuits with long straights top speed matters more. That is why there are low-downforce wings for Monza and high-downforce ones for Monaco; L/D measures what each point of downforce costs.</p>` } },
  ],
  myths: [
    { es: "«El balance aerodinámico es fijo». Cambia con altura, cabeceo, guiñada y velocidad.", en: "“Aero balance is fixed”. It changes with ride height, pitch, yaw and speed." },
  ],
  quiz: [
    { q: { es: "En un circuito tipo Monza el nivel de alerón óptimo es…", en: "On a Monza-like circuit the optimum wing level is…" }, options: [{ es: "máximo", en: "maximum" }, { es: "bajo", en: "low" }, { es: "da igual", en: "irrelevant" }, { es: "negativo", en: "negative" }], correct: 1, explain: { es: "Domina la velocidad punta.", en: "Top speed dominates." } },
  ],
  refs: [
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 1 & 10 (performance, set-up).",
    "W.F. Milliken & D.L. Milliken, <i>Race Car Vehicle Dynamics</i>, SAE, 1995.",
    "P. Wright, <i>Formula 1 Technology</i>, SAE, 2001.",
  ],
};
