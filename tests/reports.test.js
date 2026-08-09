import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeReport } from '../lib/reports.js';

const base = {
  customers: [{ id: 'a', name: 'Acme' }, { id: 'b', name: 'Beta' }],
  invoices: [
    { number: 'INV-1', status: 'paid', total: 100, amount_paid: 100, issue_date: '2026-08-05', customer_id: 'a' },
    { number: 'INV-2', status: 'sent', total: 200, amount_paid: 0, issue_date: '2026-08-20', customer_id: 'b' },
    { number: 'INV-3', status: 'sent', total: 50, amount_paid: 0, issue_date: '2026-07-31', customer_id: 'a' }, // out of range
    { number: 'INV-4', status: 'void', total: 999, amount_paid: 0, issue_date: '2026-08-10', customer_id: 'a' },
  ],
  workOrders: [
    { id: 'w1', number: 'WO-1', title: 'Fix', customer_id: 'a', assignee_email: 'tech@x', completed_at: '2026-08-12T15:00:00Z' },
    { id: 'w2', number: 'WO-2', title: 'PM', customer_id: 'b', completed_at: '2026-09-02T10:00:00Z' }, // out of range
  ],
  lines: [
    { work_order_id: 'w1', quantity: 2, unit_price: 125, unit_cost: 0 },
    { work_order_id: 'w1', quantity: 1, unit_price: 90, unit_cost: 58.75 },
  ],
  timeEntries: [
    { user_email: 'tech@x', clock_in: '2026-08-12T13:00:00Z', clock_out: '2026-08-12T16:00:00Z' }, // 3h in range
    { user_email: 'tech@x', clock_in: '2026-07-01T13:00:00Z', clock_out: '2026-07-01T16:00:00Z' }, // out of range
  ],
};

test('range filters invoices and totals correctly', () => {
  const r = computeReport({ ...base, from: '2026-08-01', to: '2026-08-31' });
  assert.equal(r.invoices.length, 2);                 // INV-1, INV-2 (INV-3 out, INV-4 void)
  assert.equal(r.summary.invoiced, 300);
  assert.equal(r.summary.collected, 100);
  assert.equal(r.summary.outstanding, 200);
  assert.equal(r.byCustomer[0].name, 'Beta');         // 200 > 100
});

test('completed work + margin scoped to range', () => {
  const r = computeReport({ ...base, from: '2026-08-01', to: '2026-08-31' });
  assert.equal(r.completed.length, 1);                // only WO-1
  assert.equal(r.summary.woBillable, 340);            // 250 + 90
  assert.equal(r.summary.woMargin, 281.25);           // 340 - 58.75
});

test('labor hours scoped to range', () => {
  const r = computeReport({ ...base, from: '2026-08-01', to: '2026-08-31' });
  assert.equal(r.summary.laborHours, 3);
  assert.equal(r.byTech[0].jobs, 1);
});
