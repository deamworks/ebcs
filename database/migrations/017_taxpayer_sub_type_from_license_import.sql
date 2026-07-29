-- ════════════════════════════════════════════════════════
-- Migration 017 — เพิ่ม sub_type กลับเข้า taxpayer_master
--
-- Migration 016 ลบคอลัมน์นี้ไปตอนที่ยังเข้าใจว่าเป็นค่าที่ต้องกรอกเอง
-- แต่จริงๆ แล้ว "ประเภท"/"รอบ" เป็นค่าระดับบริษัทที่มาจากไฟล์ import
-- ใบอนุญาต (คอลัมน์ "ประเภท"/"รอบ" ซ้ำกันทุกแถวของบริษัทเดียวกันในไฟล์)
-- ไม่ใช่สถานะใบอนุญาตต่อใบ (licensee_master.license_status คนละอันกัน)
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/017_taxpayer_sub_type_from_license_import.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'taxpayer_master' AND COLUMN_NAME = 'sub_type'
);
SET @ddl = IF(@col_exists = 0,
  "ALTER TABLE taxpayer_master ADD COLUMN sub_type VARCHAR(50) NULL AFTER due_date",
  'SELECT 1'
);
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
