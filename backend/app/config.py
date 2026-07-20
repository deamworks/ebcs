import os
from datetime import timedelta

class Config:
    SECRET_KEY = os.environ.get("FLASK_SECRET_KEY", "dev.only-change-in-production")
    JWT_SECRET_KEY = os.environ.get("JWT_SECRET_KEY", "dev.only-change-in-production")

    JWT_ACCESS_TOKEN_EXPIRES = timedelta(hours=2)

    DB_HOST = "mysql"
    DB_PORT = 3306
    DB_NAME = os.environ.get("MYSQL_DATABASE", "ebcs")
    DB_USER = os.environ.get("MYSQL_USER", "ebcs_user")
    DB_PASSWORD = os.environ.get("MYSQL_PASSWORD", "")
    
    # Redis (เก็บ OTP)
        # "redis" คือชื่อ container ใน docker-compose
    REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
        # OTP หมดอายุใน 300 วินาที (5 นาที)
    OTP_EXPIRE_SECONDS = int(os.environ.get("OTP_EXPIRATION_SECONDS", 300))
        # กรอก OTP ผิดได้ไม่เกิน 5 ครั้ง (ป้องกันการลองสุ่ม)
    OTP_MAX_ATTEMPTS = int(os.environ.get("OTP_MAX_ATTEMPTS", 5))
        # ขอ OTP ได้ไม่เกิน 3 ครั้งต่อนาที (ป้องกัน spam SMS)
    OTP_RATE_LIMIT_PER_MIN = int(os.environ.get("OTP_RATE_LIMIT_PER_MINUTE", 3))  

    # SMS Provider
    SMS_MODE = os.environ.get("SMS_MODE", "mock") 
    SMS_API_KEY = os.environ.get("SMS_API_KEY", "")
    SMS_SENDER = os.environ.get("SMS_SENDER", "NBTC")

    # File Upload
        #โฟลเดอร์เก็บไฟล์แนบใน container
    UPLOAD_FOLDER = "/app/uploads"
        # ขนาดไฟล์สูงสุด: 10 MB (แปลงจาก MB → bytes)
    MAX_CONTENT_LENGTH = int(os.environ.get("MAX_UPLOAD_MB", 10)) *1024 *1024
        # นามสกุลไฟล์ที่อนุญาต
    ALLOWED_EXTENSIONS = {".pdf", "docx", ".xlsx"}
