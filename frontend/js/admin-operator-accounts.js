// ════════════════════════════════════════════════════
// js/admin-operator-accounts.js — บัญชีผู้ประกอบการ (อีเมลรับ OTP)
// Import จาก Excel (tax_id, operator_name, email) + ตารางแสดง/ลบบัญชีที่มีอยู่
// ════════════════════════════════════════════════════

let allOperatorAccounts = [];

// ── Import: บัญชีผู้ประกอบการ ────────────────────────────

let _operatorAccountImportFile = null;

async function handleOperatorAccountFile(input) {
  const file = input.files?.[0] || null;
  _operatorAccountImportFile = file;

  const warnEl    = document.getElementById('oa-import-warning');
  const sectionEl = document.getElementById('oa-import-section');
  const logEl     = document.getElementById('oa-import-log');
  if (warnEl)    { warnEl.style.display = 'none'; warnEl.textContent = ''; }
  if (logEl)     logEl.innerHTML = '';
  if (sectionEl) sectionEl.style.display = 'none';
  if (!file) return;

  const formData = new FormData();
  formData.append('file', file);
  formData.append('mode', 'preview');

  let data;
  try {
    data = await api.upload('/admin/import/operator-accounts', formData);
  } catch (e) {
    if (warnEl) { warnEl.textContent = 'อ่านไฟล์ไม่สำเร็จ: ' + (e.message || ''); warnEl.style.display = 'block'; }
    return;
  }

  document.getElementById('oa-import-count').textContent =
    `พบข้อมูล ${data.total_rows} แถว — ถูกต้อง ${data.valid_rows} แถว, ผิดพลาด ${data.error_rows} แถว` +
    (data.valid_rows > 5 ? ' (แสดงตัวอย่าง 5 แถวแรก)' : '');

  const rows = data.preview_data || [];
  const tbody = document.getElementById('oa-import-preview-body');
  tbody.innerHTML = rows.length ? rows.map((r, i) => `
      <tr>
        <td style="text-align:center">${i + 1}</td>
        <td>${r.tax_id || ''}</td>
        <td>${r.operator_name || ''}</td>
        <td>${r.email || ''}</td>
        <td style="text-align:center;color:#16a34a;">✓</td>
      </tr>`).join('')
    : `<tr><td colspan="5" style="text-align:center;color:#aaa;padding:12px;">ไม่มีแถวที่ถูกต้อง</td></tr>`;

  if (data.errors?.length) {
    if (logEl) logEl.innerHTML = data.errors
      .map(e => `<div style="color:#dc2626;">แถว ${e.row}: ${e.message}</div>`).join('');
  }

  document.getElementById('oa-import-btn').disabled = !data.valid_rows;
  if (sectionEl) sectionEl.style.display = 'block';
}

async function startOperatorAccountImport() {
  if (!_operatorAccountImportFile) return;
  const btn  = document.getElementById('oa-import-btn');
  const logEl = document.getElementById('oa-import-log');
  if (btn) { btn.disabled = true; btn.textContent = 'กำลังนำเข้า...'; }

  const formData = new FormData();
  formData.append('file', _operatorAccountImportFile);
  formData.append('mode', 'commit');

  try {
    // [FIX] backend /admin/import/operator-accounts บันทึก audit log ให้แล้ว (ไม่ต้องยิงซ้ำ)
    const data = await api.upload('/admin/import/operator-accounts', formData);
    if (logEl) logEl.innerHTML = `<div style="color:#16a34a;">${data.message}</div>`;
    showToast(data.message);
    await loadOperatorAccounts();
  } catch (e) {
    if (logEl) logEl.innerHTML = `<div style="color:#dc2626;">นำเข้าไม่สำเร็จ: ${e.message || ''}</div>`;
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'เริ่มการนำเข้าข้อมูล'; }
  }
}

