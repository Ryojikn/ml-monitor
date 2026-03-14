"""
Orchestrates a full monitoring run for a given model.
Called by the run trigger endpoint and the APScheduler.
"""
from __future__ import annotations

import time
from datetime import datetime, timedelta
from pathlib import Path

import pandas as pd
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.db.models import (
    Model, Dataset, MonitoringRun, DriftResult,
    PerformanceResult, QualityResult, Alert, StorageConnection,
)
from app.db.session import AsyncSessionLocal
from app.engine.drift import compute_all_drift, compute_psi
from app.engine.quality import compute_all_quality
from app.engine.performance import compute_classification, compute_regression
from app.engine.loaders import load_dataframe


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


async def _load_data_for_model(
    m: Model,
    db: AsyncSession,
) -> tuple[pd.DataFrame, pd.DataFrame, str, str]:
    """
    Load baseline and inference DataFrames for a model.

    Returns (baseline_df, inference_df, window_start, window_end).

    Strategy:
    1. If reference_dataset_config / inference_dataset_config are set and
       source_type != 'upload', load from the configured remote source.
    2. Otherwise fall back to the Dataset table (uploaded CSV files).
    """
    ref_cfg: dict | None = m.reference_dataset_config
    inf_cfg: dict | None = m.inference_dataset_config
    cm = m.column_mapping or {}
    timestamp_col: str = cm.get("timestamp_col", "")
    lookback = m.lookback_window or "7d"

    # ── connection-based loading ──────────────────────────────────────────────
    if (
        ref_cfg and ref_cfg.get("source_type", "upload") != "upload"
        and inf_cfg and inf_cfg.get("source_type", "upload") != "upload"
    ):
        # Fetch connection configs (may be None if connection_id is null)
        ref_conn_config: dict = {}
        inf_conn_config: dict = {}

        if ref_cfg.get("connection_id"):
            r = await db.execute(
                select(StorageConnection).where(StorageConnection.id == ref_cfg["connection_id"])
            )
            conn = r.scalar_one_or_none()
            if conn:
                ref_conn_config = conn.config or {}

        if inf_cfg.get("connection_id"):
            r = await db.execute(
                select(StorageConnection).where(StorageConnection.id == inf_cfg["connection_id"])
            )
            conn = r.scalar_one_or_none()
            if conn:
                inf_conn_config = conn.config or {}

        # Time filter for inference data
        now = datetime.utcnow()
        window_start_dt = now - _parse_lookback(lookback)
        time_filter = {"col": timestamp_col, "start": window_start_dt, "end": now} if timestamp_col else None

        baseline_df = await load_dataframe(ref_cfg, ref_conn_config)
        inference_df = await load_dataframe(inf_cfg, inf_conn_config, time_filter=time_filter)

        window_start = str(window_start_dt.date()) if time_filter else ""
        window_end = str(now.date())
        return baseline_df, inference_df, window_start, window_end

    # ── CSV upload fallback ───────────────────────────────────────────────────
    ds_result = await db.execute(
        select(Dataset)
        .where(Dataset.model_id == m.id)
        .order_by(Dataset.uploaded_at.desc())
    )
    datasets = ds_result.scalars().all()

    baseline_ds = next((d for d in datasets if d.role == "baseline"), None)
    prod_ds = next((d for d in datasets if d.role == "production"), None)

    if not baseline_ds or not prod_ds:
        raise ValueError(
            "Missing baseline or production dataset. "
            "Upload both before triggering a run, or configure connection-based data sources."
        )

    baseline_df = _load_csv(baseline_ds.file_path)
    prod_df = _load_csv(prod_ds.file_path)
    prod_df, window_start, window_end = _apply_lookback(prod_df, timestamp_col, lookback)
    return baseline_df, prod_df, window_start, window_end


