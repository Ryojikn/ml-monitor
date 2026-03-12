"""
Dataset generator for MLMonitor.

Produces two Delta Lake tables:
  data/baseline/   — 500 000 rows, dat_ref = "01-09-2025"
  data/inference/  — 5 000 000 rows × 6 monthly snapshots
                     dat_ref ∈ {01-10-2025 … 01-03-2026}

Features mirror the credit-risk model used throughout the project docs:
  Numeric   : age, income, credit_score, loan_amount, interest_rate, debt_to_income
  Categorical: employment_status, loan_purpose, home_ownership
  Target cols: prediction (model output), target (ground truth)
  Temporal  : dat_ref (dd-mm-YYYY string)

Drift is introduced incrementally across the inference snapshots to make
the monitoring views meaningful.
"""

import os, time
import numpy as np
import pyarrow as pa
from deltalake import write_deltalake

# ── reproducibility ──────────────────────────────────────────────────────────
RNG_SEED = 42

# ── paths ────────────────────────────────────────────────────────────────────
BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
BASELINE_PATH = os.path.join(BASE_DIR, "baseline")
INFERENCE_PATH= os.path.join(BASE_DIR, "inference")

# ── sizes ────────────────────────────────────────────────────────────────────
N_BASELINE        = 500_000
N_INFERENCE_PER   = 5_000_000
INFERENCE_DATES   = [
    "01-10-2025",
    "01-11-2025",
    "01-12-2025",
    "01-01-2026",
    "01-02-2026",
    "01-03-2026",
]

# ── baseline feature distributions (reference statistics) ────────────────────
BASE_DIST = dict(
    age_mean            = 42.0,
    age_std             = 12.0,
    income_mean         = 72_000.0,
    income_std          = 28_000.0,
    credit_score_mean   = 690.0,
    credit_score_std    = 70.0,
    loan_amount_mean    = 22_000.0,
    loan_amount_std     = 14_000.0,
    interest_rate_mean  = 9.5,
    interest_rate_std   = 3.5,
    dti_mean            = 0.32,
    dti_std             = 0.12,
    # categorical weights
    employ_weights      = [0.72, 0.18, 0.10],   # employed / self_employed / unemployed
    purpose_weights     = [0.35, 0.25, 0.20, 0.12, 0.08],  # personal/auto/home/education/business
    ownership_weights   = [0.28, 0.48, 0.24],   # own / mortgage / rent
    # positive prediction rate
    pos_rate            = 0.38,
)

# ── categorical levels ────────────────────────────────────────────────────────
EMPLOYMENT_STATUS = ["employed", "self_employed", "unemployed"]
LOAN_PURPOSE      = ["personal", "auto", "home", "education", "business"]
HOME_OWNERSHIP    = ["own", "mortgage", "rent"]


# ── pyarrow schema ────────────────────────────────────────────────────────────
SCHEMA = pa.schema([
    pa.field("dat_ref",           pa.string()),
    pa.field("age",               pa.float32()),
    pa.field("income",            pa.float32()),
    pa.field("credit_score",      pa.float32()),
    pa.field("loan_amount",       pa.float32()),
    pa.field("interest_rate",     pa.float32()),
    pa.field("debt_to_income",    pa.float32()),
    pa.field("employment_status", pa.string()),
    pa.field("loan_purpose",      pa.string()),
    pa.field("home_ownership",    pa.string()),
    pa.field("prediction",        pa.int8()),
    pa.field("target",            pa.int8()),
])


def _make_batch(
    n: int,
    dat_ref: str,
    drift: float,
    rng: np.random.Generator,
) -> pa.RecordBatch:
    """
    Generate one RecordBatch of `n` rows.

    `drift` ∈ [0, 1] controls how far the inference distribution has shifted
    from the baseline:
      0.0 → identical to baseline distribution
      1.0 → severe drift (credit_score −80 pts, income −30 %, dti +0.15, etc.)
    """
    d = BASE_DIST

    # ── numeric features (with drift applied) ────────────────────────────────
    age = rng.normal(d["age_mean"], d["age_std"], n).clip(18, 85)

    income = rng.normal(
        d["income_mean"] * (1 - 0.30 * drift),
        d["income_std"]  * (1 + 0.20 * drift),
        n,
    ).clip(12_000, 400_000)

    credit_score = rng.normal(
        d["credit_score_mean"] - 80 * drift,
        d["credit_score_std"]  * (1 + 0.30 * drift),
        n,
    ).clip(300, 850)

    loan_amount = rng.normal(
        d["loan_amount_mean"] * (1 + 0.20 * drift),
        d["loan_amount_std"]  * (1 + 0.25 * drift),
        n,
    ).clip(1_000, 200_000)

    interest_rate = rng.normal(
        d["interest_rate_mean"] + 4.0 * drift,
        d["interest_rate_std"]  * (1 + 0.20 * drift),
        n,
    ).clip(2.5, 35.0)

    debt_to_income = rng.normal(
        d["dti_mean"] + 0.15 * drift,
        d["dti_std"]  * (1 + 0.30 * drift),
        n,
    ).clip(0.05, 1.0)

    # ── categorical features (employment shifts toward unemployed under drift) ─
    employ_w = np.array(d["employ_weights"], dtype=float)
    employ_w[0] -= 0.20 * drift   # fewer employed
    employ_w[2] += 0.20 * drift   # more unemployed
    employ_w = np.clip(employ_w, 0.01, None)
    employ_w /= employ_w.sum()

    employment_status = rng.choice(EMPLOYMENT_STATUS, size=n, p=employ_w)
    loan_purpose      = rng.choice(LOAN_PURPOSE,      size=n, p=d["purpose_weights"])
    home_ownership    = rng.choice(HOME_OWNERSHIP,    size=n, p=d["ownership_weights"])

    # ── prediction + target ───────────────────────────────────────────────────
    # Positive rate decreases as credit quality degrades (model starts
    # over-predicting defaults).
    pos_rate   = d["pos_rate"] * (1 - 0.25 * drift)
    prediction = rng.binomial(1, pos_rate, n).astype(np.int8)

    # Target has ~8 % label noise plus drift-correlated shift
    noise_flip = rng.random(n) < (0.08 + 0.10 * drift)
    target     = np.where(noise_flip, 1 - prediction, prediction).astype(np.int8)

    return pa.record_batch(
        {
            "dat_ref":           np.full(n, dat_ref),
            "age":               age.astype(np.float32),
            "income":            income.astype(np.float32),
            "credit_score":      credit_score.astype(np.float32),
            "loan_amount":       loan_amount.astype(np.float32),
            "interest_rate":     interest_rate.astype(np.float32),
            "debt_to_income":    debt_to_income.astype(np.float32),
            "employment_status": employment_status,
            "loan_purpose":      loan_purpose,
            "home_ownership":    home_ownership,
            "prediction":        prediction,
            "target":            target,
        },
        schema=SCHEMA,
    )


