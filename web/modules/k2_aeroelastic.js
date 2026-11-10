import { slider, labLayout, readout, L, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function staticLab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pL = new Plot(row, { height: 260, xlabel: { es: "velocidad [m/s]", en: "speed [m/s]" }, ylabel: { es: "carga flexible / rígida", en: "flexible / rigid load" }, ylim: [0.4, 3] });
  const pT = new Plot(row, { height: 260, xlabel: { es: "velocidad [m/s]", en: "speed [m/s]" }, ylabel: { es: "torsión elástica [°]", en: "elastic twist [°]" } });
  const sE = slider({ label: { es: "Eje elástico detrás del centro aerodinámico e/c", en: "Elastic axis aft of aerodynamic centre e/c" }, min: 0.02, max: 0.3, step: 0.01, value: 0.15, onInput: run });
  const sK = slider({ label: { es: "Rigidez torsional K [N·m/rad por m]", en: "Torsional stiffness K [N·m/rad per m]" }, min: 300, max: 4000, step: 50, value: 1200, onInput: run });
  ui.controls.append(sE.el, sK.el);
  const roD = readout({ es: "Velocidad de divergencia", en: "Divergence speed" }, "m/s");
  ui.readouts.append(roD.el);
  ui.note.innerHTML = L(
    "Sección típica con resorte torsional. Si el eje elástico está detrás del centro aerodinámico, la carga tuerce el perfil hacia más incidencia: amplificación y divergencia. Si está delante (curva verde, misma rigidez), la carga lo descarga a alta velocidad: alivio de carga y menos resistencia en recta, el principio de los alerones flexibles que la FIA limita con ensayos de carga.",
    "Typical section with a torsional spring. If the elastic axis is aft of the aerodynamic centre, load twists the section to more incidence: amplification and divergence. If it is ahead (green curve, same stiffness), load unloads it at high speed: load relief and less drag on straights, the principle of flexible wings that the FIA limits with load tests."
  );
  const call = liveCall("div", "aeroelastic.divergence", 30);
  function run() {
    call({ e: sE.value, K: sK.value }, (r) => {
      pL.set([
        { x: r.flex.V, y: r.flex.load_ratio, color: cssVar("--bad"), width: 2.6, label: { es: "EA detrás del AC (divergente)", en: "EA aft of AC (divergent)" } },
        { x: r.relief.V, y: r.relief.load_ratio, color: cssVar("--good"), width: 2.6, label: { es: "EA delante del AC (alivio)", en: "EA ahead of AC (relief)" } },
      ], r.flex.V_div ? [{ type: "vline", x: r.flex.V_div, color: cssVar("--bad"), label: { es: "divergencia", en: "divergence" } }] : []);
      pT.set([
        { x: r.flex.V, y: r.flex.twist_deg, color: cssVar("--bad"), width: 2.4, label: { es: "EA detrás", en: "EA aft" } },
        { x: r.relief.V, y: r.relief.twist_deg, color: cssVar("--good"), width: 2.4, label: { es: "EA delante", en: "EA ahead" } },
      ]);
      roD.set(r.flex.V_div ? r.flex.V_div.toFixed(0) : "–", r.flex.V_div && r.flex.V_div < 100 ? "bad" : "");
    });
  }
  run();
}

