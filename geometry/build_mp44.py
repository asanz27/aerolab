"""McLaren MP4/4 (1988) CFD geometry from a free 3D model.

Source model: "McLaren MP4-4" by Twan van Zuijdam (Thingiverse user Choppertje131),
https://www.thingiverse.com/thing:4498816 , licensed CC BY 4.0
(copy obtained from the Internet Archive item thingiverse-4498816). The model is a 3D-printable
replica; here it is only rescaled, re-oriented and split into components.

Scale: 2875 mm wheelbase (published) / 91.87 mm (model) = 1:31.95 -> 31.29 mm per model mm is
cross-checked against the published 4394 mm length and 2134 mm width (both within 1 %).
Axes: x rearwards from the front axle, y to the left, z up from the ground (m).
Tyres are sunk 6 mm into the ground to give a finite contact patch.

Run:  python build_mp44.py <outdir> [--front-rh-mm F --rear-rh-mm R]
"""
from __future__ import annotations

import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
SRC = os.path.join(HERE, "external", "mclaren_mp44", "McLaren_MP4-4.stl")
sys.path.insert(0, HERE)
from meshkit import Surf, write_stl  # noqa: E402

WB = 2.875
SINK = 0.006


def read_stl(p):
    raw = open(p, "rb").read()
    n = struct.unpack("<I", raw[80:84])[0]
    rec = np.frombuffer(raw[84:84 + 50 * n], dtype=[("n", "<f4", 3), ("a", "<f4", 3), ("b", "<f4", 3), ("c", "<f4", 3), ("x", "<u2")])
    return np.stack([rec["a"], rec["b"], rec["c"]], 1).astype(float)


def components(T):
    V = T.reshape(-1, 3)
    span = (V.max(0) - V.min(0)).max()
    q = np.round(V / (span * 1e-6)).astype(np.int64)
    _, inv = np.unique(q, axis=0, return_inverse=True)
    F = inv.reshape(-1, 3)
    parent = np.arange(inv.max() + 1)

    def find(a):
        while parent[a] != a:
            parent[a] = parent[parent[a]]
            a = parent[a]
        return a

    for f in F:
        r0 = find(f[0])
        for k in (1, 2):
            rk = find(f[k])
            if rk != r0:
                parent[rk] = r0
    roots = np.array([find(i) for i in range(len(parent))])
    return roots[F[:, 0]]


