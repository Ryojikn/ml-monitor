from __future__ import annotations

"""
Storage connector browse + test implementations.
Each connector handles a specific storage type and returns a consistent
browse response: { items: [{name, type, path, full_path?}], current_path, breadcrumb }
"""

import asyncio
import json
from typing import Any


# ── Helpers ─────────────────────────────────────────────────────────────────


def _run_sync(fn, *args, **kwargs):
    """Run a synchronous function in the default thread pool."""
    loop = asyncio.get_event_loop()
    return loop.run_in_executor(None, lambda: fn(*args, **kwargs))


# ── SQL ──────────────────────────────────────────────────────────────────────


def _sql_browse_sync(conn_str: str, path: str) -> dict:
    try:
        from sqlalchemy import create_engine, inspect, text
    except ImportError:
        raise RuntimeError("sqlalchemy is not installed")

    engine = create_engine(conn_str)
    insp = inspect(engine)

    parts = [p for p in path.split(".") if p] if path else []

    if not parts:
        # List schemas
        try:
            schemas = insp.get_schema_names()
        except Exception:
            schemas = ["public"]
        return {
            "current_path": "",
            "breadcrumb": [],
            "items": [{"name": s, "type": "schema", "path": s} for s in schemas],
        }
    elif len(parts) == 1:
        # List tables in schema
        schema = parts[0]
        tables = insp.get_table_names(schema=schema)
        views = insp.get_view_names(schema=schema)
        items = [{"name": t, "type": "table", "path": f"{schema}.{t}", "full_path": f"{schema}.{t}"} for t in tables]
        items += [{"name": v, "type": "view", "path": f"{schema}.{v}", "full_path": f"{schema}.{v}"} for v in views]
        return {"current_path": schema, "breadcrumb": [schema], "items": items}
    else:
        # Table selected — list columns
        schema, table = parts[0], parts[1]
        cols = insp.get_columns(table, schema=schema)
        items = [{"name": c["name"], "type": "column", "path": f"{schema}.{table}.{c['name']}", "col_type": str(c.get("type", ""))} for c in cols]
        return {
            "current_path": f"{schema}.{table}",
            "breadcrumb": [schema, table],
            "items": items,
            "selectable": True,
            "select_value": f"SELECT * FROM {schema}.{table}",
        }


async def browse_sql(config: dict, path: str) -> dict:
    conn_str = config.get("connection_string", "")
    if not conn_str:
        raise ValueError("connection_string is required")
    return await _run_sync(_sql_browse_sync, conn_str, path)


# ── Unity Catalog (Databricks REST API) ──────────────────────────────────────


async def browse_unity_catalog(config: dict, path: str) -> dict:
    import urllib.request
    import urllib.error

    workspace_url = config.get("workspace_url", "").rstrip("/")
    token = config.get("token", "")
    if not workspace_url or not token:
        raise ValueError("workspace_url and token are required")

    headers = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}
    parts = [p for p in path.split(".") if p] if path else []

    def _get(url: str) -> Any:
        req = urllib.request.Request(url, headers=headers)
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                return json.loads(resp.read())
        except urllib.error.HTTPError as e:
            raise RuntimeError(f"HTTP {e.code}: {e.reason}")

    def _browse() -> dict:
        if not parts:
            # List catalogs
            data = _get(f"{workspace_url}/api/2.1/unity-catalog/catalogs")
            catalogs = data.get("catalogs", [])
            return {
                "current_path": "",
                "breadcrumb": [],
                "items": [{"name": c["name"], "type": "catalog", "path": c["name"]} for c in catalogs],
            }
        elif len(parts) == 1:
            catalog = parts[0]
            data = _get(f"{workspace_url}/api/2.1/unity-catalog/schemas?catalog_name={catalog}")
            schemas = data.get("schemas", [])
            return {
                "current_path": catalog,
                "breadcrumb": [catalog],
                "items": [{"name": s["name"], "type": "schema", "path": f"{catalog}.{s['name']}"} for s in schemas],
            }
        elif len(parts) == 2:
            catalog, schema = parts[0], parts[1]
            data = _get(f"{workspace_url}/api/2.1/unity-catalog/tables?catalog_name={catalog}&schema_name={schema}")
            tables = data.get("tables", [])
            return {
                "current_path": f"{catalog}.{schema}",
                "breadcrumb": [catalog, schema],
                "items": [
                    {
                        "name": t["name"],
                        "type": t.get("table_type", "TABLE").lower(),
                        "path": f"{catalog}.{schema}.{t['name']}",
                        "full_path": f"{catalog}.{schema}.{t['name']}",
                        "selectable": True,
                    }
                    for t in tables
                ],
            }
        else:
            catalog, schema, table = parts[0], parts[1], parts[2]
            data = _get(f"{workspace_url}/api/2.1/unity-catalog/tables/{catalog}.{schema}.{table}")
            cols = data.get("columns", [])
            return {
                "current_path": f"{catalog}.{schema}.{table}",
                "breadcrumb": [catalog, schema, table],
                "items": [{"name": c["name"], "type": "column", "col_type": c.get("type_name", ""), "path": f"{catalog}.{schema}.{table}.{c['name']}"} for c in cols],
                "selectable": True,
                "select_value": f"{catalog}.{schema}.{table}",
            }

    return await _run_sync(_browse)


