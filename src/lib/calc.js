// Pure money-path calculations — shared by ProjectDetail, Timesheets, Dispatch,
// and JobDetail, and covered by tests/calc.test.js. Keeping these here (not
// inline in components) means the numbers a customer is billed against have
// regression tests.

// Duration of a time entry in ms. Open entries (no clock_out) count up to `now`.
export function entryDurationMs(entry, now = Date.now()) {
  const start = new Date(entry.clock_in).getTime();
  const end = entry.clock_out ? new Date(entry.clock_out).getTime() : now;
  return Math.max(0, end - start);
}

export const msToHours = (ms) => ms / 3600000;

// Total material cost = sum(quantity * unit_cost_at_use). Cost is captured at
// time of use so historical totals survive later price changes.
export function materialCost(usage = []) {
  return usage.reduce((s, u) => s + Number(u.quantity || 0) * Number(u.unit_cost_at_use || 0), 0);
}

// Labor across a set of jobs: hours from time entries, cost = hours * the job's
// service-offer rate. rateFor(serviceOfferId) -> number.
export function laborForJobs(jobs = [], times = [], rateFor = () => 0, now = Date.now()) {
  let ms = 0;
  let cost = 0;
  for (const j of jobs) {
    const jobMs = times
      .filter((t) => t.job_id === j.id)
      .reduce((s, t) => s + entryDurationMs(t, now), 0);
    ms += jobMs;
    cost += msToHours(jobMs) * Number(rateFor(j.service_offer_id) || 0);
  }
  return { ms, hours: msToHours(ms), cost };
}

// Full project P&L rollup: budget vs. material + labor.
export function projectPnl({ budget = 0, usage = [], jobs = [], times = [], rateFor = () => 0, now = Date.now() } = {}) {
  const material = materialCost(usage);
  const labor = laborForJobs(jobs, times, rateFor, now);
  const totalCost = material + labor.cost;
  const b = Number(budget || 0);
  return {
    budget: b,
    material,
    laborCost: labor.cost,
    laborHours: labor.hours,
    totalCost,
    remaining: b - totalCost,
    overBudget: totalCost > b,
  };
}
