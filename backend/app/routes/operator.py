# ════════════════════════════════════════════════════════
# routes/operator.py — API สำหรับผู้ประกอบการ
#
# ทุก endpoint ในไฟล์นี้:
# 1. ต้องมี JWT token (ได้จากการ verify OTP)
# 2. ดึง tax_id จาก token อัตโนมัติ (ปลอมเป็นคนอื่นไม่ได้)
# 3. ตอบ JSON format เดียวกันทุกตัว: { success, data } หรือ { success, error }
# ════════════════════════════════════════════════════════

import os
import uuid

from flask import Blueprint, jsonify, request, send_file, current_app
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from datetime import datetime, date
from functools import wraps

from ..db import get_db
from ..services.integration_service import send_to_datacenter, send_to_sap
from ..services.import_service import _get_next_ref_no
from .admin import save_audit_log, now_bangkok

operator_bp = Blueprint("operator", __name__)


def _shift_date_by_years(d, delta_years):
    """เลื่อนวันที่ไปข้างหน้า/หลัง N ปี รักษาเดือน/วันเดิม (กัน 29 ก.พ. ปีที่ไม่ใช่อธิกสุรทิน)"""
    if d is None or not delta_years:
        return d
    try:
        return d.replace(year=d.year + delta_years)
    except ValueError:
        # 29 ก.พ. ในปีที่เลื่อนไปไม่ใช่ปีอธิกสุรทิน → ใช้ 28 ก.พ. แทน
        return d.replace(year=d.year + delta_years, day=28)


def _get_or_create_taxpayer_year(cur, tax_id, year):
    """
    ดึงแถว taxpayer_master ของปีที่ขอ ถ้าไม่มี → สร้างให้อัตโนมัติโดยเลื่อน
    รอบบัญชี/วันครบกำหนดของแถวปีล่าสุดที่มีอยู่ไปเป็นปีที่ขอ (คง sub_type/
    round_type เดิม, เลขอ้างอิงเจนใหม่) แทนที่จะต้องรอแอดมินเพิ่มมือทุกปี
    คืน (taxpayer_row, was_created: bool) หรือ (None, False) ถ้าไม่เคยมีข้อมูลบริษัทนี้เลย
    """
    cur.execute("""
        SELECT tax_id, operator_name, fiscal_year,
               ref_no, period_start, period_end, due_date
        FROM   taxpayer_master
        WHERE  tax_id = %s AND fiscal_year = %s
        LIMIT 1
    """, (tax_id, year))
    taxpayer = cur.fetchone()
    if taxpayer:
        return taxpayer, False

    cur.execute("""
        SELECT operator_name, fiscal_year, period_start, period_end, due_date,
               sub_type, round_type
        FROM   taxpayer_master
        WHERE  tax_id = %s
        ORDER  BY fiscal_year DESC LIMIT 1
    """, (tax_id,))
    latest = cur.fetchone()
    if not latest:
        return None, False

    delta = year - latest["fiscal_year"]
    new_period_start = _shift_date_by_years(latest["period_start"], delta)
    new_period_end   = _shift_date_by_years(latest["period_end"], delta)
    new_due_date     = _shift_date_by_years(latest["due_date"], delta)
    ref_no = _get_next_ref_no(cur, year)

    cur.execute("""
        INSERT INTO taxpayer_master
            (tax_id, operator_name, fiscal_year, ref_no,
             period_start, period_end, due_date, sub_type, round_type)
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s)
    """, (
        tax_id, latest["operator_name"], year, ref_no,
        new_period_start, new_period_end, new_due_date,
        latest["sub_type"], latest["round_type"],
    ))

    cur.execute("""
        SELECT tax_id, operator_name, fiscal_year,
               ref_no, period_start, period_end, due_date
        FROM   taxpayer_master
        WHERE  tax_id = %s AND fiscal_year = %s
        LIMIT 1
    """, (tax_id, year))
    return cur.fetchone(), True


# ════════════════════════════════════════════════════════
# Helper Functions
# ════════════════════════════════════════════════════════

def new_uuid():
    """สร้าง UUID สำหรับ primary key (MySQL ไม่มี RETURNING ต้อง gen เองใน Python)"""
    return str(uuid.uuid4())


def date_to_str(d):
    """แปลง date/datetime → "YYYY-MM-DD" string (JSON safe)"""
    if d is None:
        return None
    if isinstance(d, (date, datetime)):
        return d.strftime("%Y-%m-%d")
    return str(d)


def require_operator(f):
    """Decorator ตรวจสอบว่าเป็น token ของผู้ประกอบการ (role = operator)"""
    @wraps(f)
    def decorated(*args, **kwargs):
        claims = get_jwt()
        if claims.get("role") != "operator":
            return jsonify({
                "success": False,
                "error": {"code": "FORBIDDEN", "message": "ไม่มีสิทธิ์เข้าถึง"}
            }), 403
        return f(*args, **kwargs)
    return decorated


# ════════════════════════════════════════════════════════
# [FIX] Progressive Rate Fund Calculation
# ────────────────────────────────────────────────────────
# เดิม: flat 2% — ผิด ไม่ตรงกับ calc.js ฝั่ง frontend
# แก้:  progressive 7 ขั้นบันได เหมือนกัน RATE_TABLE ใน calc.js
# ════════════════════════════════════════════════════════

RATE_TABLE = [
    (100_000_000,    0.00125),
    (500_000_000,    0.0025),
    (1_000_000_000,  0.005),
    (10_000_000_000, 0.0075),
    (25_000_000_000, 0.01),
    (50_000_000_000, 0.0125),
    (float("inf"),   0.02),
]

VAT_RATE     = 0.07
PENALTY_RATE = 0.015  # 1.5% ต่อเดือน


def calc_progressive_fund(income: float) -> float:
    """คำนวณเงินนำส่งกองทุนแบบขั้นบันได (ตรงกับ calc.js)"""
    if not income or income <= 0:
        return 0.0
    fund = 0.0
    prev = 0.0
    for up_to, rate in RATE_TABLE:
        if income <= prev:
            break
        taxable = min(income, up_to) - prev
        fund   += taxable * rate
        prev    = up_to
        if income <= up_to:
            break
    return round(fund, 2)


