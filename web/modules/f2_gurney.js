import { slider, labLayout, readout, L, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { airfoilPanel } from "../js/core/airfoil_view.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function gurneyLab(host) {
  const ui = labLayout(host);
  const ap = airfoilPanel(ui.viz, { height: 240, plotHeight: 250, world: { x0: 0.55, x1: 1.15, y0: -0.12, y1: 0.12 }, particles: 900 });
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pCl = new Plot(row, { height: 230, xlabel: { es: "α [°]", en: "α [°]" }, ylabel: { es: "Cl", en: "Cl" } });
  const pLD = new Plot(row, { height: 230, xlabel: { es: "Cl", en: "Cl" }, ylabel: { es: "L/D (2D)", en: "L/D (2D)" } });
  const sH = slider({ label: { es: "Altura del Gurney h/c [%]", en: "Gurney height h/c [%]" }, min: 0, max: 5, step: 0.1, value: 2, onInput: run });
  const sA = slider({ label: { es: "α [°]", en: "α [°]" }, min: -4, max: 14, step: 0.5, value: 4, onInput: run });
  ui.controls.append(sH.el, sA.el);
  const roD = readout({ es: "ΔCl a este α", en: "ΔCl at this α" });
  const roCd = readout({ es: "ΔCd a este α", en: "ΔCd at this α" });
  const roL0 = readout({ es: "Δα_L0 aprox.", en: "approx. Δα_L0" }, "°");
  ui.readouts.append(roD.el, roCd.el, roL0.el);
  ui.note.innerHTML = L(
    "Modelo de cuerpo equivalente: el Gurney y la región separada detrás se sustituyen por una cuña cuyo vértice (nuevo punto de Kutta) queda por debajo y detrás del borde de salida real (modelo de línea de corriente divisoria). Resistencia: capa límite + resistencia de base de Hoerner del escalón. La vista está ampliada en el borde de salida: fíjate en dónde abandona el flujo el perfil.",
    "Equivalent-body model: the Gurney and the separated region behind it are replaced by a wedge whose apex (new Kutta point) lies below and behind the real trailing edge (dividing-streamline model). Drag: boundary layer + Hoerner base drag of the step. The view zooms on the trailing edge: look where the flow leaves the airfoil."
  );
  const callA = liveCall("gur-a", "airfoil.analyze", 60);
  const callP = liveCall("gur-p", "airfoil.polar", 150);
  let base = null;
  function run() {
    const spec = { code: "0012", n: 160, gurney: sH.value / 100 };
    callA({ spec, alpha: sA.value, re: 2e6, field: { x0: 0.55, x1: 1.15, y0: -0.12, y1: 0.12, nx: 90, ny: 40 } }, (r) => ap.update(r));
    const alphas = [...Array(19).keys()].map((i) => -4 + i);
    Promise.all([
      base ? Promise.resolve(base) : physics.call("airfoil.polar", { spec: { code: "0012", n: 160 }, alphas, re: 2e6 }),
    ]).then(([b]) => {
      base = b;
      callP({ spec, alphas, re: 2e6 }, (g) => {
        pCl.set([
          { x: b.alpha, y: b.cl, color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "sin Gurney", en: "no Gurney" } },
          { x: g.alpha, y: g.cl, color: cssVar("--accent"), width: 2.6, label: { es: `Gurney ${sH.value.toFixed(1)} % c`, en: `Gurney ${sH.value.toFixed(1)} % c` } },
        ], [{ type: "vline", x: sA.value, color: cssVar("--accent-2") }]);
        pLD.set([
          { x: b.cl, y: b.cl.map((c, i) => c / b.cd[i]), color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "sin Gurney", en: "no Gurney" } },
          { x: g.cl, y: g.cl.map((c, i) => c / g.cd[i]), color: cssVar("--accent-2"), width: 2.6, label: { es: "con Gurney", en: "with Gurney" } },
        ]);
        const k = alphas.indexOf(Math.round(sA.value));
        if (k >= 0) {
          roD.set("+" + (g.cl[k] - b.cl[k]).toFixed(3));
          roCd.set((g.cd[k] - b.cd[k] >= 0 ? "+" : "") + (g.cd[k] - b.cd[k]).toFixed(4));
        }
        const k0 = alphas.indexOf(0);
        roL0.set((-(g.cl[k0] - b.cl[k0]) / (2 * Math.PI * Math.PI / 180) / 1).toFixed(2));
      });
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Una pequeña placa perpendicular en el borde de salida que cambia la condición de Kutta: más carga, más curvatura efectiva y un pequeño coste en resistencia.",
    en: "A small plate normal to the trailing edge that changes the Kutta condition: more load, more effective camber and a small drag cost.",
  },
  heroParams: { eps: 0.1, camber: 0.1, alpha: 4 },
  intuition: {
    es: R`<p>El <span class="term">Gurney flap</span> (Dan Gurney, años 70, estudiado por Liebeck en 1978) es una tira perpendicular a la cuerda, de 1–2 % de la cuerda, en el borde de salida del lado de presión. Delante de ella el flujo del intradós se frena (sube la presión); detrás se forman dos pequeños vórtices contrarrotantes que hacen que el flujo del extradós salga del perfil <b>girado hacia abajo</b> (hacia el lado de presión).</p>
    <p>En términos de teoría potencial, el Gurney <b>desplaza el punto donde se cumple la condición de Kutta</b>: el flujo abandona el perfil como si este tuviera más curvatura en su borde de salida. Resultado: más circulación, \(C_l\) mayor a todo α (curva desplazada hacia arriba, \(\alpha_{L0}\) más negativo), \(C_{l,max}\) mayor y, si la altura es menor que el espesor de la capa límite, apenas penaliza en resistencia. Muy usado en alerones traseros de competición.</p>`,
    en: R`<p>The <span class="term">Gurney flap</span> (Dan Gurney, 1970s, studied by Liebeck in 1978) is a strip normal to the chord, 1–2 % of chord tall, at the trailing edge on the pressure side. Ahead of it the lower-surface flow slows (pressure rises); behind it two small counter-rotating vortices form which make the upper-surface flow leave the airfoil <b>turned downwards</b> (towards the pressure side).</p>
    <p>In potential-flow terms the Gurney <b>moves the point where the Kutta condition is satisfied</b>: the flow leaves the airfoil as if it had more trailing-edge camber. Result: more circulation, higher \(C_l\) at every α (curve shifted up, more negative \(\alpha_{L0}\)), higher \(C_{l,max}\) and, if its height is below the boundary-layer thickness, hardly any drag penalty. Widely used on racing rear wings.</p>`,
  },
  physics: {
    es: R`<p><b>Efectos medidos</b> (Liebeck 1978; Jeffrey, Zhang & Hurst 2000; Storms & Jang 1994):</p>
    <ul><li>\(\Delta C_l\approx0.2\)–0.4 para \(h/c\approx1\)–2 %; \(\Delta\alpha_{L0}\) negativo (2–4°).</li>
    <li>Aumento de la succión del extradós cerca del borde de salida y de la presión del intradós delante del Gurney: <b>carga trasera</b> (más momento de picado).</li>
    <li>La recuperación de presión en el extradós termina a un \(C_p\) más bajo (el borde de salida "descarga" a mayor velocidad, como un efecto dumping): el gradiente adverso efectivo se reduce cerca del borde de salida y el flujo aguanta más adherido → \(C_{l,max}\) mayor.</li>
    <li>Resistencia: casi nula si \(h\lesssim\delta\) (incluso puede mejorar L/D a Cl alto); crece como resistencia de base cuando \(h\gg\delta\) (estimación de Hoerner \(C_{D_b}\approx0.135\,h/(C_{D,f}/h)^{1/3}\)).</li>
    <li>Estela: calle de vórtices de von Kármán detrás del Gurney (desprendimiento periódico).</li></ul>
    <p><b>Interpretación</b>: el Gurney actúa como un flap partido de cuerda minúscula con deflexión de 90°: añade curvatura efectiva al final del perfil y fuerza el punto de Kutta hacia abajo.</p>`,
    en: R`<p><b>Measured effects</b> (Liebeck 1978; Jeffrey, Zhang & Hurst 2000; Storms & Jang 1994):</p>
    <ul><li>\(\Delta C_l\approx0.2\)–0.4 for \(h/c\approx1\)–2 %; negative \(\Delta\alpha_{L0}\) (2–4°).</li>
    <li>Higher upper-surface suction near the trailing edge and higher lower-surface pressure ahead of the Gurney: <b>aft loading</b> (more nose-down moment).</li>
    <li>Upper-surface recovery ends at a lower \(C_p\) (the trailing edge "dumps" at higher velocity, like a dumping effect): the effective adverse gradient near the trailing edge drops and the flow stays attached longer → higher \(C_{l,max}\).</li>
    <li>Drag: almost none if \(h\lesssim\delta\) (can even improve L/D at high Cl); grows like base drag when \(h\gg\delta\) (Hoerner estimate \(C_{D_b}\approx0.135\,h/(C_{D,f}/h)^{1/3}\)).</li>
    <li>Wake: von Kármán vortex street behind the Gurney (periodic shedding).</li></ul>
    <p><b>Interpretation</b>: the Gurney acts like a tiny-chord split flap at 90°: it adds effective camber at the end of the section and forces the Kutta point downwards.</p>`,
  },
  labs: [{ title: { es: "Gurney flap: Cl, polar y punto de Kutta", en: "Gurney flap: Cl, polar and Kutta point" }, desc: { es: "Compara 0 %, 1 % y 3 %: la curva se desplaza hacia arriba; la eficiencia L/D mejora a Cl alto si el Gurney es pequeño.", en: "Compare 0 %, 1 % and 3 %: the curve shifts up; L/D improves at high Cl if the Gurney is small." }, mount: gurneyLab }],
  interview: [
    { q: { es: "¿Qué es un Gurney flap y qué efecto tiene?", en: "What is a Gurney flap and what does it do?" }, a: { es: R`<p>Placa perpendicular de 1–2 % c en el borde de salida (lado de presión). Crea dos vórtices contrarrotantes detrás que desplazan la condición de Kutta: el flujo sale girado hacia el lado de presión, como con más curvatura. Aumenta circulación y Cl (desplaza la curva Cl–α hacia arriba, α_L0 más negativo), aumenta Cl,max, carga el borde de salida (Cm más negativo) y con altura pequeña (< δ) casi no penaliza en resistencia.</p>`, en: R`<p>A 1–2 % c plate normal to the trailing edge (pressure side). It creates two counter-rotating vortices behind that move the Kutta condition: the flow leaves turned towards the pressure side, as with more camber. It increases circulation and Cl (shifts the Cl–α curve up, more negative α_L0), raises Cl,max, loads the trailing edge (more negative Cm) and, if small (< δ), barely costs drag.</p>` } },
    { q: { es: "¿Por qué el Gurney apenas aumenta la resistencia si es pequeño?", en: "Why does a small Gurney barely increase drag?" }, a: { es: R`<p>Porque está sumergido en la capa límite de baja velocidad del intradós: su resistencia de base es pequeña, y a cambio permite obtener la misma sustentación con menos α o menos curvatura, reduciendo la resistencia inducida/de presión del resto. Por encima de la altura de la capa límite domina la resistencia de base.</p>`, en: R`<p>Because it sits inside the slow lower-surface boundary layer: its base drag is small, and it allows the same lift with less α or camber, reducing induced/pressure drag elsewhere. Above the boundary-layer height base drag dominates.</p>` } },
  ],
  myths: [
    { es: "«El Gurney funciona como un spoiler que frena el aire». Su efecto principal es sobre la circulación (punto de Kutta), que aumenta la succión del extradós, no solo la presión del intradós.", en: "“The Gurney works as a spoiler that blocks air”. Its main effect is on circulation (Kutta point), which raises upper-surface suction, not just lower-surface pressure." },
    { es: "«Más alto = siempre mejor». Por encima de ~2–3 % c el ΔCl satura y la resistencia de base crece rápido.", en: "“Taller = always better”. Above ~2–3 % c the ΔCl saturates and base drag grows fast." },
  ],
  quiz: [
    { q: { es: "El Gurney flap desplaza la curva Cl–α…", en: "The Gurney flap shifts the Cl–α curve…" }, options: [{ es: "hacia arriba (α_L0 más negativo)", en: "up (more negative α_L0)" }, { es: "hacia abajo", en: "down" }, { es: "no la cambia", en: "does not change it" }, { es: "solo cambia la pendiente", en: "only changes the slope" }], correct: 0, explain: { es: "Equivale a más curvatura.", en: "Equivalent to more camber." } },
    { q: { es: "Altura típica de un Gurney:", en: "Typical Gurney height:" }, options: [{ es: "0.1 % c", en: "0.1 % c" }, { es: "1–2 % c", en: "1–2 % c" }, { es: "10 % c", en: "10 % c" }, { es: "25 % c", en: "25 % c" }], correct: 1, explain: { es: "Del orden del espesor de la capa límite en el borde de salida.", en: "Of the order of the trailing-edge boundary-layer thickness." } },
  ],
  refs: [
    "R.H. Liebeck, “Design of subsonic airfoils for high lift”, <i>J. Aircraft</i> 15(9), 1978.",
    "D. Jeffrey, X. Zhang & D.W. Hurst, “Aerodynamics of Gurney flaps on a single-element high-lift wing”, <i>J. Aircraft</i> 37(2), 2000.",
    "B.L. Storms & C.S. Jang, “Lift enhancement of an airfoil using a Gurney flap and vortex generators”, <i>J. Aircraft</i> 31(3), 1994.",
    "S.F. Hoerner, <i>Fluid-Dynamic Drag</i> (base drag).",
  ],
};
