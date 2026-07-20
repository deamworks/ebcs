import pymysql
from contextlib import contextmanager

from .config import Config

@contextmanager
def get_db():
    """
     วิธีใช้:

        from app.db import get_db

        with get_db() as db:
            with db.cursor() as cur:
                # query ข้อมูล (อ่าน)
                cur.execute("SELECT * FROM submissions WHERE tax_id = %s", (tax_id,))
                rows = cur.fetchall()   # ได้ list ของ dict

                # หรือดึงแถวเดียว
                cur.execute("SELECT * FROM taxpayer_master WHERE phone = %s", (phone,))
                row = cur.fetchone()    # ได้ dict หรือ None

            # บันทึกการเปลี่ยนแปลง (ต้องเรียกหลัง INSERT/UPDATE/DELETE)
            db.commit()

        # หลังออกจาก with: connection ปิดอัตโนมัติ

    ทำไมใช้ %s แทนค่าตรงๆ:
        ❌ อันตราย:  f"WHERE phone = '{phone}'"   → SQL Injection
        ✅ ปลอดภัย: "WHERE phone = %s", (phone,) → pymysql จัดการให้
    """

    conn = pymysql.connect(
        host=Config.DB_HOST,
        port=Config.DB_PORT,
        user=Config.DB_USER,
        password=Config.DB_PASSWORD,
        database=Config.DB_NAME,
        charset="utf8mb4",
        cursorclass=pymysql.cursors.DictCursor,
        autocommit=False,
    )
    try:
        yield conn
    
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()