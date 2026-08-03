-- ════════════════════════════════════════════════════════
-- Migration 002 — operator_accounts table
--
-- schema.sql only runs automatically the first time MySQL
-- initializes its data directory (docker-entrypoint-initdb.d).
-- If you already have a running NBTC Filing database (docker compose
-- volumes/db is not empty), run this script once by hand to bring
-- an existing database up to date with the current schema.sql:
--
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/002_operator_accounts.sql
--
-- A fresh `docker compose up -d` (empty volumes/db) does NOT need
-- this file — schema.sql already contains this table.
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS operator_accounts (
  id         CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  tax_id     VARCHAR(13)  NOT NULL,
  email      VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_oa_tax_id (tax_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
