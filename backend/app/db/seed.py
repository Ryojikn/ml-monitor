"""Seed demo models into the database on first startup."""
from __future__ import annotations

import math
import random
import uuid
from datetime import datetime, timedelta

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.models import Model, MonitoringRun, DriftResult, PerformanceResult, QualityResult, Alert

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

DAY = timedelta(days=1)
_rng = random.Random(42)  # deterministic seed for reproducibility


def _uid() -> str:
    return str(uuid.uuid4())


def _clamp(v: float, lo: float, hi: float) -> float:
    return max(lo, min(hi, v))


def _noise(scale: float = 0.005) -> float:
    return _rng.gauss(0, scale)


def _date_str(dt: datetime) -> str:
    return dt.strftime("%Y-%m-%d")


def _gaussian_hist(mean: float, std: float, n_bins: int = 10, n_samples: int = 1000) -> dict:
    """Generate a histogram dict with bins/counts for a Gaussian distribution."""
    lo = mean - 3 * std
    hi = mean + 3 * std
    width = (hi - lo) / n_bins
    bins = [f"{lo + i * width:.2f}–{lo + (i + 1) * width:.2f}" for i in range(n_bins)]
    counts = []
    for i in range(n_bins):
        mid = lo + (i + 0.5) * width
        z = (mid - mean) / std
        density = math.exp(-0.5 * z * z) / (std * math.sqrt(2 * math.pi))
        counts.append(max(0, round(density * width * n_samples + _rng.gauss(0, 2))))
    return {"bins": bins, "counts": counts}


def _severity(psi: float, warn: float, crit: float) -> str:
    if psi >= crit:
        return "critical"
    if psi >= warn:
        return "warning"
    return "stable"


# ---------------------------------------------------------------------------
# Demo model definitions
# ---------------------------------------------------------------------------

