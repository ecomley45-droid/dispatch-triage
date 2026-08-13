// One-time data load: 62 real Family Dental Health clinic locations as
// customers (one site each), organized into 5 service regions/teams, plus 40
// open work orders distributed across them. Idempotent-ish: wipes and
// reseeds customers/sites/work_orders and the 5 target regions/teams for the
// family-dental org; leaves other org_members alone except reassigning the
// existing technicians/dispatchers to the new region/team structure.
//
//   node scripts/seed-fdh-locations.mjs
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { db } from '../lib/db.js';

const ORG = 'family-dental';
const sb = db();
if (!sb) { console.error('Supabase not configured.'); process.exit(1); }

const MGR = 'ethanfcomley@gmail.com';
const days = (n) => new Date(Date.now() + n * 86400000).toISOString();
const randInt = (min, max) => min + Math.floor(Math.random() * (max - min + 1));
// A random weekday-business-hours slot somewhere in the next 30 days.
function randomSchedule() {
  let d;
  do { d = new Date(Date.now() + randInt(0, 29) * 86400000); } while (d.getDay() === 0 || d.getDay() === 6);
  d.setHours(randInt(7, 15), [0, 15, 30, 45][randInt(0, 3)], 0, 0);
  const start = new Date(d);
  const end = new Date(start.getTime() + randInt(1, 3) * 3600000);
  return { scheduled_start: start.toISOString(), scheduled_end: end.toISOString() };
}

