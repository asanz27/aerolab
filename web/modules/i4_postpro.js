import { slider, labLayout, readout, segmented, toggle, L, tr, el } from "../js/core/ui.js";
import { cssVar } from "../js/core/plot.js";
import { FlowView, cpColor, divColor, speedColor } from "../js/core/field.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;

/* Open-access sources (all CC BY 4.0). Figures are loaded from the publisher (MDPI) and credited. */
const SRC = {
  gc: { cite: "J.M. Guerrero & R. Castilla, “Aerodynamic Study of the Wake Effects on a Formula 1 Car”, <i>Energies</i> 13(19), 5183, 2020", url: "https://doi.org/10.3390/en13195183", base: "https://mdpi-res.com/energies/energies-13-05183/article_deploy/html/images/energies-13-05183-" },
  mcs: { cite: "D. Martins, J. Correia & A. Silva, “The Influence of Front Wing Pressure Distribution on Wheel Wake Aerodynamics of a F1 Car”, <i>Energies</i> 14(15), 4421, 2021", url: "https://doi.org/10.3390/en14154421", base: "https://mdpi-res.com/energies/energies-14-04421/article_deploy/html/images/energies-14-04421-" },
  cm: { cite: "C. Cravero & D. Marsano, “Computational Investigation of the Aerodynamics of a Wheel Installed on a Race Car with a Multi-Element Front Wing”, <i>Fluids</i> 7(6), 182, 2022", url: "https://doi.org/10.3390/fluids7060182", base: "https://mdpi-res.com/fluids/fluids-07-00182/article_deploy/html/images/fluids-07-00182-" },
  ngm: { cite: "E. Pérez Nebot, A. Gupta & M. Mahak, “Investigating the Impact of Structural Features on F1 Car Diffuser Performance Using CFD”, <i>Mathematics</i> 13(9), 1455, 2025", url: "https://doi.org/10.3390/math13091455", base: "https://mdpi-res.com/mathematics/mathematics-13-01455/article_deploy/html/images/mathematics-13-01455-" },
};

