"""Integral boundary-layer methods and canonical velocity profiles.

* Laminar: Thwaites' method with Cebeci-Bradshaw closure for H(lambda), l(lambda).
* Transition: Abu-Ghannam & Shaw (1980) onset correlation (free-stream turbulence
  and pressure gradient) or Michel's criterion. Laminar separation (lambda < -0.09)
  forces transition through a laminar separation bubble.
* Turbulent: Head's entrainment method with the Ludwieg-Tillmann skin friction law;
  separation when the shape factor H exceeds 2.4.
* Profile drag: Squire-Young formula at the trailing edge.
* Profiles: Falkner-Skan similarity solutions (own shooting solver), turbulent
  composite profile (Spalding's law of the wall + Coles' wake).

These are the same building blocks as in XFOIL-class tools but without viscous-
inviscid interaction, so results are estimates, best before separation.

Refs: Thwaites (1949); Cebeci & Bradshaw, *Momentum Transfer in Boundary Layers* (1977);
Head (1958); White, *Viscous Fluid Flow* (2006) ch. 4 & 6; Schlichting & Gersten (2017).
"""
from __future__ import annotations

import numpy as np

_trapz = getattr(np, "trapezoid", None) or getattr(np, "trapz")

KAPPA = 0.41
B_LOG = 5.0
H_SEP_TURB = 2.0  # within the 1.8-2.4 range quoted for Head; calibrated on NACA 0012 Clmax
LAMBDA_SEP = -0.09


# ---------------------------------------------------------------- laminar closures
def thwaites_closure(lam):
    lam = np.clip(lam, -0.0899, 0.25)
    pos = lam >= 0
    l = np.where(pos, 0.22 + 1.57 * lam - 1.8 * lam**2, 0.22 + 1.402 * lam + 0.018 * lam / (lam + 0.107))
    H = np.where(pos, 2.61 - 3.75 * lam + 5.24 * lam**2, 2.088 + 0.0731 / (lam + 0.14))
    return H, l


def ags_onset(tu_percent: float, lam_theta: float) -> float:
    """Abu-Ghannam & Shaw momentum-thickness Reynolds number at transition onset."""
    tu = max(tu_percent, 0.02)
    l = float(np.clip(lam_theta, -0.1, 0.1))
    F = 6.91 + 12.75 * l + 63.64 * l**2 if l <= 0 else 6.91 + 2.48 * l - 12.27 * l**2
    return 163.0 + np.exp(F - F * tu / 6.91)


def michel_onset(re_x: float) -> float:
    return 1.174 * (1 + 22400.0 / max(re_x, 1.0)) * max(re_x, 1.0) ** 0.46


# ---------------------------------------------------------------- Head closures
def head_H1(H):
    H = np.maximum(H, 1.11)
    return np.where(H <= 1.6, 3.3 + 0.8234 * (H - 1.1) ** -1.287, 3.3 + 1.5501 * (H - 0.6778) ** -3.064)


def head_H_from_H1(H1):
    H1 = np.maximum(H1, 3.32)
    return np.where(H1 >= 5.3, 1.1 + ((H1 - 3.3) / 0.8234) ** (-1 / 1.287), 0.6778 + ((H1 - 3.3) / 1.5501) ** (-1 / 3.064))


def head_F(H1):
    return 0.0306 * np.maximum(H1 - 3.0, 1e-6) ** -0.6169


def ludwieg_tillmann(H, re_theta):
    return 0.246 * 10 ** (-0.678 * H) * np.maximum(re_theta, 10.0) ** -0.268


def _head_rhs(u, du, th, H1, nu, boost=0.0):
    """Head's equations, scalar version (math module for speed)."""
    H1 = max(H1, 3.32)
    if H1 >= 5.3:
        Hh = 1.1 + ((H1 - 3.3) / 0.8234) ** (-1 / 1.287)
    else:
        Hh = 0.6778 + ((H1 - 3.3) / 1.5501) ** (-1 / 3.064)
    rt = max(u * th / nu, 10.0)
    cf = 0.246 * 10 ** (-0.678 * Hh) * rt ** -0.268
    dth = 0.5 * cf - (Hh + 2.0) * th / u * du
    # entrainment, optionally augmented by streamwise vortices (VGs, floor-edge vortices)
    F = 0.0306 * max(H1 - 3.0, 1e-6) ** -0.6169 * (1.0 + boost)
    dH1 = (u * F - H1 * (th * du + u * dth)) / (u * th)
    return dth, dH1