// name, address, city, state, region key
const LOCATIONS = [
  ['Alice Drive', '227 Alice Dr, Ste 3', 'Sumter', 'SC', 'midlands'],
  ['Anderson East North', '2806 E. North Avenue', 'Anderson', 'SC', 'upstate'],
  ['Anderson North', '2713 N. Main St.', 'Anderson', 'SC', 'upstate'],
  ['Ballentine', '111 Obrian Way', 'Irmo', 'SC', 'midlands'],
  ['Blue Ridge', '2543 Locust Hill Rd', 'Taylors', 'SC', 'upstate'],
  ['Brushy Creek', '1405 Brushy Creek Rd', 'Taylors', 'SC', 'upstate'],
  ['Charleston Southern', '2680 Elms Plantation Blvd', 'North Charleston', 'SC', 'lowcountry'],
  ['Cleveland St', '1352 Cleveland St.', 'Greenville', 'SC', 'upstate'],
  ['Clinton', '700 Plaza Circle, Suite M', 'Clinton', 'SC', 'upstate'],
  ['Creekside', '12 Cleveland Ct', 'Greenville', 'SC', 'upstate'],
  ['Donaldson', '409 Donaldson Road', 'Greenville', 'SC', 'upstate'],
  ['Easley', '9 Southern Center Court', 'Easley', 'SC', 'upstate'],
  ['Fairview', '375-A Harrison Bridge Rd', 'Simpsonville', 'SC', 'upstate'],
  ['Five Forks', '216 Scuffletown Rd, Suite D', 'Simpsonville', 'SC', 'upstate'],
  ['Flatrock', '1803 Woodruff Rd', 'Greenville', 'SC', 'upstate'],
  ['Forest Acres', '5251 Forest Dr', 'Columbia', 'SC', 'midlands'],
  ['Fort Mill', '1860 Coltharp Rd', 'Fort Mill', 'SC', 'midlands'],
  ['Fountain Inn', '284 McCarter Rd', 'Fountain Inn', 'SC', 'upstate'],
  ['Furman', '5000 Old Buncombe Rd, Suite 50', 'Greenville', 'SC', 'upstate'],
  ['Garners Ferry', '8012 Garners Ferry Road, Suite D', 'Columbia', 'SC', 'midlands'],
  ['Golden Corner', '102 Lusk Dr', 'West Union', 'SC', 'upstate'],
  ['Goose Creek', '129 Plantation N Blvd', 'Goose Creek', 'SC', 'lowcountry'],
  ['Greenridge', '15 Garlington Rd', 'Greenville', 'SC', 'upstate'],
  ['Greer', '1200 W Wade Hampton Blvd, Suite A', 'Greer', 'SC', 'upstate'],
  ['Harrison Road', '3261 Harrison Rd', 'Columbia', 'SC', 'midlands'],
  ['Irmo North', '100 Hunter Village Drive', 'Irmo', 'SC', 'midlands'],
  ['Isle of Palms', '15 21st Avenue', 'Isle of Palms', 'SC', 'lowcountry'],
  ['Keowee', '241 Stork Way', 'Seneca', 'SC', 'upstate'],
  ['Lake Carolina', '5 Lake Carolina Way, Suite 210', 'Columbia', 'SC', 'midlands'],
  ['Litchfield', '39 Providence Dr.', 'Pawleys Island', 'SC', 'lowcountry'],
  ['Mauldin', '1 Winchester Court', 'Mauldin', 'SC', 'upstate'],
  ['Moncks Corner', '219 1st Street', 'Moncks Corner', 'SC', 'lowcountry'],
  ['Moore', '4044 Moore Duncan Highway', 'Moore', 'SC', 'upstate'],
  ['Mountain View', '119 Village Dr', 'Greer', 'SC', 'upstate'],
  ['Murray Landing', '1612 Lake Murray Blvd', 'Columbia', 'SC', 'midlands'],
  ['Oakbrook', '101 Morgan Pl', 'Summerville', 'SC', 'lowcountry'],
  ['Old Mill', '509 East Main Street', 'Lexington', 'SC', 'midlands'],
  ['Park West', '2138 SC-41', 'Mount Pleasant', 'SC', 'lowcountry'],
  ['Pendleton', '216 E Main Street', 'Pendleton', 'SC', 'upstate'],
  ['Reidville', '301 E Blackstock Rd', 'Spartanburg', 'SC', 'upstate'],
  ['Sandhills', '126 Barton Creek Ct', 'Columbia', 'SC', 'midlands'],
  ['Seven Oaks', '2617 Ashland Rd', 'Columbia', 'SC', 'midlands'],
  ['Spartanburg Main', '1455 East Main Street', 'Spartanburg', 'SC', 'upstate'],
  ['Spring Valley', '9 Office Park Court', 'Columbia', 'SC', 'midlands'],
  ['Spring Valley North', '18 Office Park Court', 'Columbia', 'SC', 'midlands'],
  ['Sumter', '1116 Alice Drive', 'Sumter', 'SC', 'midlands'],
  ['Sunset', '2858 Sunset Blvd', 'West Columbia', 'SC', 'midlands'],
  ['The Parkway', '319 The Parkway, Suite A', 'Greer', 'SC', 'upstate'],
  ['Tobias Gadson', '1470 Tobias Gadson, Ste. 100B', 'Charleston', 'SC', 'lowcountry'],
  ['Travelers Rest', '309 N Main Street', 'Travelers Rest', 'SC', 'upstate'],
  ['Villa Rd', '110 Villa Rd', 'Greenville', 'SC', 'upstate'],
  ['West Ashley', '1483 Tobias Gadson Blvd #105', 'Charleston', 'SC', 'lowcountry'],
  ['Woodhill', '145 Pelham Drive', 'Columbia', 'SC', 'midlands'],
  ['Concord Lake', '1921 Concord Lake Road', 'Kannapolis', 'NC', 'nc'],
  ['Davie Avenue', '1706 Davie Avenue, Suite B', 'Statesville', 'NC', 'nc'],
  ['Harrisburg', '5500 NC Highway 49 S STE 100', 'Harrisburg', 'NC', 'nc'],
  ['Kannapolis', '1408 S. Main St', 'Kannapolis', 'NC', 'nc'],
  ['Maiden', '401 Island Ford Rd', 'Maiden', 'NC', 'nc'],
  ['South Asheville', '600 Julian Lane, Suite 610', 'Arden', 'NC', 'nc'],
  ['Statesville', '1318 Davie Ave # A', 'Statesville', 'NC', 'nc'],
  ['Augusta', '2325 Washington Rd', 'Augusta', 'GA', 'gatn'],
  ['Belle Meade', '4515 Harding Pike, Suite 104', 'Nashville', 'TN', 'gatn'],
];

