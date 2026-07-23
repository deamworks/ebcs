/**
 * ไฟล์: js/step5-summary.js
 * หน้าที่: คำนวณและแสดงสรุปยอดใน Step 5 — เงินสมทบกองทุน
 * รวมถึง Phase 3 (หน้ายืนยันการชำระ) และ Phase 4
 *
 * Depends on: fund-calc.js (RATE_TABLE, calcProgressiveFund, calcPenalty, parseThaiBuddhistDate)
 *             state.js (appState, fmt, pv)
 *             step2-other.js (calcOtherTotal)
 *             ui.js (showToast)
 *             save-to-supabase.js (saveSubmissionToSupabase)
 *
 * หมายเหตุ: RATE_TABLE, calcProgressiveFund, parseThaiBuddhistDate, calcPenalty
 * ย้ายไปอยู่ใน fund-calc.js แล้ว ต้องโหลดไฟล์นั้นก่อนไฟล์นี้เสมอ
 */

/**
 * ประมวลผลและสร้างแถวข้อมูลสรุปยอดเงินสมทบใน Step 5
 */
function renderStep5AndSummary() {
  const count = parseInt(document.getElementById('license-count')?.value) || 1;
  const tbody = document.getElementById('summary-table-body');
  if (!tbody) return;
  tbody.innerHTML = '';

  let sumBizIncome = 0;
  let sumDeduction = 0;
  let sumFund      = 0;
  let sumVat       = 0;
  let sumPenalty   = 0;
  let sumNet       = 0;

  const dueDateObj = parseThaiBuddhistDate(appState.dueDate);
  const payDateObj = new Date(); 
  const isLate     = dueDateObj && payDateObj > dueDateObj;

  for (let i = 1; i <= count; i++) {
    const d    = appState.rowsData[i] || { no: '', income: 0, deduction: 0 };
    const aft  = Math.max(0, d.income - d.deduction);
    // ปัดทศนิยมเงินกองทุน (fund) เป็น 2 ตำแหน่งทันทีหลังคำนวณ
    // ก่อนจะเอาไปคิดภาษีมูลค่าเพิ่ม/เงินเพิ่มต่อ — ตรงกับวิธีคำนวณจริงของระบบ PCS
    // (ถ้าไม่ปัดตรงนี้ก่อน ตัวเลขรวมท้ายสุดจะเพี้ยนไปจากของจริงเล็กน้อย)
    const fund = Math.round(calcProgressiveFund(aft) * 100) / 100;
    const vat  = fund * 0.07;
    
    let penalty = 0;
    let months = 0;
    if (isLate) {
      const pResult = calcPenalty(fund, dueDateObj, payDateObj);
      penalty = pResult.penalty;
      months = pResult.months;
    }

    const net = Math.round((fund + vat + penalty) * 100) / 100;

    sumBizIncome += d.income;
    sumDeduction += d.deduction;
    sumFund      += fund;
    sumVat       += vat;
    sumPenalty   += penalty;
    sumNet       += net;

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td style="text-align:center;font-size:11px;color:#1565c0;font-weight:600;">${d.no || '—'}</td>
      <td style="text-align:right;">${fmt(d.income)}</td>
      <td style="text-align:right;color:#c62828;">${d.deduction > 0 ? fmt(d.deduction) : '0.00'}</td>
      <td style="text-align:right;font-weight:500;">${fmt(aft)}</td>
      <td style="text-align:right;color:#1565c0;font-weight:600;">${fmt(fund)}</td>
      <td style="text-align:right;">${fmt(vat)}</td>
      <td style="text-align:right;color:${penalty > 0 ? '#c62828' : '#444'};font-weight:${penalty > 0 ? '600' : 'normal'};">
        ${penalty > 0 ? fmt(penalty) : '0.00'}
        ${months > 0 ? `<br><small style="font-size:10px;color:#888;">(${months} เดือน)</small>` : ''}
      </td>
      <td style="text-align:right;color:#e65100;font-weight:700;background:#fff8e1;">${fmt(net)}</td>`;
    tbody.appendChild(tr);
  }

  const totalTr = document.createElement('tr');
  totalTr.style.background = '#e8eaf6';
  totalTr.style.fontWeight = '700';
  //  ยอดสุทธิรวมต้องปัดทศนิยมครั้งเดียวจาก fund+vat+เงินเพิ่ม รวมทุกใบ
  // (ไม่ใช่บวกค่า net ที่ปัดเศษแล้วของแต่ละใบ) ตามนโยบายปัดเศษใน README
  // — ป้องกันผลรวมเพี้ยนจากการสะสมเศษปัดเศษทีละใบ (rounding drift)
  const grandTotalNet = Math.round((sumFund + sumVat + sumPenalty) * 100) / 100;
  totalTr.innerHTML = `
    <td style="text-align:center;color:#1a237e;">รวมทั้งสิ้น</td>
    <td style="text-align:right;color:#1a237e;">${fmt(sumBizIncome)}</td>
    <td style="text-align:right;color:#c62828;">${fmt(sumDeduction)}</td>
    <td style="text-align:right;color:#1a237e;">${fmt(Math.max(0, sumBizIncome - sumDeduction))}</td>
    <td style="text-align:right;color:#1565c0;">${fmt(sumFund)}</td>
    <td style="text-align:right;color:#1a237e;">${fmt(sumVat)}</td>
    <td style="text-align:right;color:#c62828;">${fmt(sumPenalty)}</td>
    <td style="text-align:right;color:#e65100;font-size:13.5px;background:#ffe082;">${fmt(grandTotalNet)}</td>
  `;
  tbody.appendChild(totalTr);

  const otherTotal = typeof calcOtherTotal === 'function' ? calcOtherTotal() : 0;
  const financialInput = pv(document.getElementById('total-income-financial')?.value);

  const setVal = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.value = fmt(v);
  };
  setVal('s5-financial', financialInput || (sumBizIncome + otherTotal));
  setVal('s5-other',     otherTotal);
  setVal('s5-biz',       sumBizIncome);
  setVal('s5-net',       grandTotalNet);

  const banner = document.getElementById('penalty-alert-banner');
  if (banner) {
    if (isLate && sumPenalty > 0) {
      const pCount = calcPenalty(sumFund, dueDateObj, payDateObj);
      const days   = Math.ceil((payDateObj - dueDateObj) / (1000 * 60 * 60 * 24));
      const fmtBE  = d => d ? `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}` : '—';
      banner.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#e65100" stroke-width="2.5" style="flex-shrink:0;margin-top:2px;">
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        <span>ชำระล่าช้า — ครบกำหนด <strong>${fmtBE(dueDateObj)}</strong> ยื่นเมื่อ <strong>${fmtBE(payDateObj)}</strong> เกินมา <strong>${days} วัน (${pCount.months} เดือน)</strong> คิดเงินเพิ่ม 1.5%/เดือน รวม <strong>${fmt(sumPenalty)} บาท</strong></span>
      `;
      banner.style.display = 'flex';
      const labelEl = document.getElementById('s5-due-date-label');
      if (labelEl) labelEl.textContent = `ณ วันที่ ${payDateObj.toLocaleDateString('th-TH')}`;
    } else {
      banner.style.display = 'none';
      const labelEl = document.getElementById('s5-due-date-label');
      if (labelEl) labelEl.textContent = 'ณ วันที่ปกติ';
    }
  }
}