# ---------------------------------------------------------------- marching solver
def march(s, ue, nu, tu_percent=0.1, criterion="ags", force_transition_s=None, n_sub=4, boost=None):
    """March the boundary layer along one surface.

    Parameters
    ----------
    s, ue : arc length from the stagnation point (s[0]=0) and edge speed (ue[0] may be 0)
    nu : kinematic viscosity (consistent units: if ue ~ 1 and s ~ chord, nu = 1/Re)
    tu_percent : free-stream turbulence intensity in %
    criterion : "ags" (Abu-Ghannam & Shaw) or "michel"
    force_transition_s : optional trip location (arc length)

    Returns a dict of arrays on the input stations plus event locations.
    """
    s = np.asarray(s, dtype=float)
    ue = np.maximum(np.asarray(ue, dtype=float), 1e-9)
    n = len(s)
    due = np.gradient(ue, s, edge_order=1)

    theta = np.full(n, np.nan)
    H = np.full(n, np.nan)
    cf = np.full(n, np.nan)
    state = np.zeros(n, dtype=int)  # 0 laminar, 1 turbulent, 2 separated
    events = {"transition": None, "lam_sep": None, "bubble": False, "turb_sep": None}

    # --- laminar (Thwaites). Stagnation start: theta^2 = 0.075 nu / (due/ds)
    I = np.concatenate([[0.0], np.cumsum(0.5 * (ue[1:] ** 5 + ue[:-1] ** 5) * np.diff(s))])
    th2 = np.empty(n)
    th2[1:] = 0.45 * nu * I[1:] / ue[1:] ** 6
    th2[0] = 0.075 * nu / max(due[0], 1e-6) if ue[0] < 1e-3 else th2[1]
    i_tr = None
    for i in range(n):
        th = np.sqrt(max(th2[i], 1e-30))
        lam = th2[i] * due[i] / nu
        h, l = thwaites_closure(lam)
        theta[i], H[i] = th, float(h)
        cf[i] = 2 * nu * float(l) / (ue[i] * th) if ue[i] > 1e-6 else np.nan
        re_th = ue[i] * th / nu
        re_x = ue[i] * s[i] / nu
        if i == 0:
            continue
        tripped = force_transition_s is not None and s[i] >= force_transition_s
        onset = ags_onset(tu_percent, lam) if criterion == "ags" else michel_onset(re_x)
        if lam < LAMBDA_SEP and s[i] > 0.002 * s[-1]:
            events["lam_sep"] = float(s[i])
            # Laminar separation: the free shear layer transitions and (if Re allows)
            # reattaches turbulent -> laminar separation bubble. Below Re_theta ~ 50
            # the shear layer does not reattach (laminar stall).
            if re_th > 50:
                events["bubble"] = True
                events["transition"] = float(s[i])
                i_tr = i
            else:
                state[i:] = 2
                events["turb_sep"] = float(s[i])
                i_tr = None
                return _pack(s, ue, theta, H, cf, state, events)
            break
        if re_th > onset or tripped:
            events["transition"] = float(s[i])
            i_tr = i
            break

    if i_tr is None:
        return _pack(s, ue, theta, H, cf, state, events)

    # --- turbulent (Head), RK2 with sub-stepping on interpolated ue
    th = theta[i_tr]
    Hc = 1.4 if not events["bubble"] else 1.6
    H1 = float(head_H1(Hc))
    state[i_tr:] = 1
    for i in range(i_tr, n - 1):
        s0, s1 = s[i], s[i + 1]
        hs = (s1 - s0) / n_sub
        u0, u1 = ue[i], ue[i + 1]
        du0, du1 = due[i], due[i + 1]
        for k in range(n_sub):
            f0, f1 = k / n_sub, (k + 1) / n_sub
            b = 0.0 if boost is None else float(boost[i])
            k1 = _head_rhs(u0 + f0 * (u1 - u0), du0 + f0 * (du1 - du0), th, H1, nu, b)
            k2 = _head_rhs(u0 + f1 * (u1 - u0), du0 + f1 * (du1 - du0), th + hs * k1[0], H1 + hs * k1[1], nu, b)
            th = max(th + 0.5 * hs * (k1[0] + k2[0]), 1e-12)
            H1 = max(H1 + 0.5 * hs * (k1[1] + k2[1]), 3.32)
        Hh = float(head_H_from_H1(H1))
        theta[i + 1], H[i + 1] = th, Hh
        cf[i + 1] = float(ludwieg_tillmann(Hh, ue[i + 1] * th / nu))
        if Hh >= H_SEP_TURB:
            events["turb_sep"] = float(s[i + 1])
            state[i + 1 :] = 2
            theta[i + 2 :] = np.nan
            H[i + 2 :] = np.nan
            cf[i + 1 :] = 0.0
            break
    cf[i_tr] = float(ludwieg_tillmann(Hc, ue[i_tr] * theta[i_tr] / nu))
    return _pack(s, ue, theta, H, cf, state, events)


