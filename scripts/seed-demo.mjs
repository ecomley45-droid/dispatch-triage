// Seeds a realistic Family Dental Health demo dataset into Supabase so the app
// presents well in a tech demo. Re-runnable: wipes the demo org's CONTENT
// tables (not the org or its members) and reinserts. Safe on the demo org only.
//
//   node scripts/seed-demo.mjs   (npm run seed:demo)
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { db } from '../lib/db.js';

const ORG = 'family-dental';
const sb = db();
if (!sb) { console.error('Supabase not configured (need SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY).'); process.exit(1); }

const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const hoursAgo = (n) => new Date(Date.now() - n * 3600000).toISOString();

async function insert(table, rows) {
  const withOrg = rows.map((r) => ({ ...r, org_id: ORG }));
  const { data, error } = await sb.from(table).insert(withOrg).select();
  if (error) throw new Error(`${table}: ${error.message}`);
  return data;
}

async function wipe() {
  for (const t of ['time_entries', 'item_usage', 'punch_items', 'jobs', 'items', 'service_offers', 'projects']) {
    const { error } = await sb.from(t).delete().eq('org_id', ORG);
    if (error) throw new Error(`wipe ${t}: ${error.message}`);
  }
}

async function main() {
  console.log('Wiping demo content…');
  await wipe();

  console.log('Members…');
  await sb.from('org_members').upsert([
    { org_id: ORG, user_email: 'dana.ruiz@familydental.example', name: 'Dana Ruiz', role: 'dispatcher' },
    { org_id: ORG, user_email: 'marco.bell@familydental.example', name: 'Marco Bell', role: 'dispatcher' },
    { org_id: ORG, user_email: 'alex.nguyen@familydental.example', name: 'Alex Nguyen', role: 'accountant_admin' },
  ], { onConflict: 'org_id,user_email' });
  const DANA = 'dana.ruiz@familydental.example';
  const MARCO = 'marco.bell@familydental.example';
  const MGR = 'bigefc45@me.com';

  console.log('Service offers…');
  const svc = await insert('service_offers', [
    { name: 'Equipment Install', description: 'Chairs, units, imaging install', unit: 'hour', default_rate: 125 },
    { name: 'Preventive Maintenance', description: 'Scheduled PM visits', unit: 'hour', default_rate: 95 },
    { name: 'Emergency Repair', description: 'Same-day breakdown response', unit: 'hour', default_rate: 150 },
    { name: 'Water Line / Plumbing', description: 'Op water lines, vacuum, plumbing', unit: 'hour', default_rate: 110 },
  ]);
  const svcId = Object.fromEntries(svc.map((s) => [s.name, s.id]));

  console.log('Projects…');
  const projects = await insert('projects', [
    { name: 'North Greenville Clinic — Operatory Buildout', client_name: 'FDH — North Greenville', location: '101 N Main St, Greenville, SC', status: 'active', budget: 92000, start_date: '2026-06-01', due_date: '2026-09-15', created_by: 'demo-seed', description: 'Build out 4 new operatories: chairs, delivery units, imaging, plumbing.' },
    { name: 'Greer Office — Equipment Refresh', client_name: 'FDH — Greer', location: '201 Trade St, Greer, SC', status: 'active', budget: 48000, start_date: '2026-06-20', due_date: '2026-08-30', created_by: 'demo-seed', description: 'Replace aging chairs and compressor; sterilization upgrade.' },
    { name: 'Spartanburg Clinic — HVAC & Compressor', client_name: 'FDH — Spartanburg', location: '150 W Main St, Spartanburg, SC', status: 'on_hold', budget: 35000, start_date: '2026-05-10', due_date: '2026-08-01', created_by: 'demo-seed', description: 'HVAC replacement and central compressor swap. Awaiting parts.' },
    { name: 'Anderson New Location Fit-Out', client_name: 'FDH — Anderson', location: '300 N Main St, Anderson, SC', status: 'planning', budget: 120000, start_date: '2026-08-01', due_date: '2026-12-01', created_by: 'demo-seed', description: 'Full fit-out of a new 8-chair location.' },
    { name: 'Maiden NC — Sterilization Upgrade', client_name: 'FDH — Maiden', location: '12 S Main St, Maiden, NC', status: 'active', budget: 41000, start_date: '2026-07-01', due_date: '2026-09-01', created_by: 'demo-seed', description: 'New sterilizers, amalgam separators, and vacuum service.' },
  ]);
  const P = Object.fromEntries(projects.map((p) => [p.name.split('—')[0].trim(), p.id]));
  const pNorth = P['North Greenville Clinic'], pGreer = P['Greer Office'], pSpart = P['Spartanburg Clinic'], pMaiden = P['Maiden NC'];

  console.log('Items…');
  const items = await insert('items', [
    { name: 'Nitrile Gloves', sku: 'GLV-100', unit: 'box', unit_cost: 12.50 },
    { name: 'Compressor Filter', sku: 'FLT-22', unit: 'each', unit_cost: 34.00 },
    { name: 'Dental Chair Water Line', sku: 'WL-08', unit: 'each', unit_cost: 58.75 },
    { name: 'Suction Motor', sku: 'SUC-500', unit: 'each', unit_cost: 420.00 },
    { name: 'LED Operatory Light', sku: 'LED-14', unit: 'each', unit_cost: 780.00 },
    { name: 'Sterilizer Gasket Kit', sku: 'STG-03', unit: 'kit', unit_cost: 46.00 },
    { name: 'Air/Water Syringe Tips', sku: 'AWS-250', unit: 'pack', unit_cost: 22.00 },
    { name: 'Amalgam Separator', sku: 'AMS-11', unit: 'each', unit_cost: 310.00 },
    { name: 'Vacuum Pump Oil', sku: 'VPO-1L', unit: 'bottle', unit_cost: 18.50 },
    { name: 'HVAC Filter 20x25', sku: 'HVF-2025', unit: 'each', unit_cost: 14.00 },
  ]);
  const I = Object.fromEntries(items.map((it) => [it.sku, it.id]));

  console.log('Jobs…');
  const jobs = await insert('jobs', [
    { project_id: pNorth, service_offer_id: svcId['Equipment Install'], title: 'Install operatory chair #4', location: '101 N Main St, Greenville, SC', status: 'scheduled', scheduled_start: days(2), scheduled_end: days(2), assignee_email: DANA, dispatcher_email: MGR, notes: 'Bring lift kit and delivery unit.' },
    { project_id: pNorth, service_offer_id: svcId['Water Line / Plumbing'], title: 'Run water lines op 3 & 4', location: '101 N Main St, Greenville, SC', status: 'in_progress', scheduled_start: hoursAgo(3), assignee_email: MARCO, dispatcher_email: MGR, notes: '' },
    { project_id: pGreer, service_offer_id: svcId['Equipment Install'], title: 'Swap compressor', location: '201 Trade St, Greer, SC', status: 'scheduled', scheduled_start: days(1), assignee_email: DANA, dispatcher_email: MGR, notes: 'Confirm shutoff with office manager.' },
    { project_id: pGreer, service_offer_id: svcId['Preventive Maintenance'], title: 'Quarterly PM — 3 chairs', location: '201 Trade St, Greer, SC', status: 'completed', scheduled_start: days(-4), assignee_email: MARCO, dispatcher_email: MGR, notes: '' },
    { project_id: pSpart, service_offer_id: svcId['Emergency Repair'], title: 'Compressor down — no air', location: '150 W Main St, Spartanburg, SC', status: 'en_route', scheduled_start: hoursAgo(1), assignee_email: DANA, dispatcher_email: MGR, notes: 'Two ops offline. Priority.' },
    { project_id: pMaiden, service_offer_id: svcId['Equipment Install'], title: 'Install sterilizer + separator', location: '12 S Main St, Maiden, NC', status: 'scheduled', scheduled_start: days(3), assignee_email: MARCO, dispatcher_email: MGR, notes: '' },
    { project_id: pMaiden, service_offer_id: svcId['Water Line / Plumbing'], title: 'Vacuum pump service', location: '12 S Main St, Maiden, NC', status: 'completed', scheduled_start: days(-2), assignee_email: DANA, dispatcher_email: MGR, notes: '' },
    { project_id: pNorth, service_offer_id: svcId['Preventive Maintenance'], title: 'LED light install op 1', location: '101 N Main St, Greenville, SC', status: 'unscheduled', assignee_email: null, dispatcher_email: MGR, notes: 'Waiting on light delivery.' },
  ]);

  console.log('Punch items…');
  await insert('punch_items', [
    { project_id: pNorth, title: 'Chair #3 water line leaking', status: 'in_progress', priority: 'high', assignee_email: MARCO, created_by: 'demo-seed' },
    { project_id: pNorth, title: 'Cabinet door misaligned — op 2', status: 'open', priority: 'low', created_by: 'demo-seed' },
    { project_id: pNorth, title: 'Verify vacuum draw op 4', status: 'open', priority: 'medium', assignee_email: DANA, created_by: 'demo-seed' },
    { project_id: pNorth, title: 'Touch-up paint after plumbing', status: 'done', priority: 'low', created_by: 'demo-seed', completed_at: days(-1) },
    { project_id: pGreer, title: 'Replace compressor filter', status: 'done', priority: 'medium', created_by: 'demo-seed', completed_at: days(-3) },
    { project_id: pGreer, title: 'Sterilizer gasket seating', status: 'open', priority: 'high', assignee_email: MARCO, created_by: 'demo-seed' },
    { project_id: pSpart, title: 'Order HVAC filters (backorder)', status: 'blocked', priority: 'urgent', assignee_email: DANA, created_by: 'demo-seed' },
    { project_id: pMaiden, title: 'Amalgam separator mounting', status: 'in_progress', priority: 'medium', assignee_email: MARCO, created_by: 'demo-seed' },
    { project_id: pMaiden, title: 'Label shutoff valves', status: 'open', priority: 'low', created_by: 'demo-seed' },
  ]);

  console.log('Item usage…');
  await insert('item_usage', [
    { item_id: I['WL-08'], project_id: pNorth, quantity: 4, unit_cost_at_use: 58.75, recorded_by: MARCO, used_at: days(-1) },
    { item_id: I['GLV-100'], project_id: pNorth, quantity: 6, unit_cost_at_use: 12.50, recorded_by: MARCO, used_at: days(-1) },
    { item_id: I['LED-14'], project_id: pNorth, quantity: 2, unit_cost_at_use: 780.00, recorded_by: DANA, used_at: days(-2) },
    { item_id: I['AWS-250'], project_id: pNorth, quantity: 3, unit_cost_at_use: 22.00, recorded_by: MARCO, used_at: days(-2) },
    { item_id: I['FLT-22'], project_id: pGreer, quantity: 2, unit_cost_at_use: 34.00, recorded_by: MARCO, used_at: days(-3) },
    { item_id: I['STG-03'], project_id: pGreer, quantity: 1, unit_cost_at_use: 46.00, recorded_by: MARCO, used_at: days(-3) },
    { item_id: I['SUC-500'], project_id: pGreer, quantity: 1, unit_cost_at_use: 420.00, recorded_by: DANA, used_at: days(-3) },
    { item_id: I['AMS-11'], project_id: pMaiden, quantity: 2, unit_cost_at_use: 310.00, recorded_by: MARCO, used_at: days(-2) },
    { item_id: I['VPO-1L'], project_id: pMaiden, quantity: 3, unit_cost_at_use: 18.50, recorded_by: DANA, used_at: days(-2) },
    { item_id: I['GLV-100'], project_id: pMaiden, quantity: 4, unit_cost_at_use: 12.50, recorded_by: MARCO, used_at: days(-1) },
  ]);

  console.log('Time entries…');
  // clock in/out pairs across jobs so labor cost + timesheets populate
  const j = jobs;
  await insert('time_entries', [
    { job_id: j[1].id, user_email: MARCO, clock_in: hoursAgo(3), clock_out: hoursAgo(0.5), notes: 'Ran lines op 3.' },
    { job_id: j[3].id, user_email: MARCO, clock_in: days(-4), clock_out: new Date(Date.parse(days(-4)) + 3.5 * 3600000).toISOString(), notes: 'PM 3 chairs.' },
    { job_id: j[6].id, user_email: DANA, clock_in: days(-2), clock_out: new Date(Date.parse(days(-2)) + 5 * 3600000).toISOString(), notes: 'Vacuum service.' },
    { job_id: j[4].id, user_email: DANA, clock_in: hoursAgo(1), clock_out: null, notes: 'En route / on site.' },
    { job_id: j[0].id, user_email: DANA, clock_in: days(-1), clock_out: new Date(Date.parse(days(-1)) + 2 * 3600000).toISOString(), notes: 'Prep + partial install.' },
    { job_id: j[1].id, user_email: MARCO, clock_in: days(-1), clock_out: new Date(Date.parse(days(-1)) + 4 * 3600000).toISOString(), notes: '' },
  ]);

  // Summary
  const counts = {};
  for (const t of ['projects', 'jobs', 'items', 'punch_items', 'item_usage', 'time_entries', 'service_offers']) {
    const { count } = await sb.from(t).select('*', { count: 'exact', head: true }).eq('org_id', ORG);
    counts[t] = count;
  }
  console.log('Seed complete:', counts);
}

main().catch((e) => { console.error('Seed failed:', e.message); process.exit(1); });
