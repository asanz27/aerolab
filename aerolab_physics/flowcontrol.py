"""Vortex generators (VGs) on a turbulent boundary layer in an adverse pressure gradient.

Streamwise vortices pump high-momentum fluid towards the wall. In an integral method
this is represented as augmented entrainment in Head's equation, F(H1) x (1 + b(x)):

    b(x) = B0 * f(h/delta) * g(spacing/h) * exp(-(x - x_vg)/L_decay)   for x > x_vg
    f = 1 - exp(-(h/delta)/0.25)   (low-profile VGs, h/delta ~ 0.2-0.5, are already effective)
    g = exp(-((s/h - 6)/4)^2)       (best spacing around 4-8 heights)
    L_decay = 60 h                  (vortices persist ~50-100 device heights)

Device drag: Delta Cd ~ 0.5 n C_D,vane (h l)/(span x c) with a vane drag coefficient
growing with (h/delta)^2 -- an estimate. Semi-empirical model calibrated to the trends
reviewed by Lin (2002), "Review of research on low-profile vortex generators to control
boundary-layer separation", Prog. Aerosp. Sci. 38.
"""
from __future__ import annotations

import numpy as np

from . import boundary_layer as BL

B0 = 3.0


def vg_boost(x, x_vg, h, delta, spacing):
    f = 1 - np.exp(-(h / max(delta, 1e-9)) / 0.25)
    g = np.exp(-(((spacing / max(h, 1e-9)) - 6) / 4) ** 2)
    L = 60 * h
    b = np.where(x > x_vg, B0 * f * g * np.exp(-(x - x_vg) / L), 0.0)
    return b


def ramp_case(k=0.55, re_L=3e6, use_vg=True, x_vg=0.3, h_over_delta=0.5, spacing_over_h=6.0, n=500):
    """Turbulent boundary layer (tripped at the leading edge) in ue/U = 1 - k x.

    Returns H(x), Cf(x), separation point with and without VGs and a drag estimate.
    """
    x = np.linspace(0, 1, n)
    ue = np.maximum(1 - k * x, 0.05)
    nu = 1.0 / re_L
    base = BL.march(x, ue, nu, 1.0, "michel", 0.01, n_sub=1)
    i = int(np.searchsorted(x, x_vg))
    delta = float(np.nan_to_num(base["delta"][i], nan=0.01))
    h = h_over_delta * delta
    s = spacing_over_h * h
    boost = vg_boost(x, x_vg, h, delta, s) if use_vg else None
    r = BL.march(x, ue, nu, 1.0, "michel", 0.01, n_sub=1, boost=boost)
    dcd = 0.5 * (h / s) * 0.6 * (h_over_delta) ** 2 * h if use_vg else 0.0
    return {"x": x, "ue": ue, "H": r["H"], "cf": r["cf"], "H_base": base["H"], "cf_base": base["cf"],
            "x_sep": r["turb_sep"], "x_sep_base": base["turb_sep"], "delta_vg": delta, "h_vg": h,
            "boost": np.zeros_like(x) if boost is None else boost, "device_dcd": float(dcd)}
