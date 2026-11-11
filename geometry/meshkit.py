"""Tiny closed-surface toolkit (NumPy only) used to build the Formula Student CFD model.

Every primitive returns a watertight, consistently oriented triangle surface (V, F), which is
what snappyHexMesh needs to decide inside/outside. Bodies may overlap each other freely.
"""
from __future__ import annotations

import struct

import numpy as np


# ----------------------------------------------------------------------------------------------
# Basic container
# ----------------------------------------------------------------------------------------------
class Surf:
    def __init__(self, V=None, F=None):
        self.V = np.zeros((0, 3)) if V is None else np.asarray(V, float)
        self.F = np.zeros((0, 3), int) if F is None else np.asarray(F, int)

    def __add__(self, other: "Surf") -> "Surf":
        return Surf(np.vstack([self.V, other.V]), np.vstack([self.F, other.F + len(self.V)]))

    def mirrored_y(self) -> "Surf":
        V = self.V.copy()
        V[:, 1] *= -1
        return Surf(V, self.F[:, ::-1].copy())

    def with_mirror(self) -> "Surf":
        return self + self.mirrored_y()

    def translated(self, d) -> "Surf":
        return Surf(self.V + np.asarray(d, float), self.F.copy())

    @property
    def ntri(self) -> int:
        return len(self.F)


def merge(parts) -> Surf:
    out = Surf()
    for p in parts:
        out = out + p
    return out


def signed_volume(V, F) -> float:
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return float(np.einsum("ij,ij->i", a, np.cross(b, c)).sum() / 6.0)


def orient_outward(s: Surf) -> Surf:
    if signed_volume(s.V, s.F) < 0:
        return Surf(s.V, s.F[:, ::-1].copy())
    return s


# ----------------------------------------------------------------------------------------------
# Polygon triangulation (ear clipping) for planar caps
# ----------------------------------------------------------------------------------------------
def _newell_normal(P):
    n = np.zeros(3)
    for i in range(len(P)):
        a, b = P[i], P[(i + 1) % len(P)]
        n += np.array([(a[1] - b[1]) * (a[2] + b[2]), (a[2] - b[2]) * (a[0] + b[0]), (a[0] - b[0]) * (a[1] + b[1])])
    return n / (np.linalg.norm(n) + 1e-300)


