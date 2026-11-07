from types import SimpleNamespace

from sqlalchemy.dialects.postgresql import dialect

from database.models import Base
from database.security import secure_warehouse_tables


class RecordingConnection:
    dialect = dialect()

    def __init__(self):
        self.statements = []

    def scalar(self, statement):
        return "public"

    def scalars(self, statement):
        return ["anon", "authenticated"]

    def execute(self, statement):
        self.statements.append(str(statement))


def test_server_only_tables_enable_rls_and_revoke_unprivileged_access():
    connection = RecordingConnection()
    tables = secure_warehouse_tables(connection)
    assert tables == sorted(Base.metadata.tables)
    assert len(tables) == 7
    for table in tables:
        assert f"ALTER TABLE public.{table} ENABLE ROW LEVEL SECURITY" in connection.statements
        assert (f"REVOKE ALL PRIVILEGES ON TABLE public.{table} FROM PUBLIC, anon, authenticated"
                in connection.statements)
    assert not any("CREATE POLICY" in sql or "DISABLE ROW LEVEL SECURITY" in sql
                   for sql in connection.statements)


def test_sqlite_does_not_receive_postgresql_security_commands():
    connection = RecordingConnection()
    connection.dialect = SimpleNamespace(name="sqlite")
    assert secure_warehouse_tables(connection) == []
    assert connection.statements == []
