from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional, List

from sqlalchemy import String, Float, Integer, Boolean, DateTime, JSON, ForeignKey, Text, UniqueConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.base import Base


def _uuid() -> str:
    return str(uuid.uuid4())


def _now() -> datetime:
    return datetime.utcnow()


class Model(Base):
    __tablename__ = "models"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    version: Mapped[str] = mapped_column(String(50), default="1.0.0")
    type: Mapped[str] = mapped_column(String(50), default="classification")
    team: Mapped[str] = mapped_column(String(100), default="")
    owner: Mapped[str] = mapped_column(String(100), default="")
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    tags: Mapped[List] = mapped_column(JSON, default=list)
    status: Mapped[str] = mapped_column(String(20), default="inactive")
    engine: Mapped[str] = mapped_column(String(20), default="local")
    schedule: Mapped[str] = mapped_column(String(100), default="0 6 * * *")
    lookback_window: Mapped[str] = mapped_column(String(10), default="7d")
    comparison_strategy: Mapped[str] = mapped_column(String(50), default="baseline_vs_current")
    column_mapping: Mapped[dict] = mapped_column(JSON, default=dict)
    psi_warn_threshold: Mapped[float] = mapped_column(Float, default=0.10)
    psi_crit_threshold: Mapped[float] = mapped_column(Float, default=0.25)
    alert_cooldown_hours: Mapped[int] = mapped_column(Integer, default=6)
    alert_channels: Mapped[List] = mapped_column(JSON, default=list)
    global_psi: Mapped[float] = mapped_column(Float, default=0.0)
    global_perf: Mapped[float] = mapped_column(Float, default=0.0)
    dq_score: Mapped[float] = mapped_column(Float, default=1.0)
    reference_dataset_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    inference_dataset_config: Mapped[Optional[dict]] = mapped_column(JSON, nullable=True)
    is_demo: Mapped[bool] = mapped_column(Boolean, default=False, server_default="false")
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    runs: Mapped[List["MonitoringRun"]] = relationship(
        back_populates="model", cascade="all, delete-orphan",
        order_by="MonitoringRun.triggered_at.desc()"
    )
    alerts: Mapped[List["Alert"]] = relationship(back_populates="model", cascade="all, delete-orphan")
    datasets: Mapped[List["Dataset"]] = relationship(back_populates="model", cascade="all, delete-orphan")


class Dataset(Base):
    __tablename__ = "datasets"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    model_id: Mapped[str] = mapped_column(String(36), ForeignKey("models.id"))
    role: Mapped[str] = mapped_column(String(20))
    filename: Mapped[str] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(500))
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    column_names: Mapped[List] = mapped_column(JSON, default=list)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    model: Mapped["Model"] = relationship(back_populates="datasets")


