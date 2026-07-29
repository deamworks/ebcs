"""ทดสอบ pure-function helpers ใน auth.py"""
from app.auth import mask_email


def test_mask_email_shows_first_two_chars():
    assert mask_email("somchai@nbtc.go.th") == "so***@nbtc.go.th"


def test_mask_email_short_local_part():
    assert mask_email("a@x.com") == "a***@x.com"


def test_mask_email_no_at_sign_returned_unchanged():
    assert mask_email("not-an-email") == "not-an-email"


def test_mask_email_empty():
    assert mask_email("") == ""
    assert mask_email(None) is None
