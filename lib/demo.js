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
  const created = { customers: 0, sites: 0, assets: 0, work_orders: 0, work_order_lines: 0, items: 0, service_offers: 0, projects: 0, jobs: 0 };
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

  // Completed, ready to invoice.
  await wo(5, { customer_id: cedar.id, site_id: cMain.id, asset_id: null, title: 'Annual op inspection', description: 'Routine annual inspection of all operatories.', priority: 'low', status: 'completed', assignee_email: 'dispatch@familydental.example', requested_by: 'Dana Whitfield', sla_due: iso(-10 * DAY), completed_at: iso(-9 * DAY), resolution_notes: 'All operatories pass. Recommended replacing chair #1 upholstery next cycle.', signature_name: 'Dana Whitfield' },
    [{ kind: 'labor', description: 'Inspection (4 operatories)', quantity: 3, unit_cost: 0, unit_price: 125 }]);

  // A project + a scheduled job so the rest of the app has content too.
  const proj = await ins('projects', { name: 'North Clinic Buildout', client_name: 'Riverside — North', location: '1200 Oak Ave', status: 'active', budget: 85000, start_date: iso(-30 * DAY).slice(0, 10), due_date: iso(40 * DAY).slice(0, 10), description: 'New operatory buildout and equipment install.', created_by: owner });
  await ins('jobs', { project_id: proj.id, service_offer_id: svc?.id || null, title: 'Install operatory chair #4', location: '1200 Oak Ave', status: 'scheduled', scheduled_start: iso(3 * DAY), scheduled_end: iso(3 * DAY + 4 * HOUR), assignee_email: 'dispatch@familydental.example', dispatcher_email: owner, notes: 'Bring lift kit.' });

  return { seeded: true, created };
}
