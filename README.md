# AeroLab · CFD del Rennstall Esslingen Stallardo '25 (Formula Student)

Esta rama (`cfd`) contiene **solo** el caso de CFD que alimenta la sección «Caso de estudio FS» de AeroLab.
No se ejecuta nada pesado en local: todo el cálculo corre en **GitHub Actions** (runners gratuitos
para repositorios públicos) con software libre.

| Carpeta | Contenido |
|---|---|
| `geometry/` | Modelo paramétrico del coche (NumPy → STL cerrados por componente) |
| `scripts/make_case.py` | Genera el caso OpenFOAM (snappyHexMesh + simpleFoam k-ω SST, medio coche con simetría) |
| `scripts/run_case.sh` | Pipeline en el runner: malla → potentialFoam → simpleFoam (1.º y 2.º orden) → reconstrucción → postproceso |
| `scripts/postpro.py` | PyVista: superficie con Cp/Cf/y+, cortes, isosuperficies Q y Cpt=0, líneas de corriente → datos web compactos |
| `run.json` | Casos a lanzar; al cambiarlo en esta rama se dispara el workflow |

Resultados: ramas huérfanas `res-<caso>` (datos web + logs), progreso en vivo: `st-<caso>`.
No se usan *artifacts* de Actions.

**Aviso:** es una reproducción a partir de fotos y datos públicos (FSG 2025), no el CAD del equipo.
