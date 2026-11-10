import { slider, labLayout, readout, toggle, L, tr, canvasBox, el } from "../js/core/ui.js";
import { cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function groundLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 260 });
  const sH = slider({ label: { es: "Altura del alerón h/c", en: "Wing height h/c" }, min: 0.06, max: 0.6, step: 0.01, value: 0.12, onInput: run });
  const sX = slider({ label: { es: "Distancia desde la succión de capa límite [m]", en: "Distance from BL suction [m]" }, min: 0.2, max: 4, step: 0.1, value: 1.5, onInput: run });
  const sV = slider({ label: { es: "Velocidad del túnel [m/s]", en: "Tunnel speed [m/s]" }, min: 20, max: 60, step: 1, value: 50, onInput: run });
  const tM = toggle({ label: { es: "Suelo móvil (rolling road)", en: "Moving ground (rolling road)" }, value: false, onInput: run });
  ui.controls.append(sH.el, sX.el, sV.el, tM.el);
  const roD = readout({ es: "δ* del suelo fijo", en: "fixed-floor δ*" }, "mm");
  const roHe = readout({ es: "Altura efectiva h/c", en: "Effective h/c" });
  const roC = readout({ es: "C carga suelo móvil", en: "Downforce, moving ground" });
  const roF = readout({ es: "C carga suelo fijo", en: "Downforce, fixed ground" });
  const roE = readout({ es: "Error si no hay suelo móvil", en: "Error without moving ground" });
  ui.readouts.append(roD.el, roHe.el, roC.el, roF.el, roE.el);
  ui.note.innerHTML = L(
    "Ala invertida NACA 4412 de cuerda 0.25 m a 4°. Con suelo fijo crece una capa límite turbulenta desde la última succión (δ* ≈ 0.046 x Re_x^−1/5) que reduce el hueco efectivo. El cálculo del ala usa el mismo motor de paneles + capa límite del módulo de efecto suelo (aproximación: el desplazamiento se trata como una reducción de altura).",
    "Inverted NACA 4412 wing, 0.25 m chord, at 4°. With a fixed floor a turbulent boundary layer grows from the last suction point (δ* ≈ 0.046 x Re_x^−1/5) and shrinks the effective gap. The wing uses the same panel + boundary-layer engine as the ground-effect module (approximation: displacement treated as a height reduction)."
  );
  let last = null;
  const call = liveCall("tg", "tunnel.ground", 80);
  function run() {
    call({ h: sH.value, x_from_suction: sX.value, V: sV.value, chord: 0.25, alpha: -4 }, (r) => {
      last = r;
      roD.set((r.dstar_m * 1000).toFixed(2));
      roHe.set(r.h_eff.toFixed(3));
      roC.set((-r.cl_moving).toFixed(3));
      roF.set((-r.cl_fixed).toFixed(3));
      roE.set(((r.cl_fixed / r.cl_moving - 1) * 100).toFixed(1) + " %", "warn");
      draw();
    });
  }
  function draw() {
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
    const yG = H - 40;
    // floor / belt
    g.fillStyle = tM.value ? "#334155" : "#1f2937";
    g.fillRect(0, yG, W, 40);
    if (tM.value) {
      g.strokeStyle = "#94a3b8";
      g.setLineDash([10, 10]);
      g.lineDashOffset = -performance.now() / 8;
      g.beginPath();
      g.moveTo(0, yG + 8);
      g.lineTo(W, yG + 8);
      g.stroke();
      g.setLineDash([]);
    }
    // suction slot
    g.fillStyle = cssVar("--accent-3");
    g.fillRect(40, yG - 2, 18, 6);
    g.fillStyle = cssVar("--fg-muted");
    g.font = "11px Inter";
    g.fillText(tr({ es: "succión de capa límite", en: "BL suction" }), 20, yG + 26);
    // boundary layer profiles along the floor
    const x0 = 58, x1 = W * 0.75;
    const dsc = 6000;
    if (!tM.value && last) {
      for (let k = 1; k <= 6; k++) {
        const xs = x0 + ((x1 - x0) * k) / 6;
        const frac = k / 6;
        const d = 8 * last.dstar_m * dsc * Math.pow(frac, 0.8);
        g.strokeStyle = "rgba(244,114,182,0.8)";
        g.beginPath();
        for (let j = 0; j <= 20; j++) {
          const y = (j / 20) * d;
          const u = Math.pow(j / 20, 1 / 7);
          j ? g.lineTo(xs + u * 30, yG - y) : g.moveTo(xs, yG);
        }
        g.stroke();
      }
    } else if (tM.value) {
      for (let k = 1; k <= 6; k++) {
        const xs = x0 + ((x1 - x0) * k) / 6;
        g.strokeStyle = "rgba(34,211,238,0.7)";
        g.beginPath();
        g.moveTo(xs + 30, yG);
        g.lineTo(xs + 30, yG - 40);
        g.stroke();
      }
    }
    // inverted wing
    const c = W * 0.22;
    const wx = x1 - c * 0.2, wy = yG - (sH.value * c + 4);
    g.fillStyle = cssVar("--body-fill");
    g.strokeStyle = cssVar("--body-stroke");
    g.beginPath();
    g.ellipse(wx + c / 2, wy - c * 0.06, c / 2, c * 0.06, 0.07, 0, 7);
    g.fill();
    g.stroke();
    g.fillStyle = cssVar("--fg");
    g.font = "12px Inter";
    g.fillText(tr(tM.value ? { es: "suelo a la velocidad del aire: sin capa límite", en: "ground at air speed: no boundary layer" } : { es: "suelo fijo: la capa límite «roba» altura", en: "fixed floor: the boundary layer “steals” height" }), 12, 18);
  }
  (function anim() {
    if (!document.body.contains(box)) return;
    draw();
    setTimeout(() => requestAnimationFrame(anim), 50);
  })();
  run();
}

