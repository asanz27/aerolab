"""Remove iso-surface triangles that hug the car walls (boundary-layer Q / Cpt sheets).

NumPy only (no SciPy/VTK): the car surface is rasterised into a voxel grid, dilated by the wall
distance and iso triangles whose vertices fall inside are dropped. Works on the FSB web files.

usage: python isofilter.py <web_dir> [dist_m=0.008]
"""
from __future__ import annotations

import gzip
import json
import os
import sys

import numpy as np


def read_fsb(path):
    raw = gzip.open(path, "rb").read() if open(path, "rb").read(2) == b"\x1f\x8b" else open(path, "rb").read()
    assert raw[:4] == b"FSB1"
    hlen = int(np.frombuffer(raw[4:8], "<u4")[0])
    hdr = json.loads(raw[8:8 + hlen].decode())
    base = 8 + hlen
    bufs = {}
    for b in hdr["buffers"]:
        dt = np.dtype("<" + b["dtype"])
        bufs[b["name"]] = (np.frombuffer(raw, dt, b["count"], base + b["offset"]).copy(), {k: v for k, v in b.items() if k not in ("name", "dtype", "count", "offset")})
    extra = {k: v for k, v in hdr.items() if k != "buffers"}
    return bufs, extra


def write_fsb(path, buffers, extra=None):
    hdr = {"buffers": [], **(extra or {})}
    blobs, off = [], 0
    for name, (arr, meta) in buffers.items():
        arr = np.ascontiguousarray(arr)
        b = arr.tobytes()
        pad = (-len(b)) % 4
        hdr["buffers"].append({"name": name, "dtype": arr.dtype.str.lstrip("<|"), "count": int(arr.size), "offset": off, **(meta or {})})
        blobs.append(b + b"\0" * pad)
        off += len(b) + pad
    hj = json.dumps(hdr, separators=(",", ":")).encode()
    hj += b" " * ((-len(hj)) % 4)
    with gzip.open(path, "wb", compresslevel=9) as fh:
        fh.write(b"FSB1" + np.uint32(len(hj)).tobytes() + hj + b"".join(blobs))


def dequant_pos(q, meta):
    lo, hi = np.array(meta["min"]), np.array(meta["max"])
    return lo + q.reshape(-1, 3).astype(float) / 65535.0 * (hi - lo)


def wall_mask_grid(V, F, h, pad):
    """Boolean voxel grid marking voxels within ~pad of the triangle surface (V, F)."""
    lo = V.min(0) - pad - 2 * h
    hi = V.max(0) + pad + 2 * h
    n = np.ceil((hi - lo) / h).astype(int) + 1
    grid = np.zeros(n, bool)
    a, b, c = V[F[:, 0]], V[F[:, 1]], V[F[:, 2]]
    L = np.maximum(np.linalg.norm(b - a, axis=1), np.linalg.norm(c - a, axis=1))
    k = np.clip(np.ceil(L / (0.5 * h)).astype(int), 1, 40)
    for kk in np.unique(k):
        sel = k == kk
        u, v = np.meshgrid(np.arange(kk + 1), np.arange(kk + 1))
        m = (u + v) <= kk
        u, v = u[m] / kk, v[m] / kk
        P = a[sel, None, :] + u[None, :, None] * (b[sel] - a[sel])[:, None, :] + v[None, :, None] * (c[sel] - a[sel])[:, None, :]
        idx = np.floor((P.reshape(-1, 3) - lo) / h).astype(int)
        grid[idx[:, 0], idx[:, 1], idx[:, 2]] = True
    r = int(np.ceil(pad / h))
    for ax in range(3):  # box dilation, axis by axis
        g = grid.copy()
        for s in range(1, r + 1):
            g |= np.roll(grid, s, axis=ax) | np.roll(grid, -s, axis=ax)
        grid = g
    return grid, lo


def cluster(P, F, fields, h):
    """Vertex clustering on a grid of size h: vertices in one cell merge into their mean (fields averaged too);
    collapsed and duplicated triangles are dropped. Triangles larger than h are left as they are."""
    lo = P.min(0)
    c = np.floor((P - lo) / h).astype(np.int64)
    n = c.max(0) + 1
    key = (c[:, 0] * n[1] + c[:, 1]) * n[2] + c[:, 2]
    _, first, inv = np.unique(key, return_index=True, return_inverse=True)
    m = len(first)
    cnt = np.bincount(inv, minlength=m).astype(float)
    Q = np.stack([np.bincount(inv, P[:, k], m) / cnt for k in range(3)], 1)
    G = inv[F]
    G = G[(G[:, 0] != G[:, 1]) & (G[:, 1] != G[:, 2]) & (G[:, 0] != G[:, 2])]
    _, keep = np.unique(np.sort(G, 1), axis=0, return_index=True)
    G = G[np.sort(keep)]
    out = {k: np.round(np.bincount(inv, a.astype(float), m) / cnt).astype(a.dtype) for k, a in fields.items()}
    return Q, G, out


