"""Rebuilt wing profiles for the visual (render) F1 models (2026-11-22, wing-separation diagnosis).

The wing elements of the render models are drawn by eye: faceted or S-shaped sections, camber of the wrong sign for a
downforce wing, knife or blunt edges. The 2D section runs (scripts/sec2d*.py) showed that the flow separation on their
wings comes from these shapes, not from the mesh or the y+. This module replaces each selected wing element of the model
by a clean, closed aerofoil loft that keeps what the model does define - the element's position, span, leading- and
trailing-edge points (so chord length and chord angle) station by station - and takes the section shape from a
standard family: the NACA 4-digit aerofoil (Abbott & von Doenhoff, Theory of Wing Sections, 1959, sec. 6.4; NACA Report
460, Jacobs, Ward & Pinkerton 1933), inverted (camber towards the ground: the suction side faces down), with the model's
own thickness/chord limited to a usual band.

Selection: per car, "wing_rebuild" in build_glb.CARS maps an element name to a role ("main" or "flap", see ROLES), a
box (CFD axes; y mirrored, so both sides are taken) and optional profile parameters; every connected piece of the model
lying inside a box and spanning more than SPAN_MIN is rebuilt. Used only when the build is asked for it
(--rebuild-wings, case key "wing_rebuild"). Runs in the geometry build (CAD-level, before the wrap), so the skin + plug, the fine wing wrap and
the slot refinement regions all see the new elements. Nothing of the private model is written to the repository: the
fit is redone from the model on every build."""
from __future__ import annotations

import math

import numpy as np

SPAN_MIN = 0.20          # m: pieces narrower than this are fittings, not wing elements
DY_FIT = 0.02            # m: spacing of the fitting stations along the span
DY_LOFT = 0.008          # m: spacing of the loft rings (near-square triangles, no long spanwise slivers)
N_CHORD = 90             # points per surface (cosine spacing: dense at both edges)
EXTEND = 0.004           # m: each end of the span pushed this far (into the endplate / past a free tip)
# Section family by role: main planes NACA 44xx (4 % camber at 40 % chord: the most loaded element, nearest the ground,
# carries the highest suction peak), flaps NACA 64xx (6 %: they turn the flow, fed by the fresh boundary layer of the
# slot). Thickness: the model's own (spanwise median of the cuts) kept within 9-15 % of the chord.
ROLES = {"main": {"camber": 0.04, "camber_pos": 0.40, "t_min": 0.09, "t_max": 0.15},
         "flap": {"camber": 0.06, "camber_pos": 0.40, "t_min": 0.09, "t_max": 0.15}}


# ------------------------------------------------------------------------------------------------ section shape
def naca4(m, p, t, n=N_CHORD):
    """NACA 4-digit section (chord 1, open trailing edge of the standard formula, ~0.25 % c thick for t = 0.12):
    upper and lower surfaces from the leading to the trailing edge, (n, 2) each, x along the chord, y up. Camber m at
    chord fraction p (upright: suction side up)."""
    b = np.linspace(0.0, math.pi, n)
    x = 0.5 * (1.0 - np.cos(b))
    yt = 5.0 * t * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1015 * x ** 4)
    if m > 0:
        yc = np.where(x < p, m / p ** 2 * (2 * p * x - x ** 2), m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x ** 2))
        dy = np.where(x < p, 2 * m / p ** 2 * (p - x), 2 * m / (1 - p) ** 2 * (p - x))
    else:
        yc, dy = np.zeros_like(x), np.zeros_like(x)
    th = np.arctan(dy)
    up = np.c_[x - yt * np.sin(th), yc + yt * np.cos(th)]
    lo = np.c_[x + yt * np.sin(th), yc - yt * np.cos(th)]
    return up, lo


def section_ring(le, te, t, prm):
    """Closed ring (2n-2 points, x-z) of the inverted section between the leading-edge point `le` and the
    trailing-edge point `te` (model positions), thickness/chord t: the suction (cambered) side faces the ground."""
    up, lo = naca4(prm["camber"], prm["camber_pos"], t)
    # invert: the upright upper surface becomes the lower (suction) side
    pres, suct = np.c_[up[:, 0], -up[:, 1]], np.c_[lo[:, 0], -lo[:, 1]]
    c = float(np.hypot(*(np.asarray(te) - np.asarray(le))))
    u = (np.asarray(te) - np.asarray(le)) / c
    nrm = np.array([-u[1], u[0]])
    to = lambda Q: np.asarray(le) + c * (Q[:, :1] * u + Q[:, 1:] * nrm)
    # ring: suction side from the trailing edge to the leading edge, then the pressure side back to the trailing edge
    return np.vstack([to(suct)[::-1], to(pres)[1:]]), to(pres), to(suct)