async def run_monitoring(model_id: str) -> str:
    """
    Execute a monitoring run. Returns run_id (empty string if skipped).
    Called by the run trigger endpoint and the APScheduler.
    """
    async with AsyncSessionLocal() as db:
        # Load model
        result = await db.execute(select(Model).where(Model.id == model_id))
        m = result.scalar_one_or_none()
        if not m:
            return ""

        # ── Idempotency guard: skip if a run is already in progress ──────────
        running_q = select(MonitoringRun).where(
            MonitoringRun.model_id == model_id,
            MonitoringRun.status == "running",
        ).limit(1)
        if (await db.execute(running_q)).scalar_one_or_none():
            return ""   # already running — scheduler or manual trigger overlap

        # Create run record
        run = MonitoringRun(model_id=model_id, status="running", engine=m.engine)
        db.add(run)
        await db.commit()
        await db.refresh(run)
        run_id = run.id

        start_time = time.monotonic()

        try:
            # ── Load data ────────────────────────────────────────────────────
            baseline_df, prod_df, window_start, window_end = await _load_data_for_model(m, db)

            run.window_start = window_start
            run.window_end = window_end
            date_label = window_end or str(datetime.utcnow().date())

            # ── Column mapping ───────────────────────────────────────────────
            cm = m.column_mapping or {}
            timestamp_col: str = cm.get("timestamp_col", "")
            features: list[str] = cm.get("features", [])
            prediction_col: str = cm.get("prediction_col", "")
            score_col: str = cm.get("score_col", "")
            target_col: str = cm.get("target_col", "")

            # Fallback: use all non-special columns as features
            if not features:
                features = [
                    c for c in baseline_df.columns
                    if c not in {timestamp_col, prediction_col, score_col, target_col}
                ]

            # ── Drift ────────────────────────────────────────────────────────
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

            # ── Data quality ─────────────────────────────────────────────────
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

            # ── Performance ──────────────────────────────────────────────────
            perf_data: dict = {}
            if target_col and target_col in prod_df.columns and prediction_col and prediction_col in prod_df.columns:
                if m.type == "classification":
                    y_score = (
                        prod_df[score_col]
                        if score_col and score_col in prod_df.columns
                        else None
                    )
                    perf_data = compute_classification(
                        prod_df[target_col],
                        prod_df[prediction_col],
                        y_score=y_score,
                    )
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

            # ── Model summary ────────────────────────────────────────────────
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

            # ── Alerts ───────────────────────────────────────────────────────
            new_alerts = await _evaluate_alerts(
                db, m, run_id, drift_results, quality_results, perf_data, date_label
            )

            # ── Model status — worst of drift / quality / perf ────────────────
            severities = {a.severity for a in new_alerts}
            if "CRITICAL" in severities and m.status != "critical":
                m.status = "critical"
            elif "WARNING" in severities and m.status == "healthy":
                m.status = "warning"

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
            new_alerts = []

        await db.commit()

        # Dispatch notifications after commit so alert IDs are assigned
        if new_alerts:
            from app.alerts.dispatcher import dispatch_alert_notifications
            await dispatch_alert_notifications(db, new_alerts)

        return run_id


async def _maybe_add_alert(
    db: AsyncSession,
    new_alerts: list[Alert],
    *,
    model: Model,
    run_id: str,
    severity: str,
    metric_name: str,
    metric_value: float,
    threshold: float,
    message: str,
    feature_name: str | None,
    now: datetime,
) -> None:
    """Insert an alert if not in cooldown, appending to new_alerts."""
    cooldown_q = select(Alert).where(
        Alert.model_id == model.id,
        Alert.metric_name == metric_name,
        Alert.feature_name == feature_name,
        Alert.severity == severity,
        Alert.status == "open",
        Alert.cooldown_until > now,
    )
    if (await db.execute(cooldown_q)).scalar_one_or_none():
        return

    alert = Alert(
        model_id=model.id,
        run_id=run_id,
        severity=severity,
        metric_name=metric_name,
        metric_value=metric_value,
        threshold=threshold,
        message=message,
        feature_name=feature_name,
        cooldown_until=now + timedelta(hours=model.alert_cooldown_hours),
        notified_channels=model.alert_channels,
        status="open",
    )
    db.add(alert)
    new_alerts.append(alert)


