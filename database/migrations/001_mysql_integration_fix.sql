-- ════════════════════════════════════════════════════════
-- Migration 001 — MySQL integration fix
--
-- schema.sql only runs automatically the first time MySQL
-- initializes its data directory (docker-entrypoint-initdb.d).
-- If you already have a running e-BCS database (docker compose
-- volumes/db is not empty), run this script once by hand to bring
-- an existing database up to date with the current schema.sql:
--
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/001_mysql_integration_fix.sql
--
-- A fresh `docker compose up -d` (empty volumes/db) does NOT need
-- this file — schema.sql already contains these changes.
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ── taxpayer_master: add email OTP login field + import address ──
ALTER TABLE taxpayer_master
  ADD COLUMN email   VARCHAR(255) NULL AFTER phone,
  ADD COLUMN address VARCHAR(500) NULL AFTER email;

-- ── licensee_master: add the financial/import snapshot columns
--    import_service.py / export_service.py expect (column names
--    licensee_type/start_date/end_date are unchanged — they already
--    match admin.py's CRUD and the admin frontend) ──
ALTER TABLE licensee_master
  ADD COLUMN fiscal_year   INT           NULL COMMENT 'ปีบัญชี (พ.ศ.) ที่ import ล่าสุด' AFTER end_date,
  ADD COLUMN ref_code      VARCHAR(50)   NULL COMMENT 'รหัสอ้างอิงจากไฟล์ import' AFTER fiscal_year,
  ADD COLUMN sub_type      VARCHAR(50)   NULL COMMENT 'ประเภท (จากไฟล์ import)' AFTER ref_code,
  ADD COLUMN round_type    VARCHAR(50)   NULL COMMENT 'รอบ (จากไฟล์ import)' AFTER sub_type,
  ADD COLUMN sub_status    VARCHAR(50)   NULL COMMENT 'สถานะงวดนำส่ง (จากไฟล์ import)' AFTER round_type,
  ADD COLUMN license_count INT           NULL COMMENT 'จำนวนใบอนุญาตของ tax_id นี้ ณ วันที่ import' AFTER sub_status,
  ADD COLUMN income        DECIMAL(18,2) DEFAULT 0 COMMENT 'รายได้จากใบอนุญาต' AFTER license_count,
  ADD COLUMN deduction     DECIMAL(18,2) DEFAULT 0 COMMENT 'ค่าลดหย่อน' AFTER income,
  ADD COLUMN fund_amount   DECIMAL(18,2) DEFAULT 0 COMMENT 'เงินนำส่งเข้ากองทุน' AFTER deduction,
  ADD COLUMN vat           DECIMAL(18,2) DEFAULT 0 COMMENT 'ภาษีมูลค่าเพิ่ม' AFTER fund_amount,
  ADD COLUMN surcharge     DECIMAL(18,2) DEFAULT 0 COMMENT 'เงินเพิ่ม' AFTER vat,
  ADD COLUMN net_amount    DECIMAL(18,2) DEFAULT 0 COMMENT 'จำนวนเงินรายปีนำส่งสุทธิ' AFTER surcharge;

-- ── licenses: add per-license deduction (income was already fee_amount) ──
ALTER TABLE licenses
  ADD COLUMN deduction_amount DECIMAL(18,2) DEFAULT 0 AFTER fee_amount;

-- ── license_incomes / other_incomes: add field_key + is_custom used
--    by the operator submission form (Step 1 / Step 2 custom items) ──
ALTER TABLE license_incomes
  ADD COLUMN field_key VARCHAR(50) NULL COMMENT 'รหัสฟิลด์จากฟอร์ม Frontend เช่น f1_1, custom_1' AFTER income_type,
  ADD COLUMN is_custom BOOLEAN DEFAULT FALSE COMMENT 'รายการที่ผู้ใช้กำหนดเอง (ไม่ใช่รายการมาตรฐาน)';

ALTER TABLE other_incomes
  ADD COLUMN field_key VARCHAR(50) NULL COMMENT 'รหัสฟิลด์จากฟอร์ม Frontend เช่น o1, other_custom_1' AFTER income_type,
  ADD COLUMN is_custom BOOLEAN DEFAULT FALSE COMMENT 'รายการที่ผู้ใช้กำหนดเอง (ไม่ใช่รายการมาตรฐาน)';
