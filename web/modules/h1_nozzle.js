import { slider, labLayout, readout, L, tr, el, canvasBox, engineBadge } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

const REGIMES = {
  no_flow: { es: "Sin flujo (p_b = p₀)", en: "No flow (p_b = p₀)" },
  subsonic: { es: "Subsónico en todo el conducto (Venturi, no bloqueado)", en: "Subsonic throughout (Venturi, unchoked)" },
  choked_subsonic: { es: "Bloqueado, divergente subsónico (M = 1 solo en la garganta)", en: "Choked, subsonic divergent (M = 1 only at throat)" },
  shock_in_nozzle: { es: "Bloqueado con choque normal en el divergente", en: "Choked with a normal shock in the divergent part" },
  shock_at_exit: { es: "Choque normal justo en la salida", en: "Normal shock exactly at the exit" },
  overexpanded: { es: "Sobreexpandida (p_e < p_b): choques oblicuos fuera", en: "Overexpanded (p_e < p_b): oblique shocks outside" },
  design: { es: "Condición de diseño (p_e = p_b)", en: "Design condition (p_e = p_b)" },
  underexpanded: { es: "Subexpandida (p_e > p_b): abanicos de expansión fuera", en: "Underexpanded (p_e > p_b): expansion fans outside" },
  choked_sonic_exit: { es: "Bloqueada con M = 1 en la salida (p_b = p*)", en: "Choked, M = 1 at the exit (p_b = p*)" },
  choked_underexpanded: { es: "Convergente bloqueada: subexpandida (expansión fuera)", en: "Convergent choked: underexpanded (expansion outside)" },
};

function machColor(M) {
  const t = Math.min(1, M / 3);
  const stops = [[0, [30, 64, 175]], [0.33, [34, 211, 238]], [0.34, [250, 250, 210]], [0.66, [251, 146, 60]], [1, [244, 63, 94]]];
  for (let i = 1; i < stops.length; i++)
    if (t <= stops[i][0]) {
      const [a, ca] = stops[i - 1], [b, cb] = stops[i];
      const f = (t - a) / (b - a || 1);
      return `rgb(${ca.map((c, k) => Math.round(c + (cb[k] - c) * f)).join(",")})`;
    }
  return "rgb(244,63,94)";
}

function nozzleLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 250 });
  const wait = engineBadge(box);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pP = new Plot(row, { height: 230, xlabel: { es: "x", en: "x" }, ylabel: { es: "p / p₀  ·  M", en: "p / p₀  ·  M" } });
  const pMap = new Plot(row, { height: 230, xlabel: { es: "p_b / p₀", en: "p_b / p₀" }, ylabel: { es: "ṁ / ṁ_bloqueo", en: "ṁ / ṁ_choked" }, xlim: [0, 1], ylim: [0, 1.1] });
  const sIn = slider({ label: { es: "Área de entrada A_in / A_t", en: "Inlet area A_in / A_t" }, min: 0.5, max: 4, step: 0.05, value: 2.5, onInput: run });
  const sE = slider({ label: { es: "Área de salida A_e / A_t", en: "Exit area A_e / A_t" }, min: 0.5, max: 4, step: 0.05, value: 2, onInput: run });
  const sPb = slider({ label: { es: "Contrapresión p_b / p₀", en: "Back pressure p_b / p₀" }, min: 0.01, max: 1, step: 0.002, value: 0.6, onInput: run });
  const sG = slider({ label: { es: "γ (cp/cv)", en: "γ (cp/cv)" }, min: 1.1, max: 1.67, step: 0.01, value: 1.4, onInput: run });
  ui.controls.append(sIn.el, sE.el, sPb.el, sG.el);
  const roR = readout({ es: "Régimen", en: "Regime" });
  const roM = readout({ es: "M salida", en: "Exit M" });
  const roS = readout({ es: "Choque", en: "Shock" });
  const roMd = readout({ es: "ṁ / ṁ_bloqueo", en: "ṁ / ṁ_choked" });
  ui.readouts.append(roR.el, roM.el, roS.el, roMd.el);
  ui.note.innerHTML = L(
    "Flujo cuasi-1D isentrópico + choque normal (Rankine-Hugoniot), resuelto en Python. Si A_in ≤ A_t la tobera es solo divergente; si A_e ≤ A_t, solo convergente. En la gráfica derecha, las líneas verticales son las presiones críticas: bloqueo, choque en la salida y diseño.",
    "Quasi-1D isentropic flow + normal shock (Rankine-Hugoniot), solved in Python. If A_in ≤ A_t the nozzle is purely divergent; if A_e ≤ A_t, purely convergent. On the right, vertical lines are the critical pressures: choking, shock at exit and design."
  );
  let last = null, map = null, mapKey = null;
  const call = liveCall("noz", "nozzle.solve", 30);
  function run() {
    const params = { A_in: sIn.value, A_t: 1, A_e: sE.value, p0: 500e3, T0: 300, pb: sPb.value * 500e3, gamma: sG.value };
    call(params, (r) => {
      wait.remove();
      last = r;
      draw(r);
      pP.set([
        { x: r.x, y: r.p.map((p) => p / 500e3), color: cssVar("--accent"), width: 2.6, label: { es: "p / p₀", en: "p / p₀" } },
        { x: r.x, y: r.M, color: cssVar("--accent-2"), width: 2.2, label: { es: "Mach", en: "Mach" } },
        { x: r.x, y: r.A.map((a) => a / Math.max(...r.A)), color: cssVar("--fg-dim"), dash: [4, 3], label: { es: "A / A_máx", en: "A / A_max" } },
      ], [{ type: "hline", y: sPb.value, color: cssVar("--fg-muted"), label: { es: "p_b", en: "p_b" } }, ...(r.shock_x != null ? [{ type: "vline", x: r.shock_x, color: cssVar("--bad"), label: { es: "choque", en: "shock" } }] : [])]);
      roR.set(L(REGIMES[r.regime].es, REGIMES[r.regime].en));
      roM.set(r.exit.M.toFixed(3));
      roS.set(r.shock ? `M₁=${r.shock.M1.toFixed(2)} → M₂=${r.shock.M2.toFixed(2)}, p₀₂/p₀₁=${r.shock.p02_p01.toFixed(3)}` : "–");
      roMd.set((r.mdot / r.mdot_choked).toFixed(3), r.mdot / r.mdot_choked > 0.999 ? "warn" : "");
      const key = `${sIn.value}|${sE.value}|${sG.value}`;
      const drawMap = () => pMap.set([{ x: map.pb_ratio, y: map.mdot.map((m) => m / r.mdot_choked), color: cssVar("--accent"), width: 2.4, label: { es: "gasto másico", en: "mass flow" } }], [
        { type: "vline", x: r.critical.choke, color: cssVar("--good"), label: { es: "bloqueo", en: "choke" } },
        { type: "vline", x: r.critical.shock_at_exit, color: cssVar("--bad"), label: { es: "choque en salida", en: "shock at exit" }, labelOffset: 14 },
        { type: "vline", x: r.critical.design, color: cssVar("--accent-3"), label: { es: "diseño", en: "design" }, labelOffset: 28 },
        { type: "point", x: sPb.value, y: r.mdot / r.mdot_choked, color: cssVar("--accent-2"), r: 6 },
      ]);
      if (key === mapKey && map) drawMap();
      else {
        mapKey = key;
        physics.latest("noz-map", "nozzle.map", { A_in: sIn.value, A_t: 1, A_e: sE.value, gamma: sG.value }).then((m) => {
          if (!m) return;
          map = m;
          drawMap();
        });
      }
    });
  }
  function draw(r) {
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
    const xmax = r.x[r.x.length - 1];
    const L0 = W * 0.68;
    const X = (x) => 20 + (x / xmax) * L0;
    const amax = Math.max(...r.A);
    const hs = (H * 0.38) / Math.sqrt(amax);
    const hw = (a) => Math.sqrt(a) * hs;
    const cy = H / 2;
    for (let i = 1; i < r.x.length; i++) {
      g.fillStyle = machColor(r.M[i]);
      const h = hw(r.A[i]);
      g.fillRect(X(r.x[i - 1]), cy - h, X(r.x[i]) - X(r.x[i - 1]) + 1, 2 * h);
    }
    g.strokeStyle = cssVar("--body-stroke");
    g.lineWidth = 3;
    for (const s of [-1, 1]) {
      g.beginPath();
      r.x.forEach((x, i) => (i ? g.lineTo(X(x), cy + s * hw(r.A[i])) : g.moveTo(X(x), cy + s * hw(r.A[i]))));
      g.stroke();
    }
    if (r.shock_x != null) {
      const h = hw(r.A[r.x.findIndex((x) => x >= r.shock_x)]);
      g.strokeStyle = cssVar("--fg");
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(X(r.shock_x), cy - h);
      g.lineTo(X(r.shock_x), cy + h);
      g.stroke();
    }
    // exit jet sketch (qualitative)
    const xe = X(xmax), he = hw(r.A[r.A.length - 1]);
    g.save();
    const reg = r.regime;
    g.strokeStyle = cssVar("--contour");
    g.lineWidth = 1.5;
    if (reg === "overexpanded" || reg === "underexpanded" || reg === "choked_underexpanded") {
      const over = reg === "overexpanded";
      let x0 = xe, h0 = he;
      for (let k = 0; k < 4; k++) {
        const len = he * 1.6;
        g.beginPath();
        g.moveTo(x0, cy - h0);
        g.lineTo(x0 + len, cy + (over ? -0.2 : 0.2) * h0 - (over ? 0 : 0));
        g.moveTo(x0, cy + h0);
        g.lineTo(x0 + len, cy - (over ? -0.2 : 0.2) * h0);
        g.stroke();
        g.fillStyle = "rgba(251,146,60,0.18)";
        g.beginPath();
        g.moveTo(x0, cy - h0 * (over ? 0.9 : 1.1));
        g.lineTo(x0 + len / 2, cy - h0 * (over ? 0.75 : 1.3));
        g.lineTo(x0 + len, cy - h0 * (over ? 0.9 : 1.1));
        g.lineTo(x0 + len, cy + h0 * (over ? 0.9 : 1.1));
        g.lineTo(x0 + len / 2, cy + h0 * (over ? 0.75 : 1.3));
        g.lineTo(x0, cy + h0 * (over ? 0.9 : 1.1));
        g.fill();
        x0 += len;
        h0 *= 0.92;
        if (x0 > W) break;
      }
      g.fillStyle = cssVar("--fg-muted");
      g.font = "11px Inter";
      g.fillText(tr(over ? { es: "choques oblicuos / diamantes", en: "oblique shocks / diamonds" } : { es: "abanicos de expansión", en: "expansion fans" }), xe + 6, cy + he + 18);
    } else {
      g.fillStyle = "rgba(34,211,238,0.12)";
      g.fillRect(xe, cy - he, W - xe, 2 * he);
    }
    g.restore();
    // Mach legend
    for (let i = 0; i < 120; i++) {
      g.fillStyle = machColor((i / 120) * 3);
      g.fillRect(W - 140 + i, 12, 1, 8);
    }
    g.fillStyle = cssVar("--fg-muted");
    g.font = "10px Inter";
    g.fillText("M=0", W - 140, 32);
    g.fillText("1", W - 101, 32);
    g.fillText("3", W - 24, 32);
  }
  run();
}

