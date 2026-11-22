"""2D wing-section runs (option B of the wing-separation diagnosis): gmsh mesh -> OpenFOAM case -> results.
Runs ON THE RUNNER only (never on a laptop).

usage: python sec2d_case.py mesh  <sections.json> <section id> <variant> <case dir>
       python sec2d_case.py setup <sections.json> <section id> <variant> <case dir> <iters>   (dictionaries)
       python sec2d_case.py fixb  <sections.json> <section id> <variant> <case dir>           (after gmshToFoam)
       python sec2d_case.py post  <sections.json> <section id> <variant> <case dir> <out dir>

The section (x, z of the car) is meshed in the x-y plane of a one-cell-thick slab (y here = z of the car, z = span):
  inlet (x = xmin - 4 m), outlet (xmax + 8 m), top (zmax + 4 m), bottom = moving ground at z = 0 for front wings,
  slip far field 4 m below for rear wings; free stream 50 m/s along +x, as the 3D runs.
Variants (same numerics as the 3D runs: k-omega SST, linearUpwind U, upwind turbulence, hybrid wall functions valid
at any y+ - nutUSpalding + omega binomial blending):
  bl      boundary-layer quads, first cell 8 um (y+ ~1), 0.4 mm along the wall
  iso     triangles of 0.1 mm at the wall growing 8 % (y+ ~5-20), no layers
  iso_sa  as iso with Spalart-Allmaras
  coarse  5.3 mm at the wall (the level-6 cell of the 3D wings), no layers
  iso_m5  as iso with the incidence 5 deg lower (geometry turned trailing edge down about the leading point)
"""
from __future__ import annotations

import glob
import json
import math
import os
import re
import sys

import numpy as np

U = 50.0
NU = 1.5e-5
DZ = 0.01
VARIANTS = {
    "bl": {"mesh": "bl", "model": "kOmegaSST", "dinc": 0.0},
    "iso": {"mesh": "iso", "model": "kOmegaSST", "dinc": 0.0},
    "iso_sa": {"mesh": "iso", "model": "SpalartAllmaras", "dinc": 0.0},
    "coarse": {"mesh": "coarse", "model": "kOmegaSST", "dinc": 0.0},
    "iso_m5": {"mesh": "iso", "model": "kOmegaSST", "dinc": -5.0},
    "bl_nofan": {"mesh": "bl", "model": "kOmegaSST", "dinc": 0.0, "fans": False},
    "bl_d": {"mesh": "bl", "model": "kOmegaSST", "dinc": 0.0, "fans": False, "alg": 5},
}
MESH = {  # wall size, growth slope of the size with distance, far size, wake size
    "bl": {"h": 4e-4, "slope": 0.08, "far": 0.25, "wake": 3e-3},
    "iso": {"h": 1e-4, "slope": 0.08, "far": 0.25, "wake": 3e-3},
    "coarse": {"h": 5.3e-3, "slope": 0.25, "far": 0.25, "wake": 1.06e-2},
}
BL = {"first": 8e-6, "ratio": 1.2, "thick_max": 2.5e-3}

HDR = """FoamFile
{{
    version     2.0;
    format      ascii;
    class       {cls};
    object      {obj};
}}
"""


def load(sections, sid):
    for s in json.load(open(sections)):
        if s["id"] == sid:
            return s
    raise SystemExit(f"section {sid} not found")


def rot(P, ang, pivot):
    a = math.radians(ang)
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    return (np.asarray(P, float) - pivot) @ R.T + pivot


def polys_of(sec, var):
    """Element outlines for this variant: incidence change dinc (deg, + = trailing edge up) about the leading point."""
    P = [np.asarray(p, float) for p in sec["polys_geo"]]
    d = VARIANTS[var]["dinc"]
    if d:
        piv = np.asarray(sec["pivot"], float)
        P = [rot(p, d, piv) for p in P]
    return P


def domain(sec):
    xs = [sec["xmin"], sec["xmax"]]
    x0, x1 = xs[0] - 4.0, xs[1] + 8.0
    y1 = sec["zmax"] + 4.0
    y0 = 0.0 if sec["ground"] else sec["zmin"] - 4.0
    return x0, x1, y0, y1


