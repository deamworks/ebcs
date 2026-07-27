// ════════════════════════════════════════════════════
// js/admin-utils.js — e-BCS Admin Panel: utilities, modals, import/export,
//                     and the full submission detail view
//
// Loaded before admin.js (see admin.html script order), but every function
// here only runs from event handlers (onclick/DOMContentLoaded), so by the
// time anything actually executes both files are fully loaded — safe to
// reference admin.js globals (allSubmissions, showToast, writeAuditLog,
// loadSubmissions, loadLicenses, loadTaxpayers, currentAdminEmail,
// activeSubmissionId, ...) from here.
// ════════════════════════════════════════════════════

// ════════════════════ Small utilities ════════════════════

/** หมุนไอคอนรีเฟรชระหว่างรอ fn() ทำงาน (ใช้ class .spinning ที่มีอยู่แล้วใน admin.css) */
function spinRefreshIcon(btn, fn) {
  const icon = btn?.querySelector?.('.refresh-icon');
  icon?.classList.add('spinning');
  const done = () => setTimeout(() => icon?.classList.remove('spinning'), 500);
  try {
    const result = fn();
    if (result && typeof result.finally === 'function') result.finally(done);
    else done();
  } catch (e) {
    done();
  }
}

/** "YYYY-MM-DD HH:MM:SS" หรือ "YYYY-MM-DDTHH:MM:SS" → "DD/MM/YYYY HH:MM" (พ.ศ.)
 *  แปลงจาก string โดยตรง ไม่ผ่าน Date object เพื่อไม่ให้ browser แปลง timezone ซ้ำ
 *  ถ้าไม่มีเวลา (เป็นวันที่ล้วน) จะคืนค่าเป็น "DD/MM/YYYY" */
function fdDateTime(v) {
  if (!v) return '—';
  const s = String(v).replace('T', ' ');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    return `${d}/${mo}/${Number(y) + 543} ${h}:${mi}`;
  }
  return fdISOToThai(s);
}

/** "YYYY-MM-DD" (ค.ศ.) → "DD/MM/YYYY" (พ.ศ.) */
function fdISOToThai(iso) {
  if (!iso) return '';
  const s = String(iso).split('T')[0];
  const [y, m, d] = s.split('-');
  if (!y || !m || !d) return '';
  return `${d}/${m}/${parseInt(y, 10) + 543}`;
}

/** "DD/MM/YYYY" (พ.ศ.) → "YYYY-MM-DD" (ค.ศ.) */
function fdThaiToISO(str) {
  if (!str) return null;
  const p = str.trim().split('/');
  if (p.length !== 3) return null;
  const y = parseInt(p[2], 10) - 543;
  if (!y || isNaN(y)) return null;
  return `${y}-${p[1].padStart(2, '0')}-${p[0].padStart(2, '0')}`;
}

