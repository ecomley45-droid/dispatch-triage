// Automated backups: a full JSON snapshot of every table written to a private
// Supabase Storage bucket. Triggered daily by a Vercel Cron (see vercel.json)
// hitting /api/cron/backup. Complements (does not replace) Supabase's own
// point-in-time recovery, which is a dashboard setting on paid plans.
import { db } from './db.js';

const TABLES = [
  'orgs', 'org_members', 'projects', 'punch_items', 'service_offers', 'jobs',
  'time_entries', 'items', 'item_usage', 'attachments', 'customers', 'sites',
  'assets', 'work_orders', 'work_order_lines', 'invoices', 'invoice_lines',
  'shifts', 'timesheet_requests', 'audit_log',
];
const BUCKET = 'backups';
let bucketReady = false;

async function ensureBucket(client) {
  if (bucketReady) return;
  await client.storage.createBucket(BUCKET, { public: false }).catch(() => {}); // private; idempotent-ish
  bucketReady = true;
}

// Dump all tables (service_role reads across every org) and store one JSON file.
export async function runBackup() {
  const client = db();
  if (!client) return { ok: false, skipped: 'supabase-not-configured' };

  const snapshot = { created_at: new Date().toISOString(), tables: {} };
  for (const t of TABLES) {
    const { data, error } = await client.from(t).select('*');
    if (error && !/does not exist|schema cache/i.test(error.message || '')) throw error;
    snapshot.tables[t] = data || [];
  }

  await ensureBucket(client);
  const name = `backup-${snapshot.created_at.replace(/[:.]/g, '-')}.json`;
  const { error } = await client.storage.from(BUCKET).upload(name, Buffer.from(JSON.stringify(snapshot)), {
    contentType: 'application/json', upsert: false,
  });
  if (error) throw error;

  const counts = Object.fromEntries(TABLES.map((t) => [t, snapshot.tables[t].length]));
  return { ok: true, file: name, counts };
}
