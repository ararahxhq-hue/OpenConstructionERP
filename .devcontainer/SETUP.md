# Opening this project on another computer

This repo is a fork of OpenConstructionERP set up to run in a **VS Code Dev Container**.
Everything the app needs (Postgres, Redis, MinIO, Python 3.12, Node 20) is provided by
the container — you do **not** install those on your host.

## 1. Prerequisites (install once per computer)

- **Git**
- **Docker Desktop** (macOS/Windows) or **Docker Engine + docker compose** (Linux) — running
- **VS Code** with the **Dev Containers** extension (`ms-vscode-remote.remote-containers`)

## 2. First: commit the dev-container config to your fork (one time)

The `.devcontainer/` folder is what makes "Reopen in Container" work. If it isn't
committed and pushed, a fresh clone on another machine won't have it. From this machine:

```bash
git add .devcontainer
git commit -m "Add dev container config"
git push origin main
```

> `.claude/` is optional (Claude Code settings) — commit it too if you want it to travel.

## 3. Clone your fork (on the other computer)

```bash
git clone https://github.com/ararahxhq-hue/OpenConstructionERP.git
cd OpenConstructionERP
```

Because you pushed `.devcontainer/` in the previous step, it comes with the clone — no
extra setup files to copy around.

## 4. Open in the container

1. Open the folder in VS Code.
2. When prompted **"Reopen in Container"**, click it.
   (Or: `Cmd/Ctrl+Shift+P` → **Dev Containers: Reopen in Container**.)

First launch builds the image, starts Postgres/Redis/MinIO, and runs
`.devcontainer/post-create.sh`, which:

- installs backend deps: `pip install --user -e "backend/.[server]"`
- runs DB migrations: `alembic upgrade head`
- installs frontend deps: `cd frontend && npm install`

This takes a few minutes the first time. If it seems to hang or you want to re-run it
manually inside the container:

```bash
bash .devcontainer/post-create.sh
```

## 5. Run the app (two terminals inside the container)

**Terminal 1 — backend** (http://localhost:8000):
```bash
cd backend && uvicorn app.main:create_app --factory --reload --host 0.0.0.0 --port 8000
```

**Terminal 2 — frontend** (http://localhost:5173):
```bash
cd frontend && npm run dev -- --host 0.0.0.0
```

Then open **http://localhost:5173** in your browser. Ports are auto-forwarded to the host.

Optional seed data (cost catalog + regional indices):
```bash
make seed
```

## 6. Keeping the fork up to date (optional)

Add the upstream remote once, then pull updates when you want them:
```bash
git remote add upstream https://github.com/OpenConstructionERP/OpenConstructionERP.git
git fetch upstream
git merge upstream/main        # or: git rebase upstream/main
```
> Confirm the real upstream URL — swap it in if it differs.

## Notes / gotchas

- **Do NOT run `make infra` or `make dev-backend` inside the container.** Postgres, Redis
  and MinIO already run as sibling services; those make targets would try to start a second
  copy. The commands in step 4 skip the infra step on purpose.
- Inside the container the DB/cache/storage hosts are `postgres`, `redis`, `minio`
  (not `localhost`) — this is already configured via env vars in
  `.devcontainer/docker-compose.yml`.
- The `JWT_SECRET` in the dev compose file is **dev-only**. Never reuse it anywhere real.
- Forwarded ports: `8000` backend · `5173` frontend · `5432` postgres · `6379` redis ·
  `9000/9001` minio api/console.

## Quick health check

If something looks off, verify inside the container:
```bash
python -c "import app.main; print('backend OK')"          # deps installed
cd backend && alembic current                              # should show a revision (head)
ls frontend/node_modules >/dev/null && echo "frontend OK"  # deps installed
```
