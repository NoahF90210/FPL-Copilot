from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from database.session import get_session, init_db
from pipeline.modeling import train_and_score


if __name__ == "__main__":
    init_db()
    with get_session() as session:
        result = train_and_score(session)
    print(result)
