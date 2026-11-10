"""Synthetic cross-plane of streamwise vortices: the typical F1 post-processing variables.

Not a CFD result. An analytical flow (Lamb-Oseen streamwise vortices + ground image +
axial velocity deficit and total-pressure loss in the cores) evaluated on a cross plane
(y spanwise, z vertical) so that every variable can be compared on the *same* structure:

    CpT = (p0 - p0_inf)/q     total-pressure coefficient (losses: wakes, vortex cores)
    CpS = (p - p_inf)/q       static-pressure coefficient = CpT - |u|^2/U^2 + 1 - 1
    Vx, Vy, Vz                velocity components (normalised by U)
    omega_x                   streamwise vorticity (sense of rotation)
    H = u . omega             helicity; Hn = H/(|u||omega|) normalised helicity ("HeliQ"-style)
    Q = 1/2(|Omega|^2 - |S|^2) on the plane (vortex cores where Q > 0)
"""
from __future__ import annotations

import numpy as np

TWO_PI = 2 * np.pi


def vortex_plane(vortices=None, ground=True, ny=121, nz=81, y_range=(-1.0, 1.0), z_range=(0.0, 1.0)):
    """vortices: list of {y, z, gamma (ccw seen from behind, +), a (core), deficit, loss}."""
    if vortices is None:
        vortices = [{"y": -0.35, "z": 0.25, "gamma": 0.6, "a": 0.08, "deficit": 0.3, "loss": 0.6},
                    {"y": 0.35, "z": 0.25, "gamma": -0.6, "a": 0.08, "deficit": 0.3, "loss": 0.6}]
    y = np.linspace(*y_range, ny)
    z = np.linspace(*z_range, nz)
    Y, Z = np.meshgrid(y, z)
    vy = np.zeros_like(Y)
    vz = np.zeros_like(Y)
    ux = np.ones_like(Y)
    cpt = np.ones_like(Y)  # CpT = 1 means no total-pressure loss (p0 = p0_inf)

    def add(yv, zv, g, a):
        dy, dz = Y - yv, Z - zv
        r2 = dy * dy + dz * dz + 1e-12
        f = g / (TWO_PI * r2) * (1 - np.exp(-r2 / a**2))
        return -f * dz, f * dy

    for v in vortices:
        a = v.get("a", 0.08)
        u1, w1 = add(v["y"], v["z"], v["gamma"], a)
        vy += u1
        vz += w1
        if ground:
            u2, w2 = add(v["y"], -v["z"], -v["gamma"], a)
            vy += u2
            vz += w2
        g = np.exp(-((Y - v["y"]) ** 2 + (Z - v["z"]) ** 2) / a**2)
        ux -= v.get("deficit", 0.3) * g
        cpt -= v.get("loss", 0.6) * g
    # coefficients relative to the free stream (U = 1, q = 1/2): CpT = 1 - loss in this
    # normalisation is shifted so that the free stream reads CpT = 1 (the usual F1 convention)
    vel2 = ux**2 + vy**2 + vz**2
    cps = cpt - vel2  # Cp_static = Cp_total - |u|^2/U^2  (with CpT = 1 in the free stream -> CpS = 0)
    dy_ = y[1] - y[0]
    dz_ = z[1] - z[0]
    dvz_dy = np.gradient(vz, dy_, axis=1)
    dvy_dz = np.gradient(vy, dz_, axis=0)
    dvy_dy = np.gradient(vy, dy_, axis=1)
    dvz_dz = np.gradient(vz, dz_, axis=0)
    wx = dvz_dy - dvy_dz
    # in-plane gradients of the axial velocity give small transverse vorticity components
    dux_dy = np.gradient(ux, dy_, axis=1)
    dux_dz = np.gradient(ux, dz_, axis=0)
    wy = dux_dz
    wz = -dux_dy
    H = ux * wx + vy * wy + vz * wz
    wmag = np.sqrt(wx**2 + wy**2 + wz**2) + 1e-12
    Hn = H / (np.sqrt(vel2) * wmag)
    Hn = np.where(wmag > 0.05 * wmag.max(), Hn, 0.0)
    S11, S22 = dvy_dy, dvz_dz
    S12 = 0.5 * (dvy_dz + dvz_dy)
    O12 = 0.5 * (dvy_dz - dvz_dy)
    Q = 0.5 * (2 * O12**2 - (S11**2 + S22**2 + 2 * S12**2))
    return {"y": y, "z": z, "CpT": cpt, "CpS": cps, "Vx": ux, "Vy": vy, "Vz": vz, "omega_x": wx,
            "helicity": H, "helicity_n": Hn, "Q": Q, "vortices": vortices}
