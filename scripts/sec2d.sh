# 2D wing-section runs (option B of the wing-separation diagnosis, 2026-11-22). Sourced by run_case.sh after the
# geometry build when the case has "sec2d" (list of {id, wing FW|RW, y}); uses its functions and variables
# (CASE, RES, CFG, ROOT, NP, jget, status, stamp, collect). Runner only: never run this on a laptop.
# For each section x variant: gmsh mesh -> gmshToFoam -> simpleFoam (serial, NP runs at a time) -> results JSON/PNG
# in results/<name>/sec2d. The section outlines (private CAD) stay in $CASE.
sec2d_main() {
  local S2="$CASE/sec2d" OUT="$RES/sec2d" ITERS2 VARS IDS
  mkdir -p "$S2" "$OUT/logs" "$RES/logs"
  echo "sec2d: installing gmsh"
  sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q libglu1-mesa libxcursor1 libxinerama1 libxft2 libxrender1 \
    > /dev/null 2>&1 || true
  pip install -q gmsh shapely contourpy > "$RES/logs/log.pip_sec2d" 2>&1 || { tail -5 "$RES/logs/log.pip_sec2d"; return 1; }
  python3 -c "import gmsh; print('gmsh', gmsh.__version__)" || return 1
  python3 "$ROOT/scripts/sec2d_geom.py" extract "$CASE/constant/triSurface" "$CFG" "$S2" > "$RES/logs/log.sec2d_geom" 2>&1 \
    || { tail -20 "$RES/logs/log.sec2d_geom"; return 1; }
  cat "$RES/logs/log.sec2d_geom"
  cp "$S2/sections.png" "$OUT/" 2>/dev/null
  ITERS2=$(jget iters 6000)
  VARS=$(python3 -c "import json,sys; print(' '.join(json.loads(sys.argv[1]).get('variants', ['bl', 'iso', 'iso_sa', 'coarse', 'iso_m5'])))" "$CFG")
  IDS=$(python3 -c "import json,sys; print(' '.join(s['id'] for s in json.load(open(sys.argv[1]))))" "$S2/sections.json")
  : > "$S2/jobs.txt"
  for id in $IDS; do for v in $VARS; do echo "$id $v" >> "$S2/jobs.txt"; done; done
  local NJOB; NJOB=$(wc -l < "$S2/jobs.txt")
  echo "sec2d: $NJOB runs ($IDS) x ($VARS), $ITERS2 iterations, $NP at a time" | tee "$CASE/log.sec2d"
  stamp sec2d_start
  # wall-clock guard: every running case is told to write and stop 35 min before the job limit
  local STOP_AT=$(( JOB_START + (BUDGET_MIN - 35) * 60 ))
  ( sleep $(( STOP_AT - $(date +%s) )); echo "deadline: writeNow" >> "$CASE/log.sec2d"
    for d in "$S2"/*__*/system/controlDict; do foamDictionary "$d" -entry stopAt -set writeNow > /dev/null 2>&1; done
    touch "$S2/DEADLINE" ) > /dev/null 2>&1 &
  local GUARD2=$!
  ( while true; do sleep 600; status "sec2d: $(grep -c ' done' "$CASE/log.sec2d") of $NJOB runs done"; done ) > /dev/null 2>&1 &
  local ST2=$!
  cg_out $ST2
  local pids=() id v
  while read -r id v; do
    while :; do
      local alive=0 p
      for p in "${pids[@]}"; do kill -0 "$p" 2>/dev/null && alive=$((alive + 1)); done
      [ "$alive" -lt "$NP" ] && break
      sleep 10
    done
    [ -f "$S2/DEADLINE" ] && { echo "$id $v skipped (deadline)" >> "$CASE/log.sec2d"; continue; }
    sec2d_one "$S2" "$OUT" "$id" "$v" "$ITERS2" &
    pids+=($!)
  done < "$S2/jobs.txt"
  wait "${pids[@]}" 2>/dev/null
  kill $GUARD2 $ST2 2>/dev/null
  stamp sec2d_end
  python3 - "$OUT" > "$OUT/summary.txt" <<'EOF'
import glob, json, os, sys
rows = []
for f in sorted(glob.glob(os.path.join(sys.argv[1], "*__*.json"))):
    if f.endswith("__wall.json"):
        continue
    r = json.load(open(f))
    t = r.get("forces", {}).get("total", {})
    els = " ".join(f"{e['name']}:{e['rev_suction'] * 100:.0f}%" for e in r.get("elements", []))
    rows.append(f"{r['section']:14s} {r['variant']:7s} cells {r['mesh'].get('cells', 0):7d}  Cl {t.get('Cl', float('nan')):6.3f} "
                f"+- {t.get('Cl_std', float('nan')):.3f}  Cd {t.get('Cd', float('nan')):6.3f}  it {t.get('last_iter', 0):5d}  "
                f"reversed suction {r.get('rev_suction_total', float('nan')) * 100:4.0f} %  [{els}]")
print("\n".join(rows))
EOF
  cat "$OUT/summary.txt" | tee -a "$CASE/log.sec2d"
  collect
  return 0
}

