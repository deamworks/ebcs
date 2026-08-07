// ════════════════════════════════════════════════════
// js/index.js — Logic หน้ากรอกรายได้
// Depends on: api-client.js, auth.js, calc.js
// ════════════════════════════════════════════════════

// ── Guard: ต้อง login ก่อน ──────────────────────────
(function() {
  if (!auth.getToken()) window.location.href = '/pages/login.html';
})();

// ── Format date ISO → DD/MM/YYYY พ.ศ. ───────────────
function isoToBE(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`;
}
// ── Format datetime ISO → วัน/เดือน/ปี พ.ศ. เวลา ชม:นาที (แบบไทย) ──
function isoToBEDateTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const datePart = `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`;
  const timePart = `${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')} น.`;
  return `${datePart} เวลา ${timePart}`;
}
function thaiToISO(str) {
  if (!str) return null;
  const p = str.trim().split('/');
  if (p.length !== 3) return null;
  return `${parseInt(p[2])-543}-${p[1].padStart(2,'0')}-${p[0].padStart(2,'0')}`;
}

// ── setDate helper ───────────────────────────────────
function _setDate(el, beStr) {
  if (!el || !beStr) return;
  try { if (el._flatpickr) el._flatpickr.setDate(beStr, true, 'd/m/Y'); else el.value = beStr; }
  catch(_) { el.value = beStr; }
}

// ── init flatpickr ภาษาไทย (พ.ศ.) ───────────────────
function initBuddhistDatePicker() {
  if (typeof flatpickr !== 'function') return;
  flatpickr('.buddhist-datepicker', {
    locale:     'th',
    dateFormat: 'd/m/Y',
    onChange: function(selectedDates, dateStr, instance) {
      const id = instance.element.id;
      if (id === 'ph1-period-start' && typeof autoFillEndDate === 'function') autoFillEndDate(dateStr);
      if (id === 'ph1-period-end') {
        if (typeof autoCalcDueDate === 'function') autoCalcDueDate(dateStr);
        if (typeof autoFillYearFromPeriod === 'function') autoFillYearFromPeriod(dateStr);
      }
      if (typeof autoDetectPeriodType === 'function') autoDetectPeriodType();
    },
    onReady: function(selectedDates, dateStr, instance) {
      if (!selectedDates || selectedDates.length === 0) {
        const now = new Date();
        instance.jumpToDate(new Date(now.getFullYear() + 543, now.getMonth(), now.getDate()), false);
      }
    },
  });
}

// ── DOMContentLoaded ─────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // แสดงชื่อผู้ใช้
  const navName = document.getElementById('nav-operator-name');
  if (navName) navName.textContent = auth.getOperatorName();

  // บังคับให้ phase1 แสดงก่อนเสมอ
  const p1 = document.getElementById('phase1');
  const p2 = document.getElementById('phase2');
  if (p1) p1.style.display = 'block';
  if (p2) p2.style.display = 'none';

  // ซ่อน tax_id field (autofill จาก auth แทน)
  const taxEl = document.getElementById('ph1-taxid');
  if (taxEl) {
    taxEl.readOnly = true;
    taxEl.style.background = '#f5f5f5';
    taxEl.style.cursor = 'default';
  }

  // init flatpickr ก่อน แล้วรอ 1 tick
  initBuddhistDatePicker();
  await new Promise(r => setTimeout(r, 50));

  // autofill จาก token ที่ login ไว้
  const taxId = auth.getTaxId();
  if (taxId) {
    if (taxEl) taxEl.value = taxId;
    await autoFillFromAuth();
  }

  if (typeof loadDraftList === 'function') loadDraftList();
});

