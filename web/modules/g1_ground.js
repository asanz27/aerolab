import { slider, labLayout, readout, toggle, segmented, L, tr, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { airfoilPanel } from "../js/core/airfoil_view.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function wing2dLab(host) {
  const ui = labLayout(host);
  const ap = airfoilPanel(ui.viz, { height: 270, plotHeight: 260, world: { x0: -0.35, x1: 1.4, y0: -0.4, y1: 0.45 } });
  const sMode = segmented({ label: { es: "Configuración", en: "Configuration" }, value: "down", onInput: run, options: [{ value: "down", label: { es: "Invertido (downforce, F1)", en: "Inverted (downforce, F1)" } }, { value: "up", label: { es: "Sustentando (avión aterrizando)", en: "Lifting (aircraft landing)" } }] });
  const sH = slider({ label: { es: "Altura al suelo h/c (desde el punto más bajo)", en: "Ground clearance h/c (from lowest point)" }, min: 0.04, max: 1.5, value: 0.2, log: true, format: (v) => v.toFixed(3), onInput: run });
  const sA = slider({ label: { es: "Incidencia [°] (positiva = más carga)", en: "Incidence [°] (positive = more load)" }, min: -2, max: 12, step: 0.5, value: 4, onInput: run });
  const tImg = toggle({ label: { es: "Mostrar perfil imagen", en: "Show image airfoil" }, value: true, onInput: run });
  const tV = toggle({ label: { es: "Mejora: interacción viscosa-no viscosa (VII)", en: "Upgrade: viscous-inviscid interaction (VII)" }, value: false, onInput: run });
  ui.controls.append(sMode.el, sH.el, sA.el, tImg.el, tV.el);
  const roC = readout({ es: "C carga/sustentación", en: "C load / lift" });
  const roF = readout({ es: "En aire libre", en: "In free air" });
  const roR = readout({ es: "Ganancia por efecto suelo", en: "Ground-effect gain" });
  const roS = readout({ es: "Separación (cara de succión)", en: "Separation (suction side)" }, "x/c");
  ui.readouts.append(roC.el, roF.el, roR.el, roS.el);
  ui.note.innerHTML = L(
    "Paneles + método de imágenes (suelo móvil, sin capa límite en el suelo) + capa límite en el perfil. La curva gris es el mismo perfil en aire libre. Perfil NACA 4412.",
    "Panels + image method (moving ground, no ground boundary layer) + boundary layer on the airfoil. The grey curve is the same airfoil in free air. NACA 4412."
  );
  const call = liveCall("g2d", "airfoil.analyze", 70);
  let free = null;
  function run() {
    const inv = sMode.value === "down";
    const spec = { code: "4412", n: 140, invert: inv };
    const alpha = inv ? -sA.value : sA.value;
    physics.latest("g2d-free", "airfoil.analyze", { spec, alpha, re: 3e6, vii: tV.value }).then((f) => {
      if (!f) return;
      free = f;
      call({ spec, alpha, re: 3e6, vii: tV.value, ground_h: sH.value, field: { x0: -0.35, x1: 1.4, y0: -0.4, y1: 0.45, nx: 100, ny: 56 } }, (r) => {
        ap.setCompare(free, { es: "aire libre", en: "free air" });
        const overlays = [];
        if (tImg.value) {
          overlays.push((g, v) => {
            const e = r.elements[0];
            g.strokeStyle = "rgba(148,163,184,0.45)";
            g.setLineDash([4, 4]);
            g.beginPath();
            e.x.forEach((x, i) => {
              const y = 2 * r.ground_y - e.y[i];
              i ? g.lineTo(v.X(x), v.Y(y)) : g.moveTo(v.X(x), v.Y(y));
            });
            g.closePath();
            g.stroke();
            g.setLineDash([]);
            g.fillStyle = cssVar("--fg-muted");
            g.font = "11px Inter";
            g.fillText(tr({ es: "imagen (circulación opuesta)", en: "image (opposite circulation)" }), v.X(1.0), v.Y(2 * r.ground_y - 0.02));
          });
        }
        ap.update(r, { overlays });
        const sgn = inv ? -1 : 1;
        roC.set((sgn * r.cl).toFixed(3));
        roF.set((sgn * free.cl).toFixed(3));
        roR.set(((r.cl / free.cl - 1) * 100).toFixed(0) + " %", "good");
        const e = r.elements[0];
        const xs = e.bl[e.suction].x_sep;
        roS.set(xs == null ? L("adherida", "attached") : xs.toFixed(2), xs == null ? "good" : xs < 0.8 ? "bad" : "warn");
      });
    });
  }
  run();
}

