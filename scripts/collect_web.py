"""Pull finished CFD results (branches res-<case>) into the web folder and write index.json.

Light-weight (git + JSON only), safe to run locally:
    python scripts/collect_web.py <web_data_dir> baseline=<case> [mesh=<case>:<label> ...] [map=<case>:<label> ...]
"""
from __future__ import annotations

import json
import os
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
Q_WALL = float(os.environ.get("Q_WALL", "0.025"))  # wall clearance of the Q iso-surfaces [m]


def git(*a, cwd=REPO):
    return subprocess.run(["git", *a], cwd=cwd, check=True, capture_output=True, text=True).stdout


def fetch_case(case, dest):
    git("fetch", "-q", "origin", f"res-{case}")
    tmp = tempfile.mkdtemp()
    try:
        git("--work-tree", tmp, "checkout", "FETCH_HEAD", "--", ".")
        git("reset", "-q")  # leave the index of the cfd branch untouched
        src = os.path.join(tmp, "web")
        if not os.path.isdir(src):
            raise SystemExit(f"res-{case} has no web/ folder (post-processing failed?)")
        if os.path.isdir(dest):
            shutil.rmtree(dest)
        shutil.copytree(src, dest)
        for extra in ("case.json", "run.txt"):
            if os.path.exists(os.path.join(tmp, extra)):
                shutil.copy(os.path.join(tmp, extra), dest)
        snappy = os.path.join(tmp, "logs", "log.snappyHexMesh")
        if os.path.exists(snappy):  # re-parse the layer table (older postpro read the wrong columns)
            sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
            from postpro import layer_table
            mp = os.path.join(dest, "meta.json")
            mm = json.load(open(mp))
            mm.setdefault("mesh", {}).update(layer_table(open(snappy, errors="ignore").read()))
            json.dump(mm, open(mp, "w"))
    finally:
        shutil.rmtree(tmp, ignore_errors=True)
    try:  # drop boundary-layer sheets from the iso-surfaces (light NumPy pass)
        sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
        import isofilter
        if os.path.exists(os.path.join(dest, "surface.fsb.gz")):
            isofilter.run(dest, 0.008, Q_WALL)
    except Exception as e:  # noqa: BLE001
        print("isofilter skipped:", e)
    return json.load(open(os.path.join(dest, "meta.json")))


def summary(meta):
    t = meta.get("forces", {}).get("total", {})
    return {"ClA": t.get("ClA"), "CdA": t.get("CdA"), "balance_front": t.get("balance_front"),
            "cells": meta.get("mesh", {}).get("cells"), "h0": meta.get("config", {}).get("h0"),
            "iters": (meta.get("history", {}).get("iter") or [None])[-1],
            "parts": {k: v.get("ClA") for k, v in meta.get("forces", {}).items()
                      if k in ("frontwing", "nosewing", "rearwing", "floor", "diffuser", "body")}}


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    args = dict(a.split("=", 1) for a in sys.argv[2:] if a.startswith("baseline="))
    base = args["baseline"]
    mesh = [a.split("=", 1)[1] for a in sys.argv[2:] if a.startswith("mesh=")]
    amap = [a.split("=", 1)[1] for a in sys.argv[2:] if a.startswith("map=")]
    car = dict(a.split("=", 1) for a in sys.argv[2:] if a.startswith("car=")).get("car", "mft02")
    index = {"car": car, "baseline": base, "cases": [], "mesh_study": [], "aeromap": []}
    meta = fetch_case(base, os.path.join(out, base))
    index["cases"].append({"name": base, "dir": base, "label": "baseline"})
    for spec in mesh:
        case, label = spec.split(":", 1)
        m = meta if case == base else json.load(open(os.path.join(out, case, "meta.json"))) if os.path.exists(os.path.join(out, case, "meta.json")) else None
        if m is None:
            git("fetch", "-q", "origin", f"res-{case}")
            m = json.loads(git("show", "FETCH_HEAD:web/meta.json"))
        index["mesh_study"].append({"case": case, "label": label, **summary(m)})
    for spec in amap:
        case, label = spec.split(":", 1)
        if case == base:
            m = meta
        else:
            git("fetch", "-q", "origin", f"res-{case}")
            m = json.loads(git("show", "FETCH_HEAD:web/meta.json"))
        v = m.get("config", {}).get("variant") or m.get("car", {}).get("variant") or {}
        index["aeromap"].append({"case": case, "label": label, "front_rh_mm": v.get("front_rh_mm", 0),
                                 "rear_rh_mm": v.get("rear_rh_mm", 0), **summary(m)})
    json.dump(index, open(os.path.join(out, "index.json"), "w"), indent=1)
    total = sum(os.path.getsize(os.path.join(d, f)) for d, _, fs in os.walk(out) for f in fs)
    print(json.dumps(index, indent=1))
    print(f"web data: {total/1e6:.1f} MB in {out}")


if __name__ == "__main__":
    main()
