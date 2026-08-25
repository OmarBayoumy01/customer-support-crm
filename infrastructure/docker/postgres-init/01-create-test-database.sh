#!/bin/bash
#
# Creates the test database alongside the development one.
#
# Postgres runs everything in /docker-entrypoint-initdb.d exactly once, when the
# data directory is empty — so this does not re-run on restart, and it does not
# fight the named volume that AC3 depends on.
#
# The suite needs its own database: tests truncate, seed, and run migrations
# against a throwaway instance, and doing that to the database someone is
# developing against would be its own kind of bug.
set -euo pipefail

TEST_DB="${POSTGRES_DB:-crm}_test"

psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
	CREATE DATABASE "$TEST_DB";
EOSQL

echo "Created test database $TEST_DB"
