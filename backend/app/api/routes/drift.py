from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func

from app.db.session import get_db
from app.db.models import DriftResult, MonitoringRun

router = APIRouter(prefix="/models/{model_id}/drift", tags=["drift"])


@router.get("")
async def get_drift(model_id: str, days: int = 30, db: AsyncSession = Depends(get_db)):
    # Global PSI timeline (avg across features per date)
    psi_q = (
        select(DriftResult.date, func.avg(DriftResult.psi).label("psi"))
        .where(DriftResult.model_id == model_id)
        .group_by(DriftResult.date)
        .order_by(DriftResult.date)
    )
    psi_r = await db.execute(psi_q)
    global_psi_timeline = [{"date": r.date, "value": round(r.psi, 4)} for r in psi_r.all()]

    # Latest run features
    latest_run_q = (
        select(MonitoringRun)
        .where(MonitoringRun.model_id == model_id, MonitoringRun.status == "success")
        .order_by(MonitoringRun.triggered_at.desc())
        .limit(1)
    )
    latest_run_r = await db.execute(latest_run_q)
    latest_run = latest_run_r.scalar_one_or_none()

    feature_drift = []
    if latest_run:
        fd_q = select(DriftResult).where(DriftResult.run_id == latest_run.id)
        fd_r = await db.execute(fd_q)
        for fd in fd_r.scalars().all():
            tl_q = (
                select(DriftResult.date, DriftResult.psi)
                .where(DriftResult.model_id == model_id, DriftResult.feature_name == fd.feature_name)
                .order_by(DriftResult.date)
            )
            tl_r = await db.execute(tl_q)
            timeline = [{"date": r.date, "value": round(r.psi, 4)} for r in tl_r.all()]

            feature_drift.append({
                "feature": fd.feature_name,
                "psi": round(fd.psi, 4),
                "ks": round(fd.ks_stat, 4),
                "jsd": round(fd.jsd, 4),
                "wasserstein": round(fd.wasserstein, 4),
                "is_drifted": fd.is_drifted,
                "severity": fd.severity,
                "timeline": timeline,
            })

    return {
        "global_psi_timeline": global_psi_timeline,
        "prediction_drift": [],  # populated from performance_results elsewhere
        "feature_drift": feature_drift,
    }


@router.get("/features/{feature_name}/histogram")
async def get_histogram(model_id: str, feature_name: str, run_id: str = "", db: AsyncSession = Depends(get_db)):
    q = select(DriftResult).where(
        DriftResult.model_id == model_id,
        DriftResult.feature_name == feature_name,
    )
    if run_id:
        q = q.where(DriftResult.run_id == run_id)
    else:
        # Latest run
        q = q.order_by(DriftResult.date.desc()).limit(1)

    result = await db.execute(q)
    dr = result.scalar_one_or_none()

    if not dr:
        raise HTTPException(status_code=404, detail="No drift result found for this feature")

    return {
        "feature": feature_name,
        "psi": dr.psi,
        "ks_stat": dr.ks_stat,
        "jsd": dr.jsd,
        "baseline_histogram": dr.baseline_histogram,
        "current_histogram": dr.current_histogram,
    }
