import { slider, labLayout, readout, toggle, L, tr, engineBadge, el, canvasBox } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function plateLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 270 });
  const wait = engineBadge(box);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pH = new Plot(row, { height: 210, xlabel: { es: "x / L", en: "x / L" }, ylabel: { es: "factor de forma H", en: "shape factor H" }, ylim: [1, 4.2] });
  const pCf = new Plot(row, { height: 210, xlabel: { es: "x / L", en: "x / L" }, ylabel: { es: "Cf local", en: "local Cf" }, logY: true });
  const sRe = slider({ label: { es: "Reynolds de la placa Re_L", en: "Plate Reynolds Re_L" }, min: 1e5, max: 3e7, value: 3e6, log: true, format: (v) => v.toExponential(1), onInput: run });
  const sTu = slider({ label: { es: "Turbulencia de la corriente libre Tu [%]", en: "Free-stream turbulence Tu [%]" }, min: 0.03, max: 5, value: 0.3, log: true, format: (v) => v.toFixed(2), onInput: run });
  const sK = slider({ label: { es: "Gradiente: ue/U = 1 − k·x  (k>0 adverso)", en: "Gradient: ue/U = 1 − k·x  (k>0 adverse)" }, min: -0.6, max: 0.9, step: 0.01, value: 0, onInput: run });
  const tTrip = toggle({ label: { es: "Trip (rugosidad) en x/L = 0.05", en: "Trip (roughness) at x/L = 0.05" }, value: false, onInput: run });
  ui.controls.append(sRe.el, sTu.el, sK.el, tTrip.el);
  const roTr = readout({ es: "Transición", en: "Transition" }, "x/L");
  const roSep = readout({ es: "Separación", en: "Separation" }, "x/L");
  const roRe = readout({ es: "Re_x en transición", en: "Re_x at transition" });
  const roB = readout({ es: "Burbuja laminar", en: "Laminar bubble" });
  ui.readouts.append(roTr.el, roSep.el, roRe.el, roB.el);
  ui.note.innerHTML = L(
    "Thwaites (laminar) → criterio de Abu-Ghannam & Shaw (depende de Tu y del gradiente) → Head (turbulenta). Perfiles: Falkner-Skan con el mismo H (laminar) y ley de pared + estela de Coles (turbulenta). El espesor está exagerado verticalmente.",
    "Thwaites (laminar) → Abu-Ghannam & Shaw criterion (depends on Tu and gradient) → Head (turbulent). Profiles: Falkner-Skan with the same H (laminar) and law of the wall + Coles wake (turbulent). Thickness is vertically exaggerated."
  );
  let last = null;
  const call = liveCall("plate", "bl.flat_plate", 80);
  function run() {
    call({ re_L: sRe.value, tu: sTu.value, k: sK.value, trip: tTrip.value ? 0.05 : null, stations: [0.08, 0.25, 0.45, 0.65, 0.85] }, (r) => {
      wait.remove();
      last = r;
      drawCanvas();
      plots(r);
    });
  }
  function plots(r) {
    const lamCf = r.x.map((x, i) => (x > 0 ? 0.664 / Math.sqrt(sRe.value * x) : null));
    const turbCf = r.x.map((x) => (x > 0 ? Math.pow(2 * Math.log10(sRe.value * x) - 0.65, -2.3) : null));
    const mk = [];
    if (r.transition != null) mk.push({ type: "vline", x: r.transition, color: cssVar("--c-turb"), label: { es: "transición", en: "transition" } });
    if (r.turb_sep != null) mk.push({ type: "vline", x: r.turb_sep, color: cssVar("--bad"), label: { es: "separación", en: "separation" }, labelOffset: 14 });
    pH.set([{ x: r.x, y: r.H, color: cssVar("--accent"), label: { es: "H = δ*/θ", en: "H = δ*/θ" } }], [...mk, { type: "hline", y: 2.59, color: cssVar("--c-lam"), label: { es: "Blasius 2.59", en: "Blasius 2.59" } }, { type: "hline", y: 1.4, color: cssVar("--c-turb"), label: { es: "turbulenta ~1.4", en: "turbulent ~1.4" } }]);
    pCf.set([
      { x: r.x, y: r.cf.map((v) => (v > 0 ? v : null)), color: cssVar("--accent"), width: 2.6, label: { es: "Cf calculado", en: "computed Cf" } },
      { x: r.x, y: lamCf, color: cssVar("--c-lam"), dash: [4, 3], label: { es: "Blasius", en: "Blasius" } },
      { x: r.x, y: turbCf, color: cssVar("--c-turb"), dash: [4, 3], label: { es: "turbulenta (Schlichting)", en: "turbulent (Schlichting)" } },
    ], mk);
    roTr.set(r.transition == null ? "–" : r.transition.toFixed(3));
    roSep.set(r.turb_sep == null ? L("no", "no") : r.turb_sep.toFixed(3), r.turb_sep == null ? "good" : "bad");
    roRe.set(r.transition == null ? "–" : (r.transition * sRe.value * r.ue[Math.round(r.transition * (r.x.length - 1))]).toExponential(2));
    roB.set(r.bubble ? L("sí", "yes") : L("no", "no"), r.bubble ? "warn" : "");
  }
  function drawCanvas() {
    const r = last;
    if (!r) return;
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
    const x0 = 30, x1 = W - 20, yw = H - 40;
    const X = (x) => x0 + x * (x1 - x0);
    const dmax = Math.max(...r.delta.filter((v) => v != null && isFinite(v)), 1e-6);
    const sc = (H - 80) / dmax;
    // plate
    g.fillStyle = "#94a3b8";
    g.fillRect(X(0), yw, x1 - x0, 6);
    // boundary-layer edge coloured by state
    for (let i = 1; i < r.x.length; i++) {
      const d0 = r.delta[i - 1], d1 = r.delta[i];
      if (d0 == null || d1 == null) continue;
      const st = r.state[i];
      g.strokeStyle = st === 0 ? cssVar("--c-lam") : st === 1 ? cssVar("--c-turb") : cssVar("--bad");
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(X(r.x[i - 1]), yw - d0 * sc);
      g.lineTo(X(r.x[i]), yw - d1 * sc);
      g.stroke();
      if (st === 1 && i % 3 === 0) {
        // turbulent eddies (qualitative decoration)
        g.strokeStyle = "rgba(244,114,182,0.25)";
        g.beginPath();
        g.arc(X(r.x[i]), yw - d1 * sc * (0.3 + 0.4 * Math.abs(Math.sin(i * 1.7 + performance.now() / 600))), Math.max(2, d1 * sc * 0.18), 0, 7);
        g.stroke();
      }
    }
    // velocity profiles
    for (const p of r.profiles) {
      const xs = X(p.x);
      const umax = 70;
      g.strokeStyle = cssVar("--contour");
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(xs, yw);
      g.lineTo(xs, yw - dmax * sc * 1.05);
      g.stroke();
      const col = p.state === "laminar" ? cssVar("--c-lam") : p.state === "turbulent" ? cssVar("--c-turb") : cssVar("--bad");
      g.strokeStyle = col;
      g.lineWidth = 2;
      g.beginPath();
      p.y.forEach((y, k) => {
        const Y = yw - y * sc;
        const Xp = xs + Math.max(-15, p.u[k]) * umax;
        k ? g.lineTo(Xp, Y) : g.moveTo(Xp, Y);
      });
      g.stroke();
      for (let k = 0; k < p.y.length; k += Math.max(1, Math.floor(p.y.length / 8))) {
        const Y = yw - p.y[k] * sc;
        g.strokeStyle = col;
        g.globalAlpha = 0.5;
        g.beginPath();
        g.moveTo(xs, Y);
        g.lineTo(xs + p.u[k] * umax, Y);
        g.stroke();
        g.globalAlpha = 1;
      }
      g.fillStyle = cssVar("--fg-muted");
      g.font = "11px Inter";
      g.fillText(p.H != null ? "H=" + p.H.toFixed(2) : tr({ es: "separada", en: "separated" }), xs + 4, yw + 18);
    }
    if (r.transition != null) {
      g.fillStyle = "rgba(244,114,182,0.12)";
      g.fillRect(X(r.transition) - 6, 10, 12, yw - 10);
    }
    g.fillStyle = cssVar("--fg");
    g.font = "12px Inter";
    g.fillText(tr({ es: "laminar", en: "laminar" }), 10, 18);
    g.fillStyle = cssVar("--c-lam");
    g.fillRect(70, 12, 18, 4);
    g.fillStyle = cssVar("--fg");
    g.fillText(tr({ es: "turbulenta", en: "turbulent" }), 100, 18);
    g.fillStyle = cssVar("--c-turb");
    g.fillRect(170, 12, 18, 4);
  }
  (function anim() {
    if (!document.body.contains(box)) return;
    drawCanvas();
    setTimeout(() => requestAnimationFrame(anim), 80);
  })();
  run();
}

