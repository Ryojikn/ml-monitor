from __future__ import annotations

import smtplib
from email.mime.text import MIMEText

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.models import NotificationChannel, Alert, Model
from app.config import settings


async def dispatch_alert_notifications(db: AsyncSession, alerts: list[Alert]) -> None:
    """Send all enabled notification channels a message for each new alert."""
    if not alerts:
        return

    result = await db.execute(
        select(NotificationChannel).where(NotificationChannel.enabled == True)  # noqa: E712
    )
    channels = result.scalars().all()
    if not channels:
        return

    for alert in alerts:
        # Fetch model name and team for enriched notifications
        model_result = await db.execute(select(Model).where(Model.id == alert.model_id))
        model = model_result.scalar_one_or_none()
        model_name = model.name if model else alert.model_id
        team = model.team if model else "unknown"
        model_url = f"{settings.frontend_base_url}/models/{alert.model_id}"

        for ch in channels:
            try:
                await _send(ch.type, ch.config, alert, model_name, team, model_url)
            except Exception:
                pass  # never block run completion due to notification failure


async def _send(
    channel_type: str,
    config: dict,
    alert: Alert,
    model_name: str,
    team: str,
    model_url: str,
) -> None:
    import httpx

    severity_emoji = {"CRITICAL": "🔴", "WARNING": "🟡"}.get(alert.severity, "⚪")
    text = (
        f"{severity_emoji} *MLMonitor Alert — {alert.severity}*\n"
        f"Model: {model_name} ({team} team)\n"
        f"Metric: {alert.metric_name} = {alert.metric_value:.4f} (threshold {alert.threshold})\n"
        f"{alert.message}\n"
        f"View model: {model_url}"
    )

    if channel_type == "slack":
        url = config.get("webhook_url", "")
        if not url:
            return
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json={"text": text})

    elif channel_type == "pagerduty":
        key = config.get("integration_key", "")
        if not key:
            return
        payload = {
            "routing_key": key,
            "event_action": "trigger",
            "dedup_key": f"mlmonitor-{alert.model_id}-{alert.metric_name}-{alert.severity}",
            "payload": {
                "summary": f"MLMonitor {alert.severity}: {alert.message}",
                "severity": "critical" if alert.severity == "CRITICAL" else "warning",
                "source": "mlmonitor",
                "custom_details": {
                    "model": model_name,
                    "team": team,
                    "metric_value": alert.metric_value,
                    "threshold": alert.threshold,
                    "feature": alert.feature_name,
                    "model_url": model_url,
                },
            },
        }
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post("https://events.pagerduty.com/v2/enqueue", json=payload)

    elif channel_type == "email":
        recipients_raw = config.get("recipients", "")
        if not recipients_raw:
            return
        host = config.get("smtp_host", "")
        if not host:
            return
        port = int(config.get("smtp_port", 587))
        user = config.get("smtp_user", "")
        password = config.get("smtp_pass", "")
        from_addr = config.get("from_addr", user or "mlmonitor@localhost")
        recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

        msg = MIMEText(text)
        msg["Subject"] = f"MLMonitor {alert.severity}: {alert.metric_name}"
        msg["From"] = from_addr
        msg["To"] = ", ".join(recipients)

        import asyncio
        loop = asyncio.get_event_loop()

        def _send_smtp() -> None:
            with smtplib.SMTP(host, port, timeout=10) as smtp:
                smtp.ehlo()
                smtp.starttls()
                if user and password:
                    smtp.login(user, password)
                smtp.sendmail(from_addr, recipients, msg.as_string())

        await loop.run_in_executor(None, _send_smtp)

    elif channel_type == "webhook":
        url = config.get("url", "")
        if not url:
            return
        headers = {"Content-Type": "application/json"}
        secret_name = config.get("secret_header_name", "")
        secret = config.get("secret_header_value", "")
        if secret_name and secret:
            headers[secret_name] = secret
        payload = {
            "event": "alert",
            "severity": alert.severity,
            "model_id": alert.model_id,
            "model_name": model_name,
            "team": team,
            "model_url": model_url,
            "metric_name": alert.metric_name,
            "metric_value": alert.metric_value,
            "threshold": alert.threshold,
            "message": alert.message,
        }
        async with httpx.AsyncClient(timeout=10) as client:
            await client.post(url, json=payload, headers=headers)
