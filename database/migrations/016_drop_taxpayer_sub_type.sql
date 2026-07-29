-- ════════════════════════════════════════════════════════
-- Migration 016 — เลิกเก็บ sub_type ใน taxpayer_master
--
-- คอลัมน์ "สถานะ" ที่แสดงในหน้าผู้ประกอบการ ผู้ใช้ตัดสินใจเอาออก
-- (เก็บแค่ round_type/"รอบ" ไว้เหมือนเดิม)
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/016_drop_taxpayer_sub_type.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'taxpayer_master' AND COLUMN_NAME = 'sub_type'
);
SET @ddl = IF(@col_exists > 0, 'ALTER TABLE taxpayer_master DROP COLUMN sub_type', 'SELECT 1');
PREPARE stmt FROM @ddl; EXECUTE stmt; DEALLOCATE PREPARE stmt;