DEMO_MODELS = [
    {
        "name": "Fraud Detection Classifier",
        "version": "2.3.1",
        "type": "classification",
        "team": "fraud",
        "owner": "alice.chen",
        "description": "Real-time payment fraud detector trained on 18 months of transaction data. Flags suspicious transactions for manual review.",
        "status": "critical",
        "engine": "local",
        "schedule": "0 */6 * * *",
        "lookback_window": "7d",
        "psi_warn_threshold": 0.10,
        "psi_crit_threshold": 0.25,
        "alert_channels": ["slack", "pagerduty"],
        "features": ["transaction_amount", "merchant_category", "user_age", "account_age_days", "time_since_last_txn", "location_risk_score"],
        "drift_profile": "critical",
    },
    {
        "name": "Customer Churn Predictor",
        "version": "1.8.0",
        "type": "classification",
        "team": "marketing",
        "owner": "bob.martinez",
        "description": "Predicts monthly customer churn probability for the telecom subscriber base. Drives retention campaigns.",
        "status": "warning",
        "engine": "local",
        "schedule": "0 6 * * 1",
        "lookback_window": "30d",
        "psi_warn_threshold": 0.10,
        "psi_crit_threshold": 0.25,
        "alert_channels": ["slack"],
        "features": ["tenure_months", "monthly_charges", "num_products", "support_calls_30d", "payment_method_score", "contract_type_flag"],
        "drift_profile": "warning",
    },
    {
        "name": "Credit Scoring Model",
        "version": "3.1.0",
        "type": "classification",
        "team": "risk",
        "owner": "carol.zhang",
        "description": "FICO-calibrated credit scoring model for consumer loan origination. Regulatory requirement: bias monitoring every 30 days.",
        "status": "healthy",
        "engine": "local",
        "schedule": "0 8 1 * *",
        "lookback_window": "30d",
        "psi_warn_threshold": 0.08,
        "psi_crit_threshold": 0.20,
        "alert_channels": ["email"],
        "features": ["credit_history_length", "debt_to_income", "num_open_accounts", "payment_history_score", "income_level", "credit_utilization"],
        "drift_profile": "healthy",
    },
    {
        "name": "House Price Estimator",
        "version": "1.2.4",
        "type": "regression",
        "team": "real-estate",
        "owner": "dan.patel",
        "description": "Automated valuation model (AVM) for residential properties. Powers instant offer pricing in 12 metro areas.",
        "status": "warning",
        "engine": "local",
        "schedule": "0 7 * * *",
        "lookback_window": "14d",
        "psi_warn_threshold": 0.10,
        "psi_crit_threshold": 0.25,
        "alert_channels": ["slack"],
        "features": ["square_footage", "bedrooms", "bathrooms", "location_score", "property_age_years", "garage_spaces", "lot_size_sqft"],
        "drift_profile": "warning",
    },
    {
        "name": "Demand Forecast",
        "version": "4.0.2",
        "type": "regression",
        "team": "supply-chain",
        "owner": "emma.johnson",
        "description": "SKU-level demand forecasting model. Drives inventory replenishment orders for 3,200 products across 48 warehouses.",
        "status": "healthy",
        "engine": "spark",
        "schedule": "0 5 * * *",
        "lookback_window": "14d",
        "psi_warn_threshold": 0.12,
        "psi_crit_threshold": 0.28,
        "alert_channels": ["slack", "email"],
        "features": ["day_of_week", "month", "promotions_active", "competitor_price_index", "temperature_celsius", "holiday_flag"],
        "drift_profile": "healthy",
    },
    {
        "name": "Product Recommendation Ranker",
        "version": "2.0.0",
        "type": "ranking",
        "team": "recommendations",
        "owner": "frank.kim",
        "description": "Two-tower collaborative filtering ranker for homepage product recommendations. Optimised for click-through and add-to-cart.",
        "status": "healthy",
        "engine": "local",
        "schedule": "0 4 * * *",
        "lookback_window": "7d",
        "psi_warn_threshold": 0.10,
        "psi_crit_threshold": 0.25,
        "alert_channels": ["slack"],
        "features": ["user_preference_score", "item_popularity_rank", "recency_score", "category_match_score", "price_sensitivity_index"],
        "drift_profile": "healthy",
    },
    {
        "name": "Loan Default Predictor",
        "version": "1.5.2",
        "type": "classification",
        "team": "credit",
        "owner": "grace.liu",
        "description": "Predicts 12-month probability of default for personal loans. Underwriting gating model — regulatory SOX-compliant.",
        "status": "critical",
        "engine": "local",
        "schedule": "0 6 * * *",
        "lookback_window": "7d",
        "psi_warn_threshold": 0.08,
        "psi_crit_threshold": 0.20,
        "alert_channels": ["slack", "email", "pagerduty"],
        "features": ["loan_amount", "annual_income", "employment_length_years", "interest_rate", "debt_to_income_ratio", "num_delinquencies"],
        "drift_profile": "critical",
    },
    {
        "name": "Sentiment Analyzer",
        "version": "1.0.5",
        "type": "llm",
        "team": "nlp",
        "owner": "henry.wang",
        "description": "LLM-based sentiment and topic classifier for customer support tickets. Routes tickets and flags escalation risk.",
        "status": "warning",
        "engine": "local",
        "schedule": "0 */4 * * *",
        "lookback_window": "7d",
        "psi_warn_threshold": 0.12,
        "psi_crit_threshold": 0.30,
        "alert_channels": ["slack"],
        "features": ["input_token_count", "response_confidence", "topic_entropy", "sentiment_polarity", "escalation_flag_rate"],
        "drift_profile": "warning",
    },
    {
        "name": "Medical Diagnosis Classifier",
        "version": "2.2.0",
        "type": "classification",
        "team": "healthcare",
        "owner": "iris.nguyen",
        "description": "Type-2 diabetes risk stratification model. Used for preventive care outreach — FDA 510(k) cleared, monitored monthly.",
        "status": "healthy",
        "engine": "local",
        "schedule": "0 9 1 * *",
        "lookback_window": "30d",
        "psi_warn_threshold": 0.08,
        "psi_crit_threshold": 0.20,
        "alert_channels": ["email"],
        "features": ["age_years", "bmi", "blood_pressure_systolic", "cholesterol_ldl", "fasting_glucose", "hba1c_pct"],
        "drift_profile": "healthy",
    },
    {
        "name": "Customer Segmentation",
        "version": "1.1.0",
        "type": "clustering",
        "team": "analytics",
        "owner": "jack.brown",
        "description": "RFM-based clustering model that assigns customers to 8 behavioral segments. Drives personalisation and budget allocation.",
        "status": "healthy",
        "engine": "local",
        "schedule": "0 3 * * 0",
        "lookback_window": "30d",
        "psi_warn_threshold": 0.10,
        "psi_crit_threshold": 0.25,
        "alert_channels": ["slack"],
        "features": ["purchase_frequency", "avg_basket_size_usd", "category_diversity_score", "recency_days", "clv_estimate_usd"],
        "drift_profile": "healthy",
    },
]


# ---------------------------------------------------------------------------
# Drift / perf generation helpers
# ---------------------------------------------------------------------------

def _feature_drift_params(status: str, feature_idx: int, n_features: int) -> tuple[float, float]:
    """Return (base_psi, drift_rate) for a feature given model status."""
    if status == "critical":
        # Most features drift; 2 reach critical
        if feature_idx < 2:
            return 0.08, 0.020 + _noise(0.002)
        return 0.04, 0.010 + _noise(0.002)
    if status == "warning":
        if feature_idx < 2:
            return 0.06, 0.008 + _noise(0.001)
        return 0.02, 0.003 + _noise(0.001)
    # healthy / clustering / ranking
    return 0.01 + abs(_noise(0.005)), 0.0005 + abs(_noise(0.0002))


