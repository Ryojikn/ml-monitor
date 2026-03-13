"""
Multi-source data loading layer.

Dispatches by source_config["source_type"]:
  upload        — not handled here; caller uses Dataset table + CSV read
  s3            — boto3, CSV/parquet
  gcs           — google-cloud-storage, CSV/parquet
  sql           — pandas read_sql with time filter
  unity_catalog — stub (raises NotImplementedError)

All sync I/O runs in a thread executor to avoid blocking the event loop.
"""
from __future__ import annotations

import asyncio
import io
from datetime import datetime
from functools import partial
from typing import Any

import pandas as pd


# ── helpers ──────────────────────────────────────────────────────────────────

def _apply_time_filter(df: pd.DataFrame, time_filter: dict | None) -> pd.DataFrame:
    """Filter DataFrame to [start, end] on a timestamp column."""
    if not time_filter:
        return df
    col = time_filter.get("col", "")
    start: datetime | None = time_filter.get("start")
    end: datetime | None = time_filter.get("end")
    if col and col in df.columns:
        try:
            df[col] = pd.to_datetime(df[col], utc=True, errors="coerce")
            if start:
                start_ts = pd.Timestamp(start, tz="UTC")
                df = df[df[col] >= start_ts]
            if end:
                end_ts = pd.Timestamp(end, tz="UTC")
                df = df[df[col] <= end_ts]
        except Exception:
            pass
    return df


# ── source-specific loaders (sync, run in executor) ──────────────────────────

def _load_s3_sync(
    path: str,
    fmt: str,
    conn_config: dict,
    time_filter: dict | None,
) -> pd.DataFrame:
    try:
        import boto3  # type: ignore
    except ImportError:
        raise RuntimeError(
            "boto3 is required for S3 data loading. "
            "Install it with: pip install boto3"
        )

    session = boto3.Session(
        aws_access_key_id=conn_config.get("access_key_id"),
        aws_secret_access_key=conn_config.get("secret_access_key"),
        region_name=conn_config.get("region", "us-east-1"),
    )
    s3 = session.client(
        "s3",
        endpoint_url=conn_config.get("endpoint_url") or None,
    )

    # Parse s3://bucket/key
    path = path.lstrip("s3://")
    bucket, _, key = path.partition("/")

    obj = s3.get_object(Bucket=bucket, Key=key)
    data = obj["Body"].read()

    if fmt == "parquet":
        df = pd.read_parquet(io.BytesIO(data))
    else:
        df = pd.read_csv(io.BytesIO(data))

    return _apply_time_filter(df, time_filter)


def _load_gcs_sync(
    path: str,
    fmt: str,
    conn_config: dict,
    time_filter: dict | None,
) -> pd.DataFrame:
    try:
        from google.cloud import storage as gcs_storage  # type: ignore
    except ImportError:
        raise RuntimeError(
            "google-cloud-storage is required for GCS data loading. "
            "Install it with: pip install google-cloud-storage"
        )

    creds_json = conn_config.get("credentials_json")
    if creds_json:
        import json
        from google.oauth2 import service_account  # type: ignore
        creds = service_account.Credentials.from_service_account_info(
            json.loads(creds_json) if isinstance(creds_json, str) else creds_json
        )
        client = gcs_storage.Client(credentials=creds)
    else:
        client = gcs_storage.Client()  # application default credentials

    # Parse gs://bucket/blob or bucket/blob
    path = path.lstrip("gs://")
    bucket_name, _, blob_name = path.partition("/")
    bucket = client.bucket(bucket_name)
    blob = bucket.blob(blob_name)
    data = blob.download_as_bytes()

    if fmt == "parquet":
        df = pd.read_parquet(io.BytesIO(data))
    else:
        df = pd.read_csv(io.BytesIO(data))

    return _apply_time_filter(df, time_filter)


def _load_sql_sync(
    query_or_table: str,
    conn_config: dict,
    time_filter: dict | None,
) -> pd.DataFrame:
    from sqlalchemy import create_engine, text  # type: ignore

    connection_string = conn_config.get("connection_string", "")
    if not connection_string:
        raise ValueError("SQL connection requires 'connection_string' in connection config")

    engine = create_engine(connection_string)

    # If query_or_table looks like a SELECT statement, use it directly
    q = query_or_table.strip()
    if q.upper().startswith("SELECT"):
        sql_query = q
        if time_filter:
            col = time_filter.get("col", "")
            start = time_filter.get("start")
            end = time_filter.get("end")
            if col and start and end:
                sql_query = (
                    f"SELECT * FROM ({sql_query}) AS _t "
                    f"WHERE {col} >= '{start}' AND {col} <= '{end}'"
                )
    else:
        # Treat as table name
        col = time_filter.get("col", "") if time_filter else ""
        start = time_filter.get("start") if time_filter else None
        end = time_filter.get("end") if time_filter else None
        if col and start and end:
            sql_query = (
                f"SELECT * FROM {q} WHERE {col} >= '{start}' AND {col} <= '{end}'"
            )
        else:
            sql_query = f"SELECT * FROM {q}"

    with engine.connect() as conn:
        df = pd.read_sql(text(sql_query), conn)

    return df


# ── public async interface ────────────────────────────────────────────────────

async def load_dataframe(
    source_config: dict,
    connection_config: dict | None = None,
    time_filter: dict | None = None,
) -> pd.DataFrame:
    """
    Load a DataFrame from a configured data source.

    Args:
        source_config: DataSourceConfig dict (source_type, path, format, ...).
        connection_config: StorageConnection.config dict with credentials.
        time_filter: Optional dict with keys 'col' (str), 'start' (datetime),
                     'end' (datetime) to filter loaded data.

    Returns:
        pandas DataFrame.

    Raises:
        ValueError: for unsupported or misconfigured sources.
        RuntimeError: when optional dependencies (boto3, etc.) are missing.
        NotImplementedError: for source types not yet implemented.
    """
    source_type = source_config.get("source_type", "upload")
    path = source_config.get("path", "")
    fmt = source_config.get("format", "csv")
    conn_config: dict = connection_config or {}

    loop = asyncio.get_event_loop()

    if source_type == "upload":
        raise ValueError(
            "source_type='upload' is handled via the Dataset table. "
            "Call _load_csv(file_path) directly for uploaded datasets."
        )

    elif source_type == "s3":
        fn = partial(_load_s3_sync, path, fmt, conn_config, time_filter)
        return await loop.run_in_executor(None, fn)

    elif source_type == "gcs":
        fn = partial(_load_gcs_sync, path, fmt, conn_config, time_filter)
        return await loop.run_in_executor(None, fn)

    elif source_type == "sql":
        fn = partial(_load_sql_sync, path, conn_config, time_filter)
        return await loop.run_in_executor(None, fn)

    elif source_type == "unity_catalog":
        raise NotImplementedError(
            "Unity Catalog direct loading is not yet implemented. "
            "Use source_type='sql' with a Databricks JDBC/ODBC connection_string instead."
        )

    else:
        raise ValueError(f"Unknown source_type: '{source_type}'")
