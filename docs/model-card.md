# FPL Copilot model card

## Purpose

FPL Copilot forecasts next-gameweek player points and uses those forecasts for player research, legal squad construction, and transfer comparison.

The forecasts are decision-support signals.
They are not guarantees and do not establish FPL rank improvement.

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

The pipeline uses a later-gameweek holdout rather than randomly mixing future rows into training.

The latest evaluation report is produced by the training workflow and exposed through the Model page and `/api/model-status`.

MAE is average absolute player-point error.
RMSE weights larger misses more heavily.
Lower values are better.

These metrics do not measure captain success, transfer uplift, calibration, cross-season performance, or final FPL rank.

## Live serving

The production API loads player and prediction rows from the live Supabase database.

A scheduled GitHub Actions workflow ingests official FPL data and retrains the model every week.

At the start of a new season, the scoring pipeline derives the target from the next unfinished fixture rather than the maximum historical gameweek.
This prevents an old maximum gameweek from becoming the next target while retaining historical rows for model training.

If the database or refresh workflow is unavailable, collection routes return a safe unavailable response.
The application does not substitute old or synthetic player forecasts.

## Optimizer boundary

The squad and transfer flow compares legal choices under these constraints:

- a budget ceiling;
- exactly 2 goalkeepers, 5 defenders, 5 midfielders, and 3 forwards;
- at most 3 players per club;
- optional include and exclude constraints;
- optional transfer-hit penalties beyond the free-transfer allowance.

The optimizer is a planning aid.
It does not establish that a selected squad will outperform another squad or improve final rank.

## Limitations

- Historical rows still need stronger point-in-time handling for fields such as price and ownership.
- The validation window is limited and does not establish cross-season performance.
- Double and blank gameweeks are not fully represented by a deadline-level target.
- Future injuries, late team news, rotation, and tactical changes are not known at scoring time.
- The optimizer uses listed prices rather than each manager's exact FPL selling value.
