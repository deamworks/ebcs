# ════════════════════════════════════════════════════════
# routes/operator.py — API สำหรับผู้ประกอบการ
#
# ทุก endpoint ในไฟล์นี้:
# 1. ต้องมี JWT token (ได้จากการ verify OTP)
# 2. ดึง tax_id จาก token อัตโนมัติ (ปลอมเป็นคนอื่นไม่ได้)
# 3. ตอบ JSON format เดียวกันทุกตัว
# ════════════════════════════════════════════════════════

from flask import Blueprint, jsonify, request
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt
from datetime import datetime, date

from ..db import get_db

operator_bp = Blueprint("operator", __name__)


# ════════════════════════════════════════════════════════
# Helper Functions
# ════════════════════════════════════════════════════════

def date_to_str(d):
    """
    แปลง date object เป็น string
    เพราะ JSON ไม่รู้จัก date object โดยตรง
    ตัวอย่าง: date(2025, 1, 1) → "2025-01-01"
    """
    if d is None:
        return None
    if isinstance(d, (date, datetime)):
        return d.strftime("%Y-%m-%d")
    return str(d)


def require_operator(f):
    """
    Decorator ตรวจสอบว่าเป็น token ของผู้ประกอบการ
    ใช้แบบนี้:
        @operator_bp.route("/...")
        @jwt_required()
        @require_operator
        def my_route():
            ...
    """
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        # ดึงข้อมูลจาก JWT token
        claims = get_jwt()

        # ตรวจว่า role เป็น operator
        if claims.get("role") != "operator":
            return jsonify({
                "success": False,
                "error": {
                    "code": "FORBIDDEN",
                    "message": "ไม่มีสิทธิ์เข้าถึง"
                }
            }), 403

        return f(*args, **kwargs)
    return decorated


# ════════════════════════════════════════════════════════
# 4.1 Auto-fill ข้อมูลบริษัท
# ════════════════════════════════════════════════════════

@operator_bp.route("/autofill", methods=["GET"])
@jwt_required()
@require_operator
def autofill():
    """
    ดึงข้อมูลบริษัทตอนผู้ประกอบการ Login แล้ว

    Request:  GET /api/operator/autofill?year=2568
    Response: ข้อมูลบริษัท + เช็คว่าเคยยื่นปีนี้ไหม

    tax_id ดึงจาก JWT token อัตโนมัติ
    ไม่ต้องส่งมาใน request (ปลอมเป็นคนอื่นไม่ได้)
    """

    # ดึง tax_id จาก token
    tax_id = get_jwt_identity()

    # รับปีบัญชีจาก query parameter
    year = request.args.get("year", type=int)
    if not year:
        return jsonify({
            "success": False,
            "error": {
                "code": "MISSING_YEAR",
                "message": "กรุณาระบุปีบัญชี"
            }
        }), 400

    with get_db() as db:
        with db.cursor() as cur:

            # ── ดึงข้อมูลผู้ประกอบการ ──────────────────────
            cur.execute("""
                SELECT tax_id, operator_name, fiscal_year,
                       ref_no, period_start, period_end, due_date
                FROM   taxpayer_master
                WHERE  tax_id = %s
                AND    fiscal_year = %s
                LIMIT 1
            """, (tax_id, year))
            taxpayer = cur.fetchone()

            if not taxpayer:
                return jsonify({
                    "success": False,
                    "error": {
                        "code": "NOT_FOUND",
                        "message": f"ไม่พบข้อมูลผู้ประกอบการสำหรับปี {year}"
                    }
                }), 404

            # ── เช็คว่าเคยยื่นปีนี้ไหม ─────────────────────
            # ถ้าเคยยื่นแล้ว แจ้งเตือนผู้ใช้ก่อนดำเนินการต่อ
            cur.execute("""
                SELECT id, status, submitted_at
                FROM   submissions
                WHERE  tax_id = %s
                AND    fiscal_year = %s
                LIMIT 1
            """, (tax_id, year))
            existing = cur.fetchone()

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

            # ถ้าเคยยื่นแล้ว ส่งข้อมูลมาด้วยให้ Frontend แจ้งเตือน
            "existing_submission": {
                "id":           existing["id"],
                "status":       existing["status"],
                "submitted_at": date_to_str(existing["submitted_at"])
            } if existing else None
        }
    }), 200


