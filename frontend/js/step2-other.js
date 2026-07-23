/**
 * ไฟล์: js/step2-other.js
 * หน้าที่: จัดการ Step 2 — รายได้อื่นที่ไม่นำมาคำนวณ (o1-o5 และรายการเพิ่มเอง)
 *
 * Depends on: state.js (pv, fmt)
 */

/** รวมยอดรายได้อื่นทั้งหมด (o1-o5 + รายการเพิ่มเอง) และแสดงผล */
function calcOtherTotal() {
  let sum = 0;

  // รายการมาตรฐาน o1-o5
  ['o1', 'o2', 'o3', 'o4', 'o5'].forEach(id => {
    const el = document.getElementById(id);
    if (el) sum += pv(el.value);
  });

  // รายการกำหนดเอง (ข้อ 6)
  document.querySelectorAll('.custom-other-value')
    .forEach(input => { sum += pv(input.value); });

  const outTotal = document.getElementById('otherGrandTotal');
  if (outTotal) outTotal.value = fmt(sum);

  return sum;
}

/** เพิ่มแถวรายได้อื่นแบบกำหนดเอง */
function addCustomOtherIncomeRow(label = '', value = '') {
  const container = document.getElementById('custom-other-income-container');
  if (!container) return;
  const rowId = 'other_row_' + Date.now();
  const tr = document.createElement('tr');
  tr.id        = rowId;
  tr.className = 'custom-other-income-item-row';
  tr.innerHTML = `
    <td class="income-label main-page-indent"
      style="text-align:left !important;padding-left:25px !important;">
      <div style="display:flex;align-items:center;gap:8px;">
        <button type="button" class="btn btn-danger btn-sm"
          onclick="removeCustomOtherIncomeRow('${rowId}')"
          style="padding:1px 6px;font-size:10px;">ลบ</button>
        <input type="text" class="form-input custom-other-label"
          value="${label}" placeholder="ระบุรายการ..."
          style="flex:1;padding:4px 6px;font-size:12px;
                 border:1px solid #ccc;border-radius:4px;">
      </div>
    </td>
    <td style="text-align:center;">
      <input type="text"
        class="income-input text-right-input custom-other-value"
        value="${value}" placeholder="0.00"
        oninput="calcOtherTotal()">
    </td>
    <td class="unit-baht"
      style="text-align:center;color:#888;">บาท</td>`;
  container.appendChild(tr);
  calcOtherTotal();
}

/** ลบแถวรายได้อื่นที่เพิ่มเอง */
function removeCustomOtherIncomeRow(rowId) {
  const row = document.getElementById(rowId);
  if (row) { row.remove(); calcOtherTotal(); }
}