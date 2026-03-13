# CLAUDE.md — ML Model Monitoring System

## Project Identity

This is **MLMonitor**, a production-grade ML model monitoring platform. It provides
continuous observability over deployed machine learning models — detecting data drift,
concept drift, and performance degradation proactively.

Inspired by Arize AI, NannyML, Evidently AI, and WhyLabs.

---

## Architecture Overview

```
ml-monitor/
├── backend/                  # FastAPI service (Python 3.11+)
│   ├── app/
│   │   ├── api/              # REST endpoints (v1)
│   │   │   ├── routes/       # models, runs, alerts, datasets
│   │   │   └── deps.py       # dependency injection
│   │   ├── core/             # config, security, logging
│   │   ├── db/               # SQLAlchemy models + Alembic migrations
│   │   ├── engine/           # metrics computation layer
│   │   │   ├── drift.py      # PSI, KS, JSD, Wasserstein, Chi²
│   │   │   ├── performance.py# classification / regression / ranking metrics
│   │   │   ├── quality.py    # missing, outliers, schema, cardinality
│   │   │   └── runner.py     # execution engine abstraction
│   │   ├── scheduler/        # Celery tasks + beat config
│   │   ├── alerts/           # rule evaluation + notification dispatch
│   │   └── schemas/          # Pydantic request/response models
│   ├── tests/
│   ├── alembic/
│   └── pyproject.toml
├── frontend/                 # Vite + React 18 + TypeScript
│   ├── src/
│   │   ├── components/       # UI components by domain
│   │   ├── pages/            # route-level views
│   │   ├── hooks/            # custom React hooks
│   │   ├── api/              # typed API client (fetch wrappers)
│   │   ├── utils/            # theme, formatting, constants
│   │   └── types/            # shared TypeScript interfaces
│   ├── public/
│   └── package.json
├── infra/                    # Docker + Terraform
│   ├── docker-compose.yml
│   ├── Dockerfile.backend
│   ├── Dockerfile.frontend
│   └── terraform/
├── docs/                     # Architecture, onboarding, API reference
└── CLAUDE.md                 # ← You are here
```

---

## Tech Stack

| Layer            | Technology                                                  |
|------------------|-------------------------------------------------------------|
| Backend API      | Python 3.11+, FastAPI, Uvicorn                              |
| ORM / Migrations | SQLAlchemy 2.0 + Alembic                                    |
| Database         | PostgreSQL 15 (metadata), Redis (cache + Celery broker)     |
| Metrics Engine   | NumPy, SciPy, pandas (local), PySpark adapter (distributed) |
| Scheduler        | Celery + celery-beat + Redis broker                         |
| Frontend         | Vite 5, React 18, TypeScript, Recharts                      |
| Infra            | Docker Compose (dev), Kubernetes + Terraform (prod)         |
| Observability    | structlog (structured JSON logs), Prometheus metrics         |

---

## Key Design Decisions

### Metric Computation is Idempotent
Every monitoring run is deterministic — re-executing the same `(model_id, window_start, window_end)`
produces the same result. Runs are identified by this tuple and are upsert-safe.

### Engine Abstraction
Metrics are computed through an abstract `ExecutionEngine` interface:
- `LocalEngine` — pandas/numpy in-process (datasets < 1M rows)
- `SparkEngine` — submits PySpark jobs
- `DaskEngine` — Dask distributed client
- `SQLEngine` — pushes computation to warehouse (BigQuery, Snowflake, etc.)

The `engine/runner.py` dispatches based on `model.execution_engine_config.engine_type`.

### Alert Cooldown
After an alert fires, the same `(model_id, metric_name, severity)` triple enters cooldown
(default 6h). This prevents alert fatigue. Cooldown is configurable per-model.

### Multi-tenancy
Every model belongs to a `team`. RBAC is enforced at the API layer:
- `viewer` — read-only access to team's models
- `editor` — full CRUD on team's models
- `admin` — cross-team access + system configuration

---

## Coding Standards

### Python (Backend)

