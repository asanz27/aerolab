"""Light compressibility: similarity rules, critical Mach number and "is F1 incompressible?".

* Prandtl-Glauert: Cp = Cp0 / beta, beta = sqrt(1 - M^2)
* Karman-Tsien:    Cp = Cp0 / (beta + M^2 / (1 + beta) * Cp0 / 2)
* Critical pressure coefficient (local sonic): Cp* = 2/(g M^2) [ ((2 + (g-1) M^2)/(g+1))^(g/(g-1)) - 1 ]
* M_crit: free-stream Mach at which the corrected Cp_min equals Cp*.
* Local Mach in a region of pressure coefficient Cp (isentropic): from p/p0.

Refs: Anderson, Modern Compressible Flow, ch. 9 & 11.
"""
from __future__ import annotations

import numpy as np

from . import airfoil

G = 1.4
A_SOUND = 340.3


def cp_star(M, g=G):
    M = np.asarray(M, dtype=float)
    return 2 / (g * M**2) * (((2 + (g - 1) * M**2) / (g + 1)) ** (g / (g - 1)) - 1)


def pg(cp0, M):
    return cp0 / np.sqrt(1 - np.asarray(M) ** 2)


def kt(cp0, M):
    M = np.asarray(M, dtype=float)
    b = np.sqrt(1 - M**2)
    return cp0 / (b + M**2 / (1 + b) * cp0 / 2)


def critical_mach(cp0_min, rule="kt"):
    Ms = np.linspace(0.05, 0.95, 1801)
    cpc = (kt if rule == "kt" else pg)(cp0_min, Ms)
    diff = cpc - cp_star(Ms)
    k = np.where(diff < 0)[0]
    return float(Ms[k[0]]) if len(k) else None


def local_mach(cp, M_inf, g=G):
    """Isentropic local Mach where the (compressible) pressure coefficient is cp."""
    p_inf_p0 = (1 + 0.5 * (g - 1) * M_inf**2) ** (-g / (g - 1))
    p_p0 = p_inf_p0 * (1 + 0.5 * g * M_inf**2 * cp)
    p_p0 = np.clip(p_p0, 1e-6, 1.0)
    return np.sqrt(2 / (g - 1) * (p_p0 ** (-(g - 1) / g) - 1))


def section_study(code="2412", alpha=4.0):
    """Cp_min of a section (panel method), corrected with PG and KT, and its M_crit."""
    r = airfoil.analyze({"code": code}, alpha, viscous=False)
    cp0 = float(np.min(r["elements"][0]["cp"]))
    Ms = np.linspace(0.05, 0.9, 120)
    return {"cp0_min": cp0, "M": Ms, "cp_star": cp_star(Ms), "cp_pg": pg(cp0, Ms), "cp_kt": kt(cp0, Ms),
            "M_crit_kt": critical_mach(cp0, "kt"), "M_crit_pg": critical_mach(cp0, "pg")}


def f1_check(V=90.0, cp_floor=-4.0, cp_wing=-6.0):
    """How compressible is an F1 car? Free-stream and local Mach numbers, density change."""
    M = V / A_SOUND
    rho_ratio = (1 + 0.2 * M**2) ** -2.5  # static/stagnation density
    out = {"M_inf": M, "density_change_pct": float((1 - rho_ratio) * 100),
           "M_floor": float(local_mach(cp_floor, M)), "M_wing": float(local_mach(cp_wing, M)),
           "pg_factor": float(1 / np.sqrt(1 - M**2))}
    Vs = np.linspace(20, 100, 41)
    out["V"] = Vs
    out["M_floor_curve"] = [float(local_mach(cp_floor, v / A_SOUND)) for v in Vs]
    out["M_wing_curve"] = [float(local_mach(cp_wing, v / A_SOUND)) for v in Vs]
    out["pg_error_pct"] = [float((1 / np.sqrt(1 - (v / A_SOUND) ** 2) - 1) * 100) for v in Vs]
    return out
