#!/usr/bin/env bash
# Install the latest ESI OpenFOAM (openfoam.com) Debian package on an Ubuntu runner.
set -euo pipefail
curl -fsSL https://dl.openfoam.com/add-debian-repo.sh | sudo bash
sudo apt-get update -q
PKG=$(apt-cache search --names-only '^openfoam2[0-9]+-default$' | awk '{print $1}' | sort | tail -1)
if [ -z "$PKG" ]; then
  PKG=$(apt-cache search --names-only '^openfoam2[0-9]+$' | awk '{print $1}' | sort | tail -1)
fi
echo "Installing $PKG"
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q "$PKG" > /tmp/apt.log 2>&1 || { tail -50 /tmp/apt.log; exit 1; }
VER="${PKG%-default}"
BRC="/usr/lib/openfoam/${VER}/etc/bashrc"
ls -la "$BRC"
echo "OF_BASHRC=$BRC" >> "$GITHUB_ENV"
# extra swap on the temporary disk helps snappyHexMesh peaks
sudo fallocate -l 12G /mnt/swapfile 2>/dev/null && sudo chmod 600 /mnt/swapfile && sudo mkswap /mnt/swapfile >/dev/null && sudo swapon /mnt/swapfile || true
free -m
nproc
df -h / /mnt