const FIGS = [
  { v: "CpS", src: "gc", f: "g009", n: 9,
    t: { es: "CpS (presión estática) en la superficie y a lo largo del coche", en: "CpS (static pressure) on the surface and along the car" },
    es: "Azul = succión (Cp &lt; 0), rojo = sobrepresión. Abajo (vista inferior) el suelo y el alerón delantero están en azul: ahí sale la carga. Arriba, rojo en el alerón trasero y el morro (remanso). La gráfica separa Cp de la cara superior e inferior a lo largo del coche: la carga es el área entre ambas curvas, como en un perfil.",
    en: "Blue = suction (Cp &lt; 0), red = overpressure. Underneath, the floor and front wing are blue: that is where downforce comes from. On top, red on the rear wing and nose (stagnation). The chart splits upper and lower Cp along the car: downforce is the area between the curves, as for an airfoil." },
  { v: "ωx", src: "gc", f: "g010", n: 10,
    t: { es: "Vorticidad axial ωx en planos transversales", en: "Streamwise vorticity ωx on cross planes" },
    es: "Rojo/azul = sentido de giro (signo de ωx). Se identifican y se nombran los vórtices: <b>Y250</b> (junto al centro del alerón delantero), vórtices de los extremos de los flaps, vórtices <b>Venturi</b> del suelo y el vórtice de <b>sellado</b>. Al leerlo: posición (¿pasa por encima o por debajo del suelo?), intensidad (saturación del color) y pareja de signos (contrarrotantes se separan o se acercan al suelo según su imagen).",
    en: "Red/blue = rotation sense (sign of ωx). Vortices are identified and named: <b>Y250</b> (near the front-wing centre), flap-tip vortices, floor <b>Venturi</b> vortices and the <b>sealing</b> vortex. When reading it: position (over or under the floor?), strength (colour saturation) and sign pairs (counter-rotating pairs move apart or towards the ground depending on their image)." },
  { v: "CpT", src: "mcs", f: "g008a", n: 8,
    t: { es: "CpT (presión total) en un plano tras el alerón delantero", en: "CpT (total pressure) on a plane behind the front wing" },
    es: "CpT = 1 (rojo) es aire sin pérdidas, con la energía de la corriente libre. Todo lo que baja de 1 es «aire sucio»: la lámina amarilla es la estela de los elementos del alerón y la mancha azul-cian es el núcleo del vórtice del endplate, con fuerte pérdida de presión total. Es <b>la</b> variable de F1 para seguir estelas: dónde va el aire con pérdidas (¿entra bajo el suelo? ¿lo ensucia la rueda?).",
    en: "CpT = 1 (red) is loss-free air with free-stream energy. Anything below 1 is “dirty air”: the yellow sheet is the wing elements' wake and the blue-cyan spot is the endplate vortex core, with a large total-pressure loss. It is <b>the</b> F1 variable for tracking wakes: where does lossy air go (under the floor? fouled by the tyre?)." },
  { v: "Vx", src: "mcs", f: "g011a", n: 11,
    t: { es: "Velocidad longitudinal Vx detrás de la rueda", en: "Streamwise velocity Vx behind the wheel" },
    es: "Déficit de velocidad de la estela del neumático: las zonas lentas son baja presión dinámica para lo que venga detrás (suelo, pontones). Comparando incidencias del flap se ve cómo el alerón desplaza esa estela.",
    en: "Velocity deficit of the tyre wake: slow regions are low dynamic pressure for whatever follows (floor, sidepods). Comparing flap angles shows how the wing moves that wake." },
  { v: "Vz", src: "mcs", f: "g013a", n: 13,
    t: { es: "Velocidad vertical Vz detrás de la rueda", en: "Vertical velocity Vz behind the wheel" },
    es: "Manchas alternas de Vz positiva (amarillo) y negativa (cian): la estela del neumático es turbulenta y está llena de vórtices; el signo indica si el flujo sube o baja. En un plano, un vórtice aparece como una pareja Vz+/Vz− a ambos lados de su núcleo (y Vy+/Vy− arriba y abajo).",
    en: "Alternating patches of positive (yellow) and negative (cyan) Vz: the tyre wake is turbulent and full of vortices; the sign shows whether the flow rises or falls. On a plane, a vortex appears as a Vz+/Vz− pair either side of its core (and Vy+/Vy− above and below)." },
  { v: "FFT", src: "mcs", f: "g014", n: 14,
    t: { es: "Oscilación temporal de la carga y su FFT", en: "Time oscillation of the downforce and its FFT" },
    es: "En un cálculo no estacionario la fuerza no es constante: se muestra la señal y su espectro. Los picos indican desprendimiento periódico (Strouhal) y diferencian un diseño «tranquilo» de uno inestable.",
    en: "In an unsteady computation the force is not constant: the signal and its spectrum are shown. Peaks reveal periodic shedding (Strouhal) and separate a “quiet” design from an unsteady one." },
  { v: "τw", src: "cm", f: "g004", n: 4,
    t: { es: "Líneas de tensión de pared en el neumático (flow-vis numérico)", en: "Wall-shear-stress lines on the tyre (numerical flow-vis)" },
    es: "Equivalente numérico de la pintura de aceite: líneas tangentes a τw. Convergen en líneas de separación y divergen en líneas de reanclaje; aquí muestran cómo el flujo rodea el hombro del neumático.",
    en: "Numerical equivalent of oil paint: lines tangent to τw. They converge on separation lines and diverge from attachment lines; here they show the flow wrapping around the tyre shoulder." },
  { v: "CpS", src: "cm", f: "g012", n: 12,
    t: { es: "Presión en superficie: rueda fija frente a girando", en: "Surface pressure: stationary versus rotating wheel" },
    es: "Misma escala para comparar dos casos: el cambio de la zona de presión alta delante del contacto y de la succión en la parte superior explica la diferencia de sustentación entre rueda fija y girando.",
    en: "Same scale to compare two cases: the change of the high-pressure region ahead of the contact and of the suction on top explains the lift difference between stationary and rotating wheels." },
  { v: "Vx", src: "cm", f: "g010", n: 10,
    t: { es: "Contornos de velocidad en cuatro planos transversales", en: "Velocity contours on four cross planes" },
    es: "La secuencia de planos permite seguir la estela aguas abajo: cómo se expande, se desplaza lateralmente y decae.",
    en: "The sequence of planes lets you follow the wake downstream: how it grows, moves sideways and decays." },
  { v: "y+", src: "ngm", f: "g011", n: 11,
    t: { es: "Distribución de y⁺ en las paredes", en: "y⁺ distribution on the walls" },
    es: "Control de calidad de malla: con modelos de bajo Reynolds se exige y⁺ &lt; 1 en suelo, difusor y neumáticos. Es lo primero que se mira antes de creerse cualquier contorno.",
    en: "Mesh quality check: with low-Reynolds models y⁺ &lt; 1 is required on floor, diffuser and tyres. It is the first thing to check before trusting any contour." },
  { v: "ω", src: "ngm", f: "g013a", n: 13,
    t: { es: "Vorticidad en planos junto a la rueda delantera: base frente a modificado", en: "Vorticity on planes near the front tyre: baseline versus modified" },
    es: "Comparación lado a lado (base frente a cambio de geometría) en los mismos planos y escala: es el formato típico de un informe de CFD en F1, donde lo que interesa es la diferencia.",
    en: "Side-by-side comparison (baseline versus geometry change) on the same planes and scale: the typical format of an F1 CFD report, where the difference is what matters." },
  { v: "ΔCl(x)", src: "ngm", f: "g019", n: 19,
    t: { es: "Distribución longitudinal de carga y resistencia (curvas acumuladas)", en: "Streamwise distribution of lift and drag (cumulative curves)" },
    es: "Fuerza integrada desde el morro hasta cada x: muestra <b>dónde</b> gana o pierde carga cada versión. En F1 se usan mucho estas «delta plots» para localizar el efecto de un cambio en el coche completo.",
    en: "Force integrated from the nose up to each x: it shows <b>where</b> each version gains or loses downforce. These “delta plots” are widely used in F1 to locate the effect of a change on the full car." },
];

