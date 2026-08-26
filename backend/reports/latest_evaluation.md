# Latest Model Evaluation

- Generated at: 2026-08-24T23:15:32.905290
- Model version: ridge_recent_form_v1
- Baseline version: recent_points_average_v1
- Features: rolling_points_5, rolling_minutes_5, opponent_fdr
- Validation: later_gameweek_holdout over gameweeks [31, 32, 33, 34, 35]
- Primary metric: MAE

| Approach | MAE | RMSE (secondary) |
|---|---:|---:|
| Recent five-appearance points average | 0.981 | 2.020 |
| Ridge regression | 1.001 | 1.908 |
