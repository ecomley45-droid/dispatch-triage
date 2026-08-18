// Bulk client-onboarding import — staging table pattern.
//
//   upload (client) -> createImportJob -> stageRows (chunked) -> validateJob
//   -> preview (job counts + sample errors) -> commitJob (chunked upsert,
//   tagged with import_job_id) -> optional rollbackJob.
//
// Supabase-only: this feature reads/writes staging + audit tables directly
// via the service-role client (db()), bypassing RLS the same way every other
// server-side write in this app already does (see lib/db.js) — it does not
// have an in-memory-demo-store backend like lib/store.js's other collections,
// since chunked staging/upsert semantics aren't meaningful against the
// ephemeral demo store. Throws a clear error if Supabase isn't configured.
import { db, isSupabaseConfigured } from './db.js';
import { store } from './store.js';
import { PRESET_ROLES } from './permissions.js';
import { getSpec, EMAIL_RE } from './importSpecs.js';

const STAGE_CHUNK = 500;
const COMMIT_CHUNK = 500;

function requireSupabase() {
  if (!isSupabaseConfigured()) {
    throw Object.assign(new Error('Bulk import requires a connected Supabase database — not available in local demo mode.'), { status: 400 });
  }
}

async function getJob(orgId, jobId) {
  const { data, error } = await db().from('import_jobs').select('*').eq('org_id', orgId).eq('id', jobId).maybeSingle();
  if (error) throw error;
  if (!data) throw Object.assign(new Error('Import job not found'), { status: 404 });
  return data;
}

async function insertChunked(table, rows, chunkSize = STAGE_CHUNK) {
  for (let i = 0; i < rows.length; i += chunkSize) {
    const { error } = await db().from(table).insert(rows.slice(i, i + chunkSize));
    if (error) throw error;
  }
}

// ---------------------------------------------------------------------------
// Job lifecycle
// ---------------------------------------------------------------------------

export async function listJobs(orgId, entityType) {
  requireSupabase();
  let q = db().from('import_jobs').select('*').eq('org_id', orgId).order('created_at', { ascending: false }).limit(100);
  if (entityType) q = q.eq('entity_type', entityType);
  const { data, error } = await q;
  if (error) throw error;
  return data || [];
}

export async function getJobDetail(orgId, jobId) {
  requireSupabase();
  const job = await getJob(orgId, jobId);
  const { data: errors, error } = await db().from('import_job_errors').select('*').eq('org_id', orgId).eq('import_job_id', jobId).order('row_number').limit(200);
  if (error) throw error;
  return { ...job, errors: errors || [] };
}

export async function createImportJob(orgId, { entityType, sourceFilename, columnMapping, createdBy }) {
  requireSupabase();
  getSpec(entityType); // throws 400 if unknown
  const { data, error } = await db().from('import_jobs').insert({
    org_id: orgId, entity_type: entityType, source_filename: sourceFilename || null,
    column_mapping: columnMapping || {}, created_by: createdBy, status: 'staged',
  }).select().single();
  if (error) throw error;
  return data;
}

