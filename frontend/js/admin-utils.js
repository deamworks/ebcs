// ════════════════════════════════════════════════════
// js/admin-utils.js — NBTC Filing Admin Panel: utilities, modals, import/export,
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

/** ตั้งค่าช่อง .fd-buddhist-datepicker จากวันที่ ISO ("YYYY-MM-DD") ให้ถูกต้อง —
 *  ต้องตั้งผ่าน flatpickr API (setDate) เท่านั้น ห้ามเซ็ต el.value ตรงๆ เพราะ
 *  input ช่องนี้เป็น readonly และผูกกับ instance ของ flatpickr อยู่แล้ว การเซ็ต
 *  .value ตรงๆ ทำให้ข้อความที่โชว์กับสถานะภายในปฏิทิน (ปีที่กำลังเลื่อนดูอยู่)
 *  ไม่ตรงกัน พอเปิดปฏิทินขึ้นมาอีกครั้ง (เช่น modal เดียวกันถูกใช้ซ้ำระหว่างโหมด
 *  "เพิ่ม" กับ "แก้ไข") ปฏิทินจะเลื่อนกลับไปปีปัจจุบันแบบ ค.ศ. แทนที่จะเป็น พ.ศ. */
function fdSetDate(id, iso) {
  const el = document.getElementById(id);
  if (!el) return;
  const thaiStr = fdISOToThai(iso);
  if (el._flatpickr) {
    if (thaiStr) el._flatpickr.setDate(thaiStr, true, 'd/m/Y');
    else el._flatpickr.clear();
  } else {
    el.value = thaiStr;
  }
}

/** ล้างค่าช่อง .fd-buddhist-datepicker ผ่าน flatpickr API — คู่กับ fdSetDate() */
function fdClearDate(id) {
  const el = document.getElementById(id);
  if (!el) return;
  if (el._flatpickr) el._flatpickr.clear();
  else el.value = '';
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
  ['tp-ml-id', 'tp-ml-taxid', 'tp-ml-name', 'tp-ml-year', 'tp-ml-refno']
    .forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
  ['tp-ml-pstart', 'tp-ml-pend', 'tp-ml-due'].forEach(fdClearDate);
  document.getElementById('tp-ml-roundtype').value = 'รอบปกติ';
  document.getElementById('tp-ml-subtype').value   = 'ปกติ';
  document.getElementById('tp-ml-taxid').disabled  = false;
  document.getElementById('tp-modal-title').textContent = 'เพิ่มผู้ประกอบการ';
  document.getElementById('tp-modal').style.display = 'flex';
  initFdBuddhistDatepickers();
}

function openEditTaxpayerModal(id) {
  const r = (allTaxpayers || []).find(t => t.id === id);
  if (!r) return;
  document.getElementById('tp-ml-id').value       = r.id;
  document.getElementById('tp-ml-taxid').value    = r.tax_id || '';
  document.getElementById('tp-ml-taxid').disabled = true; // แก้ tax_id ทีหลังไม่ได้ (เป็น key ผูกกับปีบัญชี)
  document.getElementById('tp-ml-name').value     = r.operator_name || '';
  document.getElementById('tp-ml-year').value     = r.fiscal_year || '';
  fdSetDate('tp-ml-pstart', r.period_start);
  fdSetDate('tp-ml-pend',   r.period_end);
  fdSetDate('tp-ml-due',    r.due_date);
  document.getElementById('tp-ml-refno').value    = r.ref_no || '';
  document.getElementById('tp-ml-roundtype').value = r.round_type || 'รอบปกติ';
  document.getElementById('tp-ml-subtype').value  = r.sub_type || 'ปกติ';
  document.getElementById('tp-modal-title').textContent = 'แก้ไขผู้ประกอบการ';
  document.getElementById('tp-modal').style.display = 'flex';
  initFdBuddhistDatepickers();
}

function closeTaxpayerModal() {
  document.getElementById('tp-modal').style.display = 'none';
}

