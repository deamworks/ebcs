/* =========================================================================
     ไฟล์: js/license.js (ระบบดักจับข้อมูลนิติบุคคล และสร้างแถวตารางใบอนุญาต Step 1 & 3)
     ========================================================================= */

window.addEventListener('DOMContentLoaded', () => {
  generateRows();
});

/**
 * @param {HTMLInputElement} inputEl - input element ของช่องเลขที่ใบอนุญาต
 * @returns {string} ค่าที่จัดรูปแบบแล้ว สำหรับส่งต่อให้ updateRowText()
 */
function formatLicenseNo(inputEl) {
  const raw = inputEl.value;
  const cursorPos = inputEl.selectionStart ?? raw.length;

  // นับจำนวนตัวอักษร/เลข (ไม่นับ "-") ที่อยู่ก่อนตำแหน่ง cursor เดิม
  // เพื่อใช้คำนวณตำแหน่ง cursor ใหม่หลังจัดรูปแบบ ไม่ให้ cursor กระโดดไปท้ายสุด
  const alnumBeforeCursor = raw.slice(0, cursorPos).replace(/[^a-zA-Z0-9]/g, '').length;

  const clean = raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 14);
  const segments = [];
  if (clean.length > 0)  segments.push(clean.slice(0, 2));
  if (clean.length > 2)  segments.push(clean.slice(2, 8));
  if (clean.length > 8)  segments.push(clean.slice(8, 12));
  if (clean.length > 12) segments.push(clean.slice(12, 14));
  const formatted = segments.join('-');

  inputEl.value = formatted;

  // หาตำแหน่ง cursor ใหม่: เดินนับตัวอักษร/เลขในผลลัพธ์จนครบจำนวนเท่าตอนก่อนแก้ไข
  let newPos = formatted.length, alnumSeen = 0;
  for (let i = 0; i < formatted.length; i++) {
    if (alnumSeen >= alnumBeforeCursor) { newPos = i; break; }
    if (/[a-zA-Z0-9]/.test(formatted[i])) alnumSeen++;
  }
  inputEl.setSelectionRange(newPos, newPos);

  return formatted;
}

/**
 * คำนวณวันครบกำหนดชำระ (วันสิ้นสุด + 150 วัน) แบบ real-time
 * เรียกจาก onChange ของช่อง ph1-period-end
 */
function autoCalcDueDate(val) {
  const dueDateEl = document.getElementById('ph1-due-date');
  if (!dueDateEl) return;
  const parts = (val || '').trim().split('/');
  if (parts.length !== 3 || parts[2].length < 4) { dueDateEl.value = ''; return; }
  try {
    const endDate = new Date(parseInt(parts[2]) - 543, parseInt(parts[1]) - 1, parseInt(parts[0]));
    if (isNaN(endDate.getTime())) { dueDateEl.value = ''; return; }
    endDate.setDate(endDate.getDate() + 150);
    const resultStr = `${String(endDate.getDate()).padStart(2,'0')}/${String(endDate.getMonth()+1).padStart(2,'0')}/${endDate.getFullYear()+543}`;
    
    if (dueDateEl._flatpickr) {
      dueDateEl._flatpickr.setDate(resultStr, true, "d/m/Y");
    } else {
      dueDateEl.value = resultStr;
    }
  } catch(e) { dueDateEl.value = ''; }
}

