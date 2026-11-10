import { slider, labLayout, readout, segmented, L, tr, canvasBox, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function buildupLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 250 });
  const plot = new Plot(ui.viz, { height: 220, xlabel: { es: "espesor relativo t/c (0 = placa alineada, 1 = cilindro)", en: "thickness ratio t/c (0 = aligned plate, 1 = cylinder)" }, ylabel: { es: "Cd (2D, por cuerda)", en: "Cd (2D, chord-based)" }, logY: true });
  const sShape = segmented({ label: { es: "Cuerpo", en: "Body" }, value: "section", onInput: run, options: [{ value: "section", label: { es: "Perfil / elipse", en: "Section / ellipse" } }, { value: "cylinder", label: { es: "Cilindro", en: "Cylinder" } }, { value: "plate_normal", label: { es: "Placa normal", en: "Normal plate" } }] });
  const sTc = slider({ label: { es: "t/c", en: "t/c" }, min: 0, max: 1, step: 0.01, value: 0.12, onInput: run });
  const sRe = slider({ label: { es: "Reynolds", en: "Reynolds" }, min: 1e4, max: 1e7, value: 3e6, log: true, format: (v) => v.toExponential(1), onInput: run });
  const sCl = slider({ label: { es: "CL del ala (para el inducido)", en: "Wing CL (for induced drag)" }, min: 0, max: 2, step: 0.05, value: 0.6, onInput: run });
  const sAR = slider({ label: { es: "Alargamiento AR", en: "Aspect ratio AR" }, min: 1, max: 20, step: 0.5, value: 4, onInput: run });
  ui.controls.append(sShape.el, sTc.el, sRe.el, sCl.el, sAR.el);
  const roF = readout({ es: "Fricción", en: "Friction" });
  const roP = readout({ es: "Presión (forma)", en: "Pressure (form)" });
  const roI = readout({ es: "Inducido", en: "Induced" });
  const roT = readout({ es: "Total", en: "Total" });
  ui.readouts.append(roF.el, roP.el, roI.el, roT.el);
  ui.note.innerHTML = L(
    "Fricción y presión de secciones 2D: correlación de Hoerner para perfiles (t/c ≤ 0.35) con el convenio de factor de forma (fricción = 2·Cf de la placa; presión o forma = el resto: ≈ 20 % del total para t/c = 0.12, como en XFOIL) y datos de cilindro (con crisis de resistencia), interpolados entre ambos. Inducido: CDi = CL²/(π e AR), e = 0.95. Todo referido a la misma superficie de referencia.",
    "Friction and pressure of 2D sections: Hoerner's build-up for streamlined sections (t/c ≤ 0.35) with the form-factor convention (friction = the plate's 2·Cf; pressure or form = the rest: ≈ 20 % of the total for t/c = 0.12, as XFOIL shows) and cylinder data (with drag crisis), interpolated in between. Induced: CDi = CL²/(π e AR), e = 0.95. Everything on the same reference area."
  );
  let sweep = null;
  physics.call("drag.sweep", { re: 3e6 }).then((r) => (sweep = r));
  const call = liveCall("drag", "drag.buildup", 40);
  function run() {
    const shape = sShape.value;
    call({ tc: shape === "section" ? sTc.value : 1, re: sRe.value, cl: sCl.value, AR: sAR.value, e: 0.95, shape }, (r) => {
      roF.set(r.cd_friction.toFixed(4));
      roP.set(r.cd_pressure.toFixed(4));
      roI.set(r.cd_induced.toFixed(4));
      roT.set(r.total.toFixed(4));
      drawBars(r, shape);
      physics.latest("drag-sw", "drag.sweep", { re: sRe.value }).then((s) => {
        if (!s) return;
        sweep = s;
        plot.set([
          { x: s.tc.tc, y: s.tc.friction, color: cssVar("--accent"), label: { es: "fricción", en: "friction" } },
          { x: s.tc.tc, y: s.tc.pressure, color: cssVar("--accent-2"), label: { es: "presión", en: "pressure" } },
        ], [{ type: "vline", x: shape === "section" ? sTc.value : 1, color: cssVar("--fg-muted") }]);
      });
    });
  }
  function drawBars(r, shape) {
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
    // body sketch with wake width proportional to pressure drag share
    const cx = W * 0.28, cy = H / 2;
    const c = Math.min(W * 0.3, 200);
    const t = shape === "section" ? sTc.value : shape === "cylinder" ? 1 : 0;
    g.save();
    g.fillStyle = cssVar("--body-fill");
    g.strokeStyle = cssVar("--body-stroke");
    g.lineWidth = 1.5;
    if (shape === "plate_normal") {
      g.fillRect(cx - 3, cy - c / 2, 6, c);
      g.strokeRect(cx - 3, cy - c / 2, 6, c);
    } else {
      const a = shape === "cylinder" ? c * 0.35 : c / 2;
      const b = Math.max(1.5, (shape === "cylinder" ? c * 0.35 : (t * c) / 2));
      g.beginPath();
      g.ellipse(cx, cy, a, b, 0, 0, 7);
      g.fill();
      g.stroke();
    }
    const frac = r.cd_pressure / (r.cd_friction + r.cd_pressure + 1e-12);
    const wake = (shape === "plate_normal" ? c : shape === "cylinder" ? c * 0.7 : Math.max(6, t * c)) * (0.3 + 0.9 * frac);
    const grad = g.createLinearGradient(cx, 0, W * 0.62, 0);
    grad.addColorStop(0, "rgba(244,63,94,0.45)");
    grad.addColorStop(1, "rgba(244,63,94,0)");
    g.fillStyle = grad;
    g.beginPath();
    g.moveTo(cx + 10, cy - wake / 2);
    g.lineTo(W * 0.62, cy - wake * 0.75);
    g.lineTo(W * 0.62, cy + wake * 0.75);
    g.lineTo(cx + 10, cy + wake / 2);
    g.fill();
    g.restore();
    g.fillStyle = cssVar("--fg-muted");
    g.font = "11px Inter";
    g.fillText(tr({ es: "estela (anchura ∝ resistencia de presión)", en: "wake (width ∝ pressure drag)" }), 10, H - 10);
    // stacked bar
    const bx = W * 0.72, bw = W * 0.12;
    const total = r.total || 1e-9;
    const parts = [
      [r.cd_friction, cssVar("--accent"), { es: "fricción", en: "friction" }],
      [r.cd_pressure, cssVar("--accent-2"), { es: "presión", en: "pressure" }],
      [r.cd_induced, cssVar("--accent-3"), { es: "inducido", en: "induced" }],
    ];
    let y = H - 20;
    const hTot = H - 50;
    for (const [v, col, lab] of parts) {
      const h = (v / total) * hTot;
      g.fillStyle = col;
      g.fillRect(bx, y - h, bw, h);
      if (h > 14) {
        g.fillStyle = "#001018";
        g.font = "bold 11px Inter";
        g.fillText(`${Math.round((v / total) * 100)}%`, bx + 6, y - h / 2 + 4);
      }
      g.fillStyle = col;
      g.font = "12px Inter";
      if (h > 4) g.fillText(tr(lab), bx + bw + 6, y - h / 2 + 4);
      y -= h;
    }
  }
  run();
}

