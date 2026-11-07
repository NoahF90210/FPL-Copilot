"""Secure the server-only warehouse without granting browser/Data API access."""
from __future__ import annotations

from sqlalchemy import text
from sqlalchemy.engine import Connection

from database.models import Base


def secure_warehouse_tables(connection: Connection) -> list[str]:
    if connection.dialect.name != "postgresql":
        return []
    schema = connection.scalar(text("SELECT current_schema()"))
    quote = connection.dialect.identifier_preparer.quote
    roles = list(connection.scalars(text(
        "SELECT rolname FROM pg_roles WHERE rolname IN ('anon', 'authenticated')"
    )))
    recipients = ", ".join(["PUBLIC", *(quote(role) for role in roles)])
    tables = sorted(Base.metadata.tables)
    for name in tables:
        target = f"{quote(schema)}.{quote(name)}"
        # No permissive policies: the application uses its server-side owner
        # connection. Table owners retain access; Data API roles do not need it.
        connection.execute(text(f"ALTER TABLE {target} ENABLE ROW LEVEL SECURITY"))
        connection.execute(text(f"REVOKE ALL PRIVILEGES ON TABLE {target} FROM {recipients}"))
    return tables
