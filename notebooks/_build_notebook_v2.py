"""
Builder script — generates monitoring_pipeline_v2.ipynb.
v2 differences from v1:
  - All sampling removed; every step processes the full dataset.
  - Wall-clock timing wrapper around every major section.
  - Observation/recommendation cells inserted wherever sampling removal
    has statistical or memory implications.
Run with: /Users/ryojikn/micromamba/bin/python3 _build_notebook_v2.py
"""
import json, uuid, os

OUT = os.path.join(os.path.dirname(__file__), "monitoring_pipeline_v2.ipynb")


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


cells = []

# ══ TITLE ════════════════════════════════════════════════════════════════════
cells.append(md("""
# MLMonitor — Monitoring Pipeline v2 · Full Dataset · No Sampling

**Differences from v1:**
- All `.sample()` calls removed — every computation operates on the **full dataset**.
- Wall-clock timing (`⏱`) recorded at every major step so you can profile real execution time.
- Observation cells (`> ⚠️ Nota`) inserted wherever removing sampling creates statistical
  or memory trade-offs, with concrete recommendations.

| Step | What happens |
|------|--------------|
| 0 | Install deps |
| 1 | Configuration |
| 2 | Spark session (`local[*]`) |
| 3 | Load Delta parquet datasets |
| 4 | Feature type detection |
| 5 | Data quality — full scan |
| 6–7 | Histogram construction — full scan |
| 8 | PSI |
| 9 | KS · JSD · Wasserstein · Chi² |
| 10 | Drift results DataFrame |
| 11 | Prediction drift |
| 12 | Performance metrics — **full collect, no sample** |
| 13 | Model summary |
| 14 | Alert evaluation |
| 15 | Timing summary |

All outputs are **Spark DataFrames** whose schemas mirror the DB tables in
`backend/app/db/models.py`.
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

All tuneable parameters in one place.
"""))

cells.append(code("""\
import os

DATA_DIR       = os.path.abspath("../data")
BASELINE_PATH  = f"{DATA_DIR}/baseline"
INFERENCE_PATH = f"{DATA_DIR}/inference"

print(f"Baseline  : {BASELINE_PATH}")
print(f"Inference : {INFERENCE_PATH}")
"""))

cells.append(code("""\
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
    "timestamp_col":  "dat_ref",
}

FEATURES             = COLUMN_MAPPING["features"]
PREDICTION_COL       = COLUMN_MAPPING["prediction_col"]
PREDICTION_SCORE_COL = "prediction_score"   # float probability score for AUC-ROC
TARGET_COL           = COLUMN_MAPPING["target_col"]
TIMESTAMP_COL        = COLUMN_MAPPING["timestamp_col"]

print(f"Features             : {FEATURES}")
print(f"Prediction col       : {PREDICTION_COL}")
print(f"Prediction score col : {PREDICTION_SCORE_COL}")
print(f"Target col           : {TARGET_COL}")
print(f"Timestamp col        : {TIMESTAMP_COL}")
"""))

cells.append(code("""\
MODEL_TYPE           = "classification"
PSI_WARN_THRESHOLD   = 0.10
PSI_CRIT_THRESHOLD   = 0.25
N_BINS               = 10
EPS                  = 1e-6
ALERT_COOLDOWN_HOURS = 6
ALERT_CHANNELS       = ["slack", "email"]

# Inference windows to process — None = all available dat_ref partitions
INFERENCE_DATES = None

print("Monitoring config:")
print(f"  model_type         = {MODEL_TYPE}")
print(f"  psi_warn_threshold = {PSI_WARN_THRESHOLD}")
print(f"  psi_crit_threshold = {PSI_CRIT_THRESHOLD}")
print(f"  n_bins             = {N_BINS}")
print()
print("  ⚠️  v2: SAMPLE_SIZE removed — all steps process the full dataset.")
"""))

# ── Imports ───────────────────────────────────────────────────────────────────
cells.append(md("### Imports"))

cells.append(code("""\
import json, uuid, time, warnings
from collections import defaultdict

import numpy as np
import pandas as pd

from scipy.stats            import chi2_contingency, wasserstein_distance
from scipy.spatial.distance import jensenshannon
from sklearn.metrics        import (
    accuracy_score, f1_score, precision_score, recall_score, roc_auc_score,
)

from pyspark.sql        import SparkSession
from pyspark.sql        import functions as F
from pyspark.sql.types  import (
    StructType, StructField,
    StringType, DoubleType,
    IntegerType, LongType, BooleanType,
)
from pyspark.ml.feature import Bucketizer

warnings.filterwarnings("ignore")

# ── Global timing registry ────────────────────────────────────────────────────
TIMINGS = {}   # section_name → elapsed seconds

print("All imports OK.")
"""))

