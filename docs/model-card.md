# FPL Copilot model card

## Purpose

FPL Copilot forecasts next-gameweek player points and uses those forecasts for player research, legal squad construction, and transfer comparison.

The forecasts support player research, squad construction, and transfer comparison.

## Prediction target

The target is one player's FPL points for the next gameweek.

Historical training rows are built from player-gameweek history and use `total_points` as the supervised target.

Double and blank gameweeks need stronger deadline-level aggregation before the target is complete for those cases.

## Data and features

The ingestion pipeline uses official Fantasy Premier League endpoints for player, team, fixture, and player-history data.

The current public training path uses:

1. rolling points over the latest five appearances;
2. rolling minutes over the latest five appearances;
3. next-opponent fixture difficulty.

Rolling features are shifted so each training row uses earlier appearances.

Numeric values are median-imputed and standardized before Ridge regression.

## Model and baseline

- **Main model:** `Ridge(alpha=1.0)`.
- **Baseline:** recent five-appearance points average.
- **Model version:** `ridge_recent_form_v1`.
- **Baseline version:** `recent_points_average_v1`.

Predictions are clipped at zero.
Unavailable players are excluded from the scoring set.

## Validation

The pipeline uses a later-gameweek holdout that follows the forecasting timeline.

The latest evaluation report is produced by the training workflow and exposed through the Model page and `/api/model-status`.

MAE is average absolute player-point error.
RMSE weights larger misses more heavily.
Lower values are better.

These metrics report player-point error alongside the product's captaincy, squad, and transfer workflows.

## Live serving

The production API loads player and prediction rows from the live Supabase database.

A scheduled GitHub Actions workflow ingests official FPL data and retrains the model every Tuesday.

Experiment tracking runs as optional telemetry while model, report, and prediction writes remain independent.

After a gameweek deadline passes, the scoring pipeline moves the target to the next official FPL gameweek even if FPL is still finalizing the previous week's scores.

At the start of a new season, recent player history carries forward from the prior season while current prices, clubs, fixtures, and availability come from the new season.

Players marked injured, suspended, unavailable, or doubtful are excluded from the scored recommendation pool.

If the database or refresh workflow is unavailable, collection routes return a safe unavailable response and the interface surfaces the serving state.

## Optimizer boundary

The squad and transfer flow compares legal choices under these constraints:

- a budget ceiling;
- exactly 2 goalkeepers, 5 defenders, 5 midfielders, and 3 forwards;
- at most 3 players per club;
- optional include and exclude constraints;
- optional transfer-hit penalties beyond the free-transfer allowance.

The optimizer is a planning aid for comparing legal squads and transfer choices.

## Operating context

- Historical rows combine player-gameweek history with current player context fields.
- The recorded validation window covers five later gameweeks.
- Double and blank gameweeks use the current fixture-level target path.
- The scoring workflow incorporates player availability, fixture context, and recent minutes.
- The optimizer uses listed prices and the standard FPL squad structure.
