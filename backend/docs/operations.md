# MLMonitor — Operations Guide

## Health Checks

### Endpoint

```
GET /api/v1/health
```

**Response:**
```json
{ "status": "ok", "version": "1.0.0" }
```

This endpoint has no database dependency — it returns immediately. Use it as both the **readiness** and **liveness** probe in Kubernetes (see [deployment-kubernetes.md](deployment-kubernetes.md)).

**Expected behaviour:**
- Returns `200 OK` when the application is up
- No `503` is currently returned for degraded states (e.g., DB unreachable) — add a DB ping check if needed for readiness

---

## Logging

The application uses Python's standard `logging` module. All FastAPI/Uvicorn logs are written to stdout in a format suitable for container log aggregators (Datadog, CloudWatch, GCP Logging, ELK).

### Log Levels

| Level | Used for |
|-------|---------|
| `DEBUG` | Detailed internal state (disabled in production) |
| `INFO` | Normal flow events: run started, run completed, alert fired |
| `WARNING` | Degraded but non-fatal: notification channel test failed, missing data column |
| `ERROR` | Unexpected failures: database connection loss, unhandled exception in handler |

Set the log level via Uvicorn's `--log-level` flag or the `LOG_LEVEL` environment variable:
```bash
uvicorn app.main:app --log-level info
```

### Structured Logging (Production)

For structured JSON logs, wrap Uvicorn with `structlog` or use the JSON formatter:

```bash
pip install structlog
```

Add to `app/main.py`:
```python
import structlog
structlog.configure(
    processors=[structlog.processors.JSONRenderer()],
)
```

### Key Log Fields to Monitor

| Field | Description |
|-------|-------------|
| `model_id` | Which model's run produced the event |
| `run_id` | The monitoring run UUID |
| `status` | `running` / `success` / `failed` |
| `duration_seconds` | How long the run took |
| `alert_count` | Number of new alerts fired in this run |
| `error_message` | Exception message on failure |

---

## Metrics (Prometheus)

The backend does not natively expose a Prometheus `/metrics` endpoint. Add `prometheus-fastapi-instrumentator` for automatic instrumentation:

```bash
pip install prometheus-fastapi-instrumentator
```

```python
# app/main.py
from prometheus_fastapi_instrumentator import Instrumentator

app = FastAPI(...)
Instrumentator().instrument(app).expose(app)
```

### Recommended Metrics to Track

| Metric | Type | Alerting Threshold |
|--------|------|--------------------|
| `http_request_duration_seconds` (p99) | Histogram | > 5s for `/runs` endpoints |
| `http_requests_total{status="5xx"}` | Counter | > 0 in any 5-minute window |
| Monitoring run duration | Custom gauge | > 5 min suggests data source issue |
| Open alert count | Custom gauge | Rapid spike indicates system-wide drift |
| Failed notification dispatch count | Custom counter | > 0 means channels need attention |

---

## APScheduler Operations

### Viewing Active Jobs

APScheduler doesn't expose an HTTP endpoint. Inspect active jobs programmatically:

```python
from app.scheduler import scheduler

for job in scheduler.get_jobs():
    print(job.id, job.next_run_time, job.trigger)
```

Or add a debug endpoint (remove in production):
```python
@app.get("/debug/jobs")
def list_jobs():
    return [{"id": j.id, "next_run": str(j.next_run_time)} for j in scheduler.get_jobs()]
```

### Re-registering Jobs After Restart

Jobs are stored in-memory only. After every restart, `app/main.py` queries all models with a non-empty `schedule` and re-registers them. This is automatic — no manual action required.

### Manually Triggering a Delayed Job

If a job misfired (service was down past the `misfire_grace_time` of 1 hour), trigger it manually:

```bash
curl -X POST http://localhost:8000/api/v1/models/{model_id}/runs
```

### Removing a Job

Removing a model's schedule:
```bash
curl -X PATCH http://localhost:8000/api/v1/models/{model_id} \
  -H "Content-Type: application/json" \
  -d '{"schedule": ""}'
```

---

## Alert System Operations

### Alert Cooldown Override

If an alert is suppressed by cooldown but you need to fire it immediately, reset the `cooldown_until` field directly in the database:

```sql
UPDATE alerts
SET cooldown_until = NULL
WHERE model_id = 'model-uuid'
  AND metric_name = 'psi'
  AND status = 'open';
```

Then trigger a new monitoring run.

### Bulk Resolve Alerts

To bulk-resolve all open alerts for a model (e.g., after a known data pipeline fix):

```bash
# Get all open alert IDs
curl "http://localhost:8000/api/v1/alerts?model_id=MODEL_ID&status=open" | \
  python3 -c "import sys,json; [print(a['id']) for a in json.load(sys.stdin)['items']]"

# Resolve each one
for id in $(cat alert_ids.txt); do
  curl -X PATCH "http://localhost:8000/api/v1/alerts/$id" \
    -H "Content-Type: application/json" \
    -d '{"status": "resolved"}'
done
```

