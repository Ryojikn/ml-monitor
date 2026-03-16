from __future__ import annotations

from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class UserCreate(BaseModel):
    email: str
    display_name: str
    external_id: Optional[str] = None
    external_source: Optional[str] = None


class UserUpdate(BaseModel):
    display_name: Optional[str] = None
    is_active: Optional[bool] = None


class UserRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    email: str
    display_name: str
    external_id: Optional[str]
    external_source: Optional[str]
    is_active: bool
    created_at: datetime


class UserWithTeams(UserRead):
    memberships: list[MembershipRead] = []
