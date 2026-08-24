from __future__ import annotations

from _cli import prepare_backend_path

prepare_backend_path()

from database.repository import fetch_model_status
from database.session import get_session, init_db


def main() -> None:
    init_db()
    with get_session() as session:
        status = fetch_model_status(session)

    target_gameweek = status.get("latest_prediction_gameweek")
    prediction_mode = status.get("prediction_serving_mode")
    prediction_timestamp = status.get("latest_prediction_timestamp")
    training_run = status.get("latest_training_run") or {}
    prediction_count = training_run.get("rows_inserted")

    if prediction_mode != "database" or not target_gameweek or not prediction_timestamp or not prediction_count:
        raise SystemExit(
            "Refresh verification failed: the database does not contain a current prediction run."
        )

    print(
        {
            "status": "verified",
            "target_gameweek": target_gameweek,
            "prediction_timestamp": prediction_timestamp,
            "predictions": prediction_count,
        }
    )


if __name__ == "__main__":
    main()