async function startProcess(){
  const yearEl = document.getElementById('ph1-year');
  const thaiYear = yearEl ? yearEl.value.trim() : '';

  if (!thaiYear) {
    alert('กรุณาระบุปีบัญชีก่อนเริ่มนำส่ง');
    return;
  }

  // [FIX] ตรวจสอบปีบัญชีที่กรอกอยู่ตอนนี้ซ้ำอีกครั้งก่อนเข้าฟอร์ม — เผื่อ
  // ผู้ประกอบการเปลี่ยนช่อง "รอบปีบัญชี" เป็นปีอื่นหลังโหลดหน้าครั้งแรก
  // (ปีแรกที่ auto-detect อาจถูกยื่นไปแล้ว แต่ปีที่เพิ่งพิมพ์ใหม่ยังไม่ถูกยื่น
  // ต้องให้เข้าฟอร์มของปีนั้นได้ตามปกติ — เดิมเช็คแค่ตอนโหลดหน้าครั้งเดียว)
  if (typeof autoFillFromAuth === 'function') {
    await autoFillFromAuth();
    if (appState._lockedSubmission) {
      alert('ปีบัญชีนี้ยื่นแบบไปแล้ว ไม่สามารถกรอกซ้ำได้ กรุณาเปลี่ยนปีบัญชี หรือกด "ดูใบยื่นแบบที่ยื่นไปแล้ว"');
      return;
    }
  }

  const _refFieldVal = (document.getElementById('ph1-ref')?.value || '').trim();
  const _isPlaceholderRef = !_refFieldVal || _refFieldVal === '—' || _refFieldVal.includes('กรุณากรอก');
  appState.refNo = _isPlaceholderRef ? '' : _refFieldVal;

  appState.licensee = document.getElementById('ph1-licensee').value.trim();
  appState.taxid = document.getElementById('ph1-taxid').value.trim();
  appState.year = thaiYear;
  appState.type = document.getElementById('ph1-type').value.trim();
  const _ps = (document.getElementById('ph1-period-start')?.value || '').trim();
  const _pe = (document.getElementById('ph1-period-end')?.value || '').trim();
  if (!_ps || !_pe) { alert('กรุณาระบุวันเริ่มต้นและวันสิ้นสุดรอบบัญชีให้ครบถ้วน'); return; }
  appState.period = `${_ps}-${_pe}`;
  
  // ── คำนวณวันครบกำหนดชำระอัตโนมัติ: วันสิ้นสุดรอบบัญชี + 150 วัน ──────────
  let autoComputedDue = '';
  try {
    const parts = _pe.split('/');           
    if (parts.length === 3) {
      const dd  = parseInt(parts[0], 10);
      const mm  = parseInt(parts[1], 10) - 1; 
      const yy  = parseInt(parts[2], 10) - 543; 
      const endDate = new Date(yy, mm, dd);
      endDate.setDate(endDate.getDate() + 150);
      const dueDD   = String(endDate.getDate()).padStart(2, '0');
      const dueMM   = String(endDate.getMonth() + 1).padStart(2, '0');
      const dueYYYY = endDate.getFullYear() + 543; 
      autoComputedDue = `${dueDD}/${dueMM}/${dueYYYY}`;
    }
  } catch(e) { /* fallback */ }

  const dueDateEl = document.getElementById('ph1-due-date');
  if (autoComputedDue && dueDateEl) {
    if (dueDateEl._flatpickr) {
      dueDateEl._flatpickr.setDate(autoComputedDue, true, "d/m/Y");
    } else {
      dueDateEl.value = autoComputedDue;
    }
  }
  appState.dueDate = autoComputedDue || (dueDateEl ? dueDateEl.value.trim() : '');

  const roundEl = document.getElementById('ph1-period-round');
  appState.periodRound = roundEl ? roundEl.value : '';

  document.getElementById('disp-ref').textContent =
    (document.getElementById('ph1-ref')?.value || '').trim() || '(จะออกเลขจริงตอนยืนยันนำส่ง)';
  document.getElementById('disp-licensee').textContent = appState.licensee;
  document.getElementById('disp-taxid').textContent = appState.taxid;
  document.getElementById('disp-year').textContent = appState.year;
  document.getElementById('disp-type').textContent = appState.type;
  document.getElementById('disp-period').textContent = appState.period;
  document.getElementById('disp-due-date').textContent = appState.dueDate;

  document.getElementById('phase1').style.display = 'none';
  document.getElementById('phase2').style.display = 'block';
  if (typeof goToStep === 'function') goToStep(1);
  
  generateRows();
}

