const test = require('node:test');
const assert = require('node:assert/strict');

const {
  Employee,
  PayrollRun,
  STATUS
} = require('../src/payrollEngine');

test('Employee model integrates with payroll calculation', () => {
  const employee = new Employee({
    id: 'EMP-10',
    name: 'Thiri',
    nrc: '12/YGN(N)123456',
    position: 'Accountant',
    salary: 260000,
    allowances: { meal: 20000 },
    deductions: { loan: 10000 },
    ssbEligible: true
  });

  const run = new PayrollRun({
    id: 'RUN-10',
    period: { id: '2026-04', workingDays: 26 },
    employees: [employee]
  });

  const [entry] = run.calculateEntries({
    attendanceByEmployee: { 'EMP-10': { presentDays: 26 } }
  });

  assert.equal(entry.employeeId, 'EMP-10');
  assert.equal(entry.totals.grossPay, 280000);
  assert.equal(entry.deductions.ssbEmployee, 5600);
  assert.equal(entry.totals.netPay, 264400);
});

test('PayrollRun approval flow prevents recalculation when locked', () => {
  const employee = new Employee({
    id: 'EMP-11',
    name: 'Mya',
    salary: 300000
  });

  const run = new PayrollRun({
    id: 'RUN-11',
    period: { id: '2026-05', workingDays: 26 },
    employees: [employee]
  });

  run.calculateEntries();
  run.submit();
  run.approve({ approver: 'Finance Lead' });
  run.lock();

  assert.equal(run.status, STATUS.LOCKED);
  assert.throws(() => run.calculateEntries(), /Locked payroll runs/);
});
