-- ════════════════════════════════════════════════════════
-- Migration 015 — เพิ่ม ประเภท/รอบ (sub_type/round_type) ให้ taxpayer_master
--
-- ค่าทั้งสองเป็นระดับบริษัท/รอบบัญชี (ไม่ใช่ระดับใบอนุญาตทีละใบ) —
-- ใช้ตอนเพิ่ม/แก้ไขผู้ประกอบการ และซิงก์มาจากไฟล์ import ใบอนุญาต
-- (licensee_master ยังมีคอลัมน์เดิมไว้เผื่อข้อมูลที่นำเข้าจากไฟล์ Excel
-- ต่อใบอนุญาต)
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/015_taxpayer_sub_type_round_type.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col1_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'taxpayer_master' AND COLUMN_NAME = 'sub_type'
);
SET @ddl1 = IF(@col1_exists = 0,
  "ALTER TABLE taxpayer_master ADD COLUMN sub_type VARCHAR(50) NULL AFTER due_date",
  'SELECT 1'
);
PREPARE stmt1 FROM @ddl1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

SET @col2_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'taxpayer_master' AND COLUMN_NAME = 'round_type'
);
SET @ddl2 = IF(@col2_exists = 0,
  "ALTER TABLE taxpayer_master ADD COLUMN round_type VARCHAR(50) NULL AFTER sub_type",
  'SELECT 1'
);
PREPARE stmt2 FROM @ddl2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;
