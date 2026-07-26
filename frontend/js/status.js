// ════════════════════════════════════════════════════
// js/status.js — หน้าสถานะการนำส่ง
// ════════════════════════════════════════════════════

(function() {
  if (!auth.getToken()) window.location.href = '/pages/login.html';
})();

// ── helpers ──────────────────────────────────────────
function fmt(n) {
  return (parseFloat(n) || 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2, maximumFractionDigits: 2
  });
}
function isoToBE(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  return `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}/${d.getFullYear()+543}`;
}
/** "YYYY-MM-DD HH:MM:SS" → "DD/MM/YYYY HH:MM" (พ.ศ.) — แปลงจาก string โดยตรง
 *  ไม่ผ่าน Date object เพื่อไม่ให้ browser แปลง timezone ซ้ำ */
function isoToBEDateTime(v) {
  if (!v) return '—';
  const s = String(v).replace('T', ' ');
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ ](\d{2}):(\d{2})/);
  if (m) {
    const [, y, mo, d, h, mi] = m;
    return `${d}/${mo}/${Number(y) + 543} ${h}:${mi}`;
  }
  return isoToBE(s);
}
function setText(id, val) {
  const el = document.getElementById(id);
  if (el) el.textContent = val || '—';
}

// ── Status config ─────────────────────────────────────
const STATUS_CONFIG = {
  // [FIX] backend ส่งค่าจริงเป็น 'pending_payment' (ตาม ENUM ใน submissions.status)
  // ไม่ใช่ 'draft' — เพิ่ม key ให้ตรงกัน คงข้อความ/ไอคอนเดิมไว้
  pending_payment: {
    cls: 'draft', label: 'รอการชำระเงิน',
    sub: 'ยื่นแบบแล้ว กรุณาชำระเงินภายในกำหนด',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
  },
  draft: {
    cls: 'draft', label: 'รอการชำระเงิน',
    sub: 'ยื่นแบบแล้ว กรุณาชำระเงินภายในกำหนด',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>`
  },
  pending: {
    cls: 'pending', label: 'อยู่ระหว่างตรวจสอบ',
    sub: 'เจ้าหน้าที่กำลังตรวจสอบเอกสาร',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>`
  },
  paid: {
    cls: 'paid', label: 'ชำระเงินแล้ว',
    sub: 'ดำเนินการเสร็จสิ้น',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="20 6 9 17 4 12"/></svg>`
  },
  overdue: {
    cls: 'overdue', label: 'เกินกำหนดชำระ',
    sub: 'กรุณาติดต่อเจ้าหน้าที่ กสทช.',
    icon: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
  },
};

// ── Load status ───────────────────────────────────────
document.addEventListener('DOMContentLoaded', async () => {
  // แสดงชื่อผู้ใช้
  const navName = document.getElementById('nav-operator-name');
  if (navName) navName.textContent = auth.getOperatorName();

  // ดึงปีจาก query string หรือ auth
  const params = new URLSearchParams(window.location.search);
  const year   = params.get('year') || auth.getFiscalYear();

  if (!year) {
    showNotSubmitted('—');
    return;
  }

  try {
    const data = await api.get(`/operator/status?year=${year}`);

    document.getElementById('loadingState').style.display = 'none';

    if (!data || !data.submitted) {
      showNotSubmitted(year);
      return;
    }

    showSubmitted(data);

  } catch (err) {
    document.getElementById('loadingState').style.display = 'none';
    showNotSubmitted(year);
    console.error('[status]', err);
  }
});

function showNotSubmitted(year) {
  document.getElementById('loadingState').style.display = 'none';
  document.getElementById('notSubmittedState').style.display = 'block';
  setText('notSubmitYear', year ? `พ.ศ. ${year}` : '');
}

function showSubmitted(data) {
  document.getElementById('submittedState').style.display = 'block';

  // ── Status Banner ──────────────────────────────────
  const statusKey = data.status || 'draft';
  const cfg = STATUS_CONFIG[statusKey] || STATUS_CONFIG.draft;
  const banner = document.getElementById('statusBanner');
  banner.className = `status-banner ${cfg.cls}`;
  document.getElementById('statusIcon').innerHTML  = cfg.icon;
  document.getElementById('statusTitle').textContent = cfg.label;
  document.getElementById('statusSub').textContent   = cfg.sub;
  setText('statusRefNo', data.ref_no);

  // ── Info ───────────────────────────────────────────
  setText('infoName',        data.operator_name);
  setText('infoTaxId',       auth.getTaxId());
  setText('infoYear',        data.fiscal_year ? `พ.ศ. ${data.fiscal_year}` : '—');
  setText('infoPeriod',      data.period_start && data.period_end
    ? `${isoToBE(data.period_start)} — ${isoToBE(data.period_end)}` : '—');
  setText('infoDue',         isoToBE(data.due_date));
  setText('infoSubmittedAt', isoToBEDateTime(data.submitted_at || data.created_at));

  // ── Amounts ────────────────────────────────────────
  setText('amtIncome', fmt(data.total_income));
  setText('amtFund',   fmt(data.fund_amount));
  setText('amtVat',    fmt(data.vat_amount));
  setText('amtNet',    fmt(data.net_amount));

  if (data.extra_amount > 0) {
    document.getElementById('penaltyRow').style.display = 'flex';
    setText('amtPenalty', fmt(data.extra_amount));
  }

  // ── Receipt ────────────────────────────────────────
  if (data.receipt_no) {
    document.getElementById('receiptCard').style.display = 'block';
    setText('receiptNo',     data.receipt_no);
    setText('receiptDate',   isoToBE(data.received_at));
    setText('receiptAmount', data.receipt_amount ? fmt(data.receipt_amount) + ' บาท' : '—');
    setText('invoiceNo',     data.invoice_no);
  }
}