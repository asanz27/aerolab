import { slider, labLayout, readout, toggle, L, engineBadge, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { FlowView } from "../js/core/field.js";
import { physics, liveCall } from "../js/bridge/physics.js";
import { scene3d } from "../js/core/three_scene.js";

const R = String.raw;

function deltaLab(host) {
  const ui = labLayout(host);
  const holder = el("div");
  ui.viz.appendChild(holder);
  const wait = engineBadge(holder);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const fv = new FlowView(row, { height: 240, world: { x0: -1.6, x1: 1.6, y0: -0.6, y1: 1.1 }, particles: 700, speed: 0.006 });
  const pCp = new Plot(row, { height: 240, invertY: true, xlabel: { es: "y / s (envergadura local)", en: "y / s (local semi-span)" }, ylabel: { es: "Cp", en: "Cp" } });
  const pCL = new Plot(ui.viz, { height: 230, xlabel: { es: "α [°]", en: "α [°]" }, ylabel: { es: "CL", en: "CL" } });
  const sA = slider({ label: { es: "α [°]", en: "α [°]" }, min: 4, max: 40, step: 1, value: 20, onInput: run });
  const sL = slider({ label: { es: "Flecha del borde de ataque Λ [°]", en: "Leading-edge sweep Λ [°]" }, min: 55, max: 80, step: 1, value: 70, onInput: run });
  const tS = toggle({ label: { es: "Vórtice secundario", en: "Secondary vortex" }, value: true, onInput: run });
  ui.controls.append(sA.el, sL.el, tS.el);
  const roCL = readout({ es: "CL (Polhamus + breakdown)", en: "CL (Polhamus + breakdown)" });
  const roV = readout({ es: "Fracción de sustentación de vórtice", en: "Vortex-lift fraction" });
  const roB = readout({ es: "Breakdown en x/c", en: "Breakdown at x/c" });
  const roAR = readout({ es: "AR", en: "AR" });
  ui.readouts.append(roCL.el, roV.el, roB.el, roAR.el);
  ui.note.innerHTML = L(
    "3D: vórtices primarios (cian) y secundarios (naranja) sobre el extradós; se vuelven rojos y desordenados tras el breakdown. Sección: modelo de flujo cruzado de cuerpo esbelto con imágenes y condición de Kutta en el borde de ataque afilado (posiciones de vórtice según experimentos; nivel de presión escalado a la fuerza normal de Polhamus). CL: analogía de succión de Polhamus con Kp del VLM.",
    "3D: primary (cyan) and secondary (orange) vortices over the upper surface; they turn red and disorganised after breakdown. Section: slender-body crossflow model with images and the Kutta condition at the sharp leading edge (vortex positions from experiments; pressure level scaled to the Polhamus normal force). CL: Polhamus suction analogy with Kp from the VLM."
  );
  let S = null, P = null, pol = null;
  scene3d(holder, { height: 320, camera: [1.7, 1.0, 1.2], target: [0.55, 0, 0] }).then((s) => {
    S = s;
    wait.remove();
    const { THREE, scene } = S;
    P = { mesh: null, n: 1600 };
    const geo = new THREE.BufferGeometry();
    P.pos = new Float32Array(P.n * 3);
    P.col = new Float32Array(P.n * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(P.pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(P.col, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.011, vertexColors: true })));
    P.geo = geo;
    P.s = [...Array(P.n)].map(() => Math.random());
    P.ph = [...Array(P.n)].map(() => Math.random() * 6.28);
    P.r = [...Array(P.n)].map(() => 0.008 + 0.03 * Math.random());
    P.kind = [...Array(P.n)].map((_, i) => (i % 5 === 0 ? 1 : 0));
    P.side = [...Array(P.n)].map((_, i) => (i % 2 ? 1 : -1));
    S.onFrame((dt) => {
      if (!pol) return;
      const tanL = Math.tan((sL.value * Math.PI) / 180);
      const a = (sA.value * Math.PI) / 180;
      const k = pol.alpha.indexOf(sA.value);
      const xbd = k >= 0 ? pol.x_breakdown[k] : 1.2;
      for (let i = 0; i < P.n; i++) {
        P.s[i] += dt * 0.35;
        if (P.s[i] > 1.3) P.s[i] = 0;
        const x = P.s[i];
        const sec = P.kind[i] === 1 && tS.value;
        const half = Math.min(x, 1) / tanL; // local semi-span
        const yv = (sec ? 0.87 : 0.65) * half;
        const zv = (sec ? 0.07 : 0.22 + 0.15 * Math.min(1, Math.tan(a) * tanL)) * half;
        let r = P.r[i] * (0.4 + x) * (sec ? 0.5 : 1);
        const burst = x > xbd;
        if (burst) r *= 2.5 + 2 * Math.sin(P.ph[i] * 2);
        P.ph[i] += dt * (sec ? -1 : 1) * 14 * (burst ? 0.3 : 1);
        const yy = P.side[i] * (yv + r * Math.cos(P.ph[i]));
        const zz = zv + r * Math.sin(P.ph[i]);
        // wing plane rotated by alpha about the apex
        P.pos[3 * i] = x * Math.cos(a) - zz * Math.sin(a);
        P.pos[3 * i + 1] = -x * Math.sin(a) + zz * Math.cos(a);
        P.pos[3 * i + 2] = yy;
        const c = burst ? [0.96, 0.25, 0.37] : sec ? [0.98, 0.57, 0.24] : [0.13, 0.83, 0.93];
        P.col.set(c, 3 * i);
      }
      P.geo.attributes.position.needsUpdate = true;
      P.geo.attributes.color.needsUpdate = true;
    });
    run();
  });
  function buildWing() {
    if (!S) return;
    const { THREE, scene } = S;
    if (P.mesh) scene.remove(P.mesh);
    const tanL = Math.tan((sL.value * Math.PI) / 180);
    const a = (sA.value * Math.PI) / 180;
    const pts = [[0, 0], [1, 1 / tanL], [1, -1 / tanL]];
    const v = [];
    for (const [x, y] of pts) v.push(x * Math.cos(a), -x * Math.sin(a), y);
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    g.computeVertexNormals();
    P.mesh = new THREE.Mesh(g, new THREE.MeshStandardMaterial({ color: 0x334155, side: THREE.DoubleSide, transparent: true, opacity: 0.85 }));
    scene.add(P.mesh);
  }
  const callC = liveCall("cross", "delta.crossflow", 40);
  const callP = liveCall("pol", "delta.polhamus", 40);
  function run() {
    callP({ sweep: sL.value }, (r) => {
      pol = r;
      buildWing();
      const k = r.alpha.indexOf(sA.value);
      pCL.set([
        { x: r.alpha, y: r.CL_potential, color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "potencial (Kp sinα cos²α)", en: "potential (Kp sinα cos²α)" } },
        { x: r.alpha, y: r.CL_total, color: cssVar("--accent-3"), dash: [3, 3], label: { es: "Polhamus (sin breakdown)", en: "Polhamus (no breakdown)" } },
        { x: r.alpha, y: r.CL_with_breakdown, color: cssVar("--accent"), width: 2.8, label: { es: "con breakdown", en: "with breakdown" } },
      ], [{ type: "vline", x: sA.value, color: cssVar("--accent-2") }]);
      if (k >= 0) {
        roCL.set(r.CL_with_breakdown[k].toFixed(2));
        roV.set(((r.CL_vortex[k] / r.CL_total[k]) * 100).toFixed(0) + " %");
        roB.set(r.x_breakdown[k] > 1 ? L("aguas abajo del BS", "downstream of TE") : r.x_breakdown[k].toFixed(2), r.x_breakdown[k] > 1 ? "good" : "bad");
      }
      roAR.set(r.AR.toFixed(2));
    });
    callC({ alpha: sA.value, sweep: sL.value, secondary: tS.value }, (c) => {
      fv.setField({ x: c.field.y, y: c.field.z, u: c.field.u, v: c.field.v });
      fv.setBodies([{ x: [-1, 1, 1, -1], y: [-0.01, -0.01, 0.01, 0.01] }]);
      fv.setOverlays([
        (g, v) => {
          for (const p of c.vortices.primary) {
            g.fillStyle = "#22d3ee";
            g.beginPath();
            g.arc(v.X(p[0]), v.Y(p[1]), 6, 0, 7);
            g.fill();
          }
          for (const p of c.vortices.secondary) {
            g.fillStyle = "#fb923c";
            g.beginPath();
            g.arc(v.X(p[0]), v.Y(p[1]), 4, 0, 7);
            g.fill();
          }
        },
      ]);
      pCp.set([
        { x: c.upper.y, y: c.upper.cp, color: cssVar("--accent"), width: 2.6, label: { es: "extradós", en: "upper surface" } },
        { x: c.lower.y, y: c.lower.cp, color: cssVar("--accent-2"), dash: [5, 4], label: { es: "intradós", en: "lower surface" } },
      ]);
    });
  }
}

