# FPL Copilot

FPL Copilot is a Fantasy Premier League app that combines model-driven player projections, squad planning, and transfer-aware optimization.

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
- `Next.js` frontend
- `Postgres` or local SQLite fallback
- scheduled data ingestion and model training

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
