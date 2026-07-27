// ════════════════════════════════════════════════════
// js/admin.js — e-BCS Admin Panel (รวมทุก module)
// ════════════════════════════════════════════════════

// ── Helpers ───────────────────────────────────────────
function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d)) return iso;
  return d.toLocaleDateString('th-TH', { year:'numeric', month:'short', day:'numeric' });
}
function fmtDateDMY(iso) {
  if (!iso) return '—';
  const s = String(iso).split('T')[0];
  const [y,m,d] = s.split('-');
  return `${d}/${m}/${parseInt(y)+543}`;
}
function fmtMoney(n) {
  return (parseFloat(n)||0).toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
}

// ── Global State ──────────────────────────────────────
let allSubmissions    = [];
let allLicenses       = [];
let allTaxpayers      = [];
let currentAdminEmail = '';
let activeSubmissionId = null;



// ════════════════════ // ── Auth ── ════════════════════
// ── Auth ─────────────────────────────────────────────────────

async function handleLogin() {
  const email    = document.getElementById('loginEmail').value.trim();
  const password = document.getElementById('loginPassword').value;
  const errEl    = document.getElementById('loginError');
  const btn      = document.getElementById('loginBtn');

  if (errEl) errEl.style.display = 'none';
  if (!email || !password) {
    if (errEl) { errEl.textContent = 'กรุณากรอกอีเมลและรหัสผ่าน'; errEl.style.display = 'block'; }
    return;
  }

  if (btn) { btn.disabled = true; btn.textContent = 'กำลังเข้าสู่ระบบ...'; }

  try {
    // [FIX] api.post() คืนค่า data ที่ parse แล้ว (ไม่ใช่ raw Response)
    // และ throw ApiError เองถ้า success:false — ไม่ต้องเรียก .json() ซ้ำ
    const data = await api.post('/auth/admin/login', { email, password });

    localStorage.setItem('ebcs_admin_token', data.token);
    enterDashboard(data.admin.email, data.admin.full_name);

  } catch (e) {
    if (errEl) { errEl.textContent = e.message || 'เชื่อมต่อเซิร์ฟเวอร์ไม่ได้ กรุณาลองใหม่'; errEl.style.display = 'block'; }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'เข้าสู่ระบบ'; }
  }
}

function enterDashboard(email, fullName) {
  currentAdminEmail = email;
  const shell = document.getElementById('adminShell');
  if (shell) shell.style.display = 'flex';
  const emailEl = document.getElementById('adminEmailDisplay');
  if (emailEl) { emailEl.textContent = fullName || email; emailEl.title = email; }
  if (typeof initDatepickers === 'function') initDatepickers();
  setTimeout(() => showPage('submissions'), 50);
}

function handleLogout() { auth.logoutAdmin(); }

function checkAdminAuth() {
  const token = localStorage.getItem('ebcs_admin_token');
  if (!token) return;
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.exp && payload.exp * 1000 < Date.now()) {
      localStorage.removeItem('ebcs_admin_token');
      return;
    }
    if (payload.role === 'admin') {
      enterDashboard(payload.sub, payload.full_name);
    }
  } catch (e) {
    localStorage.removeItem('ebcs_admin_token');
  }
}


// ════════════════════ // ── Audit ── ════════════════════
// ── Audit Log ─────────────────────────────────────────────────

async function writeAuditLog(action, tableName, recordId, changes) {
  try {
    await api.post('/admin/audit-logs', {
      action,
      table_name: tableName,
      record_id:  String(recordId),
      changes,
    });
  } catch (e) {
    console.warn('[audit]', e);
  }
}

