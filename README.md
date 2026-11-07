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

A scheduled GitHub Actions workflow refreshes official FPL data and retrains the model daily at 09:15 UTC. Refresh and manual retraining share a concurrency group so they cannot write the warehouse simultaneously.

After a gameweek deadline passes, the target moves to the next official FPL gameweek even if FPL is still finalizing the previous week's scores.

Player registrations are verified against the official current-season roster using both the season-local ID and FPL person code. Training and recent-form features use only completed, verified current-season fixture records. Unknown-season and unmapped historical records are retained for inspection but excluded; history is not guessed across season boundaries.

A successful ingestion invalidates the previous forecast batch before its new player context can be served. Removed official history entries are retained but retired from feature construction. Until training succeeds, public forecasts are unavailable rather than mixing old predictions with new identities. Both API reads and the read-only `backend/scripts/verify_refresh.py` command check roster/display identity, availability, fixture schedule, target gameweek, complete prediction coverage, and timestamps (maximum age 36 hours). API reads use a consistent database snapshot throughout validation and fixture hydration.

Players marked injured, suspended, unavailable, or doubtful are excluded from the scored recommendation pool.

The app surfaces a clear unavailable state whenever the live data service is paused.

## Database access

The browser accesses FastAPI, not the Supabase Data API. All seven warehouse tables have Row Level Security enabled on PostgreSQL and direct table privileges revoked from `anon`, `authenticated`, and `PUBLIC`. There are intentionally no permissive browser policies. The server-side table-owner connection remains able to ingest and serve data; never put that connection string in frontend configuration. Database initialization reapplies this boundary idempotently.

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

Historical training rows are limited to verified current-season player identities and completed fixtures. Cross-season carryover is deliberately disabled until a separately verified mapping is available. At a new season's start, forecasts remain unavailable until enough current-season history exists for training and validation.

The recorded validation window covers five later gameweeks.

The planning workflow carries player availability, fixture difficulty, budget, position, and transfer context.

The optimizer uses listed player prices and standard FPL squad constraints.
