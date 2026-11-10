"""Prandtl lifting-line theory (Fourier/Glauert collocation).

Gamma(theta) = 2 b V sum A_n sin(n theta),   y = -(b/2) cos(theta)
alpha_i(theta) = sum n A_n sin(n theta) / sin(theta)
CL = pi AR A_1,   CDi = pi AR sum n A_n^2 = CL^2 / (pi e AR)
Trailing (shed) vorticity per unit span = -dGamma/dy: every spanwise load gradient
sheds vorticity into the wake. The elliptic load gives uniform downwash and e = 1.

Refs: Anderson (2017) §5.3; Katz & Plotkin (2001) §8.1; Glauert (1926).
"""
from __future__ import annotations

import numpy as np


def chord_distribution(planform: str, y_over_b: np.ndarray, AR: float, taper: float = 1.0):
    """Chord c(y)/b for a wing of unit span with aspect ratio AR."""
    eta = np.abs(2 * y_over_b)  # 0 root .. 1 tip
    S = 1.0 / AR  # wing area for b = 1
    if planform == "elliptic":
        c0 = 4 * S / np.pi
        return c0 * np.sqrt(np.clip(1 - eta**2, 0, None))
    if planform == "taper":
        cr = 2 * S / (1 + taper)
        return cr * (1 - (1 - taper) * eta)
    return np.full_like(eta, S)  # rectangular


def solve(AR=8.0, planform="rect", taper=0.4, twist_deg=0.0, alpha_deg=5.0,
          a0=2 * np.pi, alpha_L0_deg=0.0, n=40, V=1.0):
    """Lifting line for a wing of span b = 1 (results non-dimensional)."""
    b = 1.0
    i = np.arange(1, n + 1)
    th = i * np.pi / (n + 1)
    y = -0.5 * b * np.cos(th)
    c = chord_distribution(planform, y / b, AR, taper)
    c = np.maximum(c, 1e-6)
    eta = np.abs(2 * y)
    alpha = np.radians(alpha_deg) + np.radians(twist_deg) * eta - np.radians(alpha_L0_deg)
    nn = np.arange(1, n + 1)
    S = np.sin(np.outer(th, nn))
    M = S * (4 * b / (a0 * c))[:, None] + S * nn[None, :] / np.sin(th)[:, None]
    A = np.linalg.solve(M, alpha)
    return _results(A, AR, b, V, n_plot=121, extra={"alpha_geo": alpha, "a0": a0, "planform": planform,
                                                     "chord_fn": (planform, AR, taper)})


def from_gamma(y_over_b, gamma, AR=8.0, n=None, V=1.0):
    """Fourier-fit an arbitrary spanwise circulation Gamma(y)/(b V) (e.g. hand drawn).

    The number of terms is limited to about a third of the samples so the least-squares
    fit does not oscillate (Gibbs) between the given points near the tips.
    """
    b = 1.0
    y = np.asarray(y_over_b, dtype=float)
    g = np.asarray(gamma, dtype=float)
    n = int(n) if n else max(5, min(15, len(y) // 3))
    th = np.arccos(np.clip(-2 * y / b, -1, 1))
    nn = np.arange(1, n + 1)
    S = 2 * b * V * np.sin(np.outer(th, nn))
    A, *_ = np.linalg.lstsq(S, g, rcond=None)
    return _results(A, AR, b, V, n_plot=121)


def _results(A, AR, b, V, n_plot=121, extra=None):
    nn = np.arange(1, len(A) + 1)
    th = np.linspace(1e-3, np.pi - 1e-3, n_plot)
    y = -0.5 * b * np.cos(th)
    S = np.sin(np.outer(th, nn))
    gamma = 2 * b * V * S @ A
    alpha_i = (S * nn) @ A / np.sin(th)
    # shed vorticity: -dGamma/dy
    dgdy = np.gradient(gamma, y)
    CL = np.pi * AR * A[0]
    CDi = np.pi * AR * float(np.sum(nn * A**2))
    e = CL**2 / (np.pi * AR * CDi) if CDi > 1e-12 else 1.0
    out = {"y": y, "gamma": gamma, "alpha_i_deg": np.degrees(alpha_i), "downwash": V * alpha_i,
           "shed": -dgdy, "A": A, "CL": float(CL), "CDi": float(CDi), "e": float(e), "AR": AR,
           "delta": float(np.sum(nn[1:] * A[1:] ** 2) / A[0] ** 2) if abs(A[0]) > 1e-12 else 0.0}
    if extra and "chord_fn" in extra:
        pf, ar, tp = extra["chord_fn"]
        c = chord_distribution(pf, y / b, ar, tp)
        out["chord"] = c
        out["cl_local"] = np.where(c > 1e-6, 2 * gamma / (V * np.maximum(c, 1e-6)), 0.0)
    return out


def lift_slope_3d(a0=2 * np.pi, AR=8.0, e=1.0):
    """Finite-wing lift slope a = a0 / (1 + a0 / (pi e AR)) per radian."""
    return a0 / (1 + a0 / (np.pi * e * AR))
