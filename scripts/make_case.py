"""Write the OpenFOAM (ESI, v2312+) case dictionaries for one run configuration.

usage: python make_case.py <case_dir> '<json config>'
config keys: name, h0 (base cell m), U (m/s), iters, iters1 (first-order iterations), layers,
             variant {front_rh_mm, rear_rh_mm}, nprocs, mesh_only,
             avg_iters (time-average p, U and the wall shear stress over the last N iterations; default
             500, 0 = last-iteration fields only)
"""
from __future__ import annotations

import json
import math
import os
import sys

HDR = """FoamFile
{{
    version     2.0;
    format      ascii;
    class       {cls};
    object      {obj};
}}
"""

SURF_LEVELS = {
    "fw_main": (6, 6), "fw_flaps": (6, 6), "fw_cascade": (6, 6), "fw_plates": (6, 6),
    "rw_main": (5, 6), "rw_flaps": (6, 6), "rw_plates": (5, 6),
    "floor": (6, 6), "sidewing": (6, 6),
    "body": (5, 5), "sidepods": (5, 5), "driver": (4, 5), "rollhoop": (5, 5),
    "wheels_front": (5, 5), "wheels_rear": (5, 5), "susp_front": (5, 5), "susp_rear": (5, 5),
}
LAYER_PARTS = ["fw_main", "fw_flaps", "fw_cascade", "rw_main", "rw_flaps", "floor", "body", "sidepods",
               "wheels_front", "wheels_rear", "fw_plates", "rw_plates", "sidewing", "driver"]

GROUPS = {
    "frontwing": ["fw_main", "fw_flaps", "fw_cascade", "fw_plates"],
    "fw_main": ["fw_main"], "fw_flaps": ["fw_flaps", "fw_cascade"], "fw_plates": ["fw_plates"],
    "rearwing": ["rw_main", "rw_flaps", "rw_plates"],
    "rw_main": ["rw_main"], "rw_flaps": ["rw_flaps"], "rw_plates": ["rw_plates"],
    "body": ["body"], "driver": ["driver", "rollhoop"], "sidepods": ["sidepods", "sidewing"],
    "floor": ["floor"], "wheels_front": ["wheels_front"], "wheels_rear": ["wheels_rear"],
    "suspension": ["susp_front", "susp_rear"],
}
ALL_PARTS = list(SURF_LEVELS)
WHEELS = [{"part": "wheels_front", "origin": [0.0, 0.62, 0.2225]}, {"part": "wheels_rear", "origin": [1.535, 0.62, 0.2225]}]
TYRE_R = 0.2285
BOXES = {
    "box_far": ((-2.0, 0, 0), (7.0, 1.6, 2.0), 2),
    "box_wake": ((-1.3, 0, 0), (4.0, 1.05, 1.5), 3),
    "box_near": ((-1.05, 0, 0), (2.4, 0.85, 0.45), 4),
    "box_rw": ((1.0, 0, 0.55), (2.7, 0.66, 1.35), 4),
    "box_floor": ((0.25, 0.05, 0), (1.42, 0.56, 0.06), 5),
    "box_fwgnd": ((-0.95, 0, 0), (-0.50, 0.73, 0.065), 5),
}
LOCATION = (5.1234, 1.8765, 2.3456)
PATCH_TYPES = {}     # part -> OpenFOAM patch type when not a wall (e.g. the radiator face / exit)
COOLING = None       # fixed-flow radiator: {"face_area", "exit_area", ...} from car.json
GAP_BOXES = {}       # name -> (lo, hi): boxes around the wings (car.json "gap_boxes"; gapLevel refinement only on request)
REFINE = {}          # name -> {"file", "level"}: closed surfaces around the slot gaps (car.json "refine_regions")
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def wall_layers(c):
    """Hybrid wall treatment (cfg wall = "hybrid"): {part: (n, first, ratio)} with absolute first-layer heights.
    Resolved parts (wings): first cell centre at y+ ~ yplus_resolved for the 90th-percentile friction velocity of the
    previous run, growing at ratio_resolved until the last layer is final_rel_resolved x the part's surface cell; the
    mesh keeps the last layer at final_rel_resolved x the LOCAL cell (firstAndRelativeFinal), so where the wing is
    refined further (slots, leading edges) the same layers grow more gently instead of collapsing.
    Other walls: first cell centre at y+ ~ yplus_wf for the median friction velocity, n_wf layers (wall functions).
    Returns {part: (n, first, ratio, final_rel or None)}. See geometry/wall_layers.json."""
    spec = json.load(open(os.path.join(ROOT, "geometry", "wall_layers.json")))
    spec.update(c.get("wall_layers_over", {}))     # per-case test values (e.g. final_rel_resolved)
    car = spec["cars"].get(c.get("car", ""), {"U_ref": 50.0, "resolved": [], "u": {}})
    nu = spec["nu"]
    scale = (c["U"] / car["U_ref"]) ** 0.9
    out = {}
    for p in LAYER_PARTS:
        u50, u90 = car["u"].get(p, [1.5, 2.5])
        u50, u90 = max(u50, 0.5) * scale, max(u90, 1.0) * scale
        cell = c["h0"] / 2 ** SURF_LEVELS[p][1]
        fr = None
        if p in car["resolved"]:
            first = 2.0 * spec["yplus_resolved"] * nu / u90
            r = spec["ratio_resolved"]
            fr = spec["final_rel_resolved"]
            n = 1 + math.ceil(math.log(fr * cell / first) / math.log(r))
            n = min(n, int(spec.get("n_max_resolved", n)))     # layer budget (transient cells of the layer addition)
        else:
            first = min(2.0 * spec["yplus_wf"] * nu / u50, spec["first_cap_rel"] * cell)
            r = spec["ratio_wf"]
            n = spec["n_wf"]
        out[p] = (int(n), float(first), float(r), fr)
    return out