// ── autofill จาก Flask API ───────────────────────────
async function autoFillFromAuth() {
  const taxId = auth.getTaxId();
  if (!taxId) return;
  const msgEl = document.getElementById('taxid-autofill-msg');
  if (msgEl) msgEl.textContent = '';

  try {
    // [FIX] ไม่ส่ง tax_id ใน query (backend ดึงจาก JWT เอง) ส่ง year ไปด้วยถ้ามี ไม่งั้น backend ใช้ปีล่าสุด
    const yearEl  = document.getElementById('ph1-year');
    const yearVal = yearEl?.value?.trim();
    const yearQs  = yearVal ? `?year=${yearVal}` : '';
    const res = await api.get(`/operator/autofill${yearQs}`);

    // รองรับทั้ง response แบบ A (ใหม่: { success, data:{...} }) และแบบ B (เก่า: flat)
    let info;
    if (res?.success === true && res?.data) {
      info = res.data;                     // แบบ A
    } else if (res?.operator_name || res?.tax_id) {
      info = res;                          // แบบ B (flat)
    } else {
      console.error('[autoFillFromAuth] unexpected response:', res);
      throw new Error(res?.error?.message || res?.message || 'ดึงข้อมูลไม่สำเร็จ');
    }

    // [FIX] จำสถานะใบยื่นของปีนี้ไว้เงียบๆ ใช้กันซ้ำตอนกด "เริ่มนำส่ง" ใน startProcess() เท่านั้น
    appState._lockedSubmission =
      (info.existing_submission && info.existing_submission.status !== 'draft')
        ? info.existing_submission
        : null;

    // fill ปีก่อน เพื่อให้ validation ผ่าน
    _setField('ph1-year', String(info.fiscal_year || ''));

    // fill ข้อมูลอื่น
    _setField('ph1-licensee', info.operator_name);
    _setField('ph1-ref',      info.ref_no || '—');

    // วันที่ — รอ flatpickr init ก่อน
    await new Promise(r => setTimeout(r, 30));
    _setDate(document.getElementById('ph1-period-start'), isoToBE(info.period_start));
    _setDate(document.getElementById('ph1-period-end'),   isoToBE(info.period_end));
    _setDate(document.getElementById('ph1-due-date'),     isoToBE(info.due_date));

    // [FIX] เดิม rowsData ค้างข้ามปีในหน่วยความจำ ทำให้รายได้/ค่าลดหย่อนปีก่อนติดมาตอนเปลี่ยนปี
    // เปลี่ยนปีบัญชีต้องล้างข้อมูลปีเก่าทั้งหมด ยกเว้นช่อง "สถานี/รายการ" ที่ให้จำไว้
    const _newYear = String(info.fiscal_year || '');
    if (appState.year && appState.year !== _newYear) {
      const preservedStations = {};
      Object.entries(appState.rowsData || {}).forEach(([idx, row]) => {
        if (row && row.station) preservedStations[idx] = row.station;
      });
      appState.rowsData = {};
      Object.entries(preservedStations).forEach(([idx, station]) => {
        appState.rowsData[idx] = {
          income: 0, deduction: 0, no: '', type: '', station,
          startDate: '', endDate: '', hasIncome: 'yes', noIncomeReason: '',
          licenseStatus: 'active', customItems: [], savedInputs: {}
        };
      });
      appState.step2Inputs      = {};
      appState.step2CustomRows  = [];
      appState.auditor          = {};
      appState.financialIncome  = '';
      appState.customOtherIncome = [];
      appState._draftLoaded     = false;

      // [FIX] ล้าง DOM ช่อง "รายได้รวมตามงบการเงิน" ด้วย ไม่งั้นค่าปีก่อนค้างจนกว่าจะมี draft ปีใหม่มาทับ
      const _finEl = document.getElementById('total-income-financial');
      if (_finEl) _finEl.value = '';
    }

    // update appState
    appState.taxId    = taxId;
    appState.taxid    = taxId;
    appState.refNo    = info.ref_no || '';
    appState.year     = _newYear;
    appState.dueDate  = isoToBE(info.due_date);
    appState.licensee = info.operator_name || '';

    // ตรวจรอบบัญชี
    const roundEl = document.getElementById('ph1-period-round');
    if (roundEl && info.period_start && info.period_end) {
      const ps = new Date(info.period_start);
      const pe = new Date(info.period_end);
      const isNormal = ps.getMonth()===0 && ps.getDate()===1 && pe.getMonth()===11 && pe.getDate()===31;
      roundEl.value = isNormal ? 'รอบปกติ' : 'รอบอื่น';
      roundEl.disabled = true;
      roundEl.style.background = '#f5f5f5';
    }

    if (msgEl) msgEl.textContent = '';

     // โหลด draft (auto-save) จาก localStorage ด้วย taxId+year — คืนค่าที่กรอกไว้ก่อนหน้าของปีนั้นเสมอ
     await new Promise(r => setTimeout(r, 80));
     if (typeof loadDraft === 'function') {
       const hasDraft = loadDraft(taxId, String(info.fiscal_year));
       if (hasDraft) {
         appState._draftLoaded = true;
         if (typeof generateRows === 'function') generateRows();
         const fin = document.getElementById('total-income-financial');
         if (fin && appState.financialIncome) fin.value = appState.financialIncome;
         if (appState.auditor) {
           const setVal = (id, val) => { const el = document.getElementById(id); if (el && val) el.value = val; };
           setVal('auditorName',    appState.auditor.name);
           setVal('auditorRegNo',   appState.auditor.regNo);
           setVal('auditorCompany', appState.auditor.company);
         }

       }
     }

     // [FIX] ต้องดึงใบอนุญาตจาก DB "หลัง" โหลด draft เสมอ — draft ใน localStorage เป็น cache เก่าที่
     // loadDraft() เขียนทับ rowsData ทั้งก้อน ต้องดึงซ้ำให้เลขที่/ประเภท/วันที่ใบอนุญาตตรงกับ DB จริง
     await loadLicenses(info.fiscal_year, taxId);

     // บันทึก key ให้ถูกต้องทันที
     if (typeof saveDraftNow === 'function') saveDraftNow(taxId, String(info.fiscal_year));


  } catch (err) {
    if (msgEl) {
      msgEl.textContent = err?.code === 'NOT_FOUND' ? 'ไม่มีข้อมูล' : `❌ ${err.message}`;
      msgEl.style.color = '#dc2626';
    }
  }
}

