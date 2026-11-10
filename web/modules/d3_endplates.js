import { slider, labLayout, readout, toggle, L, tr, canvasBox, el, engineBadge } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { physics } from "../js/bridge/physics.js";

const R = String.raw;

function endplateLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 220 });
  const wait = engineBadge(box);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pL = new Plot(row, { height: 230, xlabel: { es: "y / b", en: "y / b" }, ylabel: { es: "Γ local (circulación de la franja)", en: "local Γ (strip circulation)" } });
  const pE = new Plot(row, { height: 230, xlabel: { es: "altura de endplate h / b", en: "endplate height h / b" }, ylabel: { es: "e efectivo", en: "effective e" } });
  const sH = slider({ label: { es: "Altura del endplate h/b", en: "Endplate height h/b" }, min: 0, max: 0.4, step: 0.01, value: 0.15, onInput: run });
  const sAR = slider({ label: { es: "AR del alerón", en: "Wing AR" }, min: 1.5, max: 8, step: 0.5, value: 3, onInput: run });
  const sA = slider({ label: { es: "α [°]", en: "α [°]" }, min: 1, max: 12, step: 0.5, value: 6, onInput: run });
  const tG = toggle({ label: { es: "Cerca del suelo (h_suelo/b = 0.08)", en: "Near the ground (h_ground/b = 0.08)" }, value: false, onInput: run });
  ui.controls.append(sH.el, sAR.el, sA.el, tG.el);
  const roCL = readout({ es: "CL", en: "CL" });
  const roCD = readout({ es: "CDi", en: "CDi" });
  const roE = readout({ es: "e", en: "e" });
  const roG = readout({ es: "ΔCL por el endplate", en: "ΔCL from endplate" });
  ui.readouts.append(roCL.el, roCD.el, roE.el, roG.el);
  ui.note.innerHTML = L(
    "Vortex-lattice (Python): ala + dos placas verticales discretizadas también con herraduras; resistencia inducida en el plano de Trefftz. La recta discontinua es la estimación de Hoerner e ≈ 1 + 1.9 h/b.",
    "Vortex lattice (Python): wing + two vertical plates also discretised with horseshoes; induced drag in the Trefftz plane. The dashed line is Hoerner's estimate e ≈ 1 + 1.9 h/b."
  );
  let sweepCache = {};
  function run() {
    const base = { AR: sAR.value, alpha: sA.value, ns: 20, nc: 4, ground_h: tG.value ? 0.08 : null };
    Promise.all([physics.latest("ep-a", "vlm.wing", { ...base, endplate_h: 0 }), physics.latest("ep-b", "vlm.wing", { ...base, endplate_h: sH.value })]).then(([a, b]) => {
      if (!a || !b) return;
      wait.remove();
      pL.set([
        { x: a.span_y, y: a.span_gamma, color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "sin endplate", en: "no endplate" } },
        { x: b.span_y, y: b.span_gamma, color: cssVar("--accent"), width: 2.6, label: { es: `con endplate h/b = ${sH.value.toFixed(2)}`, en: `with endplate h/b = ${sH.value.toFixed(2)}` } },
      ]);
      roCL.set(b.CL.toFixed(3));
      roCD.set(b.CDi.toFixed(4));
      roE.set(b.e.toFixed(2), b.e > 1 ? "good" : "");
      roG.set(((b.CL / a.CL - 1) * 100).toFixed(1) + " %");
      drawFront(a, b);
    });
    const key = `${sAR.value}-${sA.value}`;
    const done = (s) => {
      sweepCache[key] = s;
      pE.set([
        { x: s.h, y: s.e, color: cssVar("--accent-3"), points: true, width: 2.4, label: { es: "VLM", en: "VLM" } },
        { x: s.h, y: s.hoerner_e, color: cssVar("--fg-dim"), dash: [5, 4], label: { es: "Hoerner 1 + 1.9 h/b", en: "Hoerner 1 + 1.9 h/b" } },
      ], [{ type: "vline", x: sH.value, color: cssVar("--accent") }]);
    };
    if (sweepCache[key]) done(sweepCache[key]);
    else physics.latest("ep-s", "vlm.endplate_sweep", { AR: sAR.value, alpha: sA.value }).then((s) => s && done(s));
  }
  function drawFront(a, b) {
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
    const sc = W * 0.8;
    const cx = W / 2, cy = H * 0.5;
    const h = sH.value * sc;
    g.fillStyle = cssVar("--fg-muted");
    g.font = "12px Inter";
    g.fillText(tr({ es: "vista frontal (mirando hacia delante desde atrás)", en: "front view (looking forward from behind)" }), 10, 18);
    if (tG.value) {
      g.fillStyle = "rgba(148,163,184,0.2)";
      g.fillRect(0, cy + 0.08 * sc, W, H);
    }
    g.strokeStyle = cssVar("--body-stroke");
    g.lineWidth = 5;
    g.beginPath();
    g.moveTo(cx - sc / 2, cy);
    g.lineTo(cx + sc / 2, cy);
    g.stroke();
    if (h > 0) {
      g.lineWidth = 4;
      for (const s of [-1, 1]) {
        g.beginPath();
        g.moveTo(cx + (s * sc) / 2, cy - h / 2);
        g.lineTo(cx + (s * sc) / 2, cy + h / 2);
        g.stroke();
      }
    }
    // trailing vortex positions (qualitative): at the tip without endplate, at the endplate corners with it
    const t = performance.now() / 300;
    const vort = (x, y, r, sense) => {
      g.strokeStyle = cssVar("--accent");
      g.lineWidth = 2;
      g.beginPath();
      g.arc(x, y, r, t * sense, t * sense + 4.5);
      g.stroke();
    };
    if (h === 0) {
      vort(cx - sc / 2, cy - 4, 16, -1);
      vort(cx + sc / 2, cy - 4, 16, 1);
    } else {
      for (const s of [-1, 1]) {
        vort(cx + (s * sc) / 2, cy - h / 2 - 4, 10, s);
        vort(cx + (s * sc) / 2, cy + h / 2 + 4, 8, -s);
      }
    }
    g.fillStyle = cssVar("--fg-muted");
    g.fillText(tr({ es: "con endplate: la carga llega más alta a la punta y los vórtices se reparten en las esquinas, más lejos entre sí", en: "with endplate: tip load stays higher and vortices split to the corners, further apart" }), 10, H - 10);
  }
  run();
}

