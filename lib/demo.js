// One-click demo data for a fresh workspace. Runs against whichever backend is
// active (Supabase in production, in-memory locally) via the store. Idempotent:
// it no-ops if the workspace already has customers, so it can't double-seed.
import { store } from './store.js';

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const DAY = 86_400_000;
const HOUR = 3_600_000;

export async function seedDemoInto(orgId, byEmail = 'demo@dispatch') {
  const existing = await store.list('customers', orgId, {}, { limit: 1 });
  if (existing.length) return { seeded: false, reason: 'Workspace already has customers.' };

  const owner = byEmail;
  const created = { customers: 0, sites: 0, assets: 0, work_orders: 0, work_order_lines: 0, invoices: 0, invoice_lines: 0, items: 0, service_offers: 0, projects: 0, jobs: 0, time_entries: 0, item_usage: 0, shifts: 0, timesheet_requests: 0, punch_items: 0 };
  const ins = async (coll, data) => { const row = await store.insert(coll, orgId, data); created[coll]++; return row; };

  // --- Service offers & parts (only if the workspace has none) ---
  const offers = await store.list('service_offers', orgId, {}, { limit: 1 });
  let svc = offers[0];
  if (!svc) {
    svc = await ins('service_offers', { name: 'Standard Service Call', description: 'On-site diagnostic + labor', unit: 'hour', default_rate: 125, active: true });
    await ins('service_offers', { name: 'Emergency / After-hours', description: 'Priority response', unit: 'hour', default_rate: 185, active: true });
  }

  const itemsExisting = await store.list('items', orgId, {}, { limit: 1 });
  let parts = itemsExisting;
  if (!itemsExisting.length) {
    parts = [
      await ins('items', { name: 'Nitrile Gloves (box)', sku: 'GLV-100', unit: 'box', unit_cost: 12.5 }),
      await ins('items', { name: 'Compressor Filter', sku: 'FLT-22', unit: 'each', unit_cost: 34.0 }),
      await ins('items', { name: 'Dental Chair Water Line', sku: 'WL-08', unit: 'each', unit_cost: 58.75 }),
      await ins('items', { name: 'Sterilizer Door Gasket', sku: 'GSK-14', unit: 'each', unit_cost: 41.2 }),
    ];
  }
  const partBySku = Object.fromEntries(parts.map((p) => [p.sku, p]));

  // --- Customer 1: Riverside (two sites, PO required) ---
  const riverside = await ins('customers', { name: 'Riverside Dental Partners', billing_email: 'ap@riverside-dental.example', phone: '(555) 210-4488', billing_address: '900 Riverside Blvd, Suite 200', payment_terms: 'net_30', po_required: true, status: 'active', notes: 'Multi-location group; PO required on all work.', created_by: owner });
  const rNorth = await ins('sites', { customer_id: riverside.id, name: 'Riverside — North Clinic', address: '1200 Oak Ave', access_notes: 'Enter through rear; key code 4471. Open 7a–5p.', contact_name: 'Priya Shah', contact_phone: '(555) 210-4490', status: 'active', created_by: owner });
  const rEast = await ins('sites', { customer_id: riverside.id, name: 'Riverside — East Clinic', address: '52 Commerce Way', access_notes: 'Front desk will buzz you in.', contact_name: 'Marco Ruiz', contact_phone: '(555) 210-4491', status: 'active', created_by: owner });
  const chair = await ins('assets', { customer_id: riverside.id, site_id: rNorth.id, name: 'Operatory Chair #3', category: 'dental_chair', manufacturer: 'A-dec', model: '511', serial: 'ADC-511-88213', install_date: '2023-04-10', warranty_expires: '2027-04-10', status: 'needs_service', notes: 'Water line intermittently leaks.', created_by: owner });
  const compressor = await ins('assets', { customer_id: riverside.id, site_id: rNorth.id, name: 'Air Compressor (mechanical rm)', category: 'compressor', manufacturer: 'Midmark', model: 'PowerAir P32', serial: 'MID-P32-4471', install_date: '2022-11-01', warranty_expires: '2025-11-01', status: 'active', created_by: owner });

  // --- Customer 2: Cedar (one site) ---
  const cedar = await ins('customers', { name: 'Cedar Family Dentistry', billing_email: 'billing@cedarfamily.example', phone: '(555) 774-1902', billing_address: '410 Cedar St', payment_terms: 'due_on_receipt', po_required: false, status: 'active', notes: 'Single location; pays on receipt.', created_by: owner });
  const cMain = await ins('sites', { customer_id: cedar.id, name: 'Cedar — Main Office', address: '410 Cedar St', access_notes: 'Ask for the office manager, Dana.', contact_name: 'Dana Whitfield', contact_phone: '(555) 774-1903', status: 'active', created_by: owner });
  const sterilizer = await ins('assets', { customer_id: cedar.id, site_id: cMain.id, name: 'Autoclave Sterilizer', category: 'sterilizer', manufacturer: 'Tuttnauer', model: 'EZ10', serial: 'TTN-EZ10-2231', install_date: '2021-06-15', warranty_expires: '2024-06-15', status: 'active', notes: 'Out of warranty.', created_by: owner });

  // --- Work orders across statuses / priorities / SLA states ---
  const wo = async (n, data, lines = []) => {
    const row = await ins('work_orders', { number: `WO-${String(n).padStart(4, '0')}`, created_by: owner, ...data });
    for (const l of lines) await ins('work_order_lines', { work_order_id: row.id, item_id: null, ...l });
    return row;
  };

  await wo(1, { customer_id: riverside.id, site_id: rNorth.id, asset_id: chair.id, title: 'Chair #3 water line leaking', description: 'Water pooling under operatory chair #3. Suspect cracked supply line.', priority: 'high', status: 'scheduled', assignee_email: 'dispatch@familydental.example', requested_by: 'Priya Shah', sla_due: iso(2 * DAY), scheduled_start: iso(1 * DAY), scheduled_end: iso(1 * DAY + 2 * HOUR) },
    [
      { kind: 'labor', description: 'Diagnostic + supply-line replacement', quantity: 2, unit_cost: 0, unit_price: 125 },
      { kind: 'part', description: 'Dental Chair Water Line (WL-08)', quantity: 1, unit_cost: 58.75, unit_price: 89, item_id: partBySku['WL-08']?.id || null },
    ]);

  await wo(2, { customer_id: riverside.id, site_id: rNorth.id, asset_id: compressor.id, title: 'Compressor filter overdue for replacement', description: 'Quarterly PM — replace intake filter, check pressure.', priority: 'medium', status: 'requested', assignee_email: null, requested_by: 'Marco Ruiz', sla_due: iso(5 * DAY) },
    [{ kind: 'labor', description: 'Preventive maintenance visit', quantity: 1, unit_cost: 0, unit_price: 125 }, { kind: 'part', description: 'Compressor Filter (FLT-22)', quantity: 1, unit_cost: 34, unit_price: 55, item_id: partBySku['FLT-22']?.id || null }]);

  // Overdue: SLA in the past, still open.
  await wo(3, { customer_id: riverside.id, site_id: rEast.id, asset_id: null, title: 'Op 2 cabinet door misaligned', description: 'Cabinet door won’t latch after remodel.', priority: 'low', status: 'en_route', assignee_email: 'dispatch@familydental.example', requested_by: 'Front desk', sla_due: iso(-1 * DAY) });

  // Urgent, overdue.
  await wo(4, { customer_id: cedar.id, site_id: cMain.id, asset_id: sterilizer.id, title: 'Autoclave not reaching temperature', description: 'Sterilizer aborts cycle; no sterilization possible — clinic partially down.', priority: 'urgent', status: 'on_site', assignee_email: 'dispatch@familydental.example', requested_by: 'Dana Whitfield', sla_due: iso(-3 * HOUR), scheduled_start: iso(-2 * HOUR), scheduled_end: iso(1 * HOUR) },
    [{ kind: 'labor', description: 'Emergency diagnostic', quantity: 1.5, unit_cost: 0, unit_price: 185 }, { kind: 'part', description: 'Sterilizer Door Gasket (GSK-14)', quantity: 1, unit_cost: 41.2, unit_price: 68, item_id: partBySku['GSK-14']?.id || null }]);

  // Completed + invoiced (paid).
  const w5 = await wo(5, { customer_id: cedar.id, site_id: cMain.id, asset_id: null, title: 'Annual op inspection', description: 'Routine annual inspection of all operatories.', priority: 'low', status: 'invoiced', assignee_email: 'dispatch@familydental.example', requested_by: 'Dana Whitfield', sla_due: iso(-10 * DAY), completed_at: iso(-9 * DAY), resolution_notes: 'All operatories pass. Recommended replacing chair #1 upholstery next cycle.', signature_name: 'Dana Whitfield' },
    [{ kind: 'labor', description: 'Inspection (4 operatories)', quantity: 3, unit_cost: 0, unit_price: 125 }]);

  // --- Invoices: one paid, one outstanding (drives dashboard A/R) ---
  const r2 = (n) => Math.round(n * 100) / 100;
  const invoice = async (num, data, lines) => {
    const subtotal = r2(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0));
    const tax = r2(subtotal * (data.tax_rate || 0) / 100);
    const total = r2(subtotal + tax);
    const inv = await ins('invoices', { number: `INV-${String(num).padStart(4, '0')}`, subtotal, tax_amount: tax, total, created_by: owner, ...data });
    for (const l of lines) await ins('invoice_lines', { invoice_id: inv.id, description: l.description, quantity: l.quantity, unit_price: l.unit_price, amount: r2(l.quantity * l.unit_price) });
    return inv;
  };
  await invoice(1, { customer_id: cedar.id, work_order_id: w5.id, status: 'paid', tax_rate: 0, issue_date: iso(-9 * DAY).slice(0, 10), due_date: iso(-9 * DAY).slice(0, 10), amount_paid: 375 },
    [{ description: 'Annual inspection (4 operatories)', quantity: 3, unit_price: 125 }]);
  await invoice(2, { customer_id: riverside.id, work_order_id: null, status: 'sent', tax_rate: 8.25, issue_date: iso(-6 * DAY).slice(0, 10), due_date: iso(24 * DAY).slice(0, 10), amount_paid: 0, notes: 'PO #RS-4471 on file.' },
    [{ description: 'Emergency service — after hours', quantity: 1.5, unit_price: 185 }, { description: 'Sterilizer door gasket', quantity: 1, unit_price: 68 }]);

  // --- More filler so the whole app looks lived-in ---
  const tech = 'dispatch@familydental.example';
  const w6 = await wo(6, { customer_id: riverside.id, site_id: rEast.id, asset_id: null, title: 'Replace waiting-room thermostat', description: 'Old thermostat unreliable.', priority: 'low', status: 'completed', assignee_email: tech, requested_by: 'Front desk', sla_due: iso(-2 * DAY), completed_at: iso(-2 * DAY), resolution_notes: 'Installed programmable thermostat; verified heating + cooling.', approved_at: iso(-1 * DAY), approved_by: owner },
    [{ kind: 'labor', description: 'Thermostat replacement', quantity: 1, unit_cost: 0, unit_price: 125 }, { kind: 'part', description: 'Programmable thermostat', quantity: 1, unit_cost: 42, unit_price: 79 }]);
  await wo(7, { customer_id: cedar.id, site_id: cMain.id, asset_id: sterilizer.id, title: 'Quarterly sterilizer PM', description: 'Scheduled preventive maintenance.', priority: 'medium', status: 'en_route', assignee_email: tech, requested_by: 'Dana Whitfield', sla_due: iso(6 * HOUR), scheduled_start: iso(2 * HOUR), scheduled_end: iso(4 * HOUR) },
    [{ kind: 'labor', description: 'PM visit', quantity: 1, unit_cost: 0, unit_price: 125 }]);

  // Time entries (completed job) + a full shift + a pending punch-fix request.
  await ins('time_entries', { work_order_id: w6.id, user_email: tech, clock_in: iso(-2 * DAY - 3 * HOUR), clock_out: iso(-2 * DAY - 1 * HOUR) });
  await ins('shifts', { user_email: tech, clock_in: iso(-1 * DAY - 8 * HOUR), clock_out: iso(-1 * DAY) });
  await ins('timesheet_requests', { user_email: tech, target_date: iso(-3 * DAY).slice(0, 10), requested_clock_in: iso(-3 * DAY - 8 * HOUR), requested_clock_out: iso(-3 * DAY - 1 * HOUR), reason: 'Forgot to clock in at the North Clinic job.', status: 'pending' });

  // A project + a scheduled job so the rest of the app has content too.
  const proj = await ins('projects', { name: 'North Clinic Buildout', client_name: 'Riverside — North', location: '1200 Oak Ave', status: 'active', budget: 85000, start_date: iso(-30 * DAY).slice(0, 10), due_date: iso(40 * DAY).slice(0, 10), description: 'New operatory buildout and equipment install.', created_by: owner });
  const job = await ins('jobs', { project_id: proj.id, service_offer_id: svc?.id || null, title: 'Install operatory chair #4', location: '1200 Oak Ave', status: 'scheduled', scheduled_start: iso(3 * DAY), scheduled_end: iso(3 * DAY + 4 * HOUR), assignee_email: tech, dispatcher_email: owner, notes: 'Bring lift kit.' });

  // Punch list + material usage so those areas aren't empty.
  const punch = [
    { title: 'Chair #3 water line leaking', status: 'open', priority: 'high', assignee_email: tech },
    { title: 'Replace compressor filter', status: 'in_progress', priority: 'medium', assignee_email: tech },
    { title: 'Cabinet door misaligned — op 2', status: 'done', priority: 'low' },
  ];
  for (const p of punch) await ins('punch_items', { project_id: proj.id, description: '', photo_url: null, created_by: owner, completed_at: p.status === 'done' ? iso(0) : null, ...p });
  if (partBySku['FLT-22']) await ins('item_usage', { item_id: partBySku['FLT-22'].id, project_id: proj.id, job_id: job.id, quantity: 2, unit_cost_at_use: 34, used_at: iso(0), recorded_by: tech, notes: '' });
  if (partBySku['GLV-100']) await ins('item_usage', { item_id: partBySku['GLV-100'].id, project_id: proj.id, job_id: job.id, quantity: 4, unit_cost_at_use: 12.5, used_at: iso(0), recorded_by: tech, notes: '' });

  return { seeded: true, created };
}
