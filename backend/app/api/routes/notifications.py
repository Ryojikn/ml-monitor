from __future__ import annotations

import smtplib
from datetime import datetime
from email.mime.text import MIMEText

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.session import get_db
from app.db.models import NotificationChannel
from app.schemas.notification import (
    NotificationChannelCreate,
    NotificationChannelUpdate,
    NotificationChannelRead,
    TestResult,
)

router = APIRouter(prefix="/notifications", tags=["notifications"])


@router.get("", response_model=list[NotificationChannelRead])
async def list_channels(db: AsyncSession = Depends(get_db)):
    result = await db.execute(
        select(NotificationChannel).order_by(NotificationChannel.created_at.asc())
    )
    return result.scalars().all()


@router.post("", response_model=NotificationChannelRead, status_code=201)
async def create_channel(body: NotificationChannelCreate, db: AsyncSession = Depends(get_db)):
    ch = NotificationChannel(
        type=body.type,
        name=body.name,
        config=body.config,
        enabled=body.enabled,
    )
    db.add(ch)
    await db.commit()
    await db.refresh(ch)
    return ch


@router.patch("/{channel_id}", response_model=NotificationChannelRead)
async def update_channel(
    channel_id: str, body: NotificationChannelUpdate, db: AsyncSession = Depends(get_db)
):
    result = await db.execute(select(NotificationChannel).where(NotificationChannel.id == channel_id))
    ch = result.scalar_one_or_none()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")

    if body.name is not None:
        ch.name = body.name
    if body.config is not None:
        ch.config = body.config
    if body.enabled is not None:
        ch.enabled = body.enabled

    await db.commit()
    await db.refresh(ch)
    return ch


@router.delete("/{channel_id}", status_code=204)
async def delete_channel(channel_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(NotificationChannel).where(NotificationChannel.id == channel_id))
    ch = result.scalar_one_or_none()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")
    await db.delete(ch)
    await db.commit()


@router.post("/{channel_id}/test", response_model=TestResult)
async def test_channel(channel_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(NotificationChannel).where(NotificationChannel.id == channel_id))
    ch = result.scalar_one_or_none()
    if not ch:
        raise HTTPException(status_code=404, detail="Channel not found")

    ok, message = await _run_test(ch.type, ch.config)

    ch.last_tested_at = datetime.utcnow()
    ch.last_test_ok = ok
    ch.last_test_message = message
    await db.commit()

    return TestResult(ok=ok, message=message)


async def _run_test(channel_type: str, config: dict) -> tuple[bool, str]:
    try:
        import httpx  # lazy import — not available until pip install -e . re-run
        if channel_type == "slack":
            url = config.get("webhook_url", "")
            if not url:
                return False, "Webhook URL is not configured."
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(url, json={"text": "✅ MLMonitor test notification — your Slack integration is working."})
            return r.status_code == 200, f"Slack responded with HTTP {r.status_code}" if r.status_code != 200 else "Test message delivered successfully."

        elif channel_type == "pagerduty":
            key = config.get("integration_key", "")
            if not key:
                return False, "Integration key is not configured."
            payload = {
                "routing_key": key,
                "event_action": "trigger",
                "payload": {
                    "summary": "MLMonitor test alert — integration check",
                    "severity": "info",
                    "source": "mlmonitor",
                },
            }
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post("https://events.pagerduty.com/v2/enqueue", json=payload)
            ok = r.status_code == 202
            return ok, "Test event accepted by PagerDuty." if ok else f"PagerDuty responded with HTTP {r.status_code}: {r.text[:200]}"

        elif channel_type == "email":
            recipients_raw = config.get("recipients", "")
            if not recipients_raw:
                return False, "No recipients configured."
            host = config.get("smtp_host", "")
            if not host:
                return False, "SMTP host is not configured."
            port = int(config.get("smtp_port", 587))
            user = config.get("smtp_user", "")
            password = config.get("smtp_pass", "")
            from_addr = config.get("from_addr", user or "mlmonitor@localhost")
            recipients = [r.strip() for r in recipients_raw.split(",") if r.strip()]

            msg = MIMEText("This is a test notification from MLMonitor. Your email integration is working correctly.")
            msg["Subject"] = "MLMonitor — Test Notification"
            msg["From"] = from_addr
            msg["To"] = ", ".join(recipients)

            import asyncio
            loop = asyncio.get_event_loop()

            def _send():
                with smtplib.SMTP(host, port, timeout=10) as smtp:
                    smtp.ehlo()
                    smtp.starttls()
                    if user and password:
                        smtp.login(user, password)
                    smtp.sendmail(from_addr, recipients, msg.as_string())

            await loop.run_in_executor(None, _send)
            return True, f"Test email sent to {recipients[0]}."

        elif channel_type == "webhook":
            url = config.get("url", "")
            if not url:
                return False, "Webhook URL is not configured."
            headers = {"Content-Type": "application/json"}
            secret = config.get("secret_header_value", "")
            secret_name = config.get("secret_header_name", "")
            if secret_name and secret:
                headers[secret_name] = secret
            async with httpx.AsyncClient(timeout=10) as client:
                r = await client.post(url, json={"event": "test", "source": "mlmonitor"}, headers=headers)
            ok = 200 <= r.status_code < 300
            return ok, f"Webhook responded with HTTP {r.status_code}." if ok else f"Webhook responded with HTTP {r.status_code}: {r.text[:200]}"

        else:
            return False, f"Unknown channel type: {channel_type}"

    except Exception as e:
        return False, str(e)
