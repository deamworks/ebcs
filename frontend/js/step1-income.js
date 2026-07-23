/**
 * ไฟล์: js/step1-income.js หน้าที่: จัดการ Step 1 — ตารางใบอนุญาตและ Modal กรอกรายได้ (ชส.02)
 * Depends on: state.js (appState, fmt, pv), ui.js (showToast, goToStep)
 */

/* ตัวแปร Modal*/

/** index ของ row ที่กำลังแก้ไขใน Modal */
let activeModalRowIdx = 1;

/* SECTION A: ตารางใบอนุญาต (Step 1)*/

/**
 * สร้าง/อัปเดตแถวในตารางใบอนุญาต (Step 1)
 * เรียกทุกครั้งที่จำนวนใบอนุญาตเปลี่ยน
 */


/** อัปเดตสถานะใบอนุญาตลงใน appState */
function updateLicenseStatus(idx, value) {
  if (!appState.rowsData[idx]) {
    appState.rowsData[idx] = {
      income: 0, deduction: 0, no: '', type: '', station: '',
      hasIncome: 'yes', noIncomeReason: '', customItems: [], savedInputs: {},
      licenseStatus: 'active'
    };
  }
  appState.rowsData[idx].licenseStatus = value;
}

/** อัปเดตฟิลด์ข้อความของใบอนุญาตใน appState */
function updateRowText(idx, field, value) {
  if (!appState.rowsData[idx]) {
    appState.rowsData[idx] = {
      income: 0, deduction: 0, no: '', type: '', station: '',
      hasIncome: 'yes', noIncomeReason: '', customItems: [], savedInputs: {},
      licenseStatus: 'active'
    };
  }
  appState.rowsData[idx][field] = value;
}

/** รวมรายได้จากทุกใบอนุญาตแล้วแสดงผล */
function sumAllLicensesIncome() {
  let total = 0;
  const count = parseInt(document.getElementById('license-count').value) || 1;
  for (let i = 1; i <= count; i++) {
    if (appState.rowsData[i]) total += appState.rowsData[i].income;
  }
  const inputLic = document.getElementById('total-income-license');
  if (inputLic) inputLic.value = fmt(total);

  // ปิด banner เตือน (ไม่บังคับให้ยอดเท่ากัน)
  validateFinancialVsLicense();
}

/** ซ่อน banner เตือนยอดไม่ตรงกัน (ไม่บล็อกผู้ใช้) */
function validateFinancialVsLicense() {
  const banner = document.getElementById('step1-mismatch-banner');
  if (banner) banner.style.display = 'none';
}

/** ปุ่มถัดไปของ Step 1 ไป Step 2 */
function handleNextStep1() {
  if (typeof goToStep === 'function') goToStep(2);
}

// SECTION B: Modal กรอกรายได้ (ชส.02)

/** แสดง/ซ่อนฟอร์มกรอกรายได้ตามสถานะมี/ไม่มีรายได้ */
function toggleIncomeForm(val) {
  const formWrap    = document.getElementById('incomeFormWrap');
  const noIncomeNote = document.getElementById('noIncomeNote');
  if (formWrap && noIncomeNote) {
    if (val === 'yes') {
      formWrap.style.display    = 'block';
      noIncomeNote.style.display = 'none';
    } else if (val === 'no') {
      formWrap.style.display    = 'none';
      noIncomeNote.style.display = 'block';
      document.getElementById('grandTotal').textContent = '0.00';
    } else {
      formWrap.style.display    = 'none';
      noIncomeNote.style.display = 'none';
    }
  }
}

/** คำนวณยอดรวมรายได้ทั้งหมดใน Modal */
function calcModalTotal() {
  let sum = 0;
  document.querySelectorAll('.modal-calc-input:not(.custom-item-value)')
    .forEach(input => { sum += pv(input.value); });
  document.querySelectorAll('.custom-item-value')
    .forEach(input => { sum += pv(input.value); });
  
  const gTotal = document.getElementById('grandTotal');
  if (gTotal) gTotal.textContent = fmt(sum);
  return sum;
}

/** เพิ่มแถวรายได้กำหนดเอง (ข้อ 7) ใน Modal */
function addCustomIncomeRow(label = '', value = '') {
  const container = document.getElementById('custom-income-container');
  if (!container) return;
  const rowId = 'custom_row_' + Date.now();
  const tr = document.createElement('tr');
  tr.id        = rowId;
  tr.className = 'custom-income-item-row';
  tr.innerHTML = `
    <td class="td-indent"
      style="display:flex;align-items:center;gap:8px;
             border-bottom:none;border-right:none;">
      <button type="button" class="btn btn-danger btn-sm"
        onclick="removeCustomIncomeRow('${rowId}')"
        style="padding:2px 8px;font-size:11px;border-radius:4px;">ลบ</button>
      <input type="text" class="form-input custom-item-label"
        value="${label}" placeholder="ระบุชื่อรายการ..."
        style="flex:1;padding:5px 8px;font-size:13px;
               border:1px solid #ccc;border-radius:4px;font-family:'Sarabun';">
    </td>
    <td class="td-center"
      style="border-bottom:1px solid #e0e0e0;
             border-right:1px solid #e0e0e0;border-left:1px solid #e0e0e0;">
      <input type="text"
        class="text-right-input modal-calc-input custom-item-value"
        value="${value}" placeholder="0.00"
        oninput="calcModalTotal()">
    </td>
    <td class="td-center" style="border-bottom:1px solid #e0e0e0;color:#888;">
      บาท
    </td>`;
  container.appendChild(tr);
  calcModalTotal();
}

/** ลบแถวรายได้กำหนดเองออกจาก Modal */
function removeCustomIncomeRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) { row.remove(); calcModalTotal(); }
}

