"""Vortex models and vortex dynamics.

* Velocity/pressure profiles: Rankine, Lamb-Oseen, Burgers (same circulation & core).
* 2D inviscid dynamics with **vortex blobs**: each vortex is a Gaussian patch of
  regularised point vortices, so finite-core effects such as co-rotating merger
  emerge naturally (merger when core radius / separation exceeds ~0.3; Meunier,
  Le Dizes & Leweke 2005). Optional wall via image system.
* Kelvin-Helmholtz roll-up of a periodic vortex sheet (Krasny 1986 delta-regularisation).
* Vortex breakdown: quasi-cylindrical (Hall-type) on-axis momentum model of a
  Lamb-Oseen vortex in an adverse external pressure gradient (qualitative).

Refs: Saffman, *Vortex Dynamics* (1992); Leibovich (1978) Annu. Rev. Fluid Mech.;
Hall (1972) Annu. Rev. Fluid Mech.; Krasny (1986) JFM 167.
"""
from __future__ import annotations

import numpy as np

TWO_PI = 2 * np.pi
LN2 = np.log(2.0)


def profiles(gamma=1.0, rc=0.1, r_max=0.5, n=300, rho=1.0):
    """Tangential velocity and static pressure (relative to far field) for three models.

    rc is the radius of maximum tangential velocity in every model.
    """
    r = np.linspace(1e-6, r_max, n)
    out = {"r": r}
    # Rankine
    v_r = np.where(r < rc, gamma * r / (TWO_PI * rc**2), gamma / (TWO_PI * r))
    # Lamb-Oseen: v = G/(2 pi r) (1 - exp(-r^2/a^2)), r_max = 1.1209 a
    a = rc / 1.12091
    v_lo = gamma / (TWO_PI * r) * (1 - np.exp(-(r**2) / a**2))
    # Burgers vortex has the same azimuthal profile as Lamb-Oseen (steady, stretched)
    for name, v in (("rankine", v_r), ("lamb_oseen", v_lo)):
        # p(r) = p_inf - rho int_r^inf v^2/r dr  (radial equilibrium)
        rr = np.linspace(1e-6, max(r_max, 50 * rc), 20000)
        if name == "rankine":
            vv = np.where(rr < rc, gamma * rr / (TWO_PI * rc**2), gamma / (TWO_PI * rr))
        else:
            vv = gamma / (TWO_PI * rr) * (1 - np.exp(-(rr**2) / a**2))
        integrand = vv**2 / rr
        cum = np.concatenate([[0], np.cumsum(0.5 * (integrand[1:] + integrand[:-1]) * np.diff(rr))])
        tail = gamma**2 / (8 * np.pi**2 * rr[-1] ** 2)  # analytic remainder beyond rr[-1]
        p_rr = -rho * (cum[-1] - cum + tail)
        out[name] = {"v": v, "p": np.interp(r, rr, p_rr), "vorticity": np.gradient(r * v, r) / r}
    out["burgers"] = out["lamb_oseen"]
    out["core_pressure_lamb_oseen"] = -rho * LN2 * (gamma / (TWO_PI * a)) ** 2
    out["core_pressure_rankine"] = -rho * (gamma / (TWO_PI * rc)) ** 2
    return out


# ------------------------------------------------------------------ blob dynamics
def make_blobs(vortices, n_rings=4):
    """Discretise Gaussian vortices into concentric rings of blobs.

    vortices: list of {x, y, gamma, radius}. Returns blob arrays and owner ids.
    """
    xs, ys, gs, own = [], [], [], []
    for k, v in enumerate(vortices):
        a = max(float(v.get("radius", 0.1)), 1e-3)
        G = float(v["gamma"])
        dr = 2.2 * a / (n_rings + 0.5)
        pts = [(0.0, 0.0)]
        weights = [1 - np.exp(-((0.5 * dr) ** 2) / a**2)]
        for i in range(1, n_rings + 1):
            r_in, r_out = (i - 0.5) * dr, (i + 0.5) * dr
            w = np.exp(-(r_in**2) / a**2) - np.exp(-(r_out**2) / a**2)
            m = 6 * i
            for p in np.arange(m) * TWO_PI / m + 0.3 * i:
                pts.append((i * dr * np.cos(p), i * dr * np.sin(p)))
                weights.append(w / m)
        weights = np.array(weights) / np.sum(weights)
        for (px, py), w in zip(pts, weights):
            xs.append(v["x"] + px)
            ys.append(v["y"] + py)
            gs.append(G * w)
            own.append(k)
    return {"x": np.array(xs), "y": np.array(ys), "g": np.array(gs), "owner": np.array(own)}


