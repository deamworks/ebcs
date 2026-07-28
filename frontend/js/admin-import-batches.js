// ════════════════════════════════════════════════════
// js/admin-import-batches.js — ประวัติการนำเข้าข้อมูล + Rollback
// ════════════════════════════════════════════════════

let allImportBatches = [];

const IMPORT_BATCH_STATUS_TH = {
  active:      'ใช้งานอยู่',
  rolled_back: 'ย้อนกลับแล้ว',
};

async function loadImportBatches() {
  let data;
  try {
    data = await api.get('/admin/import-batches');
  } catch (e) {
    showToast('โหลดประวัติการนำเข้าข้อมูลผิดพลาด');
    return;
  }
  allImportBatches = data.batches || [];
  renderImportBatchesTable();
}

function renderImportBatchesTable() {
  const tbody = document.getElementById('import-batches-tbody');
  if (!tbody) return;

  tbody.innerHTML = allImportBatches.length ? allImportBatches.map(b => `
    <tr>
      <td style="text-align:center;font-size:12.5px;">${fmtDateDMY(b.imported_at)}</td>
      <td style="text-align:center;">${b.import_type_th || b.import_type}</td>
      <td style="text-align:center;">${b.row_count}</td>
      <td style="text-align:center;font-size:12.5px;">${b.imported_by}</td>
      <td style="text-align:center;">${b.status === 'rolled_back'
        ? `<span style="color:#888;">${IMPORT_BATCH_STATUS_TH.rolled_back}</span>`
        : `<span style="color:#16a34a;font-weight:600;">${IMPORT_BATCH_STATUS_TH.active}</span>`}</td>
      <td style="text-align:center;">
        ${b.status === 'active'
          ? `<button class="adm-btn adm-btn-sm adm-btn-danger" onclick="rollbackImportBatch('${b.id}', '${(b.import_type_th || b.import_type).replace(/'/g, "\\'")}', '${(b.imported_by || '').replace(/'/g, "\\'")}', ${b.row_count})">ย้อนกลับ (Rollback)</button>`
          : ''}
      </td>
    </tr>`).join('')
    : '<tr><td colspan="6" style="padding:20px;text-align:center;color:#aaa">ไม่พบข้อมูล</td></tr>';
}

async function rollbackImportBatch(id, importTypeTh, importedBy, rowCount) {
  const ok = confirm(
    `ย้อนกลับการนำเข้าข้อมูล "${importTypeTh}" ?\n\n` +
    `นำเข้าโดย: ${importedBy}\n` +
    `จำนวนรายการ: ${rowCount}\n\n` +
    `ระบบจะคืนค่าทุกแถวกลับไปเป็นก่อนการนำเข้าครั้งนี้ ไม่สามารถกู้คืนการย้อนกลับได้`
  );
  if (!ok) return;

  try {
    await api.post(`/admin/import-batches/${id}/rollback`, {});
  } catch (e) {
    alert('ย้อนกลับผิดพลาด: ' + (e.message || ''));
    return;
  }
  showToast('ย้อนกลับการนำเข้าข้อมูลสำเร็จ');
  await loadImportBatches();
}
