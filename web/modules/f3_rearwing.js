import { slider, labLayout, readout, toggle, L, tr, el } from "../js/core/ui.js";
import { Plot, cssVar } from "../js/core/plot.js";
import { airfoilPanel } from "../js/core/airfoil_view.js";
import { physics, liveCall } from "../js/bridge/physics.js";

const R = String.raw;

function rearWingLab(host) {
  const ui = labLayout(host);
  const ap = airfoilPanel(ui.viz, { height: 300, plotHeight: 230, world: { x0: -1.4, x1: 2.8, y0: -2.2, y1: 0.9 } });
  const sM = slider({ label: { es: "Ángulo del plano principal [°]", en: "Main-plane angle [°]" }, min: 0, max: 18, step: 0.5, value: 4, onInput: run });
  const sF = slider({ label: { es: "Ángulo del flap [°]", en: "Flap angle [°]" }, min: 10, max: 45, step: 1, value: 25, onInput: run });
  const sD = slider({ label: { es: "Apertura DRS [°] (rotación del flap)", en: "DRS opening [°] (flap rotation)" }, min: 0, max: 30, step: 1, value: 0, onInput: run });
  const tB = toggle({ label: { es: "Beam wing", en: "Beam wing" }, value: true, onInput: run });
  const sB = slider({ label: { es: "Ángulo del beam wing [°]", en: "Beam-wing angle [°]" }, min: 0, max: 16, step: 0.5, value: 8, onInput: run });
  const tV = toggle({ label: { es: "Mejora: interacción viscosa-no viscosa (VII)", en: "Upgrade: viscous-inviscid interaction (VII)" }, value: false, onInput: run });
  ui.controls.append(sM.el, sF.el, sD.el, tB.el, sB.el, tV.el);
  const roDF = readout({ es: "Carga alerón 3D (C_L)", en: "3D wing downforce (C_L)" });
  const roCD = readout({ es: "C_D alerón (perfil + inducida)", en: "Wing C_D (profile + induced)" });
  const roLD = readout({ es: "Eficiencia L/D", en: "Efficiency L/D" });
  const roCp = readout({ es: "Cp en la salida del difusor", en: "Cp at the diffuser exit" });
  const roFl = readout({ es: "Flap", en: "Flap" });
  ui.readouts.append(roDF.el, roCD.el, roLD.el, roCp.el, roFl.el);
  ui.note.innerHTML = L(
    "Sección 2D (paneles multielemento + capa límite) del alerón trasero invertido de dos elementos y del beam wing. La resistencia 3D añade la inducida con lifting line (AR = 3, endplates: e ≈ 1.5). En un alerón muy cargado y de bajo alargamiento la inducida domina (L/D ≈ 4–7 es típico de un alerón trasero); el flap cuenta como separado si lo está más del 15 % de su cuerda. El punto amarillo es la salida del difusor: el upwash/succión del beam wing baja su Cp, es decir, la presión de base del suelo (extracción).",
    "2D section (multi-element panels + boundary layer) of the inverted two-element rear wing and the beam wing. 3D drag adds induced drag from lifting line (AR = 3, endplates: e ≈ 1.5). On a heavily loaded, low-aspect-ratio wing the induced part dominates (L/D ≈ 4–7 is typical of a rear wing); the flap counts as separated when more than 15 % of its chord is. The yellow dot is the diffuser exit: the beam wing's upwash/suction lowers its Cp, i.e. the floor's base pressure (extraction)."
  );
  const call = liveCall("rw", "car.rear_wing", 90);
  function run() {
    call({ main_angle: sM.value, flap_angle: sF.value, drs: sD.value, beam: tB.value, beam_angle: sB.value, vii: tV.value, field: { x0: -2.6, x1: 4.0, y0: -2.2, y1: 0.9, nx: 140, ny: 80 } }, (r) => {
      ap.update(r, {
        overlays: [
          (g, v) => {
            g.fillStyle = "#fbbf24";
            g.beginPath();
            g.arc(v.X(r.probe[0]), v.Y(r.probe[1]), 6, 0, 7);
            g.fill();
            g.fillStyle = cssVar("--fg-muted");
            g.font = "11px Inter";
            g.fillText(tr({ es: "salida del difusor", en: "diffuser exit" }), v.X(r.probe[0]) + 8, v.Y(r.probe[1]) + 4);
          },
        ],
      });
      roDF.set(r.downforce_wing_3d.toFixed(2));
      roCD.set(`${r.cd_wing.toFixed(3)} (${r.cd_wing_induced.toFixed(3)} ind.)`);
      roLD.set(r.ld_3d.toFixed(1));
      roCp.set(r.cp_probe.toFixed(3), r.cp_probe < -0.45 ? "good" : "");
      const pct = Math.round(100 * (r.flap_sep_frac || 0));
      roFl.set(
        r.flap_separated ? L(`separado (${pct} %)`, `separated (${pct} %)`) : pct > 0 ? L(`adherido (${pct} % sep. en el borde de salida)`, `attached (${pct} % TE sep.)`) : L("adherido", "attached"),
        r.flap_separated ? "bad" : "good"
      );
    });
  }
  run();
}