def sharp_convex(P, ang_min=50.0):
    """Indices of convex corners whose direction change is above ang_min degrees."""
    n = len(P)
    area = 0.5 * np.sum(P[:, 0] * np.roll(P[:, 1], -1) - np.roll(P[:, 0], -1) * P[:, 1])
    out = []
    for i in range(n):
        e1 = P[i] - P[i - 1]
        e2 = P[(i + 1) % n] - P[i]
        c = e1[0] * e2[1] - e1[1] * e2[0]
        cosv = np.dot(e1, e2) / (np.linalg.norm(e1) * np.linalg.norm(e2) + 1e-30)
        turn = math.degrees(math.acos(max(-1.0, min(1.0, cosv))))
        if turn > ang_min and np.sign(c) == np.sign(area):
            out.append(i)
    return out


def mesh(sec, var, case):
    import gmsh
    from shapely.geometry import Point, Polygon

    os.makedirs(case, exist_ok=True)
    mv = MESH[VARIANTS[var]["mesh"]]
    polys = polys_of(sec, var)
    x0, x1, y0, y1 = domain(sec)
    gmsh.initialize()
    gmsh.option.setNumber("General.Terminal", 1)
    gmsh.option.setNumber("General.NumThreads", 1)
    gmsh.model.add(sec["id"])
    geo = gmsh.model.geo
    big = 1.0
    c = [geo.addPoint(x0, y0, 0, big), geo.addPoint(x1, y0, 0, big), geo.addPoint(x1, y1, 0, big), geo.addPoint(x0, y1, 0, big)]
    outer = [geo.addLine(c[0], c[1]), geo.addLine(c[1], c[2]), geo.addLine(c[2], c[3]), geo.addLine(c[3], c[0])]
    loops = [geo.addCurveLoop(outer)]
    el_lines, el_pts, fans = [], [], []
    for P in polys:
        pts = [geo.addPoint(float(x), float(y), 0, big) for x, y in P]
        lines = [geo.addLine(pts[i], pts[(i + 1) % len(pts)]) for i in range(len(pts))]
        loops.append(geo.addCurveLoop(lines))
        el_lines.append(lines)
        el_pts.append(pts)
        fans += [pts[i] for i in sharp_convex(P)]
    surf = geo.addPlaneSurface(loops)
    ext = geo.extrude([(2, surf)], 0, 0, DZ, numElements=[1], recombine=True)
    geo.synchronize()

    allw = [l for ls in el_lines for l in ls]
    allp = [p for ps in el_pts for p in ps]
    fld = gmsh.model.mesh.field
    fd = fld.add("Distance")
    fld.setNumbers(fd, "CurvesList", allw)
    fld.setNumber(fd, "Sampling", 4)
    ft = fld.add("Threshold")
    fld.setNumber(ft, "InField", fd)
    fld.setNumber(ft, "SizeMin", mv["h"])
    fld.setNumber(ft, "SizeMax", mv["far"])
    fld.setNumber(ft, "DistMin", 0.0)
    fld.setNumber(ft, "DistMax", (mv["far"] - mv["h"]) / mv["slope"])
    fields = [ft]
    if fans and mv["h"] > 2e-4:                  # finer along the wall next to sharp corners
        fp = fld.add("Distance")
        fld.setNumbers(fp, "PointsList", fans)
        tp = fld.add("Threshold")
        fld.setNumber(tp, "InField", fp)
        fld.setNumber(tp, "SizeMin", max(mv["h"] / 4, 1e-4))
        fld.setNumber(tp, "SizeMax", mv["far"])
        fld.setNumber(tp, "DistMin", 0.0)
        fld.setNumber(tp, "DistMax", (mv["far"] - mv["h"] / 4) / mv["slope"])
        fields.append(tp)
    fb = fld.add("Box")                          # wake (an inverted wing throws it upwards)
    fld.setNumber(fb, "VIn", mv["wake"])
    fld.setNumber(fb, "VOut", mv["far"])
    fld.setNumber(fb, "XMin", sec["xmin"] - 0.05)
    fld.setNumber(fb, "XMax", sec["xmax"] + 0.6)
    fld.setNumber(fb, "YMin", max(y0, sec["zmin"] - 0.1))
    fld.setNumber(fb, "YMax", sec["zmax"] + 0.3)
    fld.setNumber(fb, "Thickness", 0.3)
    fields.append(fb)
    fm = fld.add("Min")
    fld.setNumbers(fm, "FieldsList", fields)
    fld.setAsBackgroundMesh(fm)
    gmsh.option.setNumber("Mesh.MeshSizeExtendFromBoundary", 0)
    gmsh.option.setNumber("Mesh.MeshSizeFromPoints", 0)
    gmsh.option.setNumber("Mesh.MeshSizeFromCurvature", 0)
    gmsh.option.setNumber("Mesh.Algorithm", VARIANTS[var].get("alg", 6))
    info = {"variant": var, "mesh": VARIANTS[var]["mesh"], "h_wall": mv["h"], "fans": len(fans)}
    if VARIANTS[var]["mesh"] == "bl":
        gaps = [g[2] for g in sec["gaps"]] + ([sec["zmin"]] if sec["ground"] else [])
        thick = min(BL["thick_max"], 0.3 * min(gaps)) if gaps else BL["thick_max"]
        fbl = fld.add("BoundaryLayer")
        fld.setNumbers(fbl, "CurvesList", allw)
        fld.setNumber(fbl, "Size", BL["first"])
        fld.setNumber(fbl, "Ratio", BL["ratio"])
        fld.setNumber(fbl, "Thickness", thick)
        fld.setNumber(fbl, "SizeFar", mv["h"])
        fld.setNumber(fbl, "Quads", 1)
        if fans and VARIANTS[var].get("fans", True):
            fld.setNumbers(fbl, "FanPointsList", fans)
        fld.setAsBoundaryLayer(fbl)
        info.update({"bl_first": BL["first"], "bl_ratio": BL["ratio"], "bl_thick": thick,
                     "bl_layers": int(math.ceil(math.log(1 + thick * (BL["ratio"] - 1) / BL["first"]) / math.log(BL["ratio"])))})

    # physical groups: lateral surfaces from their position (outer box sides, else the nearest element outline)
    top_s, vol = ext[0][1], ext[1][1]
    lat = [t for d, t in ext[2:] if d == 2]
    shp = [Polygon(P) for P in polys]
    groups = {"inlet": [], "outlet": [], "top": [], "bottom": []}
    for i in range(len(polys)):
        groups[f"e{i + 1}"] = []
    tol = 1e-6
    for t in lat:
        bx0, by0, _, bx1, by1, _ = gmsh.model.getBoundingBox(2, t)
        if abs(bx0 - x0) < tol and abs(bx1 - x0) < tol:
            groups["inlet"].append(t)
        elif abs(bx0 - x1) < tol and abs(bx1 - x1) < tol:
            groups["outlet"].append(t)
        elif abs(by0 - y1) < tol and abs(by1 - y1) < tol:
            groups["top"].append(t)
        elif abs(by0 - y0) < tol and abs(by1 - y0) < tol:
            groups["bottom"].append(t)
        else:
            pm = Point(0.5 * (bx0 + bx1), 0.5 * (by0 + by1))
            k = int(np.argmin([g.exterior.distance(pm) for g in shp]))
            groups[f"e{k + 1}"].append(t)
    gmsh.model.addPhysicalGroup(3, [vol], name="fluid")
    gmsh.model.addPhysicalGroup(2, [surf], name="front")
    gmsh.model.addPhysicalGroup(2, [top_s], name="back")
    names = {"bottom": "ground" if sec["ground"] else "farbottom"}
    for k, v in groups.items():
        if v:
            gmsh.model.addPhysicalGroup(2, v, name=names.get(k, k))
    try:
        gmsh.model.mesh.generate(3)
    except Exception as ex:
        print("gmsh generate failed:", ex, flush=True)
        raise
    gmsh.option.setNumber("Mesh.MshFileVersion", 2.2)
    gmsh.option.setNumber("Mesh.Binary", 0)
    gmsh.write(os.path.join(case, "mesh.msh"))
    types, tags, _ = gmsh.model.mesh.getElements(3)
    info["cells"] = int(sum(len(t) for t in tags))
    info["elements"] = len(polys)
    gmsh.finalize()
    json.dump(info, open(os.path.join(case, "mesh_info.json"), "w"), indent=1)
    print(json.dumps(info))


