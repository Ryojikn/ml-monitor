FROM python:3.11-slim

WORKDIR /app

RUN pip install --no-cache-dir \
    fastapi "uvicorn[standard]" "sqlalchemy[asyncio]" aiosqlite asyncpg alembic \
    pydantic pydantic-settings python-multipart \
    numpy scipy pandas scikit-learn apscheduler eval_type_backport

COPY . .

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