def earclip(P3) -> list[tuple[int, int, int]]:
    """Triangulate a simple planar polygon given as (N,3) points. Returns index triples."""
    P3 = np.asarray(P3, float)
    n = _newell_normal(P3)
    u = np.cross(n, [1.0, 0, 0])
    if np.linalg.norm(u) < 0.5:
        u = np.cross(n, [0, 1.0, 0])
    u /= np.linalg.norm(u)
    v = np.cross(n, u)
    P = np.c_[P3 @ u, P3 @ v]
    idx = list(range(len(P)))
    area = 0.5 * sum(P[i, 0] * P[(i + 1) % len(P), 1] - P[(i + 1) % len(P), 0] * P[i, 1] for i in range(len(P)))
    if area < 0:
        idx = idx[::-1]
    tris = []

    def cross2(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    guard = 0
    while len(idx) > 3 and guard < 100000:
        guard += 1
        m = len(idx)
        clipped = False
        for k in range(m):
            i0, i1, i2 = idx[(k - 1) % m], idx[k], idx[(k + 1) % m]
            a, b, c = P[i0], P[i1], P[i2]
            if cross2(a, b, c) <= 1e-14:
                continue  # reflex or degenerate
            ok = True
            for j in idx:
                if j in (i0, i1, i2):
                    continue
                p = P[j]
                if cross2(a, b, p) >= -1e-14 and cross2(b, c, p) >= -1e-14 and cross2(c, a, p) >= -1e-14:
                    ok = False
                    break
            if ok:
                tris.append((i0, i1, i2))
                idx.pop(k)
                clipped = True
                break
        if not clipped:  # numerical trouble: fall back to a fan for the rest
            for k in range(1, len(idx) - 1):
                tris.append((idx[0], idx[k], idx[k + 1]))
            idx = idx[:3]
            break
    if len(idx) == 3:
        tris.append(tuple(idx))
    return tris


# ----------------------------------------------------------------------------------------------
# Lofting closed rings
# ----------------------------------------------------------------------------------------------
def loft(rings, cap0=True, cap1=True) -> Surf:
    rings = [np.asarray(r, float) for r in rings]
    M = len(rings[0])
    S = len(rings)
    V = np.vstack(rings)
    F = []
    for j in range(S - 1):
        for i in range(M):
            a = j * M + i
            b = j * M + (i + 1) % M
            c = (j + 1) * M + (i + 1) % M
            d = (j + 1) * M + i
            F.append((a, b, c))
            F.append((a, c, d))

    def cap(ring_index, want_forward):
        tris = earclip(rings[ring_index])
        # find the triangle using boundary edge (0,1) to align orientation with the side quads
        flip = False
        for t in tris:
            for k in range(3):
                if t[k] == 0 and t[(k + 1) % 3] == 1:
                    flip = not want_forward
                elif t[k] == 1 and t[(k + 1) % 3] == 0:
                    flip = want_forward
        off = ring_index * M
        for t in tris:
            tt = (t[0] + off, t[2] + off, t[1] + off) if flip else (t[0] + off, t[1] + off, t[2] + off)
            F.append(tt)

    if cap0:
        cap(0, want_forward=False)  # side quads hold 0->1 on the first ring, cap needs 1->0
    if cap1:
        cap(S - 1, want_forward=True)
    return orient_outward(Surf(V, np.array(F, int)))


# ----------------------------------------------------------------------------------------------
# Airfoils
# ----------------------------------------------------------------------------------------------
def naca4(m, p, t, n=56, te_abs=0.0015, chord=1.0):
    """Upper/lower surfaces (same chordwise stations, LE->TE) of a NACA-4 style section.

    Returns two (n+1,2) arrays in chord units * chord (x along chord, y up = suction side for lift
    up). A minimum absolute trailing-edge thickness te_abs (m) is enforced so the part is meshable.
    """
    beta = np.linspace(0, np.pi, n + 1)
    x = 0.5 * (1 - np.cos(beta))
    yt = 5 * t * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x**2 + 0.2843 * x**3 - 0.1015 * x**4)
    te_half = max(te_abs / chord / 2, yt[-1])
    yt = yt + x * (te_half - yt[-1])
    yc = np.where(x < p, m / p**2 * (2 * p * x - x**2), m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x - x**2))
    dyc = np.where(x < p, 2 * m / p**2 * (p - x), 2 * m / (1 - p) ** 2 * (p - x))
    th = np.arctan(dyc)
    U = np.c_[x - yt * np.sin(th), yc + yt * np.cos(th)] * chord
    L = np.c_[x + yt * np.sin(th), yc - yt * np.cos(th)] * chord
    U[0] = L[0] = 0.0
    return U, L


def place_inverted(U, L, le, angle_deg):
    """Invert (suction side down), rotate TE-up by angle and translate LE to le=(x,z)."""
    a = np.radians(angle_deg)
    R = np.array([[np.cos(a), -np.sin(a)], [np.sin(a), np.cos(a)]])
    # inverted: z -> -z, so the old lower surface becomes the upper (pressure) side
    Up = np.c_[L[:, 0], -L[:, 1]] @ R.T + le  # pressure side (top)
    Lo = np.c_[U[:, 0], -U[:, 1]] @ R.T + le  # suction side (bottom)
    return Up, Lo


def section_ring(Up, Lo):
    """Closed ring (TE_top -> LE -> TE_bottom) from top/bottom surfaces sharing the LE point."""
    return np.vstack([Up[::-1], Lo[1:]])


def poly_min_dist(A, B):
    d = np.sqrt(((A[:, None, :] - B[None, :, :]) ** 2).sum(-1))
    return d.min()


