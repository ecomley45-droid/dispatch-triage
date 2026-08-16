// Additive top-up seed: fills in every content type that seed-fdh-locations.mjs
// and seed-demo.mjs left thin or empty, so every page/feature has something to
// verify against — including the newest features (scheduled_shifts, per-WO
// item usage, work-order lines/tickets/invoices tied to real seeded WOs).
//
// Reads the existing live roster/customers/sites/work orders rather than
// hardcoding IDs, so it adapts to whatever's actually in the org today.
// Wipes and reinserts ONLY the tables it owns (see WIPE below) — never
// touches customers/sites/work_orders/regions/teams/org_members roster rows
// seeded by the other two scripts.
//
//   node scripts/seed-fill-gaps.mjs
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { db } from '../lib/db.js';

const ORG = 'family-dental';
const sb = db();
if (!sb) { console.error('Supabase not configured.'); process.exit(1); }

const MGR = 'ethanfcomley@gmail.com';
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const isoDate = (n) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();
const pick = (arr, i) => arr[i % arr.length];

async function insert(table, rows) {
  if (!rows.length) return [];
  const { data, error } = await sb.from(table).insert(rows.map((r) => ({ ...r, org_id: ORG }))).select();
  if (error) throw new Error(`insert ${table}: ${error.message}`);
  return data;
}

// Tables this script fully owns — wiped and reseeded each run so it's safe
// to re-run. Deliberately excludes customers/sites/work_orders/regions/teams
// /org_members, which belong to the other two seed scripts.
const WIPE = [
  'ticket_messages', 'tickets', 'invoice_lines', 'invoices', 'maintenance_plans',
  'work_order_lines', 'item_usage', 'time_entries', 'shifts', 'scheduled_shifts',
  'attachments', 'assets',
];

