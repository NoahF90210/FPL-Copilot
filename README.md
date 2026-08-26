# FPL Copilot

**[Open FPL Copilot](https://fpl-copilot.tech)**

FPL Copilot is a Fantasy Premier League decision-support app built around one practical question:

> Which players are most likely to score well in the next gameweek, and what should I do with that information?

The app turns official FPL data into a ranked player forecast, then carries that forecast into squad construction and transfer planning.

## The product

The dashboard starts with the next-gameweek leaders so the main decision is visible immediately.

Players lets you compare projected points with price, recent form, ownership, minutes, ICT, and fixture difficulty.

My Squad applies the rules of a legal 15-player team and helps set the lineup, captain, vice-captain, and bench.

Optimizer compares squad options and transfer moves while accounting for free transfers, budget, and points hits.

The Model page explains the prediction target, inputs, validation approach, and current serving context.

## How the forecast works

The pipeline ingests the official FPL API into Supabase.

A Ridge regression forecasts next-gameweek player points from three inputs:

- rolling points over the latest five appearances;
- rolling minutes over the latest five appearances;
- next-opponent fixture difficulty.

A recent-points average provides a simple comparison baseline.

The model is evaluated with a later-gameweek holdout that follows the forecasting timeline.

Experiment tracking runs as optional telemetry while model, report, and prediction writes remain independent.

The forecast supports player research, captaincy planning, squad construction, and transfer comparison.

## Data freshness

The app reads forecasts from the live Supabase database.

A scheduled GitHub Actions workflow refreshes official FPL data and retrains the model every Tuesday.

After a gameweek deadline passes, the target moves to the next official FPL gameweek even if FPL is still finalizing the previous week's scores.

At the start of a new season, recent player history carries forward from the prior season while current prices, clubs, fixtures, and availability come from the new season.

Players marked injured, suspended, unavailable, or doubtful are excluded from the scored recommendation pool.

The app surfaces a clear unavailable state whenever the live data service is paused.

## Run locally

From the repository root:

```bash
npm run app:start
```

This starts FastAPI at `http://127.0.0.1:8000` and Next.js at `http://127.0.0.1:3000`.

To run the data pipeline against the configured database:

```bash
backend/venv/bin/python backend/scripts/init_db.py
backend/venv/bin/python backend/scripts/run_pipeline.py
backend/venv/bin/python backend/scripts/train_model.py
```

For an isolated local SQLite run, add `--use-local-db` to each command.

## Verification

```bash
backend/venv/bin/python -m pytest backend/tests -q
cd frontend && npm run build
```

The API exposes `/health`, `/api/players`, `/api/predict`, `/api/model-status`, `/api/differentials`, `/api/captain`, and `/api/optimize`.

## Operating context

Historical training rows combine player-gameweek history with current player context fields.
Point-in-time data handling remains an active engineering focus.

The recorded validation window covers five later gameweeks.

The planning workflow carries player availability, fixture difficulty, budget, position, and transfer context.

The optimizer uses listed player prices and standard FPL squad constraints.