def _blob_velocity(px, py, bx, by, bg, delta, wall):
    """Velocity at points from blobs (counter-clockwise positive gamma), optional wall y=0."""
    dx = px[:, None] - bx[None, :]
    dy = py[:, None] - by[None, :]
    r2 = dx * dx + dy * dy + delta**2
    u = np.sum(-bg[None, :] * dy / (TWO_PI * r2), axis=1)
    v = np.sum(bg[None, :] * dx / (TWO_PI * r2), axis=1)
    if wall:
        dyi = py[:, None] + by[None, :]
        r2i = dx * dx + dyi * dyi + delta**2
        u += np.sum(bg[None, :] * dyi / (TWO_PI * r2i), axis=1)
        v += np.sum(-bg[None, :] * dx / (TWO_PI * r2i), axis=1)
    return u, v


def step_blobs(state, dt=0.01, n_steps=10, delta=None, wall=False, tracers=None, save_every=None):
    """Advance blobs (and passive tracers) with RK4. Returns frames for animation."""
    x, y, g = np.array(state["x"], float), np.array(state["y"], float), np.array(state["g"], float)
    tx = np.array(tracers["x"], float) if tracers else np.zeros(0)
    ty = np.array(tracers["y"], float) if tracers else np.zeros(0)
    if delta is None:
        delta = float(state.get("delta", 0.03))
    nb = len(x)
    save_every = save_every or n_steps
    frames = []

    def f(X, Y):
        u, v = _blob_velocity(X, Y, X[:nb], Y[:nb], g, delta, wall)
        return u, v

    X = np.concatenate([x, tx])
    Y = np.concatenate([y, ty])
    for s in range(n_steps):
        k1 = f(X, Y)
        k2 = f(X + 0.5 * dt * k1[0], Y + 0.5 * dt * k1[1])
        k3 = f(X + 0.5 * dt * k2[0], Y + 0.5 * dt * k2[1])
        k4 = f(X + dt * k3[0], Y + dt * k3[1])
        X = X + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
        Y = Y + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
        if wall:
            Y = np.maximum(Y, 1e-4)
        if (s + 1) % save_every == 0:
            frames.append({"x": X[:nb].copy(), "y": Y[:nb].copy(), "tx": X[nb:].copy(), "ty": Y[nb:].copy()})
    return {"x": X[:nb], "y": Y[:nb], "g": g, "owner": state.get("owner"), "delta": delta,
            "tx": X[nb:], "ty": Y[nb:], "frames": frames}


def point_vortex_pair_theory(g1, g2, d):
    """Analytical motion of two point vortices: rotation rate or translation speed."""
    if abs(g1 + g2) < 1e-12:
        return {"type": "translate", "speed": abs(g1) / (TWO_PI * d)}
    omega = (g1 + g2) / (TWO_PI * d**2)
    return {"type": "rotate", "omega": omega, "centroid_weight": [g1 / (g1 + g2), g2 / (g1 + g2)]}


# ------------------------------------------------------------------ Kelvin-Helmholtz
def kh_init(n=200, amp=0.01, subharmonic=0.0, wavelengths=2):
    x = np.arange(n) / n
    y = amp * (np.sin(TWO_PI * wavelengths * x) + subharmonic * np.sin(TWO_PI * x))
    return {"x": x, "y": y, "n": n}


