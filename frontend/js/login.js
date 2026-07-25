// ════════════════════════════════════════════════════
// js/login.js — Logic หน้า Login OTP ผู้ประกอบการ
//
// Flow:
//   Step 1: กรอก tax_id → check-taxpayer
//   Step 2: แสดงชื่อ + อีเมล → กด "ส่ง OTP"
//   Step 3: กรอก OTP 6 หลัก → verify-otp → redirect /pages/index.html
// ════════════════════════════════════════════════════

// ── State ────────────────────────────────────────────
let _taxId       = '';
let _countdown   = null;   // interval id

// ── Init ─────────────────────────────────────────────
(function init() {
  // ถ้า login แล้ว → ข้ามไปหน้า index
  if (auth.getToken()) {
    window.location.href = '/pages/index.html';
    return;
  }

  // Enter key shortcut
  document.getElementById('taxIdInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleCheckTaxId();
  });
  document.getElementById('otpInput').addEventListener('keydown', e => {
    if (e.key === 'Enter') handleVerifyOtp();
  });

  // Auto-format: ตัวเลขเท่านั้น
  document.getElementById('taxIdInput').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });
  document.getElementById('otpInput').addEventListener('input', e => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });
})();

// ── Step Navigation ───────────────────────────────────
function goToStep(stepId) {
  document.querySelectorAll('.login-step').forEach(el => el.classList.remove('active'));
  document.getElementById(stepId).classList.add('active');
  hideError();
}

// ── Error helpers ─────────────────────────────────────
function showError(msg) {
  const el = document.getElementById('loginError');
  el.textContent = msg;
  el.classList.add('show');
}
function hideError() {
  document.getElementById('loginError').classList.remove('show');
}

// ── Loading state ─────────────────────────────────────
function setLoading(btnId, loading) {
  const btn = document.getElementById(btnId);
  if (loading) {
    btn.classList.add('btn-loading');
    btn.disabled = true;
  } else {
    btn.classList.remove('btn-loading');
    btn.disabled = false;
  }
}

// ── Step 1: ตรวจเลข tax_id ───────────────────────────
async function handleCheckTaxId() {
  hideError();
  const input = document.getElementById('taxIdInput');
  const taxId = input.value.trim();

  if (!taxId || taxId.length !== 13 || !/^\d+$/.test(taxId)) {
    input.classList.add('error');
    showError('กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก (ตัวเลขเท่านั้น)');
    return;
  }
  input.classList.remove('error');

  setLoading('btnCheckTaxId', true);
  try {
    const data = await api.post('/auth/check-taxpayer', { tax_id: taxId });

    _taxId = taxId;

    // แสดงข้อมูล operator
    document.getElementById('operatorName').textContent  = data.operator_name || '—';
    document.getElementById('operatorEmail').textContent = data.channels?.[0]?.display || '—';

    goToStep('stepRequestOtp');

  } catch (err) {
    showError(err.message || 'ไม่พบข้อมูลในระบบ กรุณาติดต่อเจ้าหน้าที่ กสทช.');
  } finally {
    setLoading('btnCheckTaxId', false);
  }
}

// ── Step 2: ขอ OTP ────────────────────────────────────
async function handleRequestOtp() {
  hideError();
  setLoading('btnRequestOtp', true);

  try {
    await api.post('/auth/request-otp', {
      tax_id:  _taxId,
      channel: 'email',
    });

    goToStep('stepVerifyOtp');
    startCountdown(300);   // 5 นาที

  } catch (err) {
    showError(err.message || 'ส่ง OTP ไม่สำเร็จ กรุณาลองใหม่');
  } finally {
    setLoading('btnRequestOtp', false);
  }
}

// ── Step 2: ส่ง OTP ใหม่ (resend) ─────────────────────
async function handleResendOtp() {
  hideError();
  const btn = document.getElementById('btnResend');
  btn.disabled = true;

  try {
    await api.post('/auth/request-otp', {
      tax_id:  _taxId,
      channel: 'email',
    });
    startCountdown(300);
  } catch (err) {
    showError(err.message || 'ส่ง OTP ใหม่ไม่สำเร็จ');
    btn.disabled = false;
  }
}

// ── Step 3: ยืนยัน OTP ───────────────────────────────
async function handleVerifyOtp() {
  hideError();
  const otp = document.getElementById('otpInput').value.trim();

  if (!otp || otp.length !== 6) {
    showError('กรุณากรอกรหัส OTP 6 หลัก');
    return;
  }

  setLoading('btnVerifyOtp', true);
  try {
    const data = await api.post('/auth/verify-otp', {
      tax_id: _taxId,
      otp,
    });

    // บันทึก token + ข้อมูล operator
    // [FIX] backend ส่ง operator info ซ้อนอยู่ใน data.operator.* ไม่ใช่ flat
    auth.saveOperator(data.token, {
      tax_id:        _taxId,
      operator_name: data.operator?.operator_name || '',
      fiscal_year:   data.operator?.fiscal_year    || '',
    });

    // redirect ไปหน้ากรอกรายได้
    window.location.href = '/pages/index.html';

  } catch (err) {
    showError(err.message || 'รหัส OTP ไม่ถูกต้องหรือหมดอายุแล้ว');
  } finally {
    setLoading('btnVerifyOtp', false);
  }
}

// ── Countdown timer ───────────────────────────────────
function startCountdown(seconds) {
  clearInterval(_countdown);

  const countEl  = document.getElementById('otpCountdown');
  const resendBtn = document.getElementById('btnResend');
  resendBtn.disabled = true;

  let remaining = seconds;

  function tick() {
    const m = Math.floor(remaining / 60);
    const s = remaining % 60;
    countEl.textContent = `${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
    if (remaining <= 0) {
      clearInterval(_countdown);
      countEl.textContent = 'หมดอายุแล้ว';
      countEl.style.color = 'var(--danger)';
      resendBtn.disabled = false;
    }
    remaining--;
  }

  tick();
  _countdown = setInterval(tick, 1000);
}