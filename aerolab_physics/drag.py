"""Drag build-up: skin friction, pressure (form) drag and lift-induced drag.

Two-dimensional sections (chord-based coefficients, per unit span):
* streamlined family (t/c <= 0.35): Hoerner's build-up with the form-factor convention
      Cd = 2 Cf FF,  FF = 1 + 2 (t/c) + 60 (t/c)^4
  friction part 2 Cf (both sides of a flat plate), pressure (form) part 2 Cf (FF - 1).
  This gives ~11/20/29/40 % pressure drag for t/c = 6/12/18/24 %, as XFOIL-type analyses
  and wake surveys show for NACA 00xx sections at Re ~ 3e6 (form drag = the extra momentum
  loss caused by the thickness: supervelocities and the adverse gradient at the rear);
* bluff end (circular cylinder, t/c = 1): measured Cd(Re) incl. the drag crisis,
  friction share from laminar boundary-layer theory (~ 2.9/sqrt(Re), Schlichting);
* intermediate thicknesses: log-interpolation between the two.
* flat plate normal to the flow: Cd ~ 2.0, all pressure.
Lift-induced: CDi = CL^2 / (pi e AR) (3D wing of the given section).

Refs: Hoerner, *Fluid-Dynamic Drag* (1965) ch. 6; Schlichting & Gersten (2017); Achenbach (1968).
"""
from __future__ import annotations

import numpy as np

from .boundary_layer import flat_plate_CF

_CYL_RE = np.array([1e3, 1e4, 5e4, 1e5, 2e5, 3e5, 4e5, 5e5, 1e6, 3e6, 1e7])
_CYL_CD = np.array([1.00, 1.15, 1.20, 1.20, 1.18, 0.95, 0.40, 0.28, 0.33, 0.60, 0.70])


def cylinder_cd(re):
    return float(np.exp(np.interp(np.log10(re), np.log10(_CYL_RE), np.log(_CYL_CD))))


def section(tc: float, re: float):
    """Friction / pressure split of a 2D section of thickness ratio tc (0 = flat plate)."""
    cf = float(flat_plate_CF(re))
    def hoerner(t):
        return 2 * cf, 2 * cf * (2 * t + 60 * t**4)
    t_lim = 0.35
    if tc <= t_lim:
        f, p = hoerner(tc)
    else:
        f_l, p_l = hoerner(t_lim)
        cd_l = f_l + p_l
        cd_c = cylinder_cd(re)
        f_c = min(2.9 / np.sqrt(re), 0.05 * cd_c)
        w = (tc - t_lim) / (1 - t_lim)
        cd = float(np.exp((1 - w) * np.log(cd_l) + w * np.log(cd_c)))
        f = (1 - w) * f_l + w * f_c  # friction varies little; the form drag takes the rest
        p = cd - f
    return {"cd_friction": f, "cd_pressure": p, "cd": f + p, "cf_plate": cf}


def buildup(tc=0.12, re=3e6, cl=0.0, AR=8.0, e=0.95, shape="section"):
    if shape == "plate_normal":
        sec = {"cd_friction": 0.0, "cd_pressure": 1.98, "cd": 1.98}
    elif shape == "cylinder":
        sec = section(1.0, re)
    else:
        sec = section(tc, re)
    cdi = cl**2 / (np.pi * e * AR) if AR > 0 else 0.0
    return {**sec, "cd_induced": float(cdi), "total": float(sec["cd"] + cdi)}


def sweep_tc(re=3e6, n=60):
    tcs = np.linspace(0.0, 1.0, n)
    out = {"tc": tcs, "friction": [], "pressure": []}
    for t in tcs:
        s = section(t, re)
        out["friction"].append(s["cd_friction"])
        out["pressure"].append(s["cd_pressure"])
    return out


def sweep_re_cylinder(n=80):
    re = np.logspace(3, 7, n)
    return {"re": re, "cd": np.array([cylinder_cd(r) for r in re])}
