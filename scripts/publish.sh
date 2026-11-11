#!/usr/bin/env bash
# Force-push the contents of <dir> as a single orphan commit to branch <branch>.
# usage: publish.sh <dir> <branch> <message>
set -eu
SRC="$1"; BR="$2"; MSG="$3"
TMP="$(mktemp -d)"
cp -r "$SRC"/. "$TMP"/
cd "$TMP"
git init -q
git checkout -q -b "$BR"
git add -A
git -c user.name="cfd-runner" -c user.email="41898282+github-actions[bot]@users.noreply.github.com" commit -q -m "$MSG"
git push -q -f "https://x-access-token:${GH_TOKEN}@github.com/${GITHUB_REPOSITORY}.git" "$BR"
cd /
rm -rf "$TMP"
