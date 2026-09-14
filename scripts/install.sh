#!/usr/bin/env bash
# Backward-compatible entry point; the distributable installer is at repo root.
set -Eeuo pipefail
exec "$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/install.sh" "$@"
