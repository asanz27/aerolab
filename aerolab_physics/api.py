"""JSON entry point used by the web front-end (through Pyodide) and by notebooks.

    call("airfoil.analyze", '{"spec": {"code": "4412"}, "alpha": 5}') -> JSON string

Every endpoint takes keyword arguments and returns plain Python / NumPy data,
serialised here (NaN -> null so JavaScript can parse it).
"""
from __future__ import annotations

import json
import time

import numpy as np

from . import airfoil, boundary_layer as BL, cfd, delta, drag, floor, lifting_line as LL
from . import aeroelastic, car, compressible, postpro, duct, flowcontrol, naca, nozzle, potential, reference_data, tunnel, underbody, unsteady, vlm, vortex

ENDPOINTS = {}


def endpoint(name):
    def deco(fn):
        ENDPOINTS[name] = fn
        return fn
    return deco


def _clean(o):
    if isinstance(o, dict):
        return {str(k): _clean(v) for k, v in o.items() if not str(k).startswith("_")}
    if isinstance(o, (list, tuple)):
        return [_clean(v) for v in o]
    if isinstance(o, np.ndarray):
        if o.dtype.kind == "c":
            return {"re": o.real.tolist(), "im": o.imag.tolist()}
        if o.dtype.kind in "biu":
            return o.tolist()
        return np.asarray(o, dtype=float).tolist()
    if isinstance(o, (np.floating,)):
        return float(o)
    if isinstance(o, (np.integer,)):
        return int(o)
    if isinstance(o, (np.bool_,)):
        return bool(o)
    if isinstance(o, complex):
        return [o.real, o.imag]
    return o


def call(name: str, params_json: str = "{}") -> str:
    t0 = time.perf_counter()
    try:
        params = json.loads(params_json) if params_json else {}
        if name not in ENDPOINTS:
            raise KeyError(f"unknown endpoint {name}")
        result = ENDPOINTS[name](**params)
        payload = {"ok": True, "result": _clean(result)}
    except Exception as exc:  # report errors to the UI instead of crashing the worker
        import traceback
        payload = {"ok": False, "error": f"{type(exc).__name__}: {exc}", "trace": traceback.format_exc()}
    payload["ms"] = round((time.perf_counter() - t0) * 1000, 1)
    s = json.dumps(payload, allow_nan=True)
    return s.replace("-Infinity", "-1e308").replace("Infinity", "1e308").replace("NaN", "null")


def _grid(field):
    return field if field else None


# ------------------------------------------------------------------ potential flow
@endpoint("potential.superpose")
def _superpose(elements, x0=-3, x1=3, y0=-2, y1=2, nx=90, ny=60, alpha=0.0, V=1.0, circle=None):
    out = potential.superpose(elements, np.linspace(x0, x1, nx), np.linspace(y0, y1, ny), V, alpha)
    if circle:
        out["circle"] = potential.contour_integrals(elements, circle["x"], circle["y"], circle["r"], V, alpha)
    return out


@endpoint("potential.cylinder")
def _cylinder(gamma=0.0, x0=-3, x1=3, y0=-2, y1=2, nx=96, ny=64):
    return potential.cylinder(1.0, 1.0, gamma, np.linspace(x0, x1, nx), np.linspace(y0, y1, ny))


@endpoint("joukowski.solve")
def _jouk(eps=0.1, camber=0.08, alpha=5.0, gamma=None, x0=-3.2, x1=3.2, y0=-1.8, y1=1.8, nx=110, ny=64):
    J = potential.Joukowski(eps, camber, alpha, 1.0, gamma)
    return {"surface": J.surface(), "field": J.field(np.linspace(x0, x1, nx), np.linspace(y0, y1, ny)),
            **J.coefficients()}


