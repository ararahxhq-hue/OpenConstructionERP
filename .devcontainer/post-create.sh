#!/usr/bin/env bash
# Runs once, after the dev container is first created.
# Installs backend + frontend dependencies and brings the DB schema up to date.
set -euo pipefail

echo "==> Installing backend dependencies (editable + [server] extra)..."
pip install --user -e "backend/.[server]"

echo "==> Applying database migrations (alembic upgrade head)..."
# postgres is already healthy (see depends_on in docker-compose.yml).
( cd backend && alembic upgrade head )

echo "==> Installing frontend dependencies (npm install)..."
( cd frontend && npm install )

cat <<'DONE'

============================================================
 Dev container ready.

 Start the app in two terminals:

   Terminal 1 (backend, http://localhost:8000):
     cd backend && uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8000

   Terminal 2 (frontend, http://localhost:5173):
     cd frontend && npm run dev -- --host 0.0.0.0

 Then open http://localhost:5173

 NOTE: do NOT use `make dev-backend` / `make infra` inside the
 container — Postgres, Redis and MinIO are already running as
 sibling services. The commands above skip the infra step.

 Optional seed data (cost catalog + regional indices):
   make seed
============================================================
DONE
