-- ════════════════════════════════════════════════════════
-- Migration 004 — fix licensee_master.fiscal_year (CE → BE)
--
-- Bug: the Excel import (import_service.py _parse_licensee_row) used
-- to convert the fiscal year to ค.ศ. (CE, e.g. 2025) before storing it,
-- while taxpayer_master.fiscal_year (and the operator index page's
-- license lookup) always uses พ.ศ. (BE, e.g. 2568). Any licensee row
-- imported before the code fix has fiscal_year off by 543, so
-- GET /operator/licenses?year=2568 never matches it — the operator
-- page shows 0 licenses even though the rows exist for that tax_id.
--
-- This backfills existing rows: any fiscal_year that looks like a CE
-- year (< 2400) gets +543 to become BE. Safe to re-run — once fixed,
-- values are >= 2400 and the WHERE clause below no longer matches them.
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/004_fix_licensee_master_fiscal_year_be.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

UPDATE licensee_master
SET fiscal_year = fiscal_year + 543
WHERE fiscal_year IS NOT NULL
  AND fiscal_year < 2400;