@endpoint("joukowski.trace")
def _jtrace(eps=0.1, camber=0.08, alpha=5.0, starts=None, t_end=5.0, dt=0.01, gamma=None):
    J = potential.Joukowski(eps, camber, alpha, 1.0, gamma)
    starts = starts or [[-3.5, y] for y in np.linspace(-0.6, 0.6, 13)]
    r = J.trace(starts, t_end, dt)
    k = max(1, int(0.05 / dt))
    return {"t": r["t"][::k], "x": r["x"][:, ::k], "y": r["y"][:, ::k], "surface": J.surface()}


@endpoint("duct.solve")
def _duct(ctrl_x=None, ctrl_h=None, U_in=10.0):
    return duct.solve(ctrl_x, ctrl_h, U_in)


@endpoint("unsteady.simulate")
def _unsteady(code="0012", motion="step", alpha0=5.0, amp=5.0, k=0.3, heave=0.0, t_end=10.0, dt=0.05, save_every=4):
    return unsteady.simulate(code, motion, alpha0, amp, k, heave, 0.25, t_end, dt, 70, 0.03, save_every)


@endpoint("unsteady.theodorsen")
def _theod(alpha0=0.0, amp=5.0, k=0.3, pivot=0.25):
    r = unsteady.theodorsen_pitch_loop(alpha0, amp, k, pivot)
    ks = np.geomspace(0.01, 3, 50)
    C = unsteady.theodorsen(ks)
    return {**r, "k": ks, "F": C.real, "G": C.imag}


@endpoint("reference.data")
def _ref():
    return {"naca0012": reference_data.NACA0012, "zerihan": reference_data.ZERIHAN_ZHANG,
            "wheel": reference_data.WHEEL, "following": reference_data.FOLLOWING}


@endpoint("lift.wagner")
def _wagner(s_max=20.0, n=201):
    return potential.wagner(s_max, n)


# ------------------------------------------------------------------ airfoils
@endpoint("naca.coords")
def _naca(code="2412", n=140):
    x, y = naca.naca(code, n)
    xc, yc = naca.camber_line(code)
    return {"x": x, "y": y, "xc": xc, "yc": yc}


@endpoint("airfoil.analyze")
def _analyze(spec=None, alpha=4.0, re=3e6, tu=0.1, ground_h=None, field=None, viscous=True, vii=False):
    return airfoil.analyze(spec or {"code": "2412"}, alpha, re, tu, ground_h, field, viscous, vii)


@endpoint("airfoil.polar")
def _polar(spec=None, alphas=None, re=3e6, tu=0.1, ground_h=None, vii=False):
    alphas = np.arange(-6, 22.1, 1.0) if alphas is None else alphas
    if vii:  # VII is ~10x more expensive: coarser alpha step
        alphas = np.asarray(alphas, dtype=float)[::2]
    return airfoil.polar(spec or {"code": "2412"}, alphas, re, tu, ground_h, vii)


@endpoint("airfoil.thin")
def _thin(code="2412"):
    return airfoil.thin_airfoil(code)


@endpoint("airfoil.ground_sweep")
def _ground_sweep(spec=None, alpha=-4.0, re=3e6, tu=0.1, hs=None, vii=False):
    spec = spec or {"code": "4412", "invert": True}
    default = [2.0, 1.0, 0.7, 0.5, 0.4, 0.3, 0.25, 0.2, 0.17, 0.14, 0.12, 0.1, 0.09, 0.08, 0.07, 0.06, 0.05]
    if vii:
        default = [1.0, 0.5, 0.3, 0.2, 0.15, 0.12, 0.1, 0.08, 0.06, 0.05]
    hs = np.array(hs if hs is not None else default)
    out = {"h": hs, "cl": [], "cl_inv": [], "cd": [], "x_sep": []}
    for h in hs:
        r = airfoil.analyze(spec, alpha, re, tu, float(h), vii=vii)
        e = r["elements"][0]
        out["cl"].append(r["cl"])
        out["cl_inv"].append(r["cl_inv"])
        out["cd"].append(r["cd"])
        out["x_sep"].append(e["bl"][e["suction"]]["x_sep"])
    free = airfoil.analyze(spec, alpha, re, tu, None, vii=vii)
    out["cl_free"] = free["cl"]
    out["vii"] = bool(vii)
    out["reference"] = reference_data.ZERIHAN_ZHANG
    out["cl_inv_free"] = free["cl_inv"]
    return out


