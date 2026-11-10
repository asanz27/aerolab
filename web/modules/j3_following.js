import { slider, labLayout, readout, toggle, button, L, tr, el, canvasBox } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function followLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 220 });
  const plot = new Plot(ui.viz, { height: 260, xlabel: { es: "distancia al coche de delante [m]", en: "distance to the car ahead [m]" }, ylabel: { es: "fracción respecto a aire limpio", en: "fraction of clean-air value" }, ylim: [0.3, 1.02] });
  const presets = el("div", { class: "seg-row" });
  const sCd = slider({ label: { es: "C_D·A del coche de delante [m²]", en: "Leading car C_D·A [m²]" }, min: 0.8, max: 1.6, step: 0.05, value: 1.3, onInput: run });
  const sUp = slider({ label: { es: "Ángulo de la estela hacia arriba [°]", en: "Upward wake angle [°]" }, min: 0, max: 12, step: 0.5, value: 0, onInput: run });
  const sS = slider({ label: { es: "Sensibilidad del coche de detrás S", en: "Following-car sensitivity S" }, min: 1, max: 3, step: 0.1, value: 2.4, onInput: run });
  const sX = slider({ label: { es: "Distancia [m]", en: "Distance [m]" }, min: 5, max: 50, step: 1, value: 20, onInput: run });
  const tR = toggle({ label: { es: "Cifras publicadas (F1/FIA)", en: "Published figures (F1/FIA)" }, value: true, onInput: run });
  presets.append(
    button({ es: "Coches 2021", en: "2021 cars" }, () => ((sUp.value = 0), (sS.value = 2.4), run())),
    button({ es: "Coches 2022", en: "2022 cars" }, () => ((sUp.value = 8), (sS.value = 1.6), run()))
  );
  ui.controls.append(presets, sCd.el, sUp.el, sS.el, sX.el, tR.el);
  const roD = readout({ es: "Carga perdida", en: "Downforce lost" });
  const roR = readout({ es: "Resistencia (rebufo)", en: "Drag (slipstream)" });
  const roU = readout({ es: "Déficit de velocidad sentido", en: "Velocity deficit felt" });
  ui.readouts.append(roD.el, roR.el, roU.el);
  ui.note.innerHTML = L(
    R`Estela turbulenta 3D en campo lejano: \(u_d/U=0.6\,(C_DA/x^2)^{1/3}\), semiancho \(b=0.7\,(C_DA\,x)^{1/3}\); el centro sube \(x\tan\theta\). El coche de detrás siente \(u_d\,e^{-((z_c-z_f)/b)^2}\) y su carga escala como \((1-u)^{2S}\) (S &gt; 1 por la sensibilidad del alerón delantero y del suelo a la turbulencia y al ángulo del flujo). Los dos preajustes están calibrados con las cifras publicadas por la F1/FIA.`,
    R`Far-field 3D turbulent wake: \(u_d/U=0.6\,(C_DA/x^2)^{1/3}\), half-width \(b=0.7\,(C_DA\,x)^{1/3}\); the centre rises by \(x\tan\theta\). The follower feels \(u_d\,e^{-((z_c-z_f)/b)^2}\) and its downforce scales as \((1-u)^{2S}\) (S &gt; 1 for the front-wing and floor sensitivity to turbulence and flow angle). The two presets are calibrated against the figures published by F1/FIA.`
  );
  let last = null;
  const call = liveCall("follow", "car.following", 30);
  function run() {
    call({ cda_lead: sCd.value, upwash_deg: sUp.value, sensitivity: sS.value }, (r) => {
      last = r;
      const mk = [{ type: "vline", x: sX.value, color: cssVar("--fg-muted") }];
      const series = [
        { x: r.x, y: r.downforce_ratio, color: cssVar("--accent"), width: 2.6, label: { es: "carga del coche de detrás", en: "follower downforce" } },
        { x: r.x, y: r.drag_ratio, color: cssVar("--accent-2"), dash: [5, 4], label: { es: "resistencia (rebufo)", en: "drag (slipstream)" } },
      ];
      if (tR.value) {
        series.push({ x: r.reference["2021"].x, y: r.reference["2021"].loss.map((l) => 1 - l), color: cssVar("--bad"), pointsOnly: true, r: 6, label: { es: "publicado 2021", en: "published 2021" } });
        series.push({ x: r.reference["2022"].x, y: r.reference["2022"].loss.map((l) => 1 - l), color: cssVar("--good"), pointsOnly: true, r: 6, label: { es: "objetivo publicado 2022", en: "published 2022 target" } });
      }
      plot.set(series, mk);
      const k = r.x.findIndex((x) => x >= sX.value);
      roD.set((100 * (1 - r.downforce_ratio[k])).toFixed(0) + " %", r.downforce_ratio[k] < 0.75 ? "bad" : "good");
      roR.set((100 * (r.drag_ratio[k] - 1)).toFixed(0) + " %");
      roU.set((100 * r.deficit_felt[k]).toFixed(1) + " %");
      draw();
    });
  }
  function draw() {
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
    const xs = (x) => 40 + (x / 60) * (W - 60);
    const zs = (z) => H - 30 - z * 28;
    g.fillStyle = "#1f2937";
    g.fillRect(0, zs(0), W, H);
    // wake envelope
    g.fillStyle = "rgba(244,63,94,0.18)";
    g.beginPath();
    r.x.forEach((x, i) => g.lineTo(xs(x), zs(r.wake_centre[i] + 0.6 * r.wake_halfwidth[i])));
    for (let i = r.x.length - 1; i >= 0; i--) g.lineTo(xs(r.x[i]), zs(Math.max(0, r.wake_centre[i] - 0.6 * r.wake_halfwidth[i])));
    g.fill();
    g.strokeStyle = cssVar("--bad");
    g.setLineDash([5, 4]);
    g.beginPath();
    r.x.forEach((x, i) => (i ? g.lineTo(xs(x), zs(r.wake_centre[i])) : g.moveTo(xs(x), zs(r.wake_centre[i]))));
    g.stroke();
    g.setLineDash([]);
    const car = (x) => {
      g.fillStyle = cssVar("--body-stroke");
      g.fillRect(xs(x) - 22, zs(0.9), 44, 18);
      g.beginPath();
      g.arc(xs(x) - 14, zs(0.35), 7, 0, 7);
      g.arc(xs(x) + 14, zs(0.35), 7, 0, 7);
      g.fill();
    };
    car(0);
    car(sX.value);
    g.fillStyle = cssVar("--fg-muted");
    g.font = "11px Inter";
    g.fillText(tr({ es: "estela (vista lateral, escala vertical exagerada)", en: "wake (side view, vertical scale exaggerated)" }), 10, 16);
  }
  run();
}

