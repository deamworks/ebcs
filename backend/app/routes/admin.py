# ════════════════════════════════════════════════════════
# routes/admin.py — API สำหรับเจ้าหน้าที่ กสทช.
#
# ทุก endpoint ในไฟล์นี้:
# 1. ต้องมี JWT token ของ admin เท่านั้น
# 2. ถ้าใช้ token ของผู้ประกอบการจะได้ 403 Forbidden
# 3. ทุกการแก้ไขบันทึกลง audit_logs อัตโนมัติ
# ════════════════════════════════════════════════════════

import io
import json
import os
from datetime import datetime, date, timezone
from zoneinfo import ZoneInfo

import bcrypt
from flask import Blueprint, jsonify, request, send_file
from flask_jwt_extended import jwt_required, get_jwt_identity, get_jwt

from ..db import get_db
from ..services.export_service import (
    export_taxpayer_report,
    export_licensee_report,
    export_payment_report,
    export_license_report,   # backward compat alias
)
from ..services.import_service import (
    parse_taxpayer_excel, import_taxpayers,
    parse_licensee_excel, import_licensees,
    parse_contact_excel,  import_contacts,
    parse_operator_account_excel, import_operator_accounts,
    EMAIL_RE,
)

admin_bp = Blueprint("admin", __name__)


