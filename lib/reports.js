// Pure date-range reporting for the owner/accountant. Given loaded rows and a
// [from, to] window (YYYY-MM-DD, inclusive), returns period summaries plus the
// row-level data the client turns into CSVs. No I/O — unit-testable.

const round2 = (n) => Math.round(n * 100) / 100;
const dateOf = (v) => (v ? String(v).slice(0, 10) : null); // date part of a date or timestamp

export function computeReport({ invoices = [], workOrders = [], lines = [], timeEntries = [], customers = [], from, to }) {
  const inRange = (v) => { const d = dateOf(v); return d && d >= from && d <= to; };
  const nameById = Object.fromEntries(customers.map((c) => [c.id, c.name]));

  // Billable/cost per work order from its line items.
  const woTotals = {};
  for (const l of lines) {
    const k = l.work_order_id; if (!k) continue;
    (woTotals[k] ||= { billable: 0, cost: 0 });
    woTotals[k].billable += Number(l.quantity || 0) * Number(l.unit_price || 0);
    woTotals[k].cost += Number(l.quantity || 0) * Number(l.unit_cost || 0);
  }

  // --- Invoices issued in range ---
  const issued = invoices.filter((i) => i.status !== 'void' && (i.status === 'sent' || i.status === 'paid') && inRange(i.issue_date));
  const invoiceRows = issued.map((i) => ({
    number: i.number, customer: nameById[i.customer_id] || 'Unassigned',
    issue_date: dateOf(i.issue_date), due_date: dateOf(i.due_date),
    total: round2(Number(i.total || 0)), amount_paid: round2(Number(i.amount_paid || 0)),
    balance: round2(Number(i.total || 0) - Number(i.amount_paid || 0)), status: i.status,
  }));
  const invoiced = round2(invoiceRows.reduce((s, r) => s + r.total, 0));
  const collected = round2(invoiceRows.reduce((s, r) => s + r.amount_paid, 0));
  const outstanding = round2(invoiceRows.reduce((s, r) => s + Math.max(0, r.balance), 0));

  // Revenue by customer (from those invoices).
  const custMap = {};
  for (const r of invoiceRows) { (custMap[r.customer] ||= { name: r.customer, invoiced: 0, collected: 0 }); custMap[r.customer].invoiced = round2(custMap[r.customer].invoiced + r.total); custMap[r.customer].collected = round2(custMap[r.customer].collected + r.amount_paid); }
  const byCustomer = Object.values(custMap).sort((a, b) => b.invoiced - a.invoiced);

  // --- Work orders completed in range ---
  const completedRows = workOrders.filter((w) => inRange(w.completed_at)).map((w) => {
    const t = woTotals[w.id] || { billable: 0, cost: 0 };
    return { number: w.number, title: w.title, customer: nameById[w.customer_id] || '—', assignee: w.assignee_email || '', completed_at: dateOf(w.completed_at), billable: round2(t.billable), cost: round2(t.cost), margin: round2(t.billable - t.cost) };
  });
  const woBillable = round2(completedRows.reduce((s, r) => s + r.billable, 0));
  const woCost = round2(completedRows.reduce((s, r) => s + r.cost, 0));

  // --- Labor by technician (time entries clocked-in during range) ---
  const techMap = {};
  for (const t of timeEntries) {
    if (!inRange(t.clock_in) || !t.user_email) continue;
    const end = t.clock_out ? new Date(t.clock_out).getTime() : new Date(t.clock_in).getTime();
    (techMap[t.user_email] ||= { email: t.user_email, hours: 0, jobs: 0 }).hours += Math.max(0, end - new Date(t.clock_in).getTime()) / 3600000;
  }
  for (const w of completedRows) if (w.assignee) (techMap[w.assignee] ||= { email: w.assignee, hours: 0, jobs: 0 }).jobs += 1;
  const byTech = Object.values(techMap).map((t) => ({ ...t, hours: round2(t.hours) })).sort((a, b) => b.hours - a.hours);
  const laborHours = round2(byTech.reduce((s, t) => s + t.hours, 0));

  return {
    range: { from, to },
    summary: { invoiced, collected, outstanding, jobsCompleted: completedRows.length, woBillable, woCost, woMargin: round2(woBillable - woCost), laborHours },
    invoices: invoiceRows,
    byCustomer,
    completed: completedRows,
    byTech,
  };
}