function flutterLab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pF = new Plot(row, { height: 260, xlabel: { es: "velocidad [m/s]", en: "speed [m/s]" }, ylabel: { es: "frecuencia [Hz]", en: "frequency [Hz]" } });
  const pD = new Plot(row, { height: 260, xlabel: { es: "velocidad [m/s]", en: "speed [m/s]" }, ylabel: { es: "amortiguamiento ζ", en: "damping ζ" } });
  const sX = slider({ label: { es: "CG detrás del eje elástico x_θ (semicuerdas)", en: "CG aft of elastic axis x_θ (semichords)" }, min: -0.2, max: 0.44, step: 0.02, value: 0.2, onInput: run });
  const sW = slider({ label: { es: "ω_h / ω_θ", en: "ω_h / ω_θ" }, min: 0.2, max: 0.9, step: 0.02, value: 0.5, onInput: run });
  const sE = slider({ label: { es: "EA detrás del AC e/c", en: "EA aft of AC e/c" }, min: 0.02, max: 0.35, step: 0.01, value: 0.2, onInput: run });
  const sM = slider({ label: { es: "Relación de masa μ", en: "Mass ratio μ" }, min: 5, max: 60, step: 1, value: 20, onInput: run });
  ui.controls.append(sX.el, sW.el, sE.el, sM.el);
  const roF = readout({ es: "Velocidad de flameo", en: "Flutter speed" }, "m/s");
  const roD = readout({ es: "Velocidad de divergencia", en: "Divergence speed" }, "m/s");
  ui.readouts.append(roF.el, roD.el);
  ui.note.innerHTML = L(
    "Sección típica de 2 grados de libertad (plunge + cabeceo) con aerodinámica estacionaria. Al aumentar la velocidad, la rigidez aerodinámica acerca las frecuencias de flexión y torsión; cuando se juntan (coalescencia), un modo pierde amortiguamiento: flameo. Con el CG sobre o delante del eje elástico (x_θ ≤ 0) desaparece: es el equilibrado másico. x_θ está limitado a < r_θ = 0.5 (el radio de giro no puede ser menor que la distancia al CG).",
    "Two-degree-of-freedom typical section (plunge + pitch) with steady aerodynamics. As speed rises, aerodynamic stiffness brings the bending and torsion frequencies together; when they merge (coalescence) one mode loses damping: flutter. With the CG at or ahead of the elastic axis (x_θ ≤ 0) it disappears: mass balancing. x_θ is limited to < r_θ = 0.5 (the radius of gyration cannot be smaller than the CG offset)."
  );
  const call = liveCall("flut", "aeroelastic.flutter", 40);
  function run() {
    call({ x_theta: sX.value, w_ratio: sW.value, e: sE.value, mu: sM.value }, (r) => {
      const mk = [];
      if (r.V_flutter) mk.push({ type: "vline", x: r.V_flutter, color: cssVar("--bad"), label: { es: "flameo", en: "flutter" } });
      if (r.V_divergence) mk.push({ type: "vline", x: r.V_divergence, color: cssVar("--accent-2"), label: { es: "divergencia", en: "divergence" }, labelOffset: 14 });
      pF.set([
        { x: r.V, y: r.freq.map((f) => f[0]), color: cssVar("--accent"), width: 2.4, label: { es: "modo 1", en: "mode 1" } },
        { x: r.V, y: r.freq.map((f) => f[1]), color: cssVar("--accent-3"), width: 2.4, label: { es: "modo 2", en: "mode 2" } },
      ], mk);
      pD.set([
        { x: r.V, y: r.damping.map((d) => d[0]), color: cssVar("--accent"), width: 2.4, label: { es: "modo 1", en: "mode 1" } },
        { x: r.V, y: r.damping.map((d) => d[1]), color: cssVar("--accent-3"), width: 2.4, label: { es: "modo 2", en: "mode 2" } },
      ], [...mk, { type: "hline", y: 0, color: cssVar("--fg-dim") }]);
      roF.set(r.V_flutter ? r.V_flutter.toFixed(0) : L("ninguna", "none"), r.V_flutter ? "bad" : "good");
      roD.set(r.V_divergence ? r.V_divergence.toFixed(0) : L("ninguna", "none"));
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Cuando la estructura se deforma con la carga: divergencia, alivio de carga de los alerones flexibles y flameo por coalescencia de modos.",
    en: "When the structure deforms under load: divergence, load relief of flexible wings and flutter by mode coalescence.",
  },
  heroParams: { eps: 0.1, camber: 0.06, alpha: 4 },
  intuition: {
    es: R`<p>Ningún alerón es infinitamente rígido. La carga aerodinámica lo flexa y lo tuerce, y al torcerse cambia su incidencia y por tanto la carga: un bucle de realimentación. Si la carga tuerce hacia más incidencia (eje elástico detrás del centro aerodinámico), el bucle es inestable a partir de una velocidad: <span class="term">divergencia</span>. Si tuerce hacia menos incidencia, la carga se alivia con la velocidad: un alerón "flexible" que en recta pierde carga (y resistencia) y en curva lenta la mantiene. Es lo que la FIA vigila con sus ensayos de deformación bajo carga.</p>
    <p>El <span class="term">flameo</span> (flutter) es dinámico: la flexión y la torsión tienen frecuencias propias; las fuerzas aerodinámicas las acoplan y, a cierta velocidad, las acercan hasta fundirlas. Entonces el aire aporta energía en cada ciclo y la oscilación crece. Se evita con rigidez torsional, separando frecuencias y adelantando el centro de gravedad (equilibrado másico).</p>`,
    en: R`<p>No wing is infinitely stiff. Aerodynamic load bends and twists it, and twisting changes its incidence and hence the load: a feedback loop. If load twists towards more incidence (elastic axis aft of the aerodynamic centre) the loop becomes unstable above a certain speed: <span class="term">divergence</span>. If it twists towards less incidence, load is relieved with speed: a "flexible" wing that sheds downforce (and drag) on straights and keeps it in slow corners. This is what the FIA checks with its load-deflection tests.</p>
    <p><span class="term">Flutter</span> is dynamic: bending and torsion have natural frequencies; aerodynamic forces couple them and, at a certain speed, bring them together until they merge. The air then feeds energy every cycle and the oscillation grows. It is avoided with torsional stiffness, separating frequencies and moving the centre of gravity forward (mass balancing).</p>`,
  },
  physics: {
    es: R`<p><b>Divergencia</b> (sección típica, rigidez \(K_\theta\), EA a \(e\,c\) detrás del AC): $$K_\theta\theta=q\,c^2e\,a(\alpha_0+\theta)\Rightarrow\theta=\alpha_0\frac{\lambda}{1-\lambda},\quad\lambda=\frac{q\,c^2e\,a}{K_\theta},\quad q_D=\frac{K_\theta}{c^2e\,a}$$ \(L/L_{rigido}=1/(1-\lambda)\); con \(e<0\) la carga se alivia.</p>
    <p><b>Flameo</b> (pitch-plunge, aerodinámica estacionaria): $$\begin{bmatrix}m&S\\S&I\end{bmatrix}\begin{bmatrix}\ddot h\\\ddot\theta\end{bmatrix}+\begin{bmatrix}K_h&qca\\0&K_\theta-qc^2ea\end{bmatrix}\begin{bmatrix}h\\\theta\end{bmatrix}=0$$ Autovalores frente a \(V\): coalescencia de frecuencias → parte real positiva (flameo); autovalor real positivo → divergencia. \(S=m\,x_\theta b\): con \(x_\theta\le0\) no hay acoplamiento inercial y no aparece flameo de este tipo.</p>`,
    en: R`<p><b>Divergence</b> (typical section, stiffness \(K_\theta\), EA at \(e\,c\) aft of AC): $$K_\theta\theta=q\,c^2e\,a(\alpha_0+\theta)\Rightarrow\theta=\alpha_0\frac{\lambda}{1-\lambda},\quad\lambda=\frac{q\,c^2e\,a}{K_\theta},\quad q_D=\frac{K_\theta}{c^2e\,a}$$ \(L/L_{rigid}=1/(1-\lambda)\); with \(e<0\) load is relieved.</p>
    <p><b>Flutter</b> (pitch-plunge, steady aerodynamics): $$\begin{bmatrix}m&S\\S&I\end{bmatrix}\begin{bmatrix}\ddot h\\\ddot\theta\end{bmatrix}+\begin{bmatrix}K_h&qca\\0&K_\theta-qc^2ea\end{bmatrix}\begin{bmatrix}h\\\theta\end{bmatrix}=0$$ Eigenvalues versus \(V\): frequency coalescence → positive real part (flutter); real positive eigenvalue → divergence. \(S=m\,x_\theta b\): with \(x_\theta\le0\) there is no inertial coupling and this flutter does not appear.</p>`,
  },
  labs: [
    { title: { es: "Divergencia y alerón flexible (estático)", en: "Divergence and flexible wing (static)" }, mount: staticLab },
    { title: { es: "Flameo por coalescencia de modos (dinámico)", en: "Flutter by mode coalescence (dynamic)" }, mount: flutterLab },
  ],
  interview: [
    { q: { es: "¿Qué es un alerón flexible y por qué interesa?", en: "What is a flexible wing and why is it attractive?" }, a: { es: R`<p>Un alerón cuya estructura se deforma con la carga de forma que, a alta velocidad, reduce su incidencia (o abre un hueco): pierde carga y resistencia en recta y la conserva en curvas lentas, una especie de DRS pasivo. Aeroelásticamente: eje elástico delante del centro aerodinámico (alivio de carga). La FIA lo limita con ensayos de deflexión estática y controles en pista.</p>`, en: R`<p>A wing whose structure deforms under load so that, at high speed, it reduces incidence (or opens a slot): it sheds downforce and drag on straights and keeps it in slow corners, a sort of passive DRS. Aeroelastically: elastic axis ahead of the aerodynamic centre (load relief). The FIA limits it with static deflection tests and on-track checks.</p>` } },
    { q: { es: "¿Qué es el flameo y cómo se evita?", en: "What is flutter and how is it avoided?" }, a: { es: R`<p>Una inestabilidad dinámica en la que la aerodinámica acopla dos modos estructurales (flexión y torsión), cuyas frecuencias se acercan con la velocidad hasta fundirse; el aire aporta energía y la amplitud crece. Se evita con rigidez torsional, separando frecuencias, con equilibrado másico (CG delante del eje elástico) y manteniendo la velocidad de flameo muy por encima de la máxima.</p>`, en: R`<p>A dynamic instability in which aerodynamics couples two structural modes (bending and torsion) whose frequencies approach each other with speed until they merge; the air feeds energy and the amplitude grows. It is avoided with torsional stiffness, separating frequencies, mass balancing (CG ahead of the elastic axis) and keeping the flutter speed well above the maximum speed.</p>` } },
  ],
  myths: [
    { es: "«Flameo = vibración por turbulencia». El flameo es una inestabilidad autoexcitada (el aire aporta energía al modo), no una respuesta forzada.", en: "“Flutter = vibration from turbulence”. Flutter is a self-excited instability (the air feeds energy into the mode), not a forced response." },
  ],
  quiz: [
    { q: { es: "Con el eje elástico detrás del centro aerodinámico, al aumentar la velocidad la carga…", en: "With the elastic axis aft of the aerodynamic centre, as speed rises the load…" }, options: [{ es: "se alivia", en: "is relieved" }, { es: "se amplifica hasta divergencia", en: "is amplified up to divergence" }, { es: "no cambia", en: "does not change" }, { es: "se invierte", en: "reverses" }], correct: 1, explain: { es: "L/L_rígido = 1/(1 − q/q_D).", en: "L/L_rigid = 1/(1 − q/q_D)." } },
  ],
  refs: [
    "D.H. Hodges & G.A. Pierce, <i>Introduction to Structural Dynamics and Aeroelasticity</i>, 2nd ed., CUP, 2011, ch. 4–5.",
    "R.L. Bisplinghoff, H. Ashley & R.L. Halfman, <i>Aeroelasticity</i>, Dover.",
    "FIA Formula 1 Technical Regulations (bodywork deflection tests).",
  ],
};