def calculate_fund(total_income: float, deduction_amount: float, due_date) -> dict:
    """
    คำนวณเงินที่ต้องนำส่งกองทุน (progressive rate — ตรงกับ calc.js)

    สูตร:
      net_income   = total_income - deduction_amount
      fund_amount  = progressive rate ตาม RATE_TABLE
      vat_amount   = fund_amount × 7%
      extra_amount = fund_amount × 1.5% × จำนวนเดือนที่ล่าช้า (ถ้ามี)
      net_amount   = fund + vat + extra
    """
    net_income = max(0.0, total_income - deduction_amount)
    fund_amount = calc_progressive_fund(net_income)
    vat_amount  = round(fund_amount * VAT_RATE, 2)

    # เงินเพิ่มกรณีชำระล่าช้า
    extra_amount = 0.0
    if due_date and fund_amount > 0:
        today = date.today()
        if isinstance(due_date, str):
            due_date = datetime.strptime(due_date, "%Y-%m-%d").date()
        elif isinstance(due_date, datetime):
            due_date = due_date.date()
        if today > due_date:
            diff_days   = (today - due_date).days
            months_late = -(-diff_days // 30)  # ceil division
            extra_amount = round(fund_amount * PENALTY_RATE * months_late, 2)

    net_amount = round(fund_amount + vat_amount + extra_amount, 2)

    return {
        "total_income":     round(total_income, 2),
        "deduction_amount": round(deduction_amount, 2),
        "net_income":       round(net_income, 2),
        "fund_amount":      fund_amount,
        "vat_amount":       vat_amount,
        "extra_amount":     extra_amount,
        "net_amount":       net_amount,
    }


# ════════════════════════════════════════════════════════
# 4.1 Auto-fill ข้อมูลบริษัท
# GET /api/operator/autofill?year=2568
# ════════════════════════════════════════════════════════

@operator_bp.route("/autofill", methods=["GET"])
@jwt_required()
@require_operator
def autofill():
    """
    ดึงข้อมูลบริษัทหลัง login สำเร็จ
    tax_id ดึงจาก JWT — ไม่รับจาก query param (ปลอมไม่ได้)

    [FIX] Response: { success, data: { ...fields } }
          Frontend อ่านได้ถูกต้องที่ info.data.xxx
    """
    tax_id = get_jwt_identity()
    year   = request.args.get("year", type=int)

    with get_db() as db:
        with db.cursor() as cur:

            # ถ้าไม่ระบุปี → ดึงปีที่ยังไม่จ่ายเงินปีแรกสุด (ปีที่ต้องยื่นตอนนี้)
            # [FIX] เดิมดึง "ปีล่าสุดที่มีแถวอยู่" ตรงๆ ซึ่งวิ่งไปเรื่อยๆ ทุกครั้งที่มี
            # การเข้าปีถัดไป (เช่นตอนทดสอบ) เพราะแถวปีถัดไปถูกสร้างอัตโนมัติค้างไว้
            # ทำให้ "ปีล่าสุด" เพี้ยนไปไกลกว่าปีที่ต้องยื่นจริง — เปลี่ยนมาดึงปีแรกสุด
            # ที่ยังไม่มี submission สถานะ paid แทน (ถ้าทุกปีจ่ายครบแล้วค่อยขยับไปปีถัดจากปีล่าสุด)
            if not year:
                cur.execute("""
                    SELECT tm.fiscal_year FROM taxpayer_master tm
                    WHERE  tm.tax_id = %s
                      AND  NOT EXISTS (
                          SELECT 1 FROM submissions s
                          WHERE s.tax_id = tm.tax_id AND s.fiscal_year = tm.fiscal_year AND s.status = 'paid'
                      )
                    ORDER  BY tm.fiscal_year ASC LIMIT 1
                """, (tax_id,))
                row = cur.fetchone()
                if row:
                    year = row["fiscal_year"]
                else:
                    cur.execute("""
                        SELECT fiscal_year FROM taxpayer_master
                        WHERE  tax_id = %s
                        ORDER  BY fiscal_year DESC LIMIT 1
                    """, (tax_id,))
                    row = cur.fetchone()
                    if row:
                        year = row["fiscal_year"] + 1
                    else:
                        return jsonify({
                            "success": False,
                            "error": {"code": "NOT_FOUND", "message": "ไม่พบข้อมูลผู้ประกอบการในระบบ"}
                        }), 404

            # ดึงข้อมูล taxpayer — ถ้ายังไม่มีแถวของปีนี้ ลองสร้างอัตโนมัติจาก
            # รอบบัญชีปีล่าสุดที่มีอยู่ (เลื่อนวันที่ไปเป็นปีที่ขอ) แทนการรอแอดมินเพิ่มมือ
            taxpayer, was_created = _get_or_create_taxpayer_year(cur, tax_id, year)

            if not taxpayer:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND", "message": f"ไม่พบข้อมูลผู้ประกอบการสำหรับปี {year}"}
                }), 404

            # เช็คว่าเคยยื่นปีนี้ไหม
            cur.execute("""
                SELECT id, status, submitted_at
                FROM   submissions
                WHERE  tax_id = %s AND fiscal_year = %s
                LIMIT 1
            """, (tax_id, year))
            existing = cur.fetchone()

        if was_created:
            save_audit_log(
                db, "ระบบ (สร้างอัตโนมัติ)",
                f"สร้างรอบบัญชีปี {year} อัตโนมัติจากปีล่าสุด",
                "taxpayer_master", None,
                {"tax_id": tax_id, "fiscal_year": year},
                record_label=taxpayer.get("operator_name")
            )
            db.commit()

    return jsonify({
        "success": True,
        "data": {
            "tax_id":        taxpayer["tax_id"],
            "operator_name": taxpayer["operator_name"],
            "fiscal_year":   taxpayer["fiscal_year"],
            "ref_no":        taxpayer["ref_no"],
            "period_start":  date_to_str(taxpayer["period_start"]),
            "period_end":    date_to_str(taxpayer["period_end"]),
            "due_date":      date_to_str(taxpayer["due_date"]),
            "existing_submission": {
                "id":           existing["id"],
                "status":       existing["status"],
                "submitted_at": date_to_str(existing["submitted_at"])
            } if existing else None
        }
    }), 200


