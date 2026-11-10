import { slider, labLayout, readout, button, L, tr, engineBadge, canvasBox, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics } from "../js/bridge/physics.js";

const R = String.raw;

function khLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 300 });
  const wait = engineBadge(box);
  const plot = new Plot(ui.viz, { height: 200, xlabel: { es: "tiempo t·ΔU/λ_periodo", en: "time t·ΔU/λ_period" }, ylabel: { es: "espesor de la capa (pico a pico)", en: "layer thickness (peak to peak)" }, logY: true });
  const sAmp = slider({ label: { es: "Perturbación inicial", en: "Initial disturbance" }, min: 0.002, max: 0.05, step: 0.001, value: 0.01 });
  const sSub = slider({ label: { es: "Subarmónico (provoca emparejamiento)", en: "Subharmonic (triggers pairing)" }, min: 0, max: 1, step: 0.05, value: 0.3 });
  const sDel = slider({ label: { es: "Regularización δ (núcleo)", en: "Regularisation δ (core)" }, min: 0.05, max: 0.3, step: 0.01, value: 0.15 });
  const bGo = button({ es: "▶ Reiniciar simulación", en: "▶ Restart simulation" }, start, "primary");
  ui.controls.append(sAmp.el, sSub.el, sDel.el, bGo);
  const roT = readout({ es: "t", en: "t" });
  const roTh = readout({ es: "Espesor", en: "Thickness" });
  ui.readouts.append(roT.el, roTh.el);
  ui.note.innerHTML = L(
    R`Lámina de vórtices periódica (salto de velocidad ΔU = 1) discretizada con 200 vórtices regularizados (Krasny 1986), integrada en Python con RK4. Se ve la <b>inestabilidad de Kelvin-Helmholtz</b>: crecimiento exponencial \(\sigma = k\Delta U/2\), enrollamiento en vórtices y, con subarmónico, <b>emparejamiento</b> que duplica la escala: así crece una capa de mezcla.`,
    R`Periodic vortex sheet (velocity jump ΔU = 1) discretised with 200 regularised vortices (Krasny 1986), integrated in Python with RK4. You see the <b>Kelvin-Helmholtz instability</b>: exponential growth \(\sigma = k\Delta U/2\), roll-up into vortices and, with a subharmonic, <b>pairing</b> that doubles the scale: this is how a mixing layer grows.`
  );
  let st = null, t = 0, hist = [], run = 0;
  async function start() {
    const my = ++run;
    t = 0;
    hist = [];
    st = await physics.call("vortex.kh_init", { n: 200, amp: sAmp.value, subharmonic: sSub.value, wavelengths: 2 });
    wait.remove();
    while (my === run && t < 3.2 && document.body.contains(box)) {
      const r = await physics.call("vortex.kh_step", { x: st.x, y: st.y, dt: 0.01, n_steps: 5, delta: sDel.value, save_every: 5 });
      if (my !== run) return;
      st = { x: r.x, y: r.y };
      t += 0.05;
      hist.push([t, Math.max(r.thickness, 1e-4)]);
      draw();
    }
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
    const sc = W / 2; // show two periods (x in [0,2))
    const yc = H / 2;
    const X = (x) => x * sc, Y = (y) => yc - y * sc;
    // fast stream (upper) and slow stream (lower) colours
    g.fillStyle = "rgba(34,211,238,0.22)";
    g.fillRect(0, 0, W, H);
    g.fillStyle = "rgba(251,146,60,0.25)";
    g.beginPath();
    g.moveTo(0, H);
    for (const off of [0, 1]) st.x.forEach((x, i) => g.lineTo(X(x + off), Y(st.y[i])));
    g.lineTo(W, H);
    g.closePath();
    g.fill();
    g.strokeStyle = cssVar("--fg");
    g.lineWidth = 1.6;
    g.beginPath();
    for (const off of [-1, 0, 1, 2]) st.x.forEach((x, i) => (i === 0 && off === -1 ? g.moveTo(X(x + off), Y(st.y[i])) : g.lineTo(X(x + off), Y(st.y[i]))));
    g.stroke();
    g.fillStyle = cssVar("--fg");
    g.font = "12px Inter";
    g.fillText(tr({ es: "→ corriente rápida (+ΔU/2)", en: "→ fast stream (+ΔU/2)" }), 10, 18);
    g.fillText(tr({ es: "← corriente lenta (−ΔU/2) (sistema que se mueve con la media)", en: "← slow stream (−ΔU/2) (frame moving with the mean)" }), 10, H - 10);
    roT.set(t.toFixed(2));
    roTh.set(hist.length ? hist[hist.length - 1][1].toFixed(3) : "–");
    const sig = 0.5 * 2 * Math.PI * 2;
    const a0 = hist.length ? hist[0][1] : 0.02;
    plot.set([
      { x: hist.map((h) => h[0]), y: hist.map((h) => h[1]), color: cssVar("--accent"), width: 2.5, label: { es: "simulación", en: "simulation" } },
      { x: [0, 1.2], y: [a0, a0 * Math.exp(sig * 1.2)], color: cssVar("--fg-dim"), dash: [4, 3], label: { es: "teoría lineal e^(σt), σ = kΔU/2", en: "linear theory e^(σt), σ = kΔU/2" } },
    ]);
  }
  start();
}