export default {
  subtitle: {
    es: "Placas de extremo en alerones de competición: aumento del alargamiento efectivo, reparto de vórtices y su papel en la gestión de estelas de un F1.",
    en: "End plates on racing wings: higher effective aspect ratio, vortex redistribution and their role in managing an F1 car's wakes.",
  },
  heroParams: { eps: 0.1, camber: 0.1, alpha: 6 },
  intuition: {
    es: R`<p>Un alerón de coche de carreras tiene alargamiento pequeño (anchura limitada por el reglamento y cuerda grande para generar mucha carga). Sin nada en la punta, el aire de la cara de presión rodea la punta hacia la de succión, la carga cae a cero muy pronto y se forma un vórtice de punta intenso: mucho drag inducido y poca carga.</p>
    <p>Un <span class="term">endplate</span> es una pared que dificulta esa "fuga": la carga puede mantenerse alta hasta muy cerca de la punta (la condición de carga nula en la punta deja de aplicarse), el downwash se reduce y el ala se comporta como si tuviera más envergadura: <b>AR efectivo mayor</b>. La vorticidad no desaparece: se desprende ahora en los bordes superior e inferior de la placa, como dos vórtices más débiles y más separados. Además el endplate genera su propia resistencia de fricción y puede cargarse lateralmente.</p>
    <p>En un F1 moderno los endplates del <b>alerón delantero</b> sirven sobre todo para <b>gestionar la estela de la rueda delantera</b> (outwash/inwash) y generar vórtices que sellan el suelo; los del <b>trasero</b> controlan los vórtices de punta y la interacción con el beam wing y el difusor.</p>`,
    en: R`<p>A racing-car wing has low aspect ratio (width limited by the rules and large chord to make lots of downforce). With nothing at the tip, pressure-side air wraps around the tip to the suction side, the load drops to zero early and a strong tip vortex forms: lots of induced drag and less downforce.</p>
    <p>An <span class="term">endplate</span> is a wall that hinders that "leak": the load can remain high very close to the tip (the zero-tip-load condition no longer applies), downwash drops and the wing behaves as if it had more span: <b>higher effective AR</b>. Vorticity does not disappear: it is now shed at the plate's upper and lower edges, as two weaker, more widely spaced vortices. The endplate also adds its own friction drag and may carry side load.</p>
    <p>On a modern F1 car the <b>front-wing</b> endplates mainly <b>manage the front-wheel wake</b> (outwash/inwash) and create vortices that seal the floor; <b>rear-wing</b> endplates control tip vortices and the interaction with the beam wing and diffuser.</p>`,
  },
  physics: {
    es: R`<p><b>Eficiencia con endplates</b> (estimaciones clásicas): $$e_{ef}\approx1+1.9\,\frac{h}{b}\ \ (\text{Hoerner}),\qquad AR_{ef}\approx AR\left(1+1.9\frac hb\right)$$ válidas para \(h/b\lesssim0.4\). Un VLM con las placas como superficies sustentadoras captura además la carga lateral del endplate.</p>
    <p><b>Munk</b>: con una estela no plana (ala + placas) el óptimo ya no es la carga elíptica; la distribución óptima tiene carga finita en la punta.</p>
    <p><b>Carga del endplate</b>: la diferencia de presión entre la cara interior y exterior genera una fuerza lateral y su propia circulación; si el endplate tiene incidencia (toe), cambia la intensidad de los vórtices de sus bordes. Los cortes (<i>slots</i>) en el endplate se usan para debilitar o reposicionar el vórtice superior.</p>
    <p><b>Combinación con el suelo</b>: cerca del suelo el borde inferior del endplate y el suelo forman casi un canal cerrado: el ala aprovecha a la vez efecto suelo y sellado lateral, y la carga crece todavía más.</p>`,
    en: R`<p><b>Efficiency with endplates</b> (classic estimates): $$e_{eff}\approx1+1.9\,\frac{h}{b}\ \ (\text{Hoerner}),\qquad AR_{eff}\approx AR\left(1+1.9\frac hb\right)$$ valid for \(h/b\lesssim0.4\). A VLM modelling the plates as lifting surfaces also captures the endplate side load.</p>
    <p><b>Munk</b>: with a non-planar wake (wing + plates) the optimum is no longer elliptic; the optimal distribution has finite tip load.</p>
    <p><b>Endplate loading</b>: the pressure difference between inner and outer faces creates a side force and its own circulation; endplate incidence (toe) changes the strength of its edge vortices. Slots in the endplate are used to weaken or reposition the upper vortex.</p>
    <p><b>Combined with the ground</b>: near the ground the lower endplate edge and the ground form an almost closed channel: the wing gets ground effect and side sealing at once, and downforce grows further.</p>`,
  },
  labs: [{ title: { es: "Endplate en un alerón de AR bajo", en: "Endplate on a low-AR wing" }, desc: { es: "Sube la altura del endplate y observa cómo la carga deja de caer en la punta y e supera 1.", en: "Raise the endplate height and watch the load stop dropping at the tip and e exceed 1." }, mount: endplateLab }],
  interview: [
    { q: { es: "¿Qué efecto tiene un endplate en un alerón?", en: "What does an endplate do on a wing?" }, a: { es: R`<p>Limita la comunicación de presiones alrededor de la punta: mantiene la carga cerca de la punta, reduce el downwash, aumenta el AR efectivo (\(e>1\)) → más carga a igual α y menos resistencia inducida. Reparte la vorticidad en vórtices más débiles en sus esquinas. Coste: fricción, posible carga lateral y vórtices propios que hay que gestionar.</p>`, en: R`<p>It limits pressure communication around the tip: keeps load near the tip, reduces downwash, increases effective AR (\(e>1\)) → more downforce at the same α and less induced drag. It spreads vorticity into weaker vortices at its corners. Cost: friction, possible side load and its own vortices to manage.</p>` } },
    { q: { es: "En un F1, ¿para qué más sirve el endplate del alerón delantero?", en: "On an F1 car, what else is the front-wing endplate for?" }, a: { es: R`<p>Para dirigir el flujo alrededor de la rueda delantera (outwash: sacar la estela de la rueda fuera del suelo; con el reglamento 2022+ se busca más inwash/control de la estela), generar vórtices que sellen los bordes del suelo y condicionar todo el flujo aguas abajo. Su diseño se evalúa por su efecto en el coche completo, no solo en el alerón.</p>`, en: R`<p>To steer the flow around the front tyre (outwash: pushing the tyre wake away from the floor; with 2022+ rules more inwash/wake control), to create vortices that seal the floor edges and to condition the whole downstream flow. It is judged by its effect on the complete car, not just on the wing.</p>` } },
  ],
  myths: [
    { es: "«Un endplate infinitamente alto da un ala 2D sin drag inducido». Haría falta además que no hubiera huecos ni carga lateral; en la práctica e crece con h/b pero con rendimientos decrecientes y más fricción.", en: "“An infinitely tall endplate gives a 2D wing with no induced drag”. Only with no gaps and no side load; in practice e grows with h/b with diminishing returns and more friction." },
    { es: "«El endplate elimina los vórtices». Los redistribuye y debilita.", en: "“The endplate removes vortices”. It redistributes and weakens them." },
  ],
  quiz: [
    { q: { es: "Según Hoerner, un endplate con h/b = 0.2 da e ≈", en: "According to Hoerner, an endplate with h/b = 0.2 gives e ≈" }, options: [{ es: "0.8", en: "0.8" }, { es: "1.0", en: "1.0" }, { es: "1.38", en: "1.38" }, { es: "2.0", en: "2.0" }], correct: 2, explain: { es: "1 + 1.9·0.2 = 1.38.", en: "1 + 1.9·0.2 = 1.38." } },
    { q: { es: "Con endplate, la carga en la punta del ala…", en: "With an endplate, the load at the wing tip…" }, options: [{ es: "sigue siendo cero", en: "is still zero" }, { es: "puede ser finita", en: "can be finite" }, { es: "se invierte", en: "reverses" }, { es: "no cambia", en: "does not change" }], correct: 1, explain: { es: "La pared permite mantener diferencia de presión hasta el extremo.", en: "The wall lets the pressure difference survive up to the end." } },
  ],
  refs: [
    "S.F. Hoerner & H.V. Borst, <i>Fluid-Dynamic Lift</i>, 1985, ch. 3.",
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 5–6 (wings, endplates).",
    "J. Katz, “Aerodynamics of race cars”, <i>Annu. Rev. Fluid Mech.</i> 38 (2006).",
  ],
};
