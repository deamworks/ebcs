from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from .config import Config

def create_app():
    """สร้างและตั้งค่า Flask application"""
    
    # สร้าง Flask app
    app = Flask(__name__)

    # โหลด config ทั้งหมดจาก Config class (config.py)
    app.config.from_object(Config)

    # เปิด CORS: อนุญาตให้ browser เรียก API ข้าม origin ได้
    # จำเป็นตอน dev (frontend port 80, API port 5000)
    CORS(app)

    # เปิดระบบ JWT สำหรับ Login / Token
    JWTManager(app)

    # Health Check
    @app.route("/api/health")
    def health():
        return jsonify({
            "success": True,
            "data": {"status": "ok", "message": "e-BCS API Ready!"}
        })
    
      # ลงทะเบียน Blueprints (Routes) 
    # Blueprint = กลุ่ม routes ที่แยกไฟล์
    # เปิด comment ทีละตัวเมื่อเขียนไฟล์นั้นเสร็จ

    # Auth routes: /api/auth/request-otp, /api/auth/verify-otp ฯลฯ
    from .auth import auth_bp
    app.register_blueprint(auth_bp, url_prefix="/api/auth")

    # Operator routes: /api/operator/autofill, /api/operator/licenses ฯลฯ
    from .routes.operator import operator_bp
    app.register_blueprint(operator_bp, url_prefix="/api/operator")

    # Admin routes: /api/admin/submissions, /api/admin/taxpayers ฯลฯ
    # from .routes.admin import admin_bp
    # app.register_blueprint(admin_bp, url_prefix="/api/admin")

    # Upload routes: /api/upload
    # from .routes.upload import upload_bp
    # app.register_blueprint(upload_bp, url_prefix="/api/upload")

    # Error Handlers
    # จัดการ error ให้ตอบ JSON ทุกครั้ง (ไม่ตอบ HTML)
    # เพราะ frontend คาดหวัง JSON เสมอ
    
    @app.errorhandler(400)
    def bad_request(e):
        """ข้อมูลที่ส่งมาผิดรูปแบบ"""
        return jsonify({
            "success": False,
            "error": {"code": "BAD_REQUEST", "message": "ข้อมูลไม่ถูกต้อง"}
        }), 400

    @app.errorhandler(401)
    def unauthorized(e):
        """ยังไม่ได้ login หรือ token หมดอายุ"""
        return jsonify({
            "success": False,
            "error": {"code": "UNAUTHORIZED", "message": "กรุณาเข้าสู่ระบบก่อน"}
        }), 401

    @app.errorhandler(403)
    def forbidden(e):
        """login แล้วแต่ไม่มีสิทธิ์"""
        return jsonify({
            "success": False,
            "error": {"code": "FORBIDDEN", "message": "ไม่มีสิทธิ์เข้าถึง"}
        }), 403

    @app.errorhandler(404)
    def not_found(e):
        """ไม่พบ endpoint หรือข้อมูล"""
        return jsonify({
            "success": False,
            "error": {"code": "NOT_FOUND", "message": "ไม่พบข้อมูลที่ร้องขอ"}
        }), 404

    @app.errorhandler(500)
    def server_error(e):
        """ระบบผิดพลาด (bug หรือ DB ล่ม)"""
        return jsonify({
            "success": False,
            "error": {"code": "SERVER_ERROR", "message": "เกิดข้อผิดพลาดในระบบ กรุณาลองใหม่"}
        }), 500

    return app