### Manual Alert Assignment

Assign an alert to a user without using the UI:

```bash
curl -X PATCH "http://localhost:8000/api/v1/alerts/{alert_id}" \
  -H "Content-Type: application/json" \
  -d '{"assigned_to_user_id": "user-uuid"}'
```

This triggers assignment notifications to all enabled channels.

---

## Database Operations

### Check Migration State

```bash
cd backend
alembic current          # shows current revision
alembic history          # shows full migration chain
alembic heads            # shows latest revision (should match current)
```

### Apply Pending Migrations

```bash
alembic upgrade head
```

### Rollback One Migration

```bash
alembic downgrade -1
```

### Create a Manual Backup

**SQLite:**
```bash
cp mlmonitor.db mlmonitor_backup_$(date +%Y%m%d).db
# Or use online backup API (safe while running):
sqlite3 mlmonitor.db ".backup mlmonitor_backup.db"
```

**PostgreSQL:**
```bash
pg_dump $DATABASE_URL > mlmonitor_backup_$(date +%Y%m%d).sql
# Restore:
psql $DATABASE_URL < mlmonitor_backup_20260315.sql
```

### Vacuum / Maintenance (PostgreSQL)

```sql
VACUUM ANALYZE;  -- reclaim space + update statistics
```

For long-running deployments, `drift_results` and `quality_results` can grow large. Consider a retention policy:
```sql
DELETE FROM drift_results
WHERE created_at < NOW() - INTERVAL '90 days';
```

---

## Notification Channel Testing

Test any channel without waiting for an alert to fire:

```bash
curl -X POST "http://localhost:8000/api/v1/notifications/{channel_id}/test"
```

Response:
```json
{ "ok": true, "message": "Test message delivered" }
```

Failure response:
```json
{ "ok": false, "message": "HTTPError: 404 channel_not_found" }
```

The channel's `last_tested_at`, `last_test_ok`, and `last_test_message` are updated in the database.

---

## Storage Connection Testing

Test a storage connection before using it in a model:

```bash
curl -X POST "http://localhost:8000/api/v1/connections/{conn_id}/test"
```

Browse the connection to verify access:
```bash
curl "http://localhost:8000/api/v1/connections/{conn_id}/browse?path="
```

---

## Troubleshooting

| Symptom | Likely Cause | Resolution |
|---------|-------------|------------|
| Run stuck in `status=running` for > 10 minutes | Exception before status update, or process crashed | `PATCH /models/{id}/runs/{run_id}` is not implemented; update status directly: `UPDATE monitoring_runs SET status='failed', error_message='manual' WHERE id='...'`. Restart service. |
| No new alerts firing despite high PSI | Alert cooldown still active | Check `cooldown_until` in the `alerts` table; set to NULL to reset |
| Alert fired but no Slack/email received | Channel disabled or misconfigured | Run `POST /notifications/{id}/test` and check `last_test_ok` |
| `psi = 0.0` for all features | Features missing from `column_mapping` | Verify `column_mapping.features` includes the correct column names that match the dataset |
| No drift data in UI after run | Run completed but no DriftResults | Check `error_message` on the MonitoringRun; look for "no baseline dataset found" |
| Performance metrics all `null` | Missing `target_col` or `prediction_col` in column mapping | Update `column_mapping` to include the correct target and prediction column names |
| `asyncpg.exceptions.TooManyConnectionsError` | Connection pool exhausted | Tune `pool_size` and `max_overflow` in SQLAlchemy engine config; or scale down concurrent runs |
| Frontend 502 errors | Backend crashed or restarting | Check container/process logs; inspect `GET /health` |
| `boto3.exceptions.NoCredentialsError` | S3 connection credentials not set | Verify `aws_access_key_id` and `aws_secret_access_key` in the connection config |
| `sqlalchemy.exc.OperationalError: database is locked` | Concurrent writers to SQLite | Switch to PostgreSQL for any multi-process or production deployment |
| Cron job not firing | Schedule field empty, invalid cron, or scheduler not started | Verify `model.schedule` is a valid cron expression; check startup logs for scheduler errors |
| IdP sync not removing stale members | Members weren't provisioned via sync originally | Only members with `external_source` matching the sync source are removed by sync |

---

## Operational Runbook: Post-Deployment Checklist

After deploying a new version:

1. **Health check:** `curl https://your-domain.com/api/v1/health` → expect `{"status":"ok"}`
2. **Migration status:** `alembic current` should match `alembic heads`
3. **Scheduler jobs:** Verify all scheduled models have active jobs (check debug endpoint or logs)
4. **Notification channels:** Run test on at least one Slack/email channel
5. **Demo models:** Trigger a run on one demo model and verify drift results appear in UI
6. **Alert flow:** Confirm at least one open alert is visible in the alerts view
7. **Uploads dir:** Verify the uploads directory is writable and has sufficient disk space
