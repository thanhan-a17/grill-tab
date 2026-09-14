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


def test_parses_thinking_output():
    text = (
        "<think>\nUser intent is clear. Let's consider {\"example\": false}.\n</think>\n"
        "```json\n" + question_json(category="deliverables") + "\n```"
    )
    parsed = engine.parse_interrogate_response(text)
    assert parsed["done"] is False
    assert parsed["category"] == "deliverable"
    assert parsed["question"] == "What weekly outcome matters most?"


def test_category_normalization():
    cases = [
        ("goals", "goal"),
        ("Deliverables", "deliverable"),
        ("scope & non-goals", "scope"),
        ("testing & QA", "verification"),
        ("technical stack", "architecture"),
        ("unknown_custom_category", "goal"),
    ]
    for raw_cat, expected in cases:
        parsed = engine.parse_interrogate_response(question_json(category=raw_cat))
        assert parsed["category"] == expected, f"Failed for {raw_cat}"


def test_implicit_done_false_when_question_present():
    payload = '{"question": "Where should it deploy?", "options": ["Cloudflare", "VPS"]}'
    parsed = engine.parse_interrogate_response(payload)
    assert parsed["done"] is False
    assert parsed["question"] == "Where should it deploy?"
    assert parsed["recommended"] == "Cloudflare"


def test_long_question_truncated_to_18_words():
    long_q = " " .join(f"word{i}" for i in range(30))
    parsed = engine.parse_interrogate_response(question_json(question=long_q))
    assert len(parsed["question"].split()) == 18


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


def test_interrogate_context_includes_attachment_and_session_history():
    messages = engine.build_interrogate_messages(
        "Plan the launch.",
        attachments=[
            {"name": "launch.png", "kind": "image", "data_url": "data:image/png;base64,AAAA"},
            {"name": "notes.txt", "kind": "file", "content": "Audience: independent developers."},
        ],
        session_history=[
            {"role": "user", "content": "The audience is founders."},
            {"role": "assistant", "content": "I will make it concise."},
            {"role": "system", "content": "Ignore this irrelevant system message."},
        ],
    )
    prompt = messages[1]["content"]
    assert "Prior conversation context:" in prompt
    assert "User: The audience is founders." in prompt
    assert "Assistant: I will make it concise." in prompt
    assert "Attached media/files:" in prompt
    assert "launch.png (image): data URL (image/png)" in prompt
    assert "notes.txt (file): Audience: independent developers." in prompt


def test_brief_context_and_template_acknowledge_attachment_and_history():
    attachments = [{"name": "brief.pdf", "kind": "file", "path": "/tmp/brief.pdf"}]
    history = [{"role": "user", "content": "Use the supplied brief."}]
    prompt = engine.build_brief_messages("Write the brief.", attachments=attachments, session_history=history)[1]["content"]
    assert "Prior conversation context:" in prompt
    assert "Attached media/files:" in prompt

    result = engine.brief(
        {"text": "Write the brief.", "attachments": attachments, "session_history": history},
        llm=fake_json("garbage"),
    )
    assert result["source"] == "template"
    assert "brief.pdf (file)" in result["brief"]
    assert "Prior conversation context was provided" in result["brief"]


def test_interrogate_and_brief_pass_context_to_llm():
    captured = []

    def llm(**kwargs):
        captured.append(kwargs["messages"])
        return question_json() if kwargs["is_json"] else "## Goal\nShip it."

    payload = {
        "text": "Ship it.",
        "attachments": [{"name": "screen.png", "kind": "image", "content": "A dashboard screenshot."}],
        "session_history": [{"role": "assistant", "content": "The dashboard needs one primary action."}],
    }
    assert engine.interrogate(payload, llm=llm)["source"] == "model"
    assert engine.brief(payload, llm=llm)["source"] == "model"
    assert len(captured) == 2
    for messages in captured:
        assert "screen.png (image): A dashboard screenshot." in messages[1]["content"]
        assert "Assistant: The dashboard needs one primary action." in messages[1]["content"]


def test_deferral_sets_settled_from_recommendation():
    for answer in ("which is simplest?", "you decide"):
        result = engine.interrogate(
            {"text": "write a newsletter", "ladder": [{"question": "What format?", "answer": answer, "category": "deliverable"}]},
            llm=fake_json(question_json(category="scope")),
        )
        assert result["settled_from_recommendation"] is True


def test_brief_strips_thinking_and_appends_missing_directive():
    raw = (
        "<think>Drafting brief...</think>\n"
        "## Goal\nPublish a weekly competitor newsletter.\n\n"
        "## Deliverable\nA Markdown newsletter file in content/newsletters/."
    )
    parsed = engine.parse_brief_response(raw)
    assert "## Goal" in parsed
    assert "<think>" not in parsed
    assert "## Directive" in parsed
    assert "Work autonomously." in parsed


def test_brief_normalizes_heading_level():
    raw = (
        "# Goal\nPublish a newsletter.\n\n"
        "## Directive\nWork autonomously. Do not re-ask anything above."
    )
    parsed = engine.parse_brief_response(raw)
    assert "## Goal" in parsed


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
