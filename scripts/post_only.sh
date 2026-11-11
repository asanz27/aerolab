#!/usr/bin/env bash
# Re-run only the post-processing on a case archived by a previous run (branch res-<name>).
set -euo pipefail
CFG="$1"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
NAME=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['name'])" "$CFG")
SRCBR=$(python3 -c "import json,sys; print(json.loads(sys.argv[1])['post_only_from'])" "$CFG")
CASE="${RUNNER_TEMP:-/tmp}/case_${NAME}"
RES="$ROOT/results/${NAME}"
mkdir -p "$CASE" "$RES/logs"
cd "$ROOT"
git fetch -q --depth 1 origin "$SRCBR"
SRC="${RUNNER_TEMP:-/tmp}/src_${NAME}"
mkdir -p "$SRC"
git --work-tree="$SRC" checkout FETCH_HEAD -- case_archive
cat "$SRC"/case_archive/case.tgz.* | tar -xzf - -C "$CASE"
ls "$CASE"
python3 "$ROOT/scripts/postpro.py" "$CASE" "$RES" "$CFG" 2>&1 | tee "$RES/logs/log.postpro"
cp "$CASE"/log.* "$RES/logs/" 2>/dev/null || true
cp "$CASE"/run_config.json "$CASE/constant/triSurface/car.json" "$RES/" 2>/dev/null || true
