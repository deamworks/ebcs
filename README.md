# NBTC Filing (เดิมชื่อ e-BCS)

ระบบยื่นแบบและนำส่งเงินรายได้ประจำปีของผู้ประกอบกิจการกระจายเสียงและโทรทัศน์ ต่อ กสทช. (NBTC)
ประกอบด้วยฝั่งผู้ประกอบการ (ยื่นแบบ/แนบเอกสาร/พิมพ์ใบนำส่งเงิน) และฝั่งแอดมิน (ตรวจสอบ/จัดการข้อมูลผู้เสียภาษี-ใบอนุญาต/ดูใบยื่นแบบ)

## Tech Stack

- **Backend**: Python / Flask 3, Flask-JWT-Extended (auth), PyMySQL, bcrypt, gunicorn (production)
- **Database**: MySQL 8.0 (utf8mb4) — schema + migrations ใน `database/`
- **Cache/OTP**: Redis 7
- **Frontend**: HTML/CSS/Vanilla JS (ไม่มี framework/build step) — เสิร์ฟไฟล์ static ผ่าน Nginx
- **Reverse proxy**: Nginx — route `/api/*` ไปที่ Flask, ที่เหลือเสิร์ฟจาก `frontend/`
- **DB admin UI**: phpMyAdmin (dev เท่านั้น)

## โครงสร้างโปรเจกต์

```
backend/
  app/
    routes/        # admin.py, operator.py — REST API endpoints
    services/       # business logic (คำนวณเบี้ยปรับ, สร้างเอกสาร, ฯลฯ)
    auth.py         # JWT login/OTP
    config.py, db.py
  Dockerfile
  requirements.txt
frontend/
  pages/            # index.html (หน้ากรอกแบบ), admin.html, admin-view-submission.html,
                     # login.html, admin-login.html, status.html
  js/                # step1-income.js … step5-summary.js, view-submission.js,
                     # print.js, calc.js, index.js (entry), admin-*.js
  css/, images/, lib/
database/
  schema.sql        # schema เริ่มต้น (รันอัตโนมัติตอนสร้าง MySQL container ครั้งแรก)
  migrations/        # migration ไฟล์ต่อเนื่อง เรียงเลข
nginx/
  nginx.conf
docker-compose.yml
.env.example
```

## การรันในเครื่อง (Development)

ต้องมี Docker + Docker Compose

```bash
cp .env.example .env      # แก้ค่าตามต้องการ (DB password, JWT secret ฯลฯ)
docker compose up -d
```

- เว็บแอป: http://localhost
- phpMyAdmin: http://localhost:8181

`database/schema.sql` จะรันอัตโนมัติตอนสร้าง MySQL volume ครั้งแรกเท่านั้น ถ้า schema มีการเปลี่ยนแปลงหลังจากนั้นต้องรัน migration ใหม่ใน `database/migrations/` เอง (ไม่มีระบบ auto-migrate)

หยุดระบบ: `docker compose down`
ดู log: `docker compose logs -f`

## แนวคิดหลักของระบบ (Domain Model)

- **สถานะใบยื่นแบบ (submission status)**: `draft` (ร่าง) → `pending_attach` (รอแนบเอกสาร) → `pending_payment` (รอชำระเงิน) → `paid` (ชำระแล้ว)
- **ใบยื่นแบบที่ยืนยันแล้ว (ไม่ใช่ draft)** แก้ไขข้อมูลไม่ได้อีก ทั้งฝั่งผู้ประกอบการและแอดมิน — ดูได้อย่างเดียวและพิมพ์เอกสารได้เท่านั้น (ดู PR #150, #168)
- **เอกสารแนบบังคับ 3 รายการ** ก่อนยืนยันนำส่งข้อมูลได้: งบดุลการเงิน, แบบรายงานการนำส่งเงิน (แบบที่ 1) (ชส.01), แบบแสดงรายได้ (ชส.02) — ดู PR #156, #183
- **บันทึกร่าง (Save Draft)**: ผู้ประกอบการกดบันทึกร่างเองได้ระหว่างกรอกแบบ ไฟล์แนบที่อัปโหลดไว้จะถูกเก็บไปกับร่างด้วย — ดู PR #157, #173, #174
- **แอดมิน**: ตรวจสอบใบยื่นแบบ, ตีกลับใบยื่นแบบสถานะ `pending_payment` กลับเป็น `draft` ได้ (พร้อมเหตุผล), แก้ไขข้อมูลใบยื่นแบบของผู้เสียภาษีไม่ได้ (เอาออกแล้วใน PR #168), จัดการข้อมูลผู้เสียภาษี/ใบอนุญาต, นำเข้าข้อมูลจาก Excel (จำกัดสิทธิ์ `super_admin` เท่านั้น — PR #84)
- **ใบนำส่งเงิน (deposit slip / bill payment slip)**: พิมพ์ออกมาพร้อม QR Code มาตรฐาน Thai QR Payment (EMVCo) และ barcode — ดู PR #90–#98, #141

## เอกสารอ้างอิงเพิ่มเติม

- [CLAUDE.md](./CLAUDE.md) — สรุปบริบทโปรเจกต์และรายการ PR ทั้งหมดตั้งแต่ #1 สำหรับ Claude/agent ที่เข้ามาทำงานต่อในโปรเจกต์นี้
