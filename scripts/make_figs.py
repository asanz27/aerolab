"""Static figures of a case study for the web analysis (rendered locally from the web data, matplotlib only).

usage: python make_figs.py <case web dir> <out figs dir> [--views a,b,c]

Produces JPEGs (1600x900) of the main flow structures:
  q_front / q_rear   Q-criterion iso-surface coloured by total pressure over the grey car (3/4 views)
  cp_under / cp_top  surface pressure coefficient seen from below / above
  x_*                cross-flow planes: Cpt with in-plane vectors (vortices), and streamwise vorticity
  y0_ux              symmetry plane: streamwise velocity (wakes, recirculation)
  z_floor_cp         horizontal plane just above the ground: static pressure under the car
  cpt0               Cpt = 0 wake envelope over the car
"""
from __future__ import annotations

import argparse
import json
import os
import sys

import numpy as np
import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt  # noqa: E402
from matplotlib import colormaps  # noqa: E402
from matplotlib.collections import PolyCollection  # noqa: E402
from PIL import Image  # noqa: E402

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from isofilter import read_fsb  # noqa: E402

BG = "#05080e"
FG = "#e6edf6"
plt.rcParams.update({"figure.facecolor": BG, "axes.facecolor": BG, "text.color": FG, "axes.labelcolor": FG,
                     "xtick.color": "#93a1b5", "ytick.color": "#93a1b5", "font.size": 11})


def deq(arr_meta):
    a, m = arr_meta
    top = float(np.iinfo(a.dtype).max) if np.issubdtype(a.dtype, np.integer) else 1.0
    return m["min"] + a.astype(np.float64) / top * (m["max"] - m["min"])


def load_mesh(path, fields=()):
    b, _ = read_fsb(path)
    q, pm = b["pos"]
    lo, hi = np.array(pm["min"]), np.array(pm["max"])
    V = lo + q.reshape(-1, 3).astype(np.float64) / 65535.0 * (hi - lo)
    F = b["index"][0].reshape(-1, 3).astype(np.int64)
    out = {"V": V, "F": F}
    for f in fields:
        if f in b:
            out[f] = deq(b[f])
    if "part" in b:
        out["part"] = b["part"][0]
    return out


def mirror(mesh, keys):
    V, F = mesh["V"], mesh["F"]
    Vm = V * np.array([1, -1, 1])
    out = {"V": np.vstack([V, Vm]), "F": np.vstack([F, F[:, ::-1] + len(V)])}
    for k in keys:
        if k in mesh:
            out[k] = np.concatenate([mesh[k], mesh[k]])
    return out


def view_matrix(az, el):
    """Orthographic camera: az = 0 looks from the front (-x), 90 from the left side (+y)."""
    a, e = np.radians(az), np.radians(el)
    # camera direction (from target to eye)
    d = np.array([-np.cos(e) * np.cos(a), np.cos(e) * np.sin(a), np.sin(e)])
    up = np.array([0, 0, 1.0])
    r = np.cross(up, d)
    r /= np.linalg.norm(r)
    u = np.cross(d, r)
    return np.stack([r, u, d])  # rows: screen x, screen y, depth (towards eye)


def paint(ax, meshes, R, light=(0.35, 0.45, 0.82)):
    """meshes: list of (V, F, rgba per face). Painter's algorithm with Lambert shading."""
    polys, cols, depth = [], [], []
    L = np.array(light) / np.linalg.norm(light)
    for V, F, C in meshes:
        P = V @ R.T
        T = P[F]
        n = np.cross(T[:, 1] - T[:, 0], T[:, 2] - T[:, 0])
        n /= np.linalg.norm(n, axis=1)[:, None] + 1e-30
        sh = 0.45 + 0.55 * np.abs(n @ L)
        c = C.copy()
        c[:, :3] = np.clip(c[:, :3] * sh[:, None], 0, 1)
        polys.append(T[:, :, :2]); cols.append(c); depth.append(T[:, :, 2].mean(1))
    P = np.concatenate(polys); C = np.concatenate(cols); D = np.concatenate(depth)
    o = np.argsort(D)
    ax.add_collection(PolyCollection(P[o], facecolors=C[o], edgecolors="none", antialiaseds=False))
    ax.autoscale_view()
    ax.set_aspect("equal")
    ax.axis("off")


def face_colors(vals, F, cmap, lo, hi, alpha=1.0):
    v = vals[F].mean(1)
    c = colormaps[cmap](np.clip((v - lo) / (hi - lo), 0, 1))
    c[:, 3] = alpha
    return c


def grey(F, g=0.62, alpha=1.0):
    return np.tile([g, g, g + 0.03, alpha], (len(F), 1))