function sweepLab(host) {
  const ui = labLayout(host);
  const plot = new Plot(ui.viz, { height: 300, xlabel: { es: "h/c", en: "h/c" }, ylabel: { es: "C_downforce = −Cl", en: "C_downforce = −Cl" }, logX: true });
  const pS = new Plot(ui.viz, { height: 180, xlabel: { es: "h/c", en: "h/c" }, ylabel: { es: "x_sep/c (cara de succión)", en: "x_sep/c (suction side)" }, logX: true, ylim: [0.4, 1.02] });
  const sA = slider({ label: { es: "Incidencia [°]", en: "Incidence [°]" }, min: 0, max: 10, step: 0.5, value: 4, onInput: run });
  const tV = toggle({ label: { es: "Mejora: interacción viscosa-no viscosa (VII)", en: "Upgrade: viscous-inviscid interaction (VII)" }, value: false, onInput: run });
  const tR = toggle({ label: { es: "Zona del máximo medida (Zerihan & Zhang)", en: "Measured peak region (Zerihan & Zhang)" }, value: true, onInput: run });
  ui.controls.append(sA.el, tV.el, tR.el);
  ui.note.innerHTML = L(
    "Barrido de altura para el ala invertida. No viscoso (imágenes) frente a viscoso: modelo base (capa límite + sustentación viscosa + bloqueo del hueco) y, con la <b>mejora VII</b>, capa límite acoplada que desplaza el flujo (fuentes de transpiración). La VII frena mucho el crecimiento de la carga al bajar h porque la capa límite cada vez más gruesa de la cara de succión «estrecha» el canal y descurva el perfil. Por debajo del máximo, la capa de cortadura separada de la cara de succión <b>bloquea el hueco</b> bajo el borde de salida y anula la circulación extra que induce el suelo: es la «force reduction» de Zerihan & Zhang. La franja naranja es donde ellos midieron el máximo (ala 3D con endplates: en 2D el máximo es más alto, pero aparece a la misma h/c).",
    "Height sweep for the inverted wing. Inviscid (images) versus viscous: base model (boundary layer + viscous lift + gap blockage) and, with the <b>VII upgrade</b>, a coupled boundary layer that displaces the flow (transpiration sources). VII strongly damps the downforce growth as h drops because the ever-thicker suction-side boundary layer “narrows” the channel and decambers the section. Below the peak, the separated shear layer from the suction side <b>blocks the gap</b> under the trailing edge and cancels the extra circulation the ground induces: Zerihan & Zhang's “force reduction”. The orange band is where they measured the peak (a 3D wing with endplates: in 2D the peak is higher, but it occurs at the same h/c)."
  );
  const status = el("div", { class: "lab-note" });
  ui.controls.appendChild(status);
  function run() {
    const base = { spec: { code: "4412", invert: true, n: 120 }, alpha: -sA.value, re: 3e6 };
    status.innerHTML = tV.value ? L("Calculando con VII (≈ 5 s)…", "Computing with VII (≈ 5 s)…") : "";
    Promise.all([physics.latest("gsw", "airfoil.ground_sweep", base), tV.value ? physics.latest("gsw-v", "airfoil.ground_sweep", { ...base, vii: true }) : Promise.resolve(null)]).then(([r, rv]) => {
      if (!r) return;
      status.innerHTML = "";
      const d = (a) => a.map((v) => -v);
      const series = [
        { x: r.h, y: d(r.cl_inv), color: cssVar("--accent-3"), dash: [6, 4], points: true, label: { es: "no viscoso (imágenes)", en: "inviscid (images)" } },
        { x: r.h, y: d(r.cl), color: cssVar("--accent"), width: 2.8, points: true, label: { es: "viscoso (modelo base)", en: "viscous (base model)" } },
      ];
      if (rv) series.push({ x: rv.h, y: d(rv.cl), color: cssVar("--good"), width: 2.8, points: true, label: { es: "viscoso con VII", en: "viscous with VII" } });
      const mk = [{ type: "hline", y: -r.cl_free, color: cssVar("--fg-dim"), label: { es: "aire libre", en: "free air" } }];
      if (tR.value && r.reference) mk.unshift({ type: "band", x0: r.reference.h_peak_band[0], x1: r.reference.h_peak_band[1], color: "rgba(251,146,60,0.18)" });
      plot.set(series, mk);
      const sep = [{ x: r.h, y: r.x_sep.map((v) => (v == null ? 1 : v)), color: cssVar("--bad"), points: true, label: { es: "separación (base)", en: "separation (base)" } }];
      if (rv) sep.push({ x: rv.h, y: rv.x_sep.map((v) => (v == null ? 1 : v)), color: cssVar("--good"), points: true, label: { es: "separación (VII)", en: "separation (VII)" } });
      pS.set(sep);
    });
  }
  run();
}

