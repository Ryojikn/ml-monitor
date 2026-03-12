"""
Builder script — generates monitoring_pipeline.ipynb.
Run with: /Users/ryojikn/micromamba/bin/python3 _build_notebook.py
"""
import json, uuid, os

OUT = os.path.join(os.path.dirname(__file__), "monitoring_pipeline.ipynb")


def md(source: str) -> dict:
    return {
        "cell_type": "markdown",
        "id": str(uuid.uuid4())[:8],
        "metadata": {},
        "source": source.strip(),
    }


def code(source: str) -> dict:
    return {
        "cell_type": "code",
        "execution_count": None,
        "id": str(uuid.uuid4())[:8],
        "metadata": {},
        "outputs": [],
        "source": source.strip(),
    }


# ─────────────────────────────────────────────────────────────────────────────
cells = []

# ══ TITLE ════════════════════════════════════════════════════════════════════
cells.append(md("""
# MLMonitor — Full Monitoring Pipeline (Spark Local)

End-to-end execution of the monitoring pipeline described in `docs/dataset-pipeline.md`.

| Step | What happens |
|------|--------------|
| 0 | Install deps |
| 1 | Configuration — all tuneable knobs in one place |
| 2 | Spark session (`local[*]`) |
| 3 | Load Delta parquet datasets |
| 4 | Feature type detection |
| 5 | Data quality (missing rate, outlier rate) |
| 6–9 | Drift: PSI · KS · JSD · Wasserstein · Chi² |
| 10 | Prediction drift |
| 11 | Performance metrics (classification) |
| 12 | Model summary per snapshot |
| 13 | Alert evaluation |
| 14 | Final summary |

All outputs are **Spark DataFrames** whose schemas mirror the DB tables in
`backend/app/db/models.py` (`DriftResult`, `QualityResult`, `PerformanceResult`, `Alert`).
"""))

# ══ 0 · INSTALL ══════════════════════════════════════════════════════════════
cells.append(md("## 0 · Install Dependencies"))

cells.append(code("""\
import subprocess, sys

pkgs = ["pyspark", "scipy", "scikit-learn"]
subprocess.check_call([sys.executable, "-m", "pip", "install", "-q", *pkgs])
print("Dependencies ready.")
"""))

# ══ 1 · CONFIG ═══════════════════════════════════════════════════════════════
cells.append(md("""## 1 · Configuration

All tuneable parameters are declared here. Modify these cells before running the
rest of the notebook.
"""))

cells.append(code("""\
import os

# ── Paths ─────────────────────────────────────────────────────────────────────
DATA_DIR       = os.path.abspath("../data")
BASELINE_PATH  = f"{DATA_DIR}/baseline"
INFERENCE_PATH = f"{DATA_DIR}/inference"

print(f"Baseline  : {BASELINE_PATH}")
print(f"Inference : {INFERENCE_PATH}")
"""))

cells.append(code("""\
# ── Column mapping ────────────────────────────────────────────────────────────
# Mirrors Model.column_mapping in backend/app/db/models.py

COLUMN_MAPPING = {
    "features": [
        "age",
        "income",
        "credit_score",
        "loan_amount",
        "interest_rate",
        "debt_to_income",
        "employment_status",
        "loan_purpose",
        "home_ownership",
    ],
    "prediction_col": "prediction",
    "target_col":     "target",
    "timestamp_col":  "dat_ref",   # dd-mm-YYYY partition column
}

FEATURES        = COLUMN_MAPPING["features"]
PREDICTION_COL  = COLUMN_MAPPING["prediction_col"]
TARGET_COL      = COLUMN_MAPPING["target_col"]
TIMESTAMP_COL   = COLUMN_MAPPING["timestamp_col"]

print(f"Features        : {FEATURES}")
print(f"Prediction col  : {PREDICTION_COL}")
print(f"Target col      : {TARGET_COL}")
print(f"Timestamp col   : {TIMESTAMP_COL}")
"""))

cells.append(code("""\
# ── Model / monitoring config ─────────────────────────────────────────────────
MODEL_TYPE           = "classification"   # "classification" | "regression"

PSI_WARN_THRESHOLD   = 0.10   # warning  band
PSI_CRIT_THRESHOLD   = 0.25   # critical band
N_BINS               = 10     # quantile bins for numeric features
EPS                  = 1e-6   # epsilon floor to prevent log(0)

ALERT_COOLDOWN_HOURS = 6
ALERT_CHANNELS       = ["slack", "email"]

# Inference windows to process — None = all available dat_ref partitions
# Example subset: INFERENCE_DATES = ["01-10-2025", "01-03-2026"]
INFERENCE_DATES      = None

# Performance sample: rows collected to driver for sklearn metrics
SAMPLE_SIZE          = 200_000

print("Monitoring config:")
print(f"  model_type           = {MODEL_TYPE}")
print(f"  psi_warn_threshold   = {PSI_WARN_THRESHOLD}")
print(f"  psi_crit_threshold   = {PSI_CRIT_THRESHOLD}")
print(f"  n_bins               = {N_BINS}")
print(f"  sample_size          = {SAMPLE_SIZE:,}")
"""))

# ══ IMPORTS ══════════════════════════════════════════════════════════════════
cells.append(md("### Imports"))

