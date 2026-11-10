import { slider, labLayout, readout, segmented, button, L, tr, el, canvasBox, engineBadge } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics } from "../js/bridge/physics.js";

const R = String.raw;

function oscLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 240 });
  const wait = engineBadge(box);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pL = new Plot(row, { height: 250, xlabel: { es: "α [°]", en: "α [°]" }, ylabel: { es: "Cl", en: "Cl" } });
  const pC = new Plot(row, { height: 250, xlabel: { es: "frecuencia reducida k = ωc/2V", en: "reduced frequency k = ωc/2V" }, ylabel: { es: "C(k) = F + iG", en: "C(k) = F + iG" }, logX: true });
  const sK = slider({ label: { es: "Frecuencia reducida k", en: "Reduced frequency k" }, min: 0.02, max: 1.0, step: 0.01, value: 0.3 });
  const sA = slider({ label: { es: "Amplitud de cabeceo [°]", en: "Pitch amplitude [°]" }, min: 1, max: 8, step: 0.5, value: 4 });
  const go = button({ es: "▶ Simular (panel + estela libre)", en: "▶ Simulate (panel + free wake)" }, run, "primary");
  const status = el("div", { class: "lab-note" });
  ui.controls.append(sK.el, sA.el, go, status);
  const roA = readout({ es: "Amplitud Cl (panel)", en: "Cl amplitude (panel)" });
  const roT = readout({ es: "Amplitud Cl (Theodorsen)", en: "Cl amplitude (Theodorsen)" });
  const roQ = readout({ es: "Cl cuasi-estático", en: "Quasi-steady Cl" });
  ui.readouts.append(roA.el, roT.el, roQ.el);
  ui.note.innerHTML = L(
    "Perfil NACA 0012 cabeceando α = A sin ωt alrededor de c/4. Panel no estacionario con estela libre (Python) frente a la teoría de Theodorsen (placa delgada, estela plana). Al subir k, el lazo Cl–α se abre (desfase) y la amplitud de la parte circulatoria cae (|C(k)| &lt; 1); a k altos domina la masa aparente.",
    "NACA 0012 pitching α = A sin ωt about c/4. Unsteady panel method with free wake (Python) versus Theodorsen's theory (thin plate, flat wake). As k grows the Cl–α loop opens (phase lag) and the circulatory amplitude drops (|C(k)| &lt; 1); at high k added mass dominates."
  );
  let sim = null, t0 = 0;
  async function run() {
    status.innerHTML = L("Simulando 3 ciclos…", "Simulating 3 cycles…");
    const k = sK.value;
    const tEnd = (3 * 2 * Math.PI) / (2 * k);
    const dt = Math.min(0.06, tEnd / 260);
    const [s, th] = await Promise.all([
      physics.call("unsteady.simulate", { motion: "pitch", alpha0: 0, amp: sA.value, k, t_end: tEnd, dt, save_every: 3 }),
      physics.call("unsteady.theodorsen", { alpha0: 0, amp: sA.value, k }),
    ]);
    status.innerHTML = "";
    wait.remove();
    sim = s;
    t0 = performance.now();
    const half = Math.floor(s.cl.length / 3);
    const a = s.alpha.slice(half), c = s.cl.slice(half);
    pL.set([
      { x: a, y: c, color: cssVar("--accent"), width: 2.4, label: { es: "panel + estela libre", en: "panel + free wake" } },
      { x: th.alpha, y: th.cl, color: cssVar("--accent-2"), dash: [5, 4], label: { es: "Theodorsen", en: "Theodorsen" } },
      { x: [-sA.value, sA.value], y: [-2 * Math.PI * sA.value * Math.PI / 180, 2 * Math.PI * sA.value * Math.PI / 180], color: cssVar("--fg-dim"), dash: [2, 3], label: { es: "cuasi-estático 2πα", en: "quasi-steady 2πα" } },
    ]);
    pC.set([
      { x: th.k, y: th.F, color: cssVar("--accent"), width: 2.4, label: { es: "F(k)", en: "F(k)" } },
      { x: th.k, y: th.G, color: cssVar("--accent-3"), width: 2.4, label: { es: "G(k)", en: "G(k)" } },
    ], [{ type: "vline", x: k, color: cssVar("--accent-2") }]);
    roA.set(((Math.max(...c) - Math.min(...c)) / 2).toFixed(3));
    roT.set(((Math.max(...th.cl) - Math.min(...th.cl)) / 2).toFixed(3));
    roQ.set((2 * Math.PI * sA.value * Math.PI / 180).toFixed(3));
  }
  function frame() {
    if (!document.body.contains(box)) return;
    requestAnimationFrame(frame);
    if (!sim) return;
    const dpr = window.devicePixelRatio || 1;
    const W = box.clientWidth, H = box.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = cssVar("--flow-bg");
    g.fillRect(0, 0, W, H);
    const fr = sim.frames;
    const kf = Math.floor(((performance.now() - t0) / 1000) * 15) % fr.length;
    const f = fr[kf];
    const sc = Math.min(W / 9, H / 2.2);
    const X = (x) => 30 + x * sc, Y = (y) => H / 2 - y * sc;
    const ti = Math.min(sim.alpha.length - 1, Math.round(f.t / (sim.t[1] - sim.t[0])) - 1);
    const a = (-sim.alpha[Math.max(ti, 0)] * Math.PI) / 180;
    g.fillStyle = cssVar("--body-fill");
    g.strokeStyle = cssVar("--body-stroke");
    g.beginPath();
    sim.body.x.forEach((x, i) => {
      const xr = 0.25 + (x - 0.25) * Math.cos(a) - sim.body.y[i] * Math.sin(a);
      const yr = (x - 0.25) * Math.sin(a) + sim.body.y[i] * Math.cos(a);
      i ? g.lineTo(X(xr), Y(yr)) : g.moveTo(X(xr), Y(yr));
    });
    g.closePath();
    g.fill();
    g.stroke();
    const gm = Math.max(...f.g.map(Math.abs), 1e-9);
    for (let i = 0; i < f.x.length; i++) {
      g.fillStyle = f.g[i] > 0 ? "rgba(251,146,60,0.8)" : "rgba(34,211,238,0.8)";
      g.beginPath();
      g.arc(X(f.x[i]), Y(f.y[i]), 1.5 + 3 * Math.sqrt(Math.abs(f.g[i]) / gm), 0, 7);
      g.fill();
    }
    g.fillStyle = cssVar("--fg-muted");
    g.font = "11px Inter";
    g.fillText(tr({ es: "estela libre: vorticidad de signo alterno (calle de vórtices)", en: "free wake: alternating-sign vorticity (vortex street)" }), 10, 16);
  }
  requestAnimationFrame(frame);
  run();
}

