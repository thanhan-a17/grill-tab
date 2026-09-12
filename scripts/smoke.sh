#!/bin/sh
# Usage: scripts/smoke.sh http://127.0.0.1:9119/api/plugins/grill-tab
set -eu
base_url=${1:?usage: scripts/smoke.sh BASE_URL}
post() {
  intent=$1
  printf '\n== %s ==\n' "$intent"
  curl -sS -X POST "$base_url/interrogate" \
    -H 'content-type: application/json' \
    --data "{\"text\":$(python3 -c 'import json,sys; print(json.dumps(sys.argv[1]))' "$intent"),\"ladder\":[]}" \
    | python3 -c 'import json,sys; p=json.load(sys.stdin); print("latency_ms:", p.get("latency_ms")); print(json.dumps(p, indent=2))'
}
post 'hi'
post 'write a weekly competitor newsletter for my coffee brand'
