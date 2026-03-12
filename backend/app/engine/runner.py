"""
Orchestrates a full monitoring run for a given model.
Called by the run trigger endpoint and the APScheduler.
"""
from __future__ import annotations

import asyncio
import time
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.models import Model, Dataset, MonitoringRun, DriftResult, PerformanceResult, QualityResult, Alert
from app.db.session import AsyncSessionLocal
from app.engine.drift import compute_all_drift, compute_psi
from app.engine.quality import compute_all_quality
from app.engine.performance import compute_classification, compute_regression


def _parse_lookback(lookback: str) -> timedelta:
    """Parse '7d', '30d', '1h' etc. into timedelta."""
    units = {"d": "days", "h": "hours", "w": "weeks"}
    n = int(lookback[:-1])
    unit = lookback[-1].lower()
    return timedelta(**{units.get(unit, "days"): n})


def _load_csv(path: str) -> pd.DataFrame:
    return pd.read_csv(path)


def _apply_lookback(df: pd.DataFrame, timestamp_col: str, lookback: str) -> tuple[pd.DataFrame, str, str]:
    """Filter dataframe to the lookback window. Returns (filtered_df, window_start, window_end)."""
    if timestamp_col and timestamp_col in df.columns:
        try:
            df[timestamp_col] = pd.to_datetime(df[timestamp_col])
            window_end = df[timestamp_col].max()
            window_start = window_end - _parse_lookback(lookback)
            mask = df[timestamp_col] >= window_start
            return df[mask], str(window_start.date()), str(window_end.date())
        except Exception:
            pass
    return df, "", str(datetime.utcnow().date())