function similarityLab(host) {
  const ui = labLayout(host);
  const out = el("div", { class: "lab-readouts", style: "grid-template-columns:repeat(auto-fill,minmax(170px,1fr))" });
  ui.viz.appendChild(out);
  const sS = slider({ label: { es: "Escala del modelo", en: "Model scale" }, min: 0.2, max: 1, step: 0.05, value: 0.6, onInput: run });
  const sVt = slider({ label: { es: "Velocidad del túnel [m/s]", en: "Tunnel speed [m/s]" }, min: 20, max: 60, step: 1, value: 50, onInput: run });
  const sVr = slider({ label: { es: "Velocidad real en pista [m/s]", en: "Real track speed [m/s]" }, min: 30, max: 95, step: 1, value: 70, onInput: run });
  const sB = slider({ label: { es: "Área frontal modelo / sección de ensayo", en: "Model frontal area / test section" }, min: 0.01, max: 0.15, step: 0.005, value: 0.05, onInput: run });
  const sCd = slider({ label: { es: "Cd medido (sin corregir)", en: "Measured Cd (uncorrected)" }, min: 0.3, max: 1.4, step: 0.01, value: 0.9, onInput: run });
  ui.controls.append(sS.el, sVt.el, sVr.el, sB.el, sCd.el);
  const ro = [
    readout({ es: "Re túnel", en: "Tunnel Re" }), readout({ es: "Re real", en: "Real Re" }), readout({ es: "Re túnel / real", en: "Tunnel / real Re" }),
    readout({ es: "Velocidad para igualar Re", en: "Speed to match Re" }, "m/s"), readout({ es: "Mach necesario", en: "Mach needed" }),
    readout({ es: "q corregida / q medida", en: "corrected q / measured q" }), readout({ es: "Cd corregido", en: "corrected Cd" }),
  ];
  ro.forEach((r) => out.appendChild(r.el));
  ui.note.innerHTML = L(
    "Igualar Re a escala 60 % exigiría ~1.7 veces la velocidad real: Mach demasiado alto (efectos de compresibilidad) y cargas enormes. Por eso se acepta un Re algo menor y se cuida la transición. Bloqueo con la corrección de Maskell para cuerpos romos.",
    "Matching Re at 60 % scale would need ~1.7 times the real speed: too high a Mach (compressibility) and enormous loads. A somewhat lower Re is accepted and transition is managed. Blockage via Maskell's bluff-body correction."
  );
  function run() {
    Promise.all([physics.latest("sim", "tunnel.similarity", { scale: sS.value, V_tunnel: sVt.value, V_track: sVr.value }), physics.latest("blk", "tunnel.blockage", { frontal_ratio: sB.value, cd_u: sCd.value })]).then(([s, b]) => {
      if (!s || !b) return;
      ro[0].set(s.re_tunnel.toExponential(2));
      ro[1].set(s.re_full.toExponential(2));
      ro[2].set(s.ratio.toFixed(2), s.ratio < 0.5 ? "warn" : "good");
      ro[3].set(s.speed_for_match.toFixed(0));
      ro[4].set(s.mach_for_match.toFixed(2), s.mach_for_match > 0.3 ? "bad" : "good");
      ro[5].set(b.q_ratio.toFixed(3));
      ro[6].set(b.cd_corrected.toFixed(3));
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Cómo se ensaya un F1 en túnel: semejanza, suelo móvil, succión de capa límite, bloqueo, balanzas, tomas de presión, PIV y correlación.",
    en: "How an F1 car is tested in a tunnel: similarity, moving ground, boundary-layer suction, blockage, balances, pressure taps, PIV and correlation.",
  },
  heroParams: { eps: 0.12, camber: 0.06, alpha: 3 },
  intuition: {
    es: R`<p>Un túnel de viento reproduce el flujo relativo alrededor de un modelo (en F1, a escala ≤ 60 % y velocidad limitada por reglamento). Para que los resultados sean trasladables, la física debe ser semejante: mismo <b>número de Reynolds</b> (difícil, se acepta algo menor), Mach bajo como en pista y, sobre todo, la <b>condición de contorno del suelo</b> correcta: en pista el aire y el asfalto no se mueven entre sí, así que hace falta una <span class="term">cinta móvil</span> (rolling road) a la velocidad del aire, ruedas que giren y succión de la capa límite del suelo aguas arriba.</p>
    <p>Las paredes del túnel también alteran el flujo (<span class="term">bloqueo</span> sólido y de estela): hay que corregir. Y se mide de muchas formas: balanza de 6 componentes (fuerzas y momentos), cientos de tomas de presión con escáneres, sondas multiorificio y rakes de estela, PIV, visualización con pintura... Con todo ello se buscan <b>barridos</b> (altura, cabeceo, guiñada, balanceo, giro de dirección) y una correlación consistente túnel–CFD–pista.</p>`,
    en: R`<p>A wind tunnel reproduces the relative flow around a model (in F1, at ≤ 60 % scale and rule-limited speed). For results to transfer, the physics must be similar: same <b>Reynolds number</b> (hard; somewhat lower is accepted), low Mach like on track and, above all, the correct <b>ground boundary condition</b>: on track air and road do not move relative to each other, so a <span class="term">moving belt</span> (rolling road) at air speed, rotating wheels and upstream ground boundary-layer suction are needed.</p>
    <p>Tunnel walls also alter the flow (solid and wake <span class="term">blockage</span>): corrections are required. Measurements come in many forms: 6-component balance (forces and moments), hundreds of pressure taps with scanners, multi-hole probes and wake rakes, PIV, flow-vis paint... With them, <b>sweeps</b> (ride height, pitch, yaw, roll, steer) and a consistent tunnel–CFD–track correlation are pursued.</p>`,
  },
  physics: {
    es: R`<p><b>Semejanza</b>: \(C_F=f(Re, M, \text{geometría}, \text{actitud}, \text{condiciones de contorno})\). \(Re=\rho VL/\mu\): a escala \(s\) haría falta \(V_{tunel}=V_{real}/s\); a 60 % y 70 m/s → 117 m/s (M ≈ 0.34): compresibilidad y cargas inaceptables. Se compensa cuidando la transición (Re crítico) y con correlación.</p>
    <p><b>Correcciones de pared</b> (sección cerrada): bloqueo sólido \(\varepsilon_{sb}\approx K\tau V_{modelo}/C^{3/2}\), bloqueo de estela \(\varepsilon_{wb}=\frac{S}{4C}C_{D_u}\); para cuerpos romos (Maskell) \(q_c/q_u=1+\theta\,(S/C)\,C_{D_u}\), \(\theta\approx2.5\). Además curvatura de líneas de corriente y gradiente de presión horizontal (flotación).</p>
    <p><b>Suelo</b>: cinta móvil + succión (o soplado tangencial) aguas arriba + ruedas girando sobre la cinta (sostenidas por brazos con su propia interferencia). Con suelo fijo, \(\delta^*_{suelo}\approx0.046\,x\,Re_x^{-1/5}\) reduce el hueco.</p>
    <p><b>Instrumentación</b>: balanza interna de 6 componentes; escáneres de presión (cientos de tomas); sondas de 5/7 agujeros y rakes (presión total, ángulos de flujo, pérdidas en la estela); PIV/estéreo-PIV (campos de velocidad, vórtices); anemometría de hilo caliente (turbulencia); flow-vis (pintura, tufts); medidas de deformación (aeroelasticidad).</p>
    <p><b>Reglamento F1 (ATR)</b>: horas de túnel ("wind-on time") y capacidad de CFD limitadas y escaladas por la posición en el campeonato.</p>`,
    en: R`<p><b>Similarity</b>: \(C_F=f(Re, M, \text{geometry}, \text{attitude}, \text{boundary conditions})\). \(Re=\rho VL/\mu\): at scale \(s\) one would need \(V_{tunnel}=V_{real}/s\); at 60 % and 70 m/s → 117 m/s (M ≈ 0.34): unacceptable compressibility and loads. Compensated by managing transition (critical Re) and by correlation.</p>
    <p><b>Wall corrections</b> (closed section): solid blockage \(\varepsilon_{sb}\approx K\tau V_{model}/C^{3/2}\), wake blockage \(\varepsilon_{wb}=\frac{S}{4C}C_{D_u}\); for bluff bodies (Maskell) \(q_c/q_u=1+\theta\,(S/C)\,C_{D_u}\), \(\theta\approx2.5\). Also streamline curvature and horizontal buoyancy.</p>
    <p><b>Ground</b>: moving belt + upstream suction (or tangential blowing) + wheels rotating on the belt (held by struts with their own interference). With a fixed floor, \(\delta^*_{ground}\approx0.046\,x\,Re_x^{-1/5}\) shrinks the gap.</p>
    <p><b>Instrumentation</b>: internal 6-component balance; pressure scanners (hundreds of taps); 5/7-hole probes and rakes (total pressure, flow angles, wake losses); PIV/stereo-PIV (velocity fields, vortices); hot-wire anemometry (turbulence); flow-vis (paint, tufts); deformation measurements (aeroelasticity).</p>
    <p><b>F1 rules (ATR)</b>: wind-on time and CFD capacity are capped and scaled by championship position.</p>`,
  },
  labs: [
    { title: { es: "Suelo fijo vs suelo móvil", en: "Fixed vs moving ground" }, desc: { es: "Activa y desactiva la cinta. Baja la altura: el error crece justo donde más importa.", en: "Toggle the belt. Lower the height: the error grows exactly where it matters most." }, mount: groundLab },
    { title: { es: "Semejanza de Reynolds y corrección de bloqueo", en: "Reynolds similarity and blockage correction" }, mount: similarityLab },
  ],
  interview: [
    { q: { es: "¿Por qué los túneles de F1 tienen suelo móvil?", en: "Why do F1 tunnels have a moving ground?" }, a: { es: R`<p>Porque en pista no hay movimiento relativo entre aire y asfalto, así que no hay capa límite en el suelo. Con suelo fijo se formaría una capa límite que reduce el hueco efectivo bajo el coche, cambia el flujo del suelo, los vórtices de sellado y la separación del difusor, y por tanto la carga y su sensibilidad a la altura. Se combina con succión de capa límite aguas arriba y ruedas que giran.</p>`, en: R`<p>Because on track there is no relative motion between air and road, hence no ground boundary layer. With a fixed floor a boundary layer would shrink the effective gap under the car, alter the floor flow, sealing vortices and diffuser separation, and so the downforce and its ride-height sensitivity. It is combined with upstream boundary-layer suction and rotating wheels.</p>` } },
    { q: { es: "¿Qué correcciones aplicas a los datos de túnel?", en: "Which corrections do you apply to tunnel data?" }, a: { es: R`<p>Bloqueo sólido y de estela (la presión dinámica efectiva es mayor que la medida), gradiente de presión horizontal (flotación), curvatura de líneas de corriente/ángulo de flujo inducido por las paredes, interferencia de soportes y brazos de las ruedas, efectos de Reynolds (correlación), y tara de la balanza. Luego se correlaciona con CFD y datos de pista (presiones, cargas en suspensión, velocidad punta).</p>`, en: R`<p>Solid and wake blockage (effective dynamic pressure higher than measured), horizontal buoyancy, wall-induced streamline curvature/flow angle, support and wheel-strut interference, Reynolds effects (correlation) and balance tare. Then correlate with CFD and track data (pressures, suspension loads, top speed).</p>` } },
    { q: { es: "¿Por qué no se iguala el Reynolds?", en: "Why isn't Reynolds matched?" }, a: { es: R`<p>A escala 60 % habría que ir ~1.7 veces más rápido: Mach &gt; 0.3 (efectos de compresibilidad que no existen en el coche real), cargas y potencia del ventilador enormes. Se ensaya a la máxima velocidad permitida, se vigilan los efectos de transición y se corrigen con correlación.</p>`, en: R`<p>At 60 % scale one would need ~1.7 times the speed: Mach &gt; 0.3 (compressibility absent on the real car), enormous loads and fan power. Testing is done at the maximum allowed speed, transition effects are watched and corrected via correlation.</p>` } },
  ],
  myths: [
    { es: "«El túnel da directamente la carga real». Requiere correcciones (bloqueo, soportes, Re) y correlación continua con pista.", en: "“The tunnel directly gives the real downforce”. It needs corrections (blockage, supports, Re) and continuous correlation with the track." },
    { es: "«Basta con que el coche esté quieto y el aire se mueva». Si el suelo no se mueve, el flujo bajo el coche no es el de la pista.", en: "“It's enough to keep the car still and move the air”. If the ground does not move, the underbody flow is not the track flow." },
  ],
  quiz: [
    { q: { es: "La escala máxima de modelo en F1 es…", en: "The maximum model scale in F1 is…" }, options: [{ es: "25 %", en: "25 %" }, { es: "50 %", en: "50 %" }, { es: "60 %", en: "60 %" }, { es: "100 %", en: "100 %" }], correct: 2, explain: { es: "Fijada por el reglamento técnico/deportivo.", en: "Set by the technical/sporting regulations." } },
    { q: { es: "El bloqueo de un túnel cerrado hace que la presión dinámica real alrededor del modelo sea…", en: "Blockage in a closed tunnel makes the real dynamic pressure around the model…" }, options: [{ es: "mayor que la medida aguas arriba", en: "higher than measured upstream" }, { es: "menor", en: "lower" }, { es: "igual", en: "equal" }, { es: "cero", en: "zero" }], correct: 0, explain: { es: "El flujo se acelera alrededor del modelo y su estela.", en: "The flow accelerates around the model and its wake." } },
  ],
  refs: [
    "J.B. Barlow, W.H. Rae & A. Pope, <i>Low-Speed Wind Tunnel Testing</i>, 3rd ed., Wiley, 1999.",
    "E.C. Maskell, “A theory of the blockage effects on bluff bodies and stalled wings in a closed wind tunnel”, ARC R&M 3400 (1963).",
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 8 (testing).",
    "FIA Formula 1 Sporting Regulations (Aerodynamic Testing Restrictions).",
  ],
};
