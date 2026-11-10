import { slider, labLayout, readout, toggle, L, tr, el, canvasBox, engineBadge } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { FlowView, cpColor } from "../js/core/field.js";
import { airfoilPanel } from "../js/core/airfoil_view.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function dataLab(host) {
  const ui = labLayout(host);
  const { box, canvas } = canvasBox(ui.viz, { height: 300 });
  const wait = engineBadge(box);
  ui.note.innerHTML = L(
    "Valores medidos por Fackrell & Harvey (1975) en una rueda aislada en contacto con un suelo móvil. La rotación reduce la sustentación y la resistencia: la capa límite de la parte superior, arrastrada contra la corriente, separa antes, y delante del contacto aparece el «jetting», con Cp > 1 medido.",
    "Values measured by Fackrell & Harvey (1975) on an isolated wheel in contact with a moving ground. Rotation reduces lift and drag: the boundary layer on top, dragged against the stream, separates earlier, and ahead of the contact patch “jetting” appears, with measured Cp > 1."
  );
  physics.call("reference.data", {}).then((d) => {
    wait.remove();
    const w = d.wheel;
    const draw = () => {
      const dpr = window.devicePixelRatio || 1;
      const W = box.clientWidth, H = box.clientHeight;
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      canvas.style.width = W + "px";
      canvas.style.height = H + "px";
      const g = canvas.getContext("2d");
      g.setTransform(dpr, 0, 0, dpr, 0, 0);
      g.fillStyle = cssVar("--panel-2");
      g.fillRect(0, 0, W, H);
      const groups = [["C_D", "cd"], ["C_L", "cl"]];
      const bw = W / 7;
      groups.forEach(([lab, k], i) => {
        const x0 = W * 0.18 + i * W * 0.4;
        [["stationary", cssVar("--fg-dim"), { es: "fija", en: "stationary" }], ["rotating", cssVar("--accent"), { es: "girando", en: "rotating" }]].forEach(([key, col, name], j) => {
          const v = w[key][k];
          const h = (v / 0.9) * (H - 70);
          const x = x0 + j * (bw + 8);
          g.fillStyle = col;
          g.fillRect(x, H - 40 - h, bw, h);
          g.fillStyle = cssVar("--fg");
          g.font = "bold 13px 'JetBrains Mono'";
          g.fillText(v.toFixed(2), x + 8, H - 48 - h);
          g.font = "11px Inter";
          g.fillStyle = cssVar("--fg-muted");
          g.fillText(tr(name), x + 4, H - 24);
        });
        g.fillStyle = cssVar("--fg");
        g.font = "bold 14px Inter";
        g.fillText(lab, x0 + bw - 8, 22);
      });
    };
    draw();
    new ResizeObserver(draw).observe(box);
    window.addEventListener("langchange", draw);
  });
}

function steeringLab(host) {
  const ui = labLayout(host);
  const ap = airfoilPanel(ui.viz, { height: 330, plotHeight: 1, world: { x0: -2.8, x1: 2.2, y0: -1.6, y1: 1.4 }, particles: 1000 });
  ap.plot.box.style.display = "none";
  const sA = slider({ label: { es: "Ángulo del endplate / álabe [°] (+ = outwash)", en: "Endplate / vane angle [°] (+ = outwash)" }, min: -20, max: 25, step: 1, value: 10, onInput: run });
  ui.controls.append(sA.el);
  const roA = readout({ es: "Ángulo del flujo ante la rueda", en: "Flow angle ahead of the tyre" }, "°");
  const roS = readout({ es: "Punto de remanso (y)", en: "Stagnation point (y)" });
  ui.readouts.append(roA.el, roS.el);
  ui.note.innerHTML = L(
    "Vista en planta (2D): el álabe representa el endplate del alerón delantero y el círculo, la rueda delantera; el coche queda hacia abajo. Un álabe con outwash desvía el flujo hacia fuera y desplaza el remanso de la rueda: la estela del neumático se aleja del suelo del coche. Paneles 2D sin estela del neumático (que es 3D y separada): sirve para ver la dirección del flujo, no la estela.",
    "Plan view (2D): the vane represents the front-wing endplate and the circle the front tyre; the car is towards the bottom. An outwash vane turns the flow outboard and moves the tyre's stagnation point: the tyre wake is pushed away from the floor. 2D panels without the (3D, separated) tyre wake: it shows the flow direction, not the wake."
  );
  const call = liveCall("steer", "car.tyre_steering", 60);
  function run() {
    call({ vane_angle: sA.value, field: { x0: -2.8, x1: 2.2, y0: -1.6, y1: 1.4, nx: 110, ny: 66 } }, (r) => {
      ap.update(r, {
        bl: false,
        overlays: [
          (g, v) => {
            g.fillStyle = "#fbbf24";
            g.beginPath();
            g.arc(v.X(r.stagnation[0]), v.Y(r.stagnation[1]), 6, 0, 7);
            g.fill();
            g.fillStyle = cssVar("--fg-muted");
            g.font = "11px Inter";
            g.fillText(tr({ es: "↓ hacia el centro del coche", en: "↓ towards the car centre-line" }), 10, v.H - 10);
            g.fillText(tr({ es: "rueda", en: "tyre" }), v.X(0.55), v.Y(0.45));
            g.fillText(tr({ es: "endplate", en: "endplate" }), v.X(-1.9), v.Y(-0.45));
          },
        ],
      });
      roA.set(r.flow_angle_deg.toFixed(1));
      roS.set(r.stagnation[1].toFixed(3));
    });
  }
  run();
}