function fsLab(host) {
  const ui = labLayout(host);
  const plot = new Plot(ui.viz, { height: 300, xlabel: { es: "u / ue", en: "u / ue" }, ylabel: { es: "η = y √(ue / ν x)", en: "η = y √(ue / ν x)" }, xlim: [0, 1.05], ylim: [0, 6] });
  const sB = slider({ label: { es: "β (Falkner-Skan): <0 adverso, >0 favorable", en: "β (Falkner-Skan): <0 adverse, >0 favourable" }, min: -0.198, max: 1, step: 0.002, value: 0, onInput: run });
  ui.controls.append(sB.el);
  const roH = readout({ es: "H", en: "H" });
  const roF = readout({ es: "f''(0) ∝ τ pared", en: "f''(0) ∝ wall τ" });
  ui.readouts.append(roH.el, roF.el);
  ui.note.innerHTML = L(
    R`Soluciones de semejanza \(f''' + f f'' + \beta(1-f'^2)=0\) resueltas por disparo en Python. Con β &lt; 0 el perfil desarrolla un <b>punto de inflexión</b> (inestable) y, en β = −0.1988, \(\tau_w = 0\): separación.`,
    R`Similarity solutions \(f''' + f f'' + \beta(1-f'^2)=0\) solved by shooting in Python. With β &lt; 0 the profile develops an <b>inflection point</b> (unstable) and at β = −0.1988 \(\tau_w = 0\): separation.`
  );
  let base = null;
  physics.call("bl.falkner_skan", { betas: [-0.1988, 0, 1] }).then((r) => {
    base = r;
    run();
  });
  const call = liveCall("fs", "bl.falkner_skan", 50);
  function run() {
    call({ betas: [sB.value] }, (r) => {
      const s = [];
      if (base) {
        const names = [{ es: "separación (β=−0.199)", en: "separation (β=−0.199)" }, { es: "Blasius (β=0)", en: "Blasius (β=0)" }, { es: "remanso (β=1)", en: "stagnation (β=1)" }];
        base.fp.forEach((u, i) => s.push({ x: u, y: base.eta, color: cssVar("--fg-dim"), dash: [3, 3], width: 1.2, label: names[i] }));
      }
      s.push({ x: r.fp[0], y: r.eta, color: cssVar("--accent"), width: 3, label: { es: "β seleccionado", en: "selected β" } });
      plot.set(s);
      roH.set(r.H[0].toFixed(3));
      roF.set(r.fpp0[0].toFixed(4), r.fpp0[0] < 0.01 ? "bad" : "");
    });
  }
}

