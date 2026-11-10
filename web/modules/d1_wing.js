import { slider, labLayout, readout, segmented, L, engineBadge, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { liveCall } from "../js/bridge/physics.js";
import { scene3d, heat } from "../js/core/three_scene.js";

const R = String.raw;

function wing3dLab(host) {
  const ui = labLayout(host);
  const holder = el("div");
  ui.viz.appendChild(holder);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pG = new Plot(row, { height: 220, xlabel: { es: "y / b", en: "y / b" }, ylabel: { es: "Γ/Γmáx  ·  αi [°]", en: "Γ/Γmax  ·  αi [°]" } });
  const pCL = new Plot(row, { height: 220, xlabel: { es: "α [°]", en: "α [°]" }, ylabel: { es: "CL", en: "CL" }, xlim: [-4, 14] });
  const sPl = segmented({ label: { es: "Planta", en: "Planform" }, value: "rect", onInput: run, options: [{ value: "rect", label: { es: "Rectangular", en: "Rectangular" } }, { value: "taper", label: { es: "Trapezoidal", en: "Tapered" } }, { value: "elliptic", label: { es: "Elíptica", en: "Elliptic" } }] });
  const sAR = slider({ label: { es: "Alargamiento AR = b²/S", en: "Aspect ratio AR = b²/S" }, min: 1.5, max: 20, step: 0.5, value: 6, onInput: run });
  const sTp = slider({ label: { es: "Estrechamiento λ = c_t/c_r", en: "Taper ratio λ = c_t/c_r" }, min: 0.1, max: 1, step: 0.05, value: 0.4, onInput: run });
  const sTw = slider({ label: { es: "Torsión en punta [°] (− = washout)", en: "Tip twist [°] (− = washout)" }, min: -6, max: 4, step: 0.5, value: 0, onInput: run });
  const sA = slider({ label: { es: "α [°]", en: "α [°]" }, min: -2, max: 12, step: 0.5, value: 6, onInput: run });
  ui.controls.append(sPl.el, sAR.el, sTp.el, sTw.el, sA.el);
  const roCL = readout({ es: "CL", en: "CL" });
  const roCD = readout({ es: "CDi", en: "CDi" });
  const roE = readout({ es: "e (Oswald, inducido)", en: "e (span efficiency)" });
  const roA = readout({ es: "dCL/dα 3D", en: "3D dCL/dα" }, "/rad");
  ui.readouts.append(roCL.el, roCD.el, roE.el, roA.el);
  ui.note.innerHTML = L(
    "Línea sustentadora de Prandtl (40 términos de Fourier) resuelta en Python. El ala se colorea por cl local; flechas = downwash inducido; las partículas que giran en las puntas representan los vórtices de punta (sentido real, velocidad de giro escalada con la circulación). Arrastra para rotar la vista.",
    "Prandtl lifting line (40 Fourier terms) solved in Python. The wing is coloured by local cl; arrows = induced downwash; the spinning particles at the tips represent the tip vortices (true sense, spin rate scaled with circulation). Drag to rotate."
  );
  let S = null, wingMesh = null, arrows = [], gammaTip = 0, parts = null;
  const wait = engineBadge(holder);
  scene3d(holder, { height: 340, camera: [1.4, 0.9, 1.5], target: [0.4, -0.05, 0] }).then((s) => {
    S = s;
    const { THREE, scene } = S;
    const n = 500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    parts = { geo, pos, n, ph: [...Array(n)].map(() => Math.random() * 6.28), x: [...Array(n)].map(() => Math.random() * 2.5), side: [...Array(n)].map((_, i) => (i % 2 ? 1 : -1)), r: [...Array(n)].map(() => 0.01 + Math.random() * 0.05) };
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ color: 0x22d3ee, size: 0.012 })));
    S.onFrame((dt) => {
      if (!last) return;
      const half = 0.5;
      const w = 6 + 60 * Math.abs(gammaTip);
      for (let i = 0; i < n; i++) {
        parts.x[i] += dt * 0.6;
        if (parts.x[i] > 2.6) parts.x[i] = 0;
        parts.ph[i] += dt * w * (0.04 / (parts.r[i] + 0.02));
        const s = parts.side[i];
        const rr = parts.r[i] * (1 + 0.3 * parts.x[i]);
        const xin = 0.12 + parts.x[i];
        pos[3 * i] = xin;
        pos[3 * i + 1] = rr * Math.sin(parts.ph[i]) - 0.05 * parts.x[i] * Math.abs(gammaTip) * 3;
        pos[3 * i + 2] = s * (half * 0.92 - 0.03 * parts.x[i] + rr * Math.cos(parts.ph[i]));
      }
      geo.attributes.position.needsUpdate = true;
    });
    wait.remove();
    if (last) build(last);
  });
  let last = null;
  const call = liveCall("ll", "ll.solve", 50);
  function run() {
    call({ AR: sAR.value, planform: sPl.value, taper: sTp.value, twist: sTw.value, alpha: sA.value }, (r) => {
      last = r;
      plots(r);
      build(r);
    });
  }
  function plots(r) {
    const gmax = Math.max(...r.gamma.map(Math.abs), 1e-9);
    pG.set([
      { x: r.y, y: r.gamma.map((g) => g / gmax), color: cssVar("--accent"), width: 2.6, label: { es: "Γ / Γmáx", en: "Γ / Γmax" } },
      { x: r.y, y: r.alpha_i_deg, color: cssVar("--accent-2"), label: { es: "αi [°] (downwash)", en: "αi [°] (downwash)" } },
    ]);
    const slope3 = r.CL / ((sA.value * Math.PI) / 180 || 1e-9);
    const al = [-4, 14];
    pCL.set([
      { x: al, y: al.map((a) => (2 * Math.PI * a * Math.PI) / 180), color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "perfil 2D (2π)", en: "2D section (2π)" } },
      { x: al, y: al.map((a) => (slope3 * a * Math.PI) / 180), color: cssVar("--accent"), width: 2.6, label: { es: `ala AR ${sAR.value}`, en: `wing AR ${sAR.value}` } },
    ], [{ type: "point", x: sA.value, y: r.CL, color: cssVar("--accent-2") }]);
    roCL.set(r.CL.toFixed(3));
    roCD.set(r.CDi.toFixed(4));
    roE.set(r.e.toFixed(3), r.e > 0.99 ? "good" : "");
    roA.set(slope3.toFixed(2));
  }
  function build(r) {
    if (!S) return;
    const { THREE, scene } = S;
    if (wingMesh) scene.remove(wingMesh);
    arrows.forEach((a) => scene.remove(a));
    arrows = [];
    const ny = r.y.length;
    const a = (-sA.value * Math.PI) / 180;
    const cmax = Math.max(...r.chord);
    const sc = 1;
    const verts = [], cols = [], idx = [];
    const clmax = Math.max(...r.cl_local.map(Math.abs), 1e-6);
    for (let j = 0; j < ny; j++) {
      const c = r.chord[j] * sc;
      const z = r.y[j];
      const xle = 0.25 * (cmax - c);
      for (const f of [0, 1]) {
        const x = xle + f * c;
        // rotate nose-up by alpha about the root quarter chord
        const piv = 0.25 * cmax;
        verts.push(piv + (x - piv) * Math.cos(a), (x - piv) * Math.sin(a), z);
        const col = heat(THREE, Math.abs(r.cl_local[j]) / clmax);
        cols.push(col.r, col.g, col.b);
      }
      if (j > 0) {
        const k = 2 * j;
        idx.push(k - 2, k - 1, k, k - 1, k + 1, k);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
    g.setAttribute("color", new THREE.Float32BufferAttribute(cols, 3));
    g.setIndex(idx);
    g.computeVertexNormals();
    wingMesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, metalness: 0.1, roughness: 0.6 }));
    scene.add(wingMesh);
    const aimax = Math.max(...r.alpha_i_deg.map(Math.abs), 1e-6);
    for (let j = 0; j < ny; j += 10) {
      const len = 0.05 + (0.18 * Math.abs(r.alpha_i_deg[j])) / Math.max(aimax, 4);
      const ar = new THREE.ArrowHelper(new THREE.Vector3(0, r.alpha_i_deg[j] >= 0 ? -1 : 1, 0), new THREE.Vector3(0.25 * cmax + 0.25, 0.02, r.y[j]), len, 0xfb923c, 0.03, 0.02);
      scene.add(ar);
      arrows.push(ar);
    }
    gammaTip = r.CL / 4;
  }
  run();
}

