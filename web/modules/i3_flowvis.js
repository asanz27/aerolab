import { slider, labLayout, readout, segmented, L, tr, canvasBox, el, engineBadge } from "../js/core/ui.js";
import { cssVar } from "../js/core/plot.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function rand(seed) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
}

function oilLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 380 });
  const wait = engineBadge(box);
  const sA = slider({ label: { es: "α [°]", en: "α [°]" }, min: 0, max: 16, step: 0.5, value: 7, onInput: run });
  const sRe = slider({ label: { es: "Reynolds", en: "Reynolds" }, min: 1e5, max: 3e6, value: 4e5, log: true, format: (v) => v.toExponential(1), onInput: run });
  const sQ = segmented({ label: { es: "Modo reto: busca y haz clic en…", en: "Challenge mode: find and click on…" }, value: "none", onInput: () => (msg.innerHTML = ""), options: [
    { value: "none", label: { es: "(libre)", en: "(free)" } },
    { value: "lsep", label: { es: "separación laminar", en: "laminar separation" } },
    { value: "reat", label: { es: "reanclaje / transición", en: "reattachment / transition" } },
    { value: "tsep", label: { es: "separación turbulenta", en: "turbulent separation" } },
  ] });
  ui.controls.append(sA.el, sRe.el, sQ.el);
  const msg = el("div", { class: "callout" });
  ui.note.append(msg);
  const roB = readout({ es: "Burbuja laminar", en: "Laminar bubble" });
  const roS = readout({ es: "Separación (raíz)", en: "Separation (root)" }, "x/c");
  ui.readouts.append(roB.el, roS.el);
  ui.note.insertAdjacentHTML("afterbegin", L(
    "<p>Imagen sintética de pintura de aceite sobre el extradós de un ala rectangular (vista en planta, flujo de izquierda a derecha, raíz abajo, punta arriba). Las posiciones de transición, burbuja y separación de cada sección salen del motor (paneles + capa límite con el α efectivo de la línea sustentadora). Cerca de la punta, la huella del vórtice de punta desvía las líneas hacia fuera.</p>",
    "<p>Synthetic oil-flow image of the upper surface of a rectangular wing (plan view, flow left to right, root at the bottom, tip at the top). Transition, bubble and separation positions of each section come from the engine (panels + boundary layer with the lifting-line effective α). Near the tip, the tip-vortex footprint turns the streaks outboard.</p>"
  ));
  let data = null;
  const call = liveCall("oil", "flowvis.wing", 100);
  function run() {
    call({ code: "0012", alpha: sA.value, re: sRe.value, AR: 4, n_span: 9 }, (r) => {
      wait.remove();
      data = r;
      draw();
      const st = r.stations[0];
      roB.set(st.bubble ? L(`sí (x/c ≈ ${st.x_lsep?.toFixed(2)})`, `yes (x/c ≈ ${st.x_lsep?.toFixed(2)})`) : L("no", "no"), st.bubble ? "warn" : "");
      roS.set(st.x_sep == null ? L("ninguna", "none") : st.x_sep.toFixed(2), st.x_sep == null ? "good" : "bad");
    });
  }
  let geom = null;
  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const W = box.clientWidth, H = box.clientHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    canvas.style.width = W + "px";
    canvas.style.height = H + "px";
    const g = canvas.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#0b0f14";
    g.fillRect(0, 0, W, H);
    const x0 = 40, x1 = W - 40, y0 = 20, y1 = H - 20;
    geom = { x0, x1, y0, y1 };
    // wing surface (matte black paint with white oil)
    g.fillStyle = "#151a22";
    g.fillRect(x0, y0, x1 - x0, y1 - y0);
    const st = data.stations;
    const interp = (yy, key) => {
      // yy in [0,0.5] (root..tip), linear interpolation between stations
      let k = st.findIndex((s) => s.y >= yy);
      if (k <= 0) return st[0][key];
      const a = st[k - 1], b = st[k];
      if (a[key] == null || b[key] == null) return yy - a.y < b.y - yy ? a[key] : b[key];
      const f = (yy - a.y) / (b.y - a.y);
      return a[key] + f * (b[key] - a[key]);
    };
    const rnd = rand(12345);
    const X = (x) => x0 + x * (x1 - x0);
    const Y = (yy) => y1 - (yy / 0.5) * (y1 - y0);
    // streaks
    for (let n = 0; n < 2600; n++) {
      const yy = rnd() * 0.5;
      let x = rnd();
      const xtr = interp(yy, "x_tr") ?? 1;
      const xls = interp(yy, "x_lsep");
      const bub = (interp(yy, "bubble") ?? 0) > 0.5;
      const xs = interp(yy, "x_sep");
      const tipF = Math.max(0, (yy - 0.38) / 0.12); // tip-vortex footprint
      let len, alpha, dy;
      if (xs != null && x > xs) {
        // separated: weak reverse-flow streaks, blotchy
        len = -0.012 - 0.01 * rnd();
        alpha = 0.25;
        dy = (rnd() - 0.5) * 0.02;
      } else if (bub && xls != null && x > xls && x < xtr + 0.03) {
        // inside the bubble: slow recirculation, oil pools
        len = -0.004;
        alpha = 0.18;
        dy = 0;
      } else if (x < xtr) {
        len = 0.01;
        alpha = 0.22; // laminar: low shear, faint streaks
        dy = 0;
      } else {
        len = 0.03 + 0.02 * rnd();
        alpha = 0.55; // turbulent: high shear, clean long streaks
        dy = 0;
      }
      dy += tipF * len * 0.9; // outboard turning near the tip
      g.strokeStyle = `rgba(235,240,245,${alpha})`;
      g.lineWidth = 1;
      g.beginPath();
      g.moveTo(X(x), Y(yy));
      g.lineTo(X(x + len), Y(yy + dy));
      g.stroke();
    }
    // accumulation lines (oil collects where shear vanishes)
    const line = (key, color, w) => {
      g.strokeStyle = color;
      g.lineWidth = w;
      g.beginPath();
      let started = false;
      for (let i = 0; i <= 60; i++) {
        const yy = (i / 60) * 0.5;
        const v = interp(yy, key);
        if (v == null) {
          started = false;
          continue;
        }
        started ? g.lineTo(X(v), Y(yy)) : g.moveTo(X(v), Y(yy));
        started = true;
      }
      g.stroke();
    };
    line("x_lsep", "rgba(250,250,250,0.85)", 3);
    line("x_sep", "rgba(250,250,250,0.9)", 4);
    g.strokeStyle = "#94a3b8";
    g.lineWidth = 1.5;
    g.strokeRect(x0, y0, x1 - x0, y1 - y0);
    g.fillStyle = cssVar("--fg-muted");
    g.font = "11px Inter";
    g.fillText(tr({ es: "borde de ataque", en: "leading edge" }), x0 - 30, y1 + 14);
    g.fillText(tr({ es: "borde de salida", en: "trailing edge" }), x1 - 60, y1 + 14);
    g.fillText(tr({ es: "punta →", en: "tip →" }), x1 + 4, y0 + 10);
  }
  canvas.addEventListener("click", (e) => {
    if (!data || !geom || sQ.value === "none") return;
    const r = canvas.getBoundingClientRect();
    const px = e.clientX - r.left, py = e.clientY - r.top;
    const x = (px - geom.x0) / (geom.x1 - geom.x0);
    const yy = ((geom.y1 - py) / (geom.y1 - geom.y0)) * 0.5;
    const s = data.stations.reduce((b, st) => (Math.abs(st.y - yy) < Math.abs(b.y - yy) ? st : b), data.stations[0]);
    const target = { lsep: s.x_lsep, reat: s.x_tr, tsep: s.x_sep }[sQ.value];
    if (target == null) {
      msg.innerHTML = L("En esta sección no existe esa línea con estas condiciones: cambia α o Re.", "That line does not exist at this section for these conditions: change α or Re.");
      return;
    }
    const ok = Math.abs(x - target) < 0.05;
    msg.innerHTML = (ok ? "✅ " : "❌ ") + L(`Has marcado x/c = ${x.toFixed(2)}; la línea está en x/c ≈ ${target.toFixed(2)}.`, `You clicked x/c = ${x.toFixed(2)}; the line is at x/c ≈ ${target.toFixed(2)}.`);
  });
  run();
}

