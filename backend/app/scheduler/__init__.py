"""
APScheduler wiring for MLMonitor.

Exports:
  scheduler              — the shared AsyncIOScheduler instance
  register_model_job()   — add or replace a cron job for a model
  remove_model_job()     — remove a model's cron job
  reschedule_model_job() — update the cron expression for an existing job
"""
from __future__ import annotations

import logging

from apscheduler.schedulers.asyncio import AsyncIOScheduler
from apscheduler.triggers.cron import CronTrigger

logger = logging.getLogger(__name__)

scheduler = AsyncIOScheduler(timezone="UTC")


def _job_id(model_id: str) -> str:
    return f"monitor_{model_id}"


def register_model_job(model_id: str, cron: str) -> None:
    """
    Register (or replace) a cron monitoring job for the given model.

    Uses replace_existing=True so this is idempotent — safe to call on
    startup for all already-registered models.
    """
    from app.engine.runner import run_monitoring  # local import avoids circular deps

    job_id = _job_id(model_id)
    try:
        trigger = CronTrigger.from_crontab(cron, timezone="UTC")
    except Exception as exc:
        logger.warning("Invalid cron expression '%s' for model %s: %s", cron, model_id, exc)
        return

    scheduler.add_job(
        run_monitoring,
        trigger,
        args=[model_id],
        id=job_id,
        replace_existing=True,
        misfire_grace_time=3600,   # fire within 1h of a missed schedule
        coalesce=True,             # merge multiple missed fires into one
    )
    logger.info("Registered monitoring job %s (cron: %s)", job_id, cron)


def remove_model_job(model_id: str) -> None:
    """Remove the cron job for a model. No-op if no job exists."""
    job_id = _job_id(model_id)
    if scheduler.get_job(job_id):
        scheduler.remove_job(job_id)
        logger.info("Removed monitoring job %s", job_id)


def reschedule_model_job(model_id: str, new_cron: str) -> None:
    """Update the cron expression for a model's job (replace_existing handles it)."""
    register_model_job(model_id, new_cron)