const VARS = {
  CpT: { es: "Coeficiente de presión total CpT = (p₀ − p∞)/q∞ (también Cp0 o CPT). 1 = sin pérdidas; &lt; 1 = estelas, capas límite, núcleos de vórtice. Se usa en isosuperficies (p. ej. CpT = 0) para «ver» las estelas y el aire sucio.", en: "Total-pressure coefficient CpT = (p₀ − p∞)/q∞ (also Cp0 or CPT). 1 = loss-free; &lt; 1 = wakes, boundary layers, vortex cores. Used as iso-surfaces (e.g. CpT = 0) to “see” wakes and dirty air." },
  CpS: { es: "Coeficiente de presión estática CpS = (p − p∞)/q∞. En superficie da la carga (succión azul debajo del suelo y alerones); en planos marca los núcleos de vórtice (mínimos fuertes) y las zonas de remanso.", en: "Static-pressure coefficient CpS = (p − p∞)/q∞. On surfaces it gives the load (blue suction under floor and wings); on planes it marks vortex cores (strong minima) and stagnation regions." },
  Vx: { es: "Velocidad longitudinal (Vx/U∞): déficit de estela, zonas de recirculación (Vx &lt; 0), aceleración bajo el suelo.", en: "Streamwise velocity (Vx/U∞): wake deficit, recirculation (Vx &lt; 0), acceleration under the floor." },
  "Vy/Vz": { es: "Velocidades transversales: Vy lateral (outwash/inwash), Vz vertical (upwash/downwash). Un vórtice aparece como un par de signos opuestos alrededor del núcleo; el outwash del alerón delantero se ve en Vy.", en: "Cross-flow velocities: lateral Vy (outwash/inwash), vertical Vz (upwash/downwash). A vortex appears as a pair of opposite signs around its core; front-wing outwash shows in Vy." },
  "ωx": { es: "Vorticidad longitudinal: sentido e intensidad de los vórtices longitudinales (Y250, vórtices de borde del suelo, de endplate, de flaps).", en: "Streamwise vorticity: sense and strength of streamwise vortices (Y250, floor-edge, endplate, flap vortices)." },
  "HeliQ": { es: "Helicidad H = u·ω y helicidad normalizada Hn = H/(|u||ω|) ∈ [−1, 1] (en algunos postprocesadores se presenta como «helicity» o variables derivadas tipo HeliQ). Distingue núcleos de vórtice longitudinales (|Hn| → 1) de cizalladuras (ω ⟂ u, Hn ≈ 0) y su signo da el sentido de giro respecto al flujo.", en: "Helicity H = u·ω and normalised helicity Hn = H/(|u||ω|) ∈ [−1, 1] (some post-processors present it as “helicity” or derived variables such as HeliQ). It separates streamwise vortex cores (|Hn| → 1) from shear layers (ω ⟂ u, Hn ≈ 0) and its sign gives the rotation sense relative to the flow." },
  Q: { es: "Criterio Q = ½(‖Ω‖² − ‖S‖²): positivo donde la rotación domina sobre la deformación. Las isosuperficies Q &gt; 0 (o λ₂ &lt; 0) dibujan los tubos de vórtice sin confundirlos con las capas de cortadura, que tienen mucha vorticidad pero Q ≤ 0.", en: "Q criterion Q = ½(‖Ω‖² − ‖S‖²): positive where rotation dominates strain. Iso-surfaces Q &gt; 0 (or λ₂ &lt; 0) draw vortex tubes without confusing them with shear layers, which have strong vorticity but Q ≤ 0." },
  "y+ / τw": { es: "Calidad y física en la pared: y⁺ para validar la malla; líneas de τw (flow-vis numérico) para localizar separación y reanclaje.", en: "Wall quality and physics: y⁺ to validate the mesh; τw lines (numerical flow-vis) to locate separation and reattachment." },
};

