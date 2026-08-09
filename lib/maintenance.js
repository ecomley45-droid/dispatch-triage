// Recurring / preventive maintenance: turn due plans into work orders and
// advance each plan's next-due date. Called on demand (a manager clicks
// "Generate due now") and daily by a cron across all orgs.
import { store } from './store.js';

const today = () => new Date().toISOString().slice(0, 10);

// Advance a YYYY-MM-DD date by the plan's frequency.
function advance(iso, frequency) {
  const d = new Date(iso + 'T00:00:00');
  if (frequency === 'weekly') d.setDate(d.getDate() + 7);
  else d.setMonth(d.getMonth() + ({ monthly: 1, quarterly: 3, semiannual: 6, annual: 12 }[frequency] || 3));
  return d.toISOString().slice(0, 10);
}

// Generate work orders for every active plan whose next_due is today or earlier.
export async function generateDue(orgId, byEmail = 'maintenance') {
  const t = today();
  const plans = await store.list('maintenance_plans', orgId);
  const due = plans.filter((p) => p.active !== false && p.next_due && p.next_due <= t);
  if (!due.length) return { created: 0, ids: [] };

  const existing = await store.list('work_orders', orgId);
  let counter = existing.length;
  const ids = [];
  for (const p of due) {
    counter += 1;
    const wo = await store.insert('work_orders', orgId, {
      number: `WO-${String(counter).padStart(4, '0')}`,
      customer_id: p.customer_id || null, site_id: p.site_id || null, asset_id: p.asset_id || null,
      title: p.title, description: p.description || 'Scheduled preventive maintenance.',
      priority: p.priority || 'medium', status: 'requested',
      assignee_email: p.assignee_email || null,
      sla_due: new Date(p.next_due + 'T00:00:00').toISOString(),
      requested_by: 'Maintenance plan', created_by: byEmail,
    });
    ids.push(wo.id);
    await store.update('maintenance_plans', orgId, p.id, { next_due: advance(p.next_due, p.frequency), last_generated: t });
  }
  return { created: ids.length, ids };
}
