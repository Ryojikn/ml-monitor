# MLMonitor — API Reference

**Base URL:** `http://localhost:8000/api/v1`
**OpenAPI spec:** [`../openapi.yaml`](../openapi.yaml)
**Interactive docs:** `http://localhost:8000/docs` (Swagger UI)

---

## Authentication

API keys are supported but currently optional (not enforced by middleware). When required, pass the key in the `X-API-Key` header:

```
X-API-Key: mlm_<40-hex-chars>
```

Keys are created via `POST /api-keys` and stored as SHA-256 hashes. The full key is shown only once at creation time. See [API Keys](#api-keys) section.

---

## Health Check

### `GET /health`
Returns the service health status. Used as readiness and liveness probe target.

**Response `200 OK`:**
```json
{ "status": "ok", "version": "1.0.0" }
```

---

## Models

### `GET /models`
List all models with optional filters.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `search` | string | Filter by name (partial match) |
| `team` | string | Filter by exact team name |
| `type` | string | Filter by model type (`classification`, `regression`) |
| `status` | string | Filter by status (`healthy`, `warning`, `critical`, `inactive`) |
| `is_demo` | boolean | Filter demo models only |

**Response `200 OK`:**
```json
{
  "items": [
    {
      "id": "uuid",
      "name": "Fraud Detector v2",
      "version": "2.1",
      "type": "classification",
      "team": "Risk Engine",
      "owner": "alice@example.com",
      "status": "warning",
      "engine": "local",
      "schedule": "0 */6 * * *",
      "lookback_window": "7d",
      "global_psi": 0.18,
      "global_perf": 0.87,
      "dq_score": 0.95,
      "last_run_at": "2026-03-15T10:00:00",
      "psi_timeline": [0.05, 0.08, 0.12, 0.18],
      "is_demo": false,
      "created_at": "2026-01-01T00:00:00",
      "updated_at": "2026-03-15T10:00:00"
    }
  ],
  "total": 1
}
```

---

### `POST /models`
Register a new model.

**Request body:**
```json
{
  "name": "Fraud Detector v2",
  "version": "2.1",
  "type": "classification",
  "team": "Risk Engine",
  "owner": "alice@example.com",
  "description": "Binary classifier for transaction fraud",
  "tags": ["fraud", "realtime"],
  "engine": "local",
  "schedule": "0 */6 * * *",
  "lookback_window": "7d",
  "comparison_strategy": "baseline_vs_current",
  "column_mapping": {
    "features": ["amount", "merchant_category", "country"],
    "prediction_col": "fraud_prediction",
    "score_col": "fraud_probability",
    "target_col": "fraud_label",
    "timestamp_col": "transaction_at"
  },
  "psi_warn_threshold": 0.10,
  "psi_crit_threshold": 0.25,
  "alert_cooldown_hours": 6,
  "alert_channels": ["slack-prod-alerts"],
  "reference_dataset_config": {
    "source_type": "upload"
  },
  "inference_dataset_config": {
    "source_type": "s3",
    "connection_id": "conn-uuid",
    "path": "s3://my-bucket/inference/fraud/",
    "format": "parquet"
  }
}
```

**Response `201 Created`:** Full `ModelRead` object.

**Errors:** `422` if validation fails (invalid cron expression, missing required fields).

---

### `GET /models/{model_id}`
Get full model detail including timelines, drift results, runs, and alerts.

**Response `200 OK`:** Extended `ModelRead` with additional fields:
- `feature_drift` — array of latest DriftResult per feature
- `perf_timeline` — array of PerformanceResult records over time
- `prediction_drift_timeline` — array of `{date, psi}` for prediction column
- `quality_results` — array of latest QualityResult per feature
- `recent_runs` — last 10 MonitoringRun records
- `active_alerts` — open + acknowledged alerts for this model
- `datasets` — uploaded datasets for this model

**Errors:** `404` if model not found.

---

### `PATCH /models/{model_id}`
Update model configuration. All fields are optional.

**Request body:** Same shape as `POST /models` but all fields optional.

**Response `200 OK`:** Updated `ModelRead`.

**Side effects:** If `schedule` is changed, the cron job is rescheduled. If `schedule` is cleared, the job is removed.

---

### `DELETE /models/{model_id}`
Delete a model and all associated data (runs, drift results, alerts, datasets).

**Response `204 No Content`**

**Side effects:** Removes the associated APScheduler cron job.

---

## Monitoring Runs

### `POST /models/{model_id}/runs`
Trigger an immediate monitoring run. Returns immediately (async execution).

**Response `202 Accepted`:**
```json
{ "run_id": "uuid", "status": "running" }
```

**Errors:** `404` if model not found.

---

### `GET /models/{model_id}/runs`
List the last 50 monitoring runs for a model, ordered newest first.

**Response `200 OK`:**
```json
[
  {
    "id": "uuid",
    "model_id": "uuid",
    "triggered_at": "2026-03-15T10:00:00",
    "completed_at": "2026-03-15T10:00:45",
    "status": "success",
    "engine": "local",
    "duration_seconds": 45.2,
    "window_start": "2026-03-08",
    "window_end": "2026-03-15",
    "error_message": null
  }
]
```

---

### `GET /models/{model_id}/runs/{run_id}`
Get a single run record.

**Response `200 OK`:** Single `RunRead` object.

**Errors:** `404` if run or model not found.

---

## Drift

### `GET /models/{model_id}/drift`
Get the PSI timeline and latest drift results for all features.

**Response `200 OK`:**
```json
{
  "psi_timeline": [
    { "date": "2026-03-08", "psi": 0.05 },
    { "date": "2026-03-15", "psi": 0.18 }
  ],
  "features": [
    {
      "feature_name": "amount",
      "psi": 0.18,
      "ks_stat": 0.12,
      "ks_pvalue": 0.003,
      "jsd": 0.08,
      "wasserstein": 0.15,
      "chi2_stat": null,
      "chi2_pvalue": null,
      "is_drifted": true,
      "severity": "warning",
      "date": "2026-03-15"
    }
  ]
}
```

---

### `GET /models/{model_id}/drift/features/{feature_name}/histogram`
Get baseline vs. current histograms for a specific feature.

**Response `200 OK`:**
```json
{
  "feature_name": "amount",
  "psi": 0.18,
  "ks_stat": 0.12,
  "baseline_histogram": { "bins": [0, 100, 200, 500], "counts": [400, 300, 100] },
  "current_histogram":  { "bins": [0, 100, 200, 500], "counts": [200, 250, 350] }
}
```

**Errors:** `404` if feature has no drift results.

---

## Datasets

### `POST /models/{model_id}/datasets`
Upload a CSV or Parquet dataset for the model.

**Request:** `multipart/form-data`
| Field | Type | Description |
|-------|------|-------------|
| `file` | file | CSV or Parquet file |
| `role` | string | `baseline` or `production` |

**Response `201 Created`:**
```json
{
  "id": "uuid",
  "model_id": "uuid",
  "role": "baseline",
  "filename": "baseline_march_2026.csv",
  "row_count": 50000,
  "column_names": ["amount", "merchant_category", "fraud_label"],
  "uploaded_at": "2026-03-15T09:00:00"
}
```

**Errors:** `400` if file format is not CSV or Parquet; `404` if model not found.

---

### `GET /models/{model_id}/datasets`
List all uploaded datasets for a model.

**Response `200 OK`:** Array of `DatasetRead` objects.

---

## Alerts

### `GET /alerts`
List all alerts with optional filters.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `model_id` | string | Filter by model |
| `severity` | string | `CRITICAL` or `WARNING` |
| `status` | string | `open`, `acknowledged`, `resolved` |
| `assigned_to_user_id` | string | Filter alerts assigned to a specific user |

**Response `200 OK`:**
```json
{
  "items": [
    {
      "id": "uuid",
      "model_id": "uuid",
      "run_id": "uuid",
      "severity": "CRITICAL",
      "metric_name": "psi",
      "metric_value": 0.31,
      "threshold": 0.25,
      "message": "PSI critical drift detected for feature 'amount'",
      "status": "open",
      "feature_name": "amount",
      "created_at": "2026-03-15T10:00:00",
      "acknowledged_at": null,
      "resolved_at": null,
      "assigned_to": null,
      "assigned_to_user_id": null,
      "assigned_user": null
    }
  ],
  "total": 1
}
```

---

### `PATCH /alerts/{alert_id}`
Update an alert's status or assign it to a user.

**Request body** (all fields optional):
```json
{
  "status": "open",
  "assigned_to_user_id": "user-uuid"
}
```

**Assignment workflow:**
When `assigned_to_user_id` is set:
- `status` → `acknowledged`
- `acknowledged_at` → current timestamp
- `assigned_to` → user's `display_name` (denormalised cache)
- `assigned_user` → embedded user object in response
- Triggers `dispatch_assignment_notification()` to all enabled channels

**Response `200 OK`:** Updated `AlertRead` with embedded `assigned_user`.

**Errors:** `404` if alert or user not found.

---

## Storage Connections

### `GET /connections`
List all storage connections.

**Response `200 OK`:** Array of `StorageConnectionRead` objects.

---

### `POST /connections`
Create a new storage connection.

**Request body:**
```json
{
  "name": "Prod S3 Bucket",
  "type": "s3",
  "description": "Production inference data",
  "config": {
    "bucket": "ml-production-data",
    "aws_access_key_id": "AKIA...",
    "aws_secret_access_key": "...",
    "region_name": "us-east-1"
  }
}
```

Supported `type` values: `s3`, `gcs`, `sql`, `unity_catalog`, `kafka`.

**Response `201 Created`:** Full `StorageConnectionRead`.

---

### `GET /connections/{conn_id}`
Get connection details.

---

### `PATCH /connections/{conn_id}`
Update connection configuration. Only provided fields are updated.

---

### `DELETE /connections/{conn_id}`
Delete a connection.

**Response `204 No Content`**

---

### `POST /connections/{conn_id}/test`
Test the connection by attempting to list remote resources.

**Response `200 OK`:**
```json
{ "ok": true, "message": "Connected — found 3 tables in schema 'public'" }
```

Also updates `last_tested_at` and `last_test_ok` on the connection record.

---

### `GET /connections/{conn_id}/browse`
Browse the remote storage hierarchy.

**Query params:**
| Param | Type | Description |
|-------|------|-------------|
| `path` | string | Current path to browse (empty = top level) |

**Response `200 OK`:**
```json
{
  "items": [
    { "name": "public", "type": "schema", "path": "public" },
    { "name": "users", "type": "table", "path": "public.users", "selectable": "SELECT * FROM public.users" }
  ]
}
```

---

### `GET /connections/{conn_id}/columns`
Get column names from a specific file or table.

**Query params:** `path` (required) — path or table name to inspect.

**Response `200 OK`:**
```json
{ "columns": ["amount", "merchant_category", "fraud_label", "transaction_at"] }
```

---

## Notification Channels

### `GET /notifications`
List all notification channels.

**Response `200 OK`:** Array of `NotificationChannelRead` objects.

---

### `POST /notifications`
Create a notification channel.

**Request body:**
```json
{
  "type": "slack",
  "name": "prod-alerts-channel",
  "enabled": true,
  "config": {
    "webhook_url": "https://hooks.slack.com/services/..."
  }
}
```

**Response `201 Created`:** Full `NotificationChannelRead`.

---

### `PATCH /notifications/{channel_id}`
Update a channel. All fields optional.

---

### `DELETE /notifications/{channel_id}`
Delete a channel.

**Response `204 No Content`**

---

### `POST /notifications/{channel_id}/test`
Send a test message through the channel.

**Response `200 OK`:**
```json
{ "ok": true, "message": "Test message delivered successfully" }
```

Also updates `last_tested_at`, `last_test_ok`, `last_test_message`.

---

## API Keys

### `GET /api-keys`
List all active API keys. The full key is never returned after creation.

**Response `200 OK`:**
```json
[
  {
    "id": "uuid",
    "name": "CI Pipeline",
    "key_prefix": "mlm_abc123",
    "is_active": true,
    "created_at": "2026-01-01T00:00:00",
    "last_used_at": "2026-03-15T08:00:00"
  }
]
```

---

### `POST /api-keys`
Create a new API key. The `full_key` is returned only in this response.

**Request body:**
```json
{ "name": "CI Pipeline" }
```

**Response `201 Created`:**
```json
{
  "id": "uuid",
  "name": "CI Pipeline",
  "key_prefix": "mlm_abc123",
  "full_key": "mlm_abc123def456...",
  "is_active": true,
  "created_at": "2026-03-15T00:00:00",
  "last_used_at": null
}
```

> **Important:** Store `full_key` securely. It cannot be retrieved again.

---

### `DELETE /api-keys/{key_id}`
Revoke an API key (sets `is_active = false`).

**Response `204 No Content`**

---

## Teams

### `GET /teams`
List all teams with member count.

**Response `200 OK`:** Array of `TeamRead` objects (includes `member_count`).

---

### `POST /teams`
Create a team.

**Request body:**
```json
{
  "name": "ML Platform",
  "description": "Core ML infrastructure team",
  "external_id": "okta-group-id-123",
  "external_source": "okta"
}
```

`slug` is auto-generated from `name` (lowercase, hyphenated).

**Response `201 Created`:** Full `TeamRead`.

**Errors:** `409` if team name already exists.

---

### `GET /teams/{team_id}`
Get team with full member list.

**Response `200 OK`:** `TeamWithMembers` (includes `members` array with user details and roles).

---

### `PATCH /teams/{team_id}`
Update team info.

---

### `DELETE /teams/{team_id}`
Delete a team.

**Errors:** `409` if the team has models assigned to it.

---

### `GET /teams/{team_id}/members`
List team members.

---

### `POST /teams/{team_id}/members`
Add a user to the team.

**Request body:**
```json
{ "user_id": "user-uuid", "role": "can_edit" }
```

Valid roles: `can_review`, `can_edit`, `can_manage`, `can_admin`.

**Errors:** `409` if user is already a member.

---

### `PATCH /teams/{team_id}/members/{user_id}`
Update a member's role.

**Request body:**
```json
{ "role": "can_manage" }
```

---

### `DELETE /teams/{team_id}/members/{user_id}`
Remove a user from the team.

---

### `POST /teams/{team_id}/sync`
Bulk-sync team membership from an external IdP. Upserts all provided members and removes stale external memberships.

**Request body:**
```json
{
  "members": [
    {
      "external_id": "okta|user123",
      "email": "alice@example.com",
      "display_name": "Alice Chen",
      "role": "can_edit"
    }
  ]
}
```

**Response `200 OK`:**
```json
{ "added": 1, "updated": 2, "removed": 0 }
```

---

## Users

### `GET /users`
List all users with their team memberships.

**Response `200 OK`:** Array of `UserWithTeams` objects.

---

### `POST /users`
Create a user.

**Request body:**
```json
{
  "email": "alice@example.com",
  "display_name": "Alice Chen",
  "external_id": "okta|user123",
  "external_source": "okta"
}
```

**Errors:** `409` if email already exists.

---

### `GET /users/{user_id}`
Get a user with their team memberships.

---

### `PATCH /users/{user_id}`
Update user info.

**Request body** (all optional):
```json
{
  "display_name": "Alice Chen-Smith",
  "is_active": true
}
```

---

### `DELETE /users/{user_id}`
Deactivate a user (sets `is_active = false`). Does not delete the record.

**Response `204 No Content`**

---

## Common Error Responses

| Status | When |
|--------|------|
| `404 Not Found` | Resource (model, run, alert, user, team) does not exist |
| `409 Conflict` | Unique constraint violation (duplicate name, user already a member) |
| `422 Unprocessable Entity` | Request body validation failure (Pydantic error details in response) |
| `500 Internal Server Error` | Unhandled exception (check server logs) |

### Error response shape (`422`):
```json
{
  "detail": [
    {
      "loc": ["body", "schedule"],
      "msg": "Invalid cron expression",
      "type": "value_error"
    }
  ]
}
```