/**
 * ประมวลผลหน้า Phase 3 (หน้าสรุปยืนยันตรวจทานก่อนยื่นส่งจริง)
 */
function confirmFundPayment() {
  renderStep5AndSummary();

  const net = pv(document.getElementById('s5-net')?.value);

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };
  setText('p3-licensee',     appState.licensee);
  setText('p3-taxid',        appState.taxid);
  setText('p3-year',         appState.year);
  setText('p3-period',       appState.period?.replace('-', ' - ') || '');
  setText('p3-due',          appState.dueDate);
  setText('p3-total-amount', fmt(net));

  const count = parseInt(document.getElementById('license-count').value) || 1;
  let rowsHtml = '';
  for (let i = 1; i <= count; i++) {
    const d  = appState.rowsData[i] || { no: '', type: '', income: 0, hasIncome: '', licenseStatus: 'active' };
    const bg = i % 2 === 0 ? '#f5f7fb' : '#fff';
    
    let statusHtml = '';
    const currentStatus = d.licenseStatus || 'active';
    
    if (currentStatus === 'active') {
      statusHtml = '<span style="background:#e8f5e9;color:#2e7d32;border:1px solid #a5d6a7;border-radius:3px;padding:2px 7px;font-size:11px;">ปกติ</span>';
    } else if (currentStatus === 'cancelled') {
      statusHtml = '<span style="background:#ffebee;color:#c62828;border:1px solid #ef9a9a;border-radius:3px;padding:2px 7px;font-size:11px;">ยกเลิก</span>';
    } else if (currentStatus === 'revoked') {
      statusHtml = '<span style="background:#fce4ec;color:#ad1457;border:1px solid #f8bbd0;border-radius:3px;padding:2px 7px;font-size:11px;">เพิกถอน</span>';
    } else if (currentStatus === 'ended') {
      statusHtml = '<span style="background:#eceff1;color:#455a64;border:1px solid #cfd8dc;border-radius:3px;padding:2px 7px;font-size:11px;">สิ้นสุด</span>';
    }

    rowsHtml += `
      <div style="display:grid;grid-template-columns:40px 1fr 130px 120px 130px;
                  font-size:11.5px;padding:7px 10px;background:${bg};
                  border-bottom:1px solid #e8eaf0;align-items:center;">
        <div>${i}</div>
        <div style="color:#1565c0;font-weight:600;">${d.no || '—'}</div>
        <div>${d.type || '—'}</div>
        <div style="text-align:center;">${statusHtml}</div>
        <div style="text-align:right;font-weight:600;">${fmt(d.income)}</div>
      </div>`;
  }
  
  const p3Container = document.getElementById('p3-license-rows');
  if (p3Container) p3Container.innerHTML = rowsHtml;

  document.getElementById('phase2').style.display = 'none';
  document.getElementById('phase3').style.display = 'block';
  window.scrollTo(0, 0);
}

