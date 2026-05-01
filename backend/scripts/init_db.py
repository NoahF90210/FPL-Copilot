from pathlib import Path
import sys

sys.path.append(str(Path(__file__).resolve().parents[1]))

from database.session import init_db


if __name__ == "__main__":
    init_db()
    print("Database initialized.")
