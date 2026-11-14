"""Add the hollow-model vs filled-model comparison to a collected F1 web folder (index.json -> "hollow").

The hollow results (visual model with an empty interior, no cooling flow) were archived in <dir>/hollow.json
before the filled re-runs overwrote the result branches. The hollow runs stopped earlier, so besides the final
values the filled run is also averaged over the same iteration window as the hollow one (last 20 % of the
hollow's iterations), from its force history. Optional sweep=<case>:<ratio> arguments add the sensitivity
to the imposed radiator flow (index.json -> "cooling_sweep"). Light-weight (JSON + git), safe to run locally:
    python scripts/hollow_compare.py <web_data_dir> [sweep=<case>:<ratio> ...]
"""
from __future__ import annotations

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from collect_web import remote_meta  # noqa: E402

KEYS = ("ClA", "CdA", "balance_front", "iters", "cells", "parts")


def window_mean(hist, it_end, frac=0.2):
    it = hist.get("iter") or []
    if not it:
        return None
    lo = (1 - frac) * it_end
    sel = [i for i, x in enumerate(it) if lo <= x <= it_end]
    if not sel:
        return None
    m = lambda k: sum(hist[k][i] for i in sel) / len(sel)  # noqa: E731
    return {"ClA": m("ClA"), "CdA": m("CdA"), "balance_front": m("balance"), "window": [it[sel[0]], it[sel[-1]]]}


def main():
    out = sys.argv[1]
    hp = os.path.join(out, "hollow.json")
    if not os.path.exists(hp):
        raise SystemExit(f"no {hp}")
    hollow = json.load(open(hp))
    ip = os.path.join(out, "index.json")
    index = json.load(open(ip))
    hrows = {round(r["h0"], 3): r for r in hollow["mesh_study"] if r.get("h0")}
    rows = []
    for r in index["mesh_study"]:
        h = hrows.get(round(r.get("h0") or 0, 3))
        if not h:
            continue
        local = os.path.join(out, r["case"], "meta.json")
        meta = json.load(open(local)) if os.path.exists(local) else remote_meta(r["case"])
        matched = window_mean(meta.get("history", {}), h["iters"]) if h.get("iters") else None
        rows.append({"label": r["label"], "h0": r["h0"], "hollow": {k: h.get(k) for k in KEYS},
                     "filled": {k: r.get(k) for k in KEYS}, "filled_matched": matched})
    fb = os.path.join(out, index["baseline"], "meta.json")
    base = None
    fm = json.load(open(fb)) if os.path.exists(fb) else None
    if fm and round(fm.get("config", {}).get("h0") or 0, 3) == round(hollow["baseline"].get("h0") or -1, 3):
        hf = hollow["baseline"]["forces"]
        base = {"h0": hollow["baseline"].get("h0"),
                "parts": {k: {"hollow": hf[k].get("ClA"), "filled": fm["forces"][k].get("ClA"),
                              "hollow_CdA": hf[k].get("CdA"), "filled_CdA": fm["forces"][k].get("CdA")}
                          for k in hf if k in fm["forces"]}}
    index["hollow"] = {"rows": rows, "fine_parts": base, "note": hollow.get("note")}
    # optional sensitivity to the imposed cooling flow: sweep=<case>:<face velocity ratio> (same mesh)
    sweep = []
    for a in sys.argv[2:]:
        if not a.startswith("sweep="):
            continue
        case, ratio = a.split("=", 1)[1].split(":")
        local = os.path.join(out, case, "meta.json")
        m = json.load(open(local)) if os.path.exists(local) else remote_meta(case)
        t, c = m["forces"]["total"], m.get("cooling", {})
        sweep.append({"case": case, "ratio": float(ratio), "h0": m["config"].get("h0"), "iters": m["history"]["iter"][-1],
                      "ClA": t["ClA"], "CdA": t["CdA"], "ClA_std": t.get("ClA_std"), "CdA_std": t.get("CdA_std"),
                      "balance_front": t.get("balance_front"),
                      "parts": {k: m["forces"][k]["ClA"] for k in ("frontwing", "floor", "diffuser", "rearwing", "body", "sidepods") if k in m["forces"]},
                      "Cp_radiator_in": c.get("Cp_radiator_in"), "Q_full_m3s": c.get("Q_full_m3s"),
                      "cooling_CdA": m["forces"].get("cooling", {}).get("CdA")})
    if sweep:
        index["cooling_sweep"] = sorted(sweep, key=lambda r: r["ratio"])
    json.dump(index, open(ip, "w"), indent=1)
    for x in rows:
        h, f, m = x["hollow"], x["filled"], x["filled_matched"] or {}
        print(f"{x['label']:14s} hollow ClA {h['ClA']:.3f} CdA {h['CdA']:.3f} ({h['iters']:.0f} it) | filled ClA {f['ClA']:.3f} "
              f"CdA {f['CdA']:.3f} ({f['iters']:.0f} it) | filled@hollow window ClA {m.get('ClA', float('nan')):.3f} CdA {m.get('CdA', float('nan')):.3f}")


if __name__ == "__main__":
    main()
