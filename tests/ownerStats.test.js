import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeOverview } from '../lib/ownerStats.js';

const now = new Date('2026-08-15T12:00:00Z').getTime();

test('money metrics: collected, outstanding, overdue, this-month', () => {
  const o = computeOverview({
    now,
    invoices: [
      { status: 'paid', total: 100, amount_paid: 100, issue_date: '2026-08-01', customer_id: 'a' },
      { status: 'sent', total: 200, amount_paid: 50, issue_date: '2026-08-10', due_date: '2026-08-05', customer_id: 'b' }, // overdue balance 150
      { status: 'sent', total: 80, amount_paid: 0, issue_date: '2026-07-01', due_date: '2026-12-01', customer_id: 'a' },  // not overdue
      { status: 'void', total: 999, amount_paid: 0, issue_date: '2026-08-01' },
    ],
    customers: [{ id: 'a', name: 'Acme' }, { id: 'b', name: 'Beta' }],
  });
  assert.equal(o.money.collected, 150);          // 100 + 50 (void excluded)
  assert.equal(o.money.outstandingAR, 230);      // 150 + 80
  assert.equal(o.money.overdueAR, 150);          // only the past-due sent invoice
  assert.equal(o.money.invoicedThisMonth, 300);  // 100 + 200 issued in Aug
  assert.equal(o.topCustomers[0].name, 'Beta');  // Beta 200 > Acme 180
});

test('profit margin from work-order lines', () => {
  const o = computeOverview({ now, lines: [
    { quantity: 2, unit_price: 125, unit_cost: 0 },
    { quantity: 1, unit_price: 100, unit_cost: 40 },
  ] });
  assert.equal(o.money.billable, 350);
  assert.equal(o.money.cost, 40);
  assert.equal(o.money.margin, 310);
});

test('ops + leaderboard counts', () => {
  const o = computeOverview({
    now,
    workOrders: [
      { status: 'on_site', sla_due: '2026-08-01T00:00:00Z' },                 // open + overdue
      { status: 'completed', completed_at: '2026-08-12', assignee_email: 'tech@x' },
      { status: 'completed', approved_at: null },                             // awaiting approval
    ],
    timeEntries: [{ user_email: 'tech@x', clock_in: '2026-08-12T08:00:00Z', clock_out: '2026-08-12T10:00:00Z' }],
  });
  assert.equal(o.ops.woOpen, 1);
  assert.equal(o.ops.woOverdue, 1);
  assert.equal(o.ops.woCompletedThisMonth, 1); // only the one with completed_at in Aug
  assert.equal(o.ops.awaitingApproval, 2);     // both completed WOs lack approved_at
  assert.equal(o.leaderboard[0].email, 'tech@x');
  assert.equal(o.leaderboard[0].hours, 2);
  assert.equal(o.leaderboard[0].jobs, 1);
});

test('monthly trend has 6 buckets ending this month', () => {
  const o = computeOverview({ now });
  assert.equal(o.monthly.length, 6);
  assert.equal(o.monthly[5].label, 'Aug');
});
