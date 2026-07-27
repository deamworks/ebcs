// ════════════════════════════════════════════════════
// js/submission-view.js — เรนเดอร์ "ดูข้อมูลแบบยื่น" แบบอ่านอย่างเดียว (Step 1-6)
// ใช้ร่วมกันทั้งฝั่งแอดมิน (admin.html #page-submission-detail) และ
// ฝั่งผู้ประกอบการ (view-submission.html) — DOM ids ต้องตรงกันทั้งสองหน้า:
//   fdv-ref, fdv-licensee, fdv-taxid, fdv-year, fdv-type, fdv-period, fdv-due-date,
//   fdStepper, fdPanel1..fdPanel6, fdAttachmentList
//
// Depends on: fdMoney, fdISOToThai (admin-utils.js หรือเทียบเท่าในหน้าที่เรียกใช้)
// ════════════════════════════════════════════════════

/** URL prefix สำหรับดาวน์โหลดไฟล์แนบ — ตั้งค่าก่อนเรียก svRenderSubmission()
 *  เช่น '/api/admin/attachments/' หรือ '/api/operator/attachments/' */
let SV_DOWNLOAD_BASE = '/api/admin/attachments/';

// ── ตัวช่วยจัดรูปแบบ (ซ้ำกับ admin-utils.js โดยตั้งใจ เพื่อให้ไฟล์นี้ใช้ได้เดี่ยวๆ) ──
/** "YYYY-MM-DD" (ค.ศ.) → "DD/MM/YYYY" (พ.ศ.) */
function fdISOToThai(iso) {
  if (!iso) return '';
  const s = String(iso).split('T')[0];
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${parseInt(y, 10) + 543}`;
}

function fdMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** เปิดไฟล์แนบในแท็บใหม่ผ่าน endpoint ที่ตรวจ token */
function svDownloadAttachment(attachmentId) {
  window.open(`${SV_DOWNLOAD_BASE}${attachmentId}/download`, '_blank');
}

/** เรนเดอร์ข้อมูลแบบยื่นทั้งหมดลงในหน้า (โหมดดูอย่างเดียว) */
function svRenderSubmission(data) {
  const s = data.submission || {};
  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = (val === null || val === undefined || val === '') ? '—' : val; };

  setText('fdv-ref', s.ref_no);
  setText('fdv-licensee', s.operator_name);
  setText('fdv-taxid', s.tax_id);
  setText('fdv-year', s.fiscal_year ? `พ.ศ. ${s.fiscal_year}` : null);

  let periodType = null;
  if (s.period_start && s.period_end) {
    const ps = new Date(s.period_start), pe = new Date(s.period_end);
    periodType = (ps.getMonth() === 0 && ps.getDate() === 1 && pe.getMonth() === 11 && pe.getDate() === 31)
      ? 'รอบปกติ' : 'รอบอื่น';
  }
  setText('fdv-type', periodType);
  setText('fdv-period', (s.period_start && s.period_end) ? `${fdISOToThai(s.period_start)} – ${fdISOToThai(s.period_end)}` : null);
  setText('fdv-due-date', s.due_date ? fdISOToThai(s.due_date) : null);

  svRenderPanel1(data);
  svRenderPanel2(data);
  svRenderPanel3(data);
  svRenderPanel4(s);
  svRenderPanel5(s);
  svRenderPanel6(data);

  fdShowStep(1);
}

function fdShowStep(n) {
  document.querySelectorAll('#fdStepper .step').forEach(el => el.classList.remove('active'));
  document.querySelector(`#fdStepper .step[data-step="${n}"]`)?.classList.add('active');
  for (let i = 1; i <= 6; i++) {
    const panel = document.getElementById(`fdPanel${i}`);
    if (panel) panel.style.display = (i === n) ? 'block' : 'none';
  }
}

function fdPrevStep() {
  const active = document.querySelector('#fdStepper .step.active');
  const cur = active ? parseInt(active.dataset.step, 10) : 1;
  if (cur > 1) fdShowStep(cur - 1);
}

function fdNextStep() {
  const active = document.querySelector('#fdStepper .step.active');
  const cur = active ? parseInt(active.dataset.step, 10) : 1;
  if (cur < 6) fdShowStep(cur + 1);
}

