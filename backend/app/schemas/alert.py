from __future__ import annotations
from datetime import datetime
from typing import Optional
from pydantic import BaseModel, ConfigDict


class AssignedUserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: str
    display_name: str
    email: str


class AlertRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

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
    acknowledged_at: datetime | None
    assigned_to: str | None
    assigned_to_user_id: str | None
    assigned_user: Optional[AssignedUserRead]


class AlertUpdate(BaseModel):
    status: str | None = None
    assigned_to: str | None = None
    assigned_to_user_id: str | None = None