# ══ 2 · SPARK SESSION ════════════════════════════════════════════════════════
cells.append(md("""## 2 · Spark Session (local[\\*])

Running fully local — no cluster, no sampling.
Delta tables are partitioned parquet, readable with `spark.read.parquet()` directly.
"""))

cells.append(code("""\
import os, sys

os.environ["PYSPARK_PYTHON"]        = sys.executable
os.environ["PYSPARK_DRIVER_PYTHON"] = sys.executable
os.environ["JAVA_HOME"]             = os.environ.get(
    "JAVA_HOME", "/opt/homebrew/opt/openjdk@17"
)

_t = time.time()
spark = (
    SparkSession.builder
    .master("local[*]")
    .appName("MLMonitor — Pipeline v2 (full dataset)")
    .config("spark.driver.memory",           "8g")
    .config("spark.sql.shuffle.partitions",  "8")
    .config("spark.ui.showConsoleProgress",  "false")
    .config("spark.sql.execution.arrow.pyspark.enabled", "true")
    .getOrCreate()
)
spark.sparkContext.setLogLevel("WARN")
TIMINGS["spark_init"] = time.time() - _t

print(f"Spark {spark.version}  |  master = local[*]")
print(f"Driver memory : {spark.conf.get('spark.driver.memory')}")
print(f"⏱ Spark init  : {TIMINGS['spark_init']:.1f}s")
"""))

# ══ 3 · DATA LOADING ═════════════════════════════════════════════════════════
cells.append(md("""## 3 · Data Loading

```
data/baseline/   dat_ref=01-09-2025/  *.snappy.parquet   (500 000 rows)
data/inference/  dat_ref=01-10-2025/  *.snappy.parquet   (5 000 000 rows each)
                 ...
                 dat_ref=01-03-2026/
```
"""))

cells.append(code("""\
_t = time.time()

df_baseline       = spark.read.parquet(BASELINE_PATH)
baseline_count    = df_baseline.count()

df_inference_full = spark.read.parquet(INFERENCE_PATH)
available_dates   = sorted([
    r[TIMESTAMP_COL]
    for r in df_inference_full.select(TIMESTAMP_COL).distinct().collect()
])

selected_dates = INFERENCE_DATES if INFERENCE_DATES else available_dates
df_inference   = df_inference_full.filter(F.col(TIMESTAMP_COL).isin(selected_dates))
inference_count= df_inference.count()

TIMINGS["data_load"] = time.time() - _t

print(f"Baseline  : {baseline_count:>12,} rows   dat_ref = 01-09-2025")
print(f"Inference : {inference_count:>12,} rows   across {len(selected_dates)} windows")
print(f"\\nWindows : {selected_dates}")
print(f"\\n⏱ Data load : {TIMINGS['data_load']:.1f}s")
"""))

cells.append(code("""\
print("Schema:")
df_baseline.printSchema()
"""))

cells.append(code("""\
print(f"{'dat_ref':<15}  {'rows':>12}")
print("-" * 30)
for d in selected_dates:
    n = df_inference.filter(F.col(TIMESTAMP_COL) == d).count()
    print(f"  {d:<13}  {n:>12,}")
"""))

cells.append(code("""\
print("Baseline (3 rows):")
df_baseline.show(3, truncate=False)
print(f"Inference — {selected_dates[0]} (3 rows):")
df_inference.filter(F.col(TIMESTAMP_COL) == selected_dates[0]).show(3, truncate=False)
"""))

# ══ 4 · FEATURE TYPE DETECTION ═══════════════════════════════════════════════
cells.append(md("""## 4 · Feature Type Detection

Mirrors `_is_categorical()` in `backend/app/engine/drift.py`.
Full distinct count on baseline — no approximation.
"""))

cells.append(code("""\
_t = time.time()

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
TIMINGS["type_detection"] = time.time() - _t

print(f"Numeric     ({len(NUMERIC_FEATURES)}): {NUMERIC_FEATURES}")
print(f"Categorical ({len(CATEGORICAL_FEATURES)}): {CATEGORICAL_FEATURES}")
print(f"\\n⏱ Type detection : {TIMINGS['type_detection']:.1f}s")
"""))

