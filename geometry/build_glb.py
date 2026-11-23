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
        # detail zones from the geometry review (gaps the 3.5 mm wrap closed): forward floor, sidepod-top winglets and
        # chimneys, diffuser and rear-wheel area, front-wheel area (front wing, rear wing and bargeboards are automatic)
        "detail_zones": [[[-0.20, 0.0, 0.0], [1.05, 0.70, 0.30]], [[1.30, 0.40, 0.40], [3.00, 0.80, 0.75]],
                         [[2.35, 0.15, 0.0], [3.35, 0.70, 0.50]], [[-0.25, 0.35, 0.10], [0.25, 0.65, 0.50]]],
        # rebuilt wing elements (wing_rebuild.py section mode, --rebuild-wings): each element is two open skins in this
        # model, followed through the cuts from a seed point (CFD axes, m). The bridge wing over the nose (a wedge with a
        # knife trailing edge) separated in 2D once the main stack below was attached; outboard of y 0.31 it has a flap
        # whose inboard end joins the main plane near y 0.30, so the main plane is tracked as two pieces whose lofts
        # overlap across the junction.
        "wing_rebuild": {"fw_main": {"role": "main", "seed": [-0.887, 0.15, 0.115], "y": [0.0, 0.60], "extend_to": 0.61},
                         "fw_bridge": {"role": "main", "seed": [-0.877, 0.20, 0.389], "y": [0.0, 0.29], "extend_to": 0.309},
                         "fw_bridge_out": {"role": "main", "seed": [-0.875, 0.45, 0.330], "y": [0.31, 0.60], "extend_from": 0.307, "extend_to": 0.605},
                         "fw_bridge_flap": {"role": "flap", "after": "fw_bridge_out", "seed": [-0.765, 0.45, 0.364], "y": [0.31, 0.60], "extend_to": 0.605,
                                            "merge_skins": True},
                         "fw_flap1": {"role": "flap", "after": "fw_main", "seed": [-0.680, 0.15, 0.160], "y": [0.0, 0.60], "extend_to": 0.61},
                         "fw_flap2": {"role": "flap", "after": "fw_flap1", "seed": [-0.511, 0.15, 0.245], "y": [0.0, 0.575], "extend_to": 0.58},
                         "rw_main": {"role": "main", "seed": [3.333, 0.25, 0.725], "y": [0.0, 0.50], "extend_to": 0.505},
                         "rw_flap": {"role": "flap", "after": "rw_main", "seed": [3.486, 0.25, 0.829], "y": [0.0, 0.49], "extend_to": 0.50},
                         "beam": {"role": "main", "seed": [3.469, 0.25, 0.417], "y": [0.055, 0.51], "extend_to": 0.515}},
        "source": {"title": "2008 Mclaren MP4/23", "author": "Dave Love SketchFab", "url": "https://skfb.ly/pKX8v",
                   "license": "CC BY 4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    },
    "rb12": {
        "name": "Red Bull RB12 (2016)", "npz": "rb12.npz", "tread": r"\|Tyre\.", "drop": r"CLEARLED|TAG_DRS|kers_|DISPLAY|LCD|BLACK\.|driver_number",
        "tyre_d": 0.660, "width": 1.800, "year": 2016,
        # detail zones (review): T-tray / forward floor, front suspension and nose, diffuser and rear-wheel area,
        # sidepod side vanes
        "detail_zones": [[[0.30, 0.0, -0.02], [1.10, 0.40, 0.30]], [[-0.60, 0.03, 0.15], [0.60, 0.50, 0.75]],
                         [[2.90, 0.03, 0.0], [3.75, 0.70, 0.50]], [[1.60, 0.45, 0.25], [2.00, 0.70, 0.50]]],
        # the front-wing slots of this model are only 4-5 mm: on the 1.25 mm grid they kept 1-3 mm
        "wing_h": {"fw": 0.0008},
        # rebuilt wing elements (wing_rebuild.py section mode, --rebuild-wings): the front wing is one plane in the
        # neutral centre (|y| < 0.25) and a stack of six elements outboard (main plane, second and third elements in one
        # model piece; the fifth and sixth are one element inboard of y 0.33); the cascade winglets on the endplates and the small beam wing (4 cm chord) are left as modelled
        "wing_rebuild": {"fw_centre": {"role": "main", "seed": [-0.888, 0.10, 0.085], "y": [0.0, 0.27], "extend_to": 0.27},
                         "fw_e1": {"role": "main", "seed": [-0.964, 0.40, 0.073], "y": [0.25, 0.76]},
                         "fw_e2": {"role": "flap", "after": "fw_e1", "seed": [-0.890, 0.40, 0.092], "y": [0.25, 0.76]},
                         "fw_e3": {"role": "flap", "after": "fw_e2", "seed": [-0.823, 0.40, 0.116], "y": [0.25, 0.76]},
                         "fw_e4": {"role": "flap", "after": "fw_e3", "seed": [-0.768, 0.40, 0.159], "y": [0.25, 0.76]},
                         "fw_e56": {"role": "flap", "after": "fw_e4", "seed": [-0.751, 0.30, 0.186], "y": [0.25, 0.328]},
                         "fw_e5": {"role": "flap", "after": "fw_e4", "seed": [-0.729, 0.40, 0.201], "y": [0.25, 0.76]},
                         "fw_e6": {"role": "flap", "after": "fw_e5", "seed": [-0.699, 0.40, 0.239], "y": [0.25, 0.76]},
                         "rw_main": {"role": "main", "seed": [3.558, 0.20, 0.865], "y": [0.0, 0.35], "extend_to": 0.355},
                         # rear slot: the model draws 5.7 mm; the regulations of the time ask 10-15 mm between the two
                         # rear-wing sections at their closest (DRS closed); 12.5 mm here is ~10 mm after the voxel wrap
                         "rw_flap": {"role": "flap", "after": "rw_main", "seed": [3.707, 0.20, 0.958], "y": [0.0, 0.35], "extend_to": 0.355,
                                     "gap_min": 0.0125}},
        "source": {"title": "2016 Redbull RB12", "author": "Dave Love SketchFab", "url": "https://sketchfab.com/3d-models/d9b5ce8c5d234deeb9cb57f5029dad57",
                   "license": "CC BY 4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    },
    "mp45": {
        "name": "McLaren MP4/5 (1989)", "npz": "mp45.npz", "tread": r"^(front|back)_wheels\|", "drop": r"^$", "tyres_only": True,
        "tyre_d": 0.660, "width": 2.130, "year": 1989,
        # detail zones (review): diffuser and rear-wheel area, front-wheel area, sidepod side
        "detail_zones": [[[1.95, 0.03, 0.0], [2.90, 0.65, 0.45]], [[-0.15, 0.40, 0.10], [0.30, 0.85, 0.50]],
                         [[1.60, 0.25, 0.30], [1.95, 0.55, 0.60]]],
        # rebuilt wing elements (wing_rebuild.py section mode, --rebuild-wings). The first MP4/5 run with rebuilt wings
        # (mp45_w1, commit 8f79fbf) used the box mode with fixed NACA 4 % / 6 % camber (main / flap); the section mode
        # takes the model's own camber like the other cars (this model: front main -3.6 % = wrong side, front flap
        # +2.8 %, rear elements +8 %)
        "wing_rebuild": {"fw_main": {"role": "main", "seed": [-0.712, 0.30, 0.112], "y": [0.0, 0.69], "extend_to": 0.698},
                         "fw_flap": {"role": "flap", "after": "fw_main", "seed": [-0.521, 0.30, 0.171], "y": [0.115, 0.69], "extend_to": 0.698},
                         "rw_main": {"role": "main", "seed": [3.058, 0.20, 0.815], "y": [0.0, 0.47], "extend_to": 0.477},
                         "rw_flap": {"role": "flap", "after": "rw_main", "seed": [3.255, 0.20, 0.884], "y": [0.0, 0.47], "extend_to": 0.477},
                         "rw_lower": {"role": "main", "seed": [3.216, 0.20, 0.582], "y": [0.0, 0.47], "extend_to": 0.477}},
        "source": {"title": "McLaren MP4/5 || Formula 1", "author": "dark_igorek", "url": "https://sketchfab.com/3d-models/mclaren-mp45-formula-1-3059d4532ecd48ca8da41e1cac971f22",
                   "license": "CC BY 4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    },
    "mcl39": {
        "name": "McLaren MCL39 (2025)", "npz": "mcl39.npz", "tread": r"\|Tyre_tread", "drop": r"clearled|led|display|lcd",
        "tyre_d": 0.720, "width": 2.000, "year": 2025,
        # detail zones (review): floor edge, rear floor and diffuser centre, T-tray, front suspension and brake ducts,
        # sidepod vanes, rear-wheel / diffuser side
        "detail_zones": [[[1.50, 0.45, 0.0], [3.30, 0.85, 0.32]], [[2.50, 0.03, 0.0], [3.50, 0.45, 0.35]],
                         [[0.40, 0.03, 0.0], [1.30, 0.20, 0.20]], [[-0.40, 0.10, 0.10], [0.45, 0.80, 0.80]],
                         [[0.90, 0.45, 0.10], [1.30, 0.80, 0.45]], [[3.35, 0.40, 0.10], [4.00, 0.60, 0.45]]],
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
    if cfg.get("tyres_only"):
        # the wheel objects also hold rims, brakes and drive shafts: keep the pieces as tall as the tallest (the tyres)
        pcs = [c for n, t in zip(names, tris) if re.search(cfg["tread"], n) for c in components(t)]
        hz = np.array([np.ptp(c.reshape(-1, 3)[:, 1]) for c in pcs])
        tread = np.concatenate([c.reshape(-1, 3) for c, z in zip(pcs, hz) if z >= 0.85 * hz.max()])
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


def sample_points_ids(T, ids, h):
    """sample_points with the id of the triangle each point comes from."""
    e = np.stack([np.linalg.norm(T[:, 1] - T[:, 0], axis=1), np.linalg.norm(T[:, 2] - T[:, 1], axis=1),
                  np.linalg.norm(T[:, 0] - T[:, 2], axis=1)], 1).max(1)
    m = np.maximum(1, np.ceil(e / (0.45 * h)).astype(int))
    yield T.reshape(-1, 3), np.repeat(ids, 3)
    for mm in np.unique(m):
        sel = T[m == mm]
        sid = ids[m == mm]
        i, j = np.meshgrid(np.arange(mm + 1), np.arange(mm + 1), indexing="ij")
        k = (i + j) <= mm
        a, b = i[k] / mm, j[k] / mm
        c = 1 - a - b
        step = max(1, int(4e6 // max(1, len(a))))
        for s0 in range(0, len(sel), step):
            S = sel[s0:s0 + step]
            P = S[:, 0, None, :] * a[None, :, None] + S[:, 1, None, :] * b[None, :, None] + S[:, 2, None, :] * c[None, :, None]
            yield P.reshape(-1, 3), np.repeat(sid[s0:s0 + step], len(a))


# ------------------------------------------------------------------------------------------------ CAD skin + plug
PLUG = {}   # current build: body triangles "T", outward normals "n", "flip", "certain", "outer" (set in wrap)


def tri_normals(T):
    n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    return n / (np.linalg.norm(n, axis=1)[:, None] + 1e-30)


def mark_near(T, ids, lo, h, mask, out):
    """out[ids[i]] = True when a sample point of T[i] (h grid) falls in a True voxel of mask."""
    shape = np.array(mask.shape)
    for P, k in sample_points_ids(T, ids, h):
        idx = np.floor((P - lo) / h).astype(np.int64)
        ok = np.all((idx >= 0) & (idx < shape), axis=1)
        hit = np.zeros(len(P), bool)
        hit[ok] = mask[idx[ok, 0], idx[ok, 1], idx[ok, 2]]
        if hit.any():
            out[np.unique(k[hit])] = True


def plug_keep(mask, lo, h, sel, band, g=1.0, air=None):
    """The plug part of the voxel solid `mask` (voxel i spans lo + [i, i+1] h): voxels farther than `band` voxels from
    the model's outer triangles (PLUG["outer"] & sel), and nearer ones whose centre is on the inner side of the nearest
    outer triangle by at least g voxels (outward normals; a triangle of uncertain orientation keeps no voxel near it).
    The plug fills every part up to ~g voxel from the skin and never crosses it: no offset, no bumps, no air layer
    between skin and plug for the mesh to enter. With `air` (outside-air voxels of the same grid) only the stretches of
    the skin within band + 1 voxels of that air count: a large panel that runs from the outside deep into the car
    (a sidepod's inner sheet) cuts the plug only where it meets the outside air, never a channel along its length."""
    from scipy import ndimage
    from scipy.spatial import cKDTree
    T = PLUG["T"]
    ids = np.where(sel & PLUG["outer"])[0]
    if not len(ids):
        return mask
    shape = np.array(mask.shape)
    occ = np.zeros(mask.shape, bool)
    airN = None
    if air is not None:
        ga = np.indices((2 * band + 3,) * 3) - (band + 1)
        airN = ndimage.binary_dilation(air, (ga ** 2).sum(0) <= (band + 1) ** 2)
        del ga
    Ps, Ks = [], []
    for P, k in sample_points_ids(T[ids], ids, h):
        idx = np.floor((P - lo) / h).astype(np.int64)
        ok = np.all((idx >= -band - 1) & (idx < shape + band + 1), axis=1)
        P, k, idx = P[ok], k[ok], idx[ok]
        inb = np.all((idx >= 0) & (idx < shape), axis=1)
        if airN is not None:                           # only the stretches of skin next to the outside air
            na = np.ones(len(P), bool)
            na[inb] = airN[idx[inb, 0], idx[inb, 1], idx[inb, 2]]
            P, k, idx, inb = P[na], k[na], idx[na], inb[na]
        occ[idx[inb, 0], idx[inb, 1], idx[inb, 2]] = True
        Ps.append(P); Ks.append(k)
    P, K = np.concatenate(Ps), np.concatenate(Ks)
    del Ps, Ks, airN
    gb = np.indices((2 * band + 1,) * 3) - band
    near = ndimage.binary_dilation(occ, (gb ** 2).sum(0) <= band * band)
    del occ
    cand = np.argwhere(mask & near)
    out = mask & ~near
    del near
    if len(cand) and len(P):
        tree = cKDTree(P)
        keep = np.zeros(len(cand), bool)
        for s0 in range(0, len(cand), 2_000_000):
            X = lo + (cand[s0:s0 + 2_000_000] + 0.5) * h
            _, j = tree.query(X, workers=-1)
            k = K[j]
            s = np.einsum("ij,ij->i", X - P[j], PLUG["n"][k])
            keep[s0:s0 + len(X)] = PLUG["certain"][k] & (s < -g * h)
        out[tuple(cand[keep].T)] = True
    return out


def plug_reseal(plug, solid, lo, h, sel, seeds=None, depth=2):
    """Watertightness of walls + plug on the h grid: outside air is flooded from `seeds` (default: the box faces but the
    symmetry side) through what is neither a wall voxel (outer triangles among `sel`) nor plug; whatever it reaches more
    than `depth` voxels inside `solid` (the voxel fill, which the previous wrapped geometry had solid too) goes back to
    the plug. Gaps of the model narrower than a voxel are not seen; wider ones into the interior are sealed this way.
    Returns (plug, resealed voxel count)."""
    from scipy import ndimage
    T = PLUG["T"]
    ids = np.where(sel & PLUG["outer"])[0]
    shape = np.array(plug.shape)
    obst = plug.copy()
    for P, k in sample_points_ids(T[ids], ids, h):
        idx = np.floor((P - lo) / h).astype(np.int64)
        ok = np.all((idx >= 0) & (idx < shape), axis=1)
        obst[idx[ok, 0], idx[ok, 1], idx[ok, 2]] = True
    lab, _ = ndimage.label(~obst)
    del obst
    if seeds is None:
        sid = np.concatenate([lab[0].ravel(), lab[-1].ravel(), lab[:, -1].ravel(), lab[:, :, 0].ravel(), lab[:, :, -1].ravel()])
    else:
        sid = lab[seeds]
    sid = np.unique(sid)
    reach = np.isin(lab, sid[sid > 0])
    del lab
    deep = reach & ndimage.binary_erosion(solid, iterations=depth)
    del reach
    n = int(deep.sum())
    if n:
        plug = plug | deep
    return plug, n


PLUG_SNAP = 2.5         # plug vertices up to this many local voxels under a wall are moved onto it
PLUG_SNAP_EPS = 3e-4    # ... ending this far (m) under the wall


def closest_on_tri(X, A, B, C):
    """Closest points to X (n,3) on triangles ABC (n,3 each) (Ericson, Real-Time Collision Detection 5.1.5)."""
    ab, ac, ap = B - A, C - A, X - A
    d1, d2 = (ab * ap).sum(1), (ac * ap).sum(1)
    bp = X - B
    d3, d4 = (ab * bp).sum(1), (ac * bp).sum(1)
    cp = X - C
    d5, d6 = (ab * cp).sum(1), (ac * cp).sum(1)
    va, vb, vc = d3 * d6 - d5 * d4, d5 * d2 - d1 * d6, d1 * d4 - d3 * d2
    den = np.where(np.abs(va + vb + vc) > 1e-30, va + vb + vc, 1e-30)
    v, w = vb / den, vc / den
    Q = A + ab * v[:, None] + ac * w[:, None]                                   # inside the face
    sw = lambda m, R: np.where(m[:, None], R, Q)
    t = np.clip(d1 / np.where(np.abs(d1 - d3) > 1e-30, d1 - d3, 1e-30), 0, 1)
    Q = sw((vc <= 0) & (d1 >= 0) & (d3 <= 0), A + ab * t[:, None])              # edge AB
    t = np.clip(d2 / np.where(np.abs(d2 - d6) > 1e-30, d2 - d6, 1e-30), 0, 1)
    Q = sw((vb <= 0) & (d2 >= 0) & (d6 <= 0), A + ac * t[:, None])              # edge AC
    t = np.clip((d4 - d3) / np.where(np.abs((d4 - d3) + (d5 - d6)) > 1e-30, (d4 - d3) + (d5 - d6), 1e-30), 0, 1)
    Q = sw((va <= 0) & (d4 - d3 >= 0) & (d5 - d6 >= 0), B + (C - B) * t[:, None])  # edge BC
    Q = sw((d1 <= 0) & (d2 <= 0), A)
    Q = sw((d3 >= 0) & (d4 <= d3), B)
    Q = sw((d6 >= 0) & (d5 <= d6), C)
    return Q


def plug_to_walls(P, Wt, zones, h_body, k=16):
    """Close the gap between the plug and the walls. The plug stops >= 1 voxel under the skin so that it never crosses
    it, which leaves a 2-8 mm gap between the two surfaces, open to the outside air wherever a wall ends (open shell
    edges, overlapping panels, outer/hidden boundaries of the model). snappyHexMesh meshes that gap wherever its cells
    fit (slot regions at 1.3-2.7 mm, body surfaces at 5 mm): the MP4/23 coarse mesh reached 11.9 M cells instead of
    9.3 M and every F1 runner ran out of memory. Each plug vertex up to PLUG_SNAP local voxels under a wall triangle of
    certain orientation (signed distance along its outward normal < 0) whose normal agrees with the plug's (dot > 0.3:
    not across a thin part, not onto a perpendicular wall) is moved along that normal to PLUG_SNAP_EPS under it.
    P: plug triangles (outward); Wt: wall triangles (outward, certain orientation). Returns (P, moved vertex count)."""
    from scipy.spatial import cKDTree
    q = np.round(P.reshape(-1, 3) / 1e-7).astype(np.int64)
    _, first, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
    inv = inv.ravel()
    V = P.reshape(-1, 3)[first].copy()
    F = inv.reshape(-1, 3)
    fn = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    vn = np.zeros_like(V)
    for j in range(3):
        np.add.at(vn, F[:, j], fn)
    vn /= np.linalg.norm(vn, axis=1)[:, None] + 1e-30
    hl = np.full(len(V), h_body)
    for z in zones:
        hz = z[2] if len(z) > 2 else ZONE_H
        m = np.all((V >= np.array(z[0])) & (V <= np.array(z[1])), axis=1)
        hl[m] = np.minimum(hl[m], hz)
    dmax = PLUG_SNAP * hl
    wn = np.cross(Wt[:, 1] - Wt[:, 0], Wt[:, 2] - Wt[:, 0])
    wn /= np.linalg.norm(wn, axis=1)[:, None] + 1e-30
    sp = [(a, b) for a, b in sample_points_ids(Wt, np.arange(len(Wt)), 0.004)]
    pts, tid = np.concatenate([a for a, _ in sp]), np.concatenate([b for _, b in sp])
    del sp
    dd, kk = cKDTree(pts).query(V, k=k, distance_upper_bound=float(dmax.max()) + 0.004)
    best_d = np.full(len(V), np.inf)
    best_s = np.zeros(len(V))
    best_t = np.full(len(V), -1)
    for j in range(k):
        ok = np.isfinite(dd[:, j])
        if not ok.any():
            continue
        iv = np.where(ok)[0]
        t = tid[kk[iv, j]]
        Qc = closest_on_tri(V[iv], Wt[t, 0], Wt[t, 1], Wt[t, 2])
        d = np.linalg.norm(V[iv] - Qc, axis=1)
        s = ((V[iv] - Qc) * wn[t]).sum(1)
        good = (s < 0) & (d < dmax[iv]) & ((vn[iv] * wn[t]).sum(1) > 0.3) & (d < best_d[iv])
        g = iv[good]
        best_d[g], best_s[g], best_t[g] = d[good], s[good], t[good]
    mv = best_t >= 0
    V[mv] -= (best_s[mv] + PLUG_SNAP_EPS)[:, None] * wn[best_t[mv]]
    return V[F], int(mv.sum())


def orient_outward(T, ext, lo, h, log=print):
    """Outward orientation of the model's triangles: the side seen from outside (exterior_visibility votes); faces
    not seen (deep in a slot, under a panel) by probing the coarse outside air 2.5 voxels along each side.
    Returns (flip, certain, outward normals)."""
    from cavity import exterior_visibility
    n = tri_normals(T)
    flip = np.zeros(len(T), bool)
    cert = np.zeros(len(T), bool)
    vis = exterior_visibility(T)
    if vis is not None:
        fr, bk = vis
        tot = fr + bk
        flip = (tot > 0) & (bk > fr)
        cert = (tot > 0) & (np.abs(fr - bk) >= 0.3 * tot)
    c = T.mean(1)
    shape = np.array(ext.shape)

    def air(p):
        idx = np.floor((p - lo) / h).astype(np.int64)
        ok = np.all((idx >= 0) & (idx < shape), axis=1)
        a = np.ones(len(p), bool)                       # outside the box: air
        a[ok] = ext[idx[ok, 0], idx[ok, 1], idx[ok, 2]]
        return a
    ap, am = air(c + 2.5 * h * n), air(c - 2.5 * h * n)
    und = ~cert
    out_, in_ = ap & ~am, am & ~ap
    flip[und & in_] = True
    flip[und & out_] = False
    cert |= und & (in_ | out_)
    n[flip] *= -1
    log(f"  skin orientation: {flip.sum()} of {len(T)} faces turned outwards, {(~cert).sum()} uncertain")
    return flip, cert, n


ZONE_H, ZONE_M, ZONE_BAND = 0.0015, 0.012, 7
ZONE_RAY_STRIDE, ZONE_RAY_LEN, ZONE_RAYS_OPEN = 3, 0.30, 3   # ray test of the reopened pockets (see carve_zone)
ZONE_THICK = 0.010                    # half-thickness above which a reopened pocket is the inside of a part
ZONE_MIN_CM3 = 2.0                    # smallest reopened gap kept
ZONE_ONE_PIECE = 0.8                  # rays hitting one piece for more than this share: inside that piece
ZONE_RAYS_SHEET = 9                   # ...unless this many rays see open air: the coarse wrap's offset along a surface
ZONE_REPASS = 3                       # extra ray passes next to rebuilt (closed) wing elements, see carve_zone
_DIRS = np.array([(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if (i, j, k) != (0, 0, 0)], float)
_DIRS /= np.linalg.norm(_DIRS, axis=1)[:, None]


def ray_escapes(smp, wall_id, outside, kmax):
    """For voxel samples, 26 straight rays: how many reach outside air before a wall voxel (leaving the grid counts as
    blocked), the share of the wall hits that land on the most-hit piece of the model, the number of hits and that
    piece's id (-1 without hits)."""
    shape = np.array(wall_id.shape)
    n = len(smp)
    esc = np.zeros(n, int)
    hits = np.full((n, len(_DIRS)), -1, np.int64)
    base = smp.astype(float)
    for di, d in enumerate(_DIRS):
        alive = np.ones(n, bool)
        for k in range(1, kmax + 1):
            a = np.where(alive)[0]
            if not len(a):
                break
            q = np.rint(base[a] + d * k).astype(np.int64)
            inb = np.all((q >= 0) & (q < shape), axis=1)
            alive[a[~inb]] = False
            a, q = a[inb], q[inb]
            o = outside[q[:, 0], q[:, 1], q[:, 2]]
            wid = wall_id[q[:, 0], q[:, 1], q[:, 2]]
            w = wid >= 0
            esc[a[o]] += 1
            hits[a[w & ~o], di] = wid[w & ~o]
            alive[a[o | w]] = False
    # share of the most frequent piece among the hits (rows sorted; longest run of equal ids)
    hs = np.sort(hits, axis=1)
    nhit = (hs >= 0).sum(1)
    best = (hs[:, 0] >= 0).astype(int); run = np.ones(n, int)
    top = hs[:, 0].copy()
    for c in range(1, hs.shape[1]):
        same = (hs[:, c] == hs[:, c - 1]) & (hs[:, c] >= 0)
        run = np.where(same, run + 1, 1)
        cur = np.where(hs[:, c] >= 0, run, 0)
        top = np.where(cur > best, hs[:, c], top)
        best = np.maximum(best, cur)
    share = best / np.maximum(nhit, 1)
    return esc, share, nhit, top
# CAD skin + inner plug (2026-11-18): the walls are the model's own triangles; the voxel solid (interior fill, cooling
# duct, hollow insides of the parts) only becomes a plug kept away from them, so that the mesh cannot enter the car
PLUG_MODE = True
PLUG_BAND_COARSE = 3                  # body grid voxels (3.5 mm): >= ~10 mm inside the skin; clears every gap the closing bridged
PLUG_BAND_FINE = 2                    # detail-zone voxels (1.25-1.5 mm)
PLUG_TRIS_ZONE = 60000                # triangles of each zone's plug surface
PLUG_TRIS_BODY = 200000
ZONE_TRIS = []      # closed surfaces of the detail zones (filled by carve_zone)
ZONE_CUTS = []      # boxes removed from the coarse solid (their faces are internal, inside the zone surfaces)


ZONE_MAXVOX = 1.3e8


SPAN_CHUNKS = False  # wing zones split along the span (set for builds with rebuilt wing elements, see zone_chunks)


def zone_chunks(zlo, zhi, hf, axis=None):
    """Split a detail-zone box along its longest side (or `axis`) into chunks of at most ZONE_MAXVOX fine voxels (with
    margins). Neighbouring chunks overlap by twice the margin; the coarse solid is removed over the whole box.
    A wing zone split along x cuts its slots: in carve_zone a ray leaving the chunk counts as blocked, so a slot whose
    mouth lies beyond the cut is not reopened (MP4/23 rebuilt rear wing: 12 mm slot left at 3-5 mm, chunks split at
    x 3.42 under the flap nose). Along the span (y) every chunk holds the whole section of each slot."""
    n = int(np.ceil(np.prod((zhi - zlo + 2 * ZONE_M) / hf) / ZONE_MAXVOX))
    if n <= 1:
        return [(zlo, zhi)]
    k = int(np.argmax(zhi - zlo)) if axis is None else int(axis)
    edges = np.linspace(zlo[k], zhi[k], n + 1)
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        lo_, hi_ = zlo.copy(), zhi.copy()
        lo_[k], hi_[k] = a, b
        out.append((lo_, hi_))
    return out


def carve_zone(T, zlo, zhi, solid, band, lo, h, hf=None, target=None, ids=None, closed_ids=()):
    """Detail zone: inside the box (+ margin ZONE_M) the solid is rebuilt on a ZONE_H grid. Outside air reaches every
    gap wider than ~3 fine voxels: flood fill of the fine air from the coarse body's outside air, allowed only through
    fine air that is outside air or coarse solid within ZONE_BAND coarse voxels of the surface (gaps the coarse wrap
    closed, not the filled interior). The fine solid (= not outside air) is a closed surface overlapping the coarse body
    by 1.5 margins; the caller removes the zone interior from the coarse solid. Its triangles go to ZONE_TRIS and the
    gaps found in it to the slot refinement regions. closed_ids: pieces that are closed solids (rebuilt wing elements,
    wing_rebuild.py): air next to them is never the inside of a hollow part, so the one-piece rule does not apply."""
    from scipy import ndimage
    import pyvista as pv
    blo, bhi = zlo - ZONE_M, zhi + ZONE_M
    blo[1] = max(blo[1], lo[1])
    hf = hf or ZONE_H
    shape = np.ceil((bhi - blo) / hf).astype(int) + 1
    c = T.mean(1)
    sel = np.all((c > blo - 0.05) & (c < bhi + 0.05), axis=1)
    # model surface voxels, tagged with the connected piece of the model they belong to
    oid = np.full(shape, -1, np.int32)
    tid = ids[sel] if ids is not None else np.zeros(int(sel.sum()), np.int32)
    for P, pid in sample_points_ids(T[sel], tid, hf):
        idx = np.floor((P - blo) / hf).astype(np.int64)
        ok = np.all((idx >= 0) & (idx < shape), axis=1)
        oid[idx[ok, 0], idx[ok, 1], idx[ok, 2]] = pid[ok]
    ball = np.zeros((3, 3, 3), bool); ball[1, 1, :] = ball[1, :, 1] = ball[:, 1, 1] = True
    wall_id = ndimage.grey_dilation(oid + 1, footprint=ball) - 1      # the 1-voxel dilated surface keeps a piece id
    thick = (wall_id >= 0) & (oid < 0)        # the dilation layer: watertight walls for the fills, peeled off at the end
    del oid
    air = wall_id < 0
    ix = [np.clip(np.floor((blo[k] + hf * np.arange(shape[k]) - lo[k]) / h).astype(int), 0, solid.shape[k] - 1) for k in range(3)]
    cs = solid[np.ix_(*ix)]
    cb = band[np.ix_(*ix)]
    allowed = air & (~cs | cb)
    lab, _ = ndimage.label(allowed)
    seeds = np.unique(lab[allowed & ~cs])
    ext = np.isin(lab, seeds[seeds > 0])
    del lab, allowed, cb
    # pockets of outside air the coarse wrap made solid: reopen only what is open, as in the interior fill (cavity.py):
    # from samples of the pockets, rays in 26 directions; a sample sees open air if >= ZONE_RAYS_OPEN of them reach
    # outside air before the model's surface. Slots between elements are open through their mouths; the inside of a
    # hollow part (wing elements with open trailing edges or tips, double-skin floors, fins) is enclosed and stays solid
    # even when it is connected to a slot. Every pocket voxel takes the verdict of its nearest sample.
    outside = ext & ~cs
    L = ext & cs
    del ext
    pts = np.argwhere(L)
    reopen = np.zeros(shape, bool)
    vreal = vfake = 0.0
    if len(pts):
        st = ZONE_RAY_STRIDE
        smp = pts[np.all(pts % st == 0, axis=1)]
        if len(smp) < 50:
            smp = pts[:: max(1, len(pts) // 200)]
        esc, share, nhit, top = ray_escapes(smp, wall_id, outside, int(round(ZONE_RAY_LEN / hf)))
        # open to outside air through a few directions AND between different pieces of the model (a slot between two
        # elements); air whose walls all belong to one piece is the inside of that piece (hollow endplate, element),
        # except the thin sheet the coarse wrap added along a surface, which sees open air in about half the directions.
        # A rebuilt element is a closed solid: air seen mostly on it is the slot under it (the one-piece rule left
        # 3-6 mm of a 12 mm slot under the rebuilt MP4/23 rear flap solid)
        closed = np.isin(top, np.array(sorted(closed_ids), np.int64)) if len(closed_ids) else np.zeros(len(smp), bool)
        ok = ((esc >= ZONE_RAYS_OPEN) & ((share <= ZONE_ONE_PIECE) | closed) & (nhit >= 4)) | (esc >= ZONE_RAYS_SHEET)
        from scipy.spatial import cKDTree
        _, nn = cKDTree(smp).query(pts, k=1)
        good = ok[nn]
        reopen[tuple(pts[good].T)] = True
        # next to rebuilt elements, the slot air already found open counts as open air for a second look: from under a
        # flap nose few straight rays reach the coarse outside air through a narrow curved slot (MP4/23 rear wing: a
        # 3-5 mm column under the flap nose stayed solid), but they reach the reopened part of the same slot. The
        # inside of a closed element still sees its own walls in every direction and stays solid.
        for _ in range(ZONE_REPASS if len(closed_ids) else 0):
            pend = np.where(~ok & closed & (nhit >= 4))[0]
            if not len(pend):
                break
            e2, _s2, _n2, _t2 = ray_escapes(smp[pend], wall_id, outside | reopen, int(round(ZONE_RAY_LEN / hf)))
            new = e2 >= ZONE_RAYS_OPEN
            if not new.any():
                break
            ok[pend[new]] = True
            good = ok[nn]
            reopen[tuple(pts[good].T)] = True
        # gaps are thin: whatever holds a ball of radius ZONE_THICK is the inside of a part with openings (a nose with
        # seams, an open-backed fairing) and stays solid (morphological opening of the reopened set)
        k = max(2, int(round(ZONE_THICK / hf)))
        core = ndimage.binary_erosion(reopen, iterations=k)
        if core.any():
            reopen &= ~(ndimage.binary_dilation(core, iterations=k + 1) & reopen)
        del core
        # slivers along the inside of a shell (seams of a nose, a fairing): drop reopened pieces under ZONE_MIN_CM3
        lab, n = ndimage.label(reopen, np.ones((3, 3, 3)))
        if n:
            cnt = np.bincount(lab.ravel())
            small = np.where(cnt * hf ** 3 < ZONE_MIN_CM3 * 1e-6)[0]
            reopen[np.isin(lab, small[small > 0])] = False
        del lab
        vreal = reopen.sum() * hf ** 3
        vfake = len(pts) * hf ** 3 - vreal
    del L, pts
    nreal = int(vreal > 0)
    del wall_id
    air = outside | reopen
    del outside, reopen
    if PLUG.get("T") is T:
        # the model's triangles that face this outside air (slots included) are walls of the CFD geometry
        mark_near(T[sel], np.where(sel)[0], blo, hf, ndimage.binary_dilation(air, structure=ball), PLUG["outer"])
        PLUG["outer"] &= ~PLUG["panel"]                 # duct ends stay with the plug (see wrap)
    # peel the dilation layer where it faces air (it made every part ~1 voxel thicker per side and every slot 2 voxels
    # narrower); the model's own surface voxels stay, and they already seal every part (re-filling the notches of the
    # peeled layer left a ~1-voxel waviness on gently sloped faces)
    peel = thick & ~air & ndimage.binary_dilation(air, structure=ball)
    del thick
    S = ~air & ~peel
    del peel
    log(f"  detail zone {zlo.round(2).tolist()} - {zhi.round(2).tolist()}: {np.prod(shape)/1e6:.0f} M voxels at {hf*1000:.1f} mm, "
        f"{vreal*1e6:.0f} cm3 of closed gaps reopened; {vfake*1e6:.0f} cm3 of enclosed hollow-part insides kept solid")
    del cs
    S[0], S[-1], S[:, 0], S[:, -1], S[:, :, 0], S[:, :, -1] = False, False, False, False, False, False
    for name, (st, vol) in slot_regions(S, blo, hf).items():
        SLOTS.setdefault(name, []).append(st)
    plug = PLUG.get("T") is T
    if plug:
        # inner plug: the fine solid inside the model's skin (hollow insides of the parts: elements open at the trailing
        # edge, double skins, the filled interior), up to ~1 voxel from the skin; the skin stays the wall
        S0 = S
        S = plug_keep(S0, blo, hf, sel, PLUG_BAND_FINE, air=air)
        S, nre = plug_reseal(S, S0, blo, hf, sel, seeds=air)
        del S0
        if nre:
            log(f"    zone plug resealed: {nre * hf**3 * 1e6:.0f} cm3")
        S[0], S[-1], S[:, 0], S[:, -1], S[:, :, 0], S[:, :, -1] = False, False, False, False, False, False
    del air
    f = ndimage.gaussian_filter(S.astype(np.float32), 0.6)
    del S
    grid = pv.ImageData(dimensions=shape, spacing=(hf, hf, hf), origin=blo + 0.5 * hf)   # voxel centres
    grid.point_data["s"] = f.ravel(order="F")
    del f
    surf = grid.contour([0.5], scalars="s").triangulate().clean()
    if surf.n_cells:
        # wing boxes (fine grid) keep more triangles than the other detail zones; a plug is hidden: fewer
        target = target or (PLUG_TRIS_ZONE if plug else (250000 if hf <= WING_H + 1e-9 else 200000))
        ZONE_TRIS.append(outward(tris_of(finish(surf, target))))


def wrap(T, h, r, y0=0.0, W=None, T_extra=None, keep_solid=False, zones=(), T_ids=None, plug=False, closed_ids=()):
    """Watertight half-model (y >= y0) surface of triangle soup T on an h-voxel grid, closing radius r voxels.
    With W (wheel geometry dict) the hollow interior is filled and the cooling inlets kept as blind ducts
    (cavity.py). T_extra (the finely wrapped wings): obstacles for the outside-air flood fill and the interior fill,
    exactly as if they were part of the body, but the solid that exists only because of them (within r voxels of
    their triangles and not within r voxels of T) is removed: the body keeps its shape and its filled interior,
    the wings and the gaps between their elements are left to the fine wrap. Returns (surface, cavity info or None).
    plug=True (CAD skin + plug): the returned surface is the inner plug (fill, duct, hollow insides), kept inside the
    model's outer triangles; PLUG holds which triangles are outer (the walls) and their outward orientation."""
    from scipy import ndimage
    import pyvista as pv
    V = T.reshape(-1, 3) if T_extra is None else np.concatenate([T.reshape(-1, 3), T_extra.reshape(-1, 3)])
    pad = (r + 3) * h
    lo = V.min(0) - pad
    hi = V.max(0) + pad
    lo[1] = y0 - 2 * h
    shape = np.ceil((hi - lo) / h).astype(int) + 1
    log(f"  grid {shape.tolist()} = {np.prod(shape)/1e6:.0f} M voxels, h={h*1000:.1f} mm, r={r}")
    def raster(TT):
        o = np.zeros(shape, bool)
        n = 0
        for P in sample_points(TT[TT[..., 1].max(1) >= lo[1]], h):
            P = P[P[:, 1] >= lo[1]]
            idx = np.floor((P - lo) / h).astype(np.int64)
            np.clip(idx, 0, shape - 1, out=idx)
            o[idx[:, 0], idx[:, 1], idx[:, 2]] = True
            n += len(P)
        return o, n
    occ, npts = raster(T)
    log(f"  {npts/1e6:.0f} M surface samples, {occ.sum()/1e6:.2f} M surface voxels")
    # "farther than r voxels from the skin" and "within r voxels of the outside air": dilations by a ball of radius r
    # (the same voxel sets as thresholding a Euclidean distance transform, without its ~20 bytes per voxel)
    g = np.indices((2 * r + 1,) * 3) - r
    ball = (g ** 2).sum(0) <= r * r
    only_extra = None
    if T_extra is not None and len(T_extra):
        occ_x, nx_ = raster(T_extra)
        only_extra = ndimage.binary_dilation(occ_x, ball) & ~ndimage.binary_dilation(occ, ball)
        occ |= occ_x
        del occ_x
        log(f"  + {nx_/1e6:.0f} M samples of the finely wrapped parts (obstacles only): {only_extra.sum()/1e6:.2f} M voxels left to them")
    far = ~ndimage.binary_dilation(occ, ball)
    lab, _ = ndimage.label(far)
    del far
    # outside-air seeds: every box face except y-min (the symmetry plane cuts through the car)
    border = np.unique(np.concatenate([lab[0].ravel(), lab[-1].ravel(), lab[:, -1].ravel(), lab[:, :, 0].ravel(), lab[:, :, -1].ravel()]))
    ext0 = np.isin(lab, border[border > 0])
    del lab
    ext = ndimage.binary_dilation(ext0, ball) & ~occ
    del ext0, occ
    info, skin = None, None
    if W is not None:
        from cavity import fill as fill_cavities
        skin = ~ext
        ext, info = fill_cavities(ext, h, lo, W, T=T if T_extra is None else np.concatenate([T, T_extra]),
                                  k=max(1, int(round(0.0105 / h))), log=log)
    solid = ~ext
    if plug:
        T_all = T if T_extra is None else np.concatenate([T, T_extra])
        flip, cert, nrm = orient_outward(T_all, ext, lo, h, log=log)
        outer = np.zeros(len(T_all), bool)
        # outer triangles: those next to the outside air of the coarse solid (within 2 voxels: its offset); the
        # detail zones add the ones facing the gaps that the coarse closing bridged (carve_zone)
        g2 = np.indices((5, 5, 5)) - 2
        mark_near(T_all, np.arange(len(T_all)), lo, h, ndimage.binary_dilation(ext, (g2 ** 2).sum(0) <= 4), outer)
        panel = np.zeros(len(T_all), bool)
        ducts = {k_: d_ for k_, d_ in (info or {}).get("ducts", {}).items() if d_["mask"].any()}
        if ducts:
            # whatever the model has at and behind a duct end, across the duct's footprint and 2 cells around it, that
            # faces no outside air but the duct's (a panel closing the duct, the radiator's back face, its side walls):
            # left to the plug, so that the radiator face is the plug's end of the duct and no air layer bypasses it.
            # The bodywork around the duct faces the outside air and stays a wall.
            cc = info["c"]
            kf = int(round(cc / h))
            duct_air = np.zeros_like(ext)
            for d_ in ducts.values():
                up = np.repeat(np.repeat(np.repeat(d_["mask"], kf, 0), kf, 1), kf, 2)
                sx, sy, sz = (min(a_, b_) for a_, b_ in zip(up.shape, ext.shape))
                duct_air[:sx, :sy, :sz] |= up[:sx, :sy, :sz]
                del up
            facing = np.zeros(len(T_all), bool)
            mark_near(T_all, np.arange(len(T_all)), lo, h, ndimage.binary_dilation(ext & ~duct_air, (g2 ** 2).sum(0) <= 4), facing)
            del duct_air
            c3 = T_all.mean(1)
            j = np.floor((np.abs(c3[:, 1]) - info["lo"][1]) / cc).astype(int)
            kz = np.floor((c3[:, 2] - info["lo"][2]) / cc).astype(int)
            for k_, d_ in ducts.items():
                ix = np.where(d_["mask"].any(axis=(1, 2)))[0]
                x_end = info["lo"][0] + (ix.max() + 1) * cc
                fp = ndimage.binary_dilation(d_["footprint"], iterations=2)
                ok = (j >= 0) & (j < fp.shape[0]) & (kz >= 0) & (kz < fp.shape[1])
                infp = np.zeros(len(T_all), bool)
                infp[ok] = fp[j[ok], kz[ok]]
                pk = infp & (c3[:, 0] > x_end - 1.5 * cc) & (c3[:, 0] < x_end + 0.6) & ~facing
                panel |= pk
                log(f"  {k_} duct end at x = {x_end:.3f}: {pk.sum()} model triangles at or behind it left to the plug")
            outer &= ~panel
            del facing
        PLUG.clear()
        PLUG.update(T=T_all, n=nrm, flip=flip, certain=cert, outer=outer, panel=panel)
        PLUG["ext"] = ext                              # outside air of the coarse grid (for the plug)
    del ext
    if only_extra is not None:
        solid &= ~only_extra
        if skin is not None:
            skin &= ~only_extra
        del only_extra
    for a in (solid, skin):
        if a is not None:
            a[0], a[-1], a[:, -1], a[:, :, 0], a[:, :, -1] = False, False, False, False, False
            a[:, 0] = False
    log(f"  solid {solid.sum()/1e6:.2f} M voxels")
    kept = (solid.copy(), lo.copy()) if keep_solid else None
    if zones:
        T_all = T if T_extra is None else np.concatenate([T, T_extra])
        band = solid & ~ndimage.binary_erosion(solid, iterations=ZONE_BAND)   # solid within ~25 mm of its surface
        if skin is not None:
            # only what the closing radius bridged may reopen, never the interior the cavity fill decided to fill
            band &= skin
        for z in zones:                    # every zone reads the untouched coarse solid
            zlo, zhi = np.array(z[0], float), np.array(z[1], float)
            hz = float(z[2]) if len(z) > 2 else ZONE_H
            span = 1 if (SPAN_CHUNKS and hz <= WING_H + 1e-9) else None     # wing zones (see zone_chunks)
            for clo, chi in zone_chunks(zlo, zhi, hz, axis=span):
                carve_zone(T_all, clo, chi, solid, band, lo, h, hf=hz,
                           ids=None if T_ids is None or T_extra is not None else T_ids, closed_ids=closed_ids)
        del band
        for z in zones:
            zlo, zhi = np.array(z[0], float), np.array(z[1], float)
            # the zone interior (box shrunk by half the margin) now comes from the fine solid
            a = np.ceil((zlo + 0.5 * ZONE_M - lo) / h - 0.5).astype(int)
            b = np.floor((zhi - 0.5 * ZONE_M - lo) / h - 0.5).astype(int) + 1
            a = np.clip(a, 0, np.array(solid.shape)); b = np.clip(b, 0, np.array(solid.shape))
            if np.all(b > a):
                ZONE_CUTS.append((lo + (a + 0.5) * h, lo + (b - 0.5) * h))
                solid[a[0]:b[0], a[1]:b[1], a[2]:b[2]] = False
                if skin is not None:
                    skin[a[0]:b[0], a[1]:b[1], a[2]:b[2]] = False
    if plug:
        n_out = int(PLUG["outer"].sum())
        if os.environ.get("PLUG_DEBUG_NPZ"):            # local checks only
            np.savez_compressed(os.environ["PLUG_DEBUG_NPZ"], solid=solid, lo=lo, h=h)
        fill_ = solid
        solid = plug_keep(fill_, lo, h, np.ones(len(PLUG["T"]), bool), PLUG_BAND_COARSE, air=PLUG.pop("ext"))
        solid, nre = plug_reseal(solid, fill_, lo, h, np.ones(len(PLUG["T"]), bool))
        del fill_
        log(f"  plug resealed where outside air reached into the fill through the walls: {nre * h**3 * 1000:.2f} L")
        if os.environ.get("PLUG_DEBUG_NPZ"):
            np.savez_compressed(os.environ["PLUG_DEBUG_NPZ"].replace(".npz", "_plug.npz"), plug=solid)
        solid[0], solid[-1], solid[:, -1], solid[:, :, 0], solid[:, :, -1], solid[:, 0] = False, False, False, False, False, False
        log(f"  CAD skin: {n_out} of {len(PLUG['T'])} model triangles face the outside air; plug {solid.sum()/1e6:.2f} M voxels")
        if keep_solid:
            kept = (solid.copy(), lo.copy())
        f = ndimage.gaussian_filter(solid.astype(np.float32), 0.6)
        if skin is not None:
            del skin
    elif skin is None:
        f = ndimage.gaussian_filter(solid.astype(np.float32), 0.6)
    else:
        # skin keeps its sharpness; only the filled interior (caps, duct ends) is smoothed over ~5 mm. (Smoothing
        # skin + fill together at 1.5 voxels closed narrow outside gaps between skin panels: filling outwards.)
        f = np.maximum(ndimage.gaussian_filter(skin.astype(np.float32), 0.6),
                       ndimage.gaussian_filter((solid & ~skin).astype(np.float32), 1.5))
        del skin
    del solid
    grid = pv.ImageData(dimensions=shape, spacing=(h, h, h), origin=lo + 0.5 * h)    # voxel centres
    grid.point_data["s"] = f.ravel(order="F")
    del f
    surf = grid.contour([0.5], scalars="s").triangulate().clean()
    if keep_solid:
        return surf, info, kept
    return surf, info


def only_triangles(surf):
    """Drop the lines/vertices that clean() leaves where marching-cubes triangles degenerate."""
    import pyvista as pv
    if surf.is_all_triangles and surf.n_lines == 0 and surf.n_verts == 0:
        return surf
    return pv.PolyData(surf.points, surf.faces).triangulate().clean()


def finish(surf, target):
    surf = only_triangles(surf)
    if surf.n_cells > target:
        # smooth the voxel steps away BEFORE decimating: decimating the raw marching-cubes steps by 90-96 % left spikes
        # and sheets bridging corners (99th-percentile deviation 3-4 mm, up to 3 cm); smoothed first, ~1 mm
        surf = only_triangles(surf.smooth_taubin(n_iter=30, pass_band=0.05))
        surf = surf.decimate(1.0 - target / surf.n_cells, volume_preservation=True)
        surf = surf.smooth_taubin(n_iter=10, pass_band=0.1)
    else:
        surf = surf.smooth_taubin(n_iter=20, pass_band=0.1)
    return only_triangles(surf.triangulate().clean())


def tris_of(surf):
    F = surf.faces.reshape(-1, 4)[:, 1:]
    return np.asarray(surf.points)[F]


def outward(tri):
    """Closed triangle surface with outward normals (positive signed volume). snappyHexMesh's gap refinement
    (gapMode outside) tells the air side of a gap from the surface normals."""
    vol = np.einsum("ij,ij->i", tri[:, 0], np.cross(tri[:, 1], tri[:, 2])).sum() / 6.0
    return tri if vol >= 0 else tri[:, ::-1].copy()


def gap_box(tri, pad=0.01):
    """Box (half car, y >= 0) around a wing's triangles, for the slot-gap refinement region."""
    V = tri.reshape(-1, 3)
    lo, hi = V.min(0) - pad, V.max(0) + pad
    lo[1] = max(lo[1], 0.0)
    return [lo.round(4).tolist(), hi.round(4).tolist()]


def write_stl_bin(path, tri, name):
    tri = np.asarray(tri, dtype=np.float32)
    nrm = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    # triangles collapsed to a point by the decimation (all three vertices equal in single precision): no normal,
    # and their edges counted as non-manifold; dropping them leaves no hole
    ok = np.linalg.norm(nrm, axis=1) > 2e-12
    tri, nrm = tri[ok], nrm[ok]
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
          "wheels_front": (4, 5), "wheels_rear": (4, 5), "inlets": (6, 6), "radiator_in": (6, 6), "radiator_out": (6, 6)}
# Duct, radiator face and exit at level 6: the narrowest section of a sidepod duct can be ~2 cm (RB12), which the
# level-5 cells of the coarse mesh (h0 = 0.34 m -> 10.6 mm) cut off from the outside (no radiator face left).


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


WING_REBUILT = []   # report of the rebuilt wing elements of the current build (wing_rebuild.py)
BODY_CLOSED = []    # per body piece of the last split_parts: True for a rebuilt wing element (a closed solid)


def split_parts(car, rebuild_wings=False):
    """Load the model and split it into wheel parts (per axle) and body parts. With rebuild_wings, the car's
    "wing_rebuild" elements are replaced by clean aerofoil lofts first (wing_rebuild.py)."""
    cfg = CARS[car]
    parts, s = load(car)
    WING_REBUILT.clear()
    BODY_CLOSED.clear()
    if rebuild_wings:
        if not cfg.get("wing_rebuild"):
            raise SystemExit(f"{car}: no wing_rebuild elements defined")
        import wing_rebuild
        spec = cfg["wing_rebuild"]
        by_box = {k: v for k, v in spec.items() if "box" in v}       # one model piece per element (MP4/5)
        by_sec = {k: v for k, v in spec.items() if "seed" in v}      # elements followed through the cuts
        if by_sec:
            parts, rep = wing_rebuild.rebuild_sections(parts, by_sec, components, log=log)
            WING_REBUILT.extend(rep)
        if by_box:
            parts, rep = wing_rebuild.rebuild(parts, by_box, components, log=log)
            WING_REBUILT.extend(rep)
        missing = set(cfg["wing_rebuild"]) - {r["element"] for r in rep}
        if missing:
            raise SystemExit(f"{car}: wing elements not found in the model: {sorted(missing)}")
    tread = np.concatenate([t.reshape(-1, 3) for n, t in parts if re.search(cfg["tread"], n)])
    if cfg.get("tyres_only"):                      # tyres only (see load)
        pcs = [c for n, t in parts if re.search(cfg["tread"], n) for c in components(t)]
        hz = np.array([np.ptp(c.reshape(-1, 3)[:, 2]) for c in pcs])
        tread = np.concatenate([c.reshape(-1, 3) for c, z in zip(pcs, hz) if z >= 0.85 * hz.max()])
    tl = tread[tread[:, 1] > 0]
    split = (tl[:, 0].min() + tl[:, 0].max()) / 2
    fr, rr = tl[tl[:, 0] < split], tl[tl[:, 0] >= split]
    Rf, Rr = (fr[:, 2].max() - fr[:, 2].min()) / 2, (rr[:, 2].max() - rr[:, 2].min()) / 2
    xf, xr = (fr[:, 0].min() + fr[:, 0].max()) / 2, (rr[:, 0].min() + rr[:, 0].max()) / 2
    yf, yr = (fr[:, 1].min() + fr[:, 1].max()) / 2, (rr[:, 1].min() + rr[:, 1].max()) / 2
    W = {"xf": xf, "xr": xr, "R": 0.5 * (Rf + Rr), "y_in": min(fr[:, 1].min(), rr[:, 1].min()), "year": cfg["year"]}
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
            if not dest:
                BODY_CLOSED.append(nme.startswith("rebuilt|"))
    return parts, s, W, wheels, body, (Rf, Rr, xf, xr, yf, yr)


# Wings are wrapped on their own, finer grid: the body grid (3.5 mm, closing radius 2 voxels) closes every gap narrower
# than ~14-17 mm, i.e. all the slots between wing elements (5-15 mm in these models: section cuts of the raw meshes).
# At 1.25 mm and 1 voxel only gaps below ~3.5 mm close (the joints between touching pieces), the slots stay open.
WING_H, WING_R = 0.00125, 1
WING_TARGET = 300000
SLOTS = {}    # refinement-region name -> list of closed triangle surfaces (filled by wrap_wings)


def wing_box(W):
    """Boxes (CFD axes, half car) holding the front wing, the rear + beam wing and, before 2022, the bargeboards and
    turning vanes ahead of the sidepods (thin vanes 1-3 cm apart: on the body grid some came out perforated or
    fused with their neighbours): (lo, hi)."""
    xf, xr, R = W["xf"], W["xr"], W["R"]
    out = {"fw": ((-9.0, -9.0, -9.0), (xf - 0.75 * R, 9.0, 0.50)),
           "rw": ((xr - 0.10, -0.70, 0.30), (9.0, 0.70, 9.0))}
    if W.get("year", 2025) < 2022:
        out["bg"] = ((xf + 0.20, 0.12, -0.05), (xf + 1.35, 0.85, 0.55))
    return out


def split_wings(body, W, zones=()):
    """Move the body pieces lying (>= 80 % of their area) in a wing box to that wing's list."""
    from cavity import tri_area
    boxes = wing_box(W)
    # further fine-wrap zones of this car (geometry review: vanes, fences, strakes, brake-duct winglets...)
    for i, (lo, hi) in enumerate(zones):
        boxes[f"z{i}"] = (tuple(lo), tuple(hi))
    wings = {k: [] for k in boxes}
    rest = []
    for piece in body:
        a = tri_area(piece)
        c = piece.mean(1)
        dest = None
        for k, (lo, hi) in boxes.items():
            inside = np.all((c >= lo) & (c <= hi), axis=1)
            if a.sum() > 0 and a[inside].sum() >= 0.8 * a.sum():
                dest = k
                break
        (wings[dest] if dest else rest).append(piece)
    return wings, rest


def slot_regions(solid, lo, h, wide_mm=15.0, narrow_mm=6.0, min_cm3=0.2):
    """Air in the narrow gaps of a finely wrapped part (slots between wing elements, between vanes): the morphological
    closing of the solid minus the solid, on a 2h grid. Returns {"slots_wide": triangles, "slots_narrow": triangles}:
    closed surfaces around the gaps narrower than wide_mm / narrow_mm, used as snappyHexMesh refinement regions
    (explicit, instead of the automatic gap refinement, which also refined inside thin parts and far beyond the slots)."""
    from scipy import ndimage
    import pyvista as pv
    sh = (np.array(solid.shape) // 2) * 2
    S = solid[:sh[0], :sh[1], :sh[2]].reshape(sh[0] // 2, 2, sh[1] // 2, 2, sh[2] // 2, 2).max(axis=(1, 3, 5))
    H = 2 * h
    pad = 6
    S = np.pad(S, pad)
    org = lo + (0.5 - pad) * H                 # centre of the first (padded) 2h block
    out = {}
    for name, w_mm in (("slots_wide", wide_mm), ("slots_narrow", narrow_mm)):
        k = max(1, int(round(0.5 * w_mm / 1000 / H)))
        closed = ndimage.binary_erosion(ndimage.binary_dilation(S, iterations=k), iterations=k)
        gap = closed & ~S
        lab, n = ndimage.label(gap)
        if n:
            cnt = np.bincount(lab.ravel())
            small = np.where(cnt * H ** 3 < min_cm3 * 1e-6)[0]
            gap[np.isin(lab, small)] = False
        del lab
        gap = ndimage.binary_dilation(gap, iterations=1)       # cover the whole gap, a little beyond its mouths
        vol = gap.sum() * H ** 3
        if vol <= 0:
            continue
        f = ndimage.gaussian_filter(gap.astype(np.float32), 0.5)
        grid = pv.ImageData(dimensions=f.shape, spacing=(H, H, H), origin=org)
        grid.point_data["s"] = f.ravel(order="F")
        surf = grid.contour([0.5], scalars="s").triangulate().clean()
        if surf.n_cells == 0:
            continue
        if surf.n_cells > 40000:           # refinement region only (distance mode): a light surface is enough
            surf = only_triangles(surf.smooth_taubin(n_iter=20, pass_band=0.05))
            surf = surf.decimate(1.0 - 40000 / surf.n_cells, volume_preservation=True)
        out[name] = (outward(tris_of(only_triangles(surf))), float(vol))
        log(f"  {name}: gaps < {w_mm:.0f} mm, {vol*1e6:.0f} cm3 (half car)")
    return out


def wrap_wings(wings, W, year):
    """Fine wrap of each wing group -> {region: triangles} (front wing; rear wing above z 0.58, beam wing below)."""
    out = {}
    for k, lst in wings.items():
        if not lst:
            continue
        T = np.concatenate(lst)
        log(f"{k} wing: {len(lst)} pieces, {len(T)} triangles -> fine wrap {WING_H*1000:.2f} mm, r={WING_R}")
        surf, _, (sol, slo) = wrap(T, WING_H, WING_R, keep_solid=True)
        tri = outward(tris_of(finish(surf, WING_TARGET)))
        for name, (st, vol) in slot_regions(sol, slo, WING_H).items():
            SLOTS.setdefault(name, []).append(st)
        del sol
        if k == "fw":
            out.setdefault("frontwing", []).append(tri)
        elif k == "bg" or k.startswith("z"):   # vanes and other details: the usual position-based regions
            lab = classify(tri, W, year)
            for name in np.unique(lab):
                out.setdefault(str(name), []).append(tri[lab == name])
        else:
            up = tri.mean(1)[:, 2] > 0.58
            out.setdefault("rearwing", []).append(tri[up])
            out.setdefault("beamwing", []).append(tri[~up])
    return {k: np.concatenate(v) for k, v in out.items()}


EXIT_VIEW_MIN = 0.10


def rear_exit(tri, lab, W, target, sym=False, view_min=EXIT_VIEW_MIN, exclude=None, strict=None):
    """Radiator exit: the rear-most rear-facing bodywork around the gearbox, inboard of the rear wheels, up to
    `target` m^2 (half car). The faces closest to the rear-most face of the largest rear-facing patch are taken
    from all the rear-facing candidates (a single connected patch can be much smaller than the target after
    decimation, which made the exit jet 2x faster). Only faces open to the outside behind the car are candidates:
    rear view fraction (cavity.rear_view_fraction: share of the face seen from within 45 deg of straight behind)
    >= `view_min`. A face in a closed pocket of the bodywork gives the exit jet nowhere to go: on the RB12 coarse
    mesh the 10 % of the exit area in pockets ahead of the gearbox-cover recess (view fraction 0, p90 0.07) put
    the exit face at Cp 1.23 on average; the faces in the recess, which is open towards the back, have 0.1-0.25.
    If too few faces pass, the threshold is halved (then dropped).
    `strict`: faces that are candidates only when seen from behind at >= `view_min`, whatever the fallback - the plug
    of the CAD-skin body. Where the model's shell is open at the back (MCL39 engine-cover spine, RB12 gearbox cover)
    the plug is the car's rear closure and the exit belongs there; elsewhere it lies hidden behind the skin. With the
    model's own rear-facing triangles alone the MCL39 exit came out 31 cm2 for a 71 cm2 target and the RB12 one fell
    back to faces in a closed pocket (view fraction 0). With `strict`, a seen area short of the target is accepted
    down to half of it (exit jet up to 1x U instead of 0.5x) before the threshold is dropped."""
    from cavity import tri_area, rear_view_fraction
    c = tri.mean(1)
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1)[:, None] + 1e-30
    cand = ((n[:, 0] > 0.6) & (c[:, 0] > W["xr"] - 0.9) & (c[:, 0] < W["xr"] + 0.25) & (np.abs(c[:, 1]) > 0.08)
            & (np.abs(c[:, 1]) < 0.40) & (c[:, 2] > 0.15) & (c[:, 2] < 0.70) & np.isin(lab, ["body", "sidepods"]))
    if exclude is not None:                                # internal faces (inside the detail-zone solids)
        cand &= ~exclude
    if sym:                                                # full-car surface: pick on the y > 0 side, mirror by |y|
        cand &= c[:, 1] > 0
    if not cand.any():
        return cand
    if view_min > 0:
        # occluders: the rear of the car (a face seen from behind can only be hidden by what is behind it)
        near = c[:, 0] > W["xr"] - 1.3
        fr = rear_view_fraction(tri[near])
        if fr is not None:
            a = tri_area(tri)
            view = np.zeros(len(tri))
            view[near] = fr
            if strict is not None:
                cand &= ~strict | (view >= view_min)
            for vm in (view_min, 0.5 * view_min):
                ok = cand & (view >= vm)
                log(f"  rear exit: {a[ok].sum() * 1e4:.0f} of {a[cand].sum() * 1e4:.0f} cm2 of rear-facing candidates seen from "
                    f"behind (view fraction >= {vm:.2f}); target {target * 1e4:.0f} cm2")
                if a[ok].sum() >= target:
                    cand = ok
                    break
            else:
                if strict is not None and a[ok].sum() >= 0.5 * target:
                    log(f"  rear exit: the {a[ok].sum() * 1e4:.0f} cm2 seen from behind taken (short of the target)")
                    cand = ok
        elif strict is not None:
            cand &= ~strict
    if not cand.any():
        return cand
    from cavity import pick_area, largest_patch
    big = largest_patch(tri, cand)
    if not big.any():
        return big
    i0 = np.where(big)[0][np.argmax(c[big, 0])]            # grow the exit from its rear-most face
    sel = pick_area(tri, cand, c[i0], target)
    if sym:                                                # the mirror-image faces on the y < 0 side
        from scipy.spatial import cKDTree
        sc = c[sel].copy()
        sc[:, 1] *= -1
        neg = np.where(c[:, 1] < 0)[0]
        if len(neg):
            dist, j = cKDTree(c[neg]).query(sc, distance_upper_bound=0.01)
            sel[neg[j[np.isfinite(dist)]]] = True
    return sel


def auto_zones(Tb, W, wing_h=None):
    """Detail zones of every car: the front wing, the rear + beam wing and, before 2022, the bargeboard region.
    Finite boxes around the model's triangles in the wing_box regions (wings on a 1.25 mm grid, or the car's
    "wing_h" {zone: voxel} where the model's slots are narrower)."""
    C = Tb.mean(1)
    out = []
    for k, (lo, hi) in wing_box(W).items():
        m = np.all((C >= lo) & (C <= hi), axis=1) & (Tb[..., 1].max(1) >= 0)
        if m.sum() < 50:
            continue
        V = Tb[m].reshape(-1, 3)
        V = V[V[:, 1] >= -0.005]
        zlo, zhi = V.min(0) - 0.015, V.max(0) + 0.015
        zlo = np.maximum(zlo, np.array(lo) - 0.015); zhi = np.minimum(zhi, np.array(hi) + 0.015)
        zlo[1] = max(zlo[1], -0.005)
        out.append((zlo.round(3).tolist(), zhi.round(3).tolist(),
                    float((wing_h or {}).get(k) or (WING_H if k in ("fw", "rw") else ZONE_H))))
    return out


def main(car, outdir, front_mm=0.0, rear_mm=0.0, h_body=0.0035, r_body=2, fill_interior=True, fine_wings=False,
         rebuild_wings=False):
    cfg = CARS[car]
    os.makedirs(outdir, exist_ok=True)
    parts, s, W, wheels, body, (Rf, Rr, xf, xr, yf, yr) = split_parts(car, rebuild_wings)
    global SPAN_CHUNKS
    SPAN_CHUNKS = bool(rebuild_wings)
    regions = {}
    wing_tri, wing_pieces = {}, {}
    if fine_wings:
        wing_pieces, body = split_wings(body, W, cfg.get("fine_zones", ()))
        wing_tri = wrap_wings(wing_pieces, W, cfg["year"])
    for k, lst in wheels.items():
        T = np.concatenate(lst).copy()
        T[..., 2] -= SINK
        log(f"{k}: {len(lst)} parts, {len(T)} triangles")
        regions[k] = outward(tris_of(finish(wrap(T, 0.004, 3)[0], 120000)))
    Tb = np.concatenate(body)
    log(f"body: {len(body)} parts, {len(Tb)} triangles")
    Tw = np.concatenate([p for lst in wing_pieces.values() for p in lst]) if fine_wings and any(wing_pieces.values()) else None
    ZONE_TRIS.clear()
    ZONE_CUTS.clear()
    zones = auto_zones(Tb, W, cfg.get("wing_h")) + [tuple(z) for z in cfg.get("detail_zones", ())]
    for z in zones:
        log(f"detail zone {z[0]} - {z[1]} at {1000 * (z[2] if len(z) > 2 else ZONE_H):.2f} mm")
    Tb_ids = np.concatenate([np.full(len(p), i, np.int32) for i, p in enumerate(body)])   # connected piece of each triangle
    plug = PLUG_MODE and fill_interior and Tw is None
    closed_ids = [i for i, c in enumerate(BODY_CLOSED) if c] if len(BODY_CLOSED) == len(body) else []
    if closed_ids:
        log(f"rebuilt wing elements: {len(closed_ids)} closed body pieces (slots next to them always reopen)")
    bsurf, cav = wrap(Tb, h_body, r_body, W=W if fill_interior else None, T_extra=Tw, zones=zones, T_ids=Tb_ids, plug=plug,
                      closed_ids=closed_ids)
    bsurf = finish(bsurf, PLUG_TRIS_BODY if plug else 450000)
    btri = outward(tris_of(bsurf))
    # detail zones: their closed surfaces join the body surface; the faces of the body where the zones were cut out lie
    # inside the zone solids (internal: never candidates for the cooling exit)
    nA = len(btri)
    if ZONE_TRIS:
        btri = np.concatenate([btri] + ZONE_TRIS)
    internal = np.zeros(len(btri), bool)
    cA = btri[:nA].mean(1)
    for clo, chi in ZONE_CUTS:
        inside = np.all((cA > clo - 2 * h_body) & (cA < chi + 2 * h_body), axis=1)
        on_cut = np.any(np.abs(cA - clo) < 1.5 * h_body, axis=1) | np.any(np.abs(cA - chi) < 1.5 * h_body, axis=1)
        internal[:nA] |= inside & on_cut
    nP = len(btri)                  # plug faces (wrapped-body faces without the plug)
    skin_info = {}
    if plug:
        # the walls: the model's own triangles that face the outside air, turned outwards; the hidden ones (engine,
        # cockpit and chassis insides, the duct-end panel) are left out, the plug fills in behind the skin
        T_all = PLUG["T"]
        keep = PLUG["outer"] & (T_all[..., 1].max(1) >= -0.002)
        Wt = T_all[keep].copy()
        fl = PLUG["flip"][keep]
        Wt[fl] = Wt[fl][:, ::-1]
        skin_info = {"model_triangles": int(len(T_all)), "wall_triangles": int(keep.sum()),
                     "hidden_left_out": int((~PLUG["outer"]).sum()), "duct_panel_left_out": int(PLUG["panel"].sum()),
                     "turned_outwards": int(fl.sum()), "orientation_uncertain": int((keep & ~PLUG["certain"]).sum()),
                     "plug_band_body_m": PLUG_BAND_COARSE * h_body, "plug_band_zone_voxels": PLUG_BAND_FINE}
        log(f"CAD skin: {keep.sum()} wall triangles of {len(T_all)} (hidden left out {skin_info['hidden_left_out']}), "
            f"plug {nP} triangles")
        # the plug up against the walls (no gap for the mesh to fill)
        n0 = np.cross(btri[:, 1] - btri[:, 0], btri[:, 2] - btri[:, 0])
        btri, nmv = plug_to_walls(btri, Wt[PLUG["certain"][keep]], zones, h_body)
        n1 = np.cross(btri[:, 1] - btri[:, 0], btri[:, 2] - btri[:, 0])
        a0 = np.linalg.norm(n0, axis=1)
        over = (n0 * n1).sum(1) < 0
        skin_info.update({"plug_vertices_onto_walls": nmv, "plug_snap_voxels": PLUG_SNAP, "plug_snap_eps_m": PLUG_SNAP_EPS,
                          "plug_area_turned_over": round(float(a0[over].sum() / a0.sum()), 5)})
        log(f"plug moved up against the walls: {nmv} vertices; {over.sum()} faces turned over "
            f"({100 * a0[over].sum() / a0.sum():.2f} % of the plug area)")
        del n0, n1, a0, over
        btri = np.concatenate([btri, Wt])
        internal = np.concatenate([internal, np.zeros(len(Wt), bool)])
        if os.environ.get("PLUG_DEBUG"):                 # local checks only: plug and walls apart
            os.makedirs(os.path.join(outdir, "debug"), exist_ok=True)
            write_stl_bin(os.path.join(outdir, "debug", "plug.stl"), btri[:nP], "plug")
            write_stl_bin(os.path.join(outdir, "debug", "walls.stl"), Wt, "walls")
            write_stl_bin(os.path.join(outdir, "debug", "hidden.stl"), T_all[~PLUG["outer"]], "hidden")
    lab = classify(btri, W, cfg["year"])
    cooling = None
    if cav is not None:
        from cavity import label_cooling, tri_area
        if plug:
            bt = btri                                    # plug faces outward (outward()), walls turned outwards
        else:
            vol = np.einsum("ij,ij->i", btri[:, 0], np.cross(btri[:, 1], btri[:, 2])).sum() / 6.0
            bt = btri if vol > 0 else btri[:, ::-1]      # outward-oriented copy for the normals
        cl = label_cooling(bt, cav)
        for name in ("inlets", "radiator_in", "radiator_out"):
            if name in cl:
                # never the internal faces where the detail zones were cut out (they lie inside the zone solids and
                # would double the radiator face area, hence the imposed flow rate)
                m_ = cl[name] & ~internal
                if plug and name != "inlets":
                    m_[nP:] = False                      # the radiator face is the plug's end of the duct
                lab[m_] = name
        if (lab == "radiator_in").any() and not (lab == "radiator_out").any():
            st = None
            if plug:                                     # plug faces only where they close the shell at the back
                st = np.zeros(len(btri), bool)
                st[:nP] = True
            lab[rear_exit(bt, lab, W, 0.5 * tri_area(btri[lab == "radiator_in"]).sum(), exclude=internal,
                          strict=st)] = "radiator_out"
        if (lab == "radiator_in").any() and (lab == "radiator_out").any():
            ai, ao = tri_area(btri[lab == "radiator_in"]), tri_area(btri[lab == "radiator_out"])
            ci = (btri[lab == "radiator_in"].mean(1) * ai[:, None]).sum(0) / ai.sum()
            co = (btri[lab == "radiator_out"].mean(1) * ao[:, None]).sum(0) / ao.sum()
            sd = cav["ducts"]["sidepod"]
            m = sd["mouth"]
            ain = sd.get("inlet_area", m["area"])
            cooling = {"model": "fixed-flow radiator: duct end face = flow-rate outlet, rear exit = flow-rate inlet",
                       "ratio": 0.25, "face_area": float(ai.sum()), "exit_area": float(ao.sum()),
                       "inlet_area": ain, "duct_depth": cav["duct_depth"],
                       "face_centroid": ci.round(4).tolist(), "exit_centroid": co.round(4).tolist(),
                       "exit_from": "rear-facing bodywork",
                       **({"duct_closed_by_model_panel_at_x": round(sd["panel_x"], 4)} if "panel_x" in sd else {}),
                       **({"inlet_is_recess_inside_thin_gap": True} if sd.get("recess") else {})}
            log(f"cooling: radiator face {ai.sum()*1e4:.0f} cm2 at x {ci[0]:.2f}, exit {ao.sum()*1e4:.0f} cm2 at "
                f"({co[0]:.2f}, {co[1]:.2f}, {co[2]:.2f}) ({cooling['exit_from']}), inlet opening {ain*1e4:.0f} cm2 (half car)")
        else:
            for name in ("radiator_in", "radiator_out"):
                lab[lab == name] = "inlets" if name == "radiator_in" else "body"
            log("cooling: no sidepod inlet duct found - interior filled, no radiator flow")
    for k in np.unique(lab):
        regions[k] = btri[lab == k]
    for k, tri in wing_tri.items():       # finely wrapped wings join the regions of the same name
        regions[k] = np.concatenate([regions[k], tri]) if k in regions else tri
    slots = {k: np.concatenate(v) for k, v in SLOTS.items() if v}
    if abs(front_mm) > 1e-9 or abs(rear_mm) > 1e-9:
        dF, dR = front_mm / 1000.0, rear_mm / 1000.0
        th = np.arctan2(dR - dF, xr - xf)
        cth, sth = np.cos(th), np.sin(th)
        for k, tri in list(regions.items()) + list(slots.items()):
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
    # slot-gap refinement regions (closed surfaces, not walls): level 7 for gaps < 15 mm, 8 for gaps < 6 mm
    refine = {}
    for k, tri in slots.items():
        write_stl_bin(os.path.join(outdir, f"{k}.stl"), tri, k)
        refine[k] = {"file": f"{k}.stl", "level": 8 if k == "slots_narrow" else 7}
        log(f"{k:13s} tris={len(tri):7d} (refinement region)")
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
        "wrap": {"body_voxel_m": h_body, "body_close_voxels": r_body, "wheel_voxel_m": 0.004, "wheel_close_voxels": 3,
                 **({"wing_voxel_m": WING_H, "wing_close_voxels": WING_R, "wing_regions": sorted(wing_tri)} if wing_tri else {}),
        "detail_zones": [[list(z[0]), list(z[1]), (z[2] if len(z) > 2 else ZONE_H)] for z in zones],
                 **({"walls": "model triangles facing the outside air (CAD skin); the voxel solid is an inner plug",
                     "skin": skin_info} if plug else {}),
                 "interior_filled": cav is not None,
                 **({"enclosure_max_escapes": cav["K"], "enclosure_cell_m": round(cav["c"], 4), "core_cells": cav["core_cells"],
                     "inside_skin_test": cav.get("skin_test"),
                     "openings_used": [{k2: m[k2] for k2 in ("kind", "area", "x", "y", "z", "n")} for m in cav["mouths"] if m.get("kind")]} if cav else {})},
        **({"cooling": cooling, "patch_types": {"radiator_in": "patch", "radiator_out": "patch"}} if cooling else {}),
        "levels": {k: list(LEVELS.get(k, (4, 5))) for k in names},
        "refine_regions": refine,
        "gap_boxes": {f"gap_{k}": gap_box(regions[k]) for k in ("frontwing", "rearwing", "beamwing", "bargeboards")
                      if k in info and (k != "bargeboards" or "bg" in wing_box(W))},
        "force_groups": {**{k: [k] for k in names if not k.startswith("radiator_")},
                         **({"cooling": ["radiator_in", "radiator_out"]} if cooling else {})},
        "no_layers": [k for k in ("suspension", "radiator_in", "radiator_out") if k in names],
        "variant": {"front_rh_mm": front_mm, "rear_rh_mm": rear_mm},
        **({"wing_rebuild": [{k: r[k] for k in ("element", "role", "profile", "chord_m", "angle_deg", "span", "new_triangles")}
                             for r in WING_REBUILT]} if WING_REBUILT else {}),
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
    ap.add_argument("--rebuild-wings", action="store_true", help="replace the wing elements by clean aerofoils (wing_rebuild.py)")
    a = ap.parse_args()
    main(car, a.outdir, a.front_rh_mm, a.rear_rh_mm, rebuild_wings=a.rebuild_wings)
