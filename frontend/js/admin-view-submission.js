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

  const statusTh = { draft: 'ร่าง', pending_attach: 'รอแนบ', pending_payment: 'รอชำระเงิน', paid: 'ชำระแล้ว' };
  const actualStatus = detail.submission?.actual_status || detail.submission?.status;

  renderReadOnlySubmission(detail, {
    downloadBase: '/admin',
    statusLabel:  statusTh[actualStatus] || actualStatus,
    // [FIX] แก้ไขได้เฉพาะ draft/pending_payment — paid แล้วห้ามแก้ (มีใบเสร็จ
    // อ้างอิงยอดเดิมไปแล้ว) ตรงกับที่ backend เช็คซ้ำอีกชั้น (PUT /admin/submissions/<id>)
    editable: actualStatus === 'draft' || actualStatus === 'pending_payment',
  });
});

/** เก็บ appState ปัจจุบัน (ที่แอดมินแก้ไขในฟอร์ม) ส่งไปบันทึกทับใบยื่นแบบเดิม
 *  โครงสร้าง payload เหมือน saveSubmission() ของผู้ประกอบการ (index.js) ทุกประการ */
async function saveAdminSubmissionEdit(submissionId) {
  if (!submissionId) return;
  const btn = document.getElementById('btn-admin-save-submission');
  try {
    if (btn) { btn.disabled = true; btn.textContent = 'กำลังบันทึก...'; }

    const count = parseInt(document.getElementById('license-count')?.value) || 1;
    const { totals } = calcAllLicenseSummary(count);

    const licenses = [];
    for (let i = 1; i <= count; i++) {
      const d = appState.rowsData[i] || {};
      const incomes = [];
      Object.entries(d.savedInputs || {}).forEach(([key, val]) => {
        const amount = pv(val);
        if (amount > 0) incomes.push({ field_key: key, label: key, amount, is_custom: false });
      });
      (d.customItems || []).forEach((item, idx) => {
        if ((item.value || 0) > 0 || item.label) {
          incomes.push({
            field_key: `custom_${idx + 1}`,
            label:     item.label || `รายการ ${idx + 1}`,
            amount:    item.value || 0,
            is_custom: true
          });
        }
      });
      licenses.push({
        license_no:     d.no       || '',
        income:         d.income   || 0,
        deduction:      d.deduction || 0,
        license_type:   d.type          || '',
        license_start:  typeof thaiToISO === 'function' ? thaiToISO(d.startDate) : null,
        license_end:    typeof thaiToISO === 'function' ? thaiToISO(d.endDate)   : null,
        license_status: d.licenseStatus || 'active',
        station:        d.station || '',
        incomes,
      });
    }

    const other_incomes = [];
    ['o1','o2','o3','o4','o5'].forEach(key => {
      const amount = pv(document.getElementById(key)?.value);
      if (amount > 0) other_incomes.push({ field_key: key, label: key, amount, is_custom: false });
    });
    document.querySelectorAll('.custom-other-income-item-row').forEach((row, idx) => {
      const label  = row.querySelector('.custom-other-label')?.value?.trim() || '';
      const amount = pv(row.querySelector('.custom-other-value')?.value);
      if (amount > 0 || label) {
        other_incomes.push({ field_key: `other_custom_${idx+1}`, label, amount, is_custom: true });
      }
    });

    await api.put(`/admin/submissions/${submissionId}`, {
      total_income_financial: pv(document.getElementById('total-income-financial')?.value),
      deduction_amount: totals.totalDeduct,
      auditor_name:     document.getElementById('auditorName')?.value    || '',
      auditor_license:  document.getElementById('auditorRegNo')?.value   || '',
      auditor_office:   document.getElementById('auditorCompany')?.value || '',
      audited_date:     typeof thaiToISO === 'function' ? thaiToISO(document.getElementById('auditorDate')?.value) : null,
      licenses,
      other_incomes,
    });

    if (typeof showToast === 'function') showToast('บันทึกการแก้ไขสำเร็จ', 'success');
    else alert('บันทึกการแก้ไขสำเร็จ');
    window.location.reload();
  } catch (e) {
    alert('บันทึกไม่สำเร็จ: ' + (e.message || ''));
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'บันทึกการแก้ไข'; }
  }
}
