import { slider, labLayout, readout, toggle, L, tr, el, canvasBox } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function coolingLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 200 });
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pQ = new Plot(row, { height: 240, xlabel: { es: "área de salida [m²]", en: "exit area [m²]" }, ylabel: { es: "calor disipado [kW]", en: "heat rejected [kW]" } });
  const pD = new Plot(row, { height: 240, xlabel: { es: "área de salida [m²]", en: "exit area [m²]" }, ylabel: { es: "resistencia de refrigeración [N]", en: "cooling drag [N]" } });
  const sV = slider({ label: { es: "Velocidad [m/s]", en: "Speed [m/s]" }, min: 20, max: 95, step: 1, value: 70, onInput: run });
  const sIn = slider({ label: { es: "Área de entrada [m²]", en: "Inlet area [m²]" }, min: 0.015, max: 0.08, step: 0.001, value: 0.04, onInput: run });
  const sE = slider({ label: { es: "Área de salida [m²]", en: "Exit area [m²]" }, min: 0.01, max: 0.08, step: 0.001, value: 0.03, onInput: run });
  const sK = slider({ label: { es: "Pérdida del radiador K", en: "Radiator loss K" }, min: 4, max: 30, step: 0.5, value: 12, onInput: run });
  const sCp = slider({ label: { es: "Cp en la salida", en: "Exit Cp" }, min: -0.8, max: 0.2, step: 0.01, value: -0.3, onInput: run });
  const tM = toggle({ label: { es: "Efecto Meredith (el aire caliente sale más rápido)", en: "Meredith effect (hot air leaves faster)" }, value: true, onInput: run });
  ui.controls.append(sV.el, sIn.el, sE.el, sK.el, sCp.el, tM.el);
  const roM = readout({ es: "Gasto másico", en: "Mass flow" }, "kg/s");
  const roQ = readout({ es: "Calor disipado", en: "Heat rejected" }, "kW");
  const roD = readout({ es: "Resistencia de refrigeración", en: "Cooling drag" }, "N");
  const roC = readout({ es: "C_D·A de refrigeración", en: "Cooling C_D·A" }, "m²");
  const roR = readout({ es: "Relación de velocidad de entrada", en: "Inlet velocity ratio" });
  ui.readouts.append(roM.el, roQ.el, roD.el, roC.el, roR.el);
  ui.note.innerHTML = L(
    R`Conducto 1D: presión total de entrada (ideal) = presión de salida + presión dinámica de salida + pérdida del radiador \(K\tfrac12\rho u_r^2\). Gasto por continuidad, calor \(Q=\dot m c_p\Delta T_{aire}\) y resistencia por déficit de cantidad de movimiento \(D=\dot m(V-u_e)-(p_e-p_\infty)A_e\). La salida en zona de baja presión (Cp &lt; 0) «tira» del aire: más caudal con menos entrada.`,
    R`1D duct: inlet total pressure (ideal) = exit pressure + exit dynamic pressure + radiator loss \(K\tfrac12\rho u_r^2\). Mass flow from continuity, heat \(Q=\dot m c_p\Delta T_{air}\) and drag from the momentum deficit \(D=\dot m(V-u_e)-(p_e-p_\infty)A_e\). An exit in a low-pressure region (Cp &lt; 0) “pulls” the air: more flow with a smaller inlet.`
  );
  let last = null;
  const call = liveCall("cool", "car.cooling", 40);
  function run() {
    call({ V: sV.value, A_in: sIn.value, A_exit: sE.value, K: sK.value, cp_exit: sCp.value, meredith: tM.value }, (r) => {
      last = r;
      pQ.set([{ x: r.sweep.A_exit, y: r.sweep.Q_kW, color: cssVar("--accent-2"), width: 2.6, label: { es: "Q", en: "Q" } }], [{ type: "vline", x: sE.value, color: cssVar("--fg-muted") }]);
      pD.set([{ x: r.sweep.A_exit, y: r.sweep.drag_N, color: cssVar("--accent"), width: 2.6, label: { es: "D", en: "D" } }], [{ type: "vline", x: sE.value, color: cssVar("--fg-muted") }]);
      roM.set(r.mdot.toFixed(2));
      roQ.set(r.Q_kW.toFixed(1));
      roD.set(r.drag_N.toFixed(1));
      roC.set(r.CDA_cooling.toFixed(3));
      roR.set(r.inlet_velocity_ratio.toFixed(2));
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
    const cy = H / 2;
    const sc = 900;
    const hIn = Math.sqrt(sIn.value) * sc / 3, hR = Math.sqrt(0.12) * sc / 3, hE = Math.sqrt(sE.value) * sc / 3;
    const x = [40, W * 0.25, W * 0.45, W * 0.6, W * 0.85];
    const hh = [hIn, hR, hR, hR, hE];
    g.strokeStyle = cssVar("--body-stroke");
    g.lineWidth = 3;
    for (const s of [-1, 1]) {
      g.beginPath();
      x.forEach((xx, i) => (i ? g.lineTo(xx, cy + s * hh[i]) : g.moveTo(xx, cy + s * hh[i])));
      g.stroke();
    }
    g.fillStyle = "rgba(251,146,60,0.35)";
    g.fillRect(x[2], cy - hR, x[3] - x[2], 2 * hR);
    g.fillStyle = cssVar("--fg");
    g.font = "12px Inter";
    g.fillText(tr({ es: "radiador", en: "radiator" }), x[2] + 6, cy + 4);
    g.fillStyle = cssVar("--fg-muted");
    g.fillText(`V = ${sV.value} m/s`, 10, 16);
    g.fillText(`u_rad = ${r.u_rad.toFixed(1)} m/s`, x[1], cy - hR - 8);
    g.fillText(`u_salida = ${r.u_exit.toFixed(1)} m/s`, x[4] - 60, cy - hE - 8);
  }
  run();
}

export default {
  subtitle: {
    es: "Flujos internos: cuánto aire hay que meter por los pontones para disipar el calor, cuánto cuesta en resistencia y por qué dónde sale el aire importa tanto como dónde entra.",
    en: "Internal flows: how much air must go through the sidepods to reject heat, what it costs in drag and why where the air exits matters as much as where it enters.",
  },
  heroParams: { eps: 0.12, camber: 0.05, alpha: 3 },
  intuition: {
    es: R`<p>El motor, la batería y la electrónica de un F1 disipan cientos de kW en radiadores dentro de los pontones. El aire entra por una boca, se frena mucho antes del radiador (para que la pérdida de carga, \(\propto u^2\), sea pequeña), atraviesa el núcleo y sale por las salidas de la carrocería. Todo el aire que entra y sale más lento de lo que llegó es <b>resistencia de refrigeración</b>.</p>
    <p>El diseño tiene dos palancas: <b>cuánto</b> aire (área de entrada/salida) y <b>dónde</b> sale. Si la salida está en una zona de baja presión (Cp negativo), "succiona" el aire y se consigue el caudal con una entrada más pequeña. Además, el aire calentado se expande y sale más rápido: recupera parte de la resistencia (efecto Meredith, pequeño a velocidades de F1 pero no nulo). Abrir o cerrar la carrocería según el circuito y la temperatura es un compromiso directo entre refrigeración y tiempo por vuelta.</p>`,
    en: R`<p>An F1 car's engine, battery and electronics reject hundreds of kW through radiators inside the sidepods. Air enters through an inlet, is strongly slowed before the radiator (so the pressure loss, \(\propto u^2\), stays small), crosses the core and leaves through the bodywork exits. All the air that enters and leaves slower than it arrived is <b>cooling drag</b>.</p>
    <p>Design has two levers: <b>how much</b> air (inlet/exit area) and <b>where</b> it exits. If the exit sits in a low-pressure region (negative Cp) it "sucks" the air and the flow is achieved with a smaller inlet. Also, heated air expands and leaves faster: it recovers part of the drag (Meredith effect, small at F1 speeds but not zero). Opening or closing the bodywork per circuit and temperature is a direct trade between cooling and lap time.</p>`,
  },
  physics: {
    es: R`<p><b>Balance de presión total</b> (entrada ideal): $$p_\infty+\tfrac12\rho V^2=p_e+\tfrac12\rho_eu_e^2+K\tfrac12\rho u_r^2,\qquad \rho u_rA_r=\rho_eu_eA_e$$ \(K\) es el coeficiente de pérdida del núcleo referido a su velocidad.</p>
    <p><b>Calor</b>: \(Q=\dot m\,c_p\,\Delta T_{aire}\), con \(\Delta T_{aire}=\varepsilon\,(T_{refrigerante}-T_\infty)\).</p>
    <p><b>Resistencia</b>: \(D=\dot m(V-u_e)-(p_e-p_\infty)A_e\) (déficit de cantidad de movimiento); con aire caliente \(\rho_e<\rho\Rightarrow u_e\uparrow\Rightarrow D\downarrow\) (Meredith).</p>
    <p><b>Diseño</b>: radiador grande y lento (poca pérdida), difusor de entrada sin separar, salida en zona de succión y bien orientada para no perjudicar al suelo/beam wing.</p>`,
    en: R`<p><b>Total-pressure balance</b> (ideal inlet): $$p_\infty+\tfrac12\rho V^2=p_e+\tfrac12\rho_eu_e^2+K\tfrac12\rho u_r^2,\qquad \rho u_rA_r=\rho_eu_eA_e$$ \(K\) is the core loss coefficient referred to its own velocity.</p>
    <p><b>Heat</b>: \(Q=\dot m\,c_p\,\Delta T_{air}\), with \(\Delta T_{air}=\varepsilon\,(T_{coolant}-T_\infty)\).</p>
    <p><b>Drag</b>: \(D=\dot m(V-u_e)-(p_e-p_\infty)A_e\) (momentum deficit); with hot air \(\rho_e<\rho\Rightarrow u_e\uparrow\Rightarrow D\downarrow\) (Meredith).</p>
    <p><b>Design</b>: large, slow radiator (low loss), inlet diffuser that does not separate, exit in a suction region and well oriented so as not to hurt the floor/beam wing.</p>`,
  },
  labs: [{ title: { es: "Conducto de refrigeración: calor frente a resistencia", en: "Cooling duct: heat versus drag" }, mount: coolingLab }],
  interview: [
    { q: { es: "¿Cómo reducirías la resistencia de refrigeración sin perder capacidad?", en: "How would you reduce cooling drag without losing capacity?" }, a: { es: R`<p>Frenar el aire antes del radiador (radiador grande, pérdida \(\propto u_r^2\) pequeña), sacar el aire en una zona de baja presión para necesitar menos entrada, evitar separaciones internas en el difusor de entrada, recuperar velocidad en la salida (tobera, Meredith) y adaptar las salidas al circuito y la temperatura.</p>`, en: R`<p>Slow the air before the radiator (large radiator, small \(\propto u_r^2\) loss), exhaust in a low-pressure region so a smaller inlet suffices, avoid internal separation in the inlet diffuser, recover exit velocity (nozzle, Meredith) and adapt exits to circuit and temperature.</p>` } },
  ],
  myths: [
    { es: "«Más entrada = más refrigeración». El caudal lo fija todo el circuito de presiones (salida y radiador); una entrada grande con salida mala solo derrama aire (spillage) y añade resistencia.", en: "“Bigger inlet = more cooling”. Mass flow is set by the whole pressure circuit (exit and radiator); a big inlet with a poor exit just spills air and adds drag." },
  ],
  quiz: [
    { q: { es: "Poner la salida en una zona de Cp más negativo…", en: "Placing the exit in a more negative Cp region…" }, options: [{ es: "reduce el caudal", en: "reduces mass flow" }, { es: "aumenta el caudal", en: "increases mass flow" }, { es: "no influye", en: "has no effect" }, { es: "bloquea el radiador", en: "blocks the radiator" }], correct: 1, explain: { es: "Aumenta la diferencia de presión que mueve el aire.", en: "It increases the pressure difference driving the air." } },
  ],
  refs: [
    "F.W. Meredith, “Cooling of aircraft engines with special reference to ethylene glycol radiators enclosed in ducts”, ARC R&M 1683, 1935.",
    "W.-H. Hucho (ed.), <i>Aerodynamics of Road Vehicles</i>, 4th ed., SAE, 1998, ch. on cooling airflow.",
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 11 (internal flows).",
  ],
};