def build(front_mm=0.0, rear_mm=0.0):
    Tm = read_stl(SRC)
    comp = components(Tm)
    # model -> CFD axes; model: x = lateral, y = up, z = forwards; front axle at z = 40.13 mm
    sc = WB / 91.87
    zf, yg = 40.13, -7.84
    X = -(Tm[..., 2] - zf) * sc
    Y = -Tm[..., 0] * sc  # (x, y, z)_model -> (-z, -x, y): a proper rotation (keeps outward normals)
    Z = (Tm[..., 1] - yg) * sc - SINK
    T = np.stack([X, Y, Z], -1)
    cen = T.mean(1)
    nrm = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
    nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-30
    part = np.full(len(T), "body", dtype=object)
    # --- per-component classification (wheels, suspension)
    info = {}
    for c in np.unique(comp):
        sel = comp == c
        P = T[sel].reshape(-1, 3)
        lo, hi = P.min(0), P.max(0)
        cx, cy, cz = (lo + hi) / 2
        size = hi - lo
        info[c] = (lo, hi, sel.sum())
        for xa, nm in ((0.0, "wheels_front"), (WB, "wheels_rear")):
            if abs(cx - xa) < 0.36 and abs(cy) > 0.60 and cz < 0.62 and size[0] < 0.75:
                part[sel] = nm
        if part[sel][0] == "body" and sel.sum() < 20000:
            near_axle = abs(cx) < 0.55 or abs(cx - WB) < 0.6
            thin = np.sort(size)[1] < 0.09
            if near_axle and thin and 0.12 < abs(cy) < 0.85 and cz < 0.6:
                part[sel] = "suspension"
    body = part == "body"
    # --- per-face regions of the bodywork
    x, y, z = cen[:, 0], cen[:, 1], cen[:, 2]
    fw = body & (x < -0.36) & (z < 0.26) & (np.abs(y) > 0.115)
    fw |= body & (x < -0.47) & (z < 0.13)  # centre section of the main plane under the nose
    fw |= body & (x < -0.36) & (np.abs(y) > 0.60)  # endplates
    rw = body & (x > 2.90) & (z > 0.36)
    floor = body & ~fw & ~rw & (z < 0.14) & (nrm[:, 2] < -0.35) & (x > 0.2)
    diffuser = body & ~rw & (x > 2.35) & (z < 0.42) & (np.abs(y) < 0.62) & (nrm[:, 2] < -0.2)
    susp = body & ~fw & (np.abs(x) < 0.42) & (np.abs(y) > 0.27) & (z > 0.06) & (z < 0.50)
    susp |= body & ~rw & (x > 2.55) & (x < 3.25) & (np.abs(y) > 0.34) & (z < 0.55)
    sidepods = body & ~fw & ~rw & ~floor & ~diffuser & ~susp & (np.abs(y) > 0.30) & (x > 0.55) & (x < 2.6)
    part[susp & ~floor] = "suspension"
    part[fw] = "frontwing"
    part[rw] = "rearwing"
    part[floor] = "floor"
    part[diffuser & ~floor] = "diffuser"
    part[sidepods] = "sidepods"
    # optional ride-height change: rigid pitch/heave of everything except the wheels
    if abs(front_mm) > 1e-9 or abs(rear_mm) > 1e-9:
        dF, dR = front_mm / 1000.0, rear_mm / 1000.0
        th = np.arctan2(dR - dF, WB)
        m = part != "wheels_front"
        m &= part != "wheels_rear"
        xx, zz = T[m, :, 0].copy(), T[m, :, 2].copy()
        T[m, :, 0] = xx * np.cos(th) - zz * np.sin(th)
        T[m, :, 2] = xx * np.sin(th) + zz * np.cos(th) + dF
    return T, part


LEVELS = {"frontwing": (5, 6), "rearwing": (5, 6), "floor": (5, 6), "diffuser": (5, 6), "body": (4, 5),
          "sidepods": (4, 5), "wheels_front": (4, 5), "wheels_rear": (4, 5), "suspension": (5, 5)}
FORCE_GROUPS = {"frontwing": ["frontwing"], "rearwing": ["rearwing"], "floor": ["floor"], "diffuser": ["diffuser"],
                "body": ["body"], "sidepods": ["sidepods"], "wheels_front": ["wheels_front"],
                "wheels_rear": ["wheels_rear"], "suspension": ["suspension"]}


