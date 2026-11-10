import { slider, labLayout, readout, toggle, segmented, button, L, tr, engineBadge, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { FlowView, cpColor, contourSegments } from "../js/core/field.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;
const circlePts = (r = 1, n = 120, cx = 0, cy = 0) => {
  const t = [...Array(n + 1).keys()].map((i) => (i / n) * 2 * Math.PI);
  return { x: t.map((a) => cx + r * Math.cos(a)), y: t.map((a) => cy + r * Math.sin(a)) };
};

function cylinderLab(host) {
  const ui = labLayout(host);
  const fv = new FlowView(ui.viz, { height: 320, world: { x0: -3, x1: 3, y0: -2, y1: 2 }, particles: 900, speed: 0.004 });
  const wait = engineBadge(fv.box);
  const plot = new Plot(ui.viz, { height: 220, xlabel: { es: "θ [°] (0° = punto trasero, 90° = cima)", en: "θ [°] (0° = rear point, 90° = top)" }, ylabel: { es: "Cp superficie", en: "surface Cp" }, invertY: true, xlim: [0, 360] });
  const sG = slider({ label: { es: "Circulación Γ/(V∞R) (horaria +)", en: "Circulation Γ/(V∞R) (clockwise +)" }, min: -16, max: 16, step: 0.1, value: 4, onInput: run });
  const tCp = toggle({ label: { es: "Mapa de Cp", en: "Cp map" }, value: true, onInput: run });
  ui.controls.append(sG.el, tCp.el);
  const roCl = readout({ es: "Cl = Γ/(V∞R)", en: "Cl = Γ/(V∞R)" });
  const roSt = readout({ es: "Puntos de remanso", en: "Stagnation points" });
  ui.readouts.append(roCl.el, roSt.el);
  ui.note.innerHTML = L(
    R`Doblete + corriente uniforme + vórtice. Remansos en \(\sin\theta_s = -\Gamma/(4\pi V_\infty R)\). Para \(\Gamma = 4\pi V_\infty R \approx 12.6\) se juntan abajo; por encima se separan del cuerpo. La fuerza es \(L' = \rho V_\infty \Gamma\) (Kutta-Joukowski) y la resistencia es cero (paradoja de d'Alembert).`,
    R`Doublet + uniform stream + vortex. Stagnation at \(\sin\theta_s = -\Gamma/(4\pi V_\infty R)\). At \(\Gamma = 4\pi V_\infty R \approx 12.6\) they merge at the bottom; beyond, the point leaves the body. Force \(L' = \rho V_\infty \Gamma\) (Kutta-Joukowski), zero drag (d'Alembert's paradox).`
  );
  const call = liveCall("cyl", "potential.cylinder", 40);
  function run() {
    call({ gamma: sG.value * 1.0, x0: -3, x1: 3, y0: -2, y1: 2, nx: 120, ny: 80 }, (r) => {
      wait.remove();
      fv.setBodies([circlePts()]);
      fv.setField({ x: r.x, y: r.y, u: r.u, v: r.v }, { reseed: !fv.field });
      fv.setScalar(tCp.value ? { x: r.x, y: r.y, values: r.cp, map: (v) => cpColor(v, -4, 1), alpha: 140 } : null);
      const segs = [];
      for (let k = -14; k <= 14; k++) segs.push(...contourSegments(r.x, r.y, r.psi, k * 0.25));
      fv.setContours([{ segments: segs, color: cssVar("--contour"), width: 1 }]);
      fv.setOverlays([
        (g, v) => {
          for (const p of r.stagnation) {
            g.fillStyle = "#fbbf24";
            g.beginPath();
            g.arc(v.X(p[0]), v.Y(p[1]), 6, 0, 7);
            g.fill();
          }
          // lift arrow
          const L = r.cl;
          g.strokeStyle = cssVar("--good");
          g.fillStyle = cssVar("--good");
          g.lineWidth = 3;
          const len = Math.max(-1.6, Math.min(1.6, L * 0.12));
          if (Math.abs(len) > 0.02) {
            g.beginPath();
            g.moveTo(v.X(0), v.Y(0));
            g.lineTo(v.X(0), v.Y(len));
            g.stroke();
            g.beginPath();
            g.moveTo(v.X(0), v.Y(len) - Math.sign(len) * 10);
            g.lineTo(v.X(0) - 6, v.Y(len));
            g.lineTo(v.X(0) + 6, v.Y(len));
            g.fill();
            g.font = "12px Inter";
            g.fillText("L' = ρV∞Γ", v.X(0) + 8, v.Y(len));
          }
        },
      ]);
      const th = r.theta.map((t) => (t * 180) / Math.PI);
      plot.set([{ x: th, y: r.cp_surface, color: cssVar("--accent"), label: { es: "Cp(θ) con Γ", en: "Cp(θ) with Γ" } }, { x: th, y: r.theta.map((t) => 1 - 4 * Math.sin(t) ** 2), color: cssVar("--fg-dim"), dash: [4, 3], label: { es: "Γ = 0 (simétrico)", en: "Γ = 0 (symmetric)" } }]);
      roCl.set(r.cl.toFixed(2));
      roSt.set(r.stagnation.length === 2 ? L("2 en el cuerpo", "2 on the body") : L("1 fuera del cuerpo", "1 off the body"));
    });
  }
  run();
}

function sandboxLab(host) {
  const ui = labLayout(host);
  const fv = new FlowView(ui.viz, { height: 380, world: { x0: -3, x1: 3, y0: -2, y1: 2 }, particles: 900, speed: 0.004 });
  const wait = engineBadge(fv.box);
  const elements = [];
  let circle = { x: 0, y: 0, r: 1.0 };
  const sType = segmented({
    label: { es: "Elemento a añadir (clic en el lienzo)", en: "Element to add (click on canvas)" },
    value: "vortex",
    options: [
      { value: "source", label: { es: "Fuente", en: "Source" } },
      { value: "sink", label: { es: "Sumidero", en: "Sink" } },
      { value: "vortex", label: { es: "Vórtice ↻", en: "Vortex ↻" } },
      { value: "vortex_ccw", label: { es: "Vórtice ↺", en: "Vortex ↺" } },
      { value: "doublet", label: { es: "Doblete", en: "Doublet" } },
    ],
  });
  const sS = slider({ label: { es: "Intensidad", en: "Strength" }, min: 0.5, max: 12, step: 0.1, value: 4 });
  const sV = slider({ label: { es: "Corriente libre V∞", en: "Free stream V∞" }, min: 0, max: 1.5, step: 0.05, value: 1, onInput: run });
  const sR = slider({ label: { es: "Radio del contorno de integración", en: "Integration contour radius" }, min: 0.2, max: 1.9, step: 0.05, value: 1, onInput: (v) => ((circle.r = v), run()) });
  const presets = el("div", { class: "seg-row" });
  const preset = (lab, list, V = 1) =>
    presets.appendChild(button(lab, () => {
      elements.splice(0, elements.length, ...list);
      sV.value = V;
      run();
    }));
  preset({ es: "Óvalo de Rankine", en: "Rankine oval" }, [{ type: "source", x: -1, y: 0, strength: 4 }, { type: "source", x: 1, y: 0, strength: -4 }]);
  preset({ es: "Cilindro", en: "Cylinder" }, [{ type: "doublet", x: 0, y: 0, strength: 2 * Math.PI }]);
  preset({ es: "Cilindro girando", en: "Spinning cylinder" }, [{ type: "doublet", x: 0, y: 0, strength: 2 * Math.PI }, { type: "vortex", x: 0, y: 0, strength: 8 }]);
  preset({ es: "Par de vórtices", en: "Vortex pair" }, [{ type: "vortex", x: 0, y: 0.6, strength: 5 }, { type: "vortex", x: 0, y: -0.6, strength: -5 }], 0);
  preset({ es: "Vaciar", en: "Clear" }, []);
  ui.controls.append(sType.el, sS.el, sV.el, sR.el, presets);
  const roG = readout({ es: "Γ en el contorno (horaria +)", en: "Γ on contour (clockwise +)" });
  const roQ = readout({ es: "Flujo neto Q", en: "Net outflow Q" });
  ui.readouts.append(roG.el, roQ.el);
  ui.note.innerHTML = L(
    R`Clic izquierdo: añadir elemento. Mayús + clic: mover el contorno de integración (círculo discontinuo). La circulación calculada sobre el contorno es igual a la suma de vórtices encerrados (<b>teorema de Stokes</b>) y no depende de su forma; el flujo neto, a la suma de fuentes (Gauss). Un doblete aporta \(\Gamma = 0\).`,
    R`Click: add element. Shift + click: move the integration contour (dashed circle). The circulation on the contour equals the sum of enclosed vortices (<b>Stokes' theorem</b>) regardless of its shape; the net outflow equals the sum of sources (Gauss). A doublet contributes \(\Gamma = 0\).`
  );
  fv.top.style.cursor = "crosshair";
  fv.top.addEventListener("click", (e) => {
    const r = fv.top.getBoundingClientRect();
    const [x, y] = fv.toWorld(e.clientX - r.left, e.clientY - r.top);
    if (e.shiftKey) {
      circle = { ...circle, x, y };
    } else {
      const t = sType.value;
      const s = sS.value;
      if (t === "source") elements.push({ type: "source", x, y, strength: s });
      if (t === "sink") elements.push({ type: "source", x, y, strength: -s });
      if (t === "vortex") elements.push({ type: "vortex", x, y, strength: s });
      if (t === "vortex_ccw") elements.push({ type: "vortex", x, y, strength: -s });
      if (t === "doublet") elements.push({ type: "doublet", x, y, strength: s });
    }
    run();
  });
  const call = liveCall("sandbox", "potential.superpose", 30);
  function run() {
    call({ elements, x0: -3, x1: 3, y0: -2, y1: 2, nx: 120, ny: 80, V: sV.value, circle }, (r) => {
      wait.remove();
      // clip huge speeds near singularities for display
      const lim = 4;
      const U = r.u.map((row, j) => row.map((u, i) => {
        const v = r.v[j][i];
        const s = Math.hypot(u, v);
        return s > lim ? (u * lim) / s : u;
      }));
      const V = r.v.map((row, j) => row.map((v, i) => {
        const u = r.u[j][i];
        const s = Math.hypot(u, v);
        return s > lim ? (v * lim) / s : v;
      }));
      fv.setField({ x: r.x, y: r.y, u: U, v: V }, { reseed: !fv.field });
      const segs = [];
      const psi = r.psi.map((row) => row.map((p) => (isFinite(p) && Math.abs(p) < 50 ? p : null)));
      for (let k = -30; k <= 30; k++) segs.push(...contourSegments(r.x, r.y, psi, k * 0.2 + 0.001));
      fv.setContours([{ segments: segs, color: cssVar("--contour") }]);
      fv.setOverlays([
        (g, v) => {
          for (const e of elements) {
            const col = e.type === "source" ? (e.strength > 0 ? "#fb923c" : "#60a5fa") : e.type === "vortex" ? "#a78bfa" : cssVar("--fg");
            g.fillStyle = col;
            g.beginPath();
            g.arc(v.X(e.x), v.Y(e.y), 6, 0, 7);
            g.fill();
            g.fillStyle = "#001018";
            g.font = "bold 10px Inter";
            g.textAlign = "center";
            g.textBaseline = "middle";
            g.fillText(e.type === "source" ? (e.strength > 0 ? "+" : "−") : e.type === "vortex" ? (e.strength > 0 ? "↻" : "↺") : "D", v.X(e.x), v.Y(e.y));
            g.textAlign = "left";
            g.textBaseline = "alphabetic";
          }
          g.strokeStyle = "#fbbf24";
          g.setLineDash([6, 5]);
          g.lineWidth = 2;
          g.beginPath();
          g.arc(v.X(circle.x), v.Y(circle.y), circle.r * v.scale, 0, 7);
          g.stroke();
          g.setLineDash([]);
        },
      ]);
      roG.set(r.circle.gamma.toFixed(2));
      roQ.set(r.circle.flux.toFixed(2));
    });
  }
  elements.push({ type: "vortex", x: 0, y: 0, strength: 4 });
  run();
}

export default {
  subtitle: {
    es: "Superposición de flujos elementales, circulación, vorticidad y el teorema de Kutta-Joukowski con un cilindro que gira.",
    en: "Superposition of elementary flows, circulation, vorticity and the Kutta-Joukowski theorem with a spinning cylinder.",
  },
  heroParams: { eps: 0.0001, camber: 0.25, alpha: 0 },
  intuition: {
    es: R`<p>Fuera de las capas límite y las estelas, el flujo alrededor de un cuerpo aerodinámico es casi <span class="term">irrotacional</span>: las partículas no giran sobre sí mismas. Entonces la velocidad deriva de un potencial y las ecuaciones son lineales (Laplace), así que podemos <b>superponer</b> soluciones simples: corriente uniforme, fuentes, sumideros, vórtices y dobletes. Un cilindro es un doblete en una corriente uniforme.</p>
    <p>La <span class="term">circulación</span> \(\Gamma\) mide cuánto "gira" el flujo alrededor de un contorno cerrado. Añadir circulación a un cilindro acelera el flujo por un lado y lo frena por el otro: aparece una diferencia de presión y una fuerza perpendicular a la corriente, \(L'=\rho V_\infty\Gamma\). Ese resultado, el <b>teorema de Kutta-Joukowski</b>, vale para <i>cualquier</i> cuerpo bidimensional: la sustentación es circulación. Lo que falta saber es <b>cuánta</b> circulación elige la naturaleza (lo veremos con la condición de Kutta).</p>`,
    en: R`<p>Outside boundary layers and wakes, the flow around a streamlined body is almost <span class="term">irrotational</span>: fluid particles do not spin. Velocity then derives from a potential and the equations are linear (Laplace), so we can <b>superpose</b> simple solutions: uniform stream, sources, sinks, vortices and doublets. A cylinder is a doublet in a uniform stream.</p>
    <p><span class="term">Circulation</span> \(\Gamma\) measures how much the flow "turns" around a closed contour. Adding circulation to a cylinder speeds the flow up on one side and slows it on the other: a pressure difference and a force normal to the stream appear, \(L'=\rho V_\infty\Gamma\). That result, the <b>Kutta-Joukowski theorem</b>, holds for <i>any</i> 2D body: lift is circulation. What remains is <b>how much</b> circulation nature picks (the Kutta condition, next module).</p>`,
  },
  physics: {
    es: R`<p><b>Circulación</b> y <b>vorticidad</b> (Stokes): $$\Gamma = -\oint_C \mathbf V\cdot d\mathbf l = -\iint_S \boldsymbol\omega\cdot\mathbf n\,dS,\qquad \boldsymbol\omega=\nabla\times\mathbf V$$ (signo elegido para que la circulación de un perfil que sustenta sea positiva, sentido horario).</p>
    <p><b>Potencial complejo</b> \(W(z)=\phi+i\psi\), \(dW/dz=u-iv\):</p>
    <ul><li>Corriente uniforme: \(W=V_\infty z\)</li><li>Fuente de caudal \(m\): \(W=\frac{m}{2\pi}\ln z\)</li><li>Vórtice (horario, \(\Gamma>0\)): \(W=\frac{i\Gamma}{2\pi}\ln z\)</li><li>Doblete: \(W=\frac{\kappa}{2\pi z}\)</li></ul>
    <p><b>Cilindro con circulación</b> (\(\kappa = 2\pi V_\infty R^2\)): $$W=V_\infty\left(z+\frac{R^2}{z}\right)+\frac{i\Gamma}{2\pi}\ln z,\qquad u_\theta\big|_{r=R}=-2V_\infty\sin\theta-\frac{\Gamma}{2\pi R}$$ $$C_p(\theta)=1-\left(2\sin\theta+\frac{\Gamma}{2\pi R V_\infty}\right)^2$$</p>
    <p><b>Kutta-Joukowski</b> (cualquier cuerpo 2D en flujo potencial): $$L'=\rho_\infty V_\infty\Gamma,\qquad D'=0$$ La resistencia nula es la <b>paradoja de d'Alembert</b>: la resistencia real viene de la viscosidad (fricción y separación).</p>
    <p><b>Teorema de Kelvin</b>: en un fluido no viscoso y barotrópico, la circulación alrededor de un contorno material se conserva. Por eso, si un perfil adquiere circulación, debe dejarse en la estela un vórtice de arranque de circulación opuesta.</p>
    <div class="callout key"><div class="ct">Efecto Magnus real</div>En un cilindro real que gira, la circulación no se impone: la produce la viscosidad (la pared arrastra el fluido y modifica dónde separa la capa límite). El modelo potencial da la tendencia, pero sobreestima la fuerza y no predice el "Magnus inverso" que aparece a ciertos Reynolds.</div>`,
    en: R`<p><b>Circulation</b> and <b>vorticity</b> (Stokes): $$\Gamma = -\oint_C \mathbf V\cdot d\mathbf l = -\iint_S \boldsymbol\omega\cdot\mathbf n\,dS,\qquad \boldsymbol\omega=\nabla\times\mathbf V$$ (sign chosen so that the circulation of a lifting airfoil is positive, clockwise).</p>
    <p><b>Complex potential</b> \(W(z)=\phi+i\psi\), \(dW/dz=u-iv\):</p>
    <ul><li>Uniform stream: \(W=V_\infty z\)</li><li>Source of strength \(m\): \(W=\frac{m}{2\pi}\ln z\)</li><li>Vortex (clockwise, \(\Gamma>0\)): \(W=\frac{i\Gamma}{2\pi}\ln z\)</li><li>Doublet: \(W=\frac{\kappa}{2\pi z}\)</li></ul>
    <p><b>Cylinder with circulation</b> (\(\kappa = 2\pi V_\infty R^2\)): $$W=V_\infty\left(z+\frac{R^2}{z}\right)+\frac{i\Gamma}{2\pi}\ln z,\qquad u_\theta\big|_{r=R}=-2V_\infty\sin\theta-\frac{\Gamma}{2\pi R}$$ $$C_p(\theta)=1-\left(2\sin\theta+\frac{\Gamma}{2\pi R V_\infty}\right)^2$$</p>
    <p><b>Kutta-Joukowski</b> (any 2D body in potential flow): $$L'=\rho_\infty V_\infty\Gamma,\qquad D'=0$$ Zero drag is <b>d'Alembert's paradox</b>: real drag comes from viscosity (friction and separation).</p>
    <p><b>Kelvin's theorem</b>: in an inviscid barotropic fluid the circulation around a material contour is conserved. Hence, if an airfoil acquires circulation, a starting vortex of opposite circulation must be left in the wake.</p>
    <div class="callout key"><div class="ct">Real Magnus effect</div>On a real spinning cylinder circulation is not imposed: viscosity produces it (the wall drags fluid and moves the separation points). The potential model gives the trend, but overestimates the force and misses the "inverse Magnus" effect seen at some Reynolds numbers.</div>`,
  },
  labs: [
    { title: { es: "Cilindro que gira: puntos de remanso y sustentación", en: "Spinning cylinder: stagnation points and lift" }, desc: { es: "Las líneas blancas son líneas de corriente exactas (ψ = cte). Aumenta Γ hasta que los puntos de remanso se fusionen y se separen del cuerpo.", en: "White lines are exact streamlines (ψ = const). Increase Γ until the stagnation points merge and leave the body." }, mount: cylinderLab },
    { title: { es: "Laboratorio de superposición y teorema de Stokes", en: "Superposition lab and Stokes' theorem" }, desc: { es: "Construye flujos sumando elementos y mide la circulación sobre cualquier contorno.", en: "Build flows by adding elements and measure circulation on any contour." }, mount: sandboxLab },
  ],
  interview: [
    { q: { es: "¿Qué es la circulación y qué relación tiene con la sustentación?", en: "What is circulation and how does it relate to lift?" }, a: { es: R`<p>Es la integral de línea de la velocidad tangencial a lo largo de un contorno cerrado; por Stokes es el flujo de vorticidad a través de la superficie encerrada. Kutta-Joukowski: la sustentación por unidad de envergadura de un cuerpo 2D es \(\rho V_\infty \Gamma\). En un perfil, la "vorticidad encerrada" está en la capa límite (representada por un vórtice ligado), y la condición de Kutta fija su valor.</p>`, en: R`<p>The line integral of tangential velocity around a closed contour; by Stokes it is the vorticity flux through the enclosed surface. Kutta-Joukowski: the lift per unit span of a 2D body is \(\rho V_\infty \Gamma\). On an airfoil the "enclosed vorticity" lives in the boundary layer (modelled as a bound vortex) and the Kutta condition fixes its value.</p>` } },
    { q: { es: "Si el flujo alrededor de un perfil es irrotacional, ¿cómo puede haber circulación?", en: "If the flow around an airfoil is irrotational, how can there be circulation?" }, a: { es: R`<p>Porque el dominio fluido alrededor del perfil es <b>doblemente conexo</b>: un contorno que rodea al perfil no puede contraerse a un punto sin atravesarlo. La vorticidad está concentrada en la capa límite (y en el modelo, en el vórtice ligado dentro del cuerpo); fuera, \(\omega = 0\) y la circulación es la misma para cualquier contorno que rodee el perfil.</p>`, en: R`<p>Because the fluid domain around the airfoil is <b>doubly connected</b>: a contour around the airfoil cannot shrink to a point without crossing it. Vorticity is concentrated in the boundary layer (in the model, the bound vortex inside the body); outside \(\omega = 0\) and circulation is the same for any contour enclosing the airfoil.</p>` } },
    { q: { es: "Explica el efecto Magnus en un balón o en un cilindro.", en: "Explain the Magnus effect on a ball or a cylinder." }, a: { es: R`<p>El giro arrastra el fluido por viscosidad: en el lado que se mueve con la corriente la capa límite se energiza y separa más tarde; en el otro separa antes. La estela se desvía hacia un lado, el flujo se curva y aparece circulación neta: fuerza lateral \(\approx\rho V\Gamma\) hacia el lado donde la superficie se mueve con la corriente. A ciertos Reynolds (crisis de arrastre asimétrica) el efecto puede invertirse.</p>`, en: R`<p>Spin drags fluid by viscosity: on the side moving with the stream the boundary layer is energised and separates later; on the other it separates earlier. The wake is deflected, the flow is turned and net circulation appears: side force \(\approx\rho V\Gamma\) towards the side where the surface moves with the flow. At some Reynolds numbers (asymmetric drag crisis) the effect can reverse.</p>` } },
    { q: { es: "¿Qué es la paradoja de d'Alembert y cómo se resuelve?", en: "What is d'Alembert's paradox and how is it resolved?" }, a: { es: R`<p>En flujo potencial estacionario la resistencia de cualquier cuerpo cerrado 2D es nula: la distribución de presiones es simétrica proa-popa. Se resuelve con la viscosidad: la capa límite genera fricción y, al separarse, rompe la simetría de presiones (resistencia de presión/forma). En 3D aparece además la resistencia inducida, incluso sin viscosidad.</p>`, en: R`<p>In steady potential flow the drag of any closed 2D body is zero: the pressure distribution is fore-aft symmetric. Viscosity resolves it: the boundary layer creates friction and, when it separates, breaks the pressure symmetry (pressure/form drag). In 3D induced drag also appears, even without viscosity.</p>` } },
  ],
  myths: [
    { es: "«Flujo irrotacional = sin circulación». Falso en dominios no simplemente conexos: alrededor de un perfil hay circulación finita aunque \\(\\omega = 0\\) en todo el fluido exterior.", en: "“Irrotational flow = no circulation”. False in multiply connected domains: there is finite circulation around an airfoil although \\(\\omega = 0\\) in the whole outer flow." },
    { es: "«Un vórtice ideal hace girar las partículas». En un vórtice potencial las partículas recorren círculos pero no rotan sobre sí mismas (\\(\\omega=0\\) salvo en el núcleo).", en: "“An ideal vortex makes particles spin”. In a potential vortex particles travel on circles but do not rotate about themselves (\\(\\omega=0\\) except in the core)." },
    { es: "«El modelo potencial predice la fuerza real de un cilindro girando». Da la dirección y el orden de magnitud; la circulación real la fija la viscosidad y es bastante menor.", en: "“The potential model predicts the real force on a spinning cylinder”. It gives direction and order of magnitude; the real circulation is set by viscosity and is considerably smaller." },
  ],
  quiz: [
    { q: { es: "En el cilindro con circulación, ¿para qué Γ coinciden los dos puntos de remanso?", en: "For the cylinder with circulation, at which Γ do the two stagnation points coincide?" }, options: [{ es: "2πV∞R", en: "2πV∞R" }, { es: "4πV∞R", en: "4πV∞R" }, { es: "πV∞R", en: "πV∞R" }, { es: "Nunca", en: "Never" }], correct: 1, explain: { es: "sin θ = −Γ/(4πV∞R) = −1 → θ = −90°.", en: "sin θ = −Γ/(4πV∞R) = −1 → θ = −90°." } },
    { q: { es: "La circulación sobre un contorno que encierra una fuente y un doblete vale…", en: "The circulation on a contour enclosing a source and a doublet is…" }, options: [{ es: "la intensidad de la fuente", en: "the source strength" }, { es: "cero", en: "zero" }, { es: "la del doblete", en: "the doublet's" }, { es: "infinita", en: "infinite" }], correct: 1, explain: { es: "Ni fuentes ni dobletes tienen vorticidad: Γ = 0. La fuente sí da flujo neto Q.", en: "Neither sources nor doublets carry vorticity: Γ = 0. The source does give net outflow Q." } },
    { q: { es: "Kutta-Joukowski da para un cuerpo 2D en flujo potencial…", en: "Kutta-Joukowski gives for a 2D body in potential flow…" }, options: [{ es: "L' = ρVΓ y D' = 0", en: "L' = ρVΓ and D' = 0" }, { es: "L' = ½ρV²Γ", en: "L' = ½ρV²Γ" }, { es: "D' = ρVΓ", en: "D' = ρVΓ" }, { es: "L' depende de la forma, no de Γ", en: "L' depends on shape, not Γ" }], correct: 0, explain: { es: "La forma solo importa a través de Γ (que fija la condición de Kutta).", en: "Shape only matters through Γ (fixed by the Kutta condition)." } },
    { q: { es: "Kelvin: si un perfil arranca desde reposo y adquiere Γ, en la estela queda…", en: "Kelvin: if an airfoil starts from rest and gains Γ, the wake contains…" }, options: [{ es: "nada", en: "nothing" }, { es: "un vórtice de arranque de −Γ", en: "a starting vortex of −Γ" }, { es: "una fuente", en: "a source" }, { es: "un doblete", en: "a doublet" }], correct: 1, explain: { es: "La circulación total de un contorno material que contiene perfil y estela sigue siendo cero.", en: "Total circulation of a material contour containing airfoil and wake remains zero." } },
  ],
  refs: [
    "J.D. Anderson, <i>Fundamentals of Aerodynamics</i>, ch. 3 (elementary flows, lifting cylinder, Kutta-Joukowski).",
    "L.M. Milne-Thomson, <i>Theoretical Hydrodynamics</i>, 5th ed., Dover.",
    "G.K. Batchelor, <i>An Introduction to Fluid Dynamics</i>, CUP, §6.4–6.7.",
    "J. Katz & A. Plotkin, <i>Low-Speed Aerodynamics</i>, CUP, ch. 2–3.",
  ],
};
