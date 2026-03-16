from fastapi import APIRouter
from app.api.routes import models, datasets, runs, drift, alerts, connections
from app.api.routes import api_keys
from app.api.routes import notifications
from app.api.routes import teams, users

router = APIRouter()
router.include_router(models.router)
router.include_router(datasets.router)
router.include_router(runs.router)
router.include_router(drift.router)
router.include_router(alerts.router)
router.include_router(connections.router)
router.include_router(api_keys.router)
router.include_router(notifications.router)
router.include_router(teams.router)
router.include_router(users.router)
