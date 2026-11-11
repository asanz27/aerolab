#!/usr/bin/env bash
# Full pipeline for one case on a GitHub-hosted runner (never run this on a laptop).
# usage: run_case.sh <name> '<json config>'
set -uo pipefail
NAME="$1"
CFG="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CASE="${RUNNER_TEMP:-/tmp}/case_${NAME}"
RES="$ROOT/results/${NAME}"
JOB_START="${JOB_START:-$(date +%s)}"
BUDGET_MIN="${BUDGET_MIN:-350}"          # job timeout (minutes) as configured in the workflow
POST_RESERVE_MIN="${POST_RESERVE_MIN:-38}" # time kept for reconstruction + post-processing
mkdir -p "$CASE" "$RES"
NP=$(nproc)

jget() { python3 -c "import json,sys; c=json.loads(sys.argv[1]); v=c.get(sys.argv[2], sys.argv[3]); print(json.dumps(v) if isinstance(v,(dict,list,bool)) else v)" "$CFG" "$1" "$2"; }
ITERS=$(jget iters 1500)
ITERS1=$(jget iters1 100)
MESH_ONLY=$(jget mesh_only false)
FRH=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('variant',{}).get('front_rh_mm',0))" "$CFG")
RRH=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('variant',{}).get('rear_rh_mm',0))" "$CFG")

declare -A T
stamp() { T[$1]=$(( $(date +%s) - JOB_START )); python3 - "$CASE/timings.json" "$1" "${T[$1]}" <<'EOF'
import json, os, sys
p, k, v = sys.argv[1], sys.argv[2], int(sys.argv[3])
d = json.load(open(p)) if os.path.exists(p) else {}
d[k] = v
json.dump(d, open(p, "w"), indent=1)
EOF
}

