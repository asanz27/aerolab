"""Whole-car aerodynamics: rear wing + beam wing + DRS, wheels, following a car,
aero map + lap-time trade-off, yaw, and cooling ducts.

Every function states its model. Where published reference values are used they are
quoted (Fackrell & Harvey 1975 for wheels; FIA/F1 2019-2021 statements for following).
"""
from __future__ import annotations

import numpy as np

from . import airfoil, panel as P, vlm

RHO = 1.2
G = 9.81


# ======================================================================= rear wing / DRS
def rear_wing_layout(main_angle=4.0, flap_angle=25.0, drs=0.0, beam=True, beam_angle=8.0,
                     gap=0.025, overlap=0.02):
    """2D layout (chords relative to the main-plane chord) of an inverted two-element rear
    wing plus an optional beam wing below it. ``drs`` (deg) rotates the flap nose-up about its
    trailing edge, opening the slot (the real DRS pivots the flap about a rear hinge)."""
    els = []
    # inverted main plane: positive angle = more downforce (TE up for an inverted wing)
    els.append({"code": "6412", "chord": 1.0, "x": 0.0, "y": 0.0, "angle": -main_angle, "invert": True, "name": "main"})
    # flap: chord 0.5, leading edge near the main TE (above it, inverted wing)
    a = np.radians(main_angle)
    te_x, te_y = np.cos(a), np.sin(a)
    fa = flap_angle - drs
    fx = te_x - overlap
    fy = te_y + gap + 0.03 + 0.25 * np.radians(drs) * 0.5
    els.append({"code": "4412", "chord": 0.5, "x": fx, "y": fy, "angle": -fa, "invert": True, "name": "flap"})
    if beam:
        els.append({"code": "4412", "chord": 0.6, "x": 0.15, "y": -1.15, "angle": -beam_angle, "invert": True, "name": "beam"})
    return els


def rear_wing(main_angle=4.0, flap_angle=25.0, drs=0.0, beam=True, beam_angle=8.0, re=1.5e6,
              span_ar=3.0, endplate_h_over_b=0.25, field=None, vii=False, probe=(0.2, -1.9)):
    """Rear wing (+ beam wing) section analysis with 3D drag build-up.

    3D: CDi = CL^2 / (pi e AR) with e from Hoerner's endplate estimate. ``probe`` is the
    point where the diffuser exhausts (below/behind the beam wing): its Cp is the "base
    pressure" the floor sees -- the beam wing's upwash lowers it ("extraction").
    """
    spec = {"elements": rear_wing_layout(main_angle, flap_angle, drs, beam, beam_angle)}
    r = airfoil.analyze(spec, 0.0, re, 0.1, None, field, True, vii)
    # sum only the rear-wing elements for the wing coefficients (beam wing separately)
    cl_w = sum(e["cl"] for e in r["elements"] if e["name"] in ("main", "flap"))
    cd_w = sum(e["cd"] for e in r["elements"] if e["name"] in ("main", "flap"))
    cl_b = sum(e["cl"] for e in r["elements"] if e["name"] == "beam")
    cd_b = sum(e["cd"] for e in r["elements"] if e["name"] == "beam")
    e_span = 1 + 1.9 * endplate_h_over_b
    # finite span: lifting-line reduction of the section C_L, then induced drag
    cl3 = cl_w / (1 + 2.0 / (e_span * span_ar))
    cdi = cl3**2 / (np.pi * e_span * span_ar)
    els = airfoil.build_elements(spec)
    sol = P.PanelSystem(els).solve(0.0)
    U, V = P.influence(np.array([probe[0]]), np.array([probe[1]]), els)
    u = 1.0 + float((U @ sol.gamma)[0])
    v = float((V @ sol.gamma)[0])
    cp_probe = 1 - (u * u + v * v)
    flap = next(e for e in r["elements"] if e["name"] == "flap")
    fx_ = np.asarray(flap["x"], dtype=float)
    xs_f = flap["bl"][flap["suction"]]["x_sep"] if flap.get("bl") else None
    flap_sep = 0.0 if xs_f is None else float(np.clip(1 - (xs_f - fx_.min()) / np.ptp(fx_), 0, 1))
    return {**r, "cl_wing": cl_w, "cl_wing_3d": cl3, "cd_wing_profile": cd_w, "cd_wing_induced": cdi,
            "cd_wing": cd_w + cdi, "downforce_wing": -cl_w, "downforce_wing_3d": -cl3, "ld_3d": float(-cl3 / (cd_w + cdi)), "cl_beam": cl_b, "cd_beam": cd_b, "probe": list(probe),
            "cp_probe": cp_probe, "upwash_deg": float(np.degrees(np.arctan2(v, u))),
            # a few % of trailing-edge separation is normal; "separated" = more than 15 % of the flap chord
            "flap_sep_frac": flap_sep, "flap_separated": flap_sep > 0.15, "e_span": e_span}