# ════════════════════════════════════════════════════════
# 4.2 ดึงรายการใบอนุญาต
# GET /api/operator/licenses?year=2568
# ════════════════════════════════════════════════════════

@operator_bp.route("/licenses", methods=["GET"])
@jwt_required()
@require_operator
def get_licenses():
    """
    ดึงใบอนุญาตทั้งหมดของบริษัท (ทุกสถานะ)
    tax_id ดึงจาก JWT เสมอ — ไม่ใช้ tax_id จาก query (ปลอมไม่ได้)

    [FIX] Response: { success, data: { licenses: [...], total: n } }
    """
    tax_id = get_jwt_identity()
    year   = request.args.get("year", type=int)

    status_labels = {
        "active":    "ได้รับอนุญาต",
        "ended":     "สิ้นสุดระยะเวลาอนุญาต",
        "cancelled": "ยกเลิกประกอบกิจการ",
        "revoked":   "เพิกถอนใบอนุญาต",
    }

    # [FIX] licensee_master.fiscal_year บันทึกแค่ "ปีของไฟล์ import ล่าสุดที่แก้แถวนี้"
    # ไม่ใช่ "ใบอนุญาตนี้ใช้ได้เฉพาะปีนี้" กรองด้วยมันทำให้ใบอนุญาตที่มีจริงหายไป (เคย
    # แก้ไปแล้วให้ไม่กรองเลย) แต่นั่นทำให้ใบอนุญาตที่ยังไม่ถึงวันเริ่ม (เช่นเริ่มปีถัดไป)
    # โผล่มาในปีที่ยื่นปัจจุบันด้วยทั้งที่ยังไม่ถึงรอบชำระ — วิธีที่ถูกต้องคือกรองด้วยช่วง
    # วันที่ใบอนุญาตจริง (start_date/end_date) เทียบกับรอบบัญชี (period_start/period_end)
    # ของปีที่กำลังยื่นจาก taxpayer_master แทนการกรองด้วย fiscal_year ที่ไม่น่าเชื่อถือ
    with get_db() as db:
        with db.cursor() as cur:
            period_start = period_end = None
            if year:
                cur.execute("""
                    SELECT period_start, period_end FROM taxpayer_master
                    WHERE tax_id = %s AND fiscal_year = %s LIMIT 1
                """, (tax_id, year))
                taxpayer_period = cur.fetchone()
                if taxpayer_period:
                    period_start = taxpayer_period["period_start"]
                    period_end   = taxpayer_period["period_end"]

            if period_start and period_end:
                cur.execute("""
                    SELECT id, license_no,
                           licensee_type AS license_type,
                           license_status,
                           start_date AS license_start,
                           end_date   AS license_end
                    FROM   licensee_master
                    WHERE  tax_id = %s
                      AND  start_date <= %s
                      AND  (end_date IS NULL OR end_date >= %s)
                    ORDER  BY license_status, license_no
                """, (tax_id, period_end, period_start))
            else:
                # ไม่รู้รอบบัญชีของปีนี้ (ยังไม่มีแถว taxpayer_master ตรงปี หรือไม่ได้ส่ง year มา)
                # แสดงใบอนุญาตทั้งหมดไปก่อน ดีกว่าซ่อนของจริงโดยไม่มีเกณฑ์ที่เชื่อถือได้
                cur.execute("""
                    SELECT id, license_no,
                           licensee_type AS license_type,
                           license_status,
                           start_date AS license_start,
                           end_date   AS license_end
                    FROM   licensee_master
                    WHERE  tax_id = %s
                    ORDER  BY license_status, license_no
                """, (tax_id,))
            licenses = cur.fetchall()

    result = []
    for lic in licenses:
        result.append({
            "id":            lic["id"],
            "license_no":    lic["license_no"],
            "license_type":  lic["license_type"],
            "license_status": lic["license_status"],
            "status_label":  status_labels.get(lic["license_status"], lic["license_status"]),
            "license_start": date_to_str(lic["license_start"]),
            "license_end":   date_to_str(lic["license_end"]),
        })

    return jsonify({
        "success": True,
        "data": {
            "licenses": result,
            "total":    len(result)
        }
    }), 200