def _perf_params(model_type: str, status: str) -> tuple[float, float]:
    """Return (base_value, decline_rate) for performance metric."""
    if model_type == "regression":
        if status == "warning":
            return 0.84, 0.004
        return 0.88, 0.0005  # healthy
    # classification / ranking / llm / clustering
    if status == "critical":
        return 0.87, 0.010
    if status == "warning":
        return 0.89, 0.004
    return 0.91, 0.0005


def _quality_params(status: str) -> tuple[float, float]:
    """Return (base_missing_rate, base_outlier_rate)."""
    if status == "critical":
        return 0.08, 0.05
    if status == "warning":
        return 0.03, 0.02
    return 0.005, 0.008


# ---------------------------------------------------------------------------
# Main seed function
# ---------------------------------------------------------------------------

async def seed_demo_models(db: AsyncSession) -> None:
    """Create 10 demo models with realistic run history. Idempotent."""
    existing = await db.execute(select(Model).where(Model.is_demo == True).limit(1))  # noqa: E712
    if existing.scalar_one_or_none() is not None:
        return  # already seeded

    now = datetime.utcnow()
    n_runs = 15

    for demo_def in DEMO_MODELS:
        features: list[str] = demo_def["features"]
        drift_profile: str = demo_def["drift_profile"]
        status: str = demo_def["status"]
        model_type: str = demo_def["type"]

        column_mapping = {
            "features": features,
            "prediction_col": "prediction",
            "target_col": "label" if model_type != "regression" else "target_value",
            "timestamp_col": "event_timestamp",
            "score_col": "prediction_score" if model_type != "regression" else None,
            "segment_cols": [],
        }

        m = Model(
            id=_uid(),
            name=demo_def["name"],
            version=demo_def["version"],
            type=model_type,
            team=demo_def["team"],
            owner=demo_def["owner"],
            description=demo_def["description"],
            tags=["demo"],
            status=status,
            engine=demo_def["engine"],
            schedule=demo_def["schedule"],
            lookback_window=demo_def["lookback_window"],
            comparison_strategy="baseline_vs_current",
            column_mapping=column_mapping,
            psi_warn_threshold=demo_def["psi_warn_threshold"],
            psi_crit_threshold=demo_def["psi_crit_threshold"],
            alert_cooldown_hours=6,
            alert_channels=demo_def["alert_channels"],
            is_demo=True,
            created_at=now - timedelta(days=n_runs * 2 + 5),
        )

        perf_base, perf_decline = _perf_params(model_type, status)
        q_missing_base, q_outlier_base = _quality_params(status)
        last_run_id: str | None = None

        for run_idx in range(n_runs):
            run_date = now - timedelta(days=(n_runs - run_idx - 1) * 2)
            date_str = _date_str(run_date)
            run_id = _uid()
            last_run_id = run_id

            run = MonitoringRun(
                id=run_id,
                model_id=m.id,
                triggered_at=run_date,
                completed_at=run_date + timedelta(minutes=_rng.randint(2, 8)),
                status="success",
                engine=demo_def["engine"],
                duration_seconds=round(_rng.uniform(45, 240), 1),
                window_start=_date_str(run_date - timedelta(days=int(demo_def["lookback_window"][:-1]))),
                window_end=date_str,
            )

            # --- Drift results ---
            feature_psis: list[float] = []
            for f_idx, feature in enumerate(features):
                base_psi, drift_rate = _feature_drift_params(drift_profile, f_idx, len(features))
                psi = _clamp(base_psi + drift_rate * run_idx + abs(_noise(0.005)), 0.0, 0.6)
                feature_psis.append(psi)

                ks_stat = _clamp(psi * 0.6 + abs(_noise(0.02)), 0.0, 0.8)
                jsd = _clamp(psi * 0.4 + abs(_noise(0.01)), 0.0, 0.5)
                wass = _clamp(psi * 8.0 + abs(_noise(0.3)), 0.0, 8.0)
                ks_pv = _clamp(1.0 - ks_stat + _noise(0.05), 0.001, 1.0)
                sev = _severity(psi, demo_def["psi_warn_threshold"], demo_def["psi_crit_threshold"])

                # Histograms: baseline gaussian, current shifted proportional to PSI
                b_mean, b_std = 50.0 + f_idx * 10, 12.0 + f_idx * 2
                shift = psi * 30
                baseline_hist = _gaussian_hist(b_mean, b_std)
                current_hist = _gaussian_hist(b_mean + shift, b_std * (1 + psi * 0.5))

                db.add(DriftResult(
                    id=_uid(),
                    run_id=run_id,
                    model_id=m.id,
                    feature_name=feature,
                    date=date_str,
                    psi=round(psi, 4),
                    ks_stat=round(ks_stat, 4),
                    ks_pvalue=round(ks_pv, 4),
                    jsd=round(jsd, 4),
                    wasserstein=round(wass, 4),
                    is_drifted=sev != "stable",
                    severity=sev,
                    baseline_histogram=baseline_hist,
                    current_histogram=current_hist,
                ))

            # --- Performance result ---
            perf_val = _clamp(perf_base - perf_decline * run_idx + _noise(0.008), 0.5, 1.0)
            pred_psi = _clamp(sum(feature_psis) / len(feature_psis) * 0.8 + _noise(0.01), 0.0, 0.5)

            pr = PerformanceResult(
                id=_uid(),
                run_id=run_id,
                model_id=m.id,
                date=date_str,
                prediction_psi=round(pred_psi, 4),
            )
            if model_type == "regression":
                pr.r2 = round(perf_val, 4)
                pr.mae = round(max(0, 12.0 + (1 - perf_val) * 30 + _noise(0.5)), 2)
                pr.rmse = round(pr.mae * 1.4, 2)
            else:
                pr.auc_roc = round(perf_val, 4)
                pr.accuracy = round(_clamp(perf_val - 0.03 + _noise(0.01), 0.5, 1.0), 4)
                pr.f1_score = round(_clamp(perf_val - 0.02 + _noise(0.01), 0.5, 1.0), 4)
                pr.precision = round(_clamp(perf_val + 0.01 + _noise(0.01), 0.5, 1.0), 4)
                pr.recall = round(_clamp(perf_val - 0.04 + _noise(0.01), 0.5, 1.0), 4)
            db.add(pr)

            # --- Quality results ---
            for f_idx, feature in enumerate(features):
                miss = _clamp(q_missing_base * (1 + 0.05 * run_idx) + abs(_noise(0.005)) + f_idx * 0.002, 0.0, 0.4)
                out = _clamp(q_outlier_base + abs(_noise(0.003)) + f_idx * 0.001, 0.0, 0.3)
                db.add(QualityResult(
                    id=_uid(),
                    run_id=run_id,
                    model_id=m.id,
                    feature_name=feature,
                    date=date_str,
                    missing_rate=round(miss, 4),
                    outlier_rate=round(out, 4),
                    null_count=round(miss * 10000),
                    total_count=10000,
                ))

            db.add(run)

        # --- Alerts for critical / warning models ---
        if status in ("critical", "warning"):
            n_alerts = 5 if status == "critical" else 3
            alert_statuses = ["open", "open", "acknowledged", "resolved", "resolved"]
            for a_idx in range(n_alerts):
                drifted_feature = features[a_idx % len(features)]
                sev = "critical" if (status == "critical" and a_idx < 2) else "warning"
                a_psi = _clamp(0.30 + _noise(0.05) if sev == "critical" else 0.14 + _noise(0.02), 0.05, 0.6)
                threshold = demo_def["psi_crit_threshold"] if sev == "critical" else demo_def["psi_warn_threshold"]
                db.add(Alert(
                    id=_uid(),
                    model_id=m.id,
                    run_id=last_run_id,
                    severity=sev,
                    metric_name="psi",
                    metric_value=round(a_psi, 4),
                    threshold=threshold,
                    message=f"{drifted_feature} PSI of {a_psi:.3f} exceeds the {sev} threshold ({threshold}).",
                    status=alert_statuses[a_idx % len(alert_statuses)],
                    feature_name=drifted_feature,
                    notified_channels=demo_def["alert_channels"],
                    created_at=now - timedelta(days=_rng.randint(0, 10)),
                ))

        # --- Update model aggregate stats from last run ---
        last_feat_psis = []
        for f_idx in range(len(features)):
            base_psi, drift_rate = _feature_drift_params(drift_profile, f_idx, len(features))
            last_feat_psis.append(_clamp(base_psi + drift_rate * (n_runs - 1), 0.0, 0.6))
        m.global_psi = round(sum(last_feat_psis) / len(last_feat_psis), 4)

        final_perf = _clamp(perf_base - perf_decline * (n_runs - 1), 0.5, 1.0)
        m.global_perf = round(final_perf, 4)

        q_miss_last = _clamp(q_missing_base * (1 + 0.05 * (n_runs - 1)), 0.0, 0.4)
        m.dq_score = round(_clamp(1.0 - q_miss_last * 2, 0.5, 1.0), 4)

        db.add(m)

    await db.commit()
