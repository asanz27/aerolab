#!/usr/bin/env bash
# Publish results/<name> to branch res-<name> when this job produced FINAL results or failed
# (so the logs of a failure are kept). Intermediate stages publish nothing.
# usage: publish_results.sh <name> <job status> <run id> <run attempt>
set -uo pipefail
NAME="$1"; JOBST="$2"; RUNID="$3"; ATT="$4"
R="results/${NAME}"
mkdir -p "$R"
if [ -f "$R/.skip" ]; then echo "nothing to publish (case finished in an earlier stage)"; exit 0; fi
if [ ! -f "$R/.final" ] && [ "$JOBST" = "success" ]; then echo "intermediate stage: nothing to publish"; exit 0; fi
echo "$CASE_JSON" > "$R/case.json"
echo "run $RUNID attempt $ATT stage ${STAGE:-1} job status $JOBST" > "$R/run.txt"
rm -f "$R/.final"
du -sh "$R"
bash scripts/publish.sh "$R" "res-${NAME}" "results ${NAME} (run ${RUNID}, stage ${STAGE:-1})"