function inducedLab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pAR = new Plot(row, { height: 260, xlabel: { es: "AR", en: "AR" }, ylabel: { es: "CDi a CL dado", en: "CDi at given CL" } });
  const pE = new Plot(row, { height: 260, xlabel: { es: "altura de endplate h/b  ·  altura al suelo h/b", en: "endplate height h/b  ·  ground height h/b" }, ylabel: { es: "CDi / CDi (ala aislada)", en: "CDi / CDi (isolated wing)" }, ylim: [0, 1.1] });
  const sCl = slider({ label: { es: "CL", en: "CL" }, min: 0.2, max: 2, step: 0.05, value: 1, onInput: run });
  ui.controls.append(sCl.el);
  ui.note.innerHTML = L(
    "Izquierda: CDi = CL²/(π e AR). Derecha: vortex-lattice (Python) para un ala AR = 3 con endplates de altura creciente y para un ala AR = 6 acercándose al suelo (método de imágenes). Las tres palancas clásicas: aumentar AR (envergadura), endplates y efecto suelo.",
    "Left: CDi = CL²/(π e AR). Right: vortex lattice (Python) for an AR = 3 wing with growing endplates and an AR = 6 wing approaching the ground (image method). The three classic levers: higher AR (span), endplates and ground effect."
  );
  let ep = null, gr = null;
  Promise.all([physics.call("vlm.endplate_sweep", { AR: 3, alpha: 5 }), physics.call("vlm.ground_sweep", { AR: 6, alpha: 5 })]).then(([a, b]) => {
    ep = a;
    gr = b;
    run();
  });
  function run() {
    const ar = [...Array(40).keys()].map((i) => 1 + i * 0.5);
    const cl = sCl.value;
    pAR.set([0.7, 0.85, 1.0].map((e, k) => ({ x: ar, y: ar.map((A) => (cl * cl) / (Math.PI * e * A)), color: [cssVar("--accent-2"), cssVar("--accent-3"), cssVar("--accent")][k], label: { es: `e = ${e}`, en: `e = ${e}` } })));
    if (!ep) return;
    const cdi0 = ep.CDi[0] / (ep.CL[0] * ep.CL[0]);
    const epRatio = ep.CDi.map((c, i) => c / (ep.CL[i] * ep.CL[i]) / cdi0);
    const gRatio = gr.CDi.map((c, i) => c / (gr.CL[i] * gr.CL[i]) / (gr.CDi_free / (gr.CL_free * gr.CL_free)));
    pE.set([
      { x: ep.h, y: epRatio, color: cssVar("--accent-3"), points: true, label: { es: "endplates (a igual CL)", en: "endplates (same CL)" } },
      { x: gr.h.map((h) => h / 1), y: gRatio, color: cssVar("--good"), points: true, label: { es: "efecto suelo (a igual CL)", en: "ground effect (same CL)" } },
    ]);
  }
}