function generateRows() {
  const count = parseInt(document.getElementById('license-count').value) || 1;
  const tbody = document.getElementById('license-table-body');
  if(!tbody) return;
  tbody.innerHTML = '';

  for (let i = 1; i <= count; i++) {
    if (!appState.rowsData[i]) {
      appState.rowsData[i] = { income: 0, deduction: 0, no: '', type: '', station: '', startDate: '', endDate: '', hasIncome: 'yes', noIncomeReason: '', licenseStatus: 'active', customItems: [], savedInputs: {} };
    }
    const rowData = appState.rowsData[i];
    const row = document.createElement('tr');
    const statusMap = { active:'ปกติ', cancelled:'ยกเลิก', revoked:'เพิกถอน', ended:'สิ้นสุด' };
    const statusLabel = statusMap[rowData.licenseStatus || 'active'] || (rowData.licenseStatus || 'ปกติ');
    row.innerHTML = `
      <td style="text-align:center;">${i}</td>
      <td style="text-align:center;font-size:12.5px;font-family:'Sarabun';letter-spacing:0.4px;">${rowData.no || '—'}</td>
      <td style="text-align:center;font-size:12.5px;">${rowData.type || '—'}</td>
      <td style="text-align:center;"><input type="text" class="form-input" value="${rowData.station}" oninput="updateRowText(${i}, 'station', this.value)" placeholder="ช่องรายการ" style="width:100%;font-family:'Sarabun';text-align:center;"></td>
      <td style="font-size:12.5px;">${rowData.startDate || '—'}</td>
      <td style="font-size:12.5px;">${rowData.endDate || '—'}</td>
      <td style="font-size:12px;">${statusLabel}</td>
      <td style="text-align:center;"><button type="button" class="btn btn-primary btn-sm" onclick="openIncomeModal(${i})" title="กรอกรายได้" style="padding:4px 8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
      </button></td>
      <td id="row-income-display-${i}" style="text-align:center;color:${rowData.income > 0 ? '#2C3D8F' : '#bbb'}; font-weight:${rowData.income > 0 ? '600' : 'normal'};">
        ${rowData.income > 0 ? fmt(rowData.income) + ' บาท' : '—'}
      </td>
    `;
    tbody.appendChild(row);
  }

  if (typeof flatpickr === 'function') {
    flatpickr(".table-datepicker", {
      locale: "th",
      dateFormat: "d/m/Y",
      onReady: function(selectedDates, dateStr, instance) {
        if (!selectedDates || selectedDates.length === 0) {
          const now = new Date();
          const todayBuddhist = new Date(now.getFullYear() + 543, now.getMonth(), now.getDate());
          instance.jumpToDate(todayBuddhist, false); // false = ไม่ select วันที่ ไม่ trigger onChange
        }
      }
    });
  }

  sumAllLicensesIncome();
}

function updateLicenseStatus(idx, value) {
  if (!appState.rowsData[idx]) return;
  appState.rowsData[idx].licenseStatus = value;
}

