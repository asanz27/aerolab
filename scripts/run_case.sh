#!/usr/bin/env bash
# Pipeline for one case on a GitHub-hosted runner (never run this on a laptop).
# usage: run_case.sh <name> '<json config>'
#
# Long cases are split into STAGES (separate 6 h jobs of the same workflow run). Stage 1 meshes and
# starts the solver; when the wall-clock budget runs out and the case still has iterations to go, the
# decomposed case is packed into $STATE_DIR (uploaded as a short-lived artifact by the workflow) and
# the next stage resumes from it. The last stage (or any stage that reaches the target iterations)
# reconstructs, post-processes and marks the results as final.
# Private geometry (cfg.private=true) is fetched encrypted from branch cad-<car> and decrypted with
# $CAD_KEY (a repository secret); the packed state of such cases is encrypted with the same key.
set -uo pipefail
NAME="$1"
CFG="$2"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
CASE="${RUNNER_TEMP:-/tmp}/case_${NAME}"
RES="$ROOT/results/${NAME}"
STATE_DIR="${STATE_DIR:-${RUNNER_TEMP:-/tmp}/state}"
JOB_START="${JOB_START:-$(date +%s)}"
BUDGET_MIN="${BUDGET_MIN:-350}"          # job timeout (minutes) as configured in the workflow
STAGE="${STAGE:-1}"
mkdir -p "$CASE" "$RES" "$STATE_DIR"
NP=$(nproc)

jget() { python3 -c "import json,sys; c=json.loads(sys.argv[1]); v=c.get(sys.argv[2], sys.argv[3]); print(json.dumps(v) if isinstance(v,(dict,list,bool)) else v)" "$CFG" "$1" "$2"; }
ITERS=$(jget iters 1500)
ITERS1=$(jget iters1 100)
NSTAGES=$(jget stages 1)
PRIVATE=$(jget private false)
MESH_ONLY=$(jget mesh_only false)
FRH=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('variant',{}).get('front_rh_mm',0))" "$CFG")
RRH=$(python3 -c "import json,sys; print(json.loads(sys.argv[1]).get('variant',{}).get('rear_rh_mm',0))" "$CFG")
FINAL_STAGE=false; [ "$STAGE" -ge "$NSTAGES" ] && FINAL_STAGE=true
# time kept at the end of the job: reconstruction + post-processing (final) or packing + upload (intermediate)
if [ "$FINAL_STAGE" = true ]; then POST_RESERVE_MIN="${POST_RESERVE_MIN:-45}"; else POST_RESERVE_MIN="${PACK_RESERVE_MIN:-25}"; fi

get_key() {
  # The CAD key comes from the CAD_KEY repository secret when it exists. Otherwise this job asks for it:
  # it creates an RSA key pair, publishes ONLY the public key on branch kx-<name>-s<stage>-<run>, and
  # waits for the owner's machine to answer on kr-... with the CAD key encrypted for that public key
  # (RSA-OAEP). The private key never leaves this runner, so nothing readable is ever made public.
  [ -n "${CAD_KEY:-}" ] && return 0
  local tag="kx-${NAME}-s${STAGE}-${GITHUB_RUN_ID:-0}" kd="${RUNNER_TEMP:-/tmp}/kx_${NAME}"
  local resp="kr-${tag#kx-}"
  rm -rf "$kd"; mkdir -p "$kd/pub"
  openssl genpkey -algorithm RSA -pkeyopt rsa_keygen_bits:3072 -out "$kd/priv.pem" 2>/dev/null || return 1
  openssl pkey -in "$kd/priv.pem" -pubout -out "$kd/pub/pub.pem" || return 1
  bash "$ROOT/scripts/publish.sh" "$kd/pub" "$tag" "key request $tag" || return 1
  echo "waiting for the CAD key on $resp"
  for _ in $(seq 1 240); do
    if git -C "$ROOT" fetch -q --depth 1 origin "$resp" 2>/dev/null; then
      git -C "$ROOT" show FETCH_HEAD:key.bin > "$kd/key.bin"
      CAD_KEY=$(openssl pkeyutl -decrypt -inkey "$kd/priv.pem" -pkeyopt rsa_padding_mode:oaep -pkeyopt rsa_oaep_md:sha256 -in "$kd/key.bin") || return 1
      echo "::add-mask::$CAD_KEY"
      export CAD_KEY
      git -C "$ROOT" push -q "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" --delete "$tag" "$resp" 2>/dev/null || true
      rm -rf "$kd"
      echo "CAD key received"
      return 0
    fi
    sleep 30
  done
  return 1
}

if [ "$PRIVATE" = "true" ]; then
  get_key || { echo "private case but no CAD key (secret CAD_KEY missing and no answer to the key request)"; exit 1; }
fi