def decimate(P, F, fields, target):
    """Cluster with the cell size that leaves about `target` triangles (bisection on log h)."""
    if len(F) <= target:
        return P, F, fields
    a, b = np.log(1e-4), np.log(0.2)
    best = None
    for _ in range(14):
        h = np.exp(0.5 * (a + b))
        Q, G, out = cluster(P, F, fields, h)
        if len(G) > target:
            a = np.log(h)
        else:
            b = np.log(h)
            best = (Q, G, out)
        if best is not None and 0.85 * target <= len(best[1]) <= target:
            break
    return best if best is not None else cluster(P, F, fields, np.exp(b))


def filter_iso(iso_path, surf_V, surf_F, dist=0.008, h=0.004, target=200000):
    bufs, extra = read_fsb(iso_path)
    P = dequant_pos(bufs["pos"][0], bufs["pos"][1])
    F = bufs["index"][0].reshape(-1, 3)
    grid, lo = wall_mask_grid(surf_V, surf_F, h, dist)
    idx = np.floor((P - lo) / h).astype(int)
    inside = np.all((idx >= 0) & (idx < np.array(grid.shape)), axis=1)
    near = np.zeros(len(P), bool)
    near[inside] = grid[idx[inside, 0], idx[inside, 1], idx[inside, 2]]
    keepF = F[near[F].sum(1) == 0]
    used = np.unique(keepF)
    remap = -np.ones(len(P), np.int64)
    remap[used] = np.arange(len(used))
    newF = remap[keepF].astype(np.uint32)
    out = {}
    for name, (arr, meta) in bufs.items():
        if name == "pos":
            out[name] = (arr.reshape(-1, 3)[used].reshape(-1), meta)
        elif name == "index":
            out[name] = (newF.reshape(-1), meta)
        elif arr.size == len(P):
            out[name] = (arr[used], meta)
        else:
            out[name] = (arr, meta)
    if len(newF) > target:  # the runner's decimation failed (postpro before 2026-11-20): cluster the vertices here
        pm = out["pos"][1]
        V = dequant_pos(out["pos"][0], pm)
        fl = {k: a for k, (a, _) in out.items() if k not in ("pos", "index") and a.size == len(V)}
        Q, G, fo = decimate(V, newF.astype(np.int64), fl, target)
        lo, hi = Q.min(0), Q.max(0)
        q = np.round(np.clip((Q - lo) / (hi - lo + 1e-30), 0, 1) * 65535).astype(np.uint16)
        out["pos"] = (q.reshape(-1), {**pm, "min": lo.round(6).tolist(), "max": hi.round(6).tolist()})
        out["index"] = (G.astype(np.uint32).reshape(-1), out["index"][1])
        for k, a in fo.items():
            out[k] = (a, out[k][1])
        keepF = G
    write_fsb(iso_path, out, extra)
    return len(F), len(keepF)


def run(web_dir, dist=0.008, q_dist=None):
    """dist: wall clearance for all iso-surfaces; q_dist (optional, larger): for the Q-criterion ones, whose
    boundary-layer sheets reach further from the wall on thick (fine-mesh) boundary layers."""
    sb, _ = read_fsb(os.path.join(web_dir, "surface.fsb.gz"))
    V = dequant_pos(sb["pos"][0], sb["pos"][1])
    F = sb["index"][0].reshape(-1, 3).astype(np.int64)
    res = {}
    for fn in sorted(os.listdir(web_dir)):
        if fn.startswith("iso_") and fn.endswith(".fsb.gz"):
            d = q_dist if (q_dist and fn.startswith("iso_q")) else dist
            res[fn] = filter_iso(os.path.join(web_dir, fn), V, F, d) + (d,)
            print(fn, "triangles", res[fn])
    meta_p = os.path.join(web_dir, "meta.json")
    meta = json.load(open(meta_p))
    for it in meta.get("iso", []):
        if it.get("file") in res:
            it["tris"] = int(res[it["file"]][1])
            it["wall_filter_m"] = res[it["file"]][2]
    json.dump(meta, open(meta_p, "w"), separators=(",", ":"))
    return res


if __name__ == "__main__":
    run(sys.argv[1], float(sys.argv[2]) if len(sys.argv) > 2 else 0.008, float(sys.argv[3]) if len(sys.argv) > 3 else None)
