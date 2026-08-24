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

The Model page explains the prediction target, inputs, validation approach, live serving status, and limitations.

## How the forecast works

The pipeline ingests the official FPL API into Supabase.

A Ridge regression forecasts next-gameweek player points from three inputs:

- rolling points over the latest five appearances;
- rolling minutes over the latest five appearances;
- next-opponent fixture difficulty.

A recent-points average provides a simple comparison baseline.

The model is evaluated with a time-based holdout so later gameweeks are not mixed into training.

The forecast is a planning input, not a guarantee of points, captain success, transfer profit, rank improvement, or injury-free minutes.

## Data freshness

The public app reads forecasts from the live Supabase database.

A scheduled GitHub Actions workflow refreshes official FPL data and retrains the model every week.

At the start of a new season, the target is derived from the next unfinished fixture rather than the maximum historical gameweek, so last season's rows cannot become the next season's target.

If the live data service is unavailable, the app says so.
It does not substitute old or synthetic output.

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

## Current limits

Historical rows still need stronger point-in-time handling for fields such as price and ownership.

The validation window is limited and does not establish cross-season performance.

Injuries, late team news, rotation, tactical changes, blank gameweeks, and double gameweeks can change the outlook after a forecast is generated.

The optimizer uses listed prices rather than each manager's exact FPL selling value.
