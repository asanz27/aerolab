"""Analytical 2D potential flows: elementary superposition, spinning cylinder, Joukowski airfoil.

Complex-potential conventions: W(z) = phi + i psi, dW/dz = u - i v.
A vortex of circulation Gamma (positive **clockwise**, the lifting sense for a flow
from left to right) has W = +i Gamma/(2 pi) ln z, so that Kutta-Joukowski reads
L' = rho V_inf Gamma.

Refs: Anderson, *Fundamentals of Aerodynamics* (6th ed.) ch. 3-4; Milne-Thomson (1968).
"""
from __future__ import annotations

import numpy as np

TWO_PI = 2.0 * np.pi


# ------------------------------------------------------------- superposition
def superpose(elements: list[dict], xg, yg, V=1.0, alpha_deg=0.0):
    """Velocity and stream function of uniform flow + sources/sinks/vortices/doublets.

    element: {type: 'source'|'vortex'|'doublet', x, y, strength}; vortex strength is
    clockwise-positive circulation, source strength the volume flow m, doublet kappa.
    """
    X, Y = np.meshgrid(np.asarray(xg, float), np.asarray(yg, float))
    Z = X + 1j * Y
    W, dW = _potential(elements, Z, V, alpha_deg)
    u, v = dW.real, -dW.imag
    cp = 1 - (u**2 + v**2) / V**2
    return {"x": np.asarray(xg), "y": np.asarray(yg), "u": u, "v": v, "psi": W.imag, "cp": cp}


def _velocity(elements, Z, V=1.0, alpha_deg=0.0):
    _, dW = _potential(elements, Z, V, alpha_deg)
    return dW.real, -dW.imag


def _potential(elements, Z, V, alpha_deg):
    a = np.radians(alpha_deg)
    W = V * np.exp(-1j * a) * Z
    dW = V * np.exp(-1j * a) * np.ones_like(Z)
    for e in elements:
        z0 = complex(e["x"], e["y"])
        s = float(e["strength"])
        dz = Z - z0
        dz = np.where(np.abs(dz) < 1e-9, 1e-9, dz)
        t = e["type"]
        if t == "source":
            W = W + s / TWO_PI * np.log(dz)
            dW = dW + s / TWO_PI / dz
        elif t == "vortex":
            W = W + 1j * s / TWO_PI * np.log(dz)
            dW = dW + 1j * s / TWO_PI / dz
        elif t == "doublet":
            W = W + s / TWO_PI / dz
            dW = dW - s / TWO_PI / dz**2
    return W, dW


def contour_integrals(elements, xc, yc, r, V=1.0, alpha_deg=0.0, n=720):
    """Circulation (clockwise-positive) and net outflow through a circle, by quadrature.

    Gamma = -(contour integral of V.dl, counter-clockwise) so a clockwise vortex gives +Gamma;
    Q = contour integral of V.n dl. Stokes / Gauss: they equal the enclosed vortex and source strengths.
    """
    th = np.linspace(0, TWO_PI, n, endpoint=False)
    px = xc + r * np.cos(th)
    py = yc + r * np.sin(th)
    u, v = _velocity(elements, px + 1j * py, V, alpha_deg)
    dl = r * TWO_PI / n
    tx, ty = -np.sin(th), np.cos(th)
    circ_ccw = float(np.sum(u * tx + v * ty) * dl)
    flux = float(np.sum(u * np.cos(th) + v * np.sin(th)) * dl)
    return {"gamma": -circ_ccw, "flux": flux}


