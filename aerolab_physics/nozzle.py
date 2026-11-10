"""Quasi-one-dimensional compressible nozzle flow (perfect gas).

Isentropic relations, area-Mach relation, normal shock (Rankine-Hugoniot), and the
complete operating map of convergent, divergent and convergent-divergent nozzles
as a function of back pressure.

Hugoniot area-velocity relation: dA/A = (M^2 - 1) dV/V.
Refs: Anderson, *Modern Compressible Flow* (2003) ch. 5; Zucker & Biblarz (2002).
"""
from __future__ import annotations

import numpy as np

R_AIR = 287.05


def p_ratio(M, g=1.4):
    return (1 + 0.5 * (g - 1) * M**2) ** (-g / (g - 1))


def T_ratio(M, g=1.4):
    return 1.0 / (1 + 0.5 * (g - 1) * M**2)


def rho_ratio(M, g=1.4):
    return (1 + 0.5 * (g - 1) * M**2) ** (-1 / (g - 1))


def area_ratio(M, g=1.4):
    """A/A* as a function of Mach number."""
    M = np.maximum(np.asarray(M, dtype=float), 1e-9)
    return 1 / M * ((2 / (g + 1)) * (1 + 0.5 * (g - 1) * M**2)) ** ((g + 1) / (2 * (g - 1)))


def mach_from_area(Ar, g=1.4, supersonic=False):
    """Invert A/A* (vectorised bisection on the requested branch)."""
    Ar = np.maximum(np.atleast_1d(np.asarray(Ar, dtype=float)), 1.0)
    if supersonic:
        lo, hi = np.ones_like(Ar), np.full_like(Ar, 50.0)
    else:
        lo, hi = np.full_like(Ar, 1e-7), np.ones_like(Ar)
    for _ in range(80):
        mid = 0.5 * (lo + hi)
        f = area_ratio(mid, g) - Ar
        if supersonic:
            hi = np.where(f > 0, mid, hi)
            lo = np.where(f > 0, lo, mid)
        else:
            lo = np.where(f > 0, mid, lo)
            hi = np.where(f > 0, hi, mid)
    return 0.5 * (lo + hi)


def mach_from_p_ratio(pr, g=1.4):
    pr = np.clip(pr, 1e-12, 1.0)
    return np.sqrt(2 / (g - 1) * (pr ** (-(g - 1) / g) - 1))


def normal_shock(M1, g=1.4):
    M1 = np.asarray(M1, dtype=float)
    M2 = np.sqrt((1 + 0.5 * (g - 1) * M1**2) / (g * M1**2 - 0.5 * (g - 1)))
    p21 = 1 + 2 * g / (g + 1) * (M1**2 - 1)
    rho21 = (g + 1) * M1**2 / (2 + (g - 1) * M1**2)
    T21 = p21 / rho21
    p0r = rho21 ** (g / (g - 1)) * (1 / p21) ** (1 / (g - 1))
    return {"M2": M2, "p2_p1": p21, "rho2_rho1": rho21, "T2_T1": T21, "p02_p01": p0r}


def geometry(A_in=2.0, A_t=1.0, A_e=2.0, n=301, L_conv=1.0, L_div=2.0):
    """Smooth nozzle: cosine convergent then cosine divergent. Returns x, A(x)."""
    x = np.linspace(0, L_conv + L_div, n)
    A = np.empty_like(x)
    c = x <= L_conv
    A[c] = A_t + (A_in - A_t) * 0.5 * (1 + np.cos(np.pi * x[c] / L_conv))
    d = ~c
    A[d] = A_t + (A_e - A_t) * 0.5 * (1 - np.cos(np.pi * (x[d] - L_conv) / L_div))
    return x, A