# ------------------------------------------------------------------------------------------------ fit to the model
def cut_points(T, y0):
    """Points (x, z) where the triangles of T cross the plane y = y0."""
    ys = T[..., 1] - y0
    pts = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        m = (ys[:, a] * ys[:, b]) < 0
        if m.any():
            f = ys[m, a] / (ys[m, a] - ys[m, b])
            P = T[m, a] + f[:, None] * (T[m, b] - T[m, a])
            pts.append(P[:, [0, 2]])
    return np.vstack(pts) if pts else np.zeros((0, 2))


def fit_station(P, nbin=20):
    """Leading edge, trailing edge and thickness/chord of a section from its outline points P (x, z): trailing edge =
    rear-most point, leading edge = the point farthest from it; thickness = largest extent normal to the chord within
    one of `nbin` chordwise bins (the camber bulge does not count as thickness)."""
    te = P[np.argmax(P[:, 0])]
    le = P[np.argmax(np.linalg.norm(P - te, axis=1))]
    c = float(np.linalg.norm(te - le))
    u = (te - le) / c
    s = (P - le) @ u / c
    h = (P - le) @ np.array([-u[1], u[0]]) / c
    k = np.clip((s * nbin).astype(int), 0, nbin - 1)
    t = 0.0
    for b in range(nbin):
        hb = h[k == b]
        if len(hb) >= 2:
            t = max(t, float(hb.max() - hb.min()))
    return le, te, c, t


def fit_piece(T):
    """Spanwise fit of one wing piece: stations y, leading edges, trailing edges, thickness/chord."""
    V = T.reshape(-1, 3)
    y0, y1 = float(V[:, 1].min()), float(V[:, 1].max())
    n = max(2, int(math.ceil((y1 - y0) / DY_FIT)) + 1)
    ys = np.linspace(y0 + 0.002, y1 - 0.002, n)
    rows = []
    for y in ys:
        P = cut_points(T, y)
        if len(P) < 8:
            continue
        le, te, c, t = fit_station(P)
        rows.append((y, le[0], le[1], te[0], te[1], c, t))
    R = np.array(rows)
    # robust smoothing along the span: a running median over 3 stations (single bad cuts at joints)
    if len(R) >= 3:
        S = R.copy()
        for j in range(1, 7):
            S[1:-1, j] = np.median(np.stack([R[:-2, j], R[1:-1, j], R[2:, j]]), axis=0)
        R = S
    # one thickness ratio per element (spanwise median): the cuts of a coarse render mesh give few outline points
    R[:, 6] = np.median(R[:, 6])
    return {"y": R[:, 0], "le": R[:, 1:3], "te": R[:, 3:5], "chord": R[:, 5], "t_c": R[:, 6], "span": (y0, y1)}


# ------------------------------------------------------------------------------------------------ loft
def loft(fit, prm):
    """Closed, outward-oriented triangle surface of the rebuilt element (n, 3, 3)."""
    y0, y1 = fit["span"]
    y0, y1 = y0 - EXTEND, y1 + EXTEND
    nr = max(2, int(math.ceil((y1 - y0) / DY_LOFT)) + 1)
    yr = np.linspace(y0, y1, nr)
    fy = fit["y"]
    ip = lambda a: np.interp(yr, fy, a)
    LE = np.c_[ip(fit["le"][:, 0]), ip(fit["le"][:, 1])]
    TE = np.c_[ip(fit["te"][:, 0]), ip(fit["te"][:, 1])]
    tc = np.clip(ip(fit["t_c"]), prm["t_min"], prm["t_max"])
    rings, pres, suct = [], [], []
    for j in range(nr):
        r, pr, su = section_ring(LE[j], TE[j], tc[j], prm)
        rings.append(np.c_[r[:, 0], np.full(len(r), yr[j]), r[:, 1]])
        pres.append(pr)
        suct.append(su)
    R = np.stack(rings)                       # (nr, m, 3)
    m = R.shape[1]
    tris = []
    for j in range(nr - 1):
        a, b = R[j], R[j + 1]
        i0, i1 = np.arange(m), (np.arange(m) + 1) % m     # the ring closes over the trailing-edge base
        tris.append(np.stack([a[i0], a[i1], b[i1]], 1))
        tris.append(np.stack([a[i0], b[i1], b[i0]], 1))
    # The ring runs clockwise in (x, z) (suction side rearwards to forwards, pressure side back), so these side faces
    # face outwards. End caps: strips between the pressure and suction sides, leading to trailing edge; as written
    # they face +y, right for the outboard cap and turned over for the inboard one.
    for j in (0, nr - 1):
        pr, su = pres[j], suct[j]
        P3 = np.c_[pr[:, 0], np.full(len(pr), yr[j]), pr[:, 1]]
        S3 = np.c_[su[:, 0], np.full(len(su), yr[j]), su[:, 1]]
        k = np.arange(len(pr) - 1)
        cap = np.concatenate([np.stack([P3[k], P3[k + 1], S3[k + 1]], 1), np.stack([P3[k], S3[k + 1], S3[k]], 1)])
        cap = cap[np.linalg.norm(np.cross(cap[:, 1] - cap[:, 0], cap[:, 2] - cap[:, 0]), axis=1) > 1e-14]
        tris.append(cap[:, ::-1] if j == 0 else cap)
    T = np.concatenate(tris)
    # outward orientation: positive enclosed volume
    vol = np.einsum("ij,ij->i", T[:, 0], np.cross(T[:, 1], T[:, 2])).sum() / 6.0
    return T if vol > 0 else T[:, ::-1].copy(), {"rings": nr, "t_c_used": [float(tc.min()), float(tc.max())]}


