import { slider, labLayout, readout, L, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function profilesLab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const p1 = new Plot(row, { height: 300, xlabel: { es: "u / U", en: "u / U" }, ylabel: { es: "y / δ", en: "y / δ" }, xlim: [0, 1.05], ylim: [0, 1.1] });
  const p2 = new Plot(row, { height: 300, xlabel: { es: "y⁺ = y u_τ / ν", en: "y⁺ = y u_τ / ν" }, ylabel: { es: "u⁺ = u / u_τ", en: "u⁺ = u / u_τ" }, logX: true, ylim: [0, 30] });
  const sRt = slider({ label: { es: "Re_τ = δ u_τ / ν (turbulenta)", en: "Re_τ = δ u_τ / ν (turbulent)" }, min: 200, max: 20000, value: 1000, log: true, format: (v) => v.toFixed(0), onInput: run });
  ui.controls.append(sRt.el);
  const roHl = readout({ es: "H laminar", en: "laminar H" });
  const roHt = readout({ es: "H turbulenta", en: "turbulent H" });
  const roS = readout({ es: "∂u/∂y pared (turb/lam, mismo δ)", en: "wall ∂u/∂y (turb/lam, same δ)" });
  ui.readouts.append(roHl.el, roHt.el, roS.el);
  ui.note.innerHTML = L(
    "Laminar: Blasius (Falkner-Skan β=0). Turbulenta: ley de pared de Spalding + estela de Coles (Π = 0.55). En unidades de pared se ven la subcapa viscosa (u⁺ = y⁺, y⁺ &lt; 5), la zona de transición (buffer, 5–30) y la ley logarítmica u⁺ = ln(y⁺)/κ + B.",
    "Laminar: Blasius (Falkner-Skan β=0). Turbulent: Spalding's law of the wall + Coles wake (Π = 0.55). Wall units show the viscous sublayer (u⁺ = y⁺, y⁺ &lt; 5), the buffer layer (5–30) and the log law u⁺ = ln(y⁺)/κ + B."
  );
  const call = liveCall("lt", "bl.compare", 50);
  function run() {
    call({ re_tau: sRt.value }, (r) => {
      // tangent lines at the wall (slope) in the outer-scaled plot
      const sl = r.dudy_wall.laminar, st = r.dudy_wall.turbulent;
      p1.set([
        { x: r.laminar.u, y: r.laminar.y, color: cssVar("--c-lam"), width: 3, label: { es: "laminar (Blasius)", en: "laminar (Blasius)" } },
        { x: r.turbulent.u, y: r.turbulent.y, color: cssVar("--c-turb"), width: 3, label: { es: "turbulenta", en: "turbulent" } },
        { x: [0, 0.6], y: [0, 0.6 / sl], color: cssVar("--c-lam"), dash: [4, 3], width: 1 },
        { x: [0, 0.9], y: [0, 0.9 / st], color: cssVar("--c-turb"), dash: [4, 3], width: 1 },
      ]);
      p2.set([
        { x: r.wall.yplus, y: r.wall.uplus, color: cssVar("--accent"), width: 3, label: { es: "ley de pared (Spalding)", en: "law of the wall (Spalding)" } },
        { x: r.wall.yplus, y: r.wall.linear, color: cssVar("--c-lam"), dash: [4, 3], label: { es: "u⁺ = y⁺", en: "u⁺ = y⁺" } },
        { x: r.wall.yplus, y: r.wall.log, color: cssVar("--accent-2"), dash: [4, 3], label: { es: "ley logarítmica", en: "log law" } },
      ], [{ type: "band", x0: 0.1, x1: 5, color: "rgba(163,230,53,0.08)" }, { type: "band", x0: 5, x1: 30, color: "rgba(251,191,36,0.07)" }, { type: "text", x: 0.35, y: 27, text: { es: "subcapa viscosa", en: "viscous sublayer" } }, { type: "text", x: 7, y: 27, text: { es: "buffer", en: "buffer" } }, { type: "text", x: 200, y: 27, text: { es: "región logarítmica", en: "log region" } }]);
      roHl.set(r.laminar.H.toFixed(2));
      roHt.set(r.turbulent.H.toFixed(2));
      roS.set((st / sl).toFixed(1) + "×");
    });
  }
  run();
}