cells.append(code("""\
import json, uuid, warnings
from collections import defaultdict

import numpy as np
import pandas as pd

from scipy.stats             import ks_2samp, chi2_contingency, wasserstein_distance
from scipy.spatial.distance  import jensenshannon
from sklearn.metrics         import (
    accuracy_score, f1_score, precision_score, recall_score, roc_auc_score,
)

from pyspark.sql        import SparkSession
from pyspark.sql        import functions as F
from pyspark.sql.types  import (
    StructType, StructField,
    StringType, DoubleType, FloatType,
    IntegerType, LongType, BooleanType,
)
from pyspark.ml.feature import Bucketizer

warnings.filterwarnings("ignore")
print("All imports OK.")
"""))

# ══ 2 · SPARK SESSION ════════════════════════════════════════════════════════
cells.append(md("""## 2 · Spark Session (local[\\*])

Running on Spark local mode — no cluster required.
Delta tables are partitioned parquet, readable with `spark.read.parquet()` directly.
"""))

cells.append(code("""\
import os, sys

# Pin both driver and worker to the same Python that is running this notebook.
# Without this, Spark workers may pick up the system Python (e.g. 3.9) instead
# of the environment Python (3.12), causing import errors in worker processes.
os.environ["PYSPARK_PYTHON"]        = sys.executable
os.environ["PYSPARK_DRIVER_PYTHON"] = sys.executable
os.environ["JAVA_HOME"]             = os.environ.get(
    "JAVA_HOME", "/opt/homebrew/opt/openjdk@17"
)

spark = (
    SparkSession.builder
    .master("local[*]")
    .appName("MLMonitor — Monitoring Pipeline")
    .config("spark.driver.memory",           "6g")
    .config("spark.sql.shuffle.partitions",  "8")
    .config("spark.ui.showConsoleProgress",  "false")
    .config("spark.sql.execution.arrow.pyspark.enabled", "true")
    .getOrCreate()
)
spark.sparkContext.setLogLevel("WARN")

print(f"Spark {spark.version}  |  master = local[*]")
print(f"Driver memory : {spark.conf.get('spark.driver.memory')}")
"""))

# ══ 3 · DATA LOADING ═════════════════════════════════════════════════════════
cells.append(md("""## 3 · Data Loading

Reads the two Delta Lake tables generated by `data/generate.py`.
Partitioned layout:

```
data/baseline/   dat_ref=01-09-2025/  *.snappy.parquet
data/inference/  dat_ref=01-10-2025/  *.snappy.parquet
                 dat_ref=01-11-2025/  ...
                 dat_ref=01-12-2025/  ...
                 dat_ref=01-01-2026/  ...
                 dat_ref=01-02-2026/  ...
                 dat_ref=01-03-2026/  ...
```
"""))

cells.append(code("""\
# ── Load baseline ─────────────────────────────────────────────────────────────
df_baseline = spark.read.parquet(BASELINE_PATH)
baseline_count = df_baseline.count()

# ── Load inference ────────────────────────────────────────────────────────────
df_inference_full = spark.read.parquet(INFERENCE_PATH)

available_dates = sorted([
    r[TIMESTAMP_COL]
    for r in df_inference_full.select(TIMESTAMP_COL).distinct().collect()
])

selected_dates = INFERENCE_DATES if INFERENCE_DATES else available_dates
df_inference = df_inference_full.filter(F.col(TIMESTAMP_COL).isin(selected_dates))

print(f"Baseline  : {baseline_count:>12,} rows   dat_ref = 01-09-2025")
print(f"Inference : {df_inference.count():>12,} rows   across {len(selected_dates)} windows")
print(f"\\nWindows selected: {selected_dates}")
"""))

cells.append(code("""\
# ── Schema ────────────────────────────────────────────────────────────────────
print("Schema (baseline = inference):")
df_baseline.printSchema()
"""))

cells.append(code("""\
# ── Row counts per window ─────────────────────────────────────────────────────
print(f"{'dat_ref':<15}  {'rows':>12}")
print("-" * 30)
for d in selected_dates:
    n = df_inference.filter(F.col(TIMESTAMP_COL) == d).count()
    print(f"  {d:<13}  {n:>12,}")
"""))

cells.append(code("""\
# ── Quick peek ────────────────────────────────────────────────────────────────
print("Baseline (3 rows):")
df_baseline.show(3, truncate=False)

print(f"Inference — {selected_dates[0]} (3 rows):")
df_inference.filter(F.col(TIMESTAMP_COL) == selected_dates[0]).show(3, truncate=False)
"""))

# ══ 4 · FEATURE TYPE DETECTION ═══════════════════════════════════════════════
cells.append(md("""## 4 · Feature Type Detection

Mirrors `_is_categorical()` in `backend/app/engine/drift.py`:
- String dtype → categorical
- Numeric with `nunique() ≤ 10` → categorical
- Otherwise → numeric
"""))

cells.append(code("""\
def detect_feature_types(df_ref, features, nunique_threshold=10):
    schema_map = {f.name: str(f.dataType) for f in df_ref.schema.fields}
    numeric, categorical = [], []
    for feat in features:
        dtype = schema_map.get(feat, "")
        if "StringType" in dtype:
            categorical.append(feat)
        else:
            n_unique = df_ref.select(feat).distinct().count()
            if n_unique <= nunique_threshold:
                categorical.append(feat)
            else:
                numeric.append(feat)
    return numeric, categorical


NUMERIC_FEATURES, CATEGORICAL_FEATURES = detect_feature_types(df_baseline, FEATURES)

print(f"Numeric     ({len(NUMERIC_FEATURES)}): {NUMERIC_FEATURES}")
print(f"Categorical ({len(CATEGORICAL_FEATURES)}): {CATEGORICAL_FEATURES}")
"""))