def fix_boundary(case, nel, ground):
    """gmshToFoam makes every patch a 'patch': front/back -> empty, wing elements and the ground -> wall."""
    p = os.path.join(case, "constant", "polyMesh", "boundary")
    s = open(p).read()
    walls = [f"e{i + 1}" for i in range(nel)] + (["ground"] if ground else [])

    def sub(name, typ, s):
        pat = re.compile(r"(\n\s*" + re.escape(name) + r"\s*\n\s*\{[^}]*?type\s+)(\w+)(;)", re.S)
        s2, n = pat.subn(lambda m: m.group(1) + typ + m.group(3), s)
        if typ == "empty":
            s2 = re.sub(r"(\n\s*" + re.escape(name) + r"\s*\n\s*\{[^}]*?)physicalType\s+\w+;", r"\1", s2, flags=re.S)
        return s2, n

    for name in ("front", "back"):
        s, _ = sub(name, "empty", s)
    for name in walls:
        s, n = sub(name, "wall", s)
        if not n:
            print("warning: patch", name, "not found")
    s = re.sub(r"inGroups\s+List<word>\s*\d*\s*\([^)]*\);", "", s)
    open(p, "w").write(s)


def setup(sec, var, case, iters):
    nel = len(sec["polys_geo"])
    model = VARIANTS[var]["model"]
    walls = "|".join([f"e{i + 1}" for i in range(nel)] + (["ground"] if sec["ground"] else []))
    k = 1.5 * (0.005 * U) ** 2
    om = k / (10 * NU)
    nut0 = 3 * NU
    far = "farbottom" if not sec["ground"] else None
    sl = f"    top {{ type slip; }}\n" + (f"    {far} {{ type slip; }}\n" if far else "")
    em = "    \"(front|back)\" { type empty; }\n"
    gU = f"    ground {{ type fixedValue; value uniform ({U} 0 0); }}\n" if sec["ground"] else ""
    els = "(" + "|".join(f"e{i + 1}" for i in range(nel)) + ")"

    def wfile(rel, txt):
        p = os.path.join(case, rel)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        open(p, "w").write(txt)

    wfile("0/U", HDR.format(cls="volVectorField", obj="U") + f"""
dimensions [0 1 -1 0 0 0 0];
internalField uniform ({U} 0 0);
boundaryField
{{
    inlet {{ type fixedValue; value uniform ({U} 0 0); }}
    outlet {{ type inletOutlet; inletValue uniform (0 0 0); value uniform ({U} 0 0); }}
{sl}{em}{gU}    "{els}" {{ type noSlip; }}
}}
""")
    wfile("0/p", HDR.format(cls="volScalarField", obj="p") + f"""
dimensions [0 2 -2 0 0 0 0];
internalField uniform 0;
boundaryField
{{
    inlet {{ type zeroGradient; }}
    outlet {{ type fixedValue; value uniform 0; }}
{sl}{em}    "({walls})" {{ type zeroGradient; }}
}}
""")
    wf_nut = "nutUSpaldingWallFunction"
    if model == "kOmegaSST":
        wfile("0/k", HDR.format(cls="volScalarField", obj="k") + f"""
dimensions [0 2 -2 0 0 0 0];
internalField uniform {k:.6g};
boundaryField
{{
    inlet {{ type fixedValue; value uniform {k:.6g}; }}
    outlet {{ type inletOutlet; inletValue uniform {k:.6g}; value uniform {k:.6g}; }}
{sl}{em}    "({walls})" {{ type kqRWallFunction; value uniform {k:.6g}; }}
}}
""")
        wfile("0/omega", HDR.format(cls="volScalarField", obj="omega") + f"""
dimensions [0 0 -1 0 0 0 0];
internalField uniform {om:.6g};
boundaryField
{{
    inlet {{ type fixedValue; value uniform {om:.6g}; }}
    outlet {{ type inletOutlet; inletValue uniform {om:.6g}; value uniform {om:.6g}; }}
{sl}{em}    "({walls})" {{ type omegaWallFunction; blending binomial; n 2; value uniform {om:.6g}; }}
}}
""")
    else:
        wfile("0/nuTilda", HDR.format(cls="volScalarField", obj="nuTilda") + f"""
dimensions [0 2 -1 0 0 0 0];
internalField uniform {nut0:.6g};
boundaryField
{{
    inlet {{ type fixedValue; value uniform {nut0:.6g}; }}
    outlet {{ type inletOutlet; inletValue uniform {nut0:.6g}; value uniform {nut0:.6g}; }}
{sl}{em}    "({walls})" {{ type fixedValue; value uniform 0; }}
}}
""")
    wfile("0/nut", HDR.format(cls="volScalarField", obj="nut") + f"""
dimensions [0 2 -1 0 0 0 0];
internalField uniform 0;
boundaryField
{{
    inlet {{ type calculated; value uniform 0; }}
    outlet {{ type calculated; value uniform 0; }}
{sl}{em}    "({walls})" {{ type {wf_nut}; value uniform 0; }}
}}
""")
    wfile("constant/transportProperties", HDR.format(cls="dictionary", obj="transportProperties") +
          f"\ntransportModel Newtonian;\nnu {NU};\n")
    wfile("constant/turbulenceProperties", HDR.format(cls="dictionary", obj="turbulenceProperties") +
          f"\nsimulationType RAS;\nRAS\n{{\n    RASModel {model};\n    turbulence on;\n    printCoeffs on;\n}}\n")
    turb = "k|omega" if model == "kOmegaSST" else "nuTilda"
    for first in (True, False):
        divU = "bounded Gauss upwind" if first else "bounded Gauss linearUpwind grad(U)"
        wfile("system/fvSchemes" + (".first" if first else ".second"), HDR.format(cls="dictionary", obj="fvSchemes") + f"""
ddtSchemes {{ default steadyState; }}
gradSchemes {{ default Gauss linear; grad(U) cellLimited Gauss linear 1; grad(k) cellLimited Gauss linear 1; grad(omega) cellLimited Gauss linear 1; grad(nuTilda) cellLimited Gauss linear 1; }}
divSchemes
{{
    default none;
    div(phi,U) {divU};
    turbulence bounded Gauss upwind;
    div(phi,k) $turbulence;
    div(phi,omega) $turbulence;
    div(phi,nuTilda) $turbulence;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
}}
laplacianSchemes {{ default Gauss linear limited corrected 0.33; }}
interpolationSchemes {{ default linear; }}
snGradSchemes {{ default limited corrected 0.33; }}
wallDist {{ method meshWave; }}
""")
    wfile("system/fvSolution", HDR.format(cls="dictionary", obj="fvSolution") + f"""
solvers
{{
    p {{ solver GAMG; smoother GaussSeidel; tolerance 1e-8; relTol 0.05; }}
    "(U|{turb})" {{ solver smoothSolver; smoother symGaussSeidel; nSweeps 2; tolerance 1e-9; relTol 0.1; }}
}}
SIMPLE {{ nNonOrthogonalCorrectors 1; consistent no; }}
relaxationFactors {{ fields {{ p 0.3; }} equations {{ U 0.7; {turb.replace('|', ' 0.6; ')} 0.6; }} }}
""")
    start_avg = int(iters * 2 / 3)
    patches = " ".join(f"e{i + 1}" for i in range(nel))
    fo = []
    for name, pl in [("forces_total", patches)] + [(f"forces_e{i + 1}", f"e{i + 1}") for i in range(nel)]:
        fo.append(f"""    {name}
    {{
        type forces; libs (forces); writeControl timeStep; writeInterval 1;
        patches ({pl}); rho rhoInf; rhoInf 1; CofR (0 0 0);
    }}""")
    fo.append(f"""    wallShearStress
    {{
        type wallShearStress; libs (fieldFunctionObjects); patches ({patches});
        executeControl timeStep; writeControl writeTime;
    }}""")
    fo.append(f"""    yPlus {{ type yPlus; libs (fieldFunctionObjects); executeControl writeTime; writeControl writeTime; }}""")
    fo.append(f"""    fieldAverage
    {{
        type fieldAverage; libs (fieldFunctionObjects); timeStart {start_avg}; writeControl writeTime;
        fields ( U {{ mean on; prime2Mean off; base time; }} p {{ mean on; prime2Mean off; base time; }}
                 wallShearStress {{ mean on; prime2Mean off; base time; }} );
    }}""")
    fo.append("""    residuals { type solverInfo; libs (utilityFunctionObjects); fields (U p); writeControl timeStep; writeInterval 10; }""")
    wfile("system/controlDict", HDR.format(cls="dictionary", obj="controlDict") + f"""
application simpleFoam;
startFrom latestTime;
startTime 0;
stopAt endTime;
endTime {iters};
deltaT 1;
writeControl timeStep;
writeInterval {iters // 3};
purgeWrite 2;
writeFormat ascii;
writePrecision 8;
timeFormat general;
runTimeModifiable true;
functions
{{
{chr(10).join(fo)}
}}
""")
    json.dump({"section": sec["id"], "variant": var, "iters": iters, "avg_from": start_avg, "model": model},
              open(os.path.join(case, "run_info.json"), "w"), indent=1)


