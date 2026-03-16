from __future__ import annotations

from datetime import datetime
from typing import Literal, Optional

from pydantic import BaseModel, ConfigDict

from app.schemas.user import UserRead

RoleType = Literal["can_review", "can_edit", "can_manage", "can_admin"]


class MembershipCreate(BaseModel):
    user_id: str
    role: RoleType


class MembershipUpdate(BaseModel):
    role: RoleType


class MembershipRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    team_id: str
    user_id: str
    role: str
    created_at: datetime
    user: UserRead


class TeamCreate(BaseModel):
    name: str
    description: Optional[str] = None
    external_id: Optional[str] = None
    external_source: Optional[str] = None  # "okta" | "azure_ad" | "google" | "ldap"


class TeamUpdate(BaseModel):
    name: Optional[str] = None
    description: Optional[str] = None
    external_id: Optional[str] = None
    external_source: Optional[str] = None


class TeamRead(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    name: str
    slug: str
    description: Optional[str]
    external_id: Optional[str]
    external_source: Optional[str]
    created_at: datetime
    member_count: int = 0


class TeamWithMembers(TeamRead):
    members: list[MembershipRead] = []


class SyncMember(BaseModel):
    external_id: str
    email: str
    display_name: str
    role: RoleType


class TeamSyncRequest(BaseModel):
    members: list[SyncMember]


# Resolve forward reference: UserWithTeams.memberships → MembershipRead
from app.schemas.user import UserWithTeams as _UserWithTeams  # noqa: E402
_UserWithTeams.model_rebuild(_types_namespace={"MembershipRead": MembershipRead})
