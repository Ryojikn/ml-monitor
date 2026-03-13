# AGENTS.md — Specialized Agents for MLMonitor

This document defines the agent roles available for building, testing, and operating
the ML Model Monitoring System. Each agent has a clear scope, instructions, and
handoff patterns.

Use agents when a task benefits from focused context — a single agent working within
a bounded domain produces better results than one agent juggling the entire system.

---

## Agent Index

| Agent                  | Domain                        | When to Use                                            |
|------------------------|-------------------------------|--------------------------------------------------------|
| `metrics-engineer`     | Drift & performance metrics   | Implementing or debugging statistical computations     |
| `backend-api`          | FastAPI routes & schemas      | Building endpoints, request validation, DB queries     |
| `frontend-dashboard`   | React UI & visualizations     | Building pages, charts, components, interactions       |
| `data-engineer`        | Data pipelines & connectors   | Dataset ingestion, schema validation, engine adapters  |
| `alert-system`         | Alert rules & notifications   | Alert evaluation logic, notification dispatch, cooldown|
| `infra-ops`            | Docker, CI/CD, Terraform      | Infrastructure setup, deployment, observability        |
| `test-engineer`        | Testing & quality assurance   | Unit tests, integration tests, benchmarks, fixtures    |
| `docs-writer`          | Documentation & API reference | README, architecture docs, API docs, onboarding guides |

---

## Agent Definitions

### `metrics-engineer`

**Scope**: Statistical computations in `backend/app/engine/`.

**Responsibilities**:
- Implement drift metrics: PSI, KS test, Jensen-Shannon Divergence, Wasserstein distance, Chi-Square
- Implement performance metrics: classification (accuracy, precision, recall, F1, AUC-ROC, AUC-PR, log loss), regression (MAE, RMSE, MAPE, R²), ranking (NDCG, MAP, MRR)
- Implement data quality checks: missing rate, outlier detection (IQR + Z-score), schema validation, cardinality analysis, duplicate rate
- Ensure all computations are numerically stable (epsilon smoothing, edge-case handling)
- Write property-based tests with Hypothesis for numerical edge cases

**Key Files**:
- `backend/app/engine/drift.py` — All drift metric implementations
- `backend/app/engine/performance.py` — Model performance metrics
- `backend/app/engine/quality.py` — Data quality checks
- `backend/app/engine/runner.py` — Execution engine dispatcher
- `backend/app/engine/adapters/` — Engine-specific adapters (local, spark, dask, sql)
- `tests/engine/` — Test suite for all metrics

**Context to Load**:
- `references/metrics-reference.md` — Formulas, thresholds, edge cases
- `references/psi-implementation.md` — Detailed PSI pseudocode with binning strategies

**Constraints**:
- All metric functions must be pure — no side effects, no DB access
- Functions accept numpy arrays or pandas DataFrames and return typed result dataclasses
- Every metric must handle: empty arrays, single-element arrays, all-same values, NaN values
- PSI epsilon = 1e-6 for zero-division protection
- Default bin count for PSI = 10 (quantile-based from baseline)

---

### `backend-api`

**Scope**: FastAPI application in `backend/app/api/`.

**Responsibilities**:
- Implement REST endpoints per the API contract (see references/api-contract.md)
- Request/response validation via Pydantic v2 schemas
- Async database access via SQLAlchemy 2.0 async sessions
- Authentication & RBAC middleware
- Pagination, filtering, and sorting on list endpoints
- Error handling with consistent error response format

**Key Files**:
- `backend/app/api/routes/` — Route modules (models.py, runs.py, alerts.py, datasets.py)
- `backend/app/api/deps.py` — Dependency injection (DB session, current user, permissions)
- `backend/app/schemas/` — Pydantic models for all request/response types
- `backend/app/db/models.py` — SQLAlchemy ORM models
- `backend/app/core/security.py` — Auth utilities, RBAC decorators

**Context to Load**:
- `references/api-contract.md` — Full endpoint specification
- `references/data-model.md` — Entity relationships and JSON column schemas

**Constraints**:
- All handlers are `async def`
- List endpoints must support `?page=`, `?page_size=`, `?sort_by=`, `?order=`
- Error responses follow `{"detail": str, "code": str}` format
- Never expose internal IDs or stack traces in production error responses
- Use dependency injection for DB sessions — never instantiate directly

---

### `frontend-dashboard`

**Scope**: React application in `frontend/src/`.

