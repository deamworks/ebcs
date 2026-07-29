-- ════════════════════════════════════════════════════════
-- Migration 014 — เลิกเก็บ sub_status ใน licensee_master
--
-- คอลัมน์นี้เก็บ "สถานะงวดนำส่ง" จากไฟล์ import ใบอนุญาต แต่ไม่มีที่ไหน
-- ในระบบใช้งานจริง (ไม่แสดงผล ไม่ใช้คำนวณ) ผู้ใช้ขอให้เอาออก
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/014_drop_licensee_sub_status.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'licensee_master' AND COLUMN_NAME = 'sub_status'
);
SET @ddl = IF(@col_exists > 0, 'ALTER TABLE licensee_master DROP COLUMN sub_status', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