# ------------------------------------------------------------------------------------------------ in the build
def rebuild(parts, spec, components, log=print):
    """parts: [(name, triangles)] of the model in CFD axes. Returns (new parts, report). Every connected piece inside
    one of the spec boxes (or their mirror image in y) and spanning > SPAN_MIN is replaced by its rebuilt loft."""
    out, report = [], []
    new = []
    for name, T in parts:
        keep = []
        for piece in components(T):
            V = piece.reshape(-1, 3)
            lo, hi = V.min(0), V.max(0)
            hit = None
            for el, s in spec.items():
                blo, bhi = np.array(s["box"][0], float), np.array(s["box"][1], float)
                mlo, mhi = blo * [1, -1, 1], bhi * [1, -1, 1]
                mlo[1], mhi[1] = min(mlo[1], mhi[1]), max(mlo[1], mhi[1])
                inside = (np.all(lo >= blo) and np.all(hi <= bhi)) or (np.all(lo >= mlo) and np.all(hi <= mhi))
                if inside and hi[1] - lo[1] > SPAN_MIN:
                    hit = el
                    break
            if hit is None:
                keep.append(piece)
                continue
            prm = {**ROLES[spec[hit].get("role", "main")], **spec[hit].get("profile", {})}
            fit = fit_piece(piece)
            Tn, info = loft(fit, prm)
            new.append((f"rebuilt|{hit}", Tn))
            rec = {"element": hit, "model_triangles": int(len(piece)), "new_triangles": int(len(Tn)),
                   "span": [round(float(fit["span"][0]), 3), round(float(fit["span"][1]), 3)],
                   "chord_m": [round(float(fit["chord"].min()), 4), round(float(fit["chord"].max()), 4)],
                   "angle_deg": [round(float(a), 2) for a in (np.degrees(np.arctan2(fit["te"][:, 1] - fit["le"][:, 1],
                                                                                    fit["te"][:, 0] - fit["le"][:, 0]))[[0, -1]])],
                   "model_t_c": [round(float(fit["t_c"].min()), 3), round(float(fit["t_c"].max()), 3)],
                   "role": spec[hit].get("role", "main"),
                   "profile": f"NACA {round(prm['camber'] * 100)}{round(prm['camber_pos'] * 10)}{round(float(np.clip(fit['t_c'][0], prm['t_min'], prm['t_max'])) * 100):02d} inverted",
                   **info}
            report.append(rec)
            log(f"  wing rebuild {hit}: {len(piece)} model triangles -> {len(Tn)}, span {rec['span']}, chord {rec['chord_m']} m, "
                f"angle {rec['angle_deg']} deg, model t/c {rec['model_t_c']} -> used {[round(v, 3) for v in info['t_c_used']]}")
        if keep:
            out.append((name, np.concatenate(keep)))
    return out + new, report