function drsLab(host) {
  const ui = labLayout(host);
  const row = el("div", { class: "viz-row" });
  ui.viz.appendChild(row);
  const pA = new Plot(row, { height: 250, xlabel: { es: "apertura DRS [°]", en: "DRS opening [°]" }, ylabel: { es: "C_L alerón 3D", en: "3D wing C_L" } });
  const pB = new Plot(row, { height: 250, xlabel: { es: "apertura DRS [°]", en: "DRS opening [°]" }, ylabel: { es: "C_D alerón", en: "wing C_D" } });
  const sF = slider({ label: { es: "Ángulo del flap [°]", en: "Flap angle [°]" }, min: 15, max: 45, step: 1, value: 25, onInput: run });
  ui.controls.append(sF.el);
  const roG = readout({ es: "Reducción de C_D con DRS máx.", en: "C_D reduction at max DRS" });
  const roI = readout({ es: "Parte inducida de esa reducción", en: "Induced share of that reduction" });
  ui.readouts.append(roG.el, roI.el);
  ui.note.innerHTML = L(
    "La mayor parte de la ganancia del DRS es resistencia <b>inducida</b>: al descargar el alerón, cae C_L y con él C_L²/(πeAR). Por eso el DRS es tan eficaz en un alerón de bajo alargamiento muy cargado.",
    "Most of the DRS gain is <b>induced</b> drag: unloading the wing drops C_L and with it C_L²/(πeAR). That is why DRS is so effective on a heavily loaded, low-aspect-ratio wing."
  );
  const call = liveCall("drs", "car.drs_sweep", 100);
  function run() {
    call({ flap_angle: sF.value }, (r) => {
      pA.set([{ x: r.drs, y: r.downforce, color: cssVar("--accent"), width: 2.6, points: true, label: { es: "carga", en: "downforce" } }]);
      pB.set([
        { x: r.drs, y: r.cd, color: cssVar("--accent-2"), width: 2.6, points: true, label: { es: "total", en: "total" } },
        { x: r.drs, y: r.cdi, color: cssVar("--accent-3"), dash: [5, 4], label: { es: "inducida", en: "induced" } },
      ]);
      const dCd = r.cd[0] - r.cd[r.cd.length - 1];
      const dCi = r.cdi[0] - r.cdi[r.cdi.length - 1];
      roG.set(((dCd / r.cd[0]) * 100).toFixed(0) + " %");
      roI.set(((dCi / dCd) * 100).toFixed(0) + " %");
    });
  }
  run();
}

