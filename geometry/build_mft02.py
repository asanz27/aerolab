"""Parametric reproduction of the MAD Formula Team MFT02 "Naomi" (UC3M Madrid, FSC car #373, 2022).

Independent model built from public information only (the Assetto Corsa mod of the car is NOT
used: its licence forbids unpacking/redistribution):
  * FSG 2022 team page: overall 2950 x 1416 x 1160 mm, wheelbase 1545 mm, track 1170/1170 mm,
    132/161 kg with a 68 kg driver, Hoosier R20 18 in tyres on 10 in rims, Honda CBR600 F4i,
    chain drive, pull-rod double wishbones, "diffuser-mounted radiator".
  * FSG 2022 magazine render and FSG 2022 event photographs (side, front 3/4 and rear views).

Main aero features reproduced: 3-element front wing with neutral centre section, tall inner
fences and louvred outer endplates; long low nose; box sidepods sitting on a side undertray with
an under-floor diffuser kick ahead of the rear wheels, side skirts and strakes; engine cover
behind the main hoop; 3-element high-downforce rear wing with large louvred endplates; rear
radiator + fan housed above a short central diffuser behind the rear axle.

Coordinates: x rearwards from the front axle, y to the left, z up from the ground (m).
Run:  python build_mft02.py <outdir> [--front-rh-mm F --rear-rh-mm R]
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meshkit import (Surf, check_closed, ellipsoid, loft, merge, naca4, place_inverted, plate_xz, revolve, rod,
                     stack_elements, tube, write_stl)
from build_car import body_loft, envelope_polygon, frontal_area, loft_element

CAR_NAME = "MAD Formula Team MFT02 (reproducción)"
WB = 1.545
TRACK = 1.170
R_TYRE = 0.2286
W_TYRE = 0.178
SINK = 0.006
ZC = R_TYRE - SINK
YW = TRACK / 2
X_RA = WB


def interp(y, ys, vals):
    return float(np.interp(abs(y), ys, vals))


# ---------------------------------------------------------------------------------------------
# Front wing
# ---------------------------------------------------------------------------------------------
FW_X_LE = -0.925
FW_SPAN = 0.700
FW_FLAP_Y0 = 0.205


def fw_stack(y):
    ay = abs(y)
    centre = np.clip((FW_FLAP_Y0 - ay) / 0.07, 0, 1)
    main = dict(m=0.07 - 0.04 * centre, p=0.40, t=0.10 - 0.015 * centre, chord=0.37,
                angle=4.0 - 3.0 * centre, x_le=FW_X_LE, min_z=0.030 + 0.035 * centre)
    if ay < FW_FLAP_Y0 - 1e-9:
        return stack_elements(main, [])
    ys = [0.205, 0.30, 0.40, 0.50, 0.60, 0.70]
    a1 = interp(ay, ys, [18, 20, 22, 25, 27, 27])
    a2 = interp(ay, ys, [34, 37, 40, 45, 48, 48])
    f1 = dict(m=0.07, p=0.40, t=0.10, chord=0.20, angle=a1, gap=0.010, overlap=0.016)
    f2 = dict(m=0.06, p=0.40, t=0.10, chord=0.16, angle=a2, gap=0.009, overlap=0.013)
    return stack_elements(main, [f1, f2])


def notch_plate(outline, notches, y0, thick):
    """Plate with slot notches entering from the rear (max-x) edge: notches=[(z_at_edge, dx, dz, w)]."""
    P = list(map(tuple, outline))
    xmax = max(p[0] for p in P)
    # the rear edge is the segment between the first two consecutive vertices lying at x = xmax
    k = min(i for i, p in enumerate(P) if abs(p[0] - xmax) < 1e-9)
    down = P[k][1] > P[(k + 1) % len(P)][1]
    ins = []
    for zr, dx, dz, w in sorted(notches, key=lambda n: -n[0] if down else n[0]):
        a = [(xmax, zr + w / 2), (xmax + dx, zr + dz + w / 2), (xmax + dx, zr + dz - w / 2), (xmax, zr - w / 2)]
        ins += a if down else a[::-1]
    P = P[:k + 1] + ins + P[k + 1:]
    return plate_xz(np.array(P), y0, thick)


def build_front_wing():
    ys_main = np.r_[np.linspace(-FW_SPAN, -0.25, 7), np.linspace(-0.23, 0.23, 17), np.linspace(0.25, FW_SPAN, 7)]
    main = loft_element(ys_main, lambda y: fw_stack(y)[0])
    ys_f = np.linspace(FW_FLAP_Y0, FW_SPAN, 14)
    flaps = merge([loft_element(ys_f, lambda y, k=k: fw_stack(y)[k]).with_mirror() for k in (1, 2)])
    plates = []
    # outer endplate: envelope + margin, two louvres from the trailing edge
    st = fw_stack(FW_SPAN)
    ep = envelope_polygon(st, hi_margin=0.045, x_pad=(0.010, 0.025), z_floor=0.012)
    ztop_rear = ep[len(ep) // 2, 1]  # first point of the top edge sits at the trailing edge
    plates.append(notch_plate(ep, [(ztop_rear - 0.07, -0.13, -0.03, 0.010), (ztop_rear - 0.14, -0.12, -0.03, 0.010)],
                              FW_SPAN + 0.003, 0.006))
    # tall inner fence (inner endplate of the flap stack) and a short mid fence
    for yf, hm, xp in ((FW_FLAP_Y0, 0.050, (-0.03, 0.006)), (0.45, 0.012, (-0.08, 0.004))):
        stf = fw_stack(yf + 1e-4)
        fp = envelope_polygon(stf, hi_margin=hm, x_pad=xp)
        plates.append(plate_xz(fp, yf, 0.005))
    pyl = np.array([[-0.76, 0.075], [-0.54, 0.080], [-0.55, 0.215], [-0.66, 0.215], [-0.72, 0.17]])
    plates.append(plate_xz(pyl, 0.09, 0.008))
    plates = merge([p.with_mirror() for p in plates])
    return {"fw_main": main, "fw_flaps": flaps, "fw_plates": plates}


# ---------------------------------------------------------------------------------------------
# Bodywork
# ---------------------------------------------------------------------------------------------
def build_body():
    st = [(-0.640, 0.045, 0.200, 0.265), (-0.628, 0.100, 0.178, 0.305), (-0.585, 0.135, 0.163, 0.340),
          (-0.45, 0.165, 0.150, 0.380), (-0.25, 0.185, 0.130, 0.425), (-0.05, 0.205, 0.100, 0.475),
          (0.15, 0.225, 0.070, 0.525), (0.35, 0.250, 0.045, 0.575), (0.55, 0.280, 0.040, 0.610),
          (0.80, 0.290, 0.040, 0.620), (1.02, 0.290, 0.045, 0.615), (1.20, 0.265, 0.060, 0.580),
          (1.40, 0.225, 0.080, 0.520), (1.58, 0.175, 0.100, 0.450), (1.68, 0.125, 0.120, 0.390),
          (1.71, 0.070, 0.150, 0.340)]
    chassis = body_loft(st, n_exp=2.9)
    hr = [(1.010, 0.075, 0.68, 0.94), (1.030, 0.095, 0.64, 0.97), (1.060, 0.095, 0.60, 0.97), (1.075, 0.07, 0.60, 0.93)]
    headrest = body_loft(hr, n_exp=3.0, M=48)
    return chassis + headrest


def build_engine_cover():
    st = [(1.04, 0.070, 0.52, 0.62), (1.09, 0.160, 0.50, 0.725), (1.20, 0.185, 0.48, 0.745),
          (1.38, 0.170, 0.46, 0.700), (1.55, 0.130, 0.43, 0.590), (1.64, 0.080, 0.42, 0.500), (1.665, 0.035, 0.44, 0.47)]
    return body_loft(st, n_exp=2.6, M=56)


def build_sidepods():
    yc = 0.330
    st = [(0.295, 0.030, 0.13, 0.20), (0.31, 0.100, 0.07, 0.31), (0.36, 0.135, 0.045, 0.350), (0.48, 0.145, 0.040, 0.365),
          (0.80, 0.147, 0.040, 0.385), (1.05, 0.140, 0.045, 0.370), (1.18, 0.120, 0.060, 0.330),
          (1.255, 0.080, 0.090, 0.270), (1.285, 0.030, 0.130, 0.200)]
    return body_loft(st, yc_fn=lambda x: yc, M=56, n_exp=3.2).with_mirror()


def floor_zb(x):
    if x < 0.38:
        t = (0.38 - x) / 0.10
        return 0.030 + 0.040 * t**1.6
    if x < 0.98:
        return 0.030
    t = (x - 0.98) / 0.32
    return 0.030 + 0.100 * (0.55 * (3 * t**2 - 2 * t**3) + 0.45 * t)


def build_floor():
    xs = np.r_[np.linspace(0.28, 0.38, 6), np.linspace(0.43, 0.98, 6), np.linspace(1.02, 1.30, 8)]
    th = 0.006
    y_in, y_out, lip = 0.10, 0.478, 0.050
    rings = []
    for x in xs:
        zb = floor_zb(x)
        sec = np.array([[y_in, zb], [y_out, zb], [y_out, zb + lip], [y_out - th, zb + lip], [y_out - th, zb + th], [y_in, zb + th]])
        rings.append(np.c_[np.full(len(sec), x), sec[:, 0], sec[:, 1]])
    floor = loft(rings)
    parts = [floor]
    # side skirt (sealing edge) and two diffuser strakes
    xk = np.linspace(0.40, 1.30, 16)
    top = [floor_zb(x) + 0.004 for x in xk]
    skirt = np.vstack([np.c_[xk, np.full(len(xk), 0.012)], np.c_[xk[::-1], top[::-1]]])
    parts.append(plate_xz(skirt, y_out - 0.003, 0.006))
    for ys in (0.22, 0.35):
        xk = np.linspace(0.85, 1.30, 10)
        top = [floor_zb(x) + 0.004 for x in xk]
        poly = np.vstack([np.c_[xk, np.full(len(xk), 0.015)], np.c_[xk[::-1], top[::-1]]])
        parts.append(plate_xz(poly, ys, 0.005))
    return merge(parts).with_mirror()


def build_rear_diffuser_radiator():
    """Short central diffuser behind the rear axle with the radiator + fan shroud on top of it."""
    # diffuser roof: plate in x-z (extruded across y via loft of y-z sections)
    xs = np.linspace(1.38, 1.86, 9)
    rings = []
    for x in xs:
        t = (x - 1.38) / 0.48
        zb = 0.065 + 0.11 * t**1.4
        sec = np.array([[-0.20, zb], [0.20, zb], [0.20, zb + 0.006], [-0.20, zb + 0.006]])
        rings.append(np.c_[np.full(4, x), sec[:, 0], sec[:, 1]])
    roof = loft(rings)
    sides = []
    for s in (1, -1):
        xk = np.linspace(1.38, 1.86, 9)
        zt = [0.065 + 0.11 * ((x - 1.38) / 0.48) ** 1.4 + 0.004 for x in xk]
        poly = np.vstack([np.c_[xk, np.full(len(xk), 0.02)], np.c_[xk[::-1], zt[::-1]]])
        sides.append(plate_xz(poly, s * 0.203, 0.006))
    diff = roof + merge(sides)
    # radiator + fan shroud: inclined block above the diffuser exit
    rings = []
    for x, zb, zt, a in ((1.66, 0.20, 0.30, 0.10), (1.70, 0.17, 0.36, 0.16), (1.80, 0.17, 0.38, 0.16), (1.86, 0.19, 0.36, 0.14), (1.88, 0.22, 0.32, 0.09)):
        from meshkit import superellipse_ring
        se = superellipse_ring(0.0, 0.5 * (zb + zt), a, 0.5 * (zt - zb), n_exp=4.0, M=48)
        rings.append(np.c_[np.full(48, x), se[:, 0], se[:, 1]])
    rad = loft(rings)
    return {"diffuser": diff, "radiator": rad}


# ---------------------------------------------------------------------------------------------
# Rear wing
# ---------------------------------------------------------------------------------------------
RW_SPAN = 0.486
RW_X_LE = 1.195
RW_TOP = 1.160


def rw_stack():
    main = dict(m=0.075, p=0.40, t=0.11, chord=0.42, angle=5.0, x_le=RW_X_LE, min_z=0.845)
    f1 = dict(m=0.07, p=0.40, t=0.10, chord=0.26, angle=24.0, gap=0.012, overlap=0.016)
    f2 = dict(m=0.07, p=0.40, t=0.10, chord=0.21, angle=44.0, gap=0.011, overlap=0.014)
    st = stack_elements(main, [f1, f2])
    top = max(max(u[:, 1].max(), l[:, 1].max()) for u, l in st)
    if top > RW_TOP:
        dz = top - RW_TOP
        st = [(u - [0, dz], l - [0, dz]) for u, l in st]
    return st


def build_rear_wing():
    st = rw_stack()
    ys = np.linspace(-RW_SPAN, RW_SPAN, 9)
    out = {"rw_main": loft_element(ys, lambda y: st[0]),
           "rw_flaps": merge([loft_element(ys, lambda y, u=u, l=l: (u, l)) for u, l in st[1:]])}
    pts = np.vstack([np.vstack([u, l]) for u, l in st])
    xmax = pts[:, 0].max() + 0.015
    ztop = pts[:, 1].max() + 0.004
    outline = [(1.10, 0.93), (1.085, 1.08), (1.12, ztop), (xmax, ztop), (xmax, 0.60), (1.80, 0.56), (1.52, 0.57),
               (1.30, 0.64), (1.16, 0.79)]
    ep = notch_plate(outline, [(1.07, -0.24, -0.09, 0.012), (0.97, -0.24, -0.09, 0.012), (0.87, -0.22, -0.08, 0.012)],
                     RW_SPAN + 0.005, 0.008)
    strut = np.array([[1.36, 0.45], [1.46, 0.45], [1.50, 0.885], [1.40, 0.885]])
    out["rw_plates"] = (ep + plate_xz(strut, 0.15, 0.012)).with_mirror()
    return out


# ---------------------------------------------------------------------------------------------
# Wheels, suspension, driver, roll hoop
# ---------------------------------------------------------------------------------------------
def wheel_profile(front=True):
    R, hw = R_TYRE, W_TYRE / 2
    rr = 0.033
    rim = 0.127
    a_in = -0.150 if front else -0.140
    prof = [(a_in, 0.0), (a_in, 0.070), (-hw, 0.070), (-hw, rim), (-hw, R - rr)]
    t = np.linspace(np.pi, np.pi / 2, 7)[1:]
    prof += [(-hw + rr + rr * np.cos(a), R - rr + rr * np.sin(a)) for a in t]
    t = np.linspace(np.pi / 2, 0, 7)[1:]
    prof += [(hw - rr + rr * np.cos(a), R - rr + rr * np.sin(a)) for a in t]
    prof += [(hw, rim + 0.01), (hw - 0.012, rim), (0.035, 0.105), (0.035, 0.045), (0.050, 0.040), (0.050, 0.0)]
    return np.array(prof)


def build_wheels():
    out = {}
    for name, x, front in (("wheels_front", 0.0, True), ("wheels_rear", X_RA, False)):
        w = revolve(wheel_profile(front), np.array([x, YW, ZC]), [0, 1.0, 0], n=96)
        out[name] = w.with_mirror()
    return out


def build_suspension():
    r = 0.010
    front = [
        ((-0.14, 0.160, 0.100), (0.0, 0.530, 0.100)), ((0.16, 0.180, 0.100), (0.0, 0.530, 0.100)),
        ((-0.12, 0.180, 0.300), (0.0, 0.510, 0.330)), ((0.15, 0.200, 0.310), (0.0, 0.510, 0.330)),
        ((0.0, 0.500, 0.320), (0.06, 0.190, 0.120)),   # pull rod
        ((0.07, 0.170, 0.170), (0.07, 0.520, 0.170)),  # track rod
    ]
    rear = [
        ((1.34, 0.160, 0.100), (X_RA, 0.530, 0.100)), ((1.72, 0.150, 0.105), (X_RA, 0.530, 0.100)),
        ((1.37, 0.180, 0.300), (X_RA, 0.510, 0.330)), ((1.68, 0.160, 0.320), (X_RA, 0.510, 0.330)),
        ((X_RA, 0.500, 0.320), (1.47, 0.170, 0.120)),
        ((1.63, 0.150, 0.180), (1.63, 0.520, 0.185)),
    ]
    f = merge([rod(np.array(a), np.array(b), r if k < 4 else 0.011) for k, (a, b) in enumerate(front)])
    rr = merge([rod(np.array(a), np.array(b), r if k < 4 else 0.011) for k, (a, b) in enumerate(rear)])
    return {"susp_front": f.with_mirror(), "susp_rear": rr.with_mirror()}


def build_driver():
    helmet = ellipsoid((0.915, 0.0, 0.870), (0.150, 0.130, 0.140), n=48)
    torso = ellipsoid((0.960, 0.0, 0.590), (0.150, 0.215, 0.165), n=48)
    neck = rod(np.array([0.945, 0, 0.69]), np.array([0.925, 0, 0.80]), 0.06, n=20)
    return helmet + torso + neck


def build_rollhoop():
    t = np.linspace(0, np.pi, 25)
    top = np.c_[np.full(25, 1.068), 0.135 * np.cos(t), 0.915 + 0.135 * np.sin(t)]
    legL = np.c_[np.full(6, 1.068), np.linspace(0.255, 0.140, 6), np.linspace(0.58, 0.900, 6)]
    path = np.vstack([legL, top[1:-1], legL[::-1] * [1, -1, 1]])
    hoop = tube(path, 0.013, n=14)
    braces = merge([rod(np.array([1.068, s * 0.12, 0.995]), np.array([1.26, s * 0.17, 0.53]), 0.011) for s in (1, -1)])
    return hoop + braces


# ---------------------------------------------------------------------------------------------
LEVELS = {
    "fw_main": (6, 6), "fw_flaps": (6, 6), "fw_plates": (6, 6),
    "rw_main": (5, 6), "rw_flaps": (6, 6), "rw_plates": (5, 6),
    "floor": (6, 6), "diffuser": (5, 6),
    "body": (5, 5), "enginecover": (5, 5), "sidepods": (5, 5), "radiator": (5, 5), "driver": (4, 5), "rollhoop": (5, 5),
    "wheels_front": (5, 5), "wheels_rear": (5, 5), "susp_front": (5, 5), "susp_rear": (5, 5),
}
FORCE_GROUPS = {
    "frontwing": ["fw_main", "fw_flaps", "fw_plates"],
    "fw_main": ["fw_main"], "fw_flaps": ["fw_flaps"], "fw_plates": ["fw_plates"],
    "rearwing": ["rw_main", "rw_flaps", "rw_plates"],
    "rw_main": ["rw_main"], "rw_flaps": ["rw_flaps"], "rw_plates": ["rw_plates"],
    "body": ["body", "enginecover"], "driver": ["driver", "rollhoop"], "sidepods": ["sidepods"],
    "floor": ["floor"], "diffuser": ["diffuser", "radiator"],
    "wheels_front": ["wheels_front"], "wheels_rear": ["wheels_rear"], "suspension": ["susp_front", "susp_rear"],
}
NO_LAYERS = ["susp_front", "susp_rear", "rollhoop", "radiator"]


def build_all():
    parts = {}
    parts.update(build_front_wing())
    parts["body"] = build_body()
    parts["enginecover"] = build_engine_cover()
    parts["sidepods"] = build_sidepods()
    parts["floor"] = build_floor()
    parts.update(build_rear_diffuser_radiator())
    parts.update(build_rear_wing())
    parts.update(build_wheels())
    parts.update(build_suspension())
    parts["driver"] = build_driver()
    parts["rollhoop"] = build_rollhoop()
    return parts


def apply_ride_height(parts, front_mm=0.0, rear_mm=0.0):
    if abs(front_mm) < 1e-9 and abs(rear_mm) < 1e-9:
        return parts
    dF, dR = front_mm / 1000.0, rear_mm / 1000.0
    th = np.arctan2(dR - dF, WB)
    c, s = np.cos(th), np.sin(th)
    out = {}
    for k, sf in parts.items():
        if k.startswith("wheels"):
            out[k] = sf
            continue
        V = sf.V.copy()
        x, z = V[:, 0].copy(), V[:, 2].copy()
        V[:, 0] = x * c - z * s
        V[:, 2] = x * s + z * c + dF
        out[k] = Surf(V, sf.F)
    return out


def main(outdir, front_mm=0.0, rear_mm=0.0):
    os.makedirs(outdir, exist_ok=True)
    parts = apply_ride_height(build_all(), front_mm, rear_mm)
    info = {}
    allV = []
    for name, s in parts.items():
        write_stl(os.path.join(outdir, f"{name}.stl"), s, name)
        info[name] = check_closed(s)
        allV.append(s.V)
        print(f"{name:14s} tris={info[name]['tris']:7d} open_edges={info[name]['open_or_misoriented_edges']}")
    V = np.vstack(allV)
    lo, hi = V.min(0), V.max(0)
    meta = {
        "car": CAR_NAME, "car_id": "mft02",
        "wheelbase": WB, "track": TRACK, "tyre_radius": R_TYRE, "tyre_width": W_TYRE,
        "wheel_centre_z": ZC, "x_front_axle": 0.0, "x_rear_axle": X_RA,
        "wheels": [{"part": "wheels_front", "origin": [0.0, YW, ZC]}, {"part": "wheels_rear", "origin": [X_RA, YW, ZC]}],
        "bbox_min": lo.round(4).tolist(), "bbox_max": hi.round(4).tolist(),
        "length": float(hi[0] - lo[0]), "width": float(hi[1] - lo[1]), "height": float(hi[2]),
        "frontal_area": round(frontal_area(list(parts.values())), 4),
        "levels": {k: list(v) for k, v in LEVELS.items()}, "force_groups": FORCE_GROUPS, "no_layers": NO_LAYERS,
        "parts": list(parts.keys()), "closure": info,
        "variant": {"front_rh_mm": front_mm, "rear_rh_mm": rear_mm},
        "published": {"length": 2.950, "width": 1.416, "height": 1.160, "wheelbase": 1.545, "track": 1.170,
                      "mass_with_driver": 293.0, "weight_front_pct": 45.1},
    }
    with open(os.path.join(outdir, "car.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(json.dumps({k: meta[k] for k in ("length", "width", "height", "frontal_area")}, indent=1))


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("outdir", nargs="?", default="stl")
    ap.add_argument("--front-rh-mm", type=float, default=0.0)
    ap.add_argument("--rear-rh-mm", type=float, default=0.0)
    a = ap.parse_args()
    main(a.outdir, a.front_rh_mm, a.rear_rh_mm)