# ------------------------------------------------------------- spinning cylinder
def cylinder(R=1.0, V=1.0, gamma=0.0, xg=None, yg=None, alpha_deg=0.0):
    """Lifting cylinder: doublet + uniform flow + clockwise vortex Gamma.

    Surface: u_theta = -2 V sin(theta) - Gamma/(2 pi R); Cp = 1 - (u_theta/V)^2.
    Stagnation points at sin(theta) = -Gamma/(4 pi V R) (on the body while |.| <= 1).
    """
    th = np.linspace(0, TWO_PI, 361)
    ut = -2 * V * np.sin(th) - gamma / (TWO_PI * R)
    cp_s = 1 - (ut / V) ** 2
    q = -gamma / (4 * np.pi * V * R)
    if abs(q) <= 1:
        stag = [float(np.arcsin(q)), float(np.pi - np.arcsin(q))]
        stag_pts = [[R * np.cos(t), R * np.sin(t)] for t in stag]
    else:
        # single stagnation point off the body, on the y-axis below the cylinder
        # (clockwise Gamma > 0 drives it downwards): r solves r^2 - (Gamma/(2 pi V)) r + R^2 = 0
        k = abs(gamma) / (TWO_PI * V)
        r = 0.5 * (k + np.sqrt(k**2 - 4 * R**2))
        stag_pts = [[0.0, -r if gamma > 0 else r]]
    res = {"theta": th, "cp_surface": cp_s, "stagnation": stag_pts, "cl": gamma / (R * V),
           "lift_per_rho": V * gamma}
    if xg is not None:
        a = np.radians(alpha_deg)
        X, Y = np.meshgrid(np.asarray(xg, float), np.asarray(yg, float))
        Z = X + 1j * Y
        Zs = np.where(np.abs(Z) < 1e-9, 1e-9, Z)
        W = V * (Zs * np.exp(-1j * a) + R**2 * np.exp(1j * a) / Zs) + 1j * gamma / TWO_PI * np.log(Zs)
        dW = V * (np.exp(-1j * a) - R**2 * np.exp(1j * a) / Zs**2) + 1j * gamma / (TWO_PI * Zs)
        inside = np.abs(Z) < R
        u = np.where(inside, np.nan, dW.real)
        v = np.where(inside, np.nan, -dW.imag)
        res.update(x=np.asarray(xg), y=np.asarray(yg), u=u, v=v, psi=np.where(inside, np.nan, W.imag),
                   cp=1 - (u**2 + v**2) / V**2)
    return res


