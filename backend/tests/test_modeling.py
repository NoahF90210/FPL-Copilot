import json
from types import SimpleNamespace

import joblib
import pandas as pd
from sklearn.linear_model import Ridge
from sqlalchemy import create_engine
from sqlalchemy.orm import Session

from database.models import Base, Fixture, ModelPrediction, Player, PlayerGameweekStat, Team
from pipeline import modeling


def make_session() -> Session:
    engine = create_engine("sqlite:///:memory:")
    Base.metadata.create_all(engine)
    return Session(engine)


def test_training_features_use_only_prior_appearances():
    with make_session() as session:
        session.add(Team(id=1, name="Example FC", short_name="EX"))
        session.add(
            Player(
                id=1,
                first_name="Test",
                second_name="Player",
                web_name="Player",
                full_name="Test Player",
                team_id=1,
                position="MID",
                position_id=3,
                price=7.0,
            )
        )
        for gameweek, points, minutes in [
            (1, 2, 30),
            (2, 4, 60),
            (3, 8, 90),
            (4, 20, 90),
        ]:
            session.add(
                PlayerGameweekStat(
                    player_id=1,
                    team_id=1,
                    gameweek=gameweek,
                    minutes=minutes,
                    total_points=points,
                    opponent_fdr=3.0,
                )
            )
        session.commit()

        frame = modeling._build_training_dataframe(session)

    assert list(frame["gameweek"]) == [4]
    assert frame.iloc[0]["rolling_points_5"] == 14 / 3
    assert frame.iloc[0]["rolling_minutes_5"] == 60
    assert modeling.FEATURE_COLUMNS == [
        "rolling_points_5",
        "rolling_minutes_5",
        "opponent_fdr",
    ]


def test_next_target_uses_next_unfinished_fixture_at_new_season_start(monkeypatch):
    monkeypatch.setattr(modeling, "get_bootstrap", lambda: {})
    monkeypatch.setattr(modeling, "get_prediction_gameweek", lambda bootstrap: 1)

    with make_session() as session:
        session.add_all(
            [
                Team(id=1, name="Example FC", short_name="EX"),
                Team(id=2, name="Opponent FC", short_name="OP"),
                Player(
                    id=1,
                    first_name="Test",
                    second_name="Player",
                    web_name="Player",
                    full_name="Test Player",
                    team_id=1,
                    position="MID",
                    position_id=3,
                    price=7.0,
                    status="a",
                ),
                PlayerGameweekStat(
                    player_id=1,
                    team_id=1,
                    gameweek=35,
                    minutes=90,
                    total_points=6,
                    opponent_fdr=3.0,
                ),
                Fixture(
                    id=1,
                    gameweek=1,
                    finished=False,
                    team_h=1,
                    team_a=2,
                    team_h_difficulty=2,
                    team_a_difficulty=4,
                ),
            ]
        )
        session.commit()

        frame, target_gameweek = modeling._build_next_gameweek_dataframe(session)

    assert target_gameweek == 1
    assert frame.iloc[0]["opponent_fdr"] == 2.0


def test_public_training_path_is_ridge_with_recent_average_baseline(tmp_path, monkeypatch):
    training_rows = []
    for player_id in [1, 2]:
        for gameweek in range(1, 11):
            recent_points = float(gameweek + player_id)
            training_rows.append(
                {
                    "player_id": player_id,
                    "team_id": player_id,
                    "gameweek": gameweek,
                    "minutes": 90,
                    "total_points": recent_points + (0.5 if player_id == 1 else -0.5),
                    "opponent_fdr": float((gameweek % 5) + 1),
                    "games_played": gameweek - 1,
                    "rolling_points_5": recent_points,
                    "rolling_minutes_5": float(60 + gameweek),
                }
            )
    training_frame = pd.DataFrame(training_rows)
    scoring_frame = pd.DataFrame(
        [
            {
                "player_id": 1,
                "team_id": 1,
                "status": "a",
                "games_played": 10,
                "rolling_points_5": 6.25,
                "rolling_minutes_5": 82.0,
                "opponent_fdr": 2.0,
            },
            {
                "player_id": 2,
                "team_id": 2,
                "status": "u",
                "games_played": 10,
                "rolling_points_5": 7.5,
                "rolling_minutes_5": 0.0,
                "opponent_fdr": 4.0,
            },
            {
                "player_id": 3,
                "team_id": 3,
                "status": "d",
                "games_played": 8,
                "rolling_points_5": 4.5,
                "rolling_minutes_5": 45.0,
                "opponent_fdr": 3.0,
            },
        ]
    )
    test_settings = SimpleNamespace(
        reports_dir=tmp_path,
        model_artifact_path=tmp_path / "artifacts" / "latest_model.joblib",
        evaluation_report_path=tmp_path / "latest_evaluation.json",
        latest_predictions_path=tmp_path / "latest_predictions.json",
    )

    monkeypatch.setattr(modeling, "settings", test_settings)
    monkeypatch.setattr(modeling, "_build_training_dataframe", lambda session: training_frame)
    monkeypatch.setattr(
        modeling,
        "_build_next_gameweek_dataframe",
        lambda session: (scoring_frame, 11),
    )
    monkeypatch.setattr(modeling, "_log_training_run_to_mlflow", lambda **kwargs: None)
    monkeypatch.setattr(modeling, "save_pipeline_run", lambda *args, **kwargs: None)

    with make_session() as session:
        result = modeling.train_and_score(session)
        saved_rows = session.query(ModelPrediction).order_by(ModelPrediction.player_id).all()

    report = json.loads(test_settings.evaluation_report_path.read_text())
    artifact = joblib.load(test_settings.model_artifact_path)
    predictions = json.loads(test_settings.latest_predictions_path.read_text())

    assert result["model_version"] == "ridge_recent_form_v1"
    assert report["primary_metric"] == "mae"
    assert report["validation_strategy"] == "later_gameweek_holdout"
    assert report["validation_gameweeks"] == [6, 7, 8, 9, 10]
    assert report["baseline_version"] == "recent_points_average_v1"
    assert report["feature_columns"] == modeling.FEATURE_COLUMNS
    assert isinstance(artifact["model"].named_steps["model"], Ridge)
    assert artifact["baseline"] == {
        "type": "recent_points_average",
        "feature": "rolling_points_5",
        "version": "recent_points_average_v1",
    }
    assert [row.player_id for row in saved_rows] == [1]
    assert [row.baseline_points for row in saved_rows] == [6.25]
    assert all(row.model_version == "ridge_recent_form_v1" for row in saved_rows)
    assert all(
        set(row.metadata_json) >= {"rolling_points_5", "rolling_minutes_5", "opponent_fdr"}
        for row in saved_rows
    )
    assert predictions["target_gameweek"] == 11
    assert predictions["model_version"] == "ridge_recent_form_v1"
