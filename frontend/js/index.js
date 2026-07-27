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
    clickOpens: false,
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
});

// ── autofill จาก Flask API ───────────────────────────
async function autoFillFromAuth() {
  const taxId = auth.getTaxId();
  if (!taxId) return;
  const msgEl = document.getElementById('taxid-autofill-msg');
  if (msgEl) msgEl.textContent = '';

  try {
    // [FIX] ไม่ส่ง tax_id ใน query — backend ดึงจาก JWT เอง
    // ถ้ามี year ใน field แล้ว ส่งไปด้วย (ไม่งั้น backend จะใช้ปีล่าสุดอัตโนมัติ)
    const yearEl  = document.getElementById('ph1-year');
    const yearVal = yearEl?.value?.trim();
    const yearQs  = yearVal ? `?year=${yearVal}` : '';
    const res = await api.get(`/operator/autofill${yearQs}`);

    // รองรับทั้ง 2 รูปแบบ response:
    //   แบบ A (ใหม่): { success: true, data: { operator_name, ... } }
    //   แบบ B (เก่า): { operator_name, fiscal_year, ... }  (flat)
    let info;
    if (res?.success === true && res?.data) {
      info = res.data;                     // แบบ A
    } else if (res?.operator_name || res?.tax_id) {
      info = res;                          // แบบ B (flat)
    } else {
      console.error('[autoFillFromAuth] unexpected response:', res);
      throw new Error(res?.error?.message || res?.message || 'ดึงข้อมูลไม่สำเร็จ');
    }

    // ถ้าเคยยื่นปีนี้ไปแล้ว ไม่ให้กรอกฟอร์มซ้ำ — พาไปหน้าดูสถานะ (โหมดดูอย่างเดียว) แทน
    if (info.existing_submission) {
      window.location.href = `/pages/status.html?year=${encodeURIComponent(info.fiscal_year || '')}`;
      return;
    }

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

    // update appState
    appState.taxId    = taxId;
    appState.taxid    = taxId;
    appState.refNo    = info.ref_no || '';
    appState.year     = String(info.fiscal_year || '');
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

    // ดึงใบอนุญาต
    await loadLicenses(info.fiscal_year, taxId);
    if (msgEl && !info.existing_submission) msgEl.textContent = '';

     // โหลด draft จาก localStorage — ส่ง taxId และ year ตรงๆ
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
     // บันทึก key ให้ถูกต้องทันที
     if (typeof saveDraftNow === 'function') saveDraftNow(taxId, String(info.fiscal_year));


  } catch (err) {
    if (msgEl) { msgEl.textContent = `❌ ${err.message}`; msgEl.style.color = '#dc2626'; }
  }
}

// ── autoFillFromTaxId — legacy compat ───────────────
async function autoFillFromTaxId() {
  await autoFillFromAuth();
}

function _setField(id, val) {
  const el = document.getElementById(id);
  if (el) el.value = val || '';
}

// ── โหลดใบอนุญาต ─────────────────────────────────────
async function loadLicenses(year, taxId) {
  const cntEl = document.getElementById('license-count');
  try {
    // [FIX] ไม่ส่ง tax_id ใน query (backend ดึงจาก JWT) แต่ส่ง year
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

// ── startProcess — Phase 1 → Phase 2 ─────────────────
function startProcess() {
  appState.licensee    = document.getElementById('ph1-licensee')?.value    || '';
  appState.taxId       = document.getElementById('ph1-taxid')?.value       || '';
  appState.year        = document.getElementById('ph1-year')?.value        || '';
  appState.type        = document.getElementById('ph1-type')?.value        || '';
  appState.periodRound = document.getElementById('ph1-period-round')?.value || '';
  const ps = document.getElementById('ph1-period-start')?.value || '';
  const pe = document.getElementById('ph1-period-end')?.value   || '';
  appState.period  = `${ps}-${pe}`;
  appState.dueDate = document.getElementById('ph1-due-date')?.value || '';

  if (!appState.licensee) { alert('กรุณาระบุชื่อผู้ได้รับใบอนุญาต'); return; }
  if (!appState.year)     { alert('กรุณาระบุปีบัญชี'); return; }

  document.getElementById('phase1').style.display = 'none';
  document.getElementById('phase2').style.display = 'block';
  if (typeof goToStep === 'function') goToStep(1);
  window.scrollTo(0, 0);
}

// ── saveSubmission — บันทึกใบยื่นแบบไปที่ Flask API, เรียกจาก step5-summary.js ──
async function saveSubmission() {
  try {
    const count = parseInt(document.getElementById('license-count')?.value) || 1;
    const { perLicense, totals } = calcAllLicenseSummary(count);

    // [FIX] build licenses array — ส่ง income/deduction ต่อใบ + incomes รายการย่อย
    const licenses = [];
    for (let i = 1; i <= count; i++) {
      const d = appState.rowsData[i] || {};
      const incomes = [];

      // รายการมาตรฐาน (savedInputs)
      Object.entries(d.savedInputs || {}).forEach(([key, val]) => {
        const amount = pv(val);
        if (amount > 0) incomes.push({ field_key: key, label: key, amount, is_custom: false });
      });

      // รายการกำหนดเอง (customItems)
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
        license_no: d.no       || '',
        income:     d.income   || 0,    // [FIX] ส่ง income แยก (backend ใช้ sum นี้)
        deduction:  d.deduction || 0,  // [FIX] ส่ง deduction แยก
        incomes,
      });
    }

    // build other_incomes
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

    // [FIX] ส่ง auditor เป็น flat fields (ตรงกับ backend ที่แก้แล้ว)
    const result = await api.post('/operator/submissions', {
      fiscal_year:      parseInt(appState.year) || 0,
      total_income:     totals.totalIncome,
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
    });

    // รองรับทั้ง { success, data: { submission_id } } และ { submission_id } flat
    let submissionId;
    if (result?.success === true && result?.data) {
      submissionId = result.data.submission_id;
    } else if (result?.submission_id) {
      submissionId = result.submission_id;
    } else {
      throw new Error(result?.error?.message || result?.message || 'บันทึกไม่สำเร็จ');
    }

    // ── อัปโหลดเอกสารแนบ (ถ้ามี) ไปเก็บไว้กับใบยื่นแบบที่เพิ่งสร้าง ──
    const attachmentErrors = [];
    const attached = appState.attachedFiles || {};
    for (const idx of Object.keys(attached)) {
      const entry = attached[idx];
      if (!entry?.file) continue;
      const formData = new FormData();
      formData.append('file', entry.file);
      formData.append('doc_type', entry.label || `เอกสาร ${idx}`);
      try {
        await api.upload(`/operator/submissions/${submissionId}/attachments`, formData);
      } catch (e) {
        attachmentErrors.push({ label: entry.label || `เอกสาร ${idx}`, message: e.message || 'แนบไฟล์ไม่สำเร็จ' });
      }
    }

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