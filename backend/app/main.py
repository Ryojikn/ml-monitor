from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select, text

from app.config import settings
from app.db.base import Base
from app.db.session import engine, AsyncSessionLocal
from app.db.models import Model
from app.db.seed import seed_demo_models
from app.api.v1 import router as v1_router
from app.scheduler import scheduler, register_model_job


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Create tables on startup (dev convenience; Alembic handles schema evolution)
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
        # Add is_demo column to existing DBs that predate this column
        try:
            await conn.execute(text("ALTER TABLE models ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT FALSE"))
        except Exception:
            pass  # column already exists — safe to ignore
        try:
            await conn.execute(text("ALTER TABLE alerts ADD COLUMN assigned_to TEXT"))
        except Exception:
            pass  # column already exists — safe to ignore

    # 2. Seed demo models (idempotent — no-op if already seeded)
    async with AsyncSessionLocal() as db:
        await seed_demo_models(db)

    # 3. Ensure upload dir exists
    settings.upload_path.mkdir(parents=True, exist_ok=True)

    # 4. Start the scheduler
    scheduler.start()

    # 5. Register cron jobs for all models that have a schedule
    async with AsyncSessionLocal() as db:
        result = await db.execute(
            select(Model).where(Model.schedule != None, Model.schedule != "")
        )
        models = result.scalars().all()
        for m in models:
            try:
                register_model_job(m.id, m.schedule)
            except Exception:
                pass  # invalid cron — skip silently; logged inside register_model_job

    yield

    # 5. Shut down the scheduler on app stop
    scheduler.shutdown(wait=False)


app = FastAPI(title="MLMonitor API", version="1.0.0", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(v1_router, prefix="/api/v1")


@app.get("/api/v1/health")
async def health():
    return {"status": "ok", "version": "1.0.0"}
