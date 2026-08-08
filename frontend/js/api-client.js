// ════════════════════════════════════════════════════
// js/api-client.js — ฟังก์ชันกลางสำหรับเรียก API ทุกตัว
//
// วิธีใช้:
//   const data = await api.post('/auth/check-taxpayer', { tax_id });
//   const data = await api.get('/operator/autofill');
//   await api.upload('/admin/import/taxpayers', formData);
// ════════════════════════════════════════════════════

const API_BASE = "/api";

// ── Custom Error Class ──────────────────────────────
class ApiError extends Error {
  constructor(message, code = 'UNKNOWN', status = 0) {
    super(message);
    this.name   = 'ApiError';
    this.code   = code;
    this.status = status;
  }
}

const api = (() => {

  function _getToken() {
    // [FIX] เดิมลอง nbtc_token (operator) ก่อนเสมอ ถ้ามี token ทั้งคู่หน้าแอดมินจะหยิบผิดฝั่งจน 403 — เลือกตาม path แทน
    const isAdminPage = window.location.pathname.includes('admin');
    return isAdminPage
      ? localStorage.getItem('nbtc_admin_token') || null
      : localStorage.getItem('nbtc_token') || null;
  }

  function _headers(isFormData = false) {
    const h = {};
    if (!isFormData) {
      h['Content-Type'] = 'application/json';
    }
    const token = _getToken();
    if (token) {
      h['Authorization'] = `Bearer ${token}`;
    }
    return h;
  }

  async function _request(method, path, body = null, isFormData = false) {
    const url  = `${API_BASE}${path}`;
    const opts = {
      method,
      headers: _headers(isFormData),
    };

    if (body !== null) {
      opts.body = isFormData ? body : JSON.stringify(body);
    }

    let res, data;
    try {
      res  = await fetch(url, opts);
      data = await res.json();
    } catch (err) {
      throw new ApiError(
        'ไม่สามารถเชื่อมต่อเซิร์ฟเวอร์ได้ กรุณาลองใหม่',
        'NETWORK_ERROR',
        0
      );
    }

    // token หมดอายุ → redirect ไปหน้า login ที่ถูกต้อง
    if (res.status === 401) {
      auth.clearAll();
      const isAdminPage = window.location.pathname.includes('admin');
      window.location.href = isAdminPage
        ? '/pages/admin-login.html'
        : '/pages/login.html';
      return null;
    }

    if (!data.success) {
      throw new ApiError(
        data.error?.message || 'เกิดข้อผิดพลาด',
        data.error?.code   || 'UNKNOWN',
        res.status
      );
    }

    return data.data;
  }

  return {
    get:    (path)           => _request('GET',    path),
    post:   (path, body)     => _request('POST',   path, body),
    put:    (path, body)     => _request('PUT',    path, body),
    delete: (path, body)     => _request('DELETE', path, body),
    // สำหรับ upload ไฟล์ Excel (form-data)
    upload: (path, formData) => _request('POST',   path, formData, true),
  };

})();