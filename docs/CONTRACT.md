# grill-tab REST contract (FROZEN v1)

Base: `/api/plugins/grill-tab` (reached from the desktop half via `ctx.rest('/…')`).
All bodies JSON. Errors: HTTP 4xx/5xx with `{ "error": string }`; the desktop half treats any
non-2xx from `/interrogate` as `done` with reason "engine unavailable", and from `/brief` as
"use local template".

## Request context fields (both endpoints)
Both `POST /interrogate` and `POST /brief` additionally accept these optional fields:

- `attachments`: a list of attachment objects. Each has
  `{ "name": string, "kind": "image"|"file", "data_url": string|null, "content": string|null, "path": string|null }`.
  The backend supplies the model with the filename, kind, and a bounded text preview; for a data URL it supplies a media-type description rather than its encoded body.
- `session_history`: a list of `{ "role": "user"|"assistant"|"system", "content": string }` objects.
  Prior user and assistant messages are injected as conversation context; system entries are accepted but are not rendered as user-supplied conversation context.

## POST /interrogate
Request
```json
{
  "text": "string, the user's draft intent (required, non-empty)",
  "ladder": [ { "question": "string", "answer": "string", "category": "string|null", "recommended": "string|null" } ],
  "attachments": [ { "name": "string", "kind": "image|file", "data_url": "string|null", "content": "string|null", "path": "string|null" } ],
  "session_history": [ { "role": "user|assistant|system", "content": "string" } ],
  "cwd": "string|null",
  "profile": "string|null",
  "force": false
}
```
`force=true` (user pressed Tab in the done state) ⇒ engine must return a question, never `done`.

Response 200
```json
{
  "done": false,
  "reason": null,
  "question": "string ≤18 words",
  "recommended": "string, short",
  "options": ["string", "…"],
  "category": "goal|deliverable|scope|verification|architecture",
  "settled_from_recommendation": false,
  "latency_ms": 1234,
  "model": "openrouter/google/gemini-3.7-flash"
}
```
When `done=true`: `question`, `recommended`, `options`, `category` are null/empty and `reason` is a
one-line human sentence (e.g. "Intent is a greeting; nothing to settle.").
`settled_from_recommendation=true` means the previous rung's user answer was a question/deferral and
the engine adopted its own prior recommendation as that rung's answer; the desktop half rewrites the
last ladder answer to `previous.recommended` and marks it "(recommended)".
`recommended` on a ladder rung is optional (added in 0.2.0): when present and the answer is empty or a
deferral, the engine renders that rung as "<recommended> (recommendation accepted by the user)" so the
brief treats it as settled rather than open.

## POST /brief
Request
```json
{
  "text": "string, required, non-empty",
  "ladder": [ { "question": "…", "answer": "…", "category": "…", "recommended": "…|null" } ],
  "attachments": [ { "name": "string", "kind": "image|file", "data_url": "string|null", "content": "string|null", "path": "string|null" } ],
  "session_history": [ { "role": "user|assistant|system", "content": "string" } ],
  "cwd": "string|null",
  "profile": "string|null"
}
```
Response 200
```json
{ "brief": "markdown string", "source": "model|template", "latency_ms": 2100, "model": "…" }
```

## GET /health
`{ "ok": true, "model": "provider/model resolved for task grill" }`