async def _evaluate_alerts(
    db: AsyncSession,
    model: Model,
    run_id: str,
    drift_results: list[dict],
    quality_results: list[dict],
    perf_data: dict,
    date_label: str,
) -> list[Alert]:
    """
    Evaluate drift, quality, and performance results against thresholds.
    Returns newly created Alert objects (before commit).
    """
    now = datetime.utcnow()
    new_alerts: list[Alert] = []

    # ── Feature Drift (PSI) ───────────────────────────────────────────────────
    for dr in drift_results:
        psi = dr["psi"]
        if psi >= model.psi_crit_threshold:
            severity, threshold = "CRITICAL", model.psi_crit_threshold
        elif psi >= model.psi_warn_threshold:
            severity, threshold = "WARNING", model.psi_warn_threshold
        else:
            continue

        await _maybe_add_alert(
            db, new_alerts,
            model=model, run_id=run_id,
            severity=severity,
            metric_name="psi",
            metric_value=psi,
            threshold=threshold,
            message=f"Feature '{dr['feature_name']}' PSI={psi:.3f} exceeds {severity.lower()} threshold {threshold:.2f}",
            feature_name=dr["feature_name"],
            now=now,
        )

    # ── Data Quality ──────────────────────────────────────────────────────────
    # Thresholds: missing_rate WARN>=15%, CRIT>=30%  |  outlier_rate WARN>=10%, CRIT>=20%
    MISSING_WARN, MISSING_CRIT = 0.15, 0.30
    OUTLIER_WARN, OUTLIER_CRIT = 0.10, 0.20

    for qr in quality_results:
        feat = qr["feature_name"]

        miss = qr.get("missing_rate", 0.0)
        if miss >= MISSING_CRIT:
            sev = "CRITICAL"
        elif miss >= MISSING_WARN:
            sev = "WARNING"
        else:
            sev = None

        if sev:
            thr = MISSING_CRIT if sev == "CRITICAL" else MISSING_WARN
            await _maybe_add_alert(
                db, new_alerts,
                model=model, run_id=run_id,
                severity=sev,
                metric_name="missing_rate",
                metric_value=round(miss, 4),
                threshold=thr,
                message=f"Feature '{feat}' missing rate {miss:.1%} exceeds {sev.lower()} threshold {thr:.0%}",
                feature_name=feat,
                now=now,
            )

        out = qr.get("outlier_rate", 0.0)
        if out >= OUTLIER_CRIT:
            sev = "CRITICAL"
        elif out >= OUTLIER_WARN:
            sev = "WARNING"
        else:
            sev = None

        if sev:
            thr = OUTLIER_CRIT if sev == "CRITICAL" else OUTLIER_WARN
            await _maybe_add_alert(
                db, new_alerts,
                model=model, run_id=run_id,
                severity=sev,
                metric_name="outlier_rate",
                metric_value=round(out, 4),
                threshold=thr,
                message=f"Feature '{feat}' outlier rate {out:.1%} exceeds {sev.lower()} threshold {thr:.0%}",
                feature_name=feat,
                now=now,
            )

    # ── Performance ───────────────────────────────────────────────────────────
    # For "higher is better" metrics: AUC, R², Accuracy, F1, Precision, Recall
    # WARN if below warn_threshold, CRIT if below crit_threshold.
    # Thresholds are sensible defaults; could be made per-model in the future.
    PERF_THRESHOLDS: dict[str, tuple[float, float]] = {
        # metric: (crit_below, warn_below)
        "auc_roc":   (0.70, 0.80),
        "r2":        (0.50, 0.70),
        "accuracy":  (0.70, 0.80),
        "f1_score":  (0.65, 0.78),
        "precision": (0.60, 0.75),
        "recall":    (0.60, 0.75),
    }
    # "lower is better" metrics — WARN if above warn_threshold, CRIT if above crit_threshold
    PERF_THRESHOLDS_HIGH: dict[str, tuple[float, float]] = {
        # metric: (warn_above, crit_above)  — relative values, only fire if non-zero
        "mae":  (0.20, 0.40),
        "rmse": (0.25, 0.50),
    }

    for metric, (crit_below, warn_below) in PERF_THRESHOLDS.items():
        val = perf_data.get(metric)
        if val is None:
            continue
        if val < crit_below:
            sev, thr = "CRITICAL", crit_below
        elif val < warn_below:
            sev, thr = "WARNING", warn_below
        else:
            continue

        await _maybe_add_alert(
            db, new_alerts,
            model=model, run_id=run_id,
            severity=sev,
            metric_name=metric,
            metric_value=round(val, 4),
            threshold=thr,
            message=f"{metric.upper()} {val:.3f} is below {sev.lower()} threshold {thr:.2f}",
            feature_name=None,
            now=now,
        )

    for metric, (warn_above, crit_above) in PERF_THRESHOLDS_HIGH.items():
        val = perf_data.get(metric)
        if val is None or val == 0:
            continue
        if val >= crit_above:
            sev, thr = "CRITICAL", crit_above
        elif val >= warn_above:
            sev, thr = "WARNING", warn_above
        else:
            continue

        await _maybe_add_alert(
            db, new_alerts,
            model=model, run_id=run_id,
            severity=sev,
            metric_name=metric,
            metric_value=round(val, 4),
            threshold=thr,
            message=f"{metric.upper()} {val:.3f} exceeds {sev.lower()} threshold {thr:.2f}",
            feature_name=None,
            now=now,
        )

    return new_alerts
