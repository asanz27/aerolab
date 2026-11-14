"""Post-process a finished OpenFOAM run into compact web data (runs on the CI runner, not locally).

usage: python postpro.py <case_dir> <out_dir> '<json config>'

Writes into <out_dir>/web:
  meta.json            forces per component, convergence, mesh/y+ stats, field ranges, catalogues
  surface.fsb.gz       display surface (half car, y>=0) with Cp, Cf, Cfx, y+ per vertex
  slices/{x,y,z}_NNN_<field>.png   8-bit field maps on planes (0 = solid / no data)
  slices/x_NNN_vec.png RGB in-plane velocity (R=Vy, G=Vz) for cross-flow vectors
  iso_<name>.fsb.gz    iso-surfaces (Q-criterion, Cpt = 0) with colouring fields
  streams.fsb.gz       stream lines (quantised positions + speed)
  lines.json           wing section Cp, under-floor Cp, ...
"""
from __future__ import annotations

import glob
import gzip
import json
import math
import os
import re
import sys
import time
import traceback

import numpy as np

T0 = time.time()
LOG = []


def log(*a):
    s = f"[{time.time()-T0:7.1f}s] " + " ".join(str(x) for x in a)
    print(s, flush=True)
    LOG.append(s)


# ---------------------------------------------------------------------------------------------
# binary container: 'FSB1' + u32 header length + JSON header + 4-byte aligned buffers
# ---------------------------------------------------------------------------------------------
def write_fsb(path, buffers: dict, extra: dict | None = None):
    hdr = {"buffers": [], **(extra or {})}
    blobs = []
    off = 0
    for name, (arr, meta) in buffers.items():
        arr = np.ascontiguousarray(arr)
        b = arr.tobytes()
        pad = (-len(b)) % 4
        hdr["buffers"].append({"name": name, "dtype": arr.dtype.str.lstrip("<|"), "count": int(arr.size),
                               "offset": off, **(meta or {})})
        blobs.append(b + b"\0" * pad)
        off += len(b) + pad
    hj = json.dumps(hdr, separators=(",", ":")).encode()
    hj += b" " * ((-len(hj)) % 4)
    raw = b"FSB1" + np.uint32(len(hj)).tobytes() + hj + b"".join(blobs)
    with gzip.open(path, "wb", compresslevel=9) as fh:
        fh.write(raw)
    return os.path.getsize(path)


def quant(a, lo, hi, dtype=np.uint16):
    m = np.iinfo(dtype).max
    q = np.clip((np.asarray(a, float) - lo) / (hi - lo + 1e-30), 0, 1) * m
    return np.round(q).astype(dtype)


def qpos(P):
    lo = P.min(0)
    hi = P.max(0)
    return quant(P, lo, hi).reshape(-1), {"min": lo.round(6).tolist(), "max": hi.round(6).tolist()}


# ---------------------------------------------------------------------------------------------
# forces / logs
# ---------------------------------------------------------------------------------------------
def read_dat(pattern):
    """Concatenate OpenFOAM postProcessing .dat files (several restart folders)."""
    files = sorted(glob.glob(pattern), key=lambda p: float(p.split(os.sep)[-2]) if re.match(r"^[\d.e+-]+$", p.split(os.sep)[-2]) else 0)
    rows = {}
    cols = None
    for f in files:
        with open(f) as fh:
            for line in fh:
                if line.startswith("#"):
                    h = line[1:].split()
                    if h and h[0] == "Time":
                        cols = h
                    continue
                v = line.replace("(", " ").replace(")", " ").split()
                if not v:
                    continue
                try:
                    vals = [float(x) for x in v]
                except ValueError:
                    continue
                rows[vals[0]] = vals
    if not rows:
        return None, None
    t = sorted(rows)
    return cols, np.array([rows[k] for k in t])


def cooling_flux(case, car):
    """Momentum flux sum(phi U) through the fixed-flow radiator patches (half model, m^4/s^2) with the
    patch centroids: the air leaving at the radiator face and re-entering at the exit is internal flow of
    the car, so its momentum change is a force on the car (cooling drag) that the wall forces miss."""
    cool = car.get("cooling")
    if not cool:
        return []
    out = []
    for pt, key in (("radiator_in", "face_centroid"), ("radiator_out", "exit_centroid")):
        _, A = read_dat(os.path.join(case, "postProcessing", f"cool_flux_{pt}", "*", "surfaceFieldValue.dat"))
        if A is None or A.shape[1] < 4:
            return []
        out.append((A[:, 0], A[:, 1:4], np.asarray(cool[key], float)))
    return out