# ------------------------------------------------------------- Joukowski airfoil
class Joukowski:
    """Joukowski airfoil from a circle through zeta = 1 mapped by z = zeta + 1/zeta.

    ``eps`` controls thickness, ``mu_y`` camber. ``gamma`` = None applies the Kutta
    condition (Gamma = 4 pi V R sin(alpha + beta)); a number imposes any circulation,
    which shows why the Kutta condition is needed.
    """

    def __init__(self, eps=0.1, camber=0.08, alpha_deg=5.0, V=1.0, gamma=None):
        self.mu = complex(-eps, camber)
        self.R = abs(1 - self.mu)
        self.beta = np.arcsin(camber / self.R)
        self.a = np.radians(alpha_deg)
        self.V = V
        self.gamma_kutta = 4 * np.pi * V * self.R * np.sin(self.a + self.beta)
        self.gamma = self.gamma_kutta if gamma is None else float(gamma)
        th = np.linspace(0, TWO_PI, 721)
        zeta = self.mu + self.R * np.exp(1j * th)
        z = zeta + 1 / zeta
        self.chord = float(z.real.max() - z.real.min())
        self.theta = th
        self.surface_z = z

    def dW_dzeta(self, zeta):
        s = zeta - self.mu
        return self.V * (np.exp(-1j * self.a) - self.R**2 * np.exp(1j * self.a) / s**2) + 1j * self.gamma / (TWO_PI * s)

    def W(self, zeta):
        s = zeta - self.mu
        return self.V * (s * np.exp(-1j * self.a) + self.R**2 * np.exp(1j * self.a) / s) + 1j * self.gamma / TWO_PI * np.log(s)

    def zeta_of_z(self, z):
        """Inverse map choosing the root outside the circle."""
        z = np.asarray(z, dtype=complex)
        root = np.sqrt(z**2 - 4 + 0j)
        z1 = 0.5 * (z + root)
        z2 = 0.5 * (z - root)
        return np.where(np.abs(z1 - self.mu) >= np.abs(z2 - self.mu), z1, z2)

    def velocity(self, z):
        zeta = self.zeta_of_z(z)
        dz_dzeta = 1 - 1 / zeta**2
        w = self.dW_dzeta(zeta) / np.where(np.abs(dz_dzeta) < 1e-9, 1e-9, dz_dzeta)
        return w.real, -w.imag

    def surface(self):
        zeta = self.mu + self.R * np.exp(1j * self.theta)
        dz_dzeta = 1 - 1 / zeta**2
        with np.errstate(divide="ignore", invalid="ignore"):
            w = self.dW_dzeta(zeta) / dz_dzeta
        speed = np.abs(w)
        # trailing edge (theta = -beta) is singular unless Gamma = Gamma_Kutta
        cp = 1 - speed**2 / self.V**2
        # stagnation points on the circle: zero tangential velocity
        ut = (self.dW_dzeta(zeta) * 1j * self.R * np.exp(1j * self.theta)).real
        sg = np.sign(ut)
        idx = np.where(sg[:-1] * sg[1:] < 0)[0]
        stag = []
        for k in idx:
            f = ut[k] / (ut[k] - ut[k + 1])
            th = self.theta[k] + f * (self.theta[k + 1] - self.theta[k])
            zz = self.mu + self.R * np.exp(1j * th)
            zz = zz + 1 / zz
            stag.append([float(zz.real), float(zz.imag)])
        return {"x": self.surface_z.real, "y": self.surface_z.imag, "cp": np.clip(cp, -40, 1),
                "speed": np.clip(speed, 0, 8), "stagnation": stag}

    def field(self, xg, yg):
        X, Y = np.meshgrid(np.asarray(xg, float), np.asarray(yg, float))
        Z = X + 1j * Y
        zeta = self.zeta_of_z(Z)
        inside = np.abs(zeta - self.mu) < self.R * 0.999
        u, v = self.velocity(Z)
        psi = self.W(zeta).imag
        u = np.where(inside, np.nan, u)
        v = np.where(inside, np.nan, v)
        sp = np.hypot(u, v)
        lim = 6 * self.V
        u = np.where(sp > lim, u * lim / np.maximum(sp, 1e-9), u)
        v = np.where(sp > lim, v * lim / np.maximum(sp, 1e-9), v)
        return {"x": np.asarray(xg), "y": np.asarray(yg), "u": u, "v": v,
                "psi": np.where(inside, np.nan, psi)}

    def coefficients(self):
        return {"cl": 2 * self.gamma / (self.V * self.chord), "gamma": self.gamma,
                "gamma_kutta": self.gamma_kutta, "chord": self.chord}

    def trace(self, starts, t_end=6.0, dt=0.01):
        """Path lines of particles released simultaneously (RK4 in the physical plane)."""
        P = np.array([complex(x, y) for x, y in starts])
        out = [P.copy()]
        n = int(t_end / dt)

        def vel(p):
            u, v = self.velocity(p)
            sp = np.hypot(u, v)
            lim = 6 * self.V
            fac = np.where(sp > lim, lim / np.maximum(sp, 1e-9), 1.0)
            return (u + 1j * v) * fac

        for _ in range(n):
            k1 = vel(P)
            k2 = vel(P + 0.5 * dt * k1)
            k3 = vel(P + 0.5 * dt * k2)
            k4 = vel(P + dt * k3)
            P = P + dt / 6 * (k1 + 2 * k2 + 2 * k3 + k4)
            out.append(P.copy())
        arr = np.array(out)
        return {"t": np.arange(n + 1) * dt, "x": arr.real.T, "y": arr.imag.T}


# ------------------------------------------------------------- unsteady start (Wagner)
def wagner(s_max=20.0, n=201):
    """Indicial lift build-up of a thin airfoil started impulsively (Wagner 1925).

    s = distance travelled in semi-chords (2 V t / c). R.T. Jones' approximation:
        Phi(s) = 1 - 0.165 exp(-0.0455 s) - 0.335 exp(-0.3 s),  Phi(0) = 0.5
    Bound circulation Gamma_b(s) = Phi(s) Gamma_ss. Kelvin: the vorticity shed into the
    wake up to s totals -Gamma_b(s); the sheet element shed at s' is convected with the
    free stream and lies (s - s') semi-chords behind the trailing edge.
    """
    s = np.linspace(0, s_max, n)
    phi = 1 - 0.165 * np.exp(-0.0455 * s) - 0.335 * np.exp(-0.3 * s)
    phi[0] = 0.5
    dphi = np.diff(np.concatenate([[0.0], phi]))  # includes the initial jump 0 -> 0.5
    return {"s": s, "phi": phi, "shed": -dphi}
