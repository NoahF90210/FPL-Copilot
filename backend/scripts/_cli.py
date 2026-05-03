from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path


BACKEND_ROOT = Path(__file__).resolve().parents[1]
DEFAULT_LOCAL_DB_URL = f"sqlite:///{BACKEND_ROOT / 'fpl_copilot.db'}"


def build_script_parser(description: str) -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description=description)
    parser.add_argument(
        "--database-url",
        help="Override DATABASE_URL for this run.",
    )
    parser.add_argument(
        "--use-local-db",
        action="store_true",
        help="Use the local SQLite fallback instead of the configured remote warehouse.",
    )
    return parser


def configure_script_environment(args: argparse.Namespace) -> None:
    if getattr(args, "database_url", None):
        os.environ["DATABASE_URL"] = args.database_url
    elif getattr(args, "use_local_db", False):
        os.environ["DATABASE_URL"] = DEFAULT_LOCAL_DB_URL


def prepare_backend_path() -> None:
    backend_root = str(BACKEND_ROOT)
    if backend_root not in sys.path:
        sys.path.append(backend_root)