# ════════════════════════════════════════════════════════
# 4.3 บันทึกใบยื่นแบบ (POST)
# POST /api/operator/submissions
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions", methods=["POST"])
@jwt_required()
@require_operator
def create_submission():
    """
    บันทึกข้อมูลใบยื่นแบบ (สร้าง draft)

    Body ที่ Frontend ส่งมา (index.js saveSubmission):
    {
        "fiscal_year":      2568,
        "total_income":     1000000,
        "deduction_amount": 200000,
        "fund_amount":      ...,      ← Frontend คำนวณมา (ใช้ verify เท่านั้น)
        "vat_amount":       ...,
        "extra_amount":     ...,
        "net_amount":       ...,
        "auditor_name":     "...",
        "auditor_license":  "...",
        "auditor_office":   "...",
        "audited_date":     "2568-...",
        "licenses": [
            {
                "license_no":  "...",
                "income":      500000,
                "deduction":   100000,
                "incomes": [{ "field_key": "f1_1", "label": "...", "amount": 100000, "is_custom": false }]
            }
        ],
        "other_incomes": [
            { "field_key": "o1", "label": "...", "amount": 50000, "is_custom": false }
        ]
    }

    [FIX] เดิม:
      - รับ auditor เป็น nested object → แก้เป็น flat fields
      - คำนวณ fund ด้วย flat 2% → แก้เป็น progressive rate
      - id ของแถวที่สร้างสร้างเองด้วย uuid.uuid4() ในฝั่ง Python
        (MySQL ไม่มี RETURNING แบบ PostgreSQL)
    """
    tax_id = get_jwt_identity()
    data   = request.get_json()

    if not data:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_REQUEST", "message": "กรุณาส่งข้อมูล JSON"}
        }), 400

    fiscal_year      = data.get("fiscal_year")
    licenses_data    = data.get("licenses", [])
    other_incomes    = data.get("other_incomes", [])
    deduction_amount = float(data.get("deduction_amount", 0))
    total_income_financial = float(data.get("total_income_financial", 0))

    # auditor เป็น flat fields (ตรงกับที่ Frontend ส่งมา)
    auditor_name    = data.get("auditor_name", "")
    auditor_license = data.get("auditor_license", "")
    auditor_office  = data.get("auditor_office", "")
    audited_date    = data.get("audited_date")

    if not fiscal_year:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FIELDS", "message": "กรุณาระบุปีบัญชี"}
        }), 400

    # ดึง snapshot taxpayer ณ วันที่ยื่น
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT operator_name, ref_no,
                       period_start, period_end, due_date
                FROM   taxpayer_master
                WHERE  tax_id = %s AND fiscal_year = %s
                LIMIT 1
            """, (tax_id, fiscal_year))
            taxpayer = cur.fetchone()

    if not taxpayer:
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "ไม่พบข้อมูลผู้ประกอบการ"}
        }), 404

    # [FIX] คำนวณรายได้รวมจาก licenses (income - deduction ต่อใบ)
    total_income = sum(
        float(lic.get("income", 0))
        for lic in licenses_data
    )

    # [FIX] คำนวณ fund ด้วย progressive rate (ตรงกับ calc.js)
    calculation = calculate_fund(
        total_income     = total_income,
        deduction_amount = deduction_amount,
        due_date         = taxpayer["due_date"]
    )

    # บันทึกลง DB แบบ Transaction
    with get_db() as db:
        with db.cursor() as cur:

            # [FIX] กันยื่นซ้ำ + กันแถว draft ซ้ำซ้อน (มีใบยื่นปีนี้ที่ยืนยันแล้ว
            # ห้ามสร้างใหม่, draft เก่าลบแล้วสร้างใหม่ได้) — เดิม select/delete
            # อยู่คนละ transaction กับ insert ด้านล่าง ทำให้ถ้ามีคำขอซ้อนกัน
            # (เช่นกดปุ่ม "บันทึกร่าง" ถี่ๆ) ทั้งสองคำขอเห็น "ไม่มี draft เดิม"
            # พร้อมกันได้ แล้วต่างคน insert แถวใหม่ กลายเป็น draft ซ้ำหลายแถว
            # ต่อปีเดียวกัน — ย้ายมาอยู่ transaction เดียวกับ insert พร้อมใช้
            # FOR UPDATE ล็อกแถวกันคำขอที่มาพร้อมกันสำหรับ tax_id+ปีเดียวกัน
            cur.execute("""
                SELECT id, status FROM submissions
                WHERE  tax_id = %s AND fiscal_year = %s LIMIT 1 FOR UPDATE
            """, (tax_id, fiscal_year))
            existing = cur.fetchone()
            if existing:
                if existing["status"] != "draft":
                    return jsonify({
                        "success": False,
                        "error": {
                            "code":    "ALREADY_SUBMITTED",
                            "message": "ยื่นแบบปีนี้ไปแล้ว ไม่สามารถยื่นซ้ำได้ กรุณาติดต่อเจ้าหน้าที่หากต้องการแก้ไข"
                        }
                    }), 400
                # [FIX] ดึงไฟล์แนบเดิมของ draft นี้มาก่อนลบแถว — จะ "ย้าย"
                # (carry-forward) ไปผูกกับแถวใหม่ที่กำลังจะสร้างด้านล่างแทนที่
                # จะปล่อยให้ CASCADE ลบ metadata ทิ้งไปเฉยๆ (ไฟล์จริงบนดิสก์ไม่
                # ต้องย้าย ใช้ path เดิมได้เลย) ผู้ใช้จะได้ไม่ต้องแนบไฟล์ใหม่
                # ทุกครั้งที่บันทึกร่างซ้ำ/ถูกตีกลับแล้วยื่นใหม่
                cur.execute("""
                    SELECT doc_type, file_name, storage_path, mime_type, file_size
                    FROM document_attachments WHERE submission_id = %s
                """, (existing["id"],))
                carried_attachments = cur.fetchall()
                cur.execute("DELETE FROM submissions WHERE id = %s", (existing["id"],))
            else:
                carried_attachments = []

            # 1. สร้างใบยื่นหลัก
            # [FIX] MySQL ไม่มี RETURNING → gen UUID เองก่อน insert
            submission_id = new_uuid()
            # [FIX] ระบุ created_at เอง (เวลาไทยจริง) แทนพึ่ง DEFAULT CURRENT_TIMESTAMP
            # ของ MySQL — เขตเวลาของ DB server ไม่ใช่ Asia/Bangkok (ดูโน้ตเดียวกัน
            # ที่ save_audit_log ใน admin.py) ทำให้ "บันทึกล่าสุด" ในตารางร่าง
            # หน้าแรกของผู้ประกอบการคลาดเคลื่อนจากเวลาที่บันทึกจริงหลายชั่วโมง
            cur.execute("""
                INSERT INTO submissions (
                    id, tax_id, ref_no, fiscal_year,
                    operator_name, period_start, period_end, due_date,
                    status, total_income, total_income_financial, deduction_amount,
                    fund_amount, vat_amount, extra_amount, net_amount,
                    auditor_name, auditor_license, auditor_office, audited_date,
                    created_at
                ) VALUES (
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    'draft', %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s
                )
            """, (
                submission_id,
                tax_id,
                taxpayer["ref_no"],
                fiscal_year,
                taxpayer["operator_name"],
                taxpayer["period_start"],
                taxpayer["period_end"],
                taxpayer["due_date"],
                total_income,
                total_income_financial,
                deduction_amount,
                calculation["fund_amount"],
                calculation["vat_amount"],
                calculation["extra_amount"],
                calculation["net_amount"],
                auditor_name,
                auditor_license,
                auditor_office,
                audited_date,
                now_bangkok(),
            ))

            # 1b. ย้ายไฟล์แนบเดิม (ถ้ามี) มาผูกกับใบยื่นแบบใหม่นี้ — ดู carried_attachments
            # ด้านบน แถวใหม่ใช้ id ใหม่ แต่ storage_path เดิม (ไฟล์จริงไม่ต้องย้าย)
            for att in carried_attachments:
                cur.execute("""
                    INSERT INTO document_attachments
                        (id, submission_id, doc_type, file_name, storage_path, mime_type, file_size)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    new_uuid(), submission_id, att["doc_type"],
                    att["file_name"], att["storage_path"], att["mime_type"], att["file_size"],
                ))

            # 2. บันทึกใบอนุญาตทีละใบ (ตาราง licenses — fee_amount = income)
            # [FIX] เก็บ snapshot ประเภท/วันที่/สถานะใบอนุญาต ณ วันที่ยื่น
            # ด้วย (เดิมไม่เก็บเลย ทำให้หน้าดูรายละเอียดไม่มีข้อมูลนี้)
            for sort_order, lic in enumerate(licenses_data):
                license_id = new_uuid()
                cur.execute("""
                    INSERT INTO licenses (
                        id, submission_id, sort_order, license_no,
                        licensee_type, license_status, station, start_date, end_date,
                        fee_amount, deduction_amount
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (
                    license_id,
                    submission_id,
                    sort_order,
                    lic.get("license_no", ""),
                    lic.get("license_type"),
                    lic.get("license_status"),
                    lic.get("station"),
                    lic.get("license_start"),
                    lic.get("license_end"),
                    float(lic.get("income", 0)),
                    float(lic.get("deduction", 0)),
                ))

                # 3. บันทึกรายได้ย่อยของใบอนุญาตนี้
                for income_item in lic.get("incomes", []):
                    cur.execute("""
                        INSERT INTO license_incomes (
                            id, license_id, field_key, label, amount, is_custom
                        ) VALUES (%s, %s, %s, %s, %s, %s)
                    """, (
                        new_uuid(),
                        license_id,
                        income_item.get("field_key", ""),
                        income_item.get("label", ""),
                        float(income_item.get("amount", 0)),
                        bool(income_item.get("is_custom", False)),
                    ))

            # 4. บันทึกรายได้อื่น (Step 2)
            for other in other_incomes:
                cur.execute("""
                    INSERT INTO other_incomes (
                        id, submission_id, field_key, label, amount, is_custom
                    ) VALUES (%s, %s, %s, %s, %s, %s)
                """, (
                    new_uuid(),
                    submission_id,
                    other.get("field_key", ""),
                    other.get("label", ""),
                    float(other.get("amount", 0)),
                    bool(other.get("is_custom", False)),
                ))

        db.commit()

    return jsonify({
        "success": True,
        "data": {
            "submission_id": submission_id,
            "status":        "draft",
            "calculation":   calculation
        }
    }), 201


# ════════════════════════════════════════════════════════
# 4.4 แก้ไขใบยื่นแบบ (PUT) — ทำได้เฉพาะ status = draft
# PUT /api/operator/submissions/<submission_id>
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions/<submission_id>", methods=["PUT"])
@jwt_required()
@require_operator
def update_submission(submission_id):
    tax_id = get_jwt_identity()
    data   = request.get_json()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, status, tax_id, due_date
                FROM   submissions WHERE id = %s LIMIT 1
            """, (submission_id,))
            submission = cur.fetchone()

    if not submission:
        return jsonify({"success": False, "error": {"code": "NOT_FOUND", "message": "ไม่พบใบยื่นแบบ"}}), 404
    if submission["tax_id"] != tax_id:
        return jsonify({"success": False, "error": {"code": "FORBIDDEN", "message": "ไม่มีสิทธิ์แก้ไขใบยื่นนี้"}}), 403
    if submission["status"] != "draft":
        return jsonify({"success": False, "error": {"code": "ALREADY_SUBMITTED", "message": "ใบยื่นนี้ยืนยันแล้ว ไม่สามารถแก้ไขได้"}}), 400

    licenses_data    = data.get("licenses", [])
    other_incomes    = data.get("other_incomes", [])
    deduction_amount = float(data.get("deduction_amount", 0))
    auditor_name     = data.get("auditor_name", "")
    auditor_license  = data.get("auditor_license", "")
    auditor_office   = data.get("auditor_office", "")
    audited_date     = data.get("audited_date")

    total_income = sum(float(lic.get("income", 0)) for lic in licenses_data)
    calculation  = calculate_fund(total_income, deduction_amount, submission["due_date"])

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                UPDATE submissions SET
                    total_income     = %s,
                    deduction_amount = %s,
                    fund_amount      = %s,
                    vat_amount       = %s,
                    extra_amount     = %s,
                    net_amount       = %s,
                    auditor_name     = %s,
                    auditor_license  = %s,
                    auditor_office   = %s,
                    audited_date     = %s
                WHERE id = %s
            """, (
                total_income, deduction_amount,
                calculation["fund_amount"], calculation["vat_amount"],
                calculation["extra_amount"], calculation["net_amount"],
                auditor_name, auditor_license, auditor_office, audited_date,
                submission_id,
            ))

            # ลบใบอนุญาตเก่า + income เก่า (CASCADE ลบ license_incomes ให้อัตโนมัติ)
            cur.execute("DELETE FROM licenses WHERE submission_id = %s", (submission_id,))
            cur.execute("DELETE FROM other_incomes WHERE submission_id = %s", (submission_id,))

            for sort_order, lic in enumerate(licenses_data):
                license_id = new_uuid()
                cur.execute("""
                    INSERT INTO licenses (
                        id, submission_id, sort_order, license_no,
                        licensee_type, license_status, station, start_date, end_date,
                        fee_amount, deduction_amount
                    ) VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                """, (license_id, submission_id, sort_order, lic.get("license_no", ""),
                      lic.get("license_type"), lic.get("license_status"), lic.get("station"),
                      lic.get("license_start"), lic.get("license_end"),
                      float(lic.get("income", 0)), float(lic.get("deduction", 0))))

                for income_item in lic.get("incomes", []):
                    cur.execute("""
                        INSERT INTO license_incomes (id, license_id, field_key, label, amount, is_custom)
                        VALUES (%s, %s, %s, %s, %s, %s)
                    """, (new_uuid(), license_id, income_item.get("field_key", ""),
                          income_item.get("label", ""), float(income_item.get("amount", 0)),
                          bool(income_item.get("is_custom", False))))

            for other in other_incomes:
                cur.execute("""
                    INSERT INTO other_incomes (id, submission_id, field_key, label, amount, is_custom)
                    VALUES (%s, %s, %s, %s, %s, %s)
                """, (new_uuid(), submission_id, other.get("field_key", ""),
                      other.get("label", ""), float(other.get("amount", 0)),
                      bool(other.get("is_custom", False))))

        db.commit()

    return jsonify({
        "success": True,
        "data": {"submission_id": submission_id, "calculation": calculation}
    }), 200


# ════════════════════════════════════════════════════════
# 4.5 ยืนยันการยื่นแบบ → draft → pending_payment
# POST /api/operator/submissions/<submission_id>/submit
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions/<submission_id>/submit", methods=["POST"])
@jwt_required()
@require_operator
def submit_submission(submission_id):
    tax_id = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, status, tax_id, net_amount
                FROM   submissions WHERE id = %s LIMIT 1
            """, (submission_id,))
            submission = cur.fetchone()

    if not submission:
        return jsonify({"success": False, "error": {"code": "NOT_FOUND", "message": "ไม่พบใบยื่นแบบ"}}), 404
    if submission["tax_id"] != tax_id:
        return jsonify({"success": False, "error": {"code": "FORBIDDEN", "message": "ไม่มีสิทธิ์"}}), 403
    if submission["status"] != "draft":
        return jsonify({"success": False, "error": {"code": "ALREADY_SUBMITTED", "message": "ยืนยันการยื่นแบบนี้ไปแล้ว"}}), 400

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                UPDATE submissions
                SET    status = 'pending_payment', submitted_at = NOW()
                WHERE  id = %s
            """, (submission_id,))

            # ส่งข้อมูลไป Data Center (gen QR/Barcode) และ SAP/ZAT (ตั้งหนี้รอรับชำระ)
            # ปัจจุบันเป็น mock ทั้งคู่ (ดู integration_service.py) — ไม่ block การยื่นแบบถ้าพัง
            try:
                dc_result = send_to_datacenter(cur, submission)
                sap_result = send_to_sap(cur, submission)
                cur.execute("""
                    UPDATE submissions
                    SET    datacenter_ref = %s, sap_doc_no = %s, sap_status = 'mock_sent'
                    WHERE  id = %s
                """, (dc_result["datacenter_ref"], sap_result["sap_doc_no"], submission_id))
            except Exception as e:
                current_app.logger.warning(f"[submit_submission] integration mock failed: {e}")

        db.commit()

    return jsonify({
        "success": True,
        "data": {
            "submission_id": submission_id,
            "status":        "pending_payment",
            "message":       "ยื่นแบบสำเร็จแล้ว กรุณานำใบนำฝากไปชำระเงินที่ธนาคาร"
        }
    }), 200


# ════════════════════════════════════════════════════════
# 4.6 ดูรายละเอียดใบยื่น
# GET /api/operator/submissions/<submission_id>
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions/<submission_id>", methods=["GET"])
@jwt_required()
@require_operator
def get_submission(submission_id):
    tax_id = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT * FROM submissions
                WHERE  id = %s AND tax_id = %s LIMIT 1
            """, (submission_id, tax_id))
            submission = cur.fetchone()

            if not submission:
                return jsonify({"success": False, "error": {"code": "NOT_FOUND", "message": "ไม่พบใบยื่นแบบ"}}), 404

            # [FIX] MySQL ไม่มี array_agg/json_build_object/FILTER (PostgreSQL)
            # ดึง licenses แล้วดึง incomes แยก จับกลุ่มฝั่ง Python แทน
            cur.execute("""
                SELECT * FROM licenses
                WHERE  submission_id = %s
                ORDER  BY sort_order, created_at
            """, (submission_id,))
            licenses = cur.fetchall()

            incomes_by_license = {}
            license_ids = [lic["id"] for lic in licenses]
            if license_ids:
                placeholders = ",".join(["%s"] * len(license_ids))
                cur.execute(f"""
                    SELECT license_id, field_key, label, amount, is_custom
                    FROM   license_incomes
                    WHERE  license_id IN ({placeholders})
                """, license_ids)
                for row in cur.fetchall():
                    incomes_by_license.setdefault(row["license_id"], []).append({
                        "field_key": row["field_key"],
                        "label":     row["label"],
                        "amount":    float(row["amount"] or 0),
                        "is_custom": bool(row["is_custom"]),
                    })

            for lic in licenses:
                lic["incomes"] = incomes_by_license.get(lic["id"], [])
                lic["fee_amount"] = float(lic["fee_amount"] or 0)
                lic["deduction_amount"] = float(lic["deduction_amount"] or 0)

            cur.execute("SELECT * FROM other_incomes WHERE submission_id = %s", (submission_id,))
            other_incomes = cur.fetchall()

            cur.execute("SELECT * FROM document_attachments WHERE submission_id = %s", (submission_id,))
            attachments = cur.fetchall()

            cur.execute("SELECT id FROM receipt WHERE submission_id = %s LIMIT 1", (submission_id,))
            receipt = cur.fetchone()

    # [FIX] เช็คเอกสารแนบครบ 3 ไหม ให้ตรงกับ pending_attach ของหน้าแอดมิน
    actual_status = submission["status"]
    if receipt and actual_status == "pending_payment":
        actual_status = "paid"
    elif actual_status == "pending_payment" and len(attachments) < 3:
        actual_status = "pending_attach"

    for key in ["period_start", "period_end", "due_date", "submitted_at", "created_at"]:
        if submission.get(key):
            submission[key] = date_to_str(submission[key])

    return jsonify({
        "success": True,
        "data": {
            "submission":    dict(submission),
            "status":        actual_status,
            "licenses":      [dict(l) for l in licenses],
            "other_incomes": [dict(o) for o in other_incomes],
            "attachments":   [
                {"id": a["id"], "doc_type": a["doc_type"],
                 "file_name": a["file_name"], "uploaded_at": date_to_str(a["uploaded_at"])}
                for a in attachments
            ]
        }
    }), 200


