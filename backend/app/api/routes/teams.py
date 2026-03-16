from __future__ import annotations

import re
import uuid
from datetime import datetime

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.db.models import Team, User, TeamMembership, Model
from app.schemas.team import (
    TeamCreate, TeamUpdate, TeamRead, TeamWithMembers,
    MembershipCreate, MembershipUpdate, MembershipRead,
    TeamSyncRequest,
)

router = APIRouter(prefix="/teams", tags=["teams"])


def _slugify(name: str) -> str:
    slug = name.lower().strip()
    slug = re.sub(r"[^\w\s-]", "", slug)
    slug = re.sub(r"[\s_]+", "-", slug)
    slug = re.sub(r"-+", "-", slug).strip("-")
    return slug


async def _get_team_or_404(team_id: str, db: AsyncSession) -> Team:
    result = await db.execute(select(Team).where(Team.id == team_id))
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    return team


async def _team_with_member_count(team: Team, db: AsyncSession) -> dict:
    count_result = await db.execute(
        select(func.count()).where(TeamMembership.team_id == team.id)
    )
    count = count_result.scalar_one()
    data = {c.name: getattr(team, c.name) for c in team.__table__.columns}
    data["member_count"] = count
    return data


# ── List / Create ──────────────────────────────────────────────────────────────

@router.get("", response_model=list[TeamRead])
async def list_teams(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Team).order_by(Team.name))
    teams = result.scalars().all()
    out = []
    for t in teams:
        out.append(await _team_with_member_count(t, db))
    return out


@router.post("", response_model=TeamRead, status_code=201)
async def create_team(body: TeamCreate, db: AsyncSession = Depends(get_db)):
    slug = _slugify(body.name)
    existing = await db.execute(select(Team).where(Team.name == body.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="A team with this name already exists")

    team = Team(slug=slug, **body.model_dump())
    db.add(team)
    await db.commit()
    await db.refresh(team)
    return await _team_with_member_count(team, db)


# ── Get / Update / Delete ──────────────────────────────────────────────────────

@router.get("/{team_id}", response_model=TeamWithMembers)
async def get_team(team_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Team)
        .where(Team.id == team_id)
        .options(selectinload(Team.memberships).selectinload(TeamMembership.user))
    )
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")
    data = await _team_with_member_count(team, db)
    data["members"] = team.memberships
    return data


@router.patch("/{team_id}", response_model=TeamRead)
async def update_team(team_id: str, body: TeamUpdate, db: AsyncSession = Depends(get_db)):
    team = await _get_team_or_404(team_id, db)
    updates = body.model_dump(exclude_unset=True)
    if "name" in updates:
        updates["slug"] = _slugify(updates["name"])
    for field, value in updates.items():
        setattr(team, field, value)
    await db.commit()
    await db.refresh(team)
    return await _team_with_member_count(team, db)


@router.delete("/{team_id}", status_code=204)
async def delete_team(team_id: str, db: AsyncSession = Depends(get_db)):
    team = await _get_team_or_404(team_id, db)
    # Prevent deletion if any models reference this team name
    models_using = await db.execute(select(Model).where(Model.team == team.name).limit(1))
    if models_using.scalar_one_or_none():
        raise HTTPException(
            status_code=409,
            detail=f"Cannot delete team '{team.name}': models are still assigned to it",
        )
    await db.delete(team)
    await db.commit()


# ── Members ────────────────────────────────────────────────────────────────────

@router.get("/{team_id}/members", response_model=list[MembershipRead])
async def list_members(team_id: str, db: AsyncSession = Depends(get_db)):
    await _get_team_or_404(team_id, db)
    result = await db.execute(
        select(TeamMembership)
        .where(TeamMembership.team_id == team_id)
        .options(selectinload(TeamMembership.user))
        .order_by(TeamMembership.created_at)
    )
    return result.scalars().all()