function galleryLab(host) {
  host.innerHTML = "";
  const grid = el("div", { class: "pp-grid" });
  for (const f of FIGS) {
    const s = SRC[f.src];
    const card = el("figure", { class: "pp-fig" });
    const img = el("img", { src: s.base + f.f + "-550.jpg", alt: tr(f.t), loading: "lazy", referrerpolicy: "no-referrer" });
    img.addEventListener("error", () => {
      img.replaceWith(el("div", { class: "pp-missing" }, L("No se pudo cargar la figura desde el editor: ábrela en el artículo.", "The figure could not be loaded from the publisher: open it in the article.")));
    });
    const link = el("a", { href: s.base + f.f + ".png", target: "_blank", rel: "noopener" });
    link.appendChild(img);
    card.appendChild(link);
    card.appendChild(el("figcaption", {}, `<div class="pp-tag">${f.v}</div><b>${L(f.t.es, f.t.en)}</b><p>${L(f.es, f.en)}</p><p class="pp-cred">${L("Figura", "Figure")} ${f.n} — ${s.cite}. <a href="${s.url}" target="_blank" rel="noopener">${s.url}</a> · CC BY 4.0</p>`));
    grid.appendChild(card);
  }
  host.appendChild(grid);
}

function variablesLab(host) {
  const box = el("div", { class: "pp-vars" });
  for (const [k, v] of Object.entries(VARS)) box.appendChild(el("div", { class: "gloss" }, `<h4>${k}</h4><p>${L(v.es, v.en)}</p>`));
  host.appendChild(box);
}

