# ════════════════════════════════════════════════════════
# auth.py — ระบบยืนยันตัวตน
#
# มี 2 ส่วนหลัก:
# 1. OTP สำหรับผู้ประกอบการ (เบอร์โทร → SMS → กรอก OTP)
# 2. JWT สำหรับเจ้าหน้าที่ (Email + Password)
# ════════════════════════════════════════════════════════

import os
import random
import string
from datetime import timedelta

import bcrypt
import redis
from flask import Blueprint, jsonify, request
from flask_jwt_extended import create_access_token

from .config import Config
from .db import get_db

# Blueprint คือกลุ่ม routes ที่แยกไฟล์
# url_prefix="/api/auth" ตั้งใน __init__.py ตอนลงทะเบียน
auth_bp = Blueprint("auth", __name__)

# เชื่อม Redis สำหรับเก็บ OTP
# decode_responses=True ทำให้ได้ string กลับมาแทน bytes
redis_client = redis.from_url(Config.REDIS_URL, decode_responses=True)
# redis_client = redis.from_url("redis://redis:6379/0", decode_responses=True)


# ════════════════════════════════════════════════════════
# ฟังก์ชันช่วยเหลือ (Helper Functions)
# ════════════════════════════════════════════════════════

def generate_otp(length=6):
    """
    สร้างรหัส OTP ตัวเลขสุ่ม 6 หลัก
    ตัวอย่าง: "482916"
    """
    # random.choices สุ่มตัวเลข 0-9 จำนวน length ตัว แล้วต่อเป็น string
    return "".join(random.choices(string.digits, k=length))


def send_otp_sms(phone, otp):
    """
    ส่ง OTP ทาง SMS
    ตอนนี้ใช้ mock mode (พิมพ์ลง console แทนส่งจริง)
    พอได้ SMS Provider จริง เพิ่ม elif SMS_MODE == "live" ได้เลย
    """
    #     # mock: แสดง OTP ใน terminal แทนส่ง SMS
    #     # ตอน dev ดู OTP ได้จาก: docker logs ebcs-api
    if Config.SMS_MODE == "mock":
        # เพิ่ม flush=True เพื่อบังคับให้ print ออกมาทันที
        print(f"[OTP MOCK] เบอร์: {phone} → รหัส: {otp}", flush=True)
        return True

    elif Config.SMS_MODE == "live":
        # TODO: เพิ่มโค้ดส่ง SMS จริงตรงนี้เมื่อได้ provider
        # ตัวอย่าง ThaiBulkSMS:
        # import requests
        # requests.post("https://www.thaibulksms.com/api/...", data={...})
        pass

    return True


def mask_phone(phone):
    """
    ซ่อนเบอร์โทรบางส่วนก่อนแสดงผล
    เช่น "0812345678" → "081-xxx-5678"
    ป้องกันคนอื่นเห็นเบอร์เต็มบนหน้าจอ
    """
    if len(phone) != 10:
        return phone
    return f"{phone[:3]}-xxx-{phone[6:]}"


def check_rate_limit(phone):
    """
    ตรวจว่าขอ OTP บ่อยเกินไปไหม
    จำกัด OTP_RATE_LIMIT_PER_MIN ครั้งต่อนาที (ค่า default = 3)
    ป้องกัน spam SMS ที่เสียค่าใช้จ่าย
    """
    # key ใน Redis สำหรับนับจำนวนครั้ง
    rate_key = f"rate:{phone}"

    # ดึงจำนวนครั้งที่ขอแล้ว
    count = redis_client.get(rate_key)

    if count and int(count) >= Config.OTP_RATE_LIMIT_PER_MIN:
        # เกินจำนวนที่อนุญาต
        return False

    # เพิ่มตัวนับ และตั้ง expire 60 วินาที
    pipe = redis_client.pipeline()
    pipe.incr(rate_key)          # เพิ่มค่าขึ้น 1
    pipe.expire(rate_key, 60)    # หมดอายุใน 60 วินาที
    pipe.execute()

    return True


# ════════════════════════════════════════════════════════
# Routes: ผู้ประกอบการ (OTP)
# ════════════════════════════════════════════════════════