// ── autoFillFromTaxId — legacy compat ───────────────
async function autoFillFromTaxId() {
  await autoFillFromAuth();
}

// ── เปิดดูใบยื่นแบบที่ยืนยันไปแล้ว (โหมดอ่านอย่างเดียว) ────
async function viewExistingSubmission() {
  const s = appState._lockedSubmission;
  if (!s) return;
  try {
    const detail = await api.get(`/operator/submissions/${s.id}`);
    // [FIX] detail.status คือสถานะจริง (คำนวณจากใบเสร็จ) ต่าง detail.submission.status ที่เป็นค่า raw
    // ถ้าไม่ส่ง status นี้ แบนเนอร์จะค้างโชว์ "รอชำระเงิน" แม้บันทึกรับชำระแล้ว
    const statusTh = { draft: 'ร่าง', pending_payment: 'รอชำระเงิน', paid: 'ชำระแล้ว' };
    if (typeof renderReadOnlySubmission === 'function') {
      renderReadOnlySubmission(detail, {
        downloadBase: '/operator',
        statusLabel: statusTh[detail.status] || detail.status,
        // [FIX] เดิมมีปุ่ม "กลับหน้าหลัก" ในแบนเนอร์นี้ด้วย ซ้ำกับลิงก์บนแถบนำทาง — ตัด onClose ออก
      });
    }
  } catch (e) {
    alert('เปิดดูใบยื่นแบบไม่สำเร็จ: ' + (e.message || ''));
  }
}