@router.post("/{team_id}/members", response_model=MembershipRead, status_code=201)
async def add_member(team_id: str, body: MembershipCreate, db: AsyncSession = Depends(get_db)):
    await _get_team_or_404(team_id, db)

    user_result = await db.execute(select(User).where(User.id == body.user_id))
    if not user_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="User not found")

    existing = await db.execute(
        select(TeamMembership)
        .where(TeamMembership.team_id == team_id, TeamMembership.user_id == body.user_id)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="User is already a member of this team")

    membership = TeamMembership(team_id=team_id, **body.model_dump())
    db.add(membership)
    await db.commit()

    result = await db.execute(
        select(TeamMembership)
        .where(TeamMembership.id == membership.id)
        .options(selectinload(TeamMembership.user))
    )
    return result.scalar_one()


@router.patch("/{team_id}/members/{user_id}", response_model=MembershipRead)
async def update_member_role(
    team_id: str, user_id: str, body: MembershipUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(
        select(TeamMembership)
        .where(TeamMembership.team_id == team_id, TeamMembership.user_id == user_id)
        .options(selectinload(TeamMembership.user))
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Membership not found")
    membership.role = body.role
    await db.commit()
    await db.refresh(membership)
    return membership


@router.delete("/{team_id}/members/{user_id}", status_code=204)
async def remove_member(team_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(TeamMembership)
        .where(TeamMembership.team_id == team_id, TeamMembership.user_id == user_id)
    )
    membership = result.scalar_one_or_none()
    if not membership:
        raise HTTPException(status_code=404, detail="Membership not found")
    await db.delete(membership)
    await db.commit()


# ── External Sync ──────────────────────────────────────────────────────────────

@router.post("/{team_id}/sync", response_model=TeamWithMembers)
async def sync_team_members(
    team_id: str, body: TeamSyncRequest, db: AsyncSession = Depends(get_db)
):
    """
    Bulk-upsert members from an external IdP (Okta, Azure AD, Google Workspace, LDAP).
    For each member entry:
      1. Upsert the User row (match on external_id first, then email).
      2. Upsert the TeamMembership with the given role.
    Memberships for users NOT in the payload (but with the same external_source) are removed.
    """
    result = await db.execute(
        select(Team)
        .where(Team.id == team_id)
        .options(selectinload(Team.memberships).selectinload(TeamMembership.user))
    )
    team = result.scalar_one_or_none()
    if not team:
        raise HTTPException(status_code=404, detail="Team not found")

    now = datetime.utcnow()
    synced_user_ids: set[str] = set()

    for entry in body.members:
        # Find or create user
        user = None
        if entry.external_id:
            r = await db.execute(select(User).where(User.external_id == entry.external_id))
            user = r.scalar_one_or_none()
        if user is None:
            r = await db.execute(select(User).where(User.email == entry.email))
            user = r.scalar_one_or_none()
        if user is None:
            user = User(
                email=entry.email,
                display_name=entry.display_name,
                external_id=entry.external_id,
                external_source=team.external_source,
            )
            db.add(user)
            await db.flush()  # get user.id
        else:
            user.display_name = entry.display_name
            if entry.external_id:
                user.external_id = entry.external_id

        # Upsert membership
        mr = await db.execute(
            select(TeamMembership)
            .where(TeamMembership.team_id == team_id, TeamMembership.user_id == user.id)
        )
        membership = mr.scalar_one_or_none()
        if membership is None:
            membership = TeamMembership(
                team_id=team_id, user_id=user.id, role=entry.role, created_at=now
            )
            db.add(membership)
        else:
            membership.role = entry.role

        synced_user_ids.add(user.id)

    # Remove stale external memberships not present in the payload
    if team.external_source:
        stale_r = await db.execute(
            select(TeamMembership)
            .where(TeamMembership.team_id == team_id)
            .options(selectinload(TeamMembership.user))
        )
        for m in stale_r.scalars().all():
            if (
                m.user.external_source == team.external_source
                and m.user_id not in synced_user_ids
            ):
                await db.delete(m)

    await db.commit()

    # Re-fetch with members
    fresh = await db.execute(
        select(Team)
        .where(Team.id == team_id)
        .options(selectinload(Team.memberships).selectinload(TeamMembership.user))
    )
    team = fresh.scalar_one()
    data = await _team_with_member_count(team, db)
    data["members"] = team.memberships
    return data
