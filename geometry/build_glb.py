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
        "source": {"title": "2016 Redbull RB12", "author": "Dave Love SketchFab", "url": "https://sketchfab.com/3d-models/d9b5ce8c5d234deeb9cb57f5029dad57",
                   "license": "CC BY 4.0", "license_url": "http://creativecommons.org/licenses/by/4.0/"},
    },
    "mp45": {
        "name": "McLaren MP4/5 (1989)", "npz": "mp45.npz", "tread": r"^(front|back)_wheels\|", "drop": r"^$", "tyres_only": True,
        "tyre_d": 0.660, "width": 2.130, "year": 1989,
        # detail zones (review): diffuser and rear-wheel area, front-wheel area, sidepod side
        "detail_zones": [[[1.95, 0.03, 0.0], [2.90, 0.65, 0.45]], [[-0.15, 0.40, 0.10], [0.30, 0.85, 0.50]],
                         [[1.60, 0.25, 0.30], [1.95, 0.55, 0.60]]],
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


ZONE_H, ZONE_M, ZONE_BAND = 0.0015, 0.012, 7
ZONE_RAY_STRIDE, ZONE_RAY_LEN, ZONE_RAYS_OPEN = 3, 0.30, 3   # ray test of the reopened pockets (see carve_zone)
ZONE_THICK = 0.010                    # half-thickness above which a reopened pocket is the inside of a part
ZONE_MIN_CM3 = 2.0                    # smallest reopened gap kept
ZONE_ONE_PIECE = 0.8                  # rays hitting one piece for more than this share: inside that piece
_DIRS = np.array([(i, j, k) for i in (-1, 0, 1) for j in (-1, 0, 1) for k in (-1, 0, 1) if (i, j, k) != (0, 0, 0)], float)
_DIRS /= np.linalg.norm(_DIRS, axis=1)[:, None]


def ray_escapes(smp, wall_id, outside, kmax):
    """For voxel samples, 26 straight rays: how many reach outside air before a wall voxel (leaving the grid counts as
    blocked), the share of the wall hits that land on the most-hit piece of the model, and the number of hits."""
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
    best = np.zeros(n, int); run = np.ones(n, int)
    for c in range(1, hs.shape[1]):
        same = (hs[:, c] == hs[:, c - 1]) & (hs[:, c] >= 0)
        run = np.where(same, run + 1, 1)
        best = np.maximum(best, np.where(hs[:, c] >= 0, run, 0))
    best = np.maximum(best, (hs[:, 0] >= 0).astype(int))
    share = best / np.maximum(nhit, 1)
    return esc, share, nhit
ZONE_TRIS = []      # closed surfaces of the detail zones (filled by carve_zone)
ZONE_CUTS = []      # boxes removed from the coarse solid (their faces are internal, inside the zone surfaces)


ZONE_MAXVOX = 1.3e8


def zone_chunks(zlo, zhi, hf):
    """Split a detail-zone box along its longest side into chunks of at most ZONE_MAXVOX fine voxels (with margins).
    Neighbouring chunks overlap by twice the margin; the coarse solid is removed over the whole box."""
    n = int(np.ceil(np.prod((zhi - zlo + 2 * ZONE_M) / hf) / ZONE_MAXVOX))
    if n <= 1:
        return [(zlo, zhi)]
    k = int(np.argmax(zhi - zlo))
    edges = np.linspace(zlo[k], zhi[k], n + 1)
    out = []
    for a, b in zip(edges[:-1], edges[1:]):
        lo_, hi_ = zlo.copy(), zhi.copy()
        lo_[k], hi_[k] = a, b
        out.append((lo_, hi_))
    return out


def carve_zone(T, zlo, zhi, solid, band, lo, h, hf=None, target=None, ids=None):
    """Detail zone: inside the box (+ margin ZONE_M) the solid is rebuilt on a ZONE_H grid. Outside air reaches every
    gap wider than ~3 fine voxels: flood fill of the fine air from the coarse body's outside air, allowed only through
    fine air that is outside air or coarse solid within ZONE_BAND coarse voxels of the surface (gaps the coarse wrap
    closed, not the filled interior). The fine solid (= not outside air) is a closed surface overlapping the coarse body
    by 1.5 margins; the caller removes the zone interior from the coarse solid. Its triangles go to ZONE_TRIS and the
    gaps found in it to the slot refinement regions."""
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
        esc, share, nhit = ray_escapes(smp, wall_id, outside, int(round(ZONE_RAY_LEN / hf)))
        # open to outside air through a few directions AND between different pieces of the model (a slot between two
        # elements); air whose walls all belong to one piece is the inside of that piece (hollow endplate, element)
        ok = (esc >= ZONE_RAYS_OPEN) & (share <= ZONE_ONE_PIECE) & (nhit >= 4)
        from scipy.spatial import cKDTree
        _, nn = cKDTree(smp).query(pts, k=1)
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
    S = ~(outside | reopen)
    del outside, reopen
    log(f"  detail zone {zlo.round(2).tolist()} - {zhi.round(2).tolist()}: {np.prod(shape)/1e6:.0f} M voxels at {hf*1000:.1f} mm, "
        f"{vreal*1e6:.0f} cm3 of closed gaps reopened; {vfake*1e6:.0f} cm3 of enclosed hollow-part insides kept solid")
    del cs
    S[0], S[-1], S[:, 0], S[:, -1], S[:, :, 0], S[:, :, -1] = False, False, False, False, False, False
    for name, (st, vol) in slot_regions(S, blo, hf).items():
        SLOTS.setdefault(name, []).append(st)
    f = ndimage.gaussian_filter(S.astype(np.float32), 0.6)
    del S
    grid = pv.ImageData(dimensions=shape, spacing=(hf, hf, hf), origin=blo)
    grid.point_data["s"] = f.ravel(order="F")
    del f
    surf = grid.contour([0.5], scalars="s").triangulate().clean()
    if surf.n_cells:
        # wing boxes (fine grid) keep more triangles than the other detail zones
        target = target or (250000 if hf <= WING_H + 1e-9 else 120000)
        ZONE_TRIS.append(outward(tris_of(finish(surf, target))))


def wrap(T, h, r, y0=0.0, W=None, T_extra=None, keep_solid=False, zones=(), T_ids=None):
    """Watertight half-model (y >= y0) surface of triangle soup T on an h-voxel grid, closing radius r voxels.
    With W (wheel geometry dict) the hollow interior is filled and the cooling inlets kept as blind ducts
    (cavity.py). T_extra (the finely wrapped wings): obstacles for the outside-air flood fill and the interior fill,
    exactly as if they were part of the body, but the solid that exists only because of them (within r voxels of
    their triangles and not within r voxels of T) is removed: the body keeps its shape and its filled interior,
    the wings and the gaps between their elements are left to the fine wrap. Returns (surface, cavity info or None)."""
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
            for clo, chi in zone_chunks(zlo, zhi, hz):
                carve_zone(T_all, clo, chi, solid, band, lo, h, hf=hz,
                           ids=None if T_ids is None or T_extra is not None else T_ids)
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
    if skin is None:
        f = ndimage.gaussian_filter(solid.astype(np.float32), 0.6)
    else:
        # skin keeps its sharpness; only the filled interior (caps, duct ends) is smoothed over ~5 mm. (Smoothing
        # skin + fill together at 1.5 voxels closed narrow outside gaps between skin panels: filling outwards.)
        f = np.maximum(ndimage.gaussian_filter(skin.astype(np.float32), 0.6),
                       ndimage.gaussian_filter((solid & ~skin).astype(np.float32), 1.5))
        del skin
    del solid
    grid = pv.ImageData(dimensions=shape, spacing=(h, h, h), origin=lo)
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
        surf = surf.decimate(1.0 - target / surf.n_cells)
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


def split_parts(car):
    """Load the model and split it into wheel parts (per axle) and body parts."""
    cfg = CARS[car]
    parts, s = load(car)
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
    org = lo - pad * H
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
        if surf.n_cells > 150000:
            surf = surf.decimate(1.0 - 150000 / surf.n_cells)
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


def rear_exit(tri, lab, W, target, sym=False, view_min=EXIT_VIEW_MIN, exclude=None):
    """Radiator exit: the rear-most rear-facing bodywork around the gearbox, inboard of the rear wheels, up to
    `target` m^2 (half car). The faces closest to the rear-most face of the largest rear-facing patch are taken
    from all the rear-facing candidates (a single connected patch can be much smaller than the target after
    decimation, which made the exit jet 2x faster). Only faces open to the outside behind the car are candidates:
    rear view fraction (cavity.rear_view_fraction: share of the face seen from within 45 deg of straight behind)
    >= `view_min`. A face in a closed pocket of the bodywork gives the exit jet nowhere to go: on the RB12 coarse
    mesh the 10 % of the exit area in pockets ahead of the gearbox-cover recess (view fraction 0, p90 0.07) put
    the exit face at Cp 1.23 on average; the faces in the recess, which is open towards the back, have 0.1-0.25.
    If too few faces pass, the threshold is halved (then dropped)."""
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
            for vm in (view_min, 0.5 * view_min):
                ok = cand & (view >= vm)
                log(f"  rear exit: {a[ok].sum() * 1e4:.0f} of {a[cand].sum() * 1e4:.0f} cm2 of rear-facing candidates seen from "
                    f"behind (view fraction >= {vm:.2f}); target {target * 1e4:.0f} cm2")
                if a[ok].sum() >= target:
                    cand = ok
                    break
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


def auto_zones(Tb, W):
    """Detail zones of every car: the front wing, the rear + beam wing and, before 2022, the bargeboard region.
    Finite boxes around the model's triangles in the wing_box regions (wings on a 1.25 mm grid)."""
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
        out.append((zlo.round(3).tolist(), zhi.round(3).tolist(), WING_H if k in ("fw", "rw") else ZONE_H))
    return out


def main(car, outdir, front_mm=0.0, rear_mm=0.0, h_body=0.0035, r_body=2, fill_interior=True, fine_wings=False):
    cfg = CARS[car]
    os.makedirs(outdir, exist_ok=True)
    parts, s, W, wheels, body, (Rf, Rr, xf, xr, yf, yr) = split_parts(car)
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
    zones = auto_zones(Tb, W) + [tuple(z) for z in cfg.get("detail_zones", ())]
    for z in zones:
        log(f"detail zone {z[0]} - {z[1]} at {1000 * (z[2] if len(z) > 2 else ZONE_H):.2f} mm")
    Tb_ids = np.concatenate([np.full(len(p), i, np.int32) for i, p in enumerate(body)])   # connected piece of each triangle
    bsurf, cav = wrap(Tb, h_body, r_body, W=W if fill_interior else None, T_extra=Tw, zones=zones, T_ids=Tb_ids)
    bsurf = finish(bsurf, 450000)
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
    lab = classify(btri, W, cfg["year"])
    cooling = None
    if cav is not None:
        from cavity import label_cooling, tri_area
        vol = np.einsum("ij,ij->i", btri[:, 0], np.cross(btri[:, 1], btri[:, 2])).sum() / 6.0
        bt = btri if vol > 0 else btri[:, ::-1]          # outward-oriented copy for the normals
        cl = label_cooling(bt, cav)
        for name in ("inlets", "radiator_in", "radiator_out"):
            if name in cl:
                lab[cl[name]] = name
        if (lab == "radiator_in").any() and not (lab == "radiator_out").any():
            lab[rear_exit(bt, lab, W, 0.5 * tri_area(btri[lab == "radiator_in"]).sum(), exclude=internal)] = "radiator_out"
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