declare -A T
stamp() { T[$1]=$(( $(date +%s) - JOB_START )); python3 - "$CASE/timings.json" "$1" "${T[$1]}" "$STAGE" <<'EOF'
import json, os, sys
p, k, v, st = sys.argv[1], sys.argv[2], int(sys.argv[3]), sys.argv[4]
d = json.load(open(p)) if os.path.exists(p) else {}
d[k if st == "1" else f"s{st}_{k}"] = v
json.dump(d, open(p, "w"), indent=1)
EOF
}

status() {
  # light status branch so progress can be followed without an account: st-<name>
  local S="${RUNNER_TEMP:-/tmp}/status_${NAME}"
  rm -rf "$S"; mkdir -p "$S"
  {
    echo "case: $NAME   stage: $1   job: $STAGE/$NSTAGES   elapsed: $(( ($(date +%s) - JOB_START) / 60 )) min"
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

run() { local log="$1"; shift; echo ">> $*"; "$@" > "$log" 2>&1; local rc=$?; echo "   rc=$rc"; return $rc; }
par() { local log="$1"; shift; echo ">> mpirun -np $NP $*"; mpirun --oversubscribe -np "$NP" "$@" -parallel > "$log" 2>&1; local rc=$?; echo "   rc=$rc"; return $rc; }

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
fail() { echo "FAILED at $1"; stamp "failed_$1"; status "FAILED at $1"; collect; kill $MEMPID 2>/dev/null; exit 1; }

enc() { if [ "$PRIVATE" = "true" ]; then openssl enc -aes-256-cbc -pbkdf2 -iter 100000 -salt -pass env:CAD_KEY; else cat; fi; }
dec() { if [ "$PRIVATE" = "true" ]; then openssl enc -d -aes-256-cbc -pbkdf2 -iter 100000 -pass env:CAD_KEY; else cat; fi; }

latest_iter() { ls -1 "$CASE/processor0" 2>/dev/null | grep -E '^[0-9.e+-]+$' | sort -g | tail -1; }

pack_state() {
  # decomposed mesh + latest fields + histories -> one (encrypted) archive for the next stage
  cd "$CASE"
  for d in processor*; do rm -rf "$d/0"; done
  local t0 items=(); t0=$(date +%s)
  for it in system constant processor* postProcessing log.* timings.json mem.log run_config.json 0.orig; do [ -e "$it" ] && items+=("$it"); done
  tar -cf - "${items[@]}" | zstd -T0 -3 -q | enc > "$STATE_DIR/state.bin" || return 1
  echo "state packed: $(du -h "$STATE_DIR/state.bin" | cut -f1) in $(( $(date +%s) - t0 )) s"
}

unpack_state() {
  [ -s "$STATE_DIR/state.bin" ] || return 1
  rm -rf "$CASE"; mkdir -p "$CASE"; cd "$CASE"
  dec < "$STATE_DIR/state.bin" | zstd -d -q | tar -xf - || return 1
  rm -f "$STATE_DIR/state.bin"
}

# memory sampler
( while true; do free -m | awk 'NR==2{print $3}' >> "$CASE/mem.log"; sleep 15; done ) > /dev/null 2>&1 &
MEMPID=$!

# OpenFOAM environment
set +eu
# shellcheck disable=SC1090
[ -n "${OF_BASHRC:-}" ] && source "$OF_BASHRC"
set -u
echo "OpenFOAM: ${WM_PROJECT_VERSION:-not installed}  procs: $NP  stage: $STAGE/$NSTAGES  private: $PRIVATE"

if [ "$STAGE" = "1" ]; then
  CAR=$(jget car mft02)
  GEOM="$ROOT/geometry/build_${CAR}.py"
  [ "$CAR" = "esslingen" ] && GEOM="$ROOT/geometry/build_car.py"
  if [ "$PRIVATE" = "true" ]; then
    # encrypted CAD lives on its own orphan branch (split in <50 MB chunks); never written to the results
    git -C "$ROOT" fetch -q --depth 1 origin "cad-${CAR}" || { echo "cannot fetch cad-${CAR}"; exit 1; }
    CADDIR="${RUNNER_TEMP:-/tmp}/cad_${CAR}"; mkdir -p "$CADDIR"
    for f in $(git -C "$ROOT" ls-tree --name-only FETCH_HEAD | grep '^cad\.bin\.' | sort); do git -C "$ROOT" show "FETCH_HEAD:$f"; done \
      | openssl enc -d -aes-256-cbc -pbkdf2 -iter 200000 -pass env:CAD_KEY > "$CADDIR/${CAR}.npz" || { echo "CAD decryption failed"; exit 1; }
    export CAD_NPZ="$CADDIR/${CAR}.npz"
  fi
  if ! python3 "$GEOM" "$CASE/constant/triSurface" --front-rh-mm "$FRH" --rear-rh-mm "$RRH" > "$CASE/log.geometry" 2>&1; then
    tail -30 "$CASE/log.geometry"; mkdir -p "$RES/logs"; cp "$CASE/log.geometry" "$CASE/mem.log" "$RES/logs/" 2>/dev/null
    echo "geometry failed"; exit 1
  fi
  [ -n "${CAD_NPZ:-}" ] && rm -f "$CAD_NPZ"
  if [ "$(jget geometry_only false)" = "true" ]; then
    # check run: geometry + preview images only
    mkdir -p "$RES/logs"
    cp "$CASE/log.geometry" "$RES/logs/"; cp "$CASE/constant/triSurface/car.json" "$RES/"
    python3 "$ROOT/scripts/preview_geom.py" "$CASE/constant/triSurface" "$RES/preview.png" || true
    touch "$RES/.final"; kill $MEMPID 2>/dev/null; exit 0
  fi
  python3 "$ROOT/scripts/make_case.py" "$CASE" "$CFG" || { echo "make_case failed"; exit 1; }
  cd "$CASE"
  sed -i "s/numberOfSubdomains .*/numberOfSubdomains $NP;/" system/decomposeParDict
  cp system/fvSchemes.first system/fvSchemes
  stamp start
  status "meshing"

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
    collect; touch "$RES/.final"
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
  # second order from here on (the fallback below may switch the algorithm back to SIMPLE)
  cp system/fvSchemes.second system/fvSchemes
  cp system/fvSolution.second system/fvSolution
else
  if ! unpack_state; then
    echo "no state from the previous stage: the case already finished (or failed) earlier"
    touch "$RES/.skip"; kill $MEMPID 2>/dev/null; exit 0
  fi
  cd "$CASE"
  foamDictionary system/controlDict -entry stopAt -set endTime > /dev/null
  stamp resume
  ( while true; do sleep 600; status "running"; done ) > /dev/null 2>&1 &
  STPID=$!
fi

# ------------------------------------------------------------------ second-order solve (wall-clock guarded)
foamDictionary system/controlDict -entry endTime -set "$ITERS" > /dev/null
foamDictionary system/controlDict -entry writeInterval -set 100 > /dev/null
NOW=$(date +%s)
STOP_AT=$(( JOB_START + (BUDGET_MIN - POST_RESERVE_MIN) * 60 ))
SLEEP=$(( STOP_AT - NOW ))
echo "solver wall-clock budget: $(( SLEEP / 60 )) min"
( sleep "$SLEEP"; echo "deadline reached -> writeNow" > deadline.txt; foamDictionary system/controlDict -entry stopAt -set writeNow > /dev/null ) > /dev/null 2>&1 &
GUARD=$!
LOG2="log.simpleFoam.2"; [ "$STAGE" != "1" ] && LOG2="log.simpleFoam.s${STAGE}"
if ! par "$LOG2" simpleFoam; then
  echo "second-order solve failed -> resuming with SIMPLE from the last written time"
  cp system/fvSolution.first system/fvSolution
  for d in processor*; do
    last=$(ls -1 "$d" | grep -E '^[0-9.e+-]+$' | sort -g | tail -1)
    for t in $(ls -1 "$d" | grep -E '^[0-9.e+-]+$'); do
      [ "$t" != "$last" ] && [ "$t" != "0" ] && rm -rf "$d/$t"
    done
  done
  par "${LOG2}.fallback" simpleFoam || fail simpleFoam_fallback
fi
kill $GUARD 2>/dev/null
stamp solve2
LAST=$(latest_iter)
echo "reached iteration $LAST of $ITERS"

if [ "$FINAL_STAGE" != true ] && python3 -c "import sys; sys.exit(0 if float('$LAST') < float('$ITERS') - 1 else 1)"; then
  status "stage $STAGE/$NSTAGES done at iteration $LAST: packing state"
  pack_state || fail pack_state
  stamp packed
  collect   # logs so far (not marked final: nothing is published by this stage)
  status "stage $STAGE/$NSTAGES done at iteration $LAST: continues in the next job"
  kill $MEMPID $STPID 2>/dev/null
  exit 0
fi

status "reconstructing"
run log.reconstructParMesh reconstructParMesh -constant || fail reconstructParMesh
run log.reconstructPar reconstructPar -latestTime || fail reconstructPar
stamp reconstruct
collect
status "post-processing"
python3 "$ROOT/scripts/postpro.py" "$CASE" "$RES" "$CFG" > "$RES/logs/log.postpro" 2>&1 || echo "postpro returned non-zero"
stamp postpro
cp "$CASE"/timings.json "$RES/logs/"

# optionally archive the (small) reconstructed case so post-processing can be re-run later (never for private geometry)
if [ "$(jget archive_case false)" = "true" ] && [ "$PRIVATE" != "true" ]; then
  mkdir -p "$RES/case_archive"
  LASTT=$(foamListTimes -latestTime 2>/dev/null | tail -1)
  tar -czf - constant/polyMesh constant/triSurface/*.stl constant/triSurface/car.json system run_config.json \
      "$LASTT" postProcessing log.* timings.json 2>/dev/null | split -b 45m - "$RES/case_archive/case.tgz."
  ls -la "$RES/case_archive"
fi
touch "$RES/.final"
status "done"
kill $MEMPID $STPID 2>/dev/null
exit 0