def stack_elements(first, elements):
    """2D multi-element stack for an inverted wing.

    first = dict(m,p,t,chord,angle, le=(x,z) or min_z with x_le)
    elements = list of dict(m,p,t,chord,angle,gap,overlap)
    Returns list of (Up, Lo) per element in the x-z plane.
    """
    U, L = naca4(first["m"], first["p"], first["t"], chord=first["chord"], te_abs=first.get("te", 0.0015))
    Up, Lo = place_inverted(U, L, np.array([first["x_le"], 0.0]), first["angle"])
    dz = first["min_z"] - min(Up[:, 1].min(), Lo[:, 1].min())
    Up[:, 1] += dz
    Lo[:, 1] += dz
    out = [(Up, Lo)]
    for e in elements:
        pUp, pLo = out[-1]
        te = 0.5 * (pUp[-1] + pLo[-1])
        prev_ang = np.arctan2(*(pUp[-1] - pUp[0])[::-1])  # chord direction of previous element
        dirc = np.array([np.cos(prev_ang), np.sin(prev_ang)])
        nrm = np.array([-np.sin(prev_ang), np.cos(prev_ang)])  # points to the pressure (top) side
        U, L = naca4(e["m"], e["p"], e["t"], chord=e["chord"], te_abs=e.get("te", 0.0015))
        prevpoly = np.vstack([pUp, pLo])

        def build(h):
            le = te - e["overlap"] * dirc + h * nrm
            return place_inverted(U, L, le, e["angle"])

        lo_h, hi_h = -0.02, 0.15
        for _ in range(60):  # bisection on the normal offset to hit the requested slot gap
            mid = 0.5 * (lo_h + hi_h)
            a, b = build(mid)
            if poly_min_dist(prevpoly, np.vstack([a, b])) < e["gap"]:
                lo_h = mid
            else:
                hi_h = mid
        out.append(build(hi_h))
    return out


# ----------------------------------------------------------------------------------------------
# Other primitives
# ----------------------------------------------------------------------------------------------
def superellipse_ring(yc, zc, a, b, n_exp=2.6, M=72):
    t = np.linspace(0, 2 * np.pi, M, endpoint=False)
    c, s = np.cos(t), np.sin(t)
    y = yc + a * np.sign(c) * np.abs(c) ** (2 / n_exp)
    z = zc + b * np.sign(s) * np.abs(s) ** (2 / n_exp)
    return np.c_[y, z]


def plate_xz(poly_xz, y0, thick) -> Surf:
    """Prism from an x-z polygon, centred at y0 with thickness thick."""
    P = np.asarray(poly_xz, float)
    r0 = np.c_[P[:, 0], np.full(len(P), y0 - thick / 2), P[:, 1]]
    r1 = np.c_[P[:, 0], np.full(len(P), y0 + thick / 2), P[:, 1]]
    return loft([r0, r1])


def plate_yz(poly_yz, x0, thick) -> Surf:
    P = np.asarray(poly_yz, float)
    r0 = np.c_[np.full(len(P), x0 - thick / 2), P[:, 0], P[:, 1]]
    r1 = np.c_[np.full(len(P), x0 + thick / 2), P[:, 0], P[:, 1]]
    return loft([r0, r1])


def tube(path, r, n=14) -> Surf:
    """Swept circle along a polyline with parallel-transport frames and flat caps."""
    path = np.asarray(path, float)
    T = np.gradient(path, axis=0)
    T /= np.linalg.norm(T, axis=1)[:, None]
    ref = np.array([0, 0, 1.0]) if abs(T[0, 2]) < 0.9 else np.array([1.0, 0, 0])
    N = np.cross(T[0], ref)
    N /= np.linalg.norm(N)
    rings = []
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    for i in range(len(path)):
        if i > 0:
            N = N - T[i] * np.dot(N, T[i])
            N /= np.linalg.norm(N)
        B = np.cross(T[i], N)
        rings.append(path[i] + r * (np.outer(np.cos(ang), N) + np.outer(np.sin(ang), B)))
    return loft(rings)


def rod(p0, p1, r, n=14) -> Surf:
    return tube(np.linspace(p0, p1, 3), r, n)