def _pack(s, ue, theta, H, cf, state, events):
    dstar = theta * H
    turb = state == 1
    delta = np.where(turb, theta * (head_H1(np.nan_to_num(H, nan=1.4)) + H), 7.4 * theta)
    return {"s": s, "ue": ue, "theta": theta, "H": H, "dstar": dstar, "delta": delta,
            "cf": cf, "state": state, **events}


def squire_young(theta_te, H_te, ue_te):
    """Profile drag coefficient contribution of one surface (chord-based)."""
    if not np.isfinite(theta_te):
        return np.nan
    H_te = min(H_te, 2.5)
    return 2.0 * theta_te * max(ue_te, 1e-6) ** ((H_te + 5.0) / 2.0)


def last_valid(arr):
    a = np.asarray(arr, dtype=float)
    ok = np.where(np.isfinite(a))[0]
    return a[ok[-1]] if len(ok) else np.nan


def te_regularise(s, ue, x, frac=0.015):
    """Replace the inviscid trailing-edge stagnation singularity by a linear extrapolation.

    A finite-angle trailing edge is a stagnation point in potential flow; a real
    boundary layer and wake displace it, so the last ``frac`` of chord is extrapolated
    from upstream (the same reason XFOIL couples the wake displacement thickness).
    """
    ue = np.array(ue, dtype=float)
    x = np.asarray(x)
    xte = x[-1]
    chord = max(np.max(x) - np.min(x), 1e-9)
    bad = np.where(np.abs(xte - x) < frac * chord)[0]
    bad = bad[bad > 2]
    if len(bad) == 0:
        return ue
    i0 = bad[0]
    i1, i2 = i0 - 2, i0 - 1
    slope = (ue[i2] - ue[i1]) / max(s[i2] - s[i1], 1e-12)
    ue[i0:] = np.maximum(ue[i2] + slope * (np.asarray(s)[i0:] - s[i2]), 0.05)
    return ue