function adverseLab(host) {
  const ui = labLayout(host);
  const plot = new Plot(ui.viz, { height: 260, xlabel: { es: "x / L", en: "x / L" }, ylabel: { es: "factor de forma H", en: "shape factor H" }, ylim: [1, 4.2] });
  const sK = slider({ label: { es: "Deceleración k (ue/U = 1 − k x)", en: "Deceleration k (ue/U = 1 − k x)" }, min: 0.05, max: 0.9, step: 0.01, value: 0.3, onInput: run });
  const sRe = slider({ label: { es: "Re_L", en: "Re_L" }, min: 1e5, max: 1e7, value: 1e6, log: true, format: (v) => v.toExponential(1), onInput: run });
  ui.controls.append(sK.el, sRe.el);
  const roL = readout({ es: "Separa la laminar en", en: "Laminar separates at" }, "x/L");
  const roT = readout({ es: "Separa la turbulenta en", en: "Turbulent separates at" }, "x/L");
  ui.readouts.append(roL.el, roT.el);
  ui.note.innerHTML = L(
    "Misma deceleración exterior para dos capas límite: una laminar (corriente muy limpia, sin trip) y otra disparada a turbulenta en x/L = 0.01. La laminar separa mucho antes (λ de Thwaites &lt; −0.09); la turbulenta aguanta hasta H ≈ 2. Por eso los vortex generators y los trips se usan para evitar separación.",
    "Same outer deceleration for two boundary layers: a laminar one (very clean stream, no trip) and one tripped turbulent at x/L = 0.01. The laminar layer separates much earlier (Thwaites λ &lt; −0.09); the turbulent one holds until H ≈ 2. That is why vortex generators and trips are used to avoid separation."
  );
  function run() {
    const base = { re_L: sRe.value, k: sK.value, stations: [0.5] };
    Promise.all([
      physics.latest("adv-l", "bl.flat_plate", { ...base, tu: 0.02 }),
      physics.latest("adv-t", "bl.flat_plate", { ...base, tu: 0.02, trip: 0.01 }),
    ]).then(([a, b]) => {
      if (!a || !b) return;
      const la = a.lam_sep ?? (a.transition && a.bubble ? a.transition : null);
      const mk = [];
      if (la != null) mk.push({ type: "vline", x: la, color: cssVar("--c-lam"), label: { es: "sep. laminar", en: "laminar sep." } });
      if (b.turb_sep != null) mk.push({ type: "vline", x: b.turb_sep, color: cssVar("--c-turb"), label: { es: "sep. turbulenta", en: "turbulent sep." }, labelOffset: 14 });
      const Hl = a.H.map((h, i) => (a.state[i] === 0 ? h : null));
      plot.set([
        { x: a.x, y: Hl, color: cssVar("--c-lam"), width: 2.6, label: { es: "laminar", en: "laminar" } },
        { x: b.x, y: b.H.map((h, i) => (b.state[i] === 1 ? h : null)), color: cssVar("--c-turb"), width: 2.6, label: { es: "turbulenta (trip)", en: "turbulent (tripped)" } },
      ], mk);
      roL.set(la == null ? L("no separa", "no separation") : la.toFixed(3), "bad");
      roT.set(b.turb_sep == null ? L("no separa", "no separation") : b.turb_sep.toFixed(3), b.turb_sep == null ? "good" : "warn");
    });
  }
  run();
}

function crisisLab(host) {
  const ui = labLayout(host);
  const plot = new Plot(ui.viz, { height: 280, xlabel: { es: "Re = V D / ν", en: "Re = V D / ν" }, ylabel: { es: "Cd del cilindro", en: "cylinder Cd" }, logX: true, ylim: [0, 1.4] });
  const sRe = slider({ label: { es: "Re", en: "Re" }, min: 1e3, max: 1e7, value: 1e5, log: true, format: (v) => v.toExponential(1), onInput: draw });
  ui.controls.append(sRe.el);
  const roCd = readout({ es: "Cd", en: "Cd" });
  const roS = readout({ es: "Capa límite al separar", en: "Boundary layer at separation" });
  ui.readouts.append(roCd.el, roS.el);
  ui.note.innerHTML = L(
    "Crisis de resistencia (datos clásicos de cilindro, p. ej. Achenbach 1968). Subcrítico: separa laminar a ~80° → estela ancha, Cd ≈ 1.2. Al transicionar la capa límite antes de separar (Re ≈ 3–5·10⁵) la separación pasa a ~120°, la estela se estrecha y Cd cae a ~0.3. Los hoyuelos de una pelota de golf disparan esa transición a Re más bajos.",
    "Drag crisis (classic cylinder data, e.g. Achenbach 1968). Subcritical: laminar separation at ~80° → wide wake, Cd ≈ 1.2. When the boundary layer transitions before separating (Re ≈ 3–5·10⁵) separation moves to ~120°, the wake narrows and Cd drops to ~0.3. Golf-ball dimples trigger that transition at lower Re."
  );
  let data = null;
  physics.call("drag.sweep", {}).then((r) => {
    data = r.cylinder;
    draw();
  });
  function draw() {
    if (!data) return;
    const re = sRe.value;
    let k = 0;
    data.re.forEach((v, i) => (Math.abs(Math.log(v / re)) < Math.abs(Math.log(data.re[k] / re)) ? (k = i) : 0));
    plot.set([{ x: data.re, y: data.cd, color: cssVar("--accent"), width: 2.6, label: { es: "Cd(Re) cilindro", en: "cylinder Cd(Re)" } }], [
      { type: "band", x0: 2.5e5, x1: 6e5, color: "rgba(244,114,182,0.1)" },
      { type: "point", x: re, y: data.cd[k], color: cssVar("--accent-2"), r: 6 },
    ]);
    roCd.set(data.cd[k].toFixed(2));
    roS.set(re < 2.5e5 ? L("laminar (~80°)", "laminar (~80°)") : re < 6e5 ? L("crisis: burbuja + turbulenta", "crisis: bubble + turbulent") : L("turbulenta (~110–120°)", "turbulent (~110–120°)"), re < 2.5e5 ? "" : "good");
  }
}

