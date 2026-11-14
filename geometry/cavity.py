"""Fill the hollow interior of a wrapped visual model; keep the sidepod inlets as ducts to a radiator face.

Render models are only an outer skin. The surface wrapper (build_glb.wrap) closes small gaps, but the big
openings (sidepod inlets, airbox, cockpit, rear cooling exits) stay open, so the outside-air flood fill
runs into the car and the result is a thin shell full of nearly still air. This module:

 1. ENCLOSURE TEST (coarse grid, ~1 cm, full car by mirroring the half model): from every air cell a
    straight ray is cast in each of the 26 lattice directions; a cell is inside when at most K of them
    leave the box without hitting the skin. Enclosed pockets with no thick core (gaps between wing
    elements or floor fences, the cluttered rear end) are left as outside air: the interior of a car
    is a thick volume.
 2. OPENINGS of the interior (cavity cells touching outside air) are classified:
      - sidepod inlet  (forward-facing, beside the chassis between the axles)
      - airbox         (forward-facing, above the driver)
      - cooling exit   (rear-facing, at the back of the bodywork)
    The sidepod inlet and the airbox keep a straight duct (the inside of the bodywork, limited to the
    opening's frontal footprint) down to a flat face `duct_depth` metres behind the opening. The sidepod
    duct ends in the RADIATOR FACE, which the CFD case turns into a fixed-flow outlet; the cooling air
    is returned through the RADIATOR EXIT (the cap of the rear opening, or a rear-facing patch of the
    bodywork), a fixed-flow inlet. The airbox duct ends in a wall (the engine takes a small fraction of
    the air it captures, so the airbox is close to stagnation).
 3. Everything else inside becomes solid; the fine (wrapper) air mask is updated by growing the coarse
    decision into the cells next to the skin without crossing it, and air pockets left without a path
    to the outside are removed.
"""
from __future__ import annotations

import numpy as np
from scipy import ndimage

DIRS = [(dx, dy, dz) for dx in (-1, 0, 1) for dy in (-1, 0, 1) for dz in (-1, 0, 1) if (dx, dy, dz) != (0, 0, 0)]
S6 = ndimage.generate_binary_structure(3, 1)
S26 = ndimage.generate_binary_structure(3, 3)


def _shift2(a, d1, d2):
    """out[j, k] = a[j + d1, k + d2]; cells beyond the array are True (the ray has left the box)."""
    out = np.ones_like(a)
    n1, n2 = a.shape
    out[max(0, -d1):n1 - max(0, d1), max(0, -d2):n2 - max(0, d2)] = \
        a[max(0, d1):n1 - max(0, -d1), max(0, d2):n2 - max(0, -d2)]
    return out


def escape_count(free):
    """For every cell, the number of the 26 lattice directions in which a straight ray leaves the box
    through free cells only (0 for solid cells), and the mask of cells whose upward (+z) ray escapes."""
    cnt = np.zeros(free.shape, np.uint8)
    up = None
    for d in DIRS:
        a = next(i for i in range(3) if d[i] != 0)
        f = np.moveaxis(free, a, 0)
        o = [i for i in range(3) if i != a]
        d1, d2 = d[o[0]], d[o[1]]
        esc = np.empty_like(f)
        n = f.shape[0]
        prev = None
        for i in (range(n - 1, -1, -1) if d[a] > 0 else range(n)):
            nxt = np.ones(f.shape[1:], bool) if prev is None else _shift2(prev, d1, d2)
            prev = esc[i] = f[i] & nxt
        e = np.moveaxis(esc, 0, a)
        cnt += e
        if d == (0, 0, 1):
            up = e.copy()
    return cnt, up


def _shifted(a, ax, sgn):
    """b[i] = a[i + sgn] along axis ax (False beyond the array)."""
    b = np.zeros_like(a)
    src = [slice(None)] * 3
    dst = [slice(None)] * 3
    if sgn > 0:
        dst[ax], src[ax] = slice(0, -1), slice(1, None)
    else:
        dst[ax], src[ax] = slice(1, None), slice(0, -1)
    b[tuple(dst)] = a[tuple(src)]
    return b


