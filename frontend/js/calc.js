// ════════════════════════════════════════════════════
// js/calc.js — Logic คำนวณเงินกองทุน
// แทน fund-calc.js เดิม + รวม state management
// ════════════════════════════════════════════════════

// ── อัตราเงินนำส่งกองทุน (ขั้นบันได 7 ขั้น) ────────
const RATE_TABLE = [
  { upTo: 100_000_000,    rate: 0.00125 },
  { upTo: 500_000_000,    rate: 0.0025  },
  { upTo: 1_000_000_000,  rate: 0.005   },
  { upTo: 10_000_000_000, rate: 0.0075  },
  { upTo: 25_000_000_000, rate: 0.01    },
  { upTo: 50_000_000_000, rate: 0.0125  },
  { upTo: Infinity,       rate: 0.02    },
];

const VAT_RATE           = 0.07;
const PENALTY_RATE       = 0.015;   // 1.5% ต่อเดือน
const DEDUCT_RATE_ANALOG = 0.60;    // อนาล็อก: หักได้ 60%
const DEDUCT_CAP_DIGITAL = 200_000; // ดิจิทัล: หักได้สูงสุด 200,000 บาท
const DEDUCT_CAP_IPTV    = 200_000; // IPTV: หักได้สูงสุด 200,000 บาท

/**
 * คำนวณเงินนำส่งกองทุน (Progressive Rate)
 * @param {number} income — รายได้หลังหักลดหย่อน
 * @returns {number} เงินนำส่งกองทุน
 */
function calcProgressiveFund(income) {
  if (!income || income <= 0) return 0;
  let fund = 0;
  let prev = 0;
  for (const tier of RATE_TABLE) {
    if (income <= prev) break;
    const taxable = Math.min(income, tier.upTo) - prev;
    fund += taxable * tier.rate;
    prev  = tier.upTo;
    if (income <= tier.upTo) break;
  }
  return Math.round(fund * 100) / 100;
}

/**
 * คำนวณเงินเพิ่ม (ค่าปรับล่าช้า)
 * @param {number} fundAmount — เงินนำส่งกองทุน
 * @param {string} dueDateStr — วันครบกำหนด DD/MM/YYYY (พ.ศ.)
 * @returns {{months:number, penalty:number}}
 */
function calcPenalty(fundAmount, dueDateStr) {
  if (!dueDateStr || !fundAmount) return { months: 0, penalty: 0 };
  const due = parseThaiBuddhistDate(dueDateStr);
  if (!due) return { months: 0, penalty: 0 };
  const now  = new Date();
  if (now <= due) return { months: 0, penalty: 0 };
  const diffMs    = now - due;
  const diffDays  = Math.ceil(diffMs / (1000 * 60 * 60 * 24));
  const months    = Math.ceil(diffDays / 30);
  const penalty   = Math.round(fundAmount * PENALTY_RATE * months * 100) / 100;
  return { months, penalty };
}

/**
 * แปลง DD/MM/YYYY (พ.ศ.) → Date object (ค.ศ.)
 */
function parseThaiBuddhistDate(str) {
  if (!str) return null;
  const parts = str.trim().split('/');
  if (parts.length !== 3) return null;
  const y = parseInt(parts[2], 10) - 543;
  const m = parseInt(parts[1], 10) - 1;
  const d = parseInt(parts[0], 10);
  return new Date(y, m, d);
}

/**
 * คำนวณสรุปทุกใบอนุญาต
 * @param {number} count — จำนวนใบอนุญาต
 * @returns {{perLicense: Array, totals: Object}}
 */
function calcAllLicenseSummary(count) {
  const dueDateStr = appState.dueDate || '';
  const perLicense = [];
  let totalIncome = 0, totalDeduct = 0, totalFund = 0;
  let totalVat = 0, totalPenalty = 0;

  for (let i = 1; i <= count; i++) {
    const d = appState.rowsData[i] || {};
    if (d.hasIncome === 'no') {
      perLicense.push({ income:0, deduct:0, netIncome:0, fund:0, vat:0, penalty:0, net:0 });
      continue;
    }
    const income    = d.income    || 0;
    const deduct    = d.deduction || 0;
    const netIncome = Math.max(0, income - deduct);
    const fund      = calcProgressiveFund(netIncome);
    const vat       = Math.round(fund * VAT_RATE * 100) / 100;
    const { penalty } = calcPenalty(fund, dueDateStr);
    const net       = Math.round((fund + vat + penalty) * 100) / 100;

    totalIncome  += income;
    totalDeduct  += deduct;
    totalFund    += fund;
    totalVat     += vat;
    totalPenalty += penalty;

    perLicense.push({ income, deduct, netIncome, fund, vat, penalty, net });
  }

  return {
    perLicense,
    totals: {
      totalIncome:  Math.round(totalIncome  * 100) / 100,
      totalDeduct:  Math.round(totalDeduct  * 100) / 100,
      totalFund:    Math.round(totalFund    * 100) / 100,
      totalVat:     Math.round(totalVat     * 100) / 100,
      totalPenalty: Math.round(totalPenalty * 100) / 100,
      totalNet:     Math.round((totalFund + totalVat + totalPenalty) * 100) / 100,
    },
  };
}

// ── Number helpers (ใช้ทั่วทั้งแอป) ─────────────────
/** แปลง string ที่มี comma → number */
function pv(str) {
  if (str === null || str === undefined || str === '') return 0;
  return parseFloat(String(str).replace(/,/g, '')) || 0;
}

/** Format number → string ที่มี comma */
function fmt(num) {
  const n = parseFloat(num) || 0;
  return n.toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ── appState กลาง ─────────────────────────────────────
const appState = {
  taxId:       '',
  taxid:       '',   // alias สำหรับ license.js เดิม
  licensee:    '',
  refNo:       '',
  year:        '',
  type:        '',
  period:      '',
  periodRound: '',
  dueDate:     '',
  rowsData:    {},          // { [rowIdx]: { income, deduction, no, type, ... } }
  customOtherIncome: [],
  attachedFiles: {},
  existingAttachments: {}, // { [docRowIdx]: attachmentId } — ไฟล์ที่แนบไว้แล้วบน server (resume draft)
};