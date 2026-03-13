"""Data quality metrics: missing rate, IQR outlier detection."""
from __future__ import annotations

import numpy as np
import pandas as pd


def compute_quality(df: pd.DataFrame, feature: str) -> dict:
    if feature not in df.columns:
        return {"missing_rate": 0.0, "outlier_rate": 0.0, "null_count": 0, "total_count": 0}

    series = df[feature]
    total = len(series)
    null_count = int(series.isna().sum())
    missing_rate = null_count / total if total > 0 else 0.0

    # IQR-based outlier detection (numeric only)
    outlier_rate = 0.0
    numeric = pd.to_numeric(series, errors="coerce").dropna()
    if len(numeric) > 0:
        q1 = float(numeric.quantile(0.25))
        q3 = float(numeric.quantile(0.75))
        iqr = q3 - q1
        if iqr > 0:
            mask = (numeric < q1 - 1.5 * iqr) | (numeric > q3 + 1.5 * iqr)
            outlier_rate = float(mask.sum()) / total

    return {
        "missing_rate": round(missing_rate, 6),
        "outlier_rate": round(outlier_rate, 6),
        "null_count": null_count,
        "total_count": total,
    }


def compute_all_quality(df: pd.DataFrame, features: list[str]) -> list[dict]:
    return [{"feature_name": feat, **compute_quality(df, feat)} for feat in features]