def send_excel_file(output, thai_filename):
    """
    ส่งไฟล์ Excel พร้อมชื่อไฟล์ภาษาไทย

    HTTP header อนุญาตเฉพาะ ASCII ใน filename=""
    → ใช้ filename="report.xlsx" เป็น fallback
    → ใช้ filename*=UTF-8''<encoded> สำหรับชื่อจริง (RFC 5987)

    Postman: ดูชื่อไฟล์ได้ที่ "Save Response > Save to a file"
             จะเห็นชื่อภาษาไทยจาก filename* อัตโนมัติ
    """
    from urllib.parse import quote
    from flask import Response

    if not thai_filename.lower().endswith(".xlsx"):
        thai_filename += ".xlsx"

    # encode ชื่อภาษาไทยสำหรับ RFC 5987
    encoded_name = quote(thai_filename, encoding="utf-8", safe="")

    response = Response(
        output.read(),
        mimetype="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )
    # filename= ต้องเป็น ASCII เท่านั้น — ใช้ report.xlsx เป็น fallback
    # filename*= ใช้ UTF-8 encoded — client ที่รองรับ RFC 5987 จะใช้อันนี้แทน
    response.headers["Content-Disposition"] = (
        "attachment; filename=\"report.xlsx\"; "
        f"filename*=UTF-8''{encoded_name}"
    )
    return response
def date_to_str(d):
    """แปลง date/datetime เป็น string สำหรับ JSON"""
    if d is None:
        return None
    if isinstance(d, (date, datetime)):
        return d.strftime("%Y-%m-%d")
    return str(d)


def require_admin(f):
    """
    Decorator ตรวจสอบว่าเป็น token ของ admin
    ใช้แบบนี้:
        @admin_bp.route("/...")
        @jwt_required()
        @require_admin
        def my_route():
            ...
    """
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        claims = get_jwt()
        if claims.get("role") != "admin":
            return jsonify({
                "success": False,
                "error": {
                    "code": "FORBIDDEN",
                    "message": "เฉพาะเจ้าหน้าที่เท่านั้น"
                }
            }), 403
        return f(*args, **kwargs)
    return decorated


def require_super_admin(f):
    """
    Decorator ตรวจสอบว่าเป็น admin_role = super_admin เท่านั้น
    ใช้กับ endpoint จัดการบัญชีแอดมิน (แท็บ "จัดการผู้ดูแลระบบ")
    วางต่อจาก @require_admin เสมอ
    """
    from functools import wraps

    @wraps(f)
    def decorated(*args, **kwargs):
        claims = get_jwt()
        if claims.get("admin_role") != "super_admin":
            return jsonify({
                "success": False,
                "error": {
                    "code": "FORBIDDEN",
                    "message": "เฉพาะผู้ดูแลระบบระดับสูงสุดเท่านั้น"
                }
            }), 403
        return f(*args, **kwargs)
    return decorated


BANGKOK_TZ = ZoneInfo("Asia/Bangkok")

TABLE_NAME_TH = {
    "submissions":          "ใบยื่นแบบ",
    "document_attachments": "ไฟล์แนบเอกสาร",
    "taxpayer_master":      "ผู้ประกอบการ",
    "licensee_master":      "ใบอนุญาต",
    "operator_accounts":    "บัญชีผู้ประกอบการ",
    "contact_master":       "ที่อยู่ผู้ประกอบการ",
    "receipt":              "ใบเสร็จรับเงิน",
    "export":               "ส่งออกข้อมูล",
    "admin_users":          "ผู้ดูแลระบบ",
}


def now_bangkok():
    """เวลาปัจจุบันตามเขตเวลาประเทศไทย (ไม่มี tzinfo สำหรับเก็บลง DATETIME)"""
    return datetime.now(timezone.utc).astimezone(BANGKOK_TZ).replace(tzinfo=None)


def export_date_label():
    """วันที่ส่งออก (พ.ศ.) สำหรับใส่ในชื่อไฟล์รายงาน เช่น 27-07-2569"""
    now = now_bangkok()
    return f"{now.day:02d}-{now.month:02d}-{now.year + 543}"


def save_audit_log(db, admin_email, action, table_name,
                   record_id=None, changes=None, record_label=None):
    """
    บันทึก Audit Log ทุกครั้งที่แอดมินแก้ไขข้อมูล
    เรียกใช้หลังทุก INSERT/UPDATE/DELETE

    - record_label: ระบุ "ของใคร" เช่น ชื่อผู้ประกอบการ/เลขผู้เสียภาษี
    - เวลาบันทึกใช้เขตเวลาประเทศไทย (Asia/Bangkok) เสมอ ไม่พึ่งพา timezone ของ DB server

    ตัวอย่าง changes:
    {

    }
    """
    with db.cursor() as cur:
        cur.execute("""
            INSERT INTO audit_logs
                (admin_email, action, table_name, record_id, record_label, changes, created_at)
            VALUES (%s, %s, %s, %s, %s, %s, %s)
        """, (
            admin_email,
            action,
            table_name,
            str(record_id) if record_id else None,
            record_label,
            json.dumps(changes, ensure_ascii=False, default=str) if changes else None,
            now_bangkok()
        ))


# ════════════════════════════════════════════════════════
# 5.1 รายการยื่นแบบทั้งหมด + Dashboard Cards
# ════════════════════════════════════════════════════════

@admin_bp.route("/submissions", methods=["GET"])
@jwt_required()
@require_admin
def get_submissions():
    """
    ดูรายการยื่นแบบทั้งหมด พร้อม Dashboard Cards

    Request:  GET /api/admin/submissions
    Query:    ?year=2568&status=pending_payment&search=ไทยวิทยุ&page=1

    Response:
    - items:      รายการใบยื่น (แบ่งหน้า)
    - summary:    ตัวเลขสำหรับ Dashboard Cards 4 ใบ
    - pagination: ข้อมูลการแบ่งหน้า
    """

    # ── รับ query parameters ─────────────────────────
    year       = request.args.get("year", type=int)
    status     = request.args.get("status")
    search     = request.args.get("search", "").strip()
    page       = request.args.get("page", 1, type=int)
    per_page   = request.args.get("per_page", 50, type=int)
    offset     = (page - 1) * per_page

    # ── สร้าง WHERE clause แบบ dynamic ──────────────
    # สร้างเงื่อนไขตามที่ส่งมา (ไม่ส่งมา = ไม่กรอง)
    conditions = []
    params     = []

    if year:
        conditions.append("s.fiscal_year = %s")
        params.append(year)

    # pending_attach ไม่ใช่ค่าจริงใน status enum — กรองจาก HAVING ของ attachment count แทน
    having_pending_attach = False
    if status == "pending_attach":
        having_pending_attach = True
    elif status:
        conditions.append("s.status = %s")
        params.append(status)

    if search:
        # ค้นหาทั้งชื่อบริษัทและเลขภาษี
        conditions.append(
            "(s.operator_name LIKE %s OR s.tax_id LIKE %s)"
        )
        params.append(f"%{search}%")
        params.append(f"%{search}%")

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with get_db() as db:
        with db.cursor() as cur:

            # ── ดึงรายการ (แบ่งหน้า) ─────────────────
            # required_ok: ยื่นแบบแล้วต้องมีเอกสารแนบครบ 3 อย่างบังคับ ไม่งั้นเป็น pending_attach
            cur.execute(f"""
                SELECT
                    s.id, s.tax_id, s.operator_name,
                    s.fiscal_year, s.ref_no, s.due_date,
                    s.net_amount, s.submitted_at, s.created_at,
                    COUNT(da.id) AS attachment_count,
                    CASE WHEN r.id IS NOT NULL THEN 'paid'
                         WHEN s.status = 'pending_payment' AND COUNT(da.id) < 3 THEN 'pending_attach'
                         ELSE s.status END AS status
                FROM submissions s
                LEFT JOIN receipt r ON r.submission_id = s.id
                LEFT JOIN document_attachments da ON da.submission_id = s.id
                {where}
                GROUP BY s.id, s.tax_id, s.operator_name, s.fiscal_year, s.ref_no,
                         s.due_date, s.net_amount, s.submitted_at, s.created_at,
                         r.id, s.status
                {"HAVING status = 'pending_attach'" if having_pending_attach else ""}
                ORDER BY s.created_at DESC
                LIMIT %s OFFSET %s
            """, params + [per_page, offset])
            items = cur.fetchall()

            # ── นับทั้งหมดสำหรับ pagination ─────────
            cur.execute(f"""
                SELECT COUNT(*) AS total FROM (
                    SELECT s.id,
                           CASE WHEN r.id IS NOT NULL THEN 'paid'
                                WHEN s.status = 'pending_payment' AND COUNT(da.id) < 3 THEN 'pending_attach'
                                ELSE s.status END AS status
                    FROM submissions s
                    LEFT JOIN receipt r ON r.submission_id = s.id
                    LEFT JOIN document_attachments da ON da.submission_id = s.id
                    {where}
                    GROUP BY s.id, r.id, s.status
                    {"HAVING status = 'pending_attach'" if having_pending_attach else ""}
                ) t
            """, params)
            total = cur.fetchone()["total"]

            # ── Dashboard Cards (นับแยกแต่ละสถานะ) ──
            # ถ้ากรองปีอยู่ Dashboard ก็แสดงเฉพาะปีนั้น
            dash_where = "WHERE s.fiscal_year = %s" if year else ""
            dash_params = [year] if year else []

            cur.execute(f"""
                SELECT
                    COUNT(*) as total,
                    SUM(CASE WHEN s.status = 'draft' THEN 1 ELSE 0 END) as draft,
                    SUM(CASE WHEN s.status = 'pending_payment'
                             AND r.id IS NULL THEN 1 ELSE 0 END) as pending,
                    SUM(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END) as paid
                FROM submissions s
                LEFT JOIN receipt r ON r.submission_id = s.id
                {dash_where}
            """, dash_params)
            summary = cur.fetchone()

    # แปลงวันที่และตัวเลขก่อนส่งกลับ
    for item in items:
        item["submitted_at"] = date_to_str(item["submitted_at"])
        item["created_at"]   = date_to_str(item["created_at"])
        item["due_date"]     = date_to_str(item["due_date"])
        item["net_amount"]   = float(item["net_amount"] or 0)

    return jsonify({
        "success": True,
        "data": {
            "items": items,
            "summary": {
                "total":   int(summary["total"]   or 0),
                "draft":   int(summary["draft"]   or 0),
                "pending": int(summary["pending"] or 0),
                "paid":    int(summary["paid"]    or 0)
            },
            "pagination": {
                "page":        page,
                "per_page":    per_page,
                "total":       total,
                "total_pages": -(-total // per_page)  # ceiling division
            }
        }
    }), 200


# ════════════════════════════════════════════════════════
# 5.2 ดู/แก้ไขรายละเอียดใบยื่น
# ════════════════════════════════════════════════════════

@admin_bp.route("/submissions/<submission_id>", methods=["GET"])
@jwt_required()
@require_admin
def get_submission_detail(submission_id):
    """
    ดูรายละเอียดใบยื่นแบบครบทุก Step
    Request: GET /api/admin/submissions/<id>
    """

    with get_db() as db:
        with db.cursor() as cur:

            # ดึงใบยื่นหลัก
            cur.execute("""
                SELECT s.*,
                       CASE WHEN r.id IS NOT NULL THEN 'paid'
                            ELSE s.status END AS actual_status
                FROM submissions s
                LEFT JOIN receipt r ON r.submission_id = s.id
                WHERE s.id = %s
            """, (submission_id,))
            submission = cur.fetchone()

            if not submission:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND",
                              "message": "ไม่พบใบยื่นแบบ"}
                }), 404

            # ดึงใบอนุญาตของใบยื่นนี้ (ตาราง licenses ไม่ใช่ licensee_master
            # ซึ่งเป็นทะเบียนใบอนุญาตกลางของ กสทช. คนละความหมายกัน)
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
                    SELECT id, license_id, field_key, label, amount, is_custom
                    FROM   license_incomes
                    WHERE  license_id IN ({placeholders})
                """, license_ids)
                for row in cur.fetchall():
                    incomes_by_license.setdefault(row["license_id"], []).append({
                        "id":        row["id"],
                        "field_key": row["field_key"],
                        "label":     row["label"],
                        "amount":    float(row["amount"] or 0),
                        "is_custom": bool(row["is_custom"]),
                    })

            for lic in licenses:
                lic["incomes"] = incomes_by_license.get(lic["id"], [])
                lic["fee_amount"] = float(lic["fee_amount"] or 0)
                lic["deduction_amount"] = float(lic["deduction_amount"] or 0)

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

            # ดึงใบแจ้งหนี้และใบเสร็จ
            cur.execute(
                "SELECT * FROM invoice WHERE submission_id = %s LIMIT 1",
                (submission_id,)
            )
            invoice = cur.fetchone()

            cur.execute(
                "SELECT * FROM receipt WHERE submission_id = %s LIMIT 1",
                (submission_id,)
            )
            receipt = cur.fetchone()

    # [FIX] เช็คเอกสารแนบครบ 3 ไหม ให้ตรงกับ pending_attach ของหน้ารายการ
    if submission["actual_status"] == "pending_payment" and len(attachments) < 3:
        submission["actual_status"] = "pending_attach"

    # แปลงวันที่
    for key in ["period_start", "period_end", "due_date",
                "submitted_at", "created_at", "updated_at"]:
        if submission.get(key):
            submission[key] = date_to_str(submission[key])

    for field in ["net_amount", "fund_amount", "vat_amount",
                  "extra_amount", "total_income"]:
        if submission.get(field) is not None:
            submission[field] = float(submission[field])

    return jsonify({
        "success": True,
        "data": {
            "submission":    submission,
            "licenses":      licenses,
            "other_incomes": [
                {**o, "amount": float(o["amount"] or 0)}
                for o in other_incomes
            ],
            "attachments": [
                {
                    "id":          a["id"],
                    "doc_type":    a["doc_type"],
                    "file_name":   a["file_name"],
                    "file_size":   a["file_size"],
                    "uploaded_at": date_to_str(a["uploaded_at"])
                }
                for a in attachments
            ],
            "invoice": invoice,
            "receipt":  receipt
        }
    }), 200


@admin_bp.route("/submissions/<submission_id>", methods=["PUT"])
@jwt_required()
@require_admin
def update_submission(submission_id):
    """
    แอดมินแก้ไขใบยื่น — ทำได้ทุกสถานะ
    Request: PUT /api/admin/submissions/<id>
    ทุกการแก้ไขบันทึกลง audit_logs อัตโนมัติ
    """

    admin_email = get_jwt_identity()
    data        = request.get_json()

    with get_db() as db:
        with db.cursor() as cur:

            # ดึงค่าเดิมก่อนแก้ (เพื่อ audit log)
            cur.execute(
                "SELECT * FROM submissions WHERE id = %s",
                (submission_id,)
            )
            old = cur.fetchone()

            if not old:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND",
                              "message": "ไม่พบใบยื่นแบบ"}
                }), 404

            # ── อัปเดตข้อมูลที่ส่งมา ─────────────────
            updatable = [
                "operator_name", "total_income", "total_income_financial",
                "deduction_amount",
                "fund_amount", "vat_amount", "extra_amount", "net_amount",
                "auditor_name", "auditor_license", "auditor_office",
                "audited_date"
            ]

            # สร้าง SET clause เฉพาะ field ที่ส่งมา
            set_parts = []
            set_params = []
            changes = {}

            for field in updatable:
                if field in data:
                    set_parts.append(f"{field} = %s")
                    set_params.append(data[field])
                    # บันทึกการเปลี่ยนแปลง
                    if str(old.get(field)) != str(data[field]):
                        changes[field] = {
                            "old": str(old.get(field)),
                            "new": str(data[field])
                        }

            if set_parts:
                cur.execute(
                    f"UPDATE submissions SET {', '.join(set_parts)} WHERE id = %s",
                    set_params + [submission_id]
                )

        # บันทึก Audit Log
        if changes:
            save_audit_log(
                db, admin_email,
                "แก้ไขใบยื่นแบบ",
                "submissions",
                submission_id,
                changes,
                record_label=old.get("operator_name")
            )

        db.commit()

    return jsonify({
        "success": True,
        "data": {"message": "แก้ไขสำเร็จ"}
    }), 200


@admin_bp.route("/submissions", methods=["DELETE"])
@jwt_required()
@require_admin
def delete_submissions():
    """
    ลบใบยื่นหลายรายการพร้อมกัน
    Request: DELETE /api/admin/submissions
    Body:    { "ids": ["uuid1", "uuid2"] }
    CASCADE จะลบ licenses, incomes, attachments ที่เชื่อมอยู่ด้วย
    """

    admin_email = get_jwt_identity()
    data        = request.get_json()
    ids         = data.get("ids", [])

    if not ids:
        return jsonify({
            "success": False,
            "error": {"code": "MISSING_IDS",
                      "message": "กรุณาระบุ id ที่ต้องการลบ"}
        }), 400

    with get_db() as db:
        with db.cursor() as cur:
            # ดึงข้อมูลก่อนลบ (ชื่อบริษัท/ปีบัญชี) เพื่อบันทึก audit log ให้ละเอียด
            placeholders = ",".join(["%s"] * len(ids))
            cur.execute(
                f"SELECT * FROM submissions WHERE id IN ({placeholders})",
                ids
            )
            old_by_id = {row["id"]: row for row in cur.fetchall()}

            # ลบทีละ id (CASCADE ลบลูกให้อัตโนมัติ)
            for sid in ids:
                cur.execute(
                    "DELETE FROM submissions WHERE id = %s",
                    (sid,)
                )

        # Audit Log — บันทึกทีละรายการ ระบุปีบัญชีและชื่อบริษัทที่ถูกลบ
        for sid in ids:
            old = old_by_id.get(sid)
            operator_name = old.get("operator_name") if old else None
            fiscal_year   = old.get("fiscal_year") if old else None
            label = f"ลบแบบยื่นปี {fiscal_year} ของบริษัท {operator_name}" if old \
                else "ลบแบบยื่นแบบ (ไม่พบข้อมูลเดิม)"
            save_audit_log(
                db, admin_email,
                label,
                "submissions",
                sid,
                {"deleted": dict(old)} if old else None,
                record_label=operator_name
            )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"deleted": len(ids)}
    }), 200


# ════════════════════════════════════════════════════════
# 5.2b ไฟล์แนบ (Attachments) — ดาวน์โหลด/ลบ
# nginx บล็อกการเข้าถึง /uploads/ ตรงๆ (ดู nginx.conf) ต้องผ่าน
# endpoint นี้เท่านั้น เพื่อตรวจ JWT ก่อนส่งไฟล์
# ════════════════════════════════════════════════════════

@admin_bp.route("/attachments/<attachment_id>/download", methods=["GET"])
@jwt_required()
@require_admin
def download_attachment(attachment_id):
    """ดาวน์โหลดไฟล์แนบ"""
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "SELECT storage_path, file_name, mime_type "
                "FROM document_attachments WHERE id = %s",
                (attachment_id,)
            )
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


@admin_bp.route("/attachments/<attachment_id>", methods=["DELETE"])
@jwt_required()
@require_admin
def delete_attachment(attachment_id):
    """ลบไฟล์แนบ (ทั้งแถวใน DB และไฟล์จริงบน server)"""
    admin_email = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT da.storage_path, da.file_name, s.operator_name
                FROM   document_attachments da
                JOIN   submissions s ON s.id = da.submission_id
                WHERE  da.id = %s
            """, (attachment_id,))
            att = cur.fetchone()

            if not att:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND", "message": "ไม่พบไฟล์แนบ"}
                }), 404

            cur.execute("DELETE FROM document_attachments WHERE id = %s", (attachment_id,))

        save_audit_log(
            db, admin_email,
            f"ลบไฟล์แนบ {att['file_name']} ของบริษัท {att.get('operator_name')}",
            "document_attachments", attachment_id,
            {"file_name": att.get("file_name"), "storage_path": att.get("storage_path")},
            record_label=att.get("operator_name")
        )
        db.commit()

    try:
        if att.get("storage_path") and os.path.exists(att["storage_path"]):
            os.remove(att["storage_path"])
    except OSError:
        pass

    return jsonify({
        "success": True,
        "data": {"message": "ลบไฟล์เรียบร้อยแล้ว"}
    }), 200