def cooling_summary(case, cfg, car):
    cool = car.get("cooling")
    if not cool:
        return None
    U = cfg["U"]
    res = {k: cool[k] for k in ("face_area", "exit_area", "inlet_area", "duct_depth") if k in cool}
    for pt in ("radiator_in", "radiator_out"):
        for nm in ("Q", "p"):
            pat = os.path.join(case, "postProcessing", f"cool_{nm}_{pt}", "*", "surfaceFieldValue.dat")
            _, A = read_dat(pat)
            if A is not None:
                nav = max(1, int(0.2 * len(A)))
                res[f"{nm}_{pt}"] = float(A[-nav:, 1].mean())
            for f in sorted(glob.glob(pat))[:1]:          # patch area on the mesh (header line "# Area : ...")
                for line in open(f):
                    if line.startswith("# Area"):
                        res[f"mesh_area_{pt}"] = float(line.split(":")[1])
                        break
    if "Q_radiator_in" in res:
        res["Q_full_m3s"] = 2 * res["Q_radiator_in"]
        res["face_velocity_ratio"] = res["Q_radiator_in"] / (res.get("mesh_area_radiator_in", cool["face_area"]) * U)
        res["exit_velocity_ratio"] = -res.get("Q_radiator_out", -res["Q_radiator_in"]) / (res.get("mesh_area_radiator_out", cool["exit_area"]) * U)
    for pt in ("radiator_in", "radiator_out"):
        if f"p_{pt}" in res:
            res[f"Cp_{pt}"] = res[f"p_{pt}"] / (0.5 * U * U)
    return res