function resetOperatorAccountImportPage() {
  _operatorAccountImportFile = null;
  const fileEl = document.getElementById('operatorAccountFile');
  if (fileEl) fileEl.value = '';
  const warnEl = document.getElementById('oa-import-warning');
  if (warnEl) warnEl.style.display = 'none';
  const sectionEl = document.getElementById('oa-import-section');
  if (sectionEl) sectionEl.style.display = 'none';
  const logEl = document.getElementById('oa-import-log');
  if (logEl) logEl.innerHTML = '';
}

// ── ตารางบัญชีผู้ประกอบการที่มีอยู่ ──────────────────────

async function loadOperatorAccounts() {
  let data;
  try {
    data = await api.get('/admin/operator-accounts');
  } catch (e) {
    showToast('โหลดข้อมูลบัญชีผู้ประกอบการผิดพลาด');
    return;
  }
  allOperatorAccounts = data.accounts || [];
  renderOperatorAccountsTable();
}

function renderOperatorAccountsTable() {
  const tbody = document.getElementById('oa-tbody');
  if (!tbody) return;

  const countEl = document.getElementById('oa-count');
  if (countEl) countEl.textContent = `ทั้งหมด ${allOperatorAccounts.length} รายการ`;

  tbody.innerHTML = allOperatorAccounts.length ? allOperatorAccounts.map(r => `
    <tr>
      <td style="text-align:center;font-size:12.5px;">${r.tax_id}</td>
      <td style="text-align:center;">${r.operator_name || ''}</td>
      <td style="text-align:center;">${r.email}</td>
      <td style="text-align:center;">${fmtDateDMY(r.created_at)}</td>
      <td style="text-align:center;">
        <button class="adm-btn adm-btn-sm" onclick="openOperatorAccountModal('${r.id}','${r.tax_id}','${(r.email || '').replace(/'/g, "\\'")}')">แก้ไข</button>
        <button class="adm-btn adm-btn-sm adm-btn-danger" onclick="deleteOperatorAccount('${r.id}','${r.tax_id}')">ลบ</button>
      </td>
    </tr>`).join('')
    : '<tr><td colspan="5" style="padding:20px;text-align:center;color:#aaa">ไม่พบข้อมูล</td></tr>';
}

// ── แก้ไขอีเมล ────────────────────────────────────────────

function openOperatorAccountModal(id, taxId, email) {
  document.getElementById('oa-ml-id').value    = id;
  document.getElementById('oa-ml-taxid').value = taxId;
  document.getElementById('oa-ml-email').value = email;
  document.getElementById('oa-modal').style.display = 'flex';
}

function closeOperatorAccountModal() {
  document.getElementById('oa-modal').style.display = 'none';
}

async function saveOperatorAccountEmail() {
  const id    = document.getElementById('oa-ml-id').value;
  const email = document.getElementById('oa-ml-email').value.trim();

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    alert('กรุณากรอกอีเมลให้ถูกต้อง');
    return;
  }

  try {
    await api.put(`/admin/operator-accounts/${id}`, { email });
  } catch (e) {
    alert('บันทึกผิดพลาด: ' + (e.message || ''));
    return;
  }
  showToast('แก้ไขอีเมลสำเร็จ');
  closeOperatorAccountModal();
  await loadOperatorAccounts();
}

async function deleteOperatorAccount(id, taxId) {
  if (!confirm(`ลบบัญชีผู้ประกอบการของเลขผู้เสียภาษี ${taxId} ?\nไม่สามารถกู้คืนได้`)) return;
  try {
    await api.delete(`/admin/operator-accounts/${id}`);
  } catch (e) {
    alert('ลบผิดพลาด: ' + (e.message || ''));
    return;
  }
  // [FIX] backend DELETE /admin/operator-accounts/<id> บันทึก audit log ให้แล้ว (ไม่ต้องยิงซ้ำ)
  showToast('ลบสำเร็จ');
  await loadOperatorAccounts();
}