function fdMoney(n) {
  return (parseFloat(n) || 0).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** เริ่ม flatpickr (ปฏิทิน พ.ศ.) ให้ทุกช่อง .fd-buddhist-datepicker ที่ยังไม่ได้ init
 *  เรียกซ้ำได้ปลอดภัย — ข้ามช่องที่ init ไปแล้ว (เช็คจาก el._flatpickr) */
function initFdBuddhistDatepickers() {
  if (typeof flatpickr !== 'function') return;
  document.querySelectorAll('.fd-buddhist-datepicker').forEach(el => {
    if (el._flatpickr) return;
    flatpickr(el, {
      locale: 'th',
      dateFormat: 'd/m/Y',
      onReady: function (selectedDates, dateStr, instance) {
        if (!selectedDates || selectedDates.length === 0) {
          const now = new Date();
          instance.jumpToDate(new Date(now.getFullYear() + 543, now.getMonth(), now.getDate()), false);
        }
      },
    });
  });
}

/** alias — เรียกตอน enterDashboard() ก่อนหน้าใดๆ จะโหลดเสร็จ */
function initDatepickers() {
  initFdBuddhistDatepickers();
}


// ════════════════════ Taxpayer Modal (เพิ่มผู้ประกอบการ) ════════════════════
// หมายเหตุ: หน้าตารางผู้ประกอบการมีแค่ปุ่ม "+ เพิ่มผู้ประกอบการ" ไม่มีปุ่มแก้ไข
// ในตาราง — โมดัลนี้จึงรองรับเฉพาะการเพิ่มใหม่ (ตรงกับสิ่งที่ปุ่มจริงบน UI ทำ)

function openAddTaxpayerModal() {
  ['tp-ml-taxid', 'tp-ml-name', 'tp-ml-year', 'tp-ml-pstart', 'tp-ml-pend', 'tp-ml-due', 'tp-ml-refno']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  document.getElementById('tp-modal-title').textContent = 'เพิ่มผู้ประกอบการ';
  document.getElementById('tp-modal').style.display = 'flex';
  initFdBuddhistDatepickers();
}

function closeTaxpayerModal() {
  document.getElementById('tp-modal').style.display = 'none';
}

async function saveTaxpayer() {
  const btn = document.getElementById('tp-ml-save-btn');
  const taxId = document.getElementById('tp-ml-taxid').value.trim().replace(/-/g, '');
  const name  = document.getElementById('tp-ml-name').value.trim();
  const year  = parseInt(document.getElementById('tp-ml-year').value, 10) || 0;

  if (!taxId || taxId.length !== 13 || !/^\d+$/.test(taxId)) {
    alert('กรุณากรอกเลขประจำตัวผู้เสียภาษี 13 หลัก'); return;
  }
  if (!name) { alert('กรุณากรอกชื่อผู้ประกอบการ'); return; }
  if (!year) { alert('กรุณากรอกปีบัญชี'); return; }

  const payload = {
    tax_id: taxId,
    operator_name: name,
    fiscal_year: year,
    period_start: fdThaiToISO(document.getElementById('tp-ml-pstart').value),
    period_end:   fdThaiToISO(document.getElementById('tp-ml-pend').value),
    due_date:     fdThaiToISO(document.getElementById('tp-ml-due').value),
  };
  const refNo = document.getElementById('tp-ml-refno').value.trim();
  if (refNo) payload.ref_no = refNo;

  if (btn) btn.disabled = true;
  try {
    const data = await api.post('/admin/taxpayers', payload);
    await writeAuditLog(`เพิ่มผู้ประกอบการ ${name}`, 'taxpayer_master', data.id, payload);
    showToast('เพิ่มผู้ประกอบการสำเร็จ');
    closeTaxpayerModal();
    await loadTaxpayers();
  } catch (e) {
    alert('บันทึกผิดพลาด: ' + (e.message || ''));
  } finally {
    if (btn) btn.disabled = false;
  }
}


// ════════════════════ Import: ใบอนุญาต ════════════════════

let _licenseeImportFile = null;

async function handleLicenseeFile(input) {
  const file = input.files?.[0] || null;
  _licenseeImportFile = file;

  const warnEl    = document.getElementById('licensee-import-warning');
  const sectionEl = document.getElementById('licensee-import-section');
  const logEl     = document.getElementById('licensee-import-log');
  if (warnEl)   { warnEl.style.display = 'none'; warnEl.textContent = ''; }
  if (logEl)    logEl.innerHTML = '';
  if (sectionEl) sectionEl.style.display = 'none';
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', 'preview');

  let data;
  try {
    data = await api.upload('/admin/import/licensees', formData);
  } catch (e) {
    if (warnEl) { warnEl.textContent = 'อ่านไฟล์ไม่สำเร็จ: ' + (e.message || ''); warnEl.style.display = 'block'; }
    return;
  }

  document.getElementById('licensee-import-count').textContent =
    `พบข้อมูล ${data.total_rows} แถว — ถูกต้อง ${data.valid_rows} แถว, ผิดพลาด ${data.error_rows} แถว` +
    (data.valid_rows > 5 ? ' (แสดงตัวอย่าง 5 แถวแรก)' : '');

  const rows = data.preview_data || [];
  const tbody = document.getElementById('licensee-import-preview-body');
  tbody.innerHTML = rows.length ? rows.map((r, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="text-align:center">${r.tax_id || ''}</td>
        <td>${r.company_name || ''}</td>
        <td style="text-align:center">${r.license_no || ''}</td>
        <td style="text-align:center">${r.license_type || ''}</td>
        <td style="text-align:center">${fdISOToThai(r.license_start)}</td>
        <td style="text-align:center">${fdISOToThai(r.license_end)}</td>
        <td style="text-align:center">${r.license_status || ''}</td>
        <td style="text-align:center;color:#16a34a;">✓</td>
      </tr>`).join('')
    : `<tr><td colspan="9" style="text-align:center;color:#aaa;padding:12px;">ไม่มีแถวที่ถูกต้อง</td></tr>`;

  if (data.errors?.length) {
    if (logEl) logEl.innerHTML = data.errors
      .map(e => `<div style="color:#dc2626;">แถว ${e.row}: ${e.message}</div>`).join('');
  }

  document.getElementById('licensee-import-btn').disabled = !data.valid_rows;
  if (sectionEl) sectionEl.style.display = 'block';
}

async function startLicenseeImport() {
  if (!_licenseeImportFile) return;
  const btn  = document.getElementById('licensee-import-btn');
  const logEl = document.getElementById('licensee-import-log');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังนำเข้า...'; }

  const formData = new FormData();
  formData.append('file', _licenseeImportFile);
  formData.append('mode', 'commit');

  try {
    const data = await api.upload('/admin/import/licensees', formData);
    await writeAuditLog('นำเข้าข้อมูลใบอนุญาต', 'licensee_master', 'import',
      { inserted: data.inserted, updated: data.updated });
    if (logEl) logEl.innerHTML = `<div style="color:#16a34a;">${data.message}</div>`;
    showToast(data.message);
    await loadLicenses();
  } catch (e) {
    if (logEl) logEl.innerHTML = `<div style="color:#dc2626;">นำเข้าไม่สำเร็จ: ${e.message || ''}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'เริ่มการนำเข้าข้อมูล'; }
  }
}

function resetLicenseeImportPage() {
  _licenseeImportFile = null;
  const fileEl = document.getElementById('licenseeFile');
  if (fileEl) fileEl.value = '';
  const warnEl = document.getElementById('licensee-import-warning');
  if (warnEl) warnEl.style.display = 'none';
  const sectionEl = document.getElementById('licensee-import-section');
  if (sectionEl) sectionEl.style.display = 'none';
  const logEl = document.getElementById('licensee-import-log');
  if (logEl) logEl.innerHTML = '';
}


// ════════════════════ Import: ผู้ประกอบการ ════════════════════

let _taxpayerImportFile = null;

async function handleTaxpayerFile(input) {
  const file = input.files?.[0] || null;
  _taxpayerImportFile = file;

  const warnEl    = document.getElementById('taxpayer-import-warning');
  const sectionEl = document.getElementById('taxpayer-import-section');
  const logEl     = document.getElementById('taxpayer-import-log');
  if (warnEl)   { warnEl.style.display = 'none'; warnEl.textContent = ''; }
  if (logEl)    logEl.innerHTML = '';
  if (sectionEl) sectionEl.style.display = 'none';
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', 'preview');

  let data;
  try {
    data = await api.upload('/admin/import/taxpayers', formData);
  } catch (e) {
    if (warnEl) { warnEl.textContent = 'อ่านไฟล์ไม่สำเร็จ: ' + (e.message || ''); warnEl.style.display = 'block'; }
    return;
  }

  document.getElementById('taxpayer-import-count').textContent =
    `พบข้อมูล ${data.total_rows} แถว — ถูกต้อง ${data.valid_rows} แถว, ผิดพลาด ${data.error_rows} แถว` +
    (data.valid_rows > 5 ? ' (แสดงตัวอย่าง 5 แถวแรก)' : '');

  const rows = data.preview_data || [];
  const tbody = document.getElementById('taxpayer-import-preview-body');
  tbody.innerHTML = rows.length ? rows.map((r, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td style="text-align:center">${r.tax_id || ''}</td>
        <td>${r.operator_name || ''}</td>
        <td style="text-align:center">${fdISOToThai(r.period_start)}</td>
        <td style="text-align:center">${fdISOToThai(r.period_end)}</td>
        <td style="text-align:center">${fdISOToThai(r.due_date)}</td>
        <td style="text-align:center">${r.fiscal_year || ''}</td>
        <td style="text-align:center;color:#16a34a;">✓</td>
      </tr>`).join('')
    : `<tr><td colspan="8" style="text-align:center;color:#aaa;padding:12px;">ไม่มีแถวที่ถูกต้อง</td></tr>`;

  if (data.errors?.length) {
    if (logEl) logEl.innerHTML = data.errors
      .map(e => `<div style="color:#dc2626;">แถว ${e.row}: ${e.message}</div>`).join('');
  }

  document.getElementById('taxpayer-import-btn').disabled = !data.valid_rows;
  if (sectionEl) sectionEl.style.display = 'block';
}

async function startTaxpayerImport() {
  if (!_taxpayerImportFile) return;
  const btn  = document.getElementById('taxpayer-import-btn');
  const logEl = document.getElementById('taxpayer-import-log');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังนำเข้า...'; }

  const formData = new FormData();
  formData.append('file', _taxpayerImportFile);
  formData.append('mode', 'commit');

  try {
    const data = await api.upload('/admin/import/taxpayers', formData);
    await writeAuditLog('นำเข้าข้อมูลผู้ประกอบการ', 'taxpayer_master', 'import',
      { inserted: data.inserted, updated: data.updated });
    if (logEl) logEl.innerHTML = `<div style="color:#16a34a;">${data.message}</div>`;
    showToast(data.message);
    await loadTaxpayers();
  } catch (e) {
    if (logEl) logEl.innerHTML = `<div style="color:#dc2626;">นำเข้าไม่สำเร็จ: ${e.message || ''}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'เริ่มการนำเข้าข้อมูล'; }
  }
}

function resetTaxpayerImportPage() {
  _taxpayerImportFile = null;
  const fileEl = document.getElementById('taxpayerFile');
  if (fileEl) fileEl.value = '';
  const warnEl = document.getElementById('taxpayer-import-warning');
  if (warnEl) warnEl.style.display = 'none';
  const sectionEl = document.getElementById('taxpayer-import-section');
  if (sectionEl) sectionEl.style.display = 'none';
  const logEl = document.getElementById('taxpayer-import-log');
  if (logEl) logEl.innerHTML = '';
}


// ════════════════════ Export ════════════════════

function loadExportPage() {
  resetExportFilters();
}

function resetExportFilters() {
  const reportSel = document.getElementById('exp-report-type');
  if (reportSel) reportSel.value = '';
  ['exp-year-from', 'exp-year-to', 'exp-pay-from', 'exp-pay-to'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  document.querySelectorAll('#page-export input[type="checkbox"]').forEach(cb => { cb.checked = false; });
}

/** ดาวน์โหลดไฟล์ Excel จาก endpoint export ของ backend (ต้องแนบ JWT เอง เพราะ
 *  เป็นการโหลดไฟล์ตรงๆ ไม่ผ่าน api-client ซึ่งไม่รองรับการดาวน์โหลด blob) */
async function _fdDownloadReport(path, params) {
  const token = auth.getAdminToken();
  const res = await fetch(`${path}?${params.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    let msg = 'ส่งออกไม่สำเร็จ';
    try { msg = (await res.json()).error?.message || msg; } catch (e) {}
    throw new Error(msg);
  }
  const cd = res.headers.get('Content-Disposition') || '';
  const m  = cd.match(/filename\*=UTF-8''([^;]+)/);
  const filename = m ? decodeURIComponent(m[1]) : 'report.xlsx';
  const blob = await res.blob();

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

async function handleExportSubmit() {
  const reportType = document.getElementById('exp-report-type')?.value;
  if (!reportType) { alert('กรุณาเลือกรายงานที่ต้องการส่งออก'); return; }

  const endpoints = {
    1: '/api/admin/export/licensees',
    2: '/api/admin/export/taxpayers',
    3: '/api/admin/export/payments',
  };
  const path = endpoints[reportType];

  // backend รองรับ year เดี่ยว (ไม่รองรับช่วงปี) — ใช้ปีล่าสุดที่กรอกไว้
  const yearFrom = document.getElementById('exp-year-from')?.value.trim();
  const yearTo   = document.getElementById('exp-year-to')?.value.trim();
  const year = yearTo || yearFrom || '';

  const params = new URLSearchParams();
  if (year) params.set('year', year);

  if (reportType === '1') {
    const licStatusMap = {
      'ได้รับอนุญาต': 'active', 'ยกเลิกประกอบกิจการ': 'cancelled',
      'สิ้นสุดระยะเวลาอนุญาต': 'ended', 'เพิกถอนใบอนุญาต': 'revoked',
    };
    const statuses = [...document.querySelectorAll('.exp-cb-licstatus:checked')].map(el => el.value);
    // backend รับ status ได้ค่าเดียว — ใช้ค่าแรกที่เลือก ถ้าเลือกมากกว่า 1 จะกรองเฉพาะค่าแรก
    if (statuses.length) {
      const mapped = licStatusMap[statuses[0]];
      if (mapped) params.set('status', mapped);
    }
  }

  try {
    await _fdDownloadReport(path, params);
    await writeAuditLog('ส่งออกข้อมูล', 'export', String(reportType), { year: year || null });
    showToast('ส่งออกข้อมูลสำเร็จ');
  } catch (e) {
    showToast('ส่งออกไม่สำเร็จ: ' + (e.message || ''));
  }
}

/** เรียกจาก handleAdminExport() ใน admin.js เมื่อติ๊กเลือกแถวในตารางยื่นแบบ
 *  หมายเหตุ: backend export ตามปีบัญชี/ตัวกรองเท่านั้น ไม่รองรับส่งออกเฉพาะ
 *  รายการที่เลือกเป็นรายตัว — จึงใช้ปีบัญชีของรายการที่เลือก (ถ้าปีเดียวกันหมด)
 *  เป็นตัวกรองแทน และแจ้งผู้ใช้ให้ทราบข้อจำกัดนี้ */
async function exportFromApi(selectedRows) {
  if (!selectedRows || !selectedRows.length) return;
  const years = [...new Set(selectedRows.map(s => s.fiscal_year).filter(Boolean))];
  const params = new URLSearchParams();
  if (years.length === 1) params.set('year', years[0]);

  showToast(
    years.length === 1
      ? `กำลังส่งออกรายงานชำระเงินกองทุน ปี พ.ศ. ${years[0]}`
      : 'ระบบส่งออกได้ตามปีบัญชี ไม่ใช่รายการที่เลือกเจาะจง — กำลังส่งออกรายงานทั้งหมด'
  );

  try {
    await _fdDownloadReport('/api/admin/export/payments', params);
  } catch (e) {
    showToast('ส่งออกไม่สำเร็จ: ' + (e.message || ''));
  }
}


// ════════════════════ Full Submission Detail (โหมดดูอย่างเดียว) ════════════════════
// การเรนเดอร์จริงอยู่ใน submission-view.js (ใช้ร่วมกับหน้าผู้ประกอบการ view-submission.html)

let _fdSubmission = null;

async function openFullDetailModal(submissionId) {
  activeSubmissionId = submissionId;

  let data;
  try {
    data = await api.get(`/admin/submissions/${submissionId}`);
  } catch (e) {
    showToast('โหลดข้อมูลไม่สำเร็จ: ' + (e.message || ''));
    return;
  }
  _fdSubmission = data;

  SV_DOWNLOAD_BASE = '/api/admin/attachments/';
  svRenderSubmission(data);

  const adminLabelEl = document.getElementById('currentAdminLabel');
  if (adminLabelEl) adminLabelEl.textContent = (typeof currentAdminEmail !== 'undefined' && currentAdminEmail) || auth.getAdminEmail() || '—';

  if (typeof showPage === 'function') showPage('submission-detail');
  document.querySelector('.sb-item[data-page="submissions"]')?.classList.add('active');
}

function closeSubmissionDetail() {
  activeSubmissionId = null;
  _fdSubmission = null;
  if (typeof showPage === 'function') showPage('submissions');
}


// ════════════════════ Receipt modal close ════════════════════
// (openReceiptModal/submitReceiptModal อยู่ใน admin.js แล้ว แต่ไม่มี close)

function closeReceiptModal() {
  const modal = document.getElementById('receiptModal');
  if (modal) modal.style.display = 'none';
}


// ════════════════════ Income/Deduct edit modal stubs ════════════════════
// #fdIncomeModal / #fdDeductModal มีอยู่ใน admin.html แต่ไม่มีปุ่มเปิดใช้งาน
// จริง (Panel 1/3 เป็นแบบอ่านอย่างเดียวตามที่ตกลงไว้ — ดู scope note ด้านบน)
// ใส่ stub ไว้กันปุ่มปิด/บันทึกในโมดัล error ถ้ามีการเปิดใช้ในอนาคต

function cancelFdIncomeModal() { document.getElementById('fdIncomeModal')?.classList.remove('open'); }
function saveFdIncomeModal()   { cancelFdIncomeModal(); }
function cancelFdDeductModal() { document.getElementById('fdDeductModal')?.classList.remove('open'); }
function saveFdDeductModal()   { cancelFdDeductModal(); }
