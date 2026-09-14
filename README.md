# grill-tab — press Tab to grill your draft before it becomes a session

A standalone Hermes plugin (no core patches). In Hermes Desktop, type a rough intent and press
**Tab**: a fast model asks the single most useful *decision* (never a fact it could look up), with
a recommended answer and short options. Answer, Tab again, or just Tab to accept the
recommendation. Press **Enter** when you're done: the ladder is synthesized into an execution
brief (Goal · Success criteria · Deliverable · Scope & non-goals · Settled decisions · Constraints ·
Verify · Assumptions · Directive) and **placed in the composer for your review** — you press Enter
yourself to start the session.

Designed for general agentic work (research, content, ops, code), not just dev.

## Install

```bash
# One command (downloads a temporary clone, validates it, installs it, then cleans up)
curl -fsSL https://raw.githubusercontent.com/thanhan-a17/grill-tab/main/install.sh | bash

# Local clone
./install.sh
./install.sh --profile <name>
./install.sh --home /path/to/hermes-home
```

The installer requires Python 3.12+ and Hermes 0.20.0+. Its **pre-flight** validates the plugin
manifest and host Hermes version before creating or changing the target Hermes home. On failure it
exits with code 1 and prints an `[ERROR]` explanation. After a successful pre-flight it copies the
backend package to `plugins/grill-tab`, installs `desktop-plugins/grill-tab/plugin.js` plus its
`.hermes-package.json`, enables `grill-tab` in `config.yaml`, and adds a default `auxiliary.grill`
block when missing. It is safe to run again for upgrades.

`HERMES_HOME` selects the default target; `--home` overrides it and `--profile name` targets
`$HERMES_HOME/profiles/name`. Set `PYTHON_BIN` or `HERMES_BIN` when the compatible executables are
not on `PATH`. The legacy `scripts/install.sh` delegates to the root installer.

Then restart the desktop backend (quit/reopen Hermes Desktop) and, in Capabilities → Plugins,
make sure **Grill Tab** is on. Recommended model (fast, good questions):

```yaml
auxiliary:
  grill:
    provider: openrouter
    model: openai/gpt-5-mini
    reasoning_effort: minimal
    timeout: 15
```

Remote backend (SSH / URL): run `install.sh` on the **backend** host; copy `desktop/plugin.js` to
`~/.hermes/desktop-plugins/grill-tab/plugin.js` on the machine that runs the app.

## Keys

| State | Tab | Enter | Esc | Backspace (empty) |
|---|---|---|---|---|
| Composer with text | start grilling | send as usual | — | — |
| Question | commit answer (empty = accept recommendation) | write brief | dismiss question / 2nd Esc exits & restores draft | reopen previous rung |
| Nothing critical left | one more question | write brief | exit | — |
| Brief preview | — | place brief in composer | back | — |

Palette: **Grill this draft** · Keybind: ⌘⇧G.

## Layout

```
plugin.yaml, __init__.py        agent-half marker
dashboard/manifest.json         { "api": "plugin_api.py" }  → /api/plugins/grill-tab/{interrogate,brief,health}
dashboard/grill_engine.py       prompts, parsing, fallbacks (pure; tested)
desktop/plugin.js               single-file desktop plugin (ESM, @hermes/plugin-sdk)
docs/SPEC.md, docs/CONTRACT.md  behaviour + frozen REST contract
scripts/install.sh              installer;  scripts/smoke.sh  live smoke;  scripts/cdp_*.py  renderer verification
tests/                          pytest (engine + API) and node --test (desktop core)
```

## Develop

```bash
PYTHONPATH=~/.hermes/hermes-agent ~/.hermes/hermes-agent/venv/bin/python -m pytest tests -q
node scripts/extract-core.mjs && node --test tests/desktop/
```

The desktop watcher hot-reloads a real file, not a symlink — re-run `install.sh` (or copy
`desktop/plugin.js`) after edits.
