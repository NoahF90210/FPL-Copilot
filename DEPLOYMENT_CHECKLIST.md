# Deployment Checklist

Use this checklist before sharing the public link or after changing deployment config.

## 1. Prepare production config

Frontend:

- Set `NEXT_PUBLIC_API_URL` to the deployed backend URL.
- Confirm `frontend/.env.production.example` still documents the expected value.

Backend:

- Set `APP_ENV=production`.
- Set `DATABASE_URL`.
- Set `ALLOWED_ORIGINS` to the deployed frontend URL.
- Keep report paths and model artifact paths pointed at `backend/reports` unless the host has a dedicated artifact volume.
- Confirm the weekly refresh workflow can connect to the same Supabase project used by the backend.
- Confirm `backend/.env.production.example` still matches the deployed shape.

## 2. Build before deploy

Backend checks:

```bash
backend/venv/bin/python -m pytest backend/tests/test_config.py backend/tests/test_database_repository.py backend/tests/test_optimizer.py backend/tests/test_public_contract.py
backend/venv/bin/python backend/scripts/train_model.py --use-local-db
```

Frontend checks:

```bash
cd frontend && npm run build
```

Container check:

```bash
docker build -t fpl-copilot-api ./backend
```

## 3. Deploy

Frontend:

- Deploy the `frontend` app.
- Confirm it points at the production backend through `NEXT_PUBLIC_API_URL`.
- Confirm `/api/*` and `/health` are proxied to the backend by `frontend/next.config.js`.

Backend:

- Deploy the Dockerized FastAPI service from `backend/Dockerfile`.
- Confirm the service exposes port `8000` or the platform-equivalent web port.
- Confirm CORS allows the production frontend only.

## 4. Activate and verify the data refresh

Before the first production run of the identity upgrade:

- Back up the production database and record the deployed commit. Do not treat a local SQLite check as a PostgreSQL migration test.
- Verify all seven warehouse tables have RLS enabled and no table privileges for `anon`, `authenticated`, or `PUBLIC`. The browser uses FastAPI; do not add permissive Data API policies to silence an unavailable state. Verify denial with ordinary roles and separately confirm the server-side owner can still ingest and serve.
- Test the additive migration on a restored database first. Existing identities and statistics remain unverified until a complete official ingestion succeeds; legacy history is retained, not guessed or deleted.
- Run ingestion, training, and verification against the **same** configured database. Successful ingestion intentionally clears old forecasts; if training fails, the app remains unavailable rather than serving a mismatched batch.
- Do not enable a default-branch schedule until the fixed code is on that branch. GitHub schedules use the default branch, not an unmerged feature branch.

```bash
backend/venv/bin/python backend/scripts/init_db.py
backend/venv/bin/python backend/scripts/run_pipeline.py
backend/venv/bin/python backend/scripts/train_model.py
backend/venv/bin/python backend/scripts/verify_refresh.py
```

Verification is read-only. It requires the official current-season roster and availability, a matching official fixture schedule, one complete forecast batch, the official next prediction target, successful current ingestion/training, and timestamps no more than 36 hours old. The API enforces the same original-batch integrity checks on reads, then filters out individual players whose current official availability no longer permits a recommendation. It does not disable unrelated forecasts or invent predictions for newly available players. Pipeline verification still requires a fully current availability snapshot. PostgreSQL uses repeatable-read transactions and SQLite explicitly begins request snapshots so concurrent ingestion cannot relabel an in-flight forecast.

The refresh is scheduled daily at 09:15 UTC. The refresh and manual retraining workflows share a concurrency group. After authorized activation, inspect both workflow state and the actual latest run:

```bash
gh workflow view daily-data-refresh.yml --repo NoahF90210/FPL-Copilot
gh run list --repo NoahF90210/FPL-Copilot --workflow daily-data-refresh.yml --limit 3
```

GitHub can automatically disable public-repository schedules after 60 days without repository activity. Re-enabling is an external operation, not an automatic side effect of changing the cron expression. Check workflow state before presentations; use the full refresh workflow, not retraining alone, if the roster is old.

## 5. Smoke test the live app

Open these frontend pages:

- `/`
- `/players`
- `/squad`
- `/optimize`
- `/about-model`

Verify these API paths on the frontend domain:

- `/health`
- `/api/model-status`
- `/api/predict`
- `/api/players`
- `/api/captain`
- `/api/differentials`
- `/api/optimize`

If the backend also has a separately public URL, verify these directly on the backend domain:

- `/`
- `/health`
- `/api/model-status`

For `/health`, `/api/model-status`, `/api/players`, `/api/predict`, `/api/captain`, and `/api/differentials`, compare these fields and require them to describe one compatible serving state:

- `target_gameweek`
- `generated_at`
- `serving_mode`
- `prediction_provenance`
- `model_version`
- `is_stale`
- `serving_warning`

Require `serving_mode=database` and `prediction_provenance=trained_model` for a usable public forecast.
If the database is unavailable or the forecast is stale, the app must show an unavailable or stale state and must not substitute old or synthetic output.

## 6. Exercise degraded serving locally

Before deployment, start the backend against a deliberately unreachable local database endpoint without changing any env file:

```bash
cd backend
DATABASE_URL='postgresql+psycopg://invalid:invalid@127.0.0.1:1/fpl' \
APP_ENV=production \
ALLOWED_ORIGINS='http://127.0.0.1:3000' \
venv/bin/python -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Then verify:

- the API starts in degraded mode rather than exiting;
- `/api/players` and `/api/predict` return a fast 503 with a safe unavailable message;
- `/api/model-status` and `/health` expose an unavailable, non-sensitive status;
- `/players`, `/squad`, `/optimize`, and `/about-model` render useful unavailable states;
- no route remains indefinitely on a loading or blank state.

Stop the local process after the check. This proves only the degraded unavailable-data path.

## 7. Polish pass before sharing

- Confirm the homepage explains the project clearly in under 30 seconds.
- Confirm the optimizer reads like a transfer planner, not a raw team dump.
- Confirm unavailable-data states feel intentional, not broken.
- Confirm the app looks clean on desktop and mobile.
- Confirm there are no local-development references in user-facing error messages.
- Confirm the GitHub README includes the live URL and current screenshots.
- Confirm GitHub repository metadata has a short description, homepage, and relevant topics.

## 8. Confirm the deployed boundary

A local test or build does **not** prove the public deployment is repaired. On the actual frontend domain, confirm:

- the deployed backend points to the active Supabase project;
- the latest scheduled refresh produced a current prediction gameweek;
- frontend rewrites target the intended backend URL;
- the deployed backend returns within the host timeout when its database is unavailable;
- all seven serving metadata fields match across the public API routes;
- recruiter-facing pages show the same gameweek, generation time, provenance, and warning;
- logs show no missing report file, CORS rejection, proxy error, or repeated database connection stall.

Record the exact deployed commit, frontend URL, backend URL, check time, and response samples before sharing the link.

## 9. Share

- Add the live URL to applications and the GitHub repository homepage field.
- Keep one screenshot of the dashboard and one screenshot of the optimizer ready for applications.
- Use the resume prompt from this project audit to generate concise resume bullets.
