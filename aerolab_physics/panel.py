"""2D linear-strength vortex panel method (multi-element, optional ground plane).

Model
-----
Each element is a closed clockwise contour of N straight panels carrying a vortex
sheet whose strength varies linearly between the N+1 nodes. Unknowns are the node
strengths. Equations: flow tangency (zero normal velocity) at the N panel midpoints
plus one Kutta condition per element, gamma_TE,lower + gamma_TE,upper = 0
(equal speeds leaving the trailing edge, i.e. smooth flow-off).

With the interior of each body at rest, the surface speed equals the local sheet
strength, so Cp = 1 - (gamma/V_inf)^2.

Ground effect uses the method of images: every vortex panel has a mirror image
about y = y_ground with opposite circulation, which enforces v = 0 on the ground.

Sign conventions: vortex strength positive counter-clockwise; lift positive in +y.
Free stream has unit speed, angle of attack ``alpha`` (positive = flow from below).

Refs: Katz & Plotkin, *Low-Speed Aerodynamics* (2001), §11.4; Kuethe & Chow (1998).
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

TWO_PI = 2.0 * np.pi


@dataclass
class Element:
    x: np.ndarray
    y: np.ndarray
    name: str = "element"

    def __post_init__(self):
        self.x = np.asarray(self.x, dtype=float)
        self.y = np.asarray(self.y, dtype=float)
        dx = np.diff(self.x)
        dy = np.diff(self.y)
        self.L = np.hypot(dx, dy)
        self.L[self.L < 1e-12] = 1e-12
        self.tx = dx / self.L
        self.ty = dy / self.L
        self.nx = -self.ty  # outward normal for a clockwise contour
        self.ny = self.tx
        self.xc = 0.5 * (self.x[:-1] + self.x[1:])
        self.yc = 0.5 * (self.y[:-1] + self.y[1:])

    @property
    def n_panels(self) -> int:
        return len(self.L)


def _panel_influence(px, py, el: Element):
    """Velocity at points (px, py) induced by unit node strengths of element ``el``.

    Returns (U, V), each of shape (P, N+1): column k is the velocity induced when
    node k has unit strength and all other nodes zero.
    """
    px = np.asarray(px, dtype=float)[:, None]
    py = np.asarray(py, dtype=float)[:, None]
    xs, ys = el.x[:-1][None, :], el.y[:-1][None, :]
    tx, ty, L = el.tx[None, :], el.ty[None, :], el.L[None, :]
    rx, ry = px - xs, py - ys
    xl = rx * tx + ry * ty
    yl = -rx * ty + ry * tx
    th1 = np.arctan2(yl, xl)
    th2 = np.arctan2(yl, xl - L)
    A = th2 - th1
    r1sq = xl**2 + yl**2 + 1e-14
    r2sq = (xl - L) ** 2 + yl**2 + 1e-14
    B = 0.5 * np.log(r1sq / r2sq)
    P1 = (xl * A - yl * B) / L
    P2 = (xl * B - L + yl * A) / L
    ua = -(A - P1) / TWO_PI
    va = (B - P2) / TWO_PI
    ub = -P1 / TWO_PI
    vb = P2 / TWO_PI
    # local -> global (t, n) with n = (-ty, tx)
    Ua = ua * tx - va * ty
    Va = ua * ty + va * tx
    Ub = ub * tx - vb * ty
    Vb = ub * ty + vb * tx
    P, N = Ua.shape
    U = np.zeros((P, N + 1))
    V = np.zeros((P, N + 1))
    U[:, :-1] += Ua
    U[:, 1:] += Ub
    V[:, :-1] += Va
    V[:, 1:] += Vb
    return U, V


def _source_influence_el(px, py, el: Element):
    """Velocity at points from unit constant-strength source panels of one element (P, N).

    Self-influence at a panel midpoint is the outer-side value (normal velocity 1/2).
    """
    px = np.asarray(px, dtype=float)[:, None]
    py = np.asarray(py, dtype=float)[:, None]
    xs, ys = el.x[:-1][None, :], el.y[:-1][None, :]
    tx, ty, L = el.tx[None, :], el.ty[None, :], el.L[None, :]
    rx, ry = px - xs, py - ys
    xl = rx * tx + ry * ty
    yl = -rx * ty + ry * tx
    A = np.arctan2(yl, xl - L) - np.arctan2(yl, xl)
    B = 0.5 * np.log((xl**2 + yl**2 + 1e-14) / ((xl - L) ** 2 + yl**2 + 1e-14))
    u = B / TWO_PI
    v = A / TWO_PI
    return u * tx - v * ty, u * ty + v * tx


def source_influence(px, py, elements: list[Element], ground_y: float | None = None):
    """Velocity from unit source panels of all elements (with ground images, same sign)."""
    Us, Vs = [], []
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    for el in elements:
        U, V = _source_influence_el(px, py, el)
        if ground_y is not None:
            Ui, Vi = _source_influence_el(px, 2 * ground_y - py, el)
            U = U + Ui
            V = V - Vi
        Us.append(U)
        Vs.append(V)
    return np.hstack(Us), np.hstack(Vs)


def influence(px, py, elements: list[Element], ground_y: float | None = None):
    """Influence matrices of all node strengths at points, including ground images."""
    Us, Vs = [], []
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    for el in elements:
        U, V = _panel_influence(px, py, el)
        if ground_y is not None:
            # image system: u_img(P) = u(P'), v_img(P) = -v(P'), P' mirrored point
            Ui, Vi = _panel_influence(px, 2 * ground_y - py, el)
            U = U + Ui
            V = V - Vi
        Us.append(U)
        Vs.append(V)
    return np.hstack(Us), np.hstack(Vs)


@dataclass
class PanelSolution:
    elements: list[Element]
    alpha: float
    ground_y: float | None
    gamma: np.ndarray
    offsets: list[int] = field(default_factory=list)

    def element_gamma(self, i: int) -> np.ndarray:
        return self.gamma[self.offsets[i] : self.offsets[i + 1]]


class PanelSystem:
    """Factorised panel system; solves any angle of attack by superposition."""

    def __init__(self, elements: list[Element], ground_y: float | None = None):
        self.elements = elements
        self.ground_y = ground_y
        xc = np.concatenate([e.xc for e in elements])
        yc = np.concatenate([e.yc for e in elements])
        nx = np.concatenate([e.nx for e in elements])
        ny = np.concatenate([e.ny for e in elements])
        U, V = influence(xc, yc, elements, ground_y)
        An = U * nx[:, None] + V * ny[:, None]
        n_nodes = U.shape[1]
        offsets = [0]
        for e in elements:
            offsets.append(offsets[-1] + e.n_panels + 1)
        self.offsets = offsets
        kutta = np.zeros((len(elements), n_nodes))
        for i in range(len(elements)):
            kutta[i, offsets[i]] = 1.0
            kutta[i, offsets[i + 1] - 1] = 1.0
        self.A = np.vstack([An, kutta])
        rhs_x = np.concatenate([-nx, np.zeros(len(elements))])  # free stream (1, 0)
        rhs_y = np.concatenate([-ny, np.zeros(len(elements))])  # free stream (0, 1)
        sol = np.linalg.solve(self.A, np.column_stack([rhs_x, rhs_y]))
        self.g0 = sol[:, 0]
        self.g90 = sol[:, 1]

    def solve(self, alpha_deg: float) -> PanelSolution:
        a = np.radians(alpha_deg)
        g = np.cos(a) * self.g0 + np.sin(a) * self.g90
        return PanelSolution(self.elements, alpha_deg, self.ground_y, g, self.offsets)


def forces(sol: PanelSolution, c_ref: float = 1.0, x_ref: float = 0.25, y_ref: float = 0.0):
    """Pressure-integrated force coefficients, total and per element."""
    a = np.radians(sol.alpha)
    out = []
    tot = np.zeros(3)
    for i, el in enumerate(sol.elements):
        g = sol.element_gamma(i)
        gm = 0.5 * (g[:-1] + g[1:])
        cp = 1.0 - gm**2
        fx = -np.sum(cp * el.nx * el.L) / c_ref
        fy = -np.sum(cp * el.ny * el.L) / c_ref
        rx, ry = el.xc - x_ref, el.yc - y_ref
        # aerodynamic convention: positive nose-up (clockwise with the flow coming from -x)
        mz = np.sum(cp * (rx * el.ny - ry * el.nx) * el.L) / c_ref**2
        cl = -fx * np.sin(a) + fy * np.cos(a)
        cd = fx * np.cos(a) + fy * np.sin(a)
        circ = np.sum(gm * el.L)
        out.append({"name": el.name, "cl": cl, "cd_p": cd, "cm": mz, "circulation": circ})
        tot += [cl, cd, mz]
    return {"cl": tot[0], "cd_p": tot[1], "cm": tot[2], "elements": out,
            "cl_kj": -2.0 * sum(o["circulation"] for o in out) / c_ref}


def surface(sol: PanelSolution, i: int):
    """Node-wise surface data of element i: x, y, arc length, signed tangential speed, Cp."""
    el = sol.elements[i]
    g = sol.element_gamma(i)
    s = np.concatenate([[0.0], np.cumsum(el.L)])
    vt = -g  # velocity component along the node-ordering direction
    cp = 1.0 - g**2
    return {"x": el.x, "y": el.y, "s": s, "vt": vt, "cp": cp}


def split_surfaces(sol: PanelSolution, i: int):
    """Split element i at the stagnation point into upper and lower surfaces.

    Each returned dict has arc length from the stagnation point ``s``, edge speed ``ue``
    (>= 0), coordinates and Cp, ordered from stagnation point to trailing edge.
    """
    d = surface(sol, i)
    vt = d["vt"]
    # stagnation: vt changes sign from negative (flow going towards TE along the lower
    # surface, i.e. against node order) to positive. Pick the crossing nearest the LE.
    sgn = np.sign(vt)
    cross = np.where((sgn[:-1] <= 0) & (sgn[1:] > 0))[0]
    if len(cross) == 0:
        k = int(np.argmin(np.abs(vt)))
        frac = 0.0
    else:
        ile = int(np.argmin(d["x"]))
        k = int(cross[np.argmin(np.abs(cross - ile))])
        frac = vt[k] / (vt[k] - vt[k + 1]) if vt[k] != vt[k + 1] else 0.0
    xs = d["x"][k] + frac * (d["x"][k + 1] - d["x"][k])
    ys = d["y"][k] + frac * (d["y"][k + 1] - d["y"][k])
    ss = d["s"][k] + frac * (d["s"][k + 1] - d["s"][k])

    up_idx = np.arange(k + 1, len(vt))
    lo_idx = np.arange(k, -1, -1)
    upper = {
        "s": np.concatenate([[0.0], d["s"][up_idx] - ss]),
        "ue": np.concatenate([[0.0], np.abs(vt[up_idx])]),
        "x": np.concatenate([[xs], d["x"][up_idx]]),
        "y": np.concatenate([[ys], d["y"][up_idx]]),
    }
    lower = {
        "s": np.concatenate([[0.0], ss - d["s"][lo_idx]]),
        "ue": np.concatenate([[0.0], np.abs(vt[lo_idx])]),
        "x": np.concatenate([[xs], d["x"][lo_idx]]),
        "y": np.concatenate([[ys], d["y"][lo_idx]]),
    }
    for srf in (upper, lower):
        srf["cp"] = 1.0 - srf["ue"] ** 2
    return upper, lower, (xs, ys)


def points_inside(px, py, elements: list[Element]) -> np.ndarray:
    """Boolean mask of points inside any element (even-odd ray casting)."""
    px = np.asarray(px, dtype=float)
    py = np.asarray(py, dtype=float)
    inside = np.zeros(px.shape, dtype=bool)
    for el in elements:
        x0, y0 = el.x[:-1], el.y[:-1]
        x1, y1 = el.x[1:], el.y[1:]
        ins = np.zeros(px.shape, dtype=bool)
        for a, b, c, d in zip(x0, y0, x1, y1):
            cond = (b > py) != (d > py)
            xint = a + (py - b) * (c - a) / (d - b + 1e-300)
            ins ^= cond & (px < xint)
        inside |= ins
    return inside


def velocity_field(sol: PanelSolution, xg: np.ndarray, yg: np.ndarray):
    """Velocity (u, v) on a rectilinear grid; NaN inside bodies and below the ground."""
    X, Y = np.meshgrid(xg, yg)
    px, py = X.ravel(), Y.ravel()
    U, V = influence(px, py, sol.elements, sol.ground_y)
    a = np.radians(sol.alpha)
    u = np.cos(a) + U @ sol.gamma
    v = np.sin(a) + V @ sol.gamma
    mask = points_inside(px, py, sol.elements)
    if sol.ground_y is not None:
        mask |= py < sol.ground_y
    u[mask] = np.nan
    v[mask] = np.nan
    return u.reshape(X.shape), v.reshape(X.shape)
