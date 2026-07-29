-- ════════════════════════════════════════════════════════
-- e-BCS Database Schema (MySQL 8.0)
-- รันอัตโนมัติตอน MySQL สร้าง database ครั้งแรก (ลบ volumes/db เพื่อรันใหม่)
-- ════════════════════════════════════════════════════════

SET NAMES utf8mb4;

-- ════════════════════════════════════════════════════════
-- กลุ่มที่ 1: MASTER TABLES (แอดมิน import ก่อนเปิดระบบ)
-- ════════════════════════════════════════════════════════

-- ผู้ประกอบการที่มีสิทธิ์ยื่นแบบ — 1 บริษัทมีได้หลายแถว (แถวละ 1 ปีบัญชี)
-- phone/email/address เลิกเก็บแล้ว (email รับ OTP ใช้ operator_accounts เท่านั้น)
CREATE TABLE taxpayer_master (
  id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  tax_id        VARCHAR(13)  NOT NULL,
  operator_name VARCHAR(255) NOT NULL,
  fiscal_year   INT          NOT NULL COMMENT 'ปีบัญชี (พ.ศ.)',
  ref_no        VARCHAR(50)  NULL COMMENT 'เลขอ้างอิงสำหรับชำระเงินที่ธนาคาร',
  period_start  DATE NULL,
  period_end    DATE NULL,
  due_date      DATE NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_tax_year (tax_id, fiscal_year),
  INDEX idx_txp_tax_id (tax_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ใบอนุญาตทั้งหมดของ กสทช. — เลขใบอนุญาตห้ามซ้ำทั้งระบบ
CREATE TABLE licensee_master (
  id             CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  license_no     VARCHAR(50)  NOT NULL COMMENT 'เลขที่ใบอนุญาต',
  tax_id         VARCHAR(13)  NOT NULL COMMENT 'เจ้าของใบอนุญาต',
  company_name   VARCHAR(255) NOT NULL,
  licensee_type  VARCHAR(100) NULL COMMENT 'ประเภทใบอนุญาต',
  license_status ENUM('active','ended','cancelled','revoked') DEFAULT 'active',
  start_date     DATE NULL COMMENT 'วันเริ่มต้นใบอนุญาต',
  end_date       DATE NULL COMMENT 'วันหมดอายุใบอนุญาต',

  -- คอลัมน์ต่อไปนี้ใช้โดย import/export Excel ใบอนุญาตรายปี (snapshot ล่าสุด)
  fiscal_year    INT           NULL COMMENT 'ปีบัญชี (พ.ศ.) ที่ import ล่าสุด',
  sub_type       VARCHAR(50)   NULL COMMENT 'ประเภท (จากไฟล์ import หรือ default ตอนเพิ่มเอง)',
  round_type     VARCHAR(50)   NULL COMMENT 'รอบ (จากไฟล์ import)',
  sub_status     VARCHAR(50)   NULL COMMENT 'สถานะงวดนำส่ง (จากไฟล์ import)',
  license_count  INT           NULL COMMENT 'จำนวนใบอนุญาตของ tax_id นี้ ณ วันที่ import',
  income         DECIMAL(18,2) DEFAULT 0 COMMENT 'รายได้จากใบอนุญาต',
  deduction      DECIMAL(18,2) DEFAULT 0 COMMENT 'ค่าลดหย่อน',
  fund_amount    DECIMAL(18,2) DEFAULT 0 COMMENT 'เงินนำส่งเข้ากองทุน',
  vat            DECIMAL(18,2) DEFAULT 0 COMMENT 'ภาษีมูลค่าเพิ่ม',
  surcharge      DECIMAL(18,2) DEFAULT 0 COMMENT 'เงินเพิ่ม',
  net_amount     DECIMAL(18,2) DEFAULT 0 COMMENT 'จำนวนเงินรายปีนำส่งสุทธิ',

  created_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  UNIQUE KEY uq_license_no (license_no),
  INDEX idx_lic_tax_id (tax_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- อีเมลรับ OTP ของผู้ประกอบการ — แยกจาก taxpayer_master.email เสมอมีสิทธิ์เหนือกว่าตอน login
CREATE TABLE operator_accounts (
  id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  tax_id        VARCHAR(13)  NOT NULL,
  operator_name VARCHAR(255) NOT NULL DEFAULT '',
  email         VARCHAR(255) NOT NULL,
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,

  UNIQUE KEY uq_oa_tax_id (tax_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ════════════════════════════════════════════════════════
-- กลุ่มที่ 2: ADMIN TABLE (auth เขียนเอง ไม่พึ่ง third-party)
-- ════════════════════════════════════════════════════════

CREATE TABLE admin_users (
  id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  email         VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL COMMENT 'bcrypt hash เท่านั้น ห้ามเก็บรหัสจริง',
  full_name     VARCHAR(255) NULL,
  role          ENUM('super_admin','admin') NOT NULL DEFAULT 'admin' COMMENT 'super_admin จัดการแอดมินอื่นได้ด้วย',
  is_active     BOOLEAN  DEFAULT TRUE COMMENT 'ปิดบัญชีโดยไม่ลบ (audit_logs ยังอ้างอิง email อยู่)',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL COMMENT 'เวลา login ล่าสุด',

  UNIQUE KEY uq_adm_email (email)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ════════════════════════════════════════════════════════
-- กลุ่มที่ 3: TRANSACTION TABLES (เกิดขึ้นตอนผู้ประกอบการยื่นแบบ)
-- ════════════════════════════════════════════════════════

-- ใบยื่นแบบแต่ละฉบับ (หัวใจของระบบ)
-- สถานะ: draft (ยังไม่ยืนยัน) → pending_payment (ยืนยันแล้ว) → paid (มี receipt แล้ว)
CREATE TABLE submissions (
  id            CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  tax_id        VARCHAR(13) NOT NULL,
  ref_no        VARCHAR(50) NULL,
  fiscal_year   INT         NOT NULL,

  -- snapshot ข้อมูลบริษัท ณ วันยื่น (ไม่เปลี่ยนตามถ้า master ถูกแก้ทีหลัง)
  operator_name VARCHAR(255) NULL,
  period_start  DATE NULL,
  period_end    DATE NULL,
  due_date      DATE NULL,

  status ENUM('draft','pending_payment','paid') DEFAULT 'draft' COMMENT 'คำนวณจากการกระทำจริง',
  datacenter_ref VARCHAR(50) NULL COMMENT 'reference จาก Data Center (mock จนกว่าจะเชื่อมต่อจริง)',
  sap_doc_no     VARCHAR(50) NULL COMMENT 'เลขที่เอกสารตั้งหนี้ใน SAP/ZAT (mock จนกว่าจะเชื่อมต่อจริง)',
  sap_status     ENUM('not_sent','mock_sent','confirmed') NOT NULL DEFAULT 'not_sent',

  total_income     DECIMAL(18,2) DEFAULT 0 COMMENT 'รายได้รวม',
  total_income_financial DECIMAL(18,2) DEFAULT 0 COMMENT 'รายได้รวมตามงบการเงิน (กรอกเอง Step 1)',
  deduction_amount DECIMAL(18,2) DEFAULT 0 COMMENT 'ค่าลดหย่อน Step3',
  fund_amount      DECIMAL(18,2) DEFAULT 0 COMMENT 'เงินกองทุน 2%',
  vat_amount       DECIMAL(18,2) DEFAULT 0 COMMENT 'VAT 7%',
  extra_amount     DECIMAL(18,2) DEFAULT 0 COMMENT 'เงินเพิ่มกรณีล่าช้า',
  net_amount       DECIMAL(18,2) DEFAULT 0 COMMENT 'ยอดสุทธิที่ต้องชำระ',

  -- ข้อมูลผู้สอบบัญชี (Step 4)
  auditor_name    VARCHAR(255) NULL,
  auditor_license VARCHAR(50)  NULL,
  auditor_office  VARCHAR(255) NULL,
  audited_date    DATE NULL,

  submitted_at  DATETIME NULL COMMENT 'NULL = ร่าง, มีค่า = ยืนยันแล้ว',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  INDEX idx_sub_tax_id (tax_id),
  INDEX idx_sub_year   (fiscal_year),
  INDEX idx_sub_status (status)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ใบอนุญาตในใบยื่นแต่ละฉบับ (1 ใบยื่น : N ใบอนุญาต)
CREATE TABLE licenses (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  submission_id CHAR(36)      NOT NULL COMMENT 'ลบใบยื่น → ลบใบอนุญาตตามด้วย (CASCADE)',
  sort_order    INT           NOT NULL DEFAULT 0 COMMENT 'ลำดับแถวตามที่ส่งมาตอนยื่นแบบ',
  license_no    VARCHAR(50)   NOT NULL,
  licensee_type VARCHAR(100)  NULL,
  license_status VARCHAR(20)  NULL,
  station       VARCHAR(255)  NULL COMMENT 'สถานี/ช่องรายการ',
  start_date    DATE          NULL,
  end_date      DATE          NULL,
  fee_amount    DECIMAL(18,2) DEFAULT 0 COMMENT 'รายได้รวมของใบอนุญาตนี้',
  deduction_amount DECIMAL(18,2) DEFAULT 0 COMMENT 'ค่าลดหย่อนของใบอนุญาตนี้ (Step 3)',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  INDEX idx_lcs_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- รายได้ย่อยรายประเภทของแต่ละใบอนุญาต (เช่น ค่าโฆษณา, ค่าเช่าเวลา)
CREATE TABLE license_incomes (
  id          CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  license_id  CHAR(36)      NOT NULL,
  income_type VARCHAR(50)   NULL COMMENT 'รหัสประเภท เช่น ads, rental',
  field_key   VARCHAR(50)   NULL COMMENT 'รหัสฟิลด์จากฟอร์ม Frontend เช่น f1_1, custom_1',
  label       VARCHAR(255)  NULL COMMENT 'ชื่อแสดงผล เช่น รายได้ค่าโฆษณา',
  amount      DECIMAL(18,2) DEFAULT 0,
  is_custom   BOOLEAN       DEFAULT FALSE COMMENT 'รายการที่ผู้ใช้กำหนดเอง',

  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  INDEX idx_inc_lic (license_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- รายได้อื่นที่ไม่นำมาคำนวณเงินกองทุน (Step 2) — ผูกกับใบยื่นตรงๆ
CREATE TABLE other_incomes (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  submission_id CHAR(36)      NOT NULL,
  income_type   VARCHAR(50)   NULL,
  field_key     VARCHAR(50)   NULL COMMENT 'รหัสฟิลด์จากฟอร์ม Frontend เช่น o1, other_custom_1',
  label         VARCHAR(255)  NULL,
  amount        DECIMAL(18,2) DEFAULT 0,
  is_custom     BOOLEAN       DEFAULT FALSE COMMENT 'รายการที่ผู้ใช้กำหนดเอง',

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  INDEX idx_oth_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- metadata ไฟล์แนบ (Step 6) — ไฟล์จริงเก็บที่ /uploads บน server ไม่ใช่ใน DB
CREATE TABLE document_attachments (
  id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  submission_id CHAR(36)     NOT NULL,
  doc_type      VARCHAR(50)  NULL COMMENT 'ประเภทเอกสาร',
  file_name     VARCHAR(255) NOT NULL COMMENT 'ชื่อไฟล์เดิมของผู้ใช้',
  storage_path  VARCHAR(500) NOT NULL COMMENT 'path จริงบน server (ชื่อไฟล์เปลี่ยนเป็น UUID แล้ว)',
  mime_type     VARCHAR(100) NULL,
  file_size     INT NULL COMMENT 'ขนาดไฟล์ (bytes)',
  uploaded_at   DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  INDEX idx_att_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ใบแจ้งหนี้ — 1 ใบยื่น : 1 ใบแจ้งหนี้
CREATE TABLE invoice (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  submission_id CHAR(36)      NOT NULL,
  invoice_no    VARCHAR(50)   NULL,
  amount        DECIMAL(18,2) DEFAULT 0,
  issued_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  issued_by     VARCHAR(255)  NULL COMMENT 'email เจ้าหน้าที่ผู้ออกใบแจ้งหนี้',

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_inv_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ใบเสร็จรับเงิน — มีแถวในนี้เมื่อไหร่ status ของ submissions เปลี่ยนเป็น paid อัตโนมัติ
CREATE TABLE receipt (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  submission_id CHAR(36)      NOT NULL,
  receipt_no    VARCHAR(50)   NULL,
  amount        DECIMAL(18,2) DEFAULT 0,
  received_at   DATETIME NULL COMMENT 'วันเวลารับชำระจริง',
  recorded_by   VARCHAR(255)  NULL COMMENT 'email เจ้าหน้าที่ผู้บันทึก',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  UNIQUE KEY uq_rcp_sub (submission_id) COMMENT 'กันรับเงินซ้ำ'

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ════════════════════════════════════════════════════════
-- กลุ่มที่ 4: SYSTEM TABLES
-- ════════════════════════════════════════════════════════

-- บันทึกทุกการเปลี่ยนแปลงโดยเจ้าหน้าที่ — ไม่มี FOREIGN KEY เพราะ log ต้องอยู่ถาวร
CREATE TABLE audit_logs (
  id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  admin_email VARCHAR(255) NOT NULL COMMENT 'ใครทำ',
  action      VARCHAR(255) NOT NULL COMMENT 'ทำอะไร',
  table_name  VARCHAR(100) NOT NULL COMMENT 'ตารางไหน',
  record_id   VARCHAR(50)  NULL     COMMENT 'แถวไหน',
  record_label VARCHAR(255) NULL    COMMENT 'ของใคร เช่น ชื่อผู้ประกอบการ/เลขผู้เสียภาษี',
  changes     JSON NULL COMMENT 'ค่าก่อน/หลัง เช่น {"phone":{"old":"..","new":".."}}',
  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

  INDEX idx_log_created (created_at DESC),
  INDEX idx_log_table   (table_name)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- log การเชื่อมต่อ Data Center/SAP(ZAT) ต่อใบยื่น — ปัจจุบันเป็น mock ทั้งหมด
CREATE TABLE integration_log (
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


-- บันทึกทุกครั้งที่นำเข้าข้อมูล พร้อม snapshot ค่าก่อนนำเข้า เพื่อ rollback ได้ในคลิกเดียว
CREATE TABLE import_batches (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  import_type   ENUM('taxpayer','license','operator_account') NOT NULL,
  imported_by   VARCHAR(255)  NOT NULL COMMENT 'อีเมลแอดมินที่นำเข้า',
  imported_at   DATETIME      DEFAULT CURRENT_TIMESTAMP,
  row_count     INT           NOT NULL DEFAULT 0,
  status        ENUM('active','rolled_back') NOT NULL DEFAULT 'active',
  snapshot      LONGTEXT      NOT NULL COMMENT 'JSON array: [{"table","key","old"}] old=null คือแถวใหม่',

  INDEX idx_imb_type (import_type),
  INDEX idx_imb_status (status)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ตัวนับเลขอ้างอิงอัตโนมัติ — ไม่ใช้ AUTO_INCREMENT เพราะต้องมี prefix ปี (เช่น NBTC-2568-0001)
CREATE TABLE ref_no_counters (
  id       CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  prefix   VARCHAR(20) NOT NULL COMMENT 'เช่น NBTC-2568',
  last_seq INT DEFAULT 0 COMMENT 'เลขล่าสุดที่ใช้ไป',

  UNIQUE KEY uq_prefix (prefix)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ════════════════════════════════════════════════════════
-- SEED DATA: บัญชีแอดมินคนแรกเท่านั้น
-- ════════════════════════════════════════════════════════

-- รหัสผ่านจริง: ChangeMe123! (bcrypt rounds=12) — เปลี่ยนทันทีหลัง login ครั้งแรกบน production
INSERT INTO admin_users (email, password_hash, full_name, role) VALUES
(
  'putita.chaleeprom12@gmail.com',
  '$2b$12$nGg0SOXe2NJwBaaPhk7souwTkssH/.lZfbkaf3zQEOZ5ehE5UdUs6',
  'ผู้ดูแลระบบ',
  'super_admin'
);