@endpoint("airfoil.smith")
def _smith(spec=None, alpha=8.0, re=3e6):
    """Configurations needed to visualise A.M.O. Smith's five effects."""
    spec = spec or {"code": "4412"}
    base = {k: v for k, v in spec.items() if k not in ("slat", "flap")}
    out = {"full": airfoil.analyze(spec, alpha, re), "main_alone": airfoil.analyze(base, alpha, re)}
    if spec.get("flap"):
        out["main_flap"] = airfoil.analyze({**base, "flap": spec["flap"]}, alpha, re)
    if spec.get("slat"):
        out["main_slat"] = airfoil.analyze({**base, "slat": spec["slat"]}, alpha, re)
    return out


# ------------------------------------------------------------------ boundary layer
@endpoint("bl.flat_plate")
def _flat_plate(re_L=2e6, tu=0.5, k=0.0, n=301, stations=None, trip=None):
    """Boundary layer on a plate with ue/U = 1 - k x (k > 0 decelerating = adverse)."""
    x = np.linspace(0, 1, n)
    ue = np.maximum(1 - k * x, 0.05) if k >= 0 else 1 - k * x
    nu = 1.0 / re_L
    r = BL.march(x, ue, nu, tu, "ags", trip)
    stations = stations or [0.1, 0.3, 0.5, 0.7, 0.9]
    prof = []
    fs = BL.falkner_skan(np.linspace(-0.198, 1.0, 40))
    for xs in stations:
        i = int(np.clip(round(xs * (n - 1)), 1, n - 1))
        st = int(r["state"][i])
        H = r["H"][i]
        d = r["delta"][i]
        if st == 0 and np.isfinite(H):
            j = int(np.argmin(np.abs(fs["H"] - H)))
            eta = fs["eta"]
            # scale eta so that the profile reaches 0.99 at delta
            k99 = int(np.argmax(fs["fp"][j] >= 0.99))
            y = eta / max(eta[k99], 1e-9) * d
            prof.append({"x": xs, "state": "laminar", "y": y[: k99 + 20], "u": fs["fp"][j][: k99 + 20] * ue[i],
                         "H": H, "delta": d})
        elif st == 1 and np.isfinite(H):
            tp = BL.turbulent_profile_for_H(float(H), 2000.0)
            prof.append({"x": xs, "state": "turbulent", "y": tp["eta"] * d, "u": tp["u"] * ue[i], "H": H, "delta": d})
        else:
            prof.append({"x": xs, "state": "separated", "y": [0, d if np.isfinite(d) else 0.01], "u": [0, 0], "H": None, "delta": d})
    return {"x": x, "ue": ue, **{k: r[k] for k in ("theta", "H", "dstar", "delta", "cf", "state",
                                                   "transition", "lam_sep", "turb_sep", "bubble")},
            "profiles": prof, "re_L": re_L}


@endpoint("bl.compare")
def _bl_compare(re_theta=2000.0, re_tau=800.0):
    fs = BL.falkner_skan([0.0])
    eta = fs["eta"]
    u = fs["fp"][0]
    k99 = int(np.argmax(u >= 0.99))
    lam = {"y": eta[: k99 + 30] / eta[k99], "u": u[: k99 + 30], "H": float(fs["H"][0])}
    tp = BL.turbulent_profile(re_tau)
    wall = cfd.wall_profile()
    return {"laminar": lam, "turbulent": {"y": tp["eta"], "u": tp["u"], "H": tp["H"]}, "wall": wall,
            "dudy_wall": {"laminar": float(fs["fpp0"][0] * eta[k99]), "turbulent": float(re_tau * tp["u"][1] / max(tp["yplus"][1], 1e-9))}}


@endpoint("bl.falkner_skan")
def _fs(betas=None):
    betas = betas if betas is not None else [-0.1988, -0.14, -0.05, 0.0, 0.3, 1.0]
    r = BL.falkner_skan(betas)
    return {"eta": r["eta"], "fp": r["fp"], "fpp0": r["fpp0"], "H": r["H"], "beta": betas}


