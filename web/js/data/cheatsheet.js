/* Interview cheat sheet: one card per key question, model answers as bullet points. */
const C = (t, es, en, m) => ({ t, es, en, m });

export const CHEATSHEET = [
  C({ es: "¿Cómo se genera la sustentación?", en: "How is lift generated?" }, [
    "El perfil desvía el flujo hacia abajo (incidencia + curvatura).",
    "Curvar las líneas de corriente exige ∂p/∂n = ρV²/R: succión arriba, sobrepresión abajo.",
    "Flujo potencial: infinitas soluciones; la <b>condición de Kutta</b> (salida suave en el borde de salida afilado, impuesta por la viscosidad) fija Γ.",
    "Kutta-Joukowski: L' = ρV∞Γ. Vórtice de arranque −Γ (Kelvin).",
    "Equivalente: cantidad de movimiento hacia abajo (downwash). Tiempo de tránsito igual = FALSO.",
  ], [
    "The airfoil turns the flow downwards (incidence + camber).",
    "Curving streamlines requires ∂p/∂n = ρV²/R: suction on top, overpressure below.",
    "Potential flow: infinitely many solutions; the <b>Kutta condition</b> (smooth flow-off at the sharp trailing edge, imposed by viscosity) fixes Γ.",
    "Kutta-Joukowski: L' = ρV∞Γ. Starting vortex −Γ (Kelvin).",
    "Equivalent: downward momentum (downwash). Equal transit time = FALSE.",
  ], "a3"),
  C({ es: "Tipos de resistencia", en: "Types of drag" }, [
    "Fricción (τw, área mojada, turbulenta ≫ laminar).",
    "Presión/forma (separación, espesor de estela) — domina en cuerpos romos y en un F1.",
    "Inducida: CDi = CL²/(π e AR), por la estela de vórtices de un ala finita.",
    "Reducir la inducida: más AR/envergadura, carga elíptica, endplates/winglets, efecto suelo, menos CL.",
  ], [
    "Friction (τw, wetted area, turbulent ≫ laminar).",
    "Pressure/form (separation, wake thickness) — dominates bluff bodies and F1 cars.",
    "Induced: CDi = CL²/(π e AR), from a finite wing's vortex wake.",
    "Reduce induced: higher AR/span, elliptic loading, endplates/winglets, ground effect, less CL.",
  ], "c1"),
  C({ es: "Capa límite: fases", en: "Boundary layer: stages" }, [
    "Laminar (Blasius, δ ∝ √x, H = 2.59) → ondas Tollmien-Schlichting → spots turbulentos → turbulenta (δ ∝ x^0.8, H ≈ 1.4).",
    "Adelantan la transición: Re, gradiente adverso, Tu, rugosidad. La retrasa: gradiente favorable.",
    "Separación cuando τw = 0 (gradiente adverso). Laminar separa pronto → burbuja laminar si reancla.",
  ], [
    "Laminar (Blasius, δ ∝ √x, H = 2.59) → Tollmien-Schlichting waves → turbulent spots → turbulent (δ ∝ x^0.8, H ≈ 1.4).",
    "Transition advanced by: Re, adverse gradient, Tu, roughness. Delayed by: favourable gradient.",
    "Separation when τw = 0 (adverse gradient). Laminar separates early → laminar bubble if it reattaches.",
  ], "b1"),
  C({ es: "Laminar vs turbulenta", en: "Laminar vs turbulent" }, [
    "Laminar: perfil gradual («V»), poca fricción, separa con muy poco gradiente adverso.",
    "Turbulenta: perfil lleno («D»), ∂u/∂y en pared mucho mayor → más fricción; fluido cercano a la pared con más energía → aguanta mucho más gradiente adverso.",
    "Ejemplos: crisis de resistencia, pelota de golf, vortex generators.",
  ], [
    "Laminar: gradual profile (“V”), low friction, separates with very little adverse gradient.",
    "Turbulent: full profile (“D”), much larger wall ∂u/∂y → more friction; energised near-wall fluid → withstands much more adverse gradient.",
    "Examples: drag crisis, golf ball, vortex generators.",
  ], "b2"),
  C({ es: "Distribución spanwise: ¿cuál tiene menos drag inducido?", en: "Spanwise loading: which has least induced drag?" }, [
    "La <b>elíptica</b>: el gradiente de presión/carga spanwise más suave compatible con anularse en las puntas.",
    "Vorticidad desprendida = −dΓ/dy → downwash <b>uniforme</b> → mínima energía en la estela → e = 1.",
    "CDi = CL²/(πAR)(1+δ), δ = 0 solo si es elíptica. Con endplates/suelo el óptimo cambia.",
  ], [
    "The <b>elliptic</b> one: the gentlest spanwise pressure/load gradient compatible with vanishing at the tips.",
    "Shed vorticity = −dΓ/dy → <b>uniform</b> downwash → minimum wake energy → e = 1.",
    "CDi = CL²/(πAR)(1+δ), δ = 0 only if elliptic. With endplates/ground the optimum changes.",
  ], "d2"),
  C({ es: "Cp sobre un perfil", en: "Cp over an airfoil" }, [
    "Eje invertido. Remanso Cp = 1; pico de succión cerca del borde de ataque (crece y se adelanta con α).",
    "Hasta el pico: gradiente <b>favorable</b>. Recuperación hasta el borde de salida: <b>adverso</b> (manda en la separación).",
    "Meseta de Cp = zona separada. Meseta corta + subida brusca = burbuja laminar. Curvas se unen en el BS (Kutta).",
  ], [
    "Inverted axis. Stagnation Cp = 1; suction peak near the leading edge (grows and moves forward with α).",
    "Up to the peak: <b>favourable</b> gradient. Recovery to the trailing edge: <b>adverse</b> (governs separation).",
    "Cp plateau = separated region. Short plateau + sharp rise = laminar bubble. Curves meet at the TE (Kutta).",
  ], "a5"),
  C({ es: "Multielemento (A.M.O. Smith)", en: "Multi-element (A.M.O. Smith)" }, [
    "Slat effect: el delantero reduce el pico de succión del trasero.",
    "Circulation effect: el trasero aumenta la circulación del delantero.",
    "Dumping: el delantero descarga su capa límite a V > V∞ (Cp,TE < 0) → menos recuperación.",
    "Recuperación fuera de la superficie (estela) y capa límite fresca en cada elemento.",
    "El slot NO sopla aire de alta energía.",
  ], [
    "Slat effect: the forward element lowers the aft element's suction peak.",
    "Circulation effect: the aft element raises the forward element's circulation.",
    "Dumping: the forward element dumps its boundary layer at V > V∞ (Cp,TE < 0) → less recovery.",
    "Off-the-surface recovery (wake) and a fresh boundary layer on each element.",
    "The slot does NOT blow high-energy air.",
  ], "f1"),
  C({ es: "Efecto suelo", en: "Ground effect" }, [
    "Imagen de circulación opuesta bajo el suelo (v = 0 en el suelo).",
    "Ala sustentadora: menos downwash → más CL y mucho menos CDi; efecto colchón.",
    "Ala invertida: Venturi entre ala y suelo + aumento de circulación → carga crece al bajar h.",
    "Máximo y luego <b>caída</b>: separación de la capa límite en la recuperación de la cara de succión, breakdown de vórtices. Sensibilidad a altura, porpoising.",
    "Túnel: suelo móvil + succión de capa límite.",
  ], [
    "Opposite-circulation image below the ground (v = 0 on the ground).",
    "Lifting wing: less downwash → more CL and much less CDi; cushion effect.",
    "Inverted wing: Venturi between wing and ground + increased circulation → downforce grows as h drops.",
    "Peak, then <b>drop</b>: suction-side recovery separates, vortices burst. Ride-height sensitivity, porpoising.",
    "Tunnel: moving ground + boundary-layer suction.",
  ], "g1"),
  C({ es: "Suelo y difusor de F1", en: "F1 floor and diffuser" }, [
    "Canal Venturi suelo–asfalto: entrada convergente → garganta (mín. presión) → difusor.",
    "El difusor descarga a la presión de base: C<sub>p,garganta</sub> = 1 − (1 − C<sub>p,base</sub>)(A<sub>e</sub>/A<sub>t</sub>)² mientras no separe.",
    "Bajar el coche: más carga hasta un máximo; después el difusor separa y «se ahoga» → pérdida de carga, porpoising.",
    "Rake: más carga del suelo y centro de presión más adelantado. Vórtices de borde: sellado lateral y capa límite energizada.",
  ], [
    "Floor–road Venturi channel: convergent inlet → throat (min. pressure) → diffuser.",
    "The diffuser discharges at base pressure: C<sub>p,throat</sub> = 1 − (1 − C<sub>p,base</sub>)(A<sub>e</sub>/A<sub>t</sub>)² while it does not separate.",
    "Lowering the car: more downforce up to a peak; then the diffuser separates and “chokes” → downforce loss, porpoising.",
    "Rake: more floor downforce and a more forward centre of pressure. Edge vortices: lateral sealing and energised boundary layer.",
  ], "g2"),
  C({ es: "Curva Cl–α", en: "Cl–α curve" }, [
    "Pendiente ≈ 2π/rad (0.11/°). Simétrico: pasa por el origen, Cm,c/4 = 0.",
    "Curvatura: desplaza la curva (α_L0 < 0), misma pendiente, Cm < 0.",
    "Flap: más Cl a cada α, α_L0 más negativo, α_stall algo menor. Slat: curva más larga, α_stall y Cl,max mayores.",
    "Ala finita: pendiente a0/(1 + a0/(π e AR)).",
  ], [
    "Slope ≈ 2π/rad (0.11/°). Symmetric: through the origin, Cm,c/4 = 0.",
    "Camber: shifts the curve (α_L0 < 0), same slope, Cm < 0.",
    "Flap: more Cl at each α, more negative α_L0, slightly lower α_stall. Slat: longer curve, higher α_stall and Cl,max.",
    "Finite wing: slope a0/(1 + a0/(π e AR)).",
  ], "a4"),
  C({ es: "Vórtices", en: "Vortices" }, [
    "Nacen en la pared (capa límite) y se desprenden al separar; la lámina se enrolla.",
    "Núcleo a baja presión (dp/dr = ρv²/r) → sellado del suelo en F1.",
    "Pares: corrotantes orbitan/fusionan (a/d ≳ 0.3), contrarrotantes se trasladan; pared → imagen.",
    "Breakdown: swirl alto + gradiente adverso → remanso en el eje. Vórtice más débil (menos swirl) aguanta más gradiente.",
  ], [
    "Born at the wall (boundary layer), shed at separation; the sheet rolls up.",
    "Low-pressure core (dp/dr = ρv²/r) → floor sealing in F1.",
    "Pairs: co-rotating orbit/merge (a/d ≳ 0.3), counter-rotating translate; wall → image.",
    "Breakdown: high swirl + adverse gradient → stagnation on the axis. A weaker (lower-swirl) vortex tolerates more gradient.",
  ], "e3"),
  C({ es: "Ala delta", en: "Delta wing" }, [
    "Separación en el borde de ataque → vórtice primario cónico → succión bajo el núcleo (sustentación de vórtice, Polhamus).",
    "Bajo el primario: flujo hacia fuera, gradiente adverso spanwise → vórtice secundario de signo opuesto cerca del borde.",
    "Breakdown avanza desde el BS con α y limita CL.",
  ], [
    "Leading-edge separation → conical primary vortex → suction under the core (vortex lift, Polhamus).",
    "Under the primary: outboard flow, spanwise adverse gradient → opposite-sign secondary vortex near the edge.",
    "Breakdown moves forward from the TE with α and limits CL.",
  ], "e4"),
  C({ es: "Gurney flap y endplates", en: "Gurney flap and endplates" }, [
    "Gurney (1–2 % c): desplaza el punto de Kutta, más curvatura efectiva → +Cl, +Cl,max, poca resistencia si h < δ.",
    "Endplate: limita la fuga de presión en la punta → AR efectivo mayor (e ≈ 1 + 1.9 h/b) → más carga, menos inducida. En F1, gestión de la estela de la rueda.",
  ], [
    "Gurney (1–2 % c): moves the Kutta point, more effective camber → +Cl, +Cl,max, little drag if h < δ.",
    "Endplate: limits tip pressure leakage → higher effective AR (e ≈ 1 + 1.9 h/b) → more downforce, less induced drag. In F1, tyre-wake management.",
  ], "f2"),
  C({ es: "Toberas", en: "Nozzles" }, [
    "dA/A = (M² − 1) du/u: subsónico convergente acelera; supersónico divergente acelera.",
    "Bloqueo: M = 1 en garganta, gasto máximo independiente de p_b (p*/p₀ = 0.528).",
    "C-D al bajar p_b: subsónico → bloqueo → choque normal dentro → choque en salida → sobreexpandida → diseño → subexpandida.",
  ], [
    "dA/A = (M² − 1) du/u: subsonic convergent accelerates; supersonic divergent accelerates.",
    "Choking: M = 1 at the throat, maximum mass flow independent of p_b (p*/p₀ = 0.528).",
    "C-D as p_b drops: subsonic → choked → normal shock inside → shock at exit → overexpanded → design → underexpanded.",
  ], "h1"),
  C({ es: "CFD y túnel", en: "CFD and wind tunnel" }, [
    "DNS (todas las escalas, Re bajo), LES (grandes escalas, separados/estelas), DES (RANS en pared + LES fuera), RANS (todo modelado, diseño diario).",
    "Modelos: SA, k-ε, k-ω, <b>k-ω SST</b> (estándar para separación), γ-Reθ (transición), RSM.",
    "y⁺ ≈ 1 (bajo Re) o 30–300 (funciones de pared); nunca en la zona buffer.",
    "Túnel: escala ≤ 60 %, suelo móvil, ruedas girando, correcciones de bloqueo, Re menor que el real, correlación túnel–CFD–pista.",
  ], [
    "DNS (all scales, low Re), LES (large scales, separated/wakes), DES (RANS at wall + LES outside), RANS (all modelled, day-to-day design).",
    "Models: SA, k-ε, k-ω, <b>k-ω SST</b> (standard for separation), γ-Reθ (transition), RSM.",
    "y⁺ ≈ 1 (low-Re) or 30–300 (wall functions); never in the buffer layer.",
    "Tunnel: ≤ 60 % scale, moving ground, rotating wheels, blockage corrections, Re lower than real, tunnel–CFD–track correlation.",
  ], "i1"),
  C({ es: "Alerón trasero, beam wing y DRS", en: "Rear wing, beam wing and DRS" }, [
    "Alerón trasero: multielemento invertido de AR bajo; mucha resistencia inducida (C_L²/πeAR).",
    "Beam wing: baja la presión de base en la salida del difusor (extracción) → más carga del suelo.",
    "DRS: abre el hueco y descarga el alerón; la mayor parte de la ganancia es inducida. DRS stall al cerrar si el flap no reancla.",
  ], [
    "Rear wing: low-AR inverted multi-element; lots of induced drag (C_L²/πeAR).",
    "Beam wing: lowers base pressure at the diffuser exit (extraction) → more floor downforce.",
    "DRS: opens the slot and unloads the wing; most of the gain is induced. DRS stall on closing if the flap does not reattach.",
  ], "f3"),
  C({ es: "Aire sucio y ruedas", en: "Dirty air and wheels" }, [
    "Estela: déficit ∝ x^(−2/3); el seguidor pierde carga (sobre todo delante → subviraje) y gana rebufo.",
    "2022: estela lanzada hacia arriba y coches menos sensibles (≈35 % → ≈4 % de pérdida a 20 m, cifras F1/FIA).",
    "Rueda girando: menos C_L y C_D que fija (Fackrell & Harvey); jetting en el contacto; el endplate dirige la estela.",
  ], [
    "Wake: deficit ∝ x^(−2/3); the follower loses downforce (mostly at the front → understeer) and gains tow.",
    "2022: wake thrown upwards and less sensitive cars (≈35 % → ≈4 % loss at 20 m, F1/FIA figures).",
    "Rotating wheel: lower C_L and C_D than stationary (Fackrell & Harvey); contact-patch jetting; the endplate steers the wake.",
  ], "j3"),
  C({ es: "Postprocesado de CFD", en: "CFD post-processing" }, [
    "CpS en superficie: dónde se genera la carga. CpT en planos: dónde va el aire con pérdidas (CpT = 1 sin pérdidas).",
    "Vy/Vz: outwash/upwash y pares de signo alrededor de vórtices; ωx y helicidad normalizada: sentido de giro; Q > 0: núcleos.",
    "Comparar siempre diferencias entre versiones (misma escala y planos) y curvas de fuerza acumulada; antes, revisar convergencia e y⁺.",
  ], [
    "Surface CpS: where downforce is generated. CpT on planes: where lossy air goes (CpT = 1 loss-free).",
    "Vy/Vz: outwash/upwash and sign pairs around vortices; ωx and normalised helicity: rotation sense; Q > 0: cores.",
    "Always compare deltas between versions (same scale and planes) and cumulative force curves; check convergence and y⁺ first.",
  ], "i4"),
  C({ es: "No estacionaria y aeroelasticidad", en: "Unsteady and aeroelasticity" }, [
    "k = ωc/2V; Wagner: 50 % de la sustentación al instante; Theodorsen: amplitud y fase con C(k).",
    "Divergencia si el eje elástico está detrás del centro aerodinámico; alivio de carga (alerón flexible) si está delante.",
    "Flameo: coalescencia de modos; se evita con rigidez torsional y equilibrado másico.",
  ], [
    "k = ωc/2V; Wagner: 50 % of lift instantly; Theodorsen: amplitude and phase through C(k).",
    "Divergence if the elastic axis is aft of the aerodynamic centre; load relief (flexible wing) if ahead.",
    "Flutter: mode coalescence; avoided with torsional stiffness and mass balancing.",
  ], "k2"),
];