# ════════════════════════════════════════════════════════
# 4.2 ดึงรายการใบอนุญาต
# ════════════════════════════════════════════════════════

@operator_bp.route("/licenses", methods=["GET"])
@jwt_required()
@require_operator
def get_licenses():
    """
    ดึงรายการใบอนุญาตทั้งหมดของบริษัท

    Request:  GET /api/operator/licenses?year=2568
    Response: รายการใบอนุญาตทุกสถานะ (active, ended, cancelled, revoked)

    ดึงทุกสถานะ ไม่กรองเฉพาะ active เพราะ:
    - ใบที่หมดอายุก็อาจต้องชำระย้อนหลัง
    - ผู้ประกอบการต้องเห็นภาพรวมทั้งหมด
    """

    tax_id = get_jwt_identity()
    year = request.args.get("year", type=int)

    # แปลงสถานะเป็นภาษาไทยสำหรับแสดงผล
    status_labels = {
        "active":    "ได้รับอนุญาต",
        "ended":     "สิ้นสุดระยะเวลาอนุญาต",
        "cancelled": "ยกเลิกประกอบกิจการ",
        "revoked":   "เพิกถอนใบอนุญาต"
    }

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, license_no, licensee_type,
                       license_status, start_date, end_date
                FROM   licensee_master
                WHERE  tax_id = %s
                ORDER BY license_status, license_no
            """, (tax_id,))
            licenses = cur.fetchall()

    # เพิ่ม status_label ภาษาไทยในแต่ละใบ
    for lic in licenses:
        lic["status_label"] = status_labels.get(
            lic["license_status"], lic["license_status"]
        )
        lic["start_date"] = date_to_str(lic["start_date"])
        lic["end_date"]   = date_to_str(lic["end_date"])

    return jsonify({
        "success": True,
        "data": {
            "licenses": licenses,
            "total":    len(licenses)
        }
    }), 200


# ════════════════════════════════════════════════════════
# 4.3 บันทึกใบยื่นแบบ (Step 1-4)
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions", methods=["POST"])
@jwt_required()
@require_operator
def create_submission():
    """
    บันทึกข้อมูลใบยื่นแบบครั้งแรก (สร้างเป็น draft)

    Request:  POST /api/operator/submissions
    Body: {
        "fiscal_year": 2568,
        "licenses": [
            {
                "license_no": "B1-2567-001",
                "licensee_type": "กระจายเสียง",
                "fee_amount": 150000,
                "incomes": [
                    {"income_type": "ads", "label": "รายได้ค่าโฆษณา", "amount": 100000},
                    {"income_type": "rental", "label": "รายได้ค่าเช่าเวลา", "amount": 50000}
                ]
            }
        ],
        "other_incomes": [
            {"income_type": "foreign", "label": "รายได้จากต่างประเทศ", "amount": 50000}
        ],
        "deduction_amount": 20000,
        "auditor": {
            "name": "นายสมชาย ตรวจดี",
            "license": "12345",
            "office": "สำนักงานสอบบัญชี ABC",
            "audited_date": "2026-03-15"
        }
    }

    สำคัญมาก: ใช้ Transaction
    ถ้าบันทึกใบอนุญาตครบ 2 จาก 3 ใบแล้ว error
    → ยกเลิกทั้งหมด ไม่ให้ข้อมูลครึ่งๆ กลางๆ
    """

    tax_id = get_jwt_identity()
    data   = request.get_json()

    if not data:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_REQUEST", "message": "กรุณาส่งข้อมูล JSON"}
        }), 400

    # ── รับค่าจาก request ────────────────────────────
    fiscal_year      = data.get("fiscal_year")
    licenses_data    = data.get("licenses", [])
    other_incomes    = data.get("other_incomes", [])
    deduction_amount = float(data.get("deduction_amount", 0))
    auditor          = data.get("auditor", {})

    if not fiscal_year:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_FIELDS", "message": "กรุณาระบุปีบัญชี"}
        }), 400

    # ── ดึงข้อมูล snapshot จาก taxpayer_master ───────
    # เก็บข้อมูลบริษัท ณ วันที่ยื่น ไม่เปลี่ยนตาม master
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

    # ── คำนวณรายได้รวม ───────────────────────────────
    total_income = sum(
        float(lic.get("fee_amount", 0))
        for lic in licenses_data
    )

    # ── คำนวณเงินกองทุน VAT และเงินเพิ่ม ─────────────
    calculation = calculate_fund(
        total_income     = total_income,
        deduction_amount = deduction_amount,
        due_date         = taxpayer["due_date"]
    )

    # ── บันทึกลงฐานข้อมูลแบบ Transaction ────────────
    # Transaction = ทำทั้งหมดสำเร็จ หรือยกเลิกทั้งหมด
    with get_db() as db:
        with db.cursor() as cur:

            # 1. สร้างใบยื่นหลัก
            cur.execute("""
                INSERT INTO submissions (
                    tax_id, ref_no, fiscal_year,
                    operator_name, period_start, period_end, due_date,
                    status, total_income, deduction_amount,
                    fund_amount, vat_amount, extra_amount, net_amount,
                    auditor_name, auditor_license, auditor_office, audited_date
                ) VALUES (
                    %s, %s, %s,
                    %s, %s, %s, %s,
                    'draft', %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s, %s
                )
            """, (
                tax_id,
                taxpayer["ref_no"],
                fiscal_year,
                taxpayer["operator_name"],
                taxpayer["period_start"],
                taxpayer["period_end"],
                taxpayer["due_date"],
                total_income,
                deduction_amount,
                calculation["fund_amount"],
                calculation["vat_amount"],
                calculation["extra_amount"],
                calculation["net_amount"],
                auditor.get("name"),
                auditor.get("license"),
                auditor.get("office"),
                auditor.get("audited_date")
            ))

            # ดึง id ของใบยื่นที่เพิ่งสร้าง
            submission_id = db.insert_id()

            # แต่ MySQL UUID ต้องดึงแบบนี้
            cur.execute("SELECT LAST_INSERT_ID() as lid")
            # ใช้ UUID จากการ SELECT กลับมา
            cur.execute(
                "SELECT id FROM submissions WHERE tax_id = %s AND fiscal_year = %s ORDER BY created_at DESC LIMIT 1",
                (tax_id, fiscal_year)
            )
            sub_row = cur.fetchone()
            submission_id = sub_row["id"]

            # 2. บันทึกใบอนุญาตทีละใบ
            for lic in licenses_data:
                cur.execute("""
                    INSERT INTO licenses (
                        submission_id, license_no,
                        licensee_type, license_status, fee_amount
                    ) VALUES (%s, %s, %s, %s, %s)
                """, (
                    submission_id,
                    lic.get("license_no"),
                    lic.get("licensee_type"),
                    lic.get("license_status", "active"),
                    float(lic.get("fee_amount", 0))
                ))

                # ดึง id ของใบอนุญาตที่เพิ่งสร้าง
                cur.execute(
                    "SELECT id FROM licenses WHERE submission_id = %s AND license_no = %s LIMIT 1",
                    (submission_id, lic.get("license_no"))
                )
                lic_row = cur.fetchone()
                license_id = lic_row["id"]

                # 3. บันทึกรายได้ย่อยของใบอนุญาตนี้
                for income in lic.get("incomes", []):
                    cur.execute("""
                        INSERT INTO license_incomes (
                            license_id, income_type, label, amount
                        ) VALUES (%s, %s, %s, %s)
                    """, (
                        license_id,
                        income.get("income_type"),
                        income.get("label"),
                        float(income.get("amount", 0))
                    ))

            # 4. บันทึกรายได้อื่น (Step 2)
            for other in other_incomes:
                cur.execute("""
                    INSERT INTO other_incomes (
                        submission_id, income_type, label, amount
                    ) VALUES (%s, %s, %s, %s)
                """, (
                    submission_id,
                    other.get("income_type"),
                    other.get("label"),
                    float(other.get("amount", 0))
                ))

        # Commit: บันทึกทุกอย่างพร้อมกัน
        # ถ้ามี error บรรทัดไหน จะ rollback ทั้งหมดอัตโนมัติ (ดูใน db.py)
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
# 4.4 แก้ไขใบยื่นแบบ (ก่อน Submit)
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions/<submission_id>", methods=["PUT"])
@jwt_required()
@require_operator
def update_submission(submission_id):
    """
    แก้ไขข้อมูลใบยื่น — ทำได้เฉพาะตอน status = draft เท่านั้น

    Request:  PUT /api/operator/submissions/<id>
    Body: เหมือน POST แต่ส่งแค่ field ที่ต้องการแก้
    """

    tax_id = get_jwt_identity()
    data   = request.get_json()

    # ── ตรวจสอบว่าใบยื่นนี้เป็นของ tax_id นี้จริง ───
    # และยังเป็น draft อยู่
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, status, tax_id
                FROM   submissions
                WHERE  id = %s
                LIMIT 1
            """, (submission_id,))
            submission = cur.fetchone()

    # ไม่พบใบยื่น
    if not submission:
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "ไม่พบใบยื่นแบบ"}
        }), 404

    # ตรวจว่าเป็นของตัวเอง (ป้องกันแก้ใบของคนอื่น)
    if submission["tax_id"] != tax_id:
        return jsonify({
            "success": False,
            "error": {"code": "FORBIDDEN", "message": "ไม่มีสิทธิ์แก้ไขใบยื่นนี้"}
        }), 403

    # ตรวจว่ายังเป็น draft อยู่
    if submission["status"] != "draft":
        return jsonify({
            "success": False,
            "error": {
                "code": "ALREADY_SUBMITTED",
                "message": "ใบยื่นนี้ยืนยันแล้ว ไม่สามารถแก้ไขได้ กรุณาติดต่อเจ้าหน้าที่"
            }
        }), 400

    # ── อัปเดตข้อมูล ─────────────────────────────────
    deduction_amount = float(data.get("deduction_amount", 0))
    auditor          = data.get("auditor", {})
    licenses_data    = data.get("licenses", [])

    # คำนวณใหม่
    total_income = sum(
        float(lic.get("fee_amount", 0))
        for lic in licenses_data
    )

    with get_db() as db:
        with db.cursor() as cur:

            # ดึง due_date สำหรับคำนวณเงินเพิ่ม
            cur.execute(
                "SELECT due_date FROM submissions WHERE id = %s",
                (submission_id,)
            )
            sub = cur.fetchone()

            calculation = calculate_fund(
                total_income     = total_income,
                deduction_amount = deduction_amount,
                due_date         = sub["due_date"]
            )

            # อัปเดตใบยื่นหลัก
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
                total_income,
                deduction_amount,
                calculation["fund_amount"],
                calculation["vat_amount"],
                calculation["extra_amount"],
                calculation["net_amount"],
                auditor.get("name"),
                auditor.get("license"),
                auditor.get("office"),
                auditor.get("audited_date"),
                submission_id
            ))

            # ลบใบอนุญาตเก่า แล้วเพิ่มใหม่ทั้งหมด
            # (CASCADE จะลบ license_incomes ที่เชื่อมอยู่ด้วยอัตโนมัติ)
            cur.execute(
                "DELETE FROM licenses WHERE submission_id = %s",
                (submission_id,)
            )

            for lic in licenses_data:
                cur.execute("""
                    INSERT INTO licenses (
                        submission_id, license_no,
                        licensee_type, license_status, fee_amount
                    ) VALUES (%s, %s, %s, %s, %s)
                """, (
                    submission_id,
                    lic.get("license_no"),
                    lic.get("licensee_type"),
                    lic.get("license_status", "active"),
                    float(lic.get("fee_amount", 0))
                ))

                cur.execute(
                    "SELECT id FROM licenses WHERE submission_id = %s AND license_no = %s LIMIT 1",
                    (submission_id, lic.get("license_no"))
                )
                lic_row = cur.fetchone()
                license_id = lic_row["id"]

                for income in lic.get("incomes", []):
                    cur.execute("""
                        INSERT INTO license_incomes (
                            license_id, income_type, label, amount
                        ) VALUES (%s, %s, %s, %s)
                    """, (
                        license_id,
                        income.get("income_type"),
                        income.get("label"),
                        float(income.get("amount", 0))
                    ))

        db.commit()

    return jsonify({
        "success": True,
        "data": {
            "submission_id": submission_id,
            "calculation":   calculation
        }
    }), 200


