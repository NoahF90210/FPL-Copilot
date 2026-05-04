# FPL Copilot

FPL Copilot is a Fantasy Premier League app that combines model-driven player projections, squad planning, and transfer-aware optimization.

https://fpl-copilot.tech

## What It Does

- shows weekly player predictions and model freshness
- helps you build and save a squad
- compares your current squad with optimizer suggestions
- highlights captaincy, differentials, and fixture-led picks

## Preview

- Dashboard: weekly recommendations, model freshness, and saved squad insights
- My Squad: saved lineup, bench order, captaincy, and rule-aware squad checks
- Optimizer: transfer-aware squad comparisons with points-hit context

## Tech Stack

- `FastAPI` backend
- Dockerized backend runtime
- `Next.js` frontend
- `Postgres` or local SQLite fallback
- `MLflow` experiment tracking
- weekly scheduled data ingestion and model training

## Project Flow

1. Pull official FPL data
2. Store and normalize the data
3. Train models and save predictions
4. Serve the latest outputs through the API
5. Render the dashboard and squad tools in the frontend

## Modeling

- Baseline model: Ridge regression
- Main model: HistGradientBoostingRegressor
- Inputs: rolling form, minutes, BPS, ICT index, expected goal involvements, price, ownership, position, and fixture difficulty
- Evaluation: MAE, RMSE, and time-based validation over recent gameweeks

## ML Workflow

1. Pull and normalize official FPL data into the warehouse
2. Build rolling-window features for recent performance and fixture context
3. Train a Ridge baseline and a HistGradientBoostingRegressor main model
4. Log parameters, metrics, and artifacts with MLflow
5. Save the latest model artifact, evaluation report, and weekly predictions for the app

## What To Look At

- `Model status` on the homepage and about page for freshness and evaluation data
- `Players` for ranked predictions and fixture context
- `My Squad` for saved-team logic and rule-aware lineup handling
- `Optimizer` for transfer-aware comparisons, free-transfer handling, and hit-aware planning

## Main Pages

- `/` dashboard and model status
- `/players` player table and predictions
- `/squad` saved squad builder
- `/optimize` transfer-aware optimizer

## Local Run

From the repo root:

```bash
npm run app:start
```

This starts the backend on `http://127.0.0.1:8000` and the frontend on `http://127.0.0.1:3000`.

## Deployment

This project is set up for a split deployment:

- deploy the `frontend` app separately
- deploy the FastAPI backend from `backend/Dockerfile`
- point the frontend at the backend with `NEXT_PUBLIC_API_URL`
- restrict backend CORS with `ALLOWED_ORIGINS`

Use `DEPLOYMENT_CHECKLIST.md` before sharing the public link.

## Local Data And Training

The backend scripts support both the configured warehouse and a local SQLite fallback.

Use the local fallback when you want a quick local run without depending on the remote database:

```bash
backend/venv/bin/python backend/scripts/init_db.py --use-local-db
backend/venv/bin/python backend/scripts/run_pipeline.py --use-local-db
backend/venv/bin/python backend/scripts/train_model.py --use-local-db
```

If the configured warehouse is unreachable, the scripts now fail with a clear message and point you to `--use-local-db`.

## Docker

Build and run the backend container:

```bash
docker build -t fpl-copilot-api ./backend
docker run --rm -p 8000:8000 --env-file backend/.env fpl-copilot-api
```

For a local-only container test, you can point the backend at the SQLite fallback:

```bash
docker run --rm -p 8000:8000 -e DATABASE_URL=sqlite:////app/fpl_copilot.db fpl-copilot-api
```

## API Routes

- `GET /api/players`
- `GET /api/predict`
- `GET /api/model-status`
- `POST /api/optimize`
- `GET /api/differentials`
- `GET /api/captain`
- `GET /api/squad/{team_id}`
- `GET /api/backtest`
- `GET /health`

## Notes

- The app can use live database data when available.
- If live storage is unavailable, it falls back to saved prediction reports so the demo stays usable.
- GitHub Actions runs a weekly refresh workflow, and model retraining can also be triggered manually.
- Production env examples are included in `frontend/.env.production.example` and `backend/.env.production.example`.
