import { slider, labLayout, readout, toggle, button, L, engineBadge, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { FlowView } from "../js/core/field.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function polarLab(host) {
  const ui = labLayout(host);
  const geo = new FlowView(ui.viz, { height: 150, world: { x0: -0.25, x1: 1.35, y0: -0.25, y1: 0.25 }, particles: 0 });
  const wait = engineBadge(geo.box);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pCl = new Plot(row, { height: 260, xlabel: { es: "α [°]", en: "α [°]" }, ylabel: { es: "Cl", en: "Cl" } });
  const pCd = new Plot(row, { height: 260, xlabel: { es: "Cd", en: "Cd" }, ylabel: { es: "Cl", en: "Cl" }, xlim: [0, 0.06] });
  const pCm = new Plot(ui.viz, { height: 170, xlabel: { es: "α [°]", en: "α [°]" }, ylabel: { es: "Cm c/4 (no viscoso)", en: "Cm c/4 (inviscid)" } });
  const sM = slider({ label: { es: "Curvatura máxima m [% c]", en: "Max camber m [% c]" }, min: 0, max: 8, step: 1, value: 2, onInput: run });
  const sP = slider({ label: { es: "Posición de la curvatura p [décimas de c]", en: "Camber position p [tenths of c]" }, min: 2, max: 6, step: 1, value: 4, onInput: run });
  const sT = slider({ label: { es: "Espesor t [% c]", en: "Thickness t [% c]" }, min: 6, max: 21, step: 1, value: 12, onInput: run });
  const sF = slider({ label: { es: "Flap simple δf [°] (bisagra 75 % c)", en: "Plain flap δf [°] (hinge 75 % c)" }, min: 0, max: 30, step: 1, value: 0, onInput: run });
  const tS = toggle({ label: { es: "Slat de borde de ataque", en: "Leading-edge slat" }, value: false, onInput: run });
  const sRe = slider({ label: { es: "Reynolds", en: "Reynolds" }, min: 2e5, max: 1e7, value: 3e6, log: true, format: (v) => v.toExponential(1), onInput: run });
  let ref = null;
  const bRef = button({ es: "Fijar como referencia", en: "Set as reference" }, () => {
    ref = last;
    draw(last);
  });
  const tV = toggle({ label: { es: "Mejora: interacción viscosa-no viscosa (VII)", en: "Upgrade: viscous-inviscid interaction (VII)" }, value: false, onInput: run });
  const tD = toggle({ label: { es: "Datos publicados (NACA 0012)", en: "Published data (NACA 0012)" }, value: false, onInput: () => last && draw(last) });
  ui.controls.append(sM.el, sP.el, sT.el, sF.el, tS.el, sRe.el, tV.el, tD.el, bRef);
  let refData = null;
  physics.call("reference.data", {}).then((d) => (refData = d.naca0012));
  const roCode = readout({ es: "Perfil", en: "Airfoil" });
  const roMax = readout({ es: "Cl máx", en: "Cl max" });
  const roSt = readout({ es: "α pérdida", en: "α stall" }, "°");
  const roL0 = readout({ es: "α_L0 (perfil delgado)", en: "α_L0 (thin airfoil)" }, "°");
  const roSl = readout({ es: "dCl/dα", en: "dCl/dα" }, "/rad");
  const roCd = readout({ es: "Cd mín", en: "Cd min" });
  ui.readouts.append(roCode.el, roMax.el, roSt.el, roL0.el, roSl.el, roCd.el);
  ui.note.innerHTML = L(
    "Modelo base: paneles + capa límite integral (Thwaites → transición → Head) y un modelo de sustentación viscosa: descurvado por el espesor de desplazamiento en el borde de salida, pérdida de la carga de curvatura tras la separación y factor de Kirchhoff (ajustado a las NACA 0012/2412/4412 de Abbott & von Doenhoff: Cl,max 1.49/1.60/1.70 frente a 1.55/1.62/1.65 medidos). Con la <b>mejora VII</b> la capa límite desplaza el flujo exterior (fuentes de transpiración, como XFOIL) y la pérdida aparece por «descurvado» físico, sin factor empírico; es ~10 veces más cara (paso de 2°). Los puntos naranjas son valores publicados aproximados de la NACA 0012 (Abbott & von Doenhoff; Ladson): compáralos con «0012».",
    "Base model: panels + integral boundary layer (Thwaites → transition → Head) and a viscous lift model: decambering by the trailing-edge displacement thickness, loss of the camber loading behind separation and the Kirchhoff factor (fitted to Abbott & von Doenhoff's NACA 0012/2412/4412: Clmax 1.49/1.60/1.70 vs 1.55/1.62/1.65 measured). With the <b>VII upgrade</b> the boundary layer displaces the outer flow (transpiration sources, as in XFOIL) and stall appears through physical “decambering”, with no empirical factor; it is ~10× more expensive (2° step). Orange points are approximate published NACA 0012 values (Abbott & von Doenhoff; Ladson): compare them with “0012”."
  );
  let last = null;
  const call = liveCall("polar", "airfoil.polar", 150);
  function code() {
    const m = sM.value;
    return m === 0 ? `00${String(sT.value).padStart(2, "0")}` : `${m}${sP.value}${String(sT.value).padStart(2, "0")}`;
  }
  function spec() {
    const s = { code: code(), n: 120 };
    if (sF.value > 0) Object.assign(s, { flap_deg: sF.value, hinge: 0.75 });
    if (tS.value) s.slat = { code: "6412", chord: 0.15, gap: 0.02, overlap: 0.02, deflection: 30 };
    return s;
  }
  function run() {
    const s = spec();
    roCode.set("NACA " + s.code);
    physics.latest("polar-geo", "airfoil.analyze", { spec: s, alpha: 0, viscous: false }).then((r) => {
      if (!r) return;
      wait.remove();
      geo.setBodies(r.elements.map((e) => ({ x: e.x, y: e.y })));
    });
    physics.latest("polar-thin", "airfoil.thin", { code: s.code }).then((t) => t && roL0.set(t.alpha_L0_deg.toFixed(2)));
    call({ spec: s, alphas: [...Array(31).keys()].map((i) => -8 + i), re: sRe.value, vii: tV.value }, (r) => {
      last = r;
      draw(r);
    });
  }
  function draw(r) {
    const series = [];
    const sCd = [];
    const sCm = [];
    if (ref) {
      series.push({ x: ref.alpha, y: ref.cl, color: cssVar("--fg-dim"), dash: [4, 3], label: { es: "referencia", en: "reference" } });
      sCd.push({ x: ref.cd, y: ref.cl, color: cssVar("--fg-dim"), dash: [4, 3] });
      sCm.push({ x: ref.alpha, y: ref.cm, color: cssVar("--fg-dim"), dash: [4, 3] });
    }
    series.push({ x: r.alpha, y: r.cl_inv, color: cssVar("--accent-3"), dash: [6, 4], width: 1.5, label: { es: "no viscoso", en: "inviscid" } });
    series.push({ x: r.alpha, y: r.cl, color: cssVar("--accent"), width: 2.6, points: tV.value, label: tV.value ? { es: "viscoso con VII", en: "viscous with VII" } : { es: "viscoso (modelo base)", en: "viscous (base model)" } });
    if (tD.value && refData) series.push({ x: refData.alpha, y: refData.cl, color: cssVar("--accent-2"), pointsOnly: true, r: 4, label: { es: "NACA 0012 publicado (aprox.)", en: "published NACA 0012 (approx.)" } });
    pCl.set(series);
    sCd.push({ x: r.cd, y: r.cl, color: cssVar("--accent-2"), width: 2.4, label: { es: "polar de resistencia", en: "drag polar" } });
    pCd.set(sCd);
    sCm.push({ x: r.alpha, y: r.cm, color: cssVar("--good"), label: { es: "Cm", en: "Cm" } });
    pCm.set(sCm);
    let k = 0;
    r.cl.forEach((v, i) => (v > r.cl[k] ? (k = i) : 0));
    roMax.set(r.cl[k].toFixed(2));
    roSt.set(r.alpha[k].toFixed(0));
    const i0 = r.alpha.indexOf(0), i2 = r.alpha.indexOf(2);
    roSl.set(((r.cl_inv[i2] - r.cl_inv[i0]) / (2 * Math.PI / 180)).toFixed(2));
    roCd.set(Math.min(...r.cd).toFixed(4));
  }
  run();
}

