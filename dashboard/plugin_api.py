"""FastAPI routes for grill-tab, mounted at /api/plugins/grill-tab/."""
from __future__ import annotations

import asyncio
import importlib
import importlib.util
import logging
from pathlib import Path
from typing import Any, Optional

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

logger = logging.getLogger(__name__)

router = APIRouter()


class LadderRung(BaseModel):
    question: str = ""
    answer: str = ""
    category: Optional[str] = None


class InterrogateRequest(BaseModel):
    text: str
    ladder: list[LadderRung] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    session_history: list[dict[str, Any]] = Field(default_factory=list)
    cwd: Optional[str] = None
    profile: Optional[str] = None
    force: bool = False


class BriefRequest(BaseModel):
    text: str
    ladder: list[LadderRung] = Field(default_factory=list)
    attachments: list[dict[str, Any]] = Field(default_factory=list)
    session_history: list[dict[str, Any]] = Field(default_factory=list)
    cwd: Optional[str] = None
    profile: Optional[str] = None


_cached_engine: Any = None


def _engine():
    """Load the sibling engine without a top-level Hermes import dependency."""
    global _cached_engine
    try:
        from . import grill_engine
        try:
            return importlib.reload(grill_engine)
        except Exception:
            return grill_engine
    except (ImportError, ValueError):
        pass

    module_path = Path(__file__).with_name("grill_engine.py")
    spec = importlib.util.spec_from_file_location("grill_tab_engine", module_path)
    if spec is None or spec.loader is None:
        raise RuntimeError("grill engine could not be loaded")
    if _cached_engine is None:
        _cached_engine = importlib.util.module_from_spec(spec)
    try:
        spec.loader.exec_module(_cached_engine)
    except Exception:
        if not hasattr(_cached_engine, "interrogate"):
            raise
    return _cached_engine


def _payload(request: InterrogateRequest | BriefRequest) -> dict:
    return request.model_dump() if hasattr(request, "model_dump") else request.dict()


@router.post("/interrogate")
async def interrogate(request: InterrogateRequest):
    if not request.text.strip():
        return JSONResponse(status_code=400, content={"error": "text must be non-empty"})
    try:
        return await asyncio.to_thread(_engine().interrogate, _payload(request))
    except Exception:
        logger.exception("Grill interrogate error:")
        # The engine itself is failure-safe; this preserves the REST contract if it cannot import.
        return JSONResponse(status_code=500, content={"error": "engine unavailable"})


@router.post("/brief")
async def brief(request: BriefRequest):
    if not request.text.strip():
        return JSONResponse(status_code=400, content={"error": "text must be non-empty"})
    try:
        return await asyncio.to_thread(_engine().brief, _payload(request))
    except Exception:
        logger.exception("Grill brief error:")
        return JSONResponse(status_code=500, content={"error": "engine unavailable"})


@router.get("/health")
async def health():
    try:
        return {"ok": True, "model": _engine().get_model_label()}
    except Exception:
        return {"ok": True, "model": "auto/default"}
