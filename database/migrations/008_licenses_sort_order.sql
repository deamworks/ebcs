-- ════════════════════════════════════════════════════════
-- Migration 008 — licenses.sort_order
--
-- The per-submission license list was always read back with
-- `ORDER BY created_at`, but created_at is a DATETIME (second
-- precision) and every license row for a submission is inserted in
-- the same request, often within the same second — so ties in
-- created_at left the row order undefined. MySQL doesn't guarantee a
-- stable order for tied sort keys, so the license rows (and the
-- station/income values tied to each row index on the frontend)
-- appeared to shuffle between page loads instead of staying in the
-- order the operator entered them.
--
-- This adds licenses.sort_order, populated with the row's position in
-- the submitted licenses array (routes/operator.py), and both
-- get_submission (operator.py) and get_submission_detail (admin.py)
-- now ORDER BY sort_order instead of created_at.
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/008_licenses_sort_order.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'licenses'
    AND COLUMN_NAME = 'sort_order'
);

SET @ddl = IF(
  @col_exists = 0,
  'ALTER TABLE licenses ADD COLUMN sort_order INT NOT NULL DEFAULT 0 AFTER submission_id',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
