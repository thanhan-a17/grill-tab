"""Pure, failure-safe interrogation and brief-synthesis engine for grill-tab."""
from __future__ import annotations

import datetime as _datetime
import json
import logging
import re
import time
from pathlib import Path
from typing import Any, Callable, Iterable, Mapping

logger = logging.getLogger(__name__)

# Auxiliary task registered by __init__.register(); `auxiliary.grill` is the pre-0.2 key and is
# still honoured (read-only) so existing installs keep their model pin.
_AUX_TASK = "grill_tab"
_LEGACY_AUX_TASK = "grill"
_legacy_aux_notice_logged = False

_INTERROGATE_TIMEOUT = 25.0
_BRIEF_TIMEOUT = 35.0
_INTERROGATE_MAX_TOKENS = 2048
_BRIEF_MAX_TOKENS = 4096
_CATEGORIES = ("goal", "deliverable", "scope", "verification", "architecture")
_DEFERRAL_RE = re.compile(
    r"\b(you decide|your call|which is simplest|what(?:'s| is) simplest|simplest|not sure|unsure|whatever you recommend|up to you)\b",
    re.IGNORECASE,
)

_INTERROGATE_SYSTEM = """You are the Grill preflight engine: before an autonomous agent starts on the user's draft, you surface the one decision most likely to change the outcome.
The draft may be anything — research, writing, planning, operations, design, analysis, personal errands, or code. Do not assume software.
Model the intent as a decision tree. Ask exactly one decision from the current frontier: only a decision whose prerequisites are already known.
Every question must include a short recommended answer and, where natural, 2–4 short options.
Facts are the agent's job: do not ask for facts that can be inspected or looked up. Ask decisions only.
Skip-if-same-plan rule: if every plausible answer leads to the same work, do not ask.
If the prior answer is a question, hesitation, "you decide", or asks which is simplest, treat the prior recommendation as settled. Do not re-ask or rephrase it; set settled_from_recommendation true.
Trivial greetings, thanks, and tiny underspecified intents must return done=true immediately with a one-line reason; do not manufacture questions.
Prefer the highest-leverage unanswered category: goal (the outcome that makes this worth doing), deliverable (shape, medium, audience, where it lands), scope (what is in and out), verification (how the user will know it is right). Use architecture only when the intent is clearly code-oriented. Do not repeat a category unless the user opened a new branch.
Analyze attached media/files using their supplied descriptions or previews, and build directly on prior conversation context instead of re-asking settled information.
Never ask generic checklist questions (tone, length, language, tests, error handling) unless the answer would change the plan. Questions must be 18 words or fewer, in the user's language.
Return JSON only, with exactly: done (boolean), reason (string or null), question (string or null), recommended (string or null), options (array), category (goal|deliverable|scope|verification|architecture|null), settled_from_recommendation (boolean)."""

_BRIEF_SYSTEM = """Turn the original intent and the completed ladder into an execution brief for an autonomous agent. Return markdown only.
Fidelity comes first. The brief is a faithful restatement of what the user asked for and decided, not an improved version of it:
- Goal restates the user's original intent as an outcome, in the user's own terms and at the user's stated ambition. Do not enlarge it.
- Settled means: stated in the original intent, answered in the ladder, or a recommendation the user accepted (including by deferring with "you decide" or similar). Nothing else is settled.
- Do not add deliverables, steps, audiences, channels, features, or polish the user did not ask for. Do not change the medium, tone, length, or language of what they asked for.
- Every line under Settled decisions must trace to a settled item. Write it as a directive, not as question and answer.
- Anything the work still needs that is not settled goes under Assumptions, phrased conservatively: pick the least surprising, smallest option, never the most ambitious one.
- Never invent facts, numbers, names, or constraints that were not given.
- Background about the user (memory, project notes, prior conversation) is context, not a decision. Use it only to phrase things in the user's terms. Never promote it into Goal, Settled decisions, or Constraints, and never use it to guess a target (repository, folder, file, account, brand) the user did not name — an unnamed target is an Assumption: the current working directory, or the item the user pointed at.
Use these sections, with these exact headings, only when they have content: ## Goal, ## Success criteria, ## Deliverable, ## Scope & non-goals, ## Settled decisions, ## Constraints, ## Verify before reporting done, ## Assumptions to make explicitly (do not ask), ## Directive.
Constraints holds only limits the user stated. Success criteria must be observable by the user. Verify steps must be things the agent can actually check before reporting.
Use plain, domain-appropriate language; do not use software vocabulary (architecture, tests, deploy, implementation) unless the intent itself is about code.
Write the body in the language the user wrote in; the headings stay in English.
Be concise — most briefs fit in 150–250 words — but never drop a settled decision to save space.
Analyze attached media/files using their supplied descriptions or previews, and treat prior conversation context as established context.
The Directive must say: Work autonomously. Do not re-ask anything above. Ask only if blocked by something outside this brief."""


