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
    // [FIX] backend POST /admin/taxpayers บันทึก audit log ให้แล้ว (ไม่ต้องยิงซ้ำ)
    await api.post('/admin/taxpayers', payload);
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
        <td>${r.tax_id || ''}</td>
        <td>${r.company_name || ''}</td>
        <td>${r.license_no || ''}</td>
        <td>${r.license_type || ''}</td>
        <td>${fdISOToThai(r.license_start)}</td>
        <td>${fdISOToThai(r.license_end)}</td>
        <td>${r.license_status || ''}</td>
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
    `พบข้อมูล ${data.total_rows} แถว — ถูกต้อง ${data.valid_rows} แถว, ผิดพลาด ${data.error_rows} แถว` +
    (data.valid_rows > 5 ? ' (แสดงตัวอย่าง 5 แถวแรก)' : '');

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


// ════════════════════ Full Submission Detail Modal ════════════════════
// [Scope note] แสดงข้อมูล Step 1-3 (รายได้/รายได้อื่น/ค่าลดหย่อน) แบบอ่านอย่างเดียว
// ตามที่ผู้ประกอบการยื่นไว้จริง — แก้ไขได้เฉพาะ Step 4-5 (ข้อมูลผู้สอบบัญชี +
// ยอดเงินกองทุน) ซึ่งตรงกับฟิลด์ที่ PUT /api/admin/submissions/<id> รองรับจริง
// Step 6 แสดงไฟล์แนบที่มีอยู่ (ดู/ลบได้) — ระบบยังไม่รองรับอัปโหลดผ่านหน้าแอดมิน

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

  const adminLabelEl = document.getElementById('currentAdminLabel');
  if (adminLabelEl) adminLabelEl.textContent = (typeof currentAdminEmail !== 'undefined' && currentAdminEmail) || auth.getAdminEmail() || '—';

  _fdRenderPanel1(data);
  _fdRenderPanel2(data);
  _fdRenderPanel3(data);
  _fdRenderPanel4(s);
  _fdRenderPanel5(s);
  _fdRenderPanel6(data);

  fdShowStep(1);
  document.getElementById('fullDetailModal')?.classList.add('open');
  document.body.style.overflow = 'hidden';
}