function rotationLab(host) {
  const ui = labLayout(host);
  const fv = new FlowView(ui.viz, { height: 300, world: { x0: -1.6, x1: 1.8, y0: -0.05, y1: 1.4 }, particles: 900, speed: 0.004 });
  const wait = engineBadge(fv.box);
  const tR = toggle({ label: { es: "Rueda girando (circulación inducida por la rotación)", en: "Rotating wheel (rotation-induced circulation)" }, value: false, onInput: run });
  const sG = slider({ label: { es: "Holgura con el suelo / D", en: "Ground clearance / D" }, min: 0.08, max: 0.5, step: 0.01, value: 0.15, onInput: run });
  ui.controls.append(tR.el, sG.el);
  const roC = readout({ es: "C_L potencial (ilustrativo)", en: "Potential C_L (illustrative)" });
  ui.readouts.append(roC.el);
  ui.note.innerHTML = L(
    "Flujo potencial 2D (paneles + suelo móvil) de una rueda con holgura. Con rotación se añade una circulación antihoraria (la parte superior se mueve contra la corriente): el flujo se frena arriba y se acelera abajo, desplazando los remansos. Es una ilustración del sentido del efecto, no una predicción: en contacto real la física es 3D, viscosa y separada (ver datos).",
    "2D potential flow (panels + moving ground) around a wheel with a gap. Rotation adds anticlockwise circulation (the top moves against the stream): the flow slows on top and speeds up below, moving the stagnation points. It illustrates the sense of the effect, not a prediction: in real contact the physics is 3D, viscous and separated (see data)."
  );
  const call = liveCall("whl", "car.wheel", 50);
  function run() {
    call({ gap: sG.value, rotate: tR.value, field: { x0: -1.6, x1: 1.8, y0: 0.0, y1: 1.4, nx: 100, ny: 46 } }, (r) => {
      wait.remove();
      fv.setBodies([{ x: r.x, y: r.y }]);
      fv.setField(r.field, { reseed: !fv.field });
      fv.setScalar({ x: r.field.x, y: r.field.y, values: r.field.u.map((row, j) => row.map((u, i) => (u == null ? null : 1 - u * u - r.field.v[j][i] ** 2))), map: (v) => cpColor(v, -3, 1), alpha: 130 });
      fv.setOverlays([(g, v) => {
        g.fillStyle = "#1f2937";
        g.fillRect(0, v.Y(0), v.W, v.H - v.Y(0));
      }]);
      roC.set(r.cl_potential.toFixed(2));
    });
  }
  run();
}