def airfoil_bl(upper, lower, re, tu_percent=0.1, criterion="ags", trip=None):
    """Run the boundary layer on both surfaces of a panel solution.

    ``upper``/``lower`` come from :func:`panel.split_surfaces`. Returns per-surface
    results, Squire-Young profile drag, friction drag and separation fractions.
    """
    nu = 1.0 / re
    res = {}
    cd = 0.0
    cdf = 0.0
    for name, srf in (("upper", upper), ("lower", lower)):
        srf = dict(srf)
        srf["ue"] = te_regularise(srf["s"], srf["ue"], srf["x"])
        r = march(srf["s"], srf["ue"], nu, tu_percent, criterion,
                  None if trip is None else trip)
        r["x"] = srf["x"]
        r["y"] = srf["y"]
        # skin-friction drag: integrate cf * ue^2 projected on the chord direction
        dx = np.diff(srf["x"])
        cfm = 0.5 * np.nan_to_num(r["cf"][1:] * r["ue"][1:] ** 2 + r["cf"][:-1] * r["ue"][:-1] ** 2)
        cdf += float(np.sum(cfm * np.abs(dx)))
        th_te = last_valid(r["theta"])
        h_te = last_valid(r["H"])
        k = np.where(np.isfinite(r["theta"]))[0][-1]
        cd += squire_young(th_te, h_te, srf["ue"][k] if r["turb_sep"] is None else srf["ue"][-1])
        x_sep = None
        if r["turb_sep"] is not None:
            x_sep = float(np.interp(r["turb_sep"], srf["s"], srf["x"]))
        r["x_sep"] = x_sep
        r["x_tr"] = None if r["transition"] is None else float(np.interp(r["transition"], srf["s"], srf["x"]))
        r["x_lsep"] = None if r["lam_sep"] is None else float(np.interp(r["lam_sep"], srf["s"], srf["x"]))
        res[name] = r
    res["cd"] = cd
    res["cd_f"] = cdf
    return res


def kirchhoff_factor(x_sep, x_le=0.0, chord=1.0):
    """Kirchhoff/Helmholtz flat-plate lift reduction for trailing-edge separation.

    f = attached fraction of chord; Cl = Cl_attached * ((1 + sqrt f)/2)^2.
    Used by Beddoes-Leishman type models. Ref: Thwaites, *Incompressible Aerodynamics* (1960).
    """
    if x_sep is None:
        return 1.0
    f = float(np.clip((x_sep - x_le) / chord, 0.0, 1.0))
    return ((1 + np.sqrt(f)) / 2) ** 2


# ---------------------------------------------------------------- similarity profiles
_FS_CACHE: dict = {}


def falkner_skan(betas, eta_max=8.0, n=400):
    """Falkner-Skan solutions f''' + f f'' + beta (1 - f'^2) = 0, f(0)=f'(0)=0, f'(inf)=1.

    Vectorised shooting over all betas at once (bisection on f''(0), attached branch).
    Returns eta, f'(eta) per beta, f''(0), H.
    """
    betas = np.atleast_1d(np.asarray(betas, dtype=float))
    key = (tuple(np.round(betas, 6)), eta_max, n)
    if key in _FS_CACHE:
        return _FS_CACHE[key]
    h = eta_max / n
    # bracket f''(0) around tabulated values (Cebeci & Bradshaw) so bisection stays on
    # the attached branch for every beta
    tb = np.array([-0.19884, -0.18, -0.1, 0.0, 0.1, 0.3, 0.5, 1.0, 2.0])
    tf = np.array([0.0, 0.12864, 0.31927, 0.46960, 0.58700, 0.77476, 0.92768, 1.23259, 1.68722])
    guess = np.interp(betas, tb, tf)
    lo = np.maximum(guess - 0.08, 0.0)
    hi = guess + 0.08

    def integrate(fpp0, keep=False):
        f = np.zeros_like(betas)
        fp = np.zeros_like(betas)
        fpp = fpp0.copy()
        hist = [fp.copy()] if keep else None
        fpmax = fp.copy()

        def d(f, fp, fpp):
            return fp, fpp, -f * fpp - betas * (1 - fp**2)

        for _ in range(n):
            a1 = d(f, fp, fpp)
            a2 = d(f + 0.5 * h * a1[0], fp + 0.5 * h * a1[1], fpp + 0.5 * h * a1[2])
            a3 = d(f + 0.5 * h * a2[0], fp + 0.5 * h * a2[1], fpp + 0.5 * h * a2[2])
            a4 = d(f + h * a3[0], fp + h * a3[1], fpp + h * a3[2])
            f = f + h / 6 * (a1[0] + 2 * a2[0] + 2 * a3[0] + a4[0])
            fp = fp + h / 6 * (a1[1] + 2 * a2[1] + 2 * a3[1] + a4[1])
            fpp = fpp + h / 6 * (a1[2] + 2 * a2[2] + 2 * a3[2] + a4[2])
            fp = np.clip(fp, -5, 5)
            fpp = np.clip(fpp, -50, 50)
            fpmax = np.maximum(fpmax, fp)
            if keep:
                hist.append(fp.copy())
        return fpmax, hist

    for _ in range(45):
        mid = 0.5 * (lo + hi)
        fp_end, _ = integrate(mid)
        too_big = fp_end > 1.0  # the correct solution approaches 1 monotonically from below
        hi = np.where(too_big, mid, hi)
        lo = np.where(too_big, lo, mid)
    fpp0 = 0.5 * (lo + hi)
    _, hist = integrate(fpp0, keep=True)
    eta = np.linspace(0, eta_max, n + 1)
    U = np.clip(np.array(hist), 0, 1.0)  # (n+1, nb)
    dstar = _trapz(1 - U, eta, axis=0)
    theta = _trapz(U * (1 - U), eta, axis=0)
    out = {"eta": eta, "fp": U.T, "fpp0": fpp0, "H": dstar / theta, "dstar": dstar, "theta": theta}
    _FS_CACHE[key] = out
    return out


