"""Performance metrics for classification and regression."""
from __future__ import annotations

import numpy as np
import pandas as pd


def compute_classification(
    y_true: pd.Series,
    y_pred: pd.Series,
    y_score: pd.Series | None = None,
) -> dict:
    """
    Compute classification metrics.

    y_pred  — binary class labels (int), used for accuracy/f1/precision/recall.
    y_score — continuous probability scores in [0, 1], used for AUC-ROC.
              When None, auc_roc is returned as None (passing binary labels to
              roc_auc_score produces balanced_accuracy, not true AUROC).
    """
    from sklearn.metrics import (
        accuracy_score, f1_score, precision_score, recall_score, roc_auc_score
    )

    y_true = y_true.dropna()
    y_pred = y_pred.loc[y_true.index].dropna()
    y_true = y_true.loc[y_pred.index]

    if len(y_true) == 0:
        return {}

    try:
        acc = float(accuracy_score(y_true, y_pred.round()))
        f1 = float(f1_score(y_true, y_pred.round(), average="weighted", zero_division=0))
        prec = float(precision_score(y_true, y_pred.round(), average="weighted", zero_division=0))
        rec = float(recall_score(y_true, y_pred.round(), average="weighted", zero_division=0))

        auc = None
        if y_score is not None and y_true.nunique() == 2:
            try:
                score_aligned = y_score.loc[y_true.index].dropna()
                true_aligned = y_true.loc[score_aligned.index]
                auc = float(roc_auc_score(true_aligned, score_aligned))
            except Exception:
                auc = None

        return {
            "accuracy": round(acc, 4),
            "f1_score": round(f1, 4),
            "precision": round(prec, 4),
            "recall": round(rec, 4),
            "auc_roc": round(auc, 4) if auc is not None else None,
        }
    except Exception:
        return {}


def compute_regression(y_true: pd.Series, y_pred: pd.Series) -> dict:
    from sklearn.metrics import mean_absolute_error, mean_squared_error, r2_score

    y_true = y_true.dropna()
    y_pred = pd.to_numeric(y_pred, errors="coerce").dropna()
    common = y_true.index.intersection(y_pred.index)
    y_true = y_true.loc[common]
    y_pred = y_pred.loc[common]

    if len(y_true) == 0:
        return {}

    try:
        mae = float(mean_absolute_error(y_true, y_pred))
        rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
        r2 = float(r2_score(y_true, y_pred))
        return {
            "mae": round(mae, 4),
            "rmse": round(rmse, 4),
            "r2": round(r2, 4),
        }
    except Exception:
        return {}