def _empty_interrogate(reason: str = "engine unavailable", *, source: str = "fallback") -> dict[str, Any]:
    return {
        "done": True,
        "reason": reason,
        "question": None,
        "recommended": None,
        "options": [],
        "category": None,
        "settled_from_recommendation": False,
        "source": source,
    }


def _forced_question(*, source: str = "fallback", reason: str | None = None) -> dict[str, Any]:
    return {
        "done": False,
        "reason": reason,
        "question": "What outcome would make this worthwhile?",
        "recommended": "Choose the simplest useful outcome.",
        "options": ["A useful result", "A decision-ready result"],
        "category": "goal",
        "settled_from_recommendation": False,
        "source": source,
    }


def _clean_text(value: Any) -> str:
    return value.strip() if isinstance(value, str) else ""


def _strip_thinking(text: str) -> str:
    if not isinstance(text, str):
        return ""
    return re.sub(r"<think>.*?</think>", "", text, flags=re.DOTALL).strip()


def _normalize_category(cat: Any) -> str:
    val = _clean_text(cat).lower()
    if not val:
        return "goal"
    if val in _CATEGORIES:
        return val
    # Word-boundary matching for canonical categories
    for canonical in _CATEGORIES:
        if re.search(r"\b" + canonical + r"\b", val):
            return canonical
    for canonical in _CATEGORIES:
        if re.search(r"\b" + canonical[:4] + r"[a-z]*\b", val):
            return canonical
    if re.search(r"\b(outcome|purpose|target|vision|objective)\b", val):
        return "goal"
    if re.search(r"\b(output|format|surface|artifact|product)\b", val):
        return "deliverable"
    if re.search(r"\b(scope|boundary|constraint|limit|time|budget)\b", val):
        return "scope"
    if re.search(r"\b(test|qa|check|validation|verify|metric|signal)\b", val):
        return "verification"
    if re.search(r"\b(tech|stack|code|infra|database|backend|arch)\b", val):
        return "architecture"
    return "goal"


def _json_object(text: str) -> dict[str, Any] | None:
    """Find the best valid JSON object in prose, fences, or thinking output."""
    if not isinstance(text, str):
        return None
    cleaned = _strip_thinking(text)

    # 1. Direct JSON parse
    try:
        val = json.loads(cleaned)
        if isinstance(val, dict):
            return val
    except json.JSONDecodeError:
        pass

    # 2. Markdown fence ```json ... ```
    fence_match = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL | re.IGNORECASE)
    if fence_match:
        try:
            val = json.loads(fence_match.group(1))
            if isinstance(val, dict):
                return val
        except json.JSONDecodeError:
            pass

    # 3. Scan across '{' occurrences with raw_decode
    decoder = json.JSONDecoder()
    candidates: list[dict[str, Any]] = []
    for match in re.finditer(r"\{", cleaned):
        try:
            value, _ = decoder.raw_decode(cleaned[match.start():])
            if isinstance(value, dict):
                candidates.append(value)
        except json.JSONDecodeError:
            continue

    if not candidates:
        return None

    # Prefer candidate containing grill schema keys
    for cand in candidates:
        if "question" in cand or "done" in cand or "recommended" in cand:
            return cand

    return candidates[0]


