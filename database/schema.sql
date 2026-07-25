-- ════════════════════════════════════════════════════════
-- e-BCS Database Schema (MySQL 8.0)
-- ไฟล์นี้รันอัตโนมัติตอน MySQL สร้าง database ครั้งแรก
-- ถ้าอยากรันใหม่: ลบโฟลเดอร์ volumes/db แล้ว docker compose up -d
-- ════════════════════════════════════════════════════════

-- ตั้งค่าภาษาให้รองรับภาษาไทย
SET NAMES utf8mb4;

-- ════════════════════════════════════════════════════════
-- กลุ่มที่ 1: MASTER TABLES
-- แอดมิน Import ข้อมูลเข้ามาก่อนเปิดระบบ
-- ════════════════════════════════════════════════════════

-- ตาราง: taxpayer_master
-- เก็บข้อมูลผู้ประกอบการที่มีสิทธิ์ยื่นแบบ
-- 1 บริษัท มีได้หลายแถว (แถวละ 1 ปีบัญชี)
-- เช่น บริษัท ABC มีแถวปี 2567 และ 2568 ได้
CREATE TABLE taxpayer_master (
  -- id: รหัสเฉพาะของแถว สร้างอัตโนมัติเป็น UUID
  -- UUID ดีกว่า 1,2,3 เพราะเดาไม่ได้ ปลอดภัยกว่า
  id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),

  -- tax_id: เลขประจำตัวผู้เสียภาษี 13 หลัก
  tax_id        VARCHAR(13)  NOT NULL,

  -- operator_name: ชื่อบริษัท/ผู้ประกอบการ
  operator_name VARCHAR(255) NOT NULL,

  -- phone: เบอร์โทร (เดิมใช้รับ OTP ตอน Login — ปัจจุบันเปลี่ยนไปใช้ email แล้ว
  -- เก็บไว้เผื่ออ้างอิงข้อมูลเก่า ไม่ได้ใช้ใน flow login ปัจจุบัน)
  phone         VARCHAR(10)  NULL,

  -- email: อีเมลสำหรับรับ OTP ตอน Login (Phase 6-7)
  email         VARCHAR(255) NULL,

  -- address: ที่อยู่ที่ติดต่อได้ (Import จากไฟล์ Excel ที่อยู่ผู้ประกอบการ)
  address       VARCHAR(500) NULL,


  -- fiscal_year: ปีบัญชี (พ.ศ.) เช่น 2568
  fiscal_year   INT          NOT NULL,

  -- ref_no: เลขอ้างอิง แอดมินกำหนดล่วงหน้า
  -- ผู้ประกอบการนำไปใช้ชำระเงินที่ธนาคาร
  ref_no        VARCHAR(50)  NULL,

  -- วันเริ่ม-สิ้นสุดรอบบัญชี
  period_start  DATE NULL,
  period_end    DATE NULL,

  -- วันครบกำหนดชำระเงิน
  due_date      DATE NULL,

  -- created_at: เวลาสร้างแถว (MySQL ใส่ให้อัตโนมัติ)
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- updated_at: เวลาแก้ไขล่าสุด (MySQL อัปเดตให้อัตโนมัติทุกครั้งที่แก้)
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- UNIQUE: tax_id + fiscal_year ห้ามซ้ำกัน
  -- ทำให้ Import ซ้ำ = UPDATE แทน INSERT (Upsert)
  UNIQUE KEY uq_tax_year (tax_id, fiscal_year),

  -- INDEX: สร้างดัชนีที่ phone เพราะตอน Login ค้นด้วยเบอร์ทุกครั้ง
  -- ถ้าไม่มี index MySQL ต้องวนอ่านทุกแถว (ช้ามากถ้ามี 2000 ราย)
  INDEX idx_txp_phone  (phone),
  INDEX idx_txp_tax_id (tax_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ตาราง: licensee_master
-- เก็บข้อมูลใบอนุญาตทั้งหมดของ กสทช.
-- เลขใบอนุญาตห้ามซ้ำทั้งระบบ (ใบอนุญาต 1 ใบมีเลขเดียวในโลก)
CREATE TABLE licensee_master (
  id             CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  license_no     VARCHAR(50)  NOT NULL COMMENT 'เลขที่ใบอนุญาต',
  tax_id         VARCHAR(13)  NOT NULL COMMENT 'เจ้าของใบอนุญาต',
  company_name   VARCHAR(255) NOT NULL,

  -- licensee_type: ประเภทใบอนุญาต
  licensee_type  VARCHAR(100) NULL,

  -- license_status: สถานะใบอนุญาต
  -- ENUM จำกัดให้ใส่ได้แค่ 4 ค่านี้เท่านั้น
  -- ใส่ค่าอื่น MySQL จะ error ทันที ป้องกันข้อมูลสกปรก
  license_status ENUM('active','ended','cancelled','revoked')
                 DEFAULT 'active',

  start_date     DATE NULL COMMENT 'วันเริ่มต้นใบอนุญาต',
  end_date       DATE NULL COMMENT 'วันหมดอายุใบอนุญาต',

  -- คอลัมน์ต่อไปนี้ใช้โดยการ Import Excel ใบอนุญาตรายปี (services/import_service.py)
  -- และรายงานผลการจัดเก็บ (services/export_service.py) — เก็บ snapshot
  -- ทางการเงิน/สถานะงวดนำส่งล่าสุดของใบอนุญาตนี้ไว้ในแถวเดียวกัน
  fiscal_year    INT           NULL COMMENT 'ปีบัญชี (พ.ศ.) ที่ import ล่าสุด',
  ref_code       VARCHAR(50)   NULL COMMENT 'รหัสอ้างอิงจากไฟล์ import',
  sub_type       VARCHAR(50)   NULL COMMENT 'ประเภท (จากไฟล์ import)',
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

  -- เลขใบอนุญาตห้ามซ้ำเลยทั้งระบบ
  UNIQUE KEY uq_license_no (license_no),

  -- INDEX ที่ tax_id เพราะตอนผู้ประกอบการ Login
  -- ระบบต้องดึง "ใบอนุญาตทั้งหมดของบริษัทนี้" ด้วย tax_id
  INDEX idx_lic_tax_id (tax_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ════════════════════════════════════════════════════════
-- กลุ่มที่ 2: ADMIN TABLE
-- บัญชีเจ้าหน้าที่ (ระบบ auth เขียนเอง ไม่พึ่งพา third-party auth provider)
-- ════════════════════════════════════════════════════════

CREATE TABLE admin_users (
  id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  email         VARCHAR(255) NOT NULL,

  -- password_hash: เก็บแค่ bcrypt hash ห้ามเก็บรหัสจริงเด็ดขาด
  -- bcrypt hash มีหน้าตาแบบนี้: $2b$12$xxx...
  -- ย้อนกลับเป็นรหัสจริงไม่ได้ ถ้า DB รั่วรหัสยังปลอดภัย
  password_hash VARCHAR(255) NOT NULL,

  full_name     VARCHAR(255) NULL,

  -- is_active: ปิดบัญชีโดยไม่ลบ
  -- เวลาเจ้าหน้าที่ลาออก set เป็น FALSE แทนลบ
  -- เพราะ audit_logs ยังอ้างอิง email นี้อยู่
  is_active     BOOLEAN  DEFAULT TRUE,

  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  last_login_at DATETIME NULL COMMENT 'เวลา login ล่าสุด',

  UNIQUE KEY uq_adm_email (email)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ════════════════════════════════════════════════════════
-- กลุ่มที่ 3: TRANSACTION TABLES
-- เกิดขึ้นตอนผู้ประกอบการยื่นแบบ
-- ════════════════════════════════════════════════════════

-- ตาราง: submissions (หัวใจของระบบ)
-- เก็บใบยื่นแบบแต่ละฉบับ
-- สถานะมี 3 ค่า และ flow ตามการกระทำจริง:
--   draft           = ยังไม่กดยืนยัน
--   pending_payment = กดยืนยันแล้ว รอชำระเงิน
--   paid            = มีข้อมูลใน receipt แล้ว
CREATE TABLE submissions (
  id            CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  tax_id        VARCHAR(13) NOT NULL,
  ref_no        VARCHAR(50) NULL,
  fiscal_year   INT         NOT NULL,

  -- snapshot: เก็บข้อมูลบริษัท ณ วันยื่น
  -- ถ้าแอดมินแก้ชื่อบริษัทใน master ทีหลัง
  -- ใบยื่นเดิมยังแสดงชื่อเดิม ไม่เปลี่ยนตาม
  operator_name VARCHAR(255) NULL,
  period_start  DATE NULL,
  period_end    DATE NULL,
  due_date      DATE NULL,

  -- status: คำนวณจากการกระทำจริง ไม่ใช่ dropdown ให้แอดมินเลือก
  status ENUM('draft','pending_payment','paid') DEFAULT 'draft',

  -- ยอดเงินต่างๆ (ใช้ DECIMAL ไม่ใช่ FLOAT เพราะต้องการความแม่นยำ)
  total_income     DECIMAL(18,2) DEFAULT 0 COMMENT 'รายได้รวม',
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

  -- submitted_at: เวลาที่กดยืนยัน
  -- NULL = ยังเป็นร่าง / มีค่า = ยืนยันแล้ว
  submitted_at  DATETIME NULL,
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,

  -- INDEX 3 ตัวตรงกับ 3 การกรองที่ใช้บ่อยในหน้า Admin
  INDEX idx_sub_tax_id (tax_id),
  INDEX idx_sub_year   (fiscal_year),
  INDEX idx_sub_status (status)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ตาราง: licenses
-- ใบอนุญาตในใบยื่นแต่ละฉบับ
-- 1 ใบยื่น มีใบอนุญาตได้หลายใบ (1:N)
CREATE TABLE licenses (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),

  -- submission_id: ชี้ไปยังใบยื่นแม่
  -- ON DELETE CASCADE: ถ้าลบใบยื่น → ลบใบอนุญาตของใบนั้นด้วยอัตโนมัติ
  submission_id CHAR(36)      NOT NULL,

  license_no    VARCHAR(50)   NOT NULL,
  licensee_type VARCHAR(100)  NULL,
  license_status VARCHAR(20)  NULL,

  -- fee_amount: รายได้รวมของใบอนุญาตนี้
  fee_amount    DECIMAL(18,2) DEFAULT 0,

  -- deduction_amount: ค่าลดหย่อนของใบอนุญาตนี้ (Step 3)
  deduction_amount DECIMAL(18,2) DEFAULT 0,

  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  INDEX idx_lcs_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ตาราง: license_incomes
-- รายได้ย่อยรายประเภทของแต่ละใบอนุญาต
-- ตัวอย่าง: ใบอนุญาต B1-001 มีรายได้ค่าโฆษณา 100,000 และค่าเช่าเวลา 50,000
CREATE TABLE license_incomes (
  id          CHAR(36)      PRIMARY KEY DEFAULT (UUID()),

  -- license_id: ชี้ไปยังใบอนุญาตแม่
  license_id  CHAR(36)      NOT NULL,

  income_type VARCHAR(50)   NULL COMMENT 'รหัสประเภท เช่น ads, rental',
  field_key   VARCHAR(50)   NULL COMMENT 'รหัสฟิลด์จากฟอร์ม Frontend เช่น f1_1, custom_1',
  label       VARCHAR(255)  NULL COMMENT 'ชื่อแสดงผล เช่น รายได้ค่าโฆษณา',
  amount      DECIMAL(18,2) DEFAULT 0,
  is_custom   BOOLEAN       DEFAULT FALSE COMMENT 'รายการที่ผู้ใช้กำหนดเอง (ไม่ใช่รายการมาตรฐาน)',

  FOREIGN KEY (license_id) REFERENCES licenses(id) ON DELETE CASCADE,
  INDEX idx_inc_lic (license_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ตาราง: other_incomes
-- รายได้อื่นที่ไม่นำมาคำนวณเงินกองทุน (Step 2)
-- ผูกกับใบยื่นตรงๆ ไม่ผ่านใบอนุญาต
CREATE TABLE other_incomes (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  submission_id CHAR(36)      NOT NULL,
  income_type   VARCHAR(50)   NULL,
  field_key     VARCHAR(50)   NULL COMMENT 'รหัสฟิลด์จากฟอร์ม Frontend เช่น o1, other_custom_1',
  label         VARCHAR(255)  NULL,
  amount        DECIMAL(18,2) DEFAULT 0,
  is_custom     BOOLEAN       DEFAULT FALSE COMMENT 'รายการที่ผู้ใช้กำหนดเอง (ไม่ใช่รายการมาตรฐาน)',

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  INDEX idx_oth_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ตาราง: document_attachments
-- เก็บ metadata ของไฟล์แนบ (Step 6)
-- ไฟล์จริงอยู่ในโฟลเดอร์ /uploads บน server
-- ห้ามเก็บไฟล์ใน MySQL โดยตรง (ทำให้ DB บวม backup ช้า)
CREATE TABLE document_attachments (
  id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  submission_id CHAR(36)     NOT NULL,

  -- doc_type: ประเภทเอกสาร
  doc_type      VARCHAR(50)  NULL,

  -- file_name: ชื่อไฟล์เดิมของผู้ใช้ (ไว้แสดงผล)
  file_name     VARCHAR(255) NOT NULL,

  -- storage_path: path จริงบน server (ชื่อไฟล์เปลี่ยนเป็น UUID แล้ว)
  -- ตัวอย่าง: /uploads/SUB-001/f47ac10b-xxxx.pdf
  storage_path  VARCHAR(500) NOT NULL,

  mime_type     VARCHAR(100) NULL,
  file_size     INT NULL COMMENT 'ขนาดไฟล์ (bytes)',
  uploaded_at   DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,
  INDEX idx_att_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ตาราง: invoice (ใบแจ้งหนี้)
-- 1 ใบยื่น : 1 ใบแจ้งหนี้ (UNIQUE KEY บน submission_id)
CREATE TABLE invoice (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  submission_id CHAR(36)      NOT NULL,
  invoice_no    VARCHAR(50)   NULL,
  amount        DECIMAL(18,2) DEFAULT 0,
  issued_at     DATETIME DEFAULT CURRENT_TIMESTAMP,
  issued_by     VARCHAR(255)  NULL COMMENT 'email เจ้าหน้าที่ผู้ออกใบแจ้งหนี้',

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,

  -- UNIQUE: ใบยื่น 1 ฉบับมีใบแจ้งหนี้ได้แค่ 1 ใบ
  UNIQUE KEY uq_inv_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ตาราง: receipt (ใบเสร็จรับเงิน)
-- เมื่อมีแถวในตารางนี้ → status ของ submissions เปลี่ยนเป็น paid อัตโนมัติ
-- นี่คือกลไก "สถานะ flow ตามจริง" ที่ประชุมต้องการ
CREATE TABLE receipt (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  submission_id CHAR(36)      NOT NULL,
  receipt_no    VARCHAR(50)   NULL,
  amount        DECIMAL(18,2) DEFAULT 0,
  received_at   DATETIME NULL COMMENT 'วันเวลารับชำระจริง',
  recorded_by   VARCHAR(255)  NULL COMMENT 'email เจ้าหน้าที่ผู้บันทึก',
  created_at    DATETIME DEFAULT CURRENT_TIMESTAMP,

  FOREIGN KEY (submission_id) REFERENCES submissions(id) ON DELETE CASCADE,

  -- ใบยื่น 1 ฉบับมีใบเสร็จได้แค่ 1 ใบ ป้องกันรับเงินซ้ำ
  UNIQUE KEY uq_rcp_sub (submission_id)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ════════════════════════════════════════════════════════
-- กลุ่มที่ 4: SYSTEM TABLES
-- ════════════════════════════════════════════════════════

-- ตาราง: audit_logs
-- บันทึกทุกการเปลี่ยนแปลงโดยเจ้าหน้าที่
-- จงใจไม่มี FOREIGN KEY เพราะ log ต้องอยู่ถาวร
-- แม้แถวต้นทางจะถูกลบไปแล้วก็ตาม
CREATE TABLE audit_logs (
  id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  admin_email VARCHAR(255) NOT NULL COMMENT 'ใครทำ',
  action      VARCHAR(255) NOT NULL COMMENT 'ทำอะไร',
  table_name  VARCHAR(100) NOT NULL COMMENT 'ตารางไหน',
  record_id   VARCHAR(50)  NULL     COMMENT 'แถวไหน',

  -- changes: เก็บค่าก่อน/หลังเปลี่ยนแปลง
  -- ตัวอย่าง: {"phone": {"old": "0812345678", "new": "0898765432"}}
  -- JSON type ใน MySQL 8 query ได้ด้วย JSON_EXTRACT()
  changes     JSON NULL,

  created_at  DATETIME DEFAULT CURRENT_TIMESTAMP,

  -- INDEX DESC เพราะหน้า audit log แสดง "ล่าสุดก่อน" เสมอ
  INDEX idx_log_created (created_at DESC),
  INDEX idx_log_table   (table_name)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ตาราง: ref_no_counters
-- ตัวนับเลขอ้างอิงอัตโนมัติ
-- ทำไมไม่ใช้ AUTO_INCREMENT: เพราะต้องมี prefix ปี เช่น NBTC-2568-0001
-- UPDATE จะ lock แถวให้เอง → แม้แอดมิน 2 คน Import พร้อมกัน เลขไม่ซ้ำ
CREATE TABLE ref_no_counters (
  id       CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  prefix   VARCHAR(20) NOT NULL COMMENT 'เช่น NBTC-2568',
  last_seq INT DEFAULT 0 COMMENT 'เลขล่าสุดที่ใช้ไป',

  UNIQUE KEY uq_prefix (prefix)

) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


-- ════════════════════════════════════════════════════════
-- SEED DATA: ข้อมูลเริ่มต้นสำหรับทดสอบระบบ
-- ════════════════════════════════════════════════════════

-- บัญชีแอดมินคนแรก
-- รหัสผ่านจริงคือ: ChangeMe123!
-- hash นี้สร้างด้วย bcrypt rounds=12
-- เปลี่ยนรหัสทันทีหลัง login ครั้งแรกบน production
INSERT INTO admin_users (email, password_hash, full_name) VALUES
(
  'putita.chaleeprom12@gmail.com',
  '$2b$12$nGg0SOXe2NJwBaaPhk7souwTkssH/.lZfbkaf3zQEOZ5ehE5UdUs6',
  'ผู้ดูแลระบบ'
);


-- ผู้ประกอบการทดสอบ 2 ราย
INSERT INTO taxpayer_master
  (tax_id, operator_name, phone, email, fiscal_year, ref_no,
   period_start, period_end, due_date)
VALUES
  (
    '0123456789012',
    'บริษัท ไทยวิทยุกระจายเสียง จำกัด',
    '0949122002',
    'operator1@example.com',
    2568,
    'NBTC-2568-0001',
    '2025-01-01',
    '2025-12-31',
    '2026-05-31'
  ),
  (
    '9876543210987',
    'บริษัท ทีวีดิจิทัลไทย จำกัด',
    '0898765432',
    'operator2@example.com',
    2568,
    'NBTC-2568-0002',
    '2025-01-01',
    '2025-12-31',
    '2026-05-31'
  );


-- ใบอนุญาตทดสอบ 3 ใบ
-- (มีทั้ง active และ ended เพื่อทดสอบว่าระบบดึงมาทุกสถานะ)
INSERT INTO licensee_master
  (license_no, tax_id, company_name, licensee_type,
   license_status, start_date, end_date)
VALUES
  -- ใบอนุญาตของบริษัท ไทยวิทยุ (active)
  ('B1-2567-001', '0123456789012',
   'บริษัท ไทยวิทยุกระจายเสียง จำกัด',
   'กระจายเสียง', 'active', '2024-01-01', '2029-12-31'),

  -- ใบอนุญาตเก่าของบริษัท ไทยวิทยุ (ended)
  ('B1-2565-099', '0123456789012',
   'บริษัท ไทยวิทยุกระจายเสียง จำกัด',
   'กระจายเสียง', 'ended', '2022-01-01', '2024-12-31'),

  -- ใบอนุญาตของบริษัท ทีวีดิจิทัล (active)
  ('T1-2567-005', '9876543210987',
   'บริษัท ทีวีดิจิทัลไทย จำกัด',
   'โทรทัศน์', 'active', '2024-06-01', '2030-05-31');


-- ตัวนับเลขอ้างอิงปีปัจจุบัน
-- last_seq = 2 เพราะ seed data ข้างบนใช้ไป 2 เลขแล้ว
INSERT INTO ref_no_counters (prefix, last_seq) VALUES
  ('NBTC-2568', 2);