# ══ 5 · DATA QUALITY ═════════════════════════════════════════════════════════
cells.append(md("""## 5 · Data Quality

Full scan per feature per `dat_ref` window — no sampling.

| Metric | Formula | Spark operation |
|--------|---------|----------------|
| `missing_rate` | `null_count / total_count` | `.filter(isNull).count()` |
| `outlier_rate` | IQR method | `approxQuantile` → filter |
| `null_count` | raw nulls | `.filter(isNull).count()` |
| `total_count` | window rows | `.count()` |

> **`approxQuantile`** uses Greenwald–Khanna streaming sketches with a configurable
> `relativeError` (set to `0.001` here). This is an **approximation**, not an
> exact quantile — intentional for scalability. It does **not** sample rows;
> it passes over all rows in a single Spark job.
> **Recommendation:** keep `relativeError ≤ 0.01` for production. Use `0.0` only
> on datasets that fit comfortably in driver memory (triggers a full sort).
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
_t = time.time()
quality_rows = []

for dat_ref in selected_dates:
    _tw = time.time()
    df_window   = df_inference.filter(F.col(TIMESTAMP_COL) == dat_ref)
    total_count = df_window.count()

    for feat in FEATURES:
        null_count   = df_window.filter(F.col(feat).isNull()).count()
        missing_rate = null_count / total_count if total_count > 0 else 0.0

        outlier_rate = 0.0
        if feat in NUMERIC_FEATURES:
            q1, q3 = df_window.approxQuantile(feat, [0.25, 0.75], 0.001)
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

    print(f"  [{dat_ref}] {len(FEATURES)} features  ⏱ {time.time()-_tw:.1f}s")

quality_df = spark.createDataFrame(quality_rows, schema=QUALITY_SCHEMA)
TIMINGS["data_quality"] = time.time() - _t
print(f"\\nquality_df: {quality_df.count()} rows")
print(f"⏱ Data quality total : {TIMINGS['data_quality']:.1f}s")
"""))

cells.append(code("""\
print("Missing rate — pivot by feature × window:")
quality_df \\
    .groupBy("feature_name").pivot("dat_ref") \\
    .agg(F.round(F.first("missing_rate"), 6)) \\
    .orderBy("feature_name").show(truncate=False)

print("Outlier rate — pivot by feature × window:")
quality_df \\
    .groupBy("feature_name").pivot("dat_ref") \\
    .agg(F.round(F.first("outlier_rate"), 4)) \\
    .orderBy("feature_name").show(truncate=False)
"""))

# ══ 6 · BASELINE HISTOGRAMS ══════════════════════════════════════════════════
cells.append(md("""## 6 · Baseline Histogram Construction

Full scan of all 500 000 baseline rows via `approxQuantile` + `Bucketizer`.
Bin edges computed once and reused for every inference window.

> **Nota — `approxQuantile` accuracy:**
> Bin boundaries are approximate (Greenwald–Khanna, `relativeError=0.001`).
> This introduces a small, bounded error in PSI / KS / JSD values.
> For exact bin edges pass `relativeError=0.0`, but this forces a full sort
> and collects all values to the driver — only feasible for small baselines.
> **Recommendation:** `relativeError=0.001` is the right trade-off for
> production baselines with millions of rows.
"""))

cells.append(code("""\
def make_bins(df, feature, n_bins=10, relative_error=0.001):
    quantiles = [i / n_bins for i in range(n_bins + 1)]
    edges = df.approxQuantile(feature, quantiles, relative_error)
    edges = sorted(set(edges))
    if len(edges) < 2:
        return None
    edges[0]  = float("-inf")
    edges[-1] = float("inf")
    return edges


def bin_counts_numeric(df, feature, edges):
    bucket_col = f"__bucket_{feature}"
    bucketizer = Bucketizer(
        splits=edges, inputCol=feature, outputCol=bucket_col, handleInvalid="skip",
    )
    bucketed   = bucketizer.transform(df.select(feature))
    n_bins     = len(edges) - 1
    counts_map = {
        int(r[bucket_col]): int(r["count"])
        for r in bucketed.groupBy(bucket_col).count().collect()
    }
    return [counts_map.get(i, 0) for i in range(n_bins)]


def bin_counts_categorical(df, feature):
    rows       = df.groupBy(feature).count().collect()
    levels     = sorted(str(r[feature]) for r in rows)
    counts_map = {str(r[feature]): int(r["count"]) for r in rows}
    return levels, [counts_map.get(lv, 0) for lv in levels]
"""))

