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
- Confirm `backend/.env.production.example` still matches the deployed shape.

## 2. Build before deploy

Backend checks:

```bash
backend/venv/bin/python -m pytest backend/tests/test_config.py backend/tests/test_database_repository.py backend/tests/test_optimizer.py
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
- `/api/optimize`

If the backend also has a separately public URL, verify these directly on the backend domain:

- `/`
- `/health`
- `/api/model-status`

## 5. Polish pass before sharing

- Confirm the homepage explains the project clearly in under 30 seconds.
- Confirm the optimizer reads like a transfer planner, not a raw team dump.
- Confirm snapshot-backed states feel intentional, not broken.
- Confirm the app looks clean on desktop and mobile.
- Confirm there are no local-development references in user-facing error messages.
- Confirm the GitHub README includes the live URL and current screenshots.
- Confirm GitHub repository metadata has a short description, homepage, and relevant topics.

## 6. Share

- Add the live URL to applications and the GitHub repository homepage field.
- Keep one screenshot of the dashboard and one screenshot of the optimizer ready for applications.
- Use the resume prompt from this project audit to generate concise resume bullets.
