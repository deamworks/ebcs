/**
 * ไฟล์: js/step3-deduct.js
 * หน้าที่: จัดการ Step 3 — ค่าลดหย่อน (Modal ค่าลดหย่อน Analog/Digital/IPTV)
 * ต้องใช้คู่กับ: state.js (appState, fmt, pv), ui.js (showToast),
 *              fund-calc.js (DEDUCT_RATE_ANALOG, DEDUCT_CAP_DIGITAL, DEDUCT_CAP_IPTV)
 */

// ค่าคงที่

/** index ของ row ที่กำลังแก้ไขอยู่ใน Modal ค่าลดหย่อน */
let activeDeductRowIdx = 1;

/** แปลงสถานะใบอนุญาต (เก็บเป็น key ภาษาอังกฤษ) เป็นข้อความภาษาไทยสำหรับแสดงผล */
const LICENSE_STATUS_TH = {
  active:    'ปกติ',
  cancelled: 'ยกเลิก',
  revoked:   'เพิกถอน',
  ended:     'สิ้นสุด',
};

// อัตรา/เพดานค่าลดหย่อนย้ายไปอยู่ที่ js/fund-calc.js แล้ว (ใช้ร่วมกับ admin.html)

// SECTION A: ตารางค่าลดหย่อน (Step 3)

/** สร้างแถวตารางค่าลดหย่อน Step 3 */
function generateDeductRows() {
  const count = parseInt(document.getElementById('license-count').value) || 1;
  const tbody = document.getElementById('deduct-table-body');
  if (!tbody) return;

  tbody.innerHTML = '';

  for (let i = 1; i <= count; i++) {
    const rowData = appState.rowsData[i] || {
      income: 0, deduction: 0, no: '', type: '', station: '',
    };

    const row = document.createElement('tr');
    row.innerHTML = `
      <td style="text-align:center;">${i}</td>
      <td style="text-align:center;"><span style="font-weight:600;color:#2C3D8F;">${rowData.no || '—'}</span></td>
      <td style="text-align:center;">${rowData.type || '—'}</td>
      <td style="text-align:center;">${rowData.station || '—'}</td>
      <td style="text-align:center;">${fmt(rowData.income)} บาท</td>
      <td style="text-align:center;">
        <button type="button" class="btn btn-primary btn-sm"
          onclick="openDeductModal(${i})" title="กรอกค่าลดหย่อน"
          style="padding:4px 8px;">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" stroke-width="2.2"
            stroke-linecap="round" stroke-linejoin="round">
            <rect x="4" y="2" width="16" height="20" rx="2"/>
            <line x1="8" y1="10" x2="16" y2="10"/>
            <line x1="8" y1="14" x2="16" y2="14"/>
            <line x1="8" y1="18" x2="12" y2="18"/>
          </svg>
        </button>
      </td>
      <td id="deduct-display-${i}" style="text-align:center;font-weight:600;color:#c62828;">${rowData.deduction > 0 ? fmt(rowData.deduction) + ' บาท' : '—'}</td>`;

    tbody.appendChild(row);
  }
}

// SECTION B: Modal ค่าลดหย่อน

/** เปิด Modal ค่าลดหย่อนพร้อมโหลดข้อมูลเดิม */
function openDeductModal(idx) {
  activeDeductRowIdx = idx;

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  const rowData = appState.rowsData[idx] || {};

  // เติมข้อมูลทั่วไปของใบอนุญาตใน Modal
  // หมายเหตุ: สถานะใบอนุญาตต้องดึงจาก rowData.licenseStatus (สถานะของใบนี้โดยเฉพาะ)
  set('dm-licensee',       appState.licensee);
  set('dm-license-no',     rowData.no);
  set('dm-license-status', LICENSE_STATUS_TH[rowData.licenseStatus] || 'ปกติ');

  if (rowData.startDate || rowData.endDate) {
    // ใช้วันที่ของใบอนุญาตใบนี้โดยเฉพาะ (มาจากข้อมูลใบอนุญาตจริงตอนเลือกในตาราง Step 1)
    set('dm-start-date', rowData.startDate);
    set('dm-end-date',   rowData.endDate);
  } else if (appState.period?.includes('-')) {
    // fallback: ใบอนุญาตนี้ยังไม่มีวันที่ของตัวเอง ใช้ช่วงรอบบัญชีของทั้งฉบับแทน
    const [periodStart, periodEnd] = appState.period.split('-');
    set('dm-start-date', periodStart);
    set('dm-end-date',   periodEnd);
  }

  // restore ข้อมูลค่าลดหย่อน (ถ้าไม่มีให้ใช้ค่าเริ่มต้น: เลือก Analog ไว้ก่อน)
  const dDetails = rowData.deductDetails || {
    expenseType: 'rate',
    analog:  { checked: true,  members: '', price: '0.00', income: '0.00' },
    digital: { checked: false, members: '', price: '0.00', income: '0.00' },
    iptv:    { checked: false, members: '', price: '0.00', income: '0.00' },
  };

  // restore radio ประเภทค่าใช้จ่าย
  const rType = document.querySelector(
    `input[name="dm-expense-type"][value="${dDetails.expenseType}"]`
  );
  if (rType) rType.checked = true;

  // restore ข้อมูลของแต่ละช่องทาง (analog / digital / iptv)
  ['analog', 'digital', 'iptv'].forEach(ch => {
    const cb = document.getElementById(`dm-ch-${ch}`);
    if (cb) {
      cb.checked = dDetails[ch].checked;
      toggleDeductSection(ch);
    }
    set(`dm-${ch}-members`, dDetails[ch].members);
    set(`dm-${ch}-price`,   dDetails[ch].price);
    set(`dm-${ch}-income`,  dDetails[ch].income);
  });

  // ตรวจสอบยอดรายได้เทียบเพดานทันทีตามค่าที่ restore มา (เผื่อข้อมูลเดิมเกินอยู่แล้ว)
  checkChannelIncomeLimit();

  document.getElementById('deductModal')?.classList.add('open');
}

