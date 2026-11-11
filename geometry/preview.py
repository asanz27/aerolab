"""Quick shaded previews of the STL model (matplotlib, painter's algorithm). Light-weight."""
import glob
import os
import struct
import sys

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.collections import PolyCollection

COL = {"fw": (0.85, 0.25, 0.25), "rw": (0.25, 0.45, 0.9), "wheels": (0.15, 0.15, 0.15), "susp": (0.6, 0.6, 0.6),
       "body": (0.55, 0.55, 0.6), "sidepods": (0.5, 0.6, 0.55), "floor": (0.95, 0.7, 0.2), "driver": (0.9, 0.8, 0.3),
       "rollhoop": (0.7, 0.7, 0.7), "sidewing": (0.8, 0.4, 0.8), "enginecover": (0.2, 0.4, 0.95), "radiator": (0.3, 0.3, 0.3), "diffuser": (0.95, 0.5, 0.1)}


def read_stl(p):
    with open(p, "rb") as fh:
        fh.read(80)
        n = struct.unpack("<I", fh.read(4))[0]
        rec = np.frombuffer(fh.read(n * 50), dtype=[("n", "<f4", 3), ("a", "<f4", 3), ("b", "<f4", 3), ("c", "<f4", 3), ("x", "<u2")])
    return np.stack([rec["a"], rec["b"], rec["c"]], 1).astype(float)


def color_for(name):
    for k, c in COL.items():
        if name.startswith(k):
            return np.array(c)
    return np.array((0.6, 0.6, 0.6))


def render(tris, cols, view, ax, title):
    az, el = np.radians(view[0]), np.radians(view[1])
    # camera basis
    d = np.array([np.cos(el) * np.cos(az), np.cos(el) * np.sin(az), np.sin(el)])  # towards viewer
    up0 = np.array([0, 0, 1.0])
    r = np.cross(up0, d)
    if np.linalg.norm(r) < 1e-6:
        r = np.array([0, 1.0, 0])
    r /= np.linalg.norm(r)
    u = np.cross(d, r)
    P = tris @ np.c_[r, u]  # (n,3,2)
    depth = (tris @ d).mean(1)
    nrm = np.cross(tris[:, 1] - tris[:, 0], tris[:, 2] - tris[:, 0])
    nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-30
    light = d * 0.6 + np.array([0.3, 0.3, 0.7])
    light /= np.linalg.norm(light)
    sh = 0.35 + 0.65 * np.abs(nrm @ light)
    order = np.argsort(depth)
    fc = np.clip(cols[order] * sh[order, None], 0, 1)
    pc = PolyCollection(P[order], facecolors=fc, edgecolors="none", antialiased=False)
    ax.add_collection(pc)
    ax.autoscale_view()
    ax.set_aspect("equal")
    ax.set_title(title, fontsize=9)
    ax.axis("off")


def main(stldir, out):
    tris, cols = [], []
    for p in sorted(glob.glob(os.path.join(stldir, "*.stl"))):
        t = read_stl(p)
        tris.append(t)
        cols.append(np.tile(color_for(os.path.basename(p)), (len(t), 1)))
    tris = np.vstack(tris)
    cols = np.vstack(cols)
    views = [((-130, 22), "iso front-left"), ((-90, 0), "side (left)"), ((180, 0), "front"), ((-90, 89.9), "top"),
             ((-40, 20), "iso rear-left"), ((180, -25), "front-below")]
    if len(sys.argv) > 3:
        views = [((float(sys.argv[3]), float(sys.argv[4])), "custom")]
    fig, axs = plt.subplots(len(views) // 2 if len(views) > 1 else 1, 2 if len(views) > 1 else 1, figsize=(16, 4.2 * max(1, len(views) // 2)))
    axs = np.atleast_1d(axs).ravel()
    for ax, (v, t) in zip(axs, views):
        render(tris, cols, v, ax, t)
    plt.tight_layout()
    plt.savefig(out, dpi=110)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
