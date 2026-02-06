const DEFAULT_PIT_BRACKETS = [
  { upTo: 2000000, rate: 0.0 },
  { upTo: 5000000, rate: 0.05 },
  { upTo: 10000000, rate: 0.1 },
  { upTo: 20000000, rate: 0.15 },
  { upTo: 30000000, rate: 0.2 },
  { upTo: null, rate: 0.25 }
];

const DEFAULT_CONFIG = {
  overtimeRate: 2500,
  ssbEmployeeRate: 0.02,
  ssbEmployerRate: 0.03,
  ssbCap: 300000,
  taxFreeAllowance: 0,
  pitBrackets: DEFAULT_PIT_BRACKETS
};

const STATUS = {
  DRAFT: 'draft',
  SUBMITTED: 'submitted',
  APPROVED: 'approved',
  LOCKED: 'locked'
};

const roundCurrency = (value) => Math.round(value);

const sumValues = (values = {}) =>
  Object.values(values).reduce((total, entry) => total + (entry || 0), 0);

const calculatePIT = (taxableIncome, brackets = DEFAULT_PIT_BRACKETS) => {
  if (!taxableIncome || taxableIncome <= 0) {
    return 0;
  }

  const sorted = [...brackets].sort((a, b) => {
    if (a.upTo === null) return 1;
    if (b.upTo === null) return -1;
    return a.upTo - b.upTo;
  });

  let remaining = taxableIncome;
  let previousLimit = 0;
  let tax = 0;

  for (const bracket of sorted) {
    const upper = bracket.upTo ?? Infinity;
    const bracketWidth = upper - previousLimit;
    const taxableAtRate = Math.min(remaining, bracketWidth);
    if (taxableAtRate > 0) {
      tax += taxableAtRate * bracket.rate;
      remaining -= taxableAtRate;
    }
    if (remaining <= 0) {
      break;
    }
    previousLimit = upper;
  }

  return roundCurrency(tax);
};

const calculatePayroll = ({
  employee,
  period,
  attendance,
  overtime,
  allowances,
  deductions,
  config = {}
}) => {
  const settings = { ...DEFAULT_CONFIG, ...config };
  const workingDays = period?.workingDays ?? 26;
  const baseSalary = employee?.baseSalary ?? 0;
  const dailyRate = baseSalary / workingDays;
  const presentDays = attendance?.presentDays ?? workingDays;
  const basePay = dailyRate * presentDays;
  const overtimePay = (overtime?.hours ?? 0) * settings.overtimeRate;
  const allowanceTotal = sumValues(allowances);
  const grossPay = basePay + overtimePay + allowanceTotal;
  const ssbBase = Math.min(grossPay, settings.ssbCap);
  const ssbEmployee = employee?.ssbEligible === false ? 0 : ssbBase * settings.ssbEmployeeRate;
  const ssbEmployer = employee?.ssbEligible === false ? 0 : ssbBase * settings.ssbEmployerRate;
  const deductionTotal = sumValues(deductions);
  const taxableIncome = grossPay - ssbEmployee - settings.taxFreeAllowance;
  const pit = employee?.pitEligible === false ? 0 : calculatePIT(taxableIncome, settings.pitBrackets);
  const totalDeductions = ssbEmployee + pit + deductionTotal;
  const netPay = grossPay - totalDeductions;

  return {
    employeeId: employee?.id,
    employeeName: employee?.name,
    department: employee?.department,
    periodId: period?.id,
    earnings: {
      basePay: roundCurrency(basePay),
      overtimePay: roundCurrency(overtimePay),
      allowances: roundCurrency(allowanceTotal)
    },
    deductions: {
      ssbEmployee: roundCurrency(ssbEmployee),
      pit: roundCurrency(pit),
      other: roundCurrency(deductionTotal)
    },
    employerContrib: {
      ssbEmployer: roundCurrency(ssbEmployer)
    },
    totals: {
      grossPay: roundCurrency(grossPay),
      netPay: roundCurrency(netPay),
      totalDeductions: roundCurrency(totalDeductions)
    },
    metadata: {
      workingDays,
      presentDays,
      overtimeHours: overtime?.hours ?? 0
    }
  };
};

