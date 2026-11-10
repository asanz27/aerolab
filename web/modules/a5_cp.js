import { slider, labLayout, readout, toggle, L, tr, el } from "../js/core/ui.js";
import { cssVar } from "../js/core/plot.js";
import { airfoilPanel, splitSurfaces } from "../js/core/airfoil_view.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function cpLab(host) {
  const ui = labLayout(host);
  const ap = airfoilPanel(ui.viz, { height: 260, plotHeight: 280 });
  const sA = slider({ label: { es: "Ángulo de ataque α [°]", en: "Angle of attack α [°]" }, min: -6, max: 16, step: 0.5, value: 5, onInput: run });
  const sM = slider({ label: { es: "Curvatura [% c]", en: "Camber [% c]" }, min: 0, max: 6, step: 1, value: 2, onInput: run });
  const sT = slider({ label: { es: "Espesor [% c]", en: "Thickness [% c]" }, min: 6, max: 21, step: 1, value: 12, onInput: run });
  const sRe = slider({ label: { es: "Reynolds", en: "Reynolds" }, min: 2e5, max: 1e7, value: 3e6, log: true, format: (v) => v.toExponential(1), onInput: run });
  const tG = toggle({ label: { es: "Colorear gradientes de presión", en: "Colour pressure gradients" }, value: true, onInput: () => last && draw(last) });
  const tV = toggle({ label: { es: "Mejora: interacción viscosa-no viscosa (VII)", en: "Upgrade: viscous-inviscid interaction (VII)" }, value: false, onInput: run });
  ui.controls.append(sA.el, sM.el, sT.el, sRe.el, tG.el, tV.el);
  const roCl = readout({ es: "Cl", en: "Cl" });
  const roPk = readout({ es: "Pico de succión Cp mín", en: "Suction peak Cp min" });
  const roX = readout({ es: "Posición del pico", en: "Peak location" }, "x/c");
  const roTr = readout({ es: "Transición (extradós)", en: "Transition (upper)" }, "x/c");
  const roSep = readout({ es: "Separación (extradós)", en: "Separation (upper)" }, "x/c");
  const roCd = readout({ es: "Cd", en: "Cd" });
  ui.readouts.append(roCl.el, roPk.el, roX.el, roTr.el, roSep.el, roCd.el);
  ui.note.innerHTML = L(
    "Con la mejora VII, la capa límite «engorda» el perfil: el pico de succión baja algo, la recuperación final es menos intensa y, cerca de la pérdida, aparece la meseta de presión de la zona separada. Verde: gradiente favorable (la presión baja en el sentido del flujo, la capa límite se acelera y aguanta). Rojo: gradiente adverso (la presión sube, la capa límite se frena y puede separar). ○ rosa: transición; ✗ roja: separación; ● amarilla: punto de remanso.",
    "With the VII upgrade the boundary layer “thickens” the airfoil: the suction peak drops a bit, the final recovery is gentler and, near stall, the separated-region pressure plateau appears. Green: favourable gradient (pressure falls along the flow, the boundary layer is accelerated and copes). Red: adverse gradient (pressure rises, the boundary layer decelerates and may separate). Pink ○: transition; red ✗: separation; yellow ●: stagnation point."
  );
  let last = null;
  const call = liveCall("cp", "airfoil.analyze", 60);
  function run() {
    const code = sM.value === 0 ? `00${String(sT.value).padStart(2, "0")}` : `${sM.value}4${String(sT.value).padStart(2, "0")}`;
    call({ spec: { code, n: 140 }, alpha: sA.value, re: sRe.value, vii: tV.value, field: { x0: -0.4, x1: 1.4, y0: -0.5, y1: 0.5, nx: 90, ny: 50 } }, (r) => {
      last = r;
      draw(r);
    });
  }
  function draw(r) {
    ap.update(r, { gradients: tG.value });
    const e = r.elements[0];
    const { upper, lower } = splitSurfaces(e);
    const all = upper.cp.concat(lower.cp);
    let k = 0;
    all.forEach((v, i) => (v < all[k] ? (k = i) : 0));
    const xs = upper.x.concat(lower.x);
    roCl.set(r.cl.toFixed(3));
    roPk.set(all[k].toFixed(2));
    roX.set(xs[k].toFixed(3));
    const b = e.bl.upper;
    roTr.set(b.x_tr == null ? "–" : b.x_tr.toFixed(2));
    roSep.set(b.x_sep == null ? L("adherido", "attached") : b.x_sep.toFixed(2), b.x_sep == null ? "good" : "bad");
    roCd.set(r.cd.toFixed(4));
  }
  run();
}

