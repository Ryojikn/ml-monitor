from __future__ import annotations
from datetime import datetime
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.db.session import get_db
from app.db.models import Alert, User
from app.schemas.alert import AlertRead, AlertUpdate

router = APIRouter(prefix="/alerts", tags=["alerts"])


def _alert_to_dict(a: Alert) -> dict:
    return {
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
        "acknowledged_at": a.acknowledged_at.isoformat() if a.acknowledged_at else None,
        "assigned_to": a.assigned_to,
        "assigned_to_user_id": a.assigned_to_user_id,
        "assigned_user": {
            "id": a.assigned_user.id,
            "display_name": a.assigned_user.display_name,
            "email": a.assigned_user.email,
        } if a.assigned_user else None,
    }


@router.get("")
async def list_alerts(
    model_id: str = "",
    severity: str = "",
    status: str = "",
    assigned_to_user_id: str = "",
    limit: int = 200,
    offset: int = 0,
    db: AsyncSession = Depends(get_db),
):
    q = select(Alert).options(selectinload(Alert.assigned_user))
    if model_id:
        q = q.where(Alert.model_id == model_id)
    if severity:
        q = q.where(Alert.severity == severity)
    if status:
        q = q.where(Alert.status == status)
    if assigned_to_user_id:
        q = q.where(Alert.assigned_to_user_id == assigned_to_user_id)

    q = q.order_by(Alert.created_at.desc()).offset(offset).limit(limit)
    result = await db.execute(q)
    rows = result.scalars().all()

    open_count = sum(1 for r in rows if r.status == "open")
    ack_count  = sum(1 for r in rows if r.status == "acknowledged")
    res_count  = sum(1 for r in rows if r.status == "resolved")

    return {
        "items": [_alert_to_dict(a) for a in rows],
        "total": len(rows),
        "counts": {"open": open_count, "acknowledged": ack_count, "resolved": res_count},
    }


@router.patch("/{alert_id}")
async def update_alert(alert_id: str, body: AlertUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(Alert).options(selectinload(Alert.assigned_user)).where(Alert.id == alert_id)
    )
    alert = result.scalar_one_or_none()
    if not alert:
        raise HTTPException(status_code=404, detail="Alert not found")

    now = datetime.utcnow()

    # Assignment flow: setting a user implicitly acknowledges the alert
    if body.assigned_to_user_id is not None:
        user_result = await db.execute(select(User).where(User.id == body.assigned_to_user_id))
        user = user_result.scalar_one_or_none()
        if not user:
            raise HTTPException(status_code=404, detail="User not found")
        alert.assigned_to_user_id = user.id
        alert.assigned_to = f"{user.display_name} ({user.email})"
        alert.status = "acknowledged"
        if not alert.acknowledged_at:
            alert.acknowledged_at = now
        # Fire assignment notification (non-blocking)
        try:
            from app.alerts.dispatcher import dispatch_assignment_notification
            from app.db.models import Model
            model_result = await db.execute(select(Model).where(Model.id == alert.model_id))
            model = model_result.scalar_one_or_none()
            model_name = model.name if model else alert.model_id
            team = model.team if model else "unknown"
            await dispatch_assignment_notification(db, alert, model_name, team, user.display_name, user.email)
        except Exception:
            pass

    elif body.status is not None:
        alert.status = body.status
        if body.status == "acknowledged" and not alert.acknowledged_at:
            alert.acknowledged_at = now
        if body.status == "resolved" and not alert.resolved_at:
            alert.resolved_at = now

    # Legacy plain-text assigned_to update (kept for backward compat)
    elif body.assigned_to is not None:
        alert.assigned_to = body.assigned_to

    await db.commit()
    await db.refresh(alert)
    # Reload relationship after refresh
    result2 = await db.execute(
        select(Alert).options(selectinload(Alert.assigned_user)).where(Alert.id == alert_id)
    )
    alert = result2.scalar_one()

    return _alert_to_dict(alert)