function svRenderPanel1(data) {
  const panel = document.getElementById('fdPanel1');
  if (!panel) return;
  const licenses = data.licenses || [];

  const blocks = licenses.length ? licenses.map((lic, idx) => {
    const incomes = lic.incomes || [];
    const rows = incomes.length ? incomes.map(inc => `
        <tr>
          <td style="padding:6px 10px;">${inc.label || inc.field_key || '—'}${inc.is_custom ? ' <span style="color:#888;font-size:11px;">(กำหนดเอง)</span>' : ''}</td>
          <td style="padding:6px 10px;text-align:right;">${fdMoney(inc.amount)}</td>
        </tr>`).join('')
      : `<tr><td colspan="2" style="padding:8px;text-align:center;color:#aaa;">ไม่มีรายการรายได้ย่อย</td></tr>`;
    return `
      <div class="adm-card" style="margin-bottom:12px;padding:14px 16px;">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
          <strong style="color:#1e2d5e;">${lic.license_no || `ใบอนุญาตลำดับที่ ${idx + 1}`}</strong>
          <span style="font-weight:600;color:#2C3D8F;">${fdMoney(lic.fee_amount)} บาท</span>
        </div>
        <table class="adm-table"><tbody>${rows}</tbody></table>
      </div>`;
  }).join('') : `<p style="padding:16px;color:#888;">ไม่มีข้อมูลใบอนุญาตในใบยื่นนี้</p>`;

  const total = licenses.reduce((sum, l) => sum + (parseFloat(l.fee_amount) || 0), 0);

  panel.innerHTML = `
    <div class="step-card-header">
      <div class="step-card-num">1</div>
      <div><div class="step-card-title">รายได้จากใบอนุญาต</div><div class="step-card-subtitle">ข้อมูลที่ผู้ประกอบการยื่นไว้ (แสดงอย่างเดียว)</div></div>
    </div>
    <div style="padding:14px 16px;">
      ${blocks}
      <div style="text-align:right;font-weight:700;color:#1a237e;">รวมรายได้จากใบอนุญาตทั้งหมด: ${fdMoney(total)} บาท</div>
    </div>`;
}

function svRenderPanel2(data) {
  const panel = document.getElementById('fdPanel2');
  if (!panel) return;
  const items = data.other_incomes || [];
  const rows = items.length ? items.map(o => `
      <tr>
        <td style="padding:6px 10px;">${o.label || o.field_key || '—'}${o.is_custom ? ' <span style="color:#888;font-size:11px;">(กำหนดเอง)</span>' : ''}</td>
        <td style="padding:6px 10px;text-align:right;">${fdMoney(o.amount)}</td>
      </tr>`).join('')
    : `<tr><td colspan="2" style="padding:8px;text-align:center;color:#aaa;">ไม่มีรายได้อื่น</td></tr>`;
  const total = items.reduce((sum, o) => sum + (parseFloat(o.amount) || 0), 0);

  panel.innerHTML = `
    <div class="step-card-header">
      <div class="step-card-num">2</div>
      <div><div class="step-card-title">รายได้อื่นที่ไม่นำมาคำนวณ</div></div>
    </div>
    <div style="padding:14px 16px;">
      <table class="adm-table"><tbody>${rows}</tbody></table>
      <div style="text-align:right;font-weight:700;color:#1a237e;margin-top:8px;">รวมรายได้อื่น: ${fdMoney(total)} บาท</div>
    </div>`;
}