class MonitoringRun(Base):
    __tablename__ = "monitoring_runs"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    model_id: Mapped[str] = mapped_column(String(36), ForeignKey("models.id"))
    triggered_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    completed_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    status: Mapped[str] = mapped_column(String(20), default="running")
    engine: Mapped[str] = mapped_column(String(20), default="local")
    duration_seconds: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    window_start: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    window_end: Mapped[Optional[str]] = mapped_column(String(30), nullable=True)
    error_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    model: Mapped["Model"] = relationship(back_populates="runs")
    drift_results: Mapped[List["DriftResult"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    performance_results: Mapped[List["PerformanceResult"]] = relationship(back_populates="run", cascade="all, delete-orphan")
    quality_results: Mapped[List["QualityResult"]] = relationship(back_populates="run", cascade="all, delete-orphan")


class DriftResult(Base):
    __tablename__ = "drift_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("monitoring_runs.id"))
    model_id: Mapped[str] = mapped_column(String(36), ForeignKey("models.id"))
    feature_name: Mapped[str] = mapped_column(String(200))
    date: Mapped[str] = mapped_column(String(20))
    psi: Mapped[float] = mapped_column(Float, default=0.0)
    ks_stat: Mapped[float] = mapped_column(Float, default=0.0)
    ks_pvalue: Mapped[float] = mapped_column(Float, default=1.0)
    jsd: Mapped[float] = mapped_column(Float, default=0.0)
    wasserstein: Mapped[float] = mapped_column(Float, default=0.0)
    chi2_stat: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    chi2_pvalue: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    is_drifted: Mapped[bool] = mapped_column(Boolean, default=False)
    severity: Mapped[str] = mapped_column(String(20), default="stable")
    baseline_histogram: Mapped[dict] = mapped_column(JSON, default=dict)
    current_histogram: Mapped[dict] = mapped_column(JSON, default=dict)

    run: Mapped["MonitoringRun"] = relationship(back_populates="drift_results")


class PerformanceResult(Base):
    __tablename__ = "performance_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("monitoring_runs.id"))
    model_id: Mapped[str] = mapped_column(String(36), ForeignKey("models.id"))
    date: Mapped[str] = mapped_column(String(20))
    accuracy: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    f1_score: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    auc_roc: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    precision: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    recall: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    r2: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    mae: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    rmse: Mapped[Optional[float]] = mapped_column(Float, nullable=True)
    prediction_psi: Mapped[Optional[float]] = mapped_column(Float, nullable=True)

    run: Mapped["MonitoringRun"] = relationship(back_populates="performance_results")


class QualityResult(Base):
    __tablename__ = "quality_results"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    run_id: Mapped[str] = mapped_column(String(36), ForeignKey("monitoring_runs.id"))
    model_id: Mapped[str] = mapped_column(String(36), ForeignKey("models.id"))
    feature_name: Mapped[str] = mapped_column(String(200))
    date: Mapped[str] = mapped_column(String(20))
    missing_rate: Mapped[float] = mapped_column(Float, default=0.0)
    outlier_rate: Mapped[float] = mapped_column(Float, default=0.0)
    null_count: Mapped[int] = mapped_column(Integer, default=0)
    total_count: Mapped[int] = mapped_column(Integer, default=0)

    run: Mapped["MonitoringRun"] = relationship(back_populates="quality_results")


class Alert(Base):
    __tablename__ = "alerts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    model_id: Mapped[str] = mapped_column(String(36), ForeignKey("models.id"))
    run_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("monitoring_runs.id"), nullable=True)
    severity: Mapped[str] = mapped_column(String(20))
    metric_name: Mapped[str] = mapped_column(String(100))
    metric_value: Mapped[float] = mapped_column(Float)
    threshold: Mapped[float] = mapped_column(Float)
    message: Mapped[str] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")
    feature_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    cooldown_until: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    notified_channels: Mapped[List] = mapped_column(JSON, default=list)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    acknowledged_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    assigned_to: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    assigned_to_user_id: Mapped[Optional[str]] = mapped_column(String(36), ForeignKey("users.id"), nullable=True)

    model: Mapped["Model"] = relationship(back_populates="alerts")
    assigned_user: Mapped[Optional["User"]] = relationship("User", foreign_keys=[assigned_to_user_id])


class NotificationChannel(Base):
    __tablename__ = "notification_channels"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    type: Mapped[str] = mapped_column(String(30))
    name: Mapped[str] = mapped_column(String(200))
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    enabled: Mapped[bool] = mapped_column(Boolean, default=False)
    last_tested_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_test_ok: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    last_test_message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


class ApiKey(Base):
    __tablename__ = "api_keys"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    key_prefix: Mapped[str] = mapped_column(String(12))
    key_hash: Mapped[str] = mapped_column(String(64))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    last_used_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)


class StorageConnection(Base):
    __tablename__ = "storage_connections"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200))
    type: Mapped[str] = mapped_column(String(50))  # s3, gcs, sql, unity_catalog, kafka
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    config: Mapped[dict] = mapped_column(JSON, default=dict)
    last_tested_at: Mapped[Optional[datetime]] = mapped_column(DateTime, nullable=True)
    last_test_ok: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)


# ─── User / Team management ───────────────────────────────────────────────────

class Team(Base):
    __tablename__ = "teams"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    name: Mapped[str] = mapped_column(String(200), unique=True)
    slug: Mapped[str] = mapped_column(String(200), unique=True)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    external_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    external_source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    memberships: Mapped[List["TeamMembership"]] = relationship(
        back_populates="team", cascade="all, delete-orphan"
    )


class User(Base):
    __tablename__ = "users"

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    email: Mapped[str] = mapped_column(String(200), unique=True)
    display_name: Mapped[str] = mapped_column(String(200))
    external_id: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    external_source: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)
    updated_at: Mapped[datetime] = mapped_column(DateTime, default=_now, onupdate=_now)

    memberships: Mapped[List["TeamMembership"]] = relationship(
        back_populates="user", cascade="all, delete-orphan"
    )


class TeamMembership(Base):
    __tablename__ = "team_memberships"
    __table_args__ = (UniqueConstraint("team_id", "user_id", name="uq_team_user"),)

    id: Mapped[str] = mapped_column(String(36), primary_key=True, default=_uuid)
    team_id: Mapped[str] = mapped_column(String(36), ForeignKey("teams.id"))
    user_id: Mapped[str] = mapped_column(String(36), ForeignKey("users.id"))
    role: Mapped[str] = mapped_column(String(20))  # can_review | can_edit | can_manage | can_admin
    created_at: Mapped[datetime] = mapped_column(DateTime, default=_now)

    team: Mapped["Team"] = relationship(back_populates="memberships")
    user: Mapped["User"] = relationship(back_populates="memberships")
