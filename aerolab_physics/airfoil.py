"""High-level 2D section analysis: geometry builder + panel method + boundary layer.

Viscous model (estimates, no viscous-inviscid interaction):

* The boundary layer (Thwaites -> transition -> Head) is marched on the inviscid
  edge velocity of every element.
* Lift (see viscous_lift): decambering by the trailing-edge displacement thickness, loss of the
  aft camber loading behind a trailing-edge separation, and the Kirchhoff/Helmholtz factor
  ((1 + sqrt f)/2)^2 with f the attached fraction of chord on the suction side (the basis of
  Beddoes-Leishman stall models). Fitted to NACA 0012/2412/4412 at Re ~ 3e6 (Abbott & von
  Doenhoff): Clmax 1.49/1.58/1.64 against 1.55/1.62/1.65 measured.
* Drag = Squire-Young profile drag + lost-suction pressure drag (Cl_inv - Cl) tan(alpha)
  + Hoerner base drag for a Gurney flap.

* Ground effect: the ground-induced circulation is reduced by the blockage of the gap under the
  trailing edge by the separated suction-side shear layer (ground_blockage), which gives the
  measured downforce peak at h/c ~ 0.1 and the force-reduction region below it.

Not captured: leading-edge (thin-airfoil) stall details and hysteresis.
"""
from __future__ import annotations

import numpy as np

from . import boundary_layer as BL
from . import naca as N
from . import panel as P
from . import vii as VII


def _upper_y_at(x, y, xq):
    ile = int(np.argmin(x))
    return float(np.interp(xq, x[ile:], y[ile:]))