export default {
  subtitle: {
    es: "Fricción, presión (forma) e inducida: qué las produce, cuál domina en cada caso y cómo se reduce la resistencia inducida.",
    en: "Friction, pressure (form) and induced drag: what produces them, which dominates when, and how induced drag is reduced.",
  },
  heroParams: { eps: 0.2, camber: 0.0, alpha: 0 },
  intuition: {
    es: R`<p>Toda la fuerza aerodinámica sale de dos cosas que actúan sobre la superficie: la <b>tensión tangencial</b> (fricción) y la <b>presión</b> normal. La <span class="term">resistencia de fricción</span> es la integral de \(\tau_w\): depende del área mojada y del estado de la capa límite (turbulenta ≫ laminar). La <span class="term">resistencia de presión o de forma</span> aparece porque la viscosidad impide recuperar en la parte trasera la presión que se tenía delante: espesor de capa límite y, sobre todo, <b>separación</b>. En cuerpos romos domina la presión; en cuerpos fuselados, la fricción. Juntas forman la <span class="term">resistencia de perfil</span> (2D).</p>
    <p>En 3D aparece además la <span class="term">resistencia inducida</span>: un ala finita que sustenta deja una estela con vórtices de punta; el <i>downwash</i> que inducen inclina hacia atrás la fuerza local. Es el precio energético de generar sustentación (o carga) con una envergadura finita, existe incluso sin viscosidad y escala como \(C_L^2/AR\). En un F1, con alerones de bajo alargamiento muy cargados, es una parte importante de la resistencia ligada a la carga.</p>`,
    en: R`<p>All aerodynamic force comes from two things acting on the surface: <b>shear stress</b> (friction) and normal <b>pressure</b>. <span class="term">Skin-friction drag</span> is the integral of \(\tau_w\): it depends on wetted area and boundary-layer state (turbulent ≫ laminar). <span class="term">Pressure or form drag</span> appears because viscosity prevents recovering at the rear the pressure present at the front: boundary-layer thickness and, above all, <b>separation</b>. Pressure dominates on bluff bodies, friction on streamlined ones. Together they make <span class="term">profile drag</span> (2D).</p>
    <p>In 3D there is also <span class="term">induced drag</span>: a lifting finite wing leaves a wake with tip vortices; the downwash they induce tilts the local force backwards. It is the energy price of producing lift (or downforce) with a finite span, exists even without viscosity and scales as \(C_L^2/AR\). On an F1 car, with highly loaded low-aspect-ratio wings, it is a large part of the downforce-related drag.</p>`,
  },
  physics: {
    es: R`<p><b>Descomposición</b>: $$D=\underbrace{\oint\tau_w\,\hat t\cdot\hat x\,dS}_{\text{fricción}}+\underbrace{\oint(-p)\,\hat n\cdot\hat x\,dS}_{\text{presión}}\qquad C_D=C_{D,0}+\frac{C_L^2}{\pi e AR}$$ (el término de presión incluye en 3D la parte inducida; también hay resistencia de onda en transónico y de interferencia entre componentes).</p>
    <p><b>Inducida</b> (línea sustentadora): \(\alpha_i=w/V_\infty\), \(D_i=L\sin\alpha_i\approx L\,\alpha_i\): $$C_{D_i}=\frac{C_L^2}{\pi e AR},\qquad e=1\ \text{(carga elíptica, downwash uniforme)}$$ Por energía: \(D_i\) = flujo de energía cinética del flujo cruzado en el plano de Trefftz.</p>
    <p><b>Cómo reducir la inducida</b>:</p>
    <ul><li><b>Aumentar AR / envergadura</b> (a igual sustentación \(D_i=\frac{L^2}{\pi e\,q\,b^2}\): depende de la envergadura, no del área). En F1 está limitada por el reglamento.</li>
    <li><b>Distribución de carga cercana a la elíptica</b> (\(e\to1\)): planta, alabeo.</li>
    <li><b>Endplates / winglets</b>: dificultan el paso de intradós a extradós, aumentan el AR efectivo (\(e_{ef}\approx1+1.9\,h/b\), Hoerner).</li>
    <li><b>Efecto suelo</b>: el vórtice imagen reduce el downwash; \(C_{D_i}\) cae al acercarse al suelo.</li>
    <li>Reducir el \(C_L\) necesario.</li></ul>
    <p><b>Órdenes de magnitud</b>: placa plana alineada \(C_D\approx2C_f\approx0.006\) (Re 10⁶–10⁷, turbulenta); perfil 12 % ≈ 0.006–0.01; cilindro ≈ 1.2 (subcrítico); placa normal ≈ 2.0 (2D). Un F1 completo tiene \(C_D A\approx1.0\)–1.4 m² con \(C_L A\approx3\)–5 m².</p>`,
    en: R`<p><b>Decomposition</b>: $$D=\underbrace{\oint\tau_w\,\hat t\cdot\hat x\,dS}_{\text{friction}}+\underbrace{\oint(-p)\,\hat n\cdot\hat x\,dS}_{\text{pressure}}\qquad C_D=C_{D,0}+\frac{C_L^2}{\pi e AR}$$ (in 3D the pressure term includes the induced part; there is also wave drag in transonic flow and interference drag between components).</p>
    <p><b>Induced</b> (lifting line): \(\alpha_i=w/V_\infty\), \(D_i=L\sin\alpha_i\approx L\,\alpha_i\): $$C_{D_i}=\frac{C_L^2}{\pi e AR},\qquad e=1\ \text{(elliptic loading, uniform downwash)}$$ Energy view: \(D_i\) = kinetic-energy flux of the crossflow in the Trefftz plane.</p>
    <p><b>How to reduce induced drag</b>:</p>
    <ul><li><b>Increase AR / span</b> (at equal lift \(D_i=\frac{L^2}{\pi e\,q\,b^2}\): it depends on span, not area). On F1 cars limited by the rules.</li>
    <li><b>Near-elliptic loading</b> (\(e\to1\)): planform, twist.</li>
    <li><b>Endplates / winglets</b>: hinder the flow from pressure to suction side, increase effective AR (\(e_{eff}\approx1+1.9\,h/b\), Hoerner).</li>
    <li><b>Ground effect</b>: the image vortex reduces downwash; \(C_{D_i}\) drops near the ground.</li>
    <li>Reduce the required \(C_L\).</li></ul>
    <p><b>Orders of magnitude</b>: aligned flat plate \(C_D\approx2C_f\approx0.006\) (Re 10⁶–10⁷, turbulent); 12 % airfoil ≈ 0.006–0.01; cylinder ≈ 1.2 (subcritical); normal plate ≈ 2.0 (2D). A complete F1 car has \(C_D A\approx1.0\)–1.4 m² with \(C_L A\approx3\)–5 m².</p>`,
  },
  labs: [
    { title: { es: "Descompositor de resistencia", en: "Drag decomposer" }, desc: { es: "Pasa de placa alineada a perfil, elipse gruesa, cilindro y placa normal: mira cómo cambia el reparto.", en: "Go from aligned plate to airfoil, thick ellipse, cylinder and normal plate: watch the split change." }, mount: buildupLab },
    { title: { es: "Las tres palancas contra la resistencia inducida", en: "The three levers against induced drag" }, mount: inducedLab },
  ],
  interview: [
    { q: { es: "¿Qué tipos de resistencia hay y cuál es la más importante en un F1?", en: "What types of drag are there and which matters most on an F1 car?" }, a: { es: R`<p>Fricción (cortante en la pared), presión/forma (separación y espesor de estela) e inducida (consecuencia de la sustentación finita, vórtices de punta). En un F1, cuerpo romo con ruedas expuestas y muy cargado, domina la de presión (ruedas, estelas, separaciones) y una parte grande está ligada a la carga: inducida de los alerones de bajo AR más la de presión de sus estelas. La fricción es una fracción pequeña.</p>`, en: R`<p>Friction (wall shear), pressure/form (separation and wake thickness) and induced (consequence of finite-span lift, tip vortices). On an F1 car, a bluff, heavily loaded body with exposed wheels, pressure drag dominates (wheels, wakes, separations) and a large part is downforce-related: induced drag of the low-AR wings plus the pressure drag of their wakes. Friction is a small fraction.</p>` } },
    { q: { es: "¿Cómo reducirías la resistencia inducida de un alerón?", en: "How would you reduce the induced drag of a wing?" }, a: { es: R`<p>Aumentar la envergadura/AR (limitado por reglamento), acercar la carga a una distribución elíptica (menos gradientes de carga spanwise, sobre todo en la punta), poner endplates o winglets (aumentan el AR efectivo al limitar la fuga de presión alrededor de la punta), usar efecto suelo (el vórtice imagen reduce el downwash) o simplemente pedirle menos \(C_L\).</p>`, en: R`<p>Increase span/AR (rule-limited), bring the loading closer to elliptic (fewer spanwise load gradients, especially at the tip), fit endplates or winglets (increase effective AR by limiting pressure leakage around the tip), use ground effect (the image vortex reduces downwash) or simply ask for less \(C_L\).</p>` } },
    { q: { es: "¿Por qué la resistencia inducida existe aunque el fluido sea no viscoso?", en: "Why does induced drag exist even in an inviscid fluid?" }, a: { es: R`<p>Porque un ala finita que sustenta tiene que desprender vorticidad (\(d\Gamma/dy\)) en la estela; esa estela contiene energía cinética de flujo cruzado que se renueva continuamente. La potencia para crearla, \(D_iV\), la paga el ala. Equivalentemente, el downwash inclina la fuerza local hacia atrás.</p>`, en: R`<p>Because a lifting finite wing must shed vorticity (\(d\Gamma/dy\)) into the wake; that wake contains crossflow kinetic energy that is continuously renewed. The power to create it, \(D_iV\), is paid by the wing. Equivalently, downwash tilts the local force backwards.</p>` } },
  ],
  myths: [
    { es: "«La resistencia inducida depende del área del ala». A igual sustentación depende de la envergadura: D_i = L²/(π e q b²).", en: "“Induced drag depends on wing area”. At equal lift it depends on span: D_i = L²/(π e q b²)." },
    { es: "«Aerodinámica eficiente = menos fricción». En cuerpos romos la fricción es casi irrelevante; la clave es evitar la separación.", en: "“Efficient aerodynamics = less friction”. On bluff bodies friction is almost irrelevant; the key is avoiding separation." },
    { es: "«Los endplates eliminan el vórtice de punta». Lo desplazan y debilitan; la estela sigue conteniendo la vorticidad total desprendida.", en: "“Endplates eliminate the tip vortex”. They displace and weaken it; the wake still contains the total shed vorticity." },
  ],
  quiz: [
    { q: { es: "Si duplicas el AR manteniendo CL, la resistencia inducida…", en: "If you double AR keeping CL, induced drag…" }, options: [{ es: "se duplica", en: "doubles" }, { es: "se reduce a la mitad", en: "halves" }, { es: "no cambia", en: "does not change" }, { es: "se reduce a un cuarto", en: "drops to a quarter" }], correct: 1, explain: { es: "CDi ∝ 1/AR.", en: "CDi ∝ 1/AR." } },
    { q: { es: "En un cilindro subcrítico la resistencia es sobre todo…", en: "On a subcritical cylinder drag is mostly…" }, options: [{ es: "de fricción", en: "friction" }, { es: "de presión", en: "pressure" }, { es: "inducida", en: "induced" }, { es: "de onda", en: "wave" }], correct: 1, explain: { es: "~97 %: separación temprana y estela ancha.", en: "~97 %: early separation and wide wake." } },
    { q: { es: "e = 1 corresponde a…", en: "e = 1 corresponds to…" }, options: [{ es: "ala rectangular", en: "rectangular wing" }, { es: "carga elíptica", en: "elliptic loading" }, { es: "ala delta", en: "delta wing" }, { es: "endplate infinito", en: "infinite endplate" }], correct: 1, explain: { es: "Downwash uniforme, mínima CDi para envergadura y sustentación dadas (sin endplates/suelo).", en: "Uniform downwash, minimum CDi for given span and lift (no endplates/ground)." } },
  ],
  refs: [
    "S.F. Hoerner, <i>Fluid-Dynamic Drag</i>, 1965.",
    "J.D. Anderson, <i>Fundamentals of Aerodynamics</i>, ch. 1 & 5.",
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 2 & 6.",
    "M. Drela, <i>Flight Vehicle Aerodynamics</i>, ch. 5 (Trefftz plane).",
  ],
};
