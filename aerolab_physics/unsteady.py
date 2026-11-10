"""Unsteady panel method with a free (force-free, rolling-up) vortex wake.

Linear-vortex panels on the body (same as panel.py) plus a wake of discrete vortex
blobs. Every time step:

1. one new wake vortex is shed near the trailing edge;
2. unknowns = node strengths + the new wake vortex; equations = flow tangency at the
   panel midpoints (including the wake's and the body motion's velocity), the Kutta
   condition and **Kelvin's theorem** (bound + wake circulation = 0);
3. all wake vortices are convected with the local velocity (free wake roll-up).

Forces from the time derivative of the vortex impulse, F = -rho dI/dt with
I = rho sum Gamma_k (y_k, -x_k) (counter-clockwise Gamma): exact for an inviscid flow and
free of the numerical d(phi)/dt term of unsteady Bernoulli.

Body frame: the airfoil is fixed, the free stream has unit speed at angle alpha(t);
pitch rate and heave velocity enter through the kinematic velocity at each control point.

Refs: Katz & Plotkin, *Low-Speed Aerodynamics* (2001), ch. 13.
"""
from __future__ import annotations

import numpy as np

from . import naca
from . import panel as P

TWO_PI = 2 * np.pi


def _blob_vel(px, py, wx, wy, wg, delta):
    if len(wx) == 0:
        return np.zeros_like(px), np.zeros_like(px)
    dx = px[:, None] - wx[None, :]
    dy = py[:, None] - wy[None, :]
    r2 = dx * dx + dy * dy + delta**2
    return (np.sum(-wg[None, :] * dy / (TWO_PI * r2), axis=1),
            np.sum(wg[None, :] * dx / (TWO_PI * r2), axis=1))


def simulate(code="0012", motion="step", alpha0=5.0, amp=5.0, k=0.3, heave=0.0, pivot=0.25,
             t_end=12.0, dt=0.05, n_panels=80, delta=0.03, save_every=2, ground_h=None):
    """Simulate the airfoil (unit chord, unit free-stream speed).

    motion: "step"   impulsive start at alpha0;
            "pitch"  alpha(t) = alpha0 + amp sin(omega t), omega = 2 k (k = omega c / 2V);
            "heave"  h(t) = heave sin(omega t) (plunge amplitude in chords), alpha = alpha0.
    """
    x, y = naca.naca(code, n_panels)
    el = P.Element(x, y, "main")
    els = [el]
    N = el.n_panels
    xc, yc, nx, ny = el.xc, el.yc, el.nx, el.ny
    U, V = P.influence(xc, yc, els, ground_y=None)
    An = U * nx[:, None] + V * ny[:, None]  # (N, N+1)
    omega = 2.0 * k
    xte, yte = x[0], y[0]
    wx = np.zeros(0)
    wy = np.zeros(0)
    wg = np.zeros(0)
    n_steps = int(round(t_end / dt))
    t_hist, cl_hist, gb_hist, a_hist, cl_qs = [], [], [], [], []
    frames = []
    impulse_prev = None
    for it in range(1, n_steps + 1):
        t = it * dt
        if motion == "pitch":
            a = np.radians(alpha0 + amp * np.sin(omega * t))
            adot = np.radians(amp) * omega * np.cos(omega * t)
            hdot = 0.0
        elif motion == "heave":
            a = np.radians(alpha0)
            adot = 0.0
            hdot = heave * omega * np.cos(omega * t)
        else:
            a = np.radians(alpha0)
            adot = 0.0
            hdot = 0.0
        # kinematic velocity seen by the body (body frame): free stream + rotation + heave
        ux = np.cos(a) + adot * (yc - 0.0)
        uy = np.sin(a) - adot * (xc - pivot) - hdot
        # new wake vortex position: behind the TE, along the local flow
        shed_x = xte + 0.3 * dt * np.cos(a)
        shed_y = yte + 0.3 * dt * np.sin(a)
        # induced normal velocity of the existing wake at the control points
        uw, vw = _blob_vel(xc, yc, wx, wy, wg, delta)
        # influence of the new wake vortex (unit strength)
        un, vnw = _blob_vel(xc, yc, np.array([shed_x]), np.array([shed_y]), np.array([1.0]), delta)
        M = np.zeros((N + 2, N + 2))
        rhs = np.zeros(N + 2)
        M[:N, :N + 1] = An
        M[:N, N + 1] = un * nx + vnw * ny
        rhs[:N] = -((ux + uw) * nx + (uy + vw) * ny)
        M[N, 0] = 1.0
        M[N, N] = 1.0  # Kutta
        # Kelvin: bound circulation + new wake vortex = - (previous wake circulation)
        M[N + 1, :N] += 0.5 * el.L
        M[N + 1, 1:N + 1] += 0.5 * el.L
        M[N + 1, N + 1] = 1.0
        rhs[N + 1] = -float(np.sum(wg))
        sol = np.linalg.solve(M, rhs)
        g = sol[:N + 1]
        gw = sol[N + 1]
        wx = np.append(wx, shed_x)
        wy = np.append(wy, shed_y)
        wg = np.append(wg, gw)
        gm = 0.5 * (g[:-1] + g[1:])
        gb = float(np.sum(gm * el.L))
        # impulse of the whole vortex system (bound panels + wake)
        Ix = float(np.sum(gm * el.L * yc) + np.sum(wg * wy))
        Iy = float(-np.sum(gm * el.L * xc) - np.sum(wg * wx))
        # convect the wake (body panels + wake + free stream), forward Euler
        Ub, Vb = P.influence(wx, wy, els, None)
        uwk = np.cos(a) + Ub @ g
        vwk = np.sin(a) + Vb @ g
        du, dv = _blob_vel(wx, wy, wx, wy, wg, delta)
        wx = wx + dt * (uwk + du)
        wy = wy + dt * (vwk + dv)
        if impulse_prev is not None:
            fx = -(Ix - impulse_prev[0]) / dt
            fy = -(Iy - impulse_prev[1]) / dt
            # lift normal to the free stream, coefficient with rho = 1, V = 1, c = 1
            cl = 2 * (fy * np.cos(a) - fx * np.sin(a))
        else:
            cl = np.nan
        impulse_prev = (Ix, Iy)
        t_hist.append(t)
        cl_hist.append(cl)
        gb_hist.append(gb)
        a_hist.append(np.degrees(a))
        cl_qs.append(2 * np.pi * a)  # quasi-steady thin-airfoil reference
        if it % save_every == 0:
            frames.append({"t": t, "x": wx.copy(), "y": wy.copy(), "g": wg.copy()})
    cl_arr = np.array(cl_hist)
    # light smoothing of the impulse derivative (removes step-to-step noise)
    sm = np.convolve(np.nan_to_num(cl_arr), np.ones(3) / 3, mode="same")
    sm[:2] = cl_arr[:2]
    sm[-1] = cl_arr[-1]
    steady = P.forces(P.PanelSystem(els).solve(alpha0))["cl"]
    return {"t": np.array(t_hist), "s": 2 * np.array(t_hist), "cl": sm, "gamma_bound": np.array(gb_hist),
            "alpha": np.array(a_hist), "cl_quasi_steady": np.array(cl_qs), "cl_steady": steady,
            "frames": frames, "body": {"x": x, "y": y}}


