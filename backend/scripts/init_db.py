from __future__ import annotations

from sqlalchemy.exc import OperationalError

from _cli import build_script_parser, configure_script_environment, prepare_backend_path


def main() -> None:
    parser = build_script_parser("Initialize the configured FPL Copilot database schema.")
    args = parser.parse_args()
    configure_script_environment(args)
    prepare_backend_path()

    from database.session import init_db

    try:
        init_db()
    except OperationalError as exc:
        message = str(exc.orig if getattr(exc, "orig", None) else exc)
        parser.exit(
            1,
            "Could not reach the configured database.\n"
            "If you want to initialize the local SQLite fallback instead, rerun with `--use-local-db`.\n"
            f"Original error: {message}\n",
        )
    print("Database initialized.")


if __name__ == "__main__":
    main()