def read_forces(case, name):
    fs = sorted(glob.glob(os.path.join(case, "postProcessing", name, "*", "force.dat")), key=lambda p: float(p.split(os.sep)[-2]))
    rows = {}
    for f in fs:
        for ln in open(f):
            if ln.startswith("#") or not ln.strip():
                continue
            v = [float(x) for x in re.sub(r"[()]", " ", ln).split()]
            rows[int(round(v[0]))] = v[1:4]
    it = np.array(sorted(rows))
    F = np.array([rows[i] for i in it]) if len(it) else np.zeros((0, 3))
    return it, F


def meshpic(sec, var, mb, png):
    """Mesh close-ups: leading edge of the first element and the narrowest slot (QA of the layers)."""
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    from matplotlib.collections import LineCollection
    from shapely.geometry import Polygon
    from shapely.ops import nearest_points

    polys = polys_of(sec, var)
    P0 = polys[0]
    spots = [("borde de ataque E1", P0[np.argmin(P0[:, 0])])]
    best = None
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            a, b = nearest_points(Polygon(polys[i]), Polygon(polys[j]))
            d = a.distance(b)
            if best is None or d < best[0]:
                best = (d, 0.5 * (np.array(a.coords[0]) + np.array(b.coords[0])), i, j)
    if best is not None:
        spots.append((f"ranura E{best[2] + 1}-E{best[3] + 1} ({best[0] * 1000:.1f} mm)", best[1]))
    sl = mb["internalMesh"].slice(normal="z", origin=(0, 0, 0.5 * DZ))
    edges = sl.extract_all_edges()
    pts = edges.points
    lines = edges.lines.reshape(-1, 3)[:, 1:]
    fig, axs = plt.subplots(1, len(spots), figsize=(6 * len(spots), 5), squeeze=False)
    for ax, (lab, c) in zip(axs[0], spots):
        w = 0.012
        m = (np.abs(pts[lines[:, 0], 0] - c[0]) < w) & (np.abs(pts[lines[:, 0], 1] - c[1]) < w)
        seg = pts[lines[m]][:, :, :2]
        ax.add_collection(LineCollection(seg, lw=0.25, color="k"))
        for P in polys:
            Q = np.vstack([P, P[:1]])
            ax.plot(Q[:, 0], Q[:, 1], color="C0", lw=0.8)
        ax.set_xlim(c[0] - w, c[0] + w)
        ax.set_ylim(c[1] - w, c[1] + w)
        ax.set_aspect("equal")
        ax.set_title(f"{sec['id']} · {var} · {lab}", fontsize=8)
        ax.tick_params(labelsize=6)
    fig.tight_layout()
    fig.savefig(png, dpi=110)
    plt.close(fig)


