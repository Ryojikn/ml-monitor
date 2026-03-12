from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel


class StorageConnectionCreate(BaseModel):
    name: str
    type: str
    description: Optional[str] = None
    config: dict[str, Any] = {}


class StorageConnectionUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    config: Optional[dict[str, Any]] = None


class StorageConnectionRead(BaseModel):
    id: str
    name: str
    type: str
    description: Optional[str]
    config: dict[str, Any]
    last_tested_at: Optional[datetime]
    last_test_ok: Optional[bool]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}
