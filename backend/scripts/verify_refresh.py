from __future__ import annotations

import json

from _cli import build_script_parser, configure_script_environment, prepare_backend_path


def main() -> None:
    parser = build_script_parser("Verify official roster identity and forecast freshness without writing data.")
    args = parser.parse_args()
    configure_script_environment(args)
    prepare_backend_path()

    from data.fpl_client import get_bootstrap, get_fixtures
    from database.session import get_session
    from pipeline.verify import verify_refresh

    try:
        bootstrap = get_bootstrap()
        with get_session() as session:
            result = verify_refresh(session, bootstrap, get_fixtures())
    except (RuntimeError, ValueError) as exc:
        parser.exit(1, f"Refresh verification failed: {exc}\n")
    print(json.dumps(result))


if __name__ == "__main__":
    main()