// Append a batch of raw (unvalidated) rows to a job's staging area. Called
// once per client-side chunk (see src/lib/importParse.js), so a large file
// never hits the request body-size limit in one shot.
export async function stageRows(orgId, jobId, rawRows, startRowNumber) {
  requireSupabase();
  const job = await getJob(orgId, jobId);
  if (job.status !== 'staged') throw Object.assign(new Error('Rows can only be added while the job is still staging (before it has been validated).'), { status: 400 });
  const payload = rawRows.map((raw, i) => ({ import_job_id: jobId, org_id: orgId, row_number: startRowNumber + i, raw }));
  await insertChunked('import_staging_rows', payload, STAGE_CHUNK);
  const { count, error } = await db().from('import_staging_rows').select('id', { count: 'exact', head: true }).eq('import_job_id', jobId);
  if (error) throw error;
  await db().from('import_jobs').update({ total_rows: count || 0 }).eq('id', jobId).eq('org_id', orgId);
  return { staged: payload.length, total: count || 0 };
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

function applyColumnMapping(raw, columnMapping) {
  const mapped = {};
  for (const [sourceHeader, targetField] of Object.entries(columnMapping || {})) {
    if (!targetField) continue; // "-- skip --" in the mapping UI
    mapped[targetField] = raw[sourceHeader];
  }
  return mapped;
}

function coerceValue(field, raw) {
  if (raw === undefined || raw === null) return { value: null };
  const str = String(raw).trim();
  if (str === '') return { value: null };
  switch (field.type) {
    case 'email': {
      const v = str.toLowerCase();
      if (!EMAIL_RE.test(v)) return { error: `"${str}" isn't a valid email` };
      return { value: v };
    }
    case 'number': {
      const n = Number(str.replace(/,/g, ''));
      if (!Number.isFinite(n)) return { error: `"${str}" isn't a number` };
      return { value: n };
    }
    case 'boolean': {
      const v = str.toLowerCase();
      if (['true', 'yes', 'y', '1'].includes(v)) return { value: true };
      if (['false', 'no', 'n', '0'].includes(v)) return { value: false };
      return { error: `"${str}" isn't a recognized true/false value` };
    }
    case 'date': {
      if (Number.isNaN(new Date(str).getTime())) return { error: `"${str}" isn't a recognized date` };
      return { value: str };
    }
    case 'enum': {
      const match = (field.options || []).find((o) => o.toLowerCase() === str.toLowerCase());
      if (!match) return { error: `"${str}" must be one of: ${field.options.join(', ')}` };
      return { value: match };
    }
    default:
      return { value: str };
  }
}

// Preload every row of `table` for this org into id-lookup maps, keyed by
// external_id and by lowercased name — used both for lookup fields (sites'
// customer_ref, assets' site_ref/customer_ref) and for dedupe matching.
async function loadLookupIndex(orgId, table) {
  const { data, error } = await db().from(table).select('id, external_id, name').eq('org_id', orgId);
  if (error) throw error;
  const byExternalId = new Map(), byName = new Map();
  for (const row of data || []) {
    if (row.external_id) byExternalId.set(row.external_id, row.id);
    if (row.name) byName.set(String(row.name).trim().toLowerCase(), row.id);
  }
  return { byExternalId, byName };
}

function resolveLookup(index, raw) {
  const key = String(raw).trim();
  if (!key) return { value: null };
  return { value: index.byExternalId.get(key) ?? index.byName.get(key.toLowerCase()) ?? undefined };
}

// Existing target-table rows, indexed per conflict-target field, for dedupe
// matching (a row upserts onto whichever conflict target it has a value for,
// tried in spec.conflictTargets order).
async function loadDedupeIndex(orgId, spec) {
  const { data, error } = await db().from(spec.table).select(['id', ...spec.conflictTargets].join(', ')).eq('org_id', orgId);
  if (error) throw error;
  const index = {};
  for (const target of spec.conflictTargets) {
    const m = new Map();
    for (const row of data || []) { if (row[target]) m.set(String(row[target]).toLowerCase(), row.id); }
    index[target] = m;
  }
  return index;
}

function matchExisting(spec, normalized, dedupeIndex) {
  for (const target of spec.conflictTargets) {
    const v = normalized[target];
    if (v == null || v === '') continue;
    const id = dedupeIndex[target].get(String(v).toLowerCase());
    if (id) return id;
  }
  return null;
}

// Validates and normalizes every staged row for a job, resolves dedupe
// matches, and writes the results back (chunked upsert-by-id on the staging
// table itself). Re-running validateJob on the same job is safe/idempotent —
// it clears prior errors and re-derives everything from `raw` + the current
// column mapping.
export async function validateJob(orgId, jobId) {
  requireSupabase();
  const job = await getJob(orgId, jobId);
  const spec = getSpec(job.entity_type);

  const { data: stagedRows, error: fetchErr } = await db().from('import_staging_rows').select('*').eq('org_id', orgId).eq('import_job_id', jobId).order('row_number');
  if (fetchErr) throw fetchErr;

  await db().from('import_job_errors').delete().eq('org_id', orgId).eq('import_job_id', jobId);

  // Preload every lookup target this spec's fields reference (customers for
  // sites, customers+sites for assets), once, not per row.
  const lookupIndexes = {};
  for (const f of spec.fields) {
    if (f.type === 'lookup' && !lookupIndexes[f.lookupEntity]) {
      lookupIndexes[f.lookupEntity] = await loadLookupIndex(orgId, getSpec(f.lookupEntity).table);
    }
  }
  const dedupeIndex = spec.special === 'members' ? null : await loadDedupeIndex(orgId, spec);
  const allowedRoles = spec.special === 'members' ? await loadAllowedRoles(orgId) : null;

  const stagingUpdates = [];
  const errorRows = [];
  let validCount = 0, errorCount = 0;

  for (const row of stagedRows) {
    const mapped = applyColumnMapping(row.raw, job.column_mapping);
    const normalized = {};
    const rowErrors = [];

    for (const field of spec.fields) {
      const rawVal = mapped[field.key];
      if (field.type === 'lookup') {
        if (rawVal === undefined || rawVal === null || String(rawVal).trim() === '') {
          if (field.required) rowErrors.push({ field: field.key, message: `${field.label} is required` });
          continue;
        }
        const { value } = resolveLookup(lookupIndexes[field.lookupEntity], rawVal);
        if (value === undefined) rowErrors.push({ field: field.key, message: `No ${getSpec(field.lookupEntity).label.toLowerCase()} found matching "${rawVal}"` });
        else normalized[field.targetField] = value;
        continue;
      }
      const { value, error } = coerceValue(field, rawVal);
      if (error) { rowErrors.push({ field: field.key, message: error }); continue; }
      if (field.required && (value === null || value === undefined)) { rowErrors.push({ field: field.key, message: `${field.label} is required` }); continue; }
      if (value !== null) normalized[field.key] = value;
    }

    if (spec.special === 'members' && normalized.role && !allowedRoles.has(normalized.role)) {
      rowErrors.push({ field: 'role', message: `"${normalized.role}" isn't an assignable role for this workspace` });
    }

    if (rowErrors.length) {
      errorCount++;
      for (const e of rowErrors) errorRows.push({ import_job_id: jobId, org_id: orgId, row_number: row.row_number, field: e.field, message: e.message, raw: row.raw });
      stagingUpdates.push({ id: row.id, import_job_id: jobId, org_id: orgId, row_number: row.row_number, raw: row.raw, normalized, status: 'error', match_id: null });
    } else {
      validCount++;
      const matchId = dedupeIndex ? matchExisting(spec, normalized, dedupeIndex) : null;
      stagingUpdates.push({ id: row.id, import_job_id: jobId, org_id: orgId, row_number: row.row_number, raw: row.raw, normalized, status: 'valid', match_id: matchId });
    }
  }

  // Bulk "update many different rows" = upsert on the staging table's own
  // primary key, chunked the same as every other bulk write here.
  for (let i = 0; i < stagingUpdates.length; i += STAGE_CHUNK) {
    const { error } = await db().from('import_staging_rows').upsert(stagingUpdates.slice(i, i + STAGE_CHUNK));
    if (error) throw error;
  }
  await insertChunked('import_job_errors', errorRows, STAGE_CHUNK);

  await db().from('import_jobs').update({
    status: 'validated', validated_at: new Date().toISOString(), valid_rows: validCount, error_rows: errorCount,
  }).eq('id', jobId).eq('org_id', orgId);

  return { validCount, errorCount, sampleErrors: errorRows.slice(0, 20) };
}

// Duplicates server.js's assignableRole() check (a role key is assignable if
// it's a non-hidden preset or an existing custom role) — kept local rather
// than imported to avoid a server.js <-> lib/imports.js circular import; keep
// the two in sync if that logic changes.
async function loadAllowedRoles(orgId) {
  const allowed = new Set();
  for (const key of PRESET_ROLES) {
    const r = await store.getRole(orgId, key).catch(() => null);
    if (!r?.hidden) allowed.add(key);
  }
  const { data: customRoles } = await db().from('roles').select('key').eq('org_id', orgId);
  for (const r of customRoles || []) allowed.add(r.key);
  return allowed;
}

// ---------------------------------------------------------------------------
// Commit (promote validated staging rows into the live table)
// ---------------------------------------------------------------------------

async function commitMembers(orgId, job) {
  const { data: validRows, error } = await db().from('import_staging_rows').select('*').eq('org_id', orgId).eq('import_job_id', job.id).eq('status', 'valid').order('row_number');
  if (error) throw error;
  let inserted = 0;
  const failures = [];
  for (const row of validRows) {
    try {
      await store.addMember(orgId, { user_email: row.normalized.user_email, name: row.normalized.name || null, role: row.normalized.role });
      inserted++;
    } catch (e) {
      failures.push({ import_job_id: job.id, org_id: orgId, row_number: row.row_number, field: null, message: e?.message || 'Failed to add member', raw: row.raw });
    }
  }
  if (failures.length) await insertChunked('import_job_errors', failures, STAGE_CHUNK);
  await db().from('import_jobs').update({
    status: 'committed', committed_at: new Date().toISOString(), inserted_rows: inserted, updated_rows: 0,
    error_rows: job.error_rows + failures.length,
  }).eq('id', job.id).eq('org_id', orgId);
  return { inserted, updated: 0, failed: failures.length };
}

export async function commitJob(orgId, jobId) {
  requireSupabase();
  const job = await getJob(orgId, jobId);
  if (job.status !== 'validated') throw Object.assign(new Error('Run validation before committing.'), { status: 400 });
  const spec = getSpec(job.entity_type);

  await db().from('import_jobs').update({ status: 'committing' }).eq('id', jobId).eq('org_id', orgId);

  if (spec.special === 'members') return commitMembers(orgId, job);

  const { data: validRows, error } = await db().from('import_staging_rows').select('*').eq('org_id', orgId).eq('import_job_id', jobId).eq('status', 'valid').order('row_number');
  if (error) throw error;

  const toInsert = validRows.filter((r) => !r.match_id);
  const toUpdate = validRows.filter((r) => r.match_id);

  let inserted = 0, updated = 0;
  // New rows: plain insert, tagged with import_job_id (this is what rollback
  // keys off of — see rollbackJob below).
  for (let i = 0; i < toInsert.length; i += COMMIT_CHUNK) {
    const chunk = toInsert.slice(i, i + COMMIT_CHUNK).map((r) => ({ ...r.normalized, org_id: orgId, import_job_id: jobId }));
    const { data, error: insErr } = await db().from(spec.table).insert(chunk).select('id');
    if (insErr) throw insErr;
    inserted += data.length;
  }
  // Matched rows: upsert on the live table's own primary key (`id` = the
  // matched row found during validation) — the actual "Supabase upsert() with
  // a conflict target" this feature promised, just resolved once up front
  // (at validate time) rather than re-derived per commit call, so a row that
  // could match by either external_id OR billing_email still upserts
  // correctly regardless of which key matched. import_job_id is deliberately
  // NOT overwritten here — it should keep pointing at whichever job first
  // created the row, not the job that most recently updated it.
  for (let i = 0; i < toUpdate.length; i += COMMIT_CHUNK) {
    const chunk = toUpdate.slice(i, i + COMMIT_CHUNK).map((r) => ({ id: r.match_id, ...r.normalized, org_id: orgId }));
    const { data, error: updErr } = await db().from(spec.table).upsert(chunk, { onConflict: 'id' }).select('id');
    if (updErr) throw updErr;
    updated += data.length;
  }

  await db().from('import_jobs').update({
    status: 'committed', committed_at: new Date().toISOString(), inserted_rows: inserted, updated_rows: updated,
  }).eq('id', jobId).eq('org_id', orgId);

  return { inserted, updated };
}

// ---------------------------------------------------------------------------
// Rollback
// ---------------------------------------------------------------------------

// Deletes every row this job INSERTED (tagged import_job_id = this job) in
// one query. Rows the job UPDATED (matched an existing record) are never
// touched — they weren't tagged in the first place (see commitJob). Caveat,
// surfaced in the UI rather than hidden: if a user hand-edited a row this job
// created, rolling back still deletes it — "undo this batch" semantics, not a
// full point-in-time revert.
export async function rollbackJob(orgId, jobId, actorEmail) {
  requireSupabase();
  const job = await getJob(orgId, jobId);
  if (job.status !== 'committed') throw Object.assign(new Error('Only a committed job can be rolled back.'), { status: 400 });
  const spec = getSpec(job.entity_type);
  if (spec.special === 'members') {
    throw Object.assign(new Error("Team member imports can't be rolled back automatically — remove teammates individually from the Users page."), { status: 400 });
  }

  const { error, count } = await db().from(spec.table).delete({ count: 'exact' }).eq('org_id', orgId).eq('import_job_id', jobId);
  if (error) throw error;

  await db().from('import_jobs').update({
    status: 'rolled_back', rolled_back_at: new Date().toISOString(), rolled_back_by: actorEmail,
  }).eq('id', jobId).eq('org_id', orgId);

  return { deleted: count ?? 0 };
}