def parse_interrogate_response(text: str) -> dict[str, Any]:
    """Normalize model JSON across model families; failure is a deterministic done fallback."""
    raw = _json_object(text)
    if raw is None or not isinstance(raw, dict):
        return _empty_interrogate("engine returned an unusable response")

    done_val = raw.get("done")
    question = _clean_text(raw.get("question"))

    # Explicit done=True, or done is not False and there is no question
    if done_val is True or (done_val is not False and not question):
        reason = _clean_text(raw.get("reason")) or "Nothing critical left."
        return {
            **_empty_interrogate(reason, source="model"),
            "settled_from_recommendation": bool(raw.get("settled_from_recommendation")),
        }

    if not question:
        return _empty_interrogate("engine returned an unusable response")

    words = question.split()
    if len(words) > 18:
        question = " ".join(words[:18])

    options = raw.get("options")
    clean_options = [_clean_text(item) for item in options] if isinstance(options, list) else []
    clean_options = [item for item in clean_options if item][:4]

    recommended = _clean_text(raw.get("recommended"))
    if not recommended:
        if clean_options:
            recommended = clean_options[0]
        else:
            recommended = "Choose the simplest useful outcome."

    category = _normalize_category(raw.get("category"))

    return {
        "done": False,
        "reason": None,
        "question": question,
        "recommended": recommended,
        "options": clean_options,
        "category": category,
        "settled_from_recommendation": bool(raw.get("settled_from_recommendation")),
        "source": "model",
    }


def parse_brief_response(text: str) -> str:
    """Return a model brief only when it has the mandated goal and directive shape."""
    if not isinstance(text, str):
        return ""
    clean = _strip_thinking(text)
    clean = re.sub(r"^\s*```(?:markdown|md)?\s*|\s*```\s*$", "", clean.strip(), flags=re.IGNORECASE).strip()

    # Normalize heading levels for Goal
    clean = re.sub(r"(?m)^#+\s+Goal\b", "## Goal", clean, flags=re.IGNORECASE)
    if "## Goal" not in clean:
        return ""

    # Ensure Directive is present; append canonical directive if the model omitted it
    if not re.search(r"(?m)^##\s+Directive\b", clean, flags=re.IGNORECASE):
        clean = clean + "\n\n## Directive\nWork autonomously. Do not re-ask anything above. Ask only if blocked by something outside this brief."

    return clean[:12000].strip()


def _memory_context(profile: str | None = None) -> list[str]:
    """Read bounded profile-aware memories without requiring Hermes at import time."""
    try:
        from hermes_constants import get_hermes_home
        base = Path(get_hermes_home())
        memory_dir = base / "memories"
        # Profile is an identifier, never a user-controlled path segment.
        if profile and re.fullmatch(r"[A-Za-z0-9_-]+", profile):
            candidate = Path.home() / ".hermes" / "profiles" / profile / "memories"
            if candidate.is_dir():
                memory_dir = candidate
    except Exception:
        return []
    result: list[str] = []
    for name in ("USER.md", "MEMORY.md"):
        try:
            content = (memory_dir / name).read_text(encoding="utf-8").strip()
        except (OSError, UnicodeDecodeError):
            continue
        if content:
            result.append(f"{name}:\n{content[:1500]}")
    return result


def _project_context(cwd: Any) -> str | None:
    if not isinstance(cwd, str) or not cwd.strip():
        return None
    path = Path(cwd).expanduser()
    if not path.exists():
        return None
    # Repository root = nearest ancestor holding .git (a plain filesystem walk; no subprocess).
    root = next((p for p in (path, *path.parents) if (p / ".git").exists()), path)
    hints = [name for name in ("pyproject.toml", "package.json", "README.md") if (root / name).is_file()]
    suffix = f"; hints: {', '.join(hints)}" if hints else ""
    return f"Project hint: {root.name or root}{suffix}"


def _rungs(ladder: Any) -> list[dict[str, str]]:
    if not isinstance(ladder, list):
        return []
    result = []
    for rung in ladder:
        if not isinstance(rung, Mapping):
            continue
        question = _clean_text(rung.get("question"))
        answer = _clean_text(rung.get("answer"))
        category = _clean_text(rung.get("category"))
        recommended = _clean_text(rung.get("recommended"))
        if question or answer:
            result.append({"question": question, "answer": answer, "category": category, "recommended": recommended})
    return result


def _render_answer(rung: Mapping[str, str]) -> str:
    """A deferral ("you decide") is the user accepting the recommendation; say so explicitly
    when we know it, so the brief model never has to guess what was accepted."""
    answer = rung.get("answer", "")
    recommended = rung.get("recommended", "")
    if recommended and (not answer or _DEFERRAL_RE.search(answer)):
        return f"{recommended} (recommendation accepted by the user{': ' + repr(answer) if answer else ''})"
    return answer