def _mouths(cavity, outside, lo, c):
    """Openings of the interior: connected sets of cavity cells that touch outside air (6-neighbours)."""
    mouth = cavity & ndimage.binary_dilation(outside, S6)
    lab, n = ndimage.label(mouth, S26)
    out = []
    if n == 0:
        return lab, out
    nrm = np.zeros((n + 1, 3))                       # outward direction: offsets towards outside neighbours
    for ax in range(3):
        for sgn in (-1, 1):
            nrm[:, ax] += sgn * np.bincount(lab[mouth & _shifted(outside, ax, sgn)], minlength=n + 1)
    idx = np.arange(1, n + 1)
    cells = ndimage.sum(np.ones_like(lab), lab, idx)
    cen = np.array(ndimage.center_of_mass(mouth, lab, idx)).reshape(-1, 3)
    sl = ndimage.find_objects(lab)
    for i in range(n):
        p = lo + (cen[i] + 0.5) * c
        v = nrm[i + 1] / (np.linalg.norm(nrm[i + 1]) + 1e-12)
        b0 = lo + np.array([s.start for s in sl[i]]) * c
        b1 = lo + np.array([s.stop for s in sl[i]]) * c
        out.append({"id": i + 1, "area": float(cells[i] * c * c), "x": float(p[0]), "y": float(p[1]), "z": float(p[2]),
                    "n": v.round(2).tolist(), "bbox": [b0.round(3).tolist(), b1.round(3).tolist()]})
    return lab, out


def classify_mouth(m, W):
    """sidepod (radiator inlet), airbox, exit (rear-facing cooling outlet) or None."""
    if m["area"] < 0.002:
        return None
    nx = m["n"][0]
    if nx < -0.7:                                    # facing the oncoming flow
        if m["y"] > 0.16 and W["xf"] + 0.35 < m["x"] < W["xr"] - 0.60 and 0.20 < m["z"] < 0.85:
            return "sidepod"
        if m["y"] < 0.16 and m["z"] > 0.68 and W["xf"] + 0.80 < m["x"] < W["xr"]:
            return "airbox"
    if nx > 0.6 and W["xr"] - 1.3 < m["x"] < W["xr"] + 0.4 and 0.20 < m["z"] < 0.75 and 0.05 < m["y"] < W["y_in"] - 0.05:
        return "exit"
    return None


def _duct(cavity, outside, lab, m, lo, c, depth, margin, sgn=-1):
    """Straight duct behind a forward-facing opening: cavity cells inside the opening's frontal (y-z)
    footprint, grown by `margin`, from the opening down to the plane x = x_face. Returns (mask, x_face, footprint)."""
    front = (lab == m["id"]) & _shifted(outside, 0, sgn)   # the part that faces the opening direction
    mc = np.argwhere(front) if front.any() else np.argwhere(lab == m["id"])
    fp = np.zeros(cavity.shape[1:], bool)
    fp[mc[:, 1], mc[:, 2]] = True
    lb, nb = ndimage.label(fp, ndimage.generate_binary_structure(2, 2))
    if nb > 1:                                        # keep the largest frontal blob of the opening
        big = 1 + int(np.argmax(ndimage.sum(fp, lb, np.arange(1, nb + 1))))
        fp = lb == big
        mc = mc[fp[mc[:, 1], mc[:, 2]]]
    x_face = float(lo[0] + (np.median(mc[:, 0]) + 0.5) * c - sgn * depth)
    i_face = int(np.floor((x_face - lo[0]) / c))
    r = max(1, int(round(margin / c)))
    fp = ndimage.binary_dilation(fp, ndimage.generate_binary_structure(2, 2), iterations=r)
    prism = np.zeros_like(cavity)
    if sgn < 0:
        prism[max(0, mc[:, 0].min() - 1):i_face] = fp[None, :, :]
    else:
        prism[max(0, i_face + 1):mc[:, 0].max() + 2] = fp[None, :, :]
    cand = cavity & prism
    labd, _ = ndimage.label(cand, S6)
    ids = np.unique(labd[mc[:, 0], mc[:, 1], mc[:, 2]])
    ids = ids[ids > 0]
    return np.isin(labd, ids), x_face, fp


