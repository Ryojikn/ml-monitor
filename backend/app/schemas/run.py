from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel


class RunRead(BaseModel):
    id: str
    model_id: str
    triggered_at: datetime
    completed_at: datetime | None
    status: str
    engine: str
    duration_seconds: float | None
    window_start: str | None
    window_end: str | None
    error_message: str | None

    model_config = {"from_attributes": True}