function closeFullDetailModal() {
  document.getElementById('fullDetailModal')?.classList.remove('open');
  document.body.style.overflow = '';
  activeSubmissionId = null;
  _fdSubmission = null;
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

function _fdRenderPanel1(data) {
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

function _fdRenderPanel2(data) {
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

function _fdRenderPanel3(data) {
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

function _fdRenderPanel4(s) {
  const panel = document.getElementById('fdPanel4');
  if (!panel) return;
  const auditedDateBE = s.audited_date ? fdISOToThai(s.audited_date) : '';
  panel.innerHTML = `
    <div class="step-card-header">
      <div class="step-card-num">4</div>
      <div><div class="step-card-title">ข้อมูลผู้สอบบัญชี</div></div>
    </div>
    <div class="adm-f-grid" style="padding:14px 16px;">
      <div class="adm-f-row" style="grid-column:1/-1;">
        <label>ชื่อผู้สอบบัญชี</label>
        <input class="adm-form-input" id="fd-auditor-name" value="${s.auditor_name || ''}">
      </div>
      <div class="adm-f-row">
        <label>เลขทะเบียนผู้สอบบัญชี</label>
        <input class="adm-form-input" id="fd-auditor-license" value="${s.auditor_license || ''}">
      </div>
      <div class="adm-f-row">
        <label>สำนักงานสอบบัญชี</label>
        <input class="adm-form-input" id="fd-auditor-office" value="${s.auditor_office || ''}">
      </div>
      <div class="adm-f-row">
        <label>วันที่ตรวจสอบ</label>
        <input class="adm-form-input fd-buddhist-datepicker" id="fd-audited-date" value="${auditedDateBE}" placeholder="วัน/เดือน/ปี" readonly>
      </div>
    </div>`;
  initFdBuddhistDatepickers();
}

function _fdRenderPanel5(s) {
  const panel = document.getElementById('fdPanel5');
  if (!panel) return;
  const f = v => (parseFloat(v) || 0).toFixed(2);
  panel.innerHTML = `
    <div class="step-card-header">
      <div class="step-card-num">5</div>
      <div><div class="step-card-title">เงินสมทบกองทุน</div><div class="step-card-subtitle">แก้ไขได้กรณีต้องปรับยอดหลังตรวจสอบ</div></div>
    </div>
    <div class="adm-f-grid" style="padding:14px 16px;">
      <div class="adm-f-row"><label>รายได้รวม</label><input class="adm-form-input" id="fd-total-income" type="number" step="0.01" value="${f(s.total_income)}"></div>
      <div class="adm-f-row"><label>ค่าลดหย่อน</label><input class="adm-form-input" id="fd-deduction-amount" type="number" step="0.01" value="${f(s.deduction_amount)}"></div>
      <div class="adm-f-row"><label>เงินนำส่งกองทุน</label><input class="adm-form-input" id="fd-fund-amount" type="number" step="0.01" value="${f(s.fund_amount)}"></div>
      <div class="adm-f-row"><label>ภาษีมูลค่าเพิ่ม</label><input class="adm-form-input" id="fd-vat-amount" type="number" step="0.01" value="${f(s.vat_amount)}"></div>
      <div class="adm-f-row"><label>เงินเพิ่ม</label><input class="adm-form-input" id="fd-extra-amount" type="number" step="0.01" value="${f(s.extra_amount)}"></div>
      <div class="adm-f-row"><label>ยอดสุทธิที่ต้องชำระ</label><input class="adm-form-input" id="fd-net-amount" type="number" step="0.01" value="${f(s.net_amount)}"></div>
    </div>`;
}

function _fdRenderPanel6(data) {
  const listEl = document.getElementById('fdAttachmentList');
  if (!listEl) return;
  const atts = data.attachments || [];
  listEl.innerHTML = atts.length ? atts.map(a => `
      <div style="display:flex;align-items:center;padding:8px 0;border-bottom:1px solid #eee;">
        <div style="flex:1;font-size:12.5px;">${a.doc_type || a.file_name}</div>
        <div style="width:90px;text-align:center;">
          <button type="button" class="adm-btn adm-btn-sm" onclick="viewAttachment('${a.id}')">ดาวน์โหลด</button>
        </div>
        <div style="width:200px;display:flex;align-items:center;gap:8px;justify-content:center;">
          <span style="font-size:12px;color:#555;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;max-width:130px;" title="${a.file_name || ''}">${a.file_name || '—'}</span>
          <button type="button" class="adm-btn adm-btn-sm adm-btn-danger" onclick="deleteAttachment('${a.id}', null, '${(a.file_name || '').replace(/'/g, "\\'")}')">ลบ</button>
        </div>
      </div>`).join('')
    : `<div style="padding:16px;text-align:center;color:#aaa;">ไม่มีเอกสารแนบ (ระบบยังไม่รองรับการอัปโหลดผ่านหน้าแอดมิน)</div>`;
}

/** เรียกใหม่หลังลบไฟล์แนบ เพื่อรีเฟรชรายการใน Panel 6 */
async function loadFdDocList(submissionId) {
  if (!submissionId) return;
  try {
    const data = await api.get(`/admin/submissions/${submissionId}`);
    _fdSubmission = data;
    _fdRenderPanel6(data);
  } catch (e) { /* ignore — โหลดครั้งถัดไปตอนเปิด modal ใหม่ก็จะได้ข้อมูลล่าสุด */ }
}

async function saveFullDetailChanges() {
  if (!activeSubmissionId) return;
  const btn = document.getElementById('fdSaveBtn');
  const btnInline = document.getElementById('fdSaveBtnInline');
  [btn, btnInline].forEach(b => { if (b) b.disabled = true; });

  const payload = {
    auditor_name:    document.getElementById('fd-auditor-name')?.value.trim() || '',
    auditor_license: document.getElementById('fd-auditor-license')?.value.trim() || '',
    auditor_office:  document.getElementById('fd-auditor-office')?.value.trim() || '',
    audited_date:    fdThaiToISO(document.getElementById('fd-audited-date')?.value),
    total_income:     parseFloat(document.getElementById('fd-total-income')?.value) || 0,
    deduction_amount: parseFloat(document.getElementById('fd-deduction-amount')?.value) || 0,
    fund_amount:      parseFloat(document.getElementById('fd-fund-amount')?.value) || 0,
    vat_amount:       parseFloat(document.getElementById('fd-vat-amount')?.value) || 0,
    extra_amount:     parseFloat(document.getElementById('fd-extra-amount')?.value) || 0,
    net_amount:       parseFloat(document.getElementById('fd-net-amount')?.value) || 0,
  };

  try {
    // [FIX] backend PUT /admin/submissions/<id> บันทึก audit log แบบ diff ให้แล้ว (ไม่ต้องยิงซ้ำ)
    await api.put(`/admin/submissions/${activeSubmissionId}`, payload);
    showToast('บันทึกการเปลี่ยนแปลงเรียบร้อยแล้ว ✓');
    closeFullDetailModal();
    await loadSubmissions();
  } catch (e) {
    showToast('บันทึกไม่สำเร็จ: ' + (e.message || ''));
  } finally {
    [btn, btnInline].forEach(b => { if (b) b.disabled = false; });
  }
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
