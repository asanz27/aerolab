import { slider, labLayout, readout, L, engineBadge, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";
import { scene3d } from "../js/core/three_scene.js";

const R = String.raw;

function breakdownLab(host) {
  const ui = labLayout(host);
  const holder = el("div");
  ui.viz.appendChild(holder);
  const wait = engineBadge(holder);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pW = new Plot(row, { height: 220, xlabel: { es: "x / L", en: "x / L" }, ylabel: { es: "W_eje/W₀ · r_núcleo/a₀", en: "W_axis/W₀ · r_core/a₀" }, ylim: [0, 2.2] });
  const pM = new Plot(row, { height: 220, xlabel: { es: "swirl S = v_θ,máx / W₀", en: "swirl S = v_θ,max / W₀" }, ylabel: { es: "Δp crítico / ρW₀²", en: "critical Δp / ρW₀²" }, ylim: [0, 0.55] });
  const sS = slider({ label: { es: "Swirl S (intensidad del vórtice)", en: "Swirl S (vortex strength)" }, min: 0.05, max: 0.85, step: 0.01, value: 0.45, onInput: run });
  const sP = slider({ label: { es: "Subida de presión exterior Δp/ρW₀² (gradiente adverso)", en: "External pressure rise Δp/ρW₀² (adverse gradient)" }, min: 0, max: 0.5, step: 0.005, value: 0.2, onInput: run });
  ui.controls.append(sS.el, sP.el);
  const roB = readout({ es: "Estado", en: "State" });
  const roX = readout({ es: "Posición del breakdown", en: "Breakdown location" }, "x/L");
  const roC = readout({ es: "Δp crítico", en: "critical Δp" });
  ui.readouts.append(roB.el, roX.el, roC.el);
  ui.note.innerHTML = L(
    R`Modelo cuasi-cilíndrico (tipo Hall) de un vórtice de Lamb-Oseen resuelto en Python: en el eje, \(p+\tfrac12\rho W^2\) = cte, la presión del eje = exterior − déficit por giro, y \(a^2W\) = cte. Cuando no existe solución, el núcleo no puede seguir decelerando de forma suave: <b>breakdown</b>. Es <b>cualitativo</b>: su swirl crítico (≈ 0.77) es menor que el experimental (≈ 1.3–1.5), pero la tendencia es la correcta: <b>más swirl ⇒ estalla con menos gradiente adverso</b>.`,
    R`Quasi-cylindrical (Hall-type) model of a Lamb-Oseen vortex solved in Python: on the axis \(p+\tfrac12\rho W^2\) = const, axis pressure = outer − swirl deficit, and \(a^2W\) = const. When no solution exists the core cannot keep decelerating smoothly: <b>breakdown</b>. It is <b>qualitative</b>: its critical swirl (≈ 0.77) is below experiments (≈ 1.3–1.5), but the trend is right: <b>more swirl ⇒ bursts with a weaker adverse gradient</b>.`
  );
  let map = null, S = null, pts = null, last = null;
  physics.call("vortex.breakdown_map", {}).then((m) => {
    map = m;
    drawMap();
  });
  scene3d(holder, { height: 300, camera: [0.6, 0.55, 1.5], target: [0.6, 0, 0] }).then((s) => {
    S = s;
    wait.remove();
    const { THREE, scene } = S;
    const n = 1500;
    const geo = new THREE.BufferGeometry();
    const pos = new Float32Array(n * 3);
    const col = new Float32Array(n * 3);
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
    scene.add(new THREE.Points(geo, new THREE.PointsMaterial({ size: 0.012, vertexColors: true })));
    pts = { geo, pos, col, n, s: [...Array(n)].map(() => Math.random()), ph: [...Array(n)].map(() => Math.random() * 6.28), r0: [...Array(n)].map(() => 0.02 + 0.05 * Math.random()) };
    S.onFrame((dt) => {
      if (!last) return;
      const xb = last.x_breakdown;
      for (let i = 0; i < n; i++) {
        let x = pts.s[i];
        const k = Math.min(last.x.length - 1, Math.floor(x * (last.x.length - 1)));
        let W = last.W[k];
        let r = pts.r0[i] * (last.core_radius[k] || 1);
        let after = xb != null && x >= xb;
        if (after) {
          // burst: expanding, slow, disorganised core (qualitative)
          const f = (x - xb) / 0.3;
          W = 0.15;
          r = pts.r0[i] * (1.8 + 2.5 * Math.min(1, f)) * (0.7 + 0.6 * Math.sin(pts.ph[i] * 3 + x * 20));
        }
        pts.s[i] += dt * 0.25 * (isFinite(W) ? Math.max(W, 0.1) : 0.15);
        if (pts.s[i] > 1) {
          pts.s[i] = 0;
          pts.ph[i] = Math.random() * 6.28;
        }
        pts.ph[i] += dt * (sS.value * 6) / Math.max(r / 0.04, 0.4);
        pos[3 * i] = x * 1.2;
        pos[3 * i + 1] = r * Math.sin(pts.ph[i]);
        pos[3 * i + 2] = r * Math.cos(pts.ph[i]);
        col[3 * i] = after ? 0.98 : 0.13;
        col[3 * i + 1] = after ? 0.45 : 0.83;
        col[3 * i + 2] = after ? 0.37 : 0.93;
      }
      geo.attributes.position.needsUpdate = true;
      geo.attributes.color.needsUpdate = true;
    });
  });
  function drawMap() {
    if (!map) return;
    pM.set([{ x: map.swirl, y: map.dp_crit, color: cssVar("--accent"), width: 2.6, fill: "zero", fillAlpha: 0.12, label: { es: "límite de breakdown (modelo)", en: "breakdown limit (model)" } }], [
      { type: "point", x: sS.value, y: sP.value, color: last && last.x_breakdown != null ? cssVar("--bad") : cssVar("--good"), r: 6 },
      { type: "text", x: 0.1, y: 0.05, text: { es: "estable", en: "stable" } },
      { type: "text", x: 0.55, y: 0.4, text: { es: "breakdown", en: "breakdown" } },
    ]);
  }
  const call = liveCall("bd", "vortex.breakdown", 30);
  function run() {
    call({ swirl: sS.value, dp_max: sP.value }, (r) => {
      last = r;
      pW.set([
        { x: r.x, y: r.W, color: cssVar("--accent"), width: 2.6, label: { es: "W eje / W₀", en: "axis W / W₀" } },
        { x: r.x, y: r.core_radius, color: cssVar("--accent-2"), label: { es: "radio de núcleo / a₀", en: "core radius / a₀" } },
        { x: r.x, y: r.dp.map((p) => p * 3), color: cssVar("--fg-dim"), dash: [4, 3], label: { es: "Δp exterior (×3)", en: "outer Δp (×3)" } },
      ], r.x_breakdown != null ? [{ type: "vline", x: r.x_breakdown, color: cssVar("--bad"), label: { es: "breakdown", en: "breakdown" } }] : []);
      roB.set(r.supercritical ? L("supercrítico", "supercritical") : r.x_breakdown != null ? L("BREAKDOWN", "BREAKDOWN") : L("intacto", "intact"), r.x_breakdown != null || r.supercritical ? "bad" : "good");
      roX.set(r.x_breakdown == null ? "–" : r.x_breakdown.toFixed(2));
      roC.set(r.dp_crit.toFixed(3));
      drawMap();
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Cuándo «estalla» un vórtice: swirl, gradiente adverso, burbuja y espiral. Por qué un vórtice muy intenso puede ser más frágil.",
    en: "When does a vortex “burst”: swirl, adverse gradient, bubble and spiral modes. Why a very strong vortex can be more fragile.",
  },
  heroParams: { eps: 0.05, camber: 0.12, alpha: 12 },
  intuition: {
    es: R`<p>Un vórtice longitudinal (como los del borde del suelo o el de un ala delta) tiene un núcleo con velocidad axial y velocidad de giro. Si el vórtice entra en una zona donde la presión exterior sube (gradiente adverso: difusor, zona trasera de un alerón, gran ángulo de ataque en un delta), su núcleo, que ya está a baja presión por el giro, se frena. Al frenarse se ensancha (continuidad), al ensancharse pierde velocidad de giro en el centro, su presión de núcleo sube... y se frena más. Es una realimentación positiva.</p>
    <p>Si es suficientemente fuerte, la velocidad axial en el eje cae a cero: aparece un <b>punto de remanso</b> y el núcleo "estalla" en una <span class="term">burbuja</span> de recirculación o en una <span class="term">espiral</span>, aguas abajo de la cual el vórtice es grande, desorganizado y turbulento: se pierde su succión. Cuanto <b>más swirl</b> tiene el vórtice (más intenso respecto a su velocidad axial), más cerca está del umbral y <b>menos gradiente adverso necesita</b> para estallar.</p>`,
    en: R`<p>A streamwise vortex (like floor-edge vortices or a delta-wing vortex) has a core with axial velocity and swirl. If the vortex enters a region where the outer pressure rises (adverse gradient: a diffuser, the rear of a wing, high incidence on a delta), its core, already at low pressure because of swirl, decelerates. Decelerating, it widens (continuity); widening, it loses central swirl, its core pressure rises... and it decelerates further. Positive feedback.</p>
    <p>If strong enough, the axial velocity on the axis drops to zero: a <b>stagnation point</b> appears and the core "bursts" into a recirculation <span class="term">bubble</span> or a <span class="term">spiral</span>, downstream of which the vortex is large, disorganised and turbulent: its suction is lost. The <b>more swirl</b> the vortex has (stronger relative to its axial velocity), the closer it is to the threshold and the <b>less adverse gradient it needs</b> to burst.</p>`,
  },
  physics: {
    es: R`<p><b>Parámetro de swirl</b>: \(S=\dfrac{v_{\theta,max}}{W_0}\) (o \(q=\Gamma/(2\pi r_c W_0)\)). Experimentalmente el breakdown aparece para \(S\gtrsim1.3\)–1.5 en tubos sin gradiente externo (Leibovich 1978; Spall, Gatski & Grosch 1987 dan \(Ro=W/(r\Omega)\lesssim0.65\)); un gradiente adverso lo adelanta.</p>
    <p><b>Teoría de Benjamin</b>: el flujo pasa de "supercrítico" (las ondas de inercia no remontan) a "subcrítico"; el breakdown es la transición entre ambos estados, análogo a un resalto hidráulico.</p>
    <p><b>Modelo cuasi-1D del laboratorio</b>: en el eje \(p_{eje}+\tfrac12\rho W^2=\text{cte}\), \(p_{eje}=p_{ext}-\rho\ln2\,(\Gamma/2\pi a)^2\), \(a^2W=\text{cte}\): $$\frac{W^2}{2}-\frac{K}{W_0}W=\frac{W_0^2}{2}-K-\frac{\Delta p}{\rho},\quad K=\ln2\left(\frac{\Gamma}{2\pi a_0}\right)^2$$ No hay solución si \(\Delta p/\rho>(W_0-K/W_0)^2/2\): el \(\Delta p\) crítico <b>disminuye al aumentar el swirl</b>.</p>
    <p><b>Tipos</b>: burbuja axisimétrica, espiral, doble hélice. <b>Consecuencias</b>: en alas delta, pérdida brusca de sustentación de vórtice y buffeting; en un F1, pérdida de sellado del suelo, carga inestable y sensibilidad a altura y cabeceo.</p>`,
    en: R`<p><b>Swirl parameter</b>: \(S=\dfrac{v_{\theta,max}}{W_0}\) (or \(q=\Gamma/(2\pi r_c W_0)\)). Experimentally breakdown appears for \(S\gtrsim1.3\)–1.5 in tubes without outer gradient (Leibovich 1978; Spall, Gatski & Grosch 1987 give \(Ro=W/(r\Omega)\lesssim0.65\)); an adverse gradient advances it.</p>
    <p><b>Benjamin's theory</b>: the flow changes from "supercritical" (inertial waves cannot travel upstream) to "subcritical"; breakdown is the transition between both states, analogous to a hydraulic jump.</p>
    <p><b>The lab's quasi-1D model</b>: on the axis \(p_{axis}+\tfrac12\rho W^2=\text{const}\), \(p_{axis}=p_{ext}-\rho\ln2\,(\Gamma/2\pi a)^2\), \(a^2W=\text{const}\): $$\frac{W^2}{2}-\frac{K}{W_0}W=\frac{W_0^2}{2}-K-\frac{\Delta p}{\rho},\quad K=\ln2\left(\frac{\Gamma}{2\pi a_0}\right)^2$$ No solution exists if \(\Delta p/\rho>(W_0-K/W_0)^2/2\): the critical \(\Delta p\) <b>decreases as swirl increases</b>.</p>
    <p><b>Types</b>: axisymmetric bubble, spiral, double helix. <b>Consequences</b>: on delta wings, abrupt loss of vortex lift and buffeting; on an F1 car, loss of floor sealing, unsteady downforce and sensitivity to ride height and pitch.</p>`,
  },
  labs: [{ title: { es: "Vortex breakdown: swirl frente a gradiente adverso", en: "Vortex breakdown: swirl versus adverse gradient" }, desc: { es: "Sube el swirl con el gradiente fijo, o el gradiente con el swirl fijo. Observa el punto de operación en el mapa.", en: "Increase swirl at fixed gradient, or the gradient at fixed swirl. Watch the operating point on the map." }, mount: breakdownLab }],
  interview: [
    { q: { es: "¿Cuándo hace breakdown un vórtice?", en: "When does a vortex break down?" }, a: { es: R`<p>Cuando su swirl (relación entre velocidad tangencial y axial) es alto y/o se encuentra un gradiente de presión adverso a lo largo de su eje. El núcleo decelera, se ensancha y la velocidad axial en el eje llega a cero: punto de remanso, burbuja o espiral, y aguas abajo un núcleo grande y turbulento. Valores típicos: swirl ≈ 1.3–1.5 sin gradiente; menos con gradiente adverso.</p>`, en: R`<p>When its swirl (tangential to axial velocity ratio) is high and/or it meets an adverse pressure gradient along its axis. The core decelerates, widens and the axial velocity on the axis reaches zero: stagnation point, bubble or spiral, and downstream a large turbulent core. Typical values: swirl ≈ 1.3–1.5 without gradient; less with an adverse gradient.</p>` } },
    { q: { es: "¿Por qué un vórtice más débil puede persistir más que uno fuerte?", en: "Why can a weaker vortex persist longer than a strong one?" }, a: { es: R`<p>Porque el breakdown depende del swirl: un vórtice intenso (mucho giro respecto a su velocidad axial) está más cerca del umbral y estalla con un gradiente adverso pequeño, perdiendo su estructura. Uno más débil tolera más subida de presión antes de estallar y sigue coherente más lejos, aunque dé menos succión. En diseño de F1 se busca a veces un vórtice "suficiente" y estable en vez de uno muy fuerte que estalle en el difusor.</p>`, en: R`<p>Because breakdown depends on swirl: an intense vortex (lots of rotation relative to its axial velocity) is closer to the threshold and bursts under a small adverse gradient, losing its structure. A weaker one tolerates a larger pressure rise before bursting and stays coherent further downstream, though it gives less suction. F1 design sometimes prefers an "adequate", stable vortex to a very strong one that bursts in the diffuser.</p>` } },
  ],
  myths: [
    { es: "«Más intensidad de vórtice = siempre más carga». Hasta que estalla: entonces la carga cae y se vuelve inestable.", en: "“Stronger vortex = always more downforce”. Until it bursts: then downforce drops and becomes unsteady." },
    { es: "«El breakdown es lo mismo que la disipación viscosa». Es una transición rápida e inestable de la estructura del núcleo, no un decaimiento lento.", en: "“Breakdown is the same as viscous decay”. It is a fast, unstable change of the core structure, not slow decay." },
  ],
  quiz: [
    { q: { es: "Un gradiente de presión adverso a lo largo del eje del vórtice…", en: "An adverse pressure gradient along the vortex axis…" }, options: [{ es: "retrasa el breakdown", en: "delays breakdown" }, { es: "lo adelanta", en: "advances it" }, { es: "no influye", en: "has no influence" }, { es: "lo elimina", en: "removes it" }], correct: 1, explain: { es: "Frena el núcleo y amplifica la realimentación.", en: "It slows the core and amplifies the feedback." } },
    { q: { es: "En el punto de breakdown la velocidad axial en el eje es…", en: "At the breakdown point the axial velocity on the axis is…" }, options: [{ es: "máxima", en: "maximum" }, { es: "cero (remanso)", en: "zero (stagnation)" }, { es: "supersónica", en: "supersonic" }, { es: "igual a W₀", en: "equal to W₀" }], correct: 1, explain: { es: "Se forma un punto de remanso y una burbuja/espiral.", en: "A stagnation point and a bubble/spiral form." } },
  ],
  refs: [
    "S. Leibovich, “The structure of vortex breakdown”, <i>Annu. Rev. Fluid Mech.</i> 10 (1978).",
    "M.G. Hall, “Vortex breakdown”, <i>Annu. Rev. Fluid Mech.</i> 4 (1972).",
    "R.E. Spall, T.B. Gatski & C.E. Grosch, “A criterion for vortex breakdown”, <i>Phys. Fluids</i> 30 (1987).",
    "T.B. Benjamin, “Theory of the vortex breakdown phenomenon”, <i>JFM</i> 14 (1962).",
  ],
};
