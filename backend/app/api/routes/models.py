from __future__ import annotations
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.db.models import Model, MonitoringRun, DriftResult, PerformanceResult, QualityResult, Alert, Dataset
from app.schemas.model import ModelCreate, ModelUpdate, ModelRead, ModelSummary
from app.scheduler import register_model_job, remove_model_job, reschedule_model_job

router = APIRouter(prefix="/models", tags=["models"])


def _build_model_summary(m: Model, last_run: MonitoringRun | None, psi_timeline: list) -> dict:
    return {
        "id": m.id,
        "name": m.name,
        "version": m.version,
        "type": m.type,
        "team": m.team,
        "owner": m.owner,
        "engine": m.engine,
        "status": m.status,
        "global_psi": m.global_psi,
        "global_perf": m.global_perf,
        "dq_score": m.dq_score,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
        "last_run_at": last_run.triggered_at.isoformat() if last_run else None,
        "psi_timeline": psi_timeline,
    }


@router.get("")
async def list_models(
    search: str = "",
    team: str = "",
    type: str = "",
    status: str = "",
    db: AsyncSession = Depends(get_db),
):
    q = select(Model)
    if search:
        q = q.where(Model.name.ilike(f"%{search}%"))
    if team:
        q = q.where(Model.team == team)
    if type:
        q = q.where(Model.type == type)
    if status:
        q = q.where(Model.status == status)

    result = await db.execute(q.order_by(Model.updated_at.desc()))
    models = result.scalars().all()

    items = []
    for m in models:
        # Get last run
        run_q = select(MonitoringRun).where(MonitoringRun.model_id == m.id).order_by(MonitoringRun.triggered_at.desc()).limit(1)
        run_r = await db.execute(run_q)
        last_run = run_r.scalar_one_or_none()

        # Get PSI timeline (last 10 points)
        dr_q = (
            select(DriftResult.date, func.avg(DriftResult.psi).label("psi"))
            .where(DriftResult.model_id == m.id)
            .group_by(DriftResult.date)
            .order_by(DriftResult.date.desc())
            .limit(10)
        )
        dr_r = await db.execute(dr_q)
        psi_rows = dr_r.all()
        psi_timeline = [{"date": r.date, "value": round(r.psi, 4)} for r in reversed(psi_rows)]

        items.append(_build_model_summary(m, last_run, psi_timeline))

    return {"items": items, "total": len(items)}


@router.post("", status_code=201)
async def create_model(body: ModelCreate, db: AsyncSession = Depends(get_db)):
    m = Model(
        name=body.name,
        version=body.version,
        type=body.type,
        team=body.team,
        owner=body.owner,
        description=body.description,
        tags=body.tags,
        engine=body.engine,
        schedule=body.schedule,
        lookback_window=body.lookback_window,
        comparison_strategy=body.comparison_strategy,
        column_mapping=body.column_mapping.model_dump(),
        psi_warn_threshold=body.psi_warn_threshold,
        psi_crit_threshold=body.psi_crit_threshold,
        alert_cooldown_hours=body.alert_cooldown_hours,
        alert_channels=body.alert_channels,
        reference_dataset_config=body.reference_dataset_config.model_dump() if body.reference_dataset_config else None,
        inference_dataset_config=body.inference_dataset_config.model_dump() if body.inference_dataset_config else None,
        status="inactive",
    )
    db.add(m)
    await db.commit()
    await db.refresh(m)
    if m.schedule:
        try:
            register_model_job(m.id, m.schedule)
        except Exception:
            pass
    return await _get_model_detail(m.id, db)


@router.get("/{model_id}")
async def get_model(model_id: str, db: AsyncSession = Depends(get_db)):
    return await _get_model_detail(model_id, db)


@router.patch("/{model_id}")
async def update_model(model_id: str, body: ModelUpdate, db: AsyncSession = Depends(get_db)):
    m = await _fetch_model(model_id, db)
    data = body.model_dump(exclude_none=True)
    for k, v in data.items():
        if k in ("column_mapping", "reference_dataset_config", "inference_dataset_config") and hasattr(v, "model_dump"):
            v = v.model_dump()
        setattr(m, k, v)
    await db.commit()
    if "schedule" in data and data["schedule"]:
        try:
            reschedule_model_job(model_id, data["schedule"])
        except Exception:
            pass
    return await _get_model_detail(model_id, db)


@router.delete("/{model_id}", status_code=204)
async def delete_model(model_id: str, db: AsyncSession = Depends(get_db)):
    m = await _fetch_model(model_id, db)
    remove_model_job(model_id)
    await db.delete(m)
    await db.commit()