# ════════════════════════════════════════════════════════
# 5.3 จัดการผู้ประกอบการ (Taxpayer CRUD)
# ════════════════════════════════════════════════════════

@admin_bp.route("/taxpayers", methods=["GET"])
@jwt_required()
@require_admin
def get_taxpayers():
    """ดูรายการผู้ประกอบการทั้งหมด"""

    search   = request.args.get("search", "").strip()
    year     = request.args.get("year", type=int)
    page     = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 100, type=int)

    conditions = []
    params     = []

    if search:
        conditions.append(
            "(tax_id LIKE %s OR operator_name LIKE %s)"
        )
        params += [f"%{search}%", f"%{search}%"]

    if year:
        conditions.append("fiscal_year = %s")
        params.append(year)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(f"""
                SELECT id, tax_id, operator_name, email, address,
                       fiscal_year, ref_no, period_start,
                       period_end, due_date, updated_at
                FROM taxpayer_master
                {where}
                ORDER BY fiscal_year DESC, operator_name
                LIMIT %s OFFSET %s
            """, params + [per_page, (page - 1) * per_page])
            taxpayers = cur.fetchall()

    for t in taxpayers:
        t["period_start"] = date_to_str(t["period_start"])
        t["period_end"]   = date_to_str(t["period_end"])
        t["due_date"]     = date_to_str(t["due_date"])
        t["updated_at"]   = date_to_str(t["updated_at"])

    return jsonify({
        "success": True,
        "data": {"taxpayers": taxpayers, "total": len(taxpayers)}
    }), 200


