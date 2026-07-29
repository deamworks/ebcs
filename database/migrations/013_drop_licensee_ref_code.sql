-- ════════════════════════════════════════════════════════
-- Migration 013 — เลิกเก็บ ref_code ใน licensee_master
--
-- คอลัมน์นี้เก็บ "รหัสอ้างอิง" จากไฟล์ import ใบอนุญาต แต่ไม่มีที่ไหนใน
-- ระบบใช้งานจริง (ไม่แสดงผล ไม่ใช้คำนวณ) ผู้ใช้ขอให้เอาออกเพราะมีระบบ
-- เลขอ้างอิงอัตโนมัติ (ref_no) ของ taxpayer_master อยู่แล้ว
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/013_drop_licensee_ref_code.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licensee_master' AND COLUMN_NAME = 'ref_code'
);
SET @ddl = IF(@col_exists > 0, 'ALTER TABLE licensee_master DROP COLUMN ref_code', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
