from __future__ import annotations
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.db.models import Alert
from app.schemas.alert import AlertRead, AlertUpdate

router = APIRouter(prefix="/alerts", tags=["alerts"])


@router.get("")
async def list_alerts(
    model_id: str = "",
    severity: str = "",
    status: str = "",
    limit: int = 100,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    q = select(Alert)
    if model_id:
        q = q.where(Alert.model_id == model_id)
    if severity:
        q = q.where(Alert.severity == severity)
    if status:
        q = q.where(Alert.status == status)

    q = q.order_by(Alert.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(q)
    rows = result.scalars().all()

    open_count = sum(1 for r in rows if r.status == "open")
    ack_count = sum(1 for r in rows if r.status == "acknowledged")
    res_count = sum(1 for r in rows if r.status == "resolved")

    items = [
        {
            "id": a.id,
            "model_id": a.model_id,
            "run_id": a.run_id,
            "severity": a.severity,
            "metric_name": a.metric_name,
            "metric_value": round(a.metric_value, 4),
            "threshold": round(a.threshold, 4),
            "message": a.message,
            "status": a.status,
            "feature_name": a.feature_name,
            "notified_channels": a.notified_channels,
            "created_at": a.created_at.isoformat(),
            "resolved_at": a.resolved_at.isoformat() if a.resolved_at else None,
            "assigned_to": a.assigned_to,
        }
        for a in rows
    ]

    return {
        "items": items,
        "total": len(items),
        "counts": {"open": open_count, "acknowledged": ack_count, "resolved": res_count},
    }


@router.patch("/{alert_id}")
async def update_alert(alert_id: str, body: AlertUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Alert).where(Alert.id == alert_id))
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    if body.status is not None:
        alert.status = body.status
        if body.status == "resolved":
            alert.resolved_at = datetime.utcnow()
    if body.assigned_to is not None:
        alert.assigned_to = body.assigned_to
    await db.commit()
    await db.refresh(alert)

    return {
        "id": alert.id,
        "model_id": alert.model_id,
        "status": alert.status,
        "assigned_to": alert.assigned_to,
        "resolved_at": alert.resolved_at.isoformat() if alert.resolved_at else None,
    }
