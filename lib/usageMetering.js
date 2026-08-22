// Usage-based billing metering. Field-local by design (item 6 of the
// enterprise plan) — Core is not a target for this data; Command reads
// current figures on demand via the internal /api/internal/usage-summary
// endpoint (server.js), the same on-demand-query posture as item 5's
// security-events endpoint, not a Core table.
//
// Rollup is a monthly period ('YYYY-MM-01' as period_start). Pushing a
// Stripe usage record per rollup is stubbed (pushStripeUsage) — it needs a
// Stripe-side metered/tiered plan set up first, which doesn't exist yet;
// wire it in once that plan is created, without touching the rollup logic.
import { store } from './store.js';

const periodStart = (d = new Date()) => `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-01`;
const periodEnd = (start) => {
  const d = new Date(`${start}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
};

// Called from mutation sites that count toward a metered plan (e.g. a work
// order created via the public API). Best-effort — a metering failure must
// never block the mutation that triggered it.
export async function recordUsage(orgId, metric, qty = 1) {
  try {
    const start = periodStart();
    await store.incrementUsage(orgId, start, periodEnd(start), metric, qty);
  } catch (e) {
    console.warn('[usageMetering] recordUsage failed (non-fatal):', e?.message || e);
  }
}

// Stub — fill in once a Stripe metered/tiered plan exists for this metric.
// eslint-disable-next-line no-unused-vars
async function pushStripeUsage(_orgId, _metric, _total) {}
