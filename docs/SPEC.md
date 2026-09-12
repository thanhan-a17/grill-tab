# grill-tab — Spec (v1)

Standalone Hermes plugin package. Press **Tab** in the desktop composer to interrogate a draft
before it becomes the first message of a session; **Enter** synthesizes a high-quality brief and
launches. Portable: one folder, no core patches. Supersedes the in-core fork in
`~/projects/hermes-proto` (branch proto/spike; kept as reference only).

## Decisions (settled with An, 2026-09-12)
- Engine MAY declare the ladder done ("nothing critical left"); Enter still launches, Tab forces one more question.
- Brief is SYNTHESIZED by the fast model at Enter (Goal/Success/Scope/Decisions/Verification), previewed before launch; local template is the fallback only.
- **Enter never auto-sends.** From the preview, Enter PLACES the brief into the composer (ladder closes, caret at end); the user reviews and presses Enter themselves. Lower risk of shipping a prompt with something unwanted.
- While the ladder is open the composer is cleared (the INTENT header carries the draft); a full exit restores the draft.
- Recommended answer lives only in the ghost placeholder (Tab/Enter on empty accepts it); chips exclude it. No "Write brief"/"Launch" buttons — the kbd hints are the affordance.
- Delivery = plugin package (`~/.hermes/plugins/grill-tab`), desktop half `desktop/plugin.js`, backend `dashboard/plugin_api.py`.
- `auxiliary.grill` pinned to `openrouter / openai/gpt-5-mini / reasoning_effort: minimal` (measured 2.4–3.0 s per rung with clearly better questions than flash-lite at ~1.2 s; Gemini 3.7 Flash cannot disable reasoning → 400).
- Probe categories for general agentic work: goal & success signal · deliverable shape / where output lands · scope, non-goals, constraints (time, budget, access) · verification / definition of done. Dev "architectural fork" allowed only when the intent is clearly code.

## Why the old engine produced noise (fix all four)
1. No design-tree/frontier model → generic forks ("web or CLI?") regardless of intent.
2. Never offered a recommended answer → user answered with questions ("which is simplest?") and the engine just asked the next fork.
3. Forbidden from ever finishing → manufactured questions for trivial intents ("hi").
4. Routed to the main reasoning model (5s no-progress timeout → retries → fallback) → 8–25 s per rung.

## Package layout
```
grill-tab/
├── plugin.yaml                 # name: grill-tab (agent half, minimal; marks the package)
├── dashboard/manifest.json     # { "name": "grill-tab", "api": "plugin_api.py" }
├── dashboard/plugin_api.py     # FastAPI router → /api/plugins/grill-tab/{interrogate,brief,health}
├── dashboard/grill_engine.py   # prompts, context assembly, JSON parsing, fallbacks (pure, testable)
├── desktop/plugin.js           # ESM disk plugin; jsx() calls only; imports @hermes/plugin-sdk, react, react/jsx-runtime
├── tests/                      # pytest for engine; vitest-free JS unit tests via node --test on pure modules
├── scripts/install.sh          # symlink/copy into a HERMES_HOME, add plugins.enabled, print next steps
├── docs/SPEC.md, docs/CONTRACT.md
└── README.md                   # install (local, remote backend, hermes:// link), config, keys
```

## REST contract — FROZEN (see docs/CONTRACT.md for exact JSON)
- `POST /interrogate` → next rung or done.
- `POST /brief` → synthesized markdown brief.
- `GET /health` → `{ ok, model }`.
Both halves are built against CONTRACT.md; neither may change it without editing that file first.

## Engine behaviour (dashboard/grill_engine.py)
Model call: `agent.auxiliary_client.call_llm(task="grill", ...)`, temperature 0.2, `max_tokens` 400 (interrogate) / 900 (brief), timeout 8 s / 15 s, JSON-mode when provider supports it, otherwise parse the first `{...}` block; on any failure return the deterministic fallback (interrogate: `done=true, reason="engine unavailable"`; brief: local template).

System prompt principles (adapted from the `grilling` skill, generalised beyond dev):
- Model the intent as a **design tree**; ask only from the **frontier** (prerequisites already known). One question per rung.
- Every question carries a **recommended answer** and, when natural, 2–4 short **options**.
- **Facts are the agent's job**: never ask what the agent can look up (stack, files, existing state). Ask decisions only.
- **Skip-if-same-plan test**: if every plausible answer leads to the same work, do not ask.
- If the user's answer is itself a question, hesitation, or "you decide"/"simplest": treat the previous recommendation as settled (`settled_from_recommendation=true` in the next response) and move on — never re-ask or rephrase.
- Trivial/greeting/underspecified-but-tiny intents ("hi", "thanks") → `done=true` immediately with a one-line reason.
- Ground in Context: USER.md / MEMORY.md (≤1500 chars each), project hint from cwd, today's date.
- Never generic vanilla questions (language? tests? error handling?). Never more than 18 words per question. Output JSON only.
- Category rotation: prefer the highest-leverage unanswered category; never two rungs in the same category unless the user opened a new branch.

Brief synthesis prompt: produce ≤250 words markdown, sections exactly: `## Goal` (outcome, not activity) · `## Success criteria` (observable) · `## Deliverable` (shape + where it lands) · `## Scope & non-goals` · `## Settled decisions` (directives, not Q/A) · `## Constraints` · `## Verify before reporting done` · `## Assumptions to make explicitly (do not ask)` · `## Directive` ("Work autonomously. Do not re-ask anything above. Ask only if blocked by something outside this brief."). Omit empty sections. Never invent facts the ladder didn't settle — put them under Assumptions.

