// ════════════════════════════════════════════════════
// js/view-submission.js — แสดงใบยื่นแบบที่ "ยืนยันแล้ว" แบบอ่านอย่างเดียว
//
// ใช้ร่วมกัน 2 ที่ เพื่อให้หน้าตาเหมือนกันทุกจุด:
//   1. index.js — ผู้ประกอบการกลับเข้าระบบหลังยืนยันใบยื่นแบบไปแล้ว
//      (ต้องดู/ดาวน์โหลดได้ แต่แก้ไขไม่ได้ จนกว่าแอดมินจะลบใบยื่นเดิม)
//   2. admin-view-submission.js — แอดมินเปิดดูใบยื่นแบบของผู้ประกอบการ
//
// รับข้อมูลรูปแบบเดียวกับที่ GET /operator/submissions/<id> และ
// GET /admin/submissions/<id> คืนมา: { submission, licenses,
// other_incomes, attachments }
// ════════════════════════════════════════════════════

function _vsIsoToBE(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear() + 543}`;
}

/** ดาวน์โหลดไฟล์แนบผ่าน fetch + Bearer token (ห้ามใช้ <a href> ตรงๆ
 *  เพราะ token เก็บใน localStorage ไม่ใช่ cookie นำทางตรงๆ จะไม่ส่ง token ไปด้วย) */
async function _vsDownloadAttachment(path, fileName) {
  try {
    const isAdminPage = window.location.pathname.includes('admin');
    const token = isAdminPage
      ? localStorage.getItem('ebcs_admin_token')
      : localStorage.getItem('ebcs_token');
    const res = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('ดาวน์โหลดไม่สำเร็จ');
    const blob    = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = blobUrl;
    a.download = fileName || 'document';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(blobUrl);
  } catch (e) {
    if (typeof showToast === 'function') showToast('ดาวน์โหลดไฟล์ไม่สำเร็จ: ' + (e.message || ''), 'error');
    else alert('ดาวน์โหลดไฟล์ไม่สำเร็จ');
  }
}

/**
 * Hydrate appState + DOM ด้วยข้อมูลใบยื่นแบบ แล้วล็อกเป็นโหมดดูอย่างเดียว
 * @param {object} data - { submission, licenses, other_incomes, attachments }
 * @param {object} opts - { downloadBase: '/operator' | '/admin' }
 */
function renderReadOnlySubmission(data, opts = {}) {
  const s           = data.submission    || {};
  const licenses    = data.licenses      || [];
  const others      = data.other_incomes || [];
  const attachments = data.attachments   || [];
  const downloadBase = opts.downloadBase || '/operator';

  // [FIX] สลับไป Phase 2 + เติมข้อมูลสรุปด้านบนก่อนเป็นอันดับแรกเสมอ — เดิม
  // ทำหลังลูปประมวลผลใบอนุญาต ถ้าลูปนั้น throw (ข้อมูล incomes ผิดรูป ฯลฯ)
  // จะค้างอยู่ที่ Phase 1 เปล่าๆ ทั้งที่ป้ายเตือน "โหมดดูอย่างเดียว" ขึ้นไปแล้ว
  // (แถบเตือนแทรกที่ .main ตรงๆ ไม่ขึ้นกับว่า Phase ไหนถูกซ่อนอยู่)
  const p1 = document.getElementById('phase1');
  const p2 = document.getElementById('phase2');
  if (p1) p1.style.display = 'none';
  if (p2) p2.style.display = 'block';

  const setText = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = (val === null || val === undefined || val === '') ? '—' : val; };
  setText('disp-ref',      s.ref_no);
  setText('disp-licensee', s.operator_name);
  setText('disp-taxid',    s.tax_id);
  setText('disp-year',     s.fiscal_year ? `พ.ศ. ${s.fiscal_year}` : null);
  setText('disp-period',   (s.period_start && s.period_end) ? `${_vsIsoToBE(s.period_start)} – ${_vsIsoToBE(s.period_end)}` : null);
  setText('disp-due-date', _vsIsoToBE(s.due_date));

  _vsRenderStatusBanner(s, opts.statusLabel);

  // ── appState หลัก ──
  appState.taxId       = s.tax_id || '';
  appState.taxid       = s.tax_id || '';
  appState.licensee    = s.operator_name || '';
  appState.refNo       = s.ref_no || '';
  appState.year        = String(s.fiscal_year || '');
  appState.dueDate      = _vsIsoToBE(s.due_date);
  // กัน restoreStepState(1) โหลด draft เก่าจาก localStorage มาทับข้อมูลจริงที่เพิ่ง hydrate
  appState._draftLoaded = true;

  try {
    // ── appState.rowsData จากใบอนุญาตของใบยื่นนี้ (snapshot ณ วันยื่น) ──
    appState.rowsData = {};
    licenses.forEach((lic, i) => {
      const idx = i + 1;
      const incomes = lic.incomes || [];
      const savedInputs = {};
      incomes.filter(inc => !inc.is_custom).forEach(inc => { savedInputs[inc.field_key] = inc.amount; });
      const customItems = incomes.filter(inc => inc.is_custom)
        .map(inc => ({ label: inc.label, value: inc.amount }));

      appState.rowsData[idx] = {
        income:         parseFloat(lic.fee_amount) || 0,
        deduction:      parseFloat(lic.deduction_amount) || 0,
        no:             lic.license_no || '',
        type:           lic.licensee_type || '',
        station:        lic.station || '',
        startDate:      _vsIsoToBE(lic.start_date),
        endDate:        _vsIsoToBE(lic.end_date),
        hasIncome:      'yes',
        noIncomeReason: '',
        licenseStatus:  lic.license_status || 'active',
        customItems,
        savedInputs,
      };
    });
    const countEl = document.getElementById('license-count');
    if (countEl) countEl.value = licenses.length || 1;

    // [FIX] "ประเภทรายการ" คือสถานะใบอนุญาต (ปกติ/สิ้นสุด/ยกเลิก/เพิกถอน) —
    // เดิมใช้ licensee_type (NETWORK/SERVICE ฯลฯ) ผิดความหมาย คนละฟิลด์กัน
    const licStatusTh = { active: 'ปกติ', ended: 'สิ้นสุด', cancelled: 'ยกเลิก', revoked: 'เพิกถอน' };
    setText('disp-type', licStatusTh[licenses[0]?.license_status] || licenses[0]?.license_status);

    // ── Step 2: รายได้อื่น ──
    appState.step2Inputs     = {};
    appState.step2CustomRows = [];
    others.forEach(o => {
      if (!o.is_custom && ['o1', 'o2', 'o3', 'o4', 'o5'].includes(o.field_key)) {
        appState.step2Inputs[o.field_key] = o.amount;
      } else {
        appState.step2CustomRows.push({ label: o.label, value: o.amount });
      }
    });

    // ── Step 4: ผู้สอบบัญชี ──
    appState.auditor = {
      name:    s.auditor_name    || '',
      regNo:   s.auditor_license || '',
      company: s.auditor_office  || '',
      date:    _vsIsoToBE(s.audited_date),
    };

    // [FIX] "รายได้รวมตามงบการเงิน" (Step 1) เดิมไม่ถูกส่งไป hydrate เลย —
    // ช่องนี้เลยโชว์ 0.00 เสมอในหน้าดูอย่างเดียว ทั้งที่ backend เก็บค่าไว้แล้ว
    // (submissions.total_income_financial, ดู migration 006)
    appState.financialIncome = s.total_income_financial != null
      ? Number(s.total_income_financial).toFixed(2)
      : '';
    const finEl = document.getElementById('total-income-financial');
    if (finEl) finEl.value = appState.financialIncome;

    if (typeof generateRows === 'function') generateRows();
    if (typeof goToStep === 'function') goToStep(1);
    _vsRenderAttachments(attachments, downloadBase);
  } catch (err) {
    console.error('[renderReadOnlySubmission]', err);
  }

  // [FIX] แอดมินแก้ไขข้อมูลในใบยื่นที่ยังไม่ได้จ่ายเงิน (draft/pending_payment)
  // ได้เหมือนหน้ากรอกของผู้ประกอบการ — เดิมล็อกอ่านอย่างเดียวทุกสถานะ ทั้งที่
  // paid เท่านั้นที่ควรห้ามแก้ (มีใบเสร็จอ้างอิงยอดเดิมไปแล้ว)
  if (opts.editable) {
    _vsUnlockForAdminEdit(data);
  } else {
    _vsLockReadOnly();
  }
}

/** ปิดการแก้ไขทุกช่อง + ซ่อนปุ่มที่ทำให้เกิดการบันทึก/อัปโหลด/ยืนยันซ้ำ
 *  (ปุ่มเปลี่ยน step และปุ่มพิมพ์เอกสารยังกดได้ตามปกติ) */
function _vsLockReadOnly() {
  document.body.classList.add('vs-readonly');
  document.querySelectorAll('input, select, textarea').forEach(el => {
    el.disabled = true;
  });
  const confirmBtn = document.getElementById('btn-confirm-submit');
  if (confirmBtn) confirmBtn.style.display = 'none';
  document.querySelectorAll('input[type="file"]').forEach(el => {
    const row = el.closest('.doc-upload-row') || el.parentElement;
    if (row) row.style.display = 'none';
  });
}

/** โหมดแอดมินแก้ไข — ปล่อยให้กรอกรายได้/ค่าลดหย่อน/ผู้สอบบัญชีได้ตามปกติ
 *  (เหมือนหน้าผู้ประกอบการ) แต่ยังล็อกช่องโครงสร้าง (เลขผู้เสียภาษี วันที่
 *  ใบอนุญาต ฯลฯ) กับปุ่ม/ช่องอัปโหลดเอกสารที่ไม่ได้อยู่ในขอบเขตนี้ */
function _vsUnlockForAdminEdit(data) {
  document.body.classList.add('vs-admin-edit');
  const confirmBtn = document.getElementById('btn-confirm-submit');
  if (confirmBtn) confirmBtn.style.display = 'none';
  document.querySelectorAll('input[type="file"]').forEach(el => {
    const row = el.closest('.doc-upload-row') || el.parentElement;
    if (row) row.style.display = 'none';
  });

  const bar = document.createElement('div');
  bar.style.cssText = 'background:#e8f4fd;border:1px solid #90caf9;color:#0d47a1;padding:10px 16px;border-radius:8px;margin:0 0 14px;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:12px;';
  bar.innerHTML = `<span>โหมดแอดมินแก้ไข — แก้ไขรายได้/ค่าลดหย่อน/ผู้สอบบัญชีได้ อย่าลืมกด "บันทึกการแก้ไข" หลังแก้เสร็จ</span>
    <button type="button" class="btn btn-primary btn-sm" id="btn-admin-save-submission" onclick="saveAdminSubmissionEdit('${data.submission?.id || ''}')">บันทึกการแก้ไข</button>`;
  const main = document.querySelector('.main') || document.body;
  main.insertBefore(bar, main.firstChild);
}

function _vsRenderStatusBanner(s, statusLabelOverride) {
  const statusTh = { draft: 'ร่าง', pending_attach: 'รอแนบ', pending_payment: 'รอชำระเงิน', paid: 'ชำระแล้ว' };
  const label = statusLabelOverride || statusTh[s.status] || s.status || '';
  const bar = document.createElement('div');
  bar.style.cssText = 'background:#fff3cd;border:1px solid #ffe08a;color:#7a5b00;padding:10px 16px;border-radius:8px;margin:0 0 14px;font-size:13px;font-weight:600;text-align:center;';
  bar.textContent = `ใบยื่นแบบนี้ยืนยันแล้ว (สถานะ: ${label})`;
  const main = document.querySelector('.main') || document.body;
  main.insertBefore(bar, main.firstChild);
}

/** แทนที่กล่องอัปโหลดเอกสารด้วยรายการไฟล์ที่แนบไว้จริง + ปุ่มดาวน์โหลด */
function _vsRenderAttachments(attachments, downloadBase) {
  const list = document.getElementById('doc-upload-list');
  if (!list) return;
  list.innerHTML = attachments.length
    ? attachments.map(a => `
        <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 14px;border:1px solid #e2e8f0;border-radius:8px;margin-bottom:8px;">
          <span style="font-size:13px;">${a.doc_type || ''} — ${a.file_name || ''}</span>
          <button type="button" class="btn btn-secondary btn-sm"
            onclick="_vsDownloadAttachment('${downloadBase}/attachments/${a.id}/download', '${(a.file_name || '').replace(/'/g, "\\'")}')">
            ดาวน์โหลด
          </button>
        </div>`).join('')
    : `<p style="padding:16px;color:#888;">ไม่มีไฟล์แนบ</p>`;
}
