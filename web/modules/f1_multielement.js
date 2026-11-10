import { slider, labLayout, readout, toggle, segmented, L, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { airfoilPanel, splitSurfaces } from "../js/core/airfoil_view.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function smithLab(host) {
  const ui = labLayout(host);
  const ap = airfoilPanel(ui.viz, { height: 280, plotHeight: 280, world: { x0: -0.35, x1: 1.45, y0: -0.55, y1: 0.4 }, cpRange: null });
  const sA = slider({ label: { es: "α [°]", en: "α [°]" }, min: -4, max: 16, step: 0.5, value: 8, onInput: run });
  const tS = toggle({ label: { es: "Slat", en: "Slat" }, value: true, onInput: run });
  const sSd = slider({ label: { es: "Deflexión del slat [°]", en: "Slat deflection [°]" }, min: 10, max: 45, step: 1, value: 30, onInput: run });
  const sSg = slider({ label: { es: "Gap del slat [% c]", en: "Slat gap [% c]" }, min: 0.5, max: 5, step: 0.1, value: 2, onInput: run });
  const tF = toggle({ label: { es: "Flap", en: "Flap" }, value: true, onInput: run });
  const sFd = slider({ label: { es: "Deflexión del flap [°]", en: "Flap deflection [°]" }, min: 0, max: 45, step: 1, value: 25, onInput: run });
  const sFg = slider({ label: { es: "Gap del flap [% c]", en: "Flap gap [% c]" }, min: 0.5, max: 5, step: 0.1, value: 1.5, onInput: run });
  const sFo = slider({ label: { es: "Overlap del flap [% c]", en: "Flap overlap [% c]" }, min: -2, max: 6, step: 0.2, value: 2, onInput: run });
  const sCmp = segmented({ label: { es: "Comparar con", en: "Compare with" }, value: "main", onInput: () => last && draw(last), options: [{ value: "main", label: { es: "Principal solo", en: "Main alone" } }, { value: "none", label: { es: "Nada", en: "Nothing" } }] });
  ui.controls.append(sA.el, tS.el, sSd.el, sSg.el, tF.el, sFd.el, sFg.el, sFo.el, sCmp.el);
  const roCl = readout({ es: "Cl total (viscoso est.)", en: "total Cl (visc. est.)" });
  const roMain = readout({ es: "Cl del principal", en: "main-element Cl" });
  const roMain0 = readout({ es: "Cl principal solo", en: "main alone Cl" });
  const roPk = readout({ es: "Pico Cp principal / solo", en: "main Cp peak / alone" });
  const roTe = readout({ es: "Cp BS del principal / solo", en: "main TE Cp / alone" });
  const roW = readout({ es: "Avisos", en: "Warnings" });
  ui.readouts.append(roCl.el, roMain.el, roMain0.el, roPk.el, roTe.el, roW.el);
  ui.note.innerHTML = L(
    "Método de paneles multielemento (Kutta en cada elemento) + capa límite en cada elemento (capa límite «fresca»). La curva gris discontinua es el principal aislado al mismo α: compara su pico de succión (efecto slat) y su Cp en el borde de salida (efecto dumping / circulación).",
    "Multi-element panel method (Kutta on each element) + boundary layer on each element (“fresh” boundary layer). The dashed grey curve is the main element alone at the same α: compare its suction peak (slat effect) and its trailing-edge Cp (dumping / circulation effect)."
  );
  let last = null;
  const call = liveCall("smith", "airfoil.smith", 120);
  function spec() {
    const s = { code: "4412", n: 140 };
    if (tS.value) s.slat = { code: "6412", chord: 0.15, gap: sSg.value / 100, overlap: 0.02, deflection: sSd.value };
    if (tF.value) s.flap = { code: "4412", chord: 0.3, gap: sFg.value / 100, overlap: sFo.value / 100, deflection: sFd.value };
    return s;
  }
  function run() {
    call({ spec: spec(), alpha: sA.value, re: 3e6 }, (r) => {
      last = r;
      draw(r);
    });
  }
  function draw(r) {
    const full = r.full;
    full.field = null;
    ap.setCompare(sCmp.value === "main" ? r.main_alone : null, { es: "principal solo", en: "main alone" });
    ap.update(full, { gradients: false });
    const m = full.elements.find((e) => e.name === "main");
    const m0 = r.main_alone.elements[0];
    const pk = (e) => Math.min(...e.cp);
    const te = (e) => 0.5 * (e.cp[0] + e.cp[e.cp.length - 1]);
    roCl.set(full.cl.toFixed(2));
    roMain.set(m.cl.toFixed(2));
    roMain0.set(m0.cl.toFixed(2));
    roPk.set(`${pk(m).toFixed(1)} / ${pk(m0).toFixed(1)}`);
    roTe.set(`${te(m).toFixed(2)} / ${te(m0).toFixed(2)}`);
    const warn = [];
    if (full.intersect) warn.push(L("elementos solapados", "overlapping elements"));
    for (const e of full.elements) if (e.bl && e.bl[e.suction].x_sep != null && e.bl[e.suction].x_sep < Math.max(...e.x) - 0.1 * (Math.max(...e.x) - Math.min(...e.x))) warn.push(L(`${e.name}: separado`, `${e.name}: separated`));
    roW.set(warn.length ? warn.join(", ") : "OK", warn.length ? "warn" : "good");
  }
  run();
}