export default {
  subtitle: {
    es: "Por qué el perfil turbulento es una «D» y el laminar una «V», qué implica para fricción y separación, y la ley de pared.",
    en: "Why the turbulent profile is a “D” and the laminar one a “V”, what it means for friction and separation, and the law of the wall.",
  },
  heroParams: { eps: 0.12, camber: 0.02, alpha: 2 },
  intuition: {
    es: R`<p>En una capa límite <b>laminar</b> la cantidad de movimiento solo se transporta hacia la pared por difusión molecular (viscosidad): el perfil de velocidad crece suavemente desde la pared, casi lineal y luego redondeado, forma de "<b>V</b>" estirada. En una capa <b>turbulenta</b> los remolinos traen continuamente fluido rápido de la zona exterior hacia la pared (y llevan fluido lento hacia fuera). Resultado: el perfil está mucho más "<b>lleno</b>" (forma de "<b>D</b>"), casi uniforme en la mayor parte del espesor, y cae bruscamente en una <span class="term">subcapa viscosa</span> muy delgada.</p>
    <p>Dos consecuencias opuestas: (1) el gradiente en la pared \(\partial u/\partial y|_w\) es mucho mayor → <b>más fricción</b>; (2) el fluido cerca de la pared tiene más energía y está continuamente re-energizado → <b>resiste mucho mejor un gradiente adverso</b> antes de separar. De ahí la crisis de resistencia del cilindro, los hoyuelos de las pelotas de golf y los generadores de vórtices.</p>`,
    en: R`<p>In a <b>laminar</b> boundary layer momentum reaches the wall only by molecular diffusion (viscosity): the velocity profile grows smoothly from the wall, almost linear then rounded, a stretched "<b>V</b>" shape. In a <b>turbulent</b> layer eddies continuously bring fast outer fluid towards the wall (and carry slow fluid outwards). Result: a much "<b>fuller</b>" profile ("<b>D</b>" shape), almost uniform over most of the thickness, dropping sharply in a very thin <span class="term">viscous sublayer</span>.</p>
    <p>Two opposite consequences: (1) the wall gradient \(\partial u/\partial y|_w\) is much larger → <b>more friction</b>; (2) near-wall fluid carries more energy and is continuously re-energised → it <b>withstands adverse gradients much better</b> before separating. Hence the cylinder drag crisis, golf-ball dimples and vortex generators.</p>`,
  },
  physics: {
    es: R`<p><b>Tensión de Reynolds</b>: promediando Navier-Stokes aparece \(-\rho\overline{u'v'}\), que en la capa turbulenta es mucho mayor que la tensión viscosa salvo muy cerca de la pared: $$\tau=\mu\frac{\partial \bar u}{\partial y}-\rho\overline{u'v'}$$</p>
    <p><b>Unidades de pared</b>: \(u_\tau=\sqrt{\tau_w/\rho}\), \(y^+=y u_\tau/\nu\), \(u^+=\bar u/u_\tau\).</p>
    <ul><li>Subcapa viscosa \(y^+\lesssim5\): \(u^+=y^+\).</li><li>Buffer \(5<y^+<30\).</li><li>Ley logarítmica \(30<y^+\), \(y/\delta<0.2\): \(u^+=\frac1\kappa\ln y^++B\), \(\kappa\approx0.41,\ B\approx5.0\).</li><li>Zona de estela (Coles): \(u^+ = \ldots + \frac{2\Pi}{\kappa}\sin^2\!\frac{\pi y}{2\delta}\); \(\Pi\) crece con el gradiente adverso.</li></ul>
    <p><b>Comparación a igualdad de \(Re_x\)</b> (placa plana): $$\frac{C_{f,turb}}{C_{f,lam}}\approx\frac{(2\log_{10}Re_x-0.65)^{-2.3}}{0.664\,Re_x^{-1/2}}\sim 5\text{–}10\ \text{a}\ Re_x\sim10^6\text{–}10^7$$ \(H_{lam}=2.59\) frente a \(H_{turb}\approx1.3\)–1.4; ley de potencia 1/7: \(u/U=(y/\delta)^{1/7}\).</p>
    <p><b>Separación</b>: laminar con un aumento de presión de solo \(\Delta C_p\approx0.1\) (Howarth: \(u_e=U(1-x/L)\) separa en \(x/L=0.12\)); turbulenta soporta recuperaciones mucho mayores (Stratford).</p>`,
    en: R`<p><b>Reynolds stress</b>: averaging Navier-Stokes yields \(-\rho\overline{u'v'}\), which in a turbulent layer dominates the viscous stress except very close to the wall: $$\tau=\mu\frac{\partial \bar u}{\partial y}-\rho\overline{u'v'}$$</p>
    <p><b>Wall units</b>: \(u_\tau=\sqrt{\tau_w/\rho}\), \(y^+=y u_\tau/\nu\), \(u^+=\bar u/u_\tau\).</p>
    <ul><li>Viscous sublayer \(y^+\lesssim5\): \(u^+=y^+\).</li><li>Buffer layer \(5<y^+<30\).</li><li>Log law \(30<y^+\), \(y/\delta<0.2\): \(u^+=\frac1\kappa\ln y^++B\), \(\kappa\approx0.41,\ B\approx5.0\).</li><li>Wake region (Coles): \(u^+ = \ldots + \frac{2\Pi}{\kappa}\sin^2\!\frac{\pi y}{2\delta}\); \(\Pi\) grows with adverse gradient.</li></ul>
    <p><b>Comparison at equal \(Re_x\)</b> (flat plate): $$\frac{C_{f,turb}}{C_{f,lam}}\approx\frac{(2\log_{10}Re_x-0.65)^{-2.3}}{0.664\,Re_x^{-1/2}}\sim 5\text{–}10\ \text{at}\ Re_x\sim10^6\text{–}10^7$$ \(H_{lam}=2.59\) vs \(H_{turb}\approx1.3\)–1.4; 1/7 power law: \(u/U=(y/\delta)^{1/7}\).</p>
    <p><b>Separation</b>: a laminar layer separates after a pressure rise of only \(\Delta C_p\approx0.1\) (Howarth: \(u_e=U(1-x/L)\) separates at \(x/L=0.12\)); a turbulent one withstands much larger recoveries (Stratford).</p>`,
  },
  labs: [
    { title: { es: "Perfiles laminar («V») y turbulento («D») y ley de pared", en: "Laminar (“V”) and turbulent (“D”) profiles and law of the wall" }, mount: profilesLab },
    { title: { es: "¿Quién aguanta más gradiente adverso?", en: "Which one withstands more adverse gradient?" }, mount: adverseLab },
    { title: { es: "Crisis de resistencia del cilindro (y la pelota de golf)", en: "Cylinder drag crisis (and the golf ball)" }, mount: crisisLab },
  ],
  interview: [
    { q: { es: "Dibuja los perfiles de velocidad laminar y turbulento y explica la diferencia.", en: "Sketch laminar and turbulent velocity profiles and explain the difference." }, a: { es: R`<p>Laminar: crecimiento gradual, casi parabólico, pendiente en la pared moderada (forma de "V"). Turbulento: muy lleno, casi plano en la zona exterior y una caída muy brusca en la subcapa viscosa (forma de "D"). La diferencia es el transporte turbulento de cantidad de movimiento hacia la pared (tensiones de Reynolds), que hace \(\tau_w\) mayor y da más energía al fluido cercano a la pared.</p>`, en: R`<p>Laminar: gradual, almost parabolic growth, moderate wall slope ("V" shape). Turbulent: very full, almost flat in the outer part with a very steep drop in the viscous sublayer ("D" shape). The difference is turbulent momentum transport towards the wall (Reynolds stresses), which raises \(\tau_w\) and energises near-wall fluid.</p>` } },
    { q: { es: "Si la turbulenta tiene más fricción, ¿por qué a veces se busca forzarla?", en: "If turbulent has more friction, why is it sometimes forced?" }, a: { es: R`<p>Porque evita o retrasa la separación en zonas con gradiente adverso fuerte (alerones muy cargados, difusores, flaps, cuerpos romos). La separación cuesta mucho más (pérdida de sustentación/carga y resistencia de presión) que el aumento de fricción. Ejemplos: vortex generators, trips, hoyuelos de golf, bordes dentados.</p>`, en: R`<p>Because it prevents or delays separation where adverse gradients are strong (highly loaded wings, diffusers, flaps, bluff bodies). Separation costs far more (lost lift/downforce and pressure drag) than the extra friction. Examples: vortex generators, trips, golf-ball dimples, serrated edges.</p>` } },
    { q: { es: "¿Qué es y+ y por qué importa en CFD?", en: "What is y+ and why does it matter in CFD?" }, a: { es: R`<p>Distancia a la pared adimensionalizada con la escala viscosa \(\nu/u_\tau\). Para resolver la subcapa viscosa con modelos de bajo Re (k-ω SST, SA) la primera celda debe estar en \(y^+\approx1\); con funciones de pared, en la región log \(30<y^+<300\). Caer en la zona buffer (5–30) da errores en \(\tau_w\) y en la separación.</p>`, en: R`<p>Wall distance non-dimensionalised by the viscous length \(\nu/u_\tau\). To resolve the viscous sublayer with low-Re models (k-ω SST, SA) the first cell must sit at \(y^+\approx1\); with wall functions, in the log region \(30<y^+<300\). Landing in the buffer layer (5–30) gives errors in \(\tau_w\) and separation.</p>` } },
  ],
  myths: [
    { es: "«Turbulento = separado». Son cosas distintas: una capa turbulenta adherida es lo normal en un alerón de F1; la separación es flujo inverso en la pared.", en: "“Turbulent = separated”. Different things: an attached turbulent layer is normal on an F1 wing; separation is reverse flow at the wall." },
    { es: "«La turbulenta es más gruesa porque es más lenta». Es más gruesa porque la mezcla transporta el déficit de velocidad más lejos de la pared; cerca de la pared es más rápida.", en: "“The turbulent layer is thicker because it is slower”. It is thicker because mixing carries the velocity deficit further out; near the wall it is faster." },
    { es: "«La pelota de golf vuela más porque los hoyuelos reducen la fricción». Aumentan la fricción, pero reducen mucho la resistencia de presión al retrasar la separación.", en: "“Golf balls fly further because dimples reduce friction”. They increase friction but greatly reduce pressure drag by delaying separation." },
  ],
  quiz: [
    { q: { es: "¿Qué perfil tiene mayor ∂u/∂y en la pared, a igual δ?", en: "Which profile has the larger wall ∂u/∂y at equal δ?" }, options: [{ es: "laminar", en: "laminar" }, { es: "turbulento", en: "turbulent" }, { es: "igual", en: "equal" }, { es: "depende del gradiente", en: "depends on gradient" }], correct: 1, explain: { es: "El perfil turbulento lleno cae en una subcapa muy fina: pendiente mucho mayor.", en: "The full turbulent profile drops in a very thin sublayer: much steeper." } },
    { q: { es: "En la ley log, κ ≈", en: "In the log law, κ ≈" }, options: [{ es: "0.41", en: "0.41" }, { es: "5.0", en: "5.0" }, { es: "2.59", en: "2.59" }, { es: "1/7", en: "1/7" }], correct: 0, explain: { es: "Constante de von Kármán; B ≈ 5.", en: "Von Kármán constant; B ≈ 5." } },
    { q: { es: "La caída de Cd en la crisis de resistencia se debe a…", en: "The Cd drop in the drag crisis is due to…" }, options: [{ es: "menos fricción", en: "less friction" }, { es: "separación más tardía y estela más estrecha", en: "later separation and narrower wake" }, { es: "compresibilidad", en: "compressibility" }, { es: "más sustentación", en: "more lift" }], correct: 1, explain: { es: "La capa turbulenta separa más atrás → menos resistencia de presión.", en: "The turbulent layer separates further aft → less pressure drag." } },
  ],
  refs: [
    "S.B. Pope, <i>Turbulent Flows</i>, CUP, 2000, ch. 7.",
    "D. Coles, “The law of the wake in the turbulent boundary layer”, <i>JFM</i> 1 (1956).",
    "D.B. Spalding, “A single formula for the law of the wall”, <i>J. Appl. Mech.</i> 28 (1961).",
    "E. Achenbach, “Distribution of local pressure and skin friction around a circular cylinder in cross-flow up to Re = 5×10⁶”, <i>JFM</i> 34 (1968).",
  ],
};