# ------------------------------------------------------------------------------------------------ section mode
# For models whose wing elements are not one connected piece each: an element drawn as several open sheets (upper and
# lower skin in different materials, paint / decal layers: MP4/23, RB12), or several elements joined in one piece
# (RB12 front main plane + two flaps). The element is followed through the cuts y = const of all the model's triangles
# around it: at each station the cut segments are grouped by connectivity (ends closer than GROUP_TOL: the slots between
# elements are wider), and the element is the group nearest (centroid) to the one picked at the previous station,
# starting from a seed point (x, y, z) given per element. A station whose group jumps in chord (merged with a neighbour,
# a pylon or an endplate) is skipped; after MISS_MAX without a clean station the tracking stops. Spec keys:
#   "seed": [x, y, z] on the element (y > 0), "y": [y_min, y_max] tracking limits (y_min <= 0: full-span element, one
#   loft from -y to +y through the centre), "extend_to": optional |y| the loft is carried to (endplate), "extend_from": optional inboard |y| the loft of a
#   per-side element starts at (to close a junction left as modelled between two tracked pieces), "merge_skins": the
#   element's two skins do not meet in the cuts (see track), "role", "profile".
# Section shape: NACA 4-digit with the model's own camber and its position (spanwise medians, clipped to CAMBER_RANGE
# and CAMBER_POS_RANGE: the render models draw main planes and flaps with 3-13 % camber, an S-shaped section gets the
# minimum), thickness as in the box mode; "profile" in the spec overrides.
# Removed from the model: the triangles cut by the element's groups at every station (both sides, the -y side tracked
# on its own), and the triangles of the same model pieces whose centroid lies in the element's bounding box in its chord
# frame (interpolated along the span): render triangles are long spanwise strips that some stations miss.
DY_TRACK = 0.005         # m: station spacing of the tracking
GROUP_TOL = 0.002        # m: cut segments with ends closer than this belong to the same outline
TRACK_DMAX = 0.025       # m: largest centroid move between two consecutive stations
MISS_MAX = 0.03          # m: span without a clean station that stops the tracking
CAPTURE = 0.0015         # m: margin of the chord-frame box around the model element
GAP_MIN = 0.006          # m: smallest slot between two rebuilt elements (some model slots are closed: elements touching);
                         # the detail-zone wrap (1.25 mm voxels, 1-voxel wall layer) reopens gaps wider than ~3 voxels
CAMBER_RANGE = (0.02, 0.09)
CAMBER_POS_RANGE = (0.30, 0.60)


def station_groups(T, y):
    """Cut of the triangles T (n,3,3) at y: list of groups {"segs" (k,2,2) x-z, "tri" (k,) indices into T, "c" centroid
    (length-weighted), "pts" (2k,2)}."""
    from scipy.sparse import coo_matrix
    from scipy.sparse.csgraph import connected_components
    from scipy.spatial import cKDTree
    d = T[..., 1] - y
    if np.any(np.abs(d) < 1e-9):
        d = d - 1e-7
    m = (d.min(1) < 0) & (d.max(1) > 0)
    idx = np.where(m)[0]
    if len(idx) == 0:
        return []
    Tm, dm = T[idx], d[idx]
    segs = np.zeros((len(idx), 2, 2))
    cnt = np.zeros(len(idx), int)
    for a, b in ((0, 1), (1, 2), (2, 0)):
        k = np.where(dm[:, a] * dm[:, b] < 0)[0]
        if not len(k):
            continue
        f = dm[k, a] / (dm[k, a] - dm[k, b])
        P = Tm[k, a] + f[:, None] * (Tm[k, b] - Tm[k, a])
        s = cnt[k]
        ok = s < 2
        segs[k[ok], s[ok]] = P[ok][:, [0, 2]]
        cnt[k[ok]] += 1
    good = cnt == 2
    segs, idx = segs[good], idx[good]
    n = len(segs)
    if n == 0:
        return []
    pts = segs.reshape(-1, 2)
    pairs = cKDTree(pts).query_pairs(GROUP_TOL, output_type="ndarray")
    own = np.c_[np.arange(0, 2 * n, 2), np.arange(1, 2 * n, 2)]
    E = np.vstack([pairs.reshape(-1, 2), own]) if len(pairs) else own
    A = coo_matrix((np.ones(len(E)), (E[:, 0], E[:, 1])), shape=(2 * n, 2 * n))
    _, lab = connected_components(A, directed=False)
    lab = lab[0::2]
    out = []
    for g in np.unique(lab):
        k = lab == g
        S = segs[k]
        L = np.linalg.norm(S[:, 1] - S[:, 0], axis=1) + 1e-9
        out.append({"segs": S, "tri": idx[k], "c": (S.mean(1) * L[:, None]).sum(0) / L.sum(), "pts": densify(S)})
    return out


def densify(S, step=0.001):
    """Points along the segments S (k, 2, 2) at most `step` apart (a render-model cut is a few long segments: the
    thickness and camber bins need points on both surfaces)."""
    L = np.linalg.norm(S[:, 1] - S[:, 0], axis=1)
    n = np.maximum(2, np.ceil(L / step).astype(int) + 1)
    t = np.concatenate([np.linspace(0, 1, m) for m in n])
    i = np.repeat(np.arange(len(S)), n)
    return S[i, 0] + t[:, None] * (S[i, 1] - S[i, 0])