/** เปิด Modal กรอกรายได้พร้อม restore ข้อมูลเดิม */
function openIncomeModal(idx) {
  activeModalRowIdx = idx;
  document.getElementById('modal-target-row-idx').textContent = idx;

  if (!appState.rowsData[idx]) {
    appState.rowsData[idx] = {
      income: 0, deduction: 0, no: '', type: '', station: '',
      hasIncome: '', noIncomeReason: '', customItems: [], savedInputs: {},
      licenseStatus: 'active'
    };
  }
  const rData = appState.rowsData[idx];

  const set = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.value = val || '';
  };
  set('m-licensee',    appState.licensee);
  set('m-license-no',  rData.no);
  set('m-license-type', rData.type);

  if (rData.startDate || rData.endDate) {
    // ใช้วันที่ของใบอนุญาตใบนี้โดยเฉพาะ (มาจากข้อมูลใบอนุญาตจริงตอนเลือกในตาราง Step 1)
    set('m-start-date', rData.startDate);
    set('m-end-date',   rData.endDate);
  } else if (appState.period && appState.period.includes('-')) {
    // fallback: ใบอนุญาตนี้ยังไม่มีวันที่ของตัวเอง ใช้ช่วงรอบบัญชีของทั้งฉบับแทน
    const [ps, pe] = appState.period.split('-');
    set('m-start-date', ps);
    set('m-end-date',   pe);
  }

  // Restore ค่า input รายได้
  document.querySelectorAll('.modal-calc-input:not(.custom-item-value)')
    .forEach(input => {
      input.value = rData.savedInputs?.[input.id] || '';
    });

  // Restore radio "มีรายได้ / ไม่มีรายได้"
  document.querySelectorAll('input[name="hasIncome"]')
    .forEach(r => r.checked = false);
  const hasIncome = rData.hasIncome || '';
  if (hasIncome === 'yes' || hasIncome === 'no') {
    const radio = document.querySelector(
      `input[name="hasIncome"][value="${hasIncome}"]`
    );
    if (radio) radio.checked = true;
    toggleIncomeForm(hasIncome);
  } else {
    toggleIncomeForm('');
  }

  // Restore คำชี้แจง
  set('noIncomeReason', rData.noIncomeReason);

  // Restore รายการกำหนดเอง (ข้อ 7)
  document.getElementById('custom-income-container').innerHTML = '';
  if (rData.customItems?.length > 0) {
    rData.customItems.forEach(item =>
      addCustomIncomeRow(item.label, item.value > 0 ? fmt(item.value) : '')
    );
  } else if (hasIncome === 'yes') {
    addCustomIncomeRow('', '');
  }

  calcModalTotal();
  document.getElementById('incomeModal').classList.add('open');
  document.body.style.overflow = 'hidden';
}

/** ปิด Modal กรอกรายได้ */
function closeIncomeModal() {
  document.getElementById('incomeModal').classList.remove('open');
  document.body.style.overflow = '';
}

/** บันทึกข้อมูลรายได้จาก Modal กลับ appState */
function saveIncomeData() {
  const checkedRadio = document.querySelector('input[name="hasIncome"]:checked');
  if (!checkedRadio) {
    alert('กรุณาเลือกรูปแบบสถานะ มี หรือ ไม่มี รายได้ประกอบกิจการก่อนทำการบันทึก');
    return;
  }
  const hasIncome = checkedRadio.value;
  let rowIncome = 0;
  let savedCustomItems = [];
  let currentInputs = {};

  appState.rowsData[activeModalRowIdx].hasIncome      = hasIncome;
  appState.rowsData[activeModalRowIdx].noIncomeReason = '';

  if (hasIncome === 'yes') {
    rowIncome = calcModalTotal();
    document.querySelectorAll('.modal-calc-input:not(.custom-item-value)')
      .forEach(input => {
        if (input.value.trim()) currentInputs[input.id] = input.value.trim();
      });
    document.querySelectorAll('.custom-income-item-row').forEach(row => {
      const label = row.querySelector('.custom-item-label').value.trim();
      const value = pv(row.querySelector('.custom-item-value').value);
      if (label || value > 0) savedCustomItems.push({ label, value });
    });
  } else {
    const reason = document.getElementById('noIncomeReason').value.trim();
    if (!reason) { alert('กรุณาระบุเหตุผลชี้แจงที่ไม่มีรายได้'); return; }
    appState.rowsData[activeModalRowIdx].noIncomeReason = reason;
  }

  appState.rowsData[activeModalRowIdx].income      = rowIncome;
  appState.rowsData[activeModalRowIdx].customItems = savedCustomItems;
  appState.rowsData[activeModalRowIdx].savedInputs = currentInputs;

  const displayTd = document.getElementById(
    `row-income-display-${activeModalRowIdx}`
  );
  if (displayTd) {
    displayTd.innerHTML = rowIncome > 0
      ? `<span style="color:#1565c0;font-weight:600;">${fmt(rowIncome)}</span>
         <span style="font-size:11px;color:#555;">บาท</span>`
      : '<span style="color:#888;font-size:11.5px;">ไม่มีรายได้</span>';
  }

  sumAllLicensesIncome();
  closeIncomeModal();
  showToast('บันทึกยอดรายได้เรียบร้อยแล้ว');
}

/*  ฟังก์ชัน sync รายได้จากใบอนุญาตไปช่องงบการเงิน */

/** ซิงค์ยอดรายได้จากใบอนุญาตไปช่องงบการเงิน */
function syncFromLicense() {
  const licEl = document.getElementById('total-income-license');
  const finEl = document.getElementById('total-income-financial');
  if (licEl && finEl) finEl.value = licEl.value;
}