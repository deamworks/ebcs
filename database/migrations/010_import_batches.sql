-- ════════════════════════════════════════════════════════
-- Migration 010 — import_batches (import rollback system)
--
-- Every commit-mode import (taxpayer/license/operator_account) now
-- records a batch row here, with a JSON snapshot of each affected
-- row's previous values (or NULL if the row was newly inserted) so
-- an admin can undo an entire import in one click.
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/010_import_batches.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS import_batches (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),

  import_type   ENUM('taxpayer','license','operator_account') NOT NULL,

  imported_by   VARCHAR(255)  NOT NULL COMMENT 'อีเมลแอดมินที่นำเข้า',
  imported_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,

  row_count     INT           NOT NULL DEFAULT 0,

  status        ENUM('active','rolled_back') NOT NULL DEFAULT 'active',

  -- snapshot: JSON array ของค่าก่อนนำเข้าแต่ละแถว
  -- แต่ละ element: {"table": "...", "key": {...}, "old": {...} หรือ null ถ้าเป็นแถวใหม่}
  snapshot      LONGTEXT      NOT NULL,

  INDEX idx_imb_type (import_type),
  INDEX idx_imb_status (status)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