def load_car(case):
    """Take parts, refinement levels, force groups, wheel axes and (optionally) the domain and
    refinement boxes from the geometry's car.json, so any car size can be meshed."""
    global SURF_LEVELS, LAYER_PARTS, GROUPS, ALL_PARTS, WHEELS, TYRE_R, X0, X1, Y1, Z1, BOXES, LOCATION, PATCH_TYPES, COOLING
    p = os.path.join(case, "constant", "triSurface", "car.json")
    if not os.path.exists(p):
        return
    car = json.load(open(p))
    if "levels" in car:
        SURF_LEVELS = {k: tuple(v) for k, v in car["levels"].items() if k in car["parts"]}
        ALL_PARTS = list(SURF_LEVELS)
        nol = set(car.get("no_layers", []))
        LAYER_PARTS = [k for k in ALL_PARTS if k not in nol]
        GROUPS = car["force_groups"]
        WHEELS = car["wheels"]
        TYRE_R = car["tyre_radius"]
    if "domain" in car:
        X0, X1, Y1, Z1 = car["domain"]
    if "boxes" in car:
        BOXES = {k: (tuple(v[0]), tuple(v[1]), int(v[2])) for k, v in car["boxes"].items()}
    if "location_in_mesh" in car:
        LOCATION = tuple(car["location_in_mesh"])
    PATCH_TYPES = {k: v for k, v in car.get("patch_types", {}).items() if k in ALL_PARTS}
    COOLING = car.get("cooling") if all(p in ALL_PARTS for p in ("radiator_in", "radiator_out")) else None
    global GAP_BOXES, REFINE
    GAP_BOXES = {k: (tuple(v[0]), tuple(v[1])) for k, v in car.get("gap_boxes", {}).items()}
    REFINE = {k: v for k, v in car.get("refine_regions", {}).items()
              if os.path.exists(os.path.join(case, "constant", "triSurface", v["file"]))}

# domain (half car, symmetry plane at y=0)
X0, X1, Y1, Z1 = -5.6, 12.0, 4.0, 4.0


