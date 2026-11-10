import { slider, labLayout, readout, toggle, button, L, tr, engineBadge, canvasBox, el } from "../js/core/ui.js";
import { cssVar } from "../js/core/plot.js";
import { physics } from "../js/bridge/physics.js";

const R = String.raw;

function sandboxLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 400 });
  const wait = engineBadge(box);
  const sG1 = slider({ label: { es: "Γ₁ (izquierda) — positivo = antihorario", en: "Γ₁ (left) — positive = counter-clockwise" }, min: -2, max: 2, step: 0.05, value: 1 });
  const sG2 = slider({ label: { es: "Γ₂ (derecha)", en: "Γ₂ (right)" }, min: -2, max: 2, step: 0.05, value: 1 });
  const sD = slider({ label: { es: "Separación d", en: "Separation d" }, min: 0.4, max: 2, step: 0.05, value: 1 });
  const sA = slider({ label: { es: "Radio de núcleo a (relativo a d)", en: "Core radius a (relative to d)" }, min: 0.08, max: 0.4, step: 0.01, value: 0.2 });
  const tW = toggle({ label: { es: "Pared (suelo) en y = 0", en: "Wall (ground) at y = 0" }, value: false });
  const presets = el("div", { class: "seg-row" });
  const P = (lab, f) => presets.appendChild(button(lab, () => (f(), start())));
  P({ es: "Corrotantes iguales", en: "Equal co-rotating" }, () => ((sG1.value = 1), (sG2.value = 1), (sA.value = 0.33), (tW.value = false)));
  P({ es: "Corrotantes, uno débil", en: "Co-rotating, one weak" }, () => ((sG1.value = 1.6), (sG2.value = 0.4), (sA.value = 0.25), (tW.value = false)));
  P({ es: "Contrarrotantes", en: "Counter-rotating" }, () => ((sG1.value = 1), (sG2.value = -1), (sA.value = 0.15), (tW.value = false)));
  P({ es: "Contrarrotantes desiguales", en: "Unequal counter-rotating" }, () => ((sG1.value = 1.4), (sG2.value = -0.7), (sA.value = 0.15), (tW.value = false)));
  P({ es: "Vórtice junto al suelo", en: "Vortex near the ground" }, () => ((sG1.value = 1), (sG2.value = 0), (sA.value = 0.15), (tW.value = true)));
  const go = button({ es: "▶ Simular", en: "▶ Run" }, start, "primary");
  ui.controls.append(presets, sG1.el, sG2.el, sD.el, sA.el, tW.el, go);
  const roT = readout({ es: "Teoría de vórtices puntuales", en: "Point-vortex theory" });
  const roS = readout({ es: "Separación actual / d₀", en: "Current separation / d₀" });
  ui.readouts.append(roT.el, roS.el);
  ui.note.innerHTML = L(
    R`Cada vórtice es un núcleo gaussiano discretizado en ~40 "blobs" (método de vórtices, RK4 en Python) + tinte pasivo. Iguales y corrotantes giran alrededor de su centro; si \(a/d\gtrsim0.3\) se <b>fusionan</b>. Uno débil junto a uno fuerte es estirado en filamentos alrededor del fuerte (<i>stripping</i>). Contrarrotantes iguales se trasladan juntos (inducción mutua); junto a una pared, el vórtice imagen hace que el vórtice se desplace paralelo al suelo.`,
    R`Each vortex is a Gaussian core discretised into ~40 "blobs" (vortex method, RK4 in Python) + passive dye. Equal co-rotating vortices orbit their centroid; if \(a/d\gtrsim0.3\) they <b>merge</b>. A weak vortex next to a strong one is strained into filaments around it (stripping). Equal counter-rotating vortices translate together (mutual induction); near a wall, the image vortex makes the vortex move parallel to the ground.`
  );
  let st = null, dye = null, run = 0, t = 0, d0 = 1, trail = [];
  async function start() {
    const my = ++run;
    const d = sD.value;
    d0 = d;
    const a = sA.value * d;
    const y0 = tW.value ? 0.45 * d + a : 0;
    const vort = [];
    if (Math.abs(sG1.value) > 0.01) vort.push({ x: -d / 2, y: y0, gamma: sG1.value, radius: a });
    if (Math.abs(sG2.value) > 0.01) vort.push({ x: d / 2, y: y0, gamma: sG2.value, radius: a });
    if (!vort.length) return;
    st = await physics.call("vortex.blobs_init", { vortices: vort, n_rings: 3, delta: 0.45 * a });
    // dye rings
    dye = { x: [], y: [], c: [] };
    vort.forEach((v, k) => {
      for (let i = 0; i < 70; i++) {
        const r = a * (0.5 + 1.6 * Math.random());
        const p = Math.random() * 6.283;
        dye.x.push(v.x + r * Math.cos(p));
        dye.y.push(v.y + r * Math.sin(p));
        dye.c.push(k);
      }
    });
    physics.call("vortex.pair_theory", { g1: sG1.value, g2: sG2.value, d }).then((th) => {
      roT.set(th.type === "translate" ? L(`traslación v = ${th.speed.toFixed(3)}`, `translation v = ${th.speed.toFixed(3)}`) : L(`giro ω = ${th.omega.toFixed(3)}`, `rotation ω = ${th.omega.toFixed(3)}`));
    });
    wait.remove();
    t = 0;
    trail = [];
    const Gs = Math.max(Math.abs(sG1.value), Math.abs(sG2.value), 0.2);
    const dt = (0.04 * d * d) / Gs;
    while (my === run && document.body.contains(box) && t < 400) {
      const r = await physics.call("vortex.blobs_step", { x: st.x, y: st.y, g: st.g, delta: st.delta, dt, n_steps: 3, wall: tW.value, tx: dye.x, ty: dye.y });
      if (my !== run) return;
      st = { ...st, x: r.x, y: r.y };
      dye.x = r.tx;
      dye.y = r.ty;
      t++;
      draw();
    }
  }
  function draw() {
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
    const sc = Math.min(W, H) / (3.2 * d0);
    const cy = tW.value ? H - 30 : H / 2;
    const X = (x) => W / 2 + x * sc, Y = (y) => cy - y * sc;
    if (tW.value) {
      g.fillStyle = "rgba(148,163,184,0.25)";
      g.fillRect(0, cy, W, H - cy);
      g.strokeStyle = cssVar("--fg-muted");
      g.beginPath();
      g.moveTo(0, cy);
      g.lineTo(W, cy);
      g.stroke();
    }
    const cols = ["rgba(34,211,238,0.75)", "rgba(251,146,60,0.75)"];
    for (let i = 0; i < dye.x.length; i++) {
      g.fillStyle = cols[dye.c[i]];
      g.fillRect(X(dye.x[i]) - 1.5, Y(dye.y[i]) - 1.5, 3, 3);
    }
    // centroid of each vortex and trail
    const own = st.owner;
    const cents = [];
    for (const k of [0, 1]) {
      let sx = 0, sy = 0, sw = 0;
      for (let i = 0; i < st.x.length; i++)
        if (own[i] === k) {
          const w = Math.abs(st.g[i]);
          sx += w * st.x[i];
          sy += w * st.y[i];
          sw += w;
        }
      if (sw > 0) cents.push([sx / sw, sy / sw]);
    }
    trail.push(cents);
    if (trail.length > 400) trail.shift();
    for (let k = 0; k < cents.length; k++) {
      g.strokeStyle = k ? "rgba(251,146,60,0.5)" : "rgba(34,211,238,0.5)";
      g.beginPath();
      trail.forEach((c, i) => c[k] && (i ? g.lineTo(X(c[k][0]), Y(c[k][1])) : g.moveTo(X(c[k][0]), Y(c[k][1]))));
      g.stroke();
    }
    g.fillStyle = cssVar("--fg");
    for (let i = 0; i < st.x.length; i++) g.fillRect(X(st.x[i]) - 1, Y(st.y[i]) - 1, 2, 2);
    if (cents.length === 2) roS.set((Math.hypot(cents[0][0] - cents[1][0], cents[0][1] - cents[1][1]) / d0).toFixed(2));
    g.fillStyle = cssVar("--fg-muted");
    g.font = "12px Inter";
    g.fillText(tr({ es: "blancos: elementos de vorticidad · colores: tinte pasivo", en: "white: vorticity elements · colours: passive dye" }), 10, 18);
  }
  start();
}

