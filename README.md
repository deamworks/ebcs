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
  schema.sql        # schema ทั้งหมดของระบบ (แหล่งอ้างอิงเดียว รันอัตโนมัติตอนสร้าง MySQL container ครั้งแรก)
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

`database/schema.sql` เป็นแหล่งอ้างอิงเดียวของโครงสร้างฐานข้อมูลทั้งหมด และจะรันอัตโนมัติตอนสร้าง MySQL volume ครั้งแรกเท่านั้น ถ้าจะแก้โครงสร้างฐานข้อมูลของระบบที่รันอยู่แล้ว ต้องแก้ไข `schema.sql` แล้วรันคำสั่ง ALTER ที่จำเป็นด้วยมือกับฐานข้อมูลนั้นเอง (ไม่มีระบบ auto-migrate)

หยุดระบบ: `docker compose down`
ดู log: `docker compose logs -f`

## การ Deploy จริง (Production)

ระบบใช้ `docker-compose.yml` ชุดเดียวกับตอน dev (ไม่มี compose file แยกสำหรับ production)
`backend/Dockerfile` รัน gunicorn (4 workers) อยู่แล้วเป็นค่าเริ่มต้น ก่อนขึ้นจริงต้อง:

1. ตั้งค่าใน `.env` ใหม่ทั้งหมดให้เป็นค่าจริง — ห้ามใช้ค่าตัวอย่างจาก `.env.example` เด็ดขาด
   (ดูรายละเอียดหัวข้อถัดไป)
2. ปิดหรือจำกัดการเข้าถึง phpMyAdmin (`port 8181` ใน `docker-compose.yml`) เช่น ลบ service
   `phpmyadmin` ออก หรือปิดกั้นด้วย firewall — ถ้าเปิดสู่สาธารณะจะเป็นความเสี่ยงด้านความปลอดภัยสูง
3. ตรวจสอบว่า `MAIL_SERVER` **ไม่ใช่** `mock` และตั้งค่า `MAIL_USERNAME`/`MAIL_PASSWORD` ให้ครบ
   ไม่งั้นระบบจะไม่ส่งอีเมล OTP จริง (แค่ print ค่า OTP ลง log)
4. Deploy/อัปเดตระบบ:

```bash
docker compose up -d --build      # build image ใหม่ + apply ค่า .env ล่าสุด
docker compose restart <service>  # restart เฉพาะ service ที่ต้องการ (เช่น flask-api)
```

## ตัวแปรแวดล้อมที่ต้องเปลี่ยนก่อนขึ้นจริง

ค่าใน `.env.example` เป็นค่าตัวอย่างที่ commit ไว้ใน repo (ใครก็เห็นได้) **ต้องเปลี่ยนทุกตัวก่อนขึ้น production**:

| ตัวแปร | เหตุผล |
|---|---|
| `MYSQL_PASSWORD`, `MYSQL_ROOT_PASSWORD` | รหัสผ่านฐานข้อมูล ค่าตัวอย่างรู้กันทั่วไปแล้ว |
| `FLASK_SECRET_KEY` | ใช้เซ็น session — ถ้าไม่เปลี่ยนแฮกเกอร์ปลอม session ได้ |
| `JWT_SECRET_KEY` | ใช้เซ็น JWT token — ถ้าไม่เปลี่ยนแฮกเกอร์ปลอม token login ได้ |
| `MAIL_USERNAME`, `MAIL_PASSWORD` | บัญชีอีเมลจริงสำหรับส่ง OTP |

ตัวแปรที่ปรับได้ตามความเหมาะสม ไม่บังคับต้องเปลี่ยน: `OTP_EXPIRE_SECONDS`, `OTP_MAX_ATTEMPTS`,
`OTP_RATE_LIMIT_PER_MINUTE`, `MAX_UPLOAD_MB`

## Backup / Restore ฐานข้อมูลและไฟล์แนบ

ข้อมูลจริงเก็บอยู่ที่ `./volumes/db` (bind mount) — **ถ้าลบโฟลเดอร์นี้ ข้อมูลหายถาวร**
ไฟล์แนบของผู้ประกอบการ (เอกสารที่อัปโหลด) เก็บอยู่ที่ `./uploads` (bind mount เดียวกันแบบ
`flask-api` ใน `docker-compose.yml`) — ต้อง backup คู่กับฐานข้อมูลเสมอ เพราะ path ของไฟล์แนบ
ผูกกับ record ในตาราง `document_attachments`

Backup ฐานข้อมูล:
```bash
docker compose exec mysql mysqldump -u root -p ebcs > backup.sql
```

Restore ฐานข้อมูล:
```bash
docker compose exec -T mysql mysql -u root -p ebcs < backup.sql
```

Backup ไฟล์แนบ (ทำคู่กับ backup ฐานข้อมูลทุกครั้ง):
```bash
tar -czf uploads-backup.tar.gz ./uploads
```

## Logging และการดู Error

ระบบไม่มีระบบ log แยกต่างหาก — ใช้ log มาตรฐานของแต่ละ container ผ่าน Docker:

```bash
docker compose logs -f flask-api   # log ฝั่ง backend (error, request, OTP ตอน MAIL_SERVER=mock)
docker compose logs -f nginx       # log ฝั่ง reverse proxy
docker compose logs -f mysql       # log ฐานข้อมูล
```