def post(sec, var, case, out):
    import pyvista as pv

    os.makedirs(out, exist_ok=True)
    ri = json.load(open(os.path.join(case, "run_info.json")))
    mi = json.load(open(os.path.join(case, "mesh_info.json")))
    nel = len(sec["polys_geo"])
    C = sec["xmax"] - sec["xmin"]
    q = 0.5 * U * U
    res = {"section": sec["id"], "variant": var, "mesh": mi, "run": ri, "chord": C, "forces": {}, "elements": []}
    for name in ["forces_total"] + [f"forces_e{i + 1}" for i in range(nel)]:
        it, F = read_forces(case, name)
        if not len(it):
            continue
        m = it >= ri["avg_from"]
        if not m.any():
            m = it >= it.max() * 2 // 3
        cl = -F[:, 1] / (q * C * DZ)          # downforce positive
        cd = F[:, 0] / (q * C * DZ)
        res["forces"][name.replace("forces_", "")] = {
            "Cl": float(cl[m].mean()), "Cl_std": float(cl[m].std()), "Cd": float(cd[m].mean()), "Cd_std": float(cd[m].std()),
            "last_iter": int(it.max()), "hist_it": it[::20].tolist(), "hist_Cl": cl[::20].round(4).tolist()}
    open(os.path.join(case, "case.foam"), "w").close()
    r = pv.OpenFOAMReader(os.path.join(case, "case.foam"))
    times = [t for t in r.time_values if t > 0]
    if not times:
        json.dump(res, open(os.path.join(out, f"{sec['id']}__{var}.json"), "w"))
        return
    r.set_active_time_value(times[-1])
    r.enable_all_patch_arrays()
    r.cell_to_point_creation = False
    mb = r.read()
    bnd = mb["boundary"]
    curves = {}
    for i in range(nel):
        nm = f"e{i + 1}"
        if nm not in bnd.keys():
            continue
        pt = bnd[nm].extract_surface().compute_normals(cell_normals=True, point_normals=False, auto_orient_normals=False,
                                                       consistent_normals=False)
        cc = pt.cell_centers().points
        nrm = np.asarray(pt.cell_data["Normals"])
        cd = pt.cell_data
        wss = np.asarray(cd["wallShearStressMean"] if "wallShearStressMean" in cd else cd.get("wallShearStress", np.zeros((len(cc), 3))))
        pm = np.asarray(cd["pMean"] if "pMean" in cd else cd["p"])
        ar = pt.compute_cell_sizes(length=False, volume=False).cell_data["Area"] / DZ
        # outward normal of the solid, whatever the face ordering: the side of the face that is not inside the outline
        from matplotlib.path import Path
        PP = Path(polys_of(sec, var)[i])
        inside = PP.contains_points(cc[:, :2] + 2e-5 * nrm[:, :2])
        n_out = np.where(inside[:, None], -nrm, nrm)
        suc = n_out[:, 1] < -0.2                   # facing the ground: suction side of an inverted wing
        rev = wss[:, 0] > 0                        # OpenFOAM: attached flow along +x gives wallShearStress_x < 0
        x_le = cc[:, 0].min()
        ce = float(cc[:, 0].max() - x_le)
        e = {"name": nm, "len_suction": float(ar[suc].sum()), "rev_suction": float(ar[suc & rev].sum() / max(ar[suc].sum(), 1e-12)),
             "rev_all": float(ar[rev].sum() / max(ar.sum(), 1e-12)),
             "first_sep_xc": float((cc[suc & rev, 0].min() - x_le) / max(ce, 1e-9)) if (suc & rev).any() else None,
             "Cp_min": float(pm.min() / q)}
        if "yPlus" in cd:
            yp = np.asarray(cd["yPlus"])
            e["yplus_p50"] = float(np.median(yp))
            e["yplus_p95"] = float(np.percentile(yp, 95))
        res["elements"].append(e)
        o = np.argsort(np.arctan2(cc[:, 1] - cc[:, 1].mean(), cc[:, 0] - cc[:, 0].mean()))
        curves[nm] = {"x": cc[o, 0].round(5).tolist(), "y": cc[o, 1].round(5).tolist(), "Cp": (pm[o] / q).round(4).tolist(),
                      "Cfx": (-wss[o, 0] / q).round(6).tolist(), "suc": suc[o].astype(int).tolist()}
    tot_s = sum(e["len_suction"] for e in res["elements"])
    res["rev_suction_total"] = float(sum(e["rev_suction"] * e["len_suction"] for e in res["elements"]) / max(tot_s, 1e-12))
    json.dump(res, open(os.path.join(out, f"{sec['id']}__{var}.json"), "w"))
    json.dump(curves, open(os.path.join(out, f"{sec['id']}__{var}__wall.json"), "w"))
    try:
        meshpic(sec, var, mb, os.path.join(out, f"{sec['id']}__{var}__mesh.png"))
    except Exception as ex:
        print("mesh picture failed:", ex)
    # Ux / U picture around the section (red = reversed flow)
    try:
        from scipy.interpolate import griddata
        import matplotlib
        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        im = mb["internalMesh"]
        cc = im.cell_centers().points
        u = np.asarray(im.cell_data["UMean"] if "UMean" in im.cell_data else im.cell_data["U"])[:, 0] / U
        bx0, bx1 = sec["xmin"] - 0.06, sec["xmax"] + 0.30
        by0, by1 = (max(0.0, sec["zmin"] - 0.07) if sec["ground"] else sec["zmin"] - 0.07), sec["zmax"] + 0.10
        sel = (cc[:, 0] > bx0 - 0.02) & (cc[:, 0] < bx1 + 0.02) & (cc[:, 1] > by0 - 0.02) & (cc[:, 1] < by1 + 0.02)
        gx, gy = np.meshgrid(np.linspace(bx0, bx1, 900), np.linspace(by0, by1, int(900 * (by1 - by0) / (bx1 - bx0))))
        G = griddata(cc[sel, :2], u[sel], (gx, gy), method="linear")
        from matplotlib.path import Path
        solid = np.zeros(gx.shape, bool)
        for P in polys_of(sec, var):
            solid |= Path(P).contains_points(np.c_[gx.ravel(), gy.ravel()]).reshape(gx.shape)
        rgb = plt.cm.Greys_r(np.clip(np.nan_to_num(G, nan=0) / 1.4, 0, 1))[..., :3] * 0.8 + 0.2
        rgb[np.nan_to_num(G, nan=1) < 0] = [0.84, 0.15, 0.16]
        rgb[solid] = [0.2, 0.4, 0.75]
        fig, ax = plt.subplots(figsize=(8, 8 * (by1 - by0) / (bx1 - bx0) + 0.6))
        ax.imshow(rgb, origin="lower", extent=[bx0, bx1, by0, by1], interpolation="nearest")
        f = res["forces"].get("total", {})
        ax.set_title(f"{sec['id']} · {var} · Cl {f.get('Cl', float('nan')):.2f} · invertido {res['rev_suction_total'] * 100:.0f} % succión", fontsize=9)
        ax.tick_params(labelsize=7)
        fig.tight_layout()
        fig.savefig(os.path.join(out, f"{sec['id']}__{var}.png"), dpi=100)
        plt.close(fig)
    except Exception as ex:
        print("picture failed:", ex)
    print(json.dumps({k: res[k] for k in ("section", "variant", "rev_suction_total")}), json.dumps(res["forces"].get("total", {}))[:200])


if __name__ == "__main__":
    cmd, sections, sid, var, case = sys.argv[1:6]
    sec = load(sections, sid)
    if cmd == "mesh":
        mesh(sec, var, case)
    elif cmd == "meshpic":
        import pyvista as pv
        open(os.path.join(case, "case.foam"), "w").close()
        rd = pv.OpenFOAMReader(os.path.join(case, "case.foam"))
        meshpic(sec, var, rd.read(), sys.argv[6])
    elif cmd == "fixb":
        fix_boundary(case, len(sec["polys_geo"]), sec["ground"])
    elif cmd == "setup":
        setup(sec, var, case, int(sys.argv[6]))
    elif cmd == "post":
        post(sec, var, case, sys.argv[6])
    else:
        sys.exit(__doc__)
