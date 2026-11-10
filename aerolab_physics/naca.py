"""Airfoil geometry: NACA 4- and 5-digit sections and simple geometric operations.

All contours are returned as closed node lists ordered **clockwise**:
trailing edge (lower) -> leading edge -> trailing edge (upper), with the first
and last node both at the trailing edge. This is the ordering expected by
:mod:`aerolab_physics.panel`.

Ref: Abbott & von Doenhoff, *Theory of Wing Sections* (1959), ch. 6.
"""
from __future__ import annotations

import numpy as np


def _thickness(x: np.ndarray, t: float, closed_te: bool = True) -> np.ndarray:
    a4 = -0.1036 if closed_te else -0.1015
    return 5.0 * t * (0.2969 * np.sqrt(x) - 0.1260 * x - 0.3516 * x**2 + 0.2843 * x**3 + a4 * x**4)


def _camber4(x: np.ndarray, m: float, p: float) -> tuple[np.ndarray, np.ndarray]:
    yc = np.zeros_like(x)
    dyc = np.zeros_like(x)
    if m <= 0 or p <= 0:
        return yc, dyc
    fwd = x < p
    yc[fwd] = m / p**2 * (2 * p * x[fwd] - x[fwd] ** 2)
    dyc[fwd] = 2 * m / p**2 * (p - x[fwd])
    aft = ~fwd
    yc[aft] = m / (1 - p) ** 2 * ((1 - 2 * p) + 2 * p * x[aft] - x[aft] ** 2)
    dyc[aft] = 2 * m / (1 - p) ** 2 * (p - x[aft])
    return yc, dyc


# NACA 5-digit standard (non-reflexed) mean lines: code LP -> (r, k1)
_FIVE_DIGIT = {
    "210": (0.0580, 361.400),
    "220": (0.1260, 51.640),
    "230": (0.2025, 15.957),
    "240": (0.2900, 6.643),
    "250": (0.3910, 3.230),
}


def _camber5(x: np.ndarray, key: str, design_cl: float) -> tuple[np.ndarray, np.ndarray]:
    r, k1 = _FIVE_DIGIT[key]
    k1 = k1 * design_cl / 0.3
    yc = np.empty_like(x)
    dyc = np.empty_like(x)
    fwd = x < r
    xf = x[fwd]
    yc[fwd] = k1 / 6 * (xf**3 - 3 * r * xf**2 + r**2 * (3 - r) * xf)
    dyc[fwd] = k1 / 6 * (3 * xf**2 - 6 * r * xf + r**2 * (3 - r))
    yc[~fwd] = k1 * r**3 / 6 * (1 - x[~fwd])
    dyc[~fwd] = -k1 * r**3 / 6
    return yc, dyc


