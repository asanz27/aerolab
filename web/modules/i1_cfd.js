import { slider, labLayout, readout, L, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function spectrumLab(host) {
  const ui = labLayout(host);
  const plot = new Plot(ui.viz, { height: 300, xlabel: { es: "número de onda k·L", en: "wavenumber k·L" }, ylabel: { es: "E(k) (espectro de energía)", en: "E(k) (energy spectrum)" }, logX: true, logY: true });
  const pC = new Plot(ui.viz, { height: 230, xlabel: { es: "Re_L", en: "Re_L" }, ylabel: { es: "nº de puntos de malla (estimado)", en: "grid points (estimate)" }, logX: true, logY: true });
  const sRe = slider({ label: { es: "Reynolds Re_L", en: "Reynolds Re_L" }, min: 1e3, max: 1e8, value: 1e5, log: true, format: (v) => v.toExponential(1), onInput: run });
  ui.controls.append(sRe.el);
  const roE = readout({ es: "η / L (Kolmogorov)", en: "η / L (Kolmogorov)" });
  const roN = readout({ es: "Puntos DNS ~ (L/η)³", en: "DNS points ~ (L/η)³" });
  const roK = readout({ es: "Corte LES (80 % de k)", en: "LES cut-off (80 % of k)" }, "k·L");
  ui.readouts.append(roE.el, roN.el, roK.el);
  ui.note.innerHTML = L(
    "Espectro modelo de Pope (rango inercial −5/3 con funciones de energía y de disipación). Azul: lo que resuelve LES; violeta: lo que añade DNS (hasta la escala de Kolmogorov). RANS modela todo el espectro. Abajo: escalado del coste para capas límite (Choi & Moin 2012). Un F1 a escala real tiene Re_L ~ 10⁷–2·10⁷.",
    "Pope's model spectrum (−5/3 inertial range with energy-containing and dissipation functions). Blue: what LES resolves; violet: what DNS adds (down to the Kolmogorov scale). RANS models the whole spectrum. Bottom: cost scaling for boundary layers (Choi & Moin 2012). A full-scale F1 car has Re_L ~ 10⁷–2·10⁷."
  );
  let cost = null;
  physics.call("cfd.cost", {}).then((c) => {
    cost = c;
    run();
  });
  const call = liveCall("spec", "cfd.spectrum", 40);
  function run() {
    call({ re_L: sRe.value }, (r) => {
      const kInert = r.k.filter((k) => k > 2 && k < 0.1 / r.eta);
      plot.set([
        { x: r.k, y: r.E, color: cssVar("--accent"), width: 2.6, label: { es: "E(k)", en: "E(k)" } },
        { x: kInert, y: kInert.map((k) => 1.5 * Math.pow(k, -5 / 3)), color: cssVar("--fg-dim"), dash: [4, 3], label: { es: "k^(−5/3)", en: "k^(−5/3)" } },
      ], [
        { type: "band", x0: r.k[0], x1: r.k_les, color: "rgba(34,211,238,0.10)" },
        { type: "band", x0: r.k_les, x1: r.k_eta, color: "rgba(167,139,250,0.10)" },
        { type: "vline", x: r.k_les, color: cssVar("--accent"), label: { es: "corte LES", en: "LES cut-off" } },
        { type: "vline", x: r.k_eta, color: cssVar("--accent-3"), label: { es: "1/η (DNS)", en: "1/η (DNS)" }, labelOffset: 14 },
      ]);
      roE.set(r.eta.toExponential(2));
      roN.set(Math.pow(1 / r.eta, 3).toExponential(1));
      roK.set(r.k_les.toFixed(1));
      if (cost)
        pC.set([
          { x: cost.re, y: cost.dns, color: cssVar("--accent-3"), width: 2.4, label: { es: "DNS ~ Re^(37/14)", en: "DNS ~ Re^(37/14)" } },
          { x: cost.re, y: cost.wrles, color: cssVar("--accent"), width: 2.4, label: { es: "LES resolviendo pared ~ Re^(13/7)", en: "wall-resolved LES ~ Re^(13/7)" } },
          { x: cost.re, y: cost.wmles, color: cssVar("--good"), width: 2.4, label: { es: "LES con modelo de pared ~ Re", en: "wall-modelled LES ~ Re" } },
        ], [{ type: "vline", x: 1.5e7, color: cssVar("--accent-2"), label: { es: "F1 real", en: "full-scale F1" } }, { type: "vline", x: sRe.value, color: cssVar("--fg-dim") }]);
    });
  }
}

function yplusLab(host) {
  const ui = labLayout(host);
  const plot = new Plot(ui.viz, { height: 280, xlabel: { es: "y⁺", en: "y⁺" }, ylabel: { es: "u⁺", en: "u⁺" }, logX: true, ylim: [0, 30] });
  const sU = slider({ label: { es: "Velocidad U [m/s]", en: "Velocity U [m/s]" }, min: 10, max: 100, step: 1, value: 60, onInput: run });
  const sX = slider({ label: { es: "Distancia desde el borde de ataque x [m]", en: "Distance from leading edge x [m]" }, min: 0.05, max: 5, value: 0.5, log: true, format: (v) => v.toFixed(2), onInput: run });
  const sY = slider({ label: { es: "y⁺ objetivo de la primera celda", en: "Target first-cell y⁺" }, min: 0.3, max: 300, value: 1, log: true, format: (v) => v.toFixed(1), onInput: run });
  ui.controls.append(sU.el, sX.el, sY.el);
  const roDy = readout({ es: "Altura primera celda", en: "First-cell height" }, "μm");
  const roUt = readout({ es: "u_τ", en: "u_τ" }, "m/s");
  const roD = readout({ es: "Espesor capa límite δ", en: "Boundary-layer thickness δ" }, "mm");
  const roZ = readout({ es: "Zona", en: "Region" });
  ui.readouts.append(roDy.el, roUt.el, roD.el, roZ.el);
  const call = liveCall("yp", "cfd.first_cell", 30);
  function run() {
    call({ U: sU.value, x: sX.value, yplus: sY.value }, (r) => {
      plot.set([
        { x: r.wall.yplus, y: r.wall.uplus, color: cssVar("--accent"), width: 2.6, label: { es: "ley de pared", en: "law of the wall" } },
        { x: r.wall.yplus, y: r.wall.log, color: cssVar("--fg-dim"), dash: [4, 3], label: { es: "ley log", en: "log law" } },
      ], [
        { type: "band", x0: 5, x1: 30, color: "rgba(244,63,94,0.10)" },
        { type: "vline", x: sY.value, color: cssVar("--accent-2"), label: { es: "1ª celda", en: "1st cell" } },
      ]);
      roDy.set((r.dy * 1e6).toFixed(1));
      roUt.set(r.u_tau.toFixed(2));
      roD.set((r.delta * 1e3).toFixed(1));
      const y = sY.value;
      roZ.set(y < 1.5 ? L("subcapa: resuelve la pared (bajo Re)", "sublayer: wall-resolved (low-Re)") : y < 5 ? L("subcapa (aceptable)", "sublayer (acceptable)") : y < 30 ? L("BUFFER: evitar", "BUFFER: avoid") : y < 300 ? L("log: funciones de pared", "log: wall functions") : L("demasiado alto", "too high"), y < 5 ? "good" : y < 30 ? "bad" : y < 300 ? "warn" : "bad");
    });
  }
  ui.note.innerHTML = L(
    "Primera celda a partir del Cf turbulento de placa plana. Los modelos de bajo Reynolds (k-ω SST, Spalart-Allmaras) quieren y⁺ ≈ 1; las funciones de pared, 30 &lt; y⁺ &lt; 300. La zona buffer (rojo) es la peor elección.",
    "First cell from the turbulent flat-plate Cf. Low-Reynolds models (k-ω SST, Spalart-Allmaras) want y⁺ ≈ 1; wall functions want 30 &lt; y⁺ &lt; 300. The buffer layer (red) is the worst choice."
  );
  run();
}

const TABLE_ES = `<table class="tests"><thead><tr><th>Enfoque</th><th>Qué resuelve / modela</th><th>Uso típico</th></tr></thead><tbody>
<tr><td><b>DNS</b></td><td>Todas las escalas hasta Kolmogorov; sin modelo de turbulencia</td><td>Investigación, Re bajos, validación de modelos, física de transición</td></tr>
<tr><td><b>LES</b></td><td>Remolinos grandes resueltos; subred modelada (Smagorinsky, WALE, dinámico)</td><td>Flujos separados, estelas, aeroacústica, mezcla; caro cerca de paredes</td></tr>
<tr><td><b>DES / DDES / IDDES</b></td><td>RANS en la capa límite, LES en las zonas separadas</td><td>Estelas de ruedas, flujos masivamente separados, coche siguiendo a otro: muy usado en motorsport para casos detallados</td></tr>
<tr><td><b>URANS</b></td><td>RANS con término temporal; resuelve solo inestacionariedad de gran escala</td><td>Desprendimiento periódico, maniobras</td></tr>
<tr><td><b>RANS</b></td><td>Promedio de Reynolds; toda la turbulencia modelada (hipótesis de Boussinesq o RSM)</td><td>Caballo de batalla del diseño en F1: miles de simulaciones por barridos de geometría y actitud</td></tr></tbody></table>
<table class="tests" style="margin-top:12px"><thead><tr><th>Modelo RANS</th><th>Puntos fuertes / débiles</th></tr></thead><tbody>
<tr><td><b>Spalart-Allmaras</b> (1 ec.)</td><td>Aeronáutica externa, capas límite adheridas, robusto y barato; flojo en separación masiva y flujos libres</td></tr>
<tr><td><b>k-ε</b> (estándar, realizable, RNG)</td><td>Flujos libres, chorros; sobrestima k en zonas de remanso y no predice bien separación por gradiente adverso; necesita funciones de pared</td></tr>
<tr><td><b>k-ω (Wilcox)</b></td><td>Bueno cerca de la pared y con gradientes adversos; sensible al valor de ω de la corriente libre</td></tr>
<tr><td><b>k-ω SST (Menter)</b></td><td>k-ω cerca de la pared + k-ε fuera + limitador de tensión: estándar industrial para separación por gradiente adverso; muy usado en F1</td></tr>
<tr><td><b>γ-Reθ (Langtry-Menter)</b></td><td>Modelo de transición acoplado a SST: burbujas laminares, transición natural/bypass</td></tr>
<tr><td><b>RSM</b></td><td>Transporte de todas las tensiones de Reynolds: anisotropía, curvatura, rotación (vórtices); más caro y menos robusto</td></tr></tbody></table>`;
const TABLE_EN = `<table class="tests"><thead><tr><th>Approach</th><th>Resolves / models</th><th>Typical use</th></tr></thead><tbody>
<tr><td><b>DNS</b></td><td>All scales down to Kolmogorov; no turbulence model</td><td>Research, low Re, model validation, transition physics</td></tr>
<tr><td><b>LES</b></td><td>Large eddies resolved; subgrid modelled (Smagorinsky, WALE, dynamic)</td><td>Separated flows, wakes, aeroacoustics, mixing; expensive near walls</td></tr>
<tr><td><b>DES / DDES / IDDES</b></td><td>RANS in the boundary layer, LES in separated regions</td><td>Tyre wakes, massively separated flows, car-following: widely used in motorsport for detailed cases</td></tr>
<tr><td><b>URANS</b></td><td>RANS with a time term; resolves only large-scale unsteadiness</td><td>Periodic shedding, manoeuvres</td></tr>
<tr><td><b>RANS</b></td><td>Reynolds averaging; all turbulence modelled (Boussinesq hypothesis or RSM)</td><td>The workhorse of F1 design: thousands of runs for geometry and attitude sweeps</td></tr></tbody></table>
<table class="tests" style="margin-top:12px"><thead><tr><th>RANS model</th><th>Strengths / weaknesses</th></tr></thead><tbody>
<tr><td><b>Spalart-Allmaras</b> (1 eq.)</td><td>External aero, attached boundary layers, robust and cheap; weak for massive separation and free shear flows</td></tr>
<tr><td><b>k-ε</b> (standard, realizable, RNG)</td><td>Free shear flows, jets; overpredicts k at stagnation and mispredicts adverse-gradient separation; needs wall functions</td></tr>
<tr><td><b>k-ω (Wilcox)</b></td><td>Good near walls and in adverse gradients; sensitive to free-stream ω</td></tr>
<tr><td><b>k-ω SST (Menter)</b></td><td>k-ω near the wall + k-ε outside + stress limiter: industry standard for adverse-gradient separation; widely used in F1</td></tr>
<tr><td><b>γ-Reθ (Langtry-Menter)</b></td><td>Transition model coupled to SST: laminar bubbles, natural/bypass transition</td></tr>
<tr><td><b>RSM</b></td><td>Transports every Reynolds stress: anisotropy, curvature, rotation (vortices); more expensive, less robust</td></tr></tbody></table>`;

export default {
  subtitle: {
    es: "El problema del cierre, escalas de la turbulencia, RANS vs LES vs DNS, modelos de turbulencia, y+ y buenas prácticas de malla.",
    en: "The closure problem, turbulence scales, RANS vs LES vs DNS, turbulence models, y+ and meshing best practice.",
  },
  heroParams: { eps: 0.1, camber: 0.08, alpha: 7 },
  intuition: {
    es: R`<p>Las ecuaciones de Navier-Stokes describen perfectamente un flujo turbulento, pero la turbulencia contiene remolinos desde el tamaño del coche hasta fracciones de milímetro (la <span class="term">escala de Kolmogorov</span>). Resolverlos todos (<b>DNS</b>) cuesta del orden de \(Re^{9/4}\)–\(Re^{37/14}\) puntos: imposible para un coche a \(Re\sim10^7\).</p>
    <p>Las alternativas: <b>LES</b> resuelve los remolinos grandes (los que llevan la energía y dependen de la geometría) y modela los pequeños (más universales); <b>RANS</b> promedia en el tiempo y modela toda la turbulencia con ecuaciones adicionales (k-ε, k-ω SST, Spalart-Allmaras...). RANS es barato y es el caballo de batalla del diseño; LES/DES se reservan para flujos muy separados e inestacionarios (estelas de rueda, seguir a otro coche). El reglamento de F1 limita además los recursos de CFD (ATR).</p>`,
    en: R`<p>The Navier-Stokes equations describe turbulent flow perfectly, but turbulence contains eddies from the size of the car down to fractions of a millimetre (the <span class="term">Kolmogorov scale</span>). Resolving them all (<b>DNS</b>) costs of the order of \(Re^{9/4}\)–\(Re^{37/14}\) points: impossible for a car at \(Re\sim10^7\).</p>
    <p>The alternatives: <b>LES</b> resolves the large eddies (energy-carrying, geometry-dependent) and models the small ones (more universal); <b>RANS</b> time-averages and models all turbulence with extra equations (k-ε, k-ω SST, Spalart-Allmaras...). RANS is cheap and the workhorse of design; LES/DES are kept for highly separated, unsteady flows (tyre wakes, following another car). F1 rules also cap CFD resources (ATR).</p>`,
  },
  physics: {
    es: R`<p><b>Promedio de Reynolds</b> \(u=\bar u+u'\): $$\rho\frac{D\bar u_i}{Dt}=-\frac{\partial\bar p}{\partial x_i}+\frac{\partial}{\partial x_j}\left(2\mu\bar S_{ij}-\rho\overline{u_i'u_j'}\right)$$ Las tensiones de Reynolds \(-\rho\overline{u_i'u_j'}\) son 6 incógnitas nuevas: <b>problema del cierre</b>. Hipótesis de Boussinesq: \(-\rho\overline{u_i'u_j'}=2\mu_t\bar S_{ij}-\tfrac23\rho k\delta_{ij}\) con viscosidad turbulenta \(\mu_t\) modelada (\(\mu_t=\rho C_\mu k^2/\varepsilon\) o \(\rho k/\omega\)).</p>
    <p><b>Escalas</b>: Kolmogorov \(\eta=(\nu^3/\varepsilon)^{1/4}\), \(\eta/L\sim Re_L^{-3/4}\) ⇒ DNS \(N\sim Re_L^{9/4}\) puntos (isótropa); capa límite (Choi & Moin): DNS \(\sim Re^{37/14}\), LES resolviendo pared \(\sim Re^{13/7}\), LES con modelo de pared \(\sim Re\).</p>
    <p><b>Malla</b>: primera celda con \(y^+\approx1\) para modelos de bajo Re o \(30<y^+<300\) con funciones de pared; capas prismáticas con crecimiento ≲ 1.2; refinar estelas, vórtices y zonas de separación; estudio de independencia de malla; convergencia de residuos y de fuerzas; validar con túnel y correlacionar con pista.</p>`,
    en: R`<p><b>Reynolds averaging</b> \(u=\bar u+u'\): $$\rho\frac{D\bar u_i}{Dt}=-\frac{\partial\bar p}{\partial x_i}+\frac{\partial}{\partial x_j}\left(2\mu\bar S_{ij}-\rho\overline{u_i'u_j'}\right)$$ The Reynolds stresses \(-\rho\overline{u_i'u_j'}\) are 6 new unknowns: the <b>closure problem</b>. Boussinesq hypothesis: \(-\rho\overline{u_i'u_j'}=2\mu_t\bar S_{ij}-\tfrac23\rho k\delta_{ij}\) with a modelled eddy viscosity \(\mu_t\) (\(\mu_t=\rho C_\mu k^2/\varepsilon\) or \(\rho k/\omega\)).</p>
    <p><b>Scales</b>: Kolmogorov \(\eta=(\nu^3/\varepsilon)^{1/4}\), \(\eta/L\sim Re_L^{-3/4}\) ⇒ DNS \(N\sim Re_L^{9/4}\) points (isotropic); boundary layer (Choi & Moin): DNS \(\sim Re^{37/14}\), wall-resolved LES \(\sim Re^{13/7}\), wall-modelled LES \(\sim Re\).</p>
    <p><b>Mesh</b>: first cell at \(y^+\approx1\) for low-Re models or \(30<y^+<300\) with wall functions; prism layers with growth ≲ 1.2; refine wakes, vortices and separated regions; grid-independence study; residual and force convergence; validate against the tunnel and correlate with the track.</p>`,
  },
  labs: [
    { title: { es: "Cascada de energía: qué resuelve cada método", en: "Energy cascade: what each method resolves" }, mount: spectrumLab },
    { title: { es: "Calculadora de y⁺ y primera celda", en: "y⁺ and first-cell calculator" }, mount: yplusLab },
    {
      title: { es: "Chuleta de métodos y modelos", en: "Methods and models cheat sheet" },
      mount: (h) => {
        h.innerHTML = `<div class="i-es">${TABLE_ES}</div><div class="i-en">${TABLE_EN}</div>`;
      },
    },
  ],
  interview: [
    { q: { es: "RANS vs LES vs DNS: ¿qué es cada uno y cuándo se usa?", en: "RANS vs LES vs DNS: what is each and when is it used?" }, a: { es: R`<p><b>DNS</b>: resuelve todas las escalas, sin modelo; solo Re bajos/investigación. <b>LES</b>: resuelve los remolinos grandes y modela la subred; para flujos separados, estelas y acústica; caro cerca de paredes (por eso los híbridos <b>DES/DDES/IDDES</b>: RANS en la capa límite, LES fuera). <b>RANS</b>: promedia y modela toda la turbulencia; rápido, base del diseño iterativo en F1 (k-ω SST, SA), con limitaciones en separación masiva e inestacionariedad.</p>`, en: R`<p><b>DNS</b>: resolves all scales, no model; only low Re/research. <b>LES</b>: resolves the large eddies, models the subgrid; for separated flows, wakes and acoustics; expensive near walls (hence hybrids <b>DES/DDES/IDDES</b>: RANS in the boundary layer, LES outside). <b>RANS</b>: averages and models all turbulence; fast, the basis of iterative F1 design (k-ω SST, SA), limited for massive separation and unsteadiness.</p>` } },
    { q: { es: "¿Qué modelos de turbulencia conoces y cuál usarías para un alerón en efecto suelo?", en: "Which turbulence models do you know and which would you use for a wing in ground effect?" }, a: { es: R`<p>Spalart-Allmaras, k-ε (estándar/realizable/RNG), k-ω Wilcox, k-ω SST, γ-Reθ (transición), RSM. Para un alerón en efecto suelo, con gradientes adversos fuertes y separación en la recuperación: <b>k-ω SST</b> con \(y^+\approx1\) (posiblemente con γ-Reθ si hay transición/burbujas a escala de túnel); para la estela y vórtices inestacionarios, DDES.</p>`, en: R`<p>Spalart-Allmaras, k-ε (standard/realizable/RNG), k-ω Wilcox, k-ω SST, γ-Reθ (transition), RSM. For a wing in ground effect, with strong adverse gradients and separation in the recovery: <b>k-ω SST</b> with \(y^+\approx1\) (possibly γ-Reθ if transition/bubbles matter at tunnel scale); for the wake and unsteady vortices, DDES.</p>` } },
    { q: { es: "¿Qué es y+ y qué pasa si la primera celda cae en la zona buffer?", en: "What is y+ and what happens if the first cell lands in the buffer layer?" }, a: { es: R`<p>\(y^+=yu_\tau/\nu\). Ni la integración hasta la pared (que necesita y⁺ ≈ 1) ni las funciones de pared (que asumen y⁺ en la zona log) son válidas en 5 &lt; y⁺ &lt; 30: se calcula mal \(\tau_w\), la transferencia de calor y, sobre todo, la posición de la separación.</p>`, en: R`<p>\(y^+=yu_\tau/\nu\). Neither wall integration (needs y⁺ ≈ 1) nor wall functions (assume y⁺ in the log region) are valid for 5 &lt; y⁺ &lt; 30: \(\tau_w\), heat transfer and above all the separation location are mispredicted.</p>` } },
  ],
  myths: [
    { es: "«LES siempre es mejor que RANS». Solo si la malla y el paso de tiempo son adecuados; un LES mal resuelto puede ser peor y cuesta 10–100 veces más.", en: "“LES is always better than RANS”. Only with adequate mesh and time step; an under-resolved LES can be worse and costs 10–100 times more." },
    { es: "«CFD converge = CFD correcto». Hay que comprobar independencia de malla, sensibilidad al modelo y validar con experimentos.", en: "“Converged CFD = correct CFD”. Grid independence, model sensitivity and experimental validation must be checked." },
  ],
  quiz: [
    { q: { es: "El número de puntos de una DNS isótropa escala como…", en: "The number of points of an isotropic DNS scales as…" }, options: [{ es: "Re", en: "Re" }, { es: "Re^(9/4)", en: "Re^(9/4)" }, { es: "Re^(1/2)", en: "Re^(1/2)" }, { es: "log Re", en: "log Re" }], correct: 1, explain: { es: "(L/η)³ con η/L ~ Re^(−3/4).", en: "(L/η)³ with η/L ~ Re^(−3/4)." } },
    { q: { es: "El modelo estándar de la industria para separación por gradiente adverso es…", en: "The industry-standard model for adverse-gradient separation is…" }, options: [{ es: "k-ε estándar", en: "standard k-ε" }, { es: "k-ω SST", en: "k-ω SST" }, { es: "Smagorinsky", en: "Smagorinsky" }, { es: "flujo potencial", en: "potential flow" }], correct: 1, explain: { es: "Menter (1994): k-ω en la pared, k-ε fuera y limitador de tensión.", en: "Menter (1994): k-ω at the wall, k-ε outside and a stress limiter." } },
  ],
  refs: [
    "S.B. Pope, <i>Turbulent Flows</i>, CUP, 2000.",
    "F.R. Menter, “Two-equation eddy-viscosity turbulence models for engineering applications”, <i>AIAA J.</i> 32(8), 1994.",
    "H. Choi & P. Moin, “Grid-point requirements for large eddy simulation”, <i>Phys. Fluids</i> 24, 2012.",
    "P.R. Spalart, “Detached-eddy simulation”, <i>Annu. Rev. Fluid Mech.</i> 41, 2009.",
    "D.C. Wilcox, <i>Turbulence Modeling for CFD</i>, 3rd ed., DCW Industries.",
  ],
};