function _setField(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

// ── โหลดใบอนุญาต ─────────────────────────────────────
async function loadLicenses(year, taxId) {
  const cntEl = document.getElementById('license-count');
  try {
    // [FIX] ไม่ส่ง tax_id (backend ดึงจาก JWT) ส่ง year ให้กรองด้วยช่วงวันที่ใบอนุญาต ไม่ใช้ fiscal_year ของ licensee_master ที่ไม่น่าเชื่อถือ
    const res = await api.get(`/operator/licenses?year=${year}`);
    // รองรับทั้ง { success, data: { licenses } } และ { licenses: [...] } flat
    let licenses;
    if (res?.success === true && res?.data) {
      licenses = res.data?.licenses || [];
    } else if (Array.isArray(res?.licenses)) {
      licenses = res.licenses;
    } else if (!res) {
      throw new Error('ดึงใบอนุญาตไม่สำเร็จ');
    } else {
      licenses = [];
    }
    if (!licenses.length) return;

    if (cntEl) cntEl.value = licenses.length;

    licenses.forEach((lic, i) => {
      const idx = i + 1;
      if (!appState.rowsData[idx]) {
        appState.rowsData[idx] = {
          income: 0, deduction: 0, no: '', type: '', station: '',
          startDate: '', endDate: '', hasIncome: 'yes', noIncomeReason: '',
          licenseStatus: 'active', customItems: [], savedInputs: {}
        };
      }
      appState.rowsData[idx].no            = lic.license_no     || '';
      appState.rowsData[idx].type          = lic.license_type   || '';
      appState.rowsData[idx].startDate     = isoToBE(lic.license_start);
      appState.rowsData[idx].endDate       = isoToBE(lic.license_end);
      appState.rowsData[idx].licenseStatus = lic.license_status || 'active';
    });

    if (typeof generateRows === 'function') generateRows();
  } catch (err) {
    console.error('[loadLicenses]', err);
  }
}

// [FIX] startProcess ลบออกจากไฟล์นี้ — ซ้ำกับนิยามใน license.js ที่สมบูรณ์กว่า

// _buildSubmissionPayload — รวม logic สร้าง payload ไว้ที่เดียว ใช้ร่วมกันทั้ง saveSubmission และ saveDraftToServer ไม่ให้หลุดไม่ตรงกัน
function _buildSubmissionPayload() {
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
      license_start:  thaiToISO(d.startDate),
      license_end:    thaiToISO(d.endDate),
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

  return {
    fiscal_year:      parseInt(appState.year) || 0,
    total_income:     totals.totalIncome,
    total_income_financial: pv(document.getElementById('total-income-financial')?.value),
    deduction_amount: totals.totalDeduct,
    fund_amount:      totals.totalFund,
    vat_amount:       totals.totalVat,
    extra_amount:     totals.totalPenalty,
    net_amount:       totals.totalNet,
    auditor_name:     document.getElementById('auditorName')?.value    || '',
    auditor_license:  document.getElementById('auditorRegNo')?.value   || '',
    auditor_office:   document.getElementById('auditorCompany')?.value || '',
    audited_date:     thaiToISO(document.getElementById('auditorDate')?.value),
    licenses,
    other_incomes,
  };
}

// โหลดร่างที่เคยบันทึกลง server ไว้ (จาก saveDraftToServer) มาแสดงเป็นข้อความสั้นในหน้าแรก ให้กด "ทำต่อ" ได้ข้ามเครื่อง
async function loadDraftList() {
  const wrap = document.getElementById('draft-list-wrap');
  if (!wrap) return;
  try {
    const res = await api.get('/operator/submissions');
    const all = res?.data?.submissions || res?.submissions || [];
    const drafts = all.filter(s => s.status === 'draft');
    if (!drafts.length) { wrap.style.display = 'none'; return; }

    wrap.style.display = 'flex';
    wrap.style.cssText = 'display:flex;flex-direction:column;gap:6px;background:#fff8e1;border:1px solid #ffe082;border-radius:var(--radius);padding:10px 14px;margin-bottom:16px;';
    wrap.innerHTML = drafts.map(d => `
      <div style="display:flex;justify-content:space-between;align-items:center;gap:10px;font-size:13px;color:#7b5800;">
        <span>พบร่างที่บันทึกไว้ — ปีบัญชี พ.ศ. ${d.fiscal_year} (บันทึกล่าสุด ${isoToBEDateTime(d.created_at_iso) || d.created_at || '—'}) สถานะ: <strong>${d.status_label || 'ร่าง (ยังไม่ยืนยัน)'}</strong></span>
        <button type="button" class="btn btn-primary btn-sm" style="flex-shrink:0;" onclick="resumeDraftSubmission('${d.id}')">ทำต่อ</button>
      </div>`).join('');
  } catch (err) {
    console.error('[loadDraftList]', err);
  }
}

// resumeDraftSubmission — โหลดร่างที่บันทึกไว้ในระบบ (ไม่ใช่ localStorage) มาแก้ต่อ ใช้ hydration
// เดียวกับหน้าดูอย่างเดียวแต่ไม่ล็อก (skipAttachments:false ให้เห็นไฟล์แนบเดิม + ปุ่มลบ)
async function resumeDraftSubmission(id) {
  try {
    const detail = await api.get(`/operator/submissions/${id}`);
    if (typeof renderReadOnlySubmission !== 'function') return;
    renderReadOnlySubmission(detail, {
      downloadBase:    '/operator',
      skipBanner:      true,
      skipAttachments: false,
      skipLock:        true,
    });
    showToast('โหลดร่างที่บันทึกไว้เรียบร้อยแล้ว');
  } catch (err) {
    console.error('[resumeDraftSubmission]', err);
    showToast('โหลดร่างไม่สำเร็จ: ' + (err.message || ''));
  }
}

// saveDraftToServer — บันทึกร่างลง DB จริง กดเองจากปุ่ม "บันทึกร่าง" เท่านั้น ไม่ใช่ auto-save
// [FIX] เดิมชื่อ saveDraft() ชนกับ saveDraft() ใน ui.js (auto-save ลง localStorage ทุกครั้งที่เปลี่ยน
// step/พิมพ์) ทำให้ยิงสร้าง draft ใหม่ในฐานข้อมูลซ้ำๆ โดยไม่ตั้งใจ — เปลี่ยนชื่อกันชนแล้ว
async function saveDraftToServer() {
  if (!appState.year) {
    showToast('กรุณาระบุปีบัญชีก่อนบันทึกร่าง');
    return;
  }
  try {
    const payload = _buildSubmissionPayload();
    const result  = await api.post('/operator/submissions', payload);
    if (result?.success === false) {
      throw new Error(result?.error?.message || result?.message || 'บันทึกร่างไม่สำเร็จ');
    }

    // รองรับทั้ง { success, data: { submission_id } } และ { submission_id } flat
    const submissionId = (result?.success === true && result?.data)
      ? result.data.submission_id
      : result?.submission_id;

    // [FIX] เดิมไม่อัปโหลดไฟล์แนบตอนบันทึกร่างเลย ทำให้ไฟล์หายทุกครั้ง — ตอนนี้อัปโหลดเฉพาะไฟล์ใหม่
    // ที่เพิ่งเลือก (ไฟล์เดิมถูก carry-forward ให้แล้วฝั่ง backend ไม่ต้องอัปโหลดซ้ำ)
    const attachmentErrors = [];
    if (submissionId) {
      const attachedEntries = Object.entries(appState.attachedFiles || {});
      for (const [idx, entry] of attachedEntries) {
        try {
          const formData = new FormData();
          formData.append('file', entry.file);
          formData.append('doc_type', entry.label || `เอกสาร ${idx}`);
          await api.upload(`/operator/submissions/${submissionId}/attachments`, formData);
        } catch (err) {
          attachmentErrors.push({ idx, label: entry.label, error: err });
        }
      }
    }

    if (attachmentErrors.length) {
      const names = attachmentErrors.map(e => e.label).join(', ');
      showToast(`บันทึกร่างสำเร็จ แต่แนบไฟล์บางส่วนไม่สำเร็จ: ${names} กรุณาลองแนบใหม่`);
    } else {
      showToast('บันทึกร่างเรียบร้อยแล้ว');
    }
  } catch (err) {
    console.error('[saveDraftToServer]', err);
    showToast('บันทึกร่างไม่สำเร็จ: ' + (err.message || ''));
  }
}

// ── saveSubmission — บันทึกใบยื่นแบบไปที่ Flask API, เรียกจาก step5-summary.js ──
async function saveSubmission() {
  try {
    const payload = _buildSubmissionPayload();
    const result  = await api.post('/operator/submissions', payload);

    // รองรับทั้ง { success, data: { submission_id } } และ { submission_id } flat
    let submissionId;
    if (result?.success === true && result?.data) {
      submissionId = result.data.submission_id;
    } else if (result?.submission_id) {
      submissionId = result.submission_id;
    } else {
      throw new Error(result?.error?.message || result?.message || 'บันทึกไม่สำเร็จ');
    }

    // อัปโหลดไฟล์แนบ (Step 6) ขึ้น server ก่อนยืนยันส่ง — เก็บไว้แค่ในเครื่อง
    // จนถึงตอนนี้เพราะยังไม่มี submission_id ให้ผูกจนกว่าจะสร้างใบยื่นสำเร็จ
    const attachmentErrors = [];
    const attachedEntries  = Object.entries(appState.attachedFiles || {});
    for (const [idx, entry] of attachedEntries) {
      try {
        const formData = new FormData();
        formData.append('file', entry.file);
        formData.append('doc_type', entry.label || `เอกสาร ${idx}`);
        await api.upload(`/operator/submissions/${submissionId}/attachments`, formData);
      } catch (err) {
        attachmentErrors.push({ idx, label: entry.label, error: err });
      }
    }

    // [FIX] เดิมไม่เคยเรียก endpoint นี้ ใบยื่นแบบเลยค้างสถานะ 'draft' แก้ไข/ยื่นซ้ำได้ไม่จำกัด
    // ต้องยืนยันสถานะทันทีให้เปลี่ยนเป็น pending_payment (ล็อกแก้ไขจนกว่าแอดมินจะลบ)
    await api.post(`/operator/submissions/${submissionId}/submit`, {});

    // ลบ draft หลัง submit สำเร็จ
    if (typeof clearDraft === 'function') clearDraft();

    return {
      success:          true,
      submissionId:     submissionId,
      error:            null,
      attachmentErrors
    };

  } catch (err) {
    console.error('[saveSubmission]', err);
    return { success: false, submissionId: null, error: err };
  }
}