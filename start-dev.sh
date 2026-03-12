#!/bin/bash
# Start MLMonitor in development mode (backend + frontend)

echo "Starting MLMonitor backend..."
cd backend
if [ ! -d ".venv" ]; then
  python3 -m venv .venv
  source .venv/bin/activate
  pip install -q fastapi "uvicorn[standard]" "sqlalchemy[asyncio]" aiosqlite alembic \
    pydantic pydantic-settings python-multipart \
    numpy scipy pandas scikit-learn apscheduler eval_type_backport
else
  source .venv/bin/activate
fi

# Start backend in background
PYTHONPATH=. uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload &
BACKEND_PID=$!
cd ..

echo "Backend running (PID $BACKEND_PID)"
echo "Starting MLMonitor frontend..."
npm run dev &
FRONTEND_PID=$!

echo ""
echo "MLMonitor running:"
echo "  Frontend: http://localhost:3000"
echo "  Backend:  http://localhost:8000"
echo "  API docs: http://localhost:8000/docs"
echo ""
echo "Press Ctrl+C to stop both services."

trap "kill $BACKEND_PID $FRONTEND_PID 2>/dev/null; exit" INT TERM
wait