export default {
  subtitle: {
    es: "Toberas convergentes, divergentes y convergente-divergentes: área–Mach, bloqueo, choques normales y chorros sobre/subexpandidos en función de la contrapresión.",
    en: "Convergent, divergent and convergent-divergent nozzles: area–Mach, choking, normal shocks and over/underexpanded jets versus back pressure.",
  },
  heroParams: { eps: 0.15, camber: 0, alpha: 0 },
  intuition: {
    es: R`<p>En subsónico un conducto que se estrecha acelera el flujo (como el Venturi del módulo A1). En supersónico ocurre <b>lo contrario</b>: para acelerar hay que <b>ensanchar</b>. La razón es que a M &gt; 1 la densidad cae más deprisa de lo que crece la velocidad, así que para mantener el gasto \(\rho uA\) el área tiene que crecer. Por eso M = 1 solo puede alcanzarse en la sección mínima, la <span class="term">garganta</span>, y una tobera de Laval (convergente-divergente) es la única forma de pasar de subsónico a supersónico de forma continua.</p>
    <p>Lo que decide qué pasa es la <span class="term">contrapresión</span> \(p_b\). Bajándola desde \(p_0\): el gasto aumenta hasta que la garganta llega a M = 1 y la tobera se <b>bloquea</b> (<i>choked</i>): el gasto ya no aumenta por mucho que bajes \(p_b\), porque la información no puede remontar contra un flujo sónico. Más abajo aparece flujo supersónico en el divergente terminado en un <b>choque normal</b> que se mueve hacia la salida; después la tobera queda <b>sobreexpandida</b> (choques oblicuos fuera), luego en <b>diseño</b> y, por último, <b>subexpandida</b> (abanicos de expansión fuera).</p>
    <p class="callout warn">En un F1 el flujo es incompresible (M &lt; 0.3): este módulo es teoría general que puede caer en una entrevista técnica.</p>`,
    en: R`<p>In subsonic flow a narrowing duct accelerates the flow (like the Venturi of module A1). In supersonic flow <b>the opposite</b> happens: to accelerate you must <b>widen</b>. At M &gt; 1 density falls faster than velocity grows, so to keep the mass flow \(\rho uA\) the area must grow. That is why M = 1 can only be reached at the minimum section, the <span class="term">throat</span>, and a de Laval (convergent-divergent) nozzle is the only continuous way from subsonic to supersonic.</p>
    <p>What decides the outcome is the <span class="term">back pressure</span> \(p_b\). Lowering it from \(p_0\): mass flow grows until the throat reaches M = 1 and the nozzle <b>chokes</b>: mass flow no longer increases however much you lower \(p_b\), because information cannot travel upstream against sonic flow. Lower still, supersonic flow appears in the divergent part terminated by a <b>normal shock</b> that moves towards the exit; then the nozzle is <b>overexpanded</b> (oblique shocks outside), then at <b>design</b> and finally <b>underexpanded</b> (expansion fans outside).</p>
    <p class="callout warn">In F1 the flow is incompressible (M &lt; 0.3): this module is general theory that may come up in a technical interview.</p>`,
  },
  physics: {
    es: R`<p><b>Relación área–velocidad (Hugoniot)</b>: $$\frac{dA}{A}=(M^2-1)\frac{du}{u}$$ M &lt; 1: convergente acelera, divergente frena. M &gt; 1: al revés. M = 1 solo con \(dA=0\) (garganta).</p>
    <p><b>Isentrópicas</b>: $$\frac{T_0}{T}=1+\frac{\gamma-1}{2}M^2,\qquad \frac{p_0}{p}=\left(1+\frac{\gamma-1}{2}M^2\right)^{\frac{\gamma}{\gamma-1}},\qquad \frac{A}{A^*}=\frac1M\left[\frac{2}{\gamma+1}\left(1+\frac{\gamma-1}{2}M^2\right)\right]^{\frac{\gamma+1}{2(\gamma-1)}}$$ Presión crítica: \(p^*/p_0=0.528\) (γ = 1.4).</p>
    <p><b>Gasto bloqueado</b>: $$\dot m_{max}=\frac{p_0A^*}{\sqrt{T_0}}\sqrt{\frac{\gamma}{R}}\left(\frac{\gamma+1}{2}\right)^{-\frac{\gamma+1}{2(\gamma-1)}}$$ independiente de \(p_b\).</p>
    <p><b>Choque normal</b>: \(M_2^2=\dfrac{1+\frac{\gamma-1}{2}M_1^2}{\gamma M_1^2-\frac{\gamma-1}{2}}\), \(\dfrac{p_2}{p_1}=1+\dfrac{2\gamma}{\gamma+1}(M_1^2-1)\); pérdida de presión total \(p_{02}/p_{01}<1\) (aumento de entropía). Aguas abajo del choque el flujo subsónico vuelve a decelerar en el divergente con un nuevo \(A^*_2=A^*/(p_{02}/p_{01})\).</p>
    <p><b>Mapa de regímenes</b> de una C-D al bajar \(p_b/p_0\): (1) subsónico sin bloquear; (2) bloqueo con divergente subsónico (\(p_b=p_1\)); (3) choque normal dentro; (4) choque en la salida (\(p_b=p_3\)); (5) sobreexpandida: choques oblicuos fuera; (6) diseño (\(p_e=p_b\)); (7) subexpandida: expansión de Prandtl-Meyer fuera.</p>
    <p><b>Solo convergente</b>: máximo M = 1 en la salida; por debajo de \(p^*\) sale bloqueada y subexpandida. <b>Solo divergente</b> (difusor): en subsónico decelera y comprime; con entrada supersónica decelera con choque.</p>`,
    en: R`<p><b>Area–velocity relation (Hugoniot)</b>: $$\frac{dA}{A}=(M^2-1)\frac{du}{u}$$ M &lt; 1: convergent accelerates, divergent decelerates. M &gt; 1: the opposite. M = 1 only where \(dA=0\) (throat).</p>
    <p><b>Isentropic relations</b>: $$\frac{T_0}{T}=1+\frac{\gamma-1}{2}M^2,\qquad \frac{p_0}{p}=\left(1+\frac{\gamma-1}{2}M^2\right)^{\frac{\gamma}{\gamma-1}},\qquad \frac{A}{A^*}=\frac1M\left[\frac{2}{\gamma+1}\left(1+\frac{\gamma-1}{2}M^2\right)\right]^{\frac{\gamma+1}{2(\gamma-1)}}$$ Critical pressure: \(p^*/p_0=0.528\) (γ = 1.4).</p>
    <p><b>Choked mass flow</b>: $$\dot m_{max}=\frac{p_0A^*}{\sqrt{T_0}}\sqrt{\frac{\gamma}{R}}\left(\frac{\gamma+1}{2}\right)^{-\frac{\gamma+1}{2(\gamma-1)}}$$ independent of \(p_b\).</p>
    <p><b>Normal shock</b>: \(M_2^2=\dfrac{1+\frac{\gamma-1}{2}M_1^2}{\gamma M_1^2-\frac{\gamma-1}{2}}\), \(\dfrac{p_2}{p_1}=1+\dfrac{2\gamma}{\gamma+1}(M_1^2-1)\); total-pressure loss \(p_{02}/p_{01}<1\) (entropy rise). Downstream the subsonic flow decelerates again in the divergent part with a new \(A^*_2=A^*/(p_{02}/p_{01})\).</p>
    <p><b>Regime map</b> of a C-D nozzle as \(p_b/p_0\) drops: (1) subsonic unchoked; (2) choked with subsonic divergent (\(p_b=p_1\)); (3) normal shock inside; (4) shock at the exit (\(p_b=p_3\)); (5) overexpanded: oblique shocks outside; (6) design (\(p_e=p_b\)); (7) underexpanded: Prandtl-Meyer expansion outside.</p>
    <p><b>Convergent only</b>: maximum M = 1 at the exit; below \(p^*\) it is choked and underexpanded. <b>Divergent only</b> (diffuser): subsonic flow decelerates and compresses; supersonic inflow decelerates through a shock.</p>`,
  },
  labs: [{ title: { es: "Tobera configurable: regímenes en función de la contrapresión", en: "Configurable nozzle: regimes versus back pressure" }, desc: { es: "Baja p_b/p₀ lentamente desde 1 y recorre todos los regímenes. Luego haz A_e < A_t (convergente) o A_in < A_t (divergente).", en: "Lower p_b/p₀ slowly from 1 and go through every regime. Then set A_e < A_t (convergent) or A_in < A_t (divergent)." }, mount: nozzleLab }],
  interview: [
    { q: { es: "¿Por qué en supersónico una tobera divergente acelera el flujo?", en: "Why does a divergent nozzle accelerate supersonic flow?" }, a: { es: R`<p>De continuidad + cantidad de movimiento + isentrópica: \(dA/A=(M^2-1)du/u\). Con M &gt; 1, \(d\rho/\rho=-M^2du/u\): la densidad cae más rápido de lo que sube la velocidad, así que \(\rho u\) disminuye al acelerar y el área debe aumentar para conservar el gasto.</p>`, en: R`<p>From continuity + momentum + isentropic relations: \(dA/A=(M^2-1)du/u\). With M &gt; 1, \(d\rho/\rho=-M^2du/u\): density falls faster than velocity rises, so \(\rho u\) decreases as the flow accelerates and area must increase to conserve mass flow.</p>` } },
    { q: { es: "¿Qué significa que una tobera esté bloqueada (choked)?", en: "What does it mean for a nozzle to be choked?" }, a: { es: R`<p>Que la garganta ha alcanzado M = 1: el gasto es el máximo posible para esas \(p_0,T_0,A^*\) y ya no depende de la contrapresión, porque las perturbaciones de presión no pueden propagarse aguas arriba a través de la garganta sónica. Bajar más \(p_b\) solo cambia lo que ocurre aguas abajo (choques, expansión).</p>`, en: R`<p>The throat has reached M = 1: mass flow is the maximum possible for those \(p_0,T_0,A^*\) and no longer depends on back pressure, because pressure disturbances cannot propagate upstream through the sonic throat. Lowering \(p_b\) further only changes what happens downstream (shocks, expansion).</p>` } },
    { q: { es: "Describe cómo cambia el flujo en una C-D al bajar la contrapresión.", en: "Describe how the flow in a C-D nozzle changes as back pressure is lowered." }, a: { es: R`<p>Subsónico sin bloquear (Venturi) → bloqueo con M = 1 solo en garganta → supersónico en parte del divergente con choque normal, que se desplaza hacia la salida al bajar \(p_b\) → choque en la salida → sobreexpandida (\(p_e<p_b\), choques oblicuos y diamantes) → diseño (\(p_e=p_b\)) → subexpandida (\(p_e>p_b\), abanicos de expansión). A partir del bloqueo el gasto es constante.</p>`, en: R`<p>Subsonic unchoked (Venturi) → choked with M = 1 only at the throat → supersonic in part of the divergent section with a normal shock that moves towards the exit as \(p_b\) drops → shock at the exit → overexpanded (\(p_e<p_b\), oblique shocks and diamonds) → design (\(p_e=p_b\)) → underexpanded (\(p_e>p_b\), expansion fans). From choking onwards mass flow is constant.</p>` } },
  ],
  myths: [
    { es: "«Si bajo más la presión de salida sale más gas». No una vez bloqueada: el gasto queda fijado por la garganta.", en: "“If I lower the exit pressure more gas comes out”. Not once choked: the throat fixes the mass flow." },
    { es: "«Una tobera convergente puede dar flujo supersónico si la presión de salida es muy baja». Como máximo M = 1 en la salida; la expansión adicional ocurre fuera.", en: "“A convergent nozzle can deliver supersonic flow if the exit pressure is very low”. At most M = 1 at the exit; further expansion happens outside." },
    { es: "«El choque normal no tiene pérdidas porque conserva la energía». Conserva T₀ pero aumenta la entropía: p₀ cae.", en: "“A normal shock has no losses because energy is conserved”. T₀ is conserved but entropy rises: p₀ drops." },
  ],
  quiz: [
    { q: { es: "A/A* para M = 2 (γ = 1.4) es…", en: "A/A* for M = 2 (γ = 1.4) is…" }, options: [{ es: "1.000", en: "1.000" }, { es: "1.688", en: "1.688" }, { es: "2.000", en: "2.000" }, { es: "4.235", en: "4.235" }], correct: 1, explain: { es: "Tabla isentrópica.", en: "Isentropic table." } },
    { q: { es: "Presión crítica p*/p₀ para aire:", en: "Critical pressure p*/p₀ for air:" }, options: [{ es: "0.528", en: "0.528" }, { es: "0.634", en: "0.634" }, { es: "0.5", en: "0.5" }, { es: "0.893", en: "0.893" }], correct: 0, explain: { es: "(2/(γ+1))^(γ/(γ−1)).", en: "(2/(γ+1))^(γ/(γ−1))." } },
    { q: { es: "En una tobera sobreexpandida…", en: "In an overexpanded nozzle…" }, options: [{ es: "p_e > p_b", en: "p_e > p_b" }, { es: "p_e < p_b", en: "p_e < p_b" }, { es: "no hay flujo supersónico", en: "there is no supersonic flow" }, { es: "el gasto aumenta", en: "mass flow increases" }], correct: 1, explain: { es: "El chorro se recomprime mediante choques oblicuos fuera.", en: "The jet recompresses through oblique shocks outside." } },
  ],
  refs: [
    "J.D. Anderson, <i>Modern Compressible Flow</i>, 3rd ed., ch. 3 & 5.",
    "M.J. Zucker & O. Biblarz, <i>Fundamentals of Gas Dynamics</i>, Wiley.",
    "A.H. Shapiro, <i>The Dynamics and Thermodynamics of Compressible Fluid Flow</i>, vol. 1.",
  ],
};