def kh_step(state, dt=0.01, n_steps=20, delta=0.1, save_every=5):
    """Periodic (period 1) vortex sheet, unit velocity jump, Krasny's regularised kernel."""
    x = np.array(state["x"], float)
    y = np.array(state["y"], float)
    n = len(x)

    def vel(x, y):
        dx = TWO_PI * (x[:, None] - x[None, :])
        dy = TWO_PI * (y[:, None] - y[None, :])
        den = np.cosh(dy) - np.cos(dx) + delta**2
        u = -np.sum(np.sinh(dy) / den, axis=1) / (2 * n)
        v = np.sum(np.sin(dx) / den, axis=1) / (2 * n)
        return u, v

    frames = []
    for s in range(n_steps):
        k1 = vel(x, y)
        k2 = vel(x + 0.5 * dt * k1[0], y + 0.5 * dt * k1[1])
        k3 = vel(x + 0.5 * dt * k2[0], y + 0.5 * dt * k2[1])
        k4 = vel(x + dt * k3[0], y + dt * k3[1])
        x = x + dt / 6 * (k1[0] + 2 * k2[0] + 2 * k3[0] + k4[0])
        y = y + dt / 6 * (k1[1] + 2 * k2[1] + 2 * k3[1] + k4[1])
        if (s + 1) % save_every == 0:
            frames.append({"x": x.copy(), "y": y.copy()})
    thickness = float(np.ptp(y))
    return {"x": x, "y": y, "frames": frames, "thickness": thickness}


def kh_growth_rate(wavenumber, delta_u=1.0):
    """Linear growth rate of KH for a vortex sheet: sigma = k dU / 2."""
    return 0.5 * wavenumber * delta_u


# ------------------------------------------------------------------ breakdown
def breakdown(swirl=0.6, dp_max=0.3, n=200, rho=1.0, W0=1.0):
    """Quasi-cylindrical model of a Lamb-Oseen vortex core entering a pressure rise.

    Along the axis (inviscid): p_axis + rho W^2/2 = const. The axis pressure is the
    external pressure minus the swirl-induced core deficit rho ln2 (Gamma/2 pi a)^2,
    and mass conservation in the core tube gives a^2 W = const. Hence

        W^2/2 - K W / W0 = W0^2/2 - K - dp(x)/rho,   K = ln2 (Gamma / 2 pi a0)^2

    The solution ceases to exist (fold) when the axial velocity falls to W = K/W0:
    the core cannot decelerate smoothly any more -> breakdown (stagnation point and
    recirculation bubble/spiral). Critical pressure rise:
        dp_crit / rho = (W0 - K/W0)^2 / 2  -> decreases with swirl.
    The model ignores viscosity and the radial adjustment of the core, so its
    critical swirl (~0.77 here) is lower than measured values (~1.3-1.5): use it for
    trends (higher swirl -> breaks down with a weaker adverse gradient).

    swirl = v_theta,max / W0 (Lamb-Oseen v_theta,max = 0.638 Gamma/(2 pi a)).
    dp_max = maximum external pressure rise divided by rho W0^2 (ramp along x).
    """
    x = np.linspace(0, 1, n)
    dp = dp_max * rho * W0**2 * (3 * x**2 - 2 * x**3)  # smooth ramp
    K = LN2 * (swirl / 0.6382) ** 2 * W0**2
    rhs = 0.5 * W0**2 - K - dp / rho
    # solve W^2/2 - (K/W0) W - rhs = 0 -> W = K/W0 + sqrt((K/W0)^2 + 2 rhs)
    disc = (K / W0) ** 2 + 2 * rhs
    supercritical = K / W0**2 >= 1.0
    W = np.where(disc >= 0, K / W0 + np.sqrt(np.maximum(disc, 0)), np.nan)
    if supercritical:
        W[:] = np.nan
    a2 = np.where(np.isfinite(W), W0 / np.maximum(W, 1e-6), np.nan)
    bad = np.where(~np.isfinite(W))[0]
    x_bd = float(x[bad[0]]) if len(bad) else None
    dp_crit = 0.5 * (W0 - K / W0) ** 2 * rho if not supercritical else 0.0
    return {"x": x, "dp": dp, "W": W, "core_radius": np.sqrt(a2), "x_breakdown": x_bd,
            "dp_crit": dp_crit, "swirl_crit_model": float(0.6382 / np.sqrt(LN2)),
            "supercritical": bool(supercritical)}
