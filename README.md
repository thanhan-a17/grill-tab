# grill-tab

**Press Tab before you press Enter.** A Hermes Desktop plugin that turns a rough draft into a
brief the agent can run with — by asking you the few decisions that actually matter, one at a time.

Type an intent in the composer and press **Tab**. A fast auxiliary model asks the single most useful
*decision* (never a fact it could look up), with a recommended answer and a couple of short options.
Answer and Tab again, or just Tab to accept the recommendation. Press **Enter** when you're done:
the settled ladder is synthesized into an execution brief and **placed in the composer for your
review** — you press Enter yourself to start the session. Nothing is ever sent on your behalf.

It works for any kind of work — research, writing, planning, operations, design, data, code. The
brief is a faithful restatement of what *you* asked for and decided, not an improved version of it:
it never widens scope, never adds deliverables, and writes in the language you wrote in.

## Install

```bash
hermes plugins install thanhan-a17/grill-tab --enable
```

Then restart the Desktop backend (quit and reopen Hermes Desktop). The desktop half is picked up
automatically from the installed package; check **Capabilities → Plugins** shows *Grill Tab* on.

Requires Hermes 0.20.0+ and Hermes Desktop on a local backend. For a **remote backend** (Desktop
over SSH / URL): install on the backend host as above, then copy `desktop/plugin.js` to
`~/.hermes/desktop-plugins/grill-tab/plugin.js` on the machine running the app.

<details>
<summary>Alternative: <code>install.sh</code> (profiles, custom homes, no <code>hermes</code> on PATH)</summary>

```bash
git clone https://github.com/thanhan-a17/grill-tab.git && cd grill-tab
./install.sh                      # default HERMES_HOME
./install.sh --profile <name>     # $HERMES_HOME/profiles/<name>
./install.sh --home /path/to/home
```

The installer validates the manifest and host version *before* touching the target home, copies the
package into `plugins/grill-tab` and `desktop-plugins/grill-tab`, enables the plugin, and adds a
default `auxiliary.grill_tab` block (carrying over a pre-0.2 `auxiliary.grill` block if present).
Safe to re-run for upgrades. `PYTHON_BIN` / `HERMES_BIN` override executable discovery.
</details>

## Choose the model

Grill Tab registers its own auxiliary task, `grill_tab`, so you pick its model like any other
side-model — a fast, cheap one is the point (a rung should take 1–3 s):

- **CLI:** `hermes model` → *Configure auxiliary models* → **Grill Tab**
- **Desktop:** Settings → Models → Auxiliary (on Hermes builds that list plugin tasks)
- **config.yaml:**

  ```yaml
  auxiliary:
    grill_tab:
      provider: openrouter
      model: openai/gpt-5-mini
      reasoning_effort: minimal
      timeout: 15
  ```

Left unset, the task follows your main model. Reasoning models work too — token headroom is sized
for them — they are just slower per rung.

## Keys

| State | Tab | Enter | Esc | Backspace (empty) |
|---|---|---|---|---|
| Composer with text | start grilling | send as usual | — | — |
| Question | commit answer (empty = accept recommendation) | write brief → composer | dismiss question · 2nd Esc exits & restores draft | reopen previous rung |
| Nothing critical left | one more question | write brief → composer | exit | — |

Click a settled rung to edit it in place (Enter/blur saves, Esc cancels) without losing later rungs.
Palette: **Grill this draft** · Keybind: ⌘⇧G. Tab inside slash / `@` completions and on an empty
composer is never intercepted.

## Layout

```
plugin.yaml, __init__.py        agent half; registers the grill_tab auxiliary task
dashboard/manifest.json         { "api": "plugin_api.py" } → /api/plugins/grill-tab/{interrogate,brief,health}
dashboard/grill_engine.py       prompts, context assembly, parsing, fallbacks (pure; tested)
desktop/plugin.js               single-file desktop plugin (ESM, @hermes/plugin-sdk)
docs/                           SPEC.md · CONTRACT.md (frozen REST contract) · DESKTOP-DEV.md (DOM adapter)
install.sh, scripts/            alternative installer + its pre-flight validator
tests/                          pytest (engine, API, installer) · node --test (desktop core)
```

## Develop

```bash
# Python tests need a Hermes checkout on PYTHONPATH (any venv with pytest)
PYTHONPATH=/path/to/hermes-agent python -m pytest tests -q
node scripts/extract-core.mjs && node --test tests/desktop/

# Catalog-style gates
HERMES_HOME=$(mktemp -d) hermes plugins validate .
HERMES_HOME=$(mktemp -d) hermes plugins doctor --ci .
```

Backend edits hot-reload inside `hermes serve`; desktop edits need the file re-copied (the watcher
follows a real file, not a symlink) — re-run the install or copy `desktop/plugin.js`.

## License

MIT © 2026 thanhan-a17
