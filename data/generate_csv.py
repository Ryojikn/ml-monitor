"""
CSV dataset generator for MLMonitor backend uploads.

Produces two CSV files using the same distributions, drift parameters, and
column schema as data/generate.py (the Delta Lake version):

  data/csv/baseline.csv    — 100 000 rows, dat_ref = "2025-09-01"
  data/csv/inference.csv   — 50 000 rows × 6 windows (300 000 rows total)
                             dat_ref ∈ {2025-10-01 … 2026-03-01}

Dates use ISO format (YYYY-MM-DD) so pandas to_datetime() parses them
unambiguously in the backend's _apply_lookback() filter.

Drift increases across inference windows — identical mechanics to
the Delta Lake generator (income ↓, credit_score ↓, AUC degrades).
"""

import os
import time

import numpy as np
import pandas as pd

# ── reproducibility ───────────────────────────────────────────────────────────
RNG_SEED = 42

# ── output paths ──────────────────────────────────────────────────────────────
BASE_DIR      = os.path.dirname(os.path.abspath(__file__))
CSV_DIR       = os.path.join(BASE_DIR, "csv")
BASELINE_CSV  = os.path.join(CSV_DIR, "baseline.csv")
INFERENCE_CSV = os.path.join(CSV_DIR, "inference.csv")

# ── sizes ─────────────────────────────────────────────────────────────────────
N_BASELINE       = 100_000
N_INFERENCE_PER  = 50_000

INFERENCE_WINDOWS = [
    ("2025-10-01", 0.00),
    ("2025-11-01", 0.12),
    ("2025-12-01", 0.25),
    ("2026-01-01", 0.42),
    ("2026-02-01", 0.62),
    ("2026-03-01", 0.80),
]

# ── baseline feature distributions ────────────────────────────────────────────
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
    employ_weights      = [0.72, 0.18, 0.10],
    purpose_weights     = [0.35, 0.25, 0.20, 0.12, 0.08],
    ownership_weights   = [0.28, 0.48, 0.24],
    pos_rate            = 0.38,
)

EMPLOYMENT_STATUS = ["employed", "self_employed", "unemployed"]
LOAN_PURPOSE      = ["personal", "auto", "home", "education", "business"]
HOME_OWNERSHIP    = ["own", "mortgage", "rent"]


def _make_batch(n: int, dat_ref: str, drift: float, rng: np.random.Generator) -> pd.DataFrame:
    """Generate n rows at a given drift level. Mirrors generate.py logic exactly."""
    d = BASE_DIST

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

    employ_w = np.array(d["employ_weights"], dtype=float)
    employ_w[0] -= 0.20 * drift
    employ_w[2] += 0.20 * drift
    employ_w = np.clip(employ_w, 0.01, None)
    employ_w /= employ_w.sum()

    employment_status = rng.choice(EMPLOYMENT_STATUS, size=n, p=employ_w)
    loan_purpose      = rng.choice(LOAN_PURPOSE,      size=n, p=d["purpose_weights"])
    home_ownership    = rng.choice(HOME_OWNERSHIP,    size=n, p=d["ownership_weights"])

    pos_rate   = d["pos_rate"] * (1 - 0.25 * drift)
    prediction = rng.binomial(1, pos_rate, n).astype(np.int8)

    noise_flip = rng.random(n) < (0.08 + 0.10 * drift)
    target     = np.where(noise_flip, 1 - prediction, prediction).astype(np.int8)

    alpha_pos = max(0.5, 4.0 - 2.0 * drift)
    beta_pos  = max(0.5, 2.0 + 1.0 * drift)
    alpha_neg = max(0.5, 2.0 + 1.0 * drift)
    beta_neg  = max(0.5, 4.0 - 2.0 * drift)
    prediction_score = np.where(
        prediction == 1,
        rng.beta(alpha_pos, beta_pos, n),
        rng.beta(alpha_neg, beta_neg, n),
    ).astype(np.float32)

    return pd.DataFrame({
        "dat_ref":           dat_ref,
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
        "prediction_score":  prediction_score,
        "target":            target,
    })


def main() -> None:
    os.makedirs(CSV_DIR, exist_ok=True)
    rng = np.random.default_rng(RNG_SEED)
    t0  = time.time()

    # ── baseline ──────────────────────────────────────────────────────────────
    print(f"[1/7] Generating baseline  {N_BASELINE:,} rows  dat_ref=2025-09-01 …")
    baseline_df = _make_batch(N_BASELINE, "2025-09-01", 0.0, rng)
    baseline_df.to_csv(BASELINE_CSV, index=False)
    size_mb = os.path.getsize(BASELINE_CSV) / 1e6
    print(f"      ✓ {BASELINE_CSV}  ({size_mb:.1f} MB)  ({time.time()-t0:.1f}s)")

    # ── inference (6 windows) ─────────────────────────────────────────────────
    inference_chunks = []
    for i, (dat_ref, drift) in enumerate(INFERENCE_WINDOWS, start=2):
        t1 = time.time()
        print(f"[{i}/7] Generating inference {N_INFERENCE_PER:,} rows  dat_ref={dat_ref}  drift={drift:.2f} …")
        chunk = _make_batch(N_INFERENCE_PER, dat_ref, drift, rng)
        inference_chunks.append(chunk)
        print(f"      ✓ {dat_ref} ready  ({time.time()-t1:.1f}s)")

    print("\nWriting inference.csv …")
    tw = time.time()
    inference_df = pd.concat(inference_chunks, ignore_index=True)
    inference_df.to_csv(INFERENCE_CSV, index=False)
    size_mb = os.path.getsize(INFERENCE_CSV) / 1e6
    print(f"      ✓ {INFERENCE_CSV}  ({size_mb:.1f} MB)  ({time.time()-tw:.1f}s)")

    total = time.time() - t0
    print()
    print("═" * 60)
    print(f"  Baseline  → {BASELINE_CSV}")
    print(f"             {N_BASELINE:>10,} rows")
    print(f"  Inference → {INFERENCE_CSV}")
    print(f"             {N_INFERENCE_PER * len(INFERENCE_WINDOWS):>10,} rows  ({len(INFERENCE_WINDOWS)} windows)")
    print(f"  Total time: {total:.1f}s")
    print("═" * 60)
    print()
    print("Column mapping for MLMonitor backend upload:")
    print('  features       : ["age","income","credit_score","loan_amount",')
    print('                    "interest_rate","debt_to_income",')
    print('                    "employment_status","loan_purpose","home_ownership"]')
    print('  prediction_col : "prediction"')
    print('  score_col      : "prediction_score"')
    print('  target_col     : "target"')
    print('  timestamp_col  : "dat_ref"')


if __name__ == "__main__":
    main()