/** ปิด Modal ค่าลดหย่อน */
function closeDeductModal() {
  document.getElementById('deductModal')?.classList.remove('open');
}

/** เปิด/ปิดทั้งแถวของช่องทาง (Analog/Digital/IPTV) เมื่อติ๊ก/ยกเลิก checkbox */
function toggleDeductSection(ch) {
  const isChecked = document.getElementById(`dm-ch-${ch}`)?.checked;
  ['members', 'price', 'income'].forEach(f => {
    const el = document.getElementById(`dm-${ch}-${f}`);
    if (el) el.disabled = !isChecked;
  });
  checkChannelIncomeLimit();
}

/** คำนวณรายได้อัตโนมัติจาก สมาชิก × ราคา — ถ้ากรอกทั้งคู่จะอัปเดตช่องรายได้ให้
 *  แต่ถ้ากรอกรายได้ตรงๆ โดยไม่กรอกสมาชิก/ราคา ก็ทำได้เช่นกัน */
function liveCalcDeductIncome(ch) {
  const members = parseFloat(document.getElementById(`dm-${ch}-members`)?.value) || 0;
  const price   = parseFloat(document.getElementById(`dm-${ch}-price`)?.value)   || 0;
  const incInput = document.getElementById(`dm-${ch}-income`);
  // คำนวณอัตโนมัติเฉพาะเมื่อกรอกทั้งสมาชิกและราคา
  if (members > 0 && price > 0 && incInput) {
    incInput.value = (members * price).toFixed(2);
  }
  checkChannelIncomeLimit();
}

/** ตรวจสอบแบบ real-time ว่ายอดรายได้รวมของช่องทางที่ติ๊กเลือกไว้ (Analog+Digital+IPTV)
 *  เกินรายได้รวมของใบอนุญาตที่กำลังกรอกอยู่หรือไม่ — ถ้าเกินจะ:
 *   1. โชว์ banner แจ้งเตือน #deduct-income-warning พร้อมยอดที่เกิน
 *   2. ไฮไลต์กรอบสีแดง (.field-invalid) ที่ช่อง "รายได้" ของทุกช่องทางที่ติ๊กไว้
 *  เรียกทุกครั้งที่: พิมพ์จำนวนสมาชิก/ราคา, ติ๊ก/ยกเลิกช่องทาง, หรือเปิด Modal ใหม่
 */
function checkChannelIncomeLimit() {
  const licenseIncome = appState.rowsData[activeDeductRowIdx]?.income || 0;
  const warningEl      = document.getElementById('deduct-income-warning');
  const warningTextEl  = document.getElementById('deduct-income-warning-text');

  let totalChannelIncome = 0;
  const checkedChannels = ['analog', 'digital', 'iptv'].filter(ch => {
    const checked = document.getElementById(`dm-ch-${ch}`)?.checked;
    if (checked) totalChannelIncome += pv(document.getElementById(`dm-${ch}-income`)?.value);
    return checked;
  });

  const isOverLimit = totalChannelIncome > licenseIncome;

  ['analog', 'digital', 'iptv'].forEach(ch => {
    const incInput = document.getElementById(`dm-${ch}-income`);
    if (!incInput) return;
    const shouldHighlight = isOverLimit && checkedChannels.includes(ch);
    incInput.classList.toggle('field-invalid', shouldHighlight);
  });

  if (!warningEl || !warningTextEl) return;

  if (isOverLimit) {
    warningTextEl.textContent =
      `ยอดรายได้รวมของช่องทางที่เลือก ${fmt(totalChannelIncome)} บาท เกินรายได้ของใบอนุญาตนี้ (${fmt(licenseIncome)} บาท) กรุณาแก้ไขจำนวนสมาชิก/ราคาก่อนบันทึก`;
    warningEl.style.display = 'flex';
  } else {
    warningEl.style.display = 'none';
  }
}