export default {
  subtitle: {
    es: "Geometría de un perfil, teoría del perfil delgado y cómo cambian la curva Cl–α y la polar con curvatura, espesor, flap, slat y Reynolds.",
    en: "Airfoil geometry, thin-airfoil theory and how the Cl–α curve and the polar change with camber, thickness, flap, slat and Reynolds.",
  },
  heroParams: { eps: 0.12, camber: 0.06, alpha: 4 },
  intuition: {
    es: R`<p>Un perfil se describe por su <span class="term">línea media</span> (curvatura, <i>camber</i>) y su distribución de <span class="term">espesor</span>. La curvatura decide <b>cuánta sustentación hay a ángulo cero</b>; el ángulo de ataque añade sustentación de forma casi lineal con pendiente ≈ 2π por radián (≈ 0.11 por grado), y el espesor y el radio del borde de ataque deciden <b>cómo y cuándo entra en pérdida</b>.</p>
    <p>La curva \(C_l\)–\(\alpha\) tiene tres zonas: lineal (flujo adherido), redondeo (la separación del borde de salida avanza hacia delante) y pérdida (\(C_{l,max}\)). Los dispositivos hipersustentadores actúan de forma distinta: el <b>flap</b> es "más curvatura": desplaza la curva hacia arriba/izquierda (\(\alpha_{L0}\) más negativo, más \(C_{l,max}\), pérdida a un \(\alpha\) algo menor). El <b>slat</b> no cambia apenas \(\alpha_{L0}\): <b>alarga</b> la curva, retrasando la pérdida a mayor \(\alpha\) y subiendo \(C_{l,max}\).</p>`,
    en: R`<p>An airfoil is described by its <span class="term">mean line</span> (camber) and its <span class="term">thickness</span> distribution. Camber decides <b>how much lift there is at zero angle</b>; angle of attack adds lift almost linearly with slope ≈ 2π per radian (≈ 0.11 per degree), while thickness and leading-edge radius decide <b>how and when it stalls</b>.</p>
    <p>The \(C_l\)–\(\alpha\) curve has three regions: linear (attached flow), rounding (trailing-edge separation creeping forward) and stall (\(C_{l,max}\)). High-lift devices act differently: a <b>flap</b> is "more camber": it shifts the curve up/left (more negative \(\alpha_{L0}\), higher \(C_{l,max}\), stall at a slightly lower \(\alpha\)). A <b>slat</b> barely changes \(\alpha_{L0}\): it <b>extends</b> the curve, delaying stall to higher \(\alpha\) and raising \(C_{l,max}\).</p>`,
  },
  physics: {
    es: R`<p><b>Teoría del perfil delgado</b> (Glauert): la línea media se sustituye por una lámina de vórtices \(\gamma(\theta)\), \(x=\tfrac c2(1-\cos\theta)\), con la condición de tangencia y Kutta en el borde de salida. Resultados: $$C_l = 2\pi\,(\alpha-\alpha_{L0}),\qquad \alpha_{L0} = -\frac1\pi\int_0^\pi \frac{dz}{dx}(\cos\theta-1)\,d\theta$$ $$C_{m,c/4} = \frac{\pi}{4}(A_2-A_1),\qquad A_n=\frac2\pi\int_0^\pi\frac{dz}{dx}\cos n\theta\,d\theta$$</p>
    <ul><li><b>Simétrico</b>: \(\alpha_{L0}=0\), \(C_{m,c/4}=0\); el centro de presiones está en \(c/4\).</li>
    <li><b>Curvatura positiva</b>: \(\alpha_{L0}<0\) (≈ −1° por cada 1 % de curvatura), \(C_{m,c/4}<0\) (momento de picado). La pendiente no cambia.</li>
    <li><b>Espesor</b>: en flujo potencial aumenta ligeramente la pendiente (\(\approx 2\pi(1+0.77\,t/c)\)); en flujo real los perfiles de 12–15 % suelen dar el mayor \(C_{l,max}\) y una pérdida suave de borde de salida. Perfiles finos (&lt; 9 %) tienden a pérdida de borde de ataque o de "perfil delgado" (burbuja laminar que estalla).</li>
    <li><b>Flap simple de cuerda \(E c\) y deflexión \(\delta\)</b>: la teoría del perfil delgado da \(\Delta C_l = C_{l_\delta}\,\delta\) con \(C_{l_\delta}=2\left[\sqrt{E(1-E)}+\arccos(1-2E)\right]\) (eficacia reducida en flujo real por separación sobre el flap a grandes \(\delta\)).</li>
    <li><b>Reynolds</b>: más \(Re\) → capa límite más delgada y resistente a la separación → mayor \(C_{l,max}\), menor \(C_d\).</li></ul>
    <p><b>Polar de resistencia</b>: \(C_d(C_l)\) tiene un mínimo cerca de \(C_l\) de diseño; crece suavemente (fricción + presión) y se dispara cuando separa.</p>`,
    en: R`<p><b>Thin-airfoil theory</b> (Glauert): the mean line is replaced by a vortex sheet \(\gamma(\theta)\), \(x=\tfrac c2(1-\cos\theta)\), with flow tangency and Kutta at the trailing edge. Results: $$C_l = 2\pi\,(\alpha-\alpha_{L0}),\qquad \alpha_{L0} = -\frac1\pi\int_0^\pi \frac{dz}{dx}(\cos\theta-1)\,d\theta$$ $$C_{m,c/4} = \frac{\pi}{4}(A_2-A_1),\qquad A_n=\frac2\pi\int_0^\pi\frac{dz}{dx}\cos n\theta\,d\theta$$</p>
    <ul><li><b>Symmetric</b>: \(\alpha_{L0}=0\), \(C_{m,c/4}=0\); the centre of pressure sits at \(c/4\).</li>
    <li><b>Positive camber</b>: \(\alpha_{L0}<0\) (≈ −1° per 1 % camber), \(C_{m,c/4}<0\) (nose-down). The slope does not change.</li>
    <li><b>Thickness</b>: in potential flow it slightly raises the slope (\(\approx 2\pi(1+0.77\,t/c)\)); in real flow 12–15 % sections usually give the highest \(C_{l,max}\) with gentle trailing-edge stall. Thin sections (&lt; 9 %) tend to leading-edge or "thin-airfoil" stall (bursting laminar bubble).</li>
    <li><b>Plain flap of chord \(E c\), deflection \(\delta\)</b>: thin-airfoil theory gives \(\Delta C_l = C_{l_\delta}\,\delta\) with \(C_{l_\delta}=2\left[\sqrt{E(1-E)}+\arccos(1-2E)\right]\) (reduced in real flow by separation on the flap at large \(\delta\)).</li>
    <li><b>Reynolds</b>: higher \(Re\) → thinner, separation-resistant boundary layer → higher \(C_{l,max}\), lower \(C_d\).</li></ul>
    <p><b>Drag polar</b>: \(C_d(C_l)\) has a minimum near the design \(C_l\); it grows gently (friction + pressure) and shoots up when the flow separates.</p>`,
  },
  labs: [
    { title: { es: "Generador de polares NACA con flap y slat", en: "NACA polar generator with flap and slat" }, desc: { es: "Fija una referencia y cambia una sola cosa cada vez: curvatura, espesor, flap, slat o Reynolds. Compara la forma de las curvas.", en: "Set a reference and change one thing at a time: camber, thickness, flap, slat or Reynolds. Compare the curve shapes." }, mount: polarLab },
  ],
  interview: [
    { q: { es: "Dibuja la curva Cl–α de un perfil simétrico y de uno con curvatura.", en: "Sketch the Cl–α curve of a symmetric and a cambered airfoil." }, a: { es: R`<p>Simétrico: recta que pasa por el origen con pendiente ≈ 0.11/°, redondeo y \(C_{l,max}\) (~1.5 para 12 % a Re alto). Con curvatura: misma pendiente, desplazada a la izquierda (\(\alpha_{L0}<0\)), \(C_l>0\) a \(\alpha=0\), \(C_{l,max}\) algo mayor y la pérdida a un \(\alpha\) parecido o algo menor.</p>`, en: R`<p>Symmetric: straight line through the origin, slope ≈ 0.11/°, rounding and \(C_{l,max}\) (~1.5 for 12 % at high Re). Cambered: same slope shifted left (\(\alpha_{L0}<0\)), \(C_l>0\) at \(\alpha=0\), slightly higher \(C_{l,max}\), stall at a similar or slightly lower \(\alpha\).</p>` } },
    { q: { es: "¿Qué le pasa a la curva al meter un flap? ¿Y un slat?", en: "What happens to the curve with a flap? And with a slat?" }, a: { es: R`<p><b>Flap</b>: aumenta la curvatura efectiva → curva desplazada hacia arriba (\(\Delta\alpha_{L0}\) negativo), \(C_{l,max}\) mayor, \(\alpha_{stall}\) ligeramente menor; pendiente igual (o algo mayor si el flap extiende la cuerda: Fowler). <b>Slat</b>: reduce el pico de succión del borde de ataque del principal → la pérdida se retrasa → curva más larga, \(\alpha_{stall}\) y \(C_{l,max}\) mayores, \(\alpha_{L0}\) casi igual.</p>`, en: R`<p><b>Flap</b>: increases effective camber → curve shifted up (negative \(\Delta\alpha_{L0}\)), higher \(C_{l,max}\), slightly lower \(\alpha_{stall}\); same slope (or slightly higher if it extends the chord: Fowler). <b>Slat</b>: lowers the main element's leading-edge suction peak → stall delayed → longer curve, higher \(\alpha_{stall}\) and \(C_{l,max}\), almost unchanged \(\alpha_{L0}\).</p>` } },
    { q: { es: "¿Por qué el centro aerodinámico está en c/4?", en: "Why is the aerodynamic centre at c/4?" }, a: { es: R`<p>En la teoría del perfil delgado, el momento respecto a \(c/4\) solo depende de \(A_1,A_2\) (geometría de la línea media) y no del ángulo de ataque: es el punto donde \(dC_m/d\alpha=0\). El centro de presiones, en cambio, se mueve con \(\alpha\) en un perfil curvado (hacia atrás a bajo \(C_l\)).</p>`, en: R`<p>In thin-airfoil theory the moment about \(c/4\) depends only on \(A_1,A_2\) (mean-line geometry), not on angle of attack: it is where \(dC_m/d\alpha=0\). The centre of pressure instead moves with \(\alpha\) on a cambered section (aft at low \(C_l\)).</p>` } },
    { q: { es: "Tipos de entrada en pérdida.", en: "Types of stall." }, a: { es: R`<p><b>Borde de salida</b> (perfiles gruesos, 12 %+): la separación avanza desde el borde de salida, pérdida suave. <b>Borde de ataque</b> (espesor moderado, radio pequeño): la burbuja laminar cerca del borde de ataque estalla y separa todo el extradós de golpe. <b>Perfil delgado</b>: la burbuja crece progresivamente hacia atrás. En la práctica hay mezclas que dependen de Re.</p>`, en: R`<p><b>Trailing-edge</b> (thick sections, 12 %+): separation creeps forward from the trailing edge, gentle stall. <b>Leading-edge</b> (moderate thickness, small radius): the laminar bubble near the leading edge bursts and the whole upper surface separates suddenly. <b>Thin-airfoil</b>: the bubble grows progressively aft. Real sections show mixes depending on Re.</p>` } },
  ],
  myths: [
    { es: "«La curvatura aumenta la pendiente de sustentación». No: desplaza la curva (α_L0), la pendiente es ≈ 2π para cualquier perfil delgado.", en: "“Camber increases the lift slope”. No: it shifts the curve (α_L0); the slope is ≈ 2π for any thin airfoil." },
    { es: "«Un flap retrasa la pérdida». Un flap aumenta Cl a cada α pero suele adelantar ligeramente el α de pérdida; quien la retrasa es el slat.", en: "“A flap delays stall”. A flap raises Cl at each α but usually slightly lowers the stall angle; the slat is the one that delays it." },
    { es: "«Más espesor siempre es peor». Un poco de espesor (radio de borde de ataque) reduce el pico de succión y mejora la pérdida; demasiado añade resistencia de presión.", en: "“More thickness is always worse”. Some thickness (leading-edge radius) lowers the suction peak and improves stall; too much adds pressure drag." },
  ],
  quiz: [
    { q: { es: "NACA 2412: ¿qué significa cada cifra?", en: "NACA 2412: what does each digit mean?" }, options: [{ es: "2 % curvatura, en 40 % c, 12 % espesor", en: "2 % camber at 40 % c, 12 % thickness" }, { es: "24 % espesor, 12 % curvatura", en: "24 % thickness, 12 % camber" }, { es: "2° de incidencia, 4 % flap, 12 % espesor", en: "2° incidence, 4 % flap, 12 % thickness" }, { es: "Cl de diseño 0.24", en: "design Cl 0.24" }], correct: 0, explain: { es: "m = 2 %, p = 4/10, t = 12 %.", en: "m = 2 %, p = 4/10, t = 12 %." } },
    { q: { es: "Un perfil simétrico a α = 0 tiene…", en: "A symmetric airfoil at α = 0 has…" }, options: [{ es: "Cl > 0", en: "Cl > 0" }, { es: "Cl = 0 y Cm,c/4 = 0", en: "Cl = 0 and Cm,c/4 = 0" }, { es: "Cm < 0", en: "Cm < 0" }, { es: "separación total", en: "full separation" }], correct: 1, explain: { es: "Por simetría.", en: "By symmetry." } },
    { q: { es: "La pendiente de la curva Cl–α según la teoría del perfil delgado es…", en: "The Cl–α slope from thin-airfoil theory is…" }, options: [{ es: "π/rad", en: "π/rad" }, { es: "2π/rad ≈ 0.11/°", en: "2π/rad ≈ 0.11/°" }, { es: "4π/rad", en: "4π/rad" }, { es: "depende de la curvatura", en: "depends on camber" }], correct: 1, explain: { es: "Independiente de la forma de la línea media.", en: "Independent of the mean-line shape." } },
    { q: { es: "¿Qué dispositivo aumenta principalmente el α de pérdida?", en: "Which device mainly increases the stall angle?" }, options: [{ es: "Flap simple", en: "Plain flap" }, { es: "Slat", en: "Slat" }, { es: "Gurney flap", en: "Gurney flap" }, { es: "Aumentar curvatura", en: "More camber" }], correct: 1, explain: { es: "El slat suaviza el pico de succión del borde de ataque del principal (efecto slat de Smith).", en: "The slat softens the main element's leading-edge suction peak (Smith's slat effect)." } },
  ],
  refs: [
    "I.H. Abbott & A.E. von Doenhoff, <i>Theory of Wing Sections</i>, Dover, 1959.",
    "J.D. Anderson, <i>Fundamentals of Aerodynamics</i>, ch. 4 (thin-airfoil theory).",
    "M. Drela, “XFOIL: An analysis and design system for low Reynolds number airfoils”, 1989.",
    "D. McLean, <i>Understanding Aerodynamics</i>, ch. 7–8 (stall types).",
  ],
};