def solve(A_in=2.0, A_t=1.0, A_e=2.0, p0=500e3, T0=300.0, pb=101.325e3, g=1.4, R=R_AIR, n=301):
    """Complete quasi-1D solution for back pressure pb.

    Throat = minimum area of the duct (if A_t >= A_in the nozzle is purely divergent with
    the throat at the inlet; if A_e <= A_t it is purely convergent with the throat at the exit).
    """
    if A_in > A_t and A_e > A_t:  # convergent-divergent
        kind = "cd"
        x, A = geometry(A_in, A_t, A_e, n)
    elif A_e < A_in:  # purely convergent (throat = exit)
        kind = "convergent"
        x = np.linspace(0, 1.5, n)
        A = A_e + (A_in - A_e) * 0.5 * (1 + np.cos(np.pi * x / x[-1]))
    else:  # purely divergent (throat = inlet)
        kind = "divergent"
        x = np.linspace(0, 1.5, n)
        A = A_in + (A_e - A_in) * 0.5 * (1 - np.cos(np.pi * x / x[-1]))
    it = int(np.argmin(A))
    At = A[it]
    Ae = A[-1]
    r = pb / p0
    Ar_e = Ae / At

    Me_sub = float(mach_from_area(Ar_e, g)[0])
    r1 = p_ratio(Me_sub, g)  # choked, subsonic everywhere downstream
    has_div = Ar_e > 1.0 + 1e-6
    if has_div:
        Me_sup = float(mach_from_area(Ar_e, g, True)[0])
        r_design = p_ratio(Me_sup, g)
        r_shock_exit = r_design * float(normal_shock(Me_sup, g)["p2_p1"])
    else:
        Me_sup = 1.0
        r_design = r1
        r_shock_exit = r1

    M = np.empty_like(A)
    p0_loc = np.full_like(A, p0)
    shock_x = None
    shock = None
    if r >= 1.0:
        regime = "no_flow"
        M[:] = 0.0
        Astar = np.inf
    elif r > r1:
        regime = "subsonic"  # unchoked venturi
        Me = float(mach_from_p_ratio(r, g))
        Astar = Ae / float(area_ratio(Me, g))
        M = mach_from_area(A / Astar, g)
    else:
        Astar = At
        sub = mach_from_area(A / At, g)
        sup = mach_from_area(A / At, g, True)
        idx = np.arange(len(A))
        if not has_div:
            M = sub.copy()
            M[-1] = 1.0
            regime = "choked_underexpanded" if r < r1 - 1e-9 else "choked_sonic_exit"
        elif r >= r_shock_exit:
            # normal shock inside the divergent part: find location giving pe = pb
            regime = "shock_in_nozzle" if r < r1 - 1e-9 else "choked_subsonic"
            if regime == "choked_subsonic":
                M = np.where(idx <= it, sub, sub)
            else:
                lo, hi = it + 1, len(A) - 1

                def pe_ratio(k):
                    M1 = sup[k]
                    ns = normal_shock(M1, g)
                    p0r = float(ns["p02_p01"])
                    Me2 = float(mach_from_area(Ae / (At / p0r), g)[0])
                    return p0r * p_ratio(Me2, g)

                # pe decreases monotonically as the shock moves downstream
                for _ in range(60):
                    if hi - lo <= 1:
                        break
                    mid = (lo + hi) // 2
                    if pe_ratio(mid) > r:
                        lo = mid
                    else:
                        hi = mid
                ks = lo
                ns = normal_shock(sup[ks], g)
                p0r = float(ns["p02_p01"])
                M = np.where(idx <= ks, np.where(idx <= it, sub, sup), mach_from_area(A / (At / p0r), g))
                p0_loc = np.where(idx <= ks, p0, p0 * p0r)
                shock_x = float(x[ks])
                shock = {"M1": float(sup[ks]), "M2": float(ns["M2"]), "p2_p1": float(ns["p2_p1"]),
                         "p02_p01": p0r, "A_over_At": float(A[ks] / At)}
        else:
            M = np.where(idx <= it, sub, sup)
            if abs(r - r_design) < 0.01 * r_design:
                regime = "design"
            elif r > r_design:
                regime = "overexpanded"
            else:
                regime = "underexpanded"
            if r < r_shock_exit and abs(r - r_shock_exit) < 1e-3 * r_shock_exit:
                regime = "shock_at_exit"

    p = p0_loc * p_ratio(M, g)
    T = T0 * T_ratio(M, g)
    rho = p / (R * T)
    a = np.sqrt(g * R * T)
    V = M * a
    mdot = float(rho[it] * V[it] * At)
    mdot_choked = float(p0 * At / np.sqrt(T0) * np.sqrt(g / R) * ((g + 1) / 2) ** (-(g + 1) / (2 * (g - 1))))
    return {"kind": kind, "x": x, "A": A, "M": M, "p": p, "T": T, "rho": rho, "V": V, "p0_local": p0_loc,
            "regime": regime, "shock_x": shock_x, "shock": shock, "mdot": mdot, "mdot_choked": mdot_choked,
            "throat_index": it, "pb_ratio": r,
            "critical": {"choke": float(r1), "shock_at_exit": float(r_shock_exit), "design": float(r_design)},
            "exit": {"M": float(M[-1]), "p": float(p[-1]), "pb": pb}}
