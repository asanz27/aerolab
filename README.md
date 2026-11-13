# AeroLab · CFD de coches de competición

Esta rama (`cfd`) contiene **solo** los casos de CFD que alimentan los casos de estudio de AeroLab:
`#/fs` (MAD Formula Team MFT03) y `#/f1` (McLaren MP4/4 de 1988, McLaren MP4/23 de 2008, Red Bull RB12 de 2016,
McLaren MCL39 de 2025). No se ejecuta nada pesado en local: todo el cálculo corre en **GitHub Actions**
(runners gratuitos para repositorios públicos) con software libre (OpenFOAM, PyVista, NumPy/SciPy).

| Carpeta | Contenido |
|---|---|
| `geometry/build_mft03.py` | MFT03 a partir del CAD del equipo (17 sólidos cerrados) agrupado por regiones; el CAD **no** está en claro en el repositorio (ver abajo) |
| `geometry/build_mp44.py` | MP4/4 a partir de la maqueta CC BY 4.0 de Twan van Zuijdam (escalado, reorientado y dividido en componentes) |
| `geometry/build_glb.py` | Modelos visuales (MP4/23, RB12, MCL39): escalado con el reglamento de su época, envolvente por vóxeles (*surface wrapping*), regiones por posición |
| `scripts/make_case.py` | Genera el caso OpenFOAM (snappyHexMesh + simpleFoam k-ω SST, medio coche con simetría, suelo móvil, ruedas girando) |
| `scripts/run_case.sh` | Pipeline en el runner: malla → potentialFoam → simpleFoam (SIMPLE 1.er orden → SIMPLEC 2.º orden) → reconstrucción → postproceso; hasta 3 trabajos de 6 h encadenados |
| `scripts/postpro.py` | PyVista: superficie con Cp/Cf/y+, cortes, isosuperficies Q y Cpt=0 → datos web compactos |
| `scripts/collect_web.py` | (local, ligero) baja los resultados `res-<caso>` a la carpeta de datos de la web y filtra las isosuperficies |
| `scripts/make_figs.py` | (local, matplotlib) figuras estáticas de las estructuras de flujo para el análisis de cada coche |
| `run.json` | Casos a lanzar; un commit con «[run]» en el mensaje dispara el workflow |

Resultados: ramas huérfanas `res-<caso>` (datos web + logs); progreso en vivo: `st-<caso>`.

## Trabajos encadenados

Un trabajo de Actions dura como mucho 6 h. Con `"stages": 2` o `3` en `run.json`, el solver guarda el estado
(`writeNow`) antes del límite, lo comprime (tar + zstd) y lo pasa como *artifact* (2 días de retención) al
trabajo siguiente, que continúa las iteraciones. Solo el último trabajo reconstruye, postprocesa y publica.

## Geometría privada (`"private": true`)

El CAD del MFT03 y las mallas originales de los modelos visuales están cifrados con AES-256 en ramas `cad-<coche>`.
La clave nunca está en el repositorio:

- si existe el secreto de repositorio `CAD_KEY`, se usa directamente;
- si no, el runner genera un par RSA, publica su clave pública en `kx-<caso>-s<etapa>-<run>` y espera la clave
  cifrada (RSA-OAEP-SHA256) en `kr-…`, que responde un proceso local del propietario. Las ramas se borran después.

Los estados intermedios de los casos privados también se cifran. Lo que sí se publica es la superficie decimada
de los resultados (la que muestra la web).

## Recoger resultados en la web

```bash
python scripts/collect_web.py ../web/data/fs_mft03 baseline=f03_m4 car=mft03 "mesh=f03_m1:h0 = 0.30 m" "mesh=f03_m2:h0 = 0.25 m" "mesh=f03_m3:h0 = 0.21 m" "mesh=f03_m4:h0 = 0.18 m" map=f03_m3:ref map=f03_rhl21:heave_low map=f03_rhh21:heave_high map=f03_dive21:dive map=f03_rake21:rake
Q_WALL=0.012 python scripts/collect_web.py ../web/data/f1_mp44 baseline=p44_m4 car=mp44 "mesh=mp44_c:h0 = 0.40 m" "mesh=mp44:h0 = 0.30 m" "mesh=p44_m3:h0 = 0.25 m" "mesh=p44_m4:h0 = 0.22 m"
python scripts/collect_web.py ../web/data/f1_mp423 baseline=mp423_f car=mp423 "mesh=mp423_c:h0 = 0.34 m" "mesh=mp423_m:h0 = 0.29 m" "mesh=mp423_f:h0 = 0.25 m"
python scripts/make_figs.py ../web/data/f1_mp423/mp423_f ../web/data/f1_mp423/figs
```

El mapa aerodinámico del MFT03 se calcula con la malla h0 = 0,21 m: en las mallas más gruesas (0,30 y 0,25 m) el flujo
del alerón delantero se despega a la altura nominal y en las finas (0,21 y 0,18 m) no, así que el mapa en la malla de 0,25 m
confundía el efecto de la altura con el de la resolución.

`Q_WALL` es la distancia a la pared por debajo de la cual se quitan las isosuperficies Q (capas límite); 25 mm por
defecto, 12 mm para el MP4/4 (coche más grande, vórtices con menos Q).

## Fuentes y licencias

- **MFT03**: geometría aportada por un miembro del MAD Formula Team (UC3M). No se redistribuye.
- **MP4/4**: «McLaren MP4-4», Twan van Zuijdam, thingiverse:4498816, CC BY 4.0.
- **MP4/23**: «2008 Mclaren MP4/23» (https://skfb.ly/pKX8v) de Dave Love SketchFab, CC BY 4.0.
- **RB12**: «2016 Redbull RB12» de Dave Love SketchFab, CC BY 4.0.
- **MCL39**: «2025 McLaren MCL39» de Abu Saif, CC BY 4.0.

Cambios en los modelos: escalado, envolvente, división en regiones; superficie remallada y coloreada con resultados CFD.
Los modelos visuales no son el CAD de los equipos: alerones, ranuras, fondo y difusor son aproximados.
