// One-click demo data for a workspace. Runs against whichever backend is active
// (Supabase in production, in-memory locally) via the store. The seed is
// comprehensive on purpose: it creates regions, teams, and demo members for
// EVERY role so an operator can "view as" the workspace and see the permission
// model in practice (region-scoped dispatchers, self-scoped technicians, etc.).
// Locations are all in the South-East US. Idempotent: no-ops if the workspace
// already has customers. A matching flush (flushDemoFrom) resets it.
import { randomUUID } from 'node:crypto';
import { store } from './store.js';

const iso = (msFromNow) => new Date(Date.now() + msFromNow).toISOString();
const DAY = 86_400_000;
const HOUR = 3_600_000;

// Demo members live under this domain so the flush can identify and remove them
// without touching real invited members.
export const DEMO_DOMAIN = 'demo.nexus';

export async function seedDemoInto(orgId, byEmail = 'demo@dispatch') {
  const existing = await store.list('customers', orgId, {}, { limit: 1 });
  if (existing.length) return { seeded: false, reason: 'Workspace already has customers. Eliminate demo data first to reseed.' };

  const owner = byEmail;
  const created = {
    regions: 0, teams: 0, members: 0, customers: 0, sites: 0, assets: 0,
    work_orders: 0, work_order_lines: 0, invoices: 0, invoice_lines: 0,
    tickets: 0, ticket_messages: 0, items: 0, service_offers: 0, projects: 0,
    jobs: 0, time_entries: 0, item_usage: 0, shifts: 0, timesheet_requests: 0,
    punch_items: 0, maintenance_plans: 0,
  };
  const ins = async (coll, data) => { const row = await store.insert(coll, orgId, data); created[coll] = (created[coll] || 0) + 1; return row; };

  // --- Regions (South-East US) + teams (a subsection of each region) ---
  const gaR = await ins('regions', { name: 'Georgia', created_by: owner });
  const scR = await ins('regions', { name: 'South Carolina', created_by: owner });
  const ncR = await ins('regions', { name: 'North Carolina', created_by: owner });
  const atlT = await ins('teams', { name: 'Atlanta Metro', region_id: gaR.id, created_by: owner });
  const savT = await ins('teams', { name: 'Savannah Coast', region_id: gaR.id, created_by: owner });
  const chsT = await ins('teams', { name: 'Charleston', region_id: scR.id, created_by: owner });
  const cltT = await ins('teams', { name: 'Charlotte Metro', region_id: ncR.id, created_by: owner });

  // --- Demo members, one per role, placed in regions/teams so scoping is visible ---
  const member = async (local, name, role, region_id = null, team_id = null) => {
    await store.addMember(orgId, { user_email: `${local}@${DEMO_DOMAIN}`, name, role, region_id, team_id });
    created.members++;
    return `${local}@${DEMO_DOMAIN}`;
  };
  await member('manager', 'Morgan Reyes', 'org_admin');                 // sees everything
  await member('accounting', 'Alex Books', 'accountant_admin');            // financials, all regions
  const dispGA = await member('dispatch.ga', 'Dana Fields', 'dispatcher', gaR.id, atlT.id);   // Georgia only
  const dispSC = await member('dispatch.sc', 'Sam Rivers', 'dispatcher', scR.id, chsT.id);    // South Carolina only
  const techATL = await member('tech.atl', 'Tariq Bell', 'technician', gaR.id, atlT.id);      // own work only
  const techSAV = await member('tech.sav', 'Nina Cole', 'technician', gaR.id, savT.id);
  const techCHS = await member('tech.chs', 'Jordan Pike', 'technician', scR.id, chsT.id);
  const techCLT = await member('tech.clt', 'Riley Vaughn', 'technician', ncR.id, cltT.id);

  // --- Service offers & parts ---
  const svc = await ins('service_offers', { name: 'Standard Service Call', description: 'On-site diagnostic + labor', unit: 'hour', default_rate: 125, active: true });
  await ins('service_offers', { name: 'Emergency / After-hours', description: 'Priority response', unit: 'hour', default_rate: 185, active: true });
  const parts = [
    await ins('items', { name: 'Nitrile Gloves (box)', sku: 'GLV-100', unit: 'box', unit_cost: 12.5 }),
    await ins('items', { name: 'Compressor Filter', sku: 'FLT-22', unit: 'each', unit_cost: 34.0 }),
    await ins('items', { name: 'Dental Chair Water Line', sku: 'WL-08', unit: 'each', unit_cost: 58.75 }),
    await ins('items', { name: 'Sterilizer Door Gasket', sku: 'GSK-14', unit: 'each', unit_cost: 41.2 }),
    await ins('items', { name: 'Vacuum Pump Filter', sku: 'VAC-09', unit: 'each', unit_cost: 27.9 }),
  ];
  const bySku = Object.fromEntries(parts.map((p) => [p.sku, p]));

  // --- Customers (SE US), each in a region, with sites + assets ---
  const cust = (data) => ins('customers', { payment_terms: 'net_30', po_required: false, status: 'active', portal_token: randomUUID(), created_by: owner, ...data });
  const site = (data) => ins('sites', { status: 'active', created_by: owner, ...data });
  const asset = (data) => ins('assets', { status: 'active', created_by: owner, ...data });

  // Georgia — Atlanta
  const peachtree = await cust({ name: 'Peachtree Dental Group', region_id: gaR.id, billing_email: 'ap@peachtreedental.example', phone: '(404) 555-0142', billing_address: '1100 Peachtree St NE, Atlanta, GA 30309', po_required: true, notes: 'Atlanta metro group; PO required on all work.' });
  const ptMidtown = await site({ customer_id: peachtree.id, name: 'Peachtree — Midtown', address: '1100 Peachtree St NE, Atlanta, GA 30309', access_notes: 'Suite 400; parking deck level 2, validate at desk.', contact_name: 'Priya Shah', contact_phone: '(404) 555-0143' });
  const ptBuckhead = await site({ customer_id: peachtree.id, name: 'Peachtree — Buckhead', address: '3344 Peachtree Rd NE, Atlanta, GA 30326', access_notes: 'Enter rear; key code 4471.', contact_name: 'Marco Ruiz', contact_phone: '(404) 555-0144' });
  const ptChair = await asset({ customer_id: peachtree.id, site_id: ptMidtown.id, name: 'Operatory Chair #3', category: 'dental_chair', manufacturer: 'A-dec', model: '511', serial: 'ADC-511-88213', install_date: '2023-04-10', warranty_expires: '2027-04-10', status: 'needs_service', notes: 'Water line intermittently leaks.' });
  const ptComp = await asset({ customer_id: peachtree.id, site_id: ptMidtown.id, name: 'Air Compressor (mech rm)', category: 'compressor', manufacturer: 'Midmark', model: 'PowerAir P32', serial: 'MID-P32-4471', install_date: '2022-11-01', warranty_expires: '2025-11-01' });

  // Georgia — Savannah
  const savannah = await cust({ name: 'Savannah Smiles Dentistry', region_id: gaR.id, billing_email: 'billing@savannahsmiles.example', phone: '(912) 555-0187', billing_address: '215 E Bay St, Savannah, GA 31401', payment_terms: 'due_on_receipt' });
  const savMain = await site({ customer_id: savannah.id, name: 'Savannah — Historic District', address: '215 E Bay St, Savannah, GA 31401', access_notes: 'Ask for office manager, Dana.', contact_name: 'Dana Whitfield', contact_phone: '(912) 555-0188' });
  const savSter = await asset({ customer_id: savannah.id, site_id: savMain.id, name: 'Autoclave Sterilizer', category: 'sterilizer', manufacturer: 'Tuttnauer', model: 'EZ10', serial: 'TTN-EZ10-2231', install_date: '2021-06-15', warranty_expires: '2024-06-15', notes: 'Out of warranty.' });

  // South Carolina — Charleston
  const lowcountry = await cust({ name: 'Lowcountry Dental Partners', region_id: scR.id, billing_email: 'ap@lowcountrydental.example', phone: '(843) 555-0199', billing_address: '46 King St, Charleston, SC 29401', po_required: true });
  const lcKing = await site({ customer_id: lowcountry.id, name: 'Lowcountry — King Street', address: '46 King St, Charleston, SC 29401', access_notes: 'Metered street parking; front desk buzzes you in.', contact_name: 'Beau Callahan', contact_phone: '(843) 555-0200' });
  const lcVac = await asset({ customer_id: lowcountry.id, site_id: lcKing.id, name: 'Vacuum Pump', category: 'vacuum', manufacturer: 'DentalEZ', model: 'Aeras 500', serial: 'DEZ-500-7781', install_date: '2022-02-20', warranty_expires: '2026-02-20', status: 'needs_service' });

  // South Carolina — Columbia
  const palmetto = await cust({ name: 'Palmetto Family Dental', region_id: scR.id, billing_email: 'billing@palmettofamily.example', phone: '(803) 555-0121', billing_address: '1601 Main St, Columbia, SC 29201' });
  const pmMain = await site({ customer_id: palmetto.id, name: 'Palmetto — Downtown', address: '1601 Main St, Columbia, SC 29201', contact_name: 'Grace Odom', contact_phone: '(803) 555-0122' });

  // North Carolina — Charlotte
  const queencity = await cust({ name: 'Queen City Dental', region_id: ncR.id, billing_email: 'ap@queencitydental.example', phone: '(704) 555-0165', billing_address: '300 S Tryon St, Charlotte, NC 28202' });
  const qcUptown = await site({ customer_id: queencity.id, name: 'Queen City — Uptown', address: '300 S Tryon St, Charlotte, NC 28202', access_notes: 'Loading dock on Church St; call ahead.', contact_name: 'Logan Reese', contact_phone: '(704) 555-0166' });
  const qcChair = await asset({ customer_id: queencity.id, site_id: qcUptown.id, name: 'Operatory Chair #1', category: 'dental_chair', manufacturer: 'A-dec', model: '500', serial: 'ADC-500-31902', install_date: '2020-09-05', warranty_expires: '2024-09-05', status: 'needs_service' });

  // --- Work orders: spread across regions/techs/statuses; region_id set so
  //     region-restricted members and technicians are correctly scoped. ---
  let n = 0;
  const wo = async (data, lines = []) => {
    n += 1;
    const region_id = data.region_id ?? null;
    const row = await ins('work_orders', { number: `WO-${String(n).padStart(4, '0')}`, created_by: owner, region_id, ...data });
    for (const l of lines) await ins('work_order_lines', { work_order_id: row.id, item_id: null, ...l });
    return row;
  };
  const labor = (desc, qty, price) => ({ kind: 'labor', description: desc, quantity: qty, unit_cost: 0, unit_price: price });
  const part = (desc, qty, cost, price, sku) => ({ kind: 'part', description: desc, quantity: qty, unit_cost: cost, unit_price: price, item_id: bySku[sku]?.id || null });

  // Georgia / Atlanta — tech.atl
  await wo({ customer_id: peachtree.id, site_id: ptMidtown.id, asset_id: ptChair.id, region_id: gaR.id, title: 'Chair #3 water line leaking', description: 'Water pooling under operatory chair #3. Suspect cracked supply line.', priority: 'high', status: 'scheduled', assignee_email: techATL, requested_by: 'Priya Shah', sla_due: iso(2 * DAY), scheduled_start: iso(1 * DAY), scheduled_end: iso(1 * DAY + 2 * HOUR) },
    [labor('Diagnostic + supply-line replacement', 2, 125), part('Dental Chair Water Line (WL-08)', 1, 58.75, 89, 'WL-08')]);
  await wo({ customer_id: peachtree.id, site_id: ptMidtown.id, asset_id: ptComp.id, region_id: gaR.id, title: 'Compressor filter overdue', description: 'Quarterly PM — replace intake filter, check pressure.', priority: 'medium', status: 'requested', assignee_email: null, requested_by: 'Marco Ruiz', sla_due: iso(5 * DAY) },
    [labor('Preventive maintenance visit', 1, 125), part('Compressor Filter (FLT-22)', 1, 34, 55, 'FLT-22')]);
  await wo({ customer_id: peachtree.id, site_id: ptBuckhead.id, region_id: gaR.id, title: 'Op 2 cabinet door misaligned', description: 'Cabinet door won’t latch after remodel.', priority: 'low', status: 'en_route', assignee_email: techATL, requested_by: 'Front desk', sla_due: iso(-1 * DAY) });

  // Georgia / Savannah — tech.sav
  const wSavInspect = await wo({ customer_id: savannah.id, site_id: savMain.id, region_id: gaR.id, title: 'Annual operatory inspection', description: 'Routine annual inspection of all operatories.', priority: 'low', status: 'invoiced', assignee_email: techSAV, requested_by: 'Dana Whitfield', sla_due: iso(-10 * DAY), completed_at: iso(-9 * DAY), resolution_notes: 'All operatories pass. Recommend replacing chair #1 upholstery next cycle.', signature_name: 'Dana Whitfield', approved_at: iso(-8 * DAY), approved_by: owner },
    [labor('Inspection (4 operatories)', 3, 125)]);
  await wo({ customer_id: savannah.id, site_id: savMain.id, asset_id: savSter.id, region_id: gaR.id, title: 'Autoclave not reaching temperature', description: 'Sterilizer aborts cycle; clinic partially down.', priority: 'urgent', status: 'on_site', assignee_email: techSAV, requested_by: 'Dana Whitfield', sla_due: iso(-3 * HOUR), scheduled_start: iso(-2 * HOUR), scheduled_end: iso(1 * HOUR) },
    [labor('Emergency diagnostic', 1.5, 185), part('Sterilizer Door Gasket (GSK-14)', 1, 41.2, 68, 'GSK-14')]);

  // South Carolina / Charleston — tech.chs
  await wo({ customer_id: lowcountry.id, site_id: lcKing.id, asset_id: lcVac.id, region_id: scR.id, title: 'Vacuum pump weak suction', description: 'Suction dropping across all chairs; replace pump filter.', priority: 'high', status: 'scheduled', assignee_email: techCHS, requested_by: 'Beau Callahan', sla_due: iso(1 * DAY), scheduled_start: iso(4 * HOUR), scheduled_end: iso(6 * HOUR) },
    [labor('Vacuum diagnostic + filter swap', 1.5, 125), part('Vacuum Pump Filter (VAC-09)', 1, 27.9, 49, 'VAC-09')]);
  const wPalmetto = await wo({ customer_id: palmetto.id, site_id: pmMain.id, region_id: scR.id, title: 'Replace waiting-room thermostat', description: 'Old thermostat unreliable.', priority: 'low', status: 'completed', assignee_email: techCHS, requested_by: 'Grace Odom', sla_due: iso(-2 * DAY), completed_at: iso(-2 * DAY), resolution_notes: 'Installed programmable thermostat; verified heating + cooling.', approved_at: iso(-1 * DAY), approved_by: owner },
    [labor('Thermostat replacement', 1, 125), part('Programmable thermostat', 1, 42, 79)]);

  // North Carolina / Charlotte — tech.clt
  await wo({ customer_id: queencity.id, site_id: qcUptown.id, asset_id: qcChair.id, region_id: ncR.id, title: 'Chair #1 upholstery tear + recline fault', description: 'Recline motor intermittent; upholstery torn on seat.', priority: 'medium', status: 'requested', assignee_email: techCLT, requested_by: 'Logan Reese', sla_due: iso(4 * DAY) },
    [labor('Diagnostic', 1, 125)]);

  // --- Invoices: one paid, one outstanding (drives dashboard A/R) ---
  const r2 = (v) => Math.round(v * 100) / 100;
  const invoice = async (num, data, lines) => {
    const subtotal = r2(lines.reduce((s, l) => s + l.quantity * l.unit_price, 0));
    const tax = r2(subtotal * (data.tax_rate || 0) / 100);
    const total = r2(subtotal + tax);
    const inv = await ins('invoices', { number: `INV-${String(num).padStart(4, '0')}`, subtotal, tax_amount: tax, total, created_by: owner, ...data });
    for (const l of lines) await ins('invoice_lines', { invoice_id: inv.id, description: l.description, quantity: l.quantity, unit_price: l.unit_price, amount: r2(l.quantity * l.unit_price) });
    return inv;
  };
  await invoice(1, { customer_id: savannah.id, work_order_id: wSavInspect.id, status: 'paid', tax_rate: 0, issue_date: iso(-9 * DAY).slice(0, 10), due_date: iso(-9 * DAY).slice(0, 10), amount_paid: 375 },
    [{ description: 'Annual inspection (4 operatories)', quantity: 3, unit_price: 125 }]);
  await invoice(2, { customer_id: peachtree.id, work_order_id: null, status: 'sent', tax_rate: 8.0, issue_date: iso(-6 * DAY).slice(0, 10), due_date: iso(24 * DAY).slice(0, 10), amount_paid: 0, notes: 'PO #PT-4471 on file.' },
    [{ description: 'Emergency service — after hours', quantity: 1.5, unit_price: 185 }, { description: 'Sterilizer door gasket', quantity: 1, unit_price: 68 }]);
  await invoice(3, { customer_id: palmetto.id, work_order_id: wPalmetto.id, status: 'sent', tax_rate: 8.0, issue_date: iso(-2 * DAY).slice(0, 10), due_date: iso(28 * DAY).slice(0, 10), amount_paid: 0 },
    [{ description: 'Thermostat replacement (labor)', quantity: 1, unit_price: 125 }, { description: 'Programmable thermostat', quantity: 1, unit_price: 79 }]);

  // --- Tickets: portal conversations so the ticketing area is populated ---
  const ticket = async (data, messages) => {
    const t = await ins('tickets', { number: `TK-${String(created.tickets + 1).padStart(4, '0')}`, status: 'open', priority: 'medium', last_message_at: iso(0), created_by: 'portal', ...data });
    for (const m of messages) await ins('ticket_messages', { ticket_id: t.id, ...m });
    return t;
  };
  await ticket({ customer_id: peachtree.id, subject: 'Can we move the chair #3 visit earlier?', priority: 'high', assignee_email: dispGA, last_message_at: iso(-2 * HOUR) },
    [
      { author_type: 'customer', author_name: 'Priya Shah', body: 'The leak is getting worse — any chance a tech can come tomorrow morning?', created_at: iso(-4 * HOUR) },
      { author_type: 'staff', author_email: dispGA, author_name: 'Dana Fields', body: 'Absolutely — we’ve moved Tariq to 9am tomorrow. You’ll get a text when he’s on the way.', created_at: iso(-2 * HOUR) },
    ]);
  await ticket({ customer_id: lowcountry.id, subject: 'Invoice question on vacuum service', priority: 'low', status: 'pending', assignee_email: dispSC, last_message_at: iso(-1 * DAY) },
    [{ author_type: 'customer', author_name: 'Beau Callahan', body: 'Is the filter covered under our service plan or billed separately?', created_at: iso(-1 * DAY) }]);

  // --- Preventive maintenance, projects, jobs, punch, usage, time, shifts ---
  await ins('maintenance_plans', { customer_id: savannah.id, site_id: savMain.id, asset_id: savSter.id, title: 'Quarterly autoclave PM', description: 'Routine sterilizer preventive maintenance.', priority: 'medium', frequency: 'quarterly', assignee_email: techSAV, next_due: iso(-1 * DAY).slice(0, 10), active: true, created_by: owner });
  await ins('maintenance_plans', { customer_id: peachtree.id, site_id: ptMidtown.id, asset_id: ptComp.id, title: 'Compressor filter service', description: 'Replace intake filter, check pressure.', priority: 'low', frequency: 'quarterly', assignee_email: null, next_due: iso(20 * DAY).slice(0, 10), active: true, created_by: owner });

  const proj = await ins('projects', { name: 'Buckhead Clinic Buildout', client_name: 'Peachtree — Buckhead', location: '3344 Peachtree Rd NE, Atlanta, GA 30326', status: 'active', budget: 85000, start_date: iso(-30 * DAY).slice(0, 10), due_date: iso(40 * DAY).slice(0, 10), description: 'New operatory buildout and equipment install.', created_by: owner });
  const job = await ins('jobs', { project_id: proj.id, service_offer_id: svc.id, title: 'Install operatory chair #4', location: '3344 Peachtree Rd NE, Atlanta, GA 30326', status: 'scheduled', scheduled_start: iso(3 * DAY), scheduled_end: iso(3 * DAY + 4 * HOUR), assignee_email: techATL, dispatcher_email: dispGA, notes: 'Bring lift kit.' });
  for (const p of [
    { title: 'Chair #3 water line leaking', status: 'open', priority: 'high', assignee_email: techATL },
    { title: 'Replace compressor filter', status: 'in_progress', priority: 'medium', assignee_email: techATL },
    { title: 'Cabinet door misaligned — op 2', status: 'done', priority: 'low' },
  ]) await ins('punch_items', { project_id: proj.id, description: '', photo_url: null, created_by: owner, completed_at: p.status === 'done' ? iso(0) : null, ...p });

  await ins('item_usage', { item_id: bySku['FLT-22'].id, project_id: proj.id, job_id: job.id, quantity: 2, unit_cost_at_use: 34, used_at: iso(0), recorded_by: techATL, notes: '' });
  await ins('item_usage', { item_id: bySku['GLV-100'].id, project_id: proj.id, job_id: job.id, quantity: 4, unit_cost_at_use: 12.5, used_at: iso(0), recorded_by: techATL, notes: '' });
  await ins('time_entries', { work_order_id: wPalmetto.id, user_email: techCHS, clock_in: iso(-2 * DAY - 3 * HOUR), clock_out: iso(-2 * DAY - 1 * HOUR) });
  await ins('shifts', { user_email: techATL, clock_in: iso(-1 * DAY - 8 * HOUR), clock_out: iso(-1 * DAY) });
  await ins('timesheet_requests', { user_email: techSAV, target_date: iso(-3 * DAY).slice(0, 10), requested_clock_in: iso(-3 * DAY - 8 * HOUR), requested_clock_out: iso(-3 * DAY - 1 * HOUR), reason: 'Forgot to clock in at the Savannah job.', status: 'pending' });

  return { seeded: true, created };
}

