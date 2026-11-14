#!/usr/bin/env bash
# Install the latest ESI OpenFOAM (openfoam.com) Debian package on an Ubuntu runner.
# Many matrix jobs start at the same second and hit dl.openfoam.com together: start with a random delay
# and retry every network step with back-off (nine jobs of one batch failed here in two minutes).
set -euo pipefail
retry() {
  local n=0
  until "$@"; do
    n=$((n + 1))
    if [ "$n" -ge 6 ]; then echo "giving up after $n attempts: $*"; return 1; fi
    local s=$((30 * n + RANDOM % 30))
    echo "attempt $n failed, retrying in ${s}s: $*"
    sleep "$s"
  done
}
sleep $((RANDOM % 40))
retry bash -c 'curl -fsSL --retry 3 https://dl.openfoam.com/add-debian-repo.sh | sudo bash'
retry sudo apt-get update -q
PKG=$(apt-cache search --names-only '^openfoam2[0-9]+-default$' | awk '{print $1}' | sort | tail -1)
if [ -z "$PKG" ]; then
  PKG=$(apt-cache search --names-only '^openfoam2[0-9]+$' | awk '{print $1}' | sort | tail -1)
fi
if [ -z "$PKG" ]; then echo "no OpenFOAM package found"; exit 1; fi
echo "Installing $PKG"
inst() { sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$PKG" > /tmp/apt.log 2>&1 || { tail -30 /tmp/apt.log; sudo apt-get update -q || true; return 1; }; }
retry inst
VER="${PKG%-default}"
BRC="/usr/lib/openfoam/${VER}/etc/bashrc"
ls -la "$BRC"
echo "OF_BASHRC=$BRC" >> "$GITHUB_ENV"
# extra swap on the temporary disk helps snappyHexMesh peaks
sudo fallocate -l 12G /mnt/swapfile 2>/dev/null && sudo chmod 600 /mnt/swapfile && sudo mkswap /mnt/swapfile >/dev/null && sudo swapon /mnt/swapfile || true
free -m
nproc
df -h / /mnt