def _write_in_chunks(
    path: str,
    n_total: int,
    dat_ref: str,
    drift: float,
    rng: np.random.Generator,
    chunk_size: int = 500_000,
    mode: str = "append",
) -> None:
    """Write a table to a Delta path in chunks to keep RAM usage bounded."""
    written = 0
    while written < n_total:
        batch_n = min(chunk_size, n_total - written)
        batch   = _make_batch(batch_n, dat_ref, drift, rng)
        write_deltalake(
            path,
            pa.Table.from_batches([batch]),
            mode=mode,
            partition_by=["dat_ref"],
        )
        written += batch_n
        mode = "append"   # always append after the first chunk


# ── main ──────────────────────────────────────────────────────────────────────
def main() -> None:
    rng = np.random.default_rng(RNG_SEED)
    t0  = time.time()

    # ── baseline ──────────────────────────────────────────────────────────────
    print(f"[1/7] Generating baseline  500 000 rows  dat_ref=01-09-2025 …")
    _write_in_chunks(
        path      = BASELINE_PATH,
        n_total   = N_BASELINE,
        dat_ref   = "01-09-2025",
        drift     = 0.0,
        rng       = rng,
        mode      = "overwrite",
    )
    print(f"      ✓ baseline written to {BASELINE_PATH}  ({time.time()-t0:.1f}s)")

    # ── inference (6 snapshots, drift increases each month) ───────────────────
    drift_steps = [0.00, 0.12, 0.25, 0.42, 0.62, 0.80]

    for i, (dat_ref, drift) in enumerate(zip(INFERENCE_DATES, drift_steps), start=2):
        t1 = time.time()
        mode = "overwrite" if i == 2 else "append"
        print(
            f"[{i}/7] Generating inference 5 000 000 rows  "
            f"dat_ref={dat_ref}  drift={drift:.2f} …"
        )
        _write_in_chunks(
            path      = INFERENCE_PATH,
            n_total   = N_INFERENCE_PER,
            dat_ref   = dat_ref,
            drift     = drift,
            rng       = rng,
            mode      = mode,
        )
        print(f"      ✓ {dat_ref} written ({time.time()-t1:.1f}s)")

    # ── summary ───────────────────────────────────────────────────────────────
    total = time.time() - t0
    baseline_size  = sum(
        os.path.getsize(os.path.join(r, f))
        for r, _, files in os.walk(BASELINE_PATH)
        for f in files
    )
    inference_size = sum(
        os.path.getsize(os.path.join(r, f))
        for r, _, files in os.walk(INFERENCE_PATH)
        for f in files
    )
    print()
    print("═" * 60)
    print(f"  Baseline  → {BASELINE_PATH}")
    print(f"             {N_BASELINE:>12,} rows  {baseline_size/1e6:>8.1f} MB")
    print(f"  Inference → {INFERENCE_PATH}")
    print(f"             {N_INFERENCE_PER * len(INFERENCE_DATES):>12,} rows  {inference_size/1e6:>8.1f} MB")
    print(f"  Total time: {total:.1f}s")
    print("═" * 60)
    print()
    print("Delta table layouts:")
    print("  data/baseline/   partitioned by dat_ref  (1 partition)")
    print("  data/inference/  partitioned by dat_ref  (6 partitions)")
    print()
    print("Column mapping for MLMonitor:")
    print('  features       : ["age","income","credit_score","loan_amount",')
    print('                    "interest_rate","debt_to_income",')
    print('                    "employment_status","loan_purpose","home_ownership"]')
    print('  prediction_col : "prediction"')
    print('  target_col     : "target"')
    print('  timestamp_col  : "dat_ref"')


if __name__ == "__main__":
    main()