# ======================================================================= wheels
WHEEL_DATA = {  # Fackrell & Harvey (1975), isolated wheel in contact with the ground
    "stationary": {"cd": 0.77, "cl": 0.76},
    "rotating": {"cd": 0.58, "cl": 0.44},
}


def wheel_potential(gap=0.02, rotate=False, spin_circulation=0.6, field=None):
    """2D potential flow around a wheel (unit diameter) near a moving ground.

    Panels + ground images. A rolling wheel turns counter-clockwise in the car frame
    (contact patch moving with the ground); viscosity transfers part of that motion to the
    flow as circulation. ``spin_circulation`` is that circulation as a fraction of the
    surface's own circulation (pi D V) -- an illustrative parameter, not a prediction.
    """
    from . import naca

    gap = max(float(gap), 0.08)  # a 2D potential gap flow becomes meaningless as the gap closes
    x, y = naca.ellipse(1.0, 160)
    x = x - 0.5
    y = y + 0.5 + gap  # centre at height R + gap
    el = P.Element(x, y, "wheel")
    sysm = P.PanelSystem([el], 0.0)
    g0 = sysm.solve(0.0).gamma
    rhs = np.zeros(sysm.A.shape[0])
    rhs[-1] = 1.0
    gc = np.linalg.solve(sysm.A, rhs)
    L = el.L

    def circ(g):
        return float(np.sum(0.5 * (g[:-1] + g[1:]) * L))

    target = (np.pi * 1.0 * 1.0) * spin_circulation if rotate else 0.0  # ccw circulation
    d = (target - circ(g0)) / circ(gc) if abs(circ(gc)) > 1e-12 else 0.0
    g = g0 + d * gc
    sol = P.PanelSolution([el], 0.0, 0.0, g, [0, len(x)])
    F = P.forces(sol)
    cp = 1 - g**2
    th = np.degrees(np.arctan2(y - (0.5 + gap), x))
    out = {"x": x, "y": y, "cp": cp, "theta": th, "cl_potential": F["cl"], "gap": gap,
           "data": WHEEL_DATA["rotating" if rotate else "stationary"], "reference": WHEEL_DATA}
    if field:
        xg = np.linspace(field["x0"], field["x1"], int(field.get("nx", 100)))
        yg = np.linspace(field["y0"], field["y1"], int(field.get("ny", 60)))
        u, v = P.velocity_field(sol, xg, yg)
        out["field"] = {"x": xg, "y": yg, "u": u, "v": v}
    return out


def tyre_wake_steering(vane_angle=10.0, vane_y=-0.8, vane_x=-1.7, field=None):
    """Top view: front-wing endplate (a cambered vane) upstream of the front tyre.

    Positive angle turns the flow outboard (+y, away from the car: outwash).
    The tyre is a 2D circle of unit diameter at the origin; car centre-line towards -y.
    Returns the lateral flow angle in front of the tyre and the stagnation point position.
    """
    spec = {"elements": [
        {"code": "6409", "chord": 0.8, "x": vane_x, "y": vane_y, "angle": -vane_angle, "name": "vane"},
        {"ellipse": 1.0, "chord": 1.0, "x": -0.5, "y": 0.0, "name": "tyre"},
    ]}
    r = airfoil.analyze(spec, 0.0, 2e6, 0.1, None, field, False)
    els = airfoil.build_elements(spec)
    sol = P.PanelSystem(els).solve(0.0)
    U, V = P.influence(np.array([-0.75]), np.array([0.0]), els)
    u = 1 + float((U @ sol.gamma)[0])
    v = float((V @ sol.gamma)[0])
    tyre = r["elements"][1]
    front = np.where(np.asarray(tyre["x"]) < 0.0)[0]  # stagnation is on the front half
    k = int(front[np.argmax(np.asarray(tyre["cp"])[front])])
    return {**r, "flow_angle_deg": float(np.degrees(np.arctan2(v, u))),
            "stagnation": [float(tyre["x"][k]), float(tyre["y"][k])]}


