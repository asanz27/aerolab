"""MAD Formula Team MFT03 CFD geometry from the team's own CFD surface.

The surface (17 named closed solids, metres, x rearwards from the front axle, z up from the ground) is
PRIVATE: it is never stored in clear in this public repository. The runner receives it encrypted
(branch cad-mft03) and run_case.sh decrypts it to $CAD_NPZ (an .npz with one float32 (n,3,3) triangle
array per solid) just for the geometry step.

Here the solids are grouped into CFD regions, the tyres are sunk 3 mm so that the (already flattened)
contact patches cut the ground cleanly, and optional ride-height changes are applied as a rigid
pitch/heave of everything except the wheels.

Run:  CAD_NPZ=mft03.npz python build_mft03.py <outdir> [--front-rh-mm F --rear-rh-mm R]
"""
from __future__ import annotations

import json
import os
import struct
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

WB = 1.545
SINK = 0.003
REGION = {
    "frontWing": "frontwing", "noseWing": "nosewing",
    "RW-Wings": "rw_wings", "RW-Endplates": "rw_plates",
    "venturi": "floor", "diffuser": "diffuser",
    "monocoque": "body", "engineCover": "enginecover", "intakeExhaust": "intake",
    "engineBlock": "engine", "drivetrain": "engine",
    "driver": "driver", "suspension": "suspension",
    "wheelFL": "wheels_front", "wheelFR": "wheels_front", "wheelRL": "wheels_rear", "wheelRR": "wheels_rear",
}
LEVELS = {
    "frontwing": (6, 6), "nosewing": (6, 6), "rw_wings": (6, 6), "rw_plates": (5, 6),
    "floor": (6, 6), "diffuser": (5, 6),
    "body": (5, 5), "enginecover": (5, 5), "intake": (5, 5), "engine": (4, 5), "driver": (4, 5),
    "suspension": (5, 5), "wheels_front": (5, 5), "wheels_rear": (5, 5),
}
FORCE_GROUPS = {
    "frontwing": ["frontwing"], "nosewing": ["nosewing"],
    "rearwing": ["rw_wings", "rw_plates"], "rw_wings": ["rw_wings"], "rw_plates": ["rw_plates"],
    "floor": ["floor"], "diffuser": ["diffuser"],
    "body": ["body", "enginecover", "intake", "engine"], "driver": ["driver"],
    "suspension": ["suspension"], "wheels_front": ["wheels_front"], "wheels_rear": ["wheels_rear"],
}
NO_LAYERS = ["suspension", "engine"]


def write_stl_bin(path, tri, name):
    tri = np.asarray(tri, dtype=np.float32)
    n = np.cross(tri[:, 1] - tri[:, 0], tri[:, 2] - tri[:, 0])
    n /= np.linalg.norm(n, axis=1)[:, None] + 1e-30
    rec = np.zeros(len(tri), dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])
    rec["n"], rec["v"] = n, tri
    with open(path, "wb") as fh:
        fh.write(name.encode()[:80].ljust(80, b" "))
        fh.write(struct.pack("<I", len(tri)))
        fh.write(rec.tobytes())


def frontal_area(tris, px=0.002, half_width=0.8, height=1.3):
    """Projected (y, z) area by rasterising the triangles with a vectorised edge-function test."""
    W, H = int(2 * half_width / px), int(height / px)
    mask = np.zeros((H, W), bool)
    for T in tris:
        P = T[:, :, 1:3].astype(np.float64)
        P[..., 1] = np.maximum(P[..., 1], 0.0)
        J = (P[..., 0] + half_width) / px
        I = P[..., 1] / px
        j0 = np.clip(np.floor(J.min(1)).astype(int), 0, W - 1); j1 = np.clip(np.ceil(J.max(1)).astype(int), 0, W - 1)
        i0 = np.clip(np.floor(I.min(1)).astype(int), 0, H - 1); i1 = np.clip(np.ceil(I.max(1)).astype(int), 0, H - 1)
        small = (j1 - j0 <= 2) & (i1 - i0 <= 2)
        # tiny triangles: mark their bounding cells (fine at 2 mm pixels)
        for dj in range(3):
            for di in range(3):
                jj, ii = np.minimum(j0[small] + dj, j1[small]), np.minimum(i0[small] + di, i1[small])
                mask[ii, jj] = True
        for k in np.where(~small)[0]:
            jj, ii = np.meshgrid(np.arange(j0[k], j1[k] + 1), np.arange(i0[k], i1[k] + 1))
            x, y = jj + 0.5, ii + 0.5
            (ax, ay), (bx, by), (cx, cy) = zip(J[k], I[k])
            d1 = (x - bx) * (ay - by) - (ax - bx) * (y - by)
            d2 = (x - cx) * (by - cy) - (bx - cx) * (y - cy)
            d3 = (x - ax) * (cy - ay) - (cx - ax) * (y - ay)
            inside = ~(((d1 < 0) | (d2 < 0) | (d3 < 0)) & ((d1 > 0) | (d2 > 0) | (d3 > 0)))
            mask[ii[inside], jj[inside]] = True
    return float(mask.sum() * px * px)


