# Dataset Schema & Monitoring Pipeline

This document covers the mandatory dataset schemas, the step-by-step computation pipeline, and the final output tables that power each monitoring view in MLMonitor.

---

## Table of Contents

1. [Dataset Schemas](#1-dataset-schemas)
   - [Reference Dataset (Baseline)](#11-reference-dataset-baseline)
   - [Inference Dataset (Production / Continuous)](#12-inference-dataset-production--continuous)
   - [Column Mapping Configuration](#13-column-mapping-configuration)
   - [Schema Validation Rules](#14-schema-validation-rules)
2. [Monitoring Pipeline — Step by Step](#2-monitoring-pipeline--step-by-step)
   - [Step 1: Load Model Configuration](#step-1-load-model-configuration)
   - [Step 2: Load Datasets](#step-2-load-datasets)
   - [Step 3: Apply Lookback Window](#step-3-apply-lookback-window)
   - [Step 4: Compute Feature Drift](#step-4-compute-feature-drift)
   - [Step 5: Compute Prediction Drift](#step-5-compute-prediction-drift)
   - [Step 6: Compute Data Quality](#step-6-compute-data-quality)
   - [Step 7: Compute Performance Metrics](#step-7-compute-performance-metrics)
   - [Step 8: Evaluate Alerts](#step-8-evaluate-alerts)
   - [Step 9: Update Model Summary](#step-9-update-model-summary)
   - [Step 10: Record the Run](#step-10-record-the-run)
3. [Output Tables by View](#3-output-tables-by-view)
   - [Drift Analysis View](#31-drift-analysis-view--driftresult)
   - [Feature Detail View](#32-feature-detail-view--driftresult--histograms)
   - [Performance Monitor View](#33-performance-monitor-view--performanceresult)
   - [Data Quality View](#34-data-quality-view--qualityresult)

---

## 1. Dataset Schemas

MLMonitor compares two datasets on every monitoring run: a stable **reference (baseline)** snapshot and a continuously-updated **inference (production)** stream. Both are registered against a `Model` record and stored as `Dataset` entries with a `role` field of `"baseline"` or `"production"`.

### 1.1 Reference Dataset (Baseline)

The reference dataset represents the distribution of data the model was trained or validated on. It is **static** — re-uploaded only when a new model version is deployed.

#### Mandatory Columns

| Column | Source | Type | Notes |
|--------|--------|------|-------|
| Each feature in `column_mapping.features` | `column_mapping` | numeric or categorical | All declared features must be present |
| `prediction_col` value | `column_mapping.prediction_col` | numeric or categorical | The model's output column |

#### Optional Columns

| Column | Source | Type | When Required |
|--------|--------|------|--------------|
| `target_col` value | `column_mapping.target_col` | numeric or categorical | **Required** if performance metrics are needed on baseline |
| `timestamp_col` value | `column_mapping.timestamp_col` | ISO 8601 datetime string | Only needed if you want to filter baseline by a window |
| Any `segment_cols` | `column_mapping.segment_cols` | any | Reserved for segment-level drift analysis |

#### Example Minimal Reference CSV

```csv
age,income,credit_score,loan_amount,prediction
34,52000,720,15000,0
45,80000,680,25000,1
28,35000,610,8000,0
...
```

#### Example Full Reference CSV (with target + timestamp)

```csv
event_timestamp,age,income,credit_score,loan_amount,prediction,target
2024-01-01T00:00:00Z,34,52000,720,15000,0,0
2024-01-01T00:01:00Z,45,80000,680,25000,1,1
2024-01-01T00:02:00Z,28,35000,610,8000,0,1
...
```

---

### 1.2 Inference Dataset (Production / Continuous)

The production dataset is the live inference log — rows appended as the model scores new observations. It is compared against the reference on every scheduled or triggered run.

#### Mandatory Columns

| Column | Source | Type | Notes |
|--------|--------|------|-------|
| Each feature in `column_mapping.features` | `column_mapping` | same types as baseline | Must match baseline column names exactly |
| `prediction_col` value | `column_mapping.prediction_col` | numeric or categorical | Model output for each live inference |
| `timestamp_col` value | `column_mapping.timestamp_col` | ISO 8601 datetime string | **Required** — used for lookback window filtering |

#### Optional Columns

| Column | Source | Type | When Required |
|--------|--------|------|--------------|
| `target_col` value | `column_mapping.target_col` | numeric or categorical | **Required** for live performance evaluation (ground truth must be available) |
| Any `segment_cols` | `column_mapping.segment_cols` | any | Reserved for segment-level analysis |

#### Example Production CSV

```csv
event_timestamp,age,income,credit_score,loan_amount,prediction,target
2024-08-01T09:12:00Z,31,48000,695,12000,0,0
2024-08-01T09:15:00Z,55,110000,750,40000,1,1
2024-08-01T09:18:00Z,22,28000,580,5000,1,0
...
```

> **Note**: `target` is only required if you want performance metrics computed at monitoring time. If ground truth labels arrive delayed, upload an updated production CSV or use the scheduled backfill pattern.

---

### 1.3 Column Mapping Configuration

The `column_mapping` field on the `Model` record declares which CSV columns play which roles. This is set during the Onboarding Wizard (Step 4) or via `PUT /api/v1/models/{id}`.

```json
{
  "features": ["age", "income", "credit_score", "loan_amount"],
  "prediction_col": "prediction",
  "target_col": "target",
  "timestamp_col": "event_timestamp",
  "segment_cols": []
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `features` | `list[str]` | Yes | Feature columns to monitor for drift and quality |
| `prediction_col` | `str` | Yes | Model output column (class label or regression score) |
| `target_col` | `str` | No | Ground truth label column; required for performance metrics |
| `timestamp_col` | `str` | No* | Datetime column for lookback filtering; required on production dataset |
| `segment_cols` | `list[str]` | No | Columns used for segment-level drill-down |

---

### 1.4 Schema Validation Rules

The engine applies the following checks before computation begins:

| Rule | Details |
|------|---------|
| **Column presence** | Every column in `features`, `prediction_col`, and (if declared) `target_col` / `timestamp_col` must exist in both CSV headers |
| **Type detection — numeric** | Column dtype is `int` or `float`, OR `nunique() > 10` for an object column |
| **Type detection — categorical** | Column dtype is `object`/`string`, OR `nunique() <= 10` for a numeric column |
| **Epsilon floor** | During PSI computation, bin fractions below `1e-6` are clamped to prevent `log(0)` |
| **Timestamp parsing** | `timestamp_col` values are parsed with `pd.to_datetime(..., utc=True)` |
| **Minimum rows** | An empty production window (after lookback filter) skips metric computation and records a `"success"` run with zero results |

---

## 2. Monitoring Pipeline — Step by Step

Every run executes `run_monitoring(model_id)` in [backend/app/engine/runner.py](../backend/app/engine/runner.py). The steps below trace the full execution path.

```
Model DB record
      │
      ▼
 Load Datasets  ──────────────────────────────────────────────────────────┐
      │                                                                    │
      ▼                                                                    │
Apply Lookback Window (production only)                                    │
      │                                                                    │
      ├──► Compute Feature Drift (drift.py)                                │
      │         PSI · KS · JSD · Wasserstein · Chi²                       │
      │                                                                    │
      ├──► Compute Prediction Drift (drift.py, prediction_col)             │
      │                                                                    │
      ├──► Compute Data Quality (quality.py)                               │
      │         missing_rate · outlier_rate · null_count                   │
      │                                                                    │
      ├──► Compute Performance (performance.py, if target_col present)     │
      │         accuracy · F1 · AUC-ROC  OR  MAE · RMSE · R²              │
      │                                                                    │
      ├──► Evaluate Alerts → write Alert records                           │
      │                                                                    │
      ├──► Update Model summary (global_psi · global_perf · dq_score)     │
      │                                                                    │
      └──► Write MonitoringRun record (status · duration · window)
```

---

### Step 1: Load Model Configuration

```python
model = await session.get(Model, model_id)
column_mapping = model.column_mapping  # dict parsed from JSON column
features        = column_mapping.get("features", [])
prediction_col  = column_mapping.get("prediction_col", "")
target_col      = column_mapping.get("target_col", "")
timestamp_col   = column_mapping.get("timestamp_col", "")
```

Also reads: `lookback_window`, `psi_warn_threshold`, `psi_crit_threshold`, `alert_cooldown_hours`, `alert_channels`, `engine`.

---

### Step 2: Load Datasets

```python
baseline_ds   = # Dataset WHERE model_id=X AND role='baseline'  (latest)
production_ds = # Dataset WHERE model_id=X AND role='production' (latest)

df_ref  = pd.read_csv(baseline_ds.file_path)
df_prod = pd.read_csv(production_ds.file_path)
```

Both DataFrames are loaded in full at this point. No filtering is applied yet.

---

### Step 3: Apply Lookback Window

The production DataFrame is trimmed to only the rows within the configured `lookback_window` relative to the run's `now` timestamp.

```python
def _parse_lookback(window: str) -> timedelta:
    # Supports: "1h", "7d", "30d", "1w", etc.
    unit  = window[-1]          # 'h' | 'd' | 'w'
    value = int(window[:-1])
    if unit == 'h': return timedelta(hours=value)
    if unit == 'd': return timedelta(days=value)
    if unit == 'w': return timedelta(weeks=value)

cutoff = datetime.utcnow() - _parse_lookback(model.lookback_window)
df_prod[timestamp_col] = pd.to_datetime(df_prod[timestamp_col], utc=True)
df_prod = df_prod[df_prod[timestamp_col] >= cutoff]
```

The resulting `window_start` and `window_end` are stored on the `MonitoringRun` record.

---

### Step 4: Compute Feature Drift

Executed for **every column** in `column_mapping.features`. Source: [backend/app/engine/drift.py](../backend/app/engine/drift.py).

#### 4a — Type Detection

```python
def _is_categorical(series: pd.Series) -> bool:
    if pd.api.types.is_object_dtype(series):
        return True
    return series.nunique() <= 10
```

#### 4b — Bin Construction (numeric only)

```python
def _make_bins(baseline: pd.Series, n_bins: int = 10) -> np.ndarray:
    quantiles = np.linspace(0, 100, n_bins + 1)
    edges = np.unique(np.percentile(baseline.dropna(), quantiles))
    # Ensures at least 2 edges; extends boundaries to -inf/+inf
    edges[0]  = -np.inf
    edges[-1] =  np.inf
    return edges
```

Baseline quantiles define the bin edges. Current data is then mapped into the **same** bins, ensuring comparability.

#### 4c — PSI (Population Stability Index)

Applicable to: **numeric and categorical**.

```
For each bin i:
  baseline_pct[i] = baseline_count[i] / total_baseline   (clamped ≥ ε)
  current_pct[i]  = current_count[i]  / total_current    (clamped ≥ ε)

PSI = Σ (current_pct[i] - baseline_pct[i]) × ln(current_pct[i] / baseline_pct[i])
```

| PSI Range | Severity |
|-----------|----------|
| `< psi_warn_threshold` (default 0.10) | `stable` |
| `≥ 0.10` and `< psi_crit_threshold` (default 0.25) | `warning` |
| `≥ 0.25` | `critical` |

Returns: `{ psi, bins, baseline_counts, current_counts }`

#### 4d — KS Test (Kolmogorov-Smirnov)

Applicable to: **numeric only**. Returns `(0.0, 1.0)` for categorical.

```python
from scipy.stats import ks_2samp
stat, pvalue = ks_2samp(baseline_clean, current_clean)
# stat  = max|CDF_baseline(x) - CDF_current(x)|  ∈ [0, 1]
# pvalue = probability of observing this stat under H₀ (same distribution)
```

Returns: `{ ks_stat, ks_pvalue }`

#### 4e — JSD (Jensen-Shannon Divergence)

Applicable to: **numeric and categorical**.

```python
from scipy.spatial.distance import jensenshannon
distance = jensenshannon(baseline_pct, current_pct)
jsd = distance ** 2      # squared form, range [0, ln(2)] ≈ [0, 0.693]
```

Returns: `{ jsd }`

#### 4f — Wasserstein Distance

Applicable to: **numeric only**. Returns `0.0` for categorical.

```python
from scipy.stats import wasserstein_distance
raw = wasserstein_distance(baseline_clean, current_clean)
std = baseline_clean.std()
normalized = raw / std if std > 0 else 0.0
```

Normalization by baseline standard deviation makes the metric scale-invariant.

Returns: `{ wasserstein }`

#### 4g — Chi-Square Test

Applicable to: **categorical only**. Returns `None` for numeric.

```python
from scipy.stats import chi2_contingency
contingency_table = [baseline_counts, current_counts]
chi2, pvalue, _, _ = chi2_contingency(contingency_table)
```

Returns: `{ chi2_stat, chi2_pvalue }`

#### 4h — Per-Feature Summary

All metrics for one feature are consolidated into a single `DriftResult` row:

```python
DriftResult(
    run_id         = run.id,
    model_id       = model.id,
    feature_name   = feature,
    date           = window_end_date,         # ISO date string
    psi            = psi_result["psi"],
    ks_stat        = ks_result["ks_stat"],
    ks_pvalue      = ks_result["ks_pvalue"],
    jsd            = jsd_result["jsd"],
    wasserstein    = wasserstein_result["wasserstein"],
    chi2_stat      = chi2_result["chi2_stat"],    # None for numeric
    chi2_pvalue    = chi2_result["chi2_pvalue"],  # None for numeric
    is_drifted     = psi >= psi_warn_threshold,
    severity       = severity,                # "stable" | "warning" | "critical"
    baseline_histogram = {"bins": [...], "counts": [...]},
    current_histogram  = {"bins": [...], "counts": [...]},
)
```

---

### Step 5: Compute Prediction Drift

Identical to Step 4 but applied to `prediction_col` alone. The resulting `psi` is stored as `PerformanceResult.prediction_psi`.

```python
pred_drift = compute_psi(df_ref[prediction_col], df_prod[prediction_col])
prediction_psi = pred_drift["psi"]
```

---

### Step 6: Compute Data Quality

Executed for **every column** in `column_mapping.features`. Source: [backend/app/engine/quality.py](../backend/app/engine/quality.py).

#### Missing Rate

```python
null_count   = series.isnull().sum()
total_count  = len(series)
missing_rate = null_count / total_count   # ∈ [0, 1]
```

#### Outlier Rate (IQR Method — numeric only)

```python
Q1  = series.quantile(0.25)
Q3  = series.quantile(0.75)
IQR = Q3 - Q1
lower_bound = Q1 - 1.5 * IQR
upper_bound = Q3 + 1.5 * IQR

outlier_mask = (series < lower_bound) | (series > upper_bound)
outlier_rate = outlier_mask.sum() / total_count   # ∈ [0, 1]
```

For categorical columns, `outlier_rate` is set to `0.0`.

Each feature yields one `QualityResult` row:

```python
QualityResult(
    run_id        = run.id,
    model_id      = model.id,
    feature_name  = feature,
    date          = window_end_date,
    missing_rate  = missing_rate,
    outlier_rate  = outlier_rate,
    null_count    = int(null_count),
    total_count   = int(total_count),
)
```

---

### Step 7: Compute Performance Metrics

Executed **only if** `target_col` is declared and present in the production DataFrame. Source: [backend/app/engine/performance.py](../backend/app/engine/performance.py).

#### Classification (`model.type == "classification"`)

```python
from sklearn.metrics import (
    accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
)

y_true = df_prod[target_col].align(df_prod[prediction_col])[0]
y_pred = df_prod[prediction_col].round()   # round to class label

accuracy  = accuracy_score(y_true, y_pred)
f1        = f1_score(y_true, y_pred, average="weighted")
precision = precision_score(y_true, y_pred, average="weighted")
recall    = recall_score(y_true, y_pred, average="weighted")

# Binary
auc_roc = roc_auc_score(y_true, y_pred)
# Multi-class
auc_roc = roc_auc_score(y_true, y_pred, multi_class="ovr")
```

#### Regression (`model.type == "regression"`)

```python
from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score
import numpy as np

y_true = pd.to_numeric(df_prod[target_col],     errors="coerce")
y_pred = pd.to_numeric(df_prod[prediction_col], errors="coerce")

mae  = mean_absolute_error(y_true, y_pred)
rmse = np.sqrt(mean_squared_error(y_true, y_pred))
r2   = r2_score(y_true, y_pred)
```

Result row:

```python
PerformanceResult(
    run_id         = run.id,
    model_id       = model.id,
    date           = window_end_date,
    # Classification fields (None for regression)
    accuracy       = accuracy,
    f1_score       = f1,
    auc_roc        = auc_roc,
    precision      = precision,
    recall         = recall,
    # Regression fields (None for classification)
    r2             = r2,
    mae            = mae,
    rmse           = rmse,
    # Always present
    prediction_psi = prediction_psi,
)
```

---

### Step 8: Evaluate Alerts

After all metrics are computed, the engine checks each feature's PSI against configured thresholds. Source: [backend/app/engine/runner.py](../backend/app/engine/runner.py) — `_evaluate_alerts()`.

```python
for result in drift_results:
    if result.psi >= model.psi_crit_threshold:
        severity = "CRITICAL"
        threshold = model.psi_crit_threshold
    elif result.psi >= model.psi_warn_threshold:
        severity = "WARNING"
        threshold = model.psi_warn_threshold
    else:
        continue   # No alert for this feature

    # Cooldown check: skip if an open alert for this (model, feature, severity)
    # was created within the last alert_cooldown_hours
    existing = # Alert WHERE model_id=X AND feature_name=Y AND severity=Z
               #           AND cooldown_until > now()
    if existing:
        continue

    Alert(
        model_id          = model.id,
        run_id            = run.id,
        severity          = severity,
        metric_name       = "PSI",
        metric_value      = result.psi,
        threshold         = threshold,
        message           = f"PSI drift on '{result.feature_name}': {result.psi:.4f}",
        status            = "open",
        feature_name      = result.feature_name,
        cooldown_until    = now + timedelta(hours=model.alert_cooldown_hours),
        notified_channels = model.alert_channels,
    )
```

---

### Step 9: Update Model Summary

The `Model` record is updated with aggregate signals computed from the run's results.

```python
# Global PSI — average across all features
all_psi     = [r.psi for r in drift_results]
global_psi  = mean(all_psi) if all_psi else 0.0

# Global Performance — AUC-ROC (classification) or R² (regression)
global_perf = perf_result.auc_roc  # or perf_result.r2

# Data Quality Score — 1 minus average missing rate, clamped [0, 1]
avg_missing = mean([q.missing_rate for q in quality_results])
dq_score    = max(0.0, min(1.0, 1.0 - avg_missing))

# Status — driven by worst feature PSI
max_psi = max(all_psi, default=0.0)
if max_psi >= model.psi_crit_threshold:
    status = "critical"
elif max_psi >= model.psi_warn_threshold:
    status = "warning"
else:
    status = "healthy"

model.global_psi  = global_psi
model.global_perf = global_perf
model.dq_score    = dq_score
model.status      = status
```

---

### Step 10: Record the Run

```python
run.status           = "success"        # or "failed" on exception
run.completed_at     = datetime.utcnow()
run.duration_seconds = (completed_at - triggered_at).total_seconds()
run.window_start     = cutoff.isoformat()
run.window_end       = now.isoformat()
```

---

## 3. Output Tables by View

Each view in MLMonitor consumes a specific subset of the output tables. Below are the exact columns written to the database and how the frontend renders them.

---

### 3.1 Drift Analysis View → `DriftResult`

**Source**: `backend/app/db/models.py` — `DriftResult` table
**Frontend**: ModelDetail.jsx `tab === 'drift'`

#### DriftResult Table

| Column | Type | Formula / Source | Range |
|--------|------|-----------------|-------|
| `id` | UUID string | Auto-generated | — |
| `run_id` | UUID FK | MonitoringRun.id | — |
| `model_id` | UUID FK | Model.id | — |
| `feature_name` | string(200) | `column_mapping.features[i]` | — |
| `date` | string(20) | `window_end` ISO date (YYYY-MM-DD) | — |
| `psi` | float | Σ(cur% − base%) × ln(cur%/base%) | [0, ∞) |
| `ks_stat` | float | max\|CDF_base(x) − CDF_cur(x)\| | [0, 1] |
| `ks_pvalue` | float | Probability under H₀ | [0, 1] |
| `jsd` | float | jensenshannon(base%, cur%)² | [0, 0.693] |
| `wasserstein` | float | wasserstein_distance / std(baseline) | [0, ∞) |
| `chi2_stat` | float \| NULL | chi2_contingency (categorical only) | [0, ∞) |
| `chi2_pvalue` | float \| NULL | chi2 p-value (categorical only) | [0, 1] |
| `is_drifted` | bool | `psi >= psi_warn_threshold` | true/false |
| `severity` | string(20) | "stable" / "warning" / "critical" | — |
| `baseline_histogram` | JSON | `{ bins: [...], counts: [...] }` | — |
| `current_histogram` | JSON | `{ bins: [...], counts: [...] }` | — |

#### How the Drift Analysis Tab Renders This

```
PSI Timeline Chart
  x-axis → date                     (one point per run)
  y-axis → psi                      (aggregate across features via psiTimeline)
  reference lines → 0.10 (yellow), 0.25 (red)

Feature Drift Table
  Feature     → feature_name
  PSI         → psi             (color: red >0.25 | yellow >0.10 | green)
  KS Stat     → ks_stat
  JSD         → jsd
  Wasserstein → wasserstein
  Status      → severity        (badge: STABLE / WARNING / CRITICAL)
  Trend       → last 10 psi values per feature (sparkline)
```

Clicking a row opens a **Distribution Comparison Modal**:

```
BarChart (histogram overlay)
  x-axis → bins[i]
  baseline bars → baseline_histogram.counts[i]
  current bars  → current_histogram.counts[i]

Area Chart (drift over time)
  x-axis → date
  y-axis → psi (from feature's DriftResult history)
  reference lines → 0.10, 0.25
```

---

### 3.2 Feature Detail View → DriftResult + Histograms

**Source**: Same `DriftResult` table as above
**Frontend**: ModelDetail.jsx `tab === 'features'`

Renders one **card per feature** in a responsive grid. Each card contains:

```
Card Header
  feature_name                  (left)
  severity badge                (right — color-coded)

Metric Row
  PSI value   → psi             (bold, drift-colored)
  KS value    → ks_stat
  JSD value   → jsd

Mini BarChart (100px tall)
  baseline bars → baseline_histogram.counts
  current bars  → current_histogram.counts
  x-axis        → baseline_histogram.bins
```

All cards are clickable and open the same full Distribution Comparison Modal described in §3.1.

---

### 3.3 Performance Monitor View → `PerformanceResult`

**Source**: `backend/app/db/models.py` — `PerformanceResult` table
**Frontend**: ModelDetail.jsx `tab === 'performance'`

#### PerformanceResult Table

| Column | Type | Formula / Source | Applicable To |
|--------|------|-----------------|--------------|
| `id` | UUID string | Auto-generated | Both |
| `run_id` | UUID FK | MonitoringRun.id | Both |
| `model_id` | UUID FK | Model.id | Both |
| `date` | string(20) | `window_end` ISO date | Both |
| `accuracy` | float \| NULL | `accuracy_score(y_true, y_pred)` | Classification |
| `f1_score` | float \| NULL | `f1_score(..., average="weighted")` | Classification |
| `auc_roc` | float \| NULL | `roc_auc_score(y_true, y_pred)` | Classification |
| `precision` | float \| NULL | `precision_score(..., average="weighted")` | Classification |
| `recall` | float \| NULL | `recall_score(..., average="weighted")` | Classification |
| `r2` | float \| NULL | `r2_score(y_true, y_pred)` | Regression |
| `mae` | float \| NULL | `mean_absolute_error(y_true, y_pred)` | Regression |
| `rmse` | float \| NULL | `sqrt(mean_squared_error(y_true, y_pred))` | Regression |
| `prediction_psi` | float \| NULL | PSI on `prediction_col` distribution | Both |

#### How the Performance Tab Renders This

```
Primary Metric Timeline (Area Chart)
  Title: "AUC-ROC Over Time" (classification) | "R² Score Over Time" (regression)
  x-axis → date
  y-axis → auc_roc (classification) | r2 (regression)
  data   → performanceTimeline (one entry per MonitoringRun)
  reference line → y=0.80 (yellow dashed — degradation warning)

Prediction Distribution Drift (Area Chart)
  Title: "Prediction Distribution Drift"
  x-axis → date
  y-axis → prediction_psi
  data   → predictionDrift
  reference lines → y=0.10 (yellow), y=0.25 (red)
```

**Summary card** at the top of ModelDetail shows:
```
Global Performance card → globalPerf = latest auc_roc or r2
  Green  if > 0.85
  Yellow if > 0.70
  Red    otherwise

Prediction Drift card → predictionDrift[-1].value (latest prediction PSI)
  Same drift color scale as feature PSI
```

---

### 3.4 Data Quality View → `QualityResult`

**Source**: `backend/app/db/models.py` — `QualityResult` table
**Frontend**: ModelDetail.jsx `tab === 'quality'`

#### QualityResult Table

| Column | Type | Formula / Source | Range |
|--------|------|-----------------|-------|
| `id` | UUID string | Auto-generated | — |
| `run_id` | UUID FK | MonitoringRun.id | — |
| `model_id` | UUID FK | Model.id | — |
| `feature_name` | string(200) | `column_mapping.features[i]` | — |
| `date` | string(20) | `window_end` ISO date | — |
| `missing_rate` | float | `null_count / total_count` | [0, 1] |
| `outlier_rate` | float | IQR-based count / total (numeric); 0.0 (categorical) | [0, 1] |
| `null_count` | int | `series.isnull().sum()` | [0, N] |
| `total_count` | int | `len(series)` | [0, N] |

#### How the Data Quality Tab Renders This

```
Left Panel — Missing Values Rate (Horizontal Bar Chart)
  data  → dqMissing sorted DESC by rate
  x-axis → rate (displayed as percentage)
  y-axis → feature_name
  Bar color:
    Red    if rate > 0.05  (> 5%)
    Yellow if rate > 0.02  (> 2%)
    Green  otherwise

Right Panel — Outlier Rate (Horizontal Bar Chart)
  data  → dqOutlier sorted DESC by rate
  x-axis → rate (displayed as percentage)
  Bar color:
    Red    if rate > 0.03  (> 3%)
    Yellow if rate > 0.01  (> 1%)
    Accent otherwise

Summary Table — All Features
  Feature     → feature_name
  Missing %   → missing_rate × 100   (yellow if > 2%)
  Outlier %   → outlier_rate × 100   (yellow if > 2%)
  Status      → "OK" if both < 2%, else "Check"
```

**Data Quality Score** on the summary card:

```
dq_score = max(0.0, min(1.0, 1.0 - avg(missing_rate across all features)))
  Displayed as percentage (e.g., 0.97 → "97.0%")
  Green  if > 0.95
  Yellow if > 0.90
  Red    otherwise
```

---

## Quick Reference: View → Table Mapping

| View | DB Table | Key Fields Consumed |
|------|----------|-------------------|
| Overview (model list) | `Model` | `status`, `global_psi`, `global_perf`, `dq_score`, `psiTimeline` |
| Drift Analysis | `DriftResult` | `psi`, `ks_stat`, `jsd`, `wasserstein`, `severity`, `date` |
| Feature Detail | `DriftResult` | All drift metrics + `baseline_histogram`, `current_histogram` |
| Performance Monitor | `PerformanceResult` | `auc_roc`/`r2`, `prediction_psi`, `date` |
| Data Quality | `QualityResult` | `missing_rate`, `outlier_rate`, `null_count`, `total_count`, `date` |
| Execution Log | `MonitoringRun` | `status`, `duration_seconds`, `window_start`, `window_end`, `engine` |
| Alerts | `Alert` | `severity`, `metric_name`, `metric_value`, `threshold`, `status`, `feature_name` |
