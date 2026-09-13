#!/usr/bin/env bash
# Deploy grill-tab to production Hermes homes and the MacBook desktop plugin.
set -Eeuo pipefail

SRC="$(cd "$(dirname "$0")/.." && pwd)"
INSTALL="$SRC/scripts/install.sh"
HERMES_HOME="$HOME/.hermes"
REMOTE="anthanh@100.79.45.10:~/.hermes/desktop-plugins/grill-tab/plugin.js"

[[ -x "$INSTALL" ]] || { echo "Installer is not executable: $INSTALL" >&2; exit 1; }

written=()
run_install() {
  local home="$1"
  "$INSTALL" "$home"
  written+=(
    "$home/plugins/grill-tab"
    "$home/desktop-plugins/grill-tab/plugin.js"
  )
}

run_install "$HERMES_HOME"

shopt -s nullglob
for profile in "$HERMES_HOME/profiles"/*/; do
  [[ -d "$profile" ]] || continue
  if [[ -e "$profile/plugins/grill-tab" || -L "$profile/plugins/grill-tab" || \
        -e "$profile/desktop-plugins/grill-tab" || -L "$profile/desktop-plugins/grill-tab" ]]; then
    run_install "${profile%/}"
  fi
done

scp -o BatchMode=yes "$SRC/desktop/plugin.js" "$REMOTE"
written+=("$REMOTE")

printf '\nDeploy summary (paths written):\n'
for path in "${written[@]}"; do
  printf '  %s\n' "$path"
done