@admin_bp.route("/taxpayers", methods=["POST"])
@jwt_required()
@require_admin
def create_taxpayer():
    """เพิ่มผู้ประกอบการใหม่"""

    admin_email = get_jwt_identity()
    data        = request.get_json()

    required = ["tax_id", "operator_name", "fiscal_year"]
    for field in required:
        if not data.get(field):
            return jsonify({
                "success": False,
                "error": {"code": "MISSING_FIELDS",
                          "message": f"กรุณากรอก {field}"}
            }), 400

    with get_db() as db:
        with db.cursor() as cur:
            try:
                cur.execute("""
                    INSERT INTO taxpayer_master
                        (tax_id, operator_name, fiscal_year,
                         ref_no, period_start, period_end, due_date)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    data["tax_id"],
                    data["operator_name"],
                    data["fiscal_year"],
                    data.get("ref_no"),
                    data.get("period_start"),
                    data.get("period_end"),
                    data.get("due_date")
                ))

                cur.execute(
                    "SELECT id FROM taxpayer_master WHERE tax_id = %s AND fiscal_year = %s",
                    (data["tax_id"], data["fiscal_year"])
                )
                new_id = cur.fetchone()["id"]

            except Exception as e:
                if "Duplicate entry" in str(e):
                    return jsonify({
                        "success": False,
                        "error": {"code": "DUPLICATE",
                                  "message": "มีข้อมูลปีบัญชีนี้อยู่แล้ว"}
                    }), 400
                raise

        save_audit_log(
            db, admin_email, "เพิ่มผู้ประกอบการ",
            "taxpayer_master", new_id, data,
            record_label=data.get("operator_name")
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"id": new_id}
    }), 201


@admin_bp.route("/taxpayers/<taxpayer_id>", methods=["PUT"])
@jwt_required()
@require_admin
def update_taxpayer(taxpayer_id):
    """แก้ไขข้อมูลผู้ประกอบการ"""

    admin_email = get_jwt_identity()
    data        = request.get_json()

    with get_db() as db:
        with db.cursor() as cur:

            cur.execute(
                "SELECT * FROM taxpayer_master WHERE id = %s",
                (taxpayer_id,)
            )
            old = cur.fetchone()
            if not old:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND",
                              "message": "ไม่พบผู้ประกอบการ"}
                }), 404

            updatable = ["operator_name", "email", "address", "ref_no",
                         "period_start", "period_end", "due_date"]
            set_parts  = []
            set_params = []
            changes    = {}

            for field in updatable:
                if field in data:
                    set_parts.append(f"{field} = %s")
                    set_params.append(data[field])
                    if str(old.get(field)) != str(data[field]):
                        changes[field] = {
                            "old": str(old.get(field)),
                            "new": str(data[field])
                        }

            if set_parts:
                cur.execute(
                    f"UPDATE taxpayer_master SET {', '.join(set_parts)} WHERE id = %s",
                    set_params + [taxpayer_id]
                )

        if changes:
            save_audit_log(
                db, admin_email, "แก้ไขผู้ประกอบการ",
                "taxpayer_master", taxpayer_id, changes,
                record_label=old.get("operator_name")
            )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"message": "แก้ไขสำเร็จ"}
    }), 200


@admin_bp.route("/taxpayers/<taxpayer_id>", methods=["DELETE"])
@jwt_required()
@require_admin
def delete_taxpayer(taxpayer_id):
    """ลบผู้ประกอบการ"""

    admin_email = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "SELECT * FROM taxpayer_master WHERE id = %s",
                (taxpayer_id,)
            )
            old = cur.fetchone()

            cur.execute(
                "DELETE FROM taxpayer_master WHERE id = %s",
                (taxpayer_id,)
            )

        label = (f"ลบข้อมูลผู้ประกอบการปี {old.get('fiscal_year')} ของบริษัท {old.get('operator_name')}"
                 if old else "ลบข้อมูลผู้ประกอบการ (ไม่พบข้อมูลเดิม)")
        save_audit_log(
            db, admin_email, label,
            "taxpayer_master", taxpayer_id,
            {"deleted": dict(old)} if old else None,
            record_label=old.get("operator_name") if old else None
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"message": "ลบสำเร็จ"}
    }), 200


# ════════════════════════════════════════════════════════
# 5.4 จัดการใบอนุญาต (Licensee CRUD)
# ════════════════════════════════════════════════════════

@admin_bp.route("/licensees", methods=["GET"])
@jwt_required()
@require_admin
def get_licensees():
    """ดูรายการใบอนุญาตทั้งหมด"""

    search   = request.args.get("search", "").strip()
    status   = request.args.get("status")
    page     = request.args.get("page", 1, type=int)
    per_page = request.args.get("per_page", 100, type=int)

    conditions = []
    params     = []

    if search:
        conditions.append(
            "(license_no LIKE %s OR company_name LIKE %s OR tax_id LIKE %s)"
        )
        params += [f"%{search}%"] * 3

    if status:
        conditions.append("license_status = %s")
        params.append(status)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(f"""
                SELECT id, license_no, tax_id, company_name,
                       licensee_type, license_status,
                       start_date, end_date, updated_at
                FROM licensee_master
                {where}
                ORDER BY license_no
                LIMIT %s OFFSET %s
            """, params + [per_page, (page - 1) * per_page])
            licensees = cur.fetchall()

    for lic in licensees:
        lic["start_date"] = date_to_str(lic["start_date"])
        lic["end_date"]   = date_to_str(lic["end_date"])
        lic["updated_at"] = date_to_str(lic["updated_at"])

    return jsonify({
        "success": True,
        "data": {"licensees": licensees, "total": len(licensees)}
    }), 200


@admin_bp.route("/licensees", methods=["POST"])
@jwt_required()
@require_admin
def create_licensee():
    """เพิ่มใบอนุญาตใหม่"""

    admin_email = get_jwt_identity()
    data        = request.get_json()

    required = ["license_no", "tax_id", "company_name"]
    for field in required:
        if not data.get(field):
            return jsonify({
                "success": False,
                "error": {"code": "MISSING_FIELDS",
                          "message": f"กรุณากรอก {field}"}
            }), 400

    with get_db() as db:
        with db.cursor() as cur:
            try:
                cur.execute("""
                    INSERT INTO licensee_master
                        (license_no, tax_id, company_name,
                         licensee_type, license_status,
                         start_date, end_date)
                    VALUES (%s, %s, %s, %s, %s, %s, %s)
                """, (
                    data["license_no"],
                    data["tax_id"],
                    data["company_name"],
                    data.get("licensee_type"),
                    data.get("license_status", "active"),
                    data.get("start_date"),
                    data.get("end_date")
                ))
                cur.execute(
                    "SELECT id FROM licensee_master WHERE license_no = %s",
                    (data["license_no"],)
                )
                new_id = cur.fetchone()["id"]

            except Exception as e:
                if "Duplicate entry" in str(e):
                    return jsonify({
                        "success": False,
                        "error": {"code": "DUPLICATE",
                                  "message": "เลขใบอนุญาตนี้มีในระบบแล้ว"}
                    }), 400
                raise

        save_audit_log(
            db, admin_email, "เพิ่มใบอนุญาต",
            "licensee_master", new_id, data,
            record_label=data.get("company_name") or data.get("license_no")
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"id": new_id}
    }), 201


@admin_bp.route("/licensees/<licensee_id>", methods=["PUT"])
@jwt_required()
@require_admin
def update_licensee(licensee_id):
    """แก้ไขใบอนุญาต"""

    admin_email = get_jwt_identity()
    data        = request.get_json()

    with get_db() as db:
        with db.cursor() as cur:

            cur.execute(
                "SELECT * FROM licensee_master WHERE id = %s",
                (licensee_id,)
            )
            old = cur.fetchone()
            if not old:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND",
                              "message": "ไม่พบใบอนุญาต"}
                }), 404

            updatable = ["company_name", "licensee_type",
                         "license_status", "start_date", "end_date"]
            set_parts  = []
            set_params = []
            changes    = {}

            for field in updatable:
                if field in data:
                    set_parts.append(f"{field} = %s")
                    set_params.append(data[field])
                    if str(old.get(field)) != str(data[field]):
                        changes[field] = {
                            "old": str(old.get(field)),
                            "new": str(data[field])
                        }

            if set_parts:
                cur.execute(
                    f"UPDATE licensee_master SET {', '.join(set_parts)} WHERE id = %s",
                    set_params + [licensee_id]
                )

        if changes:
            save_audit_log(
                db, admin_email, "แก้ไขใบอนุญาต",
                "licensee_master", licensee_id, changes,
                record_label=old.get("company_name") or old.get("license_no")
            )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"message": "แก้ไขสำเร็จ"}
    }), 200


@admin_bp.route("/licensees/<licensee_id>", methods=["DELETE"])
@jwt_required()
@require_admin
def delete_licensee(licensee_id):
    """ลบใบอนุญาต"""

    admin_email = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "SELECT * FROM licensee_master WHERE id = %s",
                (licensee_id,)
            )
            old = cur.fetchone()

            cur.execute(
                "DELETE FROM licensee_master WHERE id = %s",
                (licensee_id,)
            )

        label = (f"ลบใบอนุญาตเลขที่ {old.get('license_no')} ของบริษัท {old.get('company_name')}"
                 if old else "ลบใบอนุญาต (ไม่พบข้อมูลเดิม)")
        save_audit_log(
            db, admin_email, label,
            "licensee_master", licensee_id,
            {"deleted": dict(old)} if old else None,
            record_label=(old.get("company_name") or old.get("license_no")) if old else None
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"message": "ลบสำเร็จ"}
    }), 200


# ════════════════════════════════════════════════════════
# 5.4b บัญชีผู้ประกอบการ (Operator Accounts) — อีเมลสำหรับรับ OTP
# แยกต่างหากจาก taxpayer_master.email — ถ้า tax_id มีแถวอยู่ที่นี่
# ระบบ login (auth.py) จะใช้อีเมลนี้แทนอีเมลใน taxpayer_master เสมอ
# ════════════════════════════════════════════════════════

@admin_bp.route("/operator-accounts", methods=["GET"])
@jwt_required()
@require_admin
def get_operator_accounts():
    """ดูรายการบัญชีผู้ประกอบการทั้งหมด"""
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, tax_id, operator_name, email, created_at
                FROM operator_accounts
                ORDER BY created_at DESC
            """)
            accounts = cur.fetchall()

    for a in accounts:
        a["created_at"] = date_to_str(a["created_at"])

    return jsonify({
        "success": True,
        "data": {"accounts": accounts, "total": len(accounts)}
    }), 200