def revolve(profile_ar, centre, axis, n=72) -> Surf:
    """Revolve a closed meridian profile [(a, r), ...] whose first and last points lie on the axis
    (r=0). axis is a unit vector; returns a closed solid of revolution."""
    P = np.asarray(profile_ar, float)
    axis = np.asarray(axis, float) / np.linalg.norm(axis)
    ref = np.array([1.0, 0, 0]) if abs(axis[0]) < 0.9 else np.array([0, 0, 1.0])
    e1 = np.cross(axis, ref)
    e1 /= np.linalg.norm(e1)
    e2 = np.cross(axis, e1)
    ang = np.linspace(0, 2 * np.pi, n, endpoint=False)
    circ = np.outer(np.cos(ang), e1) + np.outer(np.sin(ang), e2)
    V = []
    F = []
    ids = []
    for a, r in P:
        if r < 1e-9:
            ids.append([len(V)])
            V.append(centre + a * axis)
        else:
            base = len(V)
            V.extend(list(centre + a * axis + r * circ))
            ids.append(list(range(base, base + n)))
    for k in range(len(P) - 1):
        A, B = ids[k], ids[k + 1]
        if len(A) == 1 and len(B) == 1:
            continue
        if len(A) == 1:
            for i in range(n):
                F.append((A[0], B[(i + 1) % n], B[i]))
        elif len(B) == 1:
            for i in range(n):
                F.append((A[i], A[(i + 1) % n], B[0]))
        else:
            for i in range(n):
                F.append((A[i], A[(i + 1) % n], B[(i + 1) % n]))
                F.append((A[i], B[(i + 1) % n], B[i]))
    return orient_outward(Surf(np.array(V), np.array(F, int)))


def ellipsoid(c, ax, n=40) -> Surf:
    t = np.linspace(-np.pi / 2, np.pi / 2, n // 2 + 1)
    prof = np.c_[np.sin(t), np.cos(t)]
    prof[0, 1] = prof[-1, 1] = 0.0
    s = revolve(prof, np.zeros(3), [0, 0, 1.0], n)
    return Surf(s.V * np.asarray(ax, float) + np.asarray(c, float), s.F)


# ----------------------------------------------------------------------------------------------
# I/O
# ----------------------------------------------------------------------------------------------
def write_stl(path, s: Surf, name="solid"):
    V, F = s.V, s.F
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    nrm = np.cross(b - a, c - a)
    nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-30
    rec = np.zeros(len(F), dtype=[("n", "<f4", 3), ("a", "<f4", 3), ("b", "<f4", 3), ("c", "<f4", 3), ("x", "<u2")])
    rec["n"], rec["a"], rec["b"], rec["c"] = nrm, a, b, c
    with open(path, "wb") as fh:
        fh.write(name.encode()[:80].ljust(80, b" "))
        fh.write(struct.pack("<I", len(F)))
        fh.write(rec.tobytes())


def write_stl_ascii(path, s: Surf, name="solid"):
    V, F = s.V, s.F
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    nrm = np.cross(b - a, c - a)
    nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-30
    lines = [f"solid {name}"]
    for k in range(len(F)):
        lines.append(f" facet normal {nrm[k,0]:.6e} {nrm[k,1]:.6e} {nrm[k,2]:.6e}\n  outer loop")
        for p in (a[k], b[k], c[k]):
            lines.append(f"   vertex {p[0]:.6e} {p[1]:.6e} {p[2]:.6e}")
        lines.append("  endloop\n endfacet")
    lines.append(f"endsolid {name}\n")
    with open(path, "w") as fh:
        fh.write("\n".join(lines))


def check_closed(s: Surf) -> dict:
    """Edge-manifold check per connected body (every directed edge must have its reverse)."""
    e = np.vstack([s.F[:, [0, 1]], s.F[:, [1, 2]], s.F[:, [2, 0]]])
    fwd = set(map(tuple, e))
    bad = sum(1 for (a, b) in fwd if (b, a) not in fwd)
    return {"tris": int(len(s.F)), "open_or_misoriented_edges": int(bad)}