def build_elements(spec: dict) -> list[P.Element]:
    """Build the element list from a geometry spec.

    spec keys: code (main NACA), n (panels), flap_deg + hinge (plain flap),
    gurney (h/c), ellipse (t/c, instead of NACA), invert (upside-down wing),
    slat {code, chord, gap, overlap, deflection}, flap {code, chord, gap, overlap, deflection},
    coords [x, y] (arbitrary clockwise contour, e.g. an underbody from underbody.py).
    """
    n = int(spec.get("n", 140))
    if spec.get("elements"):
        # generic multi-body layout: [{code|ellipse, chord, x, y, angle (TE-down +), invert, name}]
        out = []
        for k, e in enumerate(spec["elements"]):
            if e.get("ellipse"):
                xe, ye = N.ellipse(float(e["ellipse"]), int(e.get("n", 100)))
            else:
                xe, ye = N.naca(e.get("code", "4412"), int(e.get("n", 100)))
            if e.get("invert"):
                xe, ye = N.flip_vertical(xe, ye)
            c = float(e.get("chord", 1.0))
            xe, ye = N.transform(xe, ye, scale=c, angle_deg=float(e.get("angle", 0.0)), pivot=(0.0, 0.0),
                                 dx=float(e.get("x", 0.0)), dy=float(e.get("y", 0.0)))
            out.append(P.Element(xe, ye, e.get("name", f"el{k}")))
        return out
    if spec.get("coords"):
        x, y = (np.asarray(c, dtype=float) for c in spec["coords"])
    elif spec.get("ellipse"):
        x, y = N.ellipse(float(spec["ellipse"]), n)
    else:
        x, y = N.naca(spec.get("code", "0012"), n)
    if spec.get("flap_deg"):
        x, y = N.deflect_plain_flap(x, y, float(spec.get("hinge", 0.75)), float(spec["flap_deg"]))
    if spec.get("gurney"):
        x, y = N.add_gurney(x, y, float(spec["gurney"]))
    els = [(x, y, "main")]

    fl = spec.get("flap")
    if fl:
        cf = float(fl.get("chord", 0.3))
        xf, yf = N.naca(fl.get("code", "4412"), max(n // 2, 60))
        lex = 1.0 - float(fl.get("overlap", 0.0))
        ley = float(y[0]) - float(fl.get("gap", 0.02)) - 0.02 * cf / 0.3
        xf, yf = N.transform(xf, yf, scale=cf, angle_deg=float(fl.get("deflection", 20)), pivot=(0, 0), dx=lex, dy=ley)
        els.append((xf, yf, "flap"))
    sl = spec.get("slat")
    if sl:
        cs = float(sl.get("chord", 0.15))
        xs, ys = N.naca(sl.get("code", "6412"), max(n // 2, 60))
        xs, ys = xs * cs, ys * cs
        tex = float(sl.get("overlap", 0.02))
        tey = _upper_y_at(x, y, tex) + float(sl.get("gap", 0.02))
        xs, ys = xs + tex - cs, ys + tey
        xs, ys = N.transform(xs, ys, angle_deg=-float(sl.get("deflection", 30)), pivot=(tex, tey))
        els.insert(0, (xs, ys, "slat"))

    if spec.get("invert"):
        els = [(*N.flip_vertical(a, b), nm) for a, b, nm in els]
    return [P.Element(a, b, nm) for a, b, nm in els]


def ground_line(elements, h_over_c: float):
    """Ground y-position so that the lowest point of the geometry is h/c above it."""
    ymin = min(float(np.min(e.y)) for e in elements)
    return ymin - h_over_c


def elements_intersect(elements) -> bool:
    """Cheap check: any node of one element inside another."""
    for i, a in enumerate(elements):
        others = [b for j, b in enumerate(elements) if j != i]
        if others and np.any(P.points_inside(a.x[1:-1], a.y[1:-1], others)):
            return True
    return False


# ------------------------------------------------------------------ viscous solver
def _trim(srf, x_max):
    keep = srf["x"] <= x_max + 1e-9
    last = np.where(keep)[0][-1]
    return {k: v[: last + 1] for k, v in srf.items()}


# Viscous lift model constants, fitted to Abbott & von Doenhoff (1959) NACA 0012/2412/4412 at
# Re ~ 3e6 (smooth): lift slope, zero-lift angle, Clmax and post-stall trend within ~0.06.
K_DECAMBER = 8.0     # attached-flow decambering: dCl = -K (dstar_upper - dstar_lower)_TE / c_ref
A_CAMBER_LOSS = 3.5  # aft (camber) loading lost behind a trailing-edge separation


def camber_cl0(el: P.Element) -> float:
    """Thin-airfoil lift of the element's camber line at zero chord incidence, on the reference chord.

    Cl0 = -2 pi alpha_0, alpha_0 = -(1/pi) int_0^pi dz/dx (cos th - 1) dth (Anderson, Fundamentals
    of Aerodynamics, sec. 4.8). The chord line runs from the leading edge (point farthest from the
    trailing edge) to the trailing edge, so it works for deflected, inverted or rotated elements.
    """
    x, y = el.x, el.y
    xt, yt = 0.5 * (x[0] + x[-1]), 0.5 * (y[0] + y[-1])
    ile = int(np.argmax(np.hypot(x - xt, y - yt)))
    cx, cy = xt - x[ile], yt - y[ile]
    c = float(np.hypot(cx, cy))
    if c < 1e-9 or ile in (0, len(x) - 1):
        return 0.0
    ex, ey = cx / c, cy / c
    xi = ((x - x[ile]) * ex + (y - y[ile]) * ey) / c
    eta = (-(x - x[ile]) * ey + (y - y[ile]) * ex) / c
    th = np.linspace(0, np.pi, 121)
    xs = 0.5 * (1 - np.cos(th))
    a, b = xi[: ile + 1][::-1], eta[: ile + 1][::-1]
    d, e = xi[ile:], eta[ile:]
    oa, od = np.argsort(a), np.argsort(d)
    z = 0.5 * (np.interp(xs, a[oa], b[oa]) + np.interp(xs, d[od], e[od]))
    dz = np.gradient(z, xs, edge_order=1)
    trap = getattr(np, "trapezoid", None) or getattr(np, "trapz")
    alpha0 = -trap(dz * (np.cos(th) - 1), th) / np.pi
    return float(-2 * np.pi * alpha0 * c)


def _te_dstar(srf):
    d = np.asarray(srf["dstar"], dtype=float)
    d = d[np.isfinite(d)]
    return float(d[-1]) if len(d) else 0.0


def viscous_lift(cl_inv_el, v, el):
    """Element lift with boundary-layer effects (semi-empirical, see module docstring).

    Returns (Cl, Cl before the Kirchhoff factor); their difference sets the lost-suction drag.

    Cl = [Cl_inv - K (dstar_u - dstar_l)_TE - A Cl0_camber (1 - f)] * ((1 + sqrt f) / 2)^2
    * decambering by the trailing-edge displacement thickness (lift slope ~0.105/deg, alpha_0 shift);
    * aft camber loading lost behind a separation (why cambered sections do not reach the Clmax
      the Kirchhoff factor alone predicts: Wadcock's NACA 4412 at Clmax is separated only from ~0.8c);
    * Kirchhoff/Helmholtz factor with f the attached fraction of the suction side.
    """
    bl = v["bl"]
    cl = cl_inv_el - K_DECAMBER * (_te_dstar(bl["upper"]) - _te_dstar(bl["lower"]))
    xs = v["x_sep"]
    if xs is not None:
        xle, chord = float(np.min(el.x)), float(np.max(el.x) - np.min(el.x))
        f = float(np.clip((xs - xle) / max(chord, 1e-9), 0.0, 1.0))
        c0 = camber_cl0(el)
        if c0 * cl_inv_el > 0:  # camber loads the same side as the lift
            cl -= A_CAMBER_LOSS * c0 * (1 - f)
    if cl * cl_inv_el < 0:
        cl = 0.0
    # lost-suction drag reference: only the Kirchhoff part is a separated (dead-air) region; the
    # camber/decambering terms reshape the loading and their drag is already in Squire-Young
    return cl * v["kf"], cl


# Ground-effect force reduction (Zerihan & Zhang 2000): the separated suction-side shear layer
# blocks the gap under the trailing edge and kills the extra circulation the ground induces.
B0_BLOCK, P_BLOCK, ANG_SEP = 0.24, 3.0, 8.0


def ground_blockage(el, v, ground_y):
    """Fraction eta of the ground-induced circulation that survives the gap blockage.

    t = dstar_sep + (1 - f) c tan(8 deg) is the thickness of the dead-air region at the trailing
    edge (separated shear layer leaving roughly along the surface), b = t / gap_TE and
    eta = 1 / (1 + (b / 0.24)^3). Only when the suction side faces the ground (inverted wing).
    Calibrated so a NACA 4412 inverted wing peaks at h/c ~ 0.08-0.12 and loses ~15 % by
    h/c = 0.05 (the measured shape); the 2D peak/free-air ratio stays larger than the 3D one.
    """
    if ground_y is None or v["suction"] != "lower":
        return 1.0
    xle, chord = float(np.min(el.x)), float(np.max(el.x) - np.min(el.x))
    xs = v["x_sep"]
    f = 1.0 if xs is None else float(np.clip((xs - xle) / max(chord, 1e-9), 0.0, 1.0))
    t = _te_dstar(v["bl"]["lower"]) + (1 - f) * chord * np.tan(np.radians(ANG_SEP))
    gap = max(0.5 * (el.y[0] + el.y[-1]) - ground_y, 1e-3)
    return float(1.0 / (1.0 + (t / gap / B0_BLOCK) ** P_BLOCK))


def element_viscous(sol, i, re, tu, gurney=False):
    """Boundary layer on both surfaces of element i and its Kirchhoff lift factor."""
    up, lo, stag = P.split_surfaces(sol, i)
    el = sol.elements[i]
    if gurney and el.name == "main":
        # boundary layer only on the real surfaces (drop the virtual wedge)
        up, lo = _trim(up, 1.0), _trim(lo, 1.0)
    bl = BL.airfoil_bl(up, lo, re, tu)
    suction = "upper" if np.nanmax(up["ue"]) >= np.nanmax(lo["ue"]) else "lower"
    xle, chord = float(np.min(el.x)), float(np.max(el.x) - np.min(el.x))
    kf = BL.kirchhoff_factor(bl[suction]["x_sep"], xle, chord)
    return {"bl": bl, "suction": suction, "stag": stag, "x_sep": bl[suction]["x_sep"], "kf": kf}


def gurney_base_drag(h, cd_friction):
    """Hoerner's 2D base-drag estimate for a blunt step of height h (chord-based)."""
    if h <= 0:
        return 0.0
    return h * 0.135 / max(cd_friction / h, 1e-3) ** (1.0 / 3.0)


def _vii_analyze(spec, els, gy, alpha, re, tu, field):
    """Analysis with viscous-inviscid interaction (transpiration), see vii.py."""
    inv = P.forces(P.PanelSystem(els, gy).solve(alpha))
    sol, bls, vn, hist = VII.solve(els, gy, alpha, re, tu)
    F = P.forces(sol)
    inv0 = P.forces(P.PanelSystem(els, None).solve(alpha)) if gy is not None else None
    out = {"alpha": alpha, "ground_y": gy, "cl_inv": inv["cl"], "cm": F["cm"], "vii": True,
           "vii_iterations": len(hist), "vii_residual": hist[-1] if hist else 0.0,
           "intersect": elements_intersect(els) if len(els) > 1 else False, "elements": []}
    cd_t = 0.0
    for i, el in enumerate(els):
        bl, up, lo, stag = bls[i]
        suction = "upper" if np.nanmax(up["ue"]) >= np.nanmax(lo["ue"]) else "lower"
        fe = F["elements"][i]
        e = {"name": el.name, "x": el.x, "y": el.y, "cp": 1.0 - sol.element_gamma(i) ** 2,
             "cl_inv": inv["elements"][i]["cl"], "cm": fe["cm"], "cl": fe["cl"], "stag": stag, "suction": suction,
             "kirchhoff": 1.0}
        if inv0 is not None:  # same gap-blockage force reduction as the base model
            vv = {"bl": bl, "suction": suction, "x_sep": bl[suction]["x_sep"]}
            eta = ground_blockage(el, vv, gy)
            ci, ci0 = inv["elements"][i]["cl"], inv0["elements"][i]["cl"]
            if abs(ci) > 1e-9:
                e["cl"] = fe["cl"] * (ci0 + (ci - ci0) * eta) / ci
            e["ground_eta"] = eta
        e["bl"] = {k: {kk: bl[k][kk] for kk in ("x", "y", "s", "ue", "theta", "H", "dstar", "delta", "cf",
                                                "state", "x_tr", "x_sep", "x_lsep", "bubble")}
                   for k in ("upper", "lower")}
        # profile drag: Squire-Young + the form drag that the displacement body now produces
        e["cd_f"] = bl["cd_f"]
        e["cd"] = bl["cd"] + max(fe["cd_p"], 0.0)
        e["cd_p"] = e["cd"] - e["cd_f"]
        cd_t += e["cd"]
        out["elements"].append(e)
    out["cl"] = sum(e["cl"] for e in out["elements"])
    out["cd"] = cd_t
    if field:
        xg = np.linspace(field["x0"], field["x1"], int(field.get("nx", 90)))
        yg = np.linspace(field["y0"], field["y1"], int(field.get("ny", 50)))
        u, v = P.velocity_field(sol, xg, yg)
        X, Y = np.meshgrid(xg, yg)
        us, vs = VII.source_velocity(els, gy, vn, X.ravel(), Y.ravel())
        u = u + np.where(np.isnan(u), 0, us.reshape(u.shape))
        v = v + np.where(np.isnan(v), 0, vs.reshape(v.shape))
        out["field"] = {"x": xg, "y": yg, "u": u, "v": v}
    return out


def analyze(spec: dict, alpha: float, re: float = 3e6, tu: float = 0.1,
            ground_h: float | None = None, field: dict | None = None, viscous: bool = True,
            vii: bool = False):
    els = build_elements(spec)
    gy = None if ground_h is None else ground_line(els, ground_h)
    if viscous and vii and not spec.get("gurney"):
        return _vii_analyze(spec, els, gy, alpha, re, tu, field)
    sol = P.PanelSystem(els, gy).solve(alpha)
    F = P.forces(sol)
    F0 = P.forces(P.PanelSystem(els, None).solve(alpha)) if (viscous and gy is not None) else None
    gur = float(spec.get("gurney") or 0.0)
    ta = abs(np.tan(np.radians(alpha)))
    out = {"alpha": alpha, "ground_y": gy, "cl_inv": F["cl"], "cm": F["cm"],
           "intersect": elements_intersect(els) if len(els) > 1 else False, "elements": []}
    cl_t = cd_t = 0.0
    for i, el in enumerate(els):
        cp = 1.0 - sol.element_gamma(i) ** 2
        fe = F["elements"][i]
        e = {"name": el.name, "x": el.x, "y": el.y, "cp": cp, "cl_inv": fe["cl"], "cm": fe["cm"], "cl": fe["cl"]}
        if viscous:
            v = element_viscous(sol, i, re, tu, gur > 0)
            bl = v["bl"]
            e.update(stag=v["stag"], suction=v["suction"], kirchhoff=v["kf"])
            e["bl"] = {k: {kk: bl[k][kk] for kk in ("x", "y", "s", "ue", "theta", "H", "dstar", "delta", "cf",
                                                    "state", "x_tr", "x_sep", "x_lsep", "bubble")}
                       for k in ("upper", "lower")}
            ci = fe["cl"]
            if F0 is not None:
                eta = ground_blockage(el, v, gy)
                ci0 = F0["elements"][i]["cl"]
                ci = ci0 + (ci - ci0) * eta
                e["ground_eta"] = eta
            e["cl"], cl_att = viscous_lift(ci, v, el)
            e["cd_f"] = bl["cd_f"]
            e["cd"] = bl["cd"] + abs(cl_att - e["cl"]) * ta + (gurney_base_drag(gur, bl["cd_f"]) if el.name == "main" else 0.0)
            e["cd_p"] = e["cd"] - e["cd_f"]
            cd_t += e["cd"]
        cl_t += e["cl"]
        out["elements"].append(e)
    out["cl"] = cl_t
    out["cd"] = cd_t
    if field:
        xg = np.linspace(field["x0"], field["x1"], int(field.get("nx", 90)))
        yg = np.linspace(field["y0"], field["y1"], int(field.get("ny", 50)))
        u, v = P.velocity_field(sol, xg, yg)
        out["field"] = {"x": xg, "y": yg, "u": u, "v": v}
    return out


def polar(spec: dict, alphas, re: float = 3e6, tu: float = 0.1, ground_h: float | None = None,
          vii: bool = False):
    """Cl, Cd, Cm vs alpha with a single factorisation of the panel matrix."""
    els = build_elements(spec)
    gy = None if ground_h is None else ground_line(els, ground_h)
    if vii and not spec.get("gurney"):
        res = {k: [] for k in ("alpha", "cl_inv", "cl", "cd", "cm", "x_tr", "x_sep", "cd_f")}
        sysm = P.PanelSystem(els, gy)
        vn = None
        for a in alphas:
            a = float(a)
            inv = P.forces(sysm.solve(a))
            sol, bls, vn, hist = VII.solve(els, gy, a, re, tu, iters=16, vn0=vn)
            F = P.forces(sol)
            bl, up, lo, stag = bls[0]
            suction = "upper" if np.nanmax(up["ue"]) >= np.nanmax(lo["ue"]) else "lower"
            cd = sum(b[0]["cd"] for b in bls) + max(F["cd_p"], 0.0)
            for k, val in (("alpha", a), ("cl_inv", inv["cl"]), ("cl", F["cl"]), ("cd", cd), ("cm", F["cm"]),
                           ("cd_f", sum(b[0]["cd_f"] for b in bls)), ("x_tr", bl[suction]["x_tr"]),
                           ("x_sep", bl[suction]["x_sep"])):
                res[k].append(val)
        return res
    sysm = P.PanelSystem(els, gy)
    sys0 = P.PanelSystem(els, None) if gy is not None else None
    gur = float(spec.get("gurney") or 0.0)
    res = {k: [] for k in ("alpha", "cl_inv", "cl", "cd", "cm", "x_tr", "x_sep", "cd_f")}
    for a in alphas:
        a = float(a)
        sol = sysm.solve(a)
        F = P.forces(sol)
        F0 = P.forces(sys0.solve(a)) if sys0 is not None else None
        ta = abs(np.tan(np.radians(a)))
        cl = cd = cdf = 0.0
        xsep = xtr = None
        for i, el in enumerate(els):
            v = element_viscous(sol, i, re, tu, gur > 0)
            ci = F["elements"][i]["cl"]
            if F0 is not None:
                ci0 = F0["elements"][i]["cl"]
                ci = ci0 + (ci - ci0) * ground_blockage(el, v, gy)
            cv, cv_att = viscous_lift(ci, v, el)
            cl += cv
            cdf += v["bl"]["cd_f"]
            cd += v["bl"]["cd"] + abs(cv_att - cv) * ta
            if el.name == "main":
                cd += gurney_base_drag(gur, v["bl"]["cd_f"])
                xsep = v["x_sep"]
                xtr = v["bl"][v["suction"]]["x_tr"]
        for k, val in (("alpha", a), ("cl_inv", F["cl"]), ("cl", cl), ("cd", cd), ("cm", F["cm"]),
                       ("cd_f", cdf), ("x_tr", xtr), ("x_sep", xsep)):
            res[k].append(val)
    return res


def thin_airfoil(code: str):
    """Thin-airfoil theory: alpha_L0 and Cm_c/4 from the mean line (numerical Glauert integrals)."""
    xc, yc = N.camber_line(code, 2001)
    th = np.arccos(1 - 2 * xc)
    dz = np.nan_to_num(np.gradient(yc, xc))
    trap = getattr(np, "trapezoid", None) or getattr(np, "trapz")
    aL0 = -1 / np.pi * trap(dz * (np.cos(th) - 1), th)
    A1 = 2 / np.pi * trap(dz * np.cos(th), th)
    A2 = 2 / np.pi * trap(dz * np.cos(2 * th), th)
    return {"alpha_L0_deg": float(np.degrees(aL0)), "cm_c4": float(np.pi / 4 * (A2 - A1)),
            "lift_slope_per_rad": 2 * np.pi}