def colorbar(fig, cmap, lo, hi, label, pos=(0.30, 0.06, 0.4, 0.022)):
    ax = fig.add_axes(pos)
    ax.imshow(np.linspace(0, 1, 256)[None, :], aspect="auto", cmap=cmap, extent=(lo, hi, 0, 1))
    ax.set_yticks([])
    ax.set_xlabel(label, color=FG)
    for s in ax.spines.values():
        s.set_color("#334155")


def fig_canvas():
    fig = plt.figure(figsize=(16, 9), dpi=100)
    ax = fig.add_axes((0.01, 0.10, 0.98, 0.86))
    return fig, ax


def save(fig, path):
    fig.savefig(path + ".png", facecolor=BG)
    plt.close(fig)
    Image.open(path + ".png").convert("RGB").save(path + ".jpg", quality=86, optimize=True)
    os.remove(path + ".png")
    print("wrote", path + ".jpg")


def slice_img(D, meta, axis, pos, field):
    S = meta["slices"][axis]
    it = min(S["items"], key=lambda t: abs(t["pos"] - pos))
    img = np.array(Image.open(os.path.join(D, "slices", f"{axis}_{it['i']:03d}_{field}.png")))
    if img.ndim == 3:
        img = img[..., 0]
    lo, hi = meta["fields"][field]["range"]
    v = np.where(img > 0, lo + (img.astype(float) - 1) / 254 * (hi - lo), np.nan)
    return it, v, S["ext"]


