// ════════════════════════════════════════════════════
// js/auth.js — จัดการ Token และ Redirect Guard
//
// Token แยกกัน 2 ชุด:
//   ebcs_token       = JWT ของผู้ประกอบการ (อายุ 2 ชั่วโมง)
//   ebcs_admin_token = JWT ของเจ้าหน้าที่  (อายุ 8 ชั่วโมง)
//
// วิธีใช้:
//   auth.requireOperator();   ← เรียกตอน page load หน้า operator
//   auth.requireAdmin();      ← เรียกตอน page load หน้า admin
//   auth.logout();            ← logout ผู้ประกอบการ
//   auth.logoutAdmin();       ← logout เจ้าหน้าที่
// ════════════════════════════════════════════════════

// ── ปุ่มแสดง/ซ่อนรหัสผ่าน ใช้ร่วมกันทุกช่องกรอกรหัสผ่านในระบบ ──
// ต้องอยู่ใน .pwd-field-wrap เดียวกับ <input> ที่จะสลับ type
function togglePwdVisibility(btn) {
  const input = btn.closest('.pwd-field-wrap')?.querySelector('input');
  if (!input) return;
  const show = input.type === 'password';
  input.type = show ? 'text' : 'password';
  btn.classList.toggle('showing', show);
}

// กัน browser autofill ใส่ค่าเก่าในช่องค้นหา — input[data-nofill] ผูก animation ไว้กับ
// :-webkit-autofill (ดู admin.css) พอ autofill จริงจะ trigger animationstart ให้เคลียร์ทันที ไม่ต้องเดา delay
document.addEventListener('animationstart', e => {
  if (e.animationName === 'admSearchAutofillDetect' && e.target.hasAttribute('data-nofill')) {
    e.target.value = '';
  }
});

const auth = (() => {

  // ── Keys ────────────────────────────────────────────
  const KEY_TOKEN    = 'ebcs_token';
  const KEY_ADMIN    = 'ebcs_admin_token';
  const KEY_TAX_ID   = 'ebcs_tax_id';
  const KEY_NAME     = 'ebcs_operator_name';
  const KEY_FISCAL   = 'ebcs_fiscal_year';
  const KEY_ADMIN_EMAIL = 'ebcs_admin_email';

  // ── Operator ─────────────────────────────────────────
  function saveOperator(token, info = {}) {
    localStorage.setItem(KEY_TOKEN,  token);
    if (info.tax_id)       localStorage.setItem(KEY_TAX_ID, info.tax_id);
    if (info.operator_name) localStorage.setItem(KEY_NAME,  info.operator_name);
    if (info.fiscal_year)  localStorage.setItem(KEY_FISCAL, info.fiscal_year);
  }

  function getToken() {
    return localStorage.getItem(KEY_TOKEN);
  }

  function getTaxId() {
    return localStorage.getItem(KEY_TAX_ID);
  }

  function getOperatorName() {
    return localStorage.getItem(KEY_NAME) || '';
  }

  function getFiscalYear() {
    return localStorage.getItem(KEY_FISCAL) || '';
  }

  function clearOperator() {
    [KEY_TOKEN, KEY_TAX_ID, KEY_NAME, KEY_FISCAL].forEach(k =>
      localStorage.removeItem(k)
    );
  }

  // ── Admin ─────────────────────────────────────────────
  function saveAdmin(token, email = '') {
    localStorage.setItem(KEY_ADMIN, token);
    if (email) localStorage.setItem(KEY_ADMIN_EMAIL, email);
  }

  function getAdminToken() {
    return localStorage.getItem(KEY_ADMIN);
  }

  function getAdminEmail() {
    return localStorage.getItem(KEY_ADMIN_EMAIL) || '';
  }

  function clearAdmin() {
    [KEY_ADMIN, KEY_ADMIN_EMAIL].forEach(k => localStorage.removeItem(k));
  }

  // admin_role: 'super_admin' หรือ 'admin' — อ่านจาก claim ใน JWT โดยตรง (ไม่ต้องเก็บแยก)
  function getAdminRole() {
    const token = getAdminToken();
    if (!token) return '';
    try {
      return JSON.parse(atob(token.split('.')[1])).admin_role || '';
    } catch (e) {
      return '';
    }
  }

  // ── Clear All ──────────────────────────────────────────
  function clearAll() {
    clearOperator();
    clearAdmin();
  }

  // ── Guards ──────────────────────────────────────────────
  // เรียกที่ตอน page load — ถ้าไม่มี token redirect ไปหน้า login
  function requireOperator() {
    if (!getToken()) {
      window.location.href = '/pages/login.html';
      return false;
    }
    return true;
  }

  function requireAdmin() {
    if (!getAdminToken()) {
      window.location.href = '/pages/admin-login.html';
      return false;
    }
    return true;
  }

  // ── Logout ──────────────────────────────────────────────
  function logout() {
    clearOperator();
    window.location.href = '/pages/login.html';
  }

  function logoutAdmin() {
    clearAdmin();
    window.location.href = '/pages/admin-login.html';
  }

  // ── Display helpers ─────────────────────────────────────
  // แสดงชื่อผู้ประกอบการในหน้าต่างๆ
  function displayOperatorInfo(nameSelector = '#operator-name') {
    const el = document.querySelector(nameSelector);
    if (el) el.textContent = getOperatorName();
  }

  function displayAdminInfo(emailSelector = '#admin-email') {
    const el = document.querySelector(emailSelector);
    if (el) el.textContent = getAdminEmail();
  }

  // ── Public API ───────────────────────────────────────────
  return {
    // operator
    saveOperator,
    getToken,
    getTaxId,
    getOperatorName,
    getFiscalYear,
    clearOperator,
    logout,
    requireOperator,
    displayOperatorInfo,

    // admin
    saveAdmin,
    getAdminToken,
    getAdminEmail,
    getAdminRole,
    clearAdmin,
    logoutAdmin,
    requireAdmin,
    displayAdminInfo,

    // misc
    clearAll,
  };

})();