export default {
  subtitle: {
    es: "Capas de mezcla, estelas y chorros: inestabilidad de Kelvin-Helmholtz, enrollamiento, emparejamiento y entrainment.",
    en: "Mixing layers, wakes and jets: Kelvin-Helmholtz instability, roll-up, pairing and entrainment.",
  },
  heroParams: { eps: 0.15, camber: 0.0, alpha: 0 },
  intuition: {
    es: R`<p>Una <span class="term">capa de cortadura</span> (<i>shear layer</i>) es una zona delgada donde la velocidad cambia bruscamente entre dos corrientes: el borde de una zona separada, la frontera de un chorro, la estela de un alerón, el flujo que sale del difusor o el que sale de detrás de un Gurney. Es una lámina de vorticidad libre, sin pared que la estabilice, y por eso es <b>muy inestable</b>.</p>
    <p>Cualquier ondulación crece (<span class="term">Kelvin-Helmholtz</span>): en las crestas la corriente rápida se acelera y la presión baja, lo que tira de la cresta todavía más. La lámina se enrolla en vórtices discretos, que después se <b>emparejan</b> y crecen; en el proceso arrastran fluido de ambas corrientes hacia la capa (<span class="term">entrainment</span>), que se engrosa linealmente con la distancia. Este mezclado es lo que hace que una capa límite separada pueda reanclarse (burbuja laminar) y lo que disipa energía en una estela.</p>`,
    en: R`<p>A <span class="term">shear layer</span> is a thin region where velocity changes sharply between two streams: the edge of a separated region, a jet boundary, a wing wake, the flow leaving a diffuser or behind a Gurney flap. It is a free vorticity sheet, with no wall to stabilise it, and therefore <b>highly unstable</b>.</p>
    <p>Any wave grows (<span class="term">Kelvin-Helmholtz</span>): at the crests the fast stream speeds up and pressure drops, pulling the crest further. The sheet rolls up into discrete vortices which then <b>pair</b> and grow; in doing so they draw fluid from both streams into the layer (<span class="term">entrainment</span>), which thickens linearly with distance. This mixing is what lets a separated boundary layer reattach (laminar bubble) and what dissipates energy in a wake.</p>`,
  },
  physics: {
    es: R`<p><b>Lámina de vórtices</b> de intensidad \(\gamma=\Delta U\) entre \(U_1\) y \(U_2\). Análisis lineal (no viscoso) de una perturbación \(\eta=\hat\eta e^{ikx+\sigma t}\): $$\sigma=\frac{k\,\Delta U}{2}\quad(\text{densidades iguales})$$ todas las longitudes de onda son inestables, las cortas más (en la realidad el espesor finito \(\delta_\omega\) corta la inestabilidad para \(k\delta_\omega\gtrsim 1\); máxima amplificación a \(k\delta_\omega\approx0.44\) según Michalke).</p>
    <p><b>Crecimiento de la capa de mezcla</b> turbulenta (autosemejante): $$\frac{d\delta_\omega}{dx}\approx 0.18\,\frac{U_1-U_2}{U_1+U_2}\quad(\text{espesor de vorticidad})$$</p>
    <p><b>Estela y chorro</b>: el déficit de velocidad de una estela 2D decae como \(x^{-1/2}\) y su anchura crece como \(x^{1/2}\); el déficit de cantidad de movimiento integrado es la resistencia (\(D'=\rho U^2\theta_\infty\)). Un rake de estela mide precisamente eso.</p>
    <p><b>En un F1</b>: las capas de cortadura del borde del suelo y del difusor generan y alimentan vórtices; la estela del coche de delante (aire "sucio") es una región turbulenta de baja presión total que reduce la carga del que va detrás.</p>`,
    en: R`<p><b>Vortex sheet</b> of strength \(\gamma=\Delta U\) between \(U_1\) and \(U_2\). Linear (inviscid) analysis of a disturbance \(\eta=\hat\eta e^{ikx+\sigma t}\): $$\sigma=\frac{k\,\Delta U}{2}\quad(\text{equal densities})$$ all wavelengths are unstable, short ones most (in reality the finite thickness \(\delta_\omega\) cuts the instability off for \(k\delta_\omega\gtrsim 1\); maximum amplification at \(k\delta_\omega\approx0.44\), Michalke).</p>
    <p><b>Turbulent mixing-layer growth</b> (self-similar): $$\frac{d\delta_\omega}{dx}\approx 0.18\,\frac{U_1-U_2}{U_1+U_2}\quad(\text{vorticity thickness})$$</p>
    <p><b>Wakes and jets</b>: the velocity deficit of a 2D wake decays as \(x^{-1/2}\) and its width grows as \(x^{1/2}\); the integrated momentum deficit is the drag (\(D'=\rho U^2\theta_\infty\)). A wake rake measures exactly that.</p>
    <p><b>On an F1 car</b>: shear layers from floor edges and the diffuser create and feed vortices; the leading car's wake ("dirty air") is a turbulent region of low total pressure that reduces the follower's downforce.</p>`,
  },
  labs: [{ title: { es: "Inestabilidad de Kelvin-Helmholtz y emparejamiento", en: "Kelvin-Helmholtz instability and pairing" }, desc: { es: "Sin subarmónico verás dos vórtices por periodo; con subarmónico se emparejan en uno.", en: "Without subharmonic you see two vortices per period; with it they pair into one." }, mount: khLab }],
  interview: [
    { q: { es: "¿Qué es una shear layer y por qué es inestable?", en: "What is a shear layer and why is it unstable?" }, a: { es: R`<p>Zona de fuerte gradiente transversal de velocidad entre dos corrientes, sin pared. Es una lámina de vorticidad; su perfil de velocidad tiene punto de inflexión (criterio de Rayleigh/Fjørtoft), así que es inestable de forma no viscosa (Kelvin-Helmholtz): las perturbaciones crecen exponencialmente, se enrolla en vórtices que se emparejan y se vuelve turbulenta muy rápido.</p>`, en: R`<p>A region of strong transverse velocity gradient between two streams, with no wall. It is a vorticity sheet whose velocity profile has an inflection point (Rayleigh/Fjørtoft criterion), so it is inviscidly unstable (Kelvin-Helmholtz): disturbances grow exponentially, it rolls up into vortices that pair and it becomes turbulent very quickly.</p>` } },
    { q: { es: "¿Por qué una capa límite separada laminar puede volver a pegarse?", en: "Why can a separated laminar boundary layer reattach?" }, a: { es: R`<p>La capa de cortadura que forma al separarse transiciona enseguida (K-H). La mezcla turbulenta transporta cantidad de movimiento hacia la zona de recirculación y hacia la pared, y la capa "se ensancha" hasta tocar la superficie: reanclaje turbulento, cerrando una burbuja de separación laminar.</p>`, en: R`<p>The shear layer formed at separation transitions almost immediately (K-H). Turbulent mixing carries momentum towards the recirculation and the wall, and the layer spreads until it touches the surface: turbulent reattachment, closing a laminar separation bubble.</p>` } },
    { q: { es: "¿Qué relación hay entre la estela y la resistencia?", en: "How are the wake and drag related?" }, a: { es: R`<p>Por conservación de cantidad de movimiento, la resistencia de perfil es igual al déficit de flujo de cantidad de movimiento en la estela: \(D'=\rho\int u(U-u)\,dy\) lejos aguas abajo (o con correcciones de presión cerca). Medir el déficit de presión total con un rake de estela da la resistencia de perfil en túnel.</p>`, en: R`<p>By momentum conservation, profile drag equals the momentum-flux deficit in the wake: \(D'=\rho\int u(U-u)\,dy\) far downstream (with pressure corrections closer). Measuring the total-pressure deficit with a wake rake gives profile drag in a tunnel.</p>` } },
  ],
  myths: [
    { es: "«Las capas de cortadura solo existen con turbulencia». La lámina de vórtices ideal es una shear layer infinitamente delgada; la turbulencia es el resultado de su inestabilidad.", en: "“Shear layers only exist with turbulence”. An ideal vortex sheet is an infinitely thin shear layer; turbulence is the result of its instability." },
    { es: "«La estela de un coche desaparece rápido». El déficit decae lentamente (∝ x^(−1/2) en 2D, x^(−2/3) en 3D axisimétrica): un coche a varias longitudes detrás sigue dentro.", en: "“A car's wake disappears quickly”. The deficit decays slowly (∝ x^(−1/2) in 2D, x^(−2/3) for 3D axisymmetric): a car several lengths behind is still inside it." },
  ],
  quiz: [
    { q: { es: "La tasa de crecimiento lineal de K-H para una lámina de vórtices es…", en: "The linear K-H growth rate of a vortex sheet is…" }, options: [{ es: "σ = kΔU/2", en: "σ = kΔU/2" }, { es: "σ = ΔU/k", en: "σ = ΔU/k" }, { es: "σ = 0", en: "σ = 0" }, { es: "σ = k²ν", en: "σ = k²ν" }], correct: 0, explain: { es: "Para densidades iguales; las ondas cortas crecen más rápido.", en: "For equal densities; short waves grow fastest." } },
    { q: { es: "El emparejamiento de vórtices en una capa de mezcla…", en: "Vortex pairing in a mixing layer…" }, options: [{ es: "reduce su espesor", en: "reduces its thickness" }, { es: "duplica la escala dominante y la hace crecer", en: "doubles the dominant scale and makes it grow" }, { es: "elimina la vorticidad", en: "removes vorticity" }, { es: "solo ocurre en supersónico", en: "only happens in supersonic flow" }], correct: 1, explain: { es: "Es el mecanismo de crecimiento (Winant & Browand 1974).", en: "It is the growth mechanism (Winant & Browand 1974)." } },
  ],
  refs: [
    "R. Krasny, “Desingularization of periodic vortex sheet roll-up”, <i>J. Comput. Phys.</i> 65 (1986).",
    "G.L. Brown & A. Roshko, “On density effects and large structure in turbulent mixing layers”, <i>JFM</i> 64 (1974).",
    "C.D. Winant & F.K. Browand, “Vortex pairing”, <i>JFM</i> 63 (1974).",
    "S.B. Pope, <i>Turbulent Flows</i>, ch. 5 (free shear flows).",
  ],
};
