// ════════════════════════════════════════════════════
// js/view-submission.js — หน้าดูข้อมูลแบบยื่นของผู้ประกอบการ (โหมดดูอย่างเดียว)
// เรียกใช้เมื่อผู้ประกอบการยื่นแบบไปแล้วสำหรับปีบัญชีนั้น — ห้ามยื่นซ้ำ
// จนกว่าเจ้าหน้าที่จะลบแบบคำยื่นเดิม แต่ยังเข้ามาดู/ดาวน์โหลดเอกสารได้
// Depends on: api-client.js, auth.js, submission-view.js
// ════════════════════════════════════════════════════

(function() {
  if (!auth.getToken()) window.location.href = '/pages/login.html';
})();

const STATUS_TH = { draft: 'ร่าง', pending_payment: 'รอชำระเงิน', paid: 'ชำระแล้ว' };

document.addEventListener('DOMContentLoaded', async () => {
  const navName = document.getElementById('nav-operator-name');
  if (navName) navName.textContent = auth.getOperatorName();

  const params = new URLSearchParams(window.location.search);
  const submissionId = params.get('id');

  if (!submissionId) {
    alert('ไม่พบรหัสใบยื่นแบบที่ต้องการดู');
    window.location.href = '/pages/index.html';
    return;
  }

  let data;
  try {
    data = await api.get(`/operator/submissions/${submissionId}`);
  } catch (e) {
    alert('โหลดข้อมูลไม่สำเร็จ: ' + (e.message || ''));
    window.location.href = '/pages/index.html';
    return;
  }

  SV_DOWNLOAD_BASE = '/api/operator/attachments/';
  svRenderSubmission(data);

  const badge = document.getElementById('sv-status-badge');
  if (badge) badge.textContent = `สถานะ: ${STATUS_TH[data.status] || data.status || '—'}`;
});
