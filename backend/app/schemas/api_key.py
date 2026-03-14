from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel


class ApiKeyCreate(BaseModel):
    name: str


class ApiKeyRead(BaseModel):
    id: str
    name: str
    key_prefix: str
    created_at: datetime
    last_used_at: datetime | None
    is_active: bool

    model_config = {"from_attributes": True}


class ApiKeyCreated(ApiKeyRead):
    full_key: str  # returned only once on creation