# ════════════════════════════════════════════════════════
# 4.5 ยืนยันการยื่นแบบ (Submit)
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions/<submission_id>/submit", methods=["POST"])
@jwt_required()
@require_operator
def submit_submission(submission_id):
    """
    ยืนยันการยื่นแบบ — จุดที่ "ย้อนกลับแก้ไขไม่ได้แล้ว"

    Request:  POST /api/operator/submissions/<id>/submit
    Body:     ไม่ต้องส่งอะไร

    ผล: status เปลี่ยนจาก draft → pending_payment
        submitted_at บันทึกเวลาปัจจุบัน
    """

    tax_id = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:

            # ตรวจสอบสิทธิ์และสถานะ
            cur.execute("""
                SELECT id, status, tax_id, net_amount
                FROM   submissions
                WHERE  id = %s
                LIMIT 1
            """, (submission_id,))
            submission = cur.fetchone()

    if not submission:
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "ไม่พบใบยื่นแบบ"}
        }), 404

    if submission["tax_id"] != tax_id:
        return jsonify({
            "success": False,
            "error": {"code": "FORBIDDEN", "message": "ไม่มีสิทธิ์"}
        }), 403

    if submission["status"] != "draft":
        return jsonify({
            "success": False,
            "error": {
                "code": "ALREADY_SUBMITTED",
                "message": "ยืนยันการยื่นแบบนี้ไปแล้ว"
            }
        }), 400

    # ── เปลี่ยนสถานะเป็น pending_payment ─────────────
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                UPDATE submissions
                SET    status       = 'pending_payment',
                       submitted_at = NOW()
                WHERE  id = %s
            """, (submission_id,))
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
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions/<submission_id>", methods=["GET"])
@jwt_required()
@require_operator
def get_submission(submission_id):
    """
    ดูรายละเอียดใบยื่นแบบ + สถานะ

    Request:  GET /api/operator/submissions/<id>
    Response: ข้อมูลครบทุก Step
    """

    tax_id = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:

            # ดึงใบยื่นหลัก
            cur.execute("""
                SELECT * FROM submissions
                WHERE  id = %s AND tax_id = %s
                LIMIT 1
            """, (submission_id, tax_id))
            submission = cur.fetchone()

            if not submission:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND", "message": "ไม่พบใบยื่นแบบ"}
                }), 404

            # ดึงใบอนุญาต
            cur.execute("""
                SELECT l.*, GROUP_CONCAT(
                    JSON_OBJECT(
                        'income_type', li.income_type,
                        'label',       li.label,
                        'amount',      li.amount
                    )
                ) as incomes_json
                FROM   licenses l
                LEFT JOIN license_incomes li ON li.license_id = l.id
                WHERE  l.submission_id = %s
                GROUP BY l.id
            """, (submission_id,))
            licenses = cur.fetchall()

            # ดึงรายได้อื่น
            cur.execute(
                "SELECT * FROM other_incomes WHERE submission_id = %s",
                (submission_id,)
            )
            other_incomes = cur.fetchall()

            # ดึงไฟล์แนบ
            cur.execute(
                "SELECT * FROM document_attachments WHERE submission_id = %s",
                (submission_id,)
            )
            attachments = cur.fetchall()

            # ตรวจสถานะ paid จากตาราง receipt
            cur.execute(
                "SELECT id FROM receipt WHERE submission_id = %s LIMIT 1",
                (submission_id,)
            )
            receipt = cur.fetchone()

    # คำนวณสถานะจริง
    actual_status = submission["status"]
    if receipt and actual_status == "pending_payment":
        actual_status = "paid"

    # แปลงวันที่
    for key in ["period_start", "period_end", "due_date", "submitted_at", "created_at"]:
        if submission.get(key):
            submission[key] = date_to_str(submission[key])

    return jsonify({
        "success": True,
        "data": {
            "submission":   submission,
            "status":       actual_status,
            "licenses":     licenses,
            "other_incomes": other_incomes,
            "attachments":  [
                {
                    "id":          a["id"],
                    "doc_type":    a["doc_type"],
                    "file_name":   a["file_name"],
                    "uploaded_at": date_to_str(a["uploaded_at"])
                }
                for a in attachments
            ]
        }
    }), 200


# ════════════════════════════════════════════════════════
# ฟังก์ชันคำนวณเงินกองทุน
# ════════════════════════════════════════════════════════

def calculate_fund(total_income, deduction_amount, due_date):
    """
    คำนวณเงินที่ต้องนำส่งกองทุน

    สูตร:
    1. เงินกองทุน = (รายได้รวม - ค่าลดหย่อน) × 2%
    2. VAT        = เงินกองทุน × 7%
    3. เงินเพิ่ม  = คำนวณตามจำนวนวันล่าช้า (ถ้ามี)
    4. ยอดสุทธิ   = เงินกองทุน + VAT + เงินเพิ่ม
    """

    # ฐานในการคำนวณ
    base = max(0, total_income - deduction_amount)

    # เงินกองทุน 2%
    fund_amount = round(base * 0.02, 2)

    # VAT 7% ของเงินกองทุน
    vat_amount = round(fund_amount * 0.07, 2)

    # เงินเพิ่มกรณีชำระล่าช้า
    extra_amount = 0.0
    if due_date:
        today = date.today()
        # แปลง due_date เป็น date object ถ้าเป็น string
        if isinstance(due_date, str):
            due_date = datetime.strptime(due_date, "%Y-%m-%d").date()
        elif isinstance(due_date, datetime):
            due_date = due_date.date()

        if today > due_date:
            # จำนวนวันที่ล่าช้า
            days_late = (today - due_date).days
            # อัตราเงินเพิ่ม: 1.5% ต่อเดือน (คำนวณเป็นรายวัน)
            extra_amount = round(fund_amount * 0.015 * (days_late / 30), 2)

    # ยอดสุทธิ
    net_amount = round(fund_amount + vat_amount + extra_amount, 2)

    return {
        "total_income":    round(total_income, 2),
        "deduction_amount": round(deduction_amount, 2),
        "base_income":     round(base, 2),
        "fund_amount":     fund_amount,
        "vat_amount":      vat_amount,
        "extra_amount":    extra_amount,
        "net_amount":      net_amount
    }

# ════════════════════════════════════════════════════════
# ดูรายการใบยื่นทั้งหมดของตัวเอง
# ════════════════════════════════════════════════════════

@operator_bp.route("/submissions", methods=["GET"])
@jwt_required()
@require_operator
def get_my_submissions():
    """
    ดูรายการใบยื่นแบบทั้งหมดของผู้ประกอบการที่ Login อยู่

    Request:  GET /api/operator/submissions
    Response: รายการใบยื่นทุกปี เรียงจากล่าสุดก่อน

    สิ่งที่ผู้ใช้จะเห็น:
    - ปีบัญชีที่ยื่น
    - สถานะ (ร่าง / รอชำระ / ชำระแล้ว)
    - ยอดเงินสุทธิ
    - วันที่ยื่น
    - submission_id สำหรับคลิกเข้าดูรายละเอียด
    """

    # ดึง tax_id จาก JWT token
    tax_id = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:

            # ดึงใบยื่นทั้งหมดของบริษัทนี้
            # เรียงจากใหม่ไปเก่า (created_at DESC)
            cur.execute("""
                SELECT
                    s.id,
                    s.fiscal_year,
                    s.ref_no,
                    s.status,
                    s.total_income,
                    s.net_amount,
                    s.submitted_at,
                    s.created_at,
                    -- ตรวจว่ามีใบเสร็จไหม (ถ้ามี = paid จริงๆ)
                    CASE WHEN r.id IS NOT NULL THEN 'paid'
                         ELSE s.status
                    END AS actual_status
                FROM submissions s
                LEFT JOIN receipt r ON r.submission_id = s.id
                WHERE s.tax_id = %s
                ORDER BY s.created_at DESC
            """, (tax_id,))
            submissions = cur.fetchall()

    # แปลงสถานะเป็นภาษาไทย
    status_labels = {
        "draft":           "ร่าง (ยังไม่ยืนยัน)",
        "pending_payment": "รอชำระเงิน",
        "paid":            "ชำระแล้ว"
    }

    # จัดรูปแบบข้อมูลก่อนส่งกลับ
    result = []
    for sub in submissions:
        result.append({
            "id":           sub["id"],
            "fiscal_year":  sub["fiscal_year"],
            "ref_no":       sub["ref_no"],

            # สถานะ code (draft/pending_payment/paid)
            "status":       sub["actual_status"],

            # สถานะภาษาไทย
            "status_label": status_labels.get(
                sub["actual_status"], sub["actual_status"]
            ),

            # ยอดเงิน
            "total_income": float(sub["total_income"] or 0),
            "net_amount":   float(sub["net_amount"] or 0),

            # วันที่
            "submitted_at": date_to_str(sub["submitted_at"]),
            "created_at":   date_to_str(sub["created_at"]),

            # บอก Frontend ว่าแก้ไขได้ไหม
            # draft = แก้ได้, อื่นๆ = ดูได้อย่างเดียว
            "can_edit": sub["actual_status"] == "draft"
        })

    return jsonify({
        "success": True,
        "data": {
            "submissions": result,
            "total":       len(result)
        }
    }), 200