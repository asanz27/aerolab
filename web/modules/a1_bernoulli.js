import { slider, labLayout, readout, toggle, L, tr, engineBadge } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { FlowView, cpColor, rgb } from "../js/core/field.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function venturiLab(host) {
  const ui = labLayout(host);
  const fv = new FlowView(ui.viz, { height: 300, world: { x0: -0.02, x1: 1.02, y0: -0.36, y1: 0.36 }, particles: 700, speed: 0.004, trail: 0.85 });
  const wait = engineBadge(fv.box);
  const plot = new Plot(ui.viz, { height: 220, xlabel: { es: "x / L", en: "x / L" }, ylabel: { es: "Cp  ·  u/U_in", en: "Cp  ·  u/U_in" } });
  const sThroat = slider({ label: { es: "Semialtura de garganta h_t [m]", en: "Throat half-height h_t [m]" }, min: 0.05, max: 0.2, step: 0.005, value: 0.09, onInput: run });
  const sExit = slider({ label: { es: "Semialtura de salida h_e [m]", en: "Exit half-height h_e [m]" }, min: 0.06, max: 0.3, step: 0.005, value: 0.14, onInput: run });
  const sDiff = slider({ label: { es: "Longitud del difusor (fracción)", en: "Diffuser length (fraction)" }, min: 0.15, max: 0.45, step: 0.01, value: 0.45, onInput: run });
  const sU = slider({ label: { es: "Velocidad de entrada U_in [m/s]", en: "Inlet velocity U_in [m/s]" }, min: 2, max: 40, step: 1, value: 10, onInput: run });
  ui.controls.append(sThroat.el, sExit.el, sDiff.el, sU.el);
  const roU = readout({ es: "u garganta", en: "throat u" }, "m/s");
  const roCp = readout({ es: "Cp garganta", en: "throat Cp" });
  const roAng = readout({ es: "Semiángulo difusor", en: "Diffuser half-angle" }, "°");
  const roLoss = readout({ es: "Pérdida p₀ / q_in", en: "p₀ loss / q_in" });
  ui.readouts.append(roU.el, roCp.el, roAng.el, roLoss.el);
  ui.note.innerHTML = L(
    "Modelo: continuidad + Bernoulli cuasi-1D; capa límite turbulenta (Head) en la pared. Si separa en el difusor, el núcleo sale como chorro y la presión deja de recuperarse. Los tubos verticales son piezómetros: la altura de la columna es la presión estática.",
    "Model: quasi-1D continuity + Bernoulli; turbulent boundary layer (Head) on the wall. If it separates in the diffuser the core leaves as a jet and pressure stops recovering. Vertical tubes are piezometers: column height is static pressure."
  );
  const call = liveCall("venturi", "duct.solve", 50);
  let last = null;
  function run() {
    const xt0 = 0.45, xt1 = 0.55;
    const xe = Math.min(1, xt1 + sDiff.value);
    const ctrl_x = [0, 0.25, xt0, xt1, xe, 1.0];
    const ctrl_h = [0.2, 0.2, sThroat.value, sThroat.value, sExit.value, sExit.value];
    call({ ctrl_x, ctrl_h, U_in: sU.value }, draw);
  }
  function draw(r) {
    wait.remove();
    last = r;
    const top = { x: [...r.x, r.x[r.x.length - 1], r.x[0]], y: [...r.h, 0.36, 0.36], fill: cssVar("--body-fill"), stroke: cssVar("--body-stroke") };
    const bot = { x: [...r.x, r.x[r.x.length - 1], r.x[0]], y: [...r.h.map((v) => -v), -0.36, -0.36], fill: cssVar("--body-fill"), stroke: cssVar("--body-stroke") };
    fv.setBodies([top, bot]);
    fv.setField(r.field, { reseed: !fv.field });
    const st = [0.1, 0.3, 0.5, 0.7, 0.9];
    fv.setOverlays([
      (g, v) => {
        const pmin = Math.min(...r.cp), pmax = Math.max(...r.cp, 0.2);
        for (const xs of st) {
          const i = Math.round(xs * (r.x.length - 1));
          const h = r.h[i];
          const X = v.X(r.x[i]);
          const base = v.Y(h);
          const col = (r.cp[i] - pmin) / (pmax - pmin + 1e-9);
          const height = 10 + 50 * col;
          g.fillStyle = "rgba(34,211,238,0.12)";
          g.fillRect(X - 5, base - 64, 10, 64);
          g.fillStyle = "rgba(34,211,238,0.85)";
          g.fillRect(X - 5, base - height, 10, height);
          g.strokeStyle = cssVar("--contour");
          g.strokeRect(X - 5, base - 64, 10, 64);
        }
        if (r.x_sep != null) {
          g.strokeStyle = cssVar("--bad");
          g.setLineDash([4, 4]);
          g.beginPath();
          g.moveTo(v.X(r.x_sep), v.Y(0.36));
          g.lineTo(v.X(r.x_sep), v.Y(-0.36));
          g.stroke();
          g.setLineDash([]);
          g.fillStyle = cssVar("--bad");
          g.font = "12px Inter";
          g.fillText(tr({ es: "separación", en: "separation" }), v.X(r.x_sep) + 4, v.Y(-0.3));
        }
      },
    ]);
    const Ui = sU.value;
    plot.set(
      [
        { x: r.x, y: r.cp, color: cssVar("--accent"), label: { es: "Cp (real)", en: "Cp (actual)" }, width: 2.5 },
        { x: r.x, y: r.u.map((v) => v / Ui), color: cssVar("--accent-2"), label: { es: "u / U_in", en: "u / U_in" } },
        { x: r.x, y: r.u_attached.map((v) => 1 - (v / Ui) ** 2), color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "Cp ideal (sin separación)", en: "ideal Cp (no separation)" } },
      ],
      r.x_sep != null ? [{ type: "vline", x: r.x_sep, color: cssVar("--bad"), label: { es: "separación", en: "separation" } }] : []
    );
    const it = r.h.indexOf(Math.min(...r.h));
    roU.set(r.u[it].toFixed(1));
    roCp.set(r.cp[it].toFixed(2));
    roAng.set(r.max_half_angle.toFixed(1), r.max_half_angle > 7 ? "warn" : "good");
    roLoss.set(r.p0_loss_coeff.toFixed(2), r.p0_loss_coeff > 0.05 ? "bad" : "good");
  }
  run();
}