class PayrollRun {
  constructor({ id, periodId, entries = [] }) {
    this.id = id;
    this.periodId = periodId;
    this.entries = entries;
    this.status = STATUS.DRAFT;
    this.approvedBy = null;
    this.lockedAt = null;
    this.submittedAt = null;
  }

  submit({ submittedAt = new Date().toISOString() } = {}) {
    if (this.status !== STATUS.DRAFT) {
      throw new Error('Only draft runs can be submitted.');
    }
    this.status = STATUS.SUBMITTED;
    this.submittedAt = submittedAt;
  }

  approve({ approver, approvedAt = new Date().toISOString() } = {}) {
    if (this.status !== STATUS.SUBMITTED) {
      throw new Error('Only submitted runs can be approved.');
    }
    if (!approver) {
      throw new Error('Approver is required.');
    }
    this.status = STATUS.APPROVED;
    this.approvedBy = approver;
    this.approvedAt = approvedAt;
  }

  lock({ lockedAt = new Date().toISOString() } = {}) {
    if (this.status !== STATUS.APPROVED) {
      throw new Error('Only approved runs can be locked.');
    }
    this.status = STATUS.LOCKED;
    this.lockedAt = lockedAt;
  }
}

const generateSSBReport = (entries) => {
  const lines = entries.map((entry) => ({
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    department: entry.department,
    ssbEmployee: entry.deductions.ssbEmployee,
    ssbEmployer: entry.employerContrib.ssbEmployer,
    totalSSB: entry.deductions.ssbEmployee + entry.employerContrib.ssbEmployer
  }));

  const totals = lines.reduce(
    (acc, line) => {
      acc.ssbEmployee += line.ssbEmployee;
      acc.ssbEmployer += line.ssbEmployer;
      acc.totalSSB += line.totalSSB;
      return acc;
    },
    { ssbEmployee: 0, ssbEmployer: 0, totalSSB: 0 }
  );

  return { lines, totals };
};

const generatePITReport = (entries) => {
  const lines = entries.map((entry) => ({
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    department: entry.department,
    pit: entry.deductions.pit,
    taxableIncome: entry.totals.grossPay - entry.deductions.ssbEmployee
  }));

  const totals = lines.reduce(
    (acc, line) => {
      acc.totalPIT += line.pit;
      acc.totalTaxableIncome += line.taxableIncome;
      return acc;
    },
    { totalPIT: 0, totalTaxableIncome: 0 }
  );

  return { lines, totals };
};

const generatePayslip = (entry, period) => ({
  employeeId: entry.employeeId,
  employeeName: entry.employeeName,
  department: entry.department,
  periodId: period?.id ?? entry.periodId,
  periodLabel: period?.label ?? period?.name,
  earnings: entry.earnings,
  deductions: entry.deductions,
  employerContrib: entry.employerContrib,
  totals: entry.totals,
  metadata: entry.metadata
});

const toCSV = (rows, headers) => {
  const escaped = (value) => {
    if (value === null || value === undefined) return '';
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
      return `"${str.replace(/"/g, '""')}"`;
    }
    return str;
  };

  const headerLine = headers.join(',');
  const lines = rows.map((row) =>
    headers.map((header) => escaped(row[header])).join(',')
  );
  return [headerLine, ...lines].join('\n');
};

const generateExportPack = (run) => {
  const json = JSON.stringify(run, null, 2);
  const headers = [
    'employeeId',
    'employeeName',
    'department',
    'grossPay',
    'netPay',
    'ssbEmployee',
    'ssbEmployer',
    'pit'
  ];
  const rows = run.entries.map((entry) => ({
    employeeId: entry.employeeId,
    employeeName: entry.employeeName,
    department: entry.department,
    grossPay: entry.totals.grossPay,
    netPay: entry.totals.netPay,
    ssbEmployee: entry.deductions.ssbEmployee,
    ssbEmployer: entry.employerContrib.ssbEmployer,
    pit: entry.deductions.pit
  }));

  return {
    json,
    csv: toCSV(rows, headers),
    metadata: {
      runId: run.id,
      periodId: run.periodId,
      totalEmployees: run.entries.length
    }
  };
};

module.exports = {
  DEFAULT_CONFIG,
  DEFAULT_PIT_BRACKETS,
  STATUS,
  calculatePIT,
  calculatePayroll,
  PayrollRun,
  generateSSBReport,
  generatePITReport,
  generatePayslip,
  generateExportPack,
  toCSV
};