def camber_of(P, le, te, nbin=20):
    """Largest mean-line offset of the outline points P from the chord (le, te), in chords (+ = bulge towards the
    ground, the right side for a downforce element; - = the wrong side), and its chordwise position; mean line = mid of
    the binned normal extents."""
    c = float(np.linalg.norm(te - le))
    u = (te - le) / c
    s = (P - le) @ u / c
    h = (P - le) @ np.array([-u[1], u[0]]) / c
    k = np.clip((s * nbin).astype(int), 0, nbin - 1)
    bins = [b for b in range(2, nbin - 2) if (k == b).sum() >= 2]
    if not bins:
        return 0.0, 0.4
    mid = np.array([0.5 * (h[k == b].max() + h[k == b].min()) for b in bins])
    j = int(np.argmax(np.abs(mid)))
    return float(-mid[j]), (bins[j] + 0.5) / nbin


def chord_box(P, le, te):
    """Bounding box of the points P in the chord frame of (le, te): (s_min, s_max, h_min, h_max), in chords."""
    c = float(np.linalg.norm(te - le))
    u = (te - le) / c
    s = (P - le) @ u / c
    h = (P - le) @ np.array([-u[1], u[0]]) / c
    return s.min(), s.max(), h.min(), h.max()


def track(T, seed, ylo, yhi, skins=False):
    """Stations of one element on the y > 0 side of the triangles T: {y: (group, le, te, chord, t/c, chord box)}.
    skins: also take the other cut groups lying within the chord of the nearest one (an element drawn as two skins
    that do not meet at the leading and trailing edges, which would otherwise keep one skin as modelled)."""
    out = {}
    for direction in (1, -1):
        prev = np.array([seed[0], seed[2]], float)
        y = seed[1] if direction == 1 else seed[1] - DY_TRACK
        miss, chords = 0.0, []
        while ylo - 1e-9 <= y <= yhi + 1e-9:
            G = station_groups(T, y) if y > 1e-4 else []
            ok = False
            if G:
                dist = [float(np.linalg.norm(g["c"] - prev)) for g in G]
                j = int(np.argmin(dist))
                if dist[j] <= TRACK_DMAX and len(G[j]["pts"]) >= 6:
                    g = G[j]
                    if skins:
                        le0, te0, c0, _ = fit_station(g["pts"])
                        u = (te0 - le0) / c0
                        nrm = np.array([-u[1], u[0]])
                        for i, h in enumerate(G):
                            q = h["pts"] - le0
                            sh, hn = q @ u / c0, q @ nrm / c0
                            if i != j and sh.min() > -0.05 and sh.max() < 1.05 and np.abs(hn).max() < 0.25:
                                g = {"segs": np.concatenate([g["segs"], h["segs"]]), "tri": np.concatenate([g["tri"], h["tri"]]),
                                     "c": g["c"], "pts": np.concatenate([g["pts"], h["pts"]])}
                    le, te, c, t = fit_station(g["pts"])
                    ref = np.median(chords[-5:]) if chords else c
                    ok = 0.75 < c / ref < 1.33
            if ok:
                out[round(float(y), 6)] = (g, le, te, c, t, chord_box(g["pts"], le, te), camber_of(g["pts"], le, te))
                prev = g["c"]
                chords.append(c)
                miss = 0.0
            else:
                miss += DY_TRACK
                if miss > MISS_MAX:
                    break
            y += direction * DY_TRACK
    return dict(sorted(out.items()))


def _med(a, w=5):
    """Running median along axis 0 (window w, shorter at the ends)."""
    h = w // 2
    return np.array([np.median(a[max(0, i - h):i + h + 1], axis=0) for i in range(len(a))])


def _d_alpha(s, ys):
    """Incidence taken off at each station (deg): "d_alpha" is a number, or a list of [|y|, deg] points interpolated
    along the span (constant beyond the ends), e.g. to blend an element into a neighbour that keeps its incidence."""
    da = s.get("d_alpha", 0.0)
    if isinstance(da, (list, tuple)):
        yy, aa = zip(*sorted(da))
        return np.interp(np.abs(np.asarray(ys, float)), yy, aa)
    return np.full(len(ys), float(da))


def _rot(v, deg):
    """Rotate the 2D vectors v (n, 2; x-z) by deg (counter-clockwise, z up)."""
    r = math.radians(deg)
    c, s = math.cos(r), math.sin(r)
    return np.c_[c * v[:, 0] - s * v[:, 1], s * v[:, 0] + c * v[:, 1]]


def _pt_seg_dist(p, S):
    """Distance from point p (2,) to the closest of the segments S (k, 2, 2)."""
    a, b = S[:, 0], S[:, 1]
    ab = b - a
    t = np.clip(np.einsum("ij,ij->i", p - a, ab) / (np.einsum("ij,ij->i", ab, ab) + 1e-18), 0, 1)
    return float(np.min(np.linalg.norm(a + t[:, None] * ab - p, axis=1)))


