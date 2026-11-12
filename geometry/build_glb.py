"""CFD geometry from visual (render / game-style) 3D models: shrink-wrap + region split.

Render meshes are made of open, single-sided parts, so they cannot be meshed directly. This module:
 1. reads world-space triangles per part (.npz written from the .glb; private: fetched encrypted to
    $CAD_NPZ on the runner), finds the tyres, the car's axes, front/rear and the scale (mean of the
    regulation tyre diameter and overall width of the car's era);
 2. SHRINK-WRAPS the car body and each axle's wheels on a voxel grid, like a CFD surface wrapper: the
    triangles are rasterised, the outside air is flood-filled from the box after closing gaps smaller
    than ~2r voxels, and the solid is turned back into a watertight surface (marching cubes), smoothed
    and decimated. Half car only (y >= 0, symmetry);
 3. splits the body surface into aerodynamic regions by position (front wing, nose, rear wing, beam wing,
    floor, diffuser, sidepods, bargeboards, suspension, body).

usage (runner):  python build_<car>.py <outdir> [--front-rh-mm F --rear-rh-mm R]
"""
from __future__ import annotations

import json
import os
import re
import struct
import sys
import time

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SINK = 0.006

CARS = {
    "mp423": {
        "name": "McLaren MP4/23 (2008)", "npz": "mp423.npz", "tread": r"^TREAD_", "drop": r"led\d|CLEARLED",
        "tyre_d": 0.660, "width": 1.800, "year": 2008,
        "source": {"title": "2008 Mclaren MP4/23", "author": "Dave Love SketchFab", "url": "https://skfb.ly/pKX8v",
                   "license": "CC BY 4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    },
    "rb12": {
        "name": "Red Bull RB12 (2016)", "npz": "rb12.npz", "tread": r"\|Tyre\.", "drop": r"CLEARLED|TAG_DRS|kers_|DISPLAY|LCD|BLACK\.|driver_number",
        "tyre_d": 0.660, "width": 1.800, "year": 2016,
        "source": {"title": "2016 Redbull RB12", "author": "Dave Love SketchFab", "url": "https://sketchfab.com/3d-models/d9b5ce8c5d234deeb9cb57f5029dad57",
                   "license": "CC BY 4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    },
    "mcl39": {
        "name": "McLaren MCL39 (2025)", "npz": "mcl39.npz", "tread": r"\|Tyre_tread", "drop": r"clearled|led|display|lcd",
        "tyre_d": 0.720, "width": 2.000, "year": 2025,
        "source": {"title": "2025 McLaren MCL39", "author": "Abu Saif (abuhossain844)", "url": "https://sketchfab.com/3d-models/710fc591067848d0b3068ae3fb160ede",
                   "license": "CC BY 4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    },
}


def log(*a):
    print(f"[{time.strftime('%H:%M:%S')}]", *a, flush=True)


# ------------------------------------------------------------------------------------------------ input
def load(car):
    cfg = CARS[car]
    src = os.environ.get("CAD_NPZ") or os.path.join(HERE, "external", car, cfg["npz"])
    d = np.load(src)
    names = [str(n).split("|")[1] + "|" + str(n).split("|")[-1] for n in d["names"]]  # "node|material"
    tris = [d[f"m{i:03d}"].astype(np.float64) for i in range(len(names))]
    keep = [(n, t) for n, t in zip(names, tris) if not re.search(cfg["drop"], n, re.I) and len(t)]
    names, tris = [k[0] for k in keep], [k[1] for k in keep]
    allV = np.concatenate([t.reshape(-1, 3) for t in tris])
    # glTF is y-up; the longest horizontal axis is the car length
    ext = allV.max(0) - allV.min(0)
    la = 0 if ext[0] > ext[2] else 2
    ta = 2 if la == 0 else 0
    tread = np.concatenate([t.reshape(-1, 3) for n, t in zip(names, tris) if re.search(cfg["tread"], n)])
    # scale: mean of tyre diameter and overall width (tyre outer faces) vs the era's regulation values
    d_model = tread[:, 1].max() - tread[:, 1].min()
    w_model = tread[:, ta].max() - tread[:, ta].min()
    s = 0.5 * (cfg["tyre_d"] / d_model + cfg["width"] / w_model)
    yg = tread[:, 1].min()
    # front = the low end (the rear wing makes the rear end tall)
    L0, L1 = allV[:, la].min(), allV[:, la].max()
    lo_end = allV[allV[:, la] < L0 + 0.12 * (L1 - L0), 1].max()
    hi_end = allV[allV[:, la] > L1 - 0.12 * (L1 - L0), 1].max()
    fsign = -1.0 if hi_end > lo_end else 1.0   # +1: front at the high-coordinate end
    # front axle: tread centre nearest the front
    # front axle: centre of the tread points in the front half of the tread span
    tmid = 0.5 * (tread[:, la].min() + tread[:, la].max())
    tf = tread[tread[:, la] > tmid] if fsign > 0 else tread[tread[:, la] < tmid]
    xf_model = 0.5 * (tf[:, la].min() + tf[:, la].max())
    out = []
    for n, t in zip(names, tris):
        X = -fsign * (t[..., la] - xf_model) * s
        Z = (t[..., 1] - yg) * s
        # lateral sign chosen so that (X, Y, Z) is a proper rotation of the model axes (outward normals kept)
        M = np.zeros((3, 3)); M[0, la] = -fsign; M[2, 1] = 1.0
        M[1, ta] = 1.0
        if np.linalg.det(M) < 0:
            M[1, ta] = -1.0
        Y = M[1, ta] * t[..., ta] * s
        out.append((n, np.stack([X, Y, Z], -1)))
    log(f"{car}: scale 1:{s:.3f} (tyre {d_model*s:.3f} m, width {w_model*s:.3f} m), length axis {'xyz'[la]}, front {'+' if fsign > 0 else '-'}")
    return out, s


# ------------------------------------------------------------------------------------------------ wrap
def sample_points(T, h):
    e = np.stack([np.linalg.norm(T[:, 1] - T[:, 0], axis=1), np.linalg.norm(T[:, 2] - T[:, 1], axis=1),
                  np.linalg.norm(T[:, 0] - T[:, 2], axis=1)], 1).max(1)
    m = np.maximum(1, np.ceil(e / (0.45 * h)).astype(int))
    yield T.reshape(-1, 3)
    for mm in np.unique(m):
        sel = T[m == mm]
        i, j = np.meshgrid(np.arange(mm + 1), np.arange(mm + 1), indexing="ij")
        k = (i + j) <= mm
        a, b = i[k] / mm, j[k] / mm
        c = 1 - a - b
        step = max(1, int(4e6 // max(1, len(a))))
        for s0 in range(0, len(sel), step):
            S = sel[s0:s0 + step]
            P = S[:, 0, None, :] * a[None, :, None] + S[:, 1, None, :] * b[None, :, None] + S[:, 2, None, :] * c[None, :, None]
            yield P.reshape(-1, 3)


def wrap(T, h, r, y0=0.0):
    """Watertight half-model (y >= y0) surface of triangle soup T on an h-voxel grid, closing radius r voxels."""
    from scipy import ndimage
    import pyvista as pv
    V = T.reshape(-1, 3)
    pad = (r + 3) * h
    lo = V.min(0) - pad
    hi = V.max(0) + pad
    lo[1] = y0 - 2 * h
    shape = np.ceil((hi - lo) / h).astype(int) + 1
    log(f"  grid {shape.tolist()} = {np.prod(shape)/1e6:.0f} M voxels, h={h*1000:.1f} mm, r={r}")
    occ = np.zeros(shape, bool)
    npts = 0
    for P in sample_points(T[T[..., 1].max(1) >= lo[1]], h):
        P = P[P[:, 1] >= lo[1]]
        idx = np.floor((P - lo) / h).astype(np.int64)
        np.clip(idx, 0, shape - 1, out=idx)
        occ[idx[:, 0], idx[:, 1], idx[:, 2]] = True
        npts += len(P)
    log(f"  {npts/1e6:.0f} M surface samples, {occ.sum()/1e6:.2f} M surface voxels")
    far = ndimage.distance_transform_edt(~occ) > r
    lab, _ = ndimage.label(far)
    del far
    # outside-air seeds: every box face except y-min (the symmetry plane cuts through the car)
    border = np.unique(np.concatenate([lab[0].ravel(), lab[-1].ravel(), lab[:, -1].ravel(), lab[:, :, 0].ravel(), lab[:, :, -1].ravel()]))
    ext0 = np.isin(lab, border[border > 0])
    del lab
    ext = (ndimage.distance_transform_edt(~ext0) <= r) & ~occ
    del ext0
    solid = ~ext
    del ext
    solid[0], solid[-1], solid[:, -1], solid[:, :, 0], solid[:, :, -1] = False, False, False, False, False
    solid[:, 0] = False
    f = ndimage.gaussian_filter(solid.astype(np.float32), 0.6)
    log(f"  solid {solid.sum()/1e6:.2f} M voxels")
    del solid
    grid = pv.ImageData(dimensions=shape, spacing=(h, h, h), origin=lo)
    grid.point_data["s"] = f.ravel(order="F")
    del f
    surf = grid.contour([0.5], scalars="s").triangulate().clean()
    return surf


def finish(surf, target):
    if surf.n_cells > target:
        surf = surf.decimate(1.0 - target / surf.n_cells)
    surf = surf.smooth_taubin(n_iter=20, pass_band=0.1)
    return surf.triangulate().clean()


def tris_of(surf):
    F = surf.faces.reshape(-1, 4)[:, 1:]
    return np.asarray(surf.points)[F]


def write_stl_bin(path, tri, name):
    tri = np.asarray(tri, dtype=np.float32)
    nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-30
    rec = np.zeros(len(tri), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"], rec["v"] = nrm, tri
    with open(path, "wb") as fh:
        fh.write(name.encode()[:80].ljust(80, b" "))
        fh.write(struct.pack("<I", len(tri)))
        fh.write(rec.tobytes())


# ------------------------------------------------------------------------------------------------ regions
def classify(tri, W, year):
    """Aerodynamic regions of the wrapped body by face position/normal. W: wheel geometry dict."""
    c = tri.mean(1)
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1)[:, None] + 1e-30
    x, y, z = c[:, 0], np.abs(c[:, 1]), c[:, 2]
    xf, xr, R = W["xf"], W["xr"], W["R"]
    ytyre_in = W["y_in"]
    lab = np.full(len(tri), "body", dtype=object)
    fw_z = 0.36 if year >= 2022 else 0.33
    fw = (x < xf - 0.75 * R) & ((z < fw_z) | (y > 0.20))
    rw = (x > xr + 0.05) & (z > 0.58)
    bw = (x > xr - 0.05) & (z > 0.28) & (z <= 0.58) & (y < 0.55) & ~rw
    diff = (x > xr - 0.55) & (z < 0.30) & (n[:, 2] < 0.5) & ~bw
    # floor: underside (tunnel roofs up to ~0.3 m in the ground-effect era) and the low floor edges
    zroof = 0.32 if year >= 2022 else 0.14
    floor = (x > xf + 0.25) & (x <= xr - 0.55) & (((z < zroof) & (n[:, 2] < -0.3)) | ((z < 0.09) & (y > 0.30)))
    susp = (y > 0.22) & (y < ytyre_in + 0.02) & (z > 0.08) & (z < 0.62) & ((np.abs(x - xf) < 0.45) | (np.abs(x - xr) < 0.45)) & ~fw & ~floor & ~diff
    side = (y > 0.27) & (z < 0.68) & (x > xf + 0.75) & (x < xr - 0.30) & ~floor & ~susp & ~diff
    barge = (y > 0.22) & (z < 0.50) & (x > xf + 0.30) & (x <= xf + 0.75) & ~floor & ~susp if year < 2022 else np.zeros(len(tri), bool)
    for m, k in ((susp, "suspension"), (side, "sidepods"), (barge, "bargeboards"), (floor, "floor"), (diff, "diffuser"),
                 (bw, "beamwing"), (rw, "rearwing"), (fw, "frontwing")):
        lab[m] = k
    return lab


LEVELS = {"frontwing": (6, 6), "rearwing": (5, 6), "beamwing": (5, 6), "bargeboards": (5, 6), "floor": (5, 6),
          "diffuser": (5, 6), "body": (4, 5), "sidepods": (4, 5), "suspension": (5, 5),
          "wheels_front": (4, 5), "wheels_rear": (4, 5)}


def components(T):
    """Split a triangle soup into connected components (shared welded vertices)."""
    V = T.reshape(-1, 3)
    span = float((V.max(0) - V.min(0)).max()) or 1.0
    q = np.round(V / (span * 1e-6)).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    F = inv.reshape(-1, 3)
    parent = np.arange(inv.max() + 1)
    for _ in range(500):
        m = np.minimum(np.minimum(parent[F[:, 0]], parent[F[:, 1]]), parent[F[:, 2]])
        old = parent.copy()
        for col in (F[:, 0], F[:, 1], F[:, 2]):
            np.minimum.at(parent, col, m)
        parent = parent[parent]
        if np.array_equal(parent, old):
            break
    comp = parent[F[:, 0]]
    return [T[comp == c] for c in np.unique(comp)]


def main(car, outdir, front_mm=0.0, rear_mm=0.0, h_body=0.0035, r_body=2):
    cfg = CARS[car]
    os.makedirs(outdir, exist_ok=True)
    parts, s = load(car)
    tread = np.concatenate([t.reshape(-1, 3) for n, t in parts if re.search(cfg["tread"], n)])
    tl = tread[tread[:, 1] > 0]
    split = (tl[:, 0].min() + tl[:, 0].max()) / 2
    fr, rr = tl[tl[:, 0] < split], tl[tl[:, 0] >= split]
    Rf, Rr = (fr[:, 2].max() - fr[:, 2].min()) / 2, (rr[:, 2].max() - rr[:, 2].min()) / 2
    xf, xr = (fr[:, 0].min() + fr[:, 0].max()) / 2, (rr[:, 0].min() + rr[:, 0].max()) / 2
    yf, yr = (fr[:, 1].min() + fr[:, 1].max()) / 2, (rr[:, 1].min() + rr[:, 1].max()) / 2
    W = {"xf": xf, "xr": xr, "R": 0.5 * (Rf + Rr), "y_in": min(fr[:, 1].min(), rr[:, 1].min())}
    log(f"wheelbase {xr-xf:.3f} m, R front {Rf:.3f} rear {Rr:.3f}, track/2 {yf:.3f}/{yr:.3f}, tyre inner face y {W['y_in']:.3f}")
    # wheel parts = meshes contained in a wheel envelope (tyre, rim, brake, hub)
    # wheel parts = connected pieces lying inside a wheel envelope (tyre, rim, brake disc, hub)
    wheels = {"wheels_front": [], "wheels_rear": []}
    body = []
    for nme, t in parts:
        for piece in components(t):
            V = piece.reshape(-1, 3)
            lo, hi = V.min(0), V.max(0)
            cen = (lo + hi) / 2
            ymin = np.abs(V[:, 1]).min()
            dest = None
            for k, (xa, Ra) in (("wheels_front", (xf, Rf)), ("wheels_rear", (xr, Rr))):
                if (abs(cen[0] - xa) < Ra and lo[0] > xa - 1.1 * Ra and hi[0] < xa + 1.1 * Ra and hi[2] < 2.1 * Ra
                        and ymin > W["y_in"] - 0.10 and np.sign(lo[1]) == np.sign(hi[1])):
                    dest = k
                    break
            (wheels[dest] if dest else body).append(piece)
    regions = {}
    for k, lst in wheels.items():
        T = np.concatenate(lst).copy()
        T[..., 2] -= SINK
        log(f"{k}: {len(lst)} parts, {len(T)} triangles")
        regions[k] = tris_of(finish(wrap(T, 0.004, 3), 120000))
    Tb = np.concatenate(body)
    log(f"body: {len(body)} parts, {len(Tb)} triangles")
    bsurf = finish(wrap(Tb, h_body, r_body), 450000)
    btri = tris_of(bsurf)
    lab = classify(btri, W, cfg["year"])
    for k in np.unique(lab):
        regions[k] = btri[lab == k]
    if abs(front_mm) > 1e-9 or abs(rear_mm) > 1e-9:
        dF, dR = front_mm / 1000.0, rear_mm / 1000.0
        th = np.arctan2(dR - dF, xr - xf)
        cth, sth = np.cos(th), np.sin(th)
        for k, tri in regions.items():
            if k.startswith("wheels"):
                continue
            xx, zz = tri[..., 0] - xf, tri[..., 2].copy()
            tri[..., 0] = xf + xx * cth - zz * sth
            tri[..., 2] = xx * sth + zz * cth + dF
    info = {}
    for k, tri in regions.items():
        if len(tri) < 20:
            continue
        write_stl_bin(os.path.join(outdir, f"{k}.stl"), tri, k)
        info[k] = {"tris": int(len(tri))}
        log(f"{k:13s} tris={len(tri):7d}")
    names = list(info)
    V = np.concatenate([regions[k].reshape(-1, 3) for k in names])
    blo, bhi = V.min(0), V.max(0)
    sys.path.insert(0, HERE)
    from build_mft03 import frontal_area
    area = frontal_area([np.concatenate([regions[k], regions[k] * np.array([1, -1, 1])]) for k in names], half_width=1.1, height=1.4)
    L = float(bhi[0] - blo[0])
    meta = {
        "car": cfg["name"], "car_id": car, "source": cfg["source"], "year": cfg["year"], "scale": round(1.0 / s, 4) if s < 1 else round(s, 4),
        "wheelbase": round(xr - xf, 4), "tyre_radius": float(Rr), "x_front_axle": float(xf), "x_rear_axle": float(xr),
        "wheels": [{"part": "wheels_front", "origin": [float(xf), float(yf), float(Rf - SINK)], "radius": float(Rf)},
                   {"part": "wheels_rear", "origin": [float(xr), float(yr), float(Rr - SINK)], "radius": float(Rr)}],
        "bbox_min": [float(blo[0]), -float(bhi[1]), float(blo[2])], "bbox_max": bhi.round(4).tolist(),
        "length": L, "width": float(2 * bhi[1]), "height": float(bhi[2]),
        "frontal_area": round(area, 4), "parts": names, "closure": info,
        "wrap": {"body_voxel_m": h_body, "body_close_voxels": r_body, "wheel_voxel_m": 0.004, "wheel_close_voxels": 3},
        "levels": {k: list(LEVELS.get(k, (4, 5))) for k in names},
        "force_groups": {k: [k] for k in names}, "no_layers": [k for k in ("suspension",) if k in names],
        "variant": {"front_rh_mm": front_mm, "rear_rh_mm": rear_mm},
        "domain": [round(blo[0] - 7.5, 1), round(bhi[0] + 13.5, 1), 5.5, 5.5],
        "location_in_mesh": [round(bhi[0] + 3.1234, 4), 2.8765, 3.3456],
        "boxes": {
            "box_far": [[blo[0] - 2.0, 0, 0], [bhi[0] + 6.5, 2.3, 2.4], 2],
            "box_wake": [[blo[0] - 0.8, 0, 0], [bhi[0] + 3.0, 1.6, 1.6], 3],
            "box_near": [[blo[0] - 0.25, 0, 0], [bhi[0] + 0.6, 1.3, 1.25], 4],
            "box_rw": [[xr - 0.2, 0, 0.30], [bhi[0] + 1.0, 0.85, 1.25], 4],
            "box_floor": [[xf + 0.2, 0.0, 0], [xr + 0.9, 0.85, 0.12], 5],
            "box_fwgnd": [[blo[0] - 0.1, 0, 0], [xf - 0.2, bhi[1] + 0.05, 0.30], 5],
        },
        "post": {
            "x_slices": [round(blo[0] - 0.2, 2), round(bhi[0] + 1.0, 2)], "x_ext": [0.0, 1.35, 0.0, 1.30],
            "y_slices": [0.0, 0.15, 0.30, 0.45, 0.60, round(float(yf), 3), 0.80, 0.95], "y_ext": [round(blo[0] - 0.4, 1), round(bhi[0] + 1.6, 1), 0.0, 1.40],
            "z_slices": [0.006, 0.02, 0.04, 0.08, 0.15, 0.30, 0.50, 0.75, 0.95], "z_ext": [round(blo[0] - 0.4, 1), round(bhi[0] + 1.6, 1), 0.0, 1.30],
            "clip": [round(blo[0] - 0.6, 1), round(bhi[0] + 3.2, 1), -0.01, 1.6, -0.01, 1.6],
            "seed_rakes": [[round(blo[0] - 0.2, 2), 0.05, 1.05, 16, 0.03, 0.40, 7], [round(xf + 0.25, 2), 0.15, 0.70, 9, 0.02, 0.06, 3],
                           [round(xr - 0.1, 2), 0.02, 0.60, 10, 0.40, 1.10, 7], [round(xf - 0.45, 2), 0.45, 1.15, 7, 0.06, 0.65, 5]],
            "stream_length": 9.0,
            "wing_sections": {"FW": [["frontwing"], [0.20, 0.35, 0.50, 0.65]], "RW": [["rearwing"], [0.05, 0.20, 0.35]]},
            "underfloor": [[0.0, 0.03], [0.30, 0.03], [0.55, 0.03]], "underfloor_x": [round(blo[0] - 0.4, 1), round(bhi[0] + 1.6, 1)],
        },
    }
    with open(os.path.join(outdir, "car.json"), "w") as fh:
        json.dump(meta, fh, indent=1, default=lambda o: o.tolist() if hasattr(o, "tolist") else float(o))
    log(json.dumps({k: meta[k] for k in ("length", "width", "height", "frontal_area", "wheelbase")}))


def cli(car):
    import argparse
    ap = argparse.ArgumentParser()
    ap.add_argument("outdir", nargs="?", default="stl")
    ap.add_argument("--front-rh-mm", type=float, default=0.0)
    ap.add_argument("--rear-rh-mm", type=float, default=0.0)
    a = ap.parse_args()
    main(car, a.outdir, a.front_rh_mm, a.rear_rh_mm)
