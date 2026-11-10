import { slider, labLayout, readout, L, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { FlowView } from "../js/core/field.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function modelsLab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pV = new Plot(row, { height: 260, xlabel: { es: "r / r_c", en: "r / r_c" }, ylabel: { es: "v_θ / (Γ/2π r_c)", en: "v_θ / (Γ/2π r_c)" }, xlim: [0, 5] });
  const pP = new Plot(row, { height: 260, xlabel: { es: "r / r_c", en: "r / r_c" }, ylabel: { es: "(p − p∞) / ρ(Γ/2π r_c)²", en: "(p − p∞) / ρ(Γ/2π r_c)²" }, xlim: [0, 5] });
  const fv = new FlowView(ui.viz, { height: 240, world: { x0: -1, x1: 1, y0: -0.5, y1: 0.5 }, particles: 700, speed: 0.01, trail: 0.9 });
  const sRc = slider({ label: { es: "Radio de núcleo r_c", en: "Core radius r_c" }, min: 0.03, max: 0.3, step: 0.01, value: 0.1, onInput: run });
  const sG = slider({ label: { es: "Circulación Γ", en: "Circulation Γ" }, min: 0.2, max: 2, step: 0.05, value: 1, onInput: run });
  ui.controls.append(sRc.el, sG.el);
  const roV = readout({ es: "v_θ máx", en: "max v_θ" });
  const roP = readout({ es: "Cp en el eje (vs V = Γ/2πr_c)", en: "axis Cp (vs V = Γ/2πr_c)" });
  ui.readouts.append(roV.el, roP.el);
  ui.note.innerHTML = L(
    R`Rankine: núcleo en rotación sólida + vórtice potencial. Lamb-Oseen: solución viscosa exacta (difusión de un vórtice puntual), núcleo gaussiano; Burgers: mismo perfil mantenido por estiramiento. La presión se obtiene de \(dp/dr=\rho v_\theta^2/r\): <b>el núcleo es una zona de baja presión</b> (por eso los vórtices "chupan" y se usan para sellar el suelo de un F1).`,
    R`Rankine: solid-body core + potential vortex. Lamb-Oseen: exact viscous solution (diffusing point vortex), Gaussian core; Burgers: same profile sustained by stretching. Pressure from \(dp/dr=\rho v_\theta^2/r\): <b>the core is a low-pressure region</b> (which is why vortices "suck" and are used to seal an F1 floor).`
  );
  const call = liveCall("vprof", "vortex.profiles", 30);
  function run() {
    const rc = sRc.value, G = sG.value;
    call({ gamma: G, rc }, (r) => {
      const vs = G / (2 * Math.PI * rc);
      const x = r.r.map((v) => v / rc);
      pV.set([
        { x, y: r.rankine.v.map((v) => v / vs), color: cssVar("--accent-2"), label: { es: "Rankine", en: "Rankine" } },
        { x, y: r.lamb_oseen.v.map((v) => v / vs), color: cssVar("--accent"), width: 2.6, label: { es: "Lamb-Oseen / Burgers", en: "Lamb-Oseen / Burgers" } },
        { x, y: x.map((xx) => (xx > 0.2 ? 1 / xx : null)), color: cssVar("--fg-dim"), dash: [4, 3], label: { es: "potencial 1/r", en: "potential 1/r" } },
      ]);
      pP.set([
        { x, y: r.rankine.p.map((p) => p / (vs * vs)), color: cssVar("--accent-2"), label: { es: "Rankine", en: "Rankine" } },
        { x, y: r.lamb_oseen.p.map((p) => p / (vs * vs)), color: cssVar("--accent"), width: 2.6, label: { es: "Lamb-Oseen", en: "Lamb-Oseen" } },
      ]);
      const vmax = Math.max(...r.lamb_oseen.v);
      roV.set(vmax.toFixed(2));
      roP.set(((2 * r.lamb_oseen.p[0]) / (vs * vs)).toFixed(2));
      // 2D field of the Lamb-Oseen vortex on a grid (interpolating the radial profile from Python)
      const nx = 80, ny = 40;
      const xs = [...Array(nx).keys()].map((i) => -1 + (2 * i) / (nx - 1));
      const ys = [...Array(ny).keys()].map((j) => -0.5 + j / (ny - 1));
      const interp = (rr) => {
        const k = Math.min(r.r.length - 2, Math.floor((rr / r.r[r.r.length - 1]) * (r.r.length - 1)));
        if (k < 0) return 0;
        if (rr > r.r[r.r.length - 1]) return r.lamb_oseen.v[r.r.length - 1] * (r.r[r.r.length - 1] / rr);
        const t = (rr - r.r[k]) / (r.r[k + 1] - r.r[k]);
        return r.lamb_oseen.v[k] * (1 - t) + r.lamb_oseen.v[k + 1] * t;
      };
      const U = ys.map((y) => xs.map((x) => {
        const rr = Math.hypot(x, y) + 1e-9;
        return (-interp(rr) * y) / rr;
      }));
      const V = ys.map((y) => xs.map((x) => {
        const rr = Math.hypot(x, y) + 1e-9;
        return (interp(rr) * x) / rr;
      }));
      fv.setField({ x: xs, y: ys, u: U, v: V });
      fv.setOverlays([(g, v) => {
        g.strokeStyle = "rgba(251,191,36,0.8)";
        g.setLineDash([4, 4]);
        g.beginPath();
        g.arc(v.X(0), v.Y(0), rc * v.scale, 0, 7);
        g.stroke();
        g.setLineDash([]);
      }]);
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Cómo nacen los vórtices, modelos de núcleo (Rankine, Lamb-Oseen, Burgers), presión en el núcleo y su uso en un F1.",
    en: "How vortices are born, core models (Rankine, Lamb-Oseen, Burgers), core pressure and their use on an F1 car.",
  },
  heroParams: { eps: 0.05, camber: 0.12, alpha: 10 },
  intuition: {
    es: R`<p>La vorticidad <b>nace en las paredes</b>: la condición de no deslizamiento crea un gradiente de velocidad (cizalladura) en la capa límite, que es vorticidad. Mientras la capa está pegada, esa vorticidad se queda cerca de la pared. Cuando <b>se desprende</b> (separación en un borde afilado, el borde de salida, la punta de un ala, un endplate, el borde del suelo, un vortex generator), la lámina de vorticidad libre se <b>enrolla</b> sobre sí misma y forma un vórtice concentrado.</p>
    <p>Un vórtice real tiene un <b>núcleo</b> viscoso que gira casi como un sólido rígido y, fuera, una región potencial donde la velocidad cae como 1/r. El equilibrio radial exige que la presión baje hacia el centro: el núcleo es una zona de <b>baja presión</b>. En un F1 los vórtices se usan para "sellar" los bordes del suelo (impedir que entre aire lateral que destruiría la succión), para energizar capas límite y para gestionar estelas de las ruedas.</p>`,
    en: R`<p>Vorticity is <b>born at walls</b>: the no-slip condition creates a velocity gradient (shear) in the boundary layer, which is vorticity. While the layer is attached, that vorticity stays near the wall. When it <b>sheds</b> (separation at a sharp edge, the trailing edge, a wing tip, an endplate, the floor edge, a vortex generator), the free vorticity sheet <b>rolls up</b> on itself into a concentrated vortex.</p>
    <p>A real vortex has a viscous <b>core</b> rotating almost as a rigid body and, outside, a potential region where velocity falls as 1/r. Radial equilibrium requires pressure to fall towards the centre: the core is a <b>low-pressure</b> region. On an F1 car vortices are used to "seal" the floor edges (preventing lateral inflow that would kill the suction), to energise boundary layers and to manage tyre wakes.</p>`,
  },
  physics: {
    es: R`<p><b>Ecuación de la vorticidad</b> (incompresible): $$\frac{D\boldsymbol\omega}{Dt}=(\boldsymbol\omega\cdot\nabla)\mathbf u+\nu\nabla^2\boldsymbol\omega$$ estiramiento/inclinación de los tubos de vórtice + difusión viscosa. Teoremas de Helmholtz: los tubos de vórtice se mueven con el fluido, su circulación es constante y no pueden terminar en el fluido.</p>
    <p><b>Modelos de núcleo</b> (\(r_c\) = radio de velocidad máxima):</p>
    <ul><li>Rankine: \(v_\theta=\frac{\Gamma r}{2\pi r_c^2}\) (r&lt;r_c), \(\frac{\Gamma}{2\pi r}\) fuera.</li>
    <li>Lamb-Oseen: \(v_\theta=\frac{\Gamma}{2\pi r}\left(1-e^{-r^2/a^2}\right)\), \(a=\sqrt{4\nu t}\), \(r_c=1.121a\), \(v_{\theta,max}=0.638\,\frac{\Gamma}{2\pi a}\).</li>
    <li>Burgers: mismo perfil, estacionario, con estiramiento axial \(u_z=2\alpha z\) que equilibra la difusión: \(a^2=2\nu/\alpha\).</li></ul>
    <p><b>Presión en el núcleo</b>: \(\dfrac{dp}{dr}=\rho\dfrac{v_\theta^2}{r}\Rightarrow p(0)-p_\infty=-\rho\ln2\left(\dfrac{\Gamma}{2\pi a}\right)^2\) (Lamb-Oseen), \(-\rho\left(\frac{\Gamma}{2\pi r_c}\right)^2\) (Rankine).</p>
    <p><b>Generadores de vórtices</b>: pequeñas aletas a incidencia de altura ≈ δ que crean vórtices longitudinales; mezclan fluido de alta energía hacia la pared y retrasan la separación (tienen coste de resistencia).</p>`,
    en: R`<p><b>Vorticity equation</b> (incompressible): $$\frac{D\boldsymbol\omega}{Dt}=(\boldsymbol\omega\cdot\nabla)\mathbf u+\nu\nabla^2\boldsymbol\omega$$ stretching/tilting of vortex tubes + viscous diffusion. Helmholtz theorems: vortex tubes move with the fluid, their circulation is constant and they cannot end in the fluid.</p>
    <p><b>Core models</b> (\(r_c\) = radius of maximum velocity):</p>
    <ul><li>Rankine: \(v_\theta=\frac{\Gamma r}{2\pi r_c^2}\) (r&lt;r_c), \(\frac{\Gamma}{2\pi r}\) outside.</li>
    <li>Lamb-Oseen: \(v_\theta=\frac{\Gamma}{2\pi r}\left(1-e^{-r^2/a^2}\right)\), \(a=\sqrt{4\nu t}\), \(r_c=1.121a\), \(v_{\theta,max}=0.638\,\frac{\Gamma}{2\pi a}\).</li>
    <li>Burgers: same profile, steady, with axial stretching \(u_z=2\alpha z\) balancing diffusion: \(a^2=2\nu/\alpha\).</li></ul>
    <p><b>Core pressure</b>: \(\dfrac{dp}{dr}=\rho\dfrac{v_\theta^2}{r}\Rightarrow p(0)-p_\infty=-\rho\ln2\left(\dfrac{\Gamma}{2\pi a}\right)^2\) (Lamb-Oseen), \(-\rho\left(\frac{\Gamma}{2\pi r_c}\right)^2\) (Rankine).</p>
    <p><b>Vortex generators</b>: small vanes at incidence, height ≈ δ, creating streamwise vortices; they mix high-energy fluid towards the wall and delay separation (at some drag cost).</p>`,
  },
  labs: [{ title: { es: "Modelos de vórtice: velocidad y presión", en: "Vortex models: velocity and pressure" }, desc: { es: "La línea discontinua amarilla marca el radio del núcleo. Las partículas muestran la rotación de sólido rígido dentro y el decaimiento 1/r fuera.", en: "The dashed yellow line marks the core radius. Particles show solid-body rotation inside and 1/r decay outside." }, mount: modelsLab }],
  interview: [
    { q: { es: "¿Cómo se genera un vórtice, a grandes rasgos?", en: "Broadly, how is a vortex generated?" }, a: { es: R`<p>La vorticidad se crea en la pared por la condición de no deslizamiento (capa límite). Si la capa límite se separa en un borde (afilado o por gradiente adverso), la vorticidad pasa al flujo como una lámina libre que, por autoinducción, se enrolla en un vórtice concentrado. En alas, cualquier variación de carga a lo largo de la envergadura desprende vorticidad que se enrolla en los vórtices de punta.</p>`, en: R`<p>Vorticity is created at the wall by the no-slip condition (boundary layer). If the boundary layer separates at an edge (sharp or due to adverse gradient), vorticity enters the flow as a free sheet that, by self-induction, rolls up into a concentrated vortex. On wings, any spanwise load variation sheds vorticity that rolls up into the tip vortices.</p>` } },
    { q: { es: "¿Por qué el centro de un vórtice está a baja presión y para qué se usa en un F1?", en: "Why is a vortex centre at low pressure, and how is that used on an F1 car?" }, a: { es: R`<p>Las partículas giran: necesitan fuerza centrípeta, que la da un gradiente radial de presión \(dp/dr=\rho v_\theta^2/r>0\). La presión mínima está en el eje. En F1 los vórtices de los bordes del suelo crean una "cortina" de baja presión y alta energía que impide que el aire lateral entre bajo el coche, mantiene la succión del suelo y ayuda al difusor.</p>`, en: R`<p>Particles rotate: they need a centripetal force, provided by a radial pressure gradient \(dp/dr=\rho v_\theta^2/r>0\). Minimum pressure is on the axis. On F1 cars floor-edge vortices create a low-pressure, high-energy "curtain" that keeps lateral air from entering under the car, preserving floor suction and helping the diffuser.</p>` } },
  ],
  myths: [
    { es: "«Los vórtices se crean de la nada en el fluido». En flujo incompresible y barotrópico la vorticidad solo se genera en las paredes (o por fuerzas no conservativas).", en: "“Vortices appear out of nothing in the fluid”. In incompressible barotropic flow vorticity is only generated at walls (or by non-conservative forces)." },
    { es: "«Un vórtice potencial gira como un sólido». Fuera del núcleo la vorticidad es nula: las partículas orbitan sin rotar sobre sí mismas.", en: "“A potential vortex rotates like a solid”. Outside the core vorticity is zero: particles orbit without spinning." },
  ],
  quiz: [
    { q: { es: "En un vórtice de Lamb-Oseen el radio de velocidad máxima es…", en: "In a Lamb-Oseen vortex the radius of maximum velocity is…" }, options: [{ es: "a", en: "a" }, { es: "1.121 a", en: "1.121 a" }, { es: "2 a", en: "2 a" }, { es: "0", en: "0" }], correct: 1, explain: { es: "Máximo de (1 − e^(−r²/a²))/r.", en: "Maximum of (1 − e^(−r²/a²))/r." } },
    { q: { es: "La presión en el centro de un vórtice es…", en: "Pressure at the centre of a vortex is…" }, options: [{ es: "mayor que la ambiente", en: "higher than ambient" }, { es: "igual", en: "equal" }, { es: "menor que la ambiente", en: "lower than ambient" }, { es: "indeterminada", en: "undetermined" }], correct: 2, explain: { es: "dp/dr = ρv²/r > 0.", en: "dp/dr = ρv²/r > 0." } },
  ],
  refs: [
    "P.G. Saffman, <i>Vortex Dynamics</i>, CUP, 1992.",
    "G.K. Batchelor, <i>An Introduction to Fluid Dynamics</i>, §5.2, §7.",
    "J. Katz, <i>Race Car Aerodynamics</i> (vortex generators, underbody sealing).",
  ],
};