# ======================================================================= following
def following(cda_lead=1.3, upwash_deg=0.0, sensitivity=2.4, z_follower=0.3, z_wake0=0.3, x_max=60.0, n=120):
    """Downforce and drag of a car following another in its turbulent wake.

    Far-wake scaling of a 3D (axisymmetric-like) turbulent wake:
        u_d/U = 0.6 (C_D A / x^2)^(1/3),  half-width b = 0.7 (C_D A x)^(1/3)
    The wake centre rises by x tan(upwash) (2022 cars throw the wake up, "mushroom"
    wake). The deficit felt by the follower is u_d exp(-((z_c - z_f)/b)^2).
    Downforce ratio = (1 - u_eff)^(2 S): S = 1 would be the pure dynamic-pressure loss;
    S > 1 captures the extra sensitivity of front wing / floor edges to the turbulent,
    misaligned flow. Drag ratio (slipstream) = (1 - u_eff)^2.
    Calibrated so that (upwash 0, S 2.4) and (upwash 8 deg, S 1.6) reproduce the figures
    published by F1/FIA for 2021 and 2022 cars (35 %/47 % and 4 %/18 % loss at 20 m/10 m).
    """
    x = np.linspace(3.0, x_max, n)
    ud = 0.6 * (cda_lead / x**2) ** (1 / 3)
    b = 0.7 * (cda_lead * x) ** (1 / 3)
    zc = z_wake0 + x * np.tan(np.radians(upwash_deg))
    ueff = ud * np.exp(-(((zc - z_follower) / b) ** 2))
    df = (1 - ueff) ** (2 * sensitivity)
    dr = (1 - ueff) ** 2
    ref = {"2021": {"x": [10, 20], "loss": [0.47, 0.35]}, "2022": {"x": [10, 20], "loss": [0.18, 0.04]}}
    return {"x": x, "deficit": ud, "deficit_felt": ueff, "wake_halfwidth": b, "wake_centre": zc,
            "downforce_ratio": df, "drag_ratio": dr, "reference": ref}


# ======================================================================= aero map + lap time
_MAP_CACHE: dict = {}


def aero_map(wing_level=1.0, n=6, fast=True):
    """Car C_L A and balance over front/rear ride heights (m).

    Components (each from AeroLab's own models):
    * front wing: inverted wing in ground effect (panel + BL), clearance = front ride height;
    * floor: 2D underbody with quasi-3D leakage + edge vortices (underbody.py), throat at the
      front ride height and rake from the rear-front difference over a 3.6 m wheelbase;
    * rear wing: constant C_L A scaled by ``wing_level``.
    Areas are chosen so that a typical setting gives C_L A ~ 4.5 m^2 with ~45 % front.
    """
    from . import underbody

    key = (round(wing_level, 3), n)
    if key in _MAP_CACHE:
        return _MAP_CACHE[key]
    hf = np.linspace(0.02, 0.07, n)
    hr = np.linspace(0.04, 0.16, n)
    wb = 3.6
    fw_chord = 0.25
    # front wing: inverted wing ground-effect curve (cached sweep over clearance)
    hs = np.linspace(0.02, 0.07, n)
    fw_cl = []
    for h in hs:
        r = airfoil.analyze({"code": "6412", "invert": True, "n": 100}, -4.0, 1.5e6, 0.1, (h + 0.06) / fw_chord)
        fw_cl.append(-r["cl"])
    fw_cl = np.array(fw_cl)
    CLA = np.zeros((n, n))
    FRONT = np.zeros((n, n))
    CDA = np.zeros((n, n))
    L_car = 3.6
    for i, f in enumerate(hf):
        for j, rr in enumerate(hr):
            rake = np.degrees(np.arctan((rr - f) / wb))
            u = underbody.analyze(h=f / L_car, rake_deg=rake, three_d=True, edge_vortex=0.7)
            floor = max(u["floor_suction"], 0.0) * L_car * 0.4  # floor C_L A (m^2): effective sealed width ~0.4 x L
            fw = float(np.interp(f, hs, fw_cl)) * 0.45  # front wing reference area ~0.45 m^2
            rw = 1.4 * wing_level
            cla = floor + fw + rw
            # front share: front wing at the front axle, rear wing at the rear, floor by its CoP
            front = (fw * 1.1 + rw * (-0.15) + floor * u["front_share"]) / cla
            CLA[j, i] = cla
            FRONT[j, i] = front
            CDA[j, i] = 0.55 + 0.05 * fw + 0.32 * rw + 0.04 * floor
    out = {"hf": hf, "hr": hr, "CLA": CLA, "front": FRONT, "CDA": CDA}
    _MAP_CACHE[key] = out
    return out


