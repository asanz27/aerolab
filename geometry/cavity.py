"""Fill the hollow interior of a wrapped visual model; keep the sidepod inlets as ducts to a radiator face.

Render models are only an outer skin. The surface wrapper (build_glb.wrap) closes small gaps, but the big
openings (sidepod inlets, airbox, cockpit, rear cooling exits) stay open, so the outside-air flood fill
runs into the car and the result is a thin shell full of nearly still air. This module:

 1. ENCLOSURE TEST (coarse grid, ~1 cm, full car by mirroring the half model): from every air cell a
    straight ray is cast in each of the 26 lattice directions; a cell is inside when at most K of them
    leave the box without hitting the skin. Enclosed pockets with no thick core (gaps between wing
    elements or floor fences, the cluttered rear end) are left as outside air: the interior of a car
    is a thick volume.
    INSIDE THE SKIN ONLY: the ray test also takes deep EXTERIOR recesses (a tunnel under a raised
    monocoque, channels between floor fences under the sidepods, undercuts), which are seen from the
    outside in only a few directions. So a cell is kept only where the generalized winding number of the
    car's outer skin is >= 0.5 (Jacobson et al. 2013: 1 inside a closed outward-oriented surface, 0
    outside it however deep the recess, ~0.5 across an opening). The outer skin is the model without its
    inner surfaces (components lying inside the volume the others enclose: cockpit tub, footwell, inner
    liners, radiators), which visual models often orient towards the space they bound, and without the faces
    that are hidden or seen only through a small opening (exposure from orthographic views in 128
    directions, see outer_skin_oriented); each face seen from outside is oriented with that side out
    (visibility vote, Takayama et al. 2014). The hidden faces matter where a volume is closed by separate
    parts: an MCL39 sidepod shell open at the bottom sits on the closed floor slab, whose upper face would
    otherwise make the sidepod interior look outside; the barely exposed ones in the hollows of a printable
    model (MP4/4 sidepod and nose pockets, open at the back into the engine cover). The ducts are still
    found on the whole enclosed volume: an inlet recess may be outside the skin by this test.
    The skin test only removes volume from what the ray test encloses (it never fills more), apart from
    air left sealed off and streaks 1-2 cells thick inside the fill.
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
    fp0 = fp.copy()
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
    return np.isin(labd, ids), x_face, fp, fp0


def drop_thin(mask):
    """The duct without passages narrower than 3 cells (~3 cm): gaps between two skins of a visual model
    are not ducts (RB12: a 1-3 cm ring between the inlet's inner liner and the outer bodywork, which choked
    the imposed radiator flow at Cp -8). Keeps the largest remaining part."""
    core = ndimage.binary_opening(mask, S26)
    new = mask & ndimage.binary_dilation(core, S26)
    lab, n = ndimage.label(new, S6)
    if n > 1:
        new = lab == 1 + int(np.argmax(ndimage.sum(new, lab, np.arange(1, n + 1))))
    return new


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


# ------------------------------------------------------------------------------------------------ winding number
_WN = None


def _wn_kernel():
    import numba
    from numba import prange

    @numba.njit(parallel=True, fastmath=True, cache=True)
    def k(P, A, B, C):
        out = np.zeros(P.shape[0])
        for i in prange(P.shape[0]):
            px, py, pz = P[i, 0], P[i, 1], P[i, 2]
            s = 0.0
            for t in range(A.shape[0]):
                ax = A[t, 0] - px; ay = A[t, 1] - py; az = A[t, 2] - pz
                bx = B[t, 0] - px; by = B[t, 1] - py; bz = B[t, 2] - pz
                cx = C[t, 0] - px; cy = C[t, 1] - py; cz = C[t, 2] - pz
                la = np.sqrt(ax * ax + ay * ay + az * az)
                lb = np.sqrt(bx * bx + by * by + bz * bz)
                lc = np.sqrt(cx * cx + cy * cy + cz * cz)
                det = ax * (by * cz - bz * cy) - ay * (bx * cz - bz * cx) + az * (bx * cy - by * cx)
                div = la * lb * lc + (ax * bx + ay * by + az * bz) * lc + (bx * cx + by * cy + bz * cz) * la \
                    + (cx * ax + cy * ay + cz * az) * lb
                s += np.arctan2(det, div)
            out[i] = s / (2.0 * np.pi)
        return out
    return k


def winding(P, T):
    """Generalized winding number of triangle soup T at points P (sum of signed solid angles / 4 pi; van Oosterom &
    Strackee's formula). numba when available, numpy otherwise (slow)."""
    global _WN
    P = np.ascontiguousarray(P, np.float64)
    T = np.asarray(T, np.float64)
    A, B, C = (np.ascontiguousarray(T[:, i]) for i in range(3))
    if len(P) == 0 or len(T) == 0:
        return np.zeros(len(P))
    if _WN is None:
        try:
            _WN = _wn_kernel()
        except ImportError:
            _WN = False
    if _WN:
        return _WN(P, A, B, C)
    out = np.zeros(len(P))
    step = max(1, int(2e6 // len(T)))
    for s in range(0, len(P), step):
        p = P[s:s + step, None, :]
        a, b, c = A[None] - p, B[None] - p, C[None] - p
        la, lb, lc = (np.linalg.norm(v, axis=2) for v in (a, b, c))
        det = np.einsum("ijk,ijk->ij", a, np.cross(b, c))
        div = la * lb * lc + (a * b).sum(2) * lc + (b * c).sum(2) * la + (c * a).sum(2) * lb
        out[s:s + step] = np.arctan2(det, div).sum(1) / (2 * np.pi)
    return out


def component_ids(T):
    """Connected components of a triangle soup (welded shared vertices) -> id per triangle."""
    V = T.reshape(-1, 3)
    span = float((V.max(0) - V.min(0)).max()) or 1.0
    q = np.round(V / (span * 1e-6)).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    F = inv.ravel().reshape(-1, 3)
    parent = np.arange(F.max() + 1)
    for _ in range(1000):
        m = np.minimum(np.minimum(parent[F[:, 0]], parent[F[:, 1]]), parent[F[:, 2]])
        old = parent.copy()
        for col in (F[:, 0], F[:, 1], F[:, 2]):
            np.minimum.at(parent, col, m)
        parent = parent[parent]
        if np.array_equal(parent, old):
            break
    return np.unique(parent[F[:, 0]], return_inverse=True)[1].ravel()


def outer_skin(T, frac_inner=0.7, nsamp=256, log=print):
    """Triangles of T that bound the car from outside. A component (connected piece) whose surface lies, for at
    least `frac_inner` of its area, inside the volume enclosed by the other components (winding number >= 0.5) is an
    inner surface; a component reported inner only because of other inner ones is put back. Mirror-image pairs are
    decided together. Returns (bool mask per triangle, stats)."""
    cid = component_ids(T)
    n = int(cid.max()) + 1
    area = tri_area(T)
    cen = T.mean(1)
    order = np.argsort(cid, kind="stable")
    cnt = np.bincount(cid, minlength=n)
    st = np.concatenate([[0], np.cumsum(cnt)[:-1]])
    samp = np.concatenate([order[st[i] + np.unique(np.linspace(0, cnt[i] - 1, min(cnt[i], nsamp)).round().astype(int))]
                           for i in range(n)])
    sc = cid[samp]                                   # sorted by component
    P, wa = cen[samp], area[samp]
    sst = np.searchsorted(sc, np.arange(n + 1))
    Ts = T[order]
    w = winding(P, T)
    for i in range(n):                               # minus each component's own contribution
        if sst[i + 1] > sst[i]:
            w[sst[i]:sst[i + 1]] -= winding(P[sst[i]:sst[i + 1]], Ts[st[i]:st[i] + cnt[i]])
    A = np.bincount(cid, area, n)
    cc = np.stack([np.bincount(cid, area * cen[:, k], n) for k in range(3)], 1) / np.maximum(A, 1e-30)[:, None]
    from scipy.spatial import cKDTree
    d, j = cKDTree(cc).query(cc * np.array([1.0, -1.0, 1.0]))
    pair = (d < 0.01) & (np.abs(A[j] - A) <= 0.02 * A)

    def frac(wv, sel):
        a = np.bincount(sc[sel], wa[sel] * (wv[sel] >= 0.5), n) / np.maximum(np.bincount(sc[sel], wa[sel], n), 1e-30)
        return np.where(pair, 0.5 * (a + a[j]), a)
    inner = frac(w, np.ones(len(P), bool)) >= frac_inner
    for _ in range(4):
        si = inner[sc]
        if not si.any():
            break
        wi = np.zeros(len(P))
        wi[si] = winding(P[si], T[~inner[cid]])
        f2 = frac(wi, si)
        back = inner & (f2 < frac_inner)
        if not back.any():
            break
        inner &= ~back
    m = ~inner[cid]
    stats = {"components": n, "inner_components": int(inner.sum()), "inner_area_m2": round(float(area[~m].sum()), 3),
             "outer_area_m2": round(float(area[m].sum()), 3)}
    log(f"  outer skin: {n} components, {stats['inner_components']} inner ({stats['inner_area_m2']:.1f} m2) left out,"
        f" {stats['outer_area_m2']:.1f} m2 kept")
    return m, stats


_RS = None


def _raster_kernel():
    import numba

    @numba.njit(cache=True)
    def k(U, V, D, nu, nv, px, u0, v0, zbuf, ibuf):
        for t in range(U.shape[0]):
            ua, ub, uc = (U[t, 0] - u0) / px, (U[t, 1] - u0) / px, (U[t, 2] - u0) / px
            va, vb, vc = (V[t, 0] - v0) / px, (V[t, 1] - v0) / px, (V[t, 2] - v0) / px
            den = (vb - vc) * (ua - uc) + (uc - ub) * (va - vc)
            if abs(den) < 1e-12:
                continue
            i0 = max(0, int(np.floor(min(ua, ub, uc)))); i1 = min(nu - 1, int(np.ceil(max(ua, ub, uc))))
            j0 = max(0, int(np.floor(min(va, vb, vc)))); j1 = min(nv - 1, int(np.ceil(max(va, vb, vc))))
            for i in range(i0, i1 + 1):
                x = i + 0.5
                for j in range(j0, j1 + 1):
                    y = j + 0.5
                    l1 = ((vb - vc) * (x - uc) + (uc - ub) * (y - vc)) / den
                    l2 = ((vc - va) * (x - uc) + (ua - uc) * (y - vc)) / den
                    l3 = 1.0 - l1 - l2
                    if l1 < 0 or l2 < 0 or l3 < 0:
                        continue
                    d = l1 * D[t, 0] + l2 * D[t, 1] + l3 * D[t, 2]
                    if d < zbuf[i, j]:
                        zbuf[i, j] = d
                        ibuf[i, j] = t
    return k


def exterior_visibility(T, ndir=128, px=0.003):
    """Projected area of each triangle seen from outside the car on its front side (normal towards the viewer) and on
    its back side, summed over `ndir` orthographic z-buffer views (Fibonacci sphere of directions): the visibility
    vote of Takayama et al. 2014 for facet orientation. Returns (front, back), or None without numba."""
    global _RS
    if _RS is None:
        try:
            _RS = _raster_kernel()
        except ImportError:
            _RS = False
    if not _RS:
        return None
    N = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    front, back = np.zeros(len(T)), np.zeros(len(T))
    kk = np.arange(ndir) + 0.5
    phi, th = np.arccos(1 - 2 * kk / ndir), np.pi * (1 + 5 ** 0.5) * kk
    for d in np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1):
        a = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
        u = np.cross(d, a); u /= np.linalg.norm(u); v = np.cross(d, u)
        U, V, D = (np.ascontiguousarray(T @ e) for e in (u, v, d))    # rays travel along +d: first hit = smallest D
        u0, v0 = U.min() - px, V.min() - px
        nu, nv = int((U.max() - u0) / px) + 2, int((V.max() - v0) / px) + 2
        zbuf = np.full((nu, nv), np.inf)
        ibuf = np.full((nu, nv), -1, np.int64)
        _RS(U, V, D, nu, nv, px, u0, v0, zbuf, ibuf)
        cnt = np.bincount(ibuf[ibuf >= 0], minlength=len(T)) * px * px
        f = (N @ d) < 0
        front += np.where(f, cnt, 0.0)
        back += np.where(f, 0.0, cnt)
    return front, back


def rear_view_fraction(T, ang=45.0, ndir=2048, px=0.003):
    """For each triangle, the share of its front side (normal towards the viewer) seen from behind the car: seen
    projected area / unobstructed projected area, summed over the orthographic views within `ang` deg of straight
    behind (+x; directions of a Fibonacci sphere of `ndir`). 1 for a rear-facing face in the open, 0 for one hidden
    in a closed pocket. Returns None without numba."""
    global _RS
    if _RS is None:
        try:
            _RS = _raster_kernel()
        except ImportError:
            _RS = False
    if not _RS:
        return None
    N = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    seen, full = np.zeros(len(T)), np.zeros(len(T))
    kk = np.arange(ndir) + 0.5
    phi, th = np.arccos(1 - 2 * kk / ndir), np.pi * (1 + 5 ** 0.5) * kk
    D = np.stack([np.cos(th) * np.sin(phi), np.sin(th) * np.sin(phi), np.cos(phi)], 1)
    for d in D[D[:, 0] < -np.cos(np.radians(ang))]:        # rays travelling forwards: the viewer is behind the car
        a = np.array([1.0, 0, 0]) if abs(d[0]) < 0.9 else np.array([0, 1.0, 0])
        u = np.cross(d, a); u /= np.linalg.norm(u); v = np.cross(d, u)
        U, V, Dd = (np.ascontiguousarray(T @ e) for e in (u, v, d))
        u0, v0 = U.min() - px, V.min() - px
        nu, nv = int((U.max() - u0) / px) + 2, int((V.max() - v0) / px) + 2
        zbuf = np.full((nu, nv), np.inf)
        ibuf = np.full((nu, nv), -1, np.int64)
        _RS(U, V, Dd, nu, nv, px, u0, v0, zbuf, ibuf)
        cnt = np.bincount(ibuf[ibuf >= 0], minlength=len(T)) * px * px
        nd = N @ d
        seen += np.where(nd < 0, cnt, 0.0)
        full += np.maximum(0.0, -nd / 2)
    return np.minimum(seen / (full + 1e-30), 1.0)


def outer_skin_oriented(T, expo_min=0.01, ndir=128, log=print):
    """The outer skin for the inside test: the triangles seen from outside, each oriented with its outside-seen side
    as the front, without the inner components (outer_skin). Hidden faces - e.g. the top of a floor panel under a
    sidepod shell that sits on it - would make the space they close look outside. So would the inner faces of a
    hollow of the model that are seen only through its opening (MP4/4, printable model: the pockets inside the
    sidepods and the nose open at the back into the engine cover): a face counts only if its exposure, the projected
    area seen from outside summed over the views / (area x views), is at least `expo_min` (~0.1-0.23 for a face in
    the open; 0.0085-0.069 (p10-p90) for the walls of the tunnel under the MP4/23 monocoque, which stays outside;
    < 0.002 for 90 % of the MP4/4 sidepod pocket walls and 0.004 (median) for its nose pocket, filled with 0.01 but
    not with 0.004). Returns (triangles, stats)."""
    m, stats = outer_skin(T, log=log)
    vis = exterior_visibility(T, ndir=ndir)
    To = np.array(T, np.float64)
    if vis is not None:
        fr, bk = vis
        flip = bk > fr
        To[flip] = To[flip][:, ::-1]
        a = tri_area(T)
        seen = (fr + bk) >= expo_min * a * ndir
        m &= seen
        stats.update(exposed_area_fraction=round(float(a[seen].sum() / a.sum()), 3), exposure_min=expo_min, flipped=int(flip.sum()))
        log(f"  outer skin: {100 * a[seen].sum() / a.sum():.0f} % of the area exposed to the outside (>= {expo_min}),"
            f" {flip.sum()} faces turned to face out; {m.sum()} triangles used")
    return To[m], stats


def cell_winding(cells, lo, c, T):
    """Winding number at the centres of the given coarse cells: on 2x2x2 blocks, then cell by cell in the blocks
    close to 0.5 or next to a block on the other side of it."""
    blk = cells // 2
    ub, inv = np.unique(blk, axis=0, return_inverse=True)
    inv = inv.ravel()
    wb = winding(lo + (2 * ub + 1.0) * c, T)
    shp = ub.max(0) + 3
    ins, out = np.zeros(shp, bool), np.zeros(shp, bool)
    ins[tuple(ub.T)] = wb >= 0.5
    out[tuple(ub.T)] = wb < 0.5
    mixed = ndimage.binary_dilation(ins, S26) & ndimage.binary_dilation(out, S26)
    ref = mixed[tuple(ub.T)] | (np.abs(wb - 0.5) < 0.3)
    w = wb[inv]
    r = ref[inv]
    w[r] = winding(lo + (cells[r] + 0.5) * c, T)
    return w, float(r.mean())


def _raster(T, lo, c, shape):
    from build_glb import sample_points
    occ = np.zeros(shape, bool)
    for P in sample_points(T, c):
        idx = np.floor((P - lo) / c).astype(np.int64)
        ok = np.all((idx >= 0) & (idx < np.array(shape)), axis=1)
        idx = idx[ok]
        occ[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    return occ


def fill(ext, h, lo, W, T=None, k=3, K=3, core_cells=3.0, duct_depth=0.30, margin=0.03, wn=True, log=print):
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
    wn_info = None
    insk = cavity                                     # the part of the enclosed volume that is filled
    if T is not None and wn and cavity.any():
        # inside the outer skin only (see the module docstring). The openings and ducts below still come from the
        # whole enclosed volume: a shallow inlet recess (MP4/23: 7 cm in front of its panel) is outside the skin by
        # this test, but it is where the radiator duct starts (and air either way).
        import time
        t0 = time.time()
        Tskin, wn_info = outer_skin_oriented(T, log=log)
        cells = np.argwhere(cavity)
        w, fref = cell_winding(cells, lo, c, Tskin)
        R = np.zeros_like(cavity)
        R[tuple(cells[w < 0.5].T)] = True
        # streaks 1-2 cells thick inside the filled volume are refilled; thin slots between two skins stay air
        thin = R & ~(ndimage.binary_dilation(ndimage.binary_opening(R, S6), S6) & R)
        refill = np.zeros_like(R)
        if thin.any():
            box = np.ones((3, 3, 3), np.uint8)
            n_in = ndimage.convolve((cavity & ~R).astype(np.uint8), box, mode="constant")
            n_sk = ndimage.convolve(solidC.astype(np.uint8), box, mode="constant")
            refill = thin & (n_in > n_sk)
            R &= ~refill
        out_cells = np.argwhere(R)
        del R
        insk = cavity.copy()
        insk[tuple(out_cells.T)] = False
        # air left with no path to the outside air (sealed by the interior on every side) is interior too
        air = freeC & ~insk
        laba, _ = ndimage.label(air, S6)
        ids = np.unique(laba[out_core & air])
        sealed = air & ~np.isin(laba, ids[ids > 0])
        insk |= sealed
        del air, laba
        wn_info.update(exterior_removed_L=round(float(len(out_cells) * c**3 * 2000), 1),
                       streaks_refilled_L=round(float(refill.sum() * c**3 * 2000), 1),
                       sealed_added_L=round(float(sealed.sum() * c**3 * 2000), 1), wn_threshold=0.5)
        log(f"  inside-the-skin test: {wn_info['exterior_removed_L']:.0f} L of the enclosed volume is outside the car's"
            f" skin (winding number < 0.5) and stays air; {wn_info['streaks_refilled_L']:.0f} L of thin streaks and"
            f" {wn_info['sealed_added_L']:.0f} L of sealed air filled ({100 * fref:.0f} % of cells refined,"
            f" {time.time() - t0:.0f} s)")
        del sealed
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
            mask, x_face, fp, fp0 = _duct(cavity, outside, lab, pick[kind], lo, c, depth, margin, sgn)
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
            if kind == "sidepod" and ducts[kind]["mask"].any():
                d = ducts[kind]
                m0 = d["mask"]
                core = drop_thin(m0)
                thin = 1 - core.sum() / m0.sum()
                if thin > 0.5:
                    # the cavity behind the opening is only a gap between two skins: the inlet is the recess that
                    # the gap surrounds (open to the front, so the enclosure test calls it outside air), from the
                    # opening back to the duct end; the gap itself is filled
                    ix = np.where(m0.any(axis=(1, 2)))[0]
                    i1 = int(np.floor((d["x_face"] - lo[0]) / c))
                    fpf = ndimage.binary_fill_holes(fp0)
                    rec = np.zeros_like(m0)
                    rec[ix.min():i1] = freeC[ix.min():i1] & fpf[None, :, :]
                    rec = drop_thin(rec)
                    if rec.any():
                        log(f"  sidepod duct: {100 * thin:.0f} % of it was a gap thinner than {3 * c * 100:.0f} cm between two skins;"
                            f" the inlet is the {rec.sum() * c**3 * 2000:.0f} L recess inside it (gap filled)")
                        ir = np.where(rec.any(axis=(1, 2)))[0]
                        d.update(mask=rec, recess=True, inlet_area=float(rec[ir.min():ir.min() + 2].any(axis=0).sum() * c * c))
                elif thin > 0.15:
                    log(f"  sidepod duct: {100 * thin:.0f} % in gaps thinner than {3 * c * 100:.0f} cm, filled")
                    d.update(mask=core)
    keep = np.zeros_like(cavity)
    for d in ducts.values():
        keep |= d["mask"]
    fillC = insk & ~keep
    exit_cells = None
    log(f"  interior {cavity.sum() * c**3 * 2000:.0f} L enclosed, {insk.sum() * c**3 * 2000:.0f} L inside the skin (full car):"
        f" filled {fillC.sum() * c**3 * 2000:.0f} L, "
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
                 "ducts": ducts, "exit_cells": exit_cells, "exit": pick.get("exit"), "cavity": insk, "enclosed": cavity, "filled": fillC,
                 "escapes": cnt, "skin_test": wn_info}


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