/**
 * ฟังก์ชันยิงพรีวิวข้อมูลความสำเร็จขึ้น Phase 4 หลังเซฟ Supabase สำเร็จ
 */
function handlePhase3Success() {
  if (typeof renderStep5AndSummary === 'function') renderStep5AndSummary();

  const setText = (id, val) => {
    const el = document.getElementById(id);
    if (el) el.textContent = val;
  };

  setText('p4-ref-no',     appState.refNo || '—');
  setText('p4-licensee',   appState.licensee || '—');
  setText('p4-year',       appState.year || '—');

  const netAmount = pv(document.getElementById('s5-net')?.value);
  setText('p4-net-amount', fmt(netAmount) + ' บาท');

  document.getElementById('phase3').style.display = 'none';
  document.getElementById('phase4').style.display = 'block';
  window.scrollTo(0, 0);
}

/** ปุ่ม "ปิดหน้านี้" ใน Phase 4 */
function closePhase4() {
  window.close();
  setTimeout(() => {
    showToast('กรุณาปิดแท็บนี้ด้วยตนเอง');
  }, 300);
}

/** ปุ่ม "กลับหน้าหลัก" ใน Phase 4 — รีเซ็ตฟอร์มทั้งหมด */
function goToPhase4Home() {
  appState.licensee    = '';
  appState.taxid       = '';
  appState.refNo       = '';
  appState.year        = '';
  appState.type        = '';
  appState.period      = '';
  appState.periodRound = '';
  appState.dueDate     = '';
  appState.rowsData    = {};
  appState.customOtherIncome = [];
  appState.attachedFiles     = {};

  const clearIds = ['ph1-licensee', 'ph1-taxid', 'ph1-year', 'ph1-period-start', 'ph1-period-end', 'total-income-financial', 'auditorName', 'auditorRegNo', 'auditorCompany'];
  clearIds.forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });

  const typeSel = document.getElementById('ph1-type');
  if (typeSel) typeSel.value = 'ปกติ';

  const roundSel = document.getElementById('ph1-period-round');
  if (roundSel) {
    roundSel.value = '';
    roundSel.disabled = true;
    roundSel.style.background = '#f5f5f5';
  }

  for (let i = 1; i <= 6; i++) {
    const fInput = document.getElementById(`file-${i}`);
    if (fInput) fInput.value = '';
    const fname = document.getElementById(`fname-${i}`);
    if (fname) { fname.textContent = '—'; fname.classList.remove('attached'); }
    const cBtn = document.getElementById(`clear-${i}`);
    if (cBtn) cBtn.style.display = 'none';
  }

  document.getElementById('custom-other-income-container').innerHTML = '';
  document.getElementById('total-income-license').value = '0.00';
  document.getElementById('otherGrandTotal').value = '0.00';

  if (typeof autoUpdateRefNo === 'function') {
    autoUpdateRefNo('');
  }

  document.getElementById('phase4').style.display = 'none';
  document.getElementById('phase1').style.display = 'block';
  window.scrollTo(0, 0);
}

