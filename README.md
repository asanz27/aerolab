# AeroLab · CFD de coches de competición (MFT02 de Formula Student y McLaren MP4/4)

Esta rama (`cfd`) contiene **solo** los casos de CFD que alimentan los casos de estudio de AeroLab
(`#/fs` MAD Formula Team MFT02, `#/f1` McLaren MP4/4). No se ejecuta nada pesado en local: todo el cálculo
corre en **GitHub Actions** (runners gratuitos para repositorios públicos) con software libre.

| Carpeta | Contenido |
|---|---|
| `geometry/build_mft02.py` | Modelo paramétrico del MFT02 (NumPy → STL cerrados por componente) |
| `geometry/build_mp44.py` | MP4/4 a partir de la maqueta CC BY 4.0 de Twan van Zuijdam (escalado, reorientado y dividido en componentes) |
| `scripts/make_case.py` | Genera el caso OpenFOAM (snappyHexMesh + simpleFoam k-ω SST, medio coche con simetría) |
| `scripts/run_case.sh` | Pipeline en el runner: malla → potentialFoam → simpleFoam (SIMPLE 1.er orden → SIMPLEC 2.º orden) → reconstrucción → postproceso |
| `scripts/postpro.py` | PyVista: superficie con Cp/Cf/y+, cortes, isosuperficies Q y Cpt=0, líneas de corriente → datos web compactos |
| `scripts/collect_web.py` | (local, ligero) baja los resultados `res-<caso>` a la carpeta de datos de la web y filtra las isosuperficies |
| `run.json` | Casos a lanzar; un commit con «[run]» en el mensaje dispara el workflow |

Resultados: ramas huérfanas `res-<caso>` (datos web + logs), progreso en vivo: `st-<caso>`.
No se usan *artifacts* de Actions.

## Recoger resultados en la web

```bash
python scripts/collect_web.py ../web/data/fs_mft02 baseline=base car=mft02 "mesh=m32:h0 = 0.32 m" "mesh=m26:h0 = 0.26 m" "mesh=base:h0 = 0.22 m" map=m26:ref map=rh_low:heave_low map=rh_high:heave_high map=dive:dive map=rake:rake
Q_WALL=0.012 python scripts/collect_web.py ../web/data/f1_mp44 baseline=mp44 car=mp44 "mesh=mp44_c:h0 = 0.40 m" "mesh=mp44:h0 = 0.30 m"
```

`Q_WALL` es la distancia a la pared por debajo de la cual se quitan las isosuperficies Q (capas límite); 25 mm por
defecto, 12 mm para el MP4/4 (coche más grande, vórtices con menos Q).

**Avisos:** el MFT02 es una reproducción a partir de fotos y datos públicos (FSG 2022), no el CAD del equipo.
El MP4/4 es una maqueta imprimible («McLaren MP4-4», Twan van Zuijdam, thingiverse:4498816, CC BY 4.0).
