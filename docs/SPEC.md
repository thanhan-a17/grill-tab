# grill-tab — Spec

Standalone Hermes plugin. Press **Tab** in the Desktop composer to interrogate a draft before it
becomes the first message of a session; **Enter** synthesizes an execution brief and places it in
the composer for the user to review and send. One folder, no core patches.

## Design decisions

- The engine may declare the ladder done ("nothing critical left"). Enter still writes the brief;
  Tab forces one more question.
- The brief is **synthesized** by the auxiliary model from the original intent and the settled
  ladder. The local template is a fallback only (engine unreachable, unusable output).
- **Enter never auto-sends.** The brief is placed into the composer with the caret at the end; the
  user reads it and presses Enter themselves.
- While the ladder is open the composer is cleared (the first dimmed row carries the draft); a full
  exit restores the draft untouched.
- The recommended answer lives only in the ghost placeholder (Tab/Enter on an empty answer accepts
  it); option chips exclude it. No buttons duplicate a keyboard hint.
- General agentic work first: research, writing, planning, operations, design, analysis, personal
  errands — and code. Nothing in the prompts presumes software.

## Fidelity contract (the brief)

The brief is a faithful restatement, not an improved idea:

- **Goal** restates the original intent as an outcome, at the user's stated ambition.
- **Settled** means: stated in the intent, answered in the ladder, or a recommendation the user
  accepted (including by deferring — "you decide", "which is simplest?"). Nothing else is settled.
- No added deliverables, steps, audiences, channels, features, or polish. No change of medium, tone,
  length, or language.
- Every line under *Settled decisions* traces to a settled item and is written as a directive.
- Anything the work still needs but nobody settled goes under *Assumptions*, phrased conservatively
  (smallest, least surprising option).
- Background about the user (memory files, project hint, prior conversation) is context for phrasing
  only; it never becomes a Goal, decision, constraint, or an unnamed target.
- *Constraints* holds only limits the user stated.
- Body in the user's language; headings in English.

Sections, exact headings, present only when they have content: `## Goal`, `## Success criteria`,
`## Deliverable`, `## Scope & non-goals`, `## Settled decisions`, `## Constraints`,
`## Verify before reporting done`, `## Assumptions to make explicitly (do not ask)`, `## Directive`
("Work autonomously. Do not re-ask anything above. Ask only if blocked by something outside this
brief.").

## Interrogation contract

- Model the intent as a decision tree; ask one decision from the frontier per rung, each with a
  recommended answer and 2–4 short options where natural.
- Facts are the agent's job — never ask what can be looked up. Skip-if-same-plan: if every answer
  leads to the same work, do not ask.
- A deferral answer settles the prior recommendation (`settled_from_recommendation=true`); never
  re-ask or rephrase.
- Trivial intents (greetings, thanks) return `done=true` immediately.
- Categories: goal · deliverable · scope · verification; `architecture` only for clearly
  code-oriented intents. No category repeats unless the user opened a new branch.
- Questions ≤ 18 words, in the user's language. JSON only (see CONTRACT.md).

## Package layout

```
grill-tab/
├── plugin.yaml, __init__.py    # agent half; registers the `grill_tab` auxiliary task
├── dashboard/manifest.json     # { "api": "plugin_api.py" } → /api/plugins/grill-tab/{interrogate,brief,health}
├── dashboard/plugin_api.py     # FastAPI router (module-top imports: fastapi/pydantic/stdlib only)
├── dashboard/grill_engine.py   # prompts, context assembly, parsing, fallbacks (pure; tested)
├── desktop/plugin.js           # single-file ESM desktop plugin (@hermes/plugin-sdk); pure core between @core markers
├── install.sh                  # alternative installer (profiles, custom homes); scripts/install.sh delegates to it
├── scripts/validate_install.py # installer pre-flight (manifest + host version)
├── docs/                       # SPEC.md, CONTRACT.md (frozen REST contract), DESKTOP-DEV.md (DOM adapter)
└── tests/                      # pytest (engine, API, installer) + node --test (desktop core)
```

## Engine behaviour (dashboard/grill_engine.py)

- Model route: `agent.auxiliary_client.call_llm(task=<aux task>)` where the task is `grill_tab`,
  or the legacy `grill` block when it is the only one pinned (read-only compatibility; the
  installer copies `grill` → `grill_tab`). Temperature 0.2.
- Token headroom is generous on purpose (`_INTERROGATE_MAX_TOKENS` 2048, `_BRIEF_MAX_TOKENS`
  4096): reasoning models bill thinking against `max_tokens`, and a starved cap truncates JSON or
  the brief mid-way and silently drops to the fallback.
- Timeouts 25 s / 35 s, raised further by `auxiliary.<task>.timeout` when the user sets it higher.
- JSON mode is requested only on providers that accept `response_format`; otherwise the first
  `{…}` block is parsed. `<think>` blocks are stripped; category synonyms are normalized; a
  missing `## Directive` is appended.
- Every failure returns a contract-shaped fallback; the routes never raise.

## Desktop half (desktop/plugin.js)

- Contributes `COMPOSER_AREAS.top` (the ladder), `COMPOSER_AREAS.middleware` (returns `null`
  while the strip is engaged so a stray Enter cannot fire a blank turn), a palette command
  "Grill this draft", and a ⌘⇧G keybind as the discoverable alternative to Tab.
- Tab capture is a document-level capture-phase listener that claims Tab only for an idle
  strip, a non-empty composer rich input, and no open completion drawer. Everything else is
  untouched. Listeners are disposed in `ctx.onDispose`.
- `composerAdapter` is the single module allowed to touch app DOM; selectors and their
  production provenance are in `docs/DESKTOP-DEV.md`.
- Keys: see README. Settled rungs can be edited inline (blur/Enter saves, Esc cancels) without
  discarding later rungs; editing is locked once the brief is being written.
- Attachments staged in the composer at Tab time are described to the engine and forwarded intact
  when the brief is placed; prior conversation history (mid-session) is passed as context.

## Pre-mortem (kept current)

- `plugin_api.py` runs inside `hermes serve`; a module-top hermes import that fails breaks the
  whole plugin mount. Hermes imports stay inside functions.
- Remote backends: Python half on the backend host, `desktop/plugin.js` on the client machine.
- A tight `max_tokens` breaks the plugin the day a thinking model is configured — do not lower it.
- Memory/project context is the main fidelity leak: the engine labels it as context and the prompt
  forbids promoting it to decisions. Re-run the bake-off if either changes.

## Verification gates

1. `pytest tests/` and `node --test tests/desktop/` green; `hermes plugins validate .` and
   `hermes plugins doctor --ci .` pass in a clean `HERMES_HOME`.
2. Clean-home install via `hermes plugins install` lists the plugin enabled and exposes the
   `grill_tab` auxiliary task.
3. Prompt bake-off across non-code intents (research, writing, planning, ops, design, analysis, a
   non-English intent) plus one code intent: no scope widening, deferrals resolve to the exact
   recommendation, body language matches the intent.
4. On the real Desktop: no load toast; Tab inside slash/`@` completions and on an empty composer
   is untouched; Tab on a draft opens the ladder; Enter places the brief in the composer.
