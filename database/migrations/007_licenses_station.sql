-- ════════════════════════════════════════════════════════
-- Migration 007 — licenses.station
--
-- Step 1's license table has a "สถานี / ช่องรายการ" (station/channel)
-- input per license row. Typing into it correctly updated
-- appState.rowsData[i].station client-side (updateRowText()), but the
-- create/update-submission payload never included it, the `licenses`
-- table had no column for it, and the backend INSERT never wrote it —
-- so the value was silently dropped the moment the form was submitted,
-- and never showed up again in the admin viewer or the operator's own
-- read-only view.
--
-- This adds licenses.station. routes/operator.py now stores the value
-- sent from the frontend on both create and update, and index.js now
-- sends it.
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/007_licenses_station.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'licenses'
    AND COLUMN_NAME = 'station'
);

SET @ddl = IF(
  @col_exists = 0,
  'ALTER TABLE licenses ADD COLUMN station VARCHAR(255) NULL COMMENT ''สถานี/ช่องรายการ'' AFTER license_status',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
