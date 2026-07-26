-- Migration 003: เพิ่มรายละเอียด audit log ให้ระบุ "ของใคร" ได้ชัดเจนขึ้น
-- และรองรับการบันทึกเวลาแบบ Asia/Bangkok จากฝั่งแอปพลิเคชันโดยตรง

ALTER TABLE audit_logs
  ADD COLUMN record_label VARCHAR(255) NULL COMMENT 'ของใคร เช่น ชื่อผู้ประกอบการ/เลขผู้เสียภาษี'
  AFTER record_id;
