"""Incompressible quasi-1D duct (Venturi / nozzle / diffuser) with wall boundary layer.

Continuity  u(x) A(x) = U_in A_in  and Bernoulli  p + rho u^2/2 = p0  hold while the
flow is attached. A turbulent boundary layer (Head) is marched along the wall with the
core velocity; if it separates in the diffuser, the core leaves as a jet: pressure no
longer recovers downstream (p ~ p_sep), and the unrecovered dynamic pressure is a
total-pressure loss. This is why diffusers need small half-angles (~3.5-7 deg, Kline
stall maps) and why an F1 diffuser that separates loses downforce.

Also returns a kinematically consistent 2D velocity field for flow visualisation
(u uniform across the section, v from streamline divergence: v = u * eta * dh/dx).
"""
from __future__ import annotations

import numpy as np

from . import boundary_layer as BL


def area_profile(ctrl_x, ctrl_h, n=241):
    x = np.linspace(min(ctrl_x), max(ctrl_x), n)
    h = np.interp(x, ctrl_x, ctrl_h)
    # light smoothing so the wall slope is continuous
    k = np.ones(9) / 9
    hp = np.pad(h, 4, mode="edge")
    h = np.convolve(hp, k, mode="valid")
    return x, h


def solve(ctrl_x=None, ctrl_h=None, U_in=10.0, rho=1.225, nu_air=1.5e-5, length=1.0, field=True):
    """ctrl_x in [0,1] (fraction of duct length), ctrl_h half-heights (m)."""
    ctrl_x = ctrl_x or [0.0, 0.25, 0.45, 0.55, 1.0]
    ctrl_h = ctrl_h or [0.2, 0.2, 0.09, 0.09, 0.2]
    x, h = area_profile(ctrl_x, ctrl_h)
    u_att = U_in * h[0] / h
    # boundary layer along the wall (s in metres, ue / U_in, nu / U_in)
    r = BL.march(x * length, u_att / U_in, nu_air / U_in, 1.0, "michel", 0.01)
    x_sep = None
    u = u_att.copy()
    if r["turb_sep"] is not None:
        xs = float(r["turb_sep"]) / length
        if xs > x[np.argmin(h)]:  # only diffuser separation matters here
            x_sep = xs
            us = float(np.interp(xs, x, u_att))
            u = np.where(x > xs, us, u_att)  # jet: no further deceleration
    q_in = 0.5 * rho * U_in**2
    p0 = 101325.0 + q_in  # inlet static = atmospheric
    p = p0 - 0.5 * rho * u**2
    cp = (p - (p0 - q_in)) / q_in
    p_exit_ideal = p0 - 0.5 * rho * u_att[-1] ** 2
    loss = float(p_exit_ideal - p[-1])
    half_angle = np.degrees(np.arctan(np.gradient(h, x * length)))
    out = {"x": x, "h": h, "u": u, "u_attached": u_att, "p": p, "cp": cp, "x_sep": x_sep,
           "p0_loss": loss, "p0_loss_coeff": loss / q_in, "max_half_angle": float(np.max(half_angle)),
           "theta": r["theta"], "H": r["H"], "dstar": r["dstar"]}
    if field:
        xs_ = x[::3]
        hh = h[::3]
        uu = (u / U_in)[::3]
        dh = np.gradient(h, x * length)[::3]
        yg = np.linspace(-1.02 * h.max(), 1.02 * h.max(), 41)
        Y = yg[:, None]
        inside = np.abs(Y) < hh[None, :]
        U = np.where(inside, uu[None, :], np.nan)
        V = np.where(inside, (Y / hh[None, :]) * uu[None, :] * dh[None, :], np.nan)
        if x_sep is not None:
            hs = float(np.interp(x_sep, x, h))
            post = xs_[None, :] > x_sep
            dead = inside & post & (np.abs(Y) > hs)
            U = np.where(dead, 0.04, U)
            V = np.where(post & inside, 0.0, V)
        out["field"] = {"x": xs_ * length, "y": yg, "u": U, "v": V}
    return out