@auth_bp.route("/request-otp", methods=["POST"])
def request_otp():
    """
    ขั้นตอนที่ 1: ผู้ประกอบการขอ OTP
    
    Request:  POST /api/auth/request-otp
              Body: { "phone": "0812345678" }
    
    Response: { "success": true, "data": { "message": "...", "expires_in": 300 } }
    """

    # ── รับข้อมูลจาก request ──────────────────────────
    data = request.get_json()

    # ตรวจว่าส่ง JSON มาไหม
    if not data:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_REQUEST", "message": "กรุณาส่งข้อมูล JSON"}
        }), 400

    phone = data.get("phone", "").strip()

    # ── Validate เบอร์โทร ─────────────────────────────
    # ต้องเป็นตัวเลขล้วน 10 หลัก
    if not phone or not phone.isdigit() or len(phone) != 10:
        return jsonify({
            "success": False,
            "error": {
                "code": "INVALID_PHONE",
                "message": "เบอร์โทรต้องเป็นตัวเลข 10 หลัก"
            }
        }), 400

    # ── ตรวจ Rate Limit ───────────────────────────────
    if not check_rate_limit(phone):
        return jsonify({
            "success": False,
            "error": {
                "code": "RATE_LIMIT",
                "message": f"ขอ OTP ได้สูงสุด {Config.OTP_RATE_LIMIT_PER_MIN} ครั้งต่อนาที กรุณารอสักครู่"
            }
        }), 429

    # ── ค้นหาเบอร์ใน Database ────────────────────────
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "SELECT tax_id, operator_name FROM taxpayer_master WHERE phone = %s LIMIT 1",
                (phone,)
            )
            taxpayer = cur.fetchone()

    # ถ้าไม่พบเบอร์นี้ในระบบ
    if not taxpayer:
        return jsonify({
            "success": False,
            "error": {
                "code": "PHONE_NOT_FOUND",
                "message": "ไม่พบเบอร์นี้ในระบบ กรุณาติดต่อเจ้าหน้าที่ กสทช. โทร 02-271-7600"
            }
        }), 404

    # ── สร้าง OTP และเก็บใน Redis ────────────────────
    otp = generate_otp()

    # key รูปแบบ: "otp:0812345678"
    otp_key = f"otp:{phone}"

    # เก็บ OTP ใน Redis ตั้ง expire ตาม config (300 วินาที = 5 นาที)
    redis_client.setex(otp_key, Config.OTP_EXPIRE_SECONDS, otp)

    # เก็บตัวนับความผิดพลาด (เริ่มต้นที่ 0)
    redis_client.setex(f"otp_attempts:{phone}", Config.OTP_EXPIRE_SECONDS, 0)

    # ── ส่ง OTP ทาง SMS ──────────────────────────────
    send_otp_sms(phone, otp)

    return jsonify({
        "success": True,
        "data": {
            "message": f"ส่งรหัส OTP ไปยังเบอร์ {mask_phone(phone)} แล้ว",
            "expires_in": Config.OTP_EXPIRE_SECONDS
        }
    }), 200