def w(path, text):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", newline="\n") as fh:
        fh.write(text)


def block_mesh(c):
    h = c["h0"]
    nx, ny, nz = round((X1 - X0) / h), round(Y1 / h), round(Z1 / h)
    x1 = X0 + nx * h
    return HDR.format(cls="dictionary", obj="blockMeshDict") + f"""
scale 1;
vertices
(
    ({X0} 0 0) ({x1} 0 0) ({x1} {ny*h} 0) ({X0} {ny*h} 0)
    ({X0} 0 {nz*h}) ({x1} 0 {nz*h}) ({x1} {ny*h} {nz*h}) ({X0} {ny*h} {nz*h})
);
blocks ( hex (0 1 2 3 4 5 6 7) ({nx} {ny} {nz}) simpleGrading (1 1 1) );
edges ();
boundary
(
    inlet    {{ type patch; faces ((0 4 7 3)); }}
    outlet   {{ type patch; faces ((1 2 6 5)); }}
    ground   {{ type wall;  faces ((0 3 2 1)); }}
    top      {{ type patch; faces ((4 5 6 7)); }}
    side     {{ type patch; faces ((3 7 6 2)); }}
    ysym     {{ type symmetryPlane; faces ((0 1 5 4)); }}
);
mergePatchPairs ();
"""


LAYER_CTRL = {"nGrow": 0, "featureAngle": 130, "slipFeatureAngle": 30, "nRelaxIter": 3, "nSmoothSurfaceNormals": 1,
              "nSmoothNormals": 3, "nSmoothThickness": 10, "maxFaceThicknessRatio": 0.5, "maxThicknessToMedialRatio": 0.3,
              "minMedialAxisAngle": 90, "nBufferCellsNoExtrude": 0, "nLayerIter": 50, "nRelaxedIter": 20}
QUALITY_RELAXED = {"maxNonOrtho": 75}