# ════════════════════════════════════════════════════════
# 4.6b ดาวน์โหลดไฟล์แนบของใบยื่นตัวเอง
# GET /api/operator/attachments/<id>/download
# nginx บล็อกการเข้าถึง /uploads/ ตรงๆ ต้องผ่าน endpoint นี้เท่านั้น
# เพื่อตรวจว่าไฟล์แนบนี้เป็นของ tax_id ที่ login อยู่จริง
# ════════════════════════════════════════════════════════

@operator_bp.route("/attachments/<attachment_id>/download", methods=["GET"])
@jwt_required()
@require_operator
def download_own_attachment(attachment_id):
    tax_id = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT da.storage_path, da.file_name, da.mime_type
                FROM   document_attachments da
                JOIN   submissions s ON s.id = da.submission_id
                WHERE  da.id = %s AND s.tax_id = %s
            """, (attachment_id, tax_id))
            att = cur.fetchone()

    if not att or not os.path.exists(att["storage_path"]):
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "ไม่พบไฟล์แนบ"}
        }), 404

    return send_file(
        att["storage_path"],
        mimetype=att.get("mime_type") or "application/octet-stream",
        download_name=att["file_name"],
        as_attachment=True,
    )


# ════════════════════════════════════════════════════════
# 4.6b2 ลบไฟล์แนบของใบยื่นตัวเอง (เฉพาะร่างที่ยังไม่ยืนยัน)
# DELETE /api/operator/attachments/<id>
# ใช้ตอนกดปุ่มลบ (X) ไฟล์ที่เคยแนบไว้แล้ว ระหว่างทำร่างต่อ (resume draft) —
# ถ้าไม่ลบที่นี่ด้วย ไฟล์เดิมจะถูก carry-forward กลับมาอีกตอนบันทึกร่างรอบถัดไป
# (ดู create_submission()) ทั้งที่ผู้ใช้ตั้งใจเอาออกแล้วจากหน้าจอ
# ════════════════════════════════════════════════════════

@operator_bp.route("/attachments/<attachment_id>", methods=["DELETE"])
@jwt_required()
@require_operator
def delete_own_attachment(attachment_id):
    tax_id = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT da.storage_path, s.status
                FROM   document_attachments da
                JOIN   submissions s ON s.id = da.submission_id
                WHERE  da.id = %s AND s.tax_id = %s
            """, (attachment_id, tax_id))
            att = cur.fetchone()

            if not att:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND", "message": "ไม่พบไฟล์แนบ"}
                }), 404
            if att["status"] != "draft":
                return jsonify({
                    "success": False,
                    "error": {"code": "INVALID_STATUS", "message": "ลบไฟล์แนบได้เฉพาะร่างที่ยังไม่ยืนยันเท่านั้น"}
                }), 400

            cur.execute("DELETE FROM document_attachments WHERE id = %s", (attachment_id,))
        db.commit()

    try:
        if att["storage_path"] and os.path.exists(att["storage_path"]):
            os.remove(att["storage_path"])
    except OSError:
        pass

    return jsonify({"success": True, "data": {"message": "ลบไฟล์แนบสำเร็จ"}}), 200