# ══ 5 · DATA QUALITY ═════════════════════════════════════════════════════════
cells.append(md("""## 5 · Data Quality

Computes per feature per `dat_ref` window:

| Metric | Formula |
|--------|---------|
| `missing_rate` | `null_count / total_count` |
| `outlier_rate` | IQR method: rows outside `[Q1 − 1.5·IQR,  Q3 + 1.5·IQR]` / total |
| `null_count` | raw null count |
| `total_count` | row count for this window |

Output: `quality_df` — schema matches `QualityResult` in `backend/app/db/models.py`
"""))

cells.append(code("""\
QUALITY_SCHEMA = StructType([
    StructField("run_id",       StringType(), True),
    StructField("model_id",     StringType(), True),
    StructField("feature_name", StringType(), False),
    StructField("dat_ref",      StringType(), False),
    StructField("missing_rate", DoubleType(), True),
    StructField("outlier_rate", DoubleType(), True),
    StructField("null_count",   LongType(),   True),
    StructField("total_count",  LongType(),   True),
])

RUN_ID   = str(uuid.uuid4())
MODEL_ID = str(uuid.uuid4())

print(f"RUN_ID   = {RUN_ID}")
print(f"MODEL_ID = {MODEL_ID}")
"""))

cells.append(code("""\
quality_rows = []

for dat_ref in selected_dates:
    df_window   = df_inference.filter(F.col(TIMESTAMP_COL) == dat_ref)
    total_count = df_window.count()

    for feat in FEATURES:
        # ── Missing ───────────────────────────────────────────────────────────
        null_count   = df_window.filter(F.col(feat).isNull()).count()
        missing_rate = null_count / total_count if total_count > 0 else 0.0

        # ── Outlier (IQR, numeric only) ───────────────────────────────────────
        outlier_rate = 0.0
        if feat in NUMERIC_FEATURES:
            q1, q3 = df_window.approxQuantile(feat, [0.25, 0.75], 0.01)
            iqr    = q3 - q1
            if iqr > 0:
                lo = q1 - 1.5 * iqr
                hi = q3 + 1.5 * iqr
                outlier_count = df_window.filter(
                    (F.col(feat) < lo) | (F.col(feat) > hi)
                ).count()
                outlier_rate = outlier_count / total_count

        quality_rows.append((
            RUN_ID, MODEL_ID, feat, dat_ref,
            float(missing_rate), float(outlier_rate),
            int(null_count), int(total_count),
        ))

    print(f"  [{dat_ref}] quality computed for {len(FEATURES)} features")

quality_df = spark.createDataFrame(quality_rows, schema=QUALITY_SCHEMA)
print(f"\\nquality_df: {quality_df.count()} rows  ({len(FEATURES)} features × {len(selected_dates)} windows)")
"""))

cells.append(code("""\
print("Data Quality — missing rate by feature and window:")
quality_df \\
    .groupBy("feature_name") \\
    .pivot("dat_ref") \\
    .agg(F.round(F.first("missing_rate"), 6)) \\
    .orderBy("feature_name") \\
    .show(truncate=False)

print("\\nData Quality — outlier rate by feature and window:")
quality_df \\
    .groupBy("feature_name") \\
    .pivot("dat_ref") \\
    .agg(F.round(F.first("outlier_rate"), 4)) \\
    .orderBy("feature_name") \\
    .show(truncate=False)
"""))

# ══ 6 · BASELINE HISTOGRAMS ══════════════════════════════════════════════════
cells.append(md("""## 6 · Baseline Histogram Construction

Mirrors `_make_bins()` and the binning logic in `backend/app/engine/drift.py`.

For **numeric** features: 10 quantile-based bin edges computed from baseline via
`approxQuantile`, then `Bucketizer` counts rows per bin.

For **categorical** features: simple group-by count per category level.

Baseline histograms are stored once and reused across all inference windows —
ensuring distribution comparability on identical bin boundaries.
"""))

cells.append(code("""\
def make_bins(df, feature, n_bins=10, relative_error=0.001):
    \"\"\"Quantile-based bin edges from Spark approxQuantile.\"\"\"
    quantiles = [i / n_bins for i in range(n_bins + 1)]
    edges = df.approxQuantile(feature, quantiles, relative_error)
    edges = sorted(set(edges))
    if len(edges) < 2:
        return None
    edges[0]  = float("-inf")
    edges[-1] = float("inf")
    return edges


def bin_counts_numeric(df, feature, edges):
    \"\"\"Row counts per bin using Spark Bucketizer.\"\"\"
    bucket_col = f"__bucket_{feature}"
    bucketizer = Bucketizer(
        splits=edges,
        inputCol=feature,
        outputCol=bucket_col,
        handleInvalid="skip",
    )
    bucketed   = bucketizer.transform(df.select(feature))
    n_bins     = len(edges) - 1
    counts_map = {
        int(r[bucket_col]): int(r["count"])
        for r in bucketed.groupBy(bucket_col).count().collect()
    }
    return [counts_map.get(i, 0) for i in range(n_bins)]


def bin_counts_categorical(df, feature):
    \"\"\"Counts per category level.\"\"\"
    rows      = df.groupBy(feature).count().collect()
    levels    = sorted(str(r[feature]) for r in rows)
    counts_map= {str(r[feature]): int(r["count"]) for r in rows}
    return levels, [counts_map.get(lv, 0) for lv in levels]
"""))

