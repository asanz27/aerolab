"""Viscous-inviscid interaction (VII) by surface transpiration ("blowing velocity").

The displacement effect of the boundary layer is represented, XFOIL-style, by a normal
velocity through the surface

    v_n(s) = d(u_e delta*)/ds

added to the flow-tangency condition of the panel method. The boundary layer
(Thwaites -> transition -> Head) is re-marched on the new edge velocity and the loop is
iterated with under-relaxation. Downstream of separation the displacement thickness
keeps growing with slope ``SEP_SLOPE`` (free shear layer of the dead-air region), which
blows the outer flow away from the suction side near the trailing edge: the section
"decambers" and loses circulation. This is the physical mechanism behind stall and
behind the downforce *reduction* of an inverted wing very close to the ground, which
the simpler Kirchhoff correction only approximates.

Simplifications with respect to XFOIL: direct (not inverse) boundary-layer mode, no wake
displacement, Head's method instead of lag-entrainment. Treat as a qualitative/
semi-quantitative improvement, switchable in the labs.
"""
from __future__ import annotations

import numpy as np

from . import boundary_layer as BL
from . import panel as P

SEP_SLOPE = 0.10   # d(delta*)/ds downstream of separation
VN_CAP = 0.35      # cap on |v_n| / V_inf for robustness


def _node_mass_defect(sol, i, bl_up, bl_lo, k_stag, s_up, s_lo):
    """m = u_e delta* at every node of element i (separated region extrapolated)."""
    n_nodes = len(sol.elements[i].x)
    m = np.zeros(n_nodes)
    for r, nodes, s in ((bl_up, np.arange(k_stag + 1, n_nodes), s_up), (bl_lo, np.arange(k_stag, -1, -1), s_lo)):
        ds = np.array(r["dstar"][1:], dtype=float)
        ue = np.array(r["ue"][1:], dtype=float)
        ss = np.asarray(s[1:], dtype=float)
        ok = np.isfinite(ds)
        if not np.all(ok):
            last = np.where(ok)[0]
            j = int(last[-1]) if len(last) else 0
            ue_s = ue[j]
            ds[j + 1:] = ds[j] + SEP_SLOPE * (ss[j + 1:] - ss[j])
            ue[j + 1:] = ue_s
        mm = np.nan_to_num(ue * ds)
        nn = min(len(nodes), len(mm))
        m[nodes[:nn]] = mm[:nn]
    return m


def _stag_node(sol, i):
    vt = P.surface(sol, i)["vt"]
    sgn = np.sign(vt)
    cross = np.where((sgn[:-1] <= 0) & (sgn[1:] > 0))[0]
    if len(cross) == 0:
        return int(np.argmin(np.abs(vt)))
    ile = int(np.argmin(sol.elements[i].x))
    return int(cross[np.argmin(np.abs(cross - ile))])


def solve(elements, ground_y, alpha, re=3e6, tu=0.1, iters=24, relax=0.5, vn0=None):
    """Return (solution, per-element BL dicts, blowing velocities, convergence history)."""
    sysm = P.PanelSystem(elements, ground_y)
    A_inv = np.linalg.inv(sysm.A)
    n_pan = sum(e.n_panels for e in elements)
    g_inv = sysm.solve(alpha).gamma
    pan_off = np.concatenate([[0], np.cumsum([e.n_panels for e in elements])])
    # source panels of strength sigma = v_n carry the blowing; vortex strengths are
    # re-solved so that the interior stays at rest (outer normal velocity = v_n)
    xc = np.concatenate([e.xc for e in elements])
    yc = np.concatenate([e.yc for e in elements])
    nx = np.concatenate([e.nx for e in elements])
    ny = np.concatenate([e.ny for e in elements])
    Us, Vs = P.source_influence(xc, yc, elements, ground_y)
    Sn = Us * nx[:, None] + Vs * ny[:, None]
    np.fill_diagonal(Sn, 0.5)  # own panel, outer side (avoids the atan2 branch cut)
    # the vortex sheet carries no net normal flux: project the rhs onto zero net flux
    # per element (removes the small quadrature inconsistency)
    Lall = np.concatenate([e.L for e in elements])
    Proj = np.eye(n_pan)
    for i in range(len(elements)):
        sl = slice(pan_off[i], pan_off[i + 1])
        w = Lall[sl] / Lall[sl].sum()
        Proj[sl, sl] -= np.outer(np.ones(sl.stop - sl.start), w)
    M = A_inv[:, :n_pan] @ (Proj @ (np.eye(n_pan) - Sn))
    vn = np.zeros(n_pan) if vn0 is None or len(vn0) != n_pan else np.array(vn0, dtype=float)
    hist = []
    sol = P.PanelSolution(elements, alpha, ground_y, g_inv.copy(), sysm.offsets)
    bls = [None] * len(elements)
    for it in range(iters):
        new_vn = np.zeros(n_pan)
        for i, el in enumerate(elements):
            up, lo, stag = P.split_surfaces(sol, i)
            bl = BL.airfoil_bl(up, lo, re, tu)
            bls[i] = (bl, up, lo, stag)
            k = _stag_node(sol, i)
            m = _node_mass_defect(sol, i, bl["upper"], bl["lower"], k, up["s"], lo["s"])
            L = el.L
            v = np.zeros(el.n_panels)
            j_up = np.arange(k + 1, el.n_panels)
            v[j_up] = (m[j_up + 1] - m[j_up]) / L[j_up]
            j_lo = np.arange(0, k)
            v[j_lo] = (m[j_lo] - m[j_lo + 1]) / L[j_lo]
            new_vn[pan_off[i]:pan_off[i + 1]] = np.clip(v, -VN_CAP, VN_CAP)
        vn = (1 - relax) * vn + relax * new_vn
        g = g_inv + M @ vn
        change = float(np.max(np.abs(g - sol.gamma)))
        sol = P.PanelSolution(elements, alpha, ground_y, g, sysm.offsets)
        if hist and change > hist[-1]:
            relax = max(0.15, 0.7 * relax)  # adaptive under-relaxation against oscillations
        hist.append(change)
        if change < 1e-3 and it > 2:
            break
    # final boundary layer on the converged edge velocity
    for i, el in enumerate(elements):
        up, lo, stag = P.split_surfaces(sol, i)
        bls[i] = (BL.airfoil_bl(up, lo, re, tu), up, lo, stag)
    return sol, bls, vn, hist


def source_velocity(elements, ground_y, vn, px, py):
    """Extra velocity of the blowing (source) distribution at field points."""
    Us, Vs = P.source_influence(px, py, elements, ground_y)
    return Us @ vn, Vs @ vn
