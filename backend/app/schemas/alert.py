from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel


class AlertRead(BaseModel):
    id: str
    model_id: str
    run_id: str | None
    severity: str
    metric_name: str
    metric_value: float
    threshold: float
    message: str
    status: str
    feature_name: str | None
    notified_channels: list[str]
    created_at: datetime
    resolved_at: datetime | None

    model_config = {"from_attributes": True}


class AlertUpdate(BaseModel):
    status: str  # acknowledged | resolved