cells.append(code("""\
baseline_histograms = {}

for feat in NUMERIC_FEATURES:
    edges = make_bins(df_baseline, feat, N_BINS)
    if edges is None:
        print(f"  WARN: could not build bins for {feat}")
        continue
    counts = bin_counts_numeric(df_baseline, feat, edges)
    baseline_histograms[feat] = {
        "type":   "numeric",
        "edges":  edges,
        "counts": counts,
    }

for feat in CATEGORICAL_FEATURES:
    levels, counts = bin_counts_categorical(df_baseline, feat)
    baseline_histograms[feat] = {
        "type":   "categorical",
        "levels": levels,
        "counts": counts,
    }

print(f"{'Feature':<25}  {'Type':<12}  {'Bins':>5}  {'Total rows':>12}")
print("-" * 60)
for feat, h in baseline_histograms.items():
    bins  = len(h["counts"])
    total = sum(h["counts"])
    print(f"  {feat:<23}  {h['type']:<12}  {bins:>5}  {total:>12,}")
"""))

# ══ 7 · INFERENCE BIN COUNTS ══════════════════════════════════════════════════
cells.append(md("""## 7 · Inference Bin Counts (per dat_ref window)

Applies the **same bin boundaries** established from the baseline to each inference
window. This guarantees that PSI / KS / JSD comparisons are made on identical bins.
"""))

cells.append(code("""\
inference_histograms = defaultdict(dict)

for dat_ref in selected_dates:
    df_window = df_inference.filter(F.col(TIMESTAMP_COL) == dat_ref)

    for feat in NUMERIC_FEATURES:
        h = baseline_histograms.get(feat)
        if h is None:
            continue
        counts = bin_counts_numeric(df_window, feat, h["edges"])
        inference_histograms[dat_ref][feat] = {"type": "numeric", "counts": counts}

    for feat in CATEGORICAL_FEATURES:
        h = baseline_histograms.get(feat)
        if h is None:
            continue
        rows       = df_window.groupBy(feat).count().collect()
        counts_map = {str(r[feat]): int(r["count"]) for r in rows}
        counts     = [counts_map.get(lv, 0) for lv in h["levels"]]
        inference_histograms[dat_ref][feat] = {"type": "categorical", "counts": counts}

    print(f"  [{dat_ref}] inference histograms built for {len(inference_histograms[dat_ref])} features")

print("\\nDone.")
"""))

# ══ 8 · PSI ══════════════════════════════════════════════════════════════════
cells.append(md("""## 8 · PSI — Population Stability Index

Formula (matches `backend/app/engine/drift.py`):

```
PSI = Σ (cur_pct[i] − base_pct[i]) × ln(cur_pct[i] / base_pct[i])
```

Bin fractions are floored to `ε = 1e-6` to prevent `log(0)`.

| PSI | Severity |
|-----|----------|
| `< 0.10` | stable |
| `0.10 – 0.25` | warning |
| `≥ 0.25` | critical |
"""))

cells.append(code("""\
def compute_psi(base_counts, cur_counts, eps=EPS):
    base = np.array(base_counts, dtype=float)
    cur  = np.array(cur_counts,  dtype=float)
    base_pct = np.maximum(base / base.sum(), eps)
    cur_pct  = np.maximum(cur  / cur.sum(),  eps)
    return float(np.sum((cur_pct - base_pct) * np.log(cur_pct / base_pct)))


def psi_severity(psi, warn=PSI_WARN_THRESHOLD, crit=PSI_CRIT_THRESHOLD):
    if psi >= crit:
        return "critical"
    if psi >= warn:
        return "warning"
    return "stable"
"""))

cells.append(code("""\
# PSI heatmap across all features and dat_ref windows
header = f"{'Feature':<25}" + "".join(f"  {d[:5]:>8}" for d in selected_dates)
print(header)
print("-" * len(header))

for feat in FEATURES:
    row = f"  {feat:<23}"
    for dat_ref in selected_dates:
        h_base = baseline_histograms.get(feat)
        h_cur  = inference_histograms[dat_ref].get(feat)
        if h_base and h_cur:
            psi = compute_psi(h_base["counts"], h_cur["counts"])
            row += f"  {psi:>8.4f}"
        else:
            row += f"  {'N/A':>8}"
    print(row)
"""))

# ══ 9 · KS · JSD · WASSERSTEIN · CHI2 ═══════════════════════════════════════
cells.append(md("""## 9 · Statistical Drift Metrics

All computed from **collected histogram counts** (not raw data), making the approach
scalable to arbitrarily large datasets — only bin counts cross the Spark → driver boundary.

| Metric | Formula | Applicable |
|--------|---------|-----------|
| KS stat | `max|CDF_base − CDF_cur|` from cumulative bin fractions | numeric |
| JSD | `jensenshannon(base_pct, cur_pct)²` | numeric + categorical |
| Wasserstein | `wasserstein_distance / std(baseline)` on bin midpoints | numeric |
| Chi² | `chi2_contingency([base_counts, cur_counts])` | categorical |
"""))