# ── S3 ────────────────────────────────────────────────────────────────────────


def _s3_browse_sync(config: dict, path: str) -> dict:
    try:
        import boto3
    except ImportError:
        raise RuntimeError("boto3 is not installed. Run: pip install boto3")

    kwargs: dict[str, Any] = {"region_name": config.get("region", "us-east-1")}
    if config.get("access_key_id"):
        kwargs["aws_access_key_id"] = config["access_key_id"]
        kwargs["aws_secret_access_key"] = config.get("secret_access_key", "")
    if config.get("endpoint_url"):
        kwargs["endpoint_url"] = config["endpoint_url"]

    s3 = boto3.client("s3", **kwargs)

    if not path:
        # List buckets
        resp = s3.list_buckets()
        return {
            "current_path": "",
            "breadcrumb": [],
            "items": [{"name": b["Name"], "type": "bucket", "path": b["Name"]} for b in resp.get("Buckets", [])],
        }

    parts = path.split("/", 1)
    bucket = parts[0]
    prefix = (parts[1] if len(parts) > 1 else "") + "/"
    if prefix == "/":
        prefix = ""

    resp = s3.list_objects_v2(Bucket=bucket, Prefix=prefix, Delimiter="/")
    items = []
    for cp in resp.get("CommonPrefixes", []):
        folder = cp["Prefix"].rstrip("/")
        name = folder.split("/")[-1]
        items.append({"name": name, "type": "folder", "path": f"{bucket}/{folder}"})
    for obj in resp.get("Contents", []):
        key = obj["Key"]
        if key == prefix:
            continue
        name = key.split("/")[-1]
        if name.endswith(".csv") or name.endswith(".parquet") or name.endswith(".json"):
            items.append({"name": name, "type": "file", "path": f"{bucket}/{key}", "full_path": f"s3://{bucket}/{key}", "selectable": True})

    breadcrumb = [bucket] + [p for p in prefix.strip("/").split("/") if p]
    return {"current_path": path, "breadcrumb": breadcrumb, "items": items}


async def browse_s3(config: dict, path: str) -> dict:
    return await _run_sync(_s3_browse_sync, config, path)


# ── GCS ───────────────────────────────────────────────────────────────────────


def _gcs_browse_sync(config: dict, path: str) -> dict:
    try:
        from google.cloud import storage as gcs
    except ImportError:
        raise RuntimeError("google-cloud-storage is not installed. Run: pip install google-cloud-storage")

    project = config.get("project")
    creds_json = config.get("credentials_json")
    if creds_json:
        import google.oauth2.service_account as sa
        import json as _json
        creds = sa.Credentials.from_service_account_info(_json.loads(creds_json))
        client = gcs.Client(project=project, credentials=creds)
    else:
        client = gcs.Client(project=project)

    if not path:
        buckets = [b.name for b in client.list_buckets()]
        return {
            "current_path": "",
            "breadcrumb": [],
            "items": [{"name": b, "type": "bucket", "path": b} for b in buckets],
        }

    parts = path.split("/", 1)
    bucket_name = parts[0]
    prefix = (parts[1] if len(parts) > 1 else "") + "/"
    if prefix == "/":
        prefix = ""

    bucket = client.bucket(bucket_name)
    blobs = client.list_blobs(bucket_name, prefix=prefix, delimiter="/")
    items = []
    for page in blobs.pages:
        for prefix_str in page.prefixes:
            folder = prefix_str.rstrip("/")
            name = folder.split("/")[-1]
            items.append({"name": name, "type": "folder", "path": f"{bucket_name}/{folder}"})
        for blob in page:
            if blob.name == prefix:
                continue
            name = blob.name.split("/")[-1]
            if name.endswith(".csv") or name.endswith(".parquet") or name.endswith(".json"):
                items.append({"name": name, "type": "file", "path": f"{bucket_name}/{blob.name}", "full_path": f"gs://{bucket_name}/{blob.name}", "selectable": True})

    breadcrumb = [bucket_name] + [p for p in prefix.strip("/").split("/") if p]
    return {"current_path": path, "breadcrumb": breadcrumb, "items": items}


async def browse_gcs(config: dict, path: str) -> dict:
    return await _run_sync(_gcs_browse_sync, config, path)


# ── Dispatcher ────────────────────────────────────────────────────────────────


async def browse_connection(conn_type: str, config: dict, path: str = "") -> dict:
    if conn_type == "sql":
        return await browse_sql(config, path)
    elif conn_type == "unity_catalog":
        return await browse_unity_catalog(config, path)
    elif conn_type == "s3":
        return await browse_s3(config, path)
    elif conn_type == "gcs":
        return await browse_gcs(config, path)
    else:
        raise ValueError(f"Unknown connection type: {conn_type}")


async def test_connection(conn_type: str, config: dict) -> dict:
    try:
        await browse_connection(conn_type, config, "")
        return {"ok": True, "message": "Connection successful"}
    except Exception as exc:
        return {"ok": False, "message": str(exc)}