def main(outdir, front_mm=0.0, rear_mm=0.0):
    os.makedirs(outdir, exist_ok=True)
    T, part = build(front_mm, rear_mm)
    names = [n for n in LEVELS if (part == n).any()]
    V = T.reshape(-1, 3)
    info = {}
    for n in names:
        tri = T[part == n]
        s = Surf(tri.reshape(-1, 3), np.arange(len(tri) * 3).reshape(-1, 3))
        write_stl(os.path.join(outdir, f"{n}.stl"), s, n)
        info[n] = {"tris": int(len(tri))}
        print(f"{n:13s} tris={len(tri):7d}")
    lo, hi = V.min(0), V.max(0)
    wf = T[part == "wheels_front"].reshape(-1, 3)
    wr = T[part == "wheels_rear"].reshape(-1, 3)
    wfl, wrl = wf[wf[:, 1] > 0], wr[wr[:, 1] > 0]
    Rf = (wfl[:, 2].max() + SINK) / 2
    Rr = (wrl[:, 2].max() + SINK) / 2
    yf = float((wfl[:, 1].max() + wfl[:, 1].min()) / 2)
    yr = float((wrl[:, 1].max() + wrl[:, 1].min()) / 2)
    from build_car import frontal_area
    area = frontal_area([Surf(T[part == n].reshape(-1, 3), np.arange((part == n).sum() * 3).reshape(-1, 3)) for n in names])
    meta = {
        "car": "McLaren MP4/4 (1988)", "car_id": "mp44",
        "source": {"title": "McLaren MP4-4", "author": "Twan van Zuijdam (Choppertje131)",
                   "url": "https://www.thingiverse.com/thing:4498816", "license": "CC BY 4.0",
                   "archive": "https://archive.org/details/thingiverse-4498816"},
        "wheelbase": WB, "tyre_radius": float(Rr), "x_front_axle": 0.0, "x_rear_axle": WB,
        "wheels": [{"part": "wheels_front", "origin": [0.0, yf, float(Rf - SINK)], "radius": float(Rf)},
                   {"part": "wheels_rear", "origin": [WB, yr, float(Rr - SINK)], "radius": float(Rr)}],
        "bbox_min": lo.round(4).tolist(), "bbox_max": hi.round(4).tolist(),
        "length": float(hi[0] - lo[0]), "width": float(hi[1] - lo[1]), "height": float(hi[2]),
        "frontal_area": round(area, 4), "parts": names, "closure": info,
        "levels": {k: list(LEVELS[k]) for k in names},
        "force_groups": {k: [p for p in v if p in names] for k, v in FORCE_GROUPS.items() if any(p in names for p in v)},
        "no_layers": ["suspension"],
        "variant": {"front_rh_mm": front_mm, "rear_rh_mm": rear_mm},
        "published": {"length": 4.394, "width": 2.134, "height": 0.94, "wheelbase": 2.875, "track_front": 1.824,
                      "track_rear": 1.670, "mass_min": 540.0},
        "domain": [-8.5, 18.0, 5.5, 5.5],
        "location_in_mesh": [7.1234, 2.8765, 3.3456],
        "boxes": {
            "box_far": [[-3.0, 0, 0], [10.0, 2.2, 2.4], 2],
            "box_wake": [[-1.8, 0, 0], [6.5, 1.5, 1.6], 3],
            "box_near": [[-1.25, 0, 0], [4.0, 1.25, 0.62], 4],
            "box_rw": [[2.55, 0, 0.30], [4.4, 0.80, 1.30], 4],
            "box_floor": [[0.20, 0.0, 0], [3.40, 0.75, 0.10], 5],
            "box_fwgnd": [[-1.0, 0, 0], [-0.35, 0.80, 0.20], 5],
        },
        "post": {
            "x_slices": [-1.2, 4.55], "x_ext": [0.0, 1.30, 0.0, 1.30],
            "y_slices": [0.0, 0.15, 0.30, 0.45, 0.60, 0.72, 0.86, 1.0], "y_ext": [-1.4, 5.0, 0.0, 1.40],
            "z_slices": [0.006, 0.02, 0.04, 0.08, 0.15, 0.30, 0.50, 0.75, 0.95], "z_ext": [-1.4, 5.0, 0.0, 1.30],
            "clip": [-1.6, 6.5, -0.01, 1.6, -0.01, 1.6],
            "seed_rakes": [[-1.20, 0.05, 1.05, 16, 0.03, 0.40, 7], [0.25, 0.15, 0.70, 9, 0.02, 0.06, 3],
                           [2.40, 0.02, 0.60, 10, 0.40, 1.10, 7], [-0.45, 0.45, 1.15, 7, 0.06, 0.65, 5]],
            "stream_length": 9.0,
            "wing_sections": {"FW": [["frontwing"], [0.25, 0.40, 0.55, 0.68]], "RW": [["rearwing"], [0.05, 0.20, 0.35]]},
            "underfloor": [[0.0, 0.03], [0.30, 0.03], [0.55, 0.03]], "underfloor_x": [-1.4, 5.0],
        },
    }
    with open(os.path.join(outdir, "car.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(json.dumps({k: meta[k] for k in ("length", "width", "height", "frontal_area")}), meta["wheels"])


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("outdir", nargs="?", default="stl")
    ap.add_argument("--front-rh-mm", type=float, default=0.0)
    ap.add_argument("--rear-rh-mm", type=float, default=0.0)
    a = ap.parse_args()
    main(a.outdir, a.front_rh_mm, a.rear_rh_mm)
