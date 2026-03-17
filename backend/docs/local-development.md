# MLMonitor — Local Development Guide

## Prerequisites

| Tool | Minimum Version | Purpose |
|------|----------------|---------|
| Python | 3.11+ | Backend runtime |
| Node.js | 20+ | Frontend build toolchain |
| npm | 10+ | Frontend package manager |
| Docker | 24+ | Optional: all-in-one setup |
| Docker Compose | 2.x (plugin) | Optional: all-in-one setup |
| git | any | Version control |

---

## Quick Start — Docker Compose (recommended)

The fastest way to run the full stack locally:

```bash
git clone <repo-url>
cd ml-monitor

docker compose up
```

This starts:
- **Backend** on `http://localhost:8000` (FastAPI, hot-reload enabled)
- **Frontend** on `http://localhost:3000` (Vite dev server, HMR enabled)

Useful URLs:
| URL | Description |
|-----|-------------|
| `http://localhost:3000` | Frontend dashboard |
| `http://localhost:8000/docs` | Swagger UI (interactive API docs) |
| `http://localhost:8000/redoc` | ReDoc API docs |
| `http://localhost:8000/api/v1/health` | Health check endpoint |

To stop: `Ctrl+C` then `docker compose down`.

To rebuild after dependency changes:
```bash
docker compose build
docker compose up
```

---

## Quick Start — Convenience Script

If you have Python and Node already installed and don't want Docker:

```bash
git clone <repo-url>
cd ml-monitor
chmod +x start-dev.sh
./start-dev.sh
```

The script:
1. Creates a Python virtualenv in `backend/.venv` (if not present)
2. Installs backend dependencies via `pip install -e .`
3. Starts the backend on port 8000 (background process)
4. Starts the frontend on port 3000 (background process)
5. Traps `Ctrl+C` to kill both processes cleanly

---

## Manual Setup

### Backend

```bash
cd backend

# 1. Create and activate virtualenv
python3.11 -m venv .venv
source .venv/bin/activate          # macOS / Linux
# .venv\Scripts\activate           # Windows

# 2. Install dependencies (editable mode for dev)
pip install -e ".[dev]"

# 3. Set up environment variables (optional — defaults work for local dev)
cp ../.env.example .env
# Edit .env if needed

# 4. Run database migrations
alembic upgrade head

# 5. Start the development server (hot-reload)
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

The backend starts at `http://localhost:8000`. On first startup it creates `mlmonitor.db` (SQLite), the `uploads/` directory, and seeds 12 demo models.

### Frontend

In a separate terminal:

```bash
cd ml-monitor   # project root (not backend/)

# 1. Install dependencies
npm install

# 2. Start the dev server
npm run dev
```

The frontend starts at `http://localhost:3000`. The Vite dev server proxies all `/api/*` requests to `http://localhost:8000`, so the backend must be running.

---

## Environment Variables

All variables are optional for local development — the defaults work out of the box.

| Variable | Default | Description |
|----------|---------|-------------|
| `DATABASE_URL` | `sqlite+aiosqlite:///./mlmonitor.db` | Database connection string. Use `postgresql+asyncpg://user:pass@host/db` for PostgreSQL |
| `UPLOAD_DIR` | `./uploads` | Directory where uploaded datasets are stored |
| `CORS_ORIGINS` | `http://localhost:3000,http://localhost:5173` | Comma-separated list of allowed frontend origins |
| `FRONTEND_BASE_URL` | `http://localhost:3000` | Used to construct model deep-links in alert notifications |

For production, set `DATABASE_URL` to a PostgreSQL connection string. Install `asyncpg`:
```bash
pip install asyncpg
```

---

## Running Tests

```bash
cd backend
source .venv/bin/activate

# Run all tests with coverage
pytest -x --cov=app

# Run a specific test file
pytest tests/test_models.py -v

# Run tests matching a pattern
pytest -k "test_alert" -v
```

Test configuration is in `pyproject.toml`:
```toml
[tool.pytest.ini_options]
asyncio_mode = "auto"
```

All async tests use `pytest-asyncio` and run in auto mode (no `@pytest.mark.asyncio` decorator needed).

---

## Triggering Your First Monitoring Run

After setup, the demo models are pre-loaded with synthetic data and historical run results. To trigger a live run:

**Via the UI:**
1. Open `http://localhost:3000`
2. Click any model in the list
3. Click **"Run Now"** button in the model detail view

**Via the API:**
```bash
# List models to get an ID
curl http://localhost:8000/api/v1/models | python3 -m json.tool

# Trigger a run (replace MODEL_ID)
curl -X POST http://localhost:8000/api/v1/models/MODEL_ID/runs
# Returns: {"run_id": "...", "status": "running"}

# Check run status
curl http://localhost:8000/api/v1/models/MODEL_ID/runs/RUN_ID
```

A run typically completes in a few seconds for small datasets.

---

## Adding a Database Migration

When you modify ORM models in `app/db/models.py`:

```bash
cd backend
source .venv/bin/activate

# Generate migration from model changes
alembic revision --autogenerate -m "add_segment_columns_to_model"

# Review the generated file in alembic/versions/
# Then apply it:
alembic upgrade head
```

**Important:** Always review autogenerated migrations before applying. Autogenerate can miss:
- Server-side defaults
- Indexes on JSON columns
- Custom constraints

Migration naming convention: `verb_description_of_change` (e.g., `add_resolved_at_to_alerts`).

---

## Resetting the Database

To start fresh (delete all data including demo seed):

```bash
cd backend

# Stop the server first, then:
rm -f mlmonitor.db
alembic upgrade head
# Restart server — it will reseed demo data on startup
```

For PostgreSQL, drop and recreate the schema:
```bash
psql $DATABASE_URL -c "DROP SCHEMA public CASCADE; CREATE SCHEMA public;"
alembic upgrade head
```

---

## Common Issues

| Symptom | Likely Cause | Fix |
|---------|-------------|-----|
| `Address already in use` on port 8000 or 3000 | Another process is using the port | `lsof -ti:8000 \| xargs kill` or change the port |
| `ModuleNotFoundError: No module named 'app'` | Running from wrong directory or venv not activated | `cd backend && source .venv/bin/activate` |
| Frontend shows CORS error | Backend not running or wrong `CORS_ORIGINS` | Confirm backend is on :8000; check `CORS_ORIGINS` env var |
| `sqlite3.OperationalError: database is locked` | Multiple writer processes on the same SQLite file | Use a single backend process in dev; switch to PostgreSQL for concurrent access |
| `alembic.util.exc.CommandError: Can't locate revision` | Migration chain broken | Run `alembic history` and check for gaps; may need `alembic stamp head` after manual DB changes |
| Drift results not appearing | No baseline dataset uploaded | Upload a CSV via Settings → Datasets, or configure a storage connection |
| `ImportError: No module named 'boto3'` | Optional cloud dependencies not installed | `pip install boto3` (S3) or `pip install google-cloud-storage` (GCS) |
| Hot-reload not triggering | File watcher issue | Restart `uvicorn` with `--reload` flag; check `uvicorn` version ≥ 0.29 |
