# ════════════════════════════════════════════════════════
# auth.py — ระบบยืนยันตัวตน
#
# Flow ผู้ประกอบการ:
#   1. check-taxpayer  → ตรวจเลขภาษี คืน phone+email masked
#   2. request-otp     → เลือก channel (sms/email) ส่ง OTP
#   3. verify-otp      → ตรวจ OTP → ได้ JWT token
#
# Flow เจ้าหน้าที่:
#   admin/login → Email + Password → JWT token
# ════════════════════════════════════════════════════════

import random
import string
import smtplib
from datetime import timedelta
from email.mime.multipart import MIMEMultipart
from email.mime.text      import MIMEText

import bcrypt
import redis
from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token

from .config import Config
from .db     import get_db

auth_bp      = Blueprint("auth", __name__)
redis_client = redis.from_url(Config.REDIS_URL, decode_responses=True)


# ════════════════════════════════════════════════════════
# Helper Functions
# ════════════════════════════════════════════════════════

def generate_otp(length=6):
    """สุ่ม OTP ตัวเลข 6 หลัก"""
    return "".join(random.choices(string.digits, k=length))





def mask_email(email):
    """
    ซ่อนอีเมลบางส่วน
    เช่น somchai@nbtc.go.th → so***@nbtc.go.th
    """
    if not email or "@" not in email:
        return email
    local, domain = email.split("@", 1)
    # แสดงแค่ 2 ตัวแรก ที่เหลือซ่อน
    visible = local[:2] if len(local) >= 2 else local
    return f"{visible}***@{domain}"


def check_rate_limit(tax_id):
    """
    ตรวจ rate limit: ขอ OTP ได้ไม่เกิน 3 ครั้ง/นาที
    คืน True = ผ่าน, False = เกินจำนวน
    """
    rate_key = f"rate:{tax_id}"
    count    = redis_client.get(rate_key)

    if count and int(count) >= Config.OTP_RATE_LIMIT_PER_MIN:
        return False

    pipe = redis_client.pipeline()
    pipe.incr(rate_key)
    pipe.expire(rate_key, 60)
    pipe.execute()
    return True





def send_email(email, otp, operator_name=""):
    """
    ส่ง OTP ทาง Email (Exchange กสทช.)
    MAIL_SERVER=mock → พิมพ์ลง log แทน
    """
    if Config.MAIL_SERVER == "mock":
        print(f"[OTP EMAIL] {email} → {otp}", flush=True)
        return True

    try:
        msg            = MIMEMultipart("alternative")
        msg["Subject"] = f"รหัส OTP ระบบ e-BCS กสทช. : {otp}"
        msg["From"]    = (
            f"{Config.MAIL_FROM_NAME} <{Config.MAIL_FROM}>"
        )
        msg["To"] = email

        html = f"""
        <div style="font-family:sans-serif; max-width:480px;
                    margin:0 auto; padding:24px;
                    border:1px solid #ddd; border-radius:8px;">
            <h2 style="color:#1E2D5E; margin-top:0;">
                ระบบ e-BCS กสทช.
            </h2>
            <p>เรียน {operator_name or 'ผู้ประกอบการ'}</p>
            <p>รหัส OTP สำหรับเข้าสู่ระบบของท่านคือ:</p>
            <div style="background:#EEF2FF; padding:20px;
                        text-align:center; border-radius:8px;
                        margin:20px 0;">
                <span style="font-size:40px; font-weight:bold;
                             color:#1E2D5E; letter-spacing:10px;">
                    {otp}
                </span>
            </div>
            <p style="color:#555;">
                รหัสนี้มีอายุ <strong>5 นาที</strong> เท่านั้น<br>
                หากท่านไม่ได้ขอรหัสนี้ กรุณาเพิกเฉย
            </p>
            <hr style="border:none; border-top:1px solid #eee;">
            <p style="color:#999; font-size:12px; margin-bottom:0;">
                สำนักงาน กสทช.
            </p>
        </div>
        """

        msg.attach(MIMEText(html, "html", "utf-8"))

        with smtplib.SMTP(Config.MAIL_SERVER, Config.MAIL_PORT) as server:
            if Config.MAIL_USE_TLS:
                server.starttls()
            if Config.MAIL_USERNAME:
                server.login(Config.MAIL_USERNAME, Config.MAIL_PASSWORD)
            server.sendmail(Config.MAIL_FROM, email, msg.as_string())

        return True

    except Exception as e:
        print(f"[EMAIL ERROR] {e}", flush=True)
        return False


