---
name: ml-model-monitoring
description: "Build and extend a production ML model monitoring system. Use this skill whenever the user wants to: create a monitoring dashboard for ML models, implement data drift detection (PSI, KS, JSD, Wasserstein), track model performance degradation, build alert systems for ML pipelines, implement data quality checks for production models, create model registries, build onboarding wizards for ML model configuration, or work with any observability tooling for machine learning. Also trigger for tasks involving: statistical distribution comparison, population stability index, feature drift analysis, prediction drift, concept drift, model decay, ML observability, or MLOps monitoring. Even if the user doesn't mention 'monitoring' explicitly — if they're talking about tracking ML model health in production, use this skill."
---

# ML Model Monitoring System

A complete observability platform for machine learning models in production, providing
continuous monitoring of data drift, prediction drift, model performance, and data quality.

---

## When to Use This Skill

**Trigger on any of these signals:**
- Building or extending an ML monitoring system
- Implementing statistical drift detection (PSI, KS, chi-square, JSD, Wasserstein)
- Creating dashboards for model health visualization
- Setting up alert pipelines for model degradation
- Designing model registries or onboarding flows
- Data quality monitoring for ML feature stores
- Comparing baseline vs production distributions
- Any "MLOps observability" or "model decay detection" task

---

## Architecture

The system has 5 modules. Read the appropriate reference before implementing:

| Module                   | What it Does                                         | Reference                          |
|--------------------------|------------------------------------------------------|------------------------------------|
| Model Registry           | CRUD for monitored models + onboarding wizard        | `references/data-model.md`         |
| Metrics Engine           | Drift, performance, and data quality computation     | `references/metrics-reference.md`  |
| Execution Engine         | Multi-engine abstraction (local, Spark, Dask, SQL)   | `references/engine-adapters.md`    |
| Alert System             | Rule evaluation + multi-channel notifications        | `references/alert-rules.md`        |
| Dashboard                | React UI with drill-down views                       | `references/dashboard-spec.md`     |

For the full system design, agent definitions, and coding standards, see:
- `CLAUDE.md` — Project-level instructions, tech stack, conventions
- `AGENTS.md` — Specialized agent roles for delegated work

---

## Quick Start: Implementing a Module

### Step 1: Understand What You're Building

Before writing any code, read the relevant reference file(s) from `references/`.
They contain formulas, schemas, API contracts, and design decisions.

### Step 2: Follow the Patterns

Every module follows consistent patterns:

**Backend (Python/FastAPI):**
```
1. Define Pydantic schemas in schemas/
2. Define SQLAlchemy models in db/models.py (if new entity)
3. Create Alembic migration
4. Implement business logic in the appropriate module
5. Wire up API route in api/routes/
6. Write tests
```

**Frontend (React/TypeScript):**
```
1. Define TypeScript interfaces in types/
2. Add API client functions in api/
3. Create custom hook in hooks/ if data-fetching needed
4. Build the component/page
5. Wire into router
```

### Step 3: Validate

Run the test suite after each logical change. Consult `references/test-fixtures.md`
for standard test datasets with known expected outputs.

---

## Metrics Engine — Implementation Guide

This is the computational core of the system. All metric functions live in
`backend/app/engine/` and must be **pure functions** — no DB access, no side effects.

### Drift Metrics

Read `references/metrics-reference.md` for formulas and edge cases. Summary:

| Metric             | Use Case                         | Input Types      | Output Range    |
|--------------------|----------------------------------|------------------|-----------------|
| PSI                | Primary drift proxy              | Numeric + Categ. | [0, ∞)          |
| Kolmogorov-Smirnov | Numeric distribution comparison  | Numeric          | [0, 1]          |
| Jensen-Shannon Div.| Symmetric divergence             | Numeric + Categ. | [0, ln(2)]      |
| Wasserstein        | Magnitude-sensitive shift        | Numeric          | [0, ∞)          |
| Chi-Square         | Categorical distribution test    | Categorical      | p-value [0, 1]  |

**Implementation checklist for every metric:**
- [ ] Handles empty arrays → return 0.0 or NaN with warning
- [ ] Handles single-element arrays → return 0.0
- [ ] Handles identical distributions → return 0.0
- [ ] Handles NaN values → drop or impute, document which
- [ ] Uses epsilon smoothing where division by zero is possible
- [ ] Returns a typed dataclass, not a raw float
- [ ] Has property-based tests via Hypothesis

### Performance Metrics

| Model Type      | Metrics                                                      |
|-----------------|--------------------------------------------------------------|
| Classification  | Accuracy, Precision, Recall, F1, AUC-ROC, AUC-PR, Log Loss  |
| Regression      | MAE, RMSE, MAPE, R², Residual Distribution                   |
| Ranking         | NDCG, MAP, MRR                                               |

Performance metrics require ground truth (`target_column`). Ground truth may arrive
with delay — the system must handle partial availability gracefully.

### Data Quality

| Check              | What it Detects                                    |
|--------------------|----------------------------------------------------|
| Missing rate       | NULL / NaN proportion per feature                  |
| Outlier detection  | IQR-based + Z-score, configurable threshold        |
| Schema validation  | Type mismatches, unexpected columns, missing columns|
| Cardinality        | New categorical values not seen in baseline        |
| Duplicate rate     | Exact row duplicates in the window                 |
| Record count       | Row count per window (detects data pipeline issues)|