cells.append(code("""\
def compute_ks_from_hist(base_counts, cur_counts):
    \"\"\"KS statistic from empirical CDFs derived from histogram bin counts.\"\"\"
    base = np.array(base_counts, dtype=float)
    cur  = np.array(cur_counts,  dtype=float)
    base_cdf = np.cumsum(base / base.sum())
    cur_cdf  = np.cumsum(cur  / cur.sum())
    return float(np.max(np.abs(base_cdf - cur_cdf)))


def compute_jsd(base_counts, cur_counts, eps=EPS):
    base = np.maximum(np.array(base_counts, dtype=float), eps)
    cur  = np.maximum(np.array(cur_counts,  dtype=float), eps)
    base_pct = base / base.sum()
    cur_pct  = cur  / cur.sum()
    dist = jensenshannon(base_pct, cur_pct)
    return float(dist ** 2)   # squared form ∈ [0, ln(2)]


def compute_wasserstein_from_hist(edges, base_counts, cur_counts):
    \"\"\"
    Wasserstein distance on histogram bin midpoints, normalised by
    baseline standard deviation for scale-invariance.
    Drops the ±inf boundary bins (they have no finite midpoint).
    \"\"\"
    finite_edges = [e for e in edges if np.isfinite(e)]
    if len(finite_edges) < 2:
        return 0.0

    midpoints = np.array([
        (finite_edges[i] + finite_edges[i + 1]) / 2.0
        for i in range(len(finite_edges) - 1)
    ])

    # The ±inf boundary bins are at index 0 and -1 of the counts list;
    # strip them so lengths align with midpoints.
    n = len(midpoints)
    base_c = np.array(base_counts[1: n + 1], dtype=float)
    cur_c  = np.array(cur_counts[1:  n + 1], dtype=float)

    base_w = base_c / base_c.sum() if base_c.sum() > 0 else np.ones(n) / n
    cur_w  = cur_c  / cur_c.sum()  if cur_c.sum()  > 0 else np.ones(n) / n

    mean_b = np.average(midpoints, weights=base_w)
    std_b  = np.sqrt(np.average((midpoints - mean_b) ** 2, weights=base_w))

    raw = wasserstein_distance(midpoints, midpoints, base_w, cur_w)
    return float(raw / std_b) if std_b > 0 else 0.0


def compute_chi2(base_counts, cur_counts):
    contingency = np.array([base_counts, cur_counts], dtype=float)
    if contingency.min() < 0 or contingency.sum() == 0:
        return None, None
    try:
        chi2, pvalue, _, _ = chi2_contingency(contingency)
        return float(chi2), float(pvalue)
    except Exception:
        return None, None
"""))

# ══ 10 · DRIFT RESULTS DATAFRAME ═════════════════════════════════════════════
cells.append(md("""## 10 · Drift Results DataFrame

Assembles all drift metrics into a single Spark DataFrame matching the
`DriftResult` table schema in `backend/app/db/models.py`.

Histogram data is JSON-serialised for downstream rendering (Distribution Comparison
Modal in `src/components/ModelDetail.jsx`).
"""))

cells.append(code("""\
DRIFT_SCHEMA = StructType([
    StructField("run_id",             StringType(),  True),
    StructField("model_id",           StringType(),  True),
    StructField("feature_name",       StringType(),  False),
    StructField("dat_ref",            StringType(),  False),
    StructField("psi",                DoubleType(),  True),
    StructField("ks_stat",            DoubleType(),  True),
    StructField("jsd",                DoubleType(),  True),
    StructField("wasserstein",        DoubleType(),  True),
    StructField("chi2_stat",          DoubleType(),  True),
    StructField("chi2_pvalue",        DoubleType(),  True),
    StructField("is_drifted",         BooleanType(), True),
    StructField("severity",           StringType(),  True),
    StructField("baseline_histogram", StringType(),  True),   # JSON
    StructField("current_histogram",  StringType(),  True),   # JSON
])
"""))

cells.append(code("""\
drift_rows = []

for dat_ref in selected_dates:
    for feat in FEATURES:
        h_base = baseline_histograms.get(feat)
        h_cur  = inference_histograms[dat_ref].get(feat)
        if not h_base or not h_cur:
            continue

        base_counts = h_base["counts"]
        cur_counts  = h_cur["counts"]

        # ── PSI (all features) ────────────────────────────────────────────────
        psi = compute_psi(base_counts, cur_counts)
        sev = psi_severity(psi)

        # ── KS (all features — from CDF of bins) ─────────────────────────────
        ks_stat = compute_ks_from_hist(base_counts, cur_counts)

        # ── JSD (all features) ────────────────────────────────────────────────
        jsd = compute_jsd(base_counts, cur_counts)

        # ── Wasserstein (numeric only) ────────────────────────────────────────
        wass = 0.0
        if feat in NUMERIC_FEATURES:
            wass = compute_wasserstein_from_hist(h_base["edges"], base_counts, cur_counts)

        # ── Chi² (categorical only) ───────────────────────────────────────────
        chi2_s, chi2_p = None, None
        if feat in CATEGORICAL_FEATURES:
            chi2_s, chi2_p = compute_chi2(base_counts, cur_counts)

        # ── Histogram JSON for rendering ─────────────────────────────────────
        if feat in NUMERIC_FEATURES:
            bins_repr = [str(round(e, 4)) if np.isfinite(e) else str(e) for e in h_base["edges"]]
        else:
            bins_repr = h_base["levels"]

        base_hist_json = json.dumps({"bins": bins_repr, "counts": base_counts})
        cur_hist_json  = json.dumps({"bins": bins_repr, "counts": cur_counts})

        drift_rows.append((
            RUN_ID, MODEL_ID, feat, dat_ref,
            psi, ks_stat, jsd, wass,
            chi2_s, chi2_p,
            bool(psi >= PSI_WARN_THRESHOLD),
            sev,
            base_hist_json,
            cur_hist_json,
        ))

drift_df = spark.createDataFrame(drift_rows, schema=DRIFT_SCHEMA)
total = drift_df.count()
print(f"drift_df: {total} rows  "
      f"({len(FEATURES)} features × {len(selected_dates)} windows = {len(FEATURES)*len(selected_dates)} expected)")
"""))