@auth_bp.route("/verify-otp", methods=["POST"])
def verify_otp():
    """
    ขั้นตอนที่ 2: ตรวจสอบ OTP ที่ผู้ประกอบการกรอก
    
    Request:  POST /api/auth/verify-otp
              Body: { "phone": "0812345678", "otp": "482916" }
    
    Response: { "success": true, "data": { "token": "eyJ...", "operator": {...} } }
    """

    data = request.get_json()
    if not data:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_REQUEST", "message": "กรุณาส่งข้อมูล JSON"}
        }), 400

    phone = data.get("phone", "").strip()
    otp_input = data.get("otp", "").strip()

    # ── Validate input ────────────────────────────────
    if not phone or not otp_input:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FIELDS", "message": "กรุณากรอกเบอร์โทรและรหัส OTP"}
        }), 400

    # ── ดึง OTP จาก Redis ────────────────────────────
    otp_key = f"otp:{phone}"
    stored_otp = redis_client.get(otp_key)

    # OTP หมดอายุหรือไม่เคยขอ
    if not stored_otp:
        return jsonify({
            "success": False,
            "error": {
                "code": "OTP_EXPIRED",
                "message": "รหัส OTP หมดอายุแล้ว กรุณาขอรหัสใหม่"
            }
        }), 400

    # ── ตรวจจำนวนครั้งที่กรอกผิด ─────────────────────
    attempts_key = f"otp_attempts:{phone}"
    attempts = int(redis_client.get(attempts_key) or 0)

    if attempts >= Config.OTP_MAX_ATTEMPTS:
        # กรอกผิดครบจำนวนที่กำหนด ลบ OTP ทิ้ง ต้องขอใหม่
        redis_client.delete(otp_key)
        redis_client.delete(attempts_key)
        return jsonify({
            "success": False,
            "error": {
                "code": "OTP_MAX_ATTEMPTS",
                "message": f"กรอกรหัสผิดเกิน {Config.OTP_MAX_ATTEMPTS} ครั้ง กรุณาขอรหัสใหม่"
            }
        }), 400

    # ── เปรียบเทียบ OTP ───────────────────────────────
    if otp_input != stored_otp:
        # กรอกผิด เพิ่มตัวนับ
        redis_client.incr(attempts_key)
        remaining = Config.OTP_MAX_ATTEMPTS - attempts - 1

        return jsonify({
            "success": False,
            "error": {
                "code": "OTP_INVALID",
                "message": f"รหัส OTP ไม่ถูกต้อง เหลืออีก {remaining} ครั้ง"
            }
        }), 400

    # ── OTP ถูกต้อง ───────────────────────────────────
    # ลบ OTP ออกจาก Redis ทันที (ใช้ได้ครั้งเดียว)
    redis_client.delete(otp_key)
    redis_client.delete(attempts_key)

    # ── ดึงข้อมูลผู้ประกอบการ ─────────────────────────
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT tax_id, operator_name, fiscal_year,
                       ref_no, period_start, period_end, due_date
                FROM   taxpayer_master
                WHERE  phone = %s
                ORDER BY fiscal_year DESC
                LIMIT 1
            """, (phone,))
            taxpayer = cur.fetchone()

    if not taxpayer:
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "ไม่พบข้อมูลผู้ประกอบการ"}
        }), 404

    # ── สร้าง JWT Token ───────────────────────────────
    # identity คือข้อมูลที่เก็บไว้ใน token
    # Flask จะถอดรหัสให้เองทุกครั้งที่มี request เข้ามา
    token = create_access_token(
        identity=taxpayer["tax_id"],
        additional_claims={
            "role": "operator",           # บอกว่าเป็นผู้ประกอบการ
            "operator_name": taxpayer["operator_name"]
        },
        expires_delta=timedelta(hours=2)  # token อายุ 2 ชั่วโมง
    )

    return jsonify({
        "success": True,
        "data": {
            "token": token,
            "operator": {
                "tax_id":        taxpayer["tax_id"],
                "operator_name": taxpayer["operator_name"],
                "fiscal_year":   taxpayer["fiscal_year"],
                "ref_no":        taxpayer["ref_no"],
                "period_start":  str(taxpayer["period_start"]) if taxpayer["period_start"] else None,
                "period_end":    str(taxpayer["period_end"]) if taxpayer["period_end"] else None,
                "due_date":      str(taxpayer["due_date"]) if taxpayer["due_date"] else None,
            }
        }
    }), 200


# ════════════════════════════════════════════════════════
# Routes: เจ้าหน้าที่ (JWT)
# ════════════════════════════════════════════════════════

@auth_bp.route("/admin/login", methods=["POST"])
def admin_login():
    """
    Login เจ้าหน้าที่ กสทช.
    
    Request:  POST /api/auth/admin/login
              Body: { "email": "admin@nbtc.go.th", "password": "ChangeMe123!" }
    
    Response: { "success": true, "data": { "token": "eyJ...", "admin": {...} } }
    """

    data = request.get_json()
    if not data:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_REQUEST", "message": "กรุณาส่งข้อมูล JSON"}
        }), 400

    email    = data.get("email", "").strip().lower()
    password = data.get("password", "")

    if not email or not password:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FIELDS", "message": "กรุณากรอก Email และรหัสผ่าน"}
        }), 400

    # ── ค้นหา Admin ใน Database ──────────────────────
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, email, password_hash, full_name, is_active
                FROM   admin_users
                WHERE  email = %s
                LIMIT 1
            """, (email,))
            admin = cur.fetchone()

    # ── ตรวจสอบ Email + Password ──────────────────────
    # สำคัญ: ตอบ error เหมือนกันทั้งกรณี email ผิดและ password ผิด
    # ป้องกันการ "ดักรู้" ว่า email ไหนมีในระบบ
    if not admin or not admin["is_active"]:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_CREDENTIALS", "message": "อีเมลหรือรหัสผ่านไม่ถูกต้อง"}
        }), 401

    # bcrypt.checkpw เปรียบเทียบ password กับ hash ที่เก็บไว้
    # hash ย้อนกลับเป็นรหัสจริงไม่ได้ ต้องตรวจแบบนี้เท่านั้น
    password_match = bcrypt.checkpw(
        password.encode("utf-8"),
        admin["password_hash"].encode("utf-8")
    )

    if not password_match:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_CREDENTIALS", "message": "อีเมลหรือรหัสผ่านไม่ถูกต้อง"}
        }), 401

    # ── อัปเดตเวลา Login ล่าสุด ──────────────────────
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "UPDATE admin_users SET last_login_at = NOW() WHERE id = %s",
                (admin["id"],)
            )
        db.commit()

    # ── สร้าง JWT Token ───────────────────────────────
    token = create_access_token(
        identity=admin["email"],
        additional_claims={
            "role": "admin",              # บอกว่าเป็น admin
            "full_name": admin["full_name"]
        },
        expires_delta=timedelta(hours=8)  # admin token อายุ 8 ชั่วโมง
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