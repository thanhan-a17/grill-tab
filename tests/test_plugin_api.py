from __future__ import annotations

import sys
from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "dashboard"))
import plugin_api


class FakeEngine:
    def interrogate(self, payload):
        return {"done": False, "reason": None, "question": "What outcome?", "recommended": "A useful result.", "options": [], "category": "goal", "settled_from_recommendation": False, "source": "model", "latency_ms": 1, "model": "fake/model"}

    def brief(self, payload):
        return {"brief": "## Goal\nUseful result\n\n## Directive\nWork autonomously.", "source": "model", "latency_ms": 1, "model": "fake/model"}

    def get_model_label(self):
        return "fake/model"


def client(monkeypatch):
    monkeypatch.setattr(plugin_api, "_engine", lambda: FakeEngine())
    app = FastAPI()
    app.include_router(plugin_api.router)
    return TestClient(app)


def test_interrogate_and_brief_routes(monkeypatch):
    api = client(monkeypatch)
    interrogate = api.post("/interrogate", json={"text": "make a report", "ladder": []})
    brief = api.post("/brief", json={"text": "make a report", "ladder": []})
    assert interrogate.status_code == 200
    assert interrogate.json()["question"] == "What outcome?"
    assert brief.status_code == 200
    assert brief.json()["source"] == "model"


def test_empty_text_is_contract_error(monkeypatch):
    response = client(monkeypatch).post("/interrogate", json={"text": "  ", "ladder": []})
    assert response.status_code == 400
    assert response.json() == {"error": "text must be non-empty"}


def test_health(monkeypatch):
    response = client(monkeypatch).get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "model": "fake/model"}
