-- ════════════════════════════════════════════════════════
-- Migration 016 — ขยาย document_attachments.doc_type จาก VARCHAR(50)
-- เป็น VARCHAR(255)
--
-- [BUG] ชื่อรายการเอกสารแนบ (Step 6) บางรายการยาวเกิน 50 ตัวอักษร เช่น
-- "แบบแสดงรายได้จากการประกอบกิจการกระจายเสียงและโทรทัศน์ (ชส.04)" (61 ตัวอักษร)
-- และ "ใบแสดงสถานะร่วมประกอบกิจการอันเกี่ยวกับการวิจัยและพัฒนากิจการกระจายเสียง
-- และโทรทัศน์ฯ" (84 ตัวอักษร) — upload_attachment() เดิมตัด doc_type ที่ [:50]
-- ก่อนบันทึก ทำให้ค่าที่เก็บไม่ตรงกับชื่อเต็มที่ใช้จับคู่ฝั่ง frontend
-- (_vsRenderAttachments เทียบ doc_type กับข้อความเต็มในหน้าตาราง) ไฟล์แนบ
-- สองรายการนี้เลยไม่ถูกจับคู่แสดงผล ดูเหมือน "หาย" ทุกครั้งที่บันทึกร่าง/
-- ทำร่างต่อ ทั้งที่จริงมีข้อมูลอยู่ในฐานข้อมูล (แค่จับคู่ไม่ติด)
--
-- Run once by hand against an existing database:
--   docker compose exec -T mysql \
--     mysql -u root -p"$MYSQL_ROOT_PASSWORD" ebcs < database/migrations/016_document_attachments_doc_type_length.sql
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

ALTER TABLE document_attachments MODIFY COLUMN doc_type VARCHAR(255) NULL COMMENT 'ประเภทเอกสาร';