@admin_bp.route("/operator-accounts", methods=["POST"])
@jwt_required()
@require_admin
def create_operator_account():
    """เพิ่มบัญชีผู้ประกอบการทีละรายการ (tax_id + operator_name + email)"""
    admin_email = get_jwt_identity()
    data        = request.get_json() or {}

    tax_id        = str(data.get("tax_id", "")).strip().replace("-", "")
    operator_name = str(data.get("operator_name", "")).strip()
    email         = str(data.get("email", "")).strip()

    if not tax_id or not tax_id.isdigit() or len(tax_id) != 13:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_TAX_ID",
                      "message": "เลขประจำตัวผู้เสียภาษีต้องเป็นตัวเลข 13 หลัก"}
        }), 400

    if not operator_name:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_OPERATOR_NAME",
                      "message": "กรุณาระบุชื่อผู้ประกอบการ"}
        }), 400

    if not email or not EMAIL_RE.match(email):
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_EMAIL",
                      "message": "รูปแบบอีเมลไม่ถูกต้อง"}
        }), 400

    with get_db() as db:
        with db.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO operator_accounts (tax_id, operator_name, email) VALUES (%s, %s, %s)",
                    (tax_id, operator_name, email)
                )
                cur.execute(
                    "SELECT id FROM operator_accounts WHERE tax_id = %s",
                    (tax_id,)
                )
                new_id = cur.fetchone()["id"]

            except Exception as e:
                if "Duplicate entry" in str(e):
                    return jsonify({
                        "success": False,
                        "error": {"code": "DUPLICATE",
                                  "message": "เลขประจำตัวผู้เสียภาษีนี้มีบัญชีอยู่แล้ว"}
                    }), 400
                raise

        save_audit_log(
            db, admin_email, "เพิ่มบัญชีผู้ประกอบการ",
            "operator_accounts", new_id,
            {"tax_id": tax_id, "operator_name": operator_name, "email": email},
            record_label=f"{tax_id} ({email})"
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"id": new_id}
    }), 201


