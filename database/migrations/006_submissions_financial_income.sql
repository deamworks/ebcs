-- ════════════════════════════════════════════════════════
-- Migration 006 — submissions.total_income_financial
--
-- Step 1 of the submission form requires "รายได้รวมตามงบการเงิน"
-- (total income per the financial statement) — a manually-typed
-- figure the operator must enter before proceeding, separate from
-- total_income (which is summed from license incomes). That typed
-- value was only ever kept in the browser's localStorage draft and
-- was never sent to the backend or stored on the submission row, so
-- once submitted it was gone — the admin/operator read-only viewer
-- always showed 0.00 for it regardless of what was actually entered.
--
-- This adds submissions.total_income_financial. The backend fix
-- (routes/operator.py create_submission) now stores the value sent
-- from the frontend, and both detail endpoints (operator.py,
-- admin.py) return it so the read-only viewer can display it.
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/006_submissions_financial_income.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'submissions'
    AND COLUMN_NAME = 'total_income_financial'
);

SET @ddl = IF(
  @col_exists = 0,
  'ALTER TABLE submissions ADD COLUMN total_income_financial DECIMAL(18,2) DEFAULT 0 COMMENT ''รายได้รวมตามงบการเงิน (กรอกเอง Step 1)'' AFTER total_income',
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;
