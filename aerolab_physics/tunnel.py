"""Wind-tunnel testing corrections and similarity.

* Reynolds number of model vs full scale (F1 rules: <= 60 % scale, limited speed).
* Blockage corrections for a closed test section:
    solid blockage  eps_sb = K tau V_model / C^1.5   (Glauert/Thom form, K tau ~ 0.9 here)
    wake blockage   eps_wb = (S / 4C) Cd_u           (Maskell, streamlined)
    bluff bodies (Maskell 1963): q_c / q_u = 1 + theta (S/C) Cd_u, theta ~ 2.5
* Floor boundary layer of a fixed-ground tunnel: displacement thickness grows as a
  turbulent flat plate, delta* ~ 0.046 x Re_x^(-1/5), stealing ride height.

Refs: Barlow, Rae & Pope, *Low-Speed Wind Tunnel Testing* (1999) ch. 9-10;
Katz, *Race Car Aerodynamics* (2006) ch. 8.
"""
from __future__ import annotations

import numpy as np


def reynolds(V=50.0, L=5.0, nu=1.5e-5):
    return V * L / nu


def scale_similarity(scale=0.6, V_tunnel=50.0, V_track=80.0, L_full=5.6, nu=1.5e-5):
    re_t = reynolds(V_tunnel, scale * L_full, nu)
    re_f = reynolds(V_track, L_full, nu)
    return {"re_tunnel": re_t, "re_full": re_f, "ratio": re_t / re_f,
            "speed_for_match": V_track / scale, "mach_for_match": V_track / scale / 340.0}


def blockage(frontal_ratio=0.05, cd_u=0.9, volume_ratio=None, bluff=True):
    S_C = frontal_ratio
    if volume_ratio is None:
        volume_ratio = 0.3 * S_C**1.5  # rough body volume / C^1.5 for a car-like body
    eps_sb = 0.9 * volume_ratio
    if bluff:
        q_ratio = 1 + 2.5 * S_C * cd_u
    else:
        eps_wb = 0.25 * S_C * cd_u
        q_ratio = (1 + eps_sb + eps_wb) ** 2
    q_ratio_total = q_ratio * (1 + eps_sb) ** 2 if bluff else q_ratio
    return {"q_ratio": q_ratio_total, "cd_corrected": cd_u / q_ratio_total, "eps_sb": eps_sb}


def floor_displacement(x_from_suction=1.0, V=50.0, nu=1.5e-5, moving=False):
    if moving:
        return 0.0
    re_x = max(V * x_from_suction / nu, 1.0)
    return 0.046 * x_from_suction * re_x ** -0.2
