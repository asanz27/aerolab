"""Turbulence scales, resolution requirements of DNS / LES / RANS, and wall y+.

* Model energy spectrum (Pope, *Turbulent Flows* 2000, eq. 6.246):
      E(k) = C eps^(2/3) k^(-5/3) f_L(kL) f_eta(k eta)
* Kolmogorov scale eta/L ~ Re_L^(-3/4)  ->  DNS points ~ (L/eta)^3 ~ Re_L^(9/4).
* Wall-bounded grid-point estimates (Choi & Moin 2012, Phys. Fluids 24):
      DNS ~ Re_Lx^(37/14), wall-resolved LES ~ Re_Lx^(13/7), wall-modelled LES ~ Re_Lx.
* First-cell height for a target y+ using the flat-plate skin friction.
"""
from __future__ import annotations

import numpy as np

from .boundary_layer import law_of_wall

C_K = 1.5
P0 = 2.0
C_L = 6.78
BETA = 5.2
C_ETA = 0.40


def spectrum(re_L=1e4, n=400):
    """Normalised model spectrum with L = 1, eps = 1 (so u' ~ 1); eta = Re_L^(-3/4)."""
    eta = re_L ** (-0.75)
    k = np.logspace(-1, np.log10(5.0 / eta), n)
    kL = k
    keta = k * eta
    fL = (kL / np.sqrt(kL**2 + C_L)) ** (5.0 / 3.0 + P0)
    feta = np.exp(-BETA * ((keta**4 + C_ETA**4) ** 0.25 - C_ETA))
    E = C_K * k ** (-5.0 / 3.0) * fL * feta
    cum = np.concatenate([[0], np.cumsum(0.5 * (E[1:] + E[:-1]) * np.diff(k))])
    total = cum[-1]
    k_les = float(np.interp(0.8 * total, cum, k))  # LES rule of thumb: resolve ~80 % of k
    dissipation = 2 * k**2 * E
    cumd = np.concatenate([[0], np.cumsum(0.5 * (dissipation[1:] + dissipation[:-1]) * np.diff(k))])
    k_diss = float(np.interp(0.5 * cumd[-1], cumd, k))
    return {"k": k, "E": E, "eta": eta, "k_eta": 1 / eta, "k_les": k_les, "k_rans": float(k[0]),
            "k_dissipation_peak": k_diss, "tke": float(total)}


def grid_cost(re_lx):
    re_lx = np.asarray(re_lx, dtype=float)
    return {"re": re_lx, "dns": re_lx ** (37 / 14), "wrles": re_lx ** (13 / 7), "wmles": re_lx,
            "dns_isotropic": re_lx ** (9 / 4)}


def first_cell(U=50.0, L=2.0, x=1.0, nu=1.5e-5, yplus=1.0, rho=1.225):
    """First-cell height for a target y+ at station x on a turbulent flat plate."""
    re_x = U * x / nu
    cf = (2 * np.log10(re_x) - 0.65) ** -2.3
    tau = 0.5 * rho * U**2 * cf
    ut = np.sqrt(tau / rho)
    dy = yplus * nu / ut
    delta = 0.37 * x * re_x ** -0.2
    return {"re_x": re_x, "cf": cf, "u_tau": ut, "dy": dy, "delta": delta, "delta_plus": delta * ut / nu,
            "viscous_length": nu / ut}


def wall_profile(n=300, yplus_max=1e4):
    yp = np.logspace(-1, np.log10(yplus_max), n)
    up = law_of_wall(yp)
    return {"yplus": yp, "uplus": up, "linear": yp, "log": np.log(yp) / 0.41 + 5.0}
