"""Split the hollow-vs-solid change into the force on the hollow model's interior faces and the rest.

The hollow model is a skin: air entering through the inlets reached the inside faces of the floor, bodywork and
sidepods, and the pressure there counted in each part's force. Those faces disappear when the interior is
filled. A closed cavity at uniform pressure gives no net force, so their sum (and their mean Cp) says whether
the interior itself carried load, or whether the change comes from the exterior flow. With the two display surfaces (Cp per vertex, half car), a hollow face whose centroid is farther than
`dist` from the solid surface (exact point-triangle distance) is an interior face; the sum of -Cp n_z dA over those faces (x2 for the full car) is the ClA they
carried. The rest of the change (solid surface total - hollow exterior faces) is a change of the exterior flow.
Per-part interior values depend on how the region split assigns the cavity faces; only the totals are robust.

Light-weight (NumPy/SciPy on the decimated web surfaces), safe to run locally. The hollow surface must be
an archived copy (the result branches were overwritten by the solid re-runs):
    python scripts/hollow_interior.py <web_data_dir> <hollow surface.fsb.gz> [dist_m]
Writes <web_data_dir>/hollow.json -> "interior" (hollow_compare.py copies it into index.json).
"""
from __future__ import annotations

import json
import os
import sys

import numpy as np
from scipy.spatial import cKDTree

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import isofilter  # noqa: E402


def closest_point_tri(p, a, b, c):
    """Vectorised closest point on triangles (a, b, c) to points p (Ericson, Real-Time Collision Detection 5.1.5)."""
    ab, ac, ap = b - a, c - a, p - a
    d1 = np.einsum("ij,ij->i", ab, ap); d2 = np.einsum("ij,ij->i", ac, ap)
    bp = p - b
    d3 = np.einsum("ij,ij->i", ab, bp); d4 = np.einsum("ij,ij->i", ac, bp)
    cp = p - c
    d5 = np.einsum("ij,ij->i", ab, cp); d6 = np.einsum("ij,ij->i", ac, cp)
    vc = d1 * d4 - d3 * d2; vb = d5 * d2 - d1 * d6; va = d3 * d6 - d5 * d4
    den = va + vb + vc
    den = np.where(np.abs(den) < 1e-30, 1e-30, den)
    v = vb / den; w = vc / den
    res = a + ab * v[:, None] + ac * w[:, None]  # interior
    # edge regions
    m = (vc <= 0) & (d1 >= 0) & (d3 <= 0)
    t = d1 / np.where(np.abs(d1 - d3) < 1e-30, 1e-30, d1 - d3); res[m] = (a + ab * t[:, None])[m]
    m = (vb <= 0) & (d2 >= 0) & (d6 <= 0)
    t = d2 / np.where(np.abs(d2 - d6) < 1e-30, 1e-30, d2 - d6); res[m] = (a + ac * t[:, None])[m]
    m = (va <= 0) & ((d4 - d3) >= 0) & ((d5 - d6) >= 0)
    t = (d4 - d3) / np.where(np.abs((d4 - d3) + (d5 - d6)) < 1e-30, 1e-30, (d4 - d3) + (d5 - d6)); res[m] = (b + (c - b) * t[:, None])[m]
    # vertex regions
    m = (d1 <= 0) & (d2 <= 0); res[m] = a[m]
    m = (d3 >= 0) & (d4 <= d3); res[m] = b[m]
    m = (d6 >= 0) & (d5 <= d6); res[m] = c[m]
    return res


def surface_distance(P, V, F, tree, k=8):
    """Distance from points P to the triangle surface (V, F); tree = cKDTree of the triangle centroids."""
    _, J = tree.query(P, k=k)
    best = np.full(len(P), np.inf); bj = np.zeros(len(P), np.int64)
    for i in range(k):
        j = J[:, i]
        q = closest_point_tri(P, V[F[j, 0]], V[F[j, 1]], V[F[j, 2]])
        d = np.linalg.norm(P - q, axis=1)
        m = d < best; best[m] = d[m]; bj[m] = j[m]
    return best, bj


def load(path):
    b, e = isofilter.read_fsb(path)
    V = isofilter.dequant_pos(b["pos"][0], b["pos"][1])
    F = b["index"][0].reshape(-1, 3).astype(np.int64)
    cq, cm = b["Cp"]
    cp = cm["min"] + cq.astype(float) / 65535.0 * (cm["max"] - cm["min"])
    a, bb, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    return {"V": V, "F": F, "n": np.cross(bb - a, c - a) * 0.5, "cp": cp[F].mean(1), "part": b["part"][0][F[:, 0]],
            "cen": (a + bb + c) / 3, "names": e["parts"]}


