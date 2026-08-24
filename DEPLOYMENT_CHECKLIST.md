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

## 4. Smoke test the live app

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

## 5. Exercise degraded serving locally

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

## 6. Polish pass before sharing

- Confirm the homepage explains the project clearly in under 30 seconds.
- Confirm the optimizer reads like a transfer planner, not a raw team dump.
- Confirm unavailable-data states feel intentional, not broken.
- Confirm the app looks clean on desktop and mobile.
- Confirm there are no local-development references in user-facing error messages.
- Confirm the GitHub README includes the live URL and current screenshots.
- Confirm GitHub repository metadata has a short description, homepage, and relevant topics.

## 7. Confirm the deployed boundary

A local test or build does **not** prove the public deployment is repaired. On the actual frontend domain, confirm:

- the deployed backend points to the active Supabase project;
- the latest scheduled refresh produced a current prediction gameweek;
- frontend rewrites target the intended backend URL;
- the deployed backend returns within the host timeout when its database is unavailable;
- all seven serving metadata fields match across the public API routes;
- recruiter-facing pages show the same gameweek, generation time, provenance, and warning;
- logs show no missing report file, CORS rejection, proxy error, or repeated database connection stall.

Record the exact deployed commit, frontend URL, backend URL, check time, and response samples before sharing the link.

## 8. Share

- Add the live URL to applications and the GitHub repository homepage field.
- Keep one screenshot of the dashboard and one screenshot of the optimizer ready for applications.
- Use the resume prompt from this project audit to generate concise resume bullets.
