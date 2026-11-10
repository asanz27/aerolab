import { slider, labLayout, readout, L, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function mcritLab(host) {
  const ui = labLayout(host);
  const plot = new Plot(ui.viz, { height: 300, xlabel: { es: "Mach de vuelo M∞", en: "Free-stream Mach M∞" }, ylabel: { es: "Cp", en: "Cp" }, invertY: true, ylim: [-6, 0.2], xlim: [0.05, 0.9] });
  const sA = slider({ label: { es: "α [°]", en: "α [°]" }, min: 0, max: 10, step: 0.5, value: 4, onInput: run });
  const sT = slider({ label: { es: "Espesor NACA 00xx [%]", en: "NACA 00xx thickness [%]" }, min: 6, max: 21, step: 1, value: 12, onInput: run });
  ui.controls.append(sA.el, sT.el);
  const roC = readout({ es: "Cp,mín incompresible", en: "Incompressible Cp,min" });
  const roM = readout({ es: "M crítico (Kármán-Tsien)", en: "Critical M (Kármán-Tsien)" });
  const roP = readout({ es: "M crítico (Prandtl-Glauert)", en: "Critical M (Prandtl-Glauert)" });
  ui.readouts.append(roC.el, roM.el, roP.el);
  ui.note.innerHTML = L(
    "El Cp mínimo incompresible sale del método de paneles; se corrige con Prandtl-Glauert y Kármán-Tsien. Donde la curva corregida corta a Cp* (flujo local sónico) está el Mach crítico.",
    "The incompressible minimum Cp comes from the panel method; it is corrected with Prandtl-Glauert and Kármán-Tsien. Where the corrected curve meets Cp* (locally sonic flow) is the critical Mach number."
  );
  const call = liveCall("mcrit", "compressible.section", 60);
  function run() {
    call({ code: "00" + String(sT.value).padStart(2, "0"), alpha: sA.value }, (r) => {
      const mk = [];
      if (r.M_crit_kt) mk.push({ type: "vline", x: r.M_crit_kt, color: cssVar("--bad"), label: { es: "M crít.", en: "M crit." } });
      plot.set([
        { x: r.M, y: r.cp_star, color: cssVar("--accent-2"), width: 2.6, label: { es: "Cp* (sónico local)", en: "Cp* (local sonic)" } },
        { x: r.M, y: r.cp_pg, color: cssVar("--accent-3"), dash: [5, 4], label: { es: "Cp,mín Prandtl-Glauert", en: "Cp,min Prandtl-Glauert" } },
        { x: r.M, y: r.cp_kt, color: cssVar("--accent"), width: 2.6, label: { es: "Cp,mín Kármán-Tsien", en: "Cp,min Kármán-Tsien" } },
      ], mk);
      roC.set(r.cp0_min.toFixed(2));
      roM.set(r.M_crit_kt ? r.M_crit_kt.toFixed(3) : "–");
      roP.set(r.M_crit_pg ? r.M_crit_pg.toFixed(3) : "–");
    });
  }
  run();
}

function f1Lab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pM = new Plot(row, { height: 250, xlabel: { es: "velocidad [m/s]", en: "speed [m/s]" }, ylabel: { es: "Mach local", en: "local Mach" }, ylim: [0, 1] });
  const pE = new Plot(row, { height: 250, xlabel: { es: "velocidad [m/s]", en: "speed [m/s]" }, ylabel: { es: "error si se supone incompresible [%]", en: "error assuming incompressible [%]" } });
  const sV = slider({ label: { es: "Velocidad [m/s]", en: "Speed [m/s]" }, min: 20, max: 100, step: 1, value: 90, onInput: run });
  const sF = slider({ label: { es: "Cp en la garganta del suelo", en: "Floor throat Cp" }, min: -6, max: -1, step: 0.1, value: -4, onInput: run });
  const sW = slider({ label: { es: "Pico de succión del alerón", en: "Wing suction peak" }, min: -10, max: -2, step: 0.1, value: -6, onInput: run });
  ui.controls.append(sV.el, sF.el, sW.el);
  const roM = readout({ es: "M∞", en: "M∞" });
  const roR = readout({ es: "Cambio de densidad en remanso", en: "Density change at stagnation" }, "%");
  const roF = readout({ es: "M local en el suelo", en: "Local M under the floor" });
  const roW = readout({ es: "M local en el pico del alerón", en: "Local M at the wing peak" });
  ui.readouts.append(roM.el, roR.el, roF.el, roW.el);
  ui.note.innerHTML = L(
    "Un F1 vuela a M∞ < 0.3, pero el aire acelerado bajo el suelo o en el pico de succión de un alerón muy cargado alcanza Mach locales de 0.5–0.8: por eso los códigos de CFD de F1 suelen resolver flujo compresible.",
    "An F1 car runs at M∞ < 0.3, but the air accelerated under the floor or at the suction peak of a heavily loaded wing reaches local Mach numbers of 0.5–0.8: that is why F1 CFD codes usually solve compressible flow."
  );
  const call = liveCall("f1c", "compressible.f1", 40);
  function run() {
    call({ V: sV.value, cp_floor: sF.value, cp_wing: sW.value }, (r) => {
      pM.set([
        { x: r.V, y: r.M_floor_curve, color: cssVar("--accent"), width: 2.6, label: { es: "garganta del suelo", en: "floor throat" } },
        { x: r.V, y: r.M_wing_curve, color: cssVar("--accent-2"), width: 2.6, label: { es: "pico del alerón", en: "wing peak" } },
        { x: r.V, y: r.V.map((v) => v / 340.3), color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "M∞", en: "M∞" } },
      ], [{ type: "vline", x: sV.value, color: cssVar("--fg-muted") }]);
      pE.set([{ x: r.V, y: r.pg_error_pct, color: cssVar("--accent-3"), width: 2.4, label: { es: "factor Prandtl-Glauert − 1", en: "Prandtl-Glauert factor − 1" } }]);
      roM.set(r.M_inf.toFixed(3));
      roR.set(r.density_change_pct.toFixed(1));
      roF.set(r.M_floor.toFixed(2), r.M_floor > 0.5 ? "warn" : "");
      roW.set(r.M_wing.toFixed(2), r.M_wing > 0.7 ? "bad" : "");
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Cuándo deja de valer la hipótesis incompresible: reglas de semejanza, Mach crítico y por qué en F1 el Mach local importa aunque el coche vaya a M < 0.3.",
    en: "When the incompressible assumption fails: similarity rules, critical Mach and why local Mach matters in F1 even though the car runs at M < 0.3.",
  },
  heroParams: { eps: 0.08, camber: 0.02, alpha: 3 },
  intuition: {
    es: R`<p>La regla habitual es que por debajo de M ≈ 0.3 la densidad cambia menos del ~5 % y el flujo puede tratarse como incompresible. Un F1 a 330 km/h va a M ≈ 0.27: en la corriente libre, la aproximación es buena. Pero la compresibilidad depende de la velocidad <b>local</b>: bajo el suelo el aire va 2–2.5 veces más rápido (Cp ≈ −4) y en el pico de succión de un alerón muy cargado todavía más, así que se alcanzan Mach locales de 0.6–0.8.</p>
    <p>A medida que M∞ sube, los picos de succión se hacen más intensos (las "reglas de semejanza" de Prandtl-Glauert y Kármán-Tsien). Cuando el pico alcanza la velocidad del sonido se ha llegado al <span class="term">Mach crítico</span>: por encima aparecen bolsas supersónicas y choques, y la resistencia sube bruscamente (divergencia de resistencia).</p>`,
    en: R`<p>The usual rule is that below M ≈ 0.3 density changes by less than ~5 % and the flow can be treated as incompressible. An F1 car at 330 km/h runs at M ≈ 0.27: in the free stream the approximation is good. But compressibility depends on the <b>local</b> velocity: under the floor the air travels 2–2.5 times faster (Cp ≈ −4) and at the suction peak of a heavily loaded wing even more, so local Mach numbers of 0.6–0.8 are reached.</p>
    <p>As M∞ rises, suction peaks become stronger (the Prandtl-Glauert and Kármán-Tsien "similarity rules"). When the peak reaches the speed of sound the <span class="term">critical Mach number</span> is reached: beyond it supersonic pockets and shocks appear and drag rises sharply (drag divergence).</p>`,
  },
  physics: {
    es: R`<p><b>Cambio de densidad</b>: \(\rho_0/\rho=(1+\frac{\gamma-1}{2}M^2)^{1/(\gamma-1)}\approx1+M^2/2\).</p>
    <p><b>Prandtl-Glauert</b> (flujo potencial linealizado): \(C_p=\dfrac{C_{p,0}}{\sqrt{1-M_\infty^2}}\). <b>Kármán-Tsien</b>: \(C_p=\dfrac{C_{p,0}}{\beta+\frac{M_\infty^2}{1+\beta}\frac{C_{p,0}}{2}}\), más precisa en picos fuertes.</p>
    <p><b>Cp crítico</b> (sónico local): $$C_p^*=\frac{2}{\gamma M_\infty^2}\left[\left(\frac{2+(\gamma-1)M_\infty^2}{\gamma+1}\right)^{\frac{\gamma}{\gamma-1}}-1\right]$$ \(M_{crit}\): intersección de \(C_{p,min}(M_\infty)\) con \(C_p^*(M_\infty)\). Perfiles más finos y menos cargados → \(M_{crit}\) mayor.</p>
    <p><b>Mach local</b> en una zona de coeficiente \(C_p\): \(p/p_0=(p_\infty/p_0)(1+\tfrac{\gamma}{2}M_\infty^2C_p)\) y de ahí \(M\) isentrópico.</p>`,
    en: R`<p><b>Density change</b>: \(\rho_0/\rho=(1+\frac{\gamma-1}{2}M^2)^{1/(\gamma-1)}\approx1+M^2/2\).</p>
    <p><b>Prandtl-Glauert</b> (linearised potential flow): \(C_p=\dfrac{C_{p,0}}{\sqrt{1-M_\infty^2}}\). <b>Kármán-Tsien</b>: \(C_p=\dfrac{C_{p,0}}{\beta+\frac{M_\infty^2}{1+\beta}\frac{C_{p,0}}{2}}\), more accurate for strong peaks.</p>
    <p><b>Critical Cp</b> (local sonic): $$C_p^*=\frac{2}{\gamma M_\infty^2}\left[\left(\frac{2+(\gamma-1)M_\infty^2}{\gamma+1}\right)^{\frac{\gamma}{\gamma-1}}-1\right]$$ \(M_{crit}\): intersection of \(C_{p,min}(M_\infty)\) with \(C_p^*(M_\infty)\). Thinner, less loaded sections → higher \(M_{crit}\).</p>
    <p><b>Local Mach</b> in a region of coefficient \(C_p\): \(p/p_0=(p_\infty/p_0)(1+\tfrac{\gamma}{2}M_\infty^2C_p)\), then isentropic \(M\).</p>`,
  },
  labs: [
    { title: { es: "Mach crítico de un perfil", en: "Critical Mach number of an airfoil" }, mount: mcritLab },
    { title: { es: "¿Es incompresible un F1?", en: "Is an F1 car incompressible?" }, mount: f1Lab },
  ],
  interview: [
    { q: { es: "¿Por qué en F1 se trata el flujo como incompresible? ¿Siempre es correcto?", en: "Why is F1 flow treated as incompressible? Is it always right?" }, a: { es: R`<p>Porque M∞ ≲ 0.3 y la densidad cambia menos de un ~5 %. Pero los Mach locales bajo el suelo o en picos de succión pueden llegar a 0.6–0.8, y entonces los efectos de compresibilidad sobre los picos (y la carga) son de varios por ciento; por eso el CFD de F1 suele ser compresible o con corrección, y en túnel (a escala y menor velocidad) hay que tenerlo en cuenta en la correlación.</p>`, en: R`<p>Because M∞ ≲ 0.3 and density changes by less than ~5 %. But local Mach numbers under the floor or at suction peaks can reach 0.6–0.8, and then compressibility affects peaks (and downforce) by several per cent; that is why F1 CFD is usually compressible or corrected, and tunnel correlation (smaller scale, lower speed) must account for it.</p>` } },
    { q: { es: "¿Qué es el Mach crítico?", en: "What is the critical Mach number?" }, a: { es: R`<p>El Mach de vuelo al que el punto de máxima velocidad del cuerpo alcanza M = 1. Por encima aparecen zonas supersónicas terminadas en choques y la resistencia aumenta rápidamente (divergencia de resistencia).</p>`, en: R`<p>The flight Mach number at which the point of maximum velocity on the body reaches M = 1. Above it supersonic regions terminated by shocks appear and drag rises quickly (drag divergence).</p>` } },
  ],
  myths: [
    { es: "«Por debajo de M = 0.3 la compresibilidad no existe». Existe, es pequeña en la corriente libre; los picos locales pueden ser muy compresibles.", en: "“Below M = 0.3 compressibility does not exist”. It exists, small in the free stream; local peaks can be strongly compressible." },
  ],
  quiz: [
    { q: { es: "Con Prandtl-Glauert, a M∞ = 0.6 el Cp se multiplica por…", en: "With Prandtl-Glauert at M∞ = 0.6 Cp is multiplied by…" }, options: [{ es: "1.00", en: "1.00" }, { es: "1.25", en: "1.25" }, { es: "1.67", en: "1.67" }, { es: "0.8", en: "0.8" }], correct: 1, explain: { es: "1/√(1 − 0.36) = 1.25.", en: "1/√(1 − 0.36) = 1.25." } },
    { q: { es: "Un perfil más grueso tiene un M crítico…", en: "A thicker airfoil has a critical Mach…" }, options: [{ es: "mayor", en: "higher" }, { es: "menor", en: "lower" }, { es: "igual", en: "equal" }, { es: "infinito", en: "infinite" }], correct: 1, explain: { es: "Su pico de succión es más intenso.", en: "Its suction peak is stronger." } },
  ],
  refs: [
    "J.D. Anderson, <i>Modern Compressible Flow</i>, ch. 9 & 11.",
    "J.D. Anderson, <i>Fundamentals of Aerodynamics</i>, ch. 11 (subsonic compressible flow over airfoils).",
  ],
};
