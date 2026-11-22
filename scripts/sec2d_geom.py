"""2D wing sections for the section test (option B of the wing-separation diagnosis, 2026-11-22).

Cuts a wing STL (frontwing.stl / rearwing.stl as built for the 3D runs: CAD skin + inner plug) with a plane y = const and
returns the solid region as clean polygons in the x-z plane: the cut segments are polygonised, the closed rings joined
(skin + plug overlap) and their holes filled, so each element is one simple outline - what snappyHexMesh sees as solid.

usage (runner):  python sec2d_geom.py extract <triSurface dir> '<json config>' <out dir>
       (local):  python sec2d_geom.py inflow <web data dir of the 3D result> <wing FW|RW> <y> <xLE> <chord> <zmin> <zmax>
The geometry comes from the private CAD: the outlines stay on the runner (only images and sampled lines are published,
like the 3D mesh cuts and wing-section Cp lines).
"""
from __future__ import annotations

import json
import math
import os
import sys

import numpy as np


def read_stl(path):
    raw = open(path, "rb").read()
    n = int(np.frombuffer(raw[80:84], np.uint32)[0])
    if 84 + 50 * n == len(raw):
        rec = np.frombuffer(raw[84:84 + 50 * n], dtype=np.dtype([("n", "<f4", 3), ("v", "<f4", (3, 3)), ("a", "<u2")]))
        return rec["v"].astype(float)
    # ASCII fallback
    pts = [list(map(float, ln.split()[1:4])) for ln in raw.decode(errors="ignore").splitlines() if ln.strip().startswith("vertex")]
    return np.array(pts, float).reshape(-1, 3, 3)


def cut_segments(T, y0):
    """Segments (x, z) where the triangles T (n,3,3) cross the plane y = y0."""
    d = T[:, :, 1] - y0
    d = np.where(np.abs(d) < 1e-9, 1e-9, d)
    s = np.sign(d)
    cross = (s.min(1) < 0) & (s.max(1) > 0)
    T, d = T[cross], d[cross]
    segs = []
    for (a, b) in ((0, 1), (1, 2), (2, 0)):
        m = np.sign(d[:, a]) != np.sign(d[:, b])
        t = d[:, a] / (d[:, a] - d[:, b] + 1e-30)
        p = T[:, a] + t[:, None] * (T[:, b] - T[:, a])
        segs.append(np.where(m[:, None], p[:, [0, 2]], np.nan))
    S = np.stack(segs, 1)                       # (n, 3, 2): two of the three are valid
    out = []
    for row in S:
        v = row[~np.isnan(row[:, 0])]
        if len(v) == 2 and np.linalg.norm(v[0] - v[1]) > 1e-9:
            out.append(v)
    return np.array(out)