cells.append(code("""\
print("Drift metrics — PSI, KS, JSD, Wasserstein:")
drift_df.select("feature_name", "dat_ref", "psi", "ks_stat", "jsd", "wasserstein", "severity") \\
        .orderBy("dat_ref", F.desc("psi")) \\
        .show(60, truncate=False)
"""))

cells.append(code("""\
print("Drift metrics — Chi² (categorical features):")
drift_df.filter(F.col("chi2_stat").isNotNull()) \\
        .select("feature_name", "dat_ref", "psi", "chi2_stat", "chi2_pvalue", "severity") \\
        .orderBy("dat_ref", F.desc("psi")) \\
        .show(truncate=False)
"""))

cells.append(code("""\
print("Severity distribution per dat_ref:")
drift_df.groupBy("dat_ref", "severity") \\
        .count() \\
        .orderBy("dat_ref", "severity") \\
        .show(truncate=False)
"""))

# ══ 11 · PREDICTION DRIFT ════════════════════════════════════════════════════
cells.append(md("""## 11 · Prediction Drift

PSI applied to the `prediction` column distribution.
Stored as `PerformanceResult.prediction_psi` and rendered in the
Performance Monitor tab → "Prediction Distribution Drift" chart.
"""))

cells.append(code("""\
# Baseline prediction distribution
base_pred_rows = df_baseline.groupBy(PREDICTION_COL).count().collect()
base_pred_map  = {str(r[PREDICTION_COL]): int(r["count"]) for r in base_pred_rows}

pred_drift_map = {}

for dat_ref in selected_dates:
    df_window     = df_inference.filter(F.col(TIMESTAMP_COL) == dat_ref)
    cur_pred_rows = df_window.groupBy(PREDICTION_COL).count().collect()
    cur_pred_map  = {str(r[PREDICTION_COL]): int(r["count"]) for r in cur_pred_rows}

    all_levels  = sorted(set(base_pred_map) | set(cur_pred_map))
    base_counts = [base_pred_map.get(lv, 0) for lv in all_levels]
    cur_counts  = [cur_pred_map.get(lv, 0)  for lv in all_levels]

    pred_psi             = compute_psi(base_counts, cur_counts)
    pred_drift_map[dat_ref] = pred_psi

print(f"{'dat_ref':<15}  {'prediction_psi':>15}  {'severity'}")
print("-" * 45)
for d, psi in pred_drift_map.items():
    print(f"  {d:<13}  {psi:>15.4f}  {psi_severity(psi)}")
"""))

# ══ 12 · PERFORMANCE METRICS ═════════════════════════════════════════════════
cells.append(md("""## 12 · Performance Metrics (Classification)

Matches `backend/app/engine/performance.py`.

A sample of up to `SAMPLE_SIZE` rows is collected to the driver for `sklearn` metrics:
`accuracy`, `f1` (weighted), `precision`, `recall`, `auc_roc`.

Output: `performance_df` — schema matches `PerformanceResult` table.
"""))

cells.append(code("""\
PERF_SCHEMA = StructType([
    StructField("run_id",         StringType(), True),
    StructField("model_id",       StringType(), True),
    StructField("dat_ref",        StringType(), False),
    StructField("accuracy",       DoubleType(), True),
    StructField("f1_score",       DoubleType(), True),
    StructField("auc_roc",        DoubleType(), True),
    StructField("precision",      DoubleType(), True),
    StructField("recall",         DoubleType(), True),
    StructField("r2",             DoubleType(), True),   # None for classification
    StructField("mae",            DoubleType(), True),   # None for classification
    StructField("rmse",           DoubleType(), True),   # None for classification
    StructField("prediction_psi", DoubleType(), True),
])
"""))

