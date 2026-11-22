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