## Desktop half (desktop/plugin.js)
- Registers `COMPOSER_AREAS.top` render (the ladder), `COMPOSER_AREAS.middleware` (no-op pass-through unless a launch is in flight), a `PALETTE_AREA` command "Grill this draft", and a `KEYBINDS_AREA` action (mod+shift+g) as the discoverable alternative to Tab.
- **Tab capture**: document-level capture-phase keydown. Fires only when: target is the composer's message textarea (probe prod selectors: `[data-slot="composer-root"] textarea[aria-label]`), draft non-empty, no completion popover open inside composer-root, grill idle. Then `preventDefault` + start. All other Tabs untouched.
- `composer-adapter` (single module, the ONLY place that touches app DOM): `readDraft()`, `writeDraft(text)` (native value setter + `input` event so React state updates), `submit()` (dispatch Enter keydown on the textarea; fallback: click the composer's send button), `isPopoverOpen()`. Must be verified against the PROD renderer (`~/.hermes/hermes-agent/apps/desktop/src/app/chat/composer/index.tsx`, read-only).
- State: nanostores `atom` in plugin scope — `status: idle|asking|active|done|briefing|preview`, `intent`, `ladder[]`, `current {question, recommended, options, category}`, `answer`, `brief`.
- Keys while engaged (answer input owns them): Tab = commit answer (empty answer ⇒ accept recommendation) and ask next; Enter = synthesize brief → `preview`; in preview Enter = launch, Esc = back to ladder; Esc = dismiss current question, second Esc = exit and restore intent into composer; Backspace on empty answer = reopen previous rung; click a rung = reopen it (later rungs discarded).
- `done` state copy: "Nothing critical left." hints: `Enter ↵ write brief · Tab ⇥ one more question`.
- Launch: `writeDraft(brief)` then `submit()`; then reset. If submit fails, leave the brief in the composer and toast.
- Loading copy: asking → "Finding the next decision…", briefing → "Writing the brief…". Latency budget: rung ≤2 s p50, brief ≤4 s p50 with the fast model.

### Visual contract (An owns the look-gate; workers implement exactly this)
- ONE left gutter and ONE right inset for every row (header, rungs, question, input, hints): 12 px each, matched. No row hangs outside it.
- Rung number column 20 px, fixed; question text starts at gutter+20 across all rungs.
- Vertical rhythm on an 8 px grid: header→rungs 16, rung→rung 8, rungs→question 16, question→input 8, input→hints 8, hints→toolbar 12.
- Type: sans for prose (header value, questions, answers, placeholder); mono ONLY for the `INTENT` label, rung numbers, kbd hints. Sizes: question 14/500, rungs 12, hints 11, label 10 tracking-wide.
- Answer input: transparent, 1 px bottom hairline `var(--ui-stroke-secondary)`, focus → `var(--ui-accent)`; recommended answer shown as ghost placeholder "↵ recommended: …" (Tab on empty accepts it). Options as text chips (underline on hover), same row, wrap allowed.
- Answers right-aligned, truncated with title tooltip; questions truncate, never wrap, in the rung list.
- Only theme vars (`var(--ui-*)`); no hard colors, no background. Use SDK `Button`, `Kbd`, `Tip` where natural.
- Preview: `<pre>`-free — render the brief as plain markdown text block, max-height 40vh, scroll, mono 11.

## Config
```yaml
auxiliary:
  grill:
    provider: openrouter
    model: google/gemini-3.7-flash
    reasoning_effort: none   # verify the accepted key/values in agent/auxiliary_client.py; drop if unsupported
plugins:
  enabled: [ ..., grill-tab ]
```

## Pre-mortem
- Executor misreading: rebuilding the in-core hook in the plugin verbatim (re-list Q/A brief, no recommendation). The engine spec above is the product; the fork is reference only.
- Ambiguity: "no popover open" — the composer has slash, `@`, emoji popovers; probe by a DOM marker inside composer-root, not by guessing class names; document the selector in the adapter.
- First integration to fail: `submit()` via synthetic Enter (React may accept it; if not, the send-button click fallback must exist and be tested by hand).
- Unsaid need: Tab must NEVER steal from slash/`@` completions or an empty composer; regression is unacceptable.
- Second-order: `plugin_api.py` runs inside `hermes serve`; import errors there break the whole plugin mount — keep imports lazy and guarded; no core imports at module top beyond fastapi/pydantic.
- Remote backends (MacBook over SSH): the desktop half must be installed on the CLIENT (`~/.hermes/desktop-plugins/grill-tab/plugin.js`), the Python half on the backend host. README must say so.

## Verification gates (Director runs them)
1. `pytest tests/` green; one live smoke against `/interrogate` with intent "hi" → `done=true` in <3 s; intent "write a weekly competitor newsletter for my coffee brand" → question in the goal/deliverable category with a recommendation, <2.5 s.
2. Prod-shaped test bed: prod renderer code (`~/.hermes/hermes-agent`, untouched) run with `HERMES_HOME=~/.hermes-dev`; plugin loads with no error toast; Tab in slash popover still completes; Tab with a draft opens the ladder; Enter produces a brief preview; Enter launches a session whose first user message is the brief.
3. Screenshot look-gate with An on that surface before anything is called done.