function curvatureLab(host) {
  const ui = labLayout(host);
  const fv = new FlowView(ui.viz, { height: 300, world: { x0: -3, x1: 3, y0: -2, y1: 2 }, particles: 900, speed: 0.004 });
  const wait = engineBadge(fv.box);
  const plot = new Plot(ui.viz, { height: 200, xlabel: { es: "altura y/R sobre el cilindro (x = 0)", en: "height y/R above the cylinder (x = 0)" }, ylabel: { es: "Cp", en: "Cp" }, invertY: false });
  const sG = slider({ label: { es: "Circulación Γ / (V R)", en: "Circulation Γ / (V R)" }, min: 0, max: 10, step: 0.1, value: 0, onInput: run });
  const tCp = toggle({ label: { es: "Colorear por Cp", en: "Colour by Cp" }, value: true, onInput: run });
  ui.controls.append(sG.el, tCp.el);
  const roTop = readout({ es: "Cp en la cima", en: "Cp at the top" });
  const roFar = readout({ es: "Cp a y = 2R", en: "Cp at y = 2R" });
  ui.readouts.append(roTop.el, roFar.el);
  ui.note.innerHTML = L(
    R`Equilibrio normal a las líneas de corriente: \(\partial p/\partial n = \rho V^2 / R_c\). Donde las líneas se curvan alrededor del cuerpo, la presión <b>disminuye hacia el centro de curvatura</b>: por eso la presión en la superficie es menor que la de la corriente libre (Cp &lt; 0) aunque la línea de corriente "no sepa" nada de Bernoulli.`,
    R`Equilibrium normal to the streamlines: \(\partial p/\partial n = \rho V^2 / R_c\). Where streamlines curve around the body, pressure <b>decreases towards the centre of curvature</b>: that is why surface pressure is lower than free-stream (Cp &lt; 0).`
  );
  const call = liveCall("curv", "potential.cylinder", 40);
  function run() {
    call({ gamma: sG.value, x0: -3, x1: 3, y0: -2, y1: 2, nx: 110, ny: 74 }, (r) => {
      wait.remove();
      const th = [...Array(121).keys()].map((i) => (i / 120) * 2 * Math.PI);
      fv.setBodies([{ x: th.map(Math.cos), y: th.map(Math.sin) }]);
      fv.setField({ x: r.x, y: r.y, u: r.u, v: r.v }, { reseed: !fv.field });
      fv.setScalar(tCp.value ? { x: r.x, y: r.y, values: r.cp, map: (v) => cpColor(v, -3, 1), alpha: 150 } : null);
      // Cp along x = 0 above the cylinder (column closest to x = 0)
      const ix = r.x.reduce((b, v, i) => (Math.abs(v) < Math.abs(r.x[b]) ? i : b), 0);
      const ys = [], cps = [];
      r.y.forEach((y, j) => {
        if (y >= 1.0 && r.cp[j][ix] != null) {
          ys.push(y);
          cps.push(r.cp[j][ix]);
        }
      });
      plot.set([{ x: ys, y: cps, color: cssVar("--accent"), label: { es: "Cp(y) sobre el cilindro", en: "Cp(y) above the cylinder" } }], [{ type: "hline", y: 0, color: cssVar("--fg-dim"), label: { es: "corriente libre", en: "free stream" } }]);
      roTop.set(cps[0] != null ? cps[0].toFixed(2) : "–");
      const k = ys.findIndex((y) => y >= 2);
      roFar.set(k >= 0 ? cps[k].toFixed(2) : cps[cps.length - 1].toFixed(2));
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Continuidad, cantidad de movimiento y energía: por qué un fluido acelera en una garganta y por qué recuperar presión es lo difícil.",
    en: "Continuity, momentum and energy: why a fluid accelerates in a throat and why recovering pressure is the hard part.",
  },
  heroParams: { eps: 0.12, camber: 0.0, alpha: 0 },
  intuition: {
    es: R`<p>En un flujo estacionario la masa no se acumula: si la sección de un conducto se estrecha, el fluido <b>tiene</b> que acelerar (<span class="term">continuidad</span>). Para acelerarlo hace falta una fuerza neta, y en un fluido sin viscosidad la única disponible es un <b>gradiente de presión</b>: la presión es más alta aguas arriba de la garganta y más baja en ella. <b>Bernoulli</b> no es la causa de nada: es la relación energética entre ese campo de presión y el de velocidad, consecuencia de la ecuación de Euler integrada a lo largo de una línea de corriente.</p>
    <p>La parte fácil es acelerar (gradiente favorable, la capa límite se adelgaza). La difícil es <b>decelerar</b> en el <span class="term">difusor</span>: la presión sube aguas abajo (<span class="term">gradiente adverso</span>), el fluido de baja energía junto a la pared se frena hasta invertirse y la capa límite <b>separa</b>. Desde ese punto el núcleo sale como un chorro y la presión ya no se recupera: aparece una pérdida de presión total. Esto mismo limita el difusor de un F1.</p>`,
    en: R`<p>In steady flow mass cannot accumulate: if a duct narrows, the fluid <b>must</b> accelerate (<span class="term">continuity</span>). Accelerating it needs a net force, and in an inviscid fluid the only one available is a <b>pressure gradient</b>: pressure is higher upstream of the throat and lower in it. <b>Bernoulli</b> is not the cause of anything: it is the energy relation between that pressure field and the velocity field, obtained by integrating Euler's equation along a streamline.</p>
    <p>The easy part is accelerating (favourable gradient, thinning boundary layer). The hard part is <b>decelerating</b> in the <span class="term">diffuser</span>: pressure rises downstream (<span class="term">adverse gradient</span>), the low-energy near-wall fluid slows down until it reverses and the boundary layer <b>separates</b>. From then on the core leaves as a jet and pressure no longer recovers: a total-pressure loss appears. The same physics limits an F1 diffuser.</p>`,
  },
  physics: {
    es: R`<p><b>Continuidad</b> (incompresible, cuasi-1D): $$\dot m = \rho\,u\,A = \text{cte} \;\Rightarrow\; u_2 = u_1\,\frac{A_1}{A_2}$$</p>
    <p><b>Euler</b> a lo largo de una línea de corriente (estacionario, no viscoso): \(\rho\,u\,\partial u/\partial s = -\partial p/\partial s\). Integrando con \(\rho\) constante: $$p + \tfrac12 \rho V^2 = p_0 = \text{cte (a lo largo de la línea de corriente)}$$ Si además el flujo es <b>irrotacional</b>, \(p_0\) es la misma en todo el campo.</p>
    <p><b>Coeficiente de presión</b>: $$C_p = \frac{p-p_\infty}{\tfrac12\rho V_\infty^2} = 1-\left(\frac{V}{V_\infty}\right)^2$$ \(C_p=1\) en un punto de remanso, \(C_p<0\) donde el fluido va más rápido que la corriente libre (succión).</p>
    <p><b>Equilibrio normal</b> a una línea de corriente curva de radio \(R_c\): $$\frac{\partial p}{\partial n} = \frac{\rho V^2}{R_c}$$ La presión crece hacia fuera del centro de curvatura. Es la otra mitad de la historia de Bernoulli y la clave para explicar la sustentación.</p>
    <div class="callout warn"><div class="ct">Hipótesis de Bernoulli</div>Estacionario · incompresible (M &lt; 0.3) · no viscoso · a lo largo de una línea de corriente (o en todo el campo si es irrotacional). No es válida dentro de la capa límite ni a través de una estela separada: allí hay pérdidas de \(p_0\).</div>
    <p><b>Difusor</b>: la recuperación ideal es \(C_{p,rec} = 1 - (A_1/A_2)^2\). En la práctica, los mapas de Kline muestran que difusores 2D con semiángulos por encima de ~7–10° entran en pérdida (separan) salvo que sean muy cortos o tengan control de capa límite.</p>`,
    en: R`<p><b>Continuity</b> (incompressible, quasi-1D): $$\dot m = \rho\,u\,A = \text{const} \;\Rightarrow\; u_2 = u_1\,\frac{A_1}{A_2}$$</p>
    <p><b>Euler</b> along a streamline (steady, inviscid): \(\rho\,u\,\partial u/\partial s = -\partial p/\partial s\). Integrating with constant \(\rho\): $$p + \tfrac12 \rho V^2 = p_0 = \text{const (along a streamline)}$$ If the flow is also <b>irrotational</b>, \(p_0\) is the same everywhere.</p>
    <p><b>Pressure coefficient</b>: $$C_p = \frac{p-p_\infty}{\tfrac12\rho V_\infty^2} = 1-\left(\frac{V}{V_\infty}\right)^2$$ \(C_p=1\) at a stagnation point, \(C_p<0\) where the fluid moves faster than the free stream (suction).</p>
    <p><b>Normal equilibrium</b> across a curved streamline of radius \(R_c\): $$\frac{\partial p}{\partial n} = \frac{\rho V^2}{R_c}$$ Pressure increases away from the centre of curvature. This is the other half of the Bernoulli story and the key to explaining lift.</p>
    <div class="callout warn"><div class="ct">Bernoulli assumptions</div>Steady · incompressible (M &lt; 0.3) · inviscid · along a streamline (or everywhere if irrotational). Not valid inside the boundary layer or across a separated wake: total pressure \(p_0\) is lost there.</div>
    <p><b>Diffuser</b>: ideal recovery is \(C_{p,rec} = 1 - (A_1/A_2)^2\). In practice, Kline's stall maps show that 2D diffusers with half-angles above ~7–10° stall (separate) unless very short or boundary-layer controlled.</p>`,
  },
  labs: [
    {
      title: { es: "Tubo Venturi con piezómetros y difusor que puede separar", en: "Venturi tube with piezometers and a diffuser that can separate" },
      desc: { es: "Estrecha la garganta, abre o acorta el difusor. Observa cuándo separa la capa límite y cómo se pierde la recuperación de presión.", en: "Narrow the throat, open or shorten the diffuser. Watch when the boundary layer separates and how pressure recovery is lost." },
      mount: venturiLab,
    },
    {
      title: { es: "Presión y curvatura de las líneas de corriente", en: "Pressure and streamline curvature" },
      desc: { es: "Cilindro en flujo potencial. La presión cae al acercarse a la superficie, donde las líneas de corriente están más curvadas. Añade circulación y compara arriba y abajo.", en: "Cylinder in potential flow. Pressure falls towards the surface, where streamlines are most curved. Add circulation and compare top and bottom." },
      mount: curvatureLab,
    },
  ],
  interview: [
    {
      q: { es: "¿Por qué se acelera el aire en la garganta de un Venturi? ¿Es por Bernoulli?", en: "Why does air accelerate in a Venturi throat? Is it because of Bernoulli?" },
      a: {
        es: R`<p>Por <b>continuidad</b>: el gasto másico es constante y el área menor, así que la velocidad aumenta. Lo que <i>produce</i> esa aceleración es un gradiente de presión favorable (presión mayor aguas arriba), según Euler/Newton. Bernoulli solo relaciona ambos campos: no es una causa sino una consecuencia de conservar la energía mecánica en flujo no viscoso.</p>`,
        en: R`<p>Because of <b>continuity</b>: mass flow is constant and the area smaller, so velocity increases. What <i>produces</i> the acceleration is a favourable pressure gradient (higher pressure upstream), per Euler/Newton. Bernoulli only relates the two fields: it is not a cause but a consequence of conserving mechanical energy in inviscid flow.</p>`,
      },
    },
    {
      q: { es: "¿Cuándo NO puedes aplicar Bernoulli?", en: "When can you NOT apply Bernoulli?" },
      a: {
        es: R`<p>Dentro de la capa límite y en estelas (viscosidad, pérdidas de \(p_0\)), a través de un choque, en flujo compresible a M &gt; ~0.3 (hay que usar la forma compresible), en flujo no estacionario sin el término \(\partial\phi/\partial t\), y entre líneas de corriente distintas si el flujo es rotacional (p. ej. aguas abajo de una estela o de un rotor que añade energía).</p>`,
        en: R`<p>Inside the boundary layer and in wakes (viscosity, \(p_0\) losses), across a shock, in compressible flow above M ~0.3 (use the compressible form), in unsteady flow without the \(\partial\phi/\partial t\) term, and between different streamlines if the flow is rotational (e.g. downstream of a wake or a fan that adds energy).</p>`,
      },
    },
    {
      q: { es: "¿Por qué un difusor demasiado abierto da menos recuperación de presión, no más?", en: "Why does a diffuser that opens too fast give less pressure recovery, not more?" },
      a: {
        es: R`<p>Porque el gradiente adverso es demasiado fuerte para la capa límite: separa, el núcleo sale como chorro sin expandirse y la presión deja de subir. La relación de áreas efectiva es la de la sección donde separa. En un F1 esto se ve como pérdida de carga al bajar la altura (el difusor "se ahoga") y es un motor del porpoising.</p>`,
        en: R`<p>Because the adverse gradient is too strong for the boundary layer: it separates, the core leaves as a jet without expanding and pressure stops rising. The effective area ratio becomes that of the section where it separates. On an F1 car this shows up as downforce loss at low ride height (the diffuser "stalls"), a driver of porpoising.</p>`,
      },
    },
    {
      q: { es: "Explica qué es Cp y qué valores puede tomar.", en: "Explain what Cp is and what values it can take." },
      a: {
        es: R`<p>\(C_p=(p-p_\infty)/q_\infty\). En incompresible y fuera de la capa límite \(C_p = 1-(V/V_\infty)^2\), luego \(C_p \le 1\) (=1 en remanso). No tiene límite inferior: en el pico de succión de un perfil con mucha carga o un alerón en efecto suelo se ven \(C_p\) de −3 a −10 o menores.</p>`,
        en: R`<p>\(C_p=(p-p_\infty)/q_\infty\). In incompressible flow outside the boundary layer \(C_p = 1-(V/V_\infty)^2\), so \(C_p \le 1\) (=1 at stagnation). There is no lower bound: suction peaks of heavily loaded airfoils or wings in ground effect show \(C_p\) of −3 to −10 or lower.</p>`,
      },
    },
  ],
  myths: [
    { es: "«El aire acelera porque la presión baja (Bernoulli)». La causalidad va al revés en la explicación newtoniana: el gradiente de presión acelera al fluido; ambos campos se ajustan a la vez y Bernoulli solo es la relación entre ellos.", en: "“Air accelerates because pressure drops (Bernoulli)”. In the Newtonian explanation the pressure gradient accelerates the fluid; both fields adjust together and Bernoulli is just the relation between them." },
    { es: "«Bernoulli vale en todas partes». Solo fuera de las regiones viscosas y, entre líneas de corriente distintas, solo si el flujo es irrotacional.", en: "“Bernoulli holds everywhere”. Only outside viscous regions and, across streamlines, only if the flow is irrotational." },
    { es: "«Más ángulo de difusor = más recuperación». Hasta que separa: a partir de ahí la recuperación cae y aparecen pérdidas de presión total.", en: "“More diffuser angle = more recovery”. Until it separates: from then on recovery drops and total-pressure losses appear." },
  ],
  quiz: [
    { q: { es: "Una garganta tiene la mitad de área que la entrada. En incompresible, ¿cuánto vale Cp en la garganta (referido a la entrada)?", en: "A throat has half the inlet area. In incompressible flow, what is Cp at the throat (referred to the inlet)?" }, options: [{ es: "−1", en: "−1" }, { es: "−3", en: "−3" }, { es: "−0.5", en: "−0.5" }, { es: "+0.75", en: "+0.75" }], correct: 1, explain: { es: "u = 2U → Cp = 1 − 2² = −3.", en: "u = 2U → Cp = 1 − 2² = −3." } },
    { q: { es: "¿Qué ecuación garantiza la aceleración en una garganta?", en: "Which equation guarantees acceleration in a throat?" }, options: [{ es: "Bernoulli", en: "Bernoulli" }, { es: "Continuidad", en: "Continuity" }, { es: "Ecuación de estado", en: "Equation of state" }, { es: "Kutta-Joukowski", en: "Kutta-Joukowski" }], correct: 1, explain: { es: "ṁ = ρuA constante: si A baja, u sube. Bernoulli dice entonces cuánto baja p.", en: "ṁ = ρuA constant: if A drops, u rises. Bernoulli then tells how much p drops." } },
    { q: { es: "En una línea de corriente curva, la presión es menor…", en: "On a curved streamline, pressure is lower…" }, options: [{ es: "hacia el centro de curvatura", en: "towards the centre of curvature" }, { es: "hacia fuera", en: "outwards" }, { es: "igual a ambos lados", en: "equal on both sides" }, { es: "depende del Reynolds", en: "depends on Reynolds" }], correct: 0, explain: { es: "∂p/∂n = ρV²/R: la presión crece alejándose del centro de curvatura para proporcionar la aceleración centrípeta.", en: "∂p/∂n = ρV²/R: pressure grows away from the centre of curvature to provide the centripetal acceleration." } },
    { q: { es: "Si el difusor separa, la presión a la salida es…", en: "If the diffuser separates, the exit pressure is…" }, options: [{ es: "mayor que la ideal", en: "higher than ideal" }, { es: "igual a la ideal", en: "equal to ideal" }, { es: "menor que la ideal (pérdida de p₀)", en: "lower than ideal (p₀ loss)" }, { es: "infinita", en: "infinite" }], correct: 2, explain: { es: "La energía cinética del chorro no se convierte en presión: se disipa en la mezcla.", en: "The jet's kinetic energy is not converted into pressure: it is dissipated by mixing." } },
  ],
  refs: [
    "J.D. Anderson, <i>Fundamentals of Aerodynamics</i>, 6th ed., McGraw-Hill, ch. 3.",
    "S.J. Kline, D.E. Abbott, R.W. Fox, “Optimum design of straight-walled diffusers”, <i>J. Basic Eng.</i> 81 (1959).",
    "J. Katz, <i>Race Car Aerodynamics</i>, Bentley, 2006, ch. 2.",
    "F.M. White, <i>Fluid Mechanics</i>, ch. 3 & 6 (Bernoulli, diffusers).",
  ],
};