async function loadAuditLogs() {
  const search   = (document.getElementById('audit-search')?.value || '').toLowerCase();
  const yearFrom = (document.getElementById('audit-year-from')?.value || '').trim();
  const yearTo   = (document.getElementById('audit-year-to')?.value   || '').trim();
  const actions  = [...document.querySelectorAll('.audit-cb-action:checked')].map(el => el.value);

  const params = new URLSearchParams();
  if (yearFrom) params.set('year_from', String(parseInt(yearFrom) - 543));
  if (yearTo)   params.set('year_to',   String(parseInt(yearTo)   - 543));

  let data;
  try {
    data = await api.get('/admin/audit-logs?' + params.toString());
  } catch (e) {
    showToast('เกิดข้อผิดพลาดในการโหลดประวัติการดำเนินการ');
    return;
  }

  const rows = (data.logs || []).filter(r => {
    if (search && !`${r.admin_email} ${r.action} ${r.table_name}`.toLowerCase().includes(search)) return false;
    if (actions.length && !actions.some(a => (r.action || '').startsWith(a))) return false;
    return true;
  });

  // created_at เป็นเวลาประเทศไทย (Asia/Bangkok) ที่ backend จัดรูปแบบมาแล้วเป็น "YYYY-MM-DD HH:MM:SS"
  // แสดงผลตรงจาก string โดยไม่ผ่าน Date object เพื่อไม่ให้ browser แปลง timezone ซ้ำ
  const fmtDT = str => {
    if (!str) return '—';
    const m = String(str).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (!m) return str;
    const [, y, mo, d, h, mi] = m;
    return `${d}/${mo}/${Number(y)+543} ${h}:${mi}`;
  };

  const actionColor = a => {
    if (a.startsWith('เพิ่ม') || a.startsWith('นำเข้า')) return 'color:#16a34a;font-weight:600';
    if (a.startsWith('ลบ'))   return 'color:#dc2626;font-weight:600';
    return 'color:#2e86ab;font-weight:600';
  };

  const tbody = document.getElementById('audit-tbody');
  if (!tbody) return;
  tbody.innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td style="color:#888;font-size:11px">${fmtDT(r.created_at)}</td>
      <td style="font-size:11px">${r.admin_email || '—'}</td>
      <td style="${actionColor(r.action || '')}">${r.action || '—'}</td>
      <td style="font-size:11px;color:#888">${r.table_name_th || r.table_name || '—'}</td>
      <td style="font-size:11px;max-width:200px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.record_label || r.record_id || '—'}</td>
    </tr>`).join('')
    : '<tr><td colspan="5" style="padding:20px;text-align:center;color:#aaa">ไม่พบข้อมูลประวัติการดำเนินการ</td></tr>';
}

function clearAuditFilters() {
  const s = document.getElementById('audit-search'); if (s) s.value = '';
  const yf = document.getElementById('audit-year-from'); if (yf) yf.value = '';
  const yt = document.getElementById('audit-year-to');   if (yt) yt.value = '';
  document.querySelectorAll('.audit-cb-action').forEach(cb => cb.checked = false);
  loadAuditLogs();
}


// ════════════════════ // ── Table ── ════════════════════
// ── Submissions Table ─────────────────────────────────────────

async function loadSubmissions() {
  const tbody = document.getElementById('submissionsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="10" style="padding:20px;text-align:center;color:#888">กำลังโหลดข้อมูล...</td></tr>';

  const selectAllCb = document.getElementById('selectAll');
  if (selectAllCb) selectAllCb.checked = false;

  let data;
  try {
    data = await api.get('/admin/submissions?per_page=500');
  } catch (e) {
    tbody.innerHTML = `<tr><td colspan="10" class="empty-state">เกิดข้อผิดพลาด: ${e.message || 'ไม่ทราบสาเหตุ'}</td></tr>`;
    return;
  }

  allSubmissions = (data.items || []).map(s => ({
    ...s,
    _derivedStatus: s.status,
  }));

  renderSubmissionYearTabs();
  renderTable();
}

// ── ตัวกรองปี ─────────────────────────────────────────────────
let activeSubmissionYear = null;

function getAvailableSubmissionYears() {
  return [...new Set((allSubmissions || []).map(s => s.fiscal_year).filter(Boolean))].sort((a, b) => b - a);
}

function renderSubmissionYearTabs() {
  const el = document.getElementById('sub-year-tabs');
  if (!el) return;
  const years = getAvailableSubmissionYears();
  if (activeSubmissionYear !== null && !years.includes(activeSubmissionYear)) activeSubmissionYear = null;
  const label = activeSubmissionYear === null ? 'ทั้งหมด' : `พ.ศ. ${activeSubmissionYear}`;
  el.innerHTML = `
    <div class="year-ms-wrap">
      <button type="button" class="year-ms-btn" onclick="toggleSubmissionYearPanel(event)" aria-expanded="false" ${years.length === 0 ? 'disabled' : ''}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/></svg>
        <span>${label}</span>
        <svg class="year-ms-caret" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="6 9 12 15 18 9"/></svg>
      </button>
      <div class="year-ms-panel collapsed" id="sub-year-panel">
        <div class="year-ms-item year-ms-item-all ${activeSubmissionYear === null ? 'selected' : ''}" onclick="setSubmissionYearFilter(null)">ทั้งหมด</div>
        <div class="year-ms-divider"></div>
        ${years.map(y => `<div class="year-ms-item ${activeSubmissionYear === y ? 'selected' : ''}" onclick="setSubmissionYearFilter(${y})">พ.ศ. ${y}</div>`).join('')}
      </div>
    </div>`;
}

function toggleSubmissionYearPanel(evt) {
  evt.stopPropagation();
  const panel = document.getElementById('sub-year-panel');
  const btn = evt.currentTarget;
  const wasOpen = !panel.classList.contains('collapsed');
  document.querySelectorAll('.year-ms-panel').forEach(p => p.classList.add('collapsed'));
  document.querySelectorAll('.year-ms-btn').forEach(b => b.setAttribute('aria-expanded', 'false'));
  if (!wasOpen) { panel.classList.remove('collapsed'); btn.setAttribute('aria-expanded', 'true'); }
}

document.addEventListener('click', e => {
  if (!e.target.closest('.year-ms-wrap'))
    document.querySelectorAll('.year-ms-panel').forEach(p => p.classList.add('collapsed'));
});

function setSubmissionYearFilter(year) {
  activeSubmissionYear = year;
  renderSubmissionYearTabs();
  renderTable();
}

// ── สถานะ ──────────────────────────────────────────────────────
const SUBMISSION_STATUS_META = {
  draft:           { label: 'ร่าง',          color: '#888',    bg: '#f5f5f5' },
  pending_payment: { label: 'รอชำระเงิน',   color: '#dc2626', bg: '#fff0f0' },
  paid:            { label: 'ชำระเงินแล้ว',  color: '#2e86ab', bg: '#f0f6ff' },
};

function renderSubmissionStatusCell(s) {
  const current = s.status || 'draft';
  const meta    = SUBMISSION_STATUS_META[current] || SUBMISSION_STATUS_META.draft;
  return `<span style="background:${meta.bg};color:${meta.color};border:1px solid ${meta.color}55;
                border-radius:99px;padding:3px 10px;font-size:11px;font-weight:600;white-space:nowrap;">
            ${meta.label}
          </span>`;
}

// ── บันทึกรับชำระ ──────────────────────────────────────────────
async function openReceiptModal(submissionId) {
  const modal = document.getElementById('receiptModal');
  if (!modal) {
    // ถ้าไม่มี modal ในหน้า ให้ใช้ prompt แทนชั่วคราว
    const receiptNo = prompt('เลขที่ใบเสร็จ:');
    if (!receiptNo) return;
    const amount = parseFloat(prompt('ยอดชำระ (บาท):') || '0');
    await recordReceipt(submissionId, receiptNo, amount);
    return;
  }
  document.getElementById('receipt-sub-id').value = submissionId;
  document.getElementById('receipt-no').value     = '';
  document.getElementById('receipt-amount').value = '';
  modal.style.display = 'flex';
}

async function submitReceiptModal() {
  const subId     = document.getElementById('receipt-sub-id').value;
  const receiptNo = document.getElementById('receipt-no').value.trim();
  const amount    = parseFloat(document.getElementById('receipt-amount').value || '0');
  if (!receiptNo) { alert('กรุณากรอกเลขที่ใบเสร็จ'); return; }
  await recordReceipt(subId, receiptNo, amount);
  document.getElementById('receiptModal').style.display = 'none';
}

async function recordReceipt(submissionId, receiptNo, amount) {
  try {
    // [FIX] เดิมไม่ได้ส่ง submission_id ไปด้วย ทั้งที่ backend ต้องการ (required field)
    await api.post('/admin/receipts', {
      submission_id: submissionId,
      receipt_no:    receiptNo,
      amount,
      received_at:   new Date().toISOString().slice(0, 10),
    });
  } catch (e) {
    showToast('บันทึกไม่สำเร็จ: ' + (e.message || ''));
    return;
  }
  showToast('บันทึกรับชำระเรียบร้อยแล้ว ✓');
  await loadSubmissions();
}

// ── renderTable ─────────────────────────────────────────────────
function renderTable() {
  const tbody   = document.getElementById('submissionsTableBody');
  if (!tbody) return;

  const search      = (document.getElementById('filterSearch')?.value || '').trim().toLowerCase();
  const yearFromVal = (document.getElementById('filterYearFrom')?.value || '').trim();
  const yearToVal   = (document.getElementById('filterYearTo')?.value   || '').trim();
  const yearFrom    = parseInt(yearFromVal) || null;
  const yearTo      = parseInt(yearToVal)   || null;
  const payStatuses = [...document.querySelectorAll('.filter-cb-paystatus:checked')].map(el => el.value);
  const types       = [...document.querySelectorAll('.filter-cb-type:checked')].map(el => el.value);
  const rounds      = [...document.querySelectorAll('.filter-cb-round:checked')].map(el => el.value);
  const licStatuses = [...document.querySelectorAll('.filter-cb-licstatus:checked')].map(el => el.value);
  const licTypes    = [...document.querySelectorAll('.filter-cb-lictype:checked')].map(el => el.value);

  let rows = allSubmissions;
  if (search) rows = rows.filter(s =>
    (s.operator_name || '').toLowerCase().includes(search) ||
    (s.ref_no || '').toLowerCase().includes(search) ||
    (s.tax_id || '').toLowerCase().includes(search)
  );
  if (yearFrom) rows = rows.filter(s => (s.fiscal_year || 0) >= yearFrom);
  if (yearTo)   rows = rows.filter(s => (s.fiscal_year || 0) <= yearTo);
  if (activeSubmissionYear !== null) rows = rows.filter(s => s.fiscal_year === activeSubmissionYear);
  if (payStatuses.length) rows = rows.filter(s => payStatuses.includes(s.status || ''));
  if (types.length) rows = rows.filter(s => types.includes(s.licensee_type || ''));
  if (rounds.length) rows = rows.filter(s => rounds.some(rd => (s.period_round || '').includes(rd.replace('รอบ', ''))));
  if (licStatuses.length) rows = rows.filter(s =>
    (allLicenses || []).some(l => l.tax_id === s.tax_id && licStatuses.includes(l.license_status || '')));
  if (licTypes.length) rows = rows.filter(s =>
    (allLicenses || []).some(l => l.tax_id === s.tax_id && licTypes.includes(l.licensee_type || '')));

  document.getElementById('tableCount').textContent = `แสดง ${rows.length} / ${allSubmissions.length} รายการ`;

  // การ์ดสถิติ
  const totalEl   = document.getElementById('sub-st-total');
  const pendingEl = document.getElementById('sub-st-pending');
  const paidEl    = document.getElementById('sub-st-paid');
  const draftEl   = document.getElementById('sub-st-draft');
  if (totalEl) {
    const all = activeSubmissionYear === null ? allSubmissions : allSubmissions.filter(s => s.fiscal_year === activeSubmissionYear);
    totalEl.textContent   = all.length.toLocaleString();
    pendingEl.textContent = all.filter(s => s.status === 'pending_payment').length.toLocaleString();
    paidEl.textContent    = all.filter(s => s.status === 'paid').length.toLocaleString();
    draftEl.textContent   = all.filter(s => s.status === 'draft').length.toLocaleString();
  }

  if (!rows.length) {
    tbody.innerHTML = '<tr><td colspan="10" style="padding:20px;text-align:center;color:#aaa">ไม่พบข้อมูล</td></tr>';
    return;
  }

  tbody.innerHTML = rows.map(s => `
    <tr>
      <td style="text-align:center"><input type="checkbox" class="sub-checker" data-id="${s.id}"></td>
      <td style="text-align:center;color:#1565c0;font-weight:600;font-size:12.5px;white-space:nowrap">${s.ref_no || '—'}</td>
      <td style="font-size:12.5px">${s.operator_name || '—'}</td>
      <td style="text-align:center;font-size:12.5px;white-space:nowrap">${s.tax_id || '—'}</td>
      <td style="text-align:center;font-size:12.5px">${s.fiscal_year || '—'}</td>
      <td style="text-align:center;font-size:12.5px;white-space:nowrap">${s.due_date ? fmtDate(s.due_date) : '—'}</td>
      <td style="text-align:center;font-size:12.5px;white-space:nowrap">${s.net_amount ? Number(s.net_amount).toLocaleString('th-TH',{minimumFractionDigits:2}) : '—'}</td>
      <td style="text-align:center;font-size:12.5px;white-space:nowrap">${fmtDate(s.submitted_at)}</td>
      <td style="text-align:center">${renderSubmissionStatusCell(s)}</td>
      <td style="text-align:center">
        ${s.status === 'pending_payment' ? `<button class="adm-btn adm-btn-sm adm-btn-success" onclick="openReceiptModal('${s.id}')">บันทึกรับชำระ</button>` : ''}
        <button class="adm-btn adm-btn-sm" onclick="window.open('/pages/admin-view-submission.html?id=${s.id}', '_blank')">ดูข้อมูล</button>
      </td>
    </tr>`).join('');
}

function clearFilters() {
  const s = document.getElementById('filterSearch'); if (s) s.value = '';
  const yf = document.getElementById('filterYearFrom'); if (yf) yf.value = '';
  const yt = document.getElementById('filterYearTo');   if (yt) yt.value = '';
  document.querySelectorAll('.filter-cb-paystatus').forEach(cb => cb.checked = false);
  document.querySelectorAll('.filter-cb-type').forEach(cb => cb.checked = false);
  document.querySelectorAll('.filter-cb-round').forEach(cb => cb.checked = false);
  document.querySelectorAll('.filter-cb-licstatus').forEach(cb => cb.checked = false);
  document.querySelectorAll('.filter-cb-lictype').forEach(cb => cb.checked = false);
  renderTable();
}

function toggleSelectAll(masterCb) {
  document.querySelectorAll('.sub-checker').forEach(cb => { cb.checked = masterCb.checked; });
}

function handleAdminExport() {
  const checkers = document.querySelectorAll('.sub-checker:checked');
  if (!checkers.length) { alert('กรุณาติ๊กเลือกรายการอย่างน้อย 1 รายการ'); return; }
  const selectedIds  = Array.from(checkers).map(cb => cb.getAttribute('data-id'));
  const selectedRows = allSubmissions.filter(s => selectedIds.includes(s.id));
  if (typeof exportFromApi === 'function') exportFromApi(selectedRows);
}

async function handleAdminBulkDelete() {
  const checkers = document.querySelectorAll('.sub-checker:checked');
  if (!checkers.length) { alert('กรุณาติ๊กเลือกรายการที่ต้องการลบอย่างน้อย 1 รายการ'); return; }
  const selectedIds  = Array.from(checkers).map(cb => cb.getAttribute('data-id'));
  const selectedRows = allSubmissions.filter(s => selectedIds.includes(s.id));
  const namesPreview = selectedRows.slice(0, 5).map(s => s.operator_name || s.ref_no || s.id).join(', ');
  const moreText     = selectedRows.length > 5 ? ` และอีก ${selectedRows.length - 5} รายการ` : '';
  if (!confirm(`ยืนยันการลบ ${selectedIds.length} รายการ?\n(${namesPreview}${moreText})\nไม่สามารถเรียกคืนได้`)) return;

  showToast(`กำลังลบข้อมูล ${selectedIds.length} รายการ...`);
  try {
    await api.delete('/admin/submissions', { ids: selectedIds });
  } catch (e) {
    showToast('ลบไม่สำเร็จ: ' + (e.message || ''));
    return;
  }

  await writeAuditLog(`ลบรายการยื่นแบบ ${selectedIds.length} รายการ`, 'submissions', 'bulk', { ids: selectedIds });
  showToast(`ลบเรียบร้อยแล้ว ✓ (${selectedIds.length} รายการ)`);
  await loadSubmissions();
}

// ── ดูไฟล์แนบ (เสิร์ฟผ่าน Flask API พร้อมตรวจสอบสิทธิ์ token) ────────────
async function viewAttachment(attachmentId, storagePath) {
  // Flask เสิร์ฟไฟล์ผ่าน endpoint ที่ตรวจ token
  const url = `/api/admin/attachments/${attachmentId}/download`;
  window.open(url, '_blank');
}

async function deleteAttachment(attachmentId, storagePath, fileName, docTypeLabel) {
  if (!confirm(`ยืนยันการลบไฟล์ "${fileName}" ใช่หรือไม่?`)) return;
  try {
    await api.delete(`/admin/attachments/${attachmentId}`);
  } catch (e) {
    showToast('ลบไฟล์ไม่สำเร็จ: ' + (e.message || ''));
    return;
  }
  showToast('ลบไฟล์เรียบร้อยแล้ว');
  if (typeof loadFdDocList === 'function') loadFdDocList(activeSubmissionId);
  loadSubmissions();
}


// ════════════════════ // ── Licenses ── ════════════════════
// ── Licenses Management ───────────────────────────────────────

async function loadLicenses() {
  let data;
  try {
    data = await api.get('/admin/licensees?per_page=2000');
  } catch (e) {
    showToast('โหลดข้อมูลใบอนุญาตผิดพลาด');
    return;
  }
  allLicenses = data.licensees || [];
  renderLicenseStats();
  renderLicenseTable();
  if (typeof renderTaxpayerTable === 'function') renderTaxpayerTable();
}

function renderLicenseStats() {
  if (!document.getElementById('lic-st-total')) return;
  const total     = allLicenses.length;
  const active    = allLicenses.filter(r => r.license_status === 'active').length;
  const companies = [...new Set(allLicenses.map(r => r.tax_id))].length;
  document.getElementById('lic-st-total').textContent    = total.toLocaleString();
  document.getElementById('lic-st-active').textContent   = active.toLocaleString();
  document.getElementById('lic-st-inactive').textContent = (total - active).toLocaleString();
  document.getElementById('lic-st-co').textContent       = companies.toLocaleString();
}

function renderLicenseTable() {
  if (!document.getElementById('lic-tbody')) return;
  const search   = (document.getElementById('lic-search')?.value || '').toLowerCase();
  const types    = [...document.querySelectorAll('.lic-cb-type:checked')].map(el => el.value);
  const statuses = [...document.querySelectorAll('.lic-cb-status:checked')].map(el => el.value);

  let rows = allLicenses.filter(r => {
    if (search && !`${r.tax_id} ${r.company_name} ${r.license_no}`.toLowerCase().includes(search)) return false;
    if (types.length    && !types.includes(r.licensee_type))    return false;
    if (statuses.length && !statuses.includes(r.license_status)) return false;
    return true;
  });

  document.getElementById('lic-count').textContent = `แสดง ${rows.length} / ${allLicenses.length} รายการ`;

  const fmtBE = iso => {
    if (!iso) return '—';
    const d = new Date(iso);
    return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`;
  };
  const statusBadge = s => {
    const map   = { active:'badge-lic-ok', ended:'badge-lic-warn', cancelled:'badge-lic-danger', revoked:'badge-lic-danger' };
    const label = { active:'ปกติ', ended:'สิ้นสุด', cancelled:'ยกเลิก', revoked:'เพิกถอน' };
    return `<span class="${map[s]||''}">${label[s]||s}</span>`;
  };

  const tbody = document.getElementById('lic-tbody');
  tbody.innerHTML = rows.length ? rows.map(r => `
    <tr>
      <td style="font-size:11px">${r.tax_id}</td>
      <td style="max-width:160px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${r.company_name||'—'}</td>
      <td style="font-size:11px;font-weight:500">${r.license_no||'—'}</td>
      <td><span class="lic-type-badge">${r.licensee_type||'—'}</span></td>
      <td>${fmtBE(r.start_date)}</td>
      <td>${fmtBE(r.end_date)}</td>
      <td>${statusBadge(r.license_status)}</td>
      <td>
        <button class="adm-btn adm-btn-sm" onclick="openEditLicenseModal('${r.id}')">แก้ไข</button>
        <button class="adm-btn adm-btn-sm adm-btn-danger" onclick="deleteLicense('${r.id}','${r.license_no}')">ลบ</button>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="8" style="padding:20px;text-align:center;color:#aaa">ไม่พบข้อมูล</td></tr>';
}

function openAddLicenseModal(prefillTaxId) {
  document.getElementById('lic-modal-title').textContent = 'เพิ่มใบอนุญาต';
  ['lic-ml-id','lic-ml-taxid','lic-ml-name','lic-ml-no','lic-ml-start','lic-ml-end'].forEach(id => {
    const el = document.getElementById(id); if (el) el.value = '';
  });
  if (prefillTaxId) document.getElementById('lic-ml-taxid').value = prefillTaxId;
  document.getElementById('lic-ml-type').value   = 'NETWORK';
  document.getElementById('lic-ml-status').value = 'active';
  document.getElementById('lic-modal').style.display = 'flex';
}

function openEditLicenseModal(id) {
  const r = allLicenses.find(r => r.id === id);
  if (!r) return;
  document.getElementById('lic-modal-title').textContent = 'แก้ไขใบอนุญาต';
  document.getElementById('lic-ml-id').value      = r.id;
  document.getElementById('lic-ml-taxid').value   = r.tax_id||'';
  document.getElementById('lic-ml-name').value    = r.company_name||'';
  document.getElementById('lic-ml-no').value      = r.license_no||'';
  document.getElementById('lic-ml-type').value    = r.licensee_type||'NETWORK';
  document.getElementById('lic-ml-start').value   = fdISOToThai(r.start_date);
  document.getElementById('lic-ml-end').value     = fdISOToThai(r.end_date);
  document.getElementById('lic-ml-status').value  = r.license_status||'active';
  document.getElementById('lic-modal').style.display = 'flex';
}

function closeLicenseModal() {
  document.getElementById('lic-modal').style.display = 'none';
}

async function saveLicense() {
  const id = document.getElementById('lic-ml-id').value;
  const payload = {
    tax_id:         document.getElementById('lic-ml-taxid').value.trim().replace(/-/g,''),
    company_name:   document.getElementById('lic-ml-name').value.trim(),
    license_no:     document.getElementById('lic-ml-no').value.trim(),
    licensee_type:  document.getElementById('lic-ml-type').value,
    start_date:     fdThaiToISO(document.getElementById('lic-ml-start').value),
    end_date:       fdThaiToISO(document.getElementById('lic-ml-end').value),
    license_status: document.getElementById('lic-ml-status').value,
  };
  if (!payload.tax_id || !payload.license_no) { alert('กรุณากรอก Tax ID และเลขที่ใบอนุญาต'); return; }

  try {
    if (id) await api.put(`/admin/licensees/${id}`, payload);
    else    await api.post('/admin/licensees', payload);
  } catch (e) {
    alert('บันทึกผิดพลาด: ' + (e.message || ''));
    return;
  }

  await writeAuditLog(id ? `แก้ไขใบอนุญาต ${payload.license_no}` : `เพิ่มใบอนุญาต ${payload.license_no}`, 'licensee_master', id || 'new', payload);
  showToast(id ? 'แก้ไขสำเร็จ' : 'เพิ่มสำเร็จ');
  closeLicenseModal();
  await loadLicenses();
}

async function deleteLicense(id, no) {
  if (!confirm(`ลบใบอนุญาต ${no} ?\nไม่สามารถกู้คืนได้`)) return;
  try {
    await api.delete(`/admin/licensees/${id}`);
  } catch (e) {
    alert('ลบผิดพลาด: ' + (e.message || ''));
    return;
  }
  await writeAuditLog(`ลบใบอนุญาต ${no}`, 'licensee_master', id, {});
  showToast('ลบสำเร็จ');
  await loadLicenses();
}


// ════════════════════ Navigation ════════════════════
// ── Page navigation ─────────────────────────────────────────
  const PAGE_META = {
    submissions:       { title: 'รายการยื่นแบบ',       sub: 'ข้อมูลการนำส่งเงินรายปีเข้ากองทุน กสทช.' },
    licenses:          { title: 'ใบอนุญาต',               sub: 'จัดการข้อมูลใบอนุญาตทั้งหมด' },
    'operator-accounts': { title: 'บัญชีผู้ประกอบการ',   sub: 'จัดการอีเมลสำหรับรับ OTP ของผู้ประกอบการ' },
    'import-operator-accounts': { title: 'นำเข้าบัญชีผู้ประกอบการ', sub: 'นำเข้าอีเมลสำหรับรับ OTP ของผู้ประกอบการจากไฟล์ Excel' },
    taxpayers:         { title: 'ผู้ประกอบการ',          sub: 'ข้อมูลผู้ประกอบการและใบอนุญาต' },
    'taxpayer-detail': { title: 'รายละเอียดผู้ประกอบการ', sub: 'ใบอนุญาตทั้งหมดของบริษัทนี้' },
    'import-licensee': { title: 'นำเข้าข้อมูลใบอนุญาต', sub: 'นำเข้าข้อมูลใบอนุญาตจากไฟล์ Excel' },
    'import-taxpayer': { title: 'นำเข้าข้อมูลผู้ประกอบการ', sub: 'นำเข้าข้อมูลผู้ประกอบการจากไฟล์ Excel' },
    export:             { title: 'ส่งออกข้อมูล',           sub: 'ส่งออกรายการยื่นแบบเป็นไฟล์ Excel' },
    audit:             { title: 'บันทึกการแก้ไขข้อมูล',   sub: 'ประวัติการแก้ไขข้อมูลทั้งหมดในระบบ' },
  };

  // ── Sidebar: เปิด/ปิดกลุ่มเมนู ──────────────────────────────
  function toggleSbGroup(headerEl) {
    headerEl.parentElement.classList.toggle('collapsed');
  }

  // ── Sidebar: เปิด/ปิดทั้งแถบเมนู (hamburger) ─────────────────
  // ── Filter card: เปิด/ปิดแบบ dropdown ────────────────────────
  function toggleAdmFilter(cardId) {
    const card = document.getElementById(cardId);
    if (!card) return;
    card.classList.toggle('collapsed');
    const isOpen = !card.classList.contains('collapsed');
    document.getElementById(`filter-trigger-${cardId}`)?.classList.toggle('active', isOpen);
  }

  function toggleSidebar() {
    document.getElementById('adminShell').classList.toggle('sidebar-hidden');
  }

  function showPage(page) {
    document.querySelectorAll('.adm-page').forEach(p => p.classList.remove('active'));
    document.querySelectorAll('.sb-item').forEach(el => el.classList.remove('active'));
    document.getElementById('page-' + page)?.classList.add('active');
    document.querySelector(`.sb-item[data-page="${page}"]`)?.classList.add('active');
    const meta = PAGE_META[page] || {};
    document.getElementById('pageTitle').textContent    = meta.title || page;
    document.getElementById('pageSubtitle').textContent = meta.sub   || '';

    // โหลดข้อมูลตามหน้า
    if (page === 'submissions') { loadSubmissions(); if (typeof initFdBuddhistDatepickers === 'function') initFdBuddhistDatepickers(); }
    if (page === 'licenses')    loadLicenses();
    if (page === 'operator-accounts') loadOperatorAccounts();
    if (page === 'import-operator-accounts' && typeof resetOperatorAccountImportPage === 'function') resetOperatorAccountImportPage();
    if (page === 'taxpayers')   { loadTaxpayers(); loadLicenses(); loadSubmissions(); if (typeof initFdBuddhistDatepickers === 'function') initFdBuddhistDatepickers(); }
    if (page === 'audit')       loadAuditLogs();
    if (page === 'export')      loadExportPage();
  }

  // ── ปิด sidebar อัตโนมัติ หลังกดเลือกเมนูจากแถบด้านข้างเสร็จแล้ว
  //    (แยกจาก showPage() เพราะ showPage() ยังถูกเรียกแบบ programmatic
  //    ตอน login/เปิดหน้าแรก ซึ่งไม่ควรปิด sidebar ให้เอง) ─────────
  function navigateFromSidebar(page) {
    showPage(page);
    document.getElementById('adminShell')?.classList.add('sidebar-hidden');
  }

  // ── Taxpayers ────────────────────────────────────────────────
  // [FIX] เดิมเรียก client ฐานข้อมูลที่ไม่มีอยู่จริงในระบบนี้ — เปลี่ยนมาใช้ Flask API ตรงๆ แทน
  async function loadTaxpayers() {
    let data;
    try {
      data = await api.get('/admin/taxpayers?per_page=2000');
    } catch (e) {
      showToast('โหลดข้อมูลผิดพลาด');
      return;
    }
    allTaxpayers = data.taxpayers || [];
    renderTaxpayerTable();
  }

  const fmtBE = iso => { if (!iso) return '—'; const d = new Date(iso); return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`; };

  /** รวม taxpayer_master (หลายแถวต่อบริษัท แยกตามปีบัญชี) ให้เหลือ 1 แถวต่อบริษัท
   *  พร้อมนับจำนวนปีบัญชีและจำนวนใบอนุญาตของบริษัทนั้น (จาก allLicenses)
   *  แสดงรวมทุกปีเสมอ (เอาระบบแยกปีบัญชีในหน้านี้ออกแล้ว) */
  function getCompanyList() {
    const rows = allTaxpayers || [];

    const map = new Map();
    rows.forEach(r => {
      // ค่าแรกที่เจอต่อ tax_id คือปีล่าสุด เพราะ allTaxpayers เรียง fiscal_year desc มาแล้ว
      if (!map.has(r.tax_id)) map.set(r.tax_id, {
        tax_id: r.tax_id, operator_name: r.operator_name, years: 0,
        ref_no: r.ref_no || null,
        period_start: r.period_start || null,
        period_end: r.period_end || null,
        due_date: r.due_date || null,
      });
      map.get(r.tax_id).years++;
    });
    // เติมบริษัทที่มีใบอนุญาตแต่ไม่มีข้อมูล taxpayer_master เลย (กันตกหล่น)
    (allLicenses || []).forEach(l => {
      if (!map.has(l.tax_id)) map.set(l.tax_id, {
        tax_id: l.tax_id, operator_name: l.company_name, years: 0,
        ref_no: null, period_start: null, period_end: null, due_date: null,
      });
    });
    return [...map.values()].map(c => ({
      ...c,
      licenseCount: (allLicenses || []).filter(l => l.tax_id === c.tax_id).length,
      periodRound: getPeriodRoundLabel(c.period_start, c.period_end),
    }));
  }

  /** รอบบัญชี: 01/01–31/12 (ปีปฏิทินเต็มปี) = "ปกติ" นอกนั้นทั้งหมด = "อื่นๆ" */
  function getPeriodRoundLabel(periodStart, periodEnd) {
    if (!periodStart || !periodEnd) return '—';
    const s = new Date(periodStart), e = new Date(periodEnd);
    const isNormal = s.getMonth() === 0 && s.getDate() === 1 && e.getMonth() === 11 && e.getDate() === 31;
    return isNormal ? 'ปกติ' : 'อื่นๆ';
  }

  function renderTaxpayerTable() {
    const search = (document.getElementById('tp-search')?.value || '').toLowerCase();
    const yearFrom     = parseInt(document.getElementById('tp-year-from')?.value || '') || null;
    const yearTo       = parseInt(document.getElementById('tp-year-to')?.value || '') || null;
    const types        = [...document.querySelectorAll('.tp-cb-type:checked')].map(el => el.value);
    const rounds       = [...document.querySelectorAll('.tp-cb-round:checked')].map(el => el.value);
    const licStatuses  = [...document.querySelectorAll('.tp-cb-licstatus:checked')].map(el => el.value);
    const licTypes     = [...document.querySelectorAll('.tp-cb-lictype:checked')].map(el => el.value);
    const payStatuses  = [...document.querySelectorAll('.tp-cb-paystatus:checked')].map(el => el.value);

    let rows = getCompanyList();
    const totalCount = rows.length;

    if (search) rows = rows.filter(r => `${r.tax_id} ${r.operator_name}`.toLowerCase().includes(search));

    // ปีบัญชี (พ.ศ.): เช็คจาก taxpayer_master ของบริษัทนั้น (บริษัทหนึ่งมีได้หลายปีบัญชี)
    if (yearFrom) rows = rows.filter(r =>
      (allTaxpayers || []).some(t => t.tax_id === r.tax_id && (t.fiscal_year || 0) >= yearFrom));
    if (yearTo) rows = rows.filter(r =>
      (allTaxpayers || []).some(t => t.tax_id === r.tax_id && (t.fiscal_year || 0) <= yearTo));

    // ประเภท / รอบบัญชี / สถานะการชำระเงิน: เช็คจาก submissions ของบริษัทนั้น (match ด้วย tax_id)
    if (types.length) rows = rows.filter(r =>
      (allSubmissions || []).some(s => s.tax_id === r.tax_id && types.includes(s.licensee_type || '')));
    if (rounds.length) rows = rows.filter(r =>
      (allSubmissions || []).some(s => s.tax_id === r.tax_id && rounds.some(rd => (s.period_round || '').includes(rd.replace('รอบ', '')))));
    if (payStatuses.length) rows = rows.filter(r =>
      (allSubmissions || []).some(s => s.tax_id === r.tax_id && payStatuses.includes(s._derivedStatus || '')));

    // สถานะใบอนุญาต / ประเภทใบอนุญาต: เช็คจาก licenses ของบริษัทนั้นโดยตรง
    if (licStatuses.length) rows = rows.filter(r =>
      (allLicenses || []).some(l => l.tax_id === r.tax_id && licStatuses.includes(l.license_status || '')));
    if (licTypes.length) rows = rows.filter(r =>
      (allLicenses || []).some(l => l.tax_id === r.tax_id && licTypes.includes(l.licensee_type || '')));

    rows.sort((a, b) => (a.operator_name || '').localeCompare(b.operator_name || '', 'th'));

    const tpCountEl = document.getElementById('tp-count'); if (tpCountEl) tpCountEl.textContent = `แสดง ${rows.length} / ${totalCount} บริษัท`;
    document.getElementById('tp-st-companies').textContent = getCompanyList().length.toLocaleString();
    document.getElementById('tp-st-licenses').textContent  = (allLicenses || []).length.toLocaleString();
    document.getElementById('tp-st-active').textContent    = (allLicenses || []).filter(l => l.license_status === 'active').length.toLocaleString();
    document.getElementById('tp-st-inactive').textContent  = (allLicenses || []).filter(l => l.license_status !== 'active').length.toLocaleString();

    document.getElementById('tp-tbody').innerHTML = rows.length
      ? rows.map(r => `<tr>
          <td style="font-size:12.5px;font-weight:600;color:#1e2d5e;white-space:nowrap;text-align:center">${r.ref_no || '—'}</td>
          <td style="font-size:12.5px;white-space:nowrap;text-align:center">${r.tax_id}</td>
          <td style="font-size:12.5px">${r.operator_name || '—'}</td>
          <td style="text-align:center">${r.periodRound === 'ปกติ' ? '<span class="badge-lic-ok">ปกติ</span>' : r.periodRound === 'อื่นๆ' ? '<span class="badge-lic-warn">อื่นๆ</span>' : '—'}</td>
          <td style="font-size:12.5px;white-space:nowrap;text-align:center">${r.period_start ? `${fmtBE(r.period_start)} – ${fmtBE(r.period_end)}` : '—'}</td>
          <td style="font-size:12.5px;white-space:nowrap;text-align:center">${fmtBE(r.due_date)}</td>
          <td style="text-align:center;font-weight:600;color:#2e86ab;font-size:12.5px">${r.licenseCount}</td>
          <td style="text-align:center"><button class="adm-btn adm-btn-sm" onclick="openTaxpayerDetail('${r.tax_id}')">ดูใบอนุญาต</button></td>
        </tr>`).join('')
      : '<tr><td colspan="8" style="padding:20px;text-align:center;color:#aaa">ไม่พบข้อมูล</td></tr>';
  }

  function clearLicFilter() {
    const s = document.getElementById('lic-search'); if (s) s.value = '';
    document.querySelectorAll('.lic-cb-type,.lic-cb-status').forEach(cb => cb.checked = false);
    renderLicenseTable();
  }

  function clearTaxpayerFilters() {
    const s = document.getElementById('tp-search'); if (s) s.value = '';
    const yf = document.getElementById('tp-year-from'); if (yf) yf.value = '';
    const yt = document.getElementById('tp-year-to');   if (yt) yt.value = '';
    document.querySelectorAll('.tp-cb-type,.tp-cb-round,.tp-cb-licstatus,.tp-cb-lictype,.tp-cb-paystatus').forEach(cb => cb.checked = false);
    renderTaxpayerTable();
  }

  // ── Taxpayer detail: ใบอนุญาตแยกตามปีบัญชี (หน้าแยก ไม่ใช่ popup) ──
  let activeTaxpayerTaxId = null;

  function openTaxpayerDetail(taxId) {
    activeTaxpayerTaxId = taxId;
    renderTaxpayerDetail(taxId);
    showPage('taxpayer-detail');
    // เมนู "ผู้ประกอบการ" ควรค้าง active ไว้ แม้จะอยู่หน้ารายละเอียดที่ไม่มีปุ่มเมนูของตัวเอง
    document.querySelector('.sb-item[data-page="taxpayers"]')?.classList.add('active');
  }

  function closeTaxpayerDetail() {
    activeTaxpayerTaxId = null;
    showPage('taxpayers');
  }

  /** เรียกใหม่หลังเพิ่ม/แก้/ลบใบอนุญาต เพื่อรีเฟรชทั้งตารางบริษัทและหน้ารายละเอียด (ถ้าเปิดอยู่) */
  function refreshTaxpayerView(taxId) {
    renderTaxpayerTable();
    if (activeTaxpayerTaxId && document.getElementById('page-taxpayer-detail').classList.contains('active')) {
      renderTaxpayerDetail(activeTaxpayerTaxId);
    }
  }

  function renderTaxpayerDetail(taxId) {
    const years    = (allTaxpayers || []).filter(t => t.tax_id === taxId);
    const licenses = (allLicenses  || []).filter(l => l.tax_id === taxId);
    const name = years[0]?.operator_name || licenses[0]?.company_name || '—';

    document.getElementById('tp-detail-name').textContent = name;
    document.getElementById('tp-detail-taxid').textContent = `Tax ID: ${taxId}`;

    const statusBadge = s => {
      const map   = { active: 'badge-lic-ok', ended: 'badge-lic-warn', cancelled: 'badge-lic-danger', revoked: 'badge-lic-danger' };
      const label = { active: 'ปกติ', ended: 'สิ้นสุด', cancelled: 'ยกเลิก', revoked: 'เพิกถอน' };
      return `<span class="${map[s] || ''}">${label[s] || s}</span>`;
    };
    const licRow = l => `
      <tr>
        <td style="font-weight:500;color:#1e2d5e;font-size:12px">${l.license_no || '—'}</td>
        <td><span class="lic-type-badge">${l.licensee_type || '—'}</span></td>
        <td style="font-size:11px">${fmtBE(l.start_date)}</td>
        <td style="font-size:11px">${fmtBE(l.end_date)}</td>
        <td>${statusBadge(l.license_status)}</td>
        <td style="text-align:right;white-space:nowrap;">
          <button class="adm-btn adm-btn-sm" onclick="openEditLicenseModal('${l.id}')">แก้ไข</button>
          <button class="adm-btn adm-btn-sm adm-btn-danger" onclick="deleteLicense('${l.id}','${l.license_no}')">ลบ</button>
        </td>
      </tr>`;

    // เอา logic แยกกลุ่มตามปีบัญชีออกแล้ว (เดิมวนตาม years แล้วเช็ค overlap ทำให้
    // ใบอนุญาตใบเดียวกันโผล่ซ้ำได้หลายปีบัญชีถ้าช่วงวันที่คาบเกี่ยวกันหลายปี)
    // ตอนนี้แสดงใบอนุญาตทั้งหมดของบริษัทนี้เป็นตารางเดียว ไม่แยกกลุ่มปี
    const html = `
      <div class="tp-year-block">
        <table class="adm-table">
          <thead><tr><th>เลขที่ใบอนุญาต</th><th>ประเภท</th><th>วันเริ่มต้น</th><th>วันสิ้นสุด</th><th>สถานะ</th><th></th></tr></thead>
          <tbody>${licenses.length ? licenses.map(licRow).join('') : '<tr><td colspan="6" style="padding:12px;text-align:center;color:#aaa;">ไม่มีใบอนุญาต</td></tr>'}</tbody>
        </table>
      </div>`;

    document.getElementById('tp-detail-body').innerHTML = html;
  }

  function showToast(msg, isError=false) {
  const t = document.getElementById('toast');
  if (!t) return;
  t.textContent = msg;
  t.className = 'toast show' + (isError ? ' toast-error' : '');
  setTimeout(() => t.classList.remove('show'), 3000);
}


// ── Init ──────────────────────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  // ตรวจ token ก่อน — ถ้าไม่มี auth.requireAdmin() จะ redirect ไป login
  if (!auth.requireAdmin()) return;

  const email = auth.getAdminEmail();
  const token = auth.getAdminToken();
  let fullName = email;
  try { fullName = JSON.parse(atob(token.split('.')[1])).full_name || email; } catch(e) {}

  enterDashboard(email, fullName);

  // initDatepickers หลัง enterDashboard
  if (typeof initDatepickers === 'function') initDatepickers();
});