def _is_deferral(rungs: Iterable[Mapping[str, str]]) -> bool:
    items = list(rungs)
    return bool(items and _DEFERRAL_RE.search(items[-1].get("answer", "")))


def _render_session_history(session_history: Any) -> str | None:
    if not isinstance(session_history, list):
        return None
    messages: list[str] = []
    for item in session_history:
        if not isinstance(item, Mapping):
            continue
        role = _clean_text(item.get("role")).lower()
        content = _clean_text(item.get("content"))
        if role not in {"user", "assistant"} or not content:
            continue
        messages.append(f"{role.title()}: {content[:2000]}")
    return "\n".join(messages) or None


def _attachment_description(attachment: Mapping[str, Any]) -> str | None:
    name = _clean_text(attachment.get("name")) or "unnamed attachment"
    kind = _clean_text(attachment.get("kind")).lower()
    if kind not in {"image", "file"}:
        return None
    content = _clean_text(attachment.get("content"))
    if content:
        preview = content[:2000]
    else:
        data_url = _clean_text(attachment.get("data_url"))
        if data_url.startswith("data:"):
            media_type = data_url[5:].split(";", 1)[0].split(",", 1)[0] or "unknown"
            preview = f"data URL ({media_type})"
        else:
            path = _clean_text(attachment.get("path"))
            preview = f"path: {path}" if path else "no preview supplied"
    return f"{name} ({kind}): {preview}"


def _render_attachments(attachments: Any) -> str | None:
    if not isinstance(attachments, list):
        return None
    descriptions = [
        description
        for item in attachments
        if isinstance(item, Mapping)
        for description in [_attachment_description(item)]
        if description
    ]
    return "\n".join(f"- {description}" for description in descriptions) or None


def _context_message(
    text: str,
    ladder: Any,
    cwd: Any,
    profile: str | None,
    attachments: Any = None,
    session_history: Any = None,
) -> str:
    parts = [f"Today: {_datetime.date.today().isoformat()}"]
    project = _project_context(cwd)
    if project:
        parts.append(project)
    memories = _memory_context(profile)
    if memories:
        parts.append("Background about the user (context only, not decisions):\n" + "\n\n".join(memories))
    history = _render_session_history(session_history)
    if history:
        parts.append(f"Prior conversation context:\n{history}")
    attachments_text = _render_attachments(attachments)
    if attachments_text:
        parts.append(f"Attached media/files:\n{attachments_text}")
    parts.append(f"Original intent:\n{text.strip()}")
    rungs = _rungs(ladder)
    if rungs:
        rendered = "\n".join(f"- [{r['category'] or 'unknown'}] Q: {r['question']}\n  A: {_render_answer(r)}" for r in rungs)
        parts.append(f"Completed ladder:\n{rendered}")
    if _is_deferral(rungs):
        parts.append("The last answer is a deferral. Adopt the prior recommendation as settled and set settled_from_recommendation=true.")
    return "\n\n".join(parts)


def build_interrogate_messages(
    text: str,
    ladder: Any = None,
    cwd: Any = None,
    profile: str | None = None,
    force: bool = False,
    attachments: Any = None,
    session_history: Any = None,
) -> list[dict[str, str]]:
    instruction = "Return the next frontier decision." if not force else "The user forced another rung. Return a question, never done=true."
    return [
        {"role": "system", "content": _INTERROGATE_SYSTEM},
        {"role": "user", "content": f"{_context_message(text, ladder, cwd, profile, attachments, session_history)}\n\n{instruction}"},
    ]


def build_brief_messages(
    text: str,
    ladder: Any = None,
    cwd: Any = None,
    profile: str | None = None,
    attachments: Any = None,
    session_history: Any = None,
) -> list[dict[str, str]]:
    return [
        {"role": "system", "content": _BRIEF_SYSTEM},
        {"role": "user", "content": _context_message(text, ladder, cwd, profile, attachments, session_history)},
    ]


def _has_route(task_config: Any) -> bool:
    """True when the block pins a model. ``provider: auto`` is the registered default (and
    the installer's default), not a pin."""
    if not isinstance(task_config, Mapping):
        return False
    provider = _clean_text(task_config.get("provider")).lower()
    return bool(_clean_text(task_config.get("model")) or (provider and provider != "auto"))


