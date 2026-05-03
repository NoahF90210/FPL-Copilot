# Deployment Checklist

Use this checklist before sharing the public link.

## 1. Prepare production config

- Frontend:
  - Set `NEXT_PUBLIC_API_URL` to the deployed backend URL.
  - Example file: `frontend/.env.production.example`
- Backend:
  - Set `APP_ENV=production`
  - Set `DATABASE_URL`
  - Set `ALLOWED_ORIGINS` to the deployed frontend URL
  - Keep report paths and model artifact paths pointed at `backend/reports`
  - Example file: `backend/.env.production.example`

## 2. Build before deploy

- Backend checks:
  - `backend/venv/bin/python -m pytest backend/tests/test_config.py backend/tests/test_database_repository.py backend/tests/test_optimizer.py`
  - `backend/venv/bin/python backend/scripts/train_model.py --use-local-db`
- Frontend checks:
  - `cd frontend && npx tsc --noEmit`
  - `cd frontend && NEXT_PUBLIC_API_URL=https://your-backend-domain.example.com npm run build`
- Container check:
  - `docker build -t fpl-copilot-api ./backend`

## 3. Deploy

- Frontend:
  - Deploy the `frontend` app
  - Confirm it points at the production backend
- Backend:
  - Deploy the Dockerized FastAPI service from `backend/Dockerfile`
  - Confirm the service exposes port `8000`

## 4. Smoke test the live app

- Open:
  - `/`
  - `/players`
  - `/squad`
  - `/optimize`
  - `/about-model`
- Verify backend routes:
  - `/`
  - `/health`
  - `/api/model-status`
  - `/api/predict`
  - `/api/optimize`

## 5. Polish pass before sharing

- Confirm the homepage explains the project clearly in under 30 seconds.
- Confirm the optimizer reads like a transfer planner, not a raw team dump.
- Confirm snapshot-backed states feel intentional, not broken.
- Confirm the app looks clean on desktop and mobile.
- Confirm there are no local-development references in user-facing error messages.

## 6. Share

- Add the live URL to the GitHub repo description or README.
- Keep one screenshot of the dashboard and one screenshot of the optimizer ready for applications.