def naca(code: str, n_panels: int = 140, closed_te: bool = True) -> tuple[np.ndarray, np.ndarray]:
    """Return (x, y) clockwise nodes of a NACA 4- or 5-digit airfoil of unit chord.

    ``n_panels`` is the total number of panels (rounded to an even number);
    cosine spacing clusters nodes at the leading and trailing edges.
    """
    code = str(code).strip()
    n_side = max(int(n_panels) // 2, 8)
    beta = np.linspace(0.0, np.pi, n_side + 1)
    xc = 0.5 * (1 - np.cos(beta))  # 0 (LE) .. 1 (TE)

    if len(code) == 4:
        m = int(code[0]) / 100.0
        p = int(code[1]) / 10.0
        t = int(code[2:]) / 100.0
        yc, dyc = _camber4(xc, m, p)
    elif len(code) == 5:
        design_cl = int(code[0]) * 0.15
        key = code[:3]
        if key not in _FIVE_DIGIT:
            raise ValueError(f"unsupported 5-digit mean line {key}")
        t = int(code[3:]) / 100.0
        yc, dyc = _camber5(xc, key, design_cl)
    else:
        raise ValueError("NACA code must have 4 or 5 digits")

    yt = _thickness(xc, t, closed_te)
    th = np.arctan(dyc)
    xu, yu = xc - yt * np.sin(th), yc + yt * np.cos(th)
    xl, yl = xc + yt * np.sin(th), yc - yt * np.cos(th)
    # clockwise: TE lower -> LE -> TE upper
    x = np.concatenate([xl[::-1], xu[1:]])
    y = np.concatenate([yl[::-1], yu[1:]])
    if closed_te:
        x[0] = x[-1] = 1.0
        y[0] = y[-1] = 0.5 * (y[0] + y[-1])
    return x, y


def ellipse(thickness_ratio: float, n_panels: int = 140) -> tuple[np.ndarray, np.ndarray]:
    """Elliptic section of unit chord, x in [0, 1], clockwise from the trailing edge."""
    n = max(int(n_panels), 16)
    phi = np.linspace(0.0, 2 * np.pi, n + 1)
    # phi = 0 at TE, going clockwise means y decreasing first
    x = 0.5 + 0.5 * np.cos(phi)
    y = -0.5 * thickness_ratio * np.sin(phi)
    x[-1], y[-1] = x[0], y[0]
    return x, y


def camber_line(code: str, n: int = 101) -> tuple[np.ndarray, np.ndarray]:
    """Mean line of a NACA 4-/5-digit section."""
    xc = 0.5 * (1 - np.cos(np.linspace(0, np.pi, n)))
    code = str(code)
    if len(code) == 4:
        yc, _ = _camber4(xc, int(code[0]) / 100.0, int(code[1]) / 10.0)
    else:
        yc, _ = _camber5(xc, code[:3], int(code[0]) * 0.15)
    return xc, yc


def deflect_plain_flap(x: np.ndarray, y: np.ndarray, hinge_x: float, delta_deg: float) -> tuple[np.ndarray, np.ndarray]:
    """Rotate the part of the contour aft of ``hinge_x`` by ``delta_deg`` (positive = trailing edge down).

    The hinge sits on the local mean line. Simple geometric model of a sealed plain flap.
    """
    x = np.array(x, dtype=float)
    y = np.array(y, dtype=float)
    if abs(delta_deg) < 1e-9:
        return x, y
    lower = np.arange(len(x)) <= np.argmin(x)
    yl = np.interp(hinge_x, x[lower][::-1], y[lower][::-1])
    yu = np.interp(hinge_x, x[~lower], y[~lower])
    hx, hy = hinge_x, 0.5 * (yl + yu)
    d = -np.radians(delta_deg)
    c, s = np.cos(d), np.sin(d)
    aft = x > hinge_x
    dx, dy = x[aft] - hx, y[aft] - hy
    x[aft] = hx + c * dx - s * dy
    y[aft] = hy + s * dx + c * dy
    return x, y


def transform(x, y, scale=1.0, angle_deg=0.0, pivot=(0.0, 0.0), dx=0.0, dy=0.0):
    """Scale about the origin, rotate by ``angle_deg`` about ``pivot``, then translate.

    Convention: positive ``angle_deg`` rotates **trailing edge down** (flap-like deflection).
    """
    x = np.asarray(x, dtype=float) * scale
    y = np.asarray(y, dtype=float) * scale
    a = -np.radians(angle_deg)
    c, s = np.cos(a), np.sin(a)
    px, py = pivot
    xr = px + c * (x - px) - s * (y - py)
    yr = py + s * (x - px) + c * (y - py)
    return xr + dx, yr + dy


def flip_vertical(x, y):
    """Mirror a clockwise contour about y = 0 (upside-down wing), keeping clockwise order."""
    return np.asarray(x)[::-1].copy(), -np.asarray(y)[::-1].copy()


def add_gurney(x, y, h: float, wedge_len_factor: float = 3.0, depth_factor: float = 0.7):
    """Equivalent-body model of a Gurney flap of height ``h`` (fraction of chord).

    The flap and the separated region behind it are replaced by a thin wedge
    (dividing-streamline model): the pressure-side contour drops to the flap tip
    (1, y_te - h) and closes on a virtual trailing edge located ``wedge_len_factor*h``
    downstream and ``depth_factor*h`` below the real trailing edge (calibrated to give
    dCl ~ 0.2-0.3 for h = 1-2 % c, as measured). The Kutta condition is then
    applied at the virtual trailing edge, which reproduces the shift of the Kutta
    point that a real Gurney flap produces (Liebeck 1978; Jeffrey et al. 2000).
    """
    x = np.asarray(x, dtype=float)
    y = np.asarray(y, dtype=float)
    if h <= 0:
        return x, y
    xte, yte = x[0], y[0]
    tip = (xte, yte - h)
    vte = (xte + wedge_len_factor * h, yte - depth_factor * h)
    # lower surface (start of array) : virtual TE -> tip -> original lower surface (skip TE node)
    xn = np.concatenate([[vte[0], tip[0]], x[1:-1], [xte, vte[0]]])
    yn = np.concatenate([[vte[1], tip[1]], y[1:-1], [yte, vte[1]]])
    return xn, yn
