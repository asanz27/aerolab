/* Extra interview questions and quiz items, merged into each module at render time so every
   module reaches the minimum of the project brief (>= 3 interview questions, >= 4 quiz items).
   Q(es, en, [[es, en] x4], correct, explainEs, explainEn); IV(qEs, qEn, aEs, aEn). */
const Q = (es, en, opts, correct, xes, xen) => ({ q: { es, en }, options: opts.map(([a, b]) => ({ es: a, en: b ?? a })), correct, explain: { es: xes, en: xen } });
const IV = (qes, qen, aes, aen) => ({ q: { es: qes, en: qen }, a: { es: `<p>${aes}</p>`, en: `<p>${aen}</p>` } });

export const EXTRA = {
  b2: {
    quiz: [
      Q("El factor de forma H = δ*/θ de una capa límite turbulenta sin gradiente de presión vale aproximadamente…", "The shape factor H = δ*/θ of a zero-pressure-gradient turbulent boundary layer is about…",
        [["2.59"], ["1.3–1.4"], ["1.0"], ["3.5"]], 1,
        "Laminar (Blasius) 2.59; turbulenta ≈ 1.3–1.4 porque el perfil es más lleno. H sube hacia ~2–2.4 cerca de la separación turbulenta.", "Laminar (Blasius) 2.59; turbulent ≈ 1.3–1.4 because the profile is fuller. H rises towards ~2–2.4 near turbulent separation."),
    ],
  },
  b3: {
    quiz: [
      Q("La inestabilidad de Kelvin-Helmholtz de una capa de cortadura se debe a…", "The Kelvin-Helmholtz instability of a shear layer is caused by…",
        [["La diferencia de velocidad a través de una lámina de vorticidad", "The velocity difference across a vortex sheet"], ["La gravedad", "Gravity"], ["La compresibilidad", "Compressibility"], ["La rugosidad de la pared", "Wall roughness"]], 0,
        "Una lámina de vorticidad es inestable a perturbaciones de cualquier longitud de onda: se enrolla en vórtices discretos.", "A vortex sheet is unstable to disturbances of any wavelength: it rolls up into discrete vortices."),
      Q("El espesor de una capa de mezcla plana turbulenta crece con la distancia x como…", "The thickness of a turbulent plane mixing layer grows with distance x as…",
        [["x^(1/2)"], ["x (lineal)", "x (linear)"], ["x^(4/5)"], ["Constante", "Constant"]], 1,
        "Es un flujo libre autosemejante sin escala de longitud propia: δ ∝ x, con pendiente ∝ (U1−U2)/(U1+U2).", "It is a self-similar free shear flow with no length scale of its own: δ ∝ x, with slope ∝ (U1−U2)/(U1+U2)."),
    ],
  },
  c1: {
    quiz: [
      Q("En un perfil aerodinámico de t/c = 12 % a Re = 3·10⁶ y sustentación nula, la mayor parte de la resistencia es…", "On a 12 % thick airfoil at Re = 3·10⁶ and zero lift, most of the drag is…",
        [["Fricción", "Skin friction"], ["Presión de forma", "Form pressure drag"], ["Inducida", "Induced"], ["De onda", "Wave drag"]], 0,
        "≈ 80 % fricción y ≈ 20 % forma. En un cuerpo romo (o un F1 completo) es al revés: domina la presión.", "≈ 80 % friction and ≈ 20 % form drag. On a bluff body (or a whole F1 car) it is the opposite: pressure dominates."),
    ],
  },
  d1: {
    quiz: [
      Q("A C_L constante, si el alargamiento se reduce a la mitad, el coeficiente de resistencia inducida…", "At constant C_L, halving the aspect ratio makes the induced drag coefficient…",
        [["Se duplica", "Double"], ["Se reduce a la mitad", "Halve"], ["No cambia", "Stay the same"], ["Se multiplica por 4", "Quadruple"]], 0,
        "C_Di = C_L²/(π e AR): inversamente proporcional a AR.", "C_Di = C_L²/(π e AR): inversely proportional to AR."),
    ],
  },
  d2: {
    interview: [
      IV("¿Por qué la distribución elíptica es la óptima y qué la sustituye en un coche de carreras?", "Why is the elliptic loading optimal and what replaces it on a race car?",
        "Para una envergadura y una sustentación dadas, la carga elíptica da downwash uniforme y por tanto el mínimo C_Di (e = 1): la energía dejada en la estela es mínima. En un coche la envergadura está limitada por el reglamento y la carga no tiene por qué ser elíptica: se carga más el centro o se descarga la zona delante de las ruedas para controlar sus estelas, y los endplates y el suelo permiten mantener carga en la punta. Se acepta algo más de inducida a cambio de gestionar el flujo hacia el suelo.",
        "For a given span and lift, the elliptic loading gives uniform downwash and therefore the minimum C_Di (e = 1): the energy left in the wake is minimal. On a car the span is fixed by the rules and the loading need not be elliptic: the centre is loaded more, or the part ahead of the wheels is unloaded to control their wakes, and endplates and the ground let the tip keep load. Some extra induced drag is accepted in exchange for managing the flow to the floor."),
    ],
    quiz: [
      Q("El downwash de un ala con carga elíptica a lo largo de la envergadura es…", "The downwash of an elliptically loaded wing along the span is…",
        [["Uniforme", "Uniform"], ["Máximo en la raíz", "Maximum at the root"], ["Máximo en las puntas", "Maximum at the tips"], ["Nulo", "Zero"]], 0,
        "Γ(y) elíptica ⇒ w = Γ0/(2b) constante: todas las secciones ven el mismo ángulo inducido.", "Elliptic Γ(y) ⇒ w = Γ0/(2b) constant: every section sees the same induced angle."),
      Q("En un ala rectangular, dar torsión negativa (washout) hacia la punta hace que la carga…", "On a rectangular wing, adding washout towards the tip makes the loading…",
        [["Se acerque a la elíptica", "Closer to elliptic"], ["Se aleje de la elíptica", "Further from elliptic"], ["No cambie", "Unchanged"], ["Se invierta en la punta siempre", "Always reversed at the tip"]], 0,
        "Descarga las puntas, que en un ala rectangular están sobrecargadas respecto a la elíptica.", "It unloads the tips, which on a rectangular wing are overloaded relative to the ellipse."),
    ],
  },
  d3: {
    interview: [
      IV("¿Cómo reducen los endplates la resistencia inducida y por qué el efecto real es menor que el ideal?", "How do endplates reduce induced drag and why is the real effect smaller than the ideal?",
        "Impiden parcialmente que el aire rodee la punta de la cara de presión a la de succión: la circulación cae más tarde hacia la punta y el vórtice de punta se debilita y se aleja. Equivale a un alargamiento efectivo mayor, AR_ef ≈ AR(1 + 1.9 h/b) (Hoerner). En la realidad el endplate tiene su propia resistencia de fricción y de forma, el flujo lo rodea por arriba y por abajo, y en un F1 su forma se elige sobre todo para gestionar la estela de la rueda delantera (outwash), no solo para minimizar la inducida.",
        "They partially stop the air going round the tip from the pressure side to the suction side: circulation falls later towards the tip and the tip vortex is weaker and further out. It is equivalent to a larger effective aspect ratio, AR_eff ≈ AR(1 + 1.9 h/b) (Hoerner). In reality the endplate has its own friction and form drag, the flow goes round its top and bottom, and on an F1 car its shape is chosen mainly to manage the front-wheel wake (outwash), not just to minimise induced drag."),
    ],
    quiz: [
      Q("Según Hoerner, un endplate de altura h en un ala de envergadura b aumenta el alargamiento efectivo aproximadamente en el factor…", "According to Hoerner, an endplate of height h on a wing of span b raises the effective aspect ratio by roughly the factor…",
        [["1 + 1.9 h/b"], ["1 + h/b"], ["(1 + h/b)²"], ["1 + 4 h/b"]], 0,
        "Correlación clásica, válida para h/b pequeño; el VLM del laboratorio la reproduce.", "Classic correlation, valid for small h/b; the lab's VLM reproduces it."),
      Q("En un alerón delantero de F1, la forma del endplate se elige sobre todo para…", "On an F1 front wing, the endplate shape is mainly chosen to…",
        [["Desviar la estela de la rueda delantera lejos del suelo (outwash)", "Steer the front-wheel wake away from the floor (outwash)"], ["Aumentar la velocidad punta", "Raise top speed"], ["Refrigerar los frenos", "Cool the brakes"], ["Reducir el peso", "Save weight"]], 0,
        "La estela de la rueda es la mayor fuente de pérdidas aguas abajo; mantenerla fuera del suelo vale más que la inducida del propio alerón.", "The wheel wake is the largest source of losses downstream; keeping it away from the floor is worth more than the wing's own induced drag."),
    ],
  },
  e1: {
    interview: [
      IV("¿Cómo estimarías la presión en el núcleo de un vórtice de punta?", "How would you estimate the pressure in the core of a tip vortex?",
        "Equilibrio radial dp/dr = ρ v_θ²/r. Para un vórtice de Rankine o Lamb-Oseen, la caída de presión en el centro es del orden de ρ v_θ,max²: Δp ≈ ρ(Γ/2πa)² (Rankine) o ρ ln2 (Γ/2πa)² con a el radio del núcleo (Lamb-Oseen). Con Γ ≈ C_L V c/2 y a ≈ 5–10 % de la cuerda salen Cp del núcleo de −2 a −5: por eso el vapor condensa y el vórtice se ve en días húmedos, y por eso un vórtice que pasa cerca del suelo genera succión local.",
        "Radial equilibrium dp/dr = ρ v_θ²/r. For a Rankine or Lamb-Oseen vortex, the pressure drop at the centre is of order ρ v_θ,max²: Δp ≈ ρ(Γ/2πa)² (Rankine) or ρ ln2 (Γ/2πa)² with a the core radius (Lamb-Oseen). With Γ ≈ C_L V c/2 and a ≈ 5–10 % of chord you get core Cp of −2 to −5: that is why vapour condenses and the vortex becomes visible on humid days, and why a vortex passing close to the ground creates local suction."),
    ],
    quiz: [
      Q("En un vórtice de Rankine, la velocidad tangencial dentro del núcleo…", "In a Rankine vortex, the tangential velocity inside the core…",
        [["Crece linealmente con r (rotación de sólido rígido)", "Grows linearly with r (solid-body rotation)"], ["Decae como 1/r", "Decays as 1/r"], ["Es constante", "Is constant"], ["Es nula", "Is zero"]], 0,
        "Dentro: v = Ωr (vorticidad uniforme). Fuera: v = Γ/(2πr), irrotacional.", "Inside: v = Ωr (uniform vorticity). Outside: v = Γ/(2πr), irrotational."),
      Q("La presión en el centro de un vórtice es…", "The pressure at the centre of a vortex is…",
        [["Mínima, por debajo de la ambiente", "Minimum, below ambient"], ["Máxima", "Maximum"], ["Igual a la ambiente", "Equal to ambient"], ["La presión de remanso", "The stagnation pressure"]], 0,
        "El gradiente radial de presión equilibra la aceleración centrípeta: la presión baja hacia el eje.", "The radial pressure gradient balances the centripetal acceleration: pressure falls towards the axis."),
    ],
  },
  e2: {
    interview: [
      IV("¿Cómo se mueve un vórtice cerca del suelo y por qué puede «rebotar»?", "How does a vortex move near the ground and why can it “rebound”?",
        "El suelo se modela con un vórtice imagen de signo opuesto: el par formado avanza paralelo a la pared a Γ/(4πh), así que el vórtice se desplaza lateralmente. Además induce bajo él una capa límite en el suelo con gradiente adverso que se separa y genera vorticidad secundaria de signo contrario; esa vorticidad tira del vórtice primario hacia arriba (rebote). En un F1 importa porque los vórtices de suelo y de alerón delantero que deben sellar el suelo se desplazan y pierden fuerza al acercarse a la pista.",
        "The ground is modelled by an image vortex of opposite sign: the pair travels parallel to the wall at Γ/(4πh), so the vortex drifts sideways. It also induces underneath a ground boundary layer with an adverse gradient that separates and produces opposite-sign secondary vorticity; that vorticity pulls the primary vortex up (rebound). On an F1 car it matters because the floor and front-wing vortices that must seal the floor drift and weaken as they approach the track."),
    ],
    quiz: [
      Q("Dos vórtices de igual intensidad y signo contrario separados una distancia d…", "Two vortices of equal strength and opposite sign, a distance d apart…",
        [["Se trasladan juntos a Γ/(2πd), perpendicular a la línea que los une", "Translate together at Γ/(2πd), perpendicular to the line joining them"], ["Giran uno alrededor del otro", "Rotate about each other"], ["Se quedan quietos", "Stay still"], ["Se separan", "Move apart"]], 0,
        "Cada uno induce en el otro Γ/(2πd) en la misma dirección: el par se autopropulsa (como la estela de un avión que baja).", "Each induces Γ/(2πd) on the other in the same direction: the pair self-propels (like an aircraft wake descending)."),
      Q("Dos vórtices de igual intensidad y mismo signo…", "Two vortices of equal strength and the same sign…",
        [["Giran alrededor de su centroide y pueden fusionarse", "Rotate about their centroid and may merge"], ["Se trasladan en línea recta", "Translate in a straight line"], ["Se anulan", "Cancel out"], ["Se alejan indefinidamente", "Move apart indefinitely"]], 0,
        "Si los núcleos son grandes respecto a la separación (a/d ≳ 0.3) se fusionan en uno.", "If the cores are large relative to the spacing (a/d ≳ 0.3) they merge into one."),
    ],
  },
  e3: {
    interview: [
      IV("¿Qué es el vortex breakdown y por qué le importa a un equipo de F1?", "What is vortex breakdown and why does an F1 team care?",
        "Es la transición brusca de un vórtice con mucho giro a una estructura ensanchada con recirculación en el eje (burbuja o espiral). La favorecen un número de swirl alto y un gradiente de presión adverso a lo largo del eje. En un F1 los vórtices del alerón delantero, de los bordes del suelo y del difusor viajan hacia zonas de presión creciente; si estallan pierden su capacidad de sellar el suelo y de energizar la capa límite, la carga cae y además el comportamiento se vuelve sensible a la altura y a la guiñada.",
        "It is the abrupt transition of a strongly swirling vortex into a widened structure with recirculation on its axis (bubble or spiral). It is promoted by a high swirl number and an adverse pressure gradient along the axis. On an F1 car the vortices from the front wing, floor edges and diffuser travel into rising pressure; if they burst they lose their ability to seal the floor and energise the boundary layer, downforce drops and the car becomes sensitive to ride height and yaw."),
    ],
    quiz: [
      Q("¿Qué favorece el vortex breakdown?", "What promotes vortex breakdown?",
        [["Un gradiente de presión adverso a lo largo del eje", "An adverse pressure gradient along the axis"], ["Un gradiente favorable", "A favourable gradient"], ["Menos giro", "Less swirl"], ["Un número de Reynolds menor", "A lower Reynolds number"]], 0,
        "La presión creciente frena el flujo axial del núcleo hasta pararlo: aparece la recirculación.", "Rising pressure decelerates the core's axial flow until it stops: recirculation appears."),
      Q("En un ala delta, al aumentar α, el punto de breakdown…", "On a delta wing, as α increases, the breakdown point…",
        [["Avanza hacia el vértice", "Moves forward towards the apex"], ["Retrocede más allá del borde de salida", "Moves aft past the trailing edge"], ["No se mueve", "Does not move"], ["Desaparece", "Disappears"]], 0,
        "Más α ⇒ más swirl y más gradiente adverso: el breakdown cruza el borde de salida y avanza; la sustentación deja de crecer.", "More α ⇒ more swirl and a stronger adverse gradient: breakdown crosses the trailing edge and moves forward; lift stops growing."),
    ],
  },
  e4: {
    interview: [
      IV("Explica la sustentación de vórtice de un ala delta y la analogía de Polhamus.", "Explain vortex lift on a delta wing and Polhamus' analogy.",
        "En un borde de ataque afilado y muy en flecha, el flujo se separa y se enrolla en un vórtice estable sobre el ala; su núcleo de baja presión añade succión: es la sustentación no lineal. Polhamus supuso que la succión de borde de ataque que el flujo potencial pondría en el borde (y que se pierde al separarse) reaparece girada 90° como fuerza normal: C_L = K_p sinα cos²α + K_v cos α sin²α. El primer término es la sustentación potencial y el segundo la de vórtice. Funciona hasta que el vórtice estalla sobre el ala.",
        "At a sharp, highly swept leading edge the flow separates and rolls up into a stable vortex over the wing; its low-pressure core adds suction: the non-linear lift. Polhamus assumed that the leading-edge suction that potential flow would put at the edge (and which is lost when it separates) reappears rotated by 90° as a normal force: C_L = K_p sinα cos²α + K_v cos α sin²α. The first term is potential lift and the second vortex lift. It works until the vortex bursts over the wing."),
    ],
    quiz: [
      Q("En la analogía de Polhamus, la sustentación de vórtice varía con α como…", "In Polhamus' analogy, vortex lift varies with α as…",
        [["K_v cos α sin²α"], ["K_p sin α"], ["α"], ["cos² α"]], 0,
        "Proporcional a sin²α: es despreciable a α pequeño y domina a α grande.", "Proportional to sin²α: negligible at small α and dominant at large α."),
      Q("El vórtice secundario de un ala delta aparece porque…", "The secondary vortex on a delta wing appears because…",
        [["La capa límite del flujo cruzado se separa en el gradiente adverso por fuera del pico de succión", "The crossflow boundary layer separates in the adverse gradient outboard of the suction peak"], ["Lo genera el borde de salida", "The trailing edge generates it"], ["Es el vórtice de punta", "It is the tip vortex"], ["Es inestabilidad de Kelvin-Helmholtz", "It is Kelvin-Helmholtz instability"]], 0,
        "Bajo el primario el flujo cruzado se acelera hacia fuera y luego decelera hacia el borde: se separa y forma un vórtice de signo contrario.", "Under the primary vortex the crossflow accelerates outboard and then decelerates towards the edge: it separates and forms an opposite-sign vortex."),
    ],
  },
  e5: {
    interview: [
      IV("¿Cómo retrasan la separación los generadores de vórtices y qué cuestan?", "How do vortex generators delay separation and what do they cost?",
        "Son pequeñas aletas inclinadas que generan vórtices longitudinales. Esos vórtices mezclan fluido de alta cantidad de movimiento del exterior hacia la pared y llevan fluido lento hacia fuera: el perfil de velocidad se llena (H baja) y la capa límite aguanta más gradiente adverso. Cuestan resistencia parásita propia y una capa límite algo más gruesa aguas abajo; mal colocados (demasiado cerca de la separación, o demasiado altos) solo añaden resistencia.",
        "They are small inclined vanes that produce streamwise vortices. Those vortices mix high-momentum fluid from outside towards the wall and carry slow fluid outwards: the velocity profile gets fuller (H drops) and the boundary layer withstands more adverse gradient. They cost their own parasitic drag and a slightly thicker boundary layer downstream; badly placed (too close to separation, or too tall) they only add drag."),
      IV("¿Dónde y de qué tamaño pondrías unos VG?", "Where would you place VGs and how big would you make them?",
        "Aguas arriba de la línea de separación, a una distancia de unas decenas de alturas para que el vórtice tenga tiempo de mezclar pero aún conserve intensidad. Altura del orden del espesor de la capa límite (VG clásicos, h ≈ δ) o de 0.2–0.5δ (micro-VG, menos resistencia). Separación lateral de unas 4–8 alturas; pares contrarrotantes o corrotantes según si se quiere que los vórtices se mantengan pegados a la pared. En un F1 se usan en zonas de difusor o bordes de suelo y se validan con flow-vis y CFD.",
        "Upstream of the separation line, a few tens of heights ahead so the vortex has time to mix while it is still strong. Height of the order of the boundary-layer thickness (classic VGs, h ≈ δ) or 0.2–0.5δ (micro-VGs, less drag). Lateral spacing of about 4–8 heights; counter- or co-rotating pairs depending on whether the vortices should stay near the wall. On an F1 car they are used on diffuser or floor-edge regions and validated with flow-vis and CFD."),
    ],
    quiz: [
      Q("Un VG retrasa la separación porque…", "A VG delays separation because…",
        [["Lleva fluido de alta cantidad de movimiento hacia la pared", "It brings high-momentum fluid towards the wall"], ["Reduce la rugosidad", "It reduces roughness"], ["Laminariza la capa límite", "It laminarises the boundary layer"], ["Aumenta la presión estática", "It raises static pressure"]], 0,
        "La mezcla del vórtice longitudinal llena el perfil cerca de la pared.", "The mixing by the streamwise vortex fills the near-wall profile."),
      Q("Altura típica de un micro-VG respecto al espesor de la capa límite δ:", "Typical height of a micro-VG relative to the boundary-layer thickness δ:",
        [["0.2–0.5 δ"], ["5 δ"], ["0.01 δ"], ["10 δ"]], 0,
        "Suficiente para alcanzar fluido rápido con mucha menos resistencia que un VG de altura δ.", "Enough to reach fast fluid with much less drag than a VG of height δ."),
    ],
  },
  f1: {
    quiz: [
      Q("El «efecto slat» de Smith consiste en que el elemento delantero…", "Smith's “slat effect” is that the forward element…",
        [["Reduce el pico de succión del elemento principal", "Reduces the main element's suction peak"], ["Aumenta el pico de succión del principal", "Raises the main element's suction peak"], ["Elimina la capa límite", "Removes the boundary layer"], ["Aumenta la cuerda efectiva sin más", "Simply increases the effective chord"]], 0,
        "Su circulación induce en el borde de ataque del principal una velocidad que se opone: el pico baja y el gradiente adverso se suaviza.", "Its circulation induces at the main element's leading edge a velocity that opposes it: the peak drops and the adverse gradient softens."),
      Q("La «recuperación de presión fuera de la pared» significa que…", "“Off-surface pressure recovery” means that…",
        [["La estela del elemento delantero termina de recuperar presión lejos de la pared, donde no puede separarse", "The forward element's wake finishes recovering pressure away from the wall, where it cannot separate"], ["La presión se recupera dentro del elemento", "Pressure recovers inside the element"], ["No hay recuperación", "There is no recovery"], ["Solo ocurre en flujo supersónico", "It only happens in supersonic flow"]], 0,
        "Una estela tolera mejor el gradiente adverso que una capa límite pegada a la pared.", "A wake tolerates an adverse gradient better than a boundary layer attached to a wall."),
    ],
  },
  f2: {
    interview: [
      IV("Explica el mecanismo del Gurney flap.", "Explain how a Gurney flap works.",
        "Es una pestaña perpendicular de 1–2 % de la cuerda en el borde de salida, en la cara de presión. Detrás de ella se forman dos vórtices contrarrotantes que desplazan el punto de Kutta hacia abajo y hacia atrás: equivale a más curvatura en el borde de salida, así que sube C_L a α constante y el ángulo de sustentación nula se hace más negativo. Además aumenta la carga trasera y permite recuperar presión con menos gradiente adverso en la cara de succión. Si su altura es menor que el espesor local de la capa límite, la penalización de resistencia es pequeña; más alto, la resistencia de base crece mucho.",
        "It is a perpendicular tab of 1–2 % chord at the trailing edge, on the pressure side. Behind it two counter-rotating vortices form and move the Kutta point down and aft: it is equivalent to more trailing-edge camber, so C_L rises at constant α and the zero-lift angle becomes more negative. It also loads the rear and lets the suction side recover pressure with a milder adverse gradient. If its height is below the local boundary-layer thickness the drag penalty is small; taller, base drag grows quickly."),
    ],
    quiz: [
      Q("Altura típica de un Gurney flap:", "Typical height of a Gurney flap:",
        [["1–2 % de la cuerda", "1–2 % of chord"], ["10–20 % de la cuerda", "10–20 % of chord"], ["0.01 % de la cuerda", "0.01 % of chord"], ["Igual a la cuerda", "Equal to the chord"]], 0,
        "Del orden del espesor de la capa límite en el borde de salida (Liebeck, 1978).", "Of the order of the boundary-layer thickness at the trailing edge (Liebeck, 1978)."),
      Q("Al añadir un Gurney flap, el ángulo de sustentación nula…", "Adding a Gurney flap makes the zero-lift angle…",
        [["Se hace más negativo", "More negative"], ["Se hace más positivo", "More positive"], ["No cambia", "Unchanged"], ["Pasa a 0°", "Exactly 0°"]], 0,
        "Actúa como curvatura adicional: la curva C_L–α se desplaza hacia arriba.", "It acts as extra camber: the C_L–α curve shifts upwards."),
    ],
  },
  f3: {
    interview: [
      IV("¿Cómo interactúa el beam wing con el difusor?", "How does the beam wing interact with the diffuser?",
        "El beam wing está justo encima y detrás de la salida del difusor. Su circulación induce velocidad hacia arriba (upwash) y baja la presión en esa zona: el difusor «ve» una presión de base menor, puede expandir más sin separarse y extrae más caudal bajo el suelo, así que la carga del suelo sube más de lo que carga el propio beam wing. Por eso se diseñan juntos y por eso los reglamentos lo limitan o lo prohíben según la época.",
        "The beam wing sits just above and behind the diffuser exit. Its circulation induces upwash and lowers the pressure there: the diffuser “sees” a lower base pressure, can expand more without separating and pulls more mass flow under the floor, so the floor's downforce rises by more than the beam wing's own load. That is why they are designed together and why the rules limit or ban it depending on the era."),
    ],
    quiz: [
      Q("La reducción de resistencia del DRS procede sobre todo de…", "The drag reduction of DRS comes mainly from…",
        [["Descargar el alerón: menos resistencia inducida (y menos separación del flap)", "Unloading the wing: less induced drag (and less flap separation)"], ["Menos fricción", "Less friction"], ["Menos área frontal del coche", "Less frontal area of the car"], ["Efectos de compresibilidad", "Compressibility effects"]], 0,
        "En un alerón muy cargado de AR ≈ 3, la inducida ∝ C_L² es la mayor parte de la resistencia del alerón.", "On a heavily loaded AR ≈ 3 wing, induced drag ∝ C_L² is most of the wing's drag."),
      Q("El beam wing aumenta la carga del suelo porque…", "The beam wing increases the floor's downforce because…",
        [["Baja la presión en la salida del difusor", "It lowers the pressure at the diffuser exit"], ["Empuja el coche hacia abajo con su peso", "Its weight pushes the car down"], ["Refrigera el difusor", "It cools the diffuser"], ["Bloquea el flujo bajo el suelo", "It blocks the flow under the floor"]], 0,
        "Menor presión de base ⇒ más velocidad y más succión en todo el suelo («extracción»).", "Lower base pressure ⇒ more velocity and more suction along the whole floor (“extraction”)."),
    ],
  },
  g1: {
    quiz: [
      Q("¿Por qué un ala invertida pierde carga muy cerca del suelo?", "Why does an inverted wing lose downforce very close to the ground?",
        [["La capa límite de la cara de succión se separa y bloquea el hueco bajo el borde de salida", "The suction-side boundary layer separates and blocks the gap under the trailing edge"], ["Porque el aire se comprime", "Because the air compresses"], ["Porque el suelo la empuja hacia arriba por contacto", "Because the ground pushes it up by contact"], ["Porque aumenta la resistencia inducida", "Because induced drag increases"]], 0,
        "Es la «force reduction» de Zerihan & Zhang: por debajo de h/c ≈ 0.1 la separación crece y anula la circulación extra que da el suelo.", "It is Zerihan & Zhang's “force reduction”: below h/c ≈ 0.1 separation grows and cancels the extra circulation the ground provides."),
    ],
  },
  g2: {
    quiz: [
      Q("El porpoising de los coches de efecto suelo se produce porque…", "Porpoising of ground-effect cars happens because…",
        [["Al bajar, el suelo entra en pérdida y pierde carga; el coche sube, el flujo se readhiere y el ciclo se repite", "Going down, the floor stalls and loses downforce; the car rises, the flow reattaches and the cycle repeats"], ["Por el viento lateral", "Because of crosswind"], ["Por la compresibilidad", "Because of compressibility"], ["Por el DRS", "Because of DRS"]], 0,
        "Una pendiente carga–altura que cambia de signo junto con la suspensión rígida da una oscilación autoexcitada.", "A downforce–height slope that changes sign, combined with stiff suspension, gives a self-excited oscillation."),
    ],
  },
  h1: {
    quiz: [
      Q("Con una tobera convergente-divergente bloqueada, si se baja aún más la presión de descarga, el gasto másico…", "With a choked converging-diverging nozzle, lowering the back pressure further makes the mass flow…",
        [["No cambia", "Stay the same"], ["Aumenta", "Increase"], ["Disminuye", "Decrease"], ["Oscila", "Oscillate"]], 0,
        "Con M = 1 en la garganta la información no remonta aguas arriba: ṁ = ṁ* depende solo de p0, T0 y A*.", "With M = 1 at the throat information cannot travel upstream: ṁ = ṁ* depends only on p0, T0 and A*."),
    ],
  },
  h2: {
    interview: [
      IV("¿Es relevante la compresibilidad en un F1?", "Is compressibility relevant on an F1 car?",
        "Ligeramente, y no se puede ignorar en el detalle. A 90 m/s el Mach libre es ≈ 0.26, pero bajo el suelo y en el borde de ataque de los alerones la velocidad local llega a Mach 0.5–0.6 (Cp ≈ −4 a −6). Allí la densidad cambia varios por ciento y el factor de Prandtl-Glauert amplifica los Cp; la carga real es unos puntos mayor que la incompresible a igual geometría. Por eso el CFD de F1 se hace compresible y la correlación con el túnel (a 50 m/s) debe corregirlo.",
        "Slightly, and it cannot be ignored in the detail. At 90 m/s the free-stream Mach number is ≈ 0.26, but under the floor and at the wings' leading edges the local velocity reaches Mach 0.5–0.6 (Cp ≈ −4 to −6). There density changes by several percent and the Prandtl-Glauert factor amplifies the Cp; the real downforce is a few points higher than the incompressible one for the same geometry. That is why F1 CFD is run compressible and why tunnel correlation (at 50 m/s) must correct for it."),
    ],
    quiz: [
      Q("La corrección de Prandtl-Glauert escala el Cp incompresible por…", "The Prandtl-Glauert correction scales the incompressible Cp by…",
        [["1/√(1 − M∞²)"], ["√(1 − M∞²)"], ["1 + M∞²"], ["1/(1 − M∞)"]], 0,
        "Válida para flujo subsónico y perturbaciones pequeñas; Kármán-Tsien mejora el resultado con Cp grandes.", "Valid for subsonic flow and small disturbances; Kármán-Tsien improves it for large Cp."),
      Q("El Mach crítico es el Mach de vuelo al que…", "The critical Mach number is the flight Mach number at which…",
        [["En algún punto de la superficie se alcanza M = 1 localmente", "M = 1 is first reached locally somewhere on the surface"], ["El flujo libre es sónico", "The free stream is sonic"], ["Aparece la pérdida", "Stall appears"], ["La resistencia es mínima", "Drag is minimal"]], 0,
        "Se obtiene cruzando la curva Cp_min(M) corregida con Cp*(M).", "It is found where the corrected Cp_min(M) curve crosses Cp*(M)."),
    ],
  },
  i1: {
    quiz: [
      Q("Con funciones de pared, la primera celda debe estar aproximadamente en…", "With wall functions, the first cell should be at roughly…",
        [["y⁺ ≈ 30–300"], ["y⁺ ≈ 1"], ["y⁺ ≈ 1000–5000"], ["Da igual", "It does not matter"]], 0,
        "En la zona logarítmica. Resolver la subcapa viscosa (low-Re) exige y⁺ ≈ 1.", "In the log region. Resolving the viscous sublayer (low-Re) needs y⁺ ≈ 1."),
      Q("El modelo k-ω SST…", "The k-ω SST model…",
        [["Combina k-ω cerca de la pared con k-ε lejos y limita la viscosidad turbulenta en gradientes adversos", "Blends k-ω near the wall with k-ε away from it and limits eddy viscosity in adverse gradients"], ["Es un LES", "Is an LES"], ["No necesita malla en la capa límite", "Needs no boundary-layer mesh"], ["Solo vale para flujo laminar", "Only works for laminar flow"]], 0,
        "Por eso es el estándar RANS en automoción: predice mejor la separación que k-ε.", "That is why it is the RANS standard in motorsport: it predicts separation better than k-ε."),
    ],
  },
  i2: {
    quiz: [
      Q("Un modelo al 60 % a la misma velocidad que el coche real tiene un número de Reynolds…", "A 60 % model at the same speed as the real car has a Reynolds number…",
        [["Un 40 % menor", "40 % lower"], ["Igual", "The same"], ["Un 60 % mayor", "60 % higher"], ["Un 64 % menor", "64 % lower"]], 0,
        "Re ∝ V L: 0.6 veces. Además el reglamento limita la velocidad del túnel, así que el Re es aún menor.", "Re ∝ V L: 0.6 times. The rules also cap tunnel speed, so Re is lower still."),
      Q("El bloqueo en un túnel de sección cerrada hace que las fuerzas medidas sean…", "Blockage in a closed-section tunnel makes the measured forces…",
        [["Mayores que en aire libre (hay que corregirlas a la baja)", "Higher than in free air (they must be corrected down)"], ["Menores que en aire libre", "Lower than in free air"], ["Iguales", "The same"], ["Imposibles de medir", "Impossible to measure"]], 0,
        "Las paredes estrechan el paso: la velocidad local alrededor del modelo es mayor que la nominal.", "The walls narrow the passage: the local velocity round the model is higher than nominal."),
    ],
  },
  i3: {
    interview: [
      IV("¿Cómo identificas separación y transición en un ensayo de flow-vis con aceite?", "How do you identify separation and transition in an oil flow-vis test?",
        "El aceite sigue las líneas de fricción. En la separación las líneas convergen y el aceite se acumula en una línea nítida; en el reanclaje divergen desde una línea. Una burbuja laminar aparece como una zona de aceite quieto o acumulado entre separación y reanclaje. La transición se ve porque la fricción turbulenta, mucho mayor, barre el aceite: hay un cambio claro de textura o de espesor de la película. Siempre se cruza con tomas de presión y CFD, y hay que vigilar que la gravedad o el propio aceite no falseen el patrón.",
        "Oil follows the skin-friction lines. At separation the lines converge and oil accumulates in a sharp line; at reattachment they diverge from a line. A laminar bubble shows as a band of still or pooled oil between separation and reattachment. Transition shows because the much higher turbulent friction sweeps the oil away: there is a clear change of texture or film thickness. It is always cross-checked with pressure taps and CFD, watching that gravity or the oil itself does not distort the pattern."),
    ],
    quiz: [
      Q("En una visualización con aceite, una línea de separación se reconoce porque las líneas de fricción…", "In an oil-flow picture, a separation line is recognised because the skin-friction lines…",
        [["Convergen y el aceite se acumula", "Converge and oil accumulates"], ["Divergen", "Diverge"], ["Son paralelas", "Are parallel"], ["Desaparecen", "Disappear"]], 0,
        "En el reanclaje ocurre lo contrario: divergen desde una línea.", "At reattachment the opposite happens: they diverge from a line."),
      Q("Los hilos de lana (tufts) indican flujo separado cuando…", "Tufts indicate separated flow when they…",
        [["Se agitan de forma irregular o apuntan hacia delante", "Flap irregularly or point upstream"], ["Están quietos y alineados", "Are still and aligned"], ["Cambian de color", "Change colour"], ["Se calientan", "Heat up"]], 0,
        "Un tuft alineado y estable indica flujo adherido.", "An aligned, steady tuft indicates attached flow."),
    ],
  },
  i4: {
    quiz: [
      Q("En un plano de CpT, una región con CpT ≈ 1 indica…", "In a CpT plane, a region with CpT ≈ 1 indicates…",
        [["Flujo sin pérdidas de presión total (como el libre)", "Flow without total-pressure losses (like the free stream)"], ["Un núcleo de vórtice", "A vortex core"], ["Una estela separada", "A separated wake"], ["Flujo supersónico", "Supersonic flow"]], 0,
        "Las estelas y los núcleos de vórtice aparecen con CpT bajo: ahí se ha perdido energía.", "Wakes and vortex cores show low CpT: energy has been lost there."),
      Q("Un criterio Q positivo indica que…", "A positive Q criterion indicates that…",
        [["La rotación domina a la deformación: núcleo de vórtice", "Rotation dominates strain: a vortex core"], ["Hay separación", "There is separation"], ["La presión total es máxima", "Total pressure is maximum"], ["El flujo es laminar", "The flow is laminar"]], 0,
        "Q = ½(‖Ω‖² − ‖S‖²): a diferencia de la vorticidad, no se activa en la cortadura pura de una capa límite.", "Q = ½(‖Ω‖² − ‖S‖²): unlike vorticity, it does not light up in the pure shear of a boundary layer."),
    ],
  },
  j1: {
    interview: [
      IV("¿Por qué una rueda que gira genera menos sustentación que una parada y por qué importa en el túnel?", "Why does a rotating wheel produce less lift than a stationary one and why does it matter in the tunnel?",
        "Con la rueda girando sobre un suelo móvil, la separación en la parte superior se adelanta y el flujo delante del contacto se expulsa lateralmente (jetting); Fackrell & Harvey midieron C_L de 0.76 a 0.44 y C_D de 0.77 a 0.58 al pasar de rueda parada a girando. La estela también cambia de forma y de posición. Como la estela de la rueda delantera alimenta todo el coche (suelo, pontones), un túnel sin ruedas girando y suelo móvil daría un flujo equivocado: por eso los túneles de F1 tienen ambos.",
        "With the wheel rotating on a moving ground, separation on top moves forward and the flow ahead of the contact patch is squeezed out sideways (jetting); Fackrell & Harvey measured C_L from 0.76 to 0.44 and C_D from 0.77 to 0.58 going from a stationary to a rotating wheel. The wake also changes shape and position. Since the front-wheel wake feeds the whole car (floor, sidepods), a tunnel without rotating wheels and a moving ground would give the wrong flow: that is why F1 tunnels have both."),
    ],
    quiz: [
      Q("Según Fackrell & Harvey, al hacer girar una rueda aislada en contacto con el suelo…", "According to Fackrell & Harvey, making an isolated wheel in ground contact rotate…",
        [["Bajan la sustentación y la resistencia", "Lowers lift and drag"], ["Suben la sustentación y la resistencia", "Raises lift and drag"], ["Solo cambia la resistencia", "Only changes drag"], ["No cambia nada", "Changes nothing"]], 0,
        "C_L 0.76 → 0.44 y C_D 0.77 → 0.58.", "C_L 0.76 → 0.44 and C_D 0.77 → 0.58."),
      Q("El «jetting» de un neumático es…", "Tyre “jetting” is…",
        [["El chorro lateral que sale delante de la huella de contacto", "The lateral jet squeezed out ahead of the contact patch"], ["El rebufo del coche de delante", "The slipstream of the car ahead"], ["La refrigeración de los frenos", "Brake cooling"], ["El flujo dentro de la llanta", "The flow inside the rim"]], 0,
        "La rueda y el suelo forman una cuña convergente que expulsa el aire hacia los lados y ensancha la estela.", "Wheel and ground form a converging wedge that squeezes air sideways and widens the wake."),
    ],
  },
  j2: {
    interview: [
      IV("¿Cómo eliges el nivel de alerón para un circuito?", "How do you choose the wing level for a circuit?",
        "Con un simulador de vuelta: cada nivel de alerón da un par (C_L·A, C_D·A); más carga gana tiempo en curvas lentas y medias y más resistencia lo pierde en rectas. En Mónaco casi todo el tiempo está en curvas lentas y se pone el máximo; en Monza las rectas mandan y se usa el mínimo. Además se mira la eficiencia (L/D) de cada nivel, el balance resultante, el consumo y la velocidad punta para adelantar o defender, y la sensibilidad del coche en aire sucio.",
        "With a lap simulator: each wing level gives a (C_L·A, C_D·A) pair; more downforce gains time in slow and medium corners and more drag loses it on straights. At Monaco nearly all the time is spent in slow corners and the maximum is used; at Monza the straights dominate and the minimum is used. You also check the efficiency (L/D) of each level, the resulting balance, fuel use and top speed for overtaking or defending, and how the car copes in dirty air."),
    ],
    quiz: [
      Q("El balance aerodinámico se define como…", "Aerodynamic balance is defined as…",
        [["La fracción de la carga total que va al eje delantero", "The fraction of total downforce on the front axle"], ["La relación L/D", "The L/D ratio"], ["La carga total", "Total downforce"], ["La resistencia del alerón trasero", "The rear wing's drag"]], 0,
        "Si el balance se va hacia delante, el coche tiende al sobreviraje; hacia atrás, al subviraje.", "If balance moves forward the car tends to oversteer; rearwards, to understeer."),
      Q("Un «mapa aerodinámico» es…", "An “aero map” is…",
        [["Las fuerzas y el balance en función de la altura delantera y trasera (y guiñada, balanceo, giro)", "Forces and balance as a function of front and rear ride height (and yaw, roll, steer)"], ["Un plano del circuito", "A circuit plan"], ["La distribución de Cp en el suelo", "The floor Cp distribution"], ["El campo de velocidades del CFD", "The CFD velocity field"]], 0,
        "Es la tabla que usa el simulador de vuelta y el ingeniero de pista para elegir alturas.", "It is the table the lap simulator and race engineer use to choose ride heights."),
      Q("En un circuito tipo Monza, el nivel de alerón óptimo suele ser…", "On a Monza-type circuit, the optimum wing level is usually…",
        [["Bajo", "Low"], ["Máximo", "Maximum"], ["Indiferente", "Irrelevant"], ["Siempre el de Mónaco", "Always the Monaco one"]], 0,
        "Las rectas largas penalizan la resistencia más de lo que la carga gana en las pocas curvas.", "Long straights penalise drag more than downforce gains in the few corners."),
    ],
  },
  j3: {
    interview: [
      IV("¿Cómo cambió el reglamento de 2022 la estela de los coches?", "How did the 2022 rules change the cars' wake?",
        "Se pasó de generar mucha carga con alerones y elementos superiores, que dejan una estela ancha y baja de vórtices sucios, a generarla sobre todo con el suelo Venturi. El difusor y el alerón trasero (con el beam wing) se diseñaron para lanzar la estela hacia arriba (upwash), por encima del coche que sigue, y se simplificaron los elementos que generaban vórtices laterales. La FIA/F1 estimaron la pérdida de carga a 20 m de 35 % en 2021 a unos 4 % en 2022 (10 m: 47 % → 18 %).",
        "Downforce moved from wings and upper bodywork, which leave a wide, low wake of dirty vortices, to the Venturi floor. The diffuser and rear wing (with the beam wing) were designed to throw the wake upwards (upwash), over the following car, and the devices that shed lateral vortices were simplified. F1/FIA estimated the downforce loss at 20 m to go from 35 % in 2021 to about 4 % in 2022 (10 m: 47 % → 18 %)."),
      IV("¿Por qué el rebufo ayuda en recta pero el aire sucio penaliza en curva?", "Why does the slipstream help on straights but dirty air hurt in corners?",
        "En recta, el coche de detrás va en el déficit de velocidad de la estela: menos presión dinámica, menos resistencia y más velocidad punta. En curva ese mismo déficit, la turbulencia y el cambio de ángulo del flujo reducen la carga (sobre todo del alerón delantero y del suelo, que dependen de flujo limpio) y desplazan el balance hacia atrás: subviraje, más deslizamiento de los neumáticos y más temperatura. El mismo fenómeno da y quita.",
        "On a straight, the following car is in the wake's velocity deficit: less dynamic pressure, less drag and more top speed. In a corner the same deficit, the turbulence and the change of flow angle cut downforce (especially the front wing and floor, which need clean flow) and shift the balance rearwards: understeer, more tyre sliding and more temperature. The same phenomenon gives and takes."),
    ],
    quiz: [
      Q("Según F1/FIA, a 20 m del coche de delante la pérdida de carga pasó de ~35 % (2021) a…", "According to F1/FIA, 20 m behind another car the downforce loss went from ~35 % (2021) to…",
        [["≈ 4 % (2022)"], ["≈ 30 %"], ["≈ 50 %"], ["0 %"]], 0,
        "A 10 m: 47 % → 18 %.", "At 10 m: 47 % → 18 %."),
      Q("El elemento que más sufre en aire sucio suele ser…", "The element that suffers most in dirty air is usually…",
        [["El alerón delantero (subviraje)", "The front wing (understeer)"], ["El motor", "The engine"], ["Los frenos traseros", "The rear brakes"], ["El alerón trasero (sobreviraje)", "The rear wing (oversteer)"]], 0,
        "Trabaja con flujo cerca del suelo y es muy sensible a la presión dinámica y la turbulencia que recibe.", "It works with flow close to the ground and is very sensitive to the dynamic pressure and turbulence it receives."),
      Q("El rebufo reduce la resistencia del coche de detrás porque…", "The slipstream reduces the following car's drag because…",
        [["Va en el déficit de velocidad de la estela: menor presión dinámica", "It runs in the wake's velocity deficit: lower dynamic pressure"], ["El aire está más frío", "The air is colder"], ["Aumenta su carga", "Its downforce increases"], ["Por compresibilidad", "Because of compressibility"]], 0,
        "D ∝ ½ρV_local²·C_D·A: con V_local menor, menos resistencia.", "D ∝ ½ρV_local²·C_D·A: lower V_local, less drag."),
    ],
  },
  j4: {
    interview: [
      IV("¿Qué guiñada ve un F1 en curva y por qué se mide en el túnel?", "What yaw does an F1 car see in a corner and why is it measured in the tunnel?",
        "El ángulo de deriva del coche en curva más el viento lateral dan del orden de 2–5° (más en curvas lentas con mucho deslizamiento). Pocos grados bastan para que el borde de barlovento del suelo pierda sellado, para que las estelas de las ruedas entren bajo el coche y para que el balance cambie. En el túnel se giran el modelo o la cinta para medir carga, balance, fuerza lateral y momentos de guiñada y balanceo en función de β, y se busca un coche poco sensible.",
        "The car's slip angle in a corner plus crosswind give about 2–5° (more in slow corners with a lot of sliding). A few degrees are enough for the floor's windward edge to lose its seal, for the wheel wakes to get under the car and for the balance to change. In the tunnel the model or belt is yawed to measure downforce, balance, side force and yaw and roll moments against β, and a low-sensitivity car is sought."),
      IV("¿Qué aporta la guiñada a la estabilidad direccional?", "What does yaw contribute to directional stability?",
        "Las superficies verticales detrás del centro de gravedad (endplates del alerón trasero, aletas) generan una fuerza lateral que, con su brazo, crea un momento de guiñada que realinea el coche con el flujo: efecto veleta. Si el centro de presión lateral está delante del CG el coche es aerodinámicamente inestable en guiñada. El balance de carga también cambia con β, así que el piloto nota un coche más o menos «nervioso» al entrar en curva.",
        "Vertical surfaces behind the centre of gravity (rear-wing endplates, fins) produce a side force that, with its lever arm, creates a yawing moment realigning the car with the flow: the weathercock effect. If the lateral centre of pressure is ahead of the CG the car is aerodynamically unstable in yaw. The downforce balance also changes with β, so the driver feels a more or less “nervous” car on corner entry."),
    ],
    quiz: [
      Q("En guiñada, la mitad del suelo que más carga pierde es…", "In yaw, the half of the floor that loses most downforce is…",
        [["La de barlovento", "The windward one"], ["La de sotavento", "The leeward one"], ["Las dos igual", "Both equally"], ["Ninguna", "Neither"]], 0,
        "Por el borde de barlovento entra flujo cruzado que debilita el vórtice de sellado.", "Crossflow enters through the windward edge and weakens the sealing vortex."),
      Q("La guiñada típica de un F1 en curva es del orden de…", "Typical yaw of an F1 car in a corner is of the order of…",
        [["2–5°"], ["20–30°"], ["0.01°"], ["45°"]], 0,
        "Ángulo de deriva más viento lateral; pocos grados ya cambian la carga y el balance.", "Slip angle plus crosswind; a few degrees already change downforce and balance."),
      Q("Para que el coche sea estable en guiñada (efecto veleta), el centro de presión lateral debe estar…", "For the car to be stable in yaw (weathercock), the lateral centre of pressure must be…",
        [["Detrás del centro de gravedad", "Behind the centre of gravity"], ["Delante del centro de gravedad", "Ahead of the centre of gravity"], ["En el eje delantero exacto", "Exactly on the front axle"], ["Es indiferente", "It does not matter"]], 0,
        "Así la fuerza lateral genera un momento que realinea el coche con el flujo.", "Then the side force creates a moment that realigns the car with the flow."),
    ],
  },
  j5: {
    interview: [
      IV("¿Qué es la resistencia de refrigeración y cómo se reduce?", "What is cooling drag and how is it reduced?",
        "Es la pérdida de cantidad de movimiento del aire que atraviesa los radiadores: ṁ(V∞ − V_salida) más la resistencia de la propia toma y de la carrocería ensanchada. Se reduce tomando solo el caudal necesario (relación de velocidades de entrada < 1 con difusor antes del radiador, porque Δp ∝ V²), sacando el aire por zonas de baja presión con la velocidad de salida lo más cercana a V∞, y aprovechando el calor añadido (efecto Meredith) para acelerar la salida. Cada configuración de refrigeración es un compromiso entre temperatura y tiempo por vuelta.",
        "It is the momentum loss of the air going through the radiators: ṁ(V∞ − V_exit) plus the drag of the inlet itself and of the widened bodywork. It is reduced by taking only the mass flow needed (inlet velocity ratio < 1 with a diffuser ahead of the radiator, because Δp ∝ V²), exhausting the air into low-pressure regions with the exit velocity as close to V∞ as possible, and using the added heat (Meredith effect) to accelerate the exit. Each cooling configuration is a compromise between temperature and lap time."),
      IV("¿Por qué se pone un difusor delante del radiador?", "Why is there a diffuser ahead of the radiator?",
        "La caída de presión a través del núcleo crece con V² y el intercambio de calor necesita tiempo de residencia: conviene que el aire atraviese el radiador lento (≈ 10–20 % de V∞). El difusor frena el aire recuperando presión estática antes del núcleo, de modo que con la misma presión disponible pasa el caudal necesario con menos pérdidas. Si el difusor es demasiado agresivo separa y el radiador recibe flujo no uniforme.",
        "The pressure drop across the core grows with V² and heat transfer needs residence time: the air should cross the radiator slowly (≈ 10–20 % of V∞). The diffuser slows the air and recovers static pressure ahead of the core, so the required mass flow passes with less loss for the same available pressure. Too aggressive a diffuser separates and the radiator gets non-uniform flow."),
    ],
    quiz: [
      Q("El efecto Meredith consiste en que…", "The Meredith effect is that…",
        [["El calor añadido en el radiador acelera el aire de salida y recupera parte de la resistencia (incluso empuje)", "Heat added in the radiator accelerates the exit air and recovers part of the drag (even thrust)"], ["El radiador enfría el motor", "The radiator cools the engine"], ["El aire se comprime en la toma", "Air is compressed at the inlet"], ["El rebufo refrigera mejor", "The slipstream cools better"]], 0,
        "Funciona como un estatorreactor muy débil: el aire calentado sale más rápido.", "It works like a very weak ramjet: heated air leaves faster."),
      Q("La caída de presión a través del núcleo de un radiador escala aproximadamente con…", "The pressure drop across a radiator core scales roughly with…",
        [["V²"], ["V"], ["1/V"], ["Es constante", "It is constant"]], 0,
        "Δp = K·½ρV²: por eso se frena el aire antes del núcleo.", "Δp = K·½ρV²: that is why the air is slowed ahead of the core."),
      Q("Para reducir la resistencia de refrigeración, el aire debe salir…", "To reduce cooling drag, the air should exit…",
        [["Con velocidad cercana a V∞ en una zona de baja presión", "At a velocity close to V∞ into a low-pressure region"], ["Lo más lento posible", "As slowly as possible"], ["Hacia el alerón delantero", "Towards the front wing"], ["Por el suelo, siempre", "Always through the floor"]], 0,
        "La resistencia es ṁ(V∞ − V_salida): cuanto menor la diferencia, menor la pérdida.", "Drag is ṁ(V∞ − V_exit): the smaller the difference, the smaller the loss."),
    ],
  },
  k1: {
    interview: [
      IV("¿Cuándo es importante la aerodinámica no estacionaria en un F1?", "When does unsteady aerodynamics matter on an F1 car?",
        "Cuando la frecuencia reducida k = ωc/(2V) supera ~0.05: las fuerzas ya no siguen instantáneamente al movimiento y aparecen retrasos de fase y cambios de amplitud (Theodorsen, Wagner). En un F1 pasa con el movimiento de la suspensión sobre baches y bordillos, el porpoising (oscilaciones de unos pocos Hz con cuerdas de suelo de metros), las estelas periódicas de las ruedas y el flameo de alerones flexibles. Ignorarlo puede convertir un sistema estable en uno autoexcitado.",
        "When the reduced frequency k = ωc/(2V) exceeds ~0.05: forces no longer follow the motion instantly and phase lags and amplitude changes appear (Theodorsen, Wagner). On an F1 car it happens with suspension motion over bumps and kerbs, porpoising (oscillations of a few Hz with floor chords of metres), periodic wheel wakes and flutter of flexible wings. Ignoring it can turn a stable system into a self-excited one."),
      IV("Explica la función de Wagner.", "Explain the Wagner function.",
        "Describe la sustentación de un perfil que arranca de golpe a un ángulo de ataque: justo al empezar se tiene la mitad de la sustentación estacionaria, y el resto llega a medida que el vórtice de arranque se aleja (≈ 90 % tras unas 10–15 semicuerdas recorridas). El retraso se debe a que el vórtice de arranque, de circulación opuesta a la ligada, induce en el perfil un downwash que disminuye al alejarse. Theodorsen es su equivalente en frecuencia para movimiento armónico.",
        "It describes the lift of an airfoil suddenly started at an angle of attack: at the start you get half the steady lift, and the rest arrives as the starting vortex moves away (≈ 90 % after about 10–15 semichords travelled). The lag is because the starting vortex, with circulation opposite to the bound one, induces on the airfoil a downwash that decreases as it moves away. Theodorsen is its frequency-domain equivalent for harmonic motion."),
    ],
    quiz: [
      Q("La frecuencia reducida se define como…", "The reduced frequency is defined as…",
        [["k = ωc/(2V)"], ["k = V/(ωc)"], ["k = ωV/c"], ["k = c/V"]], 0,
        "Por encima de ~0.05 el flujo deja de ser cuasiestacionario.", "Above ~0.05 the flow stops being quasi-steady."),
      Q("Justo después de un arranque impulsivo, la sustentación de Wagner vale…", "Right after an impulsive start, Wagner's lift is…",
        [["La mitad de la estacionaria", "Half the steady value"], ["Cero", "Zero"], ["La estacionaria", "The steady value"], ["El doble", "Double"]], 0,
        "Φ(0) = 0.5 y tiende a 1 al alejarse el vórtice de arranque.", "Φ(0) = 0.5 and tends to 1 as the starting vortex moves away."),
      Q("La función de Theodorsen C(k) tiene…", "Theodorsen's function C(k) has…",
        [["Módulo menor que 1 y un retraso de fase", "Magnitude below 1 and a phase lag"], ["Módulo mayor que 1", "Magnitude above 1"], ["Siempre fase nula", "Always zero phase"], ["Valor 0 a k = 0", "Value 0 at k = 0"]], 0,
        "C(0) = 1 (estacionario); al crecer k el módulo baja hacia 0.5 y aparece retraso.", "C(0) = 1 (steady); as k grows the magnitude falls towards 0.5 and a lag appears."),
    ],
  },
  k2: {
    interview: [
      IV("¿Cómo se diferencian divergencia y flameo y cómo se evitan?", "How do divergence and flutter differ and how are they avoided?",
        "La divergencia es estática: si el eje elástico está detrás del centro aerodinámico, la sustentación crea un momento que aumenta la torsión, que aumenta la sustentación… hasta la velocidad en que la rigidez aerodinámica iguala la estructural. El flameo es dinámico: los modos de flexión y torsión acoplados por la aerodinámica se acercan en frecuencia al aumentar la velocidad y uno pierde amortiguamiento (coalescencia). Se evitan con rigidez torsional, adelantando el eje elástico (divergencia) y adelantando el CG respecto al eje elástico con equilibrado másico (flameo). En F1 la FIA limita la deflexión de los alerones con ensayos de carga.",
        "Divergence is static: if the elastic axis is behind the aerodynamic centre, lift creates a moment that increases twist, which increases lift… up to the speed at which aerodynamic stiffness equals structural stiffness. Flutter is dynamic: the bending and torsion modes, coupled by the aerodynamics, approach each other in frequency as speed rises and one loses damping (coalescence). They are avoided with torsional stiffness, by moving the elastic axis forward (divergence) and by moving the CG ahead of the elastic axis with mass balancing (flutter). In F1 the FIA limits wing deflection with load tests."),
    ],
    quiz: [
      Q("La divergencia aparece cuando el eje elástico está…", "Divergence appears when the elastic axis is…",
        [["Detrás del centro aerodinámico", "Behind the aerodynamic centre"], ["Delante del centro aerodinámico", "Ahead of the aerodynamic centre"], ["En el borde de ataque exacto", "Exactly at the leading edge"], ["Es indiferente", "It does not matter"]], 0,
        "Entonces la sustentación crea un momento que aumenta la torsión: realimentación positiva.", "Then lift creates a moment that increases twist: positive feedback."),
      Q("El flameo clásico de flexión-torsión se produce por…", "Classical bending-torsion flutter is caused by…",
        [["La coalescencia de las frecuencias de flexión y torsión", "The coalescence of the bending and torsion frequencies"], ["Falta de rigidez en flexión solamente", "Lack of bending stiffness only"], ["Compresibilidad", "Compressibility"], ["La resistencia inducida", "Induced drag"]], 0,
        "Al juntarse, un modo extrae energía del flujo y su amortiguamiento se hace negativo.", "As they merge, one mode extracts energy from the flow and its damping becomes negative."),
      Q("Adelantar el centro de gravedad de la sección respecto al eje elástico…", "Moving the section's centre of gravity ahead of the elastic axis…",
        [["Aumenta la velocidad de flameo (equilibrado másico)", "Raises the flutter speed (mass balancing)"], ["La reduce", "Lowers it"], ["Provoca divergencia", "Causes divergence"], ["No influye", "Has no effect"]], 0,
        "Con x_θ ≤ 0 se desacoplan los modos y el flameo de la sección típica desaparece.", "With x_θ ≤ 0 the modes decouple and the typical section's flutter disappears."),
    ],
  },
};

/* Module definition with the extra items appended (never mutates the original). */
export function withExtras(mod, id) {
  const x = EXTRA[id];
  if (!x) return mod;
  return { ...mod, interview: [...(mod.interview || []), ...(x.interview || [])], quiz: [...(mod.quiz || []), ...(x.quiz || [])] };
}
