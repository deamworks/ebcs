// ════════════════════════════════════════════════════
// js/admin-login.js — Admin Login Logic
// ════════════════════════════════════════════════════

// ── redirect ถ้า login อยู่แล้ว ────────────────────────
  window.addEventListener('DOMContentLoaded', () => {
    const token = auth.getAdminToken();
    if (token) {
      try {
        const payload = JSON.parse(atob(token.split('.')[1]));
        if (payload.exp && payload.exp * 1000 > Date.now() && payload.role === 'admin') {
          window.location.href = '/pages/admin.html';
          return;
        }
      } catch(e) {}
      auth.clearAdmin();
    }
  });

  async function handleLogin() {
    const email    = document.getElementById('loginEmail').value.trim();
    const password = document.getElementById('loginPassword').value;
    const errEl    = document.getElementById('loginError');
    const btn      = document.getElementById('loginBtn');

    errEl.className = 'login-error';

    if (!email || !password) {
      errEl.textContent = 'กรุณากรอกอีเมลและรหัสผ่าน';
      errEl.className   = 'login-error show';
      return;
    }

    btn.disabled    = true;
    btn.textContent = 'กำลังเข้าสู่ระบบ...';

    try {
      const res  = await fetch('/api/auth/admin/login', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ email, password }),
      });
      const json = await res.json();

      if (!json.success) throw new Error(json.error?.message || 'อีเมลหรือรหัสผ่านไม่ถูกต้อง');

      auth.saveAdmin(json.data.token, json.data.admin.email);
      window.location.href = '/pages/admin.html';

    } catch (e) {
      errEl.textContent = e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่';
      errEl.className   = 'login-error show';
      btn.disabled    = false;
      btn.textContent = 'เข้าสู่ระบบ';
    }
  }