- **Style**: Ruff formatter + linter (replaces black + flake8 + isort)
- **Type hints**: All function signatures must have full type annotations
- **Pydantic v2**: All request/response schemas use Pydantic `BaseModel`
- **Async**: All API handlers are `async def`. DB access via async SQLAlchemy sessions
- **Testing**: pytest + pytest-asyncio. Coverage target: 85%+
- **Naming**:
  - Modules/packages: `snake_case`
  - Classes: `PascalCase`
  - Constants: `UPPER_SNAKE_CASE`
  - API routes: kebab-case in URLs → snake_case in code

### TypeScript (Frontend)

- **Style**: ESLint + Prettier, strict TypeScript
- **Components**: Functional components only, hooks for state
- **State**: React hooks (useState, useReducer) for local state. No global store unless complexity justifies it
- **API layer**: Typed fetch wrappers in `src/api/`. Never raw `fetch()` in components
- **Naming**:
  - Components/types: `PascalCase`
  - Hooks: `useCamelCase`
  - Utilities/constants: `camelCase` / `UPPER_SNAKE_CASE`

### General

- Never commit secrets, credentials, or API keys
- All environment-specific values go in `.env` files (not tracked)
- Database migrations are never destructive — always additive + backfill
- Every PR must include tests for new business logic
- Log at appropriate levels: `debug` for dev, `info` for flows, `warning` for degraded, `error` for failures

---

## Database Schema Principles

The data model has 6 core entities. Relationships flow downward:

```
Model (1) ──→ (N) MonitoringRun
                    ├── (N) DriftResult
                    ├── (N) PerformanceResult
                    └── (N) DataQualityResult

Model (1) ──→ (N) Alert
```

All result tables include `run_id` as a foreign key. This enables full lineage:
given any metric value, you can trace back to the exact run, window, and baseline.

JSON columns are used for flexible/nested data:
- `Model.reference_dataset_config` — connection details (path, credentials ref, schema)
- `Model.column_mapping` — feature list, prediction/target/timestamp columns
- `DriftResult.baseline_stats` / `current_stats` — histogram bins, quantiles, etc.

---

## Development Workflow

### First-time Setup

```bash
# Clone and start infrastructure
docker compose up -d postgres redis

# Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -e ".[dev]"
alembic upgrade head
uvicorn app.main:app --reload

# Frontend
cd frontend
npm install
npm run dev
```

### Running Tests

```bash
# Backend
cd backend && pytest -x --cov=app

# Frontend
cd frontend && npm test
```

### Creating a Migration

```bash
cd backend
alembic revision --autogenerate -m "add_segment_columns_to_model"
alembic upgrade head
```

---

## Task Execution Guidelines

When working on this project, follow this priority order:

1. **Read before writing** — Always examine existing code in the relevant module before making changes. Understand the patterns already in use.
2. **Check the references** — The `docs/` directory and the skill references contain architectural decisions and API contracts. Consult them.
3. **Test incrementally** — Run tests after each logical change, not just at the end.
4. **Preserve interfaces** — If changing an internal implementation, ensure public API contracts (endpoint signatures, response schemas) remain backward-compatible.
5. **Use the agents** — For complex tasks, delegate to specialized agents (see AGENTS.md).

---

## File Navigation Shortcuts

| What you need                     | Where to look                          |
|-----------------------------------|----------------------------------------|
| API route for models              | `backend/app/api/routes/models.py`     |
| PSI computation                   | `backend/app/engine/drift.py`          |
| Celery task definitions           | `backend/app/scheduler/tasks.py`       |
| Alert rule evaluation             | `backend/app/alerts/evaluator.py`      |
| DB models (SQLAlchemy)            | `backend/app/db/models.py`             |
| Pydantic schemas                  | `backend/app/schemas/`                 |
| React model detail page           | `frontend/src/pages/ModelDetail.tsx`   |
| API client hooks                  | `frontend/src/hooks/useApi.ts`         |
| Theme tokens                      | `frontend/src/utils/theme.ts`          |
| Docker Compose                    | `infra/docker-compose.yml`             |
| Architecture diagrams             | `docs/architecture.md`                 |
| Metrics reference (formulas)      | `docs/metrics-reference.md`            |