async function main() {
  console.log('Reading existing roster/customers/sites/work orders…');
  const { data: members } = await sb.from('org_members').select('user_email,name,role,region_id,team_id').eq('org_id', ORG);
  const { data: customers } = await sb.from('customers').select('id,name,region_id').eq('org_id', ORG);
  const { data: sites } = await sb.from('sites').select('id,customer_id,name').eq('org_id', ORG);
  const { data: workOrders } = await sb.from('work_orders').select('id,number,customer_id,site_id,status,assignee_email,region_id').eq('org_id', ORG);
  const { data: items } = await sb.from('items').select('id,name,sku,unit_cost').eq('org_id', ORG);
  if (!customers?.length || !workOrders?.length) throw new Error('No customers/work orders found — run seed-fdh-locations.mjs first.');

  const techs = members.filter((m) => m.role === 'technician');
  const dispatchers = members.filter((m) => m.role === 'dispatcher');
  const siteByCustomer = Object.fromEntries(sites.map((s) => [s.customer_id, s]));
  if (!techs.length) throw new Error('No technicians found.');

  console.log('Wiping tables this script owns…');
  for (const t of WIPE) {
    const { error } = await sb.from(t).delete().eq('org_id', ORG);
    if (error) throw new Error(`wipe ${t}: ${error.message}`);
  }

  // --- Manager admins: one region-scoped, one org-wide, so the manager
  // dashboard's region/team scoping (added this round) has real accounts to
  // log in as, not just Super Admin "view as". ---
  console.log('Manager admins…');
  const { data: upstateRegion } = await sb.from('regions').select('id,name').eq('org_id', ORG).ilike('name', '%upstate%').maybeSingle();
  const { data: upstateTeam } = await sb.from('teams').select('id').eq('org_id', ORG).eq('region_id', upstateRegion?.id).maybeSingle();
  await sb.from('org_members').upsert([
    { org_id: ORG, user_email: 'manager.upstate@demo.nexus', name: 'Priya Shah', role: 'manager_admin', region_id: upstateRegion?.id || null, team_id: upstateTeam?.id || null, joined_at: new Date().toISOString() },
    { org_id: ORG, user_email: 'manager.admin@demo.nexus', name: 'Chris Nolan', role: 'manager_admin', joined_at: new Date().toISOString() },
  ], { onConflict: 'org_id,user_email' });

  // --- Assets: 2-3 per region spread across real sites, then wire a handful
  // of existing work orders to reference one (asset_id was null on all 40). ---
  console.log('Assets…');
  const ASSET_TEMPLATES = [
    { name: 'Operatory Chair #1', category: 'dental_chair', manufacturer: 'A-dec', model: '511' },
    { name: 'Air Compressor', category: 'compressor', manufacturer: 'Midmark', model: 'PowerAir P32' },
    { name: 'Autoclave Sterilizer', category: 'sterilizer', manufacturer: 'Midmark', model: 'M11' },
    { name: 'Panoramic X-Ray Unit', category: 'imaging', manufacturer: 'Carestream', model: 'CS 8100' },
    { name: 'Vacuum Pump', category: 'vacuum', manufacturer: 'Ramvac', model: 'V6N' },
  ];
  const assetRows = [];
  customers.slice(0, 25).forEach((c, i) => {
    const site = siteByCustomer[c.id];
    const tmpl = pick(ASSET_TEMPLATES, i);
    assetRows.push({
      customer_id: c.id, site_id: site?.id || null, name: tmpl.name, category: tmpl.category,
      manufacturer: tmpl.manufacturer, model: tmpl.model, serial: `SN-${1000 + i}`,
      install_date: isoDate(-365 * (1 + (i % 4))), warranty_expires: isoDate(365 * (1 + (i % 3))),
      status: i % 11 === 0 ? 'needs_service' : 'active', created_by: MGR,
    });
  });
  const assets = await insert('assets', assetRows);
  const assetByCustomer = {};
  for (const a of assets) (assetByCustomer[a.customer_id] ||= []).push(a);
  // Attach an asset to every 4th work order whose customer has one.
  let woAssetLinks = 0;
  for (const [i, wo] of workOrders.entries()) {
    if (i % 4 !== 0) continue;
    const a = assetByCustomer[wo.customer_id]?.[0];
    if (!a) continue;
    await sb.from('work_orders').update({ asset_id: a.id }).eq('org_id', ORG).eq('id', wo.id);
    woAssetLinks++;
  }
  console.log(`  ${assets.length} assets, linked to ${woAssetLinks} work orders.`);

  // --- Work order lines + item usage: give ~12 of the 40 work orders real
  // labor + part lines, and log matching item_usage against the SAME work
  // order (exercising the new item_usage.work_order_id column end to end). ---
  console.log('Work order lines + item usage…');
  const sample = workOrders.filter((_, i) => i % 3 === 0).slice(0, 14);
  let lineCount = 0, usageCount = 0;
  for (const wo of sample) {
    const laborHours = 1 + (lineCount % 4) * 0.5;
    await insert('work_order_lines', [
      { work_order_id: wo.id, kind: 'labor', description: 'Diagnostic + repair labor', quantity: laborHours, unit_cost: 0, unit_price: 125 },
    ]);
    lineCount++;
    if (items?.length) {
      const it = pick(items, lineCount);
      await insert('work_order_lines', [
        { work_order_id: wo.id, kind: 'part', description: it.name, quantity: 1, unit_cost: Number(it.unit_cost) || 0, unit_price: (Number(it.unit_cost) || 0) * 1.4, item_id: it.id },
      ]);
      await insert('item_usage', [
        { item_id: it.id, work_order_id: wo.id, quantity: 1, unit_cost_at_use: Number(it.unit_cost) || 0, recorded_by: wo.assignee_email || techs[0].user_email, used_at: hoursAgo(lineCount * 3) },
      ]);
      lineCount++; usageCount++;
    }
  }
  console.log(`  ${lineCount} lines on ${sample.length} work orders, ${usageCount} item_usage rows tied to a work order.`);

  // --- Tickets: a spread of statuses/priorities, several tied to a real work
  // order, each with a short staff/customer message thread. ---
  console.log('Tickets…');
  const TICKET_SUBJECTS = [
    'Chair not reclining fully', 'Water tastes odd from unit', 'Compressor cycling too often',
    'X-ray sensor error code E4', 'Suction weak in op 2', 'Autoclave failed a cycle',
    'Request quote for new chair', 'Follow-up on last repair visit',
  ];
  const TICKET_STATUSES = ['open', 'open', 'pending', 'resolved', 'closed'];
  const ticketRows = customers.slice(0, TICKET_SUBJECTS.length).map((c, i) => {
    const linkedWO = workOrders.find((w) => w.customer_id === c.id);
    return {
      number: `TK-${String(i + 1).padStart(4, '0')}`, customer_id: c.id, work_order_id: linkedWO?.id || null,
      subject: TICKET_SUBJECTS[i], status: pick(TICKET_STATUSES, i), priority: pick(['low', 'medium', 'high'], i),
      assignee_email: pick(dispatchers, i)?.user_email || MGR, last_message_at: hoursAgo(i * 5), created_by: MGR,
    };
  });
  const tickets = await insert('tickets', ticketRows);
  const msgRows = [];
  tickets.forEach((t, i) => {
    msgRows.push({ ticket_id: t.id, author_type: 'customer', author_name: 'Front desk', body: `${t.subject} — can someone take a look?`, created_at: hoursAgo(i * 5 + 2) });
    if (t.status !== 'open') msgRows.push({ ticket_id: t.id, author_type: 'staff', author_email: t.assignee_email, body: 'Thanks for the report — dispatching a technician.', created_at: hoursAgo(i * 5 + 1) });
    if (t.status === 'resolved' || t.status === 'closed') msgRows.push({ ticket_id: t.id, author_type: 'staff', author_email: t.assignee_email, body: 'This has been resolved on-site.', created_at: hoursAgo(i * 5) });
  });
  await insert('ticket_messages', msgRows);
  console.log(`  ${tickets.length} tickets, ${msgRows.length} messages.`);

  // --- Maintenance plans: tied to real assets, spread across frequencies. ---
  console.log('Maintenance plans…');
  const planRows = assets.slice(0, 10).map((a, i) => ({
    customer_id: a.customer_id, site_id: a.site_id, asset_id: a.id,
    title: `${pick(['Quarterly', 'Semiannual', 'Annual'], i)} PM — ${a.name}`,
    priority: pick(['low', 'medium', 'high'], i), frequency: pick(['quarterly', 'semiannual', 'annual'], i),
    assignee_email: pick(techs, i).user_email, next_due: isoDate(7 + i * 5), active: true, created_by: MGR,
  }));
  await insert('maintenance_plans', planRows);
  console.log(`  ${planRows.length} maintenance plans.`);

  // --- Invoices: a few more, spanning draft/sent/paid, tied to completed-ish
  // work orders, each with 2 lines. ---
  console.log('Invoices…');
  const invoiceSources = workOrders.filter((w) => w.status === 'on_site' || w.status === 'en_route').slice(0, 6);
  let invNum = 100;
  for (const [i, wo] of invoiceSources.entries()) {
    const subtotal = 300 + i * 45;
    const [inv] = await insert('invoices', [{
      number: `INV-${String(invNum++).padStart(4, '0')}`, customer_id: wo.customer_id, work_order_id: wo.id,
      status: pick(['draft', 'sent', 'paid'], i), issue_date: isoDate(-i), due_date: isoDate(30 - i),
      subtotal, tax_rate: 0, tax_amount: 0, total: subtotal, amount_paid: i % 3 === 2 ? subtotal : 0, created_by: MGR,
    }]);
    await insert('invoice_lines', [
      { invoice_id: inv.id, description: 'Diagnostic + repair labor', quantity: 2, unit_price: 125, amount: 250 },
      { invoice_id: inv.id, description: 'Parts', quantity: 1, unit_price: subtotal - 250, amount: subtotal - 250 },
    ]);
  }
  console.log(`  ${invoiceSources.length} invoices.`);

  // --- Shifts: actual clock in/out punches for every technician over the
  // last few days, plus one open (still clocked in) shift. ---
  console.log('Shifts (actual clock in/out)…');
  const shiftRows = [];
  techs.forEach((t, ti) => {
    for (let d = 1; d <= 3; d++) {
      const start = new Date(Date.now() - d * 86400000); start.setHours(8, 0, 0, 0);
      const end = new Date(start.getTime() + (7.5 + (ti % 2)) * 3600000);
      shiftRows.push({ user_email: t.user_email, clock_in: start.toISOString(), clock_out: end.toISOString() });
    }
  });
  shiftRows.push({ user_email: techs[0].user_email, clock_in: hoursAgo(1.5), clock_out: null, note: 'On site now' });
  await insert('shifts', shiftRows);
  console.log(`  ${shiftRows.length} shifts across ${techs.length} technicians.`);

  // --- time_entries: job-tied and work-order-tied labor, so Timesheets shows
  // both kinds of entry. ---
  console.log('Time entries…');
  const teRows = [];
  workOrders.slice(0, 8).forEach((wo, i) => {
    const start = new Date(Date.now() - (i + 1) * 43200000);
    teRows.push({ work_order_id: wo.id, user_email: wo.assignee_email || pick(techs, i).user_email, clock_in: start.toISOString(), clock_out: new Date(start.getTime() + (1 + i % 3) * 3600000).toISOString(), notes: 'Field labor.' });
  });
  await insert('time_entries', teRows);
  console.log(`  ${teRows.length} time entries.`);

  // --- Scheduled shifts (planned roster): the newest feature — completely
  // unseeded until now. A mixed week per technician: normal shifts, one PTO
  // day, one sick day, one call-out — so every DayHoursBadge type renders. ---
  console.log('Scheduled shifts (planned roster)…');
  const schedRows = [];
  const managers = ['manager.upstate@demo.nexus', 'manager.admin@demo.nexus'];
  techs.forEach((t, ti) => {
    for (let d = -1; d <= 6; d++) {
      const day = new Date(Date.now() + d * 86400000);
      if (day.getDay() === 0 || day.getDay() === 6) continue; // weekdays only
      let type = 'shift', hours = 8, start_time = '08:00', end_time = '16:00', note = null;
      if (d === 2 && ti % 5 === 0) { type = 'pto'; hours = 8; start_time = null; end_time = null; note = 'Approved PTO'; }
      else if (d === 4 && ti % 5 === 1) { type = 'sick'; hours = 8; start_time = null; end_time = null; }
      else if (d === 1 && ti % 5 === 2) { type = 'call_out'; hours = null; start_time = null; end_time = null; note = 'Called out — no coverage found'; }
      schedRows.push({
        user_email: t.user_email, date: isoDate(d), type, hours, start_time, end_time, note,
        created_by: pick(managers, ti),
      });
    }
  });
  await insert('scheduled_shifts', schedRows);
  console.log(`  ${schedRows.length} scheduled-shift rows across ${techs.length} technicians (last 1 + next 6 weekdays).`);

  // --- Attachments: a couple of field notes on a few work orders (text
  // notes only — no real photo storage to point at in a seed script). ---
  console.log('Attachments (notes)…');
  const noteRows = [];
  sample.slice(0, 6).forEach((wo, i) => {
    noteRows.push({ entity_type: 'work_order', entity_id: wo.id, kind: 'note', url: '', caption: 'Arrived on site, beginning diagnostic.', created_by: wo.assignee_email || techs[0].user_email });
    if (i % 2 === 0) noteRows.push({ entity_type: 'work_order', entity_id: wo.id, kind: 'note', url: '', caption: 'Repair complete, tested and confirmed working.', created_by: wo.assignee_email || techs[0].user_email });
  });
  await insert('attachments', noteRows);
  console.log(`  ${noteRows.length} attachment notes.`);

  console.log('\nDone. Re-run any time — this script only touches the tables it owns.');
}

main().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
