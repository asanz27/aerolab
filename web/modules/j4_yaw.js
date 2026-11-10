import { slider, labLayout, readout, L, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function yawLab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pF = new Plot(row, { height: 260, xlabel: { es: "guiñada β [°]", en: "yaw β [°]" }, ylabel: { es: "carga relativa a β = 0", en: "downforce relative to β = 0" }, ylim: [0.5, 1.05] });
  const pS = new Plot(row, { height: 260, xlabel: { es: "guiñada β [°]", en: "yaw β [°]" }, ylabel: { es: "coeficientes del alerón", en: "wing coefficients" } });
  const sB = slider({ label: { es: "β para las lecturas [°]", en: "β for readouts [°]" }, min: 0, max: 8, step: 1, value: 4, onInput: run });
  const sE = slider({ label: { es: "Altura de endplate del alerón trasero h/b", en: "Rear-wing endplate height h/b" }, min: 0, max: 0.4, step: 0.05, value: 0.25, onInput: run });
  ui.controls.append(sB.el, sE.el);
  const roF = readout({ es: "Carga del suelo (relativa)", en: "Floor downforce (relative)" });
  const roW = readout({ es: "Borde de barlovento", en: "Windward edge" });
  const roY = readout({ es: "Fuerza lateral del alerón C_Y", en: "Wing side force C_Y" });
  const roR = readout({ es: "Desequilibrio de balanceo del suelo", en: "Floor roll imbalance" });
  ui.readouts.append(roF.el, roW.el, roY.el, roR.el);
  ui.note.innerHTML = L(
    "Suelo: modelo quasi-3D de G2 en el que la guiñada debilita el vórtice del borde de barlovento (pierde sellado hasta β ≈ 6°) y refuerza algo el de sotavento (semiempírico). Alerón trasero: VLM con endplates y viento lateral (fuerza lateral, ligera pérdida de C_L).",
    "Floor: G2's quasi-3D model where yaw weakens the windward edge vortex (sealing lost up to β ≈ 6°) and slightly strengthens the leeward one (semi-empirical). Rear wing: VLM with endplates and crosswind (side force, slight C_L loss)."
  );
  const callS = liveCall("yawS", "car.yaw_sweep", 60);
  const callP = liveCall("yawP", "car.yaw", 60);
  function run() {
    callS({ endplate_h: sE.value }, (r) => {
      const cl0 = r.CL[0];
      pF.set([
        { x: r.beta, y: r.floor_ratio, color: cssVar("--accent"), width: 2.6, points: true, label: { es: "suelo (media)", en: "floor (mean)" } },
        { x: r.beta, y: r.floor_windward, color: cssVar("--bad"), dash: [5, 4], label: { es: "mitad de barlovento", en: "windward half" } },
        { x: r.beta, y: r.roll_imbalance, color: cssVar("--warn"), dash: [2, 3], width: 2, label: { es: "desequilibrio de balanceo", en: "roll imbalance" } },
        { x: r.beta, y: r.CL.map((c) => c / cl0), color: cssVar("--accent-2"), width: 2.2, label: { es: "alerón trasero", en: "rear wing" } },
      ], [{ type: "vline", x: sB.value, color: cssVar("--fg-muted") }]);
      pS.set([
        { x: r.beta, y: r.CY, color: cssVar("--accent-3"), width: 2.4, points: true, label: { es: "C_Y (lateral)", en: "C_Y (side)" } },
        { x: r.beta, y: r.Cyaw, color: cssVar("--good"), width: 2, label: { es: "C_n (guiñada)", en: "C_n (yaw moment)" } },
      ]);
    });
    callP({ beta: sB.value, endplate_h: sE.value }, (p) => {
      roF.set(p.floor.floor_ratio.toFixed(3), p.floor.floor_ratio < 0.85 ? "bad" : "");
      roW.set(p.floor.windward.toFixed(3));
      roY.set(p.CY.toFixed(3));
      roR.set((100 * p.floor.roll_imbalance).toFixed(1) + " %");
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Viento lateral y deslizamiento en curva: pérdida de sellado del suelo en el lado de barlovento, fuerza lateral y momentos.",
    en: "Crosswind and sideslip in corners: loss of floor sealing on the windward side, side force and moments.",
  },
  heroParams: { eps: 0.1, camber: 0.06, alpha: 5 },
  intuition: {
    es: R`<p>En curva el coche no va perfectamente alineado con el aire: tiene un ángulo de deslizamiento (y además puede haber viento lateral). Con <span class="term">guiñada</span>, un lado del coche "mira" al viento (barlovento) y el otro queda a sotavento. En el suelo, el aire lateral entra por el borde de barlovento y debilita el vórtice que lo sellaba: el suelo pierde succión justo cuando el piloto más la necesita, y además de forma asimétrica (momento de balanceo y cambio de balance).</p>
    <p>Los alerones y endplates generan fuerza lateral y momentos de guiñada. Un buen diseño mantiene la carga y el balance estables en guiñada (los ingenieros miden mapas con barridos de β en el túnel).</p>`,
    en: R`<p>In corners the car is not perfectly aligned with the air: it runs at a slip angle (and there may be crosswind). In <span class="term">yaw</span>, one side of the car faces the wind (windward) and the other is leeward. On the floor, crossflow enters through the windward edge and weakens the vortex that sealed it: the floor loses suction exactly when the driver needs it most, and asymmetrically (rolling moment and balance change).</p>
    <p>Wings and endplates generate side force and yawing moments. A good design keeps downforce and balance stable in yaw (engineers measure maps with β sweeps in the tunnel).</p>`,
  },
  physics: {
    es: R`<p><b>Ejes</b>: \(\beta\) = ángulo entre la velocidad relativa del aire y el eje del coche. Coeficientes: fuerza lateral \(C_Y\), momento de guiñada \(C_n\), de balanceo \(C_l\).</p>
    <p><b>Endplates</b> como alas verticales de bajo AR a incidencia \(\beta\): \(C_Y\approx a_{ep}\,\beta\,S_{ep}/S\). El VLM los resuelve junto con el ala.</p>
    <p><b>Suelo</b>: la fuga lateral depende del sellado de los bordes; con \(\beta\) el borde de barlovento recibe flujo cruzado que rompe su vórtice (modelo: intensidad efectiva \(\times(1-\beta/\beta_c)\)). La carga media cae y aparece un desequilibrio izquierda-derecha.</p>`,
    en: R`<p><b>Axes</b>: \(\beta\) = angle between the relative air velocity and the car axis. Coefficients: side force \(C_Y\), yawing moment \(C_n\), rolling moment \(C_l\).</p>
    <p><b>Endplates</b> as low-AR vertical wings at incidence \(\beta\): \(C_Y\approx a_{ep}\,\beta\,S_{ep}/S\). The VLM solves them together with the wing.</p>
    <p><b>Floor</b>: lateral leakage depends on edge sealing; with \(\beta\) the windward edge receives crossflow that breaks its vortex (model: effective strength \(\times(1-\beta/\beta_c)\)). Mean downforce drops and a left-right imbalance appears.</p>`,
  },
  labs: [{ title: { es: "Guiñada: suelo y alerón trasero", en: "Yaw: floor and rear wing" }, mount: yawLab }],
  interview: [
    { q: { es: "¿Qué le pasa a un coche de efecto suelo en guiñada?", en: "What happens to a ground-effect car in yaw?" }, a: { es: R`<p>El borde de barlovento del suelo recibe flujo cruzado que debilita su vórtice de sellado: entra aire lateral, cae la succión de ese lado y la carga total; aparece un desequilibrio de balanceo y cambia el balance. Los endplates y alerones generan fuerza lateral y momentos. Por eso se miden mapas en guiñada y se busca un coche poco sensible.</p>`, en: R`<p>The floor's windward edge receives crossflow that weakens its sealing vortex: side air enters, suction on that side and total downforce drop; a roll imbalance appears and the balance changes. Endplates and wings generate side force and moments. That is why yaw maps are measured and a low-sensitivity car is sought.</p>` } },
  ],
  myths: [
    { es: "«La guiñada solo produce fuerza lateral». También reduce y desequilibra la carga, sobre todo la del suelo.", en: "“Yaw only produces side force”. It also reduces and unbalances downforce, especially from the floor." },
  ],
  quiz: [
    { q: { es: "En guiñada, el borde del suelo más afectado es…", en: "In yaw, the most affected floor edge is…" }, options: [{ es: "el de sotavento", en: "the leeward one" }, { es: "el de barlovento", en: "the windward one" }, { es: "ninguno", en: "neither" }, { es: "el trasero", en: "the rear one" }], correct: 1, explain: { es: "Recibe el flujo cruzado que rompe su vórtice.", en: "It receives the crossflow that breaks its vortex." } },
  ],
  refs: [
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 10 (yaw, crosswind).",
    "X. Zhang, W. Toet & J. Zerihan, “Ground effect aerodynamics of race cars”, <i>Appl. Mech. Rev.</i> 59, 2006.",
  ],
};