def blocking_panel(T, W, x_mouth, x_face, fp, lo, c, frac=0.6, win=0.04):
    """A sheet of the visual model across the sidepod duct. Some models close the inlet a few cm in with a single
    panel that does not seal it, so the enclosure test finds the interior behind it and the duct ran through the
    panel's edge gaps (RB12: radiator face at -96 kPa). Returns the area-weighted x of the first `win`-long
    stretch of the duct where the transverse (|n_x| > 0.5) bodywork triangles inside the duct footprint add up
    to `frac` of the footprint section, or None. A gradual narrowing (MCL39: 32 %) is not a panel."""
    Tb = T[bodywork_tris(T, W)]
    cen = Tb.mean(1)
    n = np.cross(Tb[:, 1] - Tb[:, 0], Tb[:, 2] - Tb[:, 0])
    a = 0.5 * np.linalg.norm(n, axis=1)
    nx = n[:, 0] / (2 * a + 1e-30)
    j = np.floor((np.abs(cen[:, 1]) - lo[1]) / c).astype(int)
    k = np.floor((cen[:, 2] - lo[2]) / c).astype(int)
    ok = (j >= 0) & (j < fp.shape[0]) & (k >= 0) & (k < fp.shape[1])
    inf = np.zeros(len(Tb), bool)
    inf[ok] = fp[j[ok], k[ok]]
    sel = inf & (cen[:, 0] > x_mouth) & (cen[:, 0] < x_face) & (np.abs(nx) > 0.5)
    if not sel.any():
        return None
    o = np.argsort(cen[sel, 0])
    xs, ar = cen[sel, 0][o], a[sel][o]
    ca = np.concatenate([[0.0], np.cumsum(ar)])
    jend = np.searchsorted(xs, xs + win)
    hit = np.where(ca[jend] - ca[:-1] >= frac * fp.sum() * c * c)[0]
    if not len(hit):
        return None
    w = slice(hit[0], jend[hit[0]])
    return float((xs[w] * ar[w]).sum() / ar[w].sum())


def bodywork_tris(T, W):
    """Triangles that can enclose the interior: everything except the wings, beam wing, suspension and
    the diffuser zone (by position, like build_glb.classify). Cluttered exterior regions (between rear
    suspension, beam wing and diffuser, or between wing elements) then see out and stay air."""
    c = T.mean(1)
    x, y, z = c[:, 0], np.abs(c[:, 1]), c[:, 2]
    xf, xr, R = W["xf"], W["xr"], W["R"]
    fw_z = 0.36 if W.get("year", 2000) >= 2022 else 0.33
    fw = (x < xf - 0.75 * R) & ((z < fw_z) | (y > 0.20))
    rw = (x > xr + 0.05) & (z > 0.58)
    bw = (x > xr - 0.05) & (z > 0.28) & (z <= 0.58) & (y < 0.55)
    diff = (x > xr - 0.55) & (z < 0.30)
    susp = (y > 0.22) & (y < W["y_in"] + 0.02) & (z > 0.08) & (z < 0.62) & ((np.abs(x - xf) < 0.45) | (np.abs(x - xr) < 0.45))
    return ~(fw | rw | bw | diff | susp)


