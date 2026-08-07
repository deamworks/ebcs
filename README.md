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

ระบบมีผู้ใช้งาน 2 ฝ่าย ใช้กันคนละหน้า login และเห็นเมนูไม่เหมือนกัน:

- **ผู้ประกอบการ** (เจ้าของกิจการวิทยุ/โทรทัศน์) → login ที่ `login.html` → ใช้งานผ่าน `index.html`
- **แอดมิน** (เจ้าหน้าที่ กสทช.) → login ที่ `admin-login.html` → ใช้งานผ่าน `admin.html`

### สถานะใบยื่นแบบ (Submission Status) — แกนกลางของทั้งระบบ

ใบยื่นแบบแต่ละใบมี 3 สถานะ ไล่ตามลำดับนี้เท่านั้น (เดินหน้าอย่างเดียว ไม่มีข้ามขั้น):

```
draft (ร่าง) → pending_payment (รอชำระเงิน) → paid (ชำระแล้ว)
```

- **`draft`** — ผู้ประกอบการกำลังกรอกแบบอยู่ แก้ไขข้อมูล/แนบไฟล์/ลบทิ้งได้อิสระ เป็นสถานะเดียว
  ที่แก้ไขข้อมูลได้
- **`pending_payment`** — ผู้ประกอบการกดยืนยันนำส่งแล้ว ระบบล็อกข้อมูลทันที **แก้ไขไม่ได้อีก**
  ทั้งฝั่งผู้ประกอบการและแอดมิน (ดู PR #150, #168) เห็นได้แค่โหมดดูอย่างเดียว + พิมพ์เอกสาร
  ทางเดียวที่จะแก้ข้อมูลกลับได้คือแอดมิน "ตีกลับ" ให้กลับเป็น `draft` (ต้องระบุเหตุผลทุกครั้ง)
- **`paid`** — ยืนยันว่าชำระเงินแล้ว เป็นสถานะสุดท้าย ดูอย่างเดียวเช่นกัน

### ฝั่งผู้ประกอบการ ทำอะไรได้บ้าง

ขั้นตอนกรอกแบบแบ่งเป็น 5 Step (ไฟล์ `frontend/js/step1-income.js` … `step5-summary.js`) บวก
ขั้นแนบเอกสาร:

1. **Step 1 – รายได้**: กรอกรายได้ตามใบอนุญาตที่มี (ดึงรายชื่อใบอนุญาตของตัวเองมาให้เลือกอัตโนมัติ
   ผ่าน endpoint `/api/operator/licenses`)
2. **Step 2 – รายได้อื่นๆ**: รายได้ที่ไม่ผูกกับใบอนุญาตโดยตรง
3. **Step 3 – รายการหักลดหย่อน**: ค่าลดหย่อนตามเงื่อนไขที่กฎหมายกำหนด
4. **Step 4**: (ต่อเนื่องจากการคำนวณ ดู `calc.js` สำหรับสูตรคำนวณเบี้ยปรับ/ยอดนำส่ง)
5. **Step 5 – สรุปผล**: สรุปยอดเงินที่ต้องนำส่งทั้งหมด ก่อนกดยืนยันนำส่งจริง
6. **แนบเอกสาร**: ต้องแนบเอกสารบังคับ 3 รายการก่อนยืนยันนำส่งได้เสมอ — งบดุลการเงิน,
   แบบรายงานการนำส่งเงิน (แบบที่ 1) (ชส.01), แบบแสดงรายได้ (ชส.02) (ดู PR #156, #183)

ความสามารถเสริมระหว่างกรอกแบบ:
- **บันทึกร่าง (Save Draft)** — กดบันทึกเองได้ทุกเมื่อระหว่างกรอก ข้อมูลฟอร์ม + ไฟล์แนบที่อัปโหลด
  ไว้แล้วจะถูกเก็บไปกับร่างด้วย กลับมาทำต่อได้โดยไม่ต้องกรอกใหม่ (ดู PR #157, #173, #174)
  — คนละกลไกกับ auto-save ใน `localStorage` ของเบราว์เซอร์ (ชั่วคราว, เผื่อกรณีปิดแท็บ/ไฟดับ)
  อย่าสับสนสองอย่างนี้เข้าด้วยกันตอนแก้โค้ด
- **พิมพ์ใบนำส่งเงิน** — หลังยืนยันนำส่งแล้ว พิมพ์ใบนำส่งเงิน (deposit slip) พร้อม QR Code
  มาตรฐาน Thai QR Payment (EMVCo) และ barcode สำหรับนำไปชำระที่ธนาคาร (ดู PR #90–#98, #141)
- **ดูสถานะ/ประวัติใบยื่นแบบของตัวเอง** — ผ่านหน้า `status.html`

### ฝั่งแอดมิน ทำอะไรได้บ้าง

แอดมินมี 2 ระดับสิทธิ์: `admin` (ทั่วไป) และ `super_admin` (สิทธิ์เต็ม) — ความสามารถหลัก:

- **ตรวจสอบใบยื่นแบบ** — ดูรายการใบยื่นแบบทั้งหมดของทุกผู้ประกอบการ เปิดดูรายละเอียดทีละใบได้
  (ดูอย่างเดียว **แก้ไขข้อมูลไม่ได้** — ความสามารถแก้ไขถูกถอดออกทั้งหมดแล้วใน PR #168)
- **ตีกลับใบยื่นแบบ** — ตีกลับใบยื่นแบบสถานะ `pending_payment` ให้กลับเป็น `draft` ได้ (ต้องกรอก
  เหตุผลผ่าน modal ทุกครั้ง) เผื่อกรณีผู้ประกอบการกรอกข้อมูลผิดแล้วต้องแก้ไขใหม่
- **จัดการข้อมูลผู้เสียภาษี/ใบอนุญาต** — เพิ่ม/แก้ไข/ลบข้อมูลผู้เสียภาษีและใบอนุญาตที่ผูกกับผู้เสียภาษี
  แต่ละราย (ฐานข้อมูลอ้างอิงที่ผู้ประกอบการใช้ตอนกรอกแบบ)
- **จัดการบัญชีผู้ประกอบการ** — สร้าง/แก้ไข/ลบบัญชี login ของผู้ประกอบการ
- **นำเข้าข้อมูลจาก Excel (Import)** — นำเข้าผู้เสียภาษี/ใบอนุญาต/บัญชีผู้ประกอบการเป็นชุดใหญ่
  พร้อมระบบ rollback ย้อนกลับได้ทั้งชุด — **จำกัดสิทธิ์ `super_admin` เท่านั้น** (ดู PR #84)
- **ส่งออกรายงาน (Export)** — export รายชื่อผู้เสียภาษี/ใบอนุญาต/รายงานการชำระเงินเป็นไฟล์
- **จัดการบัญชีแอดมินด้วยกันเอง** — เฉพาะ `super_admin` เพิ่ม/ลบแอดมิน และกำหนดระดับสิทธิ์ได้
- **Audit Log** — ทุกการกระทำสำคัญ (แก้ไข/ลบ/import/ตีกลับ) ถูกบันทึกพร้อมเวลาแบบไทยและอธิบาย
  เป็นภาษาที่อ่านง่าย ดูย้อนหลังได้จากเมนู audit log

## เอกสารอ้างอิงเพิ่มเติม

- [CLAUDE.md](./CLAUDE.md) — สรุปบริบทโปรเจกต์และรายการ PR ทั้งหมดตั้งแต่ #1 สำหรับ Claude/agent ที่เข้ามาทำงานต่อในโปรเจกต์นี้