# ════════════════════════════════════════════════════════
# 4.6c อัปโหลดไฟล์แนบเอกสาร (Step 6)
# POST /api/operator/submissions/<submission_id>/attachments
# แนบได้เฉพาะใบยื่นที่ยังเป็น draft ของตัวเอง
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions/<submission_id>/attachments", methods=["POST"])
@jwt_required()
@require_operator
def upload_attachment(submission_id):
    tax_id = get_jwt_identity()

    if "file" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "NO_FILE", "message": "กรุณาแนบไฟล์"}
        }), 400

    file = request.files["file"]
    if not file.filename:
        return jsonify({
            "success": False,
            "error": {"code": "NO_FILE", "message": "กรุณาแนบไฟล์"}
        }), 400

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in current_app.config["ALLOWED_EXTENSIONS"]:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_TYPE", "message": "ประเภทไฟล์ไม่รองรับ"}
        }), 400

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "SELECT id, status, tax_id FROM submissions WHERE id = %s LIMIT 1",
                (submission_id,)
            )
            submission = cur.fetchone()

    if not submission:
        return jsonify({"success": False, "error": {"code": "NOT_FOUND", "message": "ไม่พบใบยื่นแบบ"}}), 404
    if submission["tax_id"] != tax_id:
        return jsonify({"success": False, "error": {"code": "FORBIDDEN", "message": "ไม่มีสิทธิ์"}}), 403
    if submission["status"] != "draft":
        return jsonify({"success": False, "error": {"code": "ALREADY_SUBMITTED", "message": "ใบยื่นแบบนี้ไม่สามารถแนบไฟล์เพิ่มได้"}}), 400

    doc_type    = request.form.get("doc_type", "")[:50]
    dest_dir    = os.path.join(current_app.config["UPLOAD_FOLDER"], submission_id)
    os.makedirs(dest_dir, exist_ok=True)
    stored_name = f"{uuid.uuid4()}{ext}"
    storage_path = os.path.join(dest_dir, stored_name)
    file.save(storage_path)
    file_size = os.path.getsize(storage_path)

    attachment_id = new_uuid()
    with get_db() as db:
        with db.cursor() as cur:
            # [FIX] เดิม insert ซ้อนได้เรื่อยๆ ไม่เช็คว่า doc_type นี้เคยแนบไว้
            # แล้วหรือยัง — ตอนนี้ร่างที่ถูก "ตีกลับ"/บันทึกซ้ำจะพา attachment
            # เดิมติดไปด้วย (carry-forward ใน create_submission) ถ้าผู้ใช้แนบ
            # ไฟล์ใหม่ทับรายการเดิมจะกลายเป็นมีสองแถวซ้ำกันสำหรับเอกสารประเภท
            # เดียวกัน ต้องลบของเก่า (ทั้งแถว DB และไฟล์จริง) ก่อนแนบใหม่เสมอ
            cur.execute(
                "SELECT id, storage_path FROM document_attachments WHERE submission_id = %s AND doc_type = %s",
                (submission_id, doc_type)
            )
            old_atts = cur.fetchall()
            for old in old_atts:
                cur.execute("DELETE FROM document_attachments WHERE id = %s", (old["id"],))
                try:
                    if old["storage_path"] and os.path.exists(old["storage_path"]):
                        os.remove(old["storage_path"])
                except OSError:
                    pass

            cur.execute("""
                INSERT INTO document_attachments
                    (id, submission_id, doc_type, file_name, storage_path, mime_type, file_size)
                VALUES (%s, %s, %s, %s, %s, %s, %s)
            """, (
                attachment_id, submission_id, doc_type,
                file.filename, storage_path, file.mimetype, file_size
            ))
        db.commit()

    return jsonify({
        "success": True,
        "data": {
            "id":        attachment_id,
            "doc_type":  doc_type,
            "file_name": file.filename,
        }
    }), 201


