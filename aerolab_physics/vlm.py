"""Vortex-lattice method (horseshoe vortices) for wings, endplates and ground effect.

Each lattice panel carries a horseshoe vortex: bound segment on the panel 1/4-chord
line, trailing legs parallel to the free stream (x) to "infinity". Flow tangency at
the 3/4-chord control points. Ground effect: mirror image lattice about z = z_ground
with opposite circulation. Lift by Kutta-Joukowski on the strips, induced drag in the
Trefftz plane (far-wake 2D crossflow), which is the robust way to get CDi.

Axes: x downstream, y to starboard, z up. Free stream (cos a, 0, sin a).
Refs: Katz & Plotkin (2001) §12.3; Bertin & Cummings, *Aerodynamics for Engineers*.
"""
from __future__ import annotations

import numpy as np

FAR = 1e3


def _segments_velocity(P, A, B, core=1e-6):
    """Velocity at points P (n,3) from unit-strength straight filaments A->B (m,3)."""
    r1 = P[:, None, :] - A[None, :, :]
    r2 = P[:, None, :] - B[None, :, :]
    r0 = (B - A)[None, :, :]
    c = np.cross(r1, r2)
    c2 = np.sum(c * c, axis=2)
    n1 = np.linalg.norm(r1, axis=2)
    n2 = np.linalg.norm(r2, axis=2)
    l2 = np.sum(r0 * r0, axis=2)
    ok = (c2 > core**2 * l2) & (n1 > core) & (n2 > core)
    k = np.where(ok, (np.sum(r0 * r1, axis=2) / np.where(n1 > 0, n1, 1) - np.sum(r0 * r2, axis=2) / np.where(n2 > 0, n2, 1))
                 / (4 * np.pi * np.where(ok, c2, 1.0)), 0.0)
    return c * k[:, :, None]


def cos_cp_frac(ns):
    """Spanwise control-point position inside each strip for cosine spacing.

    With full-cosine strips the control points must sit at the *angular* midpoints
    y = -cos((th_j + th_j+1)/2) (James 1972, "semicircle" method): CL then converges at once
    and the Trefftz-plane drag (evaluated at the same points) gives e <= 1 for a planar wing,
    as Munk's theorem requires. Geometric midpoints overpredict CL near the tips (e > 1)."""
    t = np.linspace(0, np.pi, ns + 1)
    y = -np.cos(t)
    ym = -np.cos(0.5 * (t[1:] + t[:-1]))
    return (ym - y[:-1]) / (y[1:] - y[:-1])


def lattice_surface(le, te, nc, ns, cos_span=True):
    """Lattice between leading-edge points ``le`` (k,3) and trailing-edge points ``te`` (k,3)
    given at k spanwise stations; returns corner grid (nc+1, ns+1, 3)."""
    le, te = np.asarray(le, float), np.asarray(te, float)
    t_in = np.linspace(0, 1, len(le))
    if cos_span:
        t = 0.5 * (1 - np.cos(np.linspace(0, np.pi, ns + 1)))
    else:
        t = np.linspace(0, 1, ns + 1)
    LE = np.stack([np.interp(t, t_in, le[:, d]) for d in range(3)], axis=1)
    TE = np.stack([np.interp(t, t_in, te[:, d]) for d in range(3)], axis=1)
    s = np.linspace(0, 1, nc + 1)[:, None, None]
    return LE[None] * (1 - s) + TE[None] * s


