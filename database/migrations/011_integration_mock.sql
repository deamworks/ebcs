-- ════════════════════════════════════════════════════════
-- Migration 011 — mock Data Center / SAP(ZAT) integration
--
-- ยังไม่มี API spec จริงจาก Data Center และ SAP จึงทำเป็น mock ไว้ก่อน:
-- ตอนยืนยันยื่นแบบ (submit) ระบบจะ "แกล้งส่ง" ข้อมูลไปสองระบบนี้ บันทึก
-- reference ปลอมกลับมาไว้ที่ submissions และ log ไว้ที่ integration_log
-- เพื่อให้เห็นรูปร่าง flow ทั้งหมด — เมื่อได้ API spec จริง แก้แค่
-- backend/app/services/integration_service.py (branch โหมด 'real')
-- โดยไม่ต้องแก้ routes หรือ schema เพิ่ม
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/011_integration_mock.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

CREATE TABLE IF NOT EXISTS integration_log (
  id               CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  submission_id    CHAR(36) NOT NULL,
  target_system    ENUM('datacenter','sap') NOT NULL,
  action           VARCHAR(50) NOT NULL,
  status           ENUM('success','failed') NOT NULL DEFAULT 'success',
  request_payload  JSON NULL,
  response_payload JSON NULL,
  created_at       DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_il_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET @col1_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'submissions' AND COLUMN_NAME = 'datacenter_ref'
);
SET @ddl1 = IF(@col1_exists = 0,
  "ALTER TABLE submissions ADD COLUMN datacenter_ref VARCHAR(50) NULL AFTER status",
  'SELECT 1'
);
PREPARE stmt1 FROM @ddl1; EXECUTE stmt1; DEALLOCATE PREPARE stmt1;

SET @col2_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'submissions' AND COLUMN_NAME = 'sap_doc_no'
);
SET @ddl2 = IF(@col2_exists = 0,
  "ALTER TABLE submissions ADD COLUMN sap_doc_no VARCHAR(50) NULL AFTER datacenter_ref",
  'SELECT 1'
);
PREPARE stmt2 FROM @ddl2; EXECUTE stmt2; DEALLOCATE PREPARE stmt2;

SET @col3_exists = (
  SELECT COUNT(*) FROM information_schema.COLUMNS
  WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'submissions' AND COLUMN_NAME = 'sap_status'
);
SET @ddl3 = IF(@col3_exists = 0,
  "ALTER TABLE submissions ADD COLUMN sap_status ENUM('not_sent','mock_sent','confirmed') NOT NULL DEFAULT 'not_sent' AFTER sap_doc_no",
  'SELECT 1'
);
PREPARE stmt3 FROM @ddl3; EXECUTE stmt3; DEALLOCATE PREPARE stmt3;