# ════════════════════════════════════════════════════════
# ขั้นที่ 1: ตรวจเลขภาษี
# ════════════════════════════════════════════════════════

@auth_bp.route("/check-taxpayer", methods=["POST"])
def check_taxpayer():
    """
    ตรวจสอบเลขภาษีว่ามีในระบบไหม
    และคืน channel ที่รับ OTP ได้

    Request:
        POST /api/auth/check-taxpayer
        { "tax_id": "0123456789012" }

    Response:
        {
            "success": true,
            "data": {
                "operator_name": "บริษัท ABC จำกัด",
                "channels": [
                    {"type": "sms",   "display": "081-xxx-5678"},
                    {"type": "email", "display": "ab***@nbtc.go.th"}
                ]
            }
        }
    """
    data = request.get_json()
    if not data:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_REQUEST",
                      "message": "กรุณาส่งข้อมูล JSON"}
        }), 400

    # รับและทำความสะอาด tax_id
    tax_id = str(data.get("tax_id", "")).strip()
    tax_id = tax_id.replace("-", "").replace(" ", "")

    if not tax_id or not tax_id.isdigit() or len(tax_id) != 13:
        return jsonify({
            "success": False,
            "error": {
                "code":    "INVALID_TAX_ID",
                "message": "เลขผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก"
            }
        }), 400

    # ค้นหาใน DB (ใช้ปีล่าสุดอัตโนมัติ)
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT tax_id, operator_name, email
                FROM   taxpayer_master
                WHERE  tax_id = %s
                ORDER BY fiscal_year DESC
                LIMIT 1
            """, (tax_id,))
            taxpayer = cur.fetchone()

    if not taxpayer:
        return jsonify({
            "success": False,
            "error": {
                "code":    "NOT_FOUND",
                "message": (
                    "ไม่พบข้อมูลในระบบ "
                    "กรุณาติดต่อเจ้าหน้าที่ กสทช. โทร 02-271-7600"
                )
            }
        }), 404

    # สร้าง list ช่องทางที่มี
    email = taxpayer.get("email") or ""

    if not email:
        return jsonify({
            "success": False,
            "error": {
                "code":    "NO_EMAIL",
                "message": (
                    "ไม่พบอีเมลในระบบ "
                    "กรุณาติดต่อเจ้าหน้าที่ กสทช. โทร 02-271-7600"
                )
            }
        }), 404

    channels = [{"type": "email", "display": mask_email(email)}]

    return jsonify({
        "success": True,
        "data": {
            "operator_name": taxpayer["operator_name"],
            "channels":      channels
            # channels มี 1 หรือ 2 ตัวเลือก
            # Frontend นำไปแสดง radio button ให้เลือก
        }
    }), 200


# ════════════════════════════════════════════════════════
# ขั้นที่ 2: ส่ง OTP ตาม channel ที่เลือก
# ════════════════════════════════════════════════════════

@auth_bp.route("/request-otp", methods=["POST"])
def request_otp():
    """
    ส่ง OTP ทาง SMS หรือ Email ตามที่เลือก

    Request:
        POST /api/auth/request-otp
        {
            "tax_id":  "0123456789012",
            "channel": "sms"   หรือ  "email"
        }

    Response:
        {
            "success": true,
            "data": {
                "message":    "ส่งรหัส OTP ไปยังเบอร์ 081-xxx-5678 แล้ว",
                "expires_in": 300
            }
        }
    """
    data = request.get_json()
    if not data:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_REQUEST",
                      "message": "กรุณาส่งข้อมูล JSON"}
        }), 400

    tax_id  = str(data.get("tax_id",  "")).strip().replace("-", "")
    channel = str(data.get("channel", "")).strip().lower()

    # Validate
    if not tax_id or not tax_id.isdigit() or len(tax_id) != 13:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_TAX_ID",
                      "message": "เลขผู้เสียภาษีไม่ถูกต้อง"}
        }), 400

    if channel != "email":
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_CHANNEL",
                      "message": "channel ต้องเป็น email เท่านั้น"}
        }), 400

    # ตรวจ rate limit
    if not check_rate_limit(tax_id):
        return jsonify({
            "success": False,
            "error": {
                "code":    "RATE_LIMIT",
                "message": (
                    f"ขอ OTP ได้สูงสุด "
                    f"{Config.OTP_RATE_LIMIT_PER_MIN} ครั้งต่อนาที"
                )
            }
        }), 429

    # ดึงข้อมูลติดต่อ
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT operator_name, email
                FROM   taxpayer_master
                WHERE  tax_id = %s
                ORDER BY fiscal_year DESC
                LIMIT 1
            """, (tax_id,))
            taxpayer = cur.fetchone()

    if not taxpayer:
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND",
                      "message": "ไม่พบข้อมูลในระบบ"}
        }), 404

    email = taxpayer.get("email") or ""

    if not email:
        return jsonify({
            "success": False,
            "error": {"code": "NO_EMAIL",
                      "message": "ไม่มีอีเมลในระบบ กรุณาติดต่อเจ้าหน้าที่"}
        }), 400

    # สร้าง OTP และเก็บใน Redis
    otp     = generate_otp()
    otp_key = f"otp:{tax_id}"
    redis_client.setex(otp_key, Config.OTP_EXPIRE_SECONDS, otp)
    redis_client.setex(
        f"otp_attempts:{tax_id}", Config.OTP_EXPIRE_SECONDS, 0
    )

    # ส่ง OTP ทาง Email
    sent = send_email(
        email, otp,
        operator_name=taxpayer.get("operator_name", "")
    )
    if not sent:
        return jsonify({
            "success": False,
            "error": {"code": "EMAIL_ERROR",
                      "message": "ส่งอีเมลไม่สำเร็จ กรุณาลองใหม่"}
        }), 500
    message = f"ส่งรหัส OTP ไปยังอีเมล {mask_email(email)} แล้ว"

    return jsonify({
        "success": True,
        "data": {
            "message":    message,
            "channel":    channel,
            "expires_in": Config.OTP_EXPIRE_SECONDS
        }
    }), 200