def _ring_gap(p, ring):
    """Signed distance from point p to the closed ring (m, 2): negative inside."""
    S = np.stack([ring, np.roll(ring, -1, 0)], 1)
    d = _pt_seg_dist(p, S)
    x, z = ring[:, 0], ring[:, 1]
    x2, z2 = np.roll(x, -1), np.roll(z, -1)
    cross = ((z > p[1]) != (z2 > p[1])) & (p[0] < x + (p[1] - z) * (x2 - x) / (z2 - z + 1e-18))
    return -d if cross.sum() % 2 == 1 else d


def _inside(P, ring):
    """Which of the points P (k, 2) lie inside the closed ring (m, 2) (ray casting)."""
    x, z = ring[:, 0][None, :], ring[:, 1][None, :]
    x2, z2 = np.roll(ring[:, 0], -1)[None, :], np.roll(ring[:, 1], -1)[None, :]
    px, pz = P[:, :1], P[:, 1:]
    cross = ((z > pz) != (z2 > pz)) & (px < x + (pz - z) * (x2 - x) / (z2 - z + 1e-18))
    return cross.sum(1) % 2 == 1


def _outline_gap(A, B, ringA=None, ringB=None):
    """Smallest distance between two outlines given as dense points A, B (k, 2); -1 when the closed rings overlap."""
    from scipy.spatial import cKDTree
    if ringA is not None and ringB is not None and (_inside(A, ringB).any() or _inside(B, ringA).any()):
        return -1.0
    return float(cKDTree(B).query(A)[0].min())


def _ring_dense(le, te, tc, prm, step=0.0005):
    ring = section_ring(le, te, tc, prm)[0]
    return ring, densify(np.stack([ring, np.roll(ring, -1, 0)], 1), step)