def spalding_yplus(uplus):
    """Spalding's (1961) single-formula law of the wall: y+ as a function of u+."""
    ku = KAPPA * uplus
    return uplus + np.exp(-KAPPA * B_LOG) * (np.exp(ku) - 1 - ku - ku**2 / 2 - ku**3 / 6)


def law_of_wall(yplus):
    """u+(y+) inverting Spalding's law by Newton iterations."""
    yplus = np.asarray(yplus, dtype=float)
    u = np.minimum(yplus, np.log(np.maximum(yplus, 1e-9)) / KAPPA + B_LOG)
    u = np.maximum(u, 0.0)
    for _ in range(40):
        ku = KAPPA * u
        f = spalding_yplus(u) - yplus
        df = 1 + np.exp(-KAPPA * B_LOG) * KAPPA * (np.exp(ku) - 1 - ku - ku**2 / 2)
        u = u - f / df
    return u


def turbulent_profile(re_tau: float, wake_pi: float = 0.55, n: int = 200):
    """Composite profile u/U(y/delta): Spalding inner law + Coles wake law."""
    eta = np.linspace(0, 1, n)
    yplus = eta * re_tau
    uplus = law_of_wall(yplus) + 2 * wake_pi / KAPPA * np.sin(np.pi * eta / 2) ** 2
    U = uplus / uplus[-1]
    dstar = _trapz(1 - U, eta)
    theta = _trapz(U * (1 - U), eta)
    return {"eta": eta, "u": U, "H": dstar / theta, "uplus": uplus, "yplus": yplus,
            "cf": 2.0 / uplus[-1] ** 2}


def turbulent_profile_for_H(H_target: float, re_tau: float = 2000.0):
    """Choose Coles' wake parameter so the composite profile has the requested H."""
    pis = np.linspace(-0.4, 6.0, 120)
    Hs = np.array([turbulent_profile(re_tau, p, 120)["H"] for p in pis])
    p = float(np.interp(H_target, Hs, pis)) if np.all(np.diff(Hs) > 0) else pis[np.argmin(np.abs(Hs - H_target))]
    return turbulent_profile(re_tau, p)


def flat_plate_cf(re_x):
    """Local skin friction: Blasius laminar and Schlichting turbulent."""
    re_x = np.asarray(re_x, dtype=float)
    return {"laminar": 0.664 / np.sqrt(re_x), "turbulent": (2 * np.log10(re_x) - 0.65) ** -2.3}


def flat_plate_CF(re_L, re_tr=5e5):
    """Mean skin friction coefficient of one side of a plate (Prandtl-Schlichting)."""
    re_L = np.asarray(re_L, dtype=float)
    lam = 1.328 / np.sqrt(re_L)
    turb = 0.455 / np.log10(re_L) ** 2.58 - (1700.0 if re_tr == 5e5 else 0.0) / re_L
    return np.where(re_L < re_tr, lam, turb)
