#!/bin/bash
# Runs only when the Postgres volume is first initialised (empty data dir).
# Existing volumes are left alone — do not use `docker compose down -v`.
# cargo_compliance_screening was already created by hand in T3; this script
# makes a fresh `docker compose up` create it automatically.
set -euo pipefail
psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<'SQL'
SELECT 'CREATE DATABASE cargo_compliance_screening'
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'cargo_compliance_screening')\gexec
SQL
