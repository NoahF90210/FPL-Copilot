from __future__ import annotations

from sqlalchemy.exc import OperationalError

from _cli import build_script_parser, configure_script_environment, prepare_backend_path


def main() -> None:
    parser = build_script_parser("Train the latest FPL prediction model and score next gameweek projections.")
    args = parser.parse_args()
    configure_script_environment(args)
    prepare_backend_path()

    from database.session import get_session, init_db
    from pipeline.modeling import train_and_score

    try:
        init_db()
        with get_session() as session:
            result = train_and_score(session)
    except OperationalError as exc:
        message = str(exc.orig if getattr(exc, "orig", None) else exc)
        parser.exit(
            1,
            "Could not reach the configured database.\n"
            "If you want to use the local SQLite fallback instead, rerun with `--use-local-db`.\n"
            f"Original error: {message}\n",
        )
    except RuntimeError as exc:
        guidance = ""
        if "Run ingestion first" in str(exc):
            guidance = (
                "The target database does not have enough historical FPL data yet.\n"
                "Next step: run `backend/scripts/run_pipeline.py` against the same database, then retry training.\n"
            )
        parser.exit(1, f"{guidance}{exc}\n")
    print(result)


if __name__ == "__main__":
    main()