def snappy(c):
    # per-case test values of the surface levels, e.g. {"frontwing": [6, 7]}: with min < max, resolveFeatureAngle
    # refines the leading/trailing edges of thin elements to the max level (also used by the feature edges and by
    # the cell size of wall_layers)
    for p, lv in c.get("levels_over", {}).items():
        if p in SURF_LEVELS:
            SURF_LEVELS[p] = tuple(int(v) for v in lv)
    geo = "\n".join(f"    {p}.stl {{ type triSurfaceMesh; name {p}; }}" for p in ALL_PARTS)
    boxes = BOXES
    geo += "\n" + "\n".join(f"    {n} {{ type searchableBox; min ({a[0]} {a[1]} {a[2]}); max ({b[0]} {b[1]} {b[2]}); }}"
                            for n, (a, b, _) in boxes.items())
    feats = "\n".join(f'        {{ file "{p}.eMesh"; level {SURF_LEVELS[p][1]}; }}' for p in ALL_PARTS)
    surfs = "\n".join(f"        {p} {{ level ({a} {b}); patchInfo {{ type {PATCH_TYPES.get(p, 'wall')}; }} }}" for p, (a, b) in SURF_LEVELS.items())
    regs = "\n".join(f"        {n} {{ mode inside; levels ((1e15 {lv})); }}" for n, (_, _, lv) in boxes.items())
    nl = c.get("layers", 3)
    layers = "\n".join(f'        "{p}" {{ nSurfaceLayers {nl}; }}' for p in LAYER_PARTS)
    hybrid = c.get("wall") == "hybrid"
    if hybrid:
        # absolute first-layer heights per part (y+ targets); slots between wing elements refined to >= 4 cells across
        wl = wall_layers(c)
        c["wall_layers"] = {p: {"n": n, "first_m": f, "ratio": r, **({"final_rel": fr} if fr else {})}
                            for p, (n, f, r, fr) in wl.items()}
        # resolved parts: first layer absolute, last layer relative to the local cell (the ratio adapts per point);
        # wall-function parts: first layer absolute with a fixed expansion
        layers = "\n".join(
            f'        "{p}" {{ nSurfaceLayers {n}; thicknessModel firstAndRelativeFinal; firstLayerThickness {f:.4g}; '
            f'finalLayerThickness {fr}; minThickness {0.5 * f:.4g}; }}' if fr else
            f'        "{p}" {{ nSurfaceLayers {n}; thicknessModel firstAndExpansion; firstLayerThickness {f:.4g}; '
            f'expansionRatio {r}; minThickness {0.5 * f:.4g}; }}' for p, (n, f, r, fr) in wl.items())
        # explicit slot regions (closed surfaces from the geometry build): level 7 in gaps < 15 mm, 8 in gaps < 6 mm
        lv_over = c.get("slot_levels", {})
        for name, d in REFINE.items():
            geo += f"\n    {d['file']} {{ type triSurfaceMesh; name {name}; }}"
            # distance mode: the slot surfaces of several zones overlap and are not one closed surface (inside mode
            # needs one); they hug the gaps, so every cell within a few mm of them is a slot cell
            dist = float(c.get("slot_dist", {}).get(name, 0.006 if name == "slots_wide" else 0.004))
            regs += f"\n        {name} {{ mode distance; levels (({dist} {int(lv_over.get(name, d['level']))})); }}"
        gmax = int(c.get("gap_max_level", 8))
        for name, (lo, hi) in (GAP_BOXES.items() if c.get("gap_refine") else []):
            geo += f"\n    {name} {{ type searchableBox; min ({lo[0]} {lo[1]} {lo[2]}); max ({hi[0]} {hi[1]} {hi[2]}); }}"
            wl_ = max([SURF_LEVELS[p][1] for p in ALL_PARTS if name.endswith(p)] or [6])
            gm = min(gmax, 7) if name.endswith("bargeboards") else gmax     # vanes 1-3 cm apart: one level less
            regs += f"\n        {name} {{ mode inside; levels ((1e15 0)); gapLevel (4 {wl_} {gm}); gapMode outside; }}"
    lay_glob = ("""    relativeSizes false;
    thicknessModel firstAndExpansion;
    firstLayerThickness 0.0005;
    expansionRatio 1.2;
    minThickness 0.0001;""" if hybrid else """    relativeSizes true;
    expansionRatio 1.25;
    finalLayerThickness 0.45;
    minThickness 0.08;""")
    # layer-addition controls: these defaults are the settings of every run up to p15; a case may override any of
    # them (or add others, e.g. nOuterIter) with "layer_ctrl", and the relaxed mesh quality (used by the layer
    # addition after nRelaxedIter iterations) with "quality_relaxed"
    lc = dict(LAYER_CTRL, **c.get("layer_ctrl", {}))
    lay_ctrl = "\n".join(f"    {k} {v};" for k, v in lc.items())
    relaxed = "\n".join(f"        {k} {v};" for k, v in dict(QUALITY_RELAXED, **c.get("quality_relaxed", {})).items())
    return HDR.format(cls="dictionary", obj="snappyHexMeshDict") + f"""
castellatedMesh true;
snap            true;
addLayers       {"true" if nl > 0 else "false"};

geometry
{{
{geo}
}}

castellatedMeshControls
{{
    maxLocalCells 4000000;
    maxGlobalCells 40000000;
    minRefinementCells 10;
    maxLoadUnbalance 0.10;
    nCellsBetweenLevels 3;
    features
    (
{feats}
    );
    refinementSurfaces
    {{
{surfs}
    }}
    resolveFeatureAngle 30;
    refinementRegions
    {{
{regs}
    }}
    locationInMesh ({LOCATION[0]} {LOCATION[1]} {LOCATION[2]});
    allowFreeStandingZoneFaces true;
}}

snapControls
{{
    nSmoothPatch 3;
    tolerance 2.0;
    nSolveIter 50;
    nRelaxIter 5;
    nFeatureSnapIter 10;
    implicitFeatureSnap false;
    explicitFeatureSnap true;
    multiRegionFeatureSnap false;
}}

addLayersControls
{{
    layers
    {{
{layers}
    }}
{lay_glob}
{lay_ctrl}
}}

meshQualityControls
{{
    maxNonOrtho 65;
    maxBoundarySkewness 20;
    maxInternalSkewness 4;
    maxConcave 80;
    minVol 1e-13;
    minTetQuality 1e-15;
    minArea -1;
    minTwist 0.02;
    minDeterminant 0.001;
    minFaceWeight 0.05;
    minVolRatio 0.01;
    minTriangleTwist -1;
    nSmoothScale 4;
    errorReduction 0.75;
    relaxed
    {{
{relaxed}
    }}
}}

mergeTolerance 1e-6;
"""