def theodorsen(k):
    """Theodorsen's function C(k) = F + iG via Bessel functions (series implementation)."""
    k = np.atleast_1d(np.asarray(k, dtype=float))
    J0, J1, Y0, Y1 = _bessel(k)
    H1 = J1 - 1j * Y1
    H0 = J0 - 1j * Y0
    C = H1 / (H1 + 1j * H0)
    return C


def _bessel(x):
    """J0, J1, Y0, Y1 for x > 0 (numerical quadrature of the integral representations)."""
    th = np.linspace(0, np.pi, 801)
    trap = getattr(np, "trapezoid", None) or getattr(np, "trapz")
    J0 = np.array([trap(np.cos(xx * np.sin(th)), th) / np.pi for xx in x])
    J1 = np.array([trap(np.cos(th - xx * np.sin(th)), th) / np.pi for xx in x])
    # Y_n(x) = 1/pi int_0^pi sin(x sin t - n t) dt - 1/pi int_0^inf (e^{nt} + (-1)^n e^{-nt}) e^{-x sinh t} dt
    tt = np.linspace(0, 12, 4001)
    Y0 = np.array([trap(np.sin(xx * np.sin(th)), th) / np.pi - trap(2 * np.exp(-xx * np.sinh(tt)), tt) / np.pi for xx in x])
    Y1 = np.array([trap(np.sin(xx * np.sin(th) - th), th) / np.pi - trap((np.exp(tt) - np.exp(-tt)) * np.exp(-xx * np.sinh(tt)), tt) / np.pi for xx in x])
    return J0, J1, Y0, Y1


def theodorsen_pitch_loop(alpha0=5.0, amp=5.0, k=0.3, pivot=0.25, n=200):
    """Thin-airfoil Theodorsen lift for harmonic pitch about x = pivot (chord fractions).

    a = position of the pivot from mid-chord in semichords: a = 2*pivot - 1.
    Cl = pi b (alpha_dot / V - b a alpha_ddot / V^2) + 2 pi C(k) [alpha + alpha_dot b (1/2 - a) / V]
    with b = c/2 = 0.5, V = 1.
    """
    b = 0.5
    aa = 2 * pivot - 1
    w = 2 * k  # omega for V = 1, c = 1
    C = theodorsen([k])[0]
    t = np.linspace(0, 2 * np.pi / w, n)
    A = np.radians(amp)
    alpha = np.radians(alpha0) + A * np.sin(w * t)
    # complex amplitudes of the oscillating part
    al_hat = -1j * A  # A sin(wt) = Re(-i A e^{iwt})
    ad_hat = 1j * w * al_hat
    add_hat = -w * w * al_hat
    nc = np.pi * b * (ad_hat - b * aa * add_hat)
    circ = 2 * np.pi * C * (al_hat + ad_hat * b * (0.5 - aa))
    cl = 2 * np.pi * np.radians(alpha0) + np.real((nc + circ) * np.exp(1j * w * t))
    return {"t": t, "alpha": np.degrees(alpha), "cl": cl, "C": [float(C.real), float(C.imag)]}