export default {
  subtitle: {
    es: "De la capa límite laminar a la turbulenta: fases, por qué ocurren, transición, burbujas y separación.",
    en: "From laminar to turbulent boundary layer: stages, why they happen, transition, bubbles and separation.",
  },
  heroParams: { eps: 0.08, camber: 0.05, alpha: 3 },
  intuition: {
    es: R`<p>Por la <b>condición de no deslizamiento</b> el aire en contacto con la pared está quieto. La viscosidad transmite ese frenado a una capa delgada, la <span class="term">capa límite</span>, cuyo espesor crece aguas abajo (\(\delta\propto\sqrt{\nu x/U}\) en laminar). Fuera de ella el flujo es prácticamente no viscoso, y la presión exterior se impone a través de ella sin cambiar (\(\partial p/\partial y\approx0\)).</p>
    <p>Sus fases a lo largo de un cuerpo: <b>laminar</b> (láminas ordenadas, poca fricción) → al crecer \(Re_x\), pequeñas perturbaciones (<span class="term">ondas de Tollmien-Schlichting</span>) dejan de amortiguarse y se amplifican → aparecen <span class="term">spots turbulentos</span> (Emmons) que crecen y se fusionan: <b>transición</b> → capa límite <b>turbulenta</b> (mezcla intensa, mucha más fricción, pero mucho más resistente al gradiente adverso). Si el gradiente adverso es suficientemente fuerte, cualquiera de las dos <b>separa</b>. La laminar separa enseguida; a menudo transiciona en la capa separada y vuelve a adherirse: <span class="term">burbuja de separación laminar</span>.</p>`,
    en: R`<p>Because of the <b>no-slip condition</b> air touching the wall is at rest. Viscosity transmits that braking to a thin layer, the <span class="term">boundary layer</span>, whose thickness grows downstream (\(\delta\propto\sqrt{\nu x/U}\) when laminar). Outside it the flow is practically inviscid, and the outer pressure is imposed through it unchanged (\(\partial p/\partial y\approx0\)).</p>
    <p>Its stages along a body: <b>laminar</b> (orderly layers, low friction) → as \(Re_x\) grows, small disturbances (<span class="term">Tollmien-Schlichting waves</span>) stop being damped and amplify → <span class="term">turbulent spots</span> (Emmons) appear, grow and merge: <b>transition</b> → <b>turbulent</b> boundary layer (intense mixing, much higher friction, but much more resistant to adverse gradients). If the adverse gradient is strong enough, either one <b>separates</b>. A laminar layer separates early; it often transitions in the separated shear layer and reattaches: a <span class="term">laminar separation bubble</span>.</p>`,
  },
  physics: {
    es: R`<p><b>Ecuaciones de Prandtl</b> (capa límite 2D, \(\delta\ll x\)): $$u\frac{\partial u}{\partial x}+v\frac{\partial u}{\partial y}=u_e\frac{du_e}{dx}+\nu\frac{\partial^2u}{\partial y^2},\qquad \frac{\partial p}{\partial y}=0$$</p>
    <p><b>Espesores</b>: desplazamiento \(\delta^*=\int_0^\infty(1-u/u_e)dy\), cantidad de movimiento \(\theta=\int_0^\infty \frac{u}{u_e}(1-\frac{u}{u_e})dy\), <b>factor de forma</b> \(H=\delta^*/\theta\) (2.59 Blasius, ≈1.3–1.4 turbulenta, ≳3.5 separación laminar, ≳2–2.4 separación turbulenta).</p>
    <p><b>Ecuación integral de von Kármán</b>: $$\frac{d\theta}{dx}+(H+2)\frac{\theta}{u_e}\frac{du_e}{dx}=\frac{C_f}{2}$$</p>
    <p><b>Placa plana</b>: laminar (Blasius) \(\delta_{99}=5.0x/\sqrt{Re_x}\), \(C_f=0.664/\sqrt{Re_x}\); turbulenta \(\delta\approx0.37x\,Re_x^{-1/5}\), \(C_f\approx(2\log_{10}Re_x-0.65)^{-2.3}\).</p>
    <p><b>Método de Thwaites</b> (laminar): $$\theta^2=\frac{0.45\,\nu}{u_e^6}\int_0^x u_e^5\,dx,\qquad \lambda=\frac{\theta^2}{\nu}\frac{du_e}{dx},\qquad \lambda<-0.09\Rightarrow\text{separación}$$</p>
    <p><b>Transición</b>: \(Re_{x,crit}\approx 3\text{–}5\times10^5\) en placa con baja turbulencia; la estabilidad lineal (Orr-Sommerfeld) da el primer crecimiento de ondas T-S a \(Re_\theta\approx 200\). Gradiente <b>favorable</b> estabiliza (retrasa), <b>adverso</b> desestabiliza (adelanta). Alta \(Tu\) o rugosidad: <b>transición bypass</b>, sin pasar por T-S. Correlación de Abu-Ghannam & Shaw: \(Re_{\theta,t}=163+\exp\!\left[F(\lambda_\theta)-F(\lambda_\theta)\,Tu/6.91\right]\).</p>
    <p><b>Separación</b>: \(\tau_w=\mu\,\partial u/\partial y|_w=0\). Tras ella hay flujo inverso, la teoría de capa límite deja de valer y la presión exterior se modifica (interacción viscosa-no viscosa).</p>`,
    en: R`<p><b>Prandtl's equations</b> (2D boundary layer, \(\delta\ll x\)): $$u\frac{\partial u}{\partial x}+v\frac{\partial u}{\partial y}=u_e\frac{du_e}{dx}+\nu\frac{\partial^2u}{\partial y^2},\qquad \frac{\partial p}{\partial y}=0$$</p>
    <p><b>Thicknesses</b>: displacement \(\delta^*=\int_0^\infty(1-u/u_e)dy\), momentum \(\theta=\int_0^\infty \frac{u}{u_e}(1-\frac{u}{u_e})dy\), <b>shape factor</b> \(H=\delta^*/\theta\) (2.59 Blasius, ≈1.3–1.4 turbulent, ≳3.5 laminar separation, ≳2–2.4 turbulent separation).</p>
    <p><b>Von Kármán integral equation</b>: $$\frac{d\theta}{dx}+(H+2)\frac{\theta}{u_e}\frac{du_e}{dx}=\frac{C_f}{2}$$</p>
    <p><b>Flat plate</b>: laminar (Blasius) \(\delta_{99}=5.0x/\sqrt{Re_x}\), \(C_f=0.664/\sqrt{Re_x}\); turbulent \(\delta\approx0.37x\,Re_x^{-1/5}\), \(C_f\approx(2\log_{10}Re_x-0.65)^{-2.3}\).</p>
    <p><b>Thwaites' method</b> (laminar): $$\theta^2=\frac{0.45\,\nu}{u_e^6}\int_0^x u_e^5\,dx,\qquad \lambda=\frac{\theta^2}{\nu}\frac{du_e}{dx},\qquad \lambda<-0.09\Rightarrow\text{separation}$$</p>
    <p><b>Transition</b>: \(Re_{x,crit}\approx 3\text{–}5\times10^5\) on a low-turbulence plate; linear stability (Orr-Sommerfeld) gives the first T-S growth at \(Re_\theta\approx 200\). A <b>favourable</b> gradient stabilises (delays), an <b>adverse</b> one destabilises (advances). High \(Tu\) or roughness: <b>bypass transition</b>, skipping T-S. Abu-Ghannam & Shaw: \(Re_{\theta,t}=163+\exp\!\left[F(\lambda_\theta)-F(\lambda_\theta)\,Tu/6.91\right]\).</p>
    <p><b>Separation</b>: \(\tau_w=\mu\,\partial u/\partial y|_w=0\). Beyond it there is reverse flow, boundary-layer theory breaks down and the outer pressure is modified (viscous-inviscid interaction).</p>`,
  },
  labs: [
    { title: { es: "Placa plana: crecimiento, transición y separación", en: "Flat plate: growth, transition and separation" }, desc: { es: "Sube Re o Tu para adelantar la transición; mete gradiente adverso para provocar separación; prueba un trip.", en: "Increase Re or Tu to move transition forward; add an adverse gradient to cause separation; try a trip." }, mount: plateLab },
    { title: { es: "Perfiles de Falkner-Skan: el efecto del gradiente de presión", en: "Falkner-Skan profiles: the effect of the pressure gradient" }, mount: fsLab },
  ],
  interview: [
    { q: { es: "Describe las fases de una capa límite sobre un perfil y por qué ocurren.", en: "Describe the stages of a boundary layer on an airfoil and why they happen." }, a: { es: R`<p>Nace laminar en el punto de remanso (muy delgada, gradiente favorable que la estabiliza). Tras el pico de succión el gradiente adverso y el aumento de \(Re_x\) la desestabilizan: las ondas T-S crecen (o, con mucha turbulencia exterior/rugosidad, transición bypass), aparecen spots turbulentos y transiciona. A Re bajos puede separar laminarmente antes, transicionar en la capa de cortadura y reanclar (burbuja). La turbulenta, más llena, aguanta la recuperación hasta cerca del borde de salida; si el gradiente adverso es muy fuerte (α alto) separa y el perfil entra en pérdida.</p>`, en: R`<p>It is born laminar at the stagnation point (very thin, stabilised by the favourable gradient). After the suction peak, the adverse gradient and growing \(Re_x\) destabilise it: T-S waves grow (or, with high free-stream turbulence/roughness, bypass transition), turbulent spots appear and it transitions. At low Re it may separate laminar first, transition in the shear layer and reattach (bubble). The fuller turbulent layer withstands the recovery up to near the trailing edge; if the adverse gradient is very strong (high α) it separates and the airfoil stalls.</p>` } },
    { q: { es: "¿Qué factores adelantan o retrasan la transición?", en: "Which factors advance or delay transition?" }, a: { es: R`<p>Adelantan: mayor \(Re_x\), gradiente adverso, turbulencia de la corriente libre, rugosidad/escalones/suciedad, vibraciones, superficies cóncavas (Görtler), flujo cruzado en alas en flecha, calentar la pared en aire. Retrasan: gradiente favorable (perfiles laminares NLF), superficies muy lisas, succión de capa límite, enfriar la pared en aire.</p>`, en: R`<p>Advance: higher \(Re_x\), adverse gradient, free-stream turbulence, roughness/steps/dirt, vibration, concave surfaces (Görtler), crossflow on swept wings, heating the wall in air. Delay: favourable gradient (NLF sections), very smooth surfaces, boundary-layer suction, cooling the wall in air.</p>` } },
    { q: { es: "¿Qué es el factor de forma H y para qué sirve?", en: "What is the shape factor H and what is it used for?" }, a: { es: R`<p>\(H=\delta^*/\theta\): mide lo "lleno" que está el perfil de velocidad. Laminar Blasius 2.59, turbulento 1.3–1.4. Crece con el gradiente adverso; es el indicador práctico de separación inminente (laminar ~3.5–4, turbulenta ~2–2.4) y de transición (cae bruscamente).</p>`, en: R`<p>\(H=\delta^*/\theta\): it measures how "full" the velocity profile is. Laminar Blasius 2.59, turbulent 1.3–1.4. It grows with adverse gradient; it is the practical indicator of imminent separation (laminar ~3.5–4, turbulent ~2–2.4) and of transition (drops sharply).</p>` } },
    { q: { es: "¿Qué es una burbuja de separación laminar y qué problemas da?", en: "What is a laminar separation bubble and what problems does it cause?" }, a: { es: R`<p>La capa laminar separa por el gradiente adverso; la capa de cortadura libre es muy inestable, transiciona rápido y la mezcla turbulenta la vuelve a pegar a la pared. Entre separación y reanclaje queda una región de recirculación con presión casi constante. Aumenta la resistencia; a bajo Re o alto α puede "estallar" (no reanclar) y provocar pérdida de borde de ataque. Se controla con turbuladores/trips.</p>`, en: R`<p>The laminar layer separates under the adverse gradient; the free shear layer is very unstable, transitions quickly and turbulent mixing reattaches it. Between separation and reattachment there is a recirculation region at almost constant pressure. It increases drag; at low Re or high α it can "burst" (fail to reattach) and trigger leading-edge stall. It is controlled with turbulators/trips.</p>` } },
  ],
  myths: [
    { es: "«La capa límite turbulenta es mala». Tiene más fricción, pero aguanta mucho más gradiente adverso: en alerones y difusores de F1 se busca a menudo para evitar separación.", en: "“A turbulent boundary layer is bad”. It has more friction but withstands much more adverse gradient: on F1 wings and diffusers it is often wanted to avoid separation." },
    { es: "«La transición ocurre en un punto». Es una región con intermitencia creciente (spots); los modelos dan un punto por conveniencia.", en: "“Transition happens at a point”. It is a region of increasing intermittency (spots); models give a point for convenience." },
    { es: "«La presión cambia a través de la capa límite». En la aproximación de capa límite ∂p/∂y ≈ 0: la pared 'siente' la presión exterior (por eso los Cp medidos en la superficie sirven).", en: "“Pressure changes across the boundary layer”. In the boundary-layer approximation ∂p/∂y ≈ 0: the wall 'feels' the outer pressure (which is why surface Cp measurements work)." },
  ],
  quiz: [
    { q: { es: "El espesor de una capa límite laminar crece como…", en: "Laminar boundary-layer thickness grows as…" }, options: [{ es: "x", en: "x" }, { es: "√x", en: "√x" }, { es: "x^(4/5)", en: "x^(4/5)" }, { es: "constante", en: "constant" }], correct: 1, explain: { es: "δ = 5x/√Re_x ∝ √x. La turbulenta crece como x^(4/5).", en: "δ = 5x/√Re_x ∝ √x. The turbulent one grows as x^(4/5)." } },
    { q: { es: "Un gradiente favorable…", en: "A favourable gradient…" }, options: [{ es: "adelanta la transición", en: "advances transition" }, { es: "retrasa la transición y adelgaza la capa", en: "delays transition and thins the layer" }, { es: "provoca separación", en: "causes separation" }, { es: "no afecta", en: "has no effect" }], correct: 1, explain: { es: "Estabiliza el perfil de velocidad (más lleno, sin inflexión).", en: "It stabilises the velocity profile (fuller, no inflection)." } },
    { q: { es: "H = 2.59 corresponde a…", en: "H = 2.59 corresponds to…" }, options: [{ es: "capa turbulenta", en: "turbulent layer" }, { es: "Blasius (laminar, placa plana)", en: "Blasius (laminar, flat plate)" }, { es: "separación turbulenta", en: "turbulent separation" }, { es: "punto de remanso", en: "stagnation point" }], correct: 1, explain: { es: "δ*/θ = 1.7208/0.664.", en: "δ*/θ = 1.7208/0.664." } },
    { q: { es: "La transición bypass es típica de…", en: "Bypass transition is typical of…" }, options: [{ es: "túneles muy silenciosos", en: "very quiet tunnels" }, { es: "alta turbulencia exterior o rugosidad", en: "high free-stream turbulence or roughness" }, { es: "gradientes favorables", en: "favourable gradients" }, { es: "flujo supersónico", en: "supersonic flow" }], correct: 1, explain: { es: "Las perturbaciones grandes se saltan el crecimiento lineal de ondas T-S. Es el caso típico en turbomáquinas y en la estela sucia de otro coche.", en: "Large disturbances skip linear T-S growth. Typical in turbomachinery and in another car's dirty wake." } },
  ],
  refs: [
    "H. Schlichting & K. Gersten, <i>Boundary-Layer Theory</i>, 9th ed., Springer, 2017.",
    "F.M. White, <i>Viscous Fluid Flow</i>, 3rd ed., McGraw-Hill, ch. 4–6.",
    "B. Thwaites, “Approximate calculation of the laminar boundary layer”, <i>Aero. Quart.</i> 1 (1949).",
    "B.J. Abu-Ghannam & R.M. Shaw, “Natural transition of boundary layers — the effects of turbulence, pressure gradient, and flow history”, <i>J. Mech. Eng. Sci.</i> 22 (1980).",
  ],
};
