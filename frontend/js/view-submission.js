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

/** เปิดดูไฟล์แนบแบบ preview ในแท็บใหม่ (ไม่บังคับดาวน์โหลด) ผ่าน fetch +
 *  Bearer token (ห้ามใช้ <a href> ตรงๆ เพราะ token เก็บใน localStorage ไม่ใช่
 *  cookie นำทางตรงๆ จะไม่ส่ง token ไปด้วย) — browser จะพรีวิวให้เองถ้าเป็น
 *  ไฟล์ pdf/รูปภาพที่ดูได้ในตัว (ไม่ตั้ง .download จึงไม่บังคับ save ไฟล์) */
async function _vsPreviewAttachment(path, fileName) {
  try {
    const isAdminPage = window.location.pathname.includes('admin');
    const token = isAdminPage
      ? localStorage.getItem('ebcs_admin_token')
      : localStorage.getItem('ebcs_token');
    const res = await fetch(`${API_BASE}${path}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error('เปิดดูเอกสารไม่สำเร็จ');
    const blob    = await res.blob();
    const blobUrl = URL.createObjectURL(blob);
    window.open(blobUrl, '_blank');
    // คืนหน่วยความจำหลังเปิดแท็บใหม่ไปพักหนึ่ง (ให้เวลาแท็บใหม่โหลดไฟล์เสร็จก่อน)
    setTimeout(() => URL.revokeObjectURL(blobUrl), 60000);
  } catch (e) {
    if (typeof showToast === 'function') showToast('เปิดดูเอกสารไม่สำเร็จ: ' + (e.message || ''), 'error');
    else alert('เปิดดูเอกสารไม่สำเร็จ');
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

  // [FIX] ต้องสลับไป Phase 2 + เติมสรุปก่อนเป็นอันดับแรกเสมอ — เดิมทำหลังลูปใบอนุญาต
  // ถ้าลูป throw จะค้างที่ Phase 1 เปล่าๆ ทั้งที่แถบ "โหมดดูอย่างเดียว" ขึ้นไปแล้ว
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

  if (!opts.skipBanner) {
    _vsRenderStatusBanner(s, opts.statusLabel, opts.onClose);
  }

  // ── appState หลัก ──
  appState.taxId       = s.tax_id || '';
  appState.taxid       = s.tax_id || '';
  appState.licensee    = s.operator_name || '';
  appState.refNo       = s.ref_no || '';
  appState.year        = String(s.fiscal_year || '');
  appState.dueDate      = _vsIsoToBE(s.due_date);
  // กัน restoreStepState(1) โหลด draft เก่าจาก localStorage (auto-save) มาทับข้อมูลจริงที่เพิ่ง hydrate
  appState._draftLoaded = true;
  // เคลียร์ไฟล์แนบก่อน hydrate ใหม่ทุกครั้ง กันข้อมูลของใบก่อนหน้าค้างข้ามมา (เช่นสลับดูคนละปี)
  appState.attachedFiles = {};
  appState.existingAttachments = {};

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

    // [FIX] "ประเภทรายการ" คือสถานะใบอนุญาต (ปกติ/สิ้นสุด/ยกเลิก/เพิกถอน) — เดิมใช้ licensee_type ผิดฟิลด์
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

    // [FIX] "รายได้รวมตามงบการเงิน" เดิมไม่ถูกส่งไป hydrate เลย โชว์ 0.00 เสมอ ทั้งที่ backend เก็บไว้แล้ว
    appState.financialIncome = s.total_income_financial != null
      ? Number(s.total_income_financial).toFixed(2)
      : '';
    const finEl = document.getElementById('total-income-financial');
    if (finEl) finEl.value = appState.financialIncome;

    if (typeof generateRows === 'function') generateRows();
    if (typeof goToStep === 'function') goToStep(1);
    if (!opts.skipAttachments) _vsRenderAttachments(attachments, downloadBase, !!opts.skipLock);
  } catch (err) {
    console.error('[renderReadOnlySubmission]', err);
  }

  // [FIX] แอดมินแก้ตัวเลขตรงๆ ไม่ได้อีกแล้ว (จะไม่ตรงกับ ชส.01/ชส.02 ที่พิมพ์ไปแล้ว)
  // ผิดต้องใช้ "ตีกลับเป็นร่าง" (rejectSubmissionToDraft) ให้ผู้ประกอบการแก้เอง —
  // เหลือแค่โหมดดูอย่างเดียว กับโหมดแก้ไขร่างของผู้ประกอบการเอง (skipLock) เท่านั้น
  if (opts.skipLock) {
    // ไม่ทำอะไร — ปล่อยแก้ไขได้ปกติ (ตอนผู้ประกอบการทำร่างต่อผ่าน resumeDraftSubmission())
  } else {
    _vsLockReadOnly();
  }
}

const _VS_EYE_ICON = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/></svg>';

/** ปิดการแก้ไขทุกช่อง + ซ่อนปุ่มที่ทำให้เกิดการบันทึก/อัปโหลด/ยืนยันซ้ำ
 *  (ปุ่มเปลี่ยน step และปุ่มพิมพ์เอกสารยังกดได้ตามปกติ) */
function _vsLockReadOnly() {
  document.body.classList.add('vs-readonly');
  document.querySelectorAll('input, select, textarea').forEach(el => {
    // ช่องที่ readonly อยู่แล้วแต่เดิม ไม่ต้องแตะ ให้หน้าตาเหมือนเดิมทุกโหมด
    if (el.hasAttribute('readonly')) return;
    if (el.id === 'total-income-financial') {
      // [FIX] ฟิลด์นี้กรอกเองได้ปกติ โหมดดูอย่างเดียวห้ามแก้แต่ไม่อยากให้ดูจางเหมือนช่องอื่น
      // จึงใช้ readonly แทน disabled (ไม่โดน CSS .vs-readonly input:disabled ทำให้สีจาง)
      el.readOnly = true;
      return;
    }
    el.disabled = true;
  });
  // ปุ่มที่กดแล้วเปลี่ยนสถานะ/ส่งซ้ำได้ ต้องซ่อนหมดในโหมดดูอย่างเดียว รวมปุ่ม "บันทึกร่าง"
  // (ลิงก์ "หน้าหลัก" บนแถบนำทางคงไว้ตามปกติ — ดู _vsRenderStatusBanner ที่มีปุ่มซ้ำซ้อนกัน)
  ['btn-confirm-submit', 'btn-confirm-fund-payment', 'btn-save-draft'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.style.display = 'none';
  });
  // หมายเหตุ: ปุ่มอัปโหลดเอกสาร (Step 6) ไม่ต้องซ่อน — _vsRenderAttachments() จัดการเองแล้ว

  // ปุ่ม "+ เพิ่มรายการ" — ปิดใช้งานเพราะเพิ่มข้อมูลใหม่ไม่ได้ในใบที่ยืนยันแล้ว
  ['btn-add-income-row', 'btn-add-other-income-row'].forEach(id => {
    const btn = document.getElementById(id);
    if (btn) {
      btn.disabled = true;
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
    }
  });

  // ปุ่ม "กรอกรายได้" ต่อใบอนุญาต — เปลี่ยนเป็นไอคอนตาสีเทา สื่อว่าดูได้อย่างเดียว
  // (ปุ่ม "กรอกค่าลดหย่อน" Step 3 ถูกสร้างใหม่ทุกครั้งที่เข้า step จึงจัดการแยกใน generateDeductRows())
  document.querySelectorAll('button[onclick^="openIncomeModal"]').forEach(btn => {
    btn.classList.remove('btn-primary');
    btn.classList.add('btn-secondary');
    btn.style.color = '#888';
    btn.style.borderColor = '#ccc';
    btn.title = 'ดูรายได้';
    btn.innerHTML = _VS_EYE_ICON;
  });

  // ปุ่ม "ยกเลิก/บันทึกข้อมูล" ใน Modal กรอกรายได้-ค่าลดหย่อน — เหลือแค่ปุ่ม
  // "ปิด" ปุ่มเดียว เพราะไม่มีอะไรให้บันทึก (แก้ไขข้อมูลไม่ได้)
  [
    { save: 'btn-save-income-modal', cancel: 'btn-cancel-income-modal', close: 'closeIncomeModal' },
    { save: 'btn-save-deduct-modal', cancel: 'btn-cancel-deduct-modal', close: 'closeDeductModal' },
  ].forEach(({ save, cancel, close }) => {
    const cancelBtn = document.getElementById(cancel);
    if (cancelBtn) cancelBtn.style.display = 'none';
    const saveBtn = document.getElementById(save);
    if (saveBtn) {
      saveBtn.textContent = 'ปิด';
      saveBtn.setAttribute('onclick', `${close}()`);
    }
  });
}

function _vsRenderStatusBanner(s, statusLabelOverride, onClose) {
  const statusTh = { draft: 'ร่าง', pending_payment: 'รอชำระเงิน', paid: 'ชำระแล้ว' };
  const label = statusLabelOverride || statusTh[s.status] || s.status || '';
  const bar = document.createElement('div');
  bar.style.cssText = 'background:#fff3cd;border:1px solid #ffe08a;color:#7a5b00;padding:10px 16px;border-radius:8px;margin:0 0 14px;font-size:13px;font-weight:600;display:flex;justify-content:space-between;align-items:center;gap:12px;flex-wrap:wrap;';
  const msg = document.createElement('span');
  msg.textContent = `ใบยื่นแบบนี้ยืนยันแล้ว (สถานะ: ${label}) — ดูข้อมูลและพิมพ์เอกสารได้เท่านั้น ไม่สามารถแก้ไขข้อมูลได้`;
  bar.appendChild(msg);
  if (typeof onClose === 'function') {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'btn btn-secondary btn-sm';
    btn.style.cssText = 'white-space:nowrap;';
    btn.textContent = 'กลับหน้าหลัก';
    btn.onclick = onClose;
    bar.appendChild(btn);
  }
  const main = document.querySelector('.main') || document.body;
  main.insertBefore(bar, main.firstChild);
}

/** เติมชื่อไฟล์ที่แนบไว้จริงลงในตารางเอกสารแนบ (Step 6) ตัวเดิม โดยคงหน้าตา
 *  ตารางไว้ทุกอย่าง
 *  - โหมดดูอย่างเดียว (editable=false): เปลี่ยนปุ่ม "แนบไฟล์" เป็น "ดูเอกสาร"
 *    สำหรับรายการที่มีไฟล์แนบไว้แล้ว และซ่อนปุ่มลบ (X) เพราะแก้ไขไม่ได้
 *  - โหมดแก้ไข/ทำร่างต่อ (editable=true — resumeDraftSubmission ใน index.js):
 *    โชว์ชื่อไฟล์ที่เคยแนบไว้ + เปิดปุ่มลบ (X) ให้ลบออกจากฐานข้อมูลจริงได้
 *    ปุ่ม "แนบไฟล์" เปลี่ยนเป็น "ดูเอกสาร" เช่นกัน ต้องกดลบ (X) ก่อนถึงจะแนบใหม่ทับได้ */
function _vsRenderAttachments(attachments, downloadBase, editable) {
  const rows = document.querySelectorAll('#doc-upload-list .doc-row');
  if (!rows.length) return;
  rows.forEach(row => {
    const idx      = row.id.replace('docrow-', '');
    const nameEl   = row.querySelector('.doc-row-name');
    const fnameEl  = document.getElementById(`fname-${idx}`);
    const btn      = row.querySelector('.doc-row-btn button');
    const clearBtn = document.getElementById(`clear-${idx}`);

    // [FIX] ดอกจัน (*) ท้ายชื่อเอกสารบังคับใน .doc-row-name ไม่ใช่ส่วนหนึ่งของ doc_type ในฐานข้อมูล
    // ต้องตัดออกก่อนเทียบ ไม่งั้นจะจับคู่ไม่เจอ ทำให้เอกสารที่แนบไว้แล้วดูเหมือนหายไป
    const label = nameEl ? nameEl.textContent.trim().replace(/\s*\*\s*$/, '') : '';
    const att   = attachments.find(a => (a.doc_type || '').trim() === label);

    if (editable) {
      if (att) {
        // [FIX] resumeDraftSubmission() ไม่มี File object จริงให้ appState.attachedFiles (ไฟล์อยู่บน
        // server แล้ว ดึงเป็น File ไม่ได้) — ต้องจดไว้ใน existingAttachments ให้ step5-summary.js เห็นด้วย
        appState.existingAttachments = appState.existingAttachments || {};
        appState.existingAttachments[idx] = att.id;

        if (fnameEl) { fnameEl.textContent = att.file_name || 'เอกสารแนบ'; fnameEl.classList.add('attached'); }
        if (clearBtn) {
          clearBtn.style.display = 'inline-flex';
          clearBtn.onclick = () => _vsRemoveExistingAttachment(downloadBase, idx, att.id);
        }
        // [FIX] เปลี่ยนปุ่ม "แนบไฟล์" เป็น "ดูเอกสาร" เมื่อมีไฟล์อยู่แล้ว (เหมือน handleFileAttach) ต้องลบ (X) ก่อนถึงแนบใหม่ทับได้
        if (btn) {
          btn.textContent = 'ดูเอกสาร';
          btn.onclick = () => _vsPreviewAttachment(`${downloadBase}/attachments/${att.id}/download`, att.file_name);
        }
      }
      return;
    }

    if (clearBtn) clearBtn.style.display = 'none';
    if (att) {
      if (fnameEl) { fnameEl.textContent = att.file_name || 'เอกสารแนบ'; fnameEl.classList.add('attached'); }
      if (btn) {
        btn.textContent = 'ดูเอกสาร';
        btn.onclick = () => _vsPreviewAttachment(`${downloadBase}/attachments/${att.id}/download`, att.file_name);
      }
    } else {
      if (fnameEl) fnameEl.textContent = '—';
      if (btn) {
        btn.disabled = true;
        btn.style.opacity = '0.5';
        btn.style.cursor = 'not-allowed';
        btn.onclick = null;
      }
    }
  });
}

/** ลบไฟล์แนบที่เคยบันทึกไว้แล้วในฐานข้อมูลจริง (ใช้ตอนทำร่างต่อ — ต่างจาก
 *  clearFileAttach() เดิมที่แค่ล้างไฟล์ที่เพิ่งเลือกในเครื่อง ยังไม่เคยอัปโหลด) */
async function _vsRemoveExistingAttachment(downloadBase, idx, attachmentId) {
  if (!confirm('ลบไฟล์แนบนี้?')) return;
  try {
    await api.delete(`${downloadBase}/attachments/${attachmentId}`);
    if (appState.existingAttachments) delete appState.existingAttachments[idx];
    const rowEl     = document.getElementById(`docrow-${idx}`);
    const attachBtn = rowEl?.querySelector('.doc-row-btn button');
    const fnameEl   = document.getElementById(`fname-${idx}`);
    const clearBtn  = document.getElementById(`clear-${idx}`);
    if (fnameEl)   { fnameEl.textContent = '—'; fnameEl.classList.remove('attached'); }
    if (clearBtn)  clearBtn.style.display = 'none';
    if (attachBtn) {
      attachBtn.textContent = 'แนบไฟล์';
      attachBtn.onclick = () => document.getElementById(`file-${idx}`).click();
    }
    if (typeof showToast === 'function') showToast('ลบไฟล์แนบเรียบร้อยแล้ว');
  } catch (e) {
    if (typeof showToast === 'function') showToast('ลบไฟล์แนบไม่สำเร็จ: ' + (e.message || ''), 'error');
    else alert('ลบไฟล์แนบไม่สำเร็จ');
  }
}
