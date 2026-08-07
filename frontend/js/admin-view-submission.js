// ════════════════════════════════════════════════════
// js/admin-view-submission.js — หน้าแอดมินดูใบยื่นแบบของผู้ประกอบการ
// ใช้โครง UI เดียวกับ index.js ของผู้ประกอบการทุกประการ (ผ่าน
// view-submission.js) ต่างกันแค่แหล่งข้อมูล (admin API) และสิทธิ์ (admin token)
// ════════════════════════════════════════════════════

(function () {
  if (!auth.getAdminToken()) window.location.href = '/pages/admin-login.html';
})();

document.addEventListener('DOMContentLoaded', async () => {
  const emailEl = document.getElementById('nav-admin-email');
  if (emailEl) emailEl.textContent = auth.getAdminEmail();

  const params = new URLSearchParams(window.location.search);
  const submissionId = params.get('id');

  const main = document.querySelector('.main');

  if (!submissionId) {
    if (main) main.innerHTML = '<p style="padding:24px;color:#c62828;">ไม่พบเลขที่ใบยื่นแบบ (?id=... หายไปจาก URL)</p>';
    return;
  }

  let detail;
  try {
    detail = await api.get(`/admin/submissions/${submissionId}`);
  } catch (e) {
    if (main) main.innerHTML = `<p style="padding:24px;color:#c62828;">โหลดข้อมูลไม่สำเร็จ: ${e.message || ''}</p>`;
    return;
  }

  const statusTh = { draft: 'ร่าง', pending_payment: 'รอชำระเงิน', paid: 'ชำระแล้ว' };
  const actualStatus = detail.submission?.actual_status || detail.submission?.status;

  // [FIX] แอดมินแก้ตัวเลขตรงๆ ไม่ได้อีกแล้ว (จะไม่ตรงกับ ชส.01/ชส.02 ที่พิมพ์ไปแล้ว)
  // ทุกสถานะเปิดเป็นโหมดดูอย่างเดียว ผิดต้อง "ตีกลับเป็นร่าง" ให้ผู้ประกอบการแก้เอง
  renderReadOnlySubmission(detail, {
    downloadBase: '/admin',
    statusLabel:  statusTh[actualStatus] || actualStatus,
  });
});
