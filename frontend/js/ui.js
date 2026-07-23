/**
 * ไฟล์: js/ui.js
 * หน้าที่: ควบคุม UI ส่วนกลาง เช่น Stepper, Toast notification
 * และการเปลี่ยน Step / Phase ต่างๆ
 */

// ค่าคงที่

/** Step ทั้งหมดในฟอร์ม (ใช้ตอนซ่อน/แสดง stepContent) */
const ALL_STEPS = [1, 2, 3, 4, 5, 6];

/** ระยะเวลาแสดง Toast notification (มิลลิวินาที) */
const TOAST_DURATION_MS = 2800;

// Phase Navigation

/** กลับไปหน้า Phase 1 */
function goBack() {
  document.getElementById('phase2').style.display = 'none';
  document.getElementById('phase1').style.display = 'block';
  window.scrollTo(0, 0);
}

// Step Navigation

/** สลับไปแสดง Step ที่กำหนดและอัปเดต Stepper */
function goToStep(n) {
  // ซ่อนทุก Step ก่อน แล้วแสดงเฉพาะ Step ที่เลือก
  ALL_STEPS.forEach(i => {
    const el = document.getElementById(`stepContent${i}`);
    if (el) el.style.display = 'none';
  });

  const targetEl = document.getElementById(`stepContent${n}`);
  if (targetEl) targetEl.style.display = 'block';

  // อัปเดต Stepper UI: step ปัจจุบัน = active, step ที่ผ่านมาแล้ว = done
  document.querySelectorAll('.stepper .step').forEach(s => {
    const si = parseInt(s.dataset.step);
    s.classList.remove('active', 'done');
    if (si === n) s.classList.add('active');
    else if (si < n) s.classList.add('done');
  });

  // Hook: สร้างแถวค่าลดหย่อนเมื่อเข้า Step 3
  if (n === 3 && typeof generateDeductRows === 'function') generateDeductRows();

  // Hook: คำนวณและแสดงสรุปเมื่อเข้า Step 5
  if (n === 5 && typeof renderStep5AndSummary === 'function') renderStep5AndSummary();

  window.scrollTo(0, 0);
}

/** ปุ่มถัดไปทั่วไป ไป Step 2 */
function handleNext() {
  goToStep(2);
}

// Toast Notification

/** แสดงข้อความแจ้งเตือนชั่วคราว (toast)
 * @param {string} msg
 * @param {'success'|'error'|'warning'} [type='success']
 * @param {number} [duration=TOAST_DURATION_MS] - ระยะเวลาแสดง (ms) ปรับได้เฉพาะกรณี
 *        ข้อความยาวกว่าปกติ (เช่น toast แจ้งเตือน error ที่มีตัวเลขยอดเงินยาวๆ)
 */
function showToast(msg, type = 'success', duration = TOAST_DURATION_MS) {
  const toast    = document.getElementById('toast');
  const toastMsg = document.getElementById('toastMsg');
  if (!toast || !toastMsg) return;

  toastMsg.textContent = msg;

  toast.classList.remove('toast-error', 'toast-warning');
  if (type === 'error')   toast.classList.add('toast-error');
  if (type === 'warning') toast.classList.add('toast-warning');

  toast.classList.add('show');
  clearTimeout(showToast._hideTimer);
  showToast._hideTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// Alert Modal (แทน window.alert ของเบราว์เซอร์)

/** สี/icon ของแต่ละประเภท Alert */
const APP_ALERT_COLORS = {
  danger:  '#c62828',
  warning: '#e65100',
  info:    '#1565c0',
};

const APP_ALERT_ICONS = {
  danger: `<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
  warning:`<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>`,
  info:   `<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>`,
};

/**
 * แสดง Alert Modal ในหน้าเว็บ แทน window.alert() ของเบราว์เซอร์
 */
function showAppAlert(message, options = {}) {
  const { title = 'แจ้งเตือน', type = 'danger' } = options;

  const overlay   = document.getElementById('appAlertModal');
  const header    = document.getElementById('appAlertHeader');
  const titleEl   = document.getElementById('appAlertTitle');
  const msgEl     = document.getElementById('appAlertMsg');
  const iconEl    = document.getElementById('appAlertIcon');
  const btnEl     = document.getElementById('appAlertBtn');

  if (!overlay || !msgEl) { alert(message); return; }

  const color = APP_ALERT_COLORS[type] || APP_ALERT_COLORS.danger;
  const icon  = APP_ALERT_ICONS[type]  || APP_ALERT_ICONS.danger;

  header.style.background = color;
  if (iconEl) iconEl.innerHTML = icon;
  if (btnEl)  btnEl.style.background = color;
  titleEl.textContent = title;
  msgEl.textContent   = message;

  overlay.classList.add('open');
  document.body.style.overflow = 'hidden';
}

/** ปิด Alert Modal */
function closeAppAlert() {
  document.getElementById('appAlertModal')?.classList.remove('open');
  document.body.style.overflow = '';
}

// Stepper Click

// ผูก event คลิกที่ Step วงกลมใน Stepper ให้เปลี่ยน Step ได้อิสระ
document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('.stepper .step').forEach(step => {
    step.style.cursor = 'pointer';
    step.addEventListener('click', () => {
      const targetStep = parseInt(step.dataset.step);
      goToStep(targetStep);
    });
  });
});