/** คำนวณยอดค่าลดหย่อนตามอัตรา/เพดานของแต่ละช่องทาง */
function calcDeductAmount(state) {
  const deductAnalog  = state.analog.checked
    ? parseFloat(state.analog.income) * DEDUCT_RATE_ANALOG : 0;
  const deductDigital = state.digital.checked
    ? Math.min(DEDUCT_CAP_DIGITAL, parseFloat(state.digital.income)) : 0;
  const deductIptv    = state.iptv.checked
    ? Math.min(DEDUCT_CAP_IPTV, parseFloat(state.iptv.income)) : 0;

  return deductAnalog + deductDigital + deductIptv;
}

/** บันทึกค่าลดหย่อนจาก Modal กลับ appState และอัปเดต UI */
function saveDeductData() {
  const expenseType = document.querySelector(
    'input[name="dm-expense-type"]:checked'
  )?.value || 'rate';

  // อ่านข้อมูลทุกช่องทางจากฟอร์ม
  const state = { expenseType };
  ['analog', 'digital', 'iptv'].forEach(ch => {
    state[ch] = {
      checked: document.getElementById(`dm-ch-${ch}`)?.checked || false,
      members: document.getElementById(`dm-${ch}-members`)?.value || '',
      price:   document.getElementById(`dm-${ch}-price`)?.value  || '0.00',
      income:  document.getElementById(`dm-${ch}-income`)?.value || '0.00',
    };
  });

  // รวมค่าลดหย่อนทุกช่องทางของใบอนุญาตนี้
  const licenseIncome  = appState.rowsData[activeDeductRowIdx]?.income || 0;

  // เงื่อนไข A: รายได้รวมของทุกช่องทางที่เลือก ต้องไม่เกินรายได้ของใบอนุญาตนี้
  const totalChannelIncome = ['analog', 'digital', 'iptv']
    .reduce((sum, ch) => sum + (state[ch].checked ? pv(state[ch].income) : 0), 0);

  if (totalChannelIncome > licenseIncome) {
    showAppAlert(
      'ยอดรายได้รวมของช่องทางที่เลือก ' + fmt(totalChannelIncome) + ' บาท\nเกินรายได้ของใบอนุญาตนี้ (' + fmt(licenseIncome) + ' บาท)\nกรุณาแก้ไขจำนวนสมาชิก/ราคาก่อนบันทึก',
      { title: 'ยอดรายได้เกินขอบเขต', type: 'warning' }
    );
    return;
  }

  const requestedDeduct = calcDeductAmount(state);

  // เงื่อนไข B: ค่าลดหย่อนของใบอนุญาตนี้ (เช็คแยกรายใบ ไม่ใช่ยอดรวมทั้งฉบับ)
  if (requestedDeduct > licenseIncome) {
    showAppAlert(
      'ค่าลดหย่อน ' + fmt(requestedDeduct) + ' บาท\nเกินรายได้ของใบอนุญาตนี้ (' + fmt(licenseIncome) + ' บาท)\nกรุณาแก้ไขก่อนบันทึก',
      { title: 'ค่าลดหย่อนเกินขอบเขต', type: 'warning' }
    );
    return;
  }

  const finalDeduct = requestedDeduct;

  // บันทึกลง appState
  appState.rowsData[activeDeductRowIdx].deduction     = finalDeduct;
  appState.rowsData[activeDeductRowIdx].deductDetails = state;

  // อัปเดตยอดค่าลดหย่อนที่แสดงในตารางหลัก
  const displayTd = document.getElementById(`deduct-display-${activeDeductRowIdx}`);
  if (displayTd) {
    displayTd.innerHTML = finalDeduct > 0
      ? `<span style="color:#1565c0;font-weight:600;">${fmt(finalDeduct)}</span>
         <span style="font-size:11px;color:#555;">บาท</span>`
      : '<span style="color:#888;">—</span>';
  }

  // อัปเดตยอดรวมค่าลดหย่อนทั้งหมดของทุกใบอนุญาต
  const count = parseInt(document.getElementById('license-count').value) || 1;
  let grandSum = 0;
  for (let i = 1; i <= count; i++) {
    grandSum += appState.rowsData[i]?.deduction || 0;
  }
  const totalDeductionInput = document.getElementById('totalDeduction');
  if (totalDeductionInput) totalDeductionInput.value = fmt(grandSum);

  if (typeof saveDraft === 'function') saveDraft();
  closeDeductModal();
  showToast('บันทึกรายละเอียดค่าลดหย่อนสิทธิ์เรียบร้อยแล้ว');
}