# ════════════════════════════════════════════════════════
# 4.7 ดูรายการใบยื่นทั้งหมดของตัวเอง
# GET /api/operator/submissions
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions", methods=["GET"])
@jwt_required()
@require_operator
def get_my_submissions():
    tax_id = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT
                    s.id, s.fiscal_year, s.ref_no, s.status,
                    s.total_income, s.net_amount,
                    s.submitted_at, s.created_at,
                    CASE WHEN r.id IS NOT NULL THEN 'paid' ELSE s.status END AS actual_status
                FROM submissions s
                LEFT JOIN receipt r ON r.submission_id = s.id
                WHERE s.tax_id = %s
                ORDER BY s.created_at DESC
            """, (tax_id,))
            submissions = cur.fetchall()

    status_labels = {
        "draft":           "ร่าง (ยังไม่ยืนยัน)",
        "pending_payment": "รอชำระเงิน",
        "paid":            "ชำระแล้ว",
    }

    result = []
    for sub in submissions:
        result.append({
            "id":           sub["id"],
            "fiscal_year":  sub["fiscal_year"],
            "ref_no":       sub["ref_no"],
            "status":       sub["actual_status"],
            "status_label": status_labels.get(sub["actual_status"], sub["actual_status"]),
            "total_income": float(sub["total_income"] or 0),
            "net_amount":   float(sub["net_amount"] or 0),
            "submitted_at": date_to_str(sub["submitted_at"]),
            "created_at":   date_to_str(sub["created_at"]),
            # [FIX] เพิ่ม field แยกเก็บวัน+เวลาเต็ม (ISO) ไว้ให้ frontend แปลง
            # เป็นวันที่/เวลาแบบไทยเอง — created_at เดิมตัด time ทิ้งหมด (แค่
            # YYYY-MM-DD) ใช้โชว์ "บันทึกล่าสุด" ในตารางร่างหน้าแรกไม่พอ
            "created_at_iso": sub["created_at"].isoformat() if sub["created_at"] else None,
            "can_edit":     sub["actual_status"] == "draft",
        })

    return jsonify({
        "success": True,
        "data": {"submissions": result, "total": len(result)}
    }), 200


# ════════════════════════════════════════════════════════
# 4.8 สถานะการนำส่งล่าสุด (สำหรับหน้า pages/status.html)
# GET /api/operator/status?year=2568
# ════════════════════════════════════════════════════════

@operator_bp.route("/status", methods=["GET"])
@jwt_required()
@require_operator
def get_status():
    """
    ดูสถานะใบยื่นแบบล่าสุด (หรือของปีที่ระบุ) ของผู้ประกอบการ
    ใช้โดยหน้า pages/status.html (frontend/js/status.js)

    Response:
        { success, data: { submitted: false } }
        หรือ
        { success, data: { submitted: true, status, ref_no, ... } }
    """
    tax_id = get_jwt_identity()
    year   = request.args.get("year", type=int)

    with get_db() as db:
        with db.cursor() as cur:
            params = [tax_id]
            year_clause = ""
            if year:
                year_clause = "AND s.fiscal_year = %s"
                params.append(year)

            cur.execute(f"""
                SELECT s.*, r.receipt_no, r.received_at,
                       r.amount AS receipt_amount, inv.invoice_no
                FROM   submissions s
                LEFT JOIN receipt r   ON r.submission_id = s.id
                LEFT JOIN invoice inv ON inv.submission_id = s.id
                WHERE  s.tax_id = %s {year_clause}
                ORDER  BY s.created_at DESC
                LIMIT  1
            """, params)
            submission = cur.fetchone()

    if not submission or submission["status"] == "draft":
        return jsonify({"success": True, "data": {"submitted": False}}), 200

    actual_status = "paid" if submission.get("receipt_no") else submission["status"]

    return jsonify({
        "success": True,
        "data": {
            "submitted":      True,
            "status":         actual_status,
            "ref_no":         submission["ref_no"],
            "operator_name":  submission["operator_name"],
            "fiscal_year":    submission["fiscal_year"],
            "period_start":   date_to_str(submission["period_start"]),
            "period_end":     date_to_str(submission["period_end"]),
            "due_date":       date_to_str(submission["due_date"]),
            "submitted_at":   date_to_str(submission["submitted_at"]),
            "created_at":     date_to_str(submission["created_at"]),
            "total_income":   float(submission["total_income"] or 0),
            "fund_amount":    float(submission["fund_amount"] or 0),
            "vat_amount":     float(submission["vat_amount"] or 0),
            "extra_amount":   float(submission["extra_amount"] or 0),
            "net_amount":     float(submission["net_amount"] or 0),
            "receipt_no":     submission.get("receipt_no"),
            "received_at":    date_to_str(submission.get("received_at")),
            "receipt_amount": (
                float(submission["receipt_amount"])
                if submission.get("receipt_amount") is not None else None
            ),
            "invoice_no":     submission.get("invoice_no"),
        }
    }), 200