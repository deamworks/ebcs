-- ════════════════════════════════════════════════════════
-- Migration 005 — licenses.start_date / end_date
--
-- The `licenses` table (per-submission license rows) already had
-- licensee_type and license_status columns, but nothing ever wrote to
-- them, and start_date/end_date didn't exist at all — so once an
-- operator's submission was saved, the license type/dates/status they
-- saw while filling the form were lost. The admin "view submission"
-- page could not show them (data always NULL) even though the
-- operator had the correct values on screen at submit time.
--
-- This adds the missing start_date/end_date columns. The backend fix
-- (routes/operator.py) now populates licensee_type, license_status,
-- start_date, end_date on every submission create/update, so future
-- submissions carry a full snapshot.
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/005_licenses_snapshot_dates.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'licenses'
    AND COLUMN_NAME = 'start_date'
);

SET @ddl = IF(
  @col_exists = 0,
  'ALTER TABLE licenses ADD COLUMN start_date DATE NULL AFTER license_status, ADD COLUMN end_date DATE NULL AFTER start_date',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
