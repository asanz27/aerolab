"""Slender delta wings: Polhamus vortex lift and a crossflow model of the vortex system.

* Polhamus (1966) leading-edge-suction analogy:
      CL = Kp sin(a) cos^2(a) + Kv cos(a) sin^2(a)
  Kp = potential lift slope (here from the VLM), Kv = (Kp - Kp^2 Ki) / cos(Lambda),
  Ki = dCDi/dCL^2 ~ 1/(pi AR).
* Crossflow (slender-body / conical) model of a cross-section: flat plate of half
  span s in a crossflow w = V sin(a), with the primary leading-edge vortex pair
  (and optionally the secondary pair, of opposite sign, outboard and close to the
  surface). The plate is mapped to a circle (Joukowski), images enforce the body
  boundary condition and the **Kutta condition at the sharp leading edges** fixes
  the primary vortex strength. Vortex positions follow experimental trends
  (Hummel 1979; Earnshaw 1961), so the model is semi-empirical.
* Vortex-breakdown position: empirical trend from Wentz & Kohlman (1971) data.
"""
from __future__ import annotations

import numpy as np

from . import vlm

TWO_PI = 2 * np.pi


def polhamus(sweep_deg=70.0, alphas=None):
    alphas = np.arange(0, 41, 1.0) if alphas is None else np.asarray(alphas, float)
    r = vlm.solve(vlm.delta_surfaces(sweep_deg, 1.0, nc=8, ns=16), 1.0)
    Kp = r["CL"] / np.radians(1.0)
    AR = 4 / np.tan(np.radians(sweep_deg))
    Ki = 1 / (np.pi * AR)
    Kv = (Kp - Kp**2 * Ki) / np.cos(np.radians(sweep_deg))
    a = np.radians(alphas)
    clp = Kp * np.sin(a) * np.cos(a) ** 2
    clv = Kv * np.cos(a) * np.sin(a) ** 2
    xbd = np.array([breakdown_position(sweep_deg, al) for al in alphas])
    # vortex lift is lost on the part of the wing aft of breakdown (~ area fraction)
    clv_eff = clv * np.clip(xbd, 0, 1) ** 2
    return {"alpha": alphas, "Kp": float(Kp), "Kv": float(Kv), "AR": float(AR),
            "CL_potential": clp, "CL_vortex": clv, "CL_total": clp + clv,
            "CL_with_breakdown": clp + clv_eff, "x_breakdown": xbd}


def alpha_breakdown_at_te(sweep_deg):
    """Incidence at which vortex breakdown crosses the trailing edge (empirical trend)."""
    sw = np.array([55, 60, 65, 70, 75, 80])
    a_te = np.array([10, 14, 20, 27, 35, 42])
    return float(np.interp(sweep_deg, sw, a_te))


def breakdown_position(sweep_deg, alpha_deg):
    """x_bd / c_root: 1+ means downstream of the wing; moves towards the apex with alpha."""
    a_te = alpha_breakdown_at_te(sweep_deg)
    if alpha_deg <= a_te:
        return 1.0 + 0.03 * (a_te - alpha_deg)
    return float(max(0.0, 1.0 - (alpha_deg - a_te) / 14.0))


