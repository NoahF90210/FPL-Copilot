from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from database.session import get_session, init_db
from pipeline.ingest import run_ingestion


if __name__ == "__main__":
    init_db()
    with get_session() as session:
        result = run_ingestion(session)
    print(result)