def section_polygons(T_wing, T_all, y0, px=1e-4, margin=0.15, min_area=1e-5, close=1e-3):
    """Solid region of the cut, as snappyHexMesh sees it: every wall surface of the car is cut (a wing element is often
    two open skin sheets closed by faces of another part - the MP4/23 rear-wing nose belongs to body.stl), the cut lines
    are drawn on a px raster (0.1 mm) and thickened by one pixel (seals pinholes < ~0.3 mm), and whatever the outside
    air cannot reach is solid. Open sheets stay as ~0.3 mm plates (snappy makes them zero-thickness baffles). Gaps under
    2 mm are closed (see below) and pieces under 10 mm2 dropped (plug voxels, lights).
    Window: the wing's own cut plus a 15 cm margin (the part split can give an element's nose to body.stl - RB12 rear
    wing); kept are the solids that hold some of the wing's own cut and do not touch the window edge."""
    from contourpy import contour_generator
    from scipy import ndimage
    from shapely.geometry import MultiLineString, MultiPolygon, Polygon
    from shapely.ops import unary_union

    Sw = cut_segments(T_wing, y0)
    if not len(Sw):
        return []
    x0, z0 = Sw.reshape(-1, 2).min(0) - margin
    x1, z1 = Sw.reshape(-1, 2).max(0) + margin
    S = cut_segments(T_all, y0) if T_all is not None else Sw
    m = (S[:, :, 0].max(1) >= x0) & (S[:, :, 0].min(1) <= x1) & (S[:, :, 1].max(1) >= z0) & (S[:, :, 1].min(1) <= z1)
    S = S[m]
    nx, nz = int(math.ceil((x1 - x0) / px)) + 1, int(math.ceil((z1 - z0) / px)) + 1
    wall = np.zeros((nz, nx), bool)
    for a, b in S:
        n = int(np.linalg.norm(b - a) / (0.4 * px)) + 2
        t = np.linspace(0, 1, n)[:, None]
        p = a + t * (b - a)
        j = np.clip(np.round((p[:, 0] - x0) / px).astype(int), 0, nx - 1)
        i = np.clip(np.round((p[:, 1] - z0) / px).astype(int), 0, nz - 1)
        wall[i, j] = True
    wall = ndimage.binary_dilation(wall, iterations=1)
    lab, _ = ndimage.label(~wall)
    border = np.unique(np.r_[lab[0], lab[-1], lab[:, 0], lab[:, -1]])
    fluid = np.isin(lab, border[border > 0])
    solid = ~fluid
    solid[[0, -1], :] = False
    solid[:, [0, -1]] = False
    lines = contour_generator(z=solid.astype(float), line_type="Separate").lines(0.5)
    polys = []
    for L in lines:
        if len(L) < 4:
            continue
        P = np.c_[x0 + L[:, 0] * px, z0 + L[:, 1] * px]
        g = Polygon(P).buffer(0)
        if g.area > 0:
            polys.append(g)
    if not polys:
        return []
    U = unary_union(polys)
    # morphological closing (round, radius `close`): joins faces less than 2 x close apart - the skin and the voxel plug
    # inside it, double skins - which the 3D mesh (2.6-5.6 mm cells on the wings) never separates either; convex corners
    # are kept, concave ones get a 1 mm fillet
    if close > 0:
        U = U.buffer(close, quad_segs=8).buffer(-close, quad_segs=8)
    geoms = list(U.geoms) if isinstance(U, MultiPolygon) else [U]
    wing_lines = MultiLineString([s.tolist() for s in Sw])
    edge = 3 * px
    out = []
    for g in geoms:
        g = Polygon(g.exterior).simplify(5e-5, preserve_topology=True)   # fill holes, drop < 0.05 mm staircase
        b = g.bounds
        if b[0] < x0 + edge or b[1] < z0 + edge or b[2] > x1 - edge or b[3] > z1 - edge:
            continue                             # cut by the window: not this wing
        if g.area >= min_area and g.buffer(1e-3).intersects(wing_lines):
            out.append(g)
    out.sort(key=lambda g: g.bounds[0])
    return out


def load_all(tri_dir):
    """All wall surfaces of the built car (car.json parts minus inflow/outflow patches)."""
    car = json.load(open(os.path.join(tri_dir, "car.json")))
    skip = set(car.get("patch_types", {}))
    Ts = [read_stl(os.path.join(tri_dir, f"{p}.stl")) for p in car["parts"]
          if p not in skip and not p.startswith("wheels") and os.path.exists(os.path.join(tri_dir, f"{p}.stl"))]
    return np.concatenate(Ts)


def rotate(P, ang_deg, pivot):
    a = math.radians(ang_deg)
    R = np.array([[math.cos(a), -math.sin(a)], [math.sin(a), math.cos(a)]])
    return (np.asarray(P) - pivot) @ R.T + pivot


def describe(polys):
    """Per element: chord, angle (deg, + = trailing edge up), thickness/chord; gaps between elements (m)."""
    els = []
    for g in polys:
        P = np.asarray(g.exterior.coords)[:-1]
        te = int(np.argmax(P[:, 0]))
        le = int(np.argmax(np.linalg.norm(P - P[te], axis=1)))
        c = float(np.linalg.norm(P[te] - P[le]))
        u = (P[te] - P[le]) / max(c, 1e-12)
        h = (P - P[le]) @ np.array([-u[1], u[0]])
        els.append({"n": len(P), "chord": c, "angle": math.degrees(math.atan2(P[te, 1] - P[le, 1], P[te, 0] - P[le, 0])),
                    "t_c": float((h.max() - h.min()) / max(c, 1e-12)), "le": P[le].tolist(), "te": P[te].tolist(),
                    "area": g.area})
    gaps = []
    for i in range(len(polys)):
        for j in range(i + 1, len(polys)):
            dist = polys[i].distance(polys[j])
            if dist < 0.05:
                gaps.append([i, j, float(dist)])
    return els, gaps