cells.append(code("""\
perf_rows = []

for dat_ref in selected_dates:
    df_window = df_inference.filter(F.col(TIMESTAMP_COL) == dat_ref)
    n_total   = df_window.count()
    fraction  = min(1.0, SAMPLE_SIZE / n_total)

    sample_pd = (
        df_window
        .select(TARGET_COL, PREDICTION_COL)
        .sample(fraction=fraction, seed=42)
        .toPandas()
    )

    y_true = sample_pd[TARGET_COL].astype(int).values
    y_pred = sample_pd[PREDICTION_COL].astype(int).values

    acc   = float(accuracy_score(y_true, y_pred))
    f1    = float(f1_score(y_true, y_pred,       average="weighted", zero_division=0))
    prec  = float(precision_score(y_true, y_pred, average="weighted", zero_division=0))
    rec   = float(recall_score(y_true, y_pred,    average="weighted", zero_division=0))

    try:
        auc = float(roc_auc_score(y_true, y_pred))
    except Exception:
        auc = None

    perf_rows.append((
        RUN_ID, MODEL_ID, dat_ref,
        acc, f1, auc, prec, rec,
        None, None, None,            # r2, mae, rmse (regression only)
        pred_drift_map.get(dat_ref),
    ))
    auc_str = f"{auc:.4f}" if auc is not None else "N/A"
    print(f"  [{dat_ref}]  n_sampled={len(y_true):>7,}  acc={acc:.4f}  f1={f1:.4f}  auc={auc_str}")

performance_df = spark.createDataFrame(perf_rows, schema=PERF_SCHEMA)
print(f"\\nperformance_df: {performance_df.count()} rows")
"""))

cells.append(code("""\
print("Performance metrics per dat_ref:")
performance_df.select(
    "dat_ref", "accuracy", "f1_score", "auc_roc",
    "precision", "recall", "prediction_psi"
).show(truncate=False)
"""))

# ══ 13 · MODEL SUMMARY ═══════════════════════════════════════════════════════
cells.append(md("""## 12 · Model Summary per dat_ref

Aggregates drift, quality, and performance into the fields stored on the
`Model` record:

| Field | Formula |
|-------|---------|
| `global_psi` | `mean(psi)` across all features |
| `global_perf` | `auc_roc` (classification) or `r2` (regression) |
| `dq_score` | `1 − mean(missing_rate)`, clamped to `[0, 1]` |
| `status` | `"critical"` if `max(psi) ≥ 0.25`; `"warning"` if `≥ 0.10`; else `"healthy"` |

Output: `model_summary_df`
"""))

cells.append(code("""\
MODEL_SUMMARY_SCHEMA = StructType([
    StructField("model_id",    StringType(),  True),
    StructField("dat_ref",     StringType(),  False),
    StructField("global_psi",  DoubleType(),  True),
    StructField("max_psi",     DoubleType(),  True),
    StructField("global_perf", DoubleType(),  True),
    StructField("dq_score",    DoubleType(),  True),
    StructField("status",      StringType(),  True),
    StructField("n_features",  IntegerType(), True),
    StructField("n_drifted",   IntegerType(), True),
])
"""))

cells.append(code("""\
# ── Aggregate drift per dat_ref ───────────────────────────────────────────────
psi_agg_pd = (
    drift_df
    .groupBy("dat_ref")
    .agg(
        F.avg("psi").alias("global_psi"),
        F.max("psi").alias("max_psi"),
        F.count("*").alias("n_features"),
        F.sum(F.when(F.col("is_drifted"), 1).otherwise(0)).alias("n_drifted"),
    )
    .toPandas()
)

# ── Aggregate quality per dat_ref ─────────────────────────────────────────────
dq_agg_pd = (
    quality_df
    .groupBy("dat_ref")
    .agg(F.avg("missing_rate").alias("avg_missing"))
    .toPandas()
)

# ── Performance per dat_ref ───────────────────────────────────────────────────
perf_agg_pd = performance_df.select("dat_ref", "auc_roc", "r2").toPandas()

# ── Assemble summary ──────────────────────────────────────────────────────────
summary_rows = []

for dat_ref in selected_dates:
    psi_row  = psi_agg_pd[psi_agg_pd["dat_ref"] == dat_ref].iloc[0]
    dq_row   = dq_agg_pd[dq_agg_pd["dat_ref"] == dat_ref].iloc[0]
    perf_row = perf_agg_pd[perf_agg_pd["dat_ref"] == dat_ref].iloc[0]

    global_psi  = float(psi_row["global_psi"])
    max_psi     = float(psi_row["max_psi"])
    dq_score    = float(max(0.0, min(1.0, 1.0 - dq_row["avg_missing"])))

    if MODEL_TYPE == "classification":
        global_perf = float(perf_row["auc_roc"]) if perf_row["auc_roc"] is not None else None
    else:
        global_perf = float(perf_row["r2"]) if perf_row["r2"] is not None else None

    if max_psi >= PSI_CRIT_THRESHOLD:
        status = "critical"
    elif max_psi >= PSI_WARN_THRESHOLD:
        status = "warning"
    else:
        status = "healthy"

    summary_rows.append((
        MODEL_ID, dat_ref,
        global_psi, max_psi, global_perf, dq_score, status,
        int(psi_row["n_features"]),
        int(psi_row["n_drifted"]),
    ))

model_summary_df = spark.createDataFrame(summary_rows, schema=MODEL_SUMMARY_SCHEMA)
print(f"model_summary_df: {model_summary_df.count()} rows")
"""))

cells.append(code("""\
print("Model health progression across inference windows:")
model_summary_df.orderBy("dat_ref").show(truncate=False)
"""))

# ══ 14 · ALERT EVALUATION ════════════════════════════════════════════════════
cells.append(md("""## 13 · Alert Evaluation

Mirrors `_evaluate_alerts()` in `backend/app/engine/runner.py`.

Generates an `Alert` record for every `(feature, dat_ref)` pair where
`psi ≥ psi_warn_threshold`.  In a production system the cooldown check would
filter out duplicate alerts within the cooldown window — shown here as a note.

Output: `alerts_df` — schema matches the `Alert` table.
"""))