# ------------------------------------------------------------------ wings
@endpoint("ll.solve")
def _ll(AR=8.0, planform="rect", taper=0.4, twist=0.0, alpha=5.0):
    return LL.solve(AR, planform, taper, twist, alpha)


@endpoint("ll.from_gamma")
def _llg(y, gamma, AR=8.0):
    return LL.from_gamma(y, gamma, AR)


@endpoint("vlm.wing")
def _vlm_wing(AR=6.0, taper=1.0, sweep=0.0, dihedral=0.0, twist=0.0, alpha=5.0, endplate_h=0.0,
              ground_h=None, nc=6, ns=24):
    surf = vlm.wing_surfaces(AR, taper, sweep, dihedral, twist, 1.0, nc, ns, endplate_h)
    r = vlm.solve(surf, alpha, None if ground_h is None else -float(ground_h))
    r["grids"] = [s["grid"] for s in surf]
    return r


@endpoint("vlm.endplate_sweep")
def _vlm_ep(AR=3.0, alpha=5.0, hs=None):
    hs = hs if hs is not None else [0, 0.05, 0.1, 0.15, 0.2, 0.3, 0.4]
    out = {"h": hs, "CL": [], "CDi": [], "e": []}
    for h in hs:
        r = vlm.solve(vlm.wing_surfaces(AR, endplate_h=h, ns=20, nc=4), alpha)
        out["CL"].append(r["CL"])
        out["CDi"].append(r["CDi"])
        out["e"].append(r["e"])
    out["hoerner_e"] = [1 + 1.9 * h for h in hs]
    return out


@endpoint("vlm.ground_sweep")
def _vlm_ground(AR=6.0, alpha=5.0, hs=None):
    hs = hs if hs is not None else [0.6, 0.4, 0.3, 0.2, 0.15, 0.1, 0.07, 0.05, 0.03]
    free = vlm.solve(vlm.wing_surfaces(AR, ns=20, nc=4), alpha)
    out = {"h": hs, "CL": [], "CDi": [], "CL_free": free["CL"], "CDi_free": free["CDi"]}
    for h in hs:
        r = vlm.solve(vlm.wing_surfaces(AR, ns=20, nc=4), alpha, -float(h))
        out["CL"].append(r["CL"])
        out["CDi"].append(r["CDi"])
    return out


# ------------------------------------------------------------------ vortices
@endpoint("vortex.profiles")
def _vprof(gamma=1.0, rc=0.1):
    return vortex.profiles(gamma, rc)


@endpoint("vortex.blobs_init")
def _vinit(vortices, n_rings=3, delta=None):
    st = vortex.make_blobs(vortices, n_rings)
    a = min(v.get("radius", 0.1) for v in vortices) if vortices else 0.1
    st["delta"] = delta if delta is not None else 0.5 * a
    return st


@endpoint("vortex.blobs_step")
def _vstep(x, y, g, delta=0.05, dt=0.01, n_steps=10, wall=False, tx=None, ty=None, owner=None, save_every=None):
    tr = {"x": tx or [], "y": ty or []}
    r = vortex.step_blobs({"x": x, "y": y, "g": g, "owner": owner}, dt, n_steps, delta, wall, tr, save_every)
    if save_every is None:
        r.pop("frames", None)
    return r


@endpoint("vortex.pair_theory")
def _vpair(g1=1.0, g2=1.0, d=1.0):
    return vortex.point_vortex_pair_theory(g1, g2, d)


@endpoint("vortex.kh_init")
def _khi(n=200, amp=0.01, subharmonic=0.0, wavelengths=2):
    return vortex.kh_init(n, amp, subharmonic, wavelengths)


@endpoint("vortex.kh_step")
def _khs(x, y, dt=0.01, n_steps=10, delta=0.1, save_every=10, n=None, **_):
    return vortex.kh_step({"x": x, "y": y}, dt, n_steps, delta, save_every)


