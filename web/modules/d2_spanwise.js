import { slider, labLayout, readout, button, L, tr, canvasBox, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;
const N = 41;
const ys = [...Array(N).keys()].map((i) => -0.5 + i / (N - 1));

const SHAPES = {
  elliptic: { es: "Elíptica", en: "Elliptic", f: (y) => Math.sqrt(Math.max(0, 1 - 4 * y * y)) },
  rect: { es: "Casi uniforme (cae solo en la punta)", en: "Near-uniform (drops only at the tip)", f: (y) => Math.pow(Math.max(0, 1 - Math.pow(2 * Math.abs(y), 12)), 0.5) },
  tri: { es: "Triangular (pico central)", en: "Triangular (central peak)", f: (y) => Math.max(0, 1 - 2 * Math.abs(y)) },
  bimodal: { es: "Cargada en las puntas", en: "Tip-loaded", f: (y) => Math.sqrt(Math.max(0, 1 - 4 * y * y)) * (0.55 + 1.8 * y * y) },
};

function drawLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 240 });
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pW = new Plot(row, { height: 220, xlabel: { es: "y / b", en: "y / b" }, ylabel: { es: "downwash αi (a igual CL)", en: "downwash αi (same CL)" } });
  const pS = new Plot(row, { height: 220, xlabel: { es: "y / b", en: "y / b" }, ylabel: { es: "vorticidad desprendida −dΓ/dy", en: "shed vorticity −dΓ/dy" } });
  let g = ys.map((y) => SHAPES.rect.f(y));
  const presets = el("div", { class: "seg-row" });
  for (const [k, s] of Object.entries(SHAPES)) presets.appendChild(button({ es: s.es, en: s.en }, () => ((g = ys.map(s.f)), run())));
  const sAR = slider({ label: { es: "AR", en: "AR" }, min: 2, max: 12, step: 0.5, value: 4, onInput: run });
  ui.controls.append(el("div", { class: "ctl-label" }, L("Preajustes (o dibuja con el ratón sobre la gráfica superior):", "Presets (or draw with the mouse on the top chart):")), presets, sAR.el);
  const roE = readout({ es: "e (eficiencia de envergadura)", en: "e (span efficiency)" });
  const roC = readout({ es: "CDi a CL = 1", en: "CDi at CL = 1" });
  const roD = readout({ es: "δ = Σ n Aₙ²/A₁² − 1", en: "δ = Σ n Aₙ²/A₁² − 1" });
  ui.readouts.append(roE.el, roC.el, roD.el);
  ui.note.innerHTML = L(
    R`Python ajusta una serie de Fourier a tu Γ(y) y calcula downwash y \(C_{D_i}\). Fíjate en la gráfica derecha: cada <b>gradiente spanwise de carga</b> (\(d\Gamma/dy\)) desprende vorticidad a la estela. La elíptica reparte ese desprendimiento de modo que el downwash es <b>uniforme</b> y la energía dejada en la estela es mínima.`,
    R`Python fits a Fourier series to your Γ(y) and computes downwash and \(C_{D_i}\). Look at the right chart: every <b>spanwise load gradient</b> (\(d\Gamma/dy\)) sheds vorticity into the wake. The elliptic load distributes that shedding so that downwash is <b>uniform</b> and the energy left in the wake is minimal.`
  );
  // drawing
  let drawing = false;
  const toData = (ev) => {
    const r = canvas.getBoundingClientRect();
    const x = (ev.clientX - r.left) / r.width;
    const yv = 1 - (ev.clientY - r.top - 20) / (r.height - 40);
    return [-0.5 + x, Math.max(0, Math.min(1.3, yv))];
  };
  canvas.addEventListener("pointerdown", (e) => {
    drawing = true;
    canvas.setPointerCapture(e.pointerId);
    paint(e);
  });
  canvas.addEventListener("pointermove", (e) => drawing && paint(e));
  canvas.addEventListener("pointerup", () => {
    drawing = false;
    g[0] = g[N - 1] = 0;
    run();
  });
  function paint(e) {
    const [y, v] = toData(e);
    const i = Math.round((y + 0.5) * (N - 1));
    for (const k of [i, N - 1 - i]) if (k > 0 && k < N - 1) g[k] = v;
    drawCanvas(null);
  }
  let fit = null;
  function drawCanvas(r) {
    const dpr = window.devicePixelRatio || 1;
    const W = box.clientWidth, H = box.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const c = canvas.getContext("2d");
    c.setTransform(dpr, 0, 0, dpr, 0, 0);
    c.fillStyle = cssVar("--panel-2");
    c.fillRect(0, 0, W, H);
    const X = (y) => (y + 0.5) * W, Y = (v) => H - 20 - v * (H - 40);
    c.strokeStyle = cssVar("--grid");
    for (let k = 0; k <= 4; k++) {
      c.beginPath();
      c.moveTo(0, Y(k / 4));
      c.lineTo(W, Y(k / 4));
      c.stroke();
    }
    // wing outline
    c.fillStyle = cssVar("--body-fill");
    c.fillRect(X(-0.5), H - 14, W, 6);
    c.fillStyle = "rgba(34,211,238,0.18)";
    c.beginPath();
    c.moveTo(X(-0.5), Y(0));
    ys.forEach((y, i) => c.lineTo(X(y), Y(g[i])));
    c.lineTo(X(0.5), Y(0));
    c.fill();
    c.strokeStyle = cssVar("--accent");
    c.lineWidth = 2.5;
    c.beginPath();
    ys.forEach((y, i) => (i ? c.lineTo(X(y), Y(g[i])) : c.moveTo(X(y), Y(g[i]))));
    c.stroke();
    if (fit) {
      const gm = Math.max(...fit.gamma.map(Math.abs), 1e-9);
      const gsc = Math.max(...g) / gm;
      c.strokeStyle = cssVar("--accent-2");
      c.setLineDash([5, 4]);
      c.lineWidth = 1.5;
      c.beginPath();
      fit.y.forEach((y, i) => (i ? c.lineTo(X(y), Y(fit.gamma[i] * gsc)) : c.moveTo(X(y), Y(fit.gamma[i] * gsc))));
      c.stroke();
      c.setLineDash([]);
    }
    c.fillStyle = cssVar("--fg-muted");
    c.font = "12px Inter";
    c.fillText(tr({ es: "Γ(y): dibuja aquí (simétrica)", en: "Γ(y): draw here (symmetric)" }), 10, 16);
  }
  const call = liveCall("draw", "ll.from_gamma", 40);
  function run() {
    drawCanvas(null);
    call({ y: ys, gamma: g, AR: sAR.value }, (r) => {
      fit = r;
      drawCanvas(r);
      const A1 = r.A[0] || 1e-9;
      // normalise to CL = 1: alpha_i scales with 1/A1 * CL/(pi AR)
      const k = 1 / (Math.PI * sAR.value * A1);
      pW.set([{ x: r.y, y: r.alpha_i_deg.map((a) => a * k), color: cssVar("--accent-2"), width: 2.4, label: { es: "αi [°] a CL = 1", en: "αi [°] at CL = 1" } }], [{ type: "hline", y: (1 / (Math.PI * sAR.value)) * (180 / Math.PI), color: cssVar("--good"), label: { es: "elíptica (uniforme)", en: "elliptic (uniform)" } }]);
      pS.set([{ x: r.y, y: r.shed.map((s) => s * k), color: cssVar("--accent-3"), width: 2.4, fill: "zero", label: { es: "−dΓ/dy", en: "−dΓ/dy" } }]);
      roE.set(r.e.toFixed(3), r.e > 0.99 ? "good" : r.e < 0.85 ? "bad" : "warn");
      roC.set((1 / (Math.PI * sAR.value * r.e)).toFixed(4));
      roD.set(r.delta.toFixed(3));
    });
  }
  run();
}

