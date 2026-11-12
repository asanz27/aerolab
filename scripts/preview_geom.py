"""Render quick check images of the generated CFD surfaces (constant/triSurface/*.stl), coloured by region.
usage: preview_geom.py <triSurface dir> <out png>"""
import glob
import os
import struct
import sys

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402

src, out = sys.argv[1], sys.argv[2]
pal = ["#e11d48", "#2563eb", "#06b6d4", "#a855f7", "#16a34a", "#65a30d", "#9ca3af", "#f59e0b", "#111827", "#334155", "#ec4899", "#f97316", "#facc15", "#0ea5e9"]
tris, cols, legend = [], [], []
rng = np.random.default_rng(0)
for k, f in enumerate(sorted(glob.glob(os.path.join(src, "*.stl")))):
    raw = open(f, "rb").read()
    n = struct.unpack("<I", raw[80:84])[0]
    if 84 + 50 * n != len(raw):
        continue
    T = np.frombuffer(raw[84:84 + 50 * n], dtype=[("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")])["v"].astype(float)
    T = T[rng.random(len(T)) < min(1.0, 90000 / max(1, len(T)))]
    T = np.concatenate([T, T * np.array([1, -1, 1])])  # mirror the half car
    c = pal[k % len(pal)]
    tris.append(T); cols += [c] * len(T); legend.append((os.path.basename(f)[:-4], c))
T = np.concatenate(tris); cols = np.array(cols)


def rot(az, el):
    a, e = np.radians(az), np.radians(el)
    Rz = np.array([[np.cos(a), -np.sin(a), 0], [np.sin(a), np.cos(a), 0], [0, 0, 1]])
    base = np.array([[0, 1, 0], [0, 0, 1], [1, 0, 0]], float)
    Rx = np.array([[1, 0, 0], [0, np.cos(e), -np.sin(e)], [0, np.sin(e), np.cos(e)]])
    return Rx @ base @ Rz


views = [(np.array([[-1, 0, 0], [0, 0, 1], [0, -1, 0]], float), "side"), (np.array([[-1, 0, 0], [0, 1, 0], [0, 0, -1]], float), "bottom"),
         (rot(-35, 22), "front 3/4"), (rot(145, 22), "rear 3/4")]
fig, axs = plt.subplots(2, 2, figsize=(18, 11))
L = np.dot(np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0]), [0.3, 0.4, 0.85])
for ax, (R, title) in zip(axs.flat, views):
    P = T @ R.T
    o = np.argsort(P[:, :, 2].mean(1))
    nrm = np.cross(P[:, 1] - P[:, 0], P[:, 2] - P[:, 0])
    nrm /= np.linalg.norm(nrm, axis=1)[:, None] + 1e-30
    shade = 0.45 + 0.55 * np.abs(nrm[:, 2])
    import matplotlib.colors as mc
    fc = np.array([mc.to_rgb(c) for c in cols]) * shade[:, None]
    ax.add_collection(PolyCollection(P[o][:, :, :2], facecolors=np.clip(fc[o], 0, 1), edgecolors="none"))
    ax.autoscale(); ax.set_aspect("equal"); ax.set_title(title); ax.axis("off")
axs.flat[0].legend(handles=[plt.Rectangle((0, 0), 1, 1, color=c) for _, c in legend], labels=[n for n, _ in legend], loc="upper left", fontsize=8, ncol=2)
plt.tight_layout()
plt.savefig(out, dpi=75)
print("preview written", out)