**Responsibilities**:
- Implement all dashboard views: Model Overview, Model Detail (6 tabs), Alerts, Onboarding Wizard
- Build responsive charts with Recharts (drift timelines, heatmaps, histograms, performance tracking)
- Create reusable UI primitives (Card, Badge, Button, MetricCard, Sparkline, Select, etc.)
- Typed API integration via custom hooks (`useModels`, `useModelDetail`, `useAlerts`)
- State management with React hooks
- Accessibility: keyboard navigation, ARIA labels, color-blind-safe palettes

**Key Files**:
- `frontend/src/pages/` — Route-level page components
- `frontend/src/components/` — Shared and domain-specific components
- `frontend/src/components/charts/` — Chart components (DriftTimeline, FeatureHeatmap, DistributionComparison)
- `frontend/src/hooks/` — Custom hooks (useApi, useModels, useAlerts)
- `frontend/src/api/` — Typed fetch client
- `frontend/src/utils/theme.ts` — Design tokens
- `frontend/src/types/` — Shared TypeScript interfaces

**Context to Load**:
- `references/dashboard-spec.md` — UI specification with wireframes description
- `references/api-contract.md` — Endpoint shapes for building the API client

**Constraints**:
- Functional components only, no class components
- No direct `fetch()` in components — always go through `src/api/` client
- Charts must include threshold reference lines (PSI 0.10 warning, 0.25 critical)
- The design follows a dark theme with cyan (#06b6d4) as primary accent
- Use DM Sans for body text, JetBrains Mono for numeric/code values
- All interactive elements must have hover states and transitions

---

### `data-engineer`

**Scope**: Data ingestion, connectors, and schema validation.

**Responsibilities**:
- Implement dataset connectors: S3, GCS, ADLS, SQL (BigQuery, Snowflake, Redshift, Trino), Delta Tables, Kafka
- Schema inference and validation against expected column mapping
- Incremental ingestion with watermark tracking for production datasets
- Baseline dataset caching and versioning (immutable snapshots)
- Windowed data retrieval based on `timestamp_column` + `lookback_window`

**Key Files**:
- `backend/app/engine/connectors/` — Data source adapters
- `backend/app/engine/schema.py` — Schema validation and inference
- `backend/app/engine/windowing.py` — Temporal window management
- `backend/app/db/models.py` — Dataset config models

**Context to Load**:
- `references/data-model.md` — Dataset configuration schemas
- `references/connectors.md` — Connector interface and implementation guide

**Constraints**:
- All connectors implement the `DatasetConnector` protocol (read, validate_schema, get_sample)
- Production dataset reads must always filter by timestamp window — never full-table scans
- Baseline datasets are cached in Redis (TTL = 1 hour) after first read per run
- Connection credentials are never stored in the DB — use AWS Secrets Manager / Vault references

---

### `alert-system`

**Scope**: Alert evaluation, notification dispatch, lifecycle management.

**Responsibilities**:
- Evaluate metric results against configured alert rules after each run
- Support rule types: static threshold, dynamic threshold (σ-based), trend detection (N consecutive)
- Manage alert lifecycle: open → acknowledged → resolved
- Dispatch notifications: Slack webhook, email (SMTP/SES), PagerDuty, generic webhook
- Enforce cooldown windows to prevent alert fatigue
- Include rich context in notifications: model name, metric, value vs threshold, dashboard link

**Key Files**:
- `backend/app/alerts/evaluator.py` — Rule evaluation engine
- `backend/app/alerts/dispatcher.py` — Notification channel dispatchers
- `backend/app/alerts/cooldown.py` — Cooldown tracking (Redis-backed)
- `backend/app/api/routes/alerts.py` — Alert CRUD + acknowledge/resolve
- `backend/app/schemas/alerts.py` — Alert Pydantic schemas

**Context to Load**:
- `references/alert-rules.md` — Rule types, evaluation logic, cooldown semantics

**Constraints**:
- Alert evaluation runs synchronously after each monitoring run (within the same Celery task)
- Cooldown key = `alert:{model_id}:{metric_name}:{severity}` in Redis with TTL
- Notification dispatch is fire-and-forget (async task) — failures don't block the run
- Dynamic thresholds require ≥5 historical data points; fall back to static otherwise

---

### `infra-ops`

**Scope**: Infrastructure, deployment, CI/CD.

**Responsibilities**:
- Docker Compose for local development (postgres, redis, backend, frontend, celery worker, celery beat)
- Production Dockerfiles (multi-stage builds, non-root user)
- Kubernetes manifests (Deployments, Services, ConfigMaps, Secrets, CronJobs)
- Terraform modules for AWS/GCP infrastructure
- GitHub Actions CI/CD pipeline
- Prometheus metrics endpoint + Grafana dashboards

**Key Files**:
- `infra/docker-compose.yml` — Local dev environment
- `infra/Dockerfile.backend` / `Dockerfile.frontend`
- `infra/k8s/` — Kubernetes manifests
- `infra/terraform/` — IaC modules
- `.github/workflows/` — CI/CD

**Constraints**:
- Dev environment must start with a single `docker compose up`
- Backend image < 500MB, frontend image < 100MB
- All secrets via environment variables — never baked into images
- Health check endpoints: `/health` (liveness), `/ready` (readiness)

---

### `test-engineer`

**Scope**: Testing strategy, test implementation, quality gates.

**Responsibilities**:
- Unit tests for all metric computations (edge cases, numerical stability)
- Integration tests for API endpoints (CRUD, filtering, pagination, error cases)
- Property-based tests (Hypothesis) for drift metrics
- Test fixtures and factories for models, runs, alerts
- Benchmark tests for metric computation performance
- Frontend component tests with React Testing Library

**Key Files**:
- `backend/tests/` — All backend tests
- `backend/tests/conftest.py` — Shared fixtures, test DB setup
- `backend/tests/factories.py` — Factory Boy factories for DB models
- `frontend/src/__tests__/` — Frontend tests

**Context to Load**:
- `references/metrics-reference.md` — Expected values for known inputs
- `references/test-fixtures.md` — Standard test datasets and expected results

**Constraints**:
- Coverage target: 85%+ lines for backend, 70%+ for frontend
- Every public API endpoint must have ≥ 1 happy-path + ≥ 1 error-path test
- Metric tests must include: empty input, single value, identical distributions, extreme drift
- Tests must be independent and parallelizable (no shared mutable state)

---

### `docs-writer`

**Scope**: Documentation across the project.

**Responsibilities**:
- Project README with quick start, architecture overview, and contributing guide
- Architecture documentation with Mermaid diagrams
- API reference (auto-generated from OpenAPI + manual enrichment)
- Metrics reference: formulas, interpretation, thresholds
- Onboarding guide: how to register a model, configure alerts, interpret results
- Runbook: common operational procedures, troubleshooting

**Key Files**:
- `README.md` — Project root README
- `docs/architecture.md` — System design documentation
- `docs/metrics-reference.md` — Statistical metrics deep dive
- `docs/onboarding-guide.md` — User-facing guide
- `docs/api-reference.md` — API documentation
- `docs/runbook.md` — Operational procedures

**Constraints**:
- Diagrams in Mermaid (renders natively in GitHub)
- Code examples must be copy-pasteable and tested
- No marketing language — technical documentation only
- Keep the audience in mind: ML engineers and data scientists who want to monitor their models

---

## Handoff Patterns

### Sequential Handoff
When one agent's output feeds another's input:

```
metrics-engineer (implements PSI) → test-engineer (writes PSI tests) → docs-writer (documents PSI)
```

### Parallel Work
When agents can work independently:

```
┌─ metrics-engineer (drift metrics)
│
├─ backend-api (CRUD endpoints)      ← can work simultaneously
│
└─ frontend-dashboard (UI shells)
```

### Integration Point
When multiple agents' work converges:

```
backend-api + metrics-engineer → data-engineer (wires up connectors to engine)
                                → alert-system (evaluates results post-run)
                                → frontend-dashboard (displays results)
```

---

## Spawning an Agent

When delegating to an agent, provide:

1. **Agent role** — which agent definition to follow
2. **Task description** — what specifically to accomplish
3. **Key files** — which files to read first
4. **References** — which reference docs to load
5. **Acceptance criteria** — how to know the task is done

Example:

```
Agent: metrics-engineer
Task: Implement Jensen-Shannon Divergence for categorical features
Key files: backend/app/engine/drift.py (existing PSI implementation as pattern)
References: references/metrics-reference.md § Jensen-Shannon Divergence
Acceptance criteria:
  - Function `compute_jsd(baseline: np.ndarray, current: np.ndarray) -> float`
  - Returns value in [0, ln(2)] for discrete distributions
  - Handles zero-probability categories with epsilon smoothing
  - Unit tests pass in tests/engine/test_drift.py
```