const REGIONS = [
  { key: 'upstate', name: 'Upstate SC' },
  { key: 'midlands', name: 'Midlands SC' },
  { key: 'lowcountry', name: 'Lowcountry SC' },
  { key: 'nc', name: 'North Carolina' },
  { key: 'gatn', name: 'Georgia & Tennessee' },
];
const TEAM_NAME = { upstate: 'Upstate SC Team', midlands: 'Midlands SC Team', lowcountry: 'Lowcountry SC Team', nc: 'North Carolina Team', gatn: 'Georgia & Tennessee Team' };
const TECH = { upstate: 'tech.atl@demo.nexus', midlands: 'tech.col@demo.nexus', lowcountry: 'tech.chs@demo.nexus', nc: 'tech.clt@demo.nexus', gatn: 'tech.sav@demo.nexus' };
const TECH_NAME = { 'tech.col@demo.nexus': 'Sam Rivera' };

const WO_TITLES = [
  'Autoclave not reaching temperature', 'Vacuum pump weak suction', 'Chair recline fault',
  'X-ray sensor malfunction', 'Compressor running loud', 'Suction line clog',
  'Handpiece repair needed', 'Waterline treatment overdue', 'Nitrous system check',
  'Sterilizer PM service', 'Intraoral camera not connecting', 'Panoramic unit calibration',
  'Operatory light flickering', 'Curing light weak output', 'Ultrasonic scaler not powering on',
];
const STATUSES = ['requested', 'requested', 'scheduled', 'scheduled', 'en_route', 'on_site'];
const PRIORITIES = ['medium', 'medium', 'high', 'low'];

