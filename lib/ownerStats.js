// Pure analytics for the owner dashboard. Takes already-loaded rows and returns
// the metrics the owner watches. No I/O here so it's easy to unit-test; the
// server loads the data and calls this.

const OPEN_WO = new Set(['requested', 'scheduled', 'en_route', 'on_site']);
const round2 = (n) => Math.round(n * 100) / 100;
const monthKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function computeOverview({ invoices = [], workOrders = [], lines = [], timeEntries = [], customers = [], plans = [], now = Date.now() }) {
  const today = new Date(now).toISOString().slice(0, 10);
  const nowD = new Date(now);
  const thisMonth = monthKey(nowD);
  const live = invoices.filter((i) => i.status !== 'void');

  // --- Money ---
  const collected = round2(live.reduce((s, i) => s + Number(i.amount_paid || 0), 0));
  const issued = live.filter((i) => i.status === 'sent' || i.status === 'paid');
  const invoiced = round2(issued.reduce((s, i) => s + Number(i.total || 0), 0));
  const sent = live.filter((i) => i.status === 'sent');
  const outstandingAR = round2(sent.reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)), 0));
  const overdueAR = round2(sent.filter((i) => i.due_date && i.due_date < today).reduce((s, i) => s + Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0)), 0));
  // issue_date is a date-only string; compare its YYYY-MM directly (parsing as a
  // Date would apply a UTC→local shift and misfile first-of-month invoices).
  const ymOf = (s) => String(s).slice(0, 7);
  const invoicedThisMonth = round2(issued.filter((i) => i.issue_date && ymOf(i.issue_date) === thisMonth).reduce((s, i) => s + Number(i.total || 0), 0));

  // --- Invoiced by month (last 6 months) ---
  const buckets = [];
  for (let k = 5; k >= 0; k--) {
    const d = new Date(nowD.getFullYear(), nowD.getMonth() - k, 1);
    buckets.push({ key: monthKey(d), label: MONTH[d.getMonth()], total: 0 });
  }
  const bucketByKey = Object.fromEntries(buckets.map((b) => [b.key, b]));
  for (const i of issued) {
    if (!i.issue_date) continue;
    const b = bucketByKey[ymOf(i.issue_date)];
    if (b) b.total = round2(b.total + Number(i.total || 0));
  }

  // --- Work orders ---
  const open = workOrders.filter((w) => OPEN_WO.has(w.status));
  const woOpen = open.length;
  const woOverdue = open.filter((w) => w.sla_due && new Date(w.sla_due).getTime() < now).length;
  const woCompletedThisMonth = workOrders.filter((w) => w.completed_at && monthKey(new Date(w.completed_at)) === thisMonth).length;
  const woTotal = workOrders.length;
  const awaitingApproval = workOrders.filter((w) => w.status === 'completed' && !w.approved_at).length;

  // --- Profitability (from work-order line items) ---
  const billable = round2(lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_price || 0), 0));
  const cost = round2(lines.reduce((s, l) => s + Number(l.quantity || 0) * Number(l.unit_cost || 0), 0));
  const margin = round2(billable - cost);
  const marginPct = billable > 0 ? Math.round((margin / billable) * 100) : 0;

  // --- Top customers by invoiced revenue ---
  const nameById = Object.fromEntries(customers.map((c) => [c.id, c.name]));
  const byCust = {};
  for (const i of issued) { const k = i.customer_id || 'none'; byCust[k] = round2((byCust[k] || 0) + Number(i.total || 0)); }
  const topCustomers = Object.entries(byCust)
    .map(([id, total]) => ({ name: nameById[id] || 'Unassigned', total }))
    .sort((a, b) => b.total - a.total).slice(0, 5);

  // --- Technician leaderboard (hours + completed jobs) ---
  const techs = {};
  for (const t of timeEntries) {
    if (!t.user_email) continue;
    const end = t.clock_out ? new Date(t.clock_out).getTime() : now;
    const hrs = Math.max(0, end - new Date(t.clock_in).getTime()) / 3600000;
    (techs[t.user_email] ||= { email: t.user_email, hours: 0, jobs: 0 }).hours += hrs;
  }
  for (const w of workOrders) {
    if (w.assignee_email && (w.status === 'completed' || w.status === 'invoiced')) {
      (techs[w.assignee_email] ||= { email: w.assignee_email, hours: 0, jobs: 0 }).jobs += 1;
    }
  }
  const leaderboard = Object.values(techs).map((t) => ({ ...t, hours: round2(t.hours) })).sort((a, b) => b.hours - a.hours).slice(0, 6);

  // --- Forward look ---
  const in30 = new Date(now + 30 * 86400000).toISOString().slice(0, 10);
  const upcomingMaintenance = plans.filter((p) => p.active !== false && p.next_due && p.next_due <= in30).length;

  return {
    money: { collected, invoiced, outstandingAR, overdueAR, invoicedThisMonth, billable, cost, margin, marginPct },
    ops: { woOpen, woOverdue, woCompletedThisMonth, woTotal, awaitingApproval, customers: customers.length, upcomingMaintenance },
    monthly: buckets,
    topCustomers,
    leaderboard,
  };
}
