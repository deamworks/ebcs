"""
ทดสอบการคำนวณเงินนำส่งกองทุน (progressive rate) ใน routes/operator.py
เป็น pure function ไม่แตะ DB จึงรันได้โดยไม่ต้องมี MySQL/Redis จริง
"""
from datetime import date, timedelta

from app.routes.operator import calc_progressive_fund, calculate_fund, RATE_TABLE


def test_zero_or_negative_income_gives_zero_fund():
    assert calc_progressive_fund(0) == 0.0
    assert calc_progressive_fund(-100) == 0.0
    assert calc_progressive_fund(None) == 0.0


def test_first_bracket_flat_rate():
    # ต่ำกว่าขั้นแรก (100,000,000) ใช้ rate 0.125% ตลอดทั้งก้อน
    income = 50_000_000
    assert calc_progressive_fund(income) == round(income * 0.00125, 2)


def test_exact_bracket_boundary():
    # พอดีขอบขั้นแรกเป๊ะ ต้องคำนวณด้วย rate ขั้นแรกทั้งหมด ไม่ตกไปขั้นถัดไป
    income = 100_000_000
    assert calc_progressive_fund(income) == round(income * 0.00125, 2)


def test_crosses_two_brackets():
    # ขั้นแรก 100M @0.125% + ส่วนเกิน 50M @0.25% (ขั้นที่สอง ถึง 500M)
    income = 150_000_000
    expected = round(100_000_000 * 0.00125 + 50_000_000 * 0.0025, 2)
    assert calc_progressive_fund(income) == expected


def test_top_bracket_uses_highest_rate_only_on_excess():
    # เกินขั้นบนสุด (50,000,000,000) ส่วนเกินคิด rate สูงสุด 2%
    income = 60_000_000_000
    prev = 50_000_000_000
    expected = round(calc_progressive_fund(prev) + (income - prev) * 0.02, 2)
    assert calc_progressive_fund(income) == expected


def test_calculate_fund_basic_no_deduction_no_penalty():
    result = calculate_fund(total_income=1_000_000, deduction_amount=0, due_date=None)
    assert result["net_income"] == 1_000_000
    assert result["fund_amount"] == calc_progressive_fund(1_000_000)
    assert result["vat_amount"] == round(result["fund_amount"] * 0.07, 2)
    assert result["extra_amount"] == 0.0
    assert result["net_amount"] == round(result["fund_amount"] + result["vat_amount"], 2)


def test_calculate_fund_deduction_reduces_net_income():
    result = calculate_fund(total_income=1_000_000, deduction_amount=300_000, due_date=None)
    assert result["net_income"] == 700_000
    assert result["deduction_amount"] == 300_000


def test_calculate_fund_deduction_cannot_go_negative():
    # หักลดหย่อนมากกว่ารายได้ ไม่ควรทำให้ net_income ติดลบ
    result = calculate_fund(total_income=100, deduction_amount=999_999, due_date=None)
    assert result["net_income"] == 0
    assert result["fund_amount"] == 0.0
    assert result["net_amount"] == 0.0


def test_calculate_fund_no_penalty_when_not_yet_due():
    future_due = (date.today() + timedelta(days=30)).isoformat()
    result = calculate_fund(total_income=1_000_000, deduction_amount=0, due_date=future_due)
    assert result["extra_amount"] == 0.0


def test_calculate_fund_penalty_when_overdue():
    # เลยกำหนด 40 วัน = ปัดขึ้น 2 เดือน, เงินเพิ่ม = fund * 1.5% * 2
    overdue = (date.today() - timedelta(days=40)).isoformat()
    result = calculate_fund(total_income=1_000_000, deduction_amount=0, due_date=overdue)
    expected_extra = round(result["fund_amount"] * 0.015 * 2, 2)
    assert result["extra_amount"] == expected_extra
    assert result["net_amount"] == round(
        result["fund_amount"] + result["vat_amount"] + expected_extra, 2
    )


def test_rate_table_is_sorted_ascending():
    # กันคนแก้ RATE_TABLE พลาดลำดับ ซึ่งจะทำให้คำนวณผิดเงียบๆ
    thresholds = [t for t, _ in RATE_TABLE]
    assert thresholds == sorted(thresholds)