export default {
  subtitle: {
    es: "El alerón trasero de dos elementos, el beam wing y su acoplamiento con el difusor, y el DRS: cuánta carga y cuánta resistencia (sobre todo inducida) se quitan al abrirlo.",
    en: "The two-element rear wing, the beam wing and its coupling with the diffuser, and DRS: how much downforce and drag (mostly induced) is removed when it opens.",
  },
  heroParams: { eps: 0.1, camber: 0.14, alpha: 8 },
  intuition: {
    es: R`<p>El alerón trasero de un F1 es un perfil <b>multielemento invertido</b> (plano principal + flap) de bajo alargamiento: genera ~30 % de la carga y una parte muy grande de la resistencia, sobre todo <b>inducida</b> por sus vórtices de punta. Debajo, el <span class="term">beam wing</span> trabaja con el difusor: su succión y el upwash que induce "tiran" del aire que sale del suelo y bajan la presión en la salida del difusor (<b>extracción</b>), que como vimos en G2 es la presión de base que fija el caudal bajo el coche.</p>
    <p>El <span class="term">DRS</span> (Drag Reduction System) abre el hueco entre plano principal y flap girando el flap. El flap descarga, el plano principal pierde el "efecto circulación" de Smith y toda la carga del alerón cae. Con ella cae la resistencia inducida (\(\propto C_L^2\)), que es la mayor parte de la ganancia. Al cerrarlo, el flujo tiene que volver a adherirse: si no lo hace a tiempo (o el flap está muy cargado) aparece el <b>DRS stall</b>, una pérdida de carga momentánea en la frenada.</p>`,
    en: R`<p>An F1 rear wing is an <b>inverted multi-element</b> section (main plane + flap) of low aspect ratio: it makes ~30 % of the downforce and a large share of the drag, mostly <b>induced</b> by its tip vortices. Below it, the <span class="term">beam wing</span> works with the diffuser: its suction and the upwash it induces "pull" the air leaving the floor and lower the pressure at the diffuser exit (<b>extraction</b>), which, as in G2, is the base pressure that sets the underbody mass flow.</p>
    <p><span class="term">DRS</span> (Drag Reduction System) opens the slot between main plane and flap by rotating the flap. The flap unloads, the main plane loses Smith's "circulation effect" and the whole wing loses downforce. Induced drag (\(\propto C_L^2\)) falls with it, which is most of the gain. When closing, the flow must reattach: if it does not do so in time (or the flap is heavily loaded) <b>DRS stall</b> appears, a momentary downforce loss under braking.</p>`,
  },
  physics: {
    es: R`<p><b>Resistencia del alerón</b>: $$C_D=C_{d,perfil}+\frac{C_{L,3D}^2}{\pi e\,AR},\qquad C_{L,3D}\approx\frac{C_{l,2D}}{1+2/(e\,AR)},\qquad e\approx1+1.9\frac{h_{ep}}{b}$$ Con \(AR\approx3\) y \(C_L\approx2.5\)–3 la inducida domina.</p>
    <p><b>Acoplamiento con el difusor</b>: un vórtice ligado de circulación \(\Gamma\) (beam wing invertido) induce en un punto a distancia \(r\) una velocidad \(\Gamma/2\pi r\); en la salida del difusor esa velocidad se suma al flujo de salida y baja su presión: \(C_{p,base}\downarrow\) ⇒ \(C_{p,garganta}=1-(1-C_{p,base})(A_e/A_t)^2\) más negativo ⇒ más carga del suelo. Por eso el beam wing aporta más carga al coche que la suya propia.</p>
    <p><b>DRS</b>: abrir el hueco reduce el ángulo efectivo del flap y elimina el efecto circulación/dumping sobre el principal (Smith). La reducción de \(C_D\) típica es del 15–25 % del coche en recta (≈ 10–15 km/h de velocidad punta). <b>DRS stall</b>: al cerrar, la capa límite del flap tiene que reanclarse con un gradiente adverso grande; si separa, la carga trasera tarda en volver (histéresis).</p>
    <p><b>Endplates del alerón trasero</b>: aumentan el AR efectivo y controlan el vórtice de punta, cuyo tamaño y posición afectan al coche que sigue (estela).</p>`,
    en: R`<p><b>Wing drag</b>: $$C_D=C_{d,profile}+\frac{C_{L,3D}^2}{\pi e\,AR},\qquad C_{L,3D}\approx\frac{C_{l,2D}}{1+2/(e\,AR)},\qquad e\approx1+1.9\frac{h_{ep}}{b}$$ With \(AR\approx3\) and \(C_L\approx2.5\)–3 induced drag dominates.</p>
    <p><b>Coupling with the diffuser</b>: a bound vortex of circulation \(\Gamma\) (inverted beam wing) induces at a point at distance \(r\) a velocity \(\Gamma/2\pi r\); at the diffuser exit that velocity adds to the exhaust flow and lowers its pressure: \(C_{p,base}\downarrow\) ⇒ \(C_{p,throat}=1-(1-C_{p,base})(A_e/A_t)^2\) more negative ⇒ more floor downforce. That is why the beam wing adds more downforce to the car than its own.</p>
    <p><b>DRS</b>: opening the slot reduces the flap's effective angle and removes the circulation/dumping effect on the main element (Smith). Typical \(C_D\) reduction is 15–25 % of the car on a straight (≈ 10–15 km/h of top speed). <b>DRS stall</b>: on closing, the flap boundary layer must reattach against a large adverse gradient; if it separates, rear downforce is slow to return (hysteresis).</p>
    <p><b>Rear-wing endplates</b>: raise effective AR and control the tip vortex, whose size and position affect the following car (wake).</p>`,
  },
  labs: [
    { title: { es: "Alerón trasero + beam wing + DRS", en: "Rear wing + beam wing + DRS" }, desc: { es: "Abre el DRS y observa la carga del principal y del flap; quita el beam wing y mira el Cp en la salida del difusor.", en: "Open DRS and watch the main and flap loading; remove the beam wing and watch the Cp at the diffuser exit." }, mount: rearWingLab },
    { title: { es: "¿De dónde sale la ganancia del DRS?", en: "Where does the DRS gain come from?" }, mount: drsLab },
  ],
  interview: [
    { q: { es: "¿Cómo funciona el DRS y por qué reduce tanto la resistencia?", en: "How does DRS work and why does it cut so much drag?" }, a: { es: R`<p>Abre el hueco entre plano principal y flap girando el flap: el flap descarga y el principal pierde el efecto circulación (Smith), así que cae la carga de todo el alerón. La resistencia que se elimina es sobre todo inducida (\(\propto C_L^2/AR\), grande en un alerón de AR bajo muy cargado) y, en menor medida, de perfil. Al cerrarlo, el flujo debe reanclar en el flap; si no lo hace, "DRS stall".</p>`, en: R`<p>It opens the slot between main plane and flap by rotating the flap: the flap unloads and the main element loses the circulation effect (Smith), so the whole wing loses downforce. The drag removed is mostly induced (\(\propto C_L^2/AR\), large on a heavily loaded low-AR wing) and, to a lesser extent, profile drag. On closing, the flow must reattach on the flap; if it does not, "DRS stall".</p>` } },
    { q: { es: "¿Para qué sirve el beam wing?", en: "What is the beam wing for?" }, a: { es: R`<p>Genera algo de carga propia, pero sobre todo trabaja con el difusor: su succión/upwash baja la presión en la salida del difusor (extracción), lo que aumenta el caudal y la succión bajo todo el suelo. También condiciona la estela del coche (mezcla con el flujo del difusor) y la eficiencia del alerón superior.</p>`, en: R`<p>It makes some downforce of its own but mainly works with the diffuser: its suction/upwash lowers the pressure at the diffuser exit (extraction), increasing mass flow and suction under the whole floor. It also shapes the car's wake (mixing with the diffuser flow) and the upper wing's efficiency.</p>` } },
  ],
  myths: [
    { es: "«El DRS reduce sobre todo la resistencia de forma del flap». La mayor parte es inducida: el alerón entero se descarga.", en: "“DRS mainly removes the flap's form drag”. Most of it is induced: the whole wing unloads." },
    { es: "«El beam wing solo aporta su propia carga». Su efecto en la extracción del difusor suele valer más que su carga.", en: "“The beam wing only contributes its own downforce”. Its effect on diffuser extraction is usually worth more than its own load." },
  ],
  quiz: [
    { q: { es: "La resistencia inducida de un alerón escala con…", en: "A wing's induced drag scales with…" }, options: [{ es: "C_L", en: "C_L" }, { es: "C_L²/AR", en: "C_L²/AR" }, { es: "AR", en: "AR" }, { es: "1/C_L", en: "1/C_L" }], correct: 1, explain: { es: "C_Di = C_L²/(π e AR).", en: "C_Di = C_L²/(π e AR)." } },
    { q: { es: "El beam wing aumenta la carga del suelo porque…", en: "The beam wing increases floor downforce because…" }, options: [{ es: "tapa el difusor", en: "it blocks the diffuser" }, { es: "baja la presión en la salida del difusor", en: "it lowers the pressure at the diffuser exit" }, { es: "aumenta la presión de base", en: "it raises base pressure" }, { es: "reduce la velocidad bajo el coche", en: "it reduces underbody velocity" }], correct: 1, explain: { es: "Menor presión de base ⇒ más caudal y succión bajo el suelo.", en: "Lower base pressure ⇒ more mass flow and suction under the floor." } },
  ],
  refs: [
    "J. Katz, <i>Race Car Aerodynamics</i>, ch. 5 (rear wings, multi-element).",
    "A.M.O. Smith, “High-Lift Aerodynamics”, <i>J. Aircraft</i> 12(6), 1975.",
    "X. Zhang, W. Toet & J. Zerihan, “Ground effect aerodynamics of race cars”, <i>Appl. Mech. Rev.</i> 59, 2006.",
    "FIA Formula 1 Technical Regulations (DRS, rear wing and beam wing definitions).",
  ],
};
