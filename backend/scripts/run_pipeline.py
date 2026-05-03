from __future__ import annotations

from sqlalchemy.exc import OperationalError

from _cli import build_script_parser, configure_script_environment, prepare_backend_path


def main() -> None:
    parser = build_script_parser("Run the FPL ingestion pipeline against the configured data store.")
    args = parser.parse_args()
    configure_script_environment(args)
    prepare_backend_path()

    from database.session import get_session, init_db
    from pipeline.ingest import run_ingestion

    try:
        init_db()
        with get_session() as session:
            result = run_ingestion(session)
    except OperationalError as exc:
        message = str(exc.orig if getattr(exc, "orig", None) else exc)
        parser.exit(
            1,
            "Could not reach the configured database.\n"
            "If you want to populate the local SQLite fallback instead, rerun with `--use-local-db`.\n"
            f"Original error: {message}\n",
        )
    print(result)


if __name__ == "__main__":
    main()