export default {
  subtitle: {
    es: "Biot-Savart en acción: pares corrotantes y contrarrotantes, fusión, stripping del vórtice débil y efecto de una pared.",
    en: "Biot-Savart in action: co- and counter-rotating pairs, merging, stripping of the weak vortex and the effect of a wall.",
  },
  heroParams: { eps: 0.05, camber: 0.1, alpha: 12 },
  intuition: {
    es: R`<p>Un vórtice no se mueve por sí mismo: se mueve con la velocidad que le <b>inducen los demás</b> (y sus imágenes). Dos vórtices del mismo signo giran uno alrededor del otro; si son de signo opuesto e igual intensidad, se empujan mutuamente y avanzan juntos en línea recta (así se hunde la estela de un avión). Cerca del suelo, el vórtice "ve" una imagen de signo contrario y se desplaza paralelo a la pared; además arranca vorticidad secundaria de la capa límite del suelo y puede "rebotar".</p>
    <p>Cuando los núcleos tienen tamaño finito aparecen efectos no lineales: dos vórtices iguales y corrotantes, si están lo bastante cerca (\(a/d\gtrsim0.3\)), se <b>fusionan</b> en uno. Si uno es mucho más fuerte, el campo de deformación del fuerte <b>estira y deshilacha</b> al débil, que acaba enrollado en filamentos alrededor del fuerte. Es el pan de cada día en la estela de un F1: decenas de vórtices (alerón, endplates, ruedas, suelo) interactuando.</p>`,
    en: R`<p>A vortex does not move by itself: it moves with the velocity <b>induced by the others</b> (and by its images). Two same-sign vortices orbit each other; opposite-sign equal ones push each other and travel together in a straight line (that is why an aircraft wake sinks). Near the ground a vortex "sees" an opposite-sign image and moves parallel to the wall; it also lifts secondary vorticity from the ground boundary layer and can "rebound".</p>
    <p>With finite cores non-linear effects appear: two equal co-rotating vortices close enough (\(a/d\gtrsim0.3\)) <b>merge</b> into one. If one is much stronger, its strain field <b>stretches and strips</b> the weaker one, which ends up wrapped in filaments around the strong one. This is everyday life in an F1 wake: dozens of vortices (wings, endplates, wheels, floor) interacting.</p>`,
  },
  physics: {
    es: R`<p><b>Biot-Savart</b> (filamento recto 2D, vórtice puntual): \(\mathbf u=\dfrac{\Gamma}{2\pi}\dfrac{\hat z\times(\mathbf x-\mathbf x_0)}{|\mathbf x-\mathbf x_0|^2}\); en 3D: \(\mathbf u(\mathbf x)=\frac{\Gamma}{4\pi}\oint\frac{d\mathbf l\times(\mathbf x-\mathbf x')}{|\mathbf x-\mathbf x'|^3}\).</p>
    <p><b>Dos vórtices puntuales</b> a distancia \(d\):</p>
    <ul><li>\(\Gamma_1+\Gamma_2\neq0\): giran alrededor del centro de vorticidad \(\frac{\Gamma_1\mathbf x_1+\Gamma_2\mathbf x_2}{\Gamma_1+\Gamma_2}\) con \(\Omega=\dfrac{\Gamma_1+\Gamma_2}{2\pi d^2}\).</li>
    <li>\(\Gamma_1=-\Gamma_2\): traslación a \(V=\dfrac{\Gamma}{2\pi d}\) perpendicular a la línea que los une.</li>
    <li>Pared: vórtice a altura \(h\) → imagen \(-\Gamma\) en \(-h\) → \(V=\Gamma/(4\pi h)\) paralela al suelo.</li></ul>
    <p><b>Fusión</b> de vórtices iguales corrotantes: umbral \(a/b\approx0.29\)–0.32 (Meunier, Le Dizès & Leweke 2005), con \(a\) radio de núcleo y \(b\) separación. <b>Stripping</b>: un vórtice débil se destruye cuando la deformación que le impone el fuerte (\(\sim\Gamma_{fuerte}/2\pi d^2\)) supera su propia vorticidad de núcleo.</p>
    <p><b>¿Por qué un vórtice débil puede persistir más?</b> Ojo con generalizar: en una pareja, el débil se destruye por stripping. Pero frente a gradientes de presión adversos, un vórtice <b>más débil (menor swirl)</b> está más lejos de la condición de breakdown y aguanta más; uno muy intenso puede "estallar" (ver E3). Además, uno con menos velocidad inducida interactúa menos con superficies y con su imagen.</p>`,
    en: R`<p><b>Biot-Savart</b> (2D straight filament, point vortex): \(\mathbf u=\dfrac{\Gamma}{2\pi}\dfrac{\hat z\times(\mathbf x-\mathbf x_0)}{|\mathbf x-\mathbf x_0|^2}\); in 3D: \(\mathbf u(\mathbf x)=\frac{\Gamma}{4\pi}\oint\frac{d\mathbf l\times(\mathbf x-\mathbf x')}{|\mathbf x-\mathbf x'|^3}\).</p>
    <p><b>Two point vortices</b> at distance \(d\):</p>
    <ul><li>\(\Gamma_1+\Gamma_2\neq0\): they orbit the centre of vorticity \(\frac{\Gamma_1\mathbf x_1+\Gamma_2\mathbf x_2}{\Gamma_1+\Gamma_2}\) at \(\Omega=\dfrac{\Gamma_1+\Gamma_2}{2\pi d^2}\).</li>
    <li>\(\Gamma_1=-\Gamma_2\): translation at \(V=\dfrac{\Gamma}{2\pi d}\) normal to the line joining them.</li>
    <li>Wall: vortex at height \(h\) → image \(-\Gamma\) at \(-h\) → \(V=\Gamma/(4\pi h)\) parallel to the ground.</li></ul>
    <p><b>Merging</b> of equal co-rotating vortices: threshold \(a/b\approx0.29\)–0.32 (Meunier, Le Dizès & Leweke 2005), \(a\) core radius, \(b\) separation. <b>Stripping</b>: a weak vortex is destroyed when the strain imposed by the strong one (\(\sim\Gamma_{strong}/2\pi d^2\)) exceeds its own core vorticity.</p>
    <p><b>Why can a weaker vortex persist longer?</b> Careful generalising: in a pair, the weak one is stripped. But against adverse pressure gradients a <b>weaker vortex (lower swirl)</b> is further from breakdown and survives longer; a very intense one can "burst" (see E3). Also, one with less induced velocity interacts less with surfaces and its image.</p>`,
  },
  labs: [{ title: { es: "Sandbox de vórtices (método de blobs)", en: "Vortex sandbox (blob method)" }, desc: { es: "Usa los preajustes y luego cambia intensidades, separación y tamaño de núcleo.", en: "Use the presets, then change strengths, separation and core size." }, mount: sandboxLab }],
  interview: [
    { q: { es: "¿Cómo interactúan dos vórtices según su sentido e intensidad?", en: "How do two vortices interact depending on sense and strength?" }, a: { es: R`<p>Mismo sentido: orbitan alrededor del centro de vorticidad (Ω = (Γ₁+Γ₂)/2πd²); con núcleos grandes y cercanos se fusionan; si uno es mucho más débil, es estirado y destruido por el fuerte (stripping). Sentido contrario e igual intensidad: se trasladan juntos a Γ/2πd; si son desiguales describen trayectorias curvas alrededor de un punto lejano. Cerca de una pared, la imagen los hace desplazarse paralelos a ella y pueden generar vorticidad secundaria que los hace rebotar.</p>`, en: R`<p>Same sense: they orbit the centre of vorticity (Ω = (Γ₁+Γ₂)/2πd²); with large, close cores they merge; if one is much weaker it is strained and destroyed by the strong one (stripping). Opposite sense and equal strength: they translate together at Γ/2πd; unequal, they follow curved paths around a distant point. Near a wall, the image makes them move parallel to it and they can generate secondary vorticity that makes them rebound.</p>` } },
    { q: { es: "¿Por qué se dice que un vórtice más débil tiende a persistir más que uno fuerte?", en: "Why is it said that a weaker vortex tends to persist longer than a stronger one?" }, a: { es: R`<p>En el contexto de gradientes adversos (p. ej. un vórtice de suelo que entra en el difusor o pasa junto a un alerón): el breakdown depende de la relación swirl \(v_\theta/u_x\). Un vórtice muy intenso tiene swirl alto y está cerca del umbral, así que un pequeño aumento de presión aguas abajo lo hace estallar y pierde su núcleo coherente. Uno más débil soporta más gradiente adverso antes de estallar y mantiene su estructura (aunque produzca menos succión). Matiz: en interacción directa con otro vórtice fuerte, el débil sí puede ser destruido por stripping.</p>`, en: R`<p>In the context of adverse gradients (e.g. a floor vortex entering the diffuser or passing a wing): breakdown depends on the swirl ratio \(v_\theta/u_x\). A very intense vortex has high swirl and sits near the threshold, so a small downstream pressure rise makes it burst and lose its coherent core. A weaker one withstands more adverse gradient before bursting and keeps its structure (though giving less suction). Caveat: in direct interaction with a strong vortex, the weak one can be destroyed by stripping.</p>` } },
  ],
  myths: [
    { es: "«Los vórtices se atraen como imanes». No hay fuerza entre vórtices: cada uno es transportado por la velocidad que inducen los demás.", en: "“Vortices attract like magnets”. There is no force between vortices: each is carried by the velocity the others induce." },
    { es: "«Dos vórtices corrotantes siempre se fusionan». Solo por encima de un a/d crítico (o tras difusión viscosa suficiente).", en: "“Two co-rotating vortices always merge”. Only above a critical a/d (or after enough viscous diffusion)." },
  ],
  quiz: [
    { q: { es: "Dos vórtices de igual intensidad y sentido opuesto…", en: "Two vortices of equal strength and opposite sense…" }, options: [{ es: "giran uno alrededor del otro", en: "orbit each other" }, { es: "se trasladan juntos", en: "translate together" }, { es: "se fusionan", en: "merge" }, { es: "se quedan quietos", en: "stay still" }], correct: 1, explain: { es: "V = Γ/(2πd).", en: "V = Γ/(2πd)." } },
    { q: { es: "Un vórtice a altura h sobre el suelo se mueve…", en: "A vortex at height h above the ground moves…" }, options: [{ es: "hacia el suelo", en: "towards the ground" }, { es: "paralelo al suelo a Γ/(4πh)", en: "parallel to the ground at Γ/(4πh)" }, { es: "hacia arriba", en: "upwards" }, { es: "no se mueve", en: "does not move" }], correct: 1, explain: { es: "Lo induce su imagen a distancia 2h.", en: "Induced by its image at distance 2h." } },
  ],
  refs: [
    "P. Meunier, S. Le Dizès & T. Leweke, “Physics of vortex merging”, <i>C. R. Physique</i> 6 (2005).",
    "P.G. Saffman, <i>Vortex Dynamics</i>, ch. 7.",
    "G.-H. Cottet & P. Koumoutsakos, <i>Vortex Methods</i>, CUP, 2000.",
  ],
};