@endpoint("vortex.breakdown")
def _vbd(swirl=0.6, dp_max=0.3):
    return vortex.breakdown(swirl, dp_max)


@endpoint("vortex.breakdown_map")
def _vbdmap(n=41):
    sw = np.linspace(0.05, 0.9, n)
    crit = [vortex.breakdown(s, 0.0)["dp_crit"] for s in sw]
    return {"swirl": sw, "dp_crit": crit}


@endpoint("delta.polhamus")
def _pol(sweep=70.0):
    return delta.polhamus(sweep)


@endpoint("delta.crossflow")
def _cross(alpha=20.0, sweep=70.0, secondary=True):
    return delta.crossflow(alpha, sweep, secondary)


# ------------------------------------------------------------------ compressible
@endpoint("nozzle.solve")
def _noz(A_in=2.0, A_t=1.0, A_e=2.0, p0=500e3, T0=300.0, pb=101.325e3, gamma=1.4):
    return nozzle.solve(A_in, A_t, A_e, p0, T0, pb, gamma)


@endpoint("nozzle.map")
def _nozmap(A_in=2.0, A_t=1.0, A_e=2.0, p0=500e3, T0=300.0, gamma=1.4, n=60):
    prs = np.linspace(0.02, 0.999, n)
    md, me = [], []
    for r in prs:
        s = nozzle.solve(A_in, A_t, A_e, p0, T0, r * p0, gamma)
        md.append(s["mdot"])
        me.append(s["exit"]["M"])
    return {"pb_ratio": prs, "mdot": md, "M_exit": me}


# ------------------------------------------------------------------ car / floor
@endpoint("floor.solve")
def _floor(h_throat=0.02, h_inlet=0.08, diffuser_deg=8.0, cp_base=-0.25, re=1.5e7):
    return floor.solve(h_throat, h_inlet, diffuser_deg, cp_base, re)


@endpoint("floor.sweep")
def _floor_sweep(h_inlet=0.08, diffuser_deg=8.0, cp_base=-0.25, re=1.5e7, n=32):
    return floor.ride_height_sweep(np.linspace(0.006, 0.08, n), h_inlet=h_inlet, diffuser_deg=diffuser_deg,
                                   cp_base=cp_base, re=re)


@endpoint("underbody.analyze")
def _ub(h=0.03, h_inlet=0.09, x_throat0=0.25, x_diff0=0.72, diffuser_deg=7.0, rake_deg=0.0,
        cp_base=-0.25, field=None, three_d=False, width=0.35, edge_vortex=0.6):
    return underbody.analyze(h, h_inlet, x_throat0, x_diff0, diffuser_deg, rake_deg, 0.08, cp_base, 2e7, field,
                             three_d, width, edge_vortex)


@endpoint("underbody.sweep")
def _ub_sweep(var="h", h=0.03, h_inlet=0.09, x_throat0=0.25, x_diff0=0.72, diffuser_deg=7.0,
              rake_deg=0.0, cp_base=-0.25, n=12, three_d=False, width=0.35, edge_vortex=0.6):
    vals = np.geomspace(0.006, 0.12, n) if var == "h" else (np.linspace(2.0, 22.0, n) if var == "diffuser" else np.linspace(-0.5, 2.0, n))
    base = dict(h=h, h_inlet=h_inlet, x_throat0=x_throat0, x_diff0=x_diff0, diffuser_deg=diffuser_deg,
                rake_deg=rake_deg, cp_base=cp_base, three_d=three_d, width=width, edge_vortex=edge_vortex)
    out = {"var": var, "values": vals, "floor": [], "body": [], "front_share": [], "x_sep": []}
    key = {"h": "h", "rake": "rake_deg", "diffuser": "diffuser_deg"}[var]
    for v in vals:
        r = underbody.analyze(**{**base, key: float(v)})
        out["floor"].append(r["floor_suction"])
        out["body"].append(r["downforce"])
        out["front_share"].append(r["front_share"])
        out["x_sep"].append(r["x_sep"])
    return out


