"""2D model of an F1-style underbody in ground effect (Venturi floor).

The car is represented by a closed 2D body (unit length) whose lower surface is the
floor: a **convergent inlet** (floor descending to the throat), a **flat throat** and a
**divergent diffuser** (kick-up at the rear). The upper surface adds a smooth thickness
distribution and closes at a sharp trailing edge at the diffuser exit, where the Kutta
condition is applied. The moving ground is modelled with the method of images.

Solved with the same engine as the airfoils: linear-vortex panels + ground images +
integral boundary layer on the floor (Thwaites -> transition -> Head). A real car has a
blunt base and its floor discharges into the wake at the base pressure, so the exit
condition is Cp(diffuser exit) = Cp_base instead of a Kutta condition at a sharp tail
(a sharp-tail Kutta body this close to the ground gives unphysical suction, Cp ~ -100).
If the diffuser separates, the jet leaves at the separation point at Cp_base and the
pressure recovery downstream is lost (same logic as the quasi-1D floor model).

Limitations (2D): no floor-edge vortices or lateral leakage (a real floor is sealed by
them), no wheels, no base wake; separation acts through an estimate, not a full
viscous-inviscid coupling. Trends (ride-height, rake and diffuser-angle sensitivity,
centre-of-pressure movement) are the point.
"""
from __future__ import annotations

import numpy as np

from . import panel as P

X_FRONT_AXLE = 0.15
X_REAR_AXLE = 0.85


def floor_line(x, h_inlet=0.08, x_throat0=0.25, x_diff0=0.65, diffuser_deg=10.0):
    """Floor height above the ground (before rake), throat at height 0 (shifted later)."""
    x = np.asarray(x, dtype=float)
    y = np.zeros_like(x)
    inl = x < x_throat0
    y[inl] = h_inlet * 0.5 * (1 + np.cos(np.pi * x[inl] / x_throat0))
    dif = x > x_diff0
    y[dif] = (x[dif] - x_diff0) * np.tan(np.radians(diffuser_deg))
    return y


def geometry(h=0.03, h_inlet=0.09, x_throat0=0.25, x_diff0=0.72, diffuser_deg=7.0,
             rake_deg=0.0, thickness=0.08, n=200):
    """Clockwise contour (TE lower -> nose -> TE upper) with minimum ground clearance h."""
    beta = np.linspace(0.0, np.pi, n // 2 + 1)
    x = 0.5 * (1 - np.cos(beta))
    yf = floor_line(x, h_inlet, x_throat0, x_diff0, diffuser_deg)
    half = 5 * thickness * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x**2 + 0.2843 * x**3 - 0.1036 * x**4)
    nose = np.clip(1 - x / 0.2, 0, 1)
    yl = yf - 0.35 * half * nose  # rounded nose below the floor line
    yu = yf + 2 * half
    xs = np.concatenate([x[::-1], x[1:]])
    ys = np.concatenate([yl[::-1], yu[1:]])
    xs[0] = xs[-1] = 1.0
    ys[0] = ys[-1] = yf[-1]
    # rake: positive = nose down / rear up (rotation counter-clockwise about mid-floor)
    a = np.radians(rake_deg)
    cx, cy = 0.5, float(np.interp(0.5, x, yf))
    dx, dy = xs - cx, ys - cy
    xr = cx + dx * np.cos(a) - dy * np.sin(a)
    yr = cy + dx * np.sin(a) + dy * np.cos(a)
    yr = yr - yr.min() + h  # ground at y = 0, minimum clearance = h
    return xr, yr, {"x_throat0": x_throat0, "x_diff0": x_diff0,
                    "area_ratio": float((h + (1 - x_diff0) * np.tan(np.radians(diffuser_deg))) / h)}


def _circulation_basis(sysm):
    """Node strengths of a pure circulation change (Kutta row = 1, no free stream)."""
    rhs = np.zeros(sysm.A.shape[0])
    rhs[-1] = 1.0
    return np.linalg.solve(sysm.A, rhs)


