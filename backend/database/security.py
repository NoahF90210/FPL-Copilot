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
    secured = set(connection.scalars(text(
        "SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace "
        "WHERE n.nspname = :schema AND c.relrowsecurity"
    ), {"schema": schema}))
    for name in tables:
        target = f"{quote(schema)}.{quote(name)}"
        # Repeating ALTER takes an exclusive lock even when RLS is already on.
        # Avoid blocking/deadlocking live forecast readers on daily startup.
        if name not in secured:
            connection.execute(text(f"ALTER TABLE {target} ENABLE ROW LEVEL SECURITY"))
        # No permissive policies: owner access stays server-side. Always revoke
        # ordinary-role grants, including grants restored since the last startup.
        connection.execute(text(f"REVOKE ALL PRIVILEGES ON TABLE {target} FROM {recipients}"))
    return tables