export default {
  subtitle: {
    es: "Cuando el flujo no tiene tiempo de adaptarse: frecuencia reducida, Wagner y Theodorsen, estelas oscilantes, desprendimiento de vórtices (Strouhal) y su relación con el porpoising.",
    en: "When the flow has no time to adapt: reduced frequency, Wagner and Theodorsen, oscillating wakes, vortex shedding (Strouhal) and their link with porpoising.",
  },
  heroParams: { eps: 0.1, camber: 0.04, alpha: 6 },
  intuition: {
    es: R`<p>Si un perfil cambia de ángulo despacio, la sustentación sigue en cada instante a la curva estacionaria. Si cambia deprisa, la circulación no puede ajustarse al instante: cada cambio desprende vorticidad a la estela, y esa estela "recuerda" el pasado e induce velocidades sobre el perfil. El parámetro que lo mide es la <span class="term">frecuencia reducida</span> \(k=\omega c/2V\): cuántas semicuerdas recorre el aire en un radián de oscilación. Con \(k\lesssim0.05\) el flujo es casi estacionario; con \(k\gtrsim0.2\) los efectos no estacionarios son fuertes.</p>
    <p>Las dos soluciones clásicas: <b>Wagner</b> (respuesta a un escalón: 50 % al instante) y <b>Theodorsen</b> (oscilación armónica: amplitud reducida y desfase). En un F1 esto aparece en el <b>porpoising</b> (oscilaciones de 4–8 Hz con k no despreciable para el suelo), en baches, en la apertura y cierre del DRS y en el desprendimiento de vórtices de cuerpos romos (\(St=fD/V\approx0.2\)).</p>`,
    en: R`<p>If an airfoil changes angle slowly, lift follows the steady curve at every instant. If it changes quickly, circulation cannot adjust instantly: every change sheds vorticity into the wake, and that wake "remembers" the past and induces velocities on the airfoil. The parameter is the <span class="term">reduced frequency</span> \(k=\omega c/2V\): how many semi-chords the air travels per radian of oscillation. With \(k\lesssim0.05\) the flow is almost steady; with \(k\gtrsim0.2\) unsteady effects are strong.</p>
    <p>Two classic solutions: <b>Wagner</b> (step response: 50 % instantly) and <b>Theodorsen</b> (harmonic oscillation: reduced amplitude and phase lag). On an F1 car this appears in <b>porpoising</b> (4–8 Hz oscillations with non-negligible k for the floor), over bumps, when DRS opens and closes, and in bluff-body vortex shedding (\(St=fD/V\approx0.2\)).</p>`,
  },
  physics: {
    es: R`<p><b>Theodorsen</b> (placa delgada, cabeceo y plunge armónicos, semicuerda \(b\), pivote en \(a\,b\) desde el centro): $$C_l=\underbrace{\pi b\left(\frac{\dot\alpha}{V}-\frac{b\,a\,\ddot\alpha}{V^2}+\frac{\ddot h}{V^2}\right)}_{\text{masa aparente}}+\underbrace{2\pi\,C(k)\left[\alpha+\frac{\dot h}{V}+b\left(\tfrac12-a\right)\frac{\dot\alpha}{V}\right]}_{\text{circulatoria}}$$ con la función de Theodorsen \(C(k)=F+iG=\dfrac{H_1^{(2)}(k)}{H_1^{(2)}(k)+iH_0^{(2)}(k)}\): \(C(0)=1\), \(C(\infty)=1/2\).</p>
    <p><b>Wagner</b>: \(C_l(s)=2\pi\alpha\,\Phi(s)\), \(\Phi(0)=0.5\); relación con Theodorsen por transformada de Fourier.</p>
    <p><b>Strouhal</b>: desprendimiento periódico de vórtices tras cuerpos romos, \(St=fD/V\approx0.2\) (cilindro); tras un Gurney o un borde de salida grueso aparece también una calle de von Kármán.</p>
    <p><b>Panel no estacionario</b>: en cada paso Kutta + Kelvin + estela libre; la fuerza sale de \(\mathbf F=-\rho\,d\mathbf I/dt\), \(\mathbf I=\sum\Gamma_k(y_k,-x_k)\).</p>`,
    en: R`<p><b>Theodorsen</b> (thin plate, harmonic pitch and plunge, semichord \(b\), pivot at \(a\,b\) from mid-chord): $$C_l=\underbrace{\pi b\left(\frac{\dot\alpha}{V}-\frac{b\,a\,\ddot\alpha}{V^2}+\frac{\ddot h}{V^2}\right)}_{\text{added mass}}+\underbrace{2\pi\,C(k)\left[\alpha+\frac{\dot h}{V}+b\left(\tfrac12-a\right)\frac{\dot\alpha}{V}\right]}_{\text{circulatory}}$$ with Theodorsen's function \(C(k)=F+iG=\dfrac{H_1^{(2)}(k)}{H_1^{(2)}(k)+iH_0^{(2)}(k)}\): \(C(0)=1\), \(C(\infty)=1/2\).</p>
    <p><b>Wagner</b>: \(C_l(s)=2\pi\alpha\,\Phi(s)\), \(\Phi(0)=0.5\); related to Theodorsen through a Fourier transform.</p>
    <p><b>Strouhal</b>: periodic vortex shedding behind bluff bodies, \(St=fD/V\approx0.2\) (cylinder); a von Kármán street also appears behind a Gurney or a thick trailing edge.</p>
    <p><b>Unsteady panel</b>: every step Kutta + Kelvin + free wake; force from \(\mathbf F=-\rho\,d\mathbf I/dt\), \(\mathbf I=\sum\Gamma_k(y_k,-x_k)\).</p>`,
  },
  labs: [{ title: { es: "Perfil en cabeceo: panel con estela libre frente a Theodorsen", en: "Pitching airfoil: panel with free wake versus Theodorsen" }, desc: { es: "Compara k = 0.05 (casi estacionario) con k = 0.5: el lazo se abre y la amplitud cambia.", en: "Compare k = 0.05 (almost steady) with k = 0.5: the loop opens and the amplitude changes." }, mount: oscLab }],
  interview: [
    { q: { es: "¿Qué es la frecuencia reducida y cuándo importa?", en: "What is the reduced frequency and when does it matter?" }, a: { es: R`<p>\(k=\omega c/2V\): compara el tiempo que tarda el aire en recorrer una semicuerda con el periodo de la oscilación. Con \(k<0.05\) el flujo es cuasi-estacionario; con \(k>0.2\) la estela y la masa aparente cambian amplitud y fase de la carga (Theodorsen). En F1: porpoising, baches, DRS, guiñada transitoria.</p>`, en: R`<p>\(k=\omega c/2V\): it compares the time for air to travel a semi-chord with the oscillation period. With \(k<0.05\) the flow is quasi-steady; with \(k>0.2\) the wake and added mass change the load amplitude and phase (Theodorsen). In F1: porpoising, bumps, DRS, transient yaw.</p>` } },
  ],
  myths: [
    { es: "«La carga responde instantáneamente a la altura o al ángulo». Hay un retraso ligado a la estela (Wagner/Theodorsen) que puede alimentar oscilaciones como el porpoising.", en: "“Downforce responds instantly to ride height or angle”. There is a wake-related lag (Wagner/Theodorsen) that can feed oscillations such as porpoising." },
  ],
  quiz: [
    { q: { es: "C(k) de Theodorsen tiende a… cuando k → ∞", en: "Theodorsen's C(k) tends to… as k → ∞" }, options: [{ es: "1", en: "1" }, { es: "0.5", en: "0.5" }, { es: "0", en: "0" }, { es: "∞", en: "∞" }], correct: 1, explain: { es: "La parte circulatoria se reduce a la mitad.", en: "The circulatory part halves." } },
  ],
  refs: [
    "T. Theodorsen, “General theory of aerodynamic instability and the mechanism of flutter”, NACA Rep. 496, 1935.",
    "J.G. Leishman, <i>Principles of Helicopter Aerodynamics</i>, CUP, ch. 8 (unsteady aerodynamics).",
    "J. Katz & A. Plotkin, <i>Low-Speed Aerodynamics</i>, ch. 13.",
  ],
};