Log เหล่านี้ไม่ได้ตั้ง rotation ไว้ ถ้าระบบรันนานควรตั้ง `docker compose logs` ให้หมุนเวียนเอง
(เช่นตั้งค่า `max-size`/`max-file` ใน Docker daemon) ไม่งั้น log จะสะสมจนกินพื้นที่ดิสก์

## แก้ปัญหาเบื้องต้น (Troubleshooting)

- **`flask-api` ขึ้นไม่ได้ / restart วนไม่หยุด**: เช็ค `docker compose logs flask-api` ก่อนเสมอ
  ส่วนใหญ่เกิดจาก `.env` ตั้งค่าไม่ครบหรือผิด (โดยเฉพาะ `REDIS_URL` ต้องมี `redis://` นำหน้า)
- **`mysql` ไม่ healthy นาน / `flask-api` รอ MySQL ไม่จบ**: `flask-api` ตั้งไว้ให้รอ MySQL
  `service_healthy` ก่อนเริ่ม (ดู `docker-compose.yml`) ถ้า MySQL ไม่ผ่าน healthcheck ให้เช็ค
  `docker compose logs mysql` และตรวจว่า `MYSQL_ROOT_PASSWORD` ตรงกับที่ตั้งไว้ตอนสร้าง volume
  ครั้งแรก (เปลี่ยนรหัสผ่านทีหลังจะไม่ sync กับข้อมูลใน `./volumes/db` เดิม)
- **แก้ `.env` แล้วระบบไม่เปลี่ยนพฤติกรรม**: ต้อง `docker compose up -d` ใหม่ (หรือ
  `docker compose restart <service>`) ค่า env จะไม่ reload อัตโนมัติ
- **OTP ไม่ส่งอีเมลจริง**: เช็คว่า `MAIL_SERVER` ไม่ใช่ `mock` — ถ้าเป็น `mock` ระบบจะ print
  ค่า OTP ลง log แทนส่งอีเมลจริง (ตั้งใจไว้สำหรับ dev)

## การอัปเดตโครงสร้างฐานข้อมูล (Schema) บนระบบที่รันอยู่แล้ว

ไม่มีระบบ auto-migrate — `database/schema.sql` รันอัตโนมัติแค่ตอนสร้าง MySQL volume ครั้งแรก
เท่านั้น ถ้าจะแก้โครงสร้างฐานข้อมูลของระบบที่มีข้อมูลอยู่แล้ว ต้องทำตามลำดับนี้:

1. แก้ `database/schema.sql` ให้ตรงกับโครงสร้างใหม่ที่ต้องการ (เพื่อให้เป็น single source of
   truth สำหรับคนที่สร้างระบบใหม่ในอนาคต)
2. เขียนคำสั่ง `ALTER TABLE` ที่จำเป็นแยกต่างหาก แล้วรันกับฐานข้อมูลจริงด้วยมือ เช่น:
   ```bash
   docker compose exec mysql mysql -u root -p ebcs -e "ALTER TABLE ..."
   ```
3. **Backup ฐานข้อมูลก่อนรัน ALTER เสมอ** (ดูหัวข้อ Backup ด้านบน)
4. ทดสอบกับข้อมูลจริงหรือ backup ที่ restore มาทดสอบก่อน ไม่รัน ALTER ตรงกับฐานข้อมูล
   production โดยไม่เคยทดสอบมาก่อน

## แนวคิดหลักของระบบ (Domain Model)

- **สถานะใบยื่นแบบ (submission status)**: `draft` (ร่าง) → `pending_payment` (รอชำระเงิน) → `paid` (ชำระแล้ว)
- **ใบยื่นแบบที่ยืนยันแล้ว (ไม่ใช่ draft)** แก้ไขข้อมูลไม่ได้อีก ทั้งฝั่งผู้ประกอบการและแอดมิน — ดูได้อย่างเดียวและพิมพ์เอกสารได้เท่านั้น (ดู PR #150, #168)
- **เอกสารแนบบังคับ 3 รายการ** ก่อนยืนยันนำส่งข้อมูลได้: งบดุลการเงิน, แบบรายงานการนำส่งเงิน (แบบที่ 1) (ชส.01), แบบแสดงรายได้ (ชส.02) — ดู PR #156, #183
- **บันทึกร่าง (Save Draft)**: ผู้ประกอบการกดบันทึกร่างเองได้ระหว่างกรอกแบบ ไฟล์แนบที่อัปโหลดไว้จะถูกเก็บไปกับร่างด้วย — ดู PR #157, #173, #174
- **แอดมิน**: ตรวจสอบใบยื่นแบบ, ตีกลับใบยื่นแบบสถานะ `pending_payment` กลับเป็น `draft` ได้ (พร้อมเหตุผล), แก้ไขข้อมูลใบยื่นแบบของผู้เสียภาษีไม่ได้ (เอาออกแล้วใน PR #168), จัดการข้อมูลผู้เสียภาษี/ใบอนุญาต, นำเข้าข้อมูลจาก Excel (จำกัดสิทธิ์ `super_admin` เท่านั้น — PR #84)
- **ใบนำส่งเงิน (deposit slip / bill payment slip)**: พิมพ์ออกมาพร้อม QR Code มาตรฐาน Thai QR Payment (EMVCo) และ barcode — ดู PR #90–#98, #141

## เอกสารอ้างอิงเพิ่มเติม

- [CLAUDE.md](./CLAUDE.md) — สรุปบริบทโปรเจกต์และรายการ PR ทั้งหมดตั้งแต่ #1 สำหรับ Claude/agent ที่เข้ามาทำงานต่อในโปรเจกต์นี้