function svRenderPanel3(data) {
  const panel = document.getElementById('fdPanel3');
  if (!panel) return;
  const licenses = data.licenses || [];
  const rows = licenses.length ? licenses.map(l => `
      <tr>
        <td style="padding:6px 10px;">${l.license_no || '—'}</td>
        <td style="padding:6px 10px;text-align:right;">${fdMoney(l.fee_amount)}</td>
        <td style="padding:6px 10px;text-align:right;color:#c62828;">${fdMoney(l.deduction_amount)}</td>
        <td style="padding:6px 10px;text-align:right;font-weight:600;">${fdMoney((parseFloat(l.fee_amount) || 0) - (parseFloat(l.deduction_amount) || 0))}</td>
      </tr>`).join('')
    : `<tr><td colspan="4" style="padding:8px;text-align:center;color:#aaa;">ไม่มีข้อมูล</td></tr>`;
  const totalDeduct = licenses.reduce((sum, l) => sum + (parseFloat(l.deduction_amount) || 0), 0);

  panel.innerHTML = `
    <div class="step-card-header">
      <div class="step-card-num">3</div>
      <div><div class="step-card-title">ค่าลดหย่อน</div></div>
    </div>
    <div style="padding:14px 16px;">
      <table class="adm-table">
        <thead><tr><th>เลขที่ใบอนุญาต</th><th>รายได้</th><th>ค่าลดหย่อน</th><th>รายได้หลังหักลดหย่อน</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="text-align:right;font-weight:700;color:#c62828;margin-top:8px;">รวมค่าลดหย่อนทั้งหมด: ${fdMoney(totalDeduct)} บาท</div>
    </div>`;
}

function svRenderPanel4(s) {
  const panel = document.getElementById('fdPanel4');
  if (!panel) return;
  const auditedDateBE = s.audited_date ? fdISOToThai(s.audited_date) : '—';
  const row = (label, val) => `
      <div class="adm-f-row"><label>${label}</label><div class="adm-f-view-value">${val || '—'}</div></div>`;
  panel.innerHTML = `
    <div class="step-card-header">
      <div class="step-card-num">4</div>
      <div><div class="step-card-title">ข้อมูลผู้สอบบัญชี</div></div>
    </div>
    <div class="adm-f-grid" style="padding:14px 16px;">
      <div class="adm-f-row" style="grid-column:1/-1;"><label>ชื่อผู้สอบบัญชี</label><div class="adm-f-view-value">${s.auditor_name || '—'}</div></div>
      ${row('เลขทะเบียนผู้สอบบัญชี', s.auditor_license)}
      ${row('สำนักงานสอบบัญชี', s.auditor_office)}
      ${row('วันที่ตรวจสอบ', auditedDateBE)}
    </div>`;
}

function svRenderPanel5(s) {
  const panel = document.getElementById('fdPanel5');
  if (!panel) return;
  const f = v => (parseFloat(v) || 0).toLocaleString('th-TH', {minimumFractionDigits:2, maximumFractionDigits:2});
  const row = (label, val) => `<div class="adm-f-row"><label>${label}</label><div class="adm-f-view-value">${f(val)} บาท</div></div>`;
  panel.innerHTML = `
    <div class="step-card-header">
      <div class="step-card-num">5</div>
      <div><div class="step-card-title">เงินสมทบกองทุน</div></div>
    </div>
    <div class="adm-f-grid" style="padding:14px 16px;">
      ${row('รายได้รวม', s.total_income)}
      ${row('ค่าลดหย่อน', s.deduction_amount)}
      ${row('เงินนำส่งกองทุน', s.fund_amount)}
      ${row('ภาษีมูลค่าเพิ่ม', s.vat_amount)}
      ${row('เงินเพิ่ม', s.extra_amount)}
      ${row('ยอดสุทธิที่ต้องชำระ', s.net_amount)}
    </div>`;
}

function svRenderPanel6(data) {
  const listEl = document.getElementById('fdAttachmentList');
  if (!listEl) return;
  const atts = data.attachments || [];
  listEl.innerHTML = atts.length ? atts.map(a => `
      <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #eee;">
        <div style="flex:1;font-size:12.5px;">${a.doc_type || a.file_name}</div>
        <div style="width:90px;text-align:center;">
          <button type="button" class="adm-btn adm-btn-sm" onclick="svDownloadAttachment('${a.id}')">ดาวน์โหลด</button>
        </div>
        <div style="width:200px;display:flex;align-items:center;gap:8px;justify-content:center;">
          <span style="font-size:12px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;" title="${a.file_name || ''}">${a.file_name || '—'}</span>
        </div>
      </div>`).join('')
    : `<div style="padding:16px;text-align:center;color:#aaa;">ไม่มีเอกสารแนบ</div>`;
}
