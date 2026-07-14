import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entryDurationMs, msToHours, materialCost, laborForJobs, projectPnl } from '../src/lib/calc.js';

const H = 3600000;
const NOW = Date.parse('2026-07-14T12:00:00Z');

test('entryDurationMs: closed entry', () => {
  const ms = entryDurationMs({ clock_in: '2026-07-14T09:00:00Z', clock_out: '2026-07-14T11:30:00Z' });
  assert.equal(ms, 2.5 * H);
});

test('entryDurationMs: open entry counts to now', () => {
  const ms = entryDurationMs({ clock_in: '2026-07-14T11:00:00Z', clock_out: null }, NOW);
  assert.equal(ms, 1 * H);
});

test('entryDurationMs: never negative on bad data', () => {
  const ms = entryDurationMs({ clock_in: '2026-07-14T12:00:00Z', clock_out: '2026-07-14T09:00:00Z' });
  assert.equal(ms, 0);
});

test('materialCost: sums quantity * captured unit cost', () => {
  const usage = [
    { quantity: 4, unit_cost_at_use: 58.75 },
    { quantity: 2, unit_cost_at_use: 12.5 },
  ];
  assert.equal(materialCost(usage), 4 * 58.75 + 2 * 12.5); // 260
});

test('materialCost: empty is 0', () => {
  assert.equal(materialCost([]), 0);
  assert.equal(materialCost(), 0);
});

test('laborForJobs: hours * service rate per job', () => {
  const jobs = [{ id: 'j1', service_offer_id: 's1' }, { id: 'j2', service_offer_id: 's2' }];
  const times = [
    { job_id: 'j1', clock_in: '2026-07-14T09:00:00Z', clock_out: '2026-07-14T14:00:00Z' }, // 5h
    { job_id: 'j2', clock_in: '2026-07-14T09:00:00Z', clock_out: '2026-07-14T12:30:00Z' }, // 3.5h
  ];
  const rateFor = (id) => ({ s1: 125, s2: 95 }[id] || 0);
  const { hours, cost } = laborForJobs(jobs, times, rateFor, NOW);
  assert.equal(hours, 8.5);
  assert.equal(cost, 5 * 125 + 3.5 * 95); // 957.5
});

test('laborForJobs: ignores time for jobs not in the set', () => {
  const jobs = [{ id: 'j1', service_offer_id: 's1' }];
  const times = [{ job_id: 'jX', clock_in: '2026-07-14T09:00:00Z', clock_out: '2026-07-14T19:00:00Z' }];
  const { hours, cost } = laborForJobs(jobs, times, () => 100, NOW);
  assert.equal(hours, 0);
  assert.equal(cost, 0);
});

test('projectPnl: material + labor vs budget, over/under', () => {
  const p = projectPnl({
    budget: 1000,
    usage: [{ quantity: 2, unit_cost_at_use: 100 }], // 200 material
    jobs: [{ id: 'j1', service_offer_id: 's1' }],
    times: [{ job_id: 'j1', clock_in: '2026-07-14T09:00:00Z', clock_out: '2026-07-14T13:00:00Z' }], // 4h
    rateFor: () => 125, // 500 labor
    now: NOW,
  });
  assert.equal(p.material, 200);
  assert.equal(p.laborCost, 500);
  assert.equal(p.totalCost, 700);
  assert.equal(p.remaining, 300);
  assert.equal(p.overBudget, false);
});

test('projectPnl: flags over budget', () => {
  const p = projectPnl({ budget: 100, usage: [{ quantity: 3, unit_cost_at_use: 50 }], now: NOW });
  assert.equal(p.totalCost, 150);
  assert.equal(p.remaining, -50);
  assert.equal(p.overBudget, true);
});

test('msToHours', () => {
  assert.equal(msToHours(90 * 60000), 1.5);
});