def plane_fig(D, meta, axis, pos, field, cmap, title, vectors=False, out=None, crop=None):
    it, v, (a0, a1, b0, b1) = slice_img(D, meta, axis, pos, field)
    lo, hi = meta["fields"][field]["range"]
    fig = plt.figure(figsize=(16, 9), dpi=100)
    ax = fig.add_axes((0.06, 0.16, 0.9, 0.76))
    if axis == "x":  # half plane y in [0, a1] -> mirror to the full width (seen from the front: +y on the right)
        full = np.concatenate([v[:, ::-1], v[:, 1:]], 1)
        ext = (-a1, a1, b0, b1)
        ax.imshow(full, extent=ext, origin="upper", cmap=cmap, vmin=lo, vmax=hi, interpolation="bilinear")
        ax.set_xlabel("y [m]"); ax.set_ylabel("z [m]")
        if vectors:
            vp = os.path.join(D, "slices", f"x_{it['i']:03d}_vec.png")
            if os.path.exists(vp):
                vec = np.array(Image.open(vp).convert("RGBA")).astype(float)
                h, w = vec.shape[:2]
                st = max(4, w // 70)
                J, I = np.mgrid[0:h:st, 0:w:st]
                m = vec[J, I, 2] >= 128
                vy, vz = vec[J, I, 0] / 255 - 0.5, vec[J, I, 1] / 255 - 0.5
                yy = I * (a1 / (w - 1)); zz = b1 - J * ((b1 - b0) / (h - 1))
                for s in (1, -1):
                    ax.quiver(s * yy[m], zz[m], s * vy[m], vz[m], color="white", alpha=0.75, scale=6, width=0.0012, headwidth=3.5)
    else:
        ext = (a0, a1, b0, b1)
        img = v if axis == "y" else np.concatenate([v[::-1], v[1:]], 0)
        if axis == "z":
            ext = (a0, a1, -b1, b1)
        ax.imshow(img, extent=ext, origin="upper", cmap=cmap, vmin=lo, vmax=hi, interpolation="bilinear", aspect="equal")
        ax.set_xlabel("x [m]  (0 = " + ("eje delantero / front axle" if True else "") + ")")
        ax.set_ylabel("z [m]" if axis == "y" else "y [m]")
    if crop:
        ax.set_xlim(crop[0], crop[1]); ax.set_ylim(crop[2], crop[3])
    ax.set_facecolor("#1b2436")
    ax.set_title(title, color=FG, fontsize=15, pad=10)
    colorbar(fig, cmap, lo, hi, meta["fields"][field].get("label", field), pos=(0.32, 0.05, 0.36, 0.022))
    save(fig, out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("case_dir")
    ap.add_argument("out_dir")
    ap.add_argument("--views", default="")
    a = ap.parse_args()
    D, O = a.case_dir, a.out_dir
    os.makedirs(O, exist_ok=True)
    meta = json.load(open(os.path.join(D, "meta.json"), encoding="utf-8"))
    car = meta.get("car", {})
    xf, xr = car.get("x_front_axle", 0.0), car.get("x_rear_axle", 1.545)
    R = car.get("tyre_radius", 0.25)
    want = set(a.views.split(",")) if a.views else None
    do = lambda k: want is None or k in want  # noqa: E731
    surf = load_mesh(os.path.join(D, "surface.fsb.gz"), ("Cp", "Cfx"))
    full = mirror(surf, ("Cp", "Cfx"))
    isos = {it["name"]: it for it in meta.get("iso", [])}
    # ------------------------------------------------ Q iso-surfaces over the car
    for name, az, el, title in (("q_front", -38, 24, "Q-criterion (vortices) coloured by Cpt · front 3/4"),
                                ("q_rear", 145, 22, "Q-criterion (vortices) coloured by Cpt · rear 3/4"),
                                ("q_side", 90, 4, "Q-criterion (vortices) coloured by Cpt · side")):
        if not do(name) or "q_low" not in isos:
            continue
        iso = mirror(load_mesh(os.path.join(D, isos["q_low"]["file"]), ("Cpt",)), ("Cpt",))
        fig, ax = fig_canvas()
        Rm = view_matrix(az, el)
        paint(ax, [(full["V"], full["F"], grey(full["F"], 0.55)),
                   (iso["V"], iso["F"], face_colors(iso["Cpt"], iso["F"], "turbo", -0.4, 1.0))], Rm)
        ax.set_title(title, color=FG, fontsize=15)
        colorbar(fig, "turbo", -0.4, 1.0, "Cpt (1 = loss-free air)")
        save(fig, os.path.join(O, name))
    # ------------------------------------------------ surface Cp
    for name, az, el, title in (("cp_under", 0, -89, "Surface Cp seen from below (blue = suction)"),
                                ("cp_top", -35, 30, "Surface Cp · front 3/4 (blue = suction)")):
        if not do(name):
            continue
        fig, ax = fig_canvas()
        Rm = view_matrix(az, el)
        paint(ax, [(full["V"], full["F"], face_colors(full["Cp"], full["F"], "coolwarm", -2.5, 1.0))], Rm)
        ax.set_title(title, color=FG, fontsize=15)
        colorbar(fig, "coolwarm", -2.5, 1.0, "Cp")
        save(fig, os.path.join(O, name))
    # ------------------------------------------------ Cpt = 0 wake envelope
    if do("cpt0") and "cpt0" in isos:
        iso = mirror(load_mesh(os.path.join(D, isos["cpt0"]["file"]), ()), ())
        fig, ax = fig_canvas()
        Rm = view_matrix(150, 25)
        paint(ax, [(full["V"], full["F"], grey(full["F"], 0.6)),
                   (iso["V"], iso["F"], np.tile([0.98, 0.55, 0.22, 0.55], (len(iso["F"]), 1)))], Rm)
        ax.set_title("Cpt = 0 envelope: high-loss wakes (tyres, wings, diffuser)", color=FG, fontsize=15)
        save(fig, os.path.join(O, "cpt0"))
    # ------------------------------------------------ planes
    # "behind the front wing": just downstream of the wing's trailing edge, but still ahead of the tyres
    x_fw = xf - 0.5
    parts = meta.get("surface", {}).get("parts", [])
    if "part" in surf and "frontwing" in parts:
        sel = surf["part"] == parts.index("frontwing")
        if sel.shape[0] == surf["V"].shape[0] and sel.any():
            x_fw = min(float(np.percentile(surf["V"][sel, 0], 95)) + 0.04, xf - R - 0.12)
    planes = [
        ("x_fw", "x", x_fw, "Cpt", "turbo", True, "Cross-flow plane behind the front wing (Cpt + in-plane velocity)"),
        ("x_wheel", "x", xf + 1.15 * R, "Cpt", "turbo", True, "Cross-flow plane behind the front wheels (Cpt + in-plane velocity)"),
        ("x_mid", "x", 0.5 * (xf + xr), "wx", "coolwarm", True, "Mid-car plane: streamwise vorticity (red/blue = rotation sense)"),
        ("x_rear", "x", xr + 0.9 * R, "Cpt", "turbo", True, "Plane behind the rear axle: diffuser and rear-wing wake (Cpt)"),
        ("x_rearwx", "x", xr + 1.6 * R, "wx", "coolwarm", True, "Behind the car: streamwise vorticity of the wake"),
    ]
    for name, axis, pos, field, cmap, vec, title in planes:
        if do(name):
            plane_fig(D, meta, axis, pos, field, cmap, title + f"  ·  x = {pos:.2f} m", vectors=vec, out=os.path.join(O, name))
    if do("y0_ux"):
        plane_fig(D, meta, "y", 0.0, "Ux", "turbo", "Symmetry plane: streamwise velocity Ux/U∞ (blue = slow / reversed)", out=os.path.join(O, "y0_ux"))
    if do("z_floor_cp"):
        zs = meta["slices"]["z"]["items"]
        zp = sorted(zs, key=lambda t: t["pos"])[1]["pos"]
        plane_fig(D, meta, "z", zp, "Cp", "coolwarm", f"Plane z = {zp*1000:.0f} mm above the ground: static pressure under the car", out=os.path.join(O, "z_floor_cp"))


if __name__ == "__main__":
    main()