function vlmLab(host) {
  const ui = labLayout(host);
  const plot = new Plot(ui.viz, { height: 260, xlabel: { es: "h / b (altura / envergadura)", en: "h / b (height / span)" }, ylabel: { es: "relativo al ala aislada", en: "relative to isolated wing" }, ylim: [0, 1.8] });
  const sAR = slider({ label: { es: "AR", en: "AR" }, min: 2, max: 10, step: 0.5, value: 6, onInput: run });
  ui.controls.append(sAR.el);
  ui.note.innerHTML = L(
    "VLM 3D con imagen (Python). Ala sustentadora acercándose al suelo: el vórtice imagen de los vórtices de punta reduce el downwash → más CL al mismo α y mucho menos CDi a igual CL.",
    "3D VLM with image (Python). Lifting wing approaching the ground: the image of the tip vortices reduces downwash → more CL at the same α and much less CDi at equal CL."
  );
  const call = liveCall("gvlm", "vlm.ground_sweep", 80);
  function run() {
    call({ AR: sAR.value, alpha: 5 }, (r) => {
      const k = r.CDi_free / (r.CL_free * r.CL_free);
      plot.set([
        { x: r.h, y: r.CL.map((c) => c / r.CL_free), color: cssVar("--accent"), width: 2.6, points: true, label: { es: "CL / CL∞ (mismo α)", en: "CL / CL∞ (same α)" } },
        { x: r.h, y: r.CDi.map((c, i) => c / (r.CL[i] * r.CL[i]) / k), color: cssVar("--good"), width: 2.6, points: true, label: { es: "CDi / CDi∞ (mismo CL)", en: "CDi / CDi∞ (same CL)" } },
      ], [{ type: "hline", y: 1, color: cssVar("--fg-dim") }]);
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Perfiles y alas cerca del suelo, en sustentación y en downforce: imagen, reducción del downwash, aumento de circulación, efecto Venturi y por qué la carga acaba cayendo.",
    en: "Airfoils and wings near the ground, lifting and in downforce: image, downwash reduction, increased circulation, Venturi effect and why downforce eventually collapses.",
  },
  heroParams: { eps: 0.1, camber: 0.08, alpha: 5 },
  intuition: {
    es: R`<p>El suelo es una pared por la que el aire no puede pasar. Matemáticamente se impone poniendo un <b>cuerpo imagen</b> simétrico bajo el suelo, con circulación opuesta: así la velocidad normal en el plano del suelo es nula. Todo lo que ocurre en efecto suelo se entiende mirando qué le hace la imagen al ala real.</p>
    <p><b>Ala que sustenta</b> (avión aterrizando, cara de presión hacia el suelo): (1) los vórtices imagen de los vórtices de punta inducen <b>upwash</b> en el ala → <b>se reduce el downwash</b> → más ángulo efectivo, más \(C_L\) y mucha menos resistencia inducida; (2) en 2D, el aire se "acumula" bajo el ala (efecto colchón) → más presión en el intradós.</p>
    <p><b>Ala invertida que genera downforce</b> (F1, cara de succión hacia el suelo): el aire entre ala y suelo se ve <b>confinado y acelerado</b> (efecto Venturi): el pico de succión crece muchísimo y la imagen <b>aumenta la circulación</b> del ala. La carga sube al bajar la altura... hasta que el gradiente adverso de la recuperación (cada vez más fuerte) hace <b>separar la capa límite</b> de la cara de succión: la carga deja de crecer, alcanza un máximo y <b>cae</b> (región de reducción de fuerza). En un coche, además, los vórtices de los bordes pueden estallar. Por eso un F1 es tan sensible a la altura y al cabeceo.</p>`,
    en: R`<p>The ground is a wall air cannot cross. Mathematically it is enforced with a symmetric <b>image body</b> below the ground carrying opposite circulation, so the normal velocity on the ground plane is zero. Everything in ground effect is understood by looking at what the image does to the real wing.</p>
    <p><b>Lifting wing</b> (aircraft landing, pressure side facing the ground): (1) the images of the tip vortices induce <b>upwash</b> on the wing → <b>downwash is reduced</b> → higher effective angle, more \(C_L\) and much less induced drag; (2) in 2D, air "piles up" under the wing (cushion effect) → more lower-surface pressure.</p>
    <p><b>Inverted wing making downforce</b> (F1, suction side facing the ground): air between wing and ground is <b>confined and accelerated</b> (Venturi effect): the suction peak grows enormously and the image <b>increases the wing's circulation</b>. Downforce rises as height drops... until the (ever stronger) adverse gradient of the recovery makes the suction-side <b>boundary layer separate</b>: downforce stops growing, peaks and <b>falls</b> (force-reduction region). On a car, edge vortices can also burst. That is why an F1 car is so sensitive to ride height and pitch.</p>`,
  },
  physics: {
    es: R`<p><b>Método de imágenes</b>: suelo en \(y=0\); cada vórtice \(\Gamma\) en \((x,h)\) tiene imagen \(-\Gamma\) en \((x,-h)\) ⇒ \(v(x,0)=0\). En 2D, un vórtice ligado a altura \(h\) recibe de su imagen una velocidad horizontal \(u=\Gamma/(4\pi h)\):</p>
    <ul><li>Ala sustentadora (\(\Gamma\) horaria, cara de presión abajo): la imagen <b>frena</b> el flujo bajo el ala → más presión en el intradós.</li>
    <li>Ala invertida (\(\Gamma\) antihoraria): la imagen <b>acelera</b> el flujo entre ala y suelo → más succión: efecto equivalente a un aumento de la circulación efectiva.</li></ul>
    <p><b>3D</b> (Wieselsberger): reducción del drag inducido $$\frac{C_{D_i,suelo}}{C_{D_i,\infty}}\approx\sigma(h/b)=\frac{1-1.32\,h/b}{1.05+7.4\,h/b}\quad(\text{aprox.})$$ por el upwash inducido por las imágenes de los vórtices de punta.</p>
    <p><b>Regímenes del ala invertida</b> (Zerihan & Zhang 2000; Zhang, Toet & Zerihan 2006), al reducir \(h/c\):</p>
    <ol><li><b>Aumento suave</b> de la carga (\(h/c\gtrsim0.5\)).</li><li><b>Aumento fuerte</b>, casi como \(1/h\): dominado por el efecto Venturi.</li><li><b>Máximo</b> de carga (\(h/c\sim0.08\)–0.1 según incidencia): la separación de la capa límite en la recuperación de la cara de succión limita el pico.</li><li><b>Reducción de carga</b>: la separación avanza, el vórtice de punta estalla, la región separada "bloquea" el canal. Puede haber histéresis.</li></ol>
    <p><b>Suelo de un F1</b>: canales Venturi (garganta + difusor). Sus laboratorios están en el módulo <a href="#/m/g2">G2 · Suelo y difusor de F1</a>. Carga ≈ \(-\int C_p\,dA\); menor altura → más velocidad en la garganta → más carga, hasta que la relación de áreas del difusor supera lo que la capa límite puede recuperar → separación → pérdida de carga y realimentación con la suspensión (porpoising).</p>
    <p><b>Túnel</b>: es imprescindible el <b>suelo móvil</b> (rolling road) y la succión de la capa límite del suelo; con suelo fijo, la capa límite del suelo reduce el hueco efectivo y falsea la curva.</p>`,
    en: R`<p><b>Image method</b>: ground at \(y=0\); each vortex \(\Gamma\) at \((x,h)\) has an image \(-\Gamma\) at \((x,-h)\) ⇒ \(v(x,0)=0\). In 2D a bound vortex at height \(h\) receives from its image a horizontal velocity \(u=\Gamma/(4\pi h)\):</p>
    <ul><li>Lifting wing (clockwise \(\Gamma\), pressure side down): the image <b>slows</b> the flow under the wing → more lower-surface pressure.</li>
    <li>Inverted wing (anticlockwise \(\Gamma\)): the image <b>accelerates</b> the flow between wing and ground → more suction: equivalent to an increase in effective circulation.</li></ul>
    <p><b>3D</b> (Wieselsberger): induced-drag reduction $$\frac{C_{D_i,ground}}{C_{D_i,\infty}}\approx\sigma(h/b)=\frac{1-1.32\,h/b}{1.05+7.4\,h/b}\quad(\text{approx.})$$ due to the upwash induced by the images of the tip vortices.</p>
    <p><b>Regimes of an inverted wing</b> (Zerihan & Zhang 2000; Zhang, Toet & Zerihan 2006), as \(h/c\) decreases:</p>
    <ol><li><b>Gentle increase</b> of downforce (\(h/c\gtrsim0.5\)).</li><li><b>Strong increase</b>, almost like \(1/h\): Venturi-dominated.</li><li><b>Maximum</b> downforce (\(h/c\sim0.08\)–0.1 depending on incidence): separation of the suction-side recovery limits the peak.</li><li><b>Force reduction</b>: separation moves forward, the tip vortex bursts, the separated region "blocks" the channel. Hysteresis is possible.</li></ol>
    <p><b>F1 floor</b>: Venturi channels (throat + diffuser). Its labs are in module <a href="#/m/g2">G2 · F1 floor and diffuser</a>. Downforce ≈ \(-\int C_p\,dA\); lower height → more throat velocity → more downforce, until the diffuser area ratio exceeds what the boundary layer can recover → separation → downforce loss and coupling with the suspension (porpoising).</p>
    <p><b>Tunnel</b>: a <b>moving ground</b> (rolling road) and ground boundary-layer suction are essential; with a fixed floor the ground boundary layer shrinks the effective gap and distorts the curve.</p>`,
  },
  labs: [
    { title: { es: "Perfil en efecto suelo: sustentando o invertido", en: "Airfoil in ground effect: lifting or inverted" }, desc: { es: "Baja h/c y compara el Cp con el de aire libre (gris). En modo invertido mira cómo crece el pico de succión bajo el ala y cómo avanza la separación.", en: "Lower h/c and compare Cp with free air (grey). In inverted mode watch the suction peak under the wing grow and separation creep forward." }, mount: wing2dLab },
    { title: { es: "Curva carga–altura del ala invertida", en: "Downforce–height curve of the inverted wing" }, mount: sweepLab },
    { title: { es: "Ala 3D cerca del suelo: downwash y drag inducido", en: "3D wing near the ground: downwash and induced drag" }, mount: vlmLab },
  ],
  interview: [
    { q: { es: "¿Qué pasa con la carga de un alerón invertido al acercarlo al suelo?", en: "What happens to an inverted wing's downforce as it approaches the ground?" }, a: { es: R`<p>Aumenta: el flujo entre ala y suelo se confina y acelera (Venturi), crece el pico de succión y la circulación (el vórtice imagen la refuerza); en 3D además se reduce el downwash/upwash inducido y el drag inducido. Primero crece suavemente, luego muy rápido, alcanza un máximo y a alturas muy bajas <b>cae</b>: el gradiente adverso de la recuperación en la cara de succión es tan fuerte que la capa límite separa (y los vórtices de punta pueden estallar). Hay sensibilidad a la altura e incluso histéresis.</p>`, en: R`<p>It increases: the flow between wing and ground is confined and accelerated (Venturi), the suction peak and circulation grow (the image vortex reinforces it); in 3D induced down/upwash and induced drag also drop. It first grows gently, then very fast, peaks and at very low heights <b>falls</b>: the adverse gradient of the suction-side recovery is so strong that the boundary layer separates (and tip vortices may burst). There is height sensitivity and even hysteresis.</p>` } },
    { q: { es: "¿Por qué un ala que sustenta tiene menos drag inducido cerca del suelo?", en: "Why does a lifting wing have less induced drag near the ground?" }, a: { es: R`<p>Porque el suelo obliga a que la velocidad vertical sea cero en su plano: equivale a vórtices imagen de signo opuesto bajo el suelo, que inducen upwash en el ala y <b>reducen el downwash</b> de los vórtices de punta. Menos downwash → menos inclinación de la fuerza → menos \(C_{D_i}\) y más ángulo efectivo (más \(C_L\)).</p>`, en: R`<p>Because the ground forces zero vertical velocity on its plane: equivalent to opposite-sign image vortices below the ground, which induce upwash on the wing and <b>reduce the downwash</b> of the tip vortices. Less downwash → less tilt of the force → lower \(C_{D_i}\) and higher effective angle (more \(C_L\)).</p>` } },
    { q: { es: "¿Por qué hace falta suelo móvil en el túnel?", en: "Why is a moving ground needed in the tunnel?" }, a: { es: R`<p>En pista el aire y el asfalto están en reposo relativo entre sí: no hay capa límite en el suelo (visto desde el coche, el suelo se mueve a la velocidad del aire). Con suelo fijo se forma una capa límite que reduce el hueco efectivo, cambia el flujo bajo el coche, los vórtices y la separación del difusor, y falsea la curva de carga frente a altura.</p>`, en: R`<p>On track air and road are at rest relative to each other: there is no ground boundary layer (seen from the car, the ground moves at air speed). With a fixed floor a boundary layer forms that shrinks the effective gap, changes underbody flow, vortices and diffuser separation, and distorts the downforce-versus-height curve.</p>` } },
  ],
  myths: [
    { es: "«Cuanto más cerca del suelo, siempre más carga». Hasta el máximo; después la separación (y el breakdown de vórtices) la reducen.", en: "“The closer to the ground, always more downforce”. Up to the peak; then separation (and vortex breakdown) reduces it." },
    { es: "«El efecto suelo es solo un efecto Venturi». También hay efecto de imagen sobre la circulación y, en 3D, reducción del downwash inducido.", en: "“Ground effect is just a Venturi effect”. There is also the image effect on circulation and, in 3D, reduced induced downwash." },
    { es: "«Un avión en efecto suelo tiene más sustentación porque el aire se comprime». Es incompresible: el aumento viene del cambio en el campo de velocidades (imagen).", en: "“An aircraft in ground effect gets more lift because air is compressed”. It is incompressible: the increase comes from the changed velocity field (image)." },
  ],
  quiz: [
    { q: { es: "En el método de imágenes, la imagen de un vórtice Γ a altura h es…", en: "In the image method, the image of a vortex Γ at height h is…" }, options: [{ es: "+Γ en −h", en: "+Γ at −h" }, { es: "−Γ en −h", en: "−Γ at −h" }, { es: "−Γ en +h", en: "−Γ at +h" }, { es: "una fuente", en: "a source" }], correct: 1, explain: { es: "Así v = 0 en el suelo.", en: "So that v = 0 on the ground." } },
    { q: { es: "La caída de carga a muy baja altura en un ala invertida se debe principalmente a…", en: "The downforce drop at very low height on an inverted wing is mainly due to…" }, options: [{ es: "compresibilidad", en: "compressibility" }, { es: "separación de la capa límite en la cara de succión", en: "suction-side boundary-layer separation" }, { es: "más drag inducido", en: "more induced drag" }, { es: "la gravedad", en: "gravity" }], correct: 1, explain: { es: "El gradiente adverso de la recuperación crece al bajar h.", en: "The recovery's adverse gradient grows as h drops." } },
    { q: { es: "Para un ala sustentadora, acercarse al suelo…", en: "For a lifting wing, approaching the ground…" }, options: [{ es: "aumenta el downwash", en: "increases downwash" }, { es: "reduce el downwash y el drag inducido", en: "reduces downwash and induced drag" }, { es: "no cambia nada", en: "changes nothing" }, { es: "invierte la sustentación", en: "reverses lift" }], correct: 1, explain: { es: "Upwash inducido por las imágenes.", en: "Upwash induced by the images." } },
  ],
  refs: [
    "J. Zerihan & X. Zhang, “Aerodynamics of a single element wing in ground effect”, <i>J. Aircraft</i> 37(6), 2000.",
    "X. Zhang, W. Toet & J. Zerihan, “Ground effect aerodynamics of race cars”, <i>Appl. Mech. Rev.</i> 59, 2006.",
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 4–7.",
    "C. Wieselsberger, “Wing resistance near the ground”, NACA TM-77 (1922).",
  ],
};