def _raster(T, lo, c, shape):
    from build_glb import sample_points
    occ = np.zeros(shape, bool)
    for P in sample_points(T, c):
        idx = np.floor((P - lo) / c).astype(np.int64)
        ok = np.all((idx >= 0) & (idx < np.array(shape)), axis=1)
        idx = idx[ok]
        occ[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    return occ


def fill(ext, h, lo, W, T=None, k=3, K=3, core_cells=3.0, duct_depth=0.30, margin=0.03, log=print):
    """ext: fine air mask of the half model (bool, y index 0 at lo[1] < 0); h: fine voxel size; T: the
    body triangles (their bodywork subset is the obstacle set of the enclosure test).
    Returns (new air mask, info dict for region labelling)."""
    lo = np.asarray(lo, float)
    sh = np.array(ext.shape)
    pad = (-sh) % k
    E = np.pad(ext, [(0, p) for p in pad], constant_values=True)
    nC = np.array(E.shape) // k
    c = k * h
    solidC = (~E).reshape(nC[0], k, nC[1], k, nC[2], k).any(axis=(1, 3, 5))
    del E
    freeC = ~solidC
    # 1. enclosure test on the full car (mirror of the half model across the symmetry side of the box)
    obst = solidC
    if T is not None:
        Tb = T[bodywork_tris(T, W)]
        Tb = Tb[Tb[..., 1].max(1) >= lo[1]]
        obst = _raster(Tb, lo, c, solidC.shape) | ndimage.binary_erosion(solidC, S6, iterations=2)
        log(f"  enclosure obstacles: bodywork {len(Tb)} of {len(T)} triangles")
    full = np.concatenate([obst[:, ::-1], obst], axis=1)
    free_core = ~ndimage.binary_dilation(full, S6)       # thickened skin: no leaks between diagonal cells
    cnt, upesc = escape_count(free_core)
    cnt, upesc = cnt[:, nC[1]:], upesc[:, nC[1]:]
    free_core = free_core[:, nC[1]:]
    del full
    # inside: enclosed in (almost) every direction AND covered by the bodywork from above (the interior of a
    # car is under its skin; open-topped spaces between bargeboards, sidepods and wings stay outside)
    out_core = free_core & ((cnt > K) | upesc)
    outside = freeC & (out_core | (~free_core & ndimage.binary_dilation(out_core, S26)))
    cavity = freeC & ~outside
    labc, nc = ndimage.label(cavity, S26)
    if nc:
        dist = ndimage.distance_transform_edt(cavity)
        thick = np.concatenate([[False], np.asarray(ndimage.maximum(dist, labc, np.arange(1, nc + 1))) >= core_cells])
        dropped = cavity & ~thick[labc]
        log(f"  enclosed pockets: {nc}, thick: {int(thick.sum())}; thin pockets left as air: {dropped.sum() * c**3 * 2000:.0f} L")
        cavity = thick[labc]
        outside = freeC & ~cavity
        del dist, dropped
    del labc
    # 2. openings
    lab, mouths = _mouths(cavity, outside, lo, c)
    for m in mouths:
        m["kind"] = classify_mouth(m, W)
    for m in sorted(mouths, key=lambda m: -m["area"])[:14]:
        log(f"    opening {m['id']:4d}: {m['area']*1e4:6.1f} cm2 at x {m['x']:.2f} y {m['y']:.2f} z {m['z']:.2f} facing {m['n']}"
            f"{'  <- ' + m['kind'] if m['kind'] else ''}")
    pick = {}
    for kind in ("sidepod", "airbox", "exit"):
        cands = [m for m in mouths if m["kind"] == kind]
        if kind == "exit" and "sidepod" in pick:     # a usable exit passes a flow similar to the inlet's
            cands = [m for m in cands if m["area"] >= 0.4 * pick["sidepod"]["area"]]
        if cands:
            pick[kind] = max(cands, key=lambda m: m["area"])
    ducts = {}
    # (the radiator exit is not taken from the model's rear openings, which vary from model to model: it is
    #  the rear-facing bodywork around the gearbox, chosen on the surface by build_glb.rear_exit)
    for kind, depth, sgn in (("sidepod", duct_depth, -1), ("airbox", duct_depth, -1)):
        if kind in pick:
            mask, x_face, fp = _duct(cavity, outside, lab, pick[kind], lo, c, depth, margin, sgn)
            ducts[kind] = {"mask": mask, "x_face": x_face, "footprint": fp, "mouth": pick[kind]}
            if kind == "sidepod" and T is not None and mask.any():
                # a panel of the model across the duct that does not seal it: the duct ends at the panel
                xb = blocking_panel(T, W, pick[kind]["x"], x_face, fp, lo, c)
                ix = np.where(mask.any(axis=(1, 2)))[0]
                if xb is not None and lo[0] + (ix.max() + 1) * c > xb + 0.04:
                    ib = int(np.floor((xb - lo[0]) / c))
                    cut = mask.copy()
                    cut[ib:] = False
                    labc, nc = ndimage.label(cut, S6)
                    if nc:
                        ids = np.unique(labc[ix.min():ix.min() + 2])
                        ids = ids[ids > 0]
                        cut = np.isin(labc, ids)
                    if cut.any():
                        log(f"  sidepod duct closed by a panel of the model at x = {xb:.3f} (was open to x = {x_face:.2f})")
                        ducts[kind].update(mask=cut, x_face=xb, panel_x=xb)
    keep = np.zeros_like(cavity)
    for d in ducts.values():
        keep |= d["mask"]
    fillC = cavity & ~keep
    exit_cells = None
    log(f"  interior {cavity.sum() * c**3 * 2000:.0f} L (full car): filled {fillC.sum() * c**3 * 2000:.0f} L, "
        + ", ".join(f"{k2} duct {d['mask'].sum() * c**3 * 2000:.0f} L to x = {d['x_face']:.2f}" for k2, d in ducts.items())
        + (f"; exit opening {pick['exit']['area']*1e4:.0f} cm2 at x {pick['exit']['x']:.2f}" if "exit" in pick else "; no rear opening"))
    # 3. fine level: grow both decisions into the partly-solid cells next to the skin, never across it
    up = lambda a: np.repeat(np.repeat(np.repeat(a, k, 0), k, 1), k, 2)[:sh[0], :sh[1], :sh[2]]
    F = up(fillC) & ext
    A = up(freeC & ~fillC) & ext
    for _ in range(k + 1):
        A |= ndimage.binary_dilation(A, S6) & ext & ~F
        F |= ndimage.binary_dilation(F, S6) & ext & ~A
    new = ext & ~F
    del A, F
    labf, _ = ndimage.label(new)                         # drop air pockets with no path to the outside
    border = np.unique(np.concatenate([labf[0].ravel(), labf[-1].ravel(), labf[:, -1].ravel(), labf[:, :, 0].ravel(), labf[:, :, -1].ravel()]))
    new = np.isin(labf, border[border > 0])
    del labf
    log(f"  fine air cells removed: {(ext & ~new).sum() / 1e6:.2f} M")
    return new, {"lo": lo, "c": c, "K": K, "core_cells": core_cells, "duct_depth": duct_depth, "mouths": mouths,
                 "ducts": ducts, "exit_cells": exit_cells, "exit": pick.get("exit"), "cavity": cavity, "filled": fillC,
                 "escapes": cnt}


# ------------------------------------------------------------------------------------------------ labelling
def _probe(tri_c, n, info, mask, dist):
    lo, c = info["lo"], info["c"]
    p = tri_c + n * dist
    p[:, 1] = np.abs(p[:, 1])
    idx = np.floor((p - lo) / c).astype(int)
    ok = np.all((idx >= 0) & (idx < np.array(mask.shape)), axis=1)
    hit = np.zeros(len(p), bool)
    hit[ok] = mask[idx[ok, 0], idx[ok, 1], idx[ok, 2]]
    return hit


def pick_area(tri, cand, centre, target):
    """The candidate triangles closest to `centre` whose total area just reaches `target`."""
    idx = np.where(cand)[0]
    sel = np.zeros(len(tri), bool)
    if len(idx) == 0:
        return sel
    d = np.linalg.norm(tri[idx].mean(1) - centre, axis=1)
    idx = idx[np.argsort(d)]
    a = np.cumsum(tri_area(tri[idx]))
    sel[idx[:int(np.searchsorted(a, target)) + 1]] = True
    return sel


def label_cooling(tri, info, exit_ratio=0.5):
    """Labels for the triangles of the wrapped body (outward-oriented): 'radiator_in' (duct end face of
    the sidepod), 'inlets' (duct walls), 'radiator_out' (rear exit, `exit_ratio` x the radiator face area
    taken around the centre of the rear opening). Returns dict name -> bool mask."""
    c = info["c"]
    cen = tri.mean(1)
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1)[:, None] + 1e-30
    lab = {}
    duct_any = np.zeros(len(tri), bool)
    for kind, d in info["ducts"].items():
        hit = np.zeros(len(tri), bool)
        for f in (0.5, 1.0, 1.5):
            hit |= _probe(cen, n, info, d["mask"], f * c)
        if kind != "exit":
            duct_any |= hit
        if kind == "sidepod":
            # radiator face: the forward-facing end wall of the duct - the cut plane behind a deep inlet,
            # or the back panel of a shallow inlet recess (some visual models close the inlet a few cm in)
            lo = info["lo"]
            j = np.floor((np.abs(cen[:, 1]) - lo[1]) / c).astype(int)
            kz = np.floor((cen[:, 2] - lo[2]) / c).astype(int)
            fp = d["footprint"]
            ok = (j >= 0) & (j < fp.shape[0]) & (kz >= 0) & (kz < fp.shape[1])
            infp = np.zeros(len(tri), bool)
            infp[ok] = fp[j[ok], kz[ok]]
            ix = np.where(d["mask"].any(axis=(1, 2)))[0]
            x0, x1 = lo[0] + ix.min() * c, lo[0] + (ix.max() + 1) * c
            d["x_end"] = float(x1)
            face = hit & infp & (n[:, 0] < -0.7) & (cen[:, 0] > max(x0 + 0.5 * (x1 - x0), x1 - 4 * c))
            lab["radiator_in"] = face
        if kind == "exit" and "radiator_in" in lab and lab["radiator_in"].any():
            lo = info["lo"]
            j = np.floor((np.abs(cen[:, 1]) - lo[1]) / c).astype(int)
            kz = np.floor((cen[:, 2] - lo[2]) / c).astype(int)
            fp = d["footprint"]
            ok = (j >= 0) & (j < fp.shape[0]) & (kz >= 0) & (kz < fp.shape[1])
            infp = np.zeros(len(tri), bool)
            infp[ok] = fp[j[ok], kz[ok]]
            ix = np.where(d["mask"].any(axis=(1, 2)))[0]
            if len(ix):
                x0 = lo[0] + ix.min() * c
                wall = hit & infp & (n[:, 0] > 0.7) & (cen[:, 0] < x0 + 4 * c)
                wall = largest_patch(tri, wall)
                if wall.any():
                    a = tri_area(tri[wall])
                    ctr = (tri[wall].mean(1) * a[:, None]).sum(0) / a.sum()
                    lab["radiator_out"] = pick_area(tri, wall, ctr, exit_ratio * tri_area(tri[lab["radiator_in"]]).sum())
    lab["inlets"] = duct_any & ~lab.get("radiator_in", np.zeros(len(tri), bool)) & ~lab.get("radiator_out", np.zeros(len(tri), bool))
    return lab


def largest_patch(tri, cand):
    """The connected (shared-vertex) set of candidate triangles with the largest area."""
    idx = np.where(cand)[0]
    if len(idx) == 0:
        return cand
    V = tri[idx].reshape(-1, 3)
    q = np.round(V / 1e-5).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    F = inv.reshape(-1, 3)
    parent = np.arange(inv.max() + 1)
    for _ in range(1000):
        m = np.minimum(np.minimum(parent[F[:, 0]], parent[F[:, 1]]), parent[F[:, 2]])
        old = parent.copy()
        for col in (F[:, 0], F[:, 1], F[:, 2]):
            np.minimum.at(parent, col, m)
        parent = parent[parent]
        if np.array_equal(parent, old):
            break
    comp = parent[F[:, 0]]
    a = tri_area(tri[idx])
    u, ci = np.unique(comp, return_inverse=True)
    best = np.argmax(np.bincount(ci, weights=a))
    out = np.zeros(len(tri), bool)
    out[idx[ci == best]] = True
    return out


def tri_area(tri):
    return 0.5 * np.linalg.norm(np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0]), axis=1)