async function saveTaxpayer() {
  const btn = document.getElementById('tp-ml-save-btn');
  const id    = document.getElementById('tp-ml-id').value;
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
    round_type:   document.getElementById('tp-ml-roundtype').value,
    sub_type:     document.getElementById('tp-ml-subtype').value.trim() || null,
  };
  const refNo = document.getElementById('tp-ml-refno').value.trim();
  if (refNo) payload.ref_no = refNo;

  if (btn) btn.disabled = true;
  try {
    // [FIX] backend POST/PUT /admin/taxpayers บันทึก audit log ให้แล้ว (ไม่ต้องยิงซ้ำ)
    if (id) await api.put(`/admin/taxpayers/${id}`, payload);
    else    await api.post('/admin/taxpayers', payload);
    showToast(id ? 'แก้ไขผู้ประกอบการสำเร็จ' : 'เพิ่มผู้ประกอบการสำเร็จ');
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

/** แปลงสถานะใบอนุญาต (เก็บเป็น key ภาษาอังกฤษ) เป็นข้อความภาษาไทยสำหรับตารางตัวอย่างนำเข้า */
const LICENSEE_IMPORT_STATUS_TH = {
  active:    'ปกติ',
  cancelled: 'ยกเลิก',
  revoked:   'เพิกถอน',
  ended:     'สิ้นสุด',
};

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
    `พบข้อมูล ${data.total_rows} แถว — ถูกต้อง ${data.valid_rows} แถว, ผิดพลาด ${data.error_rows} แถว`;

  const rows = data.preview_data || [];
  const tbody = document.getElementById('licensee-import-preview-body');
  tbody.innerHTML = rows.length ? rows.map((r, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${r.tax_id || ''}</td>
        <td>${r.company_name || ''}</td>
        <td>${r.license_no || ''}</td>
        <td>${r.license_type || ''}</td>
        <td>${fdISOToThai(r.license_start)}</td>
        <td>${fdISOToThai(r.license_end)}</td>
        <td>${LICENSEE_IMPORT_STATUS_TH[r.license_status] || r.license_status || ''}</td>
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
    // [FIX] backend /admin/import/licensees บันทึก audit log ให้แล้ว (ไม่ต้องยิงซ้ำ)
    const data = await api.upload('/admin/import/licensees', formData);
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
    `พบข้อมูล ${data.total_rows} แถว — ถูกต้อง ${data.valid_rows} แถว, ผิดพลาด ${data.error_rows} แถว`;

  const rows = data.preview_data || [];
  const tbody = document.getElementById('taxpayer-import-preview-body');
  tbody.innerHTML = rows.length ? rows.map((r, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${r.tax_id || ''}</td>
        <td>${r.operator_name || ''}</td>
        <td>${fdISOToThai(r.period_start)}</td>
        <td>${fdISOToThai(r.period_end)}</td>
        <td>${fdISOToThai(r.due_date)}</td>
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
    // [FIX] backend /admin/import/taxpayers บันทึก audit log ให้แล้ว (ไม่ต้องยิงซ้ำ)
    const data = await api.upload('/admin/import/taxpayers', formData);
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
  return filename;
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

  // [FIX] เดิม backend รองรับ year เดี่ยว ใช้แค่ "ถึง" ทิ้งค่า "จาก" ไปเฉยๆ —
  // ตอนนี้ส่งเป็นช่วงปีจริง (year_from/year_to) ให้ backend กรองแบบ BETWEEN
  const yearFrom = document.getElementById('exp-year-from')?.value.trim();
  const yearTo   = document.getElementById('exp-year-to')?.value.trim();

  const params = new URLSearchParams();
  if (yearFrom) params.set('year_from', yearFrom);
  if (yearTo)   params.set('year_to', yearTo);

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

  if (reportType === '3') {
    // [FIX] สถานะการชำระเงินไม่เคยถูกส่งไปกรองเลย — เชื่อมกับสถานะจริงที่ระบบ
    // มี (draft/pending_payment/paid) ส่วนตัวเลือกอื่น (รอบันทึก,
    // สอบทานแล้ว, เห็นชอบแล้ว, END) ยังไม่มีสถานะแบบนั้นในระบบจริง เลือกแล้วจะไม่มีข้อมูลตรงกัน
    const payStatusMap = {
      'ร่าง': 'draft',
      'รอชำระเงิน': 'pending_payment', 'ชำระเงินแล้ว': 'paid',
    };
    const statuses = [...document.querySelectorAll('.exp-cb-paystatus:checked')].map(el => el.value);
    statuses.forEach(s => { if (payStatusMap[s]) params.append('status', payStatusMap[s]); });
  }

  // [FIX] เดิม audit log ระบุแค่เลขรายงาน (1/2/3) และไม่บอกชื่อไฟล์ที่ได้เลย
  const reportNames = {
    1: 'รายงานข้อมูลใบอนุญาต',
    2: 'รายงานข้อมูลผู้ประกอบการ',
    3: 'รายงานข้อมูลการชำระเงินกองทุนประจำปี',
  };
  const reportName = reportNames[reportType] || `รายงาน ${reportType}`;

  try {
    const filename = await _fdDownloadReport(path, params);
    await writeAuditLog(`ส่งออก${reportName}`, 'export', reportName, {
      file_name: filename, year_from: yearFrom || null, year_to: yearTo || null,
    });
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
    const filename = await _fdDownloadReport('/api/admin/export/payments', params);
    await writeAuditLog(
      'ส่งออกรายงานข้อมูลการชำระเงินกองทุนประจำปี',
      'export', 'รายงานข้อมูลการชำระเงินกองทุนประจำปี',
      { file_name: filename, year: years.length === 1 ? years[0] : null }
    );
  } catch (e) {
    showToast('ส่งออกไม่สำเร็จ: ' + (e.message || ''));
  }
}