CIRCUITS = {
    # (type, length m or radius m, angle deg for corners)
    "monaco": [("s", 220), ("c", 25, 90), ("s", 160), ("c", 12, 180), ("s", 120), ("c", 20, 90), ("s", 450),
               ("c", 35, 90), ("s", 200), ("c", 15, 120), ("s", 300), ("c", 30, 90), ("s", 380), ("c", 45, 60)],
    # Monza-like: main straight, Rettifilo chicane, Curva Grande (flat), Lesmos, Ascari chicane,
    # back straight and Parabolica (5.7 km, ~75 % full throttle)
    "monza": [("s", 1100), ("c", 15, 90), ("c", 15, 90), ("s", 250), ("c", 350, 70), ("s", 500), ("c", 70, 90),
              ("s", 200), ("c", 60, 80), ("s", 950), ("c", 45, 60), ("c", 45, 60), ("c", 90, 50), ("s", 1000),
              ("c", 130, 180), ("s", 300)],
}


MU_LOAD_EXP = -0.1  # tyre load sensitivity: mu = mu0 (Fz / m g)^-0.1 (grip grows less than load)
C_RR = 0.015         # rolling-resistance coefficient of a racing tyre


def _mu(mu0, mass, down):
    return mu0 * ((mass * G + down) / (mass * G)) ** MU_LOAD_EXP


def lap_time(cla=4.5, cda=1.2, circuit="monaco", mass=850.0, power=700e3, mu=1.75, dx=2.0):
    """Quasi-steady point-mass lap simulation.

    Corner limit: mu(Fz) (m g + 1/2 rho v^2 C_L A) = m v^2 / R, with tyre load sensitivity
    mu = mu0 (Fz / m g)^-0.1 (more downforce gives proportionally less extra grip).
    Straights: forward pass with power-limited traction minus drag and rolling resistance,
    backward pass with tyre-limited braking (+ drag). Mass ~ car + driver + average fuel,
    power ~ ICE + average ERS deployment. Returns lap time and the speed trace.
    """
    segs = CIRCUITS[circuit]
    xs, vlim = [], []
    pos = 0.0
    for s in segs:
        if s[0] == "s":
            n = max(2, int(s[1] / dx))
            for _ in range(n):
                xs.append(pos)
                vlim.append(1e9)
                pos += s[1] / n
        else:
            R, ang = s[1], s[2]
            length = R * np.radians(ang)
            # solve m v^2/R = mu(Fz) Fz by fixed-point iteration (load sensitivity)
            vc = 30.0
            for _ in range(40):
                down = 0.5 * RHO * cla * vc**2
                vc_new = np.sqrt(_mu(mu, mass, down) * (mass * G + down) * R / mass)
                if abs(vc_new - vc) < 1e-3:
                    break
                vc = min(vc_new, 120.0)
            n = max(2, int(length / dx))
            for _ in range(n):
                xs.append(pos)
                vlim.append(min(vc, 120.0))
                pos += length / n
    xs = np.array(xs)
    vlim = np.array(vlim)
    ds = np.diff(np.append(xs, pos))
    v = vlim.copy()
    v[0] = min(v[0], np.min(vlim))
    # forward (traction + power limit)
    for i in range(len(v) - 1):
        vi = max(v[i], 5.0)
        drag = 0.5 * RHO * cda * vi**2
        down = 0.5 * RHO * cla * vi**2
        f_trac = min(power / vi, _mu(mu, mass, down) * (mass * G + down))
        a = (f_trac - drag - C_RR * (mass * G + down)) / mass
        v[i + 1] = min(vlim[i + 1], np.sqrt(max(vi**2 + 2 * a * ds[i], 0)))
    # backward (braking)
    for i in range(len(v) - 1, 0, -1):
        vi = v[i]
        drag = 0.5 * RHO * cda * vi**2
        down = 0.5 * RHO * cla * vi**2
        a = (_mu(mu, mass, down) * (mass * G + down) + drag) / mass
        v[i - 1] = min(v[i - 1], np.sqrt(vi**2 + 2 * a * ds[i - 1]))
    t = float(np.sum(ds / np.maximum(v, 1.0)))
    return {"time": t, "x": xs, "v": v, "v_max": float(v.max()), "v_min": float(v.min()), "length": float(pos)}