function guessLab(host) {
  const ui = labLayout(host);
  const ap = airfoilPanel(ui.viz, { height: 200, plotHeight: 300, field: false, particles: 0 });
  const sA = slider({ label: { es: "α [°]", en: "α [°]" }, min: 0, max: 12, step: 1, value: 6, onInput: run });
  ui.controls.append(sA.el);
  const score = readout({ es: "Aciertos", en: "Correct" });
  const msg = el("div", { class: "callout" }, L("Haz clic sobre la curva del <b>extradós</b> (línea continua) en un punto y responde: ¿ahí el gradiente es favorable o adverso? Pulsa F (favorable) o A (adverso) antes de hacer clic.", "Click on the <b>upper-surface</b> curve (solid line) and answer: is the gradient there favourable or adverse? Press F (favourable) or A (adverse) before clicking."));
  ui.readouts.append(score.el);
  ui.note.appendChild(msg);
  let guess = null;
  let ok = 0, tot = 0;
  score.set("0/0");
  host.tabIndex = 0;
  host.addEventListener("keydown", (e) => {
    if (e.key === "f" || e.key === "F") guess = "fav";
    if (e.key === "a" || e.key === "A") guess = "adv";
    msg.innerHTML = guess ? L(`Tu predicción: <b>${guess === "fav" ? "favorable" : "adverso"}</b>. Ahora haz clic en la curva.`, `Your prediction: <b>${guess === "fav" ? "favourable" : "adverse"}</b>. Now click on the curve.`) : msg.innerHTML;
  });
  let last = null;
  ap.plot.canvas.addEventListener("click", (ev) => {
    if (!last || !ap.plot._map) return;
    const m = ap.plot._map;
    const rect = ap.plot.canvas.getBoundingClientRect();
    const x = m.X0 + ((ev.clientX - rect.left - m.pl) / m.pw) * (m.X1 - m.X0);
    const { upper } = splitSurfaces(last.elements[0]);
    let i = upper.x.findIndex((v) => v >= x);
    if (i < 1) i = 1;
    const kind = upper.cp[i] - upper.cp[i - 1] > 0 ? "adv" : "fav";
    tot++;
    if (guess === kind) ok++;
    score.set(`${ok}/${tot}`);
    msg.innerHTML =
      L(`En x/c = ${x.toFixed(2)} el gradiente es <b>${kind === "fav" ? "favorable" : "adverso"}</b> (Cp ${kind === "fav" ? "baja" : "sube"} hacia el borde de salida). `, `At x/c = ${x.toFixed(2)} the gradient is <b>${kind === "fav" ? "favourable" : "adverse"}</b> (Cp ${kind === "fav" ? "decreases" : "increases"} towards the trailing edge). `) +
      (guess ? (guess === kind ? "✅" : "❌") : L("(no habías predicho: pulsa F o A)", "(no prediction: press F or A)"));
    guess = null;
    ap.plot.setMarkers([{ type: "vline", x, color: kind === "fav" ? "#34d399" : "#f43f5e" }]);
  });
  const call = liveCall("guess", "airfoil.analyze", 60);
  function run() {
    call({ spec: { code: "2412", n: 140 }, alpha: sA.value, re: 3e6 }, (r) => {
      last = r;
      ap.update(r, { gradients: false, bl: false });
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Leer una distribución de presiones como un aerodinamicista: remanso, pico de succión, gradientes favorables y adversos, recuperación y Kutta.",
    en: "Reading a pressure distribution like an aerodynamicist: stagnation, suction peak, favourable and adverse gradients, recovery and Kutta.",
  },
  heroParams: { eps: 0.1, camber: 0.04, alpha: 9 },
  intuition: {
    es: R`<p>El gráfico de \(C_p\) se dibuja con el <b>eje invertido</b> (succión hacia arriba), de modo que la curva del extradós queda encima. El área encerrada entre las curvas de extradós e intradós es \(C_l\) (a pequeño α). Recorre la curva como lo haría la capa límite: nace en el <span class="term">punto de remanso</span> (\(C_p=1\)), acelera bruscamente alrededor del borde de ataque hasta el <span class="term">pico de succión</span> (gradiente <b>favorable</b>, la presión baja en el sentido del flujo) y después tiene que <b>recuperar presión</b> hasta el borde de salida (gradiente <b>adverso</b>).</p>
    <p>La recuperación es lo que limita al perfil: cuanto más alto y más adelantado el pico, más fuerte el gradiente adverso y más fácil que la capa límite separe. En el borde de salida ambas curvas se juntan en un valor ligeramente positivo: es la condición de Kutta (presiones iguales arriba y abajo).</p>`,
    en: R`<p>A \(C_p\) plot is drawn with the <b>axis inverted</b> (suction up), so the upper-surface curve sits on top. The area enclosed between the upper and lower curves is \(C_l\) (at small α). Follow the curve as the boundary layer does: it is born at the <span class="term">stagnation point</span> (\(C_p=1\)), accelerates sharply around the leading edge to the <span class="term">suction peak</span> (<b>favourable</b> gradient, pressure falling along the flow) and then has to <b>recover pressure</b> up to the trailing edge (<b>adverse</b> gradient).</p>
    <p>Recovery is what limits the airfoil: the higher and further forward the peak, the stronger the adverse gradient and the easier it is for the boundary layer to separate. At the trailing edge both curves meet at a slightly positive value: that is the Kutta condition (equal pressure top and bottom).</p>`,
  },
  physics: {
    es: R`<p><b>Fuerzas a partir de Cp</b> (normal y axial, por unidad de cuerda): $$c_n=\oint C_p\,d\!\left(\frac{x}{c}\right),\qquad C_l=c_n\cos\alpha-c_a\sin\alpha\approx\int_0^1\left(C_{p,l}-C_{p,u}\right)d\!\left(\frac xc\right)$$</p>
    <p><b>Gradiente de presión</b> en la capa límite (Prandtl): \(\partial p/\partial y\approx0\) a través de ella, así que la presión exterior se "impone" a la capa límite: $$\frac{dp}{dx}=-\rho\,u_e\frac{du_e}{dx}\qquad\Rightarrow\qquad \frac{dp}{dx}<0\ \text{favorable},\quad \frac{dp}{dx}>0\ \text{adverso}$$ En la pared, \(\mu\,\partial^2u/\partial y^2|_w=dp/dx\): con gradiente adverso el perfil de velocidad tiene un punto de inflexión y el fluido de la pared se frena hasta \(\tau_w=0\) (separación).</p>
    <p><b>Lectura típica</b> (perfil con curvatura moderada a 5–8°):</p>
    <ul><li>Intradós: \(C_p\) ligeramente positivo o cercano a 0, gradientes suaves.</li>
    <li>Extradós: pico en 1–10 % de cuerda (más adelante y más alto al subir α), recuperación hasta \(C_{p,TE}\approx 0.1–0.2\).</li>
    <li>Cerca de la pérdida: pico altísimo, la recuperación "se aplana" en el último tramo → <b>meseta de presión</b> = zona separada.</li>
    <li>Una pequeña meseta seguida de una subida brusca indica una <b>burbuja laminar</b>.</li></ul>
    <p><b>Criterio de Stratford</b>: la recuperación de presión más rápida posible sin separar exige empezar con capa límite turbulenta "fresca" y seguir un perfil de \(C_p\) concreto; los perfiles de alta sustentación y los alerones de F1 se diseñan cerca de ese límite.</p>`,
    en: R`<p><b>Forces from Cp</b> (normal and axial, per unit chord): $$c_n=\oint C_p\,d\!\left(\frac{x}{c}\right),\qquad C_l=c_n\cos\alpha-c_a\sin\alpha\approx\int_0^1\left(C_{p,l}-C_{p,u}\right)d\!\left(\frac xc\right)$$</p>
    <p><b>Pressure gradient</b> in the boundary layer (Prandtl): \(\partial p/\partial y\approx0\) across it, so the outer pressure is "imposed" on the boundary layer: $$\frac{dp}{dx}=-\rho\,u_e\frac{du_e}{dx}\qquad\Rightarrow\qquad \frac{dp}{dx}<0\ \text{favourable},\quad \frac{dp}{dx}>0\ \text{adverse}$$ At the wall \(\mu\,\partial^2u/\partial y^2|_w=dp/dx\): with an adverse gradient the velocity profile has an inflection point and near-wall fluid slows down until \(\tau_w=0\) (separation).</p>
    <p><b>Typical reading</b> (moderately cambered section at 5–8°):</p>
    <ul><li>Lower surface: \(C_p\) slightly positive or near 0, gentle gradients.</li>
    <li>Upper surface: peak at 1–10 % chord (further forward and higher as α increases), recovery to \(C_{p,TE}\approx 0.1–0.2\).</li>
    <li>Near stall: very high peak, recovery "flattens" over the last part → <b>pressure plateau</b> = separated region.</li>
    <li>A small plateau followed by a sharp rise indicates a <b>laminar separation bubble</b>.</li></ul>
    <p><b>Stratford criterion</b>: the fastest possible pressure recovery without separating requires a "fresh" turbulent boundary layer and a specific \(C_p\) shape; high-lift sections and F1 wings are designed close to that limit.</p>`,
  },
  labs: [
    { title: { es: "Distribución de Cp en tiempo real", en: "Real-time Cp distribution" }, desc: { es: "Sube α y observa cómo el pico de succión crece y se adelanta, el gradiente adverso se intensifica y la separación avanza desde el borde de salida.", en: "Raise α and watch the suction peak grow and move forward, the adverse gradient intensify and separation creep forward from the trailing edge." }, mount: cpLab },
    { title: { es: "Reto: ¿favorable o adverso?", en: "Challenge: favourable or adverse?" }, desc: { es: "Entrena la lectura de un Cp como en la pizarra de una entrevista.", en: "Practise reading a Cp plot as on an interview whiteboard." }, mount: guessLab },
  ],
  interview: [
    { q: { es: "Dibuja la distribución de Cp de un perfil y señala gradientes adversos y favorables.", en: "Sketch the Cp distribution of an airfoil and mark adverse and favourable gradients." }, a: { es: R`<p>Eje de \(C_p\) invertido. Remanso \(C_p=1\) cerca del borde de ataque (en el intradós a α&gt;0). Extradós: caída brusca hasta el pico de succión (favorable), luego subida continua hasta el borde de salida (adverso, el que manda en la separación). Intradós: acelera poco, gradientes suaves, a veces ligeramente adverso al final. Ambas curvas se unen en el borde de salida (Kutta), con \(C_p\) algo positivo.</p>`, en: R`<p>Inverted \(C_p\) axis. Stagnation \(C_p=1\) near the leading edge (on the lower surface for α&gt;0). Upper surface: sharp drop to the suction peak (favourable), then continuous rise to the trailing edge (adverse, the one that governs separation). Lower surface: little acceleration, gentle gradients, sometimes slightly adverse at the end. Both curves meet at the trailing edge (Kutta), with slightly positive \(C_p\).</p>` } },
    { q: { es: "¿Por qué el gradiente adverso provoca separación y el favorable no?", en: "Why does an adverse gradient cause separation but a favourable one does not?" }, a: { es: R`<p>La presión exterior se transmite a toda la capa límite. Con \(dp/dx>0\) la fuerza de presión frena a todas las capas; las cercanas a la pared tienen poca cantidad de movimiento y se frenan antes, hasta que \(\partial u/\partial y|_w=0\) y aparece flujo inverso. Con \(dp/dx<0\) la presión empuja a favor, el perfil se "llena" y la capa límite se adelgaza.</p>`, en: R`<p>Outer pressure is transmitted through the whole boundary layer. With \(dp/dx>0\) the pressure force decelerates every layer; near-wall layers have little momentum and stop first, until \(\partial u/\partial y|_w=0\) and reverse flow appears. With \(dp/dx<0\) pressure pushes along, the profile "fills" and the boundary layer thins.</p>` } },
    { q: { es: "¿Cómo reconoces la separación en un gráfico de Cp medido?", en: "How do you recognise separation on a measured Cp plot?" }, a: { es: R`<p>Por una <b>meseta</b>: en la zona separada la presión deja de recuperarse y queda casi constante hasta el borde de salida (y \(C_{p,TE}\) se vuelve negativo). Una meseta corta seguida de una recuperación brusca es una burbuja laminar con reanclaje turbulento.</p>`, en: R`<p>By a <b>plateau</b>: in the separated region pressure stops recovering and stays almost constant up to the trailing edge (and \(C_{p,TE}\) becomes negative). A short plateau followed by a sharp recovery is a laminar bubble with turbulent reattachment.</p>` } },
    { q: { es: "¿Qué ocurre con el pico de succión al aumentar α?", en: "What happens to the suction peak as α increases?" }, a: { es: R`<p>Crece y se desplaza hacia el borde de ataque (el punto de remanso se mueve hacia atrás por el intradós y el flujo tiene que rodear un borde de ataque más "agudo"). La recuperación posterior es más larga y más intensa, por eso la separación del borde de salida avanza.</p>`, en: R`<p>It grows and moves towards the leading edge (the stagnation point moves aft along the lower surface and the flow has to turn around a "sharper" leading edge). The subsequent recovery is longer and stronger, so trailing-edge separation moves forward.</p>` } },
  ],
  myths: [
    { es: "«El gradiente adverso solo está en el extradós». También en el intradós puede haber zonas adversas (p. ej. cerca del borde de salida o en el flap).", en: "“Adverse gradients only exist on the upper surface”. The lower surface can also have adverse regions (e.g. near the trailing edge or on a flap)." },
    { es: "«Cp no puede ser menor que −1». Cp = 1 − (V/V∞)²: un pico con V = 3V∞ da Cp = −8.", en: "“Cp cannot be lower than −1”. Cp = 1 − (V/V∞)²: a peak with V = 3V∞ gives Cp = −8." },
    { es: "«La separación empieza donde está el pico de succión». Empieza aguas abajo, en la recuperación; el pico solo marca dónde empieza el gradiente adverso.", en: "“Separation starts at the suction peak”. It starts downstream, in the recovery; the peak only marks where the adverse gradient begins." },
  ],
  quiz: [
    { q: { es: "En un gráfico de Cp de un perfil, el valor en el punto de remanso es…", en: "On an airfoil Cp plot, the value at the stagnation point is…" }, options: [{ es: "0", en: "0" }, { es: "1", en: "1" }, { es: "−1", en: "−1" }, { es: "depende de α", en: "depends on α" }], correct: 1, explain: { es: "V = 0 → Cp = 1 (incompresible).", en: "V = 0 → Cp = 1 (incompressible)." } },
    { q: { es: "dp/dx > 0 en el extradós significa…", en: "dp/dx > 0 on the upper surface means…" }, options: [{ es: "gradiente favorable", en: "favourable gradient" }, { es: "gradiente adverso", en: "adverse gradient" }, { es: "separación segura", en: "certain separation" }, { es: "transición", en: "transition" }], correct: 1, explain: { es: "Adverso no implica separación inmediata: depende de su intensidad y del estado de la capa límite.", en: "Adverse does not mean immediate separation: it depends on its strength and on the boundary-layer state." } },
    { q: { es: "Una meseta de Cp casi constante hasta el borde de salida indica…", en: "An almost constant Cp plateau up to the trailing edge indicates…" }, options: [{ es: "flujo laminar", en: "laminar flow" }, { es: "separación", en: "separation" }, { es: "choque", en: "a shock" }, { es: "condición de Kutta", en: "the Kutta condition" }], correct: 1, explain: { es: "El aire muerto separado tiene presión casi uniforme.", en: "Separated dead air has almost uniform pressure." } },
    { q: { es: "A pequeño α, el área entre las curvas de Cp de extradós e intradós es…", en: "At small α, the area between upper and lower Cp curves is…" }, options: [{ es: "Cd", en: "Cd" }, { es: "Cl", en: "Cl" }, { es: "Cm", en: "Cm" }, { es: "Re", en: "Re" }], correct: 1, explain: { es: "c_n = ∫(Cp,l − Cp,u) dx/c ≈ Cl.", en: "c_n = ∫(Cp,l − Cp,u) dx/c ≈ Cl." } },
  ],
  refs: [
    "B.S. Stratford, “The prediction of separation of the turbulent boundary layer”, <i>JFM</i> 5 (1959).",
    "A.M.O. Smith, “High-Lift Aerodynamics”, <i>J. Aircraft</i> 12(6), 1975.",
    "J.D. Anderson, <i>Fundamentals of Aerodynamics</i>, §1.5, §4.",
    "M. Drela, <i>Flight Vehicle Aerodynamics</i>, MIT Press, 2014, ch. 4.",
  ],
};
