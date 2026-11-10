"""Validation cases shared by pytest (tests/) and the in-browser test page (tests.html).

Each check compares a solver against an analytical solution or a classic tabulated
result and returns (name, value, reference, tolerance, passed).
"""
from __future__ import annotations

import numpy as np

from . import airfoil, boundary_layer as BL, lifting_line as LL, naca, nozzle, panel as P, potential, unsteady, vlm, vortex

CHECKS = []


def check(name, ref, tol, rel=True):
    def deco(fn):
        CHECKS.append((name, fn, ref, tol, rel))
        return fn
    return deco


@check("Panel: cylinder Cp = 1 - 4 sin^2(theta), max error", 0.0, 1e-3, rel=False)
def _cyl():
    x, y = naca.ellipse(1.0, 200)
    sol = P.PanelSystem([P.Element(x, y)]).solve(0.0)
    d = P.surface(sol, 0)
    th = np.arctan2(d["y"], d["x"] - 0.5)
    return float(np.max(np.abs(d["cp"] - (1 - 4 * np.sin(th) ** 2))))


@check("Panel: NACA 0012 lift slope dCl/dalpha [1/rad] (thin airfoil 2pi, thickness adds ~10%)", 2 * np.pi * 1.09, 0.03)
def _slope():
    x, y = naca.naca("0012", 160)
    s = P.PanelSystem([P.Element(x, y)])
    return (P.forces(s.solve(2))["cl"] - P.forces(s.solve(-2))["cl"]) / np.radians(4)


@check("Panel: pressure-integrated Cl equals Kutta-Joukowski Cl (NACA 2412, 6 deg)", 0.0, 2e-3, rel=False)
def _kj():
    x, y = naca.naca("2412", 160)
    f = P.forces(P.PanelSystem([P.Element(x, y)]).solve(6))
    return abs(f["cl"] - f["cl_kj"])


@check("Thin airfoil: NACA 2412 alpha_L0 [deg]", -2.08, 0.03)
def _al0():
    return airfoil.thin_airfoil("2412")["alpha_L0_deg"]


@check("Joukowski: panel Cl vs exact conformal-map Cl", 0.0, 0.02, rel=False)
def _jouk():
    J = potential.Joukowski(0.08, 0.06, 5.0)
    s = J.surface()
    x, y = s["x"][::-1], s["y"][::-1]  # make clockwise from TE
    k = int(np.argmax(x))
    x = np.roll(x, -k)
    y = np.roll(y, -k)
    x = np.append(x, x[0])
    y = np.append(y, y[0])
    if np.sum((x[1:] - x[:-1]) * (y[1:] + y[:-1])) < 0:
        x, y = x[::-1], y[::-1]
    idx = np.linspace(0, len(x) - 1, 201).astype(int)
    el = P.Element(x[idx], y[idx])
    f = P.forces(P.PanelSystem([el]).solve(5.0), c_ref=J.chord)
    return abs(f["cl"] - J.coefficients()["cl"]) / J.coefficients()["cl"]


@check("Blasius: theta at Re_x = 1e5 (0.664 x / sqrt(Re_x))", 0.664 * 0.5 / np.sqrt(1e5), 0.03)
def _blasius():
    x = np.linspace(0, 1, 801)
    r = BL.march(x, np.ones_like(x), 1 / 2e5, 0.01, "michel")
    return float(np.interp(0.5, x, r["theta"]))


@check("Falkner-Skan: Blasius f''(0) = 0.4696", 0.4696, 0.002)
def _fs():
    return float(BL.falkner_skan([0.0])["fpp0"][0])


@check("Thwaites: Howarth decelerating flow separates at x/L = 0.120", 0.1199, 0.05)
def _howarth():
    x = np.linspace(0, 0.3, 1201)
    r = BL.march(x, 1 - x, 1e-6, 0.01)
    return r["lam_sep"]


@check("Lifting line: elliptic wing e = 1", 1.0, 1e-3)
def _ell():
    return LL.solve(8.0, "elliptic", alpha_deg=5)["e"]


@check("Lifting line: elliptic CL = a0 alpha / (1 + 2/AR)", 2 * np.pi / (1 + 2 / 8) * np.radians(5), 1e-3)
def _ellcl():
    return LL.solve(8.0, "elliptic", alpha_deg=5)["CL"]