cells.append(code("""\
_t = time.time()
baseline_histograms = {}

for feat in NUMERIC_FEATURES:
    edges = make_bins(df_baseline, feat, N_BINS)
    if edges is None:
        print(f"  WARN: could not build bins for {feat}")
        continue
    counts = bin_counts_numeric(df_baseline, feat, edges)
    baseline_histograms[feat] = {"type": "numeric",  "edges": edges, "counts": counts}

for feat in CATEGORICAL_FEATURES:
    levels, counts = bin_counts_categorical(df_baseline, feat)
    baseline_histograms[feat] = {"type": "categorical", "levels": levels, "counts": counts}

TIMINGS["baseline_histograms"] = time.time() - _t

print(f"{'Feature':<25}  {'Type':<12}  {'Bins':>5}  {'Total rows':>12}")
print("-" * 60)
for feat, h in baseline_histograms.items():
    print(f"  {feat:<23}  {h['type']:<12}  {len(h['counts']):>5}  {sum(h['counts']):>12,}")
print(f"\\n⏱ Baseline histograms : {TIMINGS['baseline_histograms']:.1f}s")
"""))

# ══ 7 · INFERENCE BIN COUNTS ══════════════════════════════════════════════════
cells.append(md("""## 7 · Inference Bin Counts (per dat_ref window)

Full scan of each 5 000 000-row window using the baseline bin boundaries.
No rows are dropped or sampled.
"""))

cells.append(code("""\
_t = time.time()
inference_histograms = defaultdict(dict)

for dat_ref in selected_dates:
    _tw = time.time()
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

    print(f"  [{dat_ref}] {len(inference_histograms[dat_ref])} features  ⏱ {time.time()-_tw:.1f}s")

TIMINGS["inference_histograms"] = time.time() - _t
print(f"\\n⏱ Inference histograms total : {TIMINGS['inference_histograms']:.1f}s")
"""))

# ══ 8 · PSI ══════════════════════════════════════════════════════════════════
cells.append(md("""## 8 · PSI — Population Stability Index

Computed from full histogram counts (no sampling at any stage).

```
PSI = Σ (cur_pct[i] − base_pct[i]) × ln(cur_pct[i] / base_pct[i])
```

> **Nota — accuracy of histogram-based PSI:**
> PSI here is computed from binned counts (10 quantile bins), not the raw
> continuous distribution. Bin granularity (`N_BINS`) controls the resolution.
> Increasing `N_BINS` (e.g., 20–50) improves accuracy at the cost of more
> Spark jobs per feature.
> The ε floor (`1e-6`) prevents `log(0)` when a bin is empty in one split.
> This is consistent with `backend/app/engine/drift.py`.

| PSI | Severity |
|-----|----------|
| `< 0.10` | stable |
| `0.10 – 0.25` | warning |
| `≥ 0.25` | critical |
"""))

cells.append(code("""\
def compute_psi(base_counts, cur_counts, eps=EPS):
    base     = np.array(base_counts, dtype=float)
    cur      = np.array(cur_counts,  dtype=float)
    base_pct = np.maximum(base / base.sum(), eps)
    cur_pct  = np.maximum(cur  / cur.sum(),  eps)
    return float(np.sum((cur_pct - base_pct) * np.log(cur_pct / base_pct)))


def psi_severity(psi, warn=PSI_WARN_THRESHOLD, crit=PSI_CRIT_THRESHOLD):
    if psi >= crit:  return "critical"
    if psi >= warn:  return "warning"
    return "stable"
"""))

cells.append(code("""\
header = f"{'Feature':<25}" + "".join(f"  {d[:5]:>8}" for d in selected_dates)
print(header)
print("-" * len(header))
for feat in FEATURES:
    row = f"  {feat:<23}"
    for dat_ref in selected_dates:
        h_base = baseline_histograms.get(feat)
        h_cur  = inference_histograms[dat_ref].get(feat)
        psi    = compute_psi(h_base["counts"], h_cur["counts"]) if h_base and h_cur else None
        row   += f"  {psi:>8.4f}" if psi is not None else f"  {'N/A':>8}"
    print(row)
"""))