export default {
  subtitle: {
    es: "Leer una visualización de flujo: transición, burbujas, líneas de separación y reanclaje, huellas de vórtices y topología.",
    en: "Reading flow visualisation: transition, bubbles, separation and reattachment lines, vortex footprints and topology.",
  },
  heroParams: { eps: 0.1, camber: 0.04, alpha: 8 },
  intuition: {
    es: R`<p>La <span class="term">pintura de flujo</span> (aceite con pigmento, <i>flow-vis paint</i>) se mueve sobre la superficie arrastrada por la tensión tangencial de la pared: dibuja las <b>líneas de fricción</b> (<i>skin-friction lines</i>). Donde la fricción es alta (capa turbulenta) las rayas son largas y la superficie queda "barrida"; donde es baja (laminar) apenas se mueve; donde la fricción se anula y el flujo de pared converge (<b>separación</b>), el aceite se <b>acumula</b> formando una línea gruesa; donde el flujo llega a la pared y diverge (<b>reanclaje</b>), la pintura se aparta.</p>
    <p>Así se identifican: zona <b>laminar</b> (rayas débiles), <b>burbuja laminar</b> (acumulación en la separación laminar seguida de una franja casi inmóvil y una línea de reanclaje donde empiezan las rayas turbulentas), <b>transición</b> (cambio brusco de textura), <b>separación turbulenta</b> (línea de acumulación, aguas abajo flujo inverso desordenado) y <b>huellas de vórtices</b> (rayas curvadas que convergen en líneas de separación o divergen desde líneas de reanclaje). En pista se usan también <i>tufts</i> (hilos) y en túnel PIV y cámaras infrarrojas (la transición se ve por el cambio de transferencia de calor).</p>`,
    en: R`<p><span class="term">Flow-vis paint</span> (pigmented oil) moves over the surface driven by wall shear stress: it draws the <b>skin-friction lines</b>. Where friction is high (turbulent layer) streaks are long and the surface is "scrubbed"; where it is low (laminar) it barely moves; where friction vanishes and wall flow converges (<b>separation</b>) oil <b>accumulates</b> into a thick line; where flow arrives at the wall and diverges (<b>reattachment</b>) paint is pushed away.</p>
    <p>This identifies: <b>laminar</b> region (faint streaks), <b>laminar bubble</b> (accumulation at laminar separation, then an almost still band and a reattachment line where turbulent streaks start), <b>transition</b> (sudden texture change), <b>turbulent separation</b> (accumulation line, disordered reverse flow downstream) and <b>vortex footprints</b> (curved streaks converging into separation lines or diverging from attachment lines). On track tufts are also used, and in the tunnel PIV and infrared cameras (transition shows as a heat-transfer change).</p>`,
  },
  physics: {
    es: R`<p><b>Líneas de fricción</b>: tangentes al vector \(\boldsymbol\tau_w=\mu\,\partial\mathbf u/\partial n|_w\). La pintura se mueve con velocidad \(\propto\boldsymbol\tau_w h/\mu_{oil}\) (película delgada): es un "integrador" de la tensión de pared.</p>
    <p><b>Topología</b> (Legendre, Tobak & Peake): puntos singulares donde \(\boldsymbol\tau_w=0\): <b>nodos</b> (de separación o de reanclaje), <b>focos</b> (espirales: huella de un vórtice que despega de la superficie) y <b>puntos de silla</b>. En una superficie cerrada se cumple \(\sum N-\sum S=2\) (regla de Poincaré-Hopf para cuerpos en flujo). Las líneas de separación salen de sillas y terminan en nodos/focos.</p>
    <p><b>Burbuja laminar</b>: separación laminar (λ &lt; −0.09) → capa de cortadura que transiciona → reanclaje turbulento; longitud de la burbuja decrece al aumentar Re.</p>
    <p><b>Técnicas</b>: pintura de aceite (superficie, estacionario), tufts (dirección local, inestacionario), humo/láser (planos del flujo), PIV (campo de velocidades), PSP/tomas de presión (presión), IR/cristales líquidos (transición), sublimación (naftaleno, transición).</p>`,
    en: R`<p><b>Skin-friction lines</b>: tangent to \(\boldsymbol\tau_w=\mu\,\partial\mathbf u/\partial n|_w\). Paint moves at a speed \(\propto\boldsymbol\tau_w h/\mu_{oil}\) (thin film): it is an "integrator" of wall shear.</p>
    <p><b>Topology</b> (Legendre, Tobak & Peake): singular points where \(\boldsymbol\tau_w=0\): <b>nodes</b> (separation or attachment), <b>foci</b> (spirals: footprint of a vortex lifting off the surface) and <b>saddles</b>. On a closed body \(\sum N-\sum S=2\) (Poincaré-Hopf rule for bodies in flow). Separation lines start at saddles and end at nodes/foci.</p>
    <p><b>Laminar bubble</b>: laminar separation (λ &lt; −0.09) → transitioning shear layer → turbulent reattachment; the bubble shortens as Re grows.</p>
    <p><b>Techniques</b>: oil paint (surface, steady), tufts (local direction, unsteady), smoke/laser sheet (flow planes), PIV (velocity field), PSP/pressure taps (pressure), IR/liquid crystals (transition), sublimation (naphthalene, transition).</p>`,
  },
  labs: [{ title: { es: "Pintura de aceite sintética de un ala", en: "Synthetic oil-flow on a wing" }, desc: { es: "A Re bajo verás la burbuja laminar; sube α para que aparezca la separación turbulenta desde el borde de salida. Usa el modo reto para practicar.", en: "At low Re you'll see the laminar bubble; raise α so turbulent separation appears from the trailing edge. Use challenge mode to practise." }, mount: oilLab }],
  interview: [
    { q: { es: "Te enseñan una foto de flow-vis: ¿cómo distingues las zonas?", en: "You're shown a flow-vis photo: how do you tell the regions apart?" }, a: { es: R`<p>Laminar: rayas débiles, poca fricción. Transición: cambio brusco a rayas largas y superficie limpia (alta fricción). Burbuja laminar: línea de acumulación (separación laminar), franja con pintura casi quieta o retrocediendo, y línea de reanclaje donde empiezan las rayas turbulentas. Separación turbulenta: línea gruesa de acumulación donde convergen las rayas; detrás, flujo inverso o pintura sin patrón. Vórtices: rayas curvadas, líneas de separación/reanclaje en forma de "V" o espirales (focos).</p>`, en: R`<p>Laminar: faint streaks, low friction. Transition: sudden change to long streaks and clean surface (high friction). Laminar bubble: accumulation line (laminar separation), a band of almost still or backward-moving paint, then a reattachment line where turbulent streaks start. Turbulent separation: thick accumulation line where streaks converge; behind it reverse flow or patternless paint. Vortices: curved streaks, "V"-shaped separation/attachment lines or spirals (foci).</p>` } },
    { q: { es: "¿Por qué el aceite se acumula en la línea de separación?", en: "Why does oil accumulate at the separation line?" }, a: { es: R`<p>Porque ahí la tensión de pared se anula y cambia de signo: el aceite llega desde aguas arriba (flujo adherido) y desde aguas abajo (flujo inverso de la zona separada), las líneas de fricción convergen y no hay cortante que lo arrastre.</p>`, en: R`<p>Because wall shear vanishes and changes sign there: oil arrives from upstream (attached flow) and from downstream (reverse flow of the separated region), skin-friction lines converge and there is no shear to carry it away.</p>` } },
  ],
  myths: [
    { es: "«Las rayas de aceite son líneas de corriente». Son líneas de fricción en la pared; pueden diferir mucho de las líneas de corriente exteriores (p. ej. bajo un vórtice o en flujo cruzado).", en: "“Oil streaks are streamlines”. They are wall skin-friction lines; they can differ greatly from outer streamlines (e.g. under a vortex or in crossflow)." },
    { es: "«Si no hay acumulación de aceite, no hay separación». En flujo 3D la separación puede ser «abierta» y verse solo como convergencia de líneas.", en: "“No oil accumulation means no separation”. In 3D flow separation can be “open” and show only as converging lines." },
  ],
  quiz: [
    { q: { es: "Una zona con rayas largas y superficie barrida indica…", en: "A region with long streaks and scrubbed surface indicates…" }, options: [{ es: "flujo laminar", en: "laminar flow" }, { es: "capa límite turbulenta adherida (alta fricción)", en: "attached turbulent boundary layer (high friction)" }, { es: "separación", en: "separation" }, { es: "punto de remanso", en: "stagnation point" }], correct: 1, explain: { es: "La pintura se mueve proporcionalmente a τw.", en: "Paint moves in proportion to τw." } },
    { q: { es: "Un foco (espiral) en un patrón de aceite indica…", en: "A focus (spiral) in an oil pattern indicates…" }, options: [{ es: "un vórtice que despega de la superficie", en: "a vortex lifting off the surface" }, { es: "transición", en: "transition" }, { es: "un choque", en: "a shock" }, { es: "flujo uniforme", en: "uniform flow" }], correct: 0, explain: { es: "Topología de flujo separado 3D.", en: "3D separated-flow topology." } },
  ],
  refs: [
    "M. Tobak & D.J. Peake, “Topology of three-dimensional separated flows”, <i>Annu. Rev. Fluid Mech.</i> 14 (1982).",
    "W. Merzkirch, <i>Flow Visualization</i>, 2nd ed., Academic Press, 1987.",
    "J.B. Barlow, W.H. Rae & A. Pope, <i>Low-Speed Wind Tunnel Testing</i>, ch. 5.",
  ],
};
