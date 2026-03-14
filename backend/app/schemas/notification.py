from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel


class NotificationChannelCreate(BaseModel):
    type: str
    name: str
    config: dict
    enabled: bool = True


class NotificationChannelUpdate(BaseModel):
    name: str | None = None
    config: dict | None = None
    enabled: bool | None = None


class NotificationChannelRead(BaseModel):
    id: str
    type: str
    name: str
    config: dict
    enabled: bool
    last_tested_at: datetime | None
    last_test_ok: bool | None
    last_test_message: str | None
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class TestResult(BaseModel):
    ok: bool
    message: str
