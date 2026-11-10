"""Static and dynamic aeroelasticity of a typical section.

Static (torsional divergence / "flexi-wing" load relief):
    the section twists about its elastic axis (EA), a distance e*c behind the aerodynamic
    centre (AC, quarter chord). Torsional stiffness K (per unit span, N m/rad).
        theta = q c^2 e a alpha0 / (K - q c^2 e a)  ->  L = L_rigid / (1 - q/q_D),
        q_D = K / (c^2 e a)   (divergence, only if e > 0, EA aft of AC)
    If the EA is *ahead* of the AC (e < 0) the wing twists nose-down under load: load
    relief at high speed (what a flexible rear wing exploits to shed drag on straights).
    For an *inverted* wing the same algebra holds with downforce.

Dynamic (classical flutter, 2 DOF pitch-plunge, steady aerodynamics by default):
    m h'' + S theta'' + K_h h = -L,   S h'' + I theta'' + K_t theta = M_EA
    L = q c a (theta + h'/V),  M_EA = e c L
    Eigenvalues of the first-order system vs speed. With *steady* aerodynamics (the h'/V
    term dropped, Hodges & Pierce ch. 5) the two frequencies approach each other and
    flutter appears where they coalesce; a real positive eigenvalue is static divergence.
    The quasi-steady option keeps h'/V but is known to give spurious low-speed instability.
"""
from __future__ import annotations

import numpy as np

RHO = 1.2


def divergence(e=0.15, K=1200.0, c=0.3, a=2 * np.pi, alpha0_deg=4.0, v_max=200.0, n=161):
    V = np.linspace(1.0, v_max, n)
    q = 0.5 * RHO * V**2
    qD = K / (c**2 * e * a) if e > 0 else np.inf
    lam = q * c**2 * e * a / K
    with np.errstate(divide="ignore", invalid="ignore"):
        factor = np.where(lam < 0.98, 1 / (1 - lam), np.nan)
    a0 = np.radians(alpha0_deg)
    theta = np.degrees(a0 * (factor - 1))
    L_rigid = q * c * a * a0
    return {"V": V, "load_ratio": factor, "twist_deg": theta, "L_rigid": L_rigid, "L_flex": L_rigid * factor,
            "V_div": float(np.sqrt(2 * qD / RHO)) if np.isfinite(qD) else None}


def flutter(mu=20.0, w_ratio=0.5, x_theta=0.2, r2=0.25, e=0.2, w_theta=300.0, c=0.3, v_max=250.0, n=250,
            steady=True):
    """Pitch-plunge typical section (semichord b = c/2).

    mu = m/(pi rho b^2), w_ratio = w_h/w_theta, x_theta = CG offset behind EA / b,
    r2 = (radius of gyration / b)^2, e = EA aft of AC / c.
    Returns frequencies and damping ratios of the two modes versus speed.
    """
    if x_theta**2 >= r2:
        raise ValueError(f"x_theta^2 = {x_theta**2:.3f} must be < r^2 = {r2:.3f}: the radius of gyration about the "
                         "elastic axis cannot be smaller than the CG offset (singular mass matrix)")
    b = c / 2
    m = mu * np.pi * RHO * b**2
    S = m * x_theta * b
    I = m * r2 * b**2
    w_h = w_ratio * w_theta
    Kh, Kt = m * w_h**2, I * w_theta**2
    a = 2 * np.pi
    Ms = np.array([[m, S], [S, I]])
    Vs = np.linspace(1.0, v_max, n)
    freqs = np.zeros((n, 2))
    damp = np.zeros((n, 2))
    v_flutter = None
    v_div = None
    for k, V in enumerate(Vs):
        q = 0.5 * RHO * V**2
        # aerodynamic stiffness and damping (per unit span) on [h, theta]
        Ka = np.array([[0.0, q * c * a], [0.0, -q * c * a * e * c]])
        Ca = np.array([[q * c * a / V, 0.0], [-q * c * a * e * c / V, 0.0]])
        K = np.array([[Kh, 0.0], [0.0, Kt]]) + Ka
        C = Ca * 0.0 if steady else Ca
        Minv = np.linalg.inv(Ms)
        A = np.block([[np.zeros((2, 2)), np.eye(2)], [-Minv @ K, -Minv @ C]])
        ev = np.linalg.eigvals(A)
        if v_div is None and np.any((np.abs(np.imag(ev)) <= 1e-6) & (np.real(ev) > 1e-9)):
            v_div = float(V)
        osc_only = ev[np.imag(ev) > 1e-6]
        if v_flutter is None and np.any(np.real(osc_only) > 1e-9):
            v_flutter = float(V)
        osc = ev[np.imag(ev) > 1e-6]
        osc = osc[np.argsort(np.imag(osc))]
        if len(osc) < 2:  # a mode has become non-oscillatory (static divergence)
            real = ev[np.abs(np.imag(ev)) <= 1e-6]
            real = real[np.argsort(-np.real(real))]
            osc = np.concatenate([osc, real[: 2 - len(osc)]])
        for j in range(2):
            lam = osc[j]
            wn = np.abs(lam)
            freqs[k, j] = np.imag(lam) / (2 * np.pi)
            damp[k, j] = -np.real(lam) / wn if wn > 0 else 0.0
    return {"V": Vs, "freq": freqs, "damping": damp, "V_flutter": v_flutter, "V_divergence": v_div}