export default {
  subtitle: {
    es: "Slats y flaps sobre la distribución de presiones: los cinco efectos de A.M.O. Smith (1975) y por qué el hueco NO «sopla energía».",
    en: "Slats and flaps on the pressure distribution: A.M.O. Smith's (1975) five effects and why the slot does NOT “blow energy”.",
  },
  heroParams: { eps: 0.1, camber: 0.14, alpha: 6 },
  intuition: {
    es: R`<p>Un perfil único está limitado por cuánto gradiente adverso puede aguantar su capa límite en la recuperación. Dividirlo en varios elementos con huecos (<i>slots</i>) permite generar mucha más sustentación (o carga, en un alerón de F1 de dos o tres elementos) porque <b>cada elemento ayuda al otro a través del campo de velocidades que induce</b>, no porque el hueco "inyecte aire de alta energía".</p>
    <p>El elemento delantero (o el slat) <b>reduce el pico de succión</b> del siguiente; el trasero (el flap) <b>aumenta la circulación</b> del anterior y le permite descargar su capa límite a alta velocidad; la estela del delantero termina su recuperación de presión lejos de la pared; y cada elemento empieza con una <b>capa límite nueva y delgada</b>. Son los cinco efectos que A.M.O. Smith identificó en su clásico <i>High-Lift Aerodynamics</i>.</p>`,
    en: R`<p>A single airfoil is limited by how much adverse gradient its boundary layer can withstand during recovery. Splitting it into several elements with slots produces much more lift (or downforce, on a two- or three-element F1 wing) because <b>each element helps the other through the velocity field it induces</b>, not because the slot "injects high-energy air".</p>
    <p>The forward element (or slat) <b>lowers the suction peak</b> of the next one; the aft element (flap) <b>raises the circulation</b> of the one ahead and lets it discharge its boundary layer at high velocity; the forward element's wake completes its pressure recovery away from the wall; and each element starts with a <b>new, thin boundary layer</b>. These are the five effects identified by A.M.O. Smith in his classic <i>High-Lift Aerodynamics</i>.</p>`,
  },
  physics: {
    es: R`<ol>
    <li><b>Efecto slat</b>: la circulación del elemento delantero induce, en el borde de ataque del siguiente, una velocidad que se opone a la local → <b>reduce el pico de succión</b> del elemento trasero y con él la severidad de su recuperación. (El slat "hace sombra" al borde de ataque del principal.)</li>
    <li><b>Efecto circulación</b>: el elemento trasero coloca el borde de salida del delantero en una zona de alta velocidad (su upwash/succión). Para cumplir Kutta a mayor velocidad, la <b>circulación del delantero aumenta</b>: más carga en el principal gracias al flap.</li>
    <li><b>Efecto dumping</b>: como el borde de salida del delantero está en una zona de velocidad \(>V_\infty\) (\(C_{p,TE}<0\)), su capa límite "descarga" a alta velocidad: la recuperación de presión que tiene que hacer es <b>menor</b>, menos riesgo de separación y se puede subir más el pico.</li>
    <li><b>Recuperación fuera de la superficie</b>: la estela del delantero sigue desacelerándose aguas abajo <b>lejos de la pared</b> (sobre el flap), donde decelerar es más eficiente que en contacto con una superficie.</li>
    <li><b>Capa límite fresca</b>: cada elemento empieza con su propia capa límite, delgada (\(\theta\) pequeño), capaz de soportar un gradiente adverso fuerte; un perfil único arrastraría una capa límite gruesa y "cansada".</li></ol>
    <p><b>Mito del slot</b>: la velocidad en el hueco no es mayor por "soplar" energía; la presión total del aire del hueco es la de la corriente libre. Lo que cuentan son las interacciones de circulación anteriores (Smith lo deja explícito).</p>
    <p><b>Gap y overlap</b>: hay un óptimo (típicamente gap 1–3 % c). Gap muy pequeño: las capas límite y la estela del delantero se fusionan con la del trasero (confluencia) y el flap separa; gap muy grande: se pierde la interacción y el flap "va por libre".</p>`,
    en: R`<ol>
    <li><b>Slat effect</b>: the forward element's circulation induces, at the next element's leading edge, a velocity opposing the local one → it <b>lowers the suction peak</b> of the aft element and the severity of its recovery. (The slat "shields" the main element's leading edge.)</li>
    <li><b>Circulation effect</b>: the aft element puts the trailing edge of the forward one in a high-velocity region (its upwash/suction). To satisfy Kutta at that higher velocity, the <b>forward element's circulation increases</b>: more load on the main thanks to the flap.</li>
    <li><b>Dumping effect</b>: since the forward element's trailing edge sits where velocity \(>V_\infty\) (\(C_{p,TE}<0\)), its boundary layer "dumps" at high velocity: the pressure recovery it needs is <b>smaller</b>, less risk of separation, and the peak can be raised further.</li>
    <li><b>Off-the-surface pressure recovery</b>: the forward element's wake keeps decelerating downstream <b>away from the wall</b> (over the flap), where deceleration is more efficient than in contact with a surface.</li>
    <li><b>Fresh boundary layer</b>: each element starts with its own thin boundary layer (small \(\theta\)), able to withstand a strong adverse gradient; a single airfoil would carry a thick, "tired" boundary layer.</li></ol>
    <p><b>Slot myth</b>: slot velocity is not higher because energy is "blown"; the slot air has free-stream total pressure. What matters are the circulation interactions above (Smith is explicit about this).</p>
    <p><b>Gap and overlap</b>: there is an optimum (typically 1–3 % c gap). Too small: the forward element's boundary layer/wake merges with the aft one (confluence) and the flap separates; too large: the interaction is lost and the flap "works alone".</p>`,
  },
  labs: [{ title: { es: "Perfil de tres elementos: los cinco efectos en el Cp", en: "Three-element airfoil: the five effects on Cp" }, desc: { es: "Quita y pon el slat mirando el pico del principal (efecto slat). Quita y pon el flap mirando el Cl del principal y su Cp en el borde de salida (circulación y dumping).", en: "Toggle the slat watching the main element's peak (slat effect). Toggle the flap watching the main element's Cl and its trailing-edge Cp (circulation and dumping)." }, mount: smithLab }],
  interview: [
    { q: { es: "¿Qué pasa con la distribución de presiones si añades un flap? ¿Y un slat?", en: "What happens to the pressure distribution if you add a flap? And a slat?" }, a: { es: R`<p><b>Flap</b>: aumenta la circulación del principal (efecto circulación): su pico de succión sube y su \(C_p\) en el borde de salida pasa a ser negativo (dumping), así que la recuperación que debe hacer es menor; el flap tiene su propio pico y su capa límite fresca. <b>Slat</b>: reduce el pico de succión del borde de ataque del principal (efecto slat), lo que retrasa su pérdida; el slat soporta un pico propio muy alto pero corto. Total: más \(C_{l,max}\) (flap: más Cl a cada α; slat: más α de pérdida).</p>`, en: R`<p><b>Flap</b>: raises the main element's circulation (circulation effect): its suction peak rises and its trailing-edge \(C_p\) becomes negative (dumping), so the recovery it must perform is smaller; the flap has its own peak and fresh boundary layer. <b>Slat</b>: lowers the main element's leading-edge suction peak (slat effect), delaying its stall; the slat carries a very high but short peak of its own. Overall: higher \(C_{l,max}\) (flap: more Cl at each α; slat: higher stall α).</p>` } },
    { q: { es: "¿Por qué funciona el hueco entre elementos? ¿Es porque inyecta aire de alta energía?", en: "Why does the slot between elements work? Is it because it injects high-energy air?" }, a: { es: R`<p>No. El aire del hueco tiene la misma presión total que la corriente libre. Funciona por las interacciones potenciales entre elementos (Smith): slat effect, circulation effect, dumping, recuperación fuera de la superficie y capa límite fresca. El hueco permite que cada elemento tenga su propio borde de salida (Kutta) y su propia capa límite.</p>`, en: R`<p>No. Slot air has the same total pressure as the free stream. It works through the potential-flow interactions between elements (Smith): slat effect, circulation effect, dumping, off-surface recovery and fresh boundary layer. The slot lets each element have its own trailing edge (Kutta) and its own boundary layer.</p>` } },
    { q: { es: "¿Qué ocurre si cierras demasiado el gap del flap?", en: "What happens if you close the flap gap too much?" }, a: { es: R`<p>La estela y la capa límite del principal se mezclan con la capa límite del flap (flujo confluente): la capa límite del flap deja de ser "fresca", el gradiente adverso que soporta es menor y separa, con pérdida de carga. Con gap demasiado grande se pierde la interacción. El óptimo depende de α y de la deflexión.</p>`, en: R`<p>The main element's wake and boundary layer merge with the flap's boundary layer (confluent flow): the flap's boundary layer is no longer "fresh", it withstands less adverse gradient and separates, losing load. With too large a gap the interaction is lost. The optimum depends on α and deflection.</p>` } },
  ],
  myths: [
    { es: "«El slot sopla aire de alta energía que re-energiza la capa límite». Smith (1975) lo desmonta: la presión total en el slot es la de la corriente libre; los beneficios son interacciones de circulación.", en: "“The slot blows high-energy air that re-energises the boundary layer”. Smith (1975) debunks it: slot total pressure equals free-stream; the benefits are circulation interactions." },
    { es: "«El slat aumenta la sustentación del principal». La reduce algo a igual α (baja su pico), pero le permite llegar a α mucho mayores sin separar.", en: "“The slat increases the main element's lift”. It slightly reduces it at the same α (lower peak), but lets it reach much higher α without separating." },
  ],
  quiz: [
    { q: { es: "¿Qué efecto de Smith baja el pico de succión del principal?", en: "Which Smith effect lowers the main element's suction peak?" }, options: [{ es: "Slat effect", en: "Slat effect" }, { es: "Circulation effect", en: "Circulation effect" }, { es: "Dumping", en: "Dumping" }, { es: "Fresh boundary layer", en: "Fresh boundary layer" }], correct: 0, explain: { es: "La circulación del slat induce una velocidad opuesta en el borde de ataque del principal.", en: "The slat's circulation induces an opposing velocity at the main element's leading edge." } },
    { q: { es: "El efecto dumping consiste en…", en: "The dumping effect consists of…" }, options: [{ es: "soltar la capa límite del delantero a velocidad > V∞", en: "releasing the forward boundary layer at velocity > V∞" }, { es: "tirar aire por el hueco", en: "dumping air through the slot" }, { es: "reducir la circulación del flap", en: "reducing flap circulation" }, { es: "separar el flap", en: "separating the flap" }], correct: 0, explain: { es: "Cp,TE negativo → menos recuperación necesaria.", en: "Negative Cp,TE → less recovery needed." } },
  ],
  refs: [
    "A.M.O. Smith, “High-Lift Aerodynamics”, 37th Wright Brothers Lecture, <i>J. Aircraft</i> 12(6), 501–530, 1975.",
    "C.P. van Dam, “The aerodynamic design of multi-element high-lift systems for transport airplanes”, <i>Prog. Aerosp. Sci.</i> 38 (2002).",
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 5 (multi-element wings).",
  ],
};