export default {
  subtitle: {
    es: "Ruedas expuestas: rueda fija frente a girando, jetting en el contacto, estela del neumático y cómo el alerón delantero la dirige (outwash/inwash).",
    en: "Exposed wheels: stationary versus rotating, contact-patch jetting, tyre wake and how the front wing steers it (outwash/inwash).",
  },
  heroParams: { eps: 0.25, camber: 0.0, alpha: 0 },
  intuition: {
    es: R`<p>Las cuatro ruedas de un F1 son cuerpos romos, giratorios y en contacto con el suelo: generan alrededor del 30–40 % de la resistencia del coche y una estela enorme y turbulenta. Que giren importa: la parte superior se mueve <b>contra</b> la corriente y la capa límite separa antes, la estela sube y la rueda tiene menos sustentación y menos resistencia que una fija. Delante del contacto con el suelo, el aire queda atrapado entre la goma y el asfalto que convergen y sale disparado lateralmente: el <span class="term">jetting</span>, con presiones por encima de la de remanso de la corriente libre (Cp &gt; 1 medido).</p>
    <p>La estela del neumático delantero es el mayor "contaminante" del suelo: si entra bajo el coche destruye la succión. Por eso el alerón delantero y su endplate se diseñan para <b>dirigirla</b>: <span class="term">outwash</span> (sacarla hacia fuera, típico hasta 2021) o un control más contenido (<span class="term">inwash</span> controlado con el reglamento de 2022, para no ensuciar al coche de detrás).</p>`,
    en: R`<p>An F1 car's four wheels are bluff, rotating bodies in contact with the ground: they produce about 30–40 % of the car's drag and a huge turbulent wake. Rotation matters: the top moves <b>against</b> the stream so the boundary layer separates earlier, the wake rises, and the wheel has less lift and less drag than a stationary one. Ahead of the contact patch the air is trapped between converging rubber and road and squirts out sideways: <span class="term">jetting</span>, with pressures above free-stream stagnation (Cp &gt; 1 measured).</p>
    <p>The front-tyre wake is the floor's main "contaminant": if it gets under the car it destroys suction. That is why the front wing and its endplate are designed to <b>steer</b> it: <span class="term">outwash</span> (pushing it outboard, typical until 2021) or more contained control (controlled <span class="term">inwash</span> with the 2022 rules, to avoid dirtying the following car).</p>`,
  },
  physics: {
    es: R`<p><b>Datos clásicos</b> (Fackrell & Harvey 1975, rueda aislada sobre suelo móvil): fija \(C_D\approx0.77,\ C_L\approx0.76\); girando \(C_D\approx0.58,\ C_L\approx0.44\). La rotación adelanta la separación en la parte superior y reduce la región de alta velocidad de arriba.</p>
    <p><b>Jetting</b>: entre la rueda que gira y el suelo que se mueve, las dos superficies convergen hacia el contacto y arrastran aire por viscosidad; sin salida longitudinal, el aire se expulsa lateralmente y la presión delante del contacto supera \(q_\infty\) (\(C_p>1\)). Detrás del contacto ocurre lo contrario (succión).</p>
    <p><b>Estela</b>: dominada por los vórtices que se desprenden de los hombros del neumático y del contacto con el suelo, muy sensible a la deformación de la goma, al giro de dirección y a la guiñada. Los <i>wheel wake control devices</i> (carenados, deflectores de los frenos, endplates) intentan fijar dónde va.</p>
    <p><b>Modelado</b>: en CFD se impone velocidad de giro en la llanta (MRF o malla rotatoria en los radios) y suelo móvil; en túnel, ruedas giratorias sobre la cinta, con brazos de sujeción que interfieren.</p>`,
    en: R`<p><b>Classic data</b> (Fackrell & Harvey 1975, isolated wheel on a moving ground): stationary \(C_D\approx0.77,\ C_L\approx0.76\); rotating \(C_D\approx0.58,\ C_L\approx0.44\). Rotation advances separation on the top and shrinks the high-velocity region above.</p>
    <p><b>Jetting</b>: between the rotating wheel and the moving ground both surfaces converge towards the contact and drag air by viscosity; with no longitudinal exit the air is expelled sideways and the pressure ahead of the contact exceeds \(q_\infty\) (\(C_p>1\)). Behind the contact the opposite happens (suction).</p>
    <p><b>Wake</b>: dominated by vortices shed from the tyre shoulders and the contact patch, very sensitive to tyre deformation, steering and yaw. <i>Wheel wake control devices</i> (fairings, brake-duct deflectors, endplates) try to fix where it goes.</p>
    <p><b>Modelling</b>: CFD imposes rim rotation (MRF or sliding mesh for the spokes) and a moving ground; in the tunnel, wheels rotate on the belt, held by struts that interfere.</p>`,
  },
  labs: [
    { title: { es: "Rueda fija frente a girando (datos publicados)", en: "Stationary versus rotating wheel (published data)" }, mount: dataLab },
    { title: { es: "El endplate dirige la estela del neumático (vista en planta)", en: "The endplate steers the tyre wake (plan view)" }, mount: steeringLab },
    { title: { es: "Efecto de la rotación (ilustración potencial 2D)", en: "Effect of rotation (2D potential illustration)" }, mount: rotationLab },
  ],
  interview: [
    { q: { es: "¿En qué se diferencia una rueda girando de una fija?", en: "How does a rotating wheel differ from a stationary one?" }, a: { es: R`<p>Girando, la parte superior se mueve contra la corriente: la capa límite separa antes, la zona de alta velocidad arriba se reduce y la rueda tiene menos sustentación (≈0.44 frente a 0.76) y menos resistencia (≈0.58 frente a 0.77). En el contacto aparece el jetting (Cp &gt; 1 delante). Por eso túneles y CFD deben girar las ruedas y mover el suelo.</p>`, en: R`<p>Rotating, the top moves against the stream: the boundary layer separates earlier, the high-velocity region on top shrinks and the wheel has less lift (≈0.44 vs 0.76) and less drag (≈0.58 vs 0.77). Jetting appears at the contact (Cp &gt; 1 ahead). That is why tunnels and CFD must rotate the wheels and move the ground.</p>` } },
    { q: { es: "¿Por qué importa tanto la estela de la rueda delantera?", en: "Why does the front-wheel wake matter so much?" }, a: { es: R`<p>Es baja presión total y turbulenta; si entra bajo el suelo o junto al borde del suelo, rompe el sellado y reduce la succión del canal Venturi. El alerón delantero (endplates, flaps exteriores) la dirige hacia fuera (outwash) o la controla; con el reglamento 2022 se limitó el outwash para no perjudicar al coche de detrás.</p>`, en: R`<p>It is low total pressure and turbulent; if it enters under the floor or near the floor edge it breaks the sealing and reduces Venturi suction. The front wing (endplates, outer flaps) steers it outboard (outwash) or controls it; the 2022 rules limited outwash so as not to hurt the following car.</p>` } },
  ],
  myths: [
    { es: "«Una rueda girando genera sustentación negativa por efecto Magnus». Sigue teniendo sustentación positiva (≈0.44), solo menor que fija.", en: "“A rotating wheel makes negative lift by the Magnus effect”. It still has positive lift (≈0.44), just less than stationary." },
  ],
  quiz: [
    { q: { es: "Según Fackrell & Harvey, la rotación…", en: "According to Fackrell & Harvey, rotation…" }, options: [{ es: "aumenta C_L y C_D", en: "increases C_L and C_D" }, { es: "reduce C_L y C_D", en: "reduces C_L and C_D" }, { es: "no cambia nada", en: "changes nothing" }, { es: "invierte C_L", en: "reverses C_L" }], correct: 1, explain: { es: "≈0.76→0.44 y 0.77→0.58.", en: "≈0.76→0.44 and 0.77→0.58." } },
    { q: { es: "El jetting es…", en: "Jetting is…" }, options: [{ es: "succión delante del contacto", en: "suction ahead of the contact" }, { es: "sobrepresión (Cp > 1) delante del contacto y expulsión lateral", en: "overpressure (Cp > 1) ahead of the contact and lateral ejection" }, { es: "un vórtice de punta", en: "a tip vortex" }, { es: "la estela superior", en: "the upper wake" }], correct: 1, explain: { es: "Aire atrapado entre superficies que convergen.", en: "Air trapped between converging surfaces." } },
  ],
  refs: [
    "J.E. Fackrell & J.K. Harvey, “The aerodynamics of an isolated road wheel”, Proc. 2nd AIAA Symposium on the Aerodynamics of Sports and Competition Automobiles, 1975.",
    "J. McManus & X. Zhang, “A computational study of the flow around an isolated wheel in contact with the ground”, <i>J. Fluids Eng.</i> 128, 2006.",
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 9 (wheels).",
  ],
};
