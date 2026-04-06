#!/usr/bin/env bash
# Realign Flyway checksums in flyway_schema_history after editing migration files that were already applied.
# Requires Docker or Podman and a reachable SQL Server (same URL/credentials as the backend).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MIGRATIONS="$ROOT/src/backend/src/main/resources/db/migration"

USER="${SPRING_DATASOURCE_USERNAME:-service_app}"
PASS="${SPRING_DATASOURCE_PASSWORD:-${MSSQL_SA_PASSWORD:-The.S3cr3t.2026}}"

RUNNER="${CONTAINER_ENGINE:-}"
if [[ -z "$RUNNER" ]]; then
  if command -v podman >/dev/null 2>&1; then
    RUNNER=podman
  elif command -v docker >/dev/null 2>&1; then
    RUNNER=docker
  else
    echo "Install Podman or Docker, or set CONTAINER_ENGINE." >&2
    exit 1
  fi
fi

# Podman: use host network so jdbc:sqlserver://127.0.0.1 works. Docker Desktop: host.docker.internal.
NETWORK_ARGS=()
if [[ -n "${SPRING_DATASOURCE_URL:-}" ]]; then
  URL="$SPRING_DATASOURCE_URL"
elif [[ "$RUNNER" == "podman" ]]; then
  NETWORK_ARGS=(--network host)
  URL="jdbc:sqlserver://127.0.0.1:1433;databaseName=service_app_db;encrypt=true;trustServerCertificate=true"
else
  URL="jdbc:sqlserver://host.docker.internal:1433;databaseName=service_app_db;encrypt=true;trustServerCertificate=true"
fi

# Match Flyway major used by Spring Boot (see flyway-core on the backend classpath).
IMAGE="${FLYWAY_IMAGE:-docker.io/flyway/flyway:11-alpine}"

echo "Using $RUNNER with $IMAGE"
echo "JDBC URL: $URL"

exec "$RUNNER" run --rm \
  "${NETWORK_ARGS[@]}" \
  -v "$MIGRATIONS:/flyway/sql:ro" \
  "$IMAGE" \
  -url="$URL" \
  -user="$USER" \
  -password="$PASS" \
  -locations=filesystem:/flyway/sql \
  -table=flyway_schema_history \
  repair
