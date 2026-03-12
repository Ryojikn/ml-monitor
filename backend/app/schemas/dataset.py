from __future__ import annotations
from datetime import datetime
from pydantic import BaseModel


class DatasetRead(BaseModel):
    id: str
    model_id: str
    role: str
    filename: str
    row_count: int
    column_names: list[str]
    uploaded_at: datetime

    model_config = {"from_attributes": True}