def wing_surfaces(AR=6.0, taper=1.0, sweep_deg=0.0, dihedral_deg=0.0, twist_deg=0.0,
                  span=1.0, nc=6, ns=24, endplate_h=0.0, endplate_len=1.0, nce=4, nse=6,
                  camber_slope=0.0):
    """Wing (full span, symmetric) plus optional vertical endplates (height as fraction of span)."""
    b = span
    S = b**2 / AR
    cr = 2 * S / (b * (1 + taper))
    ct = cr * taper
    tw = np.radians(twist_deg)
    sw = np.tan(np.radians(sweep_deg))
    dh = np.tan(np.radians(dihedral_deg))
    ys = np.linspace(-b / 2, b / 2, 41)
    eta = np.abs(2 * ys / b)
    c = cr + (ct - cr) * eta
    xle = sw * np.abs(ys)
    zle = dh * np.abs(ys)
    # geometric twist: rotate about the quarter chord, washout negative
    tws = tw * eta
    xte = xle + c * np.cos(tws)
    zte = zle - c * np.sin(tws) - camber_slope * c
    le = np.stack([xle, ys, zle], axis=1)
    te = np.stack([xte, ys, zte], axis=1)
    surfaces = [{"name": "wing", "grid": lattice_surface(le, te, nc, ns), "cp_frac": cos_cp_frac(ns)}]
    if endplate_h > 0:
        h = endplate_h * b
        for side in (-1, 1):
            y0 = side * b / 2
            ctip = ct
            x0 = sw * b / 2 - 0.15 * ctip * (endplate_len - 1)
            L = ctip * endplate_len
            z0 = dh * b / 2
            zs = np.array([z0 - 0.5 * h, z0 + 0.5 * h])
            le_e = np.stack([np.full(2, x0), np.full(2, y0), zs], axis=1)
            te_e = np.stack([np.full(2, x0 + L), np.full(2, y0), zs], axis=1)
            if side < 0:
                le_e, te_e = le_e[::-1], te_e[::-1]
            surfaces.append({"name": "endplate", "grid": lattice_surface(le_e, te_e, nce, nse, cos_span=False)})
    return surfaces


def delta_surfaces(sweep_le_deg=70.0, root_chord=1.0, nc=10, ns=20):
    """Flat delta wing; leading-edge sweep sets AR = 4 / tan(sweep)."""
    half_span = root_chord / np.tan(np.radians(sweep_le_deg))
    ys = np.linspace(-half_span, half_span, 41)
    xle = np.abs(ys) * np.tan(np.radians(sweep_le_deg))
    le = np.stack([xle, ys, np.zeros_like(ys)], axis=1)
    te = np.stack([np.full_like(ys, root_chord), ys, np.zeros_like(ys)], axis=1)
    return [{"name": "delta", "grid": lattice_surface(le, te, nc, ns), "cp_frac": cos_cp_frac(ns)}]


def _panels(surfaces):
    A, B, C, Nrm, area, strip, surf_id = [], [], [], [], [], [], []
    sid = 0
    strip_base = 0
    for k, s in enumerate(surfaces):
        G = s["grid"]
        nc, ns = G.shape[0] - 1, G.shape[1] - 1
        frac = s.get("cp_frac")
        for i in range(nc):
            for j in range(ns):
                p00, p01 = G[i, j], G[i, j + 1]
                p10, p11 = G[i + 1, j], G[i + 1, j + 1]
                a = p00 + 0.25 * (p10 - p00)
                b = p01 + 0.25 * (p11 - p01)
                cl = p00 + 0.75 * (p10 - p00)
                cr = p01 + 0.75 * (p11 - p01)
                w = 0.5 if frac is None else float(frac[j])
                cp = (1 - w) * cl + w * cr
                n = np.cross(p11 - p00, p01 - p10)
                # orient so that n = x_hat x (B - A) direction (lift-positive for +y spans)
                ref = np.cross([1.0, 0, 0], b - a)
                if np.dot(n, ref) < 0:
                    n = -n
                nn = np.linalg.norm(n)
                A.append(a)
                B.append(b)
                C.append(cp)
                Nrm.append(n / nn)
                area.append(0.5 * nn)
                strip.append(strip_base + j)
                surf_id.append(k)
        strip_base += ns
        sid += 1
    return (np.array(A), np.array(B), np.array(C), np.array(Nrm), np.array(area),
            np.array(strip), np.array(surf_id))


def _horseshoe_velocity(P, A, B):
    """Velocity at P from unit horseshoes: inf -> A -> B -> inf (legs along +x)."""
    Ainf = A + np.array([FAR, 0, 0])
    Binf = B + np.array([FAR, 0, 0])
    return (_segments_velocity(P, Ainf, A) + _segments_velocity(P, A, B) + _segments_velocity(P, B, Binf))


def _mirror(Pts, zg):
    M = Pts.copy()
    M[..., 2] = 2 * zg - M[..., 2]
    return M