# ════════════════════════════════════════════════════════
# ขั้นที่ 3: ตรวจ OTP → ได้ Token
# ════════════════════════════════════════════════════════

@auth_bp.route("/verify-otp", methods=["POST"])
def verify_otp():
    """
    ตรวจสอบ OTP และออก JWT Token

    Request:
        POST /api/auth/verify-otp
        {
            "tax_id": "0123456789012",
            "otp":    "123456"
        }

    Response:
        {
            "success": true,
            "data": {
                "token": "eyJ...",
                "operator": {
                    "tax_id":        "0123456789012",
                    "operator_name": "บริษัท ABC จำกัด",
                    "ref_no":        "BK6800001",
                    "fiscal_year":   2568,
                    "period_start":  "01/01/2568",
                    "period_end":    "31/12/2568",
                    "due_date":      "31/05/2569"
                }
            }
        }
    """
    data = request.get_json()
    if not data:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_REQUEST",
                      "message": "กรุณาส่งข้อมูล JSON"}
        }), 400

    tax_id    = str(data.get("tax_id", "")).strip().replace("-", "")
    otp_input = str(data.get("otp",    "")).strip()

    if not tax_id or not otp_input:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FIELDS",
                      "message": "กรุณากรอกเลขภาษีและรหัส OTP"}
        }), 400

    # ดึง OTP จาก Redis
    otp_key    = f"otp:{tax_id}"
    stored_otp = redis_client.get(otp_key)

    if not stored_otp:
        return jsonify({
            "success": False,
            "error": {
                "code":    "OTP_EXPIRED",
                "message": "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่"
            }
        }), 400

    # ตรวจจำนวนครั้งที่กรอกผิด
    attempts_key = f"otp_attempts:{tax_id}"
    attempts     = int(redis_client.get(attempts_key) or 0)

    if attempts >= Config.OTP_MAX_ATTEMPTS:
        redis_client.delete(otp_key)
        redis_client.delete(attempts_key)
        return jsonify({
            "success": False,
            "error": {
                "code":    "OTP_MAX_ATTEMPTS",
                "message": (
                    f"กรอกรหัสผิดเกิน {Config.OTP_MAX_ATTEMPTS} ครั้ง "
                    f"กรุณาขอรหัสใหม่"
                )
            }
        }), 400

    # เปรียบเทียบ OTP
    if otp_input != stored_otp:
        redis_client.incr(attempts_key)
        remaining = Config.OTP_MAX_ATTEMPTS - attempts - 1
        return jsonify({
            "success": False,
            "error": {
                "code":    "OTP_INVALID",
                "message": f"รหัส OTP ไม่ถูกต้อง เหลืออีก {remaining} ครั้ง"
            }
        }), 400

    # OTP ถูกต้อง → ลบออก (ใช้ได้ครั้งเดียว)
    redis_client.delete(otp_key)
    redis_client.delete(attempts_key)

    # ดึงข้อมูลผู้ประกอบการ (ปีล่าสุดอัตโนมัติ)
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT
                    tax_id, operator_name, fiscal_year,
                    ref_no, period_start, period_end, due_date
                FROM taxpayer_master
                WHERE tax_id = %s
                ORDER BY fiscal_year DESC
                LIMIT 1
            """, (tax_id,))
            taxpayer = cur.fetchone()

    if not taxpayer:
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND",
                      "message": "ไม่พบข้อมูลผู้ประกอบการ"}
        }), 404

    # แปลงวันที่เป็นรูปแบบไทย DD/MM/YYYY (พ.ศ.)
    def to_thai_date(val):
        if not val:
            return ""
        try:
            s = str(val)
            parts = s.split("-")
            y_ce = int(parts[0])
            m    = int(parts[1])
            d    = int(parts[2][:2])
            return f"{d:02d}/{m:02d}/{y_ce + 543}"
        except Exception:
            return str(val)

    # ออก JWT Token (อายุ 2 ชั่วโมง)
    token = create_access_token(
        identity=taxpayer["tax_id"],
        additional_claims={
            "role":          "operator",
            "operator_name": taxpayer["operator_name"]
        },
        expires_delta=timedelta(hours=2)
    )

    return jsonify({
        "success": True,
        "data": {
            "token": token,
            "operator": {
                "tax_id":        taxpayer["tax_id"],
                "operator_name": taxpayer["operator_name"],
                "fiscal_year":   taxpayer["fiscal_year"],
                "ref_no":        taxpayer["ref_no"] or "",
                "period_start":  to_thai_date(taxpayer["period_start"]),
                "period_end":    to_thai_date(taxpayer["period_end"]),
                "due_date":      to_thai_date(taxpayer["due_date"]),
            }
        }
    }), 200


# ════════════════════════════════════════════════════════
# เจ้าหน้าที่: Login
# ════════════════════════════════════════════════════════

@auth_bp.route("/admin/login", methods=["POST"])
def admin_login():
    """
    Login เจ้าหน้าที่ กสทช.

    Request:
        POST /api/auth/admin/login
        { "email": "admin@nbtc.go.th", "password": "..." }

    Response:
        { "token": "eyJ...", "admin": { "email": "...", "full_name": "..." } }
    """
    data = request.get_json()
    if not data:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_REQUEST",
                      "message": "กรุณาส่งข้อมูล JSON"}
        }), 400

    email    = str(data.get("email",    "")).strip().lower()
    password = str(data.get("password", ""))

    if not email or not password:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FIELDS",
                      "message": "กรุณากรอก Email และรหัสผ่าน"}
        }), 400

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, email, password_hash, full_name, is_active
                FROM   admin_users
                WHERE  email = %s
                LIMIT 1
            """, (email,))
            admin = cur.fetchone()

    # ตอบ error เหมือนกันทั้งกรณี email/password ผิด
    # ป้องกันการ probe ว่า email ไหนมีในระบบ
    if not admin or not admin["is_active"]:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_CREDENTIALS",
                      "message": "อีเมลหรือรหัสผ่านไม่ถูกต้อง"}
        }), 401

    if not bcrypt.checkpw(
        password.encode("utf-8"),
        admin["password_hash"].encode("utf-8")
    ):
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_CREDENTIALS",
                      "message": "อีเมลหรือรหัสผ่านไม่ถูกต้อง"}
        }), 401

    # อัปเดตเวลา login ล่าสุด
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "UPDATE admin_users SET last_login_at = NOW() WHERE id = %s",
                (admin["id"],)
            )
        db.commit()

    # ออก JWT Token (อายุ 8 ชั่วโมง)
    token = create_access_token(
        identity=admin["email"],
        additional_claims={
            "role":      "admin",
            "full_name": admin["full_name"]
        },
        expires_delta=timedelta(hours=8)
    )

    return jsonify({
        "success": True,
        "data": {
            "token": token,
            "admin": {
                "email":     admin["email"],
                "full_name": admin["full_name"]
            }
        }
    }), 200