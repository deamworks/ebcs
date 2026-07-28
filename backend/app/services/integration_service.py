"""
เชื่อมต่อระบบภายนอก: Data Center (gen QR/Barcode) และ SAP/ZAT (ตั้งหนี้รอรับชำระ)

ยังไม่มี API spec จริงจากทั้งสองระบบ ตอนนี้เป็นโหมด mock ทั้งหมด — เรียกใช้
ได้เหมือนของจริง (return shape เดียวกัน) แค่ค่าที่ได้เป็นของปลอมและถูก log ไว้ที่
ตาราง integration_log เพื่อให้เห็นรูปร่าง flow ทั้งหมดตั้งแต่ตอนนี้

เมื่อได้ API spec จริง: แก้เฉพาะ branch "if INTEGRATION_MODE == 'real'" ในแต่ละ
ฟังก์ชันด้านล่างให้ยิง HTTP ไปยังระบบจริงแล้ว map response ให้ตรงกับ return shape
เดิม จุดที่เรียกใช้ฟังก์ชันเหล่านี้ (routes) ไม่ต้องแก้อะไรเลย
"""

import json
import os
import uuid

INTEGRATION_MODE = os.environ.get("INTEGRATION_MODE", "mock")


def _log(cur, submission_id, system, action, status, request_payload, response_payload):
    cur.execute("""
        INSERT INTO integration_log
            (submission_id, system, action, status, request_payload, response_payload)
        VALUES (%s, %s, %s, %s, %s, %s)
    """, (
        submission_id, system, action, status,
        json.dumps(request_payload, default=str, ensure_ascii=False),
        json.dumps(response_payload, default=str, ensure_ascii=False),
    ))


def send_to_datacenter(cur, submission):
    """
    ส่งข้อมูลใบยื่นไป Data Center เพื่อขอ reference สำหรับ gen QR/Barcode ที่ธนาคาร

    Returns: {"datacenter_ref": str}
    """
    if INTEGRATION_MODE == "real":
        raise NotImplementedError(
            "ยังไม่ได้เชื่อมต่อ Data Center จริง — ใส่ HTTP call ตรงนี้เมื่อได้ API spec"
        )

    result = {"datacenter_ref": f"MOCK-DC-{uuid.uuid4().hex[:10].upper()}"}
    _log(cur, submission["id"], "datacenter", "send_bill", "success", submission, result)
    return result


def send_to_sap(cur, submission):
    """
    ส่งข้อมูลใบนำส่งไป SAP (ZAT) เพื่อ "ตั้งหนี้รอรับชำระ"

    Returns: {"sap_doc_no": str}
    """
    if INTEGRATION_MODE == "real":
        raise NotImplementedError(
            "ยังไม่ได้เชื่อมต่อ SAP จริง — ใส่ HTTP call ตรงนี้เมื่อได้ API spec"
        )

    result = {"sap_doc_no": f"MOCK-SAP-{uuid.uuid4().hex[:10].upper()}"}
    _log(cur, submission["id"], "sap", "create_ar_doc", "success", submission, result)
    return result
