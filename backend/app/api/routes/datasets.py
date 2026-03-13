from __future__ import annotations
import shutil
from pathlib import Path

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, Form
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select

from app.config import settings
from app.db.session import get_db
from app.db.models import Dataset, Model
from app.schemas.dataset import DatasetRead

router = APIRouter(prefix="/models/{model_id}/datasets", tags=["datasets"])


@router.post("", status_code=201, response_model=DatasetRead)
async def upload_dataset(
    model_id: str,
    file: UploadFile = File(...),
    role: str = Form(...),
    db: AsyncSession = Depends(get_db),
):
    # Validate model exists
    result = await db.execute(select(Model).where(Model.id == model_id))
    m = result.scalar_one_or_none()
    if not m:
        raise HTTPException(status_code=404, detail="Model not found")

    if role not in ("baseline", "production"):
        raise HTTPException(status_code=422, detail="role must be 'baseline' or 'production'")

    # Save file
    dest_dir = settings.upload_path / model_id / role
    dest_dir.mkdir(parents=True, exist_ok=True)
    dest_path = dest_dir / (file.filename or "data.csv")

    with dest_path.open("wb") as f:
        shutil.copyfileobj(file.file, f)

    # Infer schema
    try:
        df = pd.read_csv(dest_path, nrows=5)
        column_names = list(df.columns)
        row_count = sum(1 for _ in open(dest_path)) - 1  # subtract header
    except Exception:
        column_names = []
        row_count = 0

    ds = Dataset(
        model_id=model_id,
        role=role,
        filename=file.filename or "data.csv",
        file_path=str(dest_path),
        row_count=row_count,
        column_names=column_names,
    )
    db.add(ds)
    await db.commit()
    await db.refresh(ds)
    return ds


@router.get("", response_model=list[DatasetRead])
async def list_datasets(model_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Dataset).where(Dataset.model_id == model_id).order_by(Dataset.uploaded_at.desc()))
    return result.scalars().all()
