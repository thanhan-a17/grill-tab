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


def test_routes_pass_attachments_and_session_history(monkeypatch):
    class RecordingEngine(FakeEngine):
        def __init__(self):
            self.payloads = []

        def interrogate(self, payload):
            self.payloads.append(("interrogate", payload))
            return super().interrogate(payload)

        def brief(self, payload):
            self.payloads.append(("brief", payload))
            return super().brief(payload)

    engine = RecordingEngine()
    monkeypatch.setattr(plugin_api, "_engine", lambda: engine)
    app = FastAPI()
    app.include_router(plugin_api.router)
    api = TestClient(app)
    extras = {
        "attachments": [{"name": "reference.png", "kind": "image", "data_url": "data:image/png;base64,AA"}],
        "session_history": [{"role": "user", "content": "Use this reference."}],
    }
    assert api.post("/interrogate", json={"text": "make a report", **extras}).status_code == 200
    assert api.post("/brief", json={"text": "make a report", **extras}).status_code == 200

    assert engine.payloads == [
        ("interrogate", {"text": "make a report", "ladder": [], "cwd": None, "profile": None, "force": False, **extras}),
        ("brief", {"text": "make a report", "ladder": [], "cwd": None, "profile": None, **extras}),
    ]


def test_empty_text_is_contract_error(monkeypatch):
    response = client(monkeypatch).post("/interrogate", json={"text": "  ", "ladder": []})
    assert response.status_code == 400
    assert response.json() == {"error": "text must be non-empty"}


def test_health(monkeypatch):
    response = client(monkeypatch).get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True, "model": "fake/model"}


def test_real_engine_loader():
    eng = plugin_api._engine()
    assert eng is not None
    assert hasattr(eng, "interrogate")
    assert hasattr(eng, "brief")
    assert hasattr(eng, "get_model_label")


def test_standalone_spec_loader():
    import importlib.util
    api_path = Path(__file__).resolve().parents[1] / "dashboard" / "plugin_api.py"
    spec = importlib.util.spec_from_file_location("hermes_dashboard_plugin_test", api_path)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    eng = mod._engine()
    assert eng is not None
    assert hasattr(eng, "interrogate")
    assert hasattr(eng, "brief")