cells.append(code("""\
ALERT_SCHEMA = StructType([
    StructField("alert_id",          StringType(), True),
    StructField("model_id",          StringType(), True),
    StructField("run_id",            StringType(), True),
    StructField("dat_ref",           StringType(), False),
    StructField("severity",          StringType(), False),
    StructField("metric_name",       StringType(), False),
    StructField("metric_value",      DoubleType(), True),
    StructField("threshold",         DoubleType(), True),
    StructField("feature_name",      StringType(), True),
    StructField("message",           StringType(), True),
    StructField("status",            StringType(), True),
    StructField("notified_channels", StringType(), True),  # JSON
])

alert_rows = []

for row in drift_df.filter(F.col("psi") >= PSI_WARN_THRESHOLD).collect():
    psi = row["psi"]
    if psi >= PSI_CRIT_THRESHOLD:
        sev, threshold = "CRITICAL", PSI_CRIT_THRESHOLD
    else:
        sev, threshold = "WARNING",  PSI_WARN_THRESHOLD

    alert_rows.append((
        str(uuid.uuid4()),
        MODEL_ID, RUN_ID,
        row["dat_ref"], sev, "PSI",
        psi, float(threshold),
        row["feature_name"],
        (
            f"{sev}: PSI drift on '{row['feature_name']}' = {psi:.4f} "
            f"(threshold = {threshold})"
        ),
        "open",
        json.dumps(ALERT_CHANNELS),
    ))

alerts_df = spark.createDataFrame(alert_rows, schema=ALERT_SCHEMA)
print(f"alerts_df: {alerts_df.count()} alerts triggered")
"""))

cells.append(code("""\
print("Alerts by dat_ref and severity:")
alerts_df \\
    .select("dat_ref", "severity", "feature_name", "metric_value", "threshold", "status") \\
    .orderBy("dat_ref", "severity", F.desc("metric_value")) \\
    .show(60, truncate=False)
"""))

cells.append(code("""\
print("Alert counts per dat_ref:")
alerts_df \\
    .groupBy("dat_ref", "severity") \\
    .count() \\
    .orderBy("dat_ref", "severity") \\
    .show(truncate=False)
"""))

# ══ 15 · FINAL SUMMARY ═══════════════════════════════════════════════════════
cells.append(md("""## 14 · Final Summary

All five output DataFrames and their row counts.
"""))

cells.append(code("""\
print("=" * 70)
print("  MONITORING PIPELINE — OUTPUT DATAFRAMES")
print("=" * 70)
print()

outputs = [
    ("drift_df",         drift_df,         "DriftResult"),
    ("quality_df",       quality_df,       "QualityResult"),
    ("performance_df",   performance_df,   "PerformanceResult"),
    ("model_summary_df", model_summary_df, "Model (summary fields)"),
    ("alerts_df",        alerts_df,        "Alert"),
]

print(f"  {'DataFrame':<22}  {'Rows':>8}  {'DB Table'}")
print("-" * 55)
for name, df, table in outputs:
    print(f"  {name:<22}  {df.count():>8}  {table}")

print()
print("=" * 70)
print("  MODEL HEALTH PROGRESSION")
print("=" * 70)

header = (
    f"  {'dat_ref':<13}  {'GlobalPSI':>10}  {'MaxPSI':>9}  "
    f"{'AUC-ROC':>8}  {'DQ Score':>9}  {'Status':<10}  Drifted/Total"
)
print(header)
print("-" * len(header))

for row in model_summary_df.orderBy("dat_ref").collect():
    print(
        f"  {row['dat_ref']:<13}  "
        f"{row['global_psi']:>10.4f}  "
        f"{row['max_psi']:>9.4f}  "
        f"{row['global_perf']:>8.4f}  "
        f"{row['dq_score']:>9.4f}  "
        f"{row['status']:<10}  "
        f"{row['n_drifted']}/{row['n_features']}"
    )

print()
print("  Column mapping for MLMonitor model registration:")
print(f"    features       : {FEATURES}")
print(f"    prediction_col : {PREDICTION_COL!r}")
print(f"    target_col     : {TARGET_COL!r}")
print(f"    timestamp_col  : {TIMESTAMP_COL!r}")
"""))

cells.append(code("""\
# ── Keep Spark session alive for further exploration ──────────────────────────
print("Spark session is still running.  Use spark.stop() to shut it down.")
print()
print("Available DataFrames:")
print("  drift_df         — drift_df.show() / drift_df.filter(...).show()")
print("  quality_df       — quality_df.show()")
print("  performance_df   — performance_df.show()")
print("  model_summary_df — model_summary_df.show()")
print("  alerts_df        — alerts_df.show()")
"""))

# ─────────────────────────────────────────────────────────────────────────────
notebook = {
    "cells":    cells,
    "metadata": {
        "kernelspec": {
            "display_name": "Python 3",
            "language":     "python",
            "name":         "python3",
        },
        "language_info": {
            "name":    "python",
            "version": "3.12.0",
        },
    },
    "nbformat":       4,
    "nbformat_minor": 5,
}

with open(OUT, "w", encoding="utf-8") as f:
    json.dump(notebook, f, indent=1, ensure_ascii=False)

print(f"Written: {OUT}")
print(f"  {len(cells)} cells")
