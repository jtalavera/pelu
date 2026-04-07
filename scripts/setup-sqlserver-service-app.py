#!/usr/bin/env python3
"""
Create service_app_db and login service_app (matches default application.properties).
Run after a fresh SQL Server / Azure SQL Edge container. Requires: pip install pymssql

  SPRING_DATASOURCE_PASSWORD=... python3 scripts/setup-sqlserver-service-app.py

Defaults: host 127.0.0.1, port 1433, sa password The.S3cr3t.2026, same password for service_app.
"""
from __future__ import annotations

import os
import sys


def main() -> int:
    try:
        import pymssql
    except ImportError:
        print("Install pymssql: pip install pymssql", file=sys.stderr)
        return 1

    host = os.environ.get("MSSQL_HOST", "127.0.0.1")
    port = int(os.environ.get("MSSQL_PORT", "1433"))
    sa_password = os.environ.get("MSSQL_SA_PASSWORD", "The.S3cr3t.2026")
    app_password = os.environ.get("SPRING_DATASOURCE_PASSWORD", "The.S3cr3t.2026")

    conn = pymssql.connect(
        server=host,
        port=port,
        user="sa",
        password=sa_password,
        autocommit=True,
    )
    cur = conn.cursor()
    cur.execute(
        """
        IF NOT EXISTS (SELECT name FROM sys.databases WHERE name = N'service_app_db')
          CREATE DATABASE [service_app_db];
        """
    )
    cur.execute(
        f"""
        IF NOT EXISTS (SELECT name FROM sys.server_principals WHERE name = N'service_app')
          CREATE LOGIN [service_app] WITH PASSWORD = N'{app_password.replace("'", "''")}', CHECK_POLICY = OFF;
        """
    )
    cur.execute("USE [service_app_db]")
    cur.execute(
        """
        IF NOT EXISTS (SELECT name FROM sys.database_principals WHERE name = N'service_app')
        BEGIN
          CREATE USER [service_app] FOR LOGIN [service_app];
          ALTER ROLE db_owner ADD MEMBER [service_app];
        END
        """
    )
    conn.close()
    print("Created database service_app_db and login service_app (db_owner).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