def _aux_task_key(get_config: Callable[[str], Mapping[str, Any]] | None = None) -> str:
    """Return the auxiliary task to route through: ``grill_tab`` unless only the legacy
    ``grill`` block carries a provider/model pin."""
    global _legacy_aux_notice_logged
    if get_config is None:
        from agent.auxiliary_client import _get_auxiliary_task_config as get_config

    if _has_route(get_config(_AUX_TASK)):
        return _AUX_TASK
    if _has_route(get_config(_LEGACY_AUX_TASK)):
        if not _legacy_aux_notice_logged:
            logger.info("auxiliary.%s is deprecated; move the block to auxiliary.%s", _LEGACY_AUX_TASK, _AUX_TASK)
            _legacy_aux_notice_logged = True
        return _LEGACY_AUX_TASK
    return _AUX_TASK


def _default_llm(
    *,
    messages: list[dict[str, str]],
    temperature: float,
    max_tokens: int,
    timeout: float,
    is_json: bool = False,
) -> tuple[str, str]:
    """Universal Hermes adapter handling reasoning controls and token headroom across all providers."""
    from agent.auxiliary_client import (
        call_llm,
        extract_content_or_reasoning,
        _get_auxiliary_task_config,
        _resolve_task_provider_model,
    )
    from hermes_constants import parse_reasoning_effort

    route: dict[str, str] = {}
    task = _aux_task_key()
    task_config = _get_auxiliary_task_config(task)
    provider, model, _, _, _ = _resolve_task_provider_model(task)
    provider_norm = (provider or "").strip().lower()

    effort = task_config.get("reasoning_effort")
    reasoning_config = parse_reasoning_effort(effort) if effort else None

    extra_body: dict[str, Any] = {}
    configured_extra = task_config.get("extra_body")
    if isinstance(configured_extra, dict):
        extra_body.update(configured_extra)

    # Provider-specific thinking / reasoning adaptation
    if provider_norm == "gemini":
        # If effort is 'none' or not configured, disable thinking tokens for fast sub-second rungs
        if reasoning_config is None or reasoning_config.get("enabled") is False or effort == "none":
            extra_body.setdefault("thinking_config", {"thinkingBudget": 0, "includeThoughts": False})
        elif effort in ("minimal", "low"):
            extra_body.setdefault("thinking_config", {"thinkingLevel": "low", "includeThoughts": True})

    # JSON mode: only send response_format on OpenAI-compatible providers that won't 400 on it
    if is_json and provider_norm not in ("gemini", "anthropic"):
        extra_body.setdefault("response_format", {"type": "json_object"})

    # Respect user-configured timeout from config.yaml if higher
    cfg_timeout = task_config.get("timeout")
    if isinstance(cfg_timeout, (int, float)) and cfg_timeout > 0:
        timeout = max(timeout, float(cfg_timeout))

    response = call_llm(
        task=task,
        messages=messages,
        temperature=temperature,
        max_tokens=max_tokens,
        timeout=timeout,
        route_info=route,
        extra_body=extra_body or None,
        reasoning_config=reasoning_config,
    )
    resolved_provider = route.get("provider", provider or "auto")
    resolved_model = route.get("model", model or "default")
    return extract_content_or_reasoning(response), f"{resolved_provider}/{resolved_model}"


def get_model_label() -> str:
    """Best-effort configured auxiliary route for health/fallback responses."""
    try:
        from agent.auxiliary_client import _resolve_task_provider_model
        provider, model, _, _, _ = _resolve_task_provider_model(_aux_task_key())
        return f"{provider or 'auto'}/{model or 'default'}"
    except Exception:
        return "auto/default"


def _invoke(
    llm: Callable[..., Any] | None,
    messages: list[dict[str, str]],
    *,
    max_tokens: int,
    timeout: float,
    is_json: bool = False,
) -> tuple[str, str]:
    if llm is not None:
        try:
            result = llm(messages=messages, temperature=0.2, max_tokens=max_tokens, timeout=timeout, is_json=is_json)
        except TypeError:
            result = llm(messages=messages, temperature=0.2, max_tokens=max_tokens, timeout=timeout)
    else:
        result = _default_llm(messages=messages, temperature=0.2, max_tokens=max_tokens, timeout=timeout, is_json=is_json)

    if isinstance(result, tuple) and len(result) >= 2:
        return str(result[0] or ""), str(result[1] or get_model_label())
    if isinstance(result, Mapping):
        return str(result.get("text") or result.get("content") or ""), str(result.get("model") or get_model_label())
    return str(result or ""), get_model_label()