# ══ 9 · KS · JSD · WASSERSTEIN · CHI² ══════════════════════════════════════
cells.append(md("""## 9 · Statistical Drift Metrics

All four metrics are computed from **histogram bin counts collected to the driver** —
no raw rows are transferred.  This is the scalable pattern for distributed datasets:
only `O(n_bins)` integers cross the Spark → driver boundary per feature per window.

| Metric | Formula | Applicable | Notes |
|--------|---------|------------|-------|
| KS stat | `max\\|CDF_base − CDF_cur\\|` from bin CDFs | numeric | Approximate — see note |
| JSD | `jensenshannon(base_pct, cur_pct)²` | all | |
| Wasserstein | `wasserstein(midpoints, weights) / σ_baseline` | numeric | Approximate — see note |
| Chi² | `chi2_contingency([base_counts, cur_counts])` | categorical | |

> **⚠️ Nota — KS test (approximate, histogram-based):**
> The classic KS test operates on the **empirical CDF of raw values**.
> Here the CDF is reconstructed from histogram bin counts (10 bins by default),
> which makes it a **binned approximation**. The statistic underestimates the
> true KS distance because fine-grained differences within a bin are invisible.
>
> **Recommendations:**
> - Increase `N_BINS` (e.g., 50–100) to reduce approximation error.
> - For exact KS on numeric features, use a Spark pandas UDF:
>   `@pandas_udf(returnType=...)` over the raw column — this keeps the
>   computation distributed without collecting all rows to the driver.
> - Alternatively, collect a large representative sample (e.g., 500k rows)
>   via stratified sampling and run `scipy.stats.ks_2samp`.

> **⚠️ Nota — Wasserstein (approximate, midpoint representation):**
> The Wasserstein distance here uses bin midpoints as representative values
> weighted by normalized bin counts. This is a valid approximation for the
> Earth Mover's Distance when bins are narrow and data is smooth.
> For heavy-tailed or multimodal distributions, finer binning (`N_BINS ≥ 50`)
> or exact computation via sorted raw arrays is more accurate.
"""))

cells.append(code("""\
def compute_ks_from_hist(base_counts, cur_counts):
    \"\"\"KS statistic from empirical CDFs derived from histogram counts (approximate).\"\"\"
    base     = np.array(base_counts, dtype=float)
    cur      = np.array(cur_counts,  dtype=float)
    base_cdf = np.cumsum(base / base.sum())
    cur_cdf  = np.cumsum(cur  / cur.sum())
    return float(np.max(np.abs(base_cdf - cur_cdf)))


def compute_jsd(base_counts, cur_counts, eps=EPS):
    base     = np.maximum(np.array(base_counts, dtype=float), eps)
    cur      = np.maximum(np.array(cur_counts,  dtype=float), eps)
    base_pct = base / base.sum()
    cur_pct  = cur  / cur.sum()
    return float(jensenshannon(base_pct, cur_pct) ** 2)


def compute_wasserstein_from_hist(edges, base_counts, cur_counts):
    \"\"\"Wasserstein on bin midpoints, normalised by baseline std (approximate).\"\"\"
    finite_edges = [e for e in edges if np.isfinite(e)]
    if len(finite_edges) < 2:
        return 0.0
    midpoints = np.array([
        (finite_edges[i] + finite_edges[i + 1]) / 2.0
        for i in range(len(finite_edges) - 1)
    ])
    n      = len(midpoints)
    base_c = np.array(base_counts[1: n + 1], dtype=float)
    cur_c  = np.array(cur_counts[1:  n + 1], dtype=float)
    base_w = base_c / base_c.sum() if base_c.sum() > 0 else np.ones(n) / n
    cur_w  = cur_c  / cur_c.sum()  if cur_c.sum()  > 0 else np.ones(n) / n
    mean_b = np.average(midpoints, weights=base_w)
    std_b  = np.sqrt(np.average((midpoints - mean_b) ** 2, weights=base_w))
    raw    = wasserstein_distance(midpoints, midpoints, base_w, cur_w)
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

Schema matches `DriftResult` in `backend/app/db/models.py`.
Histogram JSON columns are included for rendering in the Distribution Comparison Modal.
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
    StructField("baseline_histogram", StringType(),  True),
    StructField("current_histogram",  StringType(),  True),
])
"""))

cells.append(code("""\
_t = time.time()
drift_rows = []

for dat_ref in selected_dates:
    for feat in FEATURES:
        h_base = baseline_histograms.get(feat)
        h_cur  = inference_histograms[dat_ref].get(feat)
        if not h_base or not h_cur:
            continue

        base_counts = h_base["counts"]
        cur_counts  = h_cur["counts"]

        psi     = compute_psi(base_counts, cur_counts)
        sev     = psi_severity(psi)
        ks_stat = compute_ks_from_hist(base_counts, cur_counts)
        jsd     = compute_jsd(base_counts, cur_counts)

        wass = 0.0
        if feat in NUMERIC_FEATURES:
            wass = compute_wasserstein_from_hist(h_base["edges"], base_counts, cur_counts)

        chi2_s, chi2_p = None, None
        if feat in CATEGORICAL_FEATURES:
            chi2_s, chi2_p = compute_chi2(base_counts, cur_counts)

        if feat in NUMERIC_FEATURES:
            bins_repr = [str(round(e, 4)) if np.isfinite(e) else str(e) for e in h_base["edges"]]
        else:
            bins_repr = h_base["levels"]

        drift_rows.append((
            RUN_ID, MODEL_ID, feat, dat_ref,
            psi, ks_stat, jsd, wass,
            chi2_s, chi2_p,
            bool(psi >= PSI_WARN_THRESHOLD),
            sev,
            json.dumps({"bins": bins_repr, "counts": base_counts}),
            json.dumps({"bins": bins_repr, "counts": cur_counts}),
        ))

drift_df = spark.createDataFrame(drift_rows, schema=DRIFT_SCHEMA)
TIMINGS["drift_assembly"] = time.time() - _t
print(f"drift_df: {drift_df.count()} rows  "
      f"({len(FEATURES)} features × {len(selected_dates)} windows)")
print(f"⏱ Drift assembly : {TIMINGS['drift_assembly']:.1f}s")
"""))

