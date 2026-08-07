from flask import Flask, jsonify
from flask_cors import CORS
from flask_jwt_extended import JWTManager

from .config import Config

def create_app():
    """สร้างและตั้งค่า Flask application"""
    app = Flask(__name__)
    app.config.from_object(Config)

    # อนุญาต CORS ข้าม origin เพราะตอน dev frontend/API คนละ port
    CORS(app)

    JWTManager(app)

    # Health Check
    @app.route("/api/health")
    def health():
        return jsonify({
            "success": True,
            "data": {"status": "ok", "message": "NBTC Filing API Ready!"}
        })
    
    # ลงทะเบียน Blueprints ของแต่ละกลุ่ม route
    from .auth import auth_bp
    app.register_blueprint(auth_bp, url_prefix="/api/auth")

    from .routes.operator import operator_bp
    app.register_blueprint(operator_bp, url_prefix="/api/operator")

    from .routes.admin import admin_bp
    app.register_blueprint(admin_bp, url_prefix="/api/admin")

    # Error handler: ตอบ JSON เสมอ เพราะ frontend คาดหวัง JSON ไม่ใช่ HTML

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