def _lower_index(x):
    ile = int(np.argmin(x))
    return np.arange(ile, -1, -1)  # nose -> tail along the floor


# entrainment augmentation produced by fully developed floor-edge vortices (Head's F x (1+b))
EDGE_VORTEX_BOOST = 2.5
# lateral pressure-relief length in gap heights (semi-empirical: potential-flow decay of the
# side-gap disturbance is O(h); viscous leakage widens it)
EDGE_RELIEF = 2.0


def leakage_factor(width=0.35, h_mean=0.04, seal=0.0):
    """Mean floor suction of a finite-width floor relative to the 2D value (0..1).

    The underfloor suction is relieved near each side over a strip of about
    EDGE_RELIEF gap heights, where air leaks in from the sides. Floor-edge vortices act
    as aerodynamic "skirts" and shrink that strip (up to 70 % with full sealing).
    Semi-empirical: it gives the right trends (narrower floor or larger gap -> more
    leakage; stronger edge vortices -> better sealing), not exact numbers.
    """
    strip = EDGE_RELIEF * h_mean * (1.0 - 0.7 * float(np.clip(seal, 0, 1)))
    return float(np.clip(1.0 - 2.0 * strip / max(width, 1e-6), 0.2, 1.0))


def analyze(h=0.03, h_inlet=0.09, x_throat0=0.25, x_diff0=0.72, diffuser_deg=7.0,
            rake_deg=0.0, thickness=0.08, cp_base=-0.25, re=2e7, field=None,
            three_d=False, width=0.35, edge_vortex=0.6):
    """Underbody with a base-pressure exit condition (see module docstring).

    Instead of a Kutta condition at a sharp tail, the circulation is chosen so that the
    floor flow discharges at the base pressure Cp_base (the car's wake) at the diffuser
    exit -- or, if the diffuser boundary layer cannot stay attached that far, at the
    furthest point x_m up to which it does stay attached (found by bisection); the
    separated jet downstream of x_m stays at Cp_base (no further pressure recovery).

    three_d=True adds the two dominant 3D effects of a real floor of width ``width``:
    lateral leakage (suction scaled by the VLM 3D/2D loading ratio) and floor-edge
    vortices of strength ``edge_vortex`` (0..1) that seal the edges and energise the
    diffuser boundary layer (augmented entrainment, delays separation).
    """
    from . import boundary_layer as BL

    x, y, info = geometry(h, h_inlet, x_throat0, x_diff0, diffuser_deg, rake_deg, thickness)
    el = P.Element(x, y, "main")
    sysm = P.PanelSystem([el], 0.0)
    g0 = sysm.solve(0.0).gamma
    gc = _circulation_basis(sysm)
    low = _lower_index(x)
    xl = x[low]
    target = np.sqrt(1.0 - cp_base)
    kappa = 1.0
    boost_level = 0.0
    if three_d:
        h_mean = float(np.mean(y[low][(xl > 0.05) & (xl < 0.95)]))
        kappa = leakage_factor(width, h_mean, edge_vortex)
        boost_level = EDGE_VORTEX_BOOST * edge_vortex

    def state(xm):
        k = int(np.clip(np.searchsorted(xl, xm), 1, len(xl) - 1))
        f = (xm - xl[k - 1]) / max(xl[k] - xl[k - 1], 1e-12)
        i0, i1 = low[k - 1], low[k]
        a = (1 - f) * g0[i0] + f * g0[i1]
        b = (1 - f) * gc[i0] + f * gc[i1]
        # keep the floor-flow direction of the Kutta solution
        d = (np.sign(a) * target - a) / b if abs(b) > 1e-12 else 0.0
        sol = P.PanelSolution([el], 0.0, 0.0, g0 + d * gc, [0, len(x)])
        up, lo, stag = P.split_surfaces(sol, 0)
        ue = BL.te_regularise(lo["s"], lo["ue"], lo["x"])
        ue = np.where(lo["x"] > xm, np.interp(xm, lo["x"], ue), ue)  # jet / plateau after x_m
        # march on a fine, uniform arc-length grid so the separation point is resolved
        # independently of the panel spacing (keeps the sweeps smooth)
        sf = np.linspace(0.0, lo["s"][-1], 450)
        xf = np.interp(sf, lo["s"], lo["x"])
        boost = np.where(xf > x_throat0, boost_level, 0.0) if boost_level > 0 else None
        r = BL.march(sf, np.interp(sf, lo["s"], ue), 1.0 / re, 0.1, n_sub=1, boost=boost)
        r["x"] = xf
        xs = None if r["turb_sep"] is None else float(np.interp(r["turb_sep"], sf, xf))
        if xs is None and r["lam_sep"] is not None and not r["bubble"]:
            xs = float(np.interp(r["lam_sep"], sf, xf))
        return sol, stag, r, xs

    x_end = 0.97
    sol, stag, r, xs = state(x_end)
    x_match = x_end
    x_sep = None
    if xs is not None and xs < x_end - 0.005:
        # bisection on the discharge point: attached up to x_m <=> no separation before x_m
        lo_x, hi_x = max(x_throat0, x_diff0 - 0.1), x_end
        for _ in range(10):
            mid = 0.5 * (lo_x + hi_x)
            _, _, _, xs_m = state(mid)
            if xs_m is None or xs_m >= mid - 0.005:
                lo_x = mid
            else:
                hi_x = mid
        x_match = lo_x
        sol, stag, r, _ = state(x_match)
        x_sep = x_match
    bl = {"lower": {"x": r["x"], "H": r["H"], "state": r["state"],
                    "x_tr": None if r["transition"] is None else float(r["transition"]), "x_sep": x_sep}}
    g = sol.gamma
    cp = 1.0 - g**2
    if three_d:
        # lateral leakage: the floor suction relative to the base level drops by kappa
        cp[low] = cp_base + kappa * (cp[low] - cp_base)
    # separated jet / base region: constant base pressure on the floor downstream of x_match
    cp[low[xl > x_match]] = cp_base
    upper_tail = np.arange(int(np.argmin(x)), len(x))
    cp[upper_tail[x[upper_tail] > 0.97]] = np.maximum(cp[upper_tail[x[upper_tail] > 0.97]], cp_base)
    cpm = 0.5 * (cp[:-1] + cp[1:])
    fy = -cpm * el.ny * el.L
    fx = -cpm * el.nx * el.L
    lift = float(np.sum(fy))
    trap = getattr(np, "trapezoid", None) or getattr(np, "trapz")
    fcp = cp[low]
    # floor centre of pressure (the floor is what this lab is about; the 2D roof adds
    # lift that a real car's bodywork does not reproduce) and front/rear axle split
    w = -fcp
    x_cp = float(trap(w * xl, xl) / trap(w, xl)) if abs(trap(w, xl)) > 1e-9 else 0.5
    front = (X_REAR_AXLE - x_cp) / (X_REAR_AXLE - X_FRONT_AXLE)
    out = {"x": x, "y": y, "cp": cp, "ground_y": 0.0, "downforce": -lift, "cd_p": float(np.sum(fx)),
           "x_cp": x_cp, "front_share": float(front), "x_sep": x_sep, "x_exit_match": float(x_match),
           "floor": {"x": xl, "y": y[low], "cp": fcp}, "throat_cp": float(fcp.min()),
           "floor_suction": -float(trap(fcp, xl)), "stag": stag,
           "bl_lower": bl["lower"], "three_d": bool(three_d), "leakage_factor": kappa,
           "entrainment_boost": boost_level, **info}
    if field:
        xg = np.linspace(field["x0"], field["x1"], int(field.get("nx", 110)))
        yg = np.linspace(field["y0"], field["y1"], int(field.get("ny", 50)))
        u, v = P.velocity_field(sol, xg, yg)
        out["field"] = {"x": xg, "y": yg, "u": u, "v": v}
    return out