---

## Execution Engine

The engine abstraction allows the same metric computation to run on different backends.

```python
# The interface all engines implement
class ExecutionEngine(Protocol):
    async def compute_drift(self, baseline: DataFrame, current: DataFrame, features: list[str]) -> list[DriftResult]: ...
    async def compute_performance(self, current: DataFrame, prediction_col: str, target_col: str) -> list[PerformanceResult]: ...
    async def compute_quality(self, current: DataFrame, features: list[str], baseline_stats: dict) -> list[DataQualityResult]: ...
```

| Engine   | When to Use                         | Implementation Notes                     |
|----------|-------------------------------------|------------------------------------------|
| `local`  | Datasets < 1M rows                  | pandas + numpy + scipy                   |
| `spark`  | Datasets > 1M rows, Databricks/EMR  | PySpark UDFs, spark-submit               |
| `dask`   | Medium-large, no Spark infra        | Dask DataFrame API                       |
| `ray`    | GPU-accelerated or Ray clusters     | Ray Data + remote functions              |
| `sql`    | Data stays in warehouse             | SQL templates, computed in-warehouse     |

Read `references/engine-adapters.md` for implementation details per engine.

---

## Alert System

After each monitoring run, the alert evaluator checks results against rules.

### Rule Types

1. **Static threshold**: `metric_value > threshold` → fire
2. **Dynamic threshold**: `metric_value > mean(last_N) + k * std(last_N)` → fire (requires ≥5 data points)
3. **Trend detection**: `N consecutive runs with increasing metric` → fire

### Notification Channels

Each channel implements the `NotificationChannel` protocol:

```python
class NotificationChannel(Protocol):
    async def send(self, alert: Alert, model: Model) -> bool: ...
```

Channels: `SlackWebhook`, `EmailSMTP`, `PagerDutyAPI`, `GenericWebhook`.

### Cooldown

Key: `alert:{model_id}:{metric_name}:{severity}` → Redis SET with TTL.
Default cooldown: 6 hours. Configurable per model in `alert_config`.

---

## Dashboard

The frontend is a Vite + React 18 + TypeScript SPA with Recharts for visualization.

### Views

| View                | Path                  | Description                                    |
|---------------------|-----------------------|------------------------------------------------|
| Model Overview      | `/`                   | Grid of all models with health status          |
| Model Detail        | `/models/:id`         | 6-tab drill-down (drift, features, perf, etc.) |
| Alerts              | `/alerts`             | Filterable alert timeline                      |
| Onboarding Wizard   | `/models/new`         | 7-step model registration flow                 |

### Design System

- **Theme**: Dark background (#0a0e17), cyan accent (#06b6d4)
- **Typography**: DM Sans (body), JetBrains Mono (numbers/code)
- **Charts**: Always include threshold reference lines (0.10 warning, 0.25 critical for PSI)
- **Status colors**: Green (#10b981) healthy, Yellow (#f59e0b) warning, Red (#ef4444) critical

Read `references/dashboard-spec.md` for detailed component specifications.

---

## API Contract

Full endpoint specification is in `references/api-contract.md`. Core routes:

```
POST   /api/v1/models                    → Register model
GET    /api/v1/models                    → List models (filterable, paginated)
GET    /api/v1/models/{id}               → Model detail
PUT    /api/v1/models/{id}               → Update configuration
DELETE /api/v1/models/{id}               → Remove model

POST   /api/v1/models/{id}/runs/trigger  → Manual run trigger
GET    /api/v1/models/{id}/runs          → Run history
GET    /api/v1/models/{id}/runs/{run_id} → Run detail with results

GET    /api/v1/models/{id}/metrics       → Aggregated metrics (temporal filters)
GET    /api/v1/models/{id}/drift         → Feature-level drift
GET    /api/v1/models/{id}/alerts        → Model alerts

GET    /api/v1/alerts                    → Global alerts
PUT    /api/v1/alerts/{id}/acknowledge   → Acknowledge alert

POST   /api/v1/datasets/validate         → Validate dataset schema
```

---

## Reference Files

Load these as needed — don't read everything upfront:

| File                              | When to Read                                      |
|-----------------------------------|---------------------------------------------------|
| `references/metrics-reference.md` | Implementing any statistical metric                |
| `references/data-model.md`        | Working with DB schema or entities                 |
| `references/api-contract.md`      | Building API endpoints or frontend API client      |
| `references/dashboard-spec.md`    | Building frontend views or components              |
| `references/alert-rules.md`       | Implementing alert evaluation or notification      |
| `references/engine-adapters.md`   | Building or modifying execution engine adapters     |
| `references/connectors.md`        | Implementing data source connectors                |
| `references/test-fixtures.md`     | Writing tests with known expected values           |

---

## Scripts

Utility scripts in `scripts/`:

| Script                        | Purpose                                              |
|-------------------------------|------------------------------------------------------|
| `scripts/seed_demo_data.py`   | Populate dev DB with realistic synthetic models      |
| `scripts/run_metrics_bench.py`| Benchmark metric computation performance             |
| `scripts/validate_schema.py`  | Validate a dataset against expected schema           |
| `scripts/export_results.py`   | Export monitoring results to CSV/JSON                |
