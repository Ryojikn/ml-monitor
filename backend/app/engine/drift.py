"""
Drift computation: PSI, KS, JSD, Wasserstein, Chi-Square.
All functions are pure — they accept pandas Series and return dicts.
"""
from __future__ import annotations

import numpy as np
import pandas as pd
from scipy import stats
from scipy.spatial.distance import jensenshannon


_EPS = 1e-6


def _is_categorical(series: pd.Series) -> bool:
    return series.dtype == object or str(series.dtype) == "category" or series.nunique() <= 10


def _make_bins(baseline: pd.Series, n_bins: int = 10) -> np.ndarray:
    """Quantile-based bin edges from baseline."""
    quantiles = np.linspace(0, 100, n_bins + 1)
    edges = np.percentile(baseline.dropna(), quantiles)
    edges[0] = -np.inf
    edges[-1] = np.inf
    return edges


def compute_psi(baseline: pd.Series, current: pd.Series, n_bins: int = 10) -> dict:
    """Population Stability Index."""
    baseline = baseline.dropna()
    current = current.dropna()

    if len(baseline) == 0 or len(current) == 0:
        return {"psi": 0.0, "bins": [], "baseline_counts": [], "current_counts": []}

    if _is_categorical(baseline):
        categories = list(set(baseline.unique()) | set(current.unique()))
        b_counts = np.array([np.sum(baseline == c) for c in categories], dtype=float)
        c_counts = np.array([np.sum(current == c) for c in categories], dtype=float)
        bins = categories
    else:
        edges = _make_bins(baseline, n_bins)
        b_counts, _ = np.histogram(baseline, bins=edges)
        c_counts, _ = np.histogram(current, bins=edges)
        bins = [f"{edges[i]:.2f}–{edges[i+1]:.2f}" for i in range(len(edges) - 1)]

    b_pct = b_counts / len(baseline) + _EPS
    c_pct = c_counts / len(current) + _EPS
    psi = float(np.sum((c_pct - b_pct) * np.log(c_pct / b_pct)))

    return {
        "psi": round(psi, 6),
        "bins": bins,
        "baseline_counts": b_counts.tolist(),
        "current_counts": c_counts.tolist(),
    }


def compute_ks(baseline: pd.Series, current: pd.Series) -> dict:
    """Kolmogorov-Smirnov test (numeric only)."""
    baseline = baseline.dropna()
    current = current.dropna()

    if len(baseline) == 0 or len(current) == 0 or _is_categorical(baseline):
        return {"ks_stat": 0.0, "ks_pvalue": 1.0}

    stat, pvalue = stats.ks_2samp(baseline.values, current.values)
    return {"ks_stat": round(float(stat), 6), "ks_pvalue": round(float(pvalue), 6)}


def compute_jsd(baseline: pd.Series, current: pd.Series, n_bins: int = 10) -> float:
    """Jensen-Shannon Divergence."""
    baseline = baseline.dropna()
    current = current.dropna()

    if len(baseline) == 0 or len(current) == 0:
        return 0.0

    if _is_categorical(baseline):
        categories = list(set(baseline.unique()) | set(current.unique()))
        b_counts = np.array([np.sum(baseline == c) for c in categories], dtype=float)
        c_counts = np.array([np.sum(current == c) for c in categories], dtype=float)
    else:
        edges = _make_bins(baseline, n_bins)
        b_counts, _ = np.histogram(baseline, bins=edges)
        c_counts, _ = np.histogram(current, bins=edges)

    b_pct = b_counts / (b_counts.sum() + _EPS)
    c_pct = c_counts / (c_counts.sum() + _EPS)

    # jensenshannon returns distance; square for divergence
    return round(float(jensenshannon(b_pct, c_pct) ** 2), 6)


def compute_wasserstein(baseline: pd.Series, current: pd.Series) -> float:
    """Wasserstein / Earth Mover's Distance (numeric only)."""
    baseline = baseline.dropna()
    current = current.dropna()

    if len(baseline) == 0 or len(current) == 0 or _is_categorical(baseline):
        return 0.0

    wd = stats.wasserstein_distance(baseline.values, current.values)
    std = float(baseline.std()) if float(baseline.std()) > 0 else 1.0
    return round(float(wd) / std, 6)  # normalize by baseline std


def compute_chi2(baseline: pd.Series, current: pd.Series) -> dict:
    """Chi-Square test (categorical columns)."""
    baseline = baseline.dropna()
    current = current.dropna()

    if not _is_categorical(baseline) or len(baseline) == 0 or len(current) == 0:
        return {"chi2_stat": None, "chi2_pvalue": None}

    categories = list(set(baseline.unique()) | set(current.unique()))
    b_counts = np.array([np.sum(baseline == c) for c in categories], dtype=float)
    c_counts = np.array([np.sum(current == c) for c in categories], dtype=float)

    # Avoid zero-frequency rows
    mask = (b_counts > 0) | (c_counts > 0)
    table = np.vstack([b_counts[mask], c_counts[mask]])

    try:
        chi2, pvalue, _, _ = stats.chi2_contingency(table)
        return {"chi2_stat": round(float(chi2), 6), "chi2_pvalue": round(float(pvalue), 6)}
    except Exception:
        return {"chi2_stat": None, "chi2_pvalue": None}


def compute_all_drift(
    baseline_df: pd.DataFrame,
    current_df: pd.DataFrame,
    features: list[str],
    warn_threshold: float = 0.10,
    crit_threshold: float = 0.25,
) -> list[dict]:
    """Compute all drift metrics for each feature. Returns list of result dicts."""
    results = []

    for feat in features:
        if feat not in baseline_df.columns or feat not in current_df.columns:
            continue

        base_s = baseline_df[feat]
        curr_s = current_df[feat]

        psi_result = compute_psi(base_s, curr_s)
        ks_result = compute_ks(base_s, curr_s)
        jsd = compute_jsd(base_s, curr_s)
        wd = compute_wasserstein(base_s, curr_s)
        chi2_result = compute_chi2(base_s, curr_s)

        psi = psi_result["psi"]
        if psi >= crit_threshold:
            severity = "critical"
        elif psi >= warn_threshold:
            severity = "warning"
        else:
            severity = "stable"

        results.append({
            "feature_name": feat,
            "psi": psi,
            "ks_stat": ks_result["ks_stat"],
            "ks_pvalue": ks_result["ks_pvalue"],
            "jsd": jsd,
            "wasserstein": wd,
            "chi2_stat": chi2_result["chi2_stat"],
            "chi2_pvalue": chi2_result["chi2_pvalue"],
            "is_drifted": psi >= warn_threshold,
            "severity": severity,
            "baseline_histogram": {
                "bins": psi_result["bins"],
                "counts": psi_result["baseline_counts"],
            },
            "current_histogram": {
                "bins": psi_result["bins"],
                "counts": psi_result["current_counts"],
            },
        })

    return results