def build(front_mm=0.0, rear_mm=0.0):
    src = os.environ.get("CAD_NPZ") or os.path.join(HERE, "external", "mft03", "mft03.npz")
    d = np.load(src)
    regions = {}
    for solid, reg in REGION.items():
        if solid not in d.files:
            print("missing solid", solid)
            continue
        T = d[solid].astype(np.float64)
        if reg.startswith("wheels"):
            T[..., 2] -= SINK
        regions.setdefault(reg, []).append(T)
    regions = {k: np.concatenate(v) for k, v in regions.items()}
    if abs(front_mm) > 1e-9 or abs(rear_mm) > 1e-9:
        dF, dR = front_mm / 1000.0, rear_mm / 1000.0
        th = np.arctan2(dR - dF, WB)
        c, s = np.cos(th), np.sin(th)
        for k, T in regions.items():
            if k.startswith("wheels"):
                continue
            x, z = T[..., 0].copy(), T[..., 2].copy()
            T[..., 0] = x * c - z * s
            T[..., 2] = x * s + z * c + dF
    return regions


def main(outdir, front_mm=0.0, rear_mm=0.0):
    os.makedirs(outdir, exist_ok=True)
    regions = build(front_mm, rear_mm)
    info = {}
    for name, T in regions.items():
        write_stl_bin(os.path.join(outdir, f"{name}.stl"), T, name)
        info[name] = {"tris": int(len(T))}
        print(f"{name:14s} tris={len(T):8d}")
    allT = np.concatenate(list(regions.values()))
    V = allT.reshape(-1, 3)
    lo, hi = V.min(0), V.max(0)
    wf = regions["wheels_front"].reshape(-1, 3); wr = regions["wheels_rear"].reshape(-1, 3)
    wfl, wrl = wf[wf[:, 1] > 0], wr[wr[:, 1] > 0]
    Rf = float((wfl[:, 2].max() + SINK) / 2)
    Rr = float((wrl[:, 2].max() + SINK) / 2)
    yf = float((wfl[:, 1].max() + wfl[:, 1].min()) / 2); yr = float((wrl[:, 1].max() + wrl[:, 1].min()) / 2)
    xf = float((wfl[:, 0].max() + wfl[:, 0].min()) / 2); xr = float((wrl[:, 0].max() + wrl[:, 0].min()) / 2)
    area = frontal_area(list(regions.values()))
    meta = {
        "car": "MAD Formula Team MFT03", "car_id": "mft03", "private_geometry": True,
        "wheelbase": round(xr - xf, 4), "track": round(yf * 2, 4), "tyre_radius": Rr,
        "x_front_axle": xf, "x_rear_axle": xr,
        "wheels": [{"part": "wheels_front", "origin": [xf, yf, Rf - SINK], "radius": Rf},
                   {"part": "wheels_rear", "origin": [xr, yr, Rr - SINK], "radius": Rr}],
        "bbox_min": lo.round(4).tolist(), "bbox_max": hi.round(4).tolist(),
        "length": float(hi[0] - lo[0]), "width": float(hi[1] - lo[1]), "height": float(hi[2]),
        "frontal_area": round(area, 4), "parts": list(regions.keys()), "closure": info,
        "levels": {k: list(LEVELS[k]) for k in regions}, "force_groups": {k: [p for p in v if p in regions] for k, v in FORCE_GROUPS.items()},
        "no_layers": NO_LAYERS, "variant": {"front_rh_mm": front_mm, "rear_rh_mm": rear_mm},
        "post": {
            "wing_sections": {"FW": [["frontwing"], [0.10, 0.25, 0.45, 0.62]], "RW": [["rw_wings"], [0.05, 0.20, 0.35]]},
            "underfloor": [[0.0, 0.012], [0.25, 0.012], [0.40, 0.012], [0.55, 0.012]],
        },
    }
    with open(os.path.join(outdir, "car.json"), "w") as fh:
        json.dump(meta, fh, indent=1)
    print(json.dumps({k: meta[k] for k in ("length", "width", "height", "frontal_area", "wheelbase", "track")}), meta["wheels"])


if __name__ == "__main__":
    import argparse

    ap = argparse.ArgumentParser()
    ap.add_argument("outdir", nargs="?", default="stl")
    ap.add_argument("--front-rh-mm", type=float, default=0.0)
    ap.add_argument("--rear-rh-mm", type=float, default=0.0)
    a = ap.parse_args()
    main(a.outdir, a.front_rh_mm, a.rear_rh_mm)