function generateDeductRows() {
  const count = parseInt(document.getElementById('license-count').value) || 1;
  const tbody = document.getElementById('deduct-table-body');
  if(!tbody) return;
  tbody.innerHTML = '';

  for (let i = 1; i <= count; i++) {
    const rowData = appState.rowsData[i] || { income: 0, deduction: 0, no: '', type: '', station: '' };
    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="text-align:center;">${i}</td>
      <td style="text-align:center;"><span style="font-weight:600;color:#2C3D8F;">${rowData.no || '—'}</span></td>
      <td style="text-align:center;">${rowData.type || '—'}</td>
      <td style="text-align:center;">${rowData.station || '—'}</td>
      <td style="text-align:center;">${fmt(rowData.income)} บาท</td>
      <td style="text-align:center;"><button type="button" class="btn btn-primary btn-sm" onclick="openDeductModal(${i})" title="กรอกค่าลดหย่อน" style="padding:4px 8px;">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="2" width="16" height="20" rx="2"/><line x1="8" y1="10" x2="16" y2="10"/><line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="12" y2="18"/></svg>
      </button></td>
      <td id="deduct-display-${i}" style="text-align:center;font-weight:600;color:#c62828;">${rowData.deduction > 0 ? fmt(rowData.deduction) + ' บาท' : '—'}</td>
    `;
    tbody.appendChild(row);
  }
}

function updateRowText(idx, field, value) {
  if (!appState.rowsData[idx]) {
    appState.rowsData[idx] = { income: 0, deduction: 0, no: '', type: '', station: '', hasIncome: 'yes', noIncomeReason: '', customItems: [], savedInputs: {} };
  }
  appState.rowsData[idx][field] = value;
}

function sumAllLicensesIncome() {
  let total = 0;
  const count = parseInt(document.getElementById('license-count').value) || 1;
  for (let i = 1; i <= count; i++) {
    if (appState.rowsData[i]) total += appState.rowsData[i].income;
  }
  const inputLic = document.getElementById('total-income-license');
  if (inputLic) inputLic.value = fmt(total);
  validateFinancialVsLicense();
}

function validateFinancialVsLicense() {
  const banner = document.getElementById('step1-mismatch-banner');
  if (banner) banner.style.display = 'none';
}

function handleNextStep1() {
  if (typeof goToStep === 'function') goToStep(2);
}

async function genRefNo(thaiYear) {
  const yearShort = String(thaiYear || '').slice(-2) || String(new Date().getFullYear() + 543).slice(-2);
  const yearInt = parseInt(thaiYear) || 0;

  if (!window.dbClient) {
    return `BK${yearShort}00001`; 
  }

  try {
    const { data, error } = await window.dbClient.rpc('next_ref_no', { p_fiscal_year: yearInt });
    if (error) throw error;
    if (data) return data;
    throw new Error('next_ref_no ไม่คืนค่า');
  } catch (e) {
    console.error('[genRefNo Error]', e);
    const rand = String(Math.floor(10000 + Math.random() * 90000));
    return `BK${yearShort}F${rand.slice(-4)}`;
  }
}

function autoDetectPeriodType() {
  const typeEl  = document.getElementById('ph1-type');
  const startEl = document.getElementById('ph1-period-start');
  const endEl   = document.getElementById('ph1-period-end');
  const roundEl = document.getElementById('ph1-period-round');
  const roundNote = document.getElementById('ph1-period-round-note');
  if (!typeEl || !startEl || !endEl || !roundEl) return;

  const typeVal  = typeEl.value;
  const startVal = startEl.value.trim();
  const endVal   = endEl.value.trim();

  if (typeVal !== 'ปกติ') {
    roundEl.disabled = false;
    roundEl.style.background = '#fff';
    roundEl.style.color      = '#333';
    roundEl.style.cursor     = 'pointer';
    if (roundEl.value === 'รอบปกติ' || roundEl.value === 'รอบอื่น') {
    } else {
      roundEl.value = '';
    }
    if (roundNote) roundNote.textContent = 'กรุณาเลือกรอบบัญชี';
    return;
  }

  if (!startVal || !endVal) { roundEl.value = ''; return; }
  const [sd, sm] = startVal.split('/').map(Number);
  const [ed, em] = endVal.split('/').map(Number);

  if (sd === 1 && sm === 1 && ed === 31 && em === 12) {
    roundEl.value = 'รอบปกติ';
    if (roundNote) roundNote.textContent = 'กำหนดอัตโนมัติจากวันที่';
  } else {
    roundEl.value = 'รอบอื่น';
    if (roundNote) roundNote.textContent = 'กำหนดอัตโนมัติจากวันที่';
  }
  roundEl.disabled = true;
  roundEl.style.background = '#f5f5f5';
  roundEl.style.color      = '#555';
  roundEl.style.cursor     = 'not-allowed';
}