cells.append(code("""\
print("Drift metrics — PSI, KS, JSD, Wasserstein:")
drift_df.select("feature_name", "dat_ref", "psi", "ks_stat", "jsd", "wasserstein", "severity") \\
        .orderBy("dat_ref", F.desc("psi")).show(60, truncate=False)
"""))

cells.append(code("""\
print("Chi² — categorical features only:")
drift_df.filter(F.col("chi2_stat").isNotNull()) \\
        .select("feature_name", "dat_ref", "psi", "chi2_stat", "chi2_pvalue", "severity") \\
        .orderBy("dat_ref", F.desc("psi")).show(truncate=False)
"""))

cells.append(code("""\
print("Severity distribution per window:")
drift_df.groupBy("dat_ref", "severity").count() \\
        .orderBy("dat_ref", "severity").show(truncate=False)
"""))

# ══ 11 · PREDICTION DRIFT ════════════════════════════════════════════════════
cells.append(md("""## 11 · Prediction Drift

PSI on the `prediction` column — full group-by count on each window.
No sampling involved; category counts are exact.
"""))

cells.append(code("""\
_t = time.time()

base_pred_rows = df_baseline.groupBy(PREDICTION_COL).count().collect()
base_pred_map  = {str(r[PREDICTION_COL]): int(r["count"]) for r in base_pred_rows}
pred_drift_map = {}

for dat_ref in selected_dates:
    df_window    = df_inference.filter(F.col(TIMESTAMP_COL) == dat_ref)
    cur_rows     = df_window.groupBy(PREDICTION_COL).count().collect()
    cur_pred_map = {str(r[PREDICTION_COL]): int(r["count"]) for r in cur_rows}
    all_levels   = sorted(set(base_pred_map) | set(cur_pred_map))
    pred_psi     = compute_psi(
        [base_pred_map.get(lv, 0) for lv in all_levels],
        [cur_pred_map.get(lv, 0)  for lv in all_levels],
    )
    pred_drift_map[dat_ref] = pred_psi

TIMINGS["prediction_drift"] = time.time() - _t

print(f"{'dat_ref':<15}  {'prediction_psi':>15}  severity")
print("-" * 45)
for d, psi in pred_drift_map.items():
    print(f"  {d:<13}  {psi:>15.4f}  {psi_severity(psi)}")
print(f"\\n⏱ Prediction drift : {TIMINGS['prediction_drift']:.1f}s")
"""))

# ══ 12 · PERFORMANCE METRICS ═════════════════════════════════════════════════
cells.append(md("""## 12 · Performance Metrics (Classification) — Full Collect

> **⚠️ Nota — full `.toPandas()` collect (sampling removed):**
> This step collects **all** `(target, prediction)` rows from each inference
> window to the driver in order to compute sklearn metrics.
>
> | Window size | Columns | dtype | Approx. driver RAM |
> |-------------|---------|-------|--------------------|
> | 5 000 000   | 2 × int8| int8  | ~10 MB raw / ~40 MB pandas |
>
> For the current dataset (5M rows × 2 int8 columns) this is safe in local
> mode with `spark.driver.memory = 8g`.
>
> **Recommendation for larger datasets (> 50M rows per window):**
> Replace sklearn with **Spark MLlib evaluators** — they run distributed and
> never collect raw rows to the driver:
> ```python
> from pyspark.ml.evaluation import (
>     BinaryClassificationEvaluator,   # AUC-ROC
>     MulticlassClassificationEvaluator,  # accuracy, F1, precision, recall
> )
> evaluator = BinaryClassificationEvaluator(
>     labelCol=TARGET_COL, rawPredictionCol=PREDICTION_COL
> )
> auc = evaluator.evaluate(df_window)
> ```
> MLlib evaluators require the prediction column to be `DoubleType`; cast with
> `F.col(PREDICTION_COL).cast("double")` before passing to the evaluator.
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
    StructField("r2",             DoubleType(), True),
    StructField("mae",            DoubleType(), True),
    StructField("rmse",           DoubleType(), True),
    StructField("prediction_psi", DoubleType(), True),
])
"""))

