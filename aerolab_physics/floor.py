"""Quasi-1D model of a ground-effect underfloor (Venturi channel + diffuser).

The channel between the floor and a **moving** ground (no ground boundary layer, as
on track or on a rolling road) is treated as a 1D duct of height h(x):

* the diffuser exit discharges into the car's base wake at pressure Cp_base, which
  fixes the exit velocity  u_e/U = sqrt(1 - Cp_base);
* continuity u(x) h_eff(x) = const with h_eff = h - delta*(floor) gives u(x);
* Cp(x) = 1 - (u/U)^2 (Bernoulli, losses ignored upstream of separation);
* a turbulent boundary layer (Head) is marched on the floor; if it separates at x_s
  the diffuser stops recovering pressure there: the effective exit becomes the
  section at x_s, which lowers the throat velocity. Iterated to convergence.

Reproduces the classic behaviour: downforce grows as ride height drops (more
throat acceleration), until the diffuser's adverse gradient is too strong and it
separates -> downforce loss (and pitch/ride-height sensitivity, "porpoising" driver).
Downforce coefficient is referred to floor plan length L (per unit width).
"""
from __future__ import annotations

import numpy as np

from . import boundary_layer as BL


def channel(h_throat=0.02, h_inlet=0.08, diffuser_deg=8.0, x_throat0=0.25, x_diff0=0.70,
            n=161):
    x = np.linspace(0, 1, n)
    h = np.full_like(x, h_throat)
    inl = x < x_throat0
    h[inl] = h_throat + (h_inlet - h_throat) * 0.5 * (1 + np.cos(np.pi * x[inl] / x_throat0))
    dif = x > x_diff0
    h[dif] = h_throat + (x[dif] - x_diff0) * np.tan(np.radians(diffuser_deg))
    return x, h


def solve(h_throat=0.02, h_inlet=0.08, diffuser_deg=8.0, cp_base=-0.25, re=1.5e7,
          x_throat0=0.25, x_diff0=0.70, iters=20):
    x, h = channel(h_throat, h_inlet, diffuser_deg, x_throat0, x_diff0)
    ue_exit = np.sqrt(1 - cp_base)
    nu = 1.0 / re
    dstar = np.zeros_like(x)
    x_end = float(x[-1])
    x_sep_c = x_end  # continuous separation location (relaxed)

    def velocity(dstar, xs):
        h_eff = np.maximum(h - dstar, 0.15 * h)
        a_exit = float(np.interp(xs, x, h_eff))
        u = ue_exit * a_exit / h_eff
        u[x > xs] = ue_exit  # separated: no further pressure recovery
        return u, h_eff

    for _ in range(iters):
        u, h_eff = velocity(dstar, x_sep_c)
        r = BL.march(x, u, nu, 1.0, criterion="michel", force_transition_s=0.02, n_sub=2)
        new_dstar = np.nan_to_num(r["dstar"], nan=0.0)
        xs_new = x_end
        if r["turb_sep"] is not None:
            xs_new = max(float(r["turb_sep"]), x_diff0)
            j = int(np.searchsorted(x, xs_new))
            if j < len(x):
                new_dstar[j:] = new_dstar[max(j - 1, 0)] + 0.1 * (x[j:] - x[max(j - 1, 0)])
        conv = abs(xs_new - x_sep_c) < 2e-3 and np.max(np.abs(new_dstar - dstar)) < 1e-5
        dstar = 0.5 * dstar + 0.5 * new_dstar
        x_sep_c = 0.5 * x_sep_c + 0.5 * xs_new
        if conv:
            break
    x_sep = x_sep_c if x_sep_c < x_end - 1e-3 else None
    u, h_eff = velocity(dstar, x_sep_c)
    cp = 1 - u**2
    trap = getattr(np, "trapezoid", None) or getattr(np, "trapz")
    cl_down = float(-trap(cp, x))
    # ideal (attached, no BL) reference with the same geometry
    u_id = ue_exit * h[-1] / h
    cp_id = 1 - u_id**2
    return {"x": x, "h": h, "h_eff": h_eff, "dstar": dstar, "u": u, "cp": cp, "cp_ideal": cp_id,
            "x_sep": x_sep, "downforce": cl_down, "downforce_ideal": float(-trap(cp_id, x)),
            "area_ratio": float(h[-1] / h_throat)}


def ride_height_sweep(h_values=None, **kw):
    h_values = np.linspace(0.006, 0.08, 40) if h_values is None else np.asarray(h_values, float)
    cl, cli, xs = [], [], []
    for hv in h_values:
        r = solve(h_throat=float(hv), **kw)
        cl.append(r["downforce"])
        cli.append(r["downforce_ideal"])
        xs.append(r["x_sep"])
    return {"h": h_values, "downforce": np.array(cl), "downforce_ideal": np.array(cli), "x_sep": xs}