def solve(surfaces, alpha_deg=5.0, ground_z=None, rho=1.0, V=1.0, s_ref=None, b_ref=None):
    A, B, C, Nrm, area, strip, sid = _panels(surfaces)
    a = np.radians(alpha_deg)
    Vinf = V * np.array([np.cos(a), 0.0, np.sin(a)])
    Vind = _horseshoe_velocity(C, A, B)
    if ground_z is not None:
        Vind = Vind - _horseshoe_velocity(C, _mirror(A, ground_z), _mirror(B, ground_z))
    AIC = np.einsum("ijk,ik->ij", Vind, Nrm)
    G = np.linalg.solve(AIC, -Nrm @ Vinf)

    wing = sid == 0
    if s_ref is None:
        s_ref = float(np.sum(area[wing]))
    if b_ref is None:
        b_ref = float(np.ptp(np.concatenate([A[wing, 1], B[wing, 1]])))

    # Kutta-Joukowski on each bound segment (local velocity incl. induced, for side force)
    lvec = B - A
    F = rho * np.cross(np.tile(Vinf, (len(G), 1)), lvec) * G[:, None]
    lift_dir = np.array([-np.sin(a), 0, np.cos(a)])
    L = float(np.sum(F @ lift_dir))
    q = 0.5 * rho * V**2
    CL = L / (q * s_ref)

    # Trefftz plane: strip circulations and trailing vortices
    n_strip = strip.max() + 1
    Gs = np.zeros(n_strip)
    np.add.at(Gs, strip, G)
    # strip geometry from the first chordwise row (bound segment ends)
    ya = np.zeros((n_strip, 2))
    yb = np.zeros((n_strip, 2))
    nrm2 = np.zeros((n_strip, 2))
    cpts = np.zeros((n_strip, 2))
    seen = np.zeros(n_strip, bool)
    for k in range(len(G)):
        s = strip[k]
        if not seen[s]:
            ya[s] = A[k, 1:]
            yb[s] = B[k, 1:]
            cpts[s] = C[k, 1:]
            n2 = Nrm[k, 1:]
            nrm2[s] = n2 / (np.linalg.norm(n2) + 1e-12)
            seen[s] = True
    # trailing filaments: at a of each strip +(-Gs), at b +Gs (legs along +x: B->inf carries +G)
    pos = np.concatenate([ya, yb])
    strn = np.concatenate([-Gs, Gs])
    # downwash at the strips' control points (consistent with the collocation, see cos_cp_frac)
    mid = cpts
    ds = np.linalg.norm(yb - ya, axis=1)

    def vel2d(points, src, g):
        d = points[:, None, :] - src[None, :, :]
        r2 = np.sum(d * d, axis=2) + 1e-10
        vy = -g[None, :] * d[:, :, 1] / (2 * np.pi * r2)
        vz = g[None, :] * d[:, :, 0] / (2 * np.pi * r2)
        return np.stack([vy.sum(1), vz.sum(1)], axis=1)

    w = vel2d(mid, pos, strn)
    if ground_z is not None:
        img = pos.copy()
        img[:, 1] = 2 * ground_z - img[:, 1]
        w = w + vel2d(mid, img, -strn)
    wn = np.sum(w * nrm2, axis=1)
    Di = -0.5 * rho * float(np.sum(Gs * wn * ds))
    CDi = Di / (q * s_ref)
    AR = b_ref**2 / s_ref
    e = CL**2 / (np.pi * AR * CDi) if CDi > 1e-9 else np.nan

    # spanwise loading of the wing (strip circulation) for plotting
    wing_strips = np.unique(strip[wing])
    ymid = mid[wing_strips, 0]
    order = np.argsort(ymid)
    dCp = G / (q * area) * rho * V  # panel loading coefficient ~ delta Cp
    return {"CL": CL, "CDi": CDi, "e": e, "AR": AR, "S": s_ref, "b": b_ref,
            "span_y": ymid[order], "span_gamma": Gs[wing_strips][order], "span_w": wn[wing_strips][order],
            "panels": {"A": A, "B": B, "C": C, "G": G, "dcp": dCp, "surface": sid},
            "endplate_gamma": [float(np.sum(G[sid == k])) for k in range(1, int(sid.max()) + 1)]}
