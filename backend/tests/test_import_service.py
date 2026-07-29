"""
ทดสอบ pure-function helpers ใน services/import_service.py
(ตัวที่ไม่ต้องต่อ DB — การ upsert จริงมี integration test แยกถ้าจะเพิ่มทีหลัง)
"""
from datetime import date

from app.services.import_service import (
    _clean_tax_id,
    _to_date,
    _parse_period,
    _fiscal_year_be,
    _normalize_license_status,
    _num,
    EMAIL_RE,
    _parse_operator_account_row,
)


# ── _clean_tax_id ──────────────────────────────────────────

def test_clean_tax_id_strips_dashes_and_spaces():
    assert _clean_tax_id("1-2345-67890-12-3") == "1234567890123"
    assert _clean_tax_id("150 123 456 7895") == "1501234567895"


def test_clean_tax_id_handles_none_and_empty():
    assert _clean_tax_id(None) == ""
    assert _clean_tax_id("") == ""


# ── _num (regression: comma thousand separators must not become 0) ────

def test_num_parses_plain_numbers():
    assert _num(1234.5) == 1234.5
    assert _num("1234.5") == 1234.5


def test_num_parses_comma_thousand_separators():
    # บั๊กเดิม: float("1,234.50") raise ValueError แล้วเงียบๆ คืน 0.0
    # ทำให้ยอดเงินที่ import จากไฟล์ Excel จริง (มักมี comma) หายไปเป็น 0
    assert _num("1,234.50") == 1234.50
    assert _num("1,000,000") == 1_000_000.0


def test_num_empty_and_invalid_gives_zero():
    assert _num(None) == 0.0
    assert _num("") == 0.0
    assert _num("ไม่ใช่ตัวเลข") == 0.0


# ── _to_date ───────────────────────────────────────────────

def test_to_date_converts_buddhist_era_to_gregorian():
    assert _to_date("01/04/2568") == date(2025, 4, 1)


def test_to_date_passes_through_gregorian_year():
    assert _to_date("01/04/2025") == date(2025, 4, 1)


def test_to_date_none_and_empty():
    assert _to_date(None) is None
    assert _to_date("") is None


# ── _parse_period ──────────────────────────────────────────

def test_parse_period_splits_start_end():
    start, end = _parse_period("01/04/2568-31/03/2569")
    assert start == date(2025, 4, 1)
    assert end == date(2026, 3, 31)


# ── _fiscal_year_be ────────────────────────────────────────

def test_fiscal_year_be_adds_543():
    assert _fiscal_year_be(date(2026, 3, 31)) == 2569
    assert _fiscal_year_be(date(2025, 12, 31)) == 2568


def test_fiscal_year_be_none_input():
    assert _fiscal_year_be(None) is None


# ── _normalize_license_status ──────────────────────────────

def test_normalize_license_status_thai_labels():
    assert _normalize_license_status("ปกติ") == ("active", None)
    assert _normalize_license_status("ยกเลิก") == ("cancelled", None)
    assert _normalize_license_status("เพิกถอน") == ("revoked", None)
    assert _normalize_license_status("สิ้นสุด") == ("ended", None)


def test_normalize_license_status_enum_passthrough():
    assert _normalize_license_status("active") == ("active", None)


def test_normalize_license_status_empty_defaults_active():
    status, err = _normalize_license_status("")
    assert status == "active"
    assert err is None


def test_normalize_license_status_unknown_returns_error():
    status, err = _normalize_license_status("ไม่รู้จัก")
    assert status is None
    assert err is not None


# ── EMAIL_RE ───────────────────────────────────────────────

def test_email_regex_accepts_valid():
    assert EMAIL_RE.match("someone@example.com")


def test_email_regex_rejects_phone_number():
    assert not EMAIL_RE.match("0812345678")


# ── _parse_operator_account_row ────────────────────────────

def test_operator_account_row_valid():
    row, err = _parse_operator_account_row(
        ["1501234567895", "บริษัท ทดสอบ จำกัด", "test@example.com"], 2, set()
    )
    assert err is None
    assert row["tax_id"] == "1501234567895"
    assert row["email"] == "test@example.com"


def test_operator_account_row_multi_email_keeps_first():
    row, err = _parse_operator_account_row(
        ["1501234567895", "บริษัท ทดสอบ จำกัด", "a@x.co.th, b@x.co.th"], 2, set()
    )
    assert err is None
    assert row["email"] == "a@x.co.th"


def test_operator_account_row_blank_name_and_email_dont_block():
    row, err = _parse_operator_account_row(["1501234567895", "", ""], 2, set())
    assert err is None
    assert row["operator_name"] == ""
    assert row["email"] == ""


def test_operator_account_row_invalid_email_becomes_blank_not_error():
    # เช่น เผลอใส่เบอร์โทรในช่องอีเมล — ไม่ block ทั้งแถว แค่เว้นว่างอีเมลไว้
    row, err = _parse_operator_account_row(
        ["1501234567895", "บริษัท ทดสอบ จำกัด", "0812345678"], 2, set()
    )
    assert err is None
    assert row["email"] == ""


def test_operator_account_row_invalid_tax_id_rejected():
    row, err = _parse_operator_account_row(["123", "บริษัท ทดสอบ จำกัด", "a@x.com"], 2, set())
    assert row is None
    assert err is not None


def test_operator_account_row_duplicate_tax_id_in_file_rejected():
    seen = {"1501234567895"}
    row, err = _parse_operator_account_row(
        ["1501234567895", "บริษัท ทดสอบ จำกัด", "a@x.com"], 5, seen
    )
    assert row is None
    assert err is not None