export default {
  subtitle: {
    es: "Separación en el borde de ataque, vórtices primario y secundario, succión inducida (vortex lift de Polhamus) y breakdown.",
    en: "Leading-edge separation, primary and secondary vortices, induced suction (Polhamus vortex lift) and breakdown.",
  },
  heroParams: { eps: 0.03, camber: 0.0, alpha: 15 },
  intuition: {
    es: R`<p>En un ala delta de borde de ataque afilado y mucha flecha, incluso a ángulos moderados el flujo <b>separa en todo el borde de ataque</b>. La lámina separada no se pierde: se enrolla en un <span class="term">vórtice primario</span> cónico a cada lado, por encima del extradós. Bajo él el flujo se reacopla (línea de reanclaje) y corre hacia fuera, hacia el borde; esa corriente cruzada encuentra un gradiente adverso cerca del borde, la capa límite separa de nuevo y forma un <span class="term">vórtice secundario</span> de sentido contrario, más pequeño, pegado a la superficie junto al borde.</p>
    <p>El núcleo de baja presión del vórtice primario produce un <b>pico de succión</b> en el extradós justo debajo de él: es una sustentación adicional, <b>no lineal</b> (crece con \(\sin^2\alpha\)), la <span class="term">sustentación de vórtice</span>. Gracias a ella los deltas alcanzan α de 30–40°. El límite lo marca el <b>breakdown</b> del vórtice primario, que avanza desde el borde de salida hacia el ápice al subir α. Los vórtices de los bordes del suelo y de alerones de bajo AR en un F1 siguen la misma física.</p>`,
    en: R`<p>On a sharp-edged, highly swept delta wing the flow <b>separates along the whole leading edge</b> even at moderate incidence. The separated sheet is not lost: it rolls up into a conical <span class="term">primary vortex</span> on each side, above the upper surface. Beneath it the flow reattaches (attachment line) and runs outboard towards the edge; that crossflow meets an adverse gradient near the edge, the boundary layer separates again and forms a smaller, opposite-sense <span class="term">secondary vortex</span> close to the surface next to the edge.</p>
    <p>The low-pressure core of the primary vortex produces a <b>suction peak</b> on the upper surface right below it: extra, <b>non-linear</b> lift (growing like \(\sin^2\alpha\)), the <span class="term">vortex lift</span>. Thanks to it deltas reach α of 30–40°. The limit is set by <b>breakdown</b> of the primary vortex, which moves from the trailing edge towards the apex as α increases. Floor-edge vortices and low-AR wings on an F1 car follow the same physics.</p>`,
  },
  physics: {
    es: R`<p><b>Analogía de succión de Polhamus (1966)</b>: la fuerza de succión del borde de ataque que tendría el flujo adherido no se pierde, se "gira" 90° y actúa como fuerza normal sobre el extradós a través del vórtice: $$C_L=K_p\sin\alpha\cos^2\alpha+K_v\cos\alpha\sin^2\alpha,\qquad K_v=\frac{K_p-K_p^2K_i}{\cos\Lambda}$$ \(K_p\) = pendiente potencial (VLM o \(\pi AR/2\) para AR → 0), \(K_i=\partial C_{D_i}/\partial C_L^2\approx1/\pi AR\). Para Λ = 70° (AR ≈ 1.46): \(K_p\approx1.8\), \(K_v\approx3.2\).</p>
    <p><b>Topología</b> (sección transversal): separación primaria en el borde → vórtice primario → reanclaje primario → flujo hacia fuera bajo el vórtice → separación secundaria (gradiente adverso spanwise) → vórtice secundario de signo opuesto → reanclaje secundario. El secundario <b>desplaza al primario hacia dentro y hacia arriba</b> y reduce el pico de succión exterior.</p>
    <p><b>Flujo cruzado esbelto</b>: cada sección se comporta como una placa plana en una corriente cruzada \(V\sin\alpha\); con la transformación placa → círculo, imágenes de los vórtices y condición de Kutta en los bordes se obtiene la intensidad de los vórtices (modelo de Brown & Michael en su versión completa).</p>
    <p><b>Breakdown</b>: el gradiente adverso hacia el borde de salida y el alto swirl hacen estallar el núcleo; al cruzar el borde de salida y avanzar, CL deja de crecer, aparece buffeting y cambios de momento de cabeceo.</p>`,
    en: R`<p><b>Polhamus suction analogy (1966)</b>: the leading-edge suction force an attached flow would have is not lost; it is "rotated" by 90° and acts as a normal force on the upper surface through the vortex: $$C_L=K_p\sin\alpha\cos^2\alpha+K_v\cos\alpha\sin^2\alpha,\qquad K_v=\frac{K_p-K_p^2K_i}{\cos\Lambda}$$ \(K_p\) = potential slope (VLM or \(\pi AR/2\) for AR → 0), \(K_i=\partial C_{D_i}/\partial C_L^2\approx1/\pi AR\). For Λ = 70° (AR ≈ 1.46): \(K_p\approx1.8\), \(K_v\approx3.2\).</p>
    <p><b>Topology</b> (cross-section): primary separation at the edge → primary vortex → primary attachment → outboard flow under the vortex → secondary separation (spanwise adverse gradient) → opposite-sign secondary vortex → secondary attachment. The secondary <b>pushes the primary inboard and upwards</b> and lowers the outboard suction peak.</p>
    <p><b>Slender crossflow</b>: each section behaves as a flat plate in a crossflow \(V\sin\alpha\); mapping plate → circle, adding vortex images and the Kutta condition at the edges gives the vortex strength (the full Brown & Michael model).</p>
    <p><b>Breakdown</b>: the adverse gradient towards the trailing edge and high swirl burst the core; as breakdown crosses the trailing edge and moves forward, CL stops growing, buffeting and pitching-moment changes appear.</p>`,
  },
  labs: [{ title: { es: "Ala delta: vórtices, presión spanwise y sustentación no lineal", en: "Delta wing: vortices, spanwise pressure and non-linear lift" }, desc: { es: "Activa/desactiva el vórtice secundario y observa cómo cambia el pico de succión. Sube α hasta que el breakdown cruce el borde de salida.", en: "Toggle the secondary vortex and see how the suction peak changes. Raise α until breakdown crosses the trailing edge." }, mount: deltaLab }],
  interview: [
    { q: { es: "Explica los vórtices primario y secundario de un ala delta y la succión que inducen.", en: "Explain the primary and secondary vortices of a delta wing and the suction they induce." }, a: { es: R`<p>El flujo separa en el borde de ataque afilado y se enrolla en un vórtice primario cónico sobre el extradós; su núcleo de baja presión crea un pico de succión debajo (sustentación de vórtice, no lineal, Polhamus). Bajo el primario el flujo reanclado va hacia el borde, encuentra un gradiente adverso spanwise, separa y forma un secundario de signo opuesto cerca del borde, que desplaza al primario hacia dentro/arriba y reduce la succión exterior. Al aumentar α el breakdown avanza desde el borde de salida y limita el CL.</p>`, en: R`<p>The flow separates at the sharp leading edge and rolls into a conical primary vortex over the upper surface; its low-pressure core creates a suction peak beneath (vortex lift, non-linear, Polhamus). Under the primary, the reattached flow moves towards the edge, meets a spanwise adverse gradient, separates and forms an opposite-sign secondary vortex near the edge, which pushes the primary inboard/up and reduces outboard suction. As α increases breakdown moves forward from the trailing edge and limits CL.</p>` } },
    { q: { es: "¿Qué es la sustentación de vórtice y cómo se estima?", en: "What is vortex lift and how is it estimated?" }, a: { es: R`<p>La sustentación adicional producida por la baja presión de los vórtices de borde de ataque. Polhamus: la succión del borde de ataque del flujo potencial reaparece como fuerza normal: \(C_L=K_p\sin\alpha\cos^2\alpha+K_v\cos\alpha\sin^2\alpha\). Es significativa a α altos y en alas de bajo AR.</p>`, en: R`<p>The extra lift produced by the low pressure of the leading-edge vortices. Polhamus: the potential-flow leading-edge suction reappears as a normal force: \(C_L=K_p\sin\alpha\cos^2\alpha+K_v\cos\alpha\sin^2\alpha\). Significant at high α and for low-AR wings.</p>` } },
  ],
  myths: [
    { es: "«Un ala delta entra en pérdida cuando separa el borde de ataque». Separa desde α muy bajos; esa separación es la que genera el vórtice y la sustentación extra. La pérdida llega con el breakdown.", en: "“A delta wing stalls when the leading edge separates”. It separates from very low α; that separation generates the vortex and the extra lift. Stall comes with breakdown." },
    { es: "«El vórtice secundario aumenta la sustentación». Suele reducir algo el pico de succión exterior al desplazar al primario.", en: "“The secondary vortex increases lift”. It usually lowers the outboard suction peak somewhat by displacing the primary." },
  ],
  quiz: [
    { q: { es: "La sustentación de vórtice escala aproximadamente con…", en: "Vortex lift scales approximately with…" }, options: [{ es: "α", en: "α" }, { es: "sin²α", en: "sin²α" }, { es: "1/α", en: "1/α" }, { es: "AR", en: "AR" }], correct: 1, explain: { es: "Término Kv cos α sin²α.", en: "Term Kv cos α sin²α." } },
    { q: { es: "El vórtice secundario se forma por…", en: "The secondary vortex forms because of…" }, options: [{ es: "el borde de salida", en: "the trailing edge" }, { es: "separación de la capa límite bajo el primario por gradiente adverso spanwise", en: "boundary-layer separation under the primary due to a spanwise adverse gradient" }, { es: "compresibilidad", en: "compressibility" }, { es: "el breakdown", en: "breakdown" }], correct: 1, explain: { es: "La corriente cruzada hacia el borde se frena y separa.", en: "The outboard crossflow decelerates and separates." } },
  ],
  refs: [
    "E.C. Polhamus, “A concept of the vortex lift of sharp-edge delta wings based on a leading-edge-suction analogy”, NASA TN D-3767 (1966).",
    "D. Hummel, “On the vortex formation over a slender wing at large angles of incidence”, AGARD CP-247 (1979).",
    "W.H. Wentz & D.L. Kohlman, “Vortex breakdown on slender sharp-edged wings”, <i>J. Aircraft</i> 8 (1971).",
    "C.E. Brown & W.H. Michael, “Effect of leading-edge separation on the lift of a delta wing”, <i>J. Aero. Sci.</i> 21 (1954).",
  ],
};