function contestLab(host) {
  const ui = labLayout(host, { stack: true });
  const plot = new Plot(ui.viz, { height: 240, xlabel: { es: "y / b", en: "y / b" }, ylabel: { es: "carga Γ(y) (misma sustentación total)", en: "load Γ(y) (same total lift)" } });
  const res = el("div", { class: "seg-row" });
  ui.controls.append(el("div", { class: "ctl-label" }, L("Las cuatro distribuciones tienen la misma envergadura y la misma sustentación. ¿Cuál tiene menos resistencia inducida? Elige:", "All four distributions have the same span and the same lift. Which has the least induced drag? Pick one:")), res);
  const out = el("div", { class: "callout" });
  ui.note.appendChild(out);
  const keys = Object.keys(SHAPES);
  const cols = [cssVar("--accent"), cssVar("--accent-2"), cssVar("--accent-3"), cssVar("--good")];
  let results = null;
  Promise.all(keys.map((k) => physics.call("ll.from_gamma", { y: ys, gamma: ys.map(SHAPES[k].f), AR: 4 }))).then((rs) => {
    results = rs;
    // normalise each to unit lift (A1)
    plot.set(rs.map((r, i) => ({ x: r.y, y: r.gamma.map((v) => v / (r.A[0] * 2)), color: cols[i], width: 2.4, label: { es: SHAPES[keys[i]].es, en: SHAPES[keys[i]].en } })));
  });
  keys.forEach((k, i) => {
    res.appendChild(button({ es: SHAPES[k].es, en: SHAPES[k].en }, () => {
      if (!results) return;
      const es = results.map((r) => r.e);
      const best = es.indexOf(Math.max(...es));
      const lines = keys.map((kk, j) => `${L(SHAPES[kk].es, SHAPES[kk].en)}: e = <b>${es[j].toFixed(3)}</b>, CDi/CDi,elíptica = ${(es[best] / es[j]).toFixed(2)}`).join("<br>");
      out.innerHTML = (i === best ? "✅ " : "❌ ") + L("La mínima resistencia inducida es la <b>elíptica</b>: downwash uniforme y el menor gradiente de carga posible a lo largo de la envergadura (la vorticidad se desprende de forma «repartida», sin concentraciones).<br>", "Minimum induced drag is the <b>elliptic</b> one: uniform downwash and the gentlest possible load gradient along the span (vorticity is shed in a “spread” way, without concentrations).<br>") + lines;
    }));
  });
}

