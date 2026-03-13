from __future__ import annotations
import asyncio
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.db.models import MonitoringRun, Model
from app.engine.runner import run_monitoring
from app.schemas.run import RunRead

router = APIRouter(prefix="/models/{model_id}/runs", tags=["runs"])


@router.post("", status_code=202)
async def trigger_run(model_id: str, db: AsyncSession = Depends(get_db)):
    # Validate model exists
    result = await db.execute(select(Model).where(Model.id == model_id))
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Model not found")

    # Dispatch background task (non-blocking)
    asyncio.create_task(run_monitoring(model_id))

    return {"status": "accepted", "message": "Monitoring run queued"}


@router.get("", response_model=list[RunRead])
async def list_runs(model_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MonitoringRun)
        .where(MonitoringRun.model_id == model_id)
        .order_by(MonitoringRun.triggered_at.desc())
        .limit(50)
    )
    return result.scalars().all()


@router.get("/{run_id}", response_model=RunRead)
async def get_run(model_id: str, run_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(MonitoringRun).where(
            MonitoringRun.id == run_id,
            MonitoringRun.model_id == model_id,
        )
    )
    run = result.scalar_one_or_none()
    if not run:
        raise HTTPException(status_code=404, detail="Run not found")
    return run