/**
 * หน้าฟังก์ชันเมื่อต้องการยื่นแบบต่อไปหน้าบันทึก Supabase
 *
 * 🌟 [เพิ่มใหม่] เพิ่ม loading state ให้ปุ่ม "ยืนยันการนำส่งข้อมูล" ทันทีที่กด
 * เพื่อป้องกันผู้ใช้กดซ้ำหลายครั้งระหว่างที่ระบบกำลังบันทึกข้อมูลอยู่ (ซึ่งจะทำให้
 * เกิดการบันทึกข้อมูลซ้ำซ้อนหลายรายการใน Supabase ถ้าไม่กันไว้) — ปิดปุ่มและ
 * เปลี่ยนข้อความเป็น "กำลังบันทึกข้อมูล..." พร้อมไอคอนวงหมุน ตลอดช่วงที่รอผล
 * จาก saveSubmissionToSupabase() ถ้าสำเร็จจะเปลี่ยนไปหน้า Phase 4 ทันที (ไม่ต้อง
 * เปิดปุ่มกลับคืน เพราะปุ่มจะถูกซ่อนไปกับหน้านี้แล้ว) แต่ถ้าล้มเหลวจะเปิดปุ่มกลับ
 * คืนให้กดใหม่ได้ พร้อมแจ้งข้อผิดพลาดให้ผู้ใช้ทราบ
 */
function goToPhase3Next() {
  const btn = document.getElementById('btn-confirm-submit');

  // กันเหนียว: ถ้าปุ่มถูกปิดอยู่แล้ว (กำลังบันทึกข้อมูลรอบก่อนยังไม่จบ) ห้ามเริ่มซ้ำ
  if (btn && btn.disabled) return;

  const originalHtml = btn ? btn.innerHTML : '';
  if (btn) {
    btn.disabled = true;
    btn.style.opacity = '0.75';
    btn.style.cursor = 'not-allowed';
    btn.innerHTML = '<span class="btn-spinner"></span>กำลังบันทึกข้อมูล...';
  }

  if (typeof saveSubmissionToSupabase === 'function') {
    saveSubmissionToSupabase().then(res => {
      if (res && res.success) {
        handlePhase3Success(); // สำเร็จ → เปลี่ยนหน้าไป Phase 4 ไม่ต้องเปิดปุ่มคืน
      } else {
        // ล้มเหลว → เปิดปุ่มคืนให้กดใหม่ได้ พร้อมแจ้งข้อผิดพลาด
        if (btn) {
          btn.disabled = false;
          btn.style.opacity = '';
          btn.style.cursor = '';
          btn.innerHTML = originalHtml;
        }
        const msg = res?.error?.message || res?.error || 'กรุณาลองใหม่อีกครั้ง';
        alert('บันทึกข้อมูลไม่สำเร็จ: ' + msg);
      }
    }).catch(err => {
      // ดักจับ error ที่ไม่ได้ผ่าน .then ปกติ (เช่น exception ที่ไม่คาดคิด)
      if (btn) {
        btn.disabled = false;
        btn.style.opacity = '';
        btn.style.cursor = '';
        btn.innerHTML = originalHtml;
      }
      console.error('[goToPhase3Next]', err);
      alert('เกิดข้อผิดพลาดไม่คาดคิด: ' + (err?.message || err));
    });
  } else {
    handlePhase3Success();
  }
}

/** ฟังก์ชันกดย้อนกลับจากหน้า Phase 3 มาหน้า Phase 2 */
function backToPhase2() {
  document.getElementById('phase3').style.display = 'none';
  document.getElementById('phase2').style.display = 'block';
  if (typeof goToStep === 'function') goToStep(6); 
}