def wing_tradeoff(circuit="monaco", base_cla=3.2, base_cda=0.85, n=13):
    """Lap time versus rear-wing level (downforce added with its drag cost)."""
    levels = np.linspace(0.0, 2.4, n)
    out = {"level": levels, "time": [], "cla": [], "cda": [], "vmax": []}
    for w in levels:
        cla = base_cla + 1.4 * w
        # each wing level adds C_L A = 1.4 m^2 for ~0.45 m^2 of C_D A (incremental L/D ~ 3, as in the
        # aero map) plus a growing induced/separation share at high levels
        cda = base_cda + 0.45 * w + 0.05 * w**2
        r = lap_time(cla, cda, circuit)
        out["time"].append(r["time"])
        out["cla"].append(cla)
        out["cda"].append(cda)
        out["vmax"].append(r["v_max"])
    k = int(np.argmin(out["time"]))
    out["best_level"] = float(levels[k])
    return out


# ======================================================================= yaw
def yaw_wing(beta_deg=0.0, alpha=8.0, AR=3.0, endplate_h=0.25, ground_h=None):
    """Rear wing with endplates in sideslip (VLM).

    The endplates act as small vertical wings at incidence beta: they carry side load and
    their circulation adds to one wing tip and subtracts from the other, so the span
    loading becomes asymmetric (rolling and yawing moments).
    """
    surf = vlm.wing_surfaces(AR, 1.0, 0.0, 0.0, 0.0, 1.0, 5, 18, endplate_h)
    b = np.radians(beta_deg)
    a = np.radians(alpha)
    Vinf = np.array([np.cos(a) * np.cos(b), np.sin(b), np.sin(a) * np.cos(b)])
    A, B, C, Nrm, area, strip, sid = vlm._panels(surf)
    # trailing legs along x (small-beta approximation, keeps the lattice well posed with
    # endplates); sideslip enters through the free stream: side load on the endplates,
    # whose vertical bound vortices load the two wing tips differently
    Vind = vlm._horseshoe_velocity(C, A, B)
    if ground_h is not None:
        Vind = Vind - vlm._horseshoe_velocity(C, vlm._mirror(A, -ground_h), vlm._mirror(B, -ground_h))
    AIC = np.einsum("ijk,ik->ij", Vind, Nrm)
    Gm = np.linalg.solve(AIC, -Nrm @ Vinf)
    F = np.cross(np.tile(Vinf, (len(Gm), 1)), B - A) * Gm[:, None]  # rho = 1
    mid = 0.5 * (A + B)
    wing = sid == 0
    S = float(np.sum(area[wing]))
    q = 0.5
    total = F.sum(axis=0)
    ref = np.array([0.25 / AR, 0.0, 0.0])
    mom = np.cross(mid - ref, F).sum(axis=0)
    ys = mid[wing, 1]
    order = np.argsort(ys)
    nstrip = len(np.unique(strip[wing]))
    return {"CL": float(total[2] / (q * S)), "CY": float(total[1] / (q * S)),
            "Cyaw": float(mom[2] / (q * S)),
            "y": ys[order], "load": (F[wing, 2])[order] / (q * S) * nstrip,
            "endplate_side": [float(F[sid == k, 1].sum() / (q * S)) for k in (1, 2)] if endplate_h > 0 else []}


