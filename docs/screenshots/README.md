# Screenshots

## Current production PNGs

These files back the **Screenshots** section in the root `README.md`:

| File | Route | Notes |
| --- | --- | --- |
| `dashboard.png` | `/` | Weekly signals and hub |
| `squad-analysis.png` | `/squad` | My Squad builder (capture used an empty saved squad session) |
| `player-browser.png` | `/players` | Prediction table |
| `optimizer.png` | `/optimize` | Optimizer controls (capture used “no saved team” onboarding) |
| `model-status.png` | `/about-model` | Recruiter-facing model explanation; live UI may still show pending chips until `/api/model-status` resolves |

**Evaluation metrics in README** must stay aligned with `backend/reports/latest_evaluation.json`. Do not copy MAE/RMSE or row counts from screenshots—the UI can lag or show placeholders.

## Legacy SVG stubs

`squad-analysis.svg`, `dashboard.svg`, `player-browser.svg`, `optimizer.svg`, and `model-status.svg` remain as lightweight fallbacks when PNGs are missing; prefer the PNG links in README when both exist.

## Quick recapture checklist

Use a desktop-ish viewport (**~1400×900**) so README layouts stay consistent.

1. Open [https://fpl-copilot.tech](https://fpl-copilot.tech) and resize the window if needed.
2. For each route in the table above, navigate, wait until content settles (give `/players` a few seconds so the table loads), then grab a **full-page** PNG.
3. Save into this folder **using the filenames above**, replacing the checked-in PNGs.

If using Cursor Browser tools, screenshots save under `/var/folders/.../T/cursor/screenshots/` mirrored from the requested destination path—copy into this directory when needed.

Optional next step: record a ≤30 s GIF of the README “30‑second demo path”; keep any spoken or on-screen numeric claims anchored to `latest_evaluation.json` only.
