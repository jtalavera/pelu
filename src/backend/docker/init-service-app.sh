#!/bin/sh
# Creates service_app_db + login/user service_app if missing (idempotent). Used by mssql-init (Alpine + freetds).
set -eu

apk add --no-cache freetds netcat-openbsd >/dev/null

mkdir -p /etc
# Dev-only: align with JDBC encrypt=false for local Azure SQL Edge.
{
  echo "[global]"
  echo "  tds version = 7.4"
  echo "  encryption = off"
} >/etc/freetds.conf

escape_sql_literal() {
  printf '%s' "$1" | sed "s/'/''/g"
}

PW_APP_ESC=$(escape_sql_literal "${SERVICE_APP_PASSWORD:-}")

run_sql_master() {
  printf '%s\n' "$1" | tsql -H mssql -p 1433 -U sa -P "$MSSQL_SA_PASSWORD"
}

run_sql_in_db() {
  printf '%s\n' "$1" | tsql -H mssql -p 1433 -U sa -P "$MSSQL_SA_PASSWORD" -D "$2"
}

wait_login() {
  echo "Waiting for SQL Server (mssql:1433)..."
  i=0
  while [ "$i" -lt 120 ]; do
    if nc -z mssql 1433 2>/dev/null; then break; fi
    i=$((i + 1))
    sleep 1
  done

  echo "Waiting for login acceptance..."
  i=0
  while [ "$i" -lt 90 ]; do
    if printf 'SELECT 1\n' | tsql -H mssql -p 1433 -U sa -P "$MSSQL_SA_PASSWORD" >/dev/null 2>&1; then
      return 0
    fi
    i=$((i + 1))
    sleep 2
  done
  echo "Timed out waiting for SQL Server to accept connections." >&2
  exit 1
}

wait_login

echo "Applying service_app_db + service_app user (if missing)..."

run_sql_master "SET NOCOUNT ON; IF DB_ID(N'service_app_db') IS NULL CREATE DATABASE [service_app_db];"

run_sql_master "SET NOCOUNT ON; IF NOT EXISTS (SELECT * FROM sys.server_principals WHERE name = N'service_app') CREATE LOGIN [service_app] WITH PASSWORD = N'${PW_APP_ESC}';"

run_sql_in_db "SET NOCOUNT ON; IF NOT EXISTS (SELECT * FROM sys.database_principals WHERE name = N'service_app') BEGIN CREATE USER [service_app] FOR LOGIN [service_app]; ALTER ROLE db_owner ADD MEMBER [service_app]; END" service_app_db

echo "Database service_app_db and login service_app are ready."
