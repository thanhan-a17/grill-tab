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
git clone <this repo> ~/projects/grill-tab
~/projects/grill-tab/scripts/install.sh            # default home ~/.hermes
~/projects/grill-tab/scripts/install.sh ~/.hermes/profiles/<name>   # a named profile
```

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