// Reset a workspace to a clean slate: remove all business data + demo structure
// (regions/teams) + demo members, but keep the org, real members, roles, and
// saved integration credentials. Safe to run repeatedly.
export async function flushDemoFrom(orgId) {
  // Child → parent order (cascades handle the rest); every table is org-scoped.
  const tables = [
    'ticket_messages', 'tickets', 'work_order_lines', 'work_orders',
    'invoice_lines', 'invoices', 'item_usage', 'punch_items', 'jobs', 'projects',
    'time_entries', 'shifts', 'timesheet_requests', 'maintenance_plans',
    'assets', 'sites', 'customers', 'items', 'service_offers', 'notifications',
    'teams', 'regions',
  ];
  const removed = {};
  for (const t of tables) {
    removed[t] = await store.clearCollection(t, orgId).catch(() => 0);
  }
  // Remove demo members (identified by the demo domain); leave real members.
  const members = await store.listMembers(orgId).catch(() => []);
  let members_removed = 0;
  for (const m of members) {
    if (String(m.user_email || '').toLowerCase().endsWith(`@${DEMO_DOMAIN}`)) {
      if (await store.removeMember(orgId, m.user_email).catch(() => false)) members_removed++;
    }
  }
  removed.members = members_removed;
  return { flushed: true, removed };
}