@admin_bp.route("/operator-accounts/<account_id>", methods=["PUT"])
@jwt_required()
@require_admin
def update_operator_account(account_id):
    """แก้ไขอีเมลรับ OTP ของบัญชีผู้ประกอบการ"""
    admin_email = get_jwt_identity()
    data        = request.get_json() or {}

    email = str(data.get("email", "")).strip()
    if not email or not EMAIL_RE.match(email):
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_EMAIL",
                      "message": "รูปแบบอีเมลไม่ถูกต้อง"}
        }), 400

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "SELECT * FROM operator_accounts WHERE id = %s",
                (account_id,)
            )
            old = cur.fetchone()

            if not old:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND", "message": "ไม่พบบัญชีผู้ประกอบการ"}
                }), 404

            try:
                cur.execute(
                    "UPDATE operator_accounts SET email = %s WHERE id = %s",
                    (email, account_id)
                )
            except Exception as e:
                if "Duplicate entry" in str(e):
                    return jsonify({
                        "success": False,
                        "error": {"code": "DUPLICATE", "message": "อีเมลนี้ถูกใช้กับบัญชีอื่นแล้ว"}
                    }), 400
                raise

        if old["email"] != email:
            save_audit_log(
                db, admin_email,
                f"แก้ไขอีเมลบัญชีผู้ประกอบการของบริษัท {old.get('operator_name') or old.get('tax_id')}",
                "operator_accounts", account_id,
                {"email": {"old": old["email"], "new": email}},
                record_label=f"{old['tax_id']} ({email})"
            )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"message": "แก้ไขสำเร็จ"}
    }), 200


@admin_bp.route("/operator-accounts/<account_id>", methods=["DELETE"])
@jwt_required()
@require_admin
def delete_operator_account(account_id):
    """ลบบัญชีผู้ประกอบการ"""
    admin_email = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(
                "SELECT * FROM operator_accounts WHERE id = %s",
                (account_id,)
            )
            old = cur.fetchone()

            cur.execute(
                "DELETE FROM operator_accounts WHERE id = %s",
                (account_id,)
            )

        label = (f"ลบบัญชีผู้ประกอบการ {old.get('email')} ของบริษัท {old.get('operator_name') or old.get('tax_id')}"
                 if old else "ลบบัญชีผู้ประกอบการ (ไม่พบข้อมูลเดิม)")
        save_audit_log(
            db, admin_email, label,
            "operator_accounts", account_id,
            {"deleted": dict(old)} if old else None,
            record_label=f"{old['tax_id']} ({old['email']})" if old else None
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"message": "ลบสำเร็จ"}
    }), 200


# ════════════════════════════════════════════════════════
# 5.4c จัดการบัญชีผู้ดูแลระบบ (admin_users) — super_admin เท่านั้น
# ════════════════════════════════════════════════════════

@admin_bp.route("/admins", methods=["GET"])
@jwt_required()
@require_admin
@require_super_admin
def get_admins():
    """ดูรายชื่อผู้ดูแลระบบทั้งหมด"""
    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("""
                SELECT id, email, full_name, role, is_active, created_at, last_login_at
                FROM admin_users
                ORDER BY created_at DESC
            """)
            admins = cur.fetchall()

    for a in admins:
        a["created_at"]    = date_to_str(a["created_at"])
        a["last_login_at"] = date_to_str(a["last_login_at"])

    return jsonify({
        "success": True,
        "data": {"admins": admins, "total": len(admins)}
    }), 200


@admin_bp.route("/admins", methods=["POST"])
@jwt_required()
@require_admin
@require_super_admin
def create_admin():
    """เพิ่มบัญชีผู้ดูแลระบบใหม่"""
    admin_email = get_jwt_identity()
    data        = request.get_json() or {}

    email     = str(data.get("email", "")).strip().lower()
    password  = str(data.get("password", ""))
    full_name = str(data.get("full_name", "")).strip()
    role      = str(data.get("role", "admin")).strip()

    if not email or not EMAIL_RE.match(email):
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_EMAIL", "message": "รูปแบบอีเมลไม่ถูกต้อง"}
        }), 400

    if not password or len(password) < 8:
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_PASSWORD", "message": "รหัสผ่านต้องมีอย่างน้อย 8 ตัวอักษร"}
        }), 400

    if role not in ("super_admin", "admin"):
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_ROLE", "message": "role ต้องเป็น super_admin หรือ admin"}
        }), 400

    password_hash = bcrypt.hashpw(password.encode("utf-8"), bcrypt.gensalt(rounds=12)).decode("utf-8")

    with get_db() as db:
        with db.cursor() as cur:
            try:
                cur.execute(
                    "INSERT INTO admin_users (email, password_hash, full_name, role) VALUES (%s, %s, %s, %s)",
                    (email, password_hash, full_name, role)
                )
                cur.execute("SELECT id FROM admin_users WHERE email = %s", (email,))
                new_id = cur.fetchone()["id"]
            except Exception as e:
                if "Duplicate entry" in str(e):
                    return jsonify({
                        "success": False,
                        "error": {"code": "DUPLICATE", "message": "อีเมลนี้มีบัญชีผู้ดูแลระบบอยู่แล้ว"}
                    }), 400
                raise

        save_audit_log(
            db, admin_email, f"เพิ่มบัญชีผู้ดูแลระบบ {email} ({role})",
            "admin_users", new_id,
            {"email": email, "full_name": full_name, "role": role},
            record_label=email
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"id": new_id}
    }), 201


@admin_bp.route("/admins/<admin_id>/role", methods=["PUT"])
@jwt_required()
@require_admin
@require_super_admin
def update_admin_role(admin_id):
    """เปลี่ยน role ของผู้ดูแลระบบ (super_admin/admin)"""
    admin_email = get_jwt_identity()
    data        = request.get_json() or {}

    role = str(data.get("role", "")).strip()
    if role not in ("super_admin", "admin"):
        return jsonify({
            "success": False,
            "error": {"code": "INVALID_ROLE", "message": "role ต้องเป็น super_admin หรือ admin"}
        }), 400

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("SELECT * FROM admin_users WHERE id = %s", (admin_id,))
            old = cur.fetchone()
            if not old:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND", "message": "ไม่พบบัญชีผู้ดูแลระบบ"}
                }), 404

            # กันไม่ให้ระบบเหลือ super_admin 0 คน
            if old["role"] == "super_admin" and role != "super_admin":
                cur.execute(
                    "SELECT COUNT(*) AS c FROM admin_users WHERE role = 'super_admin'"
                )
                if cur.fetchone()["c"] <= 1:
                    return jsonify({
                        "success": False,
                        "error": {"code": "LAST_SUPER_ADMIN",
                                  "message": "ต้องมีผู้ดูแลระบบระดับสูงสุดอย่างน้อย 1 คนเสมอ"}
                    }), 400

            cur.execute(
                "UPDATE admin_users SET role = %s WHERE id = %s",
                (role, admin_id)
            )

        if old["role"] != role:
            save_audit_log(
                db, admin_email, f"เปลี่ยน role ผู้ดูแลระบบ {old['email']}",
                "admin_users", admin_id,
                {"role": {"old": old["role"], "new": role}},
                record_label=old["email"]
            )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"message": "แก้ไขสำเร็จ"}
    }), 200


@admin_bp.route("/admins/<admin_id>", methods=["DELETE"])
@jwt_required()
@require_admin
@require_super_admin
def delete_admin(admin_id):
    """ลบบัญชีผู้ดูแลระบบ"""
    admin_email = get_jwt_identity()

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute("SELECT * FROM admin_users WHERE id = %s", (admin_id,))
            old = cur.fetchone()
            if not old:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND", "message": "ไม่พบบัญชีผู้ดูแลระบบ"}
                }), 404

            if old["email"] == admin_email:
                return jsonify({
                    "success": False,
                    "error": {"code": "CANNOT_DELETE_SELF", "message": "ไม่สามารถลบบัญชีของตัวเองได้"}
                }), 400

            if old["role"] == "super_admin":
                cur.execute(
                    "SELECT COUNT(*) AS c FROM admin_users WHERE role = 'super_admin'"
                )
                if cur.fetchone()["c"] <= 1:
                    return jsonify({
                        "success": False,
                        "error": {"code": "LAST_SUPER_ADMIN",
                                  "message": "ต้องมีผู้ดูแลระบบระดับสูงสุดอย่างน้อย 1 คนเสมอ"}
                    }), 400

            cur.execute("DELETE FROM admin_users WHERE id = %s", (admin_id,))

        save_audit_log(
            db, admin_email, f"ลบบัญชีผู้ดูแลระบบ {old['email']}",
            "admin_users", admin_id,
            {"deleted": {"email": old["email"], "role": old["role"]}},
            record_label=old["email"]
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {"message": "ลบสำเร็จ"}
    }), 200


