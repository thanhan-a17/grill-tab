from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import grill_engine as engine


def fake_json(payload):
    def call(**_kwargs):
        return payload
    return call


def question_json(**overrides):
    base = {
        "done": False,
        "reason": None,
        "question": "What weekly outcome matters most?",
        "recommended": "Publish a concise competitor digest.",
        "options": ["Digest", "Deep analysis"],
        "category": "goal",
        "settled_from_recommendation": False,
    }
    base.update(overrides)
    return __import__("json").dumps(base)


def test_parses_good_json():
    parsed = engine.parse_interrogate_response(question_json())
    assert parsed["question"] == "What weekly outcome matters most?"
    assert parsed["category"] == "goal"
    assert parsed["source"] == "model"


def test_parses_json_wrapped_in_prose_and_fence():
    parsed = engine.parse_interrogate_response("Here you go:\n```json\n" + question_json() + "\n```")
    assert parsed["done"] is False
    assert parsed["recommended"] == "Publish a concise competitor digest."


def test_garbage_becomes_done_fallback():
    parsed = engine.parse_interrogate_response("not JSON at all")
    assert parsed["done"] is True
    assert "unusable" in parsed["reason"]


def test_force_never_returns_done():
    result = engine.interrogate({"text": "hi", "force": True}, llm=fake_json('{"done": true, "reason": "greeting"}'))
    assert result["done"] is False
    assert result["question"]


def test_system_prompt_carries_done_and_skip_contracts():
    prompt = engine.build_interrogate_messages("hi")[0]["content"].lower()
    assert "done=true immediately" in prompt
    assert "if every plausible answer leads to the same work, do not ask" in prompt


def test_deferral_sets_settled_from_recommendation():
    for answer in ("which is simplest?", "you decide"):
        result = engine.interrogate(
            {"text": "write a newsletter", "ladder": [{"question": "What format?", "answer": answer, "category": "deliverable"}]},
            llm=fake_json(question_json(category="scope")),
        )
        assert result["settled_from_recommendation"] is True


def test_brief_falls_back_to_template():
    result = engine.brief({"text": "write a weekly competitor newsletter", "ladder": []}, llm=fake_json("garbage"))
    assert result["source"] == "template"
    assert "## Goal" in result["brief"]


def test_template_has_required_headings():
    brief = engine.local_template_brief("make a thing", [])
    for heading in (
        "## Goal", "## Success criteria", "## Deliverable", "## Scope & non-goals",
        "## Settled decisions", "## Constraints", "## Verify before reporting done",
        "## Assumptions to make explicitly (do not ask)", "## Directive",
    ):
        assert heading in brief