cells.append(code("""\
_t = time.time()
perf_rows = []

for dat_ref in selected_dates:
    _tw = time.time()
    df_window = df_inference.filter(F.col(TIMESTAMP_COL) == dat_ref)
    n_total   = df_window.count()

    # ── Full collect — no sampling ────────────────────────────────────────────
    full_pd = (
        df_window
        .select(TARGET_COL, PREDICTION_COL, PREDICTION_SCORE_COL)
        .toPandas()
    )

    y_true  = full_pd[TARGET_COL].astype(int).values
    y_pred  = full_pd[PREDICTION_COL].astype(int).values
    y_score = full_pd[PREDICTION_SCORE_COL].values   # float probability for AUC-ROC

    acc   = float(accuracy_score(y_true, y_pred))
    f1    = float(f1_score(y_true, y_pred,        average="weighted", zero_division=0))
    prec  = float(precision_score(y_true, y_pred, average="weighted", zero_division=0))
    rec   = float(recall_score(y_true, y_pred,    average="weighted", zero_division=0))
    try:
        auc = float(roc_auc_score(y_true, y_score))
    except Exception:
        auc = None

    perf_rows.append((
        RUN_ID, MODEL_ID, dat_ref,
        acc, f1, auc, prec, rec,
        None, None, None,
        pred_drift_map.get(dat_ref),
    ))

    auc_str = f"{auc:.4f}" if auc is not None else "N/A"
    print(
        f"  [{dat_ref}]  n_full={n_total:>9,}  "
        f"acc={acc:.4f}  f1={f1:.4f}  auc={auc_str}  "
        f"⏱ {time.time()-_tw:.1f}s"
    )

performance_df = spark.createDataFrame(perf_rows, schema=PERF_SCHEMA)
TIMINGS["performance"] = time.time() - _t
print(f"\\nperformance_df: {performance_df.count()} rows")
print(f"⏱ Performance total : {TIMINGS['performance']:.1f}s")
"""))

cells.append(code("""\
print("Performance metrics per dat_ref:")
performance_df.select(
    "dat_ref", "accuracy", "f1_score", "auc_roc",
    "precision", "recall", "prediction_psi"
).show(truncate=False)
"""))

# ══ 13 · MODEL SUMMARY ═══════════════════════════════════════════════════════
cells.append(md("""## 13 · Model Summary per dat_ref

Aggregates from drift_df, quality_df, and performance_df.
All aggregations run as Spark jobs over the in-memory DataFrames.
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
_t = time.time()

psi_agg_pd = (
    drift_df.groupBy("dat_ref")
    .agg(
        F.avg("psi").alias("global_psi"),
        F.max("psi").alias("max_psi"),
        F.count("*").alias("n_features"),
        F.sum(F.when(F.col("is_drifted"), 1).otherwise(0)).alias("n_drifted"),
    ).toPandas()
)

dq_agg_pd = (
    quality_df.groupBy("dat_ref")
    .agg(F.avg("missing_rate").alias("avg_missing"))
    .toPandas()
)

perf_agg_pd = performance_df.select("dat_ref", "auc_roc", "r2").toPandas()

summary_rows = []
for dat_ref in selected_dates:
    psi_row  = psi_agg_pd[psi_agg_pd["dat_ref"] == dat_ref].iloc[0]
    dq_row   = dq_agg_pd[dq_agg_pd["dat_ref"] == dat_ref].iloc[0]
    perf_row = perf_agg_pd[perf_agg_pd["dat_ref"] == dat_ref].iloc[0]

    global_psi  = float(psi_row["global_psi"])
    max_psi     = float(psi_row["max_psi"])
    dq_score    = float(max(0.0, min(1.0, 1.0 - dq_row["avg_missing"])))
    global_perf = (
        float(perf_row["auc_roc"]) if MODEL_TYPE == "classification" and perf_row["auc_roc"] is not None
        else float(perf_row["r2"]) if perf_row["r2"] is not None else None
    )

    if max_psi >= PSI_CRIT_THRESHOLD:   status = "critical"
    elif max_psi >= PSI_WARN_THRESHOLD: status = "warning"
    else:                               status = "healthy"

    summary_rows.append((
        MODEL_ID, dat_ref,
        global_psi, max_psi, global_perf, dq_score, status,
        int(psi_row["n_features"]), int(psi_row["n_drifted"]),
    ))

model_summary_df = spark.createDataFrame(summary_rows, schema=MODEL_SUMMARY_SCHEMA)
TIMINGS["model_summary"] = time.time() - _t
print(f"model_summary_df: {model_summary_df.count()} rows")
print(f"⏱ Model summary : {TIMINGS['model_summary']:.1f}s")
"""))