function syntheticLab(host) {
  const ui = labLayout(host);
  const fv = new FlowView(ui.viz, { height: 330, world: { x0: -1.0, x1: 1.0, y0: 0.0, y1: 1.0 }, particles: 700, speed: 0.004, trail: 0.85 });
  const sV = segmented({ label: { es: "Variable", en: "Variable" }, value: "CpT", onInput: draw, options: ["CpT", "CpS", "Vx", "Vy", "Vz", "omega_x", "helicity_n", "Q"].map((v) => ({ value: v, label: { es: v === "helicity_n" ? "Hn" : v === "omega_x" ? "ωx" : v, en: v === "helicity_n" ? "Hn" : v === "omega_x" ? "ωx" : v } })) });
  const sS = segmented({ label: { es: "Pareja de vórtices", en: "Vortex pair" }, value: "counter", onInput: run, options: [{ value: "counter", label: { es: "Contrarrotantes", en: "Counter-rotating" } }, { value: "co", label: { es: "Corrotantes", en: "Co-rotating" } }] });
  const sG = slider({ label: { es: "Intensidad Γ", en: "Strength Γ" }, min: 0.1, max: 1.2, step: 0.05, value: 0.6, onInput: run });
  const sL = slider({ label: { es: "Pérdida de presión total en el núcleo", en: "Core total-pressure loss" }, min: 0, max: 1, step: 0.05, value: 0.6, onInput: run });
  const sZ = slider({ label: { es: "Altura sobre el suelo", en: "Height above ground" }, min: 0.12, max: 0.6, step: 0.01, value: 0.25, onInput: run });
  const tG = toggle({ label: { es: "Suelo (imagen)", en: "Ground (image)" }, value: true, onInput: run });
  ui.controls.append(sV.el, sS.el, sG.el, sL.el, sZ.el, tG.el);
  const roMin = readout({ es: "Mínimo", en: "Minimum" });
  const roMax = readout({ es: "Máximo", en: "Maximum" });
  ui.readouts.append(roMin.el, roMax.el);
  ui.note.innerHTML = L(
    "Ilustración analítica generada por AeroLab (no es CFD): dos vórtices longitudinales de Lamb-Oseen junto al suelo, con déficit de velocidad y pérdida de presión total en sus núcleos, vistos en un plano transversal. Cambia de variable para ver cómo la <b>misma</b> estructura aparece en cada una: CpT y Vx marcan las pérdidas, CpS el mínimo de presión del núcleo, Vy/Vz la pareja de signos, ωx y Hn el sentido de giro y Q solo el núcleo (no la cizalladura).",
    "Analytical illustration generated by AeroLab (not CFD): two Lamb-Oseen streamwise vortices near the ground, with velocity deficit and total-pressure loss in their cores, seen on a cross plane. Switch variable to see how the <b>same</b> structure appears in each: CpT and Vx mark losses, CpS the core pressure minimum, Vy/Vz the sign pair, ωx and Hn the rotation sense and Q only the core (not the shear)."
  );
  let last = null;
  const call = liveCall("pp", "postpro.plane", 40);
  function run() {
    call({ gamma: sG.value, sense: sS.value, loss: sL.value, z: sZ.value, ground: tG.value }, (r) => {
      last = r;
      fv.setField({ x: r.y, y: r.z, u: r.Vy, v: r.Vz }, { reseed: !fv.field });
      draw();
    });
  }
  function draw() {
    const r = last;
    if (!r) return;
    const k = sV.value;
    const F = r[k];
    const flat = F.flat();
    const mn = Math.min(...flat), mx = Math.max(...flat);
    const sym = Math.max(Math.abs(mn), Math.abs(mx)) || 1;
    let map;
    if (k === "CpT") map = (v) => cpColor(v - 1, Math.min(-0.2, mn - 1), 1);
    else if (k === "CpS") map = (v) => cpColor(v, Math.min(-0.2, mn), 1);
    else if (k === "Vx") map = (v) => speedColor(v, 1.05);
    else if (k === "Q") map = (v) => divColor(Math.max(-1, Math.min(1, v / (0.3 * mx || 1))), 1);
    else map = (v) => divColor(v, sym);
    fv.setScalar({ x: r.y, y: r.z, values: F, map, alpha: 220 });
    fv.setOverlays([(g, v) => {
      g.fillStyle = "#1f2937";
      g.fillRect(0, v.Y(0) - 2, v.W, v.H);
      g.fillStyle = cssVar("--fg");
      g.font = "12px Inter";
      g.fillText(tr({ es: "plano transversal (vista desde atrás)", en: "cross plane (view from behind)" }), 10, 16);
    }]);
    roMin.set(mn.toPrecision(3));
    roMax.set(mx.toPrecision(3));
  }
  run();
}

