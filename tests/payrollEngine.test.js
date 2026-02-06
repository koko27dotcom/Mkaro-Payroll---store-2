const test = require('node:test');
const assert = require('node:assert/strict');

const {
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
} = require('../src/payrollEngine');

test('calculatePIT applies progressive brackets', () => {
  const tax = calculatePIT(12000000, DEFAULT_PIT_BRACKETS);
  assert.equal(tax, 950000);
});

test('calculatePIT returns zero for non-taxable income', () => {
  assert.equal(calculatePIT(0, DEFAULT_PIT_BRACKETS), 0);
  assert.equal(calculatePIT(-500, DEFAULT_PIT_BRACKETS), 0);
});

test('calculatePayroll computes earnings and deductions', () => {
  const employee = {
    id: 'EMP-01',
    name: 'Aye Aye',
    department: 'Finance',
    baseSalary: 260000,
    ssbEligible: true,
    pitEligible: true
  };
  const period = { id: '2026-01', workingDays: 26 };
  const attendance = { presentDays: 24 };
  const overtime = { hours: 10 };
  const allowances = { meal: 20000, transport: 15000 };
  const deductions = { loan: 10000 };

  const calc = calculatePayroll({
    employee,
    period,
    attendance,
    overtime,
    allowances,
    deductions
  });

  assert.equal(calc.earnings.basePay, 240000);
  assert.equal(calc.earnings.overtimePay, 25000);
  assert.equal(calc.earnings.allowances, 35000);
  assert.equal(calc.deductions.ssbEmployee, 6000);
  assert.equal(calc.deductions.pit, 0);
  assert.equal(calc.totals.grossPay, 300000);
  assert.equal(calc.totals.netPay, 284000);
});

test('calculatePayroll respects SSB and PIT exemptions', () => {
  const employee = {
    id: 'EMP-02',
    name: 'Ko Ko',
    department: 'Operations',
    baseSalary: 500000,
    ssbEligible: false,
    pitEligible: false
  };

  const calc = calculatePayroll({
    employee,
    period: { id: '2026-01', workingDays: 25 },
    attendance: { presentDays: 25 },
    overtime: { hours: 0 },
    allowances: {},
    deductions: {}
  });

  assert.equal(calc.deductions.ssbEmployee, 0);
  assert.equal(calc.deductions.pit, 0);
  assert.equal(calc.employerContrib.ssbEmployer, 0);
});

test('PayrollRun enforces approval workflow', () => {
  const run = new PayrollRun({ id: 'RUN-01', periodId: '2026-01' });

  assert.equal(run.status, STATUS.DRAFT);
  assert.throws(() => run.approve({ approver: 'HR' }), /submitted/);

  run.submit({ submittedAt: '2026-01-15T00:00:00Z' });
  assert.equal(run.status, STATUS.SUBMITTED);

  assert.throws(() => run.lock(), /approved/);
  assert.throws(() => run.approve(), /Approver/);

  run.approve({ approver: 'HR Lead', approvedAt: '2026-01-16T00:00:00Z' });
  assert.equal(run.status, STATUS.APPROVED);

  run.lock({ lockedAt: '2026-01-17T00:00:00Z' });
  assert.equal(run.status, STATUS.LOCKED);
});

test('generate reports and payslip', () => {
  const entry = calculatePayroll({
    employee: {
      id: 'EMP-03',
      name: 'Hnin Hnin',
      department: 'Sales',
      baseSalary: 400000
    },
    period: { id: '2026-02', workingDays: 20 },
    attendance: { presentDays: 20 },
    overtime: { hours: 5 },
    allowances: { performance: 50000 },
    deductions: { advance: 20000 }
  });

  const entries = [entry];
  const ssbReport = generateSSBReport(entries);
  const pitReport = generatePITReport(entries);

  assert.equal(ssbReport.lines.length, 1);
  assert.equal(ssbReport.totals.totalSSB, 15000);
  assert.equal(pitReport.lines[0].pit, entry.deductions.pit);

  const payslip = generatePayslip(entry, { id: '2026-02', label: 'February 2026' });
  assert.equal(payslip.periodLabel, 'February 2026');
  assert.equal(payslip.totals.netPay, entry.totals.netPay);
});

test('export pack includes json and csv', () => {
  const entry = calculatePayroll({
    employee: { id: 'EMP-04', name: 'Su Su', department: 'HR', baseSalary: 200000 },
    period: { id: '2026-03', workingDays: 22 },
    attendance: { presentDays: 22 },
    overtime: { hours: 0 },
    allowances: {},
    deductions: {}
  });

  const run = new PayrollRun({ id: 'RUN-02', periodId: '2026-03', entries: [entry] });
  const pack = generateExportPack(run);

  assert.match(pack.json, /"RUN-02"/);
  assert.match(pack.csv.split('\n')[0], /employeeId/);
  assert.equal(pack.metadata.totalEmployees, 1);
});

test('toCSV escapes commas and quotes', () => {
  const csv = toCSV(
    [{ name: 'Aye, "A"' }],
    ['name']
  );
  assert.equal(csv.split('\n')[1], '"Aye, ""A"""');
});

test('DEFAULT_CONFIG exposes expected rates', () => {
  assert.equal(DEFAULT_CONFIG.overtimeRate, 2500);
  assert.equal(DEFAULT_CONFIG.ssbEmployeeRate, 0.02);
});