cells.append(code("""\
print("Model health progression:")
model_summary_df.orderBy("dat_ref").show(truncate=False)
"""))

# ══ 14 · ALERT EVALUATION ════════════════════════════════════════════════════
cells.append(md("""## 14 · Alert Evaluation

Collects drift rows where `psi ≥ psi_warn_threshold` from `drift_df`.
The collect is over the small result set (≤ n_features × n_windows rows),
not the raw data — no sampling concern here.
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
    StructField("notified_channels", StringType(), True),
])

_t = time.time()
alert_rows = []

for row in drift_df.filter(F.col("psi") >= PSI_WARN_THRESHOLD).collect():
    psi = row["psi"]
    sev, threshold = (
        ("CRITICAL", PSI_CRIT_THRESHOLD) if psi >= PSI_CRIT_THRESHOLD
        else ("WARNING", PSI_WARN_THRESHOLD)
    )
    alert_rows.append((
        str(uuid.uuid4()), MODEL_ID, RUN_ID,
        row["dat_ref"], sev, "PSI",
        psi, float(threshold),
        row["feature_name"],
        f"{sev}: PSI on '{row['feature_name']}' = {psi:.4f} (threshold={threshold})",
        "open",
        json.dumps(ALERT_CHANNELS),
    ))

alerts_df = spark.createDataFrame(alert_rows, schema=ALERT_SCHEMA)
TIMINGS["alerts"] = time.time() - _t
print(f"alerts_df: {alerts_df.count()} alerts triggered")
print(f"⏱ Alert evaluation : {TIMINGS['alerts']:.1f}s")
"""))

cells.append(code("""\
alerts_df \\
    .select("dat_ref", "severity", "feature_name", "metric_value", "threshold", "status") \\
    .orderBy("dat_ref", "severity", F.desc("metric_value")) \\
    .show(60, truncate=False)
"""))

cells.append(code("""\
print("Alert counts per window:")
alerts_df.groupBy("dat_ref", "severity").count() \\
         .orderBy("dat_ref", "severity").show(truncate=False)
"""))

# ══ 15 · TIMING SUMMARY ══════════════════════════════════════════════════════
cells.append(md("""## 15 · Timing Summary

Wall-clock time per pipeline section, measured on `local[*]` with the full
500 000-row baseline and 5 000 000-row inference windows.
"""))

cells.append(code("""\
print("=" * 60)
print("  PIPELINE TIMING SUMMARY (local[*], full dataset)")
print("=" * 60)
print(f"  {'Section':<30}  {'Elapsed':>10}")
print("-" * 46)
total_wall = 0.0
for section, elapsed in TIMINGS.items():
    print(f"  {section:<30}  {elapsed:>9.1f}s")
    total_wall += elapsed
print("-" * 46)
print(f"  {'TOTAL':<30}  {total_wall:>9.1f}s")
print("=" * 60)

print()
print("Output DataFrames:")
print(f"  {'DataFrame':<22}  {'Rows':>8}  DB Table")
print("-" * 52)
for name, df, table in [
    ("drift_df",         drift_df,         "DriftResult"),
    ("quality_df",       quality_df,       "QualityResult"),
    ("performance_df",   performance_df,   "PerformanceResult"),
    ("model_summary_df", model_summary_df, "Model (summary)"),
    ("alerts_df",        alerts_df,        "Alert"),
]:
    print(f"  {name:<22}  {df.count():>8}  {table}")
"""))

cells.append(code("""\
print("Model health — full dataset results:")
print()
print(f"  {'dat_ref':<13}  {'GlobalPSI':>10}  {'MaxPSI':>9}  "
      f"{'AUC-ROC':>8}  {'DQScore':>8}  {'Status':<10}  Drifted/N")
print("-" * 80)
for row in model_summary_df.orderBy("dat_ref").collect():
    print(
        f"  {row['dat_ref']:<13}  "
        f"{row['global_psi']:>10.4f}  "
        f"{row['max_psi']:>9.4f}  "
        f"{row['global_perf']:>8.4f}  "
        f"{row['dq_score']:>8.4f}  "
        f"{row['status']:<10}  "
        f"{row['n_drifted']}/{row['n_features']}"
    )
"""))

cells.append(code("""\
print("Spark session still running.")
print("Use spark.stop() to shut it down when done.")
"""))

# ─────────────────────────────────────────────────────────────────────────────
notebook = {
    "cells": cells,
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
