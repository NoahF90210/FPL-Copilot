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

A successful ingestion invalidates the previous forecast batch before its new player context can be served. Removed official history entries are retained but retired from feature construction. Until training succeeds, public forecasts are unavailable rather than mixing old predictions with new identities. Both API reads and the read-only `backend/scripts/verify_refresh.py` command check roster/display identity, fixture schedule, target gameweek, complete stored prediction coverage, and timestamps (maximum age 36 hours). API reads use a consistent database snapshot throughout validation and fixture hydration.

Availability changes are handled per player after the entire stored batch passes verification: newly injured, doubtful, suspended or unavailable players are removed immediately when the official feed refreshes (cached for up to five minutes), without disabling unaffected players' forecasts. Newly available players without a scored row wait for the next model refresh; no forecast is invented for them. The players page reports excluded/pending counts. Pipeline acceptance remains stricter: `verify_refresh.py` requires the ingested availability snapshot to match the current official feed, so a successful run proves the model has caught up.

Players marked injured, suspended, unavailable, or doubtful are excluded from the scored recommendation pool.

The players page does not depend on forecast availability to show players. `/api/player-catalogue` reads descriptive stats directly from the official FPL API, independently of the database and model. The page initially renders a bundled, dated official roster, then refreshes stats and forecasts independently. If either live source is unavailable, the table stays browsable; saved stats are explicitly labeled **not live**, with their season and capture time. The snapshot never contains model predictions and is never used by prediction, captaincy or optimization endpoints.

The availability panel shows database connectivity, ingestion/training outcomes and timestamps, the forecast request error, and a safe verification failure reason when available. A connected database is not described as paused merely because forecasts failed verification. The page retries every minute while visible and on window focus; manual retry is also available. Old or identity-mismatched forecasts are hidden rather than retained after a failed refresh.

Refresh the bundled official roster before a release (especially at season rollover):

```bash
backend/venv/bin/python backend/scripts/export_player_catalogue.py
```

This reads the official API and updates `frontend/data/player-catalogue.json`; it does not write to the warehouse. Review the data diff before shipping. The bundled snapshot does not update itself on the deployed site; live catalogue requests supply fresh stats without a deployment. If all sources fail, the saved roster remains historical, not a guarantee of current data.

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
cd frontend && npm test && npm run build
```

The API exposes `/health`, `/api/player-catalogue`, `/api/players`, `/api/predict`, `/api/model-status`, `/api/differentials`, `/api/captain`, and `/api/optimize`.

## Operating context

Historical training rows are limited to verified current-season player identities and completed fixtures. Cross-season carryover is deliberately disabled until a separately verified mapping is available. At a new season's start, forecasts remain unavailable until enough current-season history exists for training and validation.

The recorded validation window covers five later gameweeks.

The planning workflow carries player availability, fixture difficulty, budget, position, and transfer context.

The optimizer uses listed player prices and standard FPL squad constraints.
