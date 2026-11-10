import { slider, labLayout, readout, toggle, L } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function vgLab(host) {
  const ui = labLayout(host);
  const pH = new Plot(ui.viz, { height: 260, xlabel: { es: "x / L", en: "x / L" }, ylabel: { es: "factor de forma H", en: "shape factor H" }, ylim: [1.2, 2.2] });
  const pB = new Plot(ui.viz, { height: 180, xlabel: { es: "x / L", en: "x / L" }, ylabel: { es: "aumento de mezcla b(x)", en: "mixing boost b(x)" } });
  const sK = slider({ label: { es: "Gradiente adverso k (ue/U = 1 − k x)", en: "Adverse gradient k (ue/U = 1 − k x)" }, min: 0.3, max: 0.8, step: 0.01, value: 0.55, onInput: run });
  const sX = slider({ label: { es: "Posición de los VG x/L", en: "VG position x/L" }, min: 0.05, max: 0.7, step: 0.01, value: 0.3, onInput: run });
  const sHd = slider({ label: { es: "Altura h/δ", en: "Height h/δ" }, min: 0.05, max: 1.2, step: 0.01, value: 0.4, onInput: run });
  const sS = slider({ label: { es: "Separación lateral s/h", en: "Spanwise spacing s/h" }, min: 2, max: 16, step: 0.5, value: 6, onInput: run });
  const tV = toggle({ label: { es: "VGs instalados", en: "VGs fitted" }, value: true, onInput: run });
  ui.controls.append(sK.el, sX.el, sHd.el, sS.el, tV.el);
  const roS0 = readout({ es: "Separación sin VG", en: "Separation without VG" }, "x/L");
  const roS = readout({ es: "Separación con VG", en: "Separation with VG" }, "x/L");
  const roD = readout({ es: "Altura del VG / δ local", en: "VG height / local δ" });
  const roC = readout({ es: "ΔCd del dispositivo (estim.)", en: "Device ΔCd (estimate)" });
  ui.readouts.append(roS0.el, roS.el, roD.el, roC.el);
  ui.note.innerHTML = L(
    "Capa límite turbulenta (Head) en un gradiente adverso lineal. Los VG se modelan como un aumento de la mezcla (entrainment ×(1+b)) que decae aguas abajo en ~60 alturas del dispositivo; eficacia según h/δ y s/h siguiendo las tendencias revisadas por Lin (2002). Es un modelo semiempírico de tendencias.",
    "Turbulent boundary layer (Head) in a linear adverse gradient. VGs are modelled as increased mixing (entrainment ×(1+b)) decaying downstream over ~60 device heights; effectiveness versus h/δ and s/h follows the trends reviewed by Lin (2002). A semi-empirical trend model."
  );
  const call = liveCall("vg", "flowcontrol.vg", 50);
  function run() {
    call({ k: sK.value, x_vg: sX.value, h_over_delta: sHd.value, spacing_over_h: sS.value, use_vg: tV.value }, (r) => {
      const mk = [];
      if (r.x_sep_base != null) mk.push({ type: "vline", x: r.x_sep_base, color: cssVar("--fg-dim"), label: { es: "sep. sin VG", en: "sep. no VG" } });
      if (tV.value && r.x_sep != null) mk.push({ type: "vline", x: r.x_sep, color: cssVar("--bad"), label: { es: "sep. con VG", en: "sep. with VG" }, labelOffset: 14 });
      mk.push({ type: "vline", x: sX.value, color: cssVar("--good"), dash: [2, 3], label: { es: "VG", en: "VG" }, labelOffset: 28 });
      pH.set([
        { x: r.x, y: r.H_base, color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "sin VG", en: "without VG" } },
        { x: r.x, y: r.H, color: cssVar("--accent"), width: 2.6, label: { es: "con VG", en: "with VG" } },
      ], [...mk, { type: "hline", y: 2.0, color: cssVar("--bad"), label: { es: "H de separación", en: "separation H" } }]);
      pB.set([{ x: r.x, y: r.boost, color: cssVar("--accent-3"), width: 2.4, fill: "zero", label: { es: "b(x)", en: "b(x)" } }]);
      roS0.set(r.x_sep_base == null ? "–" : r.x_sep_base.toFixed(2));
      roS.set(!tV.value ? "–" : r.x_sep == null ? L("adherida", "attached") : r.x_sep.toFixed(2), tV.value && (r.x_sep == null || r.x_sep > (r.x_sep_base || 0)) ? "good" : "");
      roD.set(sHd.value.toFixed(2));
      roC.set(r.device_dcd.toExponential(1));
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Pequeñas aletas que generan vórtices longitudinales para llevar fluido rápido a la pared y retrasar la separación: altura, separación, posición y coste.",
    en: "Small vanes that create streamwise vortices to bring fast fluid to the wall and delay separation: height, spacing, position and cost.",
  },
  heroParams: { eps: 0.1, camber: 0.06, alpha: 10 },
  intuition: {
    es: R`<p>Un <span class="term">generador de vórtices</span> (VG) es una aleta pequeña puesta a incidencia respecto al flujo. Su vórtice de punta es longitudinal: gira alrededor de un eje alineado con la corriente y, al girar, baja fluido de alta energía de la parte exterior de la capa límite hacia la pared y sube fluido lento. La capa límite queda más "llena" (H menor) y aguanta más gradiente adverso antes de separar.</p>
    <p>Se colocan <b>antes</b> de la zona problemática (no en ella), con altura del orden de una fracción del espesor de la capa límite. Los VG de "bajo perfil" (h/δ ≈ 0.2–0.5) consiguen casi todo el efecto con mucha menos resistencia propia. En un F1 se ven en suelos, difusores, carenados de suspensión y antes de zonas con gradiente adverso; los propios vórtices de los bordes del suelo hacen el mismo trabajo a gran escala.</p>`,
    en: R`<p>A <span class="term">vortex generator</span> (VG) is a small vane set at incidence to the flow. Its tip vortex is streamwise: it rotates about an axis aligned with the stream and, in doing so, carries high-energy fluid from the outer boundary layer down to the wall and lifts slow fluid up. The boundary layer becomes "fuller" (lower H) and withstands more adverse gradient before separating.</p>
    <p>They are placed <b>upstream</b> of the problem region (not in it), with a height of a fraction of the boundary-layer thickness. "Low-profile" VGs (h/δ ≈ 0.2–0.5) achieve most of the effect with much less device drag. On an F1 car they appear on floors, diffusers, suspension fairings and ahead of adverse-gradient regions; the floor-edge vortices do the same job at large scale.</p>`,
  },
  physics: {
    es: R`<p><b>Mecanismo</b>: transporte convectivo de cantidad de movimiento hacia la pared (no difusión). En un método integral se representa como mayor <b>entrainment</b>: en la ecuación de Head, \(\frac{d}{dx}(u_e\theta H_1)=u_eF(H_1)\,(1+b(x))\).</p>
    <p><b>Diseño</b> (Lin 2002): \(h/\delta\approx0.1\)–0.5 para VG de bajo perfil; separación lateral \(s\approx2\)–8 \(h\) (contrarrotatorios o corrotatorios); distancia a la separación \(\approx5\)–30 \(h\); los vórtices persisten unas 50–100 alturas. Más altura → más efecto pero más resistencia de los propios VG (\(\propto(h/\delta)^2\) aprox.).</p>
    <p><b>Coste</b>: resistencia de los dispositivos + mayor fricción aguas abajo (capa límite más llena, \(C_f\) mayor). Compensa si evita una separación (que cuesta mucha más resistencia de presión y carga).</p>`,
    en: R`<p><b>Mechanism</b>: convective transport of momentum towards the wall (not diffusion). In an integral method it is represented as increased <b>entrainment</b>: in Head's equation, \(\frac{d}{dx}(u_e\theta H_1)=u_eF(H_1)\,(1+b(x))\).</p>
    <p><b>Design</b> (Lin 2002): \(h/\delta\approx0.1\)–0.5 for low-profile VGs; spanwise spacing \(s\approx2\)–8 \(h\) (counter- or co-rotating); distance to separation \(\approx5\)–30 \(h\); vortices persist about 50–100 heights. Taller → more effect but more device drag (\(\propto(h/\delta)^2\) approx.).</p>
    <p><b>Cost</b>: device drag + higher downstream friction (fuller boundary layer, higher \(C_f\)). Worth it if it prevents separation (which costs far more pressure drag and downforce).</p>`,
  },
  labs: [{ title: { es: "VG ante un gradiente adverso", en: "VGs against an adverse gradient" }, desc: { es: "Mueve los VG lejos y cerca de la separación, y cambia su altura: hay un óptimo.", en: "Move the VGs far from and close to separation, and change their height: there is an optimum." }, mount: vgLab }],
  interview: [
    { q: { es: "¿Cómo funciona un generador de vórtices y dónde lo pondrías?", en: "How does a vortex generator work and where would you put it?" }, a: { es: R`<p>Crea un vórtice longitudinal que mezcla fluido de alta energía hacia la pared, llena el perfil de velocidad y retrasa la separación. Se pone aguas arriba de la zona de gradiente adverso (≈5–30 alturas antes), con h/δ ≈ 0.2–0.5 si es de bajo perfil y separación lateral de unas pocas alturas.</p>`, en: R`<p>It creates a streamwise vortex that mixes high-energy fluid towards the wall, fills the velocity profile and delays separation. Put it upstream of the adverse-gradient region (≈5–30 heights ahead), with h/δ ≈ 0.2–0.5 for low-profile devices and spanwise spacing of a few heights.</p>` } },
  ],
  myths: [
    { es: "«Los VG funcionan haciendo turbulenta la capa límite». Funcionan aunque ya sea turbulenta: el vórtice organizado transporta cantidad de movimiento a gran escala.", en: "“VGs work by making the boundary layer turbulent”. They work even if it already is: the organised vortex transports momentum at large scale." },
    { es: "«Más grande es mejor». Más allá de h ≈ δ apenas mejora y la resistencia crece mucho.", en: "“Bigger is better”. Beyond h ≈ δ there is little gain and drag grows a lot." },
  ],
  quiz: [
    { q: { es: "Un VG de bajo perfil típico tiene h/δ ≈", en: "A typical low-profile VG has h/δ ≈" }, options: [{ es: "0.01", en: "0.01" }, { es: "0.2–0.5", en: "0.2–0.5" }, { es: "2–3", en: "2–3" }, { es: "10", en: "10" }], correct: 1, explain: { es: "Lin (2002).", en: "Lin (2002)." } },
    { q: { es: "Los VG se colocan…", en: "VGs are placed…" }, options: [{ es: "en la zona separada", en: "in the separated region" }, { es: "aguas arriba de la separación", en: "upstream of separation" }, { es: "en el borde de salida", en: "at the trailing edge" }, { es: "da igual", en: "anywhere" }], correct: 1, explain: { es: "Necesitan distancia para que el vórtice mezcle antes del gradiente adverso.", en: "They need distance for the vortex to mix before the adverse gradient." } },
  ],
  refs: [
    "J.C. Lin, “Review of research on low-profile vortex generators to control boundary-layer separation”, <i>Prog. Aerosp. Sci.</i> 38, 2002.",
    "H.H. Pearcey, “Shock-induced separation and its prevention by design and boundary-layer control”, 1961.",
    "J. Katz, <i>Race Car Aerodynamics</i> (vortex generators on race cars).",
  ],
};