def extract(tri_dir, cfg, out_dir):
    from shapely.geometry import Polygon

    os.makedirs(out_dir, exist_ok=True)
    secs = []
    cache = {"all": load_all(tri_dir)}
    for s in cfg["sec2d"]:
        wing = {"FW": "frontwing", "RW": "rearwing"}[s["wing"]]
        if wing not in cache:
            cache[wing] = read_stl(os.path.join(tri_dir, f"{wing}.stl"))
        polys = section_polygons(cache[wing], cache["all"], float(s["y"]))
        if not polys:
            print("no section for", s)
            continue
        if s.get("x_range"):                     # keep only the elements of this wing in the given x window
            polys = [g for g in polys if s["x_range"][0] <= g.centroid.x <= s["x_range"][1]]
        allP = np.vstack([np.asarray(g.exterior.coords) for g in polys])
        pivot = allP[np.argmin(allP[:, 0])]
        ang = -float(s.get("inflow_deg", 0.0))   # inflow rotated by +a  ==  geometry rotated by -a
        rot = [Polygon(rotate(np.asarray(g.exterior.coords), ang, pivot)) for g in polys] if abs(ang) > 1e-9 else polys
        els, gaps = describe(rot)
        allR = np.vstack([np.asarray(g.exterior.coords) for g in rot])
        rec = {"id": s["id"], "car": cfg.get("car"), "wing": s["wing"], "y": s["y"], "ground": s["wing"] == "FW",
               "inflow_deg": s.get("inflow_deg", 0.0), "pivot": pivot.tolist(),
               "xmin": float(allR[:, 0].min()), "xmax": float(allR[:, 0].max()),
               "zmin": float(allR[:, 1].min()), "zmax": float(allR[:, 1].max()),
               "elements": els, "gaps": gaps,
               "polys": [np.asarray(g.exterior.coords)[:-1].round(7).tolist() for g in rot],
               "polys_geo": [np.asarray(g.exterior.coords)[:-1].round(7).tolist() for g in polys]}
        secs.append(rec)
        print(f"{s['id']}: {len(rot)} elements, chord {rec['xmax'] - rec['xmin']:.3f} m, z {rec['zmin']:.3f}-{rec['zmax']:.3f}, "
              f"gaps (mm) {[round(g[2] * 1000, 2) for g in gaps]}, inflow {s.get('inflow_deg', 0.0):+.1f} deg")
        for i, e in enumerate(els):
            print(f"    E{i + 1}: c {e['chord'] * 1000:.0f} mm  {e['angle']:+.1f} deg  t/c {e['t_c'] * 100:.0f} %  {e['n']} pts")
    json.dump(secs, open(os.path.join(out_dir, "sections.json"), "w"))
    return secs


def plot_sections(secs, png):
    import matplotlib
    matplotlib.use("Agg")
    import matplotlib.pyplot as plt
    n = len(secs)
    fig, axs = plt.subplots(n, 1, figsize=(9, 2.6 * n), squeeze=False)
    for ax, s in zip(axs[:, 0], secs):
        for P in s["polys"]:
            P = np.asarray(P + [P[0]])
            ax.fill(P[:, 0], P[:, 1], color="0.75", ec="k", lw=0.6)
            ax.plot(P[:, 0], P[:, 1], ".", ms=1.5, color="C0")
        if s["ground"]:
            ax.axhline(0, color="C2", lw=1)
        ax.set_aspect("equal")
        ax.set_title(f"{s['id']}  (inflow {s['inflow_deg']:+.1f} deg)", fontsize=9)
        ax.tick_params(labelsize=7)
    fig.tight_layout()
    fig.savefig(png, dpi=110)


def inflow(web_dir, wing, y, xle, chord, zmin, zmax):
    """Mean flow angle (deg) and speed ratio on a vertical line 0.3 chord ahead of the section, from the 3D slices."""
    import matplotlib.image as mpimg
    meta = json.load(open(os.path.join(web_dir, "meta.json")))
    sl = meta["slices"]["y"]
    x0, x1, z0, z1 = sl["ext"]
    it = min(sl["items"], key=lambda i: abs(i["pos"] - y))
    vals = {}
    for f in ("Ux", "Uz"):
        enc = meta["fields"][f]["enc"]
        img = mpimg.imread(os.path.join(web_dir, "slices", f"y_{it['i']:03d}_{f}.png"))
        img = img[..., 0] if img.ndim == 3 else img
        p = np.round(img * 255).astype(int)
        v = enc["ref"] + enc["a"] * np.sinh(enc["A0"] + (p - 1) / 254 * (enc["A1"] - enc["A0"]))
        v[p == 0] = np.nan
        H, W = p.shape
        x = xle - 0.3 * chord
        j = int((x - x0) / (x1 - x0) * W)
        i0, i1 = int((z1 - zmax) / (z1 - z0) * H), int((z1 - zmin) / (z1 - z0) * H)
        vals[f] = np.nanmean(v[i0:i1 + 1, j])
    return math.degrees(math.atan2(vals["Uz"], vals["Ux"])), float(math.hypot(vals["Ux"], vals["Uz"]))


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "extract":
        cfg = json.loads(sys.argv[3])
        secs = extract(sys.argv[2], cfg, sys.argv[4])
        plot_sections(secs, os.path.join(sys.argv[4], "sections.png"))
    elif cmd == "inflow":
        a, r = inflow(sys.argv[2], sys.argv[3], *map(float, sys.argv[4:9]))
        print(f"{a:+.2f} {r:.3f}")
    else:
        sys.exit(__doc__)