# ------------------------------------------------------------------ drag
@endpoint("drag.buildup")
def _drag(tc=0.12, re=3e6, cl=0.0, AR=8.0, e=0.95, shape="section"):
    return drag.buildup(tc, re, cl, AR, e, shape)


@endpoint("drag.sweep")
def _drag_sweep(re=3e6):
    return {"tc": drag.sweep_tc(re), "cylinder": drag.sweep_re_cylinder()}


# ------------------------------------------------------------------ CFD / tunnel
@endpoint("cfd.spectrum")
def _spec(re_L=1e4):
    return cfd.spectrum(re_L)


@endpoint("cfd.cost")
def _cost():
    re = np.logspace(4, 9, 60)
    return cfd.grid_cost(re)


@endpoint("cfd.first_cell")
def _fc(U=50.0, x=1.0, yplus=1.0, nu=1.5e-5):
    return {**cfd.first_cell(U, 1.0, x, nu, yplus), "wall": cfd.wall_profile()}


@endpoint("tunnel.similarity")
def _sim(scale=0.6, V_tunnel=50.0, V_track=80.0):
    return tunnel.scale_similarity(scale, V_tunnel, V_track)


@endpoint("tunnel.blockage")
def _blk(frontal_ratio=0.05, cd_u=0.9):
    return tunnel.blockage(frontal_ratio, cd_u)


@endpoint("tunnel.ground")
def _tg(h=0.1, x_from_suction=1.0, V=50.0, chord=0.25, alpha=-4.0, moving=False):
    """Wing in ground effect: moving ground vs fixed ground (floor BL steals ride height)."""
    dst = tunnel.floor_displacement(x_from_suction, V, moving=False)
    h_eff = max(h - dst / chord, 0.02)
    spec = {"code": "4412", "invert": True}
    a = airfoil.analyze(spec, alpha, 1e6, 0.1, h)
    b = airfoil.analyze(spec, alpha, 1e6, 0.1, h_eff)
    return {"dstar_m": dst, "h_eff": h_eff, "cl_moving": a["cl"], "cl_fixed": b["cl"]}


# ------------------------------------------------------------------ flow visualisation
@endpoint("flowvis.wing")
def _flowvis(code="0012", alpha=8.0, re=1e6, AR=4.0, n_span=9, tu=0.1):
    """Surface events (transition, laminar bubble, separation) along the span of a
    rectangular wing, using lifting-line effective incidence at each station."""
    ll = LL.solve(AR, "rect", 0.4, 0.0, alpha)
    ys = np.linspace(0.0, 0.48, n_span)
    stations = []
    for y in ys:
        ai = float(np.interp(y, ll["y"], ll["alpha_i_deg"]))
        aeff = alpha - ai
        r = airfoil.analyze({"code": code, "n": 120}, aeff, re, tu)
        e = r["elements"][0]
        up = e["bl"]["upper"]
        stations.append({"y": float(y), "alpha_eff": aeff, "x_tr": up["x_tr"], "x_lsep": up["x_lsep"],
                         "bubble": bool(up["bubble"]), "x_sep": up["x_sep"]})
    return {"stations": stations, "AR": AR}


# ------------------------------------------------------------------ whole car
@endpoint("car.rear_wing")
def _rw(main_angle=4.0, flap_angle=25.0, drs=0.0, beam=True, beam_angle=8.0, vii=False, field=None):
    return car.rear_wing(main_angle, flap_angle, drs, beam, beam_angle, 1.5e6, 3.0, 0.25, field, vii)


@endpoint("car.drs_sweep")
def _drs_sweep(main_angle=4.0, flap_angle=25.0, beam=True, beam_angle=8.0):
    ds = np.linspace(0, 30, 11)
    rows = [car.rear_wing(main_angle, flap_angle, float(d), beam, beam_angle) for d in ds]
    return {"drs": ds, "downforce": [r["downforce_wing_3d"] for r in rows], "cd": [r["cd_wing"] for r in rows],
            "cdi": [r["cd_wing_induced"] for r in rows], "cp_probe": [r["cp_probe"] for r in rows]}