# ════════════════════════════════════════════════════════
# 5.5 บันทึกรับเงิน (เปลี่ยน status → paid)
# ════════════════════════════════════════════════════════

@admin_bp.route("/receipts", methods=["POST"])
@jwt_required()
@require_admin
def create_receipt():
    """
    บันทึกรับเงินจากผู้ประกอบการ
    เมื่อบันทึกแล้ว status ของ submissions = paid อัตโนมัติ
    (คำนวณจากการมีอยู่ของ receipt ไม่ใช่ dropdown)
    """

    admin_email = get_jwt_identity()
    data        = request.get_json()

    required = ["submission_id", "amount", "received_at"]
    for field in required:
        if not data.get(field):
            return jsonify({
                "success": False,
                "error": {"code": "MISSING_FIELDS",
                          "message": f"กรุณากรอก {field}"}
            }), 400

    with get_db() as db:
        with db.cursor() as cur:

            # ตรวจว่าใบยื่นมีอยู่จริง
            cur.execute(
                "SELECT id, status, operator_name FROM submissions WHERE id = %s",
                (data["submission_id"],)
            )
            submission = cur.fetchone()

            if not submission:
                return jsonify({
                    "success": False,
                    "error": {"code": "NOT_FOUND",
                              "message": "ไม่พบใบยื่นแบบ"}
                }), 404

            try:
                cur.execute("""
                    INSERT INTO receipt
                        (submission_id, receipt_no,
                         amount, received_at, recorded_by)
                    VALUES (%s, %s, %s, %s, %s)
                """, (
                    data["submission_id"],
                    data.get("receipt_no"),
                    float(data["amount"]),
                    data["received_at"],
                    admin_email
                ))

            except Exception as e:
                if "Duplicate entry" in str(e):
                    return jsonify({
                        "success": False,
                        "error": {"code": "DUPLICATE",
                                  "message": "บันทึกรับเงินไปแล้ว"}
                    }), 400
                raise

        save_audit_log(
            db, admin_email,
            "บันทึกรับเงิน",
            "receipt",
            data["submission_id"],
            {
                "amount":      data["amount"],
                "received_at": data["received_at"],
                "receipt_no":  data.get("receipt_no")
            },
            record_label=submission.get("operator_name")
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {
            "message": "บันทึกรับเงินสำเร็จ สถานะใบยื่นเปลี่ยนเป็น paid แล้ว"
        }
    }), 201


# ════════════════════════════════════════════════════════
# 5.6 Audit Logs
# ════════════════════════════════════════════════════════

@admin_bp.route("/audit-logs", methods=["POST"])
@jwt_required()
@require_admin
def post_audit_log():
    """
    บันทึก Audit Log จากฝั่ง frontend (เช่น import สำเร็จ, bulk delete)
    Request: POST /api/admin/audit-logs { action, table_name, record_id, changes }
    """
    body = request.get_json(silent=True) or {}
    admin_email = get_jwt_identity()

    with get_db() as db:
        save_audit_log(
            db, admin_email,
            body.get("action"),
            body.get("table_name"),
            body.get("record_id"),
            body.get("changes"),
        )
        db.commit()

    return jsonify({"success": True}), 201


@admin_bp.route("/audit-logs", methods=["GET"])
@jwt_required()
@require_admin
def get_audit_logs():
    """
    ดูประวัติการแก้ไขทั้งหมด
    Request: GET /api/admin/audit-logs?page=1&table=submissions
    เรียงจากล่าสุดก่อนเสมอ
    """

    page       = request.args.get("page", 1, type=int)
    table_name = request.args.get("table")
    per_page   = 50

    conditions = []
    params     = []

    if table_name:
        conditions.append("table_name = %s")
        params.append(table_name)

    where = "WHERE " + " AND ".join(conditions) if conditions else ""

    with get_db() as db:
        with db.cursor() as cur:
            cur.execute(f"""
                SELECT id, admin_email, action, table_name,
                       record_id, record_label, changes, created_at
                FROM audit_logs
                {where}
                ORDER BY created_at DESC
                LIMIT %s OFFSET %s
            """, params + [per_page, (page - 1) * per_page])
            logs = cur.fetchall()

            cur.execute(
                f"SELECT COUNT(*) as total FROM audit_logs {where}",
                params
            )
            total = cur.fetchone()["total"]

    for log in logs:
        if isinstance(log.get("created_at"), datetime):
            log["created_at"] = log["created_at"].strftime("%Y-%m-%d %H:%M:%S")
        else:
            log["created_at"] = date_to_str(log["created_at"])
        log["table_name_th"] = TABLE_NAME_TH.get(log["table_name"], log["table_name"])
        # changes ใน MySQL เก็บเป็น string แปลงกลับเป็น dict
        if log.get("changes") and isinstance(log["changes"], str):
            try:
                log["changes"] = json.loads(log["changes"])
            except Exception:
                pass

    return jsonify({
        "success": True,
        "data": {
            "logs":        logs,
            "total":       total,
            "total_pages": -(-total // per_page)
        }
    }), 200

# ════════════════════════════════════════════════════════
# Import Excel
# ════════════════════════════════════════════════════════

@admin_bp.route("/import/taxpayers", methods=["POST"])
@jwt_required()
@require_admin
def import_taxpayers_route():
    """
    Import Excel ผู้ประกอบการ
    mode=preview → ตรวจข้อมูล ยังไม่บันทึก
    mode=commit  → บันทึกจริง
    """
    admin_email = get_jwt_identity()

    if "file" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "NO_FILE",
                      "message": "กรุณาแนบไฟล์ Excel"}
        }), 400

    file = request.files["file"]
    mode = request.form.get("mode", "preview")

    rows, errors = parse_taxpayer_excel(file.stream)

    if mode == "preview":
        return jsonify({
            "success": True,
            "data": {
                "mode":         "preview",
                "total_rows":   len(rows) + len(errors),
                "valid_rows":   len(rows),
                "error_rows":   len(errors),
                "errors":       errors[:20],
                "preview_data": rows[:5]
            }
        }), 200

    if errors:
        return jsonify({
            "success": False,
            "error": {
                "code":    "VALIDATION_ERROR",
                "message": f"มีข้อผิดพลาด {len(errors)} แถว",
                "errors":  errors[:20]
            }
        }), 400

    with get_db() as db:
        result = import_taxpayers(db, rows)
        save_audit_log(
            db, admin_email,
            f"นำเข้าข้อมูลผู้ประกอบการจากไฟล์ {file.filename}",
            "taxpayer_master", None, {**result, "file_name": file.filename}
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {
            "mode":     "commit",
            "inserted": result["inserted"],
            "updated":  result["updated"],
            "message":  (
                f"Import สำเร็จ: "
                f"เพิ่มใหม่ {result['inserted']} แถว, "
                f"อัปเดต {result['updated']} แถว"
            )
        }
    }), 200