export default {
  subtitle: {
    es: "Aire sucio: déficit de velocidad y turbulencia en la estela del coche de delante, pérdida de carga y rebufo, y por qué el reglamento de 2022 lanza la estela hacia arriba.",
    en: "Dirty air: velocity deficit and turbulence in the leading car's wake, downforce loss and slipstream, and why the 2022 rules throw the wake upwards.",
  },
  heroParams: { eps: 0.12, camber: 0.06, alpha: 5 },
  intuition: {
    es: R`<p>Un coche deja detrás una estela de aire lento, turbulento y con vórtices. El que le sigue respira ese aire: menos presión dinámica, flujo desalineado y turbulento. El alerón delantero y el suelo, diseñados para aire limpio, pierden carga (y desplazan el balance hacia atrás → subviraje), los neumáticos se calientan y no se puede adelantar en curva. En recta, en cambio, la menor velocidad del aire reduce la resistencia: el <span class="term">rebufo</span>.</p>
    <p>Hasta 2021 los coches lanzaban la estela baja y ancha (mucho outwash). El reglamento de 2022 rediseñó el coche para generar la carga con el suelo (efecto suelo) y lanzar la estela <b>hacia arriba</b>, por encima del coche de detrás ("estela en seta"), y redujo la sensibilidad de los coches al aire sucio. Las cifras publicadas: de ~35 % de carga perdida a 20 m (2021) a ~4 % (objetivo 2022).</p>`,
    en: R`<p>A car leaves behind a wake of slow, turbulent, vortical air. The follower breathes that air: lower dynamic pressure, misaligned and turbulent flow. The front wing and floor, designed for clean air, lose downforce (and the balance moves rearward → understeer), tyres overheat and overtaking in corners becomes impossible. On straights, instead, the slower air reduces drag: the <span class="term">slipstream</span> (tow).</p>
    <p>Until 2021 cars threw their wake low and wide (lots of outwash). The 2022 rules redesigned the car to generate downforce with the floor (ground effect) and throw the wake <b>upwards</b>, over the following car ("mushroom wake"), and reduced the cars' sensitivity to dirty air. Published figures: from ~35 % downforce lost at 20 m (2021) to ~4 % (2022 target).</p>`,
  },
  physics: {
    es: R`<p><b>Estela 3D lejana</b> (autosemejanza de una estela axisimétrica turbulenta, momento total = resistencia): $$\frac{u_d}{U}\propto\left(\frac{C_DA}{x^2}\right)^{1/3},\qquad b\propto(C_DA\,x)^{1/3}$$ El déficit decae despacio (\(x^{-2/3}\)): a varias longitudes de coche sigue siendo de varios por ciento.</p>
    <p><b>Coche de detrás</b>: presión dinámica \(q(1-u)^2\) más turbulencia y ángulo; las superficies muy cargadas (alerón delantero con picos de succión fuertes, bordes del suelo) son las más sensibles. La pérdida suele ser mayor delante → balance hacia atrás.</p>
    <p><b>Rebufo</b>: \(D_{seguidor}\approx D_0(1-u)^2\): menos resistencia y más velocidad punta. Con DRS se suma la reducción de resistencia propia.</p>`,
    en: R`<p><b>Far 3D wake</b> (self-similar turbulent axisymmetric wake, total momentum = drag): $$\frac{u_d}{U}\propto\left(\frac{C_DA}{x^2}\right)^{1/3},\qquad b\propto(C_DA\,x)^{1/3}$$ The deficit decays slowly (\(x^{-2/3}\)): several car lengths behind it is still a few per cent.</p>
    <p><b>Following car</b>: dynamic pressure \(q(1-u)^2\) plus turbulence and flow angle; highly loaded surfaces (front wing with strong suction peaks, floor edges) are the most sensitive. The loss is usually larger at the front → balance moves rearward.</p>
    <p><b>Slipstream</b>: \(D_{follower}\approx D_0(1-u)^2\): less drag and more top speed. DRS adds its own drag reduction.</p>`,
  },
  labs: [{ title: { es: "Siguiendo a otro coche: 2021 frente a 2022", en: "Following another car: 2021 versus 2022" }, desc: { es: "Cambia entre los preajustes y acerca el coche: compara con las cifras publicadas.", en: "Switch presets and get closer: compare with the published figures." }, mount: followLab }],
  interview: [
    { q: { es: "¿Por qué cuesta seguir a otro coche en curva?", en: "Why is it hard to follow another car through corners?" }, a: { es: R`<p>El coche de detrás está en la estela: aire con menos presión dinámica, turbulento y con ángulo distinto. Pierde carga (sobre todo el alerón delantero → subviraje), sus neumáticos deslizan y se calientan. La estela decae despacio (\(x^{-2/3}\)). El reglamento 2022 lanza la estela hacia arriba y hace la carga menos sensible (suelo de efecto suelo en vez de alerones muy cargados con outwash).</p>`, en: R`<p>The follower sits in the wake: air with lower dynamic pressure, turbulent and at a different angle. It loses downforce (especially the front wing → understeer), its tyres slide and overheat. The wake decays slowly (\(x^{-2/3}\)). The 2022 rules throw the wake upwards and make downforce less sensitive (ground-effect floor instead of heavily loaded outwash wings).</p>` } },
  ],
  myths: [
    { es: "«El aire sucio solo reduce la presión dinámica». También cambia el ángulo y la turbulencia, que afectan más a superficies muy cargadas: por eso la pérdida de carga es mayor que la pérdida de q.", en: "“Dirty air only reduces dynamic pressure”. It also changes angle and turbulence, which hit highly loaded surfaces harder: that is why the downforce loss exceeds the loss of q." },
  ],
  quiz: [
    { q: { es: "El déficit de velocidad en una estela 3D lejana decae como…", en: "The velocity deficit of a far 3D wake decays as…" }, options: [{ es: "x^(−1/2)", en: "x^(−1/2)" }, { es: "x^(−2/3)", en: "x^(−2/3)" }, { es: "e^(−x)", en: "e^(−x)" }, { es: "x^(−2)", en: "x^(−2)" }], correct: 1, explain: { es: "Estela axisimétrica autosemejante.", en: "Self-similar axisymmetric wake." } },
  ],
  refs: [
    "Formula 1 / FIA, presentations of the 2022 technical regulations (2019–2021): downforce retained when following.",
    "S.B. Pope, <i>Turbulent Flows</i>, §5.4 (wakes).",
    "J. Katz, <i>Race Car Aerodynamics</i> (drafting).",
  ],
};