def rebuild_sections(parts, spec, components, log=print):
    """Section-mode rebuild (see above). parts: [(name, triangles)] in CFD axes. Returns (new parts, report).
    Extra spec keys: "after": the element ahead of this one in the stack (slot: the rebuilt element is moved along its
    chord normal, away from the ground, until the smallest distance between the two rebuilt sections is at least the
    model's own between the two model sections, and at least GAP_MIN or the element's "gap_min", station by station); "d_alpha": degrees of incidence taken off (rotation about the element's leading edge; an
    element "after" another first follows the displacement of that element's trailing edge), a number or a list of
    [|y|, deg] points along the span (see _d_alpha)."""
    from scipy.spatial import cKDTree
    Ts = [T for _, T in parts]
    offs = np.cumsum([0] + [len(T) for T in Ts])
    ALL = np.concatenate(Ts)
    C = ALL.mean(1)
    remove = np.zeros(len(ALL), bool)
    new, report = [], []
    E = {}
    # ---- pass 1: follow, fit and mark the model triangles of every element (on the unchanged model)
    for el, s in spec.items():
        prm = {**ROLES[s.get("role", "main")], **s.get("profile", {})}
        seed = np.array(s["seed"], float)
        ylo, yhi = float(s["y"][0]), float(s["y"][1])
        full = ylo <= 0.0
        win = (np.abs(C[:, 0] - seed[0]) < 0.6) & (np.abs(C[:, 2] - seed[2]) < 0.4) & (np.abs(C[:, 1]) < yhi + 0.03)
        cid = np.where(win)[0]
        Tc = ALL[cid]
        # model pieces of the candidates (connected components within the window), for the capture test
        piece = np.full(len(cid), -1)
        npc = 0
        for p in range(len(Ts)):
            k = np.where((cid >= offs[p]) & (cid < offs[p + 1]))[0]
            if not len(k):
                continue
            sub = Tc[k]
            tree = cKDTree(sub.mean(1))
            for comp in components(sub):
                _, ii = tree.query(comp.mean(1))
                piece[k[ii]] = npc
                npc += 1
        sides = {sg: track(Tc * np.array([1, sg, 1]), seed, max(ylo, 0.0), yhi, bool(s.get("merge_skins"))) for sg in (1, -1)}
        st = sides[1]
        if len(st) < 3:
            log(f"  wing rebuild {el}: only {len(st)} clean stations - left as modelled")
            continue
        ys = np.array(list(st.keys()))
        LE = _med(np.array([v[1] for v in st.values()]))
        TE = _med(np.array([v[2] for v in st.values()]))
        TCs = _med(np.array([v[4] for v in st.values()]), 9)      # thickness/chord per station (chords vary 2-3x)
        TC = float(np.median(TCs))
        BOX = np.array([v[5] for v in st.values()])
        y_end = max(float(ys[-1]) + EXTEND, float(s.get("extend_to", 0.0)))
        y_beg = -y_end if full else min(float(ys[0]) - EXTEND, float(s.get("extend_from", 9.0)))
        members = set()
        for sg in (1, -1):
            for v in sides[sg].values():
                members.update(v[0]["tri"].tolist())
        mem = np.array(sorted(members), int)
        mpieces = np.unique(piece[mem]) if len(mem) else np.array([], int)
        cand = np.where(np.isin(piece, mpieces))[0]
        Pc = Tc[cand].mean(1)
        ay = np.abs(Pc[:, 1])
        inspan = (ay <= y_end) & ((ay >= abs(y_beg)) if not full else True)
        ip = lambda a, yy: np.interp(yy, ys, a)
        le = np.c_[ip(LE[:, 0], ay), ip(LE[:, 1], ay)]
        te = np.c_[ip(TE[:, 0], ay), ip(TE[:, 1], ay)]
        cc = np.linalg.norm(te - le, axis=1) + 1e-12
        u = (te - le) / cc[:, None]
        q = Pc[:, [0, 2]] - le
        sc = np.einsum("ij,ij->i", q, u) / cc
        hc = (q[:, 0] * -u[:, 1] + q[:, 1] * u[:, 0]) / cc
        b = np.stack([ip(BOX[:, j], ay) for j in range(4)], 1)
        mrg = CAPTURE / cc
        inside = inspan & (sc >= b[:, 0] - 0.02 - mrg) & (sc <= b[:, 1] + 0.02 + mrg) & (hc >= b[:, 2] - mrg) & (hc <= b[:, 3] + mrg)
        rm = np.union1d(mem, cand[inside])
        remove[cid[rm]] = True
        cam = float(np.median([v[6][0] for v in st.values()]))
        cpos = float(np.median([v[6][1] for v in st.values()]))
        if "camber" not in s.get("profile", {}):
            prm["camber"] = float(np.clip(cam, *CAMBER_RANGE))
        if "camber_pos" not in s.get("profile", {}):
            prm["camber_pos"] = float(np.clip(cpos, *CAMBER_POS_RANGE))
        E[el] = {"prm": prm, "full": full, "ys": ys, "LE0": LE.copy(), "TE0": TE.copy(), "LE": LE.copy(), "TE": TE.copy(),
                 "TC": TC, "TCs": TCs, "y_beg": y_beg, "y_end": y_end, "segs": [v[0]["segs"] for v in st.values()],
                 "pts": [v[0]["pts"] for v in st.values()],
                 "camber": cam, "camber_pos": cpos, "n_mirror": len(sides[-1]), "removed": int(len(rm)),
                 "shift_mm": [0.0, 0.0], "gap_mm": None}
    # ---- pass 2: incidence changes and slot gaps, in the order of the spec (an element after the one ahead of it)
    for el, s in spec.items():
        if el not in E:
            continue
        e = E[el]
        prev = E.get(s.get("after"))
        if prev is not None:
            # follow the trailing edge of the element ahead (its own incidence change / shift)
            d = np.stack([np.interp(e["ys"], prev["ys"], prev["TE"][:, j] - prev["TE0"][:, j]) for j in range(2)], 1)
            e["LE"] += d
            e["TE"] += d
        da = _d_alpha(s, e["ys"])
        for j in np.nonzero(da)[0]:
            e["TE"][j] = e["LE"][j] + _rot((e["TE"][j] - e["LE"][j])[None], -da[j])[0]
        if prev is None:
            continue
        shifts, gaps = [], []
        for j, y in enumerate(e["ys"]):
            tc = float(np.clip(e["TCs"][j], e["prm"]["t_min"], e["prm"]["t_max"]))
            jp = int(np.argmin(np.abs(prev["ys"] - y)))
            if abs(prev["ys"][jp] - y) > 0.6 * DY_TRACK:
                if y < prev["ys"][0] or y > prev["ys"][-1]:
                    continue                                   # no element ahead at this station
                g_model = 0.0
            else:
                g_model = _outline_gap(prev["pts"][jp], e["pts"][j])
            target = max(g_model, float(s.get("gap_min", GAP_MIN)))
            ptc = float(np.clip(prev["TCs"][jp], prev["prm"]["t_min"], prev["prm"]["t_max"]))
            ple = np.array([np.interp(y, prev["ys"], prev["LE"][:, k]) for k in range(2)])
            pte = np.array([np.interp(y, prev["ys"], prev["TE"][:, k]) for k in range(2)])
            pring, pdense = _ring_dense(ple, pte, ptc, prev["prm"])
            le, te = e["LE"][j].copy(), e["TE"][j].copy()
            c = float(np.linalg.norm(te - le))
            nrm = np.array([-(te - le)[1], (te - le)[0]]) / c          # chord normal, away from the ground side
            tot = 0.0
            for _ in range(12):
                ring, dense = _ring_dense(le + tot * nrm, te + tot * nrm, tc, e["prm"])
                g = _outline_gap(pdense, dense, pring, ring)
                if g >= target - 2e-4:
                    break
                tot += (target - g) if g >= 0 else target + 0.002
            e["LE"][j] = le + tot * nrm
            e["TE"][j] = te + tot * nrm
            shifts.append(tot)
            gaps.append(g_model)
        if shifts:
            e["shift_mm"] = [round(1000 * min(shifts), 1), round(1000 * max(shifts), 1)]
            e["gap_mm"] = [round(1000 * float(np.min(gaps)), 1), round(1000 * float(np.median(gaps)), 1), round(1000 * float(np.max(gaps)), 1)]
    # ---- pass 3: lofts
    for el, s in spec.items():
        if el not in E:
            continue
        e = E[el]
        ys, LE, TE, TC, TCs, prm = e["ys"], _med(e["LE"]), _med(e["TE"]), e["TC"], e["TCs"], e["prm"]
        y_beg, y_end = e["y_beg"], e["y_end"]
        if e["full"]:
            yy = np.r_[-ys[::-1], ys]
            keep = np.r_[True, np.diff(yy) > 1e-9]
            fit = {"y": yy[keep], "le": np.r_[LE[::-1], LE][keep], "te": np.r_[TE[::-1], TE][keep],
                   "t_c": np.r_[TCs[::-1], TCs][keep], "span": (y_beg + EXTEND, y_end - EXTEND)}
            Tn, info = loft(fit, prm)
            lofts = [Tn]
        else:
            fit = {"y": ys, "le": LE, "te": TE, "t_c": TCs, "span": (y_beg + EXTEND, y_end - EXTEND)}
            Tn, info = loft(fit, prm)
            Tm = Tn * np.array([1, -1, 1])
            lofts = [Tn, Tm[:, ::-1].copy()]
        for i, Tl in enumerate(lofts):
            new.append((f"rebuilt|{el}" + ("" if i == 0 else "_m"), Tl))
        CH = np.linalg.norm(TE - LE, axis=1)
        ang = np.degrees(np.arctan2(TE[:, 1] - LE[:, 1], TE[:, 0] - LE[:, 0]))
        ang0 = np.degrees(np.arctan2(e["TE0"][:, 1] - e["LE0"][:, 1], e["TE0"][:, 0] - e["LE0"][:, 0]))
        rec = {"element": el, "mode": "section", "stations": int(len(ys)), "stations_mirror": int(e["n_mirror"]),
               "model_triangles_removed": e["removed"], "new_triangles": int(sum(len(t) for t in lofts)),
               "span": [round(y_beg, 3), round(y_end, 3)], "tracked": [round(float(ys[0]), 3), round(float(ys[-1]), 3)],
               "chord_m": [round(float(CH.min()), 4), round(float(CH.max()), 4)],
               "angle_deg": [round(float(ang.min()), 2), round(float(ang.max()), 2)],
               "model_angle_deg": [round(float(ang0.min()), 2), round(float(ang0.max()), 2)],
               "d_alpha": s.get("d_alpha", 0.0), "after": s.get("after"),
               "slot_gap_model_mm": e["gap_mm"], "shift_mm": e["shift_mm"],
               "model_t_c": [round(float(TCs.min()), 3), round(TC, 3), round(float(TCs.max()), 3)], "model_camber": round(e["camber"], 3), "model_camber_pos": round(e["camber_pos"], 2),
               "role": s.get("role", "main"), "camber": round(prm["camber"], 3), "camber_pos": round(prm["camber_pos"], 2),
               "profile": f"NACA {round(prm['camber'] * 100)}{round(prm['camber_pos'] * 10)}{round(float(np.clip(TC, prm['t_min'], prm['t_max'])) * 100):02d} inverted",
               **info}
        report.append(rec)
        log(f"  wing rebuild {el} (sections): {len(ys)}+{e['n_mirror']} stations, tracked y {rec['tracked']}, loft {rec['span']}, "
            f"chord {rec['chord_m']} m, angle {rec['angle_deg']} deg (model {rec['model_angle_deg']}), model t/c {rec['model_t_c']}, "
            f"camber {e['camber']:+.3f} at {e['camber_pos']:.2f} -> {rec['profile']}, slot gap {e['gap_mm']} mm, shift {e['shift_mm']} mm, {e['removed']} model triangles removed")
    out = []
    for p, (n, T) in enumerate(parts):
        k = ~remove[offs[p]:offs[p + 1]]
        if k.any():
            out.append((n, T[k]))
    return out + new, report
