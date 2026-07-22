import pymysql
from contextlib import contextmanager

from .config import Config

@contextmanager
def get_db():

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