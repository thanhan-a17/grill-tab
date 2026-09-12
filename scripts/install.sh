#!/usr/bin/env bash
# Install grill-tab into a Hermes home. Usage: scripts/install.sh [HERMES_HOME]   (default ~/.hermes)
# Idempotent. Never touches the hermes-agent checkout.
set -Eeuo pipefail
HOME_DIR="${1:-$HOME/.hermes}"
SRC="$(cd "$(dirname "$0")/.." && pwd)"
CFG="$HOME_DIR/config.yaml"

[[ -f "$CFG" ]] || { echo "No config.yaml at $HOME_DIR — is this a Hermes home?" >&2; exit 1; }

# 1) Agent/back-end half: the package folder under plugins/ (symlink keeps `git pull` upgrades trivial).
mkdir -p "$HOME_DIR/plugins"
if [[ -e "$HOME_DIR/plugins/grill-tab" && ! -L "$HOME_DIR/plugins/grill-tab" ]]; then
  echo "plugins/grill-tab exists and is not a symlink; leaving it alone." >&2
else
  ln -sfn "$SRC" "$HOME_DIR/plugins/grill-tab"
fi

# 2) Desktop half: a COPY (the desktop watcher does not follow symlinks; re-run install.sh after upgrades).
mkdir -p "$HOME_DIR/desktop-plugins/grill-tab"
rm -f "$HOME_DIR/desktop-plugins/grill-tab/plugin.js"
cp "$SRC/desktop/plugin.js" "$HOME_DIR/desktop-plugins/grill-tab/plugin.js"

# 3) plugins.enabled allow-list (security gate for the Python half).
python3 - "$CFG" <<'PY'
import re, sys, pathlib, shutil, time
p = pathlib.Path(sys.argv[1]); s = p.read_text()
if re.search(r"^\s+- grill-tab\s*$", s, re.M):
    print("plugins.enabled: grill-tab already present"); sys.exit(0)
m = re.search(r"^plugins:\n(?:  [a-z_]+:.*\n)*?  enabled:\n((?:    - .*\n)*)", s, re.M)
shutil.copy(p, p.with_suffix(f".yaml.bak-grill-{int(time.time())}"))
if m:
    s = s[:m.end()] + "    - grill-tab\n" + s[m.end():]
elif re.search(r"^plugins:\s*$", s, re.M):
    s = re.sub(r"^plugins:\s*$", "plugins:\n  enabled:\n    - grill-tab", s, count=1, flags=re.M)
else:
    s = s.rstrip("\n") + "\nplugins:\n  enabled:\n    - grill-tab\n"
p.write_text(s); print("plugins.enabled: added grill-tab")
PY

cat <<EOF

grill-tab installed into $HOME_DIR
  package : $HOME_DIR/plugins/grill-tab -> $SRC
  desktop : $HOME_DIR/desktop-plugins/grill-tab/plugin.js (copy)

Next:
  * Recommended fast model (config.yaml):
      auxiliary:
        grill: { provider: openrouter, model: openai/gpt-5-mini, reasoning_effort: minimal, timeout: 15 }
  * Restart the desktop backend (quit/reopen Hermes Desktop, or restart 'hermes serve') so the Python half mounts.
  * Desktop → Capabilities → Plugins: enable "Grill Tab" if it shows as off.
  * Remote backend (SSH/URL): run this script on the BACKEND host for the Python half, and copy
    desktop/plugin.js into <client>/.hermes/desktop-plugins/grill-tab/ on the machine running the app.
EOF
