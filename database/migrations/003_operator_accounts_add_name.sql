-- ════════════════════════════════════════════════════════
-- Migration 003 — operator_accounts.operator_name
--
-- schema.sql only runs automatically the first time MySQL
-- initializes its data directory (docker-entrypoint-initdb.d).
-- If you already have a running e-BCS database (docker compose
-- volumes/db is not empty), run this script once by hand to bring
-- an existing database up to date with the current schema.sql:
--
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/003_operator_accounts_add_name.sql
--
-- A fresh `docker compose up -d` (empty volumes/db) does NOT need
-- this file — schema.sql already contains this column.
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

ALTER TABLE operator_accounts
  ADD COLUMN IF NOT EXISTS operator_name VARCHAR(255) NOT NULL DEFAULT ''
  AFTER tax_id;