def local_template_brief(text: str, ladder: Any = None, attachments: Any = None, session_history: Any = None) -> str:
    """Deterministic local brief that records only known inputs and explicit assumptions."""
    rungs = _rungs(ladder)
    decisions = [f"- {r['category'] or 'Decision'}: {r['answer']}" for r in rungs if r["answer"]]
    known = "\n".join(decisions) or "- No decisions were settled before launch."
    context_notes: list[str] = []
    attachments_text = _render_attachments(attachments)
    if attachments_text:
        context_notes.append(f"Attached media/files to analyze:\n{attachments_text}")
    if _render_session_history(session_history):
        context_notes.append("Prior conversation context was provided and should guide the work.")
    constraints = "\n".join(f"- {note}" for note in context_notes) or "- None stated."
    return f"""## Goal
{text.strip() or 'Produce the requested outcome.'}

## Success criteria
- The result directly addresses the stated intent.

## Deliverable
- Choose the smallest useful deliverable shape and state where it lands.

## Scope & non-goals
- Limit work to the stated intent; do not expand scope without evidence.

## Settled decisions
{known}

## Constraints
{constraints}

## Verify before reporting done
- Check the deliverable against the stated success criteria.

## Assumptions to make explicitly (do not ask)
- Make the smallest reversible assumptions needed to proceed.

## Directive
Work autonomously. Do not re-ask anything above. Ask only if blocked by something outside this brief."""


def interrogate(payload: Mapping[str, Any], llm: Callable[..., Any] | None = None) -> dict[str, Any]:
    """Ask one rung, returning a contract-shaped fallback for every failure."""
    started = time.monotonic()
    data = payload if isinstance(payload, Mapping) else {}
    text = _clean_text(data.get("text"))
    model = get_model_label()
    force = bool(data.get("force"))
    try:
        if not text:
            response = _empty_interrogate("empty intent")
        else:
            raw, model = _invoke(
                llm,
                build_interrogate_messages(
                    text,
                    data.get("ladder"),
                    data.get("cwd"),
                    _clean_text(data.get("profile")) or None,
                    force,
                    data.get("attachments"),
                    data.get("session_history"),
                ),
                max_tokens=_INTERROGATE_MAX_TOKENS,
                timeout=_INTERROGATE_TIMEOUT,
                is_json=True,
            )
            response = parse_interrogate_response(raw)
            rungs = _rungs(data.get("ladder"))
            if _is_deferral(rungs) and not response["done"]:
                response["settled_from_recommendation"] = True
        if force and response["done"]:
            response = _forced_question(source=response.get("source", "fallback"), reason=None)
    except Exception:
        response = _forced_question() if force else _empty_interrogate("engine unavailable")
    return {**response, "latency_ms": max(0, int((time.monotonic() - started) * 1000)), "model": model}


def brief(payload: Mapping[str, Any], llm: Callable[..., Any] | None = None) -> dict[str, Any]:
    """Synthesize a brief, falling back to the local template without raising."""
    started = time.monotonic()
    data = payload if isinstance(payload, Mapping) else {}
    text = _clean_text(data.get("text"))
    model = get_model_label()
    try:
        if not text:
            raise ValueError("empty intent")
        raw, model = _invoke(
            llm,
            build_brief_messages(
                text,
                data.get("ladder"),
                data.get("cwd"),
                _clean_text(data.get("profile")) or None,
                data.get("attachments"),
                data.get("session_history"),
            ),
            max_tokens=_BRIEF_MAX_TOKENS,
            timeout=_BRIEF_TIMEOUT,
            is_json=False,
        )
        parsed = parse_brief_response(raw)
        if not parsed:
            raise ValueError("unusable brief")
        result = {"brief": parsed, "source": "model"}
    except Exception:
        result = {
            "brief": local_template_brief(
                text,
                data.get("ladder"),
                data.get("attachments"),
                data.get("session_history"),
            ),
            "source": "template",
        }
    return {**result, "latency_ms": max(0, int((time.monotonic() - started) * 1000)), "model": model}