def main():
    out, hpath = sys.argv[1], sys.argv[2]
    dist = float(sys.argv[3]) if len(sys.argv) > 3 else 0.002
    index = json.load(open(os.path.join(out, "index.json")))
    hp = os.path.join(out, "hollow.json")
    hollow = json.load(open(hp))
    H, S = load(hpath), load(os.path.join(out, index["baseline"], "surface.fsb.gz"))
    # display triangles keep the solver orientation (normals out of the fluid); fix the sign on the total
    cla = lambda s, m: 2 * float(np.sum(-s["cp"][m] * s["n"][m, 2]))  # noqa: E731
    sg = 1.0 if cla(S, np.ones(len(S["cp"]), bool)) > 0 else -1.0
    # exterior faces of both decimated surfaces agree within ~1 mm; the inner skin faces sit 2-15 mm or more away
    inner = surface_distance(H["cen"], S["V"], S["F"], cKDTree(S["cen"]))[0] > dist
    area = np.linalg.norm(H["n"], axis=1)
    parts, surf = {}, {}
    for nm in sorted(set(H["names"]) | set(S["names"])):
        mh = H["part"] == H["names"].index(nm) if nm in H["names"] else np.zeros(len(H["cp"]), bool)
        ms = S["part"] == S["names"].index(nm) if nm in S["names"] else np.zeros(len(S["cp"]), bool)
        surf[nm] = {"hollow": sg * cla(H, mh), "filled": sg * cla(S, ms)}
        mi = mh & inner
        if area[mi].sum() > 1e-3:
            parts[nm] = {"ClA": sg * cla(H, mi), "area_m2": 2 * float(area[mi].sum()),
                         "Cp": float(np.sum(H["cp"][mi] * area[mi]) / area[mi].sum())}
    tot = lambda which: sum(v[which] for v in surf.values())  # noqa: E731
    # the surface integral (pressure only, decimated, Cp clipped) must agree with the solver forces
    mh_tot = hollow["baseline"]["forces"].get("total", {}).get("ClA")
    ms_tot = json.load(open(os.path.join(out, index["baseline"], "meta.json")))["forces"]["total"]["ClA"]
    ok = bool(mh_tot and abs(tot("hollow") - mh_tot) < 0.1 * abs(mh_tot) and abs(tot("filled") - ms_tot) < 0.1 * abs(ms_tot))
    ci = sum(v["ClA"] for v in parts.values())
    hollow["interior"] = {
        "dist_m": dist, "ok": ok, "h0": hollow["baseline"].get("h0"),
        "ClA": ci, "exterior_change": tot("filled") - (tot("hollow") - ci), "hollow_exterior": tot("hollow") - ci, "area_m2": sum(v["area_m2"] for v in parts.values()),
        "Cp": float(np.sum(H["cp"][inner] * area[inner]) / max(area[inner].sum(), 1e-9)),
        "parts": parts, "surface_parts": surf,
        "check": {"surface_hollow": tot("hollow"), "forces_hollow": mh_tot, "surface_filled": tot("filled"), "forces_filled": ms_tot},
    }
    json.dump(hollow, open(hp, "w"), indent=1)
    I = hollow["interior"]
    print(f"interior faces (> {1000 * dist:.0f} mm from the solid surface): {I['area_m2']:.2f} m2, mean Cp {I['Cp']:.3f}, ClA {I['ClA']:+.3f}, exterior change {I['exterior_change']:+.3f}"
          f" | check surface/forces hollow {tot('hollow'):.3f}/{mh_tot:.3f} filled {tot('filled'):.3f}/{ms_tot:.3f} -> {'ok' if ok else 'MISMATCH'}")
    for k, v in sorted(parts.items(), key=lambda kv: -abs(kv[1]["ClA"])):
        e = surf[k]
        print(f"  {k:12s} interior ClA {v['ClA']:+.3f} ({v['area_m2']:.2f} m2, Cp {v['Cp']:+.2f}) | part hollow {e['hollow']:.3f} -> solid {e['filled']:.3f}"
              f" | exterior change {e['filled'] - (e['hollow'] - v['ClA']):+.3f}")


if __name__ == "__main__":
    main()