def floor_yaw(beta_deg=0.0, beta_crit=6.0, **floor_kw):
    """Floor downforce in yaw (semi-empirical, built on the quasi-3D underbody model).

    In yaw the windward floor edge sees cross-flow: its edge vortex is weakened (sealing
    lost linearly up to ``beta_crit``) while the leeward one is slightly reinforced. Each
    half of the floor uses its own leakage factor; the imbalance gives a rolling moment.
    """
    from . import underbody

    ev = float(floor_kw.pop("edge_vortex", 0.7))
    b = abs(beta_deg)
    ev_w = ev * max(0.0, 1 - b / beta_crit)
    ev_l = min(1.0, ev * (1 + 0.2 * b / beta_crit))
    rw = underbody.analyze(three_d=True, edge_vortex=ev_w, **floor_kw)
    rl = underbody.analyze(three_d=True, edge_vortex=ev_l, **floor_kw)
    r0 = underbody.analyze(three_d=True, edge_vortex=ev, **floor_kw)
    fw, fl, f0 = rw["floor_suction"], rl["floor_suction"], r0["floor_suction"]
    return {"floor_ratio": 0.5 * (fw + fl) / f0 if f0 > 0 else 1.0, "windward": fw / f0 if f0 > 0 else 1,
            "leeward": fl / f0 if f0 > 0 else 1, "roll_imbalance": (fl - fw) / (fl + fw) if fl + fw > 0 else 0.0}


def yaw_sweep(alpha=8.0, AR=3.0, endplate_h=0.25, n=9):
    betas = np.linspace(0, 8, n)
    rows = [yaw_wing(b, alpha, AR, endplate_h) for b in betas]
    fl = [floor_yaw(b) for b in betas]
    return {"beta": betas, "CL": [r["CL"] for r in rows], "CY": [r["CY"] for r in rows],
            "Cyaw": [r["Cyaw"] for r in rows],
            # rolling moment: the wing's is ~0 here (wake legs along x, no dihedral); the physical
            # source in yaw is the floor's windward/leeward suction imbalance
            "roll_imbalance": [f["roll_imbalance"] for f in fl],
            "floor_ratio": [f["floor_ratio"] for f in fl], "floor_windward": [f["windward"] for f in fl],
            "floor_leeward": [f["leeward"] for f in fl]}


# ======================================================================= cooling
def cooling(V=70.0, A_in=0.04, A_rad=0.12, A_exit=0.03, K=12.0, cp_exit=-0.3, dT=60.0, eff=0.6,
            meredith=True, T_inf=300.0):
    """Radiator duct: inlet (ram) -> radiator (loss K on radiator velocity) -> exit at Cp_exit.

    Total pressure: p_inf + q  =  p_exit + 1/2 rho_e u_e^2 + K 1/2 rho u_r^2   (inlet ideal)
    Continuity:     rho u_r A_rad = rho_e u_e A_exit, rho_e = rho T_inf / (T_inf + dT_air).
    Heat:           Q = m_dot c_p dT_air,  dT_air = eff * dT (coolant - air).
    Cooling drag:   D = m_dot (V - u_e) - (p_exit - p_inf) A_exit   (momentum deficit).
    The heated air leaves faster (Meredith effect), partially recovering drag.
    """
    cpa = 1005.0
    q = 0.5 * RHO * V**2
    dTa = eff * dT
    rho_e = RHO * T_inf / (T_inf + (dTa if meredith else 0.0))
    # unknown u_r: (q - cp_exit q) = 1/2 rho_e u_e^2 + K 1/2 rho u_r^2, u_e = rho u_r A_r /(rho_e A_e)
    ratio = RHO * A_rad / (rho_e * A_exit)
    denom = 0.5 * rho_e * ratio**2 + K * 0.5 * RHO
    u_r = np.sqrt(max(q * (1 - cp_exit), 0) / denom)
    # inlet cannot swallow more than the free-stream tube through A_in (spillage limit)
    u_r = min(u_r, V * A_in / A_rad * 1.0)
    mdot = RHO * u_r * A_rad
    u_e = mdot / (rho_e * A_exit)
    Q = mdot * cpa * dTa
    p_e = cp_exit * q
    D = mdot * (V - u_e) - p_e * A_exit
    return {"mdot": mdot, "u_rad": u_r, "u_exit": u_e, "Q_kW": Q / 1000, "drag_N": D, "CDA_cooling": D / q,
            "inlet_velocity_ratio": u_r * A_rad / (A_in * V)}


def cooling_sweep(**kw):
    areas = np.linspace(0.01, 0.08, 30)
    rows = [cooling(**{**kw, "A_exit": a}) for a in areas]
    return {"A_exit": areas, "Q_kW": [r["Q_kW"] for r in rows], "drag_N": [r["drag_N"] for r in rows],
            "mdot": [r["mdot"] for r in rows]}