export default {
  subtitle: {
    es: "Envergadura, alargamiento, downwash, vórtices de punta y por qué un ala finita sustenta menos que su perfil.",
    en: "Span, aspect ratio, downwash, tip vortices and why a finite wing lifts less than its section.",
  },
  heroParams: { eps: 0.1, camber: 0.06, alpha: 5 },
  intuition: {
    es: R`<p>En un ala finita la presión alta del intradós y la baja del extradós se "comunican" alrededor de las puntas: el aire rodea la punta de abajo arriba y se enrolla en dos <span class="term">vórtices de punta</span> que se van con la estela. Esos vórtices (y toda la lámina de vorticidad desprendida a lo largo de la envergadura) inducen sobre el ala una velocidad hacia abajo, el <span class="term">downwash</span>.</p>
    <p>Consecuencias: cada sección "ve" un viento relativo inclinado hacia abajo, su <b>ángulo efectivo</b> es menor que el geométrico (\(\alpha_{ef}=\alpha-\alpha_i\)) y la fuerza local se inclina hacia atrás. Resultado: el ala sustenta menos que su perfil al mismo α (pendiente menor) y aparece la <b>resistencia inducida</b>. Cuanto más <span class="term">alargamiento</span> (\(AR=b^2/S\)), más se parece el ala a un perfil 2D. En F1 los alerones tienen AR bajos (≈ 2–4), así que estos efectos 3D son enormes.</p>`,
    en: R`<p>On a finite wing the high pressure below and the low pressure above "communicate" around the tips: air wraps from bottom to top around the tip and rolls into two <span class="term">tip vortices</span> that trail in the wake. Those vortices (and the whole vorticity sheet shed along the span) induce a downward velocity on the wing, the <span class="term">downwash</span>.</p>
    <p>Consequences: each section "sees" a relative wind tilted downwards, its <b>effective angle</b> is lower than the geometric one (\(\alpha_{eff}=\alpha-\alpha_i\)) and the local force tilts backwards. Result: the wing lifts less than its section at the same α (lower slope) and <b>induced drag</b> appears. The higher the <span class="term">aspect ratio</span> (\(AR=b^2/S\)), the closer the wing is to a 2D section. F1 wings have low AR (≈ 2–4), so these 3D effects are huge.</p>`,
  },
  physics: {
    es: R`<p><b>Sistema de vórtices en herradura</b>: vórtice ligado a lo largo de la envergadura + vórtices libres hacia el infinito. Helmholtz: un filamento de vórtice no puede terminar en el fluido, de ahí que la circulación ligada se continúe en la estela.</p>
    <p><b>Ecuación de la línea sustentadora de Prandtl</b>: $$\alpha(y_0)=\frac{\Gamma(y_0)}{\pi V_\infty c(y_0)}+\alpha_{L0}(y_0)+\frac{1}{4\pi V_\infty}\int_{-b/2}^{b/2}\frac{d\Gamma/dy}{y_0-y}\,dy$$ (sustentación local = la de un perfil 2D al ángulo efectivo; el último término es \(\alpha_i\)).</p>
    <p>Con \(\Gamma=2bV_\infty\sum A_n\sin n\theta\), \(y=-\tfrac b2\cos\theta\): $$C_L=\pi AR\,A_1,\qquad C_{D_i}=\pi AR\sum nA_n^2=\frac{C_L^2}{\pi AR}(1+\delta)=\frac{C_L^2}{\pi e AR}$$</p>
    <p><b>Pendiente 3D</b>: $$a=\frac{a_0}{1+\dfrac{a_0}{\pi e AR}}\quad(\text{alas de AR alto});\qquad a\approx\frac{\pi AR}{2}\ \ (AR\to0,\ \text{cuerpo esbelto})$$ Para AR bajo es mejor la fórmula de Helmbold \(a=\dfrac{a_0}{\sqrt{1+(a_0/\pi AR)^2}+a_0/\pi AR}\) o un VLM.</p>
    <p><b>Otros parámetros</b>: flecha (retrasa compresibilidad, reduce la pendiente, carga las puntas), estrechamiento (λ ≈ 0.35–0.45 aproxima la carga elíptica en ala sin flecha), torsión/<i>washout</i> (descarga las puntas, mejora la entrada en pérdida), diedro (estabilidad lateral).</p>`,
    en: R`<p><b>Horseshoe vortex system</b>: bound vortex along the span + trailing vortices to infinity. Helmholtz: a vortex filament cannot end in the fluid, hence bound circulation continues into the wake.</p>
    <p><b>Prandtl's lifting-line equation</b>: $$\alpha(y_0)=\frac{\Gamma(y_0)}{\pi V_\infty c(y_0)}+\alpha_{L0}(y_0)+\frac{1}{4\pi V_\infty}\int_{-b/2}^{b/2}\frac{d\Gamma/dy}{y_0-y}\,dy$$ (local lift = 2D section lift at the effective angle; the last term is \(\alpha_i\)).</p>
    <p>With \(\Gamma=2bV_\infty\sum A_n\sin n\theta\), \(y=-\tfrac b2\cos\theta\): $$C_L=\pi AR\,A_1,\qquad C_{D_i}=\pi AR\sum nA_n^2=\frac{C_L^2}{\pi AR}(1+\delta)=\frac{C_L^2}{\pi e AR}$$</p>
    <p><b>3D slope</b>: $$a=\frac{a_0}{1+\dfrac{a_0}{\pi e AR}}\quad(\text{high-AR wings});\qquad a\approx\frac{\pi AR}{2}\ \ (AR\to0,\ \text{slender body})$$ For low AR use Helmbold's \(a=\dfrac{a_0}{\sqrt{1+(a_0/\pi AR)^2}+a_0/\pi AR}\) or a VLM.</p>
    <p><b>Other parameters</b>: sweep (delays compressibility, lowers the slope, loads the tips), taper (λ ≈ 0.35–0.45 approximates elliptic loading for an unswept wing), twist/washout (unloads the tips, improves stall behaviour), dihedral (lateral stability).</p>`,
  },
  labs: [{ title: { es: "Ala 3D: carga, downwash y vórtices de punta", en: "3D wing: loading, downwash and tip vortices" }, desc: { es: "Compara AR = 2 con AR = 15. Prueba λ ≈ 0.4 frente a rectangular y elíptica.", en: "Compare AR = 2 with AR = 15. Try λ ≈ 0.4 versus rectangular and elliptic." }, mount: wing3dLab }],
  interview: [
    { q: { es: "¿Qué es el aspect ratio y cómo afecta a la curva CL–α y a la resistencia?", en: "What is aspect ratio and how does it affect the CL–α curve and drag?" }, a: { es: R`<p>\(AR=b^2/S\) (envergadura²/superficie). Menor AR → más downwash relativo → menor pendiente \(dC_L/d\alpha\), mayor ángulo de pérdida y mucha más resistencia inducida (\(\propto 1/AR\)). Alas de AR muy bajo (deltas) tienen además sustentación no lineal por vórtices.</p>`, en: R`<p>\(AR=b^2/S\) (span²/area). Lower AR → more relative downwash → lower slope \(dC_L/d\alpha\), higher stall angle and much more induced drag (\(\propto 1/AR\)). Very low-AR wings (deltas) also get non-linear vortex lift.</p>` } },
    { q: { es: "¿De dónde salen los vórtices de punta?", en: "Where do tip vortices come from?" }, a: { es: R`<p>De la diferencia de presión entre intradós y extradós: en la punta el aire rodea el borde de la zona de alta a la de baja presión y se enrolla. Más en general, cualquier variación de circulación a lo largo de la envergadura desprende vorticidad (\(-d\Gamma/dy\)) en la estela; esa lámina se enrolla en dos vórtices concentrados a una o dos envergaduras aguas abajo.</p>`, en: R`<p>From the pressure difference between the lower and upper surfaces: at the tip air flows around the edge from high to low pressure and rolls up. More generally, any spanwise variation of circulation sheds vorticity (\(-d\Gamma/dy\)) into the wake; that sheet rolls up into two concentrated vortices within one or two spans downstream.</p>` } },
    { q: { es: "¿Por qué el ala finita tiene menos pendiente de sustentación que su perfil?", en: "Why does a finite wing have a lower lift slope than its section?" }, a: { es: R`<p>Porque el downwash reduce el ángulo efectivo de cada sección: \(\alpha_{ef}=\alpha-\alpha_i\) con \(\alpha_i\propto C_L/(\pi e AR)\). Para obtener la misma \(C_L\) hay que subir el α geométrico.</p>`, en: R`<p>Because downwash reduces each section's effective angle: \(\alpha_{eff}=\alpha-\alpha_i\) with \(\alpha_i\propto C_L/(\pi e AR)\). To obtain the same \(C_L\) the geometric α must be higher.</p>` } },
  ],
  myths: [
    { es: "«Los vórtices de punta solo existen en la punta». La vorticidad se desprende a lo largo de toda la envergadura donde Γ varía; luego se enrolla en dos núcleos.", en: "“Tip vortices only exist at the tip”. Vorticity is shed along the whole span wherever Γ varies; it then rolls up into two cores." },
    { es: "«AR alto siempre es mejor». Para resistencia inducida sí, pero aumenta peso/flexión y, en F1, el reglamento fija dimensiones; además AR bajo entra en pérdida a más α.", en: "“High AR is always better”. For induced drag yes, but it increases weight/bending and in F1 the rules fix dimensions; low AR also stalls at higher α." },
  ],
  quiz: [
    { q: { es: "Un ala de b = 2 m y S = 1 m² tiene AR =", en: "A wing with b = 2 m and S = 1 m² has AR =" }, options: [{ es: "2", en: "2" }, { es: "4", en: "4" }, { es: "0.5", en: "0.5" }, { es: "1", en: "1" }], correct: 1, explain: { es: "b²/S = 4/1.", en: "b²/S = 4/1." } },
    { q: { es: "Para una carga elíptica, el downwash es…", en: "For elliptic loading, downwash is…" }, options: [{ es: "máximo en la punta", en: "maximum at the tip" }, { es: "uniforme en la envergadura", en: "uniform along the span" }, { es: "nulo", en: "zero" }, { es: "máximo en la raíz", en: "maximum at the root" }], correct: 1, explain: { es: "Solo A₁ ≠ 0 → αi constante.", en: "Only A₁ ≠ 0 → constant αi." } },
    { q: { es: "La pendiente 3D de un ala elíptica de AR = 6 (a₀ = 2π) es ≈", en: "The 3D slope of an elliptic AR = 6 wing (a₀ = 2π) is ≈" }, options: [{ es: "6.28 /rad", en: "6.28 /rad" }, { es: "4.71 /rad", en: "4.71 /rad" }, { es: "3.14 /rad", en: "3.14 /rad" }, { es: "9.4 /rad", en: "9.4 /rad" }], correct: 1, explain: { es: "2π/(1 + 2/6) = 4.71.", en: "2π/(1 + 2/6) = 4.71." } },
  ],
  refs: [
    "L. Prandtl, “Tragflügeltheorie”, 1918; H. Glauert, <i>The Elements of Aerofoil and Airscrew Theory</i>, 1926.",
    "J.D. Anderson, <i>Fundamentals of Aerodynamics</i>, ch. 5.",
    "J. Katz & A. Plotkin, <i>Low-Speed Aerodynamics</i>, ch. 8 & 12.",
  ],
};
