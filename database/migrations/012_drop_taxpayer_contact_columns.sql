-- ════════════════════════════════════════════════════════
-- Migration 012 — เลิกเก็บ phone/email/address ใน taxpayer_master
--
-- อีเมลรับ OTP ใช้ operator_accounts เท่านั้นแล้ว (ไม่ fallback มาที่
-- taxpayer_master.email อีกต่อไป) — ต้องแน่ใจว่าทุก tax_id มีแถวใน
-- operator_accounts พร้อมอีเมลก่อนรัน migration นี้ ไม่งั้นจะ login ไม่ได้
--
-- phone ไม่ได้ใช้งานอยู่แล้ว (เปลี่ยนไปใช้ email ตั้งแต่ก่อนหน้านี้)
-- address เลิกใช้พร้อมกับฟีเจอร์ import "ที่อยู่ผู้ประกอบการ" (contacts)
-- ที่ถูกลบไปพร้อมกันในรอบนี้
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/012_drop_taxpayer_contact_columns.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col1_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'taxpayer_master' AND COLUMN_NAME = 'phone'
);
SET @ddl1 = IF(@col1_exists > 0, 'ALTER TABLE taxpayer_master DROP COLUMN phone', 'SELECT 1');
PREPARE stmt1 FROM @ddl1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

SET @col2_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'taxpayer_master' AND COLUMN_NAME = 'email'
);
SET @ddl2 = IF(@col2_exists > 0, 'ALTER TABLE taxpayer_master DROP COLUMN email', 'SELECT 1');
PREPARE stmt2 FROM @ddl2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

SET @col3_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'taxpayer_master' AND COLUMN_NAME = 'address'
);
SET @ddl3 = IF(@col3_exists > 0, 'ALTER TABLE taxpayer_master DROP COLUMN address', 'SELECT 1');
PREPARE stmt3 FROM @ddl3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
