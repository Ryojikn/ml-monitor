from __future__ import annotations

from datetime import datetime
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.db.models import StorageConnection
from app.engine.connectors import browse_connection, test_connection
from app.schemas.connection import StorageConnectionCreate, StorageConnectionRead, StorageConnectionUpdate

router = APIRouter(prefix="/connections", tags=["connections"])


@router.get("", response_model=list[StorageConnectionRead])
async def list_connections(db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(StorageConnection).order_by(StorageConnection.created_at.desc()))
    return result.scalars().all()


@router.post("", response_model=StorageConnectionRead, status_code=201)
async def create_connection(body: StorageConnectionCreate, db: AsyncSession = Depends(get_db)):
    conn = StorageConnection(**body.model_dump())
    db.add(conn)
    await db.commit()
    await db.refresh(conn)
    return conn


@router.get("/{conn_id}", response_model=StorageConnectionRead)
async def get_connection(conn_id: str, db: AsyncSession = Depends(get_db)):
    conn = await db.get(StorageConnection, conn_id)
    if not conn:
        raise HTTPException(404, "Connection not found")
    return conn


@router.patch("/{conn_id}", response_model=StorageConnectionRead)
async def update_connection(conn_id: str, body: StorageConnectionUpdate, db: AsyncSession = Depends(get_db)):
    conn = await db.get(StorageConnection, conn_id)
    if not conn:
        raise HTTPException(404, "Connection not found")
    for k, v in body.model_dump(exclude_none=True).items():
        setattr(conn, k, v)
    await db.commit()
    await db.refresh(conn)
    return conn


@router.delete("/{conn_id}", status_code=204)
async def delete_connection(conn_id: str, db: AsyncSession = Depends(get_db)):
    conn = await db.get(StorageConnection, conn_id)
    if not conn:
        raise HTTPException(404, "Connection not found")
    await db.delete(conn)
    await db.commit()


@router.post("/{conn_id}/test")
async def test_conn(conn_id: str, db: AsyncSession = Depends(get_db)):
    conn = await db.get(StorageConnection, conn_id)
    if not conn:
        raise HTTPException(404, "Connection not found")
    result = await test_connection(conn.type, conn.config)
    conn.last_tested_at = datetime.utcnow()
    conn.last_test_ok = result["ok"]
    await db.commit()
    return result


@router.get("/{conn_id}/browse")
async def browse_conn(conn_id: str, path: str = "", db: AsyncSession = Depends(get_db)):
    conn = await db.get(StorageConnection, conn_id)
    if not conn:
        raise HTTPException(404, "Connection not found")
    try:
        return await browse_connection(conn.type, conn.config, path)
    except Exception as exc:
        raise HTTPException(400, str(exc))


@router.get("/{conn_id}/columns")
async def get_connection_columns(conn_id: str, path: str = "", db: AsyncSession = Depends(get_db)):
    """Return column names from a file or table at the given path."""
    conn = await db.get(StorageConnection, conn_id)
    if not conn:
        raise HTTPException(404, "Connection not found")
    try:
        from app.engine.loaders import load_dataframe
        source_config = {"source_type": conn.type, "path": path, "format": "parquet" if path.endswith(".parquet") else "csv"}
        df = await load_dataframe(source_config, conn.config or {})
        return {"columns": list(df.columns), "path": path}
    except Exception as exc:
        raise HTTPException(400, str(exc))