async function main() {
  console.log('Wiping customers/sites/work_orders…');
  for (const t of ['work_order_lines', 'work_orders', 'sites', 'customers']) {
    const { error } = await sb.from(t).delete().eq('org_id', ORG);
    if (error) throw new Error(`wipe ${t}: ${error.message}`);
  }
  console.log('Wiping old regions/teams…');
  for (const t of ['teams', 'regions']) {
    const { error } = await sb.from(t).delete().eq('org_id', ORG);
    if (error) throw new Error(`wipe ${t}: ${error.message}`);
  }

  console.log('Regions…');
  const { data: regionRows, error: rErr } = await sb.from('regions')
    .insert(REGIONS.map((r) => ({ org_id: ORG, name: r.name, created_by: MGR })))
    .select();
  if (rErr) throw new Error(`regions: ${rErr.message}`);
  const regionId = Object.fromEntries(REGIONS.map((r, i) => [r.key, regionRows.find((row) => row.name === r.name).id]));

  console.log('Teams…');
  const { data: teamRows, error: tErr } = await sb.from('teams')
    .insert(REGIONS.map((r) => ({ org_id: ORG, region_id: regionId[r.key], name: TEAM_NAME[r.key], created_by: MGR })))
    .select();
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  const teamId = Object.fromEntries(REGIONS.map((r) => [r.key, teamRows.find((row) => row.name === TEAM_NAME[r.key]).id]));

  console.log('Reassigning technicians to regions/teams…');
  for (const [key, email] of Object.entries(TECH)) {
    const { data: existing } = await sb.from('org_members').select('user_email').eq('org_id', ORG).eq('user_email', email).maybeSingle();
    if (existing) {
      await sb.from('org_members').update({ region_id: regionId[key], team_id: teamId[key] }).eq('org_id', ORG).eq('user_email', email);
    } else {
      await sb.from('org_members').insert({ org_id: ORG, user_email: email, name: TECH_NAME[email] || email.split('@')[0], role: 'technician', region_id: regionId[key], team_id: teamId[key], joined_at: new Date().toISOString() });
    }
  }
  // The two demo dispatchers, if present, oversee the two largest regions.
  await sb.from('org_members').update({ region_id: regionId.upstate, team_id: teamId.upstate }).eq('org_id', ORG).eq('user_email', 'dispatch.sc@demo.nexus');
  await sb.from('org_members').update({ region_id: regionId.gatn, team_id: teamId.gatn }).eq('org_id', ORG).eq('user_email', 'dispatch.ga@demo.nexus');

  console.log('Customers + sites…');
  const custRows = [];
  for (const [name, , city, state, regionKey] of LOCATIONS) {
    custRows.push({ org_id: ORG, name, status: 'active', payment_terms: 'net_30', region_id: regionId[regionKey], created_by: MGR, notes: `${city}, ${state}` });
  }
  const { data: customers, error: cErr } = await sb.from('customers').insert(custRows).select();
  if (cErr) throw new Error(`customers: ${cErr.message}`);
  const custByName = Object.fromEntries(customers.map((c) => [c.name, c]));

  console.log('Geocoding site addresses (stored on the site — the Map page then skips runtime lookups)…');
  const geocode = async (address) => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, {
        headers: { 'User-Agent': 'DispatchFieldService/1.0 (seed script; contact: support@nexusfieldhub.com)' },
      });
      const data = await res.json();
      return data.length ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
    } catch { return null; }
  };
  const siteRows = [];
  let geocoded = 0;
  for (const [name, address, city, state] of LOCATIONS) {
    const full = `${address}, ${city}, ${state}`;
    const pt = await geocode(full);
    if (pt) geocoded++;
    siteRows.push({ org_id: ORG, customer_id: custByName[name].id, name, address: full, status: 'active', created_by: MGR, lat: pt?.lat ?? null, lon: pt?.lon ?? null });
    await new Promise((r) => setTimeout(r, 1100)); // respect Nominatim's 1 req/sec usage policy
  }
  console.log(`Geocoded ${geocoded} of ${siteRows.length} addresses.`);
  const { data: sites, error: sErr } = await sb.from('sites').insert(siteRows).select();
  if (sErr) throw new Error(`sites: ${sErr.message}`);
  const siteByCustomer = Object.fromEntries(sites.map((s) => [s.customer_id, s]));

  console.log('40 open work orders…');
  // Proportional per region: upstate 17, midlands 11, lowcountry 6, nc 4, gatn 2.
  const QUOTA = { upstate: 17, midlands: 11, lowcountry: 6, nc: 4, gatn: 2 };
  const byRegion = {};
  for (const loc of LOCATIONS) byRegion[loc[4]] = [...(byRegion[loc[4]] || []), loc];

  const woRows = [];
  let n = 0;
  let woNum = 1;
  for (const [key, quota] of Object.entries(QUOTA)) {
    const pool = byRegion[key];
    for (let i = 0; i < quota; i++) {
      const loc = pool[i % pool.length];
      const [name] = loc;
      const customer = custByName[name];
      const site = siteByCustomer[customer.id];
      const title = WO_TITLES[n % WO_TITLES.length];
      const status = STATUSES[n % STATUSES.length];
      const priority = PRIORITIES[n % PRIORITIES.length];
      const { scheduled_start, scheduled_end } = randomSchedule();
      woRows.push({
        org_id: ORG, number: `WO-${String(woNum++).padStart(4, '0')}`,
        customer_id: customer.id, site_id: site.id, asset_id: null, title,
        description: `${title} reported at ${name}.`, priority, status,
        assignee_email: TECH[key], requested_by: `${name} front desk`,
        sla_due: days(2 + (n % 5)), scheduled_start, scheduled_end,
        region_id: regionId[key], created_by: MGR,
      });
      n++;
    }
  }
  const { error: woErr } = await sb.from('work_orders').insert(woRows);
  if (woErr) throw new Error(`work_orders: ${woErr.message}`);

  console.log(`Done: ${customers.length} customers, ${sites.length} sites, ${woRows.length} open work orders across ${REGIONS.length} regions.`);
}

main().catch((e) => { console.error(e); process.exit(1); });
