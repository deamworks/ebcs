-- ════════════════════════════════════════════════════════
-- Migration 015 — ย้าย ประเภท/รอบ ไปเก็บที่ taxpayer_master แทน licensee_master
--
-- ผู้ใช้ตัดสินใจว่า sub_type/round_type ควรกรอกตอนเพิ่มผู้ประกอบการ
-- (ระดับบริษัท/รอบบัญชี) ไม่ใช่ตอนเพิ่มใบอนุญาตทีละใบ — เพิ่ม 2 คอลัมน์นี้
-- ให้ taxpayer_master (licensee_master ยังมีคอลัมน์เดิมไว้เผื่อข้อมูลที่
-- นำเข้าจากไฟล์ Excel ต่อใบอนุญาต)
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