@admin_bp.route("/import/licensees", methods=["POST"])
@jwt_required()
@require_admin
def import_licensees_route():
    """Import Excel ใบอนุญาต"""
    admin_email = get_jwt_identity()

    if "file" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "NO_FILE",
                      "message": "กรุณาแนบไฟล์ Excel"}
        }), 400

    file = request.files["file"]
    mode = request.form.get("mode", "preview")

    rows, errors = parse_licensee_excel(file.stream)

    if mode == "preview":
        return jsonify({
            "success": True,
            "data": {
                "mode":         "preview",
                "total_rows":   len(rows) + len(errors),
                "valid_rows":   len(rows),
                "error_rows":   len(errors),
                "errors":       errors[:20],
                "preview_data": rows[:5]
            }
        }), 200

    if errors:
        return jsonify({
            "success": False,
            "error": {
                "code":    "VALIDATION_ERROR",
                "message": f"มีข้อผิดพลาด {len(errors)} แถว",
                "errors":  errors[:20]
            }
        }), 400

    with get_db() as db:
        result = import_licensees(db, rows)
        save_audit_log(
            db, admin_email,
            f"นำเข้าข้อมูลใบอนุญาตจากไฟล์ {file.filename}",
            "licensee_master", None, {**result, "file_name": file.filename}
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {
            "mode":     "commit",
            "inserted": result["inserted"],
            "updated":  result["updated"],
            "message":  (
                f"Import สำเร็จ: "
                f"เพิ่มใหม่ {result['inserted']} แถว, "
                f"อัปเดต {result['updated']} แถว"
            )
        }
    }), 200


@admin_bp.route("/import/operator-accounts", methods=["POST"])
@jwt_required()
@require_admin
def import_operator_accounts_route():
    """
    Import Excel บัญชีผู้ประกอบการ
    คอลัมน์: tax_id | operator_name | email
    mode=preview → ตรวจข้อมูล ยังไม่บันทึก
    mode=commit  → บันทึกจริง
    """
    admin_email = get_jwt_identity()

    if "file" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "NO_FILE",
                      "message": "กรุณาแนบไฟล์ Excel"}
        }), 400

    file = request.files["file"]
    mode = request.form.get("mode", "preview")

    rows, errors = parse_operator_account_excel(file.stream)

    if mode == "preview":
        return jsonify({
            "success": True,
            "data": {
                "mode":         "preview",
                "total_rows":   len(rows) + len(errors),
                "valid_rows":   len(rows),
                "error_rows":   len(errors),
                "errors":       errors[:20],
                "preview_data": rows[:5]
            }
        }), 200

    if errors:
        return jsonify({
            "success": False,
            "error": {
                "code":    "VALIDATION_ERROR",
                "message": f"มีข้อผิดพลาด {len(errors)} แถว",
                "errors":  errors[:20]
            }
        }), 400

    with get_db() as db:
        result = import_operator_accounts(db, rows)
        save_audit_log(
            db, admin_email,
            f"นำเข้าบัญชีผู้ประกอบการจากไฟล์ {file.filename}",
            "operator_accounts", None, {**result, "file_name": file.filename}
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {
            "mode":     "commit",
            "inserted": result["inserted"],
            "updated":  result["updated"],
            "message":  (
                f"Import สำเร็จ: "
                f"เพิ่มใหม่ {result['inserted']} แถว, "
                f"อัปเดต {result['updated']} แถว"
            )
        }
    }), 200


# ════════════════════════════════════════════════════════
# Export Excel
# ════════════════════════════════════════════════════════

@admin_bp.route("/export/taxpayers", methods=["GET"])
@jwt_required()
@require_admin
def export_taxpayers():
    """รายงานข้อมูลผู้ประกอบการ"""
    year      = request.args.get("year", type=int)
    year_from = request.args.get("year_from", type=int)
    year_to   = request.args.get("year_to", type=int)
    with get_db() as db:
        output = export_taxpayer_report(db, year=year, year_from=year_from, year_to=year_to)
    return send_excel_file(output, f"รายงานข้อมูลผู้ประกอบการ_{export_date_label()}.xlsx")


@admin_bp.route("/export/licensees", methods=["GET"])
@jwt_required()
@require_admin
def export_licensees_report():
    """รายงานข้อมูลใบอนุญาต"""
    year      = request.args.get("year", type=int)
    year_from = request.args.get("year_from", type=int)
    year_to   = request.args.get("year_to", type=int)
    status    = request.args.get("status")
    with get_db() as db:
        output = export_licensee_report(db, year=year, year_from=year_from, year_to=year_to, status=status)
    return send_excel_file(output, f"รายงานข้อมูลใบอนุญาต_{export_date_label()}.xlsx")


@admin_bp.route("/export/payments", methods=["GET"])
@jwt_required()
@require_admin
def export_payments():
    """รายงานชำระเงินกองทุน"""
    year      = request.args.get("year", type=int)
    year_from = request.args.get("year_from", type=int)
    year_to   = request.args.get("year_to", type=int)
    statuses  = request.args.getlist("status")
    with get_db() as db:
        output = export_payment_report(db, year=year, year_from=year_from, year_to=year_to,
                                        statuses=statuses or None)
    return send_excel_file(output, f"รายงานชำระเงินกองทุน_{export_date_label()}.xlsx")

@admin_bp.route("/import/contacts", methods=["POST"])
@jwt_required()
@require_admin
def import_contacts_route():
    """
    Import Excel ที่อยู่ผู้ประกอบการ
    คอลัมน์: เลขภาษี | ชื่อ | ที่อยู่ | เบอร์โทร | อีเมล
    mode=preview → ตรวจข้อมูล ยังไม่บันทึก
    mode=commit  → บันทึกจริง
    """
    admin_email = get_jwt_identity()

    if "file" not in request.files:
        return jsonify({
            "success": False,
            "error": {"code": "NO_FILE",
                      "message": "กรุณาแนบไฟล์ Excel"}
        }), 400

    file = request.files["file"]
    mode = request.form.get("mode", "preview")

    rows, errors = parse_contact_excel(file.stream)

    if mode == "preview":
        return jsonify({
            "success": True,
            "data": {
                "mode":         "preview",
                "total_rows":   len(rows) + len(errors),
                "valid_rows":   len(rows),
                "error_rows":   len(errors),
                "errors":       errors[:20],
                "preview_data": rows[:5]
            }
        }), 200

    if errors:
        return jsonify({
            "success": False,
            "error": {
                "code":    "VALIDATION_ERROR",
                "message": f"มีข้อผิดพลาด {len(errors)} แถว",
                "errors":  errors[:20]
            }
        }), 400

    with get_db() as db:
        result = import_contacts(db, rows)
        save_audit_log(
            db, admin_email,
            f"นำเข้าที่อยู่ผู้ประกอบการจากไฟล์ {file.filename}",
            "contact_master", None, {**result, "file_name": file.filename}
        )
        db.commit()

    return jsonify({
        "success": True,
        "data": {
            "mode":     "commit",
            "inserted": result["inserted"],
            "updated":  result["updated"],
            "message":  (
                f"Import สำเร็จ: "
                f"เพิ่มใหม่ {result['inserted']} แถว, "
                f"อัปเดต {result['updated']} แถว"
            )
        }
    }), 200