async def run_monitoring(model_id: str) -> str:
    """
    Execute a monitoring run. Returns run_id.
    This runs in a background task (asyncio.create_task).
    """
    async with AsyncSessionLocal() as db:
        # Load model
        result = await db.execute(select(Model).where(Model.id == model_id))
        m = result.scalar_one_or_none()
        if not m:
            return ""

        # Load datasets (latest baseline + latest production)
        ds_result = await db.execute(
            select(Dataset)
            .where(Dataset.model_id == model_id)
            .order_by(Dataset.uploaded_at.desc())
        )
        datasets = ds_result.scalars().all()

        baseline_ds = next((d for d in datasets if d.role == "baseline"), None)
        prod_ds = next((d for d in datasets if d.role == "production"), None)

        if not baseline_ds or not prod_ds:
            # Can't run without both datasets
            run = MonitoringRun(
                model_id=model_id,
                status="failed",
                engine=m.engine,
                error_message="Missing baseline or production dataset. Upload both before triggering a run.",
                completed_at=datetime.utcnow(),
                duration_seconds=0,
            )
            db.add(run)
            await db.commit()
            return run.id

        # Create run record
        run = MonitoringRun(model_id=model_id, status="running", engine=m.engine)
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = run.id

        start_time = time.monotonic()

        try:
            # Load data
            baseline_df = _load_csv(baseline_ds.file_path)
            prod_df = _load_csv(prod_ds.file_path)

            # Apply lookback window
            cm = m.column_mapping or {}
            timestamp_col = cm.get("timestamp_col", "")
            features: list[str] = cm.get("features", [])
            prediction_col: str = cm.get("prediction_col", "")
            target_col: str = cm.get("target_col", "")

            prod_df, window_start, window_end = _apply_lookback(prod_df, timestamp_col, m.lookback_window)

            run.window_start = window_start
            run.window_end = window_end
            date_label = window_end or str(datetime.utcnow().date())

            # Fallback: use all numeric/string columns if no features configured
            if not features:
                features = [c for c in baseline_df.columns if c not in {timestamp_col, prediction_col, target_col}]

            # --- Drift computation ---
            drift_results = compute_all_drift(
                baseline_df, prod_df, features,
                warn_threshold=m.psi_warn_threshold,
                crit_threshold=m.psi_crit_threshold,
            )

            for dr in drift_results:
                db.add(DriftResult(
                    run_id=run_id,
                    model_id=model_id,
                    feature_name=dr["feature_name"],
                    date=date_label,
                    psi=dr["psi"],
                    ks_stat=dr["ks_stat"],
                    ks_pvalue=dr["ks_pvalue"],
                    jsd=dr["jsd"],
                    wasserstein=dr["wasserstein"],
                    chi2_stat=dr["chi2_stat"],
                    chi2_pvalue=dr["chi2_pvalue"],
                    is_drifted=dr["is_drifted"],
                    severity=dr["severity"],
                    baseline_histogram=dr["baseline_histogram"],
                    current_histogram=dr["current_histogram"],
                ))

            # --- Quality computation ---
            quality_results = compute_all_quality(prod_df, features)
            for qr in quality_results:
                db.add(QualityResult(
                    run_id=run_id,
                    model_id=model_id,
                    feature_name=qr["feature_name"],
                    date=date_label,
                    missing_rate=qr["missing_rate"],
                    outlier_rate=qr["outlier_rate"],
                    null_count=qr["null_count"],
                    total_count=qr["total_count"],
                ))

            # --- Performance computation (if target column available) ---
            perf_data: dict = {}
            if target_col and target_col in prod_df.columns and prediction_col and prediction_col in prod_df.columns:
                if m.type in ("classification",):
                    perf_data = compute_classification(prod_df[target_col], prod_df[prediction_col])
                else:
                    perf_data = compute_regression(prod_df[target_col], prod_df[prediction_col])

            # Prediction drift PSI
            pred_psi = None
            if prediction_col and prediction_col in baseline_df.columns and prediction_col in prod_df.columns:
                psi_res = compute_psi(baseline_df[prediction_col], prod_df[prediction_col])
                pred_psi = psi_res["psi"]

            db.add(PerformanceResult(
                run_id=run_id,
                model_id=model_id,
                date=date_label,
                accuracy=perf_data.get("accuracy"),
                f1_score=perf_data.get("f1_score"),
                auc_roc=perf_data.get("auc_roc"),
                precision=perf_data.get("precision"),
                recall=perf_data.get("recall"),
                r2=perf_data.get("r2"),
                mae=perf_data.get("mae"),
                rmse=perf_data.get("rmse"),
                prediction_psi=pred_psi,
            ))

            # --- Update model summary ---
            if drift_results:
                avg_psi = sum(dr["psi"] for dr in drift_results) / len(drift_results)
                m.global_psi = round(avg_psi, 4)
                max_psi = max(dr["psi"] for dr in drift_results)
                if max_psi >= m.psi_crit_threshold:
                    m.status = "critical"
                elif max_psi >= m.psi_warn_threshold:
                    m.status = "warning"
                else:
                    m.status = "healthy"
            else:
                m.status = "healthy"

            if perf_data:
                m.global_perf = round(perf_data.get("auc_roc") or perf_data.get("r2") or 0, 4)

            if quality_results:
                avg_missing = sum(qr["missing_rate"] for qr in quality_results) / len(quality_results)
                m.dq_score = round(max(0.0, 1.0 - avg_missing), 4)

            # --- Alert evaluation ---
            await _evaluate_alerts(db, m, run_id, drift_results, date_label)

            duration = time.monotonic() - start_time
            run.status = "success"
            run.completed_at = datetime.utcnow()
            run.duration_seconds = round(duration, 2)

        except Exception as exc:
            duration = time.monotonic() - start_time
            run.status = "failed"
            run.error_message = str(exc)
            run.completed_at = datetime.utcnow()
            run.duration_seconds = round(duration, 2)

        await db.commit()
        return run_id


async def _evaluate_alerts(
    db: AsyncSession,
    model: Model,
    run_id: str,
    drift_results: list[dict],
    date_label: str,
) -> None:
    """Check drift results against thresholds and insert alerts with cooldown logic."""
    now = datetime.utcnow()

    for dr in drift_results:
        psi = dr["psi"]
        severity = None
        threshold = None

        if psi >= model.psi_crit_threshold:
            severity = "CRITICAL"
            threshold = model.psi_crit_threshold
        elif psi >= model.psi_warn_threshold:
            severity = "WARNING"
            threshold = model.psi_warn_threshold

        if not severity:
            continue

        # Check cooldown: find any open alert for same (model, feature, severity) not yet past cooldown
        existing_q = select(Alert).where(
            Alert.model_id == model.id,
            Alert.feature_name == dr["feature_name"],
            Alert.severity == severity,
            Alert.status == "open",
            Alert.cooldown_until > now,
        )
        existing = await db.execute(existing_q)
        if existing.scalar_one_or_none():
            continue  # still in cooldown

        cooldown_until = now + timedelta(hours=model.alert_cooldown_hours)
        db.add(Alert(
            model_id=model.id,
            run_id=run_id,
            severity=severity,
            metric_name="PSI",
            metric_value=psi,
            threshold=threshold,
            message=f"Feature '{dr['feature_name']}' PSI={psi:.3f} exceeds {severity.lower()} threshold {threshold:.2f}",
            feature_name=dr["feature_name"],
            cooldown_until=cooldown_until,
            notified_channels=model.alert_channels,
            status="open",
        ))