@check("VLM: rectangular AR 8 CL vs lifting line (within 7 %: LL ignores chordwise loading)", 0.0, 0.07, rel=False)
def _vlm():
    a = vlm.solve(vlm.wing_surfaces(8.0, ns=32), 5.0)["CL"]
    b = LL.solve(8.0, "rect", alpha_deg=5)["CL"]
    return abs(a - b) / b


@check("VLM: planar rectangular AR 3 span efficiency e <= 1 (Munk), ~0.98", 0.985, 0.015, rel=False)
def _vlm_e():
    return vlm.solve(vlm.wing_surfaces(3.0, ns=20, nc=4), 5.0)["e"]


@check("Ground effect: inverted NACA 4412 downforce peaks at h/c ~ 0.08-0.12 (Zerihan & Zhang)", 0.10, 0.03, rel=False)
def _ground_peak():
    hs = [0.3, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05]
    cl = [-airfoil.analyze({"code": "4412", "invert": True, "n": 120}, -4.0, 3e6, ground_h=h)["cl"] for h in hs]
    return hs[int(np.argmax(cl))]


@check("Viscous NACA 4412 Re 3e6: Clmax ~ 1.65 (Abbott & von Doenhoff)", 1.65, 0.06)
def _clmax_4412():
    return max(airfoil.polar({"code": "4412"}, np.arange(10, 21, 1.0), 3e6)["cl"])


@check("Isentropic: A/A* at M = 2 (gamma 1.4) = 1.6875", 1.6875, 1e-4)
def _am():
    return float(nozzle.area_ratio(2.0))


@check("Normal shock M1 = 2: p02/p01 = 0.7209", 0.7209, 1e-3)
def _ns():
    return float(nozzle.normal_shock(2.0)["p02_p01"])


@check("Lamb-Oseen core pressure = -rho ln2 (Gamma/2 pi a)^2", 1.0, 1e-3)
def _lo():
    p = vortex.profiles(1.0, 0.1)
    return float(p["lamb_oseen"]["p"][0] / p["core_pressure_lamb_oseen"])


@check("Viscous NACA 0012 Re 3e6: Clmax ~ 1.55 (wind tunnel 1.5-1.6)", 1.55, 0.06)
def _clmax():
    r = airfoil.polar({"code": "0012"}, np.arange(10, 21, 1.0), 3e6)
    return max(r["cl"])


@check("Viscous NACA 0012 Re 3e6: Cd0 ~ 0.006 (Abbott & von Doenhoff ~0.0058)", 0.006, 0.15)
def _cd0():
    return airfoil.polar({"code": "0012"}, [0.0], 3e6)["cd"][0]


@check("Unsteady panel + free wake: Cl/Cl_steady at s = 8 vs Wagner (0.855)", 0.855, 0.05)
def _wagner_panel():
    r = unsteady.simulate(motion="step", alpha0=5, t_end=5, dt=0.05)
    i = int(np.argmin(np.abs(r["s"] - 8)))
    return r["cl"][i] / r["cl_steady"]


@check("Theodorsen C(k=0.3) real part = 0.665", 0.665, 0.005)
def _theod():
    return float(unsteady.theodorsen([0.3])[0].real)


@check("VII: NACA 0012 Re 3e6, Cl at 4 deg ~ 0.44 (published ~0.44)", 0.44, 0.08)
def _vii4():
    return airfoil.analyze({"code": "0012", "n": 120}, 4.0, 3e6, vii=True)["cl"]


def run_all():
    out = []
    for name, fn, ref, tol, rel in CHECKS:
        try:
            v = float(fn())
            err = abs(v - ref) / abs(ref) if rel and ref != 0 else abs(v - ref)
            out.append({"name": name, "value": v, "ref": ref, "tol": tol, "pass": bool(err <= tol)})
        except Exception as exc:  # pragma: no cover
            out.append({"name": name, "value": None, "ref": ref, "tol": tol, "pass": False, "error": str(exc)})
    return {"checks": out, "passed": sum(c["pass"] for c in out), "total": len(out)}
