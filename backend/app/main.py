import asyncio
from contextlib import asynccontextmanager
from concurrent.futures import ThreadPoolExecutor

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import select

from app.config import settings
from app.db.session import AsyncSessionLocal
from app.db.models import Model
from app.db.seed import seed_demo_models
from app.api.v1 import router as v1_router
from app.scheduler import scheduler, register_model_job


def _run_migrations_sync() -> None:
    from alembic.config import Config
    from alembic import command

    alembic_cfg = Config("alembic.ini")
    command.upgrade(alembic_cfg, "head")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. Run Alembic migrations — creates tables on first run, no-ops on subsequent runs
    loop = asyncio.get_event_loop()
    with ThreadPoolExecutor() as pool:
        await loop.run_in_executor(pool, _run_migrations_sync)

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

    # 6. Shut down the scheduler on app stop
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