status() {
  # light status branch so progress can be followed without an account: st-<name>
  local S="${RUNNER_TEMP:-/tmp}/status_${NAME}"
  rm -rf "$S"; mkdir -p "$S"
  {
    echo "case: $NAME   stage: $1   elapsed: $(( ($(date +%s) - JOB_START) / 60 )) min"
    echo "memory used now (MB): $(free -m | awk 'NR==2{print $3}')   max so far: $(sort -n "$CASE/mem.log" 2>/dev/null | tail -1)"
    df -h / /mnt 2>/dev/null | tail -2
  } > "$S/status.txt"
  cp "$CASE"/timings.json "$S/" 2>/dev/null
  for f in "$CASE"/log.*; do [ -f "$f" ] && tail -n 60 "$f" > "$S/$(basename "$f").tail"; done
  grep -h "cells:" "$CASE/log.checkMesh" > "$S/cells.txt" 2>/dev/null
  for d in "$CASE"/postProcessing/forces_total/*/; do [ -f "$d/force.dat" ] && tail -n 5 "$d/force.dat" >> "$S/force_total.tail"; done
  bash "$ROOT/scripts/publish.sh" "$S" "st-${NAME}" "status ${NAME}: $1" >/dev/null 2>&1 || true
}

MEMPID=""; STPID=""; GUARD=""
trap 'kill $MEMPID $STPID $GUARD 2>/dev/null' EXIT
# memory sampler
( while true; do free -m | awk 'NR==2{print $3}' >> "$CASE/mem.log"; sleep 15; done ) > /dev/null 2>&1 &
MEMPID=$!

# OpenFOAM environment
set +eu
# shellcheck disable=SC1090
source "$OF_BASHRC"
set -u
echo "OpenFOAM: $WM_PROJECT_VERSION  procs: $NP"

CAR=$(jget car mft02)
GEOM="$ROOT/geometry/build_${CAR}.py"
[ "$CAR" = "esslingen" ] && GEOM="$ROOT/geometry/build_car.py"
python3 "$GEOM" "$CASE/constant/triSurface" --front-rh-mm "$FRH" --rear-rh-mm "$RRH" > "$CASE/log.geometry" 2>&1 || { cat "$CASE/log.geometry"; echo "geometry failed"; exit 1; }
python3 "$ROOT/scripts/make_case.py" "$CASE" "$CFG" || { echo "make_case failed"; exit 1; }
cd "$CASE"
sed -i "s/numberOfSubdomains .*/numberOfSubdomains $NP;/" system/decomposeParDict
cp system/fvSchemes.first system/fvSchemes
stamp start
status "meshing"

run() { local log="$1"; shift; echo ">> $*"; "$@" > "$log" 2>&1; local rc=$?; echo "   rc=$rc"; return $rc; }
par() { local log="$1"; shift; echo ">> mpirun -np $NP $*"; mpirun --oversubscribe -np "$NP" "$@" -parallel > "$log" 2>&1; local rc=$?; echo "   rc=$rc"; return $rc; }

fail() { echo "FAILED at $1"; stamp "failed_$1"; status "FAILED at $1"; collect; kill $MEMPID 2>/dev/null; exit 1; }

collect() {
  mkdir -p "$RES/logs"
  cp "$CASE"/log.* "$RES/logs/" 2>/dev/null
  cp "$CASE"/timings.json "$CASE"/mem.log "$RES/logs/" 2>/dev/null
  cp "$CASE"/run_config.json "$CASE/constant/triSurface/car.json" "$RES/" 2>/dev/null
  mkdir -p "$RES/postProcessing" && cp -r "$CASE"/postProcessing/* "$RES/postProcessing/" 2>/dev/null
  # keep the logs small enough for git
  for f in "$RES"/logs/log.*; do
    if [ "$(stat -c %s "$f")" -gt 20000000 ]; then tail -c 20000000 "$f" > "$f.tmp" && mv "$f.tmp" "$f"; fi
  done
}

run log.blockMesh blockMesh || fail blockMesh
run log.surfaceFeatureExtract surfaceFeatureExtract || fail surfaceFeatureExtract
run log.decomposePar decomposePar -force || fail decomposePar
stamp mesh_prep
( while true; do sleep 600; status "running"; done ) > /dev/null 2>&1 &
STPID=$!
par log.snappyHexMesh snappyHexMesh -overwrite || fail snappyHexMesh
stamp snappy
par log.checkMesh checkMesh -constant || true
grep -E "cells:|Mesh OK|Failed" log.checkMesh | head
stamp checkMesh

if [ "$MESH_ONLY" = "true" ]; then
  status "mesh only: done"
  collect
  kill $MEMPID $STPID 2>/dev/null
  exit 0
fi

for d in processor*; do rm -rf "$d/0"; cp -r 0.orig "$d/0"; done
par log.potentialFoam potentialFoam -writephi || fail potentialFoam
stamp potentialFoam

# stage 1: first-order momentum for robustness
foamDictionary system/controlDict -entry endTime -set "$ITERS1" > /dev/null
foamDictionary system/controlDict -entry writeInterval -set "$ITERS1" > /dev/null
par log.simpleFoam.1 simpleFoam || fail simpleFoam1
stamp solve1

# stage 2: second order, guarded by a wall-clock deadline
cp system/fvSchemes.second system/fvSchemes
foamDictionary system/controlDict -entry endTime -set "$ITERS" > /dev/null
foamDictionary system/controlDict -entry writeInterval -set 100 > /dev/null
NOW=$(date +%s)
STOP_AT=$(( JOB_START + (BUDGET_MIN - POST_RESERVE_MIN) * 60 ))
SLEEP=$(( STOP_AT - NOW ))
echo "solver wall-clock budget: $(( SLEEP / 60 )) min"
( sleep "$SLEEP"; echo "deadline reached -> writeNow" > deadline.txt; foamDictionary system/controlDict -entry stopAt -set writeNow > /dev/null ) > /dev/null 2>&1 &
GUARD=$!
par log.simpleFoam.2 simpleFoam || fail simpleFoam2
kill $GUARD 2>/dev/null
stamp solve2
status "reconstructing"

run log.reconstructParMesh reconstructParMesh -constant || fail reconstructParMesh
run log.reconstructPar reconstructPar -latestTime || fail reconstructPar
stamp reconstruct
collect
status "post-processing"
python3 "$ROOT/scripts/postpro.py" "$CASE" "$RES" "$CFG" > "$RES/logs/log.postpro" 2>&1 || echo "postpro returned non-zero"
stamp postpro
cp "$CASE"/timings.json "$RES/logs/"

# optionally archive the (small) reconstructed case so post-processing can be re-run later
if [ "$(jget archive_case false)" = "true" ]; then
  mkdir -p "$RES/case_archive"
  LAST=$(foamListTimes -latestTime 2>/dev/null | tail -1)
  tar -czf - constant/polyMesh constant/triSurface/*.stl constant/triSurface/car.json system run_config.json \
      "$LAST" postProcessing log.* timings.json 2>/dev/null | split -b 45m - "$RES/case_archive/case.tgz."
  ls -la "$RES/case_archive"
fi
status "done"
kill $MEMPID $STPID 2>/dev/null
exit 0
