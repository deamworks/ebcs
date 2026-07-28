-- ════════════════════════════════════════════════════════
-- Migration 009 — admin_users.role (2-role admin system)
--
-- Adds a role column distinguishing super_admin (full access,
-- including managing other admin accounts) from admin (full access
-- except the admin-management tab). Existing admin accounts are
-- promoted to super_admin so nobody loses access after this runs;
-- new accounts created afterwards default to 'admin' unless a
-- super_admin explicitly grants super_admin.
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/009_admin_roles.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

SET @col_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE()
    AND TABLE_NAME = 'admin_users'
    AND COLUMN_NAME = 'role'
);

SET @ddl = IF(
  @col_exists = 0,
  "ALTER TABLE admin_users ADD COLUMN role ENUM('super_admin','admin') NOT NULL DEFAULT 'admin' AFTER full_name",
  'SELECT 1'
);

PREPARE stmt FROM @ddl;
EXECUTE stmt;
DEALLOCATE PREPARE stmt;

-- ยกระดับบัญชีแอดมินทั้งหมดที่มีอยู่แล้ว (ก่อน migration นี้) ให้เป็น super_admin
-- ทำครั้งเดียวตอนเพิ่มคอลัมน์เท่านั้น กันไม่ให้ promote ซ้ำถ้ารันไฟล์นี้อีกรอบ
-- (เช่น admin ที่สร้างเป็น role='admin' ทีหลัง ไม่ควรถูกเลื่อนขั้นโดยไม่ตั้งใจ)
SET @sql_promote = IF(
  @col_exists = 0,
  "UPDATE admin_users SET role = 'super_admin'",
  'SELECT 1'
);

PREPARE stmt2 FROM @sql_promote;
EXECUTE stmt2;
DEALLOCATE PREPARE stmt2;
