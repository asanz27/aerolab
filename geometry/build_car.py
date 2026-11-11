"""Parametric reproduction of the Rennstall Esslingen "Stallardo '25" (FSE car #94, 2025).

Sources used for the reproduction (all public):
  * FSG 2025 team page: overall 2902 x 1500 x 1181 mm, wheelbase 1535 mm, track 1240/1240 mm,
    tyres Hoosier R20 18x7.5-10, 4 hub motors (4 x 40 kW), 262 kg with a 68 kg driver.
  * FSG 2025 magazine CAD render of the car, roll-out photos (7 May 2025) and the team photo at
    FS Spain 2025: 3-element front wing with outboard cascade, vertical fences and tall endplates;
    4-element rear wing behind the main hoop with large louvred endplates; side undertrays with
    diffusers ahead of the rear wheels and under-floor strakes; small sidepod winglets.

It is NOT the team's CAD: dimensions not published were estimated from photographs and from the
Formula Student rules (aero envelope). Coordinates: x rearwards from the front axle, y to the left,
z up from the ground (m). The tyres are sunk 6 mm into the ground to create a contact patch.

Run:  python build_car.py <outdir>   -> one binary STL per component + car.json metadata
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from meshkit import (Surf, check_closed, ellipsoid, loft, merge, plate_xz, revolve, rod, section_ring,
                     stack_elements, superellipse_ring, tube, write_stl)

# ---------------------------------------------------------------------------------------------
# Global layout (published data)
# ---------------------------------------------------------------------------------------------
WB = 1.535          # wheelbase
TRACK = 1.240
R_TYRE = 0.2285     # 18 in diameter
W_TYRE = 0.190      # 7.5 in
SINK = 0.006
ZC = R_TYRE - SINK  # wheel centre height
YW = TRACK / 2      # wheel centre plane
X_RA = WB


def interp(y, ys, vals):
    return float(np.interp(abs(y), ys, vals))


# ---------------------------------------------------------------------------------------------
# Front wing
# ---------------------------------------------------------------------------------------------
FW_X_LE = -0.910
FW_SPAN = 0.709       # inner face of the outer endplate
FW_FLAP_Y0 = 0.17


def fw_stack(y):
    """2D element stack (list of (Up, Lo)) of the front wing at spanwise station y (>=0)."""
    ay = abs(y)
    centre = np.clip((0.17 - ay) / 0.07, 0, 1)  # 1 under the nose (neutral section), 0 outboard
    main = dict(m=0.07 - 0.035 * centre, p=0.40, t=0.10 - 0.01 * centre, chord=0.36,
                angle=4.0 - 2.5 * centre, x_le=FW_X_LE, min_z=0.032 + 0.030 * centre)
    if ay < FW_FLAP_Y0 - 1e-9:
        return stack_elements(main, [])
    a1 = interp(ay, [0.17, 0.25, 0.35, 0.45, 0.52, 0.60, 0.709], [20, 21, 23, 25, 28, 30, 30])
    a2 = interp(ay, [0.17, 0.25, 0.35, 0.45, 0.52, 0.60, 0.709], [36, 38, 42, 46, 52, 55, 55])
    f1 = dict(m=0.07, p=0.40, t=0.10, chord=0.19, angle=a1, gap=0.010, overlap=0.015)
    f2 = dict(m=0.06, p=0.40, t=0.10, chord=0.15, angle=a2, gap=0.009, overlap=0.012)
    return stack_elements(main, [f1, f2])


def cascade_stack():
    a = dict(m=0.06, p=0.4, t=0.10, chord=0.11, angle=10.0, x_le=-0.625, min_z=0.205, te=0.0015)
    b = dict(m=0.06, p=0.4, t=0.10, chord=0.09, angle=30.0, gap=0.008, overlap=0.010)
    return stack_elements(a, [b])


def loft_element(stations, getter):
    """Loft one element through spanwise stations; getter(y) -> (Up, Lo) in x-z."""
    rings = []
    for y in stations:
        Up, Lo = getter(y)
        r = section_ring(Up, Lo)
        rings.append(np.c_[r[:, 0], np.full(len(r), y), r[:, 1]])
    return loft(rings)


def envelope_polygon(stack, lo_margin=0.006, hi_margin=0.014, x_pad=(0.004, 0.004), z_floor=None, nx=60):
    """x-z outline that covers a 2D element stack (for fences / endplates)."""
    pts = np.vstack([np.vstack([u, l]) for u, l in stack])
    x0, x1 = pts[:, 0].min() - x_pad[0], pts[:, 0].max() + x_pad[1]
    xs = np.linspace(x0, x1, nx)
    top, bot = [], []
    for x in xs:
        near = pts[np.abs(pts[:, 0] - x) < 0.02]
        if len(near) == 0:
            near = pts[np.argsort(np.abs(pts[:, 0] - x))[:4]]
        top.append(near[:, 1].max() + hi_margin)
        bot.append(near[:, 1].min() - lo_margin if z_floor is None else z_floor)
    top = np.maximum.accumulate(np.array(top)) if False else np.array(top)
    # smooth the outline a bit
    k = np.ones(5) / 5
    top = np.convolve(np.pad(top, 2, mode="edge"), k, mode="valid")
    bot = np.convolve(np.pad(np.array(bot), 2, mode="edge"), k, mode="valid")
    return np.vstack([np.c_[xs, bot], np.c_[xs[::-1], top[::-1]]])


def build_front_wing():
    # main plane: continuous across the span
    ys_main = np.r_[np.linspace(-FW_SPAN, -0.24, 7), np.linspace(-0.22, 0.22, 17), np.linspace(0.24, FW_SPAN, 7)]
    main = loft_element(ys_main, lambda y: fw_stack(y)[0])
    # flaps: both sides from 0.17 to the endplate
    ys_f = np.linspace(FW_FLAP_Y0, FW_SPAN, 14)
    flaps = []
    for k in (1, 2):
        s = loft_element(ys_f, lambda y, k=k: fw_stack(y)[k])
        flaps.append(s.with_mirror())
    flaps = merge(flaps)
    # outboard cascade above flap 1, ahead of flap 2
    cs = cascade_stack()
    ys_c = np.linspace(0.515, FW_SPAN, 5)
    casc = merge([loft_element(ys_c, lambda y, k=k: cs[k]).with_mirror() for k in range(2)])
    # endplates (outer) + fences + nose pylons
    plates = []
    st_out = fw_stack(FW_SPAN) + cs
    ep = envelope_polygon(st_out, hi_margin=0.03, x_pad=(0.012, 0.02), z_floor=0.014)
    plates.append(plate_xz(ep, FW_SPAN + 0.003, 0.006))
    for yf, hm in ((0.17, 0.012), (0.33, 0.014), (0.515, 0.016)):
        st = fw_stack(yf + 1e-4) + (cs if yf > 0.5 else [])
        fp = envelope_polygon(st, hi_margin=hm, x_pad=(-0.06, 0.004))
        plates.append(plate_xz(fp, yf, 0.005))
    # nose pylons (connect the neutral centre section to the nose)
    pyl = np.array([[-0.74, 0.07], [-0.52, 0.075], [-0.53, 0.215], [-0.64, 0.215], [-0.70, 0.17]])
    plates.append(plate_xz(pyl, 0.085, 0.008))
    plates = merge([p.with_mirror() for p in plates])
    return {"fw_main": main, "fw_flaps": flaps, "fw_cascade": casc, "fw_plates": plates}


# ---------------------------------------------------------------------------------------------
# Chassis / nose / tail, sidepods, floor
# ---------------------------------------------------------------------------------------------
def body_loft(stations, yc_fn=lambda x: 0.0, M=72, n_exp=2.6):
    rings = []
    for x, a, zb, zt in stations:
        se = superellipse_ring(yc_fn(x), 0.5 * (zb + zt), a, 0.5 * (zt - zb), n_exp=n_exp, M=M)
        rings.append(np.c_[np.full(M, x), se[:, 0], se[:, 1]])
    return loft(rings)


def build_body():
    # x, half-width, z_bottom, z_top
    st = [(-0.672, 0.030, 0.205, 0.245), (-0.660, 0.075, 0.180, 0.275), (-0.62, 0.110, 0.165, 0.305),
          (-0.52, 0.140, 0.155, 0.340), (-0.35, 0.165, 0.140, 0.390), (-0.15, 0.185, 0.120, 0.440),
          (0.05, 0.205, 0.085, 0.505), (0.25, 0.240, 0.050, 0.570), (0.45, 0.280, 0.040, 0.615),
          (0.70, 0.300, 0.040, 0.630), (0.95, 0.300, 0.040, 0.630), (1.10, 0.290, 0.045, 0.615),
          (1.30, 0.265, 0.055, 0.585), (1.50, 0.230, 0.070, 0.540), (1.68, 0.185, 0.090, 0.480),
          (1.80, 0.140, 0.110, 0.420), (1.83, 0.090, 0.140, 0.380)]
    chassis = body_loft(st, n_exp=2.8)
    # headrest behind the helmet
    hr = [(1.025, 0.075, 0.70, 0.96), (1.045, 0.095, 0.66, 0.99), (1.075, 0.095, 0.62, 0.99), (1.090, 0.07, 0.62, 0.95)]
    headrest = body_loft(hr, n_exp=3.0, M=48)
    return chassis + headrest


def build_sidepods():
    yc = 0.335
    st = [(0.395, 0.030, 0.12, 0.18), (0.42, 0.090, 0.07, 0.27), (0.48, 0.125, 0.045, 0.34), (0.58, 0.140, 0.040, 0.385),
          (0.80, 0.142, 0.040, 0.415), (1.00, 0.132, 0.040, 0.400), (1.15, 0.110, 0.045, 0.355),
          (1.26, 0.075, 0.060, 0.290), (1.31, 0.035, 0.090, 0.220)]
    sp = body_loft(st, yc_fn=lambda x: yc, M=56, n_exp=2.6)
    return sp.with_mirror()


def build_sidewing():
    from meshkit import naca4, place_inverted
    U, L = naca4(0.06, 0.4, 0.10, chord=0.15)
    Up, Lo = place_inverted(U, L, np.array([0.47, 0.452]), 16.0)
    s = loft_element(np.linspace(0.24, 0.485, 4), lambda y: (Up, Lo))
    # small endplate on the outboard tip
    ep = np.array([[0.462, 0.40], [0.63, 0.40], [0.63, 0.52], [0.50, 0.50], [0.462, 0.47]])
    return (s + plate_xz(ep, 0.488, 0.005)).with_mirror()


def floor_zb(x):
    """Underside height of the side undertray."""
    if x < 0.40:
        t = (0.40 - x) / 0.12
        return 0.035 + 0.040 * t**1.6
    if x < 0.95:
        return 0.035
    t = (x - 0.95) / 0.35
    return 0.035 + 0.115 * (3 * t**2 - 2 * t**3) * 0.55 + 0.115 * 0.45 * t  # smooth diffuser ramp


def build_floor():
    xs = np.r_[np.linspace(0.28, 0.40, 6), np.linspace(0.45, 0.95, 6), np.linspace(1.00, 1.30, 8)]
    th = 0.006
    y_in, y_out, lip = 0.10, 0.51, 0.045
    rings = []
    for x in xs:
        zb = floor_zb(x)
        # L-shaped section: flat plate + upturned outer lip (y-z)
        sec = np.array([[y_in, zb], [y_out, zb], [y_out, zb + lip], [y_out - th, zb + lip],
                        [y_out - th, zb + th], [y_in, zb + th]])
        rings.append(np.c_[np.full(len(sec), x), sec[:, 0], sec[:, 1]])
    floor = loft(rings)
    # under-floor strakes (vertical fences under the diffuser)
    strakes = []
    for ys in (0.27, 0.40):
        xk = np.linspace(0.78, 1.30, 12)
        top = [floor_zb(x) + 0.004 for x in xk]
        poly = np.vstack([np.c_[xk, np.full(len(xk), 0.016)], np.c_[xk[::-1], top[::-1]]])
        strakes.append(plate_xz(poly, ys, 0.005))
    return (floor + merge(strakes)).with_mirror()


# ---------------------------------------------------------------------------------------------
# Rear wing
# ---------------------------------------------------------------------------------------------
RW_SPAN = 0.515
RW_X_LE = 1.205
RW_TOP = 1.180


def rw_stack():
    main = dict(m=0.075, p=0.40, t=0.11, chord=0.36, angle=7.0, x_le=RW_X_LE, min_z=0.80)
    f1 = dict(m=0.07, p=0.40, t=0.10, chord=0.24, angle=23.0, gap=0.011, overlap=0.016)
    f2 = dict(m=0.07, p=0.40, t=0.10, chord=0.19, angle=39.0, gap=0.010, overlap=0.014)
    f3 = dict(m=0.06, p=0.40, t=0.10, chord=0.15, angle=54.0, gap=0.009, overlap=0.012)
    st = stack_elements(main, [f1, f2, f3])
    top = max(max(u[:, 1].max(), l[:, 1].max()) for u, l in st)
    if top > RW_TOP:  # respect the 1.2 m rule / 1181 mm published height
        dz = top - RW_TOP
        st = [(u - [0, dz], l - [0, dz]) for u, l in st]
    return st


def build_rear_wing():
    st = rw_stack()
    ys = np.linspace(-RW_SPAN, RW_SPAN, 9)
    names = ["rw_main", "rw_flaps", "rw_flaps", "rw_flaps"]
    parts = {"rw_main": [], "rw_flaps": []}
    for k, (u, l) in enumerate(st):
        parts[names[k]].append(loft_element(ys, lambda y, u=u, l=l: (u, l)))
    out = {k: merge(v) for k, v in parts.items()}
    # endplates with three louvres (notches from the trailing edge)
    pts = np.vstack([np.vstack([u, l]) for u, l in st])
    xmax = pts[:, 0].max() + 0.012
    ztop = pts[:, 1].max() + 0.004
    outline = [(1.075, 0.97), (1.060, 1.10), (1.10, ztop), (xmax, ztop)]
    # louvres: notches entering from the rear edge, inclined forward-down
    for zr in (1.085, 0.985, 0.885):
        w = 0.012
        dx, dz = -0.20, -0.075
        outline += [(xmax, zr + w / 2), (xmax + dx, zr + dz + w / 2), (xmax + dx, zr + dz - w / 2), (xmax, zr - w / 2)]
    outline += [(xmax, 0.60), (1.78, 0.575), (1.50, 0.585), (1.28, 0.66), (1.14, 0.80)]
    ep = plate_xz(np.array(outline), RW_SPAN + 0.005, 0.008)
    # struts from the rear frame to the main plane
    strut = np.array([[1.36, 0.50], [1.46, 0.50], [1.48, 0.86], [1.38, 0.86]])
    st_s = plate_xz(strut, 0.27, 0.012)
    out["rw_plates"] = (ep + st_s).with_mirror()
    return out


# ---------------------------------------------------------------------------------------------
# Wheels, suspension, driver, roll hoop
# ---------------------------------------------------------------------------------------------
def wheel_profile(front=True):
    R, hw = R_TYRE, W_TYRE / 2
    rr = 0.035  # shoulder radius
    rim = 0.127
    prof = [(-0.165 if front else -0.150, 0.0), (-0.165 if front else -0.150, 0.075), (-hw, 0.075), (-hw, rim), (-hw, R - rr)]
    t = np.linspace(np.pi, np.pi / 2, 7)[1:]
    prof += [(-hw + rr + rr * np.cos(a), R - rr + rr * np.sin(a)) for a in t]
    t = np.linspace(np.pi / 2, 0, 7)[1:]
    prof += [(hw - rr + rr * np.cos(a), R - rr + rr * np.sin(a)) for a in t]
    prof += [(hw, rim + 0.01), (hw - 0.012, rim), (0.040, 0.105), (0.040, 0.045), (0.055, 0.040), (0.055, 0.0)]
    return np.array(prof)


def build_wheels():
    out = {}
    for name, x, front in (("wheels_front", 0.0, True), ("wheels_rear", X_RA, False)):
        prof = wheel_profile(front)
        w = revolve(prof, np.array([x, YW, ZC]), [0, 1.0, 0], n=96)
        out[name] = w.with_mirror()
    return out


def build_suspension():
    r = 0.010
    front = [
        ((-0.15, 0.170, 0.105), (0.0, 0.565, 0.105)), ((0.17, 0.195, 0.105), (0.0, 0.565, 0.105)),
        ((-0.12, 0.185, 0.300), (0.0, 0.545, 0.330)), ((0.16, 0.205, 0.320), (0.0, 0.545, 0.330)),
        ((0.0, 0.540, 0.120), (0.04, 0.195, 0.450)),  # push rod
        ((0.075, 0.190, 0.165), (0.075, 0.555, 0.170)),  # steering track rod
    ]
    rear = [
        ((1.33, 0.165, 0.105), (X_RA, 0.565, 0.105)), ((1.72, 0.150, 0.110), (X_RA, 0.565, 0.105)),
        ((1.36, 0.185, 0.300), (X_RA, 0.545, 0.330)), ((1.68, 0.165, 0.320), (X_RA, 0.545, 0.330)),
        ((X_RA, 0.540, 0.120), (1.45, 0.170, 0.420)),
        ((1.62, 0.150, 0.180), (1.62, 0.555, 0.185)),  # toe link
    ]
    f = merge([rod(np.array(a), np.array(b), r if k < 4 else 0.011) for k, (a, b) in enumerate(front)])
    rr = merge([rod(np.array(a), np.array(b), r if k < 4 else 0.011) for k, (a, b) in enumerate(rear)])
    return {"susp_front": f.with_mirror(), "susp_rear": rr.with_mirror()}


def build_driver():
    helmet = ellipsoid((0.935, 0.0, 0.885), (0.150, 0.130, 0.140), n=48)
    torso = ellipsoid((0.975, 0.0, 0.600), (0.150, 0.215, 0.165), n=48)
    neck = rod(np.array([0.96, 0, 0.70]), np.array([0.94, 0, 0.82]), 0.06, n=20)
    return helmet + torso + neck


def build_rollhoop():
    # main hoop: inverted U in the plane x=1.085, top at 1.090 m
    t = np.linspace(0, np.pi, 25)
    top = np.c_[np.full(25, 1.085), 0.135 * np.cos(t), 0.955 + 0.135 * np.sin(t)]
    legL = np.c_[np.full(6, 1.085), np.linspace(0.255, 0.140, 6), np.linspace(0.58, 0.940, 6)]
    path = np.vstack([legL, top[1:-1] * [1, 1, 1], legL[::-1] * [1, -1, 1]])
    path[len(legL):len(legL) + 23, 1] = np.clip(path[len(legL):len(legL) + 23, 1], -0.135, 0.135)
    hoop = tube(path, 0.013, n=14)
    braces = merge([rod(np.array([1.085, s * 0.12, 1.035]), np.array([1.25, s * 0.17, 0.55]), 0.011) for s in (1, -1)])
    return hoop + braces


# ---------------------------------------------------------------------------------------------
def frontal_area(surfs, px=0.002):
    from PIL import Image, ImageDraw
    W, H = int(1.7 / px), int(1.35 / px)
    img = Image.new("1", (W, H), 0)
    d = ImageDraw.Draw(img)
    for s in surfs:
        P = s.V[:, 1:3]
        for f in s.F:
            tri = P[f]
            d.polygon([((y + 0.85) / px, (1.35 - max(z, 0.0)) / px) for y, z in tri], fill=1)
    a = np.asarray(img, dtype=bool)
    # remove ground-sunk part (z<0 clipped to z=0 already)
    return float(a.sum() * px * px)


def build_all():
    parts = {}
    parts.update(build_front_wing())
    parts["body"] = build_body()
    parts["sidepods"] = build_sidepods()
    parts["sidewing"] = build_sidewing()
    parts["floor"] = build_floor()
    parts.update(build_rear_wing())
    parts.update(build_wheels())
    parts.update(build_suspension())
    parts["driver"] = build_driver()
    parts["rollhoop"] = build_rollhoop()
    return parts


GROUPS = {
    "frontwing": ["fw_main", "fw_flaps", "fw_cascade", "fw_plates"],
    "rearwing": ["rw_main", "rw_flaps", "rw_plates"],
    "chassis": ["body", "driver", "rollhoop"],
    "sidepods": ["sidepods", "sidewing"],
    "floor": ["floor"],
    "wheels_front": ["wheels_front"],
    "wheels_rear": ["wheels_rear"],
    "suspension": ["susp_front", "susp_rear"],
}


def apply_ride_height(parts, front_mm=0.0, rear_mm=0.0):
    """Rigid heave + pitch of the sprung body (everything except the wheels).

    front_mm / rear_mm: change of ride height at the front / rear axle (positive = higher)."""
    if abs(front_mm) < 1e-9 and abs(rear_mm) < 1e-9:
        return parts
    dF, dR = front_mm / 1000.0, rear_mm / 1000.0
    th = np.arctan2(dR - dF, WB)  # positive: rear up (nose down)
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
        chk = check_closed(s)
        info[name] = chk
        allV.append(s.V)
        print(f"{name:14s} tris={chk['tris']:7d} open_edges={chk['open_or_misoriented_edges']}")
    V = np.vstack(allV)
    lo, hi = V.min(0), V.max(0)
    area = frontal_area(list(parts.values()))
    meta = {
        "car": "Rennstall Esslingen Stallardo '25 (reproduction)",
        "wheelbase": WB, "track": TRACK, "tyre_radius": R_TYRE, "tyre_width": W_TYRE,
        "wheel_centre_z": ZC, "x_front_axle": 0.0, "x_rear_axle": X_RA,
        "bbox_min": lo.round(4).tolist(), "bbox_max": hi.round(4).tolist(),
        "length": float(hi[0] - lo[0]), "width": float(hi[1] - lo[1]), "height": float(hi[2]),
        "frontal_area": round(area, 4), "groups": GROUPS, "parts": info,
        "variant": {"front_rh_mm": front_mm, "rear_rh_mm": rear_mm},
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
