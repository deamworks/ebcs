import os
from datetime import timedelta


class Config:

    # ── Flask ────────────────────────────────────────────
    SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "dev-only")

    # ── JWT ──────────────────────────────────────────────
    JWT_SECRET_KEY             = os.environ.get("JWT_SECRET_KEY", "dev-only")
    JWT_ACCESS_TOKEN_EXPIRES   = timedelta(hours=2)

    # ── MySQL ────────────────────────────────────────────
    DB_HOST     = "mysql"
    DB_PORT     = 3306
    DB_NAME     = os.environ.get("MYSQL_DATABASE", "ebcs")
    DB_USER     = os.environ.get("MYSQL_USER", "ebcs_user")
    DB_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")

    # ── Redis ────────────────────────────────────────────
    REDIS_URL              = os.environ.get("REDIS_URL", "redis://redis:6379/0")
    OTP_EXPIRE_SECONDS     = int(os.environ.get("OTP_EXPIRE_SECONDS", 300))
    OTP_MAX_ATTEMPTS       = int(os.environ.get("OTP_MAX_ATTEMPTS", 5))
    OTP_RATE_LIMIT_PER_MIN = int(os.environ.get("OTP_RATE_LIMIT_PER_MINUTE", 3))

    # ── Email (Exchange/Outlook) ──────────────────────────
    # MAIL_SERVER = mock → พิมพ์ OTP ลง log แทนส่งจริง
    MAIL_SERVER   = os.environ.get("MAIL_SERVER", "mock")
    MAIL_PORT     = int(os.environ.get("MAIL_PORT", 587))
    MAIL_USE_TLS  = os.environ.get("MAIL_USE_TLS", "true").lower() == "true"
    MAIL_USERNAME = os.environ.get("MAIL_USERNAME", "")
    MAIL_PASSWORD = os.environ.get("MAIL_PASSWORD", "")
    MAIL_FROM     = os.environ.get("MAIL_FROM", "noreply@nbtc.go.th")
    MAIL_FROM_NAME = os.environ.get("MAIL_FROM_NAME", "ระบบ e-BCS กสทช.")

    # ── Upload ────────────────────────────────────────────
    UPLOAD_FOLDER      = "/app/uploads"
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_UPLOAD_MB", 10)) * 1024 * 1024
    ALLOWED_EXTENSIONS = {".pdf", ".docx", ".xlsx", ".jpg", ".jpeg", ".png"}