def forces(case, cfg, car):
    U = cfg["U"]
    rho = 1.205
    q = 0.5 * rho * U * U
    wb = car["wheelbase"]
    out = {}
    hist = {}
    flux = cooling_flux(case, car)
    for d in sorted(glob.glob(os.path.join(case, "postProcessing", "forces_*"))):
        g = os.path.basename(d)[len("forces_"):]
        cf, F = read_dat(os.path.join(d, "*", "force.dat"))
        cm, M = read_dat(os.path.join(d, "*", "moment.dat"))
        if F is None:
            continue
        n = min(len(F), len(M)) if M is not None else len(F)
        it = F[:n, 0]
        Fx, Fy, Fz = 2 * F[:n, 1], 0 * F[:n, 2], 2 * F[:n, 3]   # half model -> full car
        Fpx, Fpz = 2 * F[:n, 4], 2 * F[:n, 6]
        Fvx, Fvz = 2 * F[:n, 7], 2 * F[:n, 9]
        My = 2 * M[:n, 2] if M is not None else np.zeros(n)
        Fmx = np.zeros(n)
        if flux and g in ("cooling", "total"):
            Fmz = np.zeros(n)
            for itf, Phi, cen in flux:
                px, pz = (np.interp(it, itf, Phi[:, j]) for j in (0, 2))
                Fmx += 2 * rho * px
                Fmz += 2 * rho * pz
                My += 2 * rho * (cen[2] * px - cen[0] * pz)
            Fx, Fz = Fx + Fmx, Fz + Fmz
        ClA = -Fz / q
        CdA = Fx / q
        L_r = My / wb          # rear-axle share of the aero load (+ = downwards)
        D = -Fz
        nav = max(1, int(0.2 * n))
        sl = slice(n - nav, n)
        out[g] = {
            "ClA": float(ClA[sl].mean()), "CdA": float(CdA[sl].mean()),
            "ClA_std": float(ClA[sl].std()), "CdA_std": float(CdA[sl].std()),
            "downforce_N": float(D[sl].mean()), "drag_N": float(Fx[sl].mean()),
            "ClA_front": float(((D - L_r) / q)[sl].mean()), "ClA_rear": float((L_r / q)[sl].mean()),
            "CdA_pressure": float((Fpx / q)[sl].mean()), "CdA_viscous": float((Fvx / q)[sl].mean()),
            "CdA_momentum": float((Fmx / q)[sl].mean()),
            "ClA_pressure": float((-Fpz / q)[sl].mean()), "ClA_viscous": float((-Fvz / q)[sl].mean()),
            "avg_window": [float(it[n - nav]), float(it[-1])],
        }
        if g == "total":
            out[g]["balance_front"] = float(((D - L_r) / np.where(np.abs(D) > 1e-9, D, 1e-9))[sl].mean())
            step = max(1, n // 600)
            hist = {"iter": it[::step].tolist(), "ClA": np.round(ClA[::step], 4).tolist(),
                    "CdA": np.round(CdA[::step], 4).tolist(),
                    "balance": np.round(((D - L_r) / np.where(np.abs(D) > 1e-9, D, 1e-9))[::step], 4).tolist()}
    return out, hist, q


def residuals(case):
    res = {}
    it = 0
    for lf in sorted(glob.glob(os.path.join(case, "log.simpleFoam*"))):
        with open(lf, errors="ignore") as fh:
            for line in fh:
                if line.startswith("Time = "):
                    try:
                        it = float(line.split()[2])
                    except Exception:
                        pass
                m = re.search(r"Solving for (\w+), Initial residual = ([\deE.+-]+)", line)
                if m:
                    f = m.group(1)
                    d = res.setdefault(f, {})
                    if it not in d:
                        d[it] = float(m.group(2))
    out = {}
    for f, d in res.items():
        k = sorted(d)
        step = max(1, len(k) // 600)
        out[f] = {"iter": k[::step], "res": [d[i] for i in k[::step]]}
    return out


def layer_table(txt):
    """Final snappyHexMesh layer summary.

    Recent versions print 'patch faces target mesh thickness[m] thickness[%]'; older ones omit 'target'.
    Only the table after the last 'overall thickness' header is used."""
    i = txt.rfind("overall thickness")
    if i < 0:
        return {}
    out = {}
    for line in txt[i:].splitlines()[3:]:
        tok = line.split()
        if len(tok) < 5 or not tok[1].isdigit():
            if out:
                break
            continue
        try:
            nums = [float(t) for t in tok[1:]]
        except ValueError:
            break
        if len(nums) == 5:
            faces, target, mean, thick, pct = nums
        else:
            faces, mean, thick, pct = nums[:4]
            target = None
        out[tok[0]] = {"faces": int(faces), "target": target, "layers": mean, "thickness": thick, "pct": pct}
    return {"layers": out} if out else {}


def mesh_stats(case):
    st = {}
    p = os.path.join(case, "log.checkMesh")
    if os.path.exists(p):
        txt = open(p, errors="ignore").read()
        for key, rx in (("cells", r"cells:\s+(\d+)"), ("faces", r"faces:\s+(\d+)"), ("points", r"points:\s+(\d+)"),
                        ("max_non_ortho", r"Mesh non-orthogonality Max:\s+([\d.]+)"),
                        ("max_skewness", r"Max skewness = ([\d.]+)")):
            m = re.search(rx, txt)
            if m:
                st[key] = float(m.group(1)) if "." in m.group(1) else int(m.group(1))
        for kind in ("hexahedra", "prisms", "polyhedra", "tet wedges", "tetrahedra", "pyramids", "wedges"):
            m = re.search(rf"{kind}:\s+(\d+)", txt)
            if m:
                st.setdefault("cell_types", {})[kind] = int(m.group(1))
        st["checkMesh_ok"] = "Mesh OK" in txt
    p = os.path.join(case, "log.snappyHexMesh")
    if os.path.exists(p):
        txt = open(p, errors="ignore").read()
        st.update(layer_table(txt))
        m = re.findall(r"Finished meshing in = ([\d.]+) s", txt)
        if m:
            st["snappy_s"] = float(m[-1])
    p = os.path.join(case, "timings.json")
    if os.path.exists(p):
        st["timings"] = json.load(open(p))
    return st


def yplus_stats(case):
    cols, Y = None, None
    out = {}
    for f in sorted(glob.glob(os.path.join(case, "postProcessing", "yPlus", "*", "yPlus.dat"))):
        for line in open(f):
            if line.startswith("#"):
                continue
            v = line.split()
            if len(v) >= 5:
                out[v[1]] = {"min": float(v[2]), "max": float(v[3]), "avg": float(v[4])}
    return out


# ---------------------------------------------------------------------------------------------
# VTK helpers
# ---------------------------------------------------------------------------------------------
def open_case(case):
    import pyvista as pv
    foam = os.path.join(case, "case.foam")
    open(foam, "a").close()
    r = pv.OpenFOAMReader(foam)
    r.set_active_time_value(r.time_values[-1])
    log("time values", r.time_values, "patches", len(r.patch_array_names))
    return r


def _disable_all(r):
    try:
        r.disable_all_patch_arrays()
    except Exception:
        for n in r.patch_array_names:
            try:
                r.disable_patch_array(n)
            except Exception:
                pass


def read_boundary(r, names):
    import pyvista as pv
    _disable_all(r)
    for n in names:
        for cand in (f"patch/{n}", n):
            if cand in r.patch_array_names:
                r.enable_patch_array(cand)
                break
    mb = r.read()
    out = {}
    bnd = mb["boundary"] if "boundary" in mb.keys() else mb
    for n in names:
        try:
            blk = bnd[n]
        except Exception:
            blk = None
        if blk is not None and blk.n_cells > 0:
            out[n] = blk
    return out


def read_internal(r):
    _disable_all(r)
    r.enable_patch_array("internalMesh")
    mb = r.read()
    return mb["internalMesh"]


# ---------------------------------------------------------------------------------------------
# Surface (display mesh from the STL, data mapped from CFD patches)
# ---------------------------------------------------------------------------------------------
PART_MAXEDGE = {"fw_": 0.012, "rw_": 0.014, "floor": 0.016, "sidewing": 0.012, "body": 0.022, "sidepods": 0.02,
                "wheels": 0.012, "susp": 0.020, "driver": 0.018, "rollhoop": 0.015}


def surface_export(case, r, cfg, webdir, parts):
    import pyvista as pv
    from scipy.spatial import cKDTree

    U = cfg["U"]
    q = 0.5 * U * U  # kinematic
    patches = read_boundary(r, parts)
    log("patches read", list(patches))
    allV, allF, allid = [], [], []
    fields = {"Cp": [], "Cf": [], "Cfx": [], "yplus": []}
    voff = 0
    sign_tau = None
    stats = {}
    for pid, name in enumerate(parts):
        stl = os.path.join(case, "constant", "triSurface", f"{name}.stl")
        if not os.path.exists(stl) or name not in patches:
            continue
        s = pv.read(stl).triangulate().clean()
        cen = s.cell_centers().points
        s = s.extract_cells(np.where(cen[:, 1] >= -1e-4)[0]).extract_surface().triangulate().clean()
        me = next((v for k, v in PART_MAXEDGE.items() if name.startswith(k)), 0.015)
        try:
            s = s.subdivide_adaptive(max_edge_len=me, max_n_passes=8)
        except Exception as e:
            log("subdivide failed", name, e)
        # keep the web surface light: ~1 triangle per (6 mm)^2 on wings, coarser elsewhere
        dens = 1.0 / (0.006 ** 2) if name.startswith(("fw_", "rw_", "floor")) else 1.0 / (0.010 ** 2)
        target = int(max(3000, s.area * dens))
        if s.n_cells > 1.15 * target:
            try:
                s = s.decimate(1.0 - target / s.n_cells).triangulate().clean()
            except Exception as e:
                log("decimate failed", name, e)
        s = s.compute_normals(point_normals=True, cell_normals=False, auto_orient_normals=False, split_vertices=False,
                              consistent_normals=False)
        pn = s.point_data["Normals"]
        # CFD side: triangulated patch with face centres and (into-car) normals
        pt = patches[name].extract_surface().triangulate()
        P = pt.points
        Fc = pt.faces.reshape(-1, 4)[:, 1:]
        a, b, c = P[Fc[:, 0]], P[Fc[:, 1]], P[Fc[:, 2]]
        nf = np.cross(b - a, c - a)
        nf /= np.linalg.norm(nf, axis=1)[:, None] + 1e-30
        cc = (a + b + c) / 3
        cd = pt.cell_data
        p = np.asarray(cd["p"]) if "p" in cd else np.zeros(len(cc))
        wss = np.asarray(cd["wallShearStress"]) if "wallShearStress" in cd else np.zeros((len(cc), 3))
        yp = np.asarray(cd["yPlus"]) if "yPlus" in cd else np.zeros(len(cc))
        if sign_tau is None and name in ("body", "fw_main", "rw_main"):
            sign_tau = 1.0 if np.median(wss[:, 0]) >= 0 else -1.0
        tree = cKDTree(cc)
        k = min(12, len(cc))
        d, idx = tree.query(s.points, k=k)
        if k == 1:
            d, idx = d[:, None], idx[:, None]
        # outward STL normal must oppose the CFD face normal (which points out of the fluid)
        align = -np.einsum("ijk,ik->ij", nf[idx], pn)
        score = d + 0.02 * (align < 0.2)
        best = idx[np.arange(len(idx)), np.argmin(score, axis=1)]
        allV.append(s.points)
        F = s.faces.reshape(-1, 4)[:, 1:] + voff
        allF.append(F)
        allid.append(np.full(len(s.points), pid, np.uint8))
        fields["Cp"].append(p[best] / q)
        fields["Cf"].append(np.linalg.norm(wss[best], axis=1) / q)
        fields["Cfx"].append(wss[best, 0] / q)
        fields["yplus"].append(yp[best])
        stats[name] = {"verts": int(s.n_points), "tris": int(s.n_cells), "cfd_faces": int(len(cc))}
        voff += s.n_points
    V = np.vstack(allV)
    F = np.vstack(allF).astype(np.uint32)
    st = sign_tau or 1.0
    fields["Cfx"] = [x * st for x in fields["Cfx"]]
    ranges = {"Cp": [-3.5, 1.0], "Cf": [0.0, 0.012], "Cfx": [-0.006, 0.006], "yplus": [0, 300]}
    bufs = {}
    pos, pm = qpos(V)
    bufs["pos"] = (pos, pm)
    bufs["index"] = (F.reshape(-1), {})
    bufs["part"] = (np.concatenate(allid), {})
    franges = {}
    for f, lst in fields.items():
        a = np.concatenate(lst)
        lo, hi = ranges[f]
        franges[f] = {"min": lo, "max": hi, "data_min": float(np.nanmin(a)), "data_max": float(np.nanmax(a))}
        bufs[f] = (quant(a, lo, hi), {"min": lo, "max": hi})
    size = write_fsb(os.path.join(webdir, "surface.fsb.gz"), bufs, {"parts": parts})
    log("surface", V.shape, F.shape, f"{size/1e6:.2f} MB")
    return {"file": "surface.fsb.gz", "parts": parts, "fields": franges, "stats": stats, "tau_sign": st}


# ---------------------------------------------------------------------------------------------
# Volume: slices, iso-surfaces, stream lines, lines
# ---------------------------------------------------------------------------------------------
FIELD_DEF = {
    "Cpt": {"label": "Cp total", "range": [-0.4, 1.0], "cmap": "cpt"},
    "Cp": {"label": "Cp estática", "range": [-2.5, 1.0], "cmap": "cp"},
    "U": {"label": "|U| / U∞", "range": [0.0, 1.6], "cmap": "speed"},
    "Ux": {"label": "Ux / U∞", "range": [-0.3, 1.5], "cmap": "speed"},
    "wx": {"label": "ωx · L / U∞", "range": [-60.0, 60.0], "cmap": "div"},
    "hel": {"label": "Helicidad normalizada", "range": [-1.0, 1.0], "cmap": "div"},
}


def add_derived(m, U):
    q = 0.5 * U * U
    pd = m.point_data
    u = np.asarray(pd["U"])
    p = np.asarray(pd["p"])
    um = np.linalg.norm(u, axis=1)
    pd["Cp"] = p / q
    pd["Cpt"] = (p + 0.5 * um**2) / q
    pd["Umag"] = um / U
    pd["Ux_n"] = u[:, 0] / U
    if "vorticity" in pd:
        w = np.asarray(pd["vorticity"])
        pd["wx"] = w[:, 0] * 1.0 / U
        wm = np.linalg.norm(w, axis=1)
        pd["hel"] = np.einsum("ij,ij->i", u, w) / (um * wm + 1e-12)
        pd["hel"][wm * 1.0 / U < 2.0] = 0.0  # suppress noise outside vortical regions
    else:
        pd["wx"] = np.zeros(len(p))
        pd["hel"] = np.zeros(len(p))
    return m


SRC = {"Cpt": "Cpt", "Cp": "Cp", "U": "Umag", "Ux": "Ux_n", "wx": "wx", "hel": "hel"}


def png8(path, img):
    from PIL import Image
    Image.fromarray(img).save(path, optimize=True)


def sample_plane(vol, axis, pos, ext, res):
    """Regular grid on a plane. ext = (a0,a1,b0,b1) along the two in-plane axes."""
    import pyvista as pv
    a0, a1, b0, b1 = ext
    na = int(round((a1 - a0) / res)) + 1
    nb = int(round((b1 - b0) / res)) + 1
    A, B = np.meshgrid(np.linspace(a0, a1, na), np.linspace(b0, b1, nb))  # rows = b
    if axis == "x":
        P = np.c_[np.full(A.size, pos), A.ravel(), B.ravel()]
    elif axis == "y":
        P = np.c_[A.ravel(), np.full(A.size, pos), B.ravel()]
    else:
        P = np.c_[A.ravel(), B.ravel(), np.full(A.size, pos)]
    pts = pv.PolyData(P)
    s = pts.sample(vol, pass_cell_data=False, pass_point_data=True)
    mask = np.asarray(s.point_data["vtkValidPointMask"]).astype(bool).reshape(nb, na)
    return s, mask, na, nb


def plane_points(axis, pos, ext, res):
    a0, a1, b0, b1 = ext
    na = int(round((a1 - a0) / res)) + 1
    nb = int(round((b1 - b0) / res)) + 1
    A, B = np.meshgrid(np.linspace(a0, a1, na), np.linspace(b0, b1, nb))  # rows = b
    if axis == "x":
        P = np.c_[np.full(A.size, pos), A.ravel(), B.ravel()]
    elif axis == "y":
        P = np.c_[A.ravel(), np.full(A.size, pos), B.ravel()]
    else:
        P = np.c_[A.ravel(), B.ravel(), np.full(A.size, pos)]
    return P, na, nb


_LIGHT = {}

POST = {
    "x_slices": [-0.95, 2.951], "x_ext": [0.0, 0.95, 0.0, 1.30],
    "y_slices": [0.0, 0.10, 0.20, 0.30, 0.40, 0.50, 0.585, 0.70], "y_ext": [-1.2, 3.2, 0.0, 1.40],
    "z_slices": [0.004, 0.015, 0.03, 0.06, 0.10, 0.20, 0.35, 0.60, 0.90, 1.10], "z_ext": [-1.2, 3.2, 0.0, 0.95],
    "clip": [-1.4, 4.6, -0.01, 1.2, -0.01, 1.6],
    "seed_rakes": [  # x, y0, y1, ny, z0, z1, nz
        [-1.05, 0.05, 0.78, 16, 0.02, 0.36, 7], [0.24, 0.12, 0.50, 9, 0.012, 0.045, 3],
        [1.05, 0.02, 0.56, 10, 0.70, 1.22, 7], [-0.30, 0.30, 0.80, 7, 0.05, 0.50, 5]],
    "stream_length": 6.0,
    "wing_sections": {"FW": [["fw_main", "fw_flaps", "fw_cascade"], [0.10, 0.25, 0.45, 0.62]],
                      "RW": [["rw_main", "rw_flaps"], [0.05, 0.25, 0.45]]},
    "underfloor": [[0.0, 0.012], [0.20, 0.012], [0.33, 0.012], [0.46, 0.012]], "underfloor_x": [-1.2, 3.2],
}


def set_post(car):
    POST.update(car.get("post", {}))


def light_volume(vol):
    """Geometry-only copy of the volume carrying just the arrays the web needs (built once)."""
    import pyvista as pv
    key = id(vol)
    if key not in _LIGHT:
        light = pv.UnstructuredGrid()
        light.copy_structure(vol)
        for n in set(SRC.values()) | {"U", "Cp"}:
            light.point_data[n] = vol.point_data[n]
        _LIGHT.clear()
        _LIGHT[key] = light
    return _LIGHT[key]


def slices_export(vol, cfg, webdir):
    """All planes are probed in ONE pass (the cell locator is built once)."""
    import pyvista as pv
    sdir = os.path.join(webdir, "slices")
    os.makedirs(sdir, exist_ok=True)
    res = cfg.get("slice_res", 0.005)
    cat = {"x": [], "y": [], "z": []}
    plan = {
        "x": (np.round(np.arange(POST["x_slices"][0], POST["x_slices"][1], cfg.get("dx_slices", 0.05)), 3), tuple(POST["x_ext"])),
        "y": (np.array(POST["y_slices"]), tuple(POST["y_ext"])),
        "z": (np.array(POST["z_slices"]), tuple(POST["z_ext"])),
    }
    jobs, chunks, off = [], [], 0
    for axis, (positions, ext) in plan.items():
        for k, pos in enumerate(positions):
            P, na, nb = plane_points(axis, float(pos), ext, res)
            jobs.append((axis, k, float(pos), na, nb, off))
            chunks.append(P)
            off += len(P)
    allP = np.vstack(chunks)
    log("probing", len(allP), "points on", len(jobs), "planes")
    keep = set(SRC.values()) | {"U"}
    smp = pv.PolyData(allP).sample(light_volume(vol), pass_cell_data=False, pass_point_data=False)
    mask_all = np.asarray(smp.point_data["vtkValidPointMask"]).astype(bool)
    arrays = {n: np.asarray(smp.point_data[n]) for n in keep}
    log("probe done")
    for axis, k, pos, na, nb, o in jobs:
        sl = slice(o, o + na * nb)
        mask = mask_all[sl].reshape(nb, na)
        for f, src in SRC.items():
            lo, hi = FIELD_DEF[f]["range"]
            v = arrays[src][sl].reshape(nb, na)
            img = (1 + np.round(np.clip((v - lo) / (hi - lo), 0, 1) * 254)).astype(np.uint8)
            img[~mask] = 0
            png8(os.path.join(sdir, f"{axis}_{k:03d}_{f}.png"), img[::-1])  # row 0 = top (max b)
        if axis == "x":
            u = arrays["U"][sl].reshape(nb, na, 3) / cfg["U"]
            rgb = np.zeros((nb, na, 3), np.uint8)
            rgb[..., 0] = np.round(np.clip((u[..., 1] + 0.5), 0, 1) * 255)
            rgb[..., 1] = np.round(np.clip((u[..., 2] + 0.5), 0, 1) * 255)
            rgb[..., 2] = mask * 255
            png8(os.path.join(sdir, f"{axis}_{k:03d}_vec.png"), rgb[::-2, ::2])
        cat[axis].append({"i": k, "pos": pos})
    for a in cat:
        log("slices", a, len(cat[a]))
    return {a: {"ext": list(plan[a][1]), "res": res, "items": cat[a]} for a in cat}


def clip_region(vol, bounds):
    cc = vol.cell_centers().points
    x0, x1, y0, y1, z0, z1 = bounds
    m = (cc[:, 0] > x0) & (cc[:, 0] < x1) & (cc[:, 1] > y0) & (cc[:, 1] < y1) & (cc[:, 2] > z0) & (cc[:, 2] < z1)
    return vol.extract_cells(np.where(m)[0])


def iso_export(vol, cfg, webdir, name, scalar, value, color_fields, target=180000):
    U = cfg["U"]
    iso = vol.contour(isosurfaces=[value], scalars=scalar)
    if iso.n_cells == 0:
        log("iso empty", name)
        return None
    iso = iso.triangulate().clean()
    if iso.n_cells > target:
        try:
            iso = iso.decimate(1 - target / iso.n_cells)
        except Exception as e:
            log("decimate failed", e)
    F = iso.faces.reshape(-1, 4)[:, 1:].astype(np.uint32)
    pos, pm = qpos(iso.points)
    bufs = {"pos": (pos, pm), "index": (F.reshape(-1), {})}
    # the linear-grid contour filter does not interpolate other arrays: probe them on the iso points
    import pyvista as pv
    probe = pv.PolyData(np.asarray(iso.points)).sample(light_volume(vol), pass_cell_data=False, pass_point_data=False)
    for f in color_fields:
        lo, hi = FIELD_DEF[f]["range"]
        bufs[f] = (quant(np.asarray(probe.point_data[SRC[f]]), lo, hi, np.uint8), {"min": lo, "max": hi})
    size = write_fsb(os.path.join(webdir, f"iso_{name}.fsb.gz"), bufs)
    log("iso", name, iso.n_cells, f"{size/1e6:.2f} MB")
    return {"file": f"iso_{name}.fsb.gz", "scalar": scalar, "value": value, "fields": color_fields, "tris": int(iso.n_cells)}


def seeds():
    pts = []
    for x, y0, y1, ny, z0, z1, nz in POST["seed_rakes"]:
        for y in np.linspace(y0, y1, int(ny)):
            for z in np.linspace(z0, z1, int(nz)):
                pts.append((x, y, z))
    return np.array(pts)


def streams_export(vol, cfg, webdir):
    import pyvista as pv
    src = pv.PolyData(seeds())
    kw = dict(vectors="U", integration_direction="forward", initial_step_length=0.5, max_steps=4000,
              terminal_speed=1e-3)
    try:
        sl = vol.streamlines_from_source(src, max_length=POST["stream_length"], **kw)
    except TypeError:
        sl = vol.streamlines_from_source(src, max_time=POST["stream_length"], **kw)
    U = cfg["U"]
    lines = []
    L = sl.lines
    i = 0
    while i < len(L):
        n = L[i]
        ids = L[i + 1:i + 1 + n]
        i += n + 1
        if n < 4:
            continue
        P = sl.points[ids]
        sp = np.linalg.norm(sl.point_data["U"][ids], axis=1) / U
        # resample by arc length to <= 160 points
        d = np.r_[0, np.cumsum(np.linalg.norm(np.diff(P, axis=0), axis=1))]
        if d[-1] < 0.05:
            continue
        m = int(min(160, max(8, d[-1] / 0.02)))
        t = np.linspace(0, d[-1], m)
        Pr = np.c_[[np.interp(t, d, P[:, j]) for j in range(3)]].T
        lines.append((Pr, np.interp(t, d, sp)))
    if not lines:
        return None
    P = np.vstack([l[0] for l in lines])
    S = np.concatenate([l[1] for l in lines])
    offs = np.cumsum([0] + [len(l[0]) for l in lines]).astype(np.uint32)
    pos, pm = qpos(P)
    size = write_fsb(os.path.join(webdir, "streams.fsb.gz"),
                     {"pos": (pos, pm), "speed": (quant(S, 0, 1.6, np.uint8), {"min": 0, "max": 1.6}), "offsets": (offs, {})})
    log("streams", len(lines), f"{size/1e6:.2f} MB")
    return {"file": "streams.fsb.gz", "n": len(lines)}


def lines_export(vol, patches, cfg):
    U = cfg["U"]
    q = 0.5 * U * U
    out = {"wing_sections": [], "underfloor": []}
    import pyvista as pv
    for wing, (names, ys) in POST["wing_sections"].items():
        for y in ys:
            pts = []
            for n in names:
                if n not in patches:
                    continue
                try:
                    s = patches[n].cell_data_to_point_data().slice(normal="y", origin=(0, y, 0))
                except Exception:
                    continue
                if s.n_points:
                    pts.append(np.c_[s.points[:, 0], s.points[:, 2], np.asarray(s.point_data["p"]) / q])
            if pts:
                a = np.vstack(pts)
                out["wing_sections"].append({"wing": wing, "y": y, "x": np.round(a[:, 0], 4).tolist(),
                                             "z": np.round(a[:, 1], 4).tolist(), "Cp": np.round(a[:, 2], 3).tolist()})
    xa, xb = POST["underfloor_x"]
    for y, z in POST["underfloor"]:
        s = light_volume(vol).sample_over_line((xa, y, z), (xb, y, z), resolution=int((xb - xa) / 0.005))
        m = np.asarray(s.point_data["vtkValidPointMask"]).astype(bool)
        x = s.points[:, 0]
        cp = np.where(m, np.asarray(s.point_data["Cp"]), np.nan)
        out["underfloor"].append({"y": y, "z": z, "x": np.round(x, 4).tolist(),
                                  "Cp": [None if not np.isfinite(v) else round(float(v), 3) for v in cp]})
    return out


# ---------------------------------------------------------------------------------------------
def main(case, out, cfg):
    webdir = os.path.join(out, "web")
    os.makedirs(webdir, exist_ok=True)
    car = json.load(open(os.path.join(case, "constant", "triSurface", "car.json")))
    set_post(car)
    rc = json.load(open(os.path.join(case, "run_config.json")))
    cfg = {**rc, **cfg}
    meta = {"case": cfg.get("name"), "config": {k: v for k, v in cfg.items() if k not in ("groups",)}, "car": car,
            "U": cfg["U"], "rho": 1.205, "nu": 1.5e-5, "fields": FIELD_DEF, "errors": []}
    try:
        f, h, q = forces(case, cfg, car)
        meta["forces"], meta["history"], meta["q"] = f, h, q
        meta["cooling"] = cooling_summary(case, cfg, car)
        log("forces total", f.get("total"))
    except Exception:
        meta["errors"].append(traceback.format_exc())
    for key, fn in (("residuals", residuals), ("mesh", mesh_stats), ("yplus", yplus_stats)):
        try:
            meta[key] = fn(case)
        except Exception:
            meta["errors"].append(traceback.format_exc())
    json.dump(meta, open(os.path.join(webdir, "meta.json"), "w"), separators=(",", ":"))
    if cfg.get("post", "full") == "none":
        return
    parts = cfg["parts"]
    r = open_case(case)
    patches = {}
    try:
        meta["surface"] = surface_export(case, r, cfg, webdir, parts)
        patches = read_boundary(r, parts)
    except Exception:
        meta["errors"].append(traceback.format_exc())
        log(meta["errors"][-1])
    json.dump(meta, open(os.path.join(webdir, "meta.json"), "w"), separators=(",", ":"))
    if cfg.get("post", "full") != "full":
        return
    try:
        vol = read_internal(r)
        log("internal mesh", vol.n_cells, vol.array_names)
        vol = clip_region(vol, tuple(POST["clip"]))
        vol = vol.cell_data_to_point_data() if "U" not in vol.point_data else vol
        vol = add_derived(vol, cfg["U"])
        log("clipped", vol.n_cells)
    except Exception:
        meta["errors"].append(traceback.format_exc())
        log(meta["errors"][-1])
        json.dump(meta, open(os.path.join(webdir, "meta.json"), "w"), separators=(",", ":"))
        return
    steps = [
        ("slices", lambda: slices_export(vol, cfg, webdir)),
        ("lines", lambda: lines_export(vol, patches, cfg)),
        ("streams", lambda: streams_export(vol, cfg, webdir)),
    ]
    U = cfg["U"]
    iso_list = []
    for nm, sc, val, cf in (("q_low", "Q", 0.25 * U * U * 100, ["Cpt", "wx"]), ("q_high", "Q", U * U * 100, ["Cpt", "wx"]),
                            ("cpt0", "Cpt", 0.0, ["wx", "U"])):
        steps.append((f"iso_{nm}", lambda nm=nm, sc=sc, val=val, cf=cf: iso_export(vol, cfg, webdir, nm, sc, val, cf)))
    for key, fn in steps:
        try:
            res = fn()
            if key.startswith("iso_"):
                if res:
                    iso_list.append({"name": key[4:], **res})
            else:
                meta[key] = res
        except Exception:
            meta["errors"].append(f"{key}: " + traceback.format_exc())
            log(meta["errors"][-1])
        meta["iso"] = iso_list
        json.dump(meta, open(os.path.join(webdir, "meta.json"), "w"), separators=(",", ":"))
    meta["post_time_s"] = round(time.time() - T0, 1)
    json.dump(meta, open(os.path.join(webdir, "meta.json"), "w"), separators=(",", ":"))
    with open(os.path.join(out, "postpro_log.txt"), "w") as fh:
        fh.write("\n".join(LOG))


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], json.loads(sys.argv[3]) if len(sys.argv) > 3 else {})
