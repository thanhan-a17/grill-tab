#!/usr/bin/env bash
# Install grill-tab from a clone or a curl | bash invocation.
set -Eeuo pipefail

REPOSITORY="${GRILL_TAB_REPOSITORY:-https://github.com/thanhan-a17/grill-tab.git}"
PYTHON_BIN="${PYTHON_BIN:-}"
if [[ -z "$PYTHON_BIN" ]]; then
  for cand in "python3" "python3.12" "$HOME/.hermes/hermes-agent/venv/bin/python" "$HOME/.local/bin/python3.12" "$HOME/.local/bin/python3" "/opt/homebrew/bin/python3.12" "/usr/local/bin/python3.12"; do
    if command -v "$cand" >/dev/null 2>&1 || [[ -x "$cand" ]]; then
      if "$cand" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
        PYTHON_BIN="$cand"
        break
      fi
    fi
  done
  PYTHON_BIN="${PYTHON_BIN:-python3}"
fi
HERMES_BIN="${HERMES_BIN:-hermes}"
TEMP_SOURCE=""

usage() {
  cat <<'EOF'
Usage: install.sh [--home DIR] [--profile NAME]

Install grill-tab into a Hermes home. With --profile NAME, installs into
$HERMES_HOME/profiles/NAME (or $HOME/.hermes/profiles/NAME).
EOF
}

cleanup() { [[ -z "$TEMP_SOURCE" ]] || rm -rf "$TEMP_SOURCE"; }
trap cleanup EXIT

TARGET_HOME=""
PROFILE=""
while [[ $# -gt 0 ]]; do
  case "$1" in
    --home) [[ $# -ge 2 ]] || { echo "[ERROR] --home requires a directory" >&2; exit 2; }; TARGET_HOME="$2"; shift 2 ;;
    --profile) [[ $# -ge 2 ]] || { echo "[ERROR] --profile requires a name" >&2; exit 2; }; PROFILE="$2"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) echo "[ERROR] Unknown argument: $1" >&2; usage >&2; exit 2 ;;
  esac
done

# A downloaded stdin script has no useful BASH_SOURCE path. Prefer a local source
# only when its manifest is beside this script, otherwise clone a clean temporary copy.
SCRIPT_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" ]]; then
  SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd || true)"
fi
if [[ -n "$SCRIPT_DIR" && -f "$SCRIPT_DIR/plugin.yaml" && -f "$SCRIPT_DIR/scripts/validate_install.py" ]]; then
  SOURCE="$SCRIPT_DIR"
elif [[ -f "$PWD/plugin.yaml" && -f "$PWD/scripts/validate_install.py" ]]; then
  SOURCE="$PWD"
else
  command -v git >/dev/null 2>&1 || { echo "[ERROR] git is required when installing from stdin" >&2; exit 1; }
  TEMP_SOURCE="$(mktemp -d "${TMPDIR:-/tmp}/grill-tab.XXXXXX")"
  if ! git clone --depth 1 "$REPOSITORY" "$TEMP_SOURCE" >/dev/null 2>&1; then
    echo "[ERROR] Could not clone $REPOSITORY" >&2
    exit 1
  fi
  SOURCE="$TEMP_SOURCE"
fi

# Everything above is discovery only. This pre-flight must complete before the
# target home is created or any of its files are changed.
if ! "$PYTHON_BIN" -c 'import sys; raise SystemExit(0 if sys.version_info >= (3, 12) else 1)' >/dev/null 2>&1; then
  echo "[ERROR] Python 3.12+ is required (set PYTHON_BIN to a compatible interpreter)" >&2
  exit 1
fi
if ! "$PYTHON_BIN" "$SOURCE/scripts/validate_install.py" --source "$SOURCE" --hermes-bin "$HERMES_BIN"; then
  exit 1
fi

BASE_HOME="${HERMES_HOME:-$HOME/.hermes}"
if [[ -z "$TARGET_HOME" ]]; then TARGET_HOME="$BASE_HOME"; fi
if [[ -n "$PROFILE" ]]; then TARGET_HOME="$BASE_HOME/profiles/$PROFILE"; fi

# Registration starts only after all compatibility checks pass.
PLUGIN_DIR="$TARGET_HOME/plugins/grill-tab"
DESKTOP_DIR="$TARGET_HOME/desktop-plugins/grill-tab"
mkdir -p "$PLUGIN_DIR" "$DESKTOP_DIR"
rm -rf "$PLUGIN_DIR"
mkdir -p "$PLUGIN_DIR"
cp "$SOURCE/__init__.py" "$SOURCE/plugin.yaml" "$PLUGIN_DIR/"
cp -R "$SOURCE/dashboard" "$PLUGIN_DIR/dashboard"
cp "$SOURCE/desktop/plugin.js" "$DESKTOP_DIR/plugin.js"
"$PYTHON_BIN" - "$DESKTOP_DIR/.hermes-package.json" <<'PY'
import json, pathlib, sys
path = pathlib.Path(sys.argv[1])
path.write_text(json.dumps({"name": "grill-tab", "version": "0.1.0", "main": "plugin.js"}, indent=2) + "\n", encoding="utf-8")
PY

"$PYTHON_BIN" - "$TARGET_HOME/config.yaml" <<'PY'
from pathlib import Path
import re, sys

path = Path(sys.argv[1])
text = path.read_text(encoding="utf-8") if path.exists() else ""

def section_end(source, section):
    # Only top-level YAML keys delimit a section; use horizontal whitespace so
    # a newline cannot be accidentally consumed as part of a key declaration.
    match = re.search(rf"(?m)^{re.escape(section)}:[ \t]*(?:#.*)?$", source)
    if not match:
        return None
    next_section = re.search(r"(?m)^[A-Za-z_][A-Za-z0-9_-]*:[ \t]*(?:#.*)?$", source[match.end():])
    return match.end() + (next_section.start() if next_section else len(source) - match.end())

# Add grill-tab to a block list without changing existing ordering/content.
plugins_end = section_end(text, "plugins")
if plugins_end is None:
    text = text.rstrip() + ("\n" if text.strip() else "") + "plugins:\n  enabled:\n    - grill-tab\n"
else:
    block = text[text.find("plugins:"):plugins_end]
    if not re.search(r"(?m)^\s*-\s*grill-tab\s*$", block):
        enabled = re.search(r"(?m)^  enabled:\s*$", block)
        if enabled:
            insertion = text.find("plugins:") + enabled.end()
            text = text[:insertion] + "\n    - grill-tab" + text[insertion:]
        else:
            text = text[:plugins_end].rstrip() + "\n  enabled:\n    - grill-tab\n" + text[plugins_end:]

aux_end = section_end(text, "auxiliary")
if aux_end is None:
    text = text.rstrip() + "\nauxiliary:\n  grill:\n    provider: auto\n    timeout: 15\n"
else:
    block = text[text.find("auxiliary:"):aux_end]
    if not re.search(r"(?m)^  grill:\s*$", block):
        text = text[:aux_end].rstrip() + "\n  grill:\n    provider: auto\n    timeout: 15\n" + text[aux_end:]
path.parent.mkdir(parents=True, exist_ok=True)
path.write_text(text.rstrip() + "\n", encoding="utf-8")
PY

cat <<EOF
[OK] grill-tab installed
  package: $PLUGIN_DIR
  desktop: $DESKTOP_DIR/plugin.js
  config:  $TARGET_HOME/config.yaml
Restart Hermes Desktop (or its backend) to load the plugin.
EOF