def feature_extract():
    items = "\n".join(f"""{p}.stl
{{
    extractionMethod    extractFromSurface;
    includedAngle       150;
    subsetFeatures {{ nonManifoldEdges no; openEdges yes; }}
    writeObj            no;
}}""" for p in ALL_PARTS)
    return HDR.format(cls="dictionary", obj="surfaceFeatureExtractDict") + "\n" + items + "\n"


def control(c):
    U = c["U"]
    fo = []
    for g, parts in GROUPS.items():
        pl = " ".join(parts)
        fo.append(f"""    forces_{g}
    {{
        type            forces;
        libs            (forces);
        writeControl    timeStep;
        writeInterval   1;
        log             false;
        patches         ({pl});
        rho             rhoInf;
        rhoInf          1.205;
        CofR            (0 0 0);
    }}""")
    fo.append(f"""    forces_total
    {{
        type            forces;
        libs            (forces);
        writeControl    timeStep;
        writeInterval   1;
        log             true;
        patches         ({" ".join(ALL_PARTS)});
        rho             rhoInf;
        rhoInf          1.205;
        CofR            (0 0 0);
    }}""")
    if COOLING:
        for pt in ("radiator_in", "radiator_out"):
            for nm, op, fl, extra in (("flux", "weightedSum", "U", "weightField     phi;"), ("Q", "sum", "phi", ""),
                                      ("p", "areaAverage", "p", "")):
                fo.append(f"""    cool_{nm}_{pt}
    {{
        type            surfaceFieldValue;
        libs            (fieldFunctionObjects);
        writeControl    timeStep;
        writeInterval   1;
        log             false;
        writeFields     false;
        regionType      patch;
        name            {pt};
        operation       {op};
        {extra}
        fields          ({fl});
    }}""")
    # time average over the last avg_iters iterations (fieldAverage -> pMean, UMean, wallShearStressMean):
    # unsteady wakes and partly stalled wing elements make the last-iteration surface fields jump from
    # one run to the next; the averaging needs the wall shear stress every iteration inside the window
    n_avg = min(int(c.get("avg_iters", 500)), max(0, (int(c["iters"]) - int(c.get("iters1", 0))) // 2))
    t_avg = int(c["iters"]) - n_avg
    wss_exec = (f"executeControl  timeStep;\n        timeStart       {t_avg};" if n_avg > 0
                else "executeControl  writeTime;")
    fo.append(f"""    yPlus
    {{
        type            yPlus;
        libs            (fieldFunctionObjects);
        executeControl  writeTime;
        writeControl    writeTime;
    }}
    wallShearStress
    {{
        type            wallShearStress;
        libs            (fieldFunctionObjects);
        {wss_exec}
        writeControl    writeTime;
    }}""")
    fo.append("""    vorticity
    {
        type            vorticity;
        libs            (fieldFunctionObjects);
        executeControl  writeTime;
        writeControl    writeTime;
    }
    Q
    {
        type            Q;
        libs            (fieldFunctionObjects);
        executeControl  writeTime;
        writeControl    writeTime;
    }""")
    if n_avg > 0:   # after wallShearStress: function objects run in this order every iteration
        fo.append(f"""    fieldAverage
    {{
        type            fieldAverage;
        libs            (fieldFunctionObjects);
        timeStart       {t_avg};
        writeControl    writeTime;
        fields
        (
            U               {{ mean on; prime2Mean off; base time; }}
            p               {{ mean on; prime2Mean off; base time; }}
            wallShearStress {{ mean on; prime2Mean off; base time; }}
        );
    }}""")
    return HDR.format(cls="dictionary", obj="controlDict") + f"""
application     simpleFoam;
startFrom       latestTime;
startTime       0;
stopAt          endTime;
endTime         {c['iters']};
deltaT          1;
writeControl    timeStep;
writeInterval   100000;
purgeWrite      1;
writeFormat     binary;
writePrecision  8;
writeCompression off;
timeFormat      general;
timePrecision   6;
runTimeModifiable true;

functions
{{
{chr(10).join(fo)}
}}
"""


def schemes(first_order):
    divU = "bounded Gauss upwind" if first_order else "bounded Gauss linearUpwind grad(U)"
    return HDR.format(cls="dictionary", obj="fvSchemes") + f"""
ddtSchemes {{ default steadyState; }}
gradSchemes
{{
    default         Gauss linear;
    grad(U)         cellLimited Gauss linear 1;
    grad(k)         cellLimited Gauss linear 1;
    grad(omega)     cellLimited Gauss linear 1;
}}
divSchemes
{{
    default         none;
    div(phi,U)      {divU};
    turbulence      bounded Gauss upwind;
    div(phi,k)      $turbulence;
    div(phi,omega)  $turbulence;
    div((nuEff*dev2(T(grad(U))))) Gauss linear;
    div(div(phi,U)) Gauss linear;
}}
laplacianSchemes {{ default Gauss linear limited corrected 0.33; }}
interpolationSchemes {{ default linear; }}
snGradSchemes {{ default limited corrected 0.33; }}
wallDist {{ method meshWave; }}
"""


def solution(simplec=False):
    """Stage 1 (and default): SIMPLE with strong under-relaxation. Stage 2 optionally SIMPLEC
    (consistent), which tolerates much larger relaxation and converges in far fewer iterations."""
    nl = chr(10)
    if simplec:
        algo = "    nNonOrthogonalCorrectors 0;" + nl + "    consistent      yes;"
        relax = "    equations   { U 0.85; k 0.7; omega 0.7; }"
    else:
        algo = "    nNonOrthogonalCorrectors 0;" + nl + "    consistent      no;"
        relax = "    fields      { p 0.3; }" + nl + "    equations   { U 0.7; k 0.6; omega 0.6; }"
    return HDR.format(cls="dictionary", obj="fvSolution") + f"""
solvers
{{
    p
    {{
        solver          GAMG;
        smoother        GaussSeidel;
        tolerance       1e-7;
        relTol          0.05;
        nCellsInCoarsestLevel 100;
        cacheAgglomeration on;
        mergeLevels     1;
    }}
    Phi {{ $p; relTol 0.01; }}
    "(U|k|omega)"
    {{
        solver          smoothSolver;
        smoother        GaussSeidel;
        nSweeps         2;
        tolerance       1e-8;
        relTol          0.1;
    }}
}}
SIMPLE
{{
{algo}
}}
potentialFlow
{{
    nNonOrthogonalCorrectors 6;
}}
relaxationFactors
{{
{relax}
}}
"""


def decompose(n):
    return HDR.format(cls="dictionary", obj="decomposeParDict") + f"""
numberOfSubdomains {n};
method          scotch;
"""


def fields(c):
    U = c["U"]
    k = 1.5 * (0.005 * U) ** 2
    om = k / (10 * 1.5e-5)
    wheels = ""
    for wdef in WHEELS:
        o = wdef["origin"]
        omega_w = U / wdef.get("radius", TYRE_R)
        wheels += f"""    {wdef['part']}
    {{
        type            rotatingWallVelocity;
        origin          ({o[0]} {o[1]} {o[2]});
        axis            (0 -1 0);
        omega           {omega_w:.4f};
    }}
"""
    walls_only = [p for p in ALL_PARTS if p not in PATCH_TYPES]
    car = "(" + "|".join(p for p in walls_only if not p.startswith("wheels")) + ")"
    allp = "(" + "|".join(ALL_PARTS) + ")"
    cU = ck = co = cn = ""
    if COOLING:
        # fixed-flow radiator: the duct end face is an outlet and the rear exit an inlet with the same
        # volumetric flow (half model), set from the face velocity ratio V_face / U
        ratio = float(c.get("cooling_ratio", COOLING.get("ratio", 0.25)))
        Q = ratio * U * COOLING["face_area"]
        Ve = Q / COOLING["exit_area"]
        ke = 1.5 * (0.05 * Ve) ** 2
        oe = ke ** 0.5 / (0.09 ** 0.25 * 0.01)
        c["cooling_Q_half"] = Q
        c["cooling_ratio"] = ratio
        # uniform outflow normal to the radiator face with the design flow rate: flowRateInletVelocity with a
        # negative flow rate and no profile extrapolation (flowRateOutletVelocity rescales the extrapolated profile,
        # which amplifies any recirculation at the duct end and diverged in the smoke test). A fixed face velocity
        # (surfaceNormalFixedValue) made the flow depend on the snapped patch area: the MP4/4 face meshed 30 % larger
        # than its STL and swallowed 30 % more air than re-entered at the exit.
        cU = f"""    radiator_in  {{ type flowRateInletVelocity; volumetricFlowRate {-Q:.6g}; extrapolateProfile false; value uniform ({ratio * U:.5g} 0 0); }}
    radiator_out {{ type flowRateInletVelocity; volumetricFlowRate {Q:.6g}; extrapolateProfile false; value uniform ({Ve:.5g} 0 0); }}
"""
        ck = f"""    radiator_in  {{ type zeroGradient; }}
    radiator_out {{ type fixedValue; value uniform {ke:.6g}; }}
"""
        co = f"""    radiator_in  {{ type zeroGradient; }}
    radiator_out {{ type fixedValue; value uniform {oe:.6g}; }}
"""
        cn = """    radiator_in  { type calculated; value uniform 0; }
    radiator_out { type calculated; value uniform 0; }
"""
    out = {}
    out["U"] = HDR.format(cls="volVectorField", obj="U") + f"""
dimensions      [0 1 -1 0 0 0 0];
internalField   uniform ({U} 0 0);
boundaryField
{{
    #includeEtc "caseDicts/setConstraintTypes"
    inlet   {{ type fixedValue; value uniform ({U} 0 0); }}
    outlet  {{ type inletOutlet; inletValue uniform (0 0 0); value uniform ({U} 0 0); }}
    ground  {{ type fixedValue; value uniform ({U} 0 0); }}
    top     {{ type slip; }}
    side    {{ type slip; }}
    "{car}" {{ type noSlip; }}
{wheels}{cU}}}
"""
    out["p"] = HDR.format(cls="volScalarField", obj="p") + f"""
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform 0;
boundaryField
{{
    #includeEtc "caseDicts/setConstraintTypes"
    inlet   {{ type zeroGradient; }}
    outlet  {{ type fixedValue; value uniform 0; }}
    ground  {{ type zeroGradient; }}
    top     {{ type slip; }}
    side    {{ type slip; }}
    "{allp}" {{ type zeroGradient; }}
}}
"""
    walls = "(ground|" + "|".join(walls_only) + ")"
    # hybrid walls (y+ ~ 1-5 on the wings, 30-100 elsewhere): omega blended between its viscous-sublayer and log-layer
    # values (Menter & Esch binomial blending), with Spalding's continuous law for nut - valid at any y+
    # (OpenFOAM ESI: blending stepwise | max | binomial (exponent n) | exponential | tanh; binomial with n 2 = Menter's)
    omb = "blending binomial; n 2; " if c.get("wall") == "hybrid" else ""
    out["k"] = HDR.format(cls="volScalarField", obj="k") + f"""
dimensions      [0 2 -2 0 0 0 0];
internalField   uniform {k:.6g};
boundaryField
{{
    #includeEtc "caseDicts/setConstraintTypes"
    inlet   {{ type fixedValue; value uniform {k:.6g}; }}
    outlet  {{ type inletOutlet; inletValue uniform {k:.6g}; value uniform {k:.6g}; }}
    top     {{ type slip; }}
    side    {{ type slip; }}
    "{walls}" {{ type kqRWallFunction; value uniform {k:.6g}; }}
{ck}}}
"""
    out["omega"] = HDR.format(cls="volScalarField", obj="omega") + f"""
dimensions      [0 0 -1 0 0 0 0];
internalField   uniform {om:.6g};
boundaryField
{{
    #includeEtc "caseDicts/setConstraintTypes"
    inlet   {{ type fixedValue; value uniform {om:.6g}; }}
    outlet  {{ type inletOutlet; inletValue uniform {om:.6g}; value uniform {om:.6g}; }}
    top     {{ type slip; }}
    side    {{ type slip; }}
    "{walls}" {{ type omegaWallFunction; {omb}value uniform {om:.6g}; }}
{co}}}
"""
    out["nut"] = HDR.format(cls="volScalarField", obj="nut") + f"""
dimensions      [0 2 -1 0 0 0 0];
internalField   uniform 0;
boundaryField
{{
    #includeEtc "caseDicts/setConstraintTypes"
    inlet   {{ type calculated; value uniform 0; }}
    outlet  {{ type calculated; value uniform 0; }}
    top     {{ type calculated; value uniform 0; }}
    side    {{ type calculated; value uniform 0; }}
    "{walls}" {{ type nutUSpaldingWallFunction; value uniform 0; }}
{cn}}}
"""
    return out


def main(case, cfg):
    c = {"U": 20.0, "iters": 1500, "iters1": 150, "layers": 3, "nprocs": 4, "h0": 0.16}
    c.update(cfg)
    load_car(case)
    w(f"{case}/system/blockMeshDict", block_mesh(c))
    w(f"{case}/system/snappyHexMeshDict", snappy(c))
    w(f"{case}/system/surfaceFeatureExtractDict", feature_extract())
    flds = fields(c)                      # first: sets the cooling flow in c
    w(f"{case}/system/controlDict", control(c))
    w(f"{case}/system/fvSchemes", schemes(first_order=False))
    w(f"{case}/system/fvSchemes.first", schemes(first_order=True))
    w(f"{case}/system/fvSchemes.second", schemes(first_order=False))
    w(f"{case}/system/fvSolution", solution())
    w(f"{case}/system/fvSolution.first", solution())
    w(f"{case}/system/fvSolution.second", solution(simplec=bool(c.get("simplec", True))))
    w(f"{case}/system/decomposeParDict", decompose(c["nprocs"]))
    w(f"{case}/constant/transportProperties", HDR.format(cls="dictionary", obj="transportProperties") +
      "\ntransportModel Newtonian;\nnu 1.5e-05;\n")
    w(f"{case}/constant/turbulenceProperties", HDR.format(cls="dictionary", obj="turbulenceProperties") +
      "\nsimulationType RAS;\nRAS\n{\n    RASModel kOmegaSST;\n    turbulence on;\n    printCoeffs on;\n}\n")
    for name, txt in flds.items():
        w(f"{case}/0.orig/{name}", txt)
    with open(f"{case}/run_config.json", "w") as fh:
        json.dump({**c, "groups": GROUPS, "parts": ALL_PARTS, "domain": [X0, X1, Y1, Z1], "cooling": COOLING}, fh, indent=1)


if __name__ == "__main__":
    main(sys.argv[1], json.loads(sys.argv[2]))