export default {
  subtitle: {
    es: "Cómo se leen los resultados de CFD de un F1: CpT, CpS, Vx/Vy/Vz, vorticidad, helicidad (HeliQ), criterio Q, y⁺, líneas de pared y curvas de fuerza acumulada, con figuras de artículos de acceso abierto.",
    en: "How to read F1 CFD results: CpT, CpS, Vx/Vy/Vz, vorticity, helicity (HeliQ), Q criterion, y⁺, wall lines and cumulative force curves, with figures from open-access papers.",
  },
  heroParams: { eps: 0.1, camber: 0.08, alpha: 6 },
  intuition: {
    es: R`<p>Un cálculo de CFD de un coche completo produce cientos de millones de valores. El trabajo del aerodinamicista es convertirlos en <b>decisiones</b>: ¿por qué esta versión tiene más carga?, ¿dónde la gana?, ¿qué estela ha cambiado? Para eso se usan siempre las mismas «vistas»: presión en superficie (dónde se genera la fuerza), <b>presión total</b> en planos (dónde va el aire con pérdidas, el «aire sucio»), velocidades y vorticidad (qué vórtices hay y hacia dónde van), criterios de vórtice (Q, helicidad) para dibujar sus núcleos, y curvas de fuerza acumulada a lo largo del coche (dónde aparece la diferencia).</p>
    <p>La regla de oro: casi nunca se mira un resultado aislado, sino la <b>diferencia</b> entre dos versiones con la misma escala de colores y en los mismos planos. Y antes de creerse un contorno se comprueba la calidad (convergencia, y⁺, independencia de malla).</p>`,
    en: R`<p>A full-car CFD run produces hundreds of millions of values. The aerodynamicist's job is to turn them into <b>decisions</b>: why does this version have more downforce, where does it gain it, which wake has changed? The same “views” are always used: surface pressure (where force is generated), <b>total pressure</b> on planes (where lossy “dirty” air goes), velocities and vorticity (which vortices exist and where they go), vortex criteria (Q, helicity) to draw their cores, and cumulative force curves along the car (where the difference appears).</p>
    <p>Golden rule: you almost never look at a result alone, but at the <b>difference</b> between two versions with the same colour scale and on the same planes. And before trusting a contour you check quality (convergence, y⁺, mesh independence).</p>`,
  },
  physics: {
    es: R`<p><b>Definiciones</b> (\(q_\infty=\tfrac12\rho V_\infty^2\)): $$C_{pS}=\frac{p-p_\infty}{q_\infty},\qquad C_{pT}=\frac{p_0-p_\infty}{q_\infty}=C_{pS}+\frac{|\mathbf u|^2}{V_\infty^2}$$ En la corriente libre \(C_{pT}=1\); fuera de la capa límite y las estelas se conserva (Bernoulli), así que cualquier \(C_{pT}<1\) delata pérdidas (viscosidad, separación, mezcla).</p>
    <p><b>Vorticidad y helicidad</b>: \(\boldsymbol\omega=\nabla\times\mathbf u\); \(H=\mathbf u\cdot\boldsymbol\omega\); \(H_n=H/(|\mathbf u||\boldsymbol\omega|)=\cos\angle(\mathbf u,\boldsymbol\omega)\). Un vórtice longitudinal tiene \(\boldsymbol\omega\parallel\mathbf u\Rightarrow|H_n|\to1\); una capa de cortadura \(\boldsymbol\omega\perp\mathbf u\Rightarrow H_n\approx0\).</p>
    <p><b>Criterio Q</b>: \(\nabla\mathbf u=\mathbf S+\boldsymbol\Omega\), \(Q=\tfrac12(\|\boldsymbol\Omega\|^2-\|\mathbf S\|^2)\). \(Q>0\): rotación dominante (núcleo); en la cizalladura pura \(Q=0\). Alternativas: \(\lambda_2<0\), \(\lambda_{ci}\).</p>
    <p><b>Fuerzas</b>: \(\mathbf F=\oint(-p\,\mathbf n+\boldsymbol\tau_w)\,dS\); la curva acumulada \(F(x)=\int_0^x\) dice dónde se genera cada parte. <b>Calidad</b>: residuos y fuerzas convergidas, \(y^+\) adecuado al modelo, independencia de malla, comparación con túnel.</p>`,
    en: R`<p><b>Definitions</b> (\(q_\infty=\tfrac12\rho V_\infty^2\)): $$C_{pS}=\frac{p-p_\infty}{q_\infty},\qquad C_{pT}=\frac{p_0-p_\infty}{q_\infty}=C_{pS}+\frac{|\mathbf u|^2}{V_\infty^2}$$ In the free stream \(C_{pT}=1\); outside boundary layers and wakes it is conserved (Bernoulli), so any \(C_{pT}<1\) reveals losses (viscosity, separation, mixing).</p>
    <p><b>Vorticity and helicity</b>: \(\boldsymbol\omega=\nabla\times\mathbf u\); \(H=\mathbf u\cdot\boldsymbol\omega\); \(H_n=H/(|\mathbf u||\boldsymbol\omega|)=\cos\angle(\mathbf u,\boldsymbol\omega)\). A streamwise vortex has \(\boldsymbol\omega\parallel\mathbf u\Rightarrow|H_n|\to1\); a shear layer \(\boldsymbol\omega\perp\mathbf u\Rightarrow H_n\approx0\).</p>
    <p><b>Q criterion</b>: \(\nabla\mathbf u=\mathbf S+\boldsymbol\Omega\), \(Q=\tfrac12(\|\boldsymbol\Omega\|^2-\|\mathbf S\|^2)\). \(Q>0\): rotation dominates (core); in pure shear \(Q=0\). Alternatives: \(\lambda_2<0\), \(\lambda_{ci}\).</p>
    <p><b>Forces</b>: \(\mathbf F=\oint(-p\,\mathbf n+\boldsymbol\tau_w)\,dS\); the cumulative curve \(F(x)=\int_0^x\) tells where each part is generated. <b>Quality</b>: converged residuals and forces, \(y^+\) suited to the model, mesh independence, tunnel comparison.</p>`,
  },
  labs: [
    { title: { es: "Las variables típicas y para qué sirve cada una", en: "The typical variables and what each one is for" }, mount: variablesLab },
    { title: { es: "Galería: capturas de CFD de F1 publicadas (CC BY 4.0) y cómo leerlas", en: "Gallery: published F1 CFD images (CC BY 4.0) and how to read them" }, desc: { es: "Figuras reproducidas de artículos de acceso abierto con licencia CC BY 4.0 y enlazadas a su fuente. Haz clic para ver la imagen a resolución completa. Para validación de alta fidelidad (LES, ala delantera de Imperial College, isosuperficies de helicidad) consulta Buscariolo et al. en las referencias.", en: "Figures reproduced from open-access papers under CC BY 4.0, linked to their source. Click for the full-resolution image. For high-fidelity validation (LES, Imperial Front Wing, helicity iso-surfaces) see Buscariolo et al. in the references." }, mount: galleryLab },
    { title: { es: "La misma estructura vista en cada variable (ilustración sintética)", en: "The same structure seen in each variable (synthetic illustration)" }, mount: syntheticLab },
  ],
  interview: [
    { q: { es: "¿Qué es el CpT y por qué se usa tanto en F1?", en: "What is CpT and why is it so widely used in F1?" }, a: { es: R`<p>Es el coeficiente de presión total \((p_0-p_\infty)/q_\infty\). Vale 1 en aire sin pérdidas y baja en estelas, capas límite y núcleos de vórtice. Como la presión total solo se pierde por efectos viscosos, una isosuperficie o un plano de CpT muestra directamente el «aire sucio»: de dónde sale, a dónde va y si llega al suelo, al difusor o al coche de detrás.</p>`, en: R`<p>The total-pressure coefficient \((p_0-p_\infty)/q_\infty\). It is 1 in loss-free air and drops in wakes, boundary layers and vortex cores. Since total pressure is only lost through viscous effects, a CpT iso-surface or plane directly shows “dirty air”: where it comes from, where it goes and whether it reaches the floor, the diffuser or the following car.</p>` } },
    { q: { es: "¿Cómo distingues un vórtice de una capa de cortadura en los resultados?", en: "How do you tell a vortex from a shear layer in the results?" }, a: { es: R`<p>La vorticidad sola no basta: una capa de cortadura tiene mucha vorticidad. Se usan criterios que comparan rotación con deformación (Q &gt; 0, λ₂ &lt; 0) o la helicidad normalizada (|Hn| → 1 cuando la vorticidad es paralela a la velocidad, típico de un vórtice longitudinal). Además, en un plano el vórtice muestra un mínimo de CpS y una pareja de signos de Vy/Vz alrededor del núcleo.</p>`, en: R`<p>Vorticity alone is not enough: a shear layer has strong vorticity. You use criteria comparing rotation with strain (Q &gt; 0, λ₂ &lt; 0) or normalised helicity (|Hn| → 1 when vorticity is parallel to velocity, typical of a streamwise vortex). On a plane a vortex also shows a CpS minimum and a sign pair of Vy/Vz around its core.</p>` } },
    { q: { es: "Te dan dos versiones de un suelo: ¿cómo analizas la diferencia?", en: "You are given two floor versions: how do you analyse the difference?" }, a: { es: R`<p>Primero, que ambos casos estén convergidos y con la misma malla y modelo. Luego: diferencias de fuerzas y balance; curvas acumuladas de carga a lo largo de x para localizar dónde aparece la diferencia; CpS en superficie (diferencia de Cp) en esa zona; planos de CpT y ωx para ver qué vórtices o estelas han cambiado (sellado, entrada de aire sucio) y líneas de τw para separaciones en el difusor.</p>`, en: R`<p>First, both cases converged with the same mesh and model. Then: force and balance deltas; cumulative downforce curves along x to locate where the difference appears; surface CpS (Cp delta) in that region; CpT and ωx planes to see which vortices or wakes changed (sealing, dirty-air ingestion) and τw lines for diffuser separation.</p>` } },
  ],
  myths: [
    { es: "«Mucha vorticidad = un vórtice». Una capa de cortadura o una capa límite tienen mucha vorticidad sin ser un vórtice; por eso se usan Q, λ₂ o la helicidad.", en: "“Lots of vorticity = a vortex”. A shear layer or boundary layer has strong vorticity without being a vortex; that is why Q, λ₂ or helicity are used." },
    { es: "«CpT bajo = presión baja». CpT mide pérdida de presión total, no presión estática: el núcleo de un vórtice tiene CpS muy bajo y CpT bajo por motivos distintos.", en: "“Low CpT = low pressure”. CpT measures total-pressure loss, not static pressure: a vortex core has very low CpS and low CpT for different reasons." },
  ],
  quiz: [
    { q: { es: "En la corriente libre, CpT vale…", en: "In the free stream CpT equals…" }, options: [{ es: "0", en: "0" }, { es: "1", en: "1" }, { es: "−1", en: "−1" }, { es: "depende de la velocidad", en: "depends on speed" }], correct: 1, explain: { es: "p₀ − p∞ = q∞.", en: "p₀ − p∞ = q∞." } },
    { q: { es: "Q > 0 indica…", en: "Q > 0 indicates…" }, options: [{ es: "deformación dominante", en: "dominant strain" }, { es: "rotación dominante (núcleo de vórtice)", en: "dominant rotation (vortex core)" }, { es: "separación", en: "separation" }, { es: "flujo supersónico", en: "supersonic flow" }], correct: 1, explain: { es: "Q = ½(‖Ω‖² − ‖S‖²).", en: "Q = ½(‖Ω‖² − ‖S‖²)." } },
  ],
  refs: [
    SRC.gc.cite + `. <a href="${SRC.gc.url}">${SRC.gc.url}</a> (CC BY 4.0).`,
    SRC.mcs.cite + `. <a href="${SRC.mcs.url}">${SRC.mcs.url}</a> (CC BY 4.0).`,
    SRC.cm.cite + `. <a href="${SRC.cm.url}">${SRC.cm.url}</a> (CC BY 4.0).`,
    SRC.ngm.cite + `. <a href="${SRC.ngm.url}">${SRC.ngm.url}</a> (CC BY 4.0).`,
    "F.F. Buscariolo et al., “Spectral/hp element simulation of flow past a Formula One front wing: validation against experiments”, arXiv:1909.06701 (Imperial Front Wing). <a href=\"https://arxiv.org/abs/1909.06701\">arxiv.org/abs/1909.06701</a>",
    "J. Jeong & F. Hussain, “On the identification of a vortex”, <i>JFM</i> 285, 1995 (λ₂); J.C.R. Hunt, A.A. Wray & P. Moin, CTR Report, 1988 (Q criterion).",
  ],
};