def crossflow(alpha_deg=20.0, sweep_deg=70.0, secondary=True, n=241, grid=True):
    """Spanwise pressure on a cross-section of a slender delta wing (crossflow model)."""
    s = 1.0  # local semi-span
    a_rad = np.radians(alpha_deg)
    eps = np.radians(90 - sweep_deg)  # semi-apex angle
    kslender = np.clip(np.tan(a_rad) / np.tan(eps), 0.05, 3.0)
    # primary vortex position (Hummel / Earnshaw trends): moves up and slightly inboard
    yv = 0.68 - 0.05 * min(kslender, 2.0)
    zv = 0.16 + 0.12 * min(kslender, 2.0)
    w = np.sin(a_rad)  # crossflow velocity / V
    R = s / 2
    zeta_v = np.array([yv + 1j * zv, -yv + 1j * zv])
    sgn = np.array([1.0, -1.0])  # starboard counter-clockwise, port clockwise (+ = ccw)
    if secondary:
        ys, zs = 0.87, 0.075
        zeta_s = np.array([ys + 1j * zs, -ys + 1j * zs])
        k_sec = -0.12  # secondary circulation relative to primary (opposite sense)
    else:
        zeta_s = np.zeros(0, complex)
        k_sec = 0.0

    def to_sigma(z):
        r = np.sqrt(z**2 - 4 * R**2 + 0j)
        s1, s2 = 0.5 * (z + r), 0.5 * (z - r)
        return np.where(np.abs(s1) >= np.abs(s2), s1, s2)

    sv = to_sigma(zeta_v)
    ss = to_sigma(zeta_s) if secondary else zeta_s

    def dW_dsigma(sig, G):
        # uniform crossflow past circle
        d = -1j * w * (1 + R**2 / sig**2)
        for k in range(2):
            g = G * sgn[k]
            d += -1j * g / TWO_PI * (1 / (sig - sv[k]) - 1 / (sig - R**2 / np.conj(sv[k])))
            if secondary:
                gs = k_sec * G * sgn[k]
                d += -1j * gs / TWO_PI * (1 / (sig - ss[k]) - 1 / (sig - R**2 / np.conj(ss[k])))
        return d

    # Kutta condition at the starboard edge sigma = +R: dW/dsigma = 0 (linear in G)
    d0 = dW_dsigma(np.array([R + 0j]), 0.0)[0]
    d1 = dW_dsigma(np.array([R + 0j]), 1.0)[0] - d0
    G = float(-(d0 / d1).real) if abs(d1) > 1e-12 else 0.0

    th = np.linspace(1e-3, np.pi - 1e-3, n)
    sig_u = R * np.exp(1j * th)
    sig_l = R * np.exp(-1j * th)
    out = {"G_primary": G, "vortices": {"primary": [[float(z.real), float(z.imag)] for z in zeta_v],
                                         "secondary": [[float(z.real), float(z.imag)] for z in zeta_s]}}
    for name, sig in (("upper", sig_u), ("lower", sig_l)):
        dz = 1 - R**2 / sig**2
        vel = dW_dsigma(sig, G) / dz
        y = (sig + R**2 / sig).real
        cp = (w**2 - np.abs(vel) ** 2)  # crossflow pressure / (1/2 rho V^2), slender-body approx.
        order = np.argsort(y)
        out[name] = {"y": y[order], "cp": cp[order], "vy": vel.real[order]}
    # The crossflow model with fixed (measured) vortex positions over-predicts the
    # suction level, so the distribution is scaled to the Polhamus normal force
    # (conical flow: CN = 1/2 * integral of (Cp_l - Cp_u) d(y/s)). Shape is the model's.
    trap = getattr(np, "trapezoid", None) or getattr(np, "trapz")
    yy = np.linspace(-0.999, 0.999, 401)
    dcp = np.interp(yy, out["lower"]["y"], out["lower"]["cp"]) - np.interp(yy, out["upper"]["y"], out["upper"]["cp"])
    cn_model = 0.5 * float(trap(dcp, yy))
    pol = polhamus(sweep_deg, [alpha_deg])
    cn_target = float(pol["CL_total"][0] / max(np.cos(a_rad), 1e-6))
    scale = cn_target / cn_model if cn_model > 1e-9 else 1.0
    for name in ("upper", "lower"):
        out[name]["cp"] = out[name]["cp"] * scale
    out["cn"] = cn_target
    out["scale"] = scale
    if grid:
        yg = np.linspace(-1.6, 1.6, 81)
        zg = np.linspace(-0.8, 1.2, 51)
        Y, Z = np.meshgrid(yg, zg)
        zeta = Y + 1j * Z
        sig = to_sigma(zeta)
        with np.errstate(divide="ignore", invalid="ignore"):
            vel = dW_dsigma(sig, G) / (1 - R**2 / sig**2)
        vel = np.where(np.isfinite(vel), vel, 0.0)
        u, v = vel.real, -vel.imag
        sp = np.hypot(u, v)
        lim = 4 * max(w, 0.05)
        fac = np.where(sp > lim, lim / np.maximum(sp, 1e-12), 1.0)
        out["field"] = {"y": yg, "z": zg, "u": u * fac, "v": v * fac}
    return out