export default {
  subtitle: {
    es: "Por qué la carga elíptica minimiza la resistencia inducida: gradientes de presión spanwise, vorticidad desprendida y downwash uniforme.",
    en: "Why elliptic loading minimises induced drag: spanwise pressure gradients, shed vorticity and uniform downwash.",
  },
  heroParams: { eps: 0.1, camber: 0.05, alpha: 4 },
  intuition: {
    es: R`<p>A lo largo de la envergadura la diferencia de presión entre intradós y extradós (la <b>carga</b> \(\Gamma(y)\)) tiene que caer a cero en las puntas. Allí donde la carga cambia con \(y\) hay un <span class="term">gradiente spanwise de presión</span>: el aire del intradós tiende a irse hacia fuera y el del extradós hacia dentro, y esa cizalladura desprende vorticidad a la estela con intensidad \(-d\Gamma/dy\). Esa lámina de vórtices es la que induce el downwash.</p>
    <p>Si la carga cae bruscamente (p. ej. muy uniforme y desplomándose en la punta), el gradiente es enorme en una zona pequeña: vorticidad muy concentrada, downwash muy alto localmente y mucha energía en la estela. La <b>distribución elíptica</b> es la que reparte el gradiente de carga de la forma más suave compatible con ir a cero en las puntas: el downwash resulta <b>uniforme</b> y la resistencia inducida es la <b>mínima</b> para una envergadura y una sustentación dadas.</p>`,
    en: R`<p>Along the span the pressure difference between lower and upper surfaces (the <b>load</b> \(\Gamma(y)\)) must fall to zero at the tips. Wherever the load changes with \(y\) there is a <span class="term">spanwise pressure gradient</span>: lower-surface air tends to move outboard and upper-surface air inboard, and that shear sheds vorticity of strength \(-d\Gamma/dy\) into the wake. That vortex sheet is what induces downwash.</p>
    <p>If the load drops abruptly (e.g. very uniform then collapsing at the tip), the gradient is huge over a small region: very concentrated vorticity, very high local downwash and a lot of energy in the wake. The <b>elliptic distribution</b> spreads the load gradient as gently as possible while still reaching zero at the tips: downwash is <b>uniform</b> and induced drag is <b>minimum</b> for a given span and lift.</p>`,
  },
  physics: {
    es: R`<p><b>Vorticidad desprendida</b>: \(\gamma_{estela}(y)=-\dfrac{d\Gamma}{dy}\). <b>Downwash</b> en la línea sustentadora: $$w(y_0)=\frac{1}{4\pi}\int_{-b/2}^{b/2}\frac{-d\Gamma/dy}{y_0-y}\,dy$$</p>
    <p><b>Resistencia inducida</b> (plano de Trefftz): $$D_i=\frac{\rho}{2}\int_{-b/2}^{b/2}\Gamma(y)\,w(y)\,dy$$ Con la serie de Fourier: \(C_{D_i}=\frac{C_L^2}{\pi AR}\left(1+\delta\right)\), \(\delta=\sum_{n\ge2} n\left(\frac{A_n}{A_1}\right)^2\ge0\). El mínimo (\(\delta=0\)) solo se alcanza con \(A_n=0\) para \(n\ge2\): \(\Gamma=\Gamma_0\sqrt{1-(2y/b)^2}\), \(w=\Gamma_0/(2b)\) constante.</p>
    <p><b>Teorema de Munk</b>: para una estela plana dada, la resistencia inducida mínima se consigue con downwash normal constante a lo largo de la traza de la estela. Con endplates o suelo el óptimo deja de ser elíptico (la carga no tiene por qué caer a cero en la punta), y se reduce la \(C_{D_i}\) por debajo de \(C_L^2/\pi AR\).</p>
    <div class="callout key"><div class="ct">Respuesta de entrevista</div>“La elíptica: es la que tiene el gradiente de presión/carga spanwise más suave compatible con anularse en las puntas, así que la vorticidad desprendida \(-d\Gamma/dy\) produce un downwash uniforme. Para envergadura y sustentación fijas, downwash uniforme ⇔ mínima energía en la estela ⇔ mínima resistencia inducida (\(e=1\)). Las distribuciones con caídas bruscas o picos concentran vorticidad y tienen más \(C_{D_i}\).”</div>`,
    en: R`<p><b>Shed vorticity</b>: \(\gamma_{wake}(y)=-\dfrac{d\Gamma}{dy}\). <b>Downwash</b> on the lifting line: $$w(y_0)=\frac{1}{4\pi}\int_{-b/2}^{b/2}\frac{-d\Gamma/dy}{y_0-y}\,dy$$</p>
    <p><b>Induced drag</b> (Trefftz plane): $$D_i=\frac{\rho}{2}\int_{-b/2}^{b/2}\Gamma(y)\,w(y)\,dy$$ With the Fourier series: \(C_{D_i}=\frac{C_L^2}{\pi AR}\left(1+\delta\right)\), \(\delta=\sum_{n\ge2} n\left(\frac{A_n}{A_1}\right)^2\ge0\). The minimum (\(\delta=0\)) only happens with \(A_n=0\) for \(n\ge2\): \(\Gamma=\Gamma_0\sqrt{1-(2y/b)^2}\), \(w=\Gamma_0/(2b)\) constant.</p>
    <p><b>Munk's theorem</b>: for a given planar wake, minimum induced drag is achieved with constant normalwash along the wake trace. With endplates or ground the optimum is no longer elliptic (the load need not vanish at the tip), and \(C_{D_i}\) drops below \(C_L^2/\pi AR\).</p>
    <div class="callout key"><div class="ct">Interview answer</div>“Elliptic: it has the gentlest spanwise pressure/load gradient compatible with vanishing at the tips, so the shed vorticity \(-d\Gamma/dy\) produces uniform downwash. For fixed span and lift, uniform downwash ⇔ minimum wake energy ⇔ minimum induced drag (\(e=1\)). Distributions with abrupt drops or peaks concentrate vorticity and have higher \(C_{D_i}\).”</div>`,
  },
  labs: [
    { title: { es: "Dibuja tu distribución de carga", en: "Draw your own load distribution" }, desc: { es: "Arrastra el ratón para modificar Γ(y). La curva discontinua naranja es el ajuste de Fourier que usa el cálculo.", en: "Drag the mouse to change Γ(y). The dashed orange curve is the Fourier fit used in the calculation." }, mount: drawLab },
    { title: { es: "Pregunta clásica: ¿cuál tiene menos drag inducido?", en: "Classic question: which one has the least induced drag?" }, mount: contestLab },
  ],
  interview: [
    { q: { es: "Te enseñan varias distribuciones de carga spanwise: ¿cuál tiene menos resistencia inducida y por qué?", en: "You're shown several spanwise load distributions: which has the least induced drag and why?" }, a: { es: R`<p>La elíptica. Argumento físico: la vorticidad desprendida es \(-d\Gamma/dy\), es decir, proporcional al <b>gradiente de presión (carga) a lo largo de la envergadura</b>; la elíptica tiene el gradiente más suave posible, la vorticidad se reparte y el downwash es uniforme. Argumento matemático: \(C_{D_i}=\frac{C_L^2}{\pi AR}(1+\delta)\), con \(\delta=0\) solo si la carga es elíptica. Si hay endplates o efecto suelo, el óptimo cambia (se puede cargar más la punta).</p>`, en: R`<p>The elliptic one. Physical argument: shed vorticity is \(-d\Gamma/dy\), i.e. proportional to the <b>spanwise pressure (load) gradient</b>; the elliptic load has the gentlest possible gradient, vorticity is spread and downwash is uniform. Mathematical argument: \(C_{D_i}=\frac{C_L^2}{\pi AR}(1+\delta)\), with \(\delta=0\) only for elliptic loading. With endplates or ground effect the optimum changes (the tip can carry more load).</p>` } },
    { q: { es: "¿Cómo se consigue una carga casi elíptica sin ala elíptica?", en: "How do you get near-elliptic loading without an elliptic wing?" }, a: { es: R`<p>Con estrechamiento (λ ≈ 0.35–0.45 en ala recta), con torsión geométrica (washout) o aerodinámica (cambio de perfil/curvatura a lo largo de la envergadura). En un alerón de F1 se juega además con la cuerda y el ángulo de cada elemento a lo largo de la envergadura para gestionar estelas y vórtices, no solo la inducida.</p>`, en: R`<p>With taper (λ ≈ 0.35–0.45 on a straight wing), geometric twist (washout) or aerodynamic twist (changing section/camber along the span). On an F1 wing chord and element angle are also varied spanwise to manage wakes and vortices, not only induced drag.</p>` } },
  ],
  myths: [
    { es: "«La elíptica es mejor porque es más bonita/aerodinámica». Es mejor porque produce downwash uniforme (δ = 0), y solo para una estela plana sin endplates ni suelo.", en: "“Elliptic is better because it looks more aerodynamic”. It is better because it produces uniform downwash (δ = 0), and only for a planar wake without endplates or ground." },
    { es: "«La carga uniforme en toda la envergadura minimiza el drag». La carga tiene que caer a cero en la punta; si es uniforme hasta el final, el gradiente en la punta es enorme y la vorticidad se concentra: más drag.", en: "“Uniform load along the span minimises drag”. The load must fall to zero at the tip; if uniform up to the end, the tip gradient is huge and vorticity concentrates: more drag." },
  ],
  quiz: [
    { q: { es: "La intensidad de la vorticidad desprendida en la estela es…", en: "The strength of the shed wake vorticity is…" }, options: [{ es: "Γ(y)", en: "Γ(y)" }, { es: "−dΓ/dy", en: "−dΓ/dy" }, { es: "constante", en: "constant" }, { es: "∫Γ dy", en: "∫Γ dy" }], correct: 1, explain: { es: "Helmholtz: cada variación de circulación ligada continúa como un filamento libre.", en: "Helmholtz: every change of bound circulation continues as a free filament." } },
    { q: { es: "Para una carga elíptica δ =", en: "For elliptic loading δ =" }, options: [{ es: "0", en: "0" }, { es: "0.05", en: "0.05" }, { es: "1", en: "1" }, { es: "depende de AR", en: "depends on AR" }], correct: 0, explain: { es: "Solo A₁ ≠ 0.", en: "Only A₁ ≠ 0." } },
  ],
  refs: [
    "M.M. Munk, “The minimum induced drag of aerofoils”, NACA Rep. 121 (1921).",
    "J.D. Anderson, <i>Fundamentals of Aerodynamics</i>, §5.3.",
    "I. Kroo, “Drag due to lift: concepts for prediction and reduction”, <i>Annu. Rev. Fluid Mech.</i> 33 (2001).",
  ],
};