async def _fetch_model(model_id: str, db: AsyncSession) -> Model:
    result = await db.execute(select(Model).where(Model.id == model_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")
    return m


async def _get_model_detail(model_id: str, db: AsyncSession) -> dict:
    m = await _fetch_model(model_id, db)

    # Runs (last 20)
    runs_q = select(MonitoringRun).where(MonitoringRun.model_id == model_id).order_by(MonitoringRun.triggered_at.desc()).limit(20)
    runs_r = await db.execute(runs_q)
    runs = runs_r.scalars().all()
    last_run = runs[0] if runs else None

    # PSI timeline (per date, avg across features)
    psi_q = (
        select(DriftResult.date, func.avg(DriftResult.psi).label("psi"))
        .where(DriftResult.model_id == model_id)
        .group_by(DriftResult.date)
        .order_by(DriftResult.date)
    )
    psi_r = await db.execute(psi_q)
    psi_timeline = [{"date": r.date, "value": round(r.psi, 4)} for r in psi_r.all()]

    # Feature drift (latest run)
    feature_drift = []
    if last_run:
        fd_q = select(DriftResult).where(DriftResult.run_id == last_run.id)
        fd_r = await db.execute(fd_q)
        fd_rows = fd_r.scalars().all()

        # Build per-feature timelines
        for fd in fd_rows:
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
                "baseline_histogram": fd.baseline_histogram,
                "current_histogram": fd.current_histogram,
            })

    # Performance timeline
    perf_q = (
        select(PerformanceResult)
        .where(PerformanceResult.model_id == model_id)
        .order_by(PerformanceResult.date)
    )
    perf_r = await db.execute(perf_q)
    perf_rows = perf_r.scalars().all()

    performance_timeline = []
    for p in perf_rows:
        val = p.auc_roc if p.auc_roc is not None else (p.r2 if p.r2 is not None else 0)
        performance_timeline.append({"date": p.date, "value": round(val, 4)})

    prediction_drift = [
        {"date": p.date, "value": round(p.prediction_psi or 0, 4)}
        for p in perf_rows if p.prediction_psi is not None
    ]

    # Data quality (latest run)
    dq_missing: list[dict] = []
    dq_outlier: list[dict] = []
    if last_run:
        dq_q = select(QualityResult).where(QualityResult.run_id == last_run.id)
        dq_r = await db.execute(dq_q)
        dq_rows = dq_r.scalars().all()
        for dq in dq_rows:
            dq_missing.append({"feature": dq.feature_name, "value": round(dq.missing_rate, 4)})
            dq_outlier.append({"feature": dq.feature_name, "value": round(dq.outlier_rate, 4)})

    # Alerts
    alerts_q = select(Alert).where(Alert.model_id == model_id).order_by(Alert.created_at.desc()).limit(50)
    alerts_r = await db.execute(alerts_q)
    alerts_rows = alerts_r.scalars().all()
    alerts_data = [
        {
            "id": a.id,
            "model_id": a.model_id,
            "severity": a.severity,
            "metric_name": a.metric_name,
            "metric_value": round(a.metric_value, 4),
            "threshold": round(a.threshold, 4),
            "message": a.message,
            "status": a.status,
            "feature_name": a.feature_name,
            "created_at": a.created_at.isoformat(),
        }
        for a in alerts_rows
    ]

    # Datasets
    ds_q = select(Dataset).where(Dataset.model_id == model_id)
    ds_r = await db.execute(ds_q)
    datasets = [
        {"id": d.id, "role": d.role, "filename": d.filename, "row_count": d.row_count, "uploaded_at": d.uploaded_at.isoformat()}
        for d in ds_r.scalars().all()
    ]

    return {
        "id": m.id,
        "name": m.name,
        "version": m.version,
        "type": m.type,
        "team": m.team,
        "owner": m.owner,
        "description": m.description,
        "tags": m.tags,
        "engine": m.engine,
        "status": m.status,
        "schedule": m.schedule,
        "lookback_window": m.lookback_window,
        "comparison_strategy": m.comparison_strategy,
        "column_mapping": m.column_mapping,
        "psi_warn_threshold": m.psi_warn_threshold,
        "psi_crit_threshold": m.psi_crit_threshold,
        "alert_cooldown_hours": m.alert_cooldown_hours,
        "alert_channels": m.alert_channels,
        "global_psi": m.global_psi,
        "global_perf": m.global_perf,
        "dq_score": m.dq_score,
        "reference_dataset_config": m.reference_dataset_config,
        "inference_dataset_config": m.inference_dataset_config,
        "created_at": m.created_at.isoformat(),
        "updated_at": m.updated_at.isoformat(),
        "last_run_at": last_run.triggered_at.isoformat() if last_run else None,
        "psi_timeline": psi_timeline,
        "performance_timeline": performance_timeline,
        "prediction_drift": prediction_drift,
        "feature_drift": feature_drift,
        "dq_missing": dq_missing,
        "dq_outlier": dq_outlier,
        "runs": [
            {
                "id": r.id,
                "triggered_at": r.triggered_at.isoformat(),
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
                "status": r.status,
                "engine": r.engine,
                "duration_seconds": r.duration_seconds,
                "window_start": r.window_start,
                "window_end": r.window_end,
                "error_message": r.error_message,
            }
            for r in runs
        ],
        "alerts": alerts_data,
        "datasets": datasets,
    }
