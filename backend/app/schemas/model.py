from __future__ import annotations
from datetime import datetime
from typing import Any
from pydantic import BaseModel, Field


class ColumnMapping(BaseModel):
    features: list[str] = Field(default_factory=list)
    prediction_col: str = ""
    score_col: str = ""       # probability/score column for AUC-ROC
    target_col: str = ""
    timestamp_col: str = ""
    segment_cols: list[str] = Field(default_factory=list)


class DataSourceConfig(BaseModel):
    """Where to load a dataset from. source_type='upload' means use Dataset table."""
    source_type: str = "upload"       # upload | s3 | gcs | sql | unity_catalog
    connection_id: str | None = None  # FK to StorageConnection.id
    path: str = ""                    # S3/GCS URI, SQL table reference, local path
    format: str = "csv"               # csv | parquet


class ModelCreate(BaseModel):
    name: str
    version: str = "1.0.0"
    type: str = "classification"
    team: str = ""
    owner: str = ""
    description: str | None = None
    tags: list[str] = Field(default_factory=list)
    engine: str = "local"
    schedule: str = "0 6 * * *"
    lookback_window: str = "7d"
    comparison_strategy: str = "baseline_vs_current"
    column_mapping: ColumnMapping = Field(default_factory=ColumnMapping)
    psi_warn_threshold: float = 0.10
    psi_crit_threshold: float = 0.25
    alert_cooldown_hours: int = 6
    alert_channels: list[str] = Field(default_factory=list)
    reference_dataset_config: DataSourceConfig | None = None
    inference_dataset_config: DataSourceConfig | None = None


class ModelUpdate(BaseModel):
    name: str | None = None
    version: str | None = None
    type: str | None = None
    team: str | None = None
    owner: str | None = None
    description: str | None = None
    tags: list[str] | None = None
    engine: str | None = None
    schedule: str | None = None
    lookback_window: str | None = None
    column_mapping: ColumnMapping | None = None
    psi_warn_threshold: float | None = None
    psi_crit_threshold: float | None = None
    alert_channels: list[str] | None = None
    reference_dataset_config: DataSourceConfig | None = None
    inference_dataset_config: DataSourceConfig | None = None


class ModelSummary(BaseModel):
    id: str
    name: str
    version: str
    type: str
    team: str
    owner: str
    engine: str
    status: str
    global_psi: float
    global_perf: float
    dq_score: float
    created_at: datetime
    updated_at: datetime
    last_run_at: datetime | None = None
    psi_timeline: list[dict[str, Any]] = Field(default_factory=list)

    model_config = {"from_attributes": True}


class ModelRead(ModelSummary):
    description: str | None
    tags: list[str]
    schedule: str
    lookback_window: str
    comparison_strategy: str
    column_mapping: dict[str, Any]
    psi_warn_threshold: float
    psi_crit_threshold: float
    alert_cooldown_hours: int
    alert_channels: list[str]

    # Timeline data (populated by service)
    performance_timeline: list[dict[str, Any]] = Field(default_factory=list)
    prediction_drift: list[dict[str, Any]] = Field(default_factory=list)
    feature_drift: list[dict[str, Any]] = Field(default_factory=list)
    dq_missing: list[dict[str, Any]] = Field(default_factory=list)
    dq_outlier: list[dict[str, Any]] = Field(default_factory=list)
    runs: list[dict[str, Any]] = Field(default_factory=list)
    alerts: list[dict[str, Any]] = Field(default_factory=list)
    datasets: list[dict[str, Any]] = Field(default_factory=list)