sec2d_one() {
  local S2="$1" OUT="$2" id="$3" v="$4" IT="$5"
  local C="$S2/${id}__${v}" PY="$ROOT/scripts/sec2d_case.py" t0
  t0=$(date +%s)
  mkdir -p "$C"
  (
    cd "$C" || exit 1
    python3 "$PY" setup "$S2/sections.json" "$id" "$v" "$C" "$IT" > log.setup 2>&1 || exit 2
    python3 "$PY" mesh "$S2/sections.json" "$id" "$v" "$C" > log.mesh 2>&1 || exit 3
    gmshToFoam mesh.msh > log.gmshToFoam 2>&1 || exit 4
    rm -f mesh.msh
    python3 "$PY" fixb "$S2/sections.json" "$id" "$v" "$C" > log.fixb 2>&1 || exit 5
    checkMesh > log.checkMesh 2>&1
    if [ "$(jget sec2d_mesh_only false)" = "true" ]; then
      python3 "$PY" meshpic "$S2/sections.json" "$id" "$v" "$C" "$OUT/${id}__${v}__mesh.png" > log.meshpic 2>&1
      exit 0
    fi
    cp system/fvSchemes.first system/fvSchemes
    foamDictionary system/controlDict -entry endTime -set 300 > /dev/null
    foamDictionary system/controlDict -entry writeInterval -set 300 > /dev/null
    simpleFoam > log.simpleFoam.1 2>&1 || exit 6
    cp system/fvSchemes.second system/fvSchemes
    foamDictionary system/controlDict -entry endTime -set "$IT" > /dev/null
    foamDictionary system/controlDict -entry writeInterval -set $(( IT / 3 )) > /dev/null
    simpleFoam > log.simpleFoam.2 2>&1 || echo "second-order solve stopped with an error" >> log.simpleFoam.2
    python3 "$PY" post "$S2/sections.json" "$id" "$v" "$C" "$OUT" > log.post 2>&1 || exit 7
    exit 0
  )
  local rc=$?
  mkdir -p "$OUT/logs/${id}__${v}"
  for f in "$C"/log.* "$C"/mesh_info.json; do
    [ -f "$f" ] && tail -c 3000000 "$f" > "$OUT/logs/${id}__${v}/$(basename "$f")"
  done
  [ -f "$C/log.checkMesh" ] && grep -E "cells:|Mesh OK|Failed|non-orthogonality|skewness|aspect" "$C/log.checkMesh" | head -8 >> "$OUT/logs/${id}__${v}/checkMesh.short"
  local what="done"
  [ "$rc" -ne 0 ] && what="FAILED (step $rc: 2 setup 3 mesh 4 gmshToFoam 5 boundary 6 first solve 7 post)"
  echo "$id $v $what in $(( ($(date +%s) - t0) / 60 )) min" >> "$CASE/log.sec2d"
  if [ "$rc" -ne 0 ]; then         # the failing step's log goes to the live status (st-<name>) too
    local lg; lg=$(ls -t "$C"/log.* 2>/dev/null | head -1)
    [ -n "$lg" ] && { echo "--- $(basename "$lg"):"; grep -iE "error|exception|fatal" "$lg" | head -5; tail -n 8 "$lg"; } >> "$CASE/log.sec2d"
  fi
  # keep the disk small: drop the case once its results are out
  [ "$rc" -eq 0 ] && rm -rf "$C"/[0-9]* "$C"/constant/polyMesh
  return $rc
}