@endpoint("car.wheel")
def _wheel(gap=0.1, rotate=False, spin_circulation=0.6, field=None):
    return car.wheel_potential(gap, rotate, spin_circulation, field)


@endpoint("car.tyre_steering")
def _steer(vane_angle=10.0, field=None):
    return car.tyre_wake_steering(vane_angle, field=field)


@endpoint("car.following")
def _follow(cda_lead=1.3, upwash_deg=0.0, sensitivity=2.4):
    return car.following(cda_lead, upwash_deg, sensitivity)


@endpoint("car.aero_map")
def _amap(wing_level=1.0, n=5):
    return car.aero_map(wing_level, n)


@endpoint("car.lap")
def _lap(cla=4.5, cda=1.2, circuit="monaco"):
    return car.lap_time(cla, cda, circuit)


@endpoint("car.wing_tradeoff")
def _wt(circuit="monaco", base_cla=3.2, base_cda=0.85):
    return car.wing_tradeoff(circuit, base_cla, base_cda)


@endpoint("car.yaw")
def _yaw(beta=4.0, alpha=8.0, endplate_h=0.25):
    return {**car.yaw_wing(beta, alpha, 3.0, endplate_h), "floor": car.floor_yaw(beta)}


@endpoint("car.yaw_sweep")
def _yaw_sweep(alpha=8.0, endplate_h=0.25):
    return car.yaw_sweep(alpha, 3.0, endplate_h)


@endpoint("car.cooling")
def _cool(V=70.0, A_in=0.04, A_rad=0.12, A_exit=0.03, K=12.0, cp_exit=-0.3, dT=60.0, eff=0.6, meredith=True):
    kw = dict(V=V, A_in=A_in, A_rad=A_rad, K=K, cp_exit=cp_exit, dT=dT, eff=eff, meredith=meredith)
    return {**car.cooling(A_exit=A_exit, **kw), "sweep": car.cooling_sweep(**kw)}


# ------------------------------------------------------------------ compressibility / aeroelasticity / VGs
@endpoint("compressible.section")
def _comp(code="0012", alpha=4.0):
    return compressible.section_study(code, alpha)


@endpoint("compressible.f1")
def _comp_f1(V=90.0, cp_floor=-4.0, cp_wing=-6.0):
    return compressible.f1_check(V, cp_floor, cp_wing)


@endpoint("aeroelastic.divergence")
def _div(e=0.15, K=1200.0, alpha0=4.0):
    return {"flex": aeroelastic.divergence(e, K, 0.3, 2 * np.pi, alpha0),
            "relief": aeroelastic.divergence(-abs(e) * 0.5, K, 0.3, 2 * np.pi, alpha0)}


@endpoint("aeroelastic.flutter")
def _flut(mu=20.0, w_ratio=0.5, x_theta=0.2, r2=0.25, e=0.2):
    return aeroelastic.flutter(mu, w_ratio, x_theta, r2, e)


@endpoint("flowcontrol.vg")
def _vg(k=0.55, re_L=3e6, x_vg=0.3, h_over_delta=0.5, spacing_over_h=6.0, use_vg=True):
    return flowcontrol.ramp_case(k, re_L, use_vg, x_vg, h_over_delta, spacing_over_h)


@endpoint("postpro.plane")
def _pp(gamma=0.6, sense="counter", ground=True, deficit=0.3, loss=0.6, a=0.08, z=0.25, sep=0.7):
    g2 = -gamma if sense == "counter" else gamma
    vort = [{"y": -sep / 2, "z": z, "gamma": gamma, "a": a, "deficit": deficit, "loss": loss},
            {"y": sep / 2, "z": z, "gamma": g2, "a": a, "deficit": deficit, "loss": loss}]
    return postpro.vortex_plane(vort, ground)


# ------------------------------------------------------------------ self tests
@endpoint("tests.run")
def _tests():
    from . import selftest
    return selftest.run_all()
