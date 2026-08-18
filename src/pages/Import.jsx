import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api.js';
import { PageHeader, Loading } from '../components/ui.jsx';
import { parseFile, guessMapping, downloadTemplate } from '../lib/importParse.js';
import { IMPORT_SPECS, IMPORT_ENTITY_KEYS, templateHeaders } from '../../lib/importSpecs.js';

const STATUS_LABEL = {
  staged: 'Staging', validated: 'Ready to commit', committing: 'Committing…',
  committed: 'Committed', failed: 'Failed', rolled_back: 'Rolled back',
};
const STATUS_COLOR = {
  staged: 'var(--text-muted)', validated: 'var(--warning, #cf8a12)', committing: 'var(--warning, #cf8a12)',
  committed: 'var(--success, #5f9e1f)', failed: 'var(--danger, #d64524)', rolled_back: 'var(--text-muted)',
};
const CHUNK = 500;

function StatusBadge({ status }) {
  return <span className="badge" style={{ color: STATUS_COLOR[status], background: 'var(--surface-2)' }}>{STATUS_LABEL[status] || status}</span>;
}

// A file column mapped to a target field, or left unmapped ("-- skip --").
function MappingRow({ header, sample, field, onChange, fields }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, alignItems: 'center', padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
      <div>
        <div style={{ fontWeight: 600, fontSize: 13.5 }}>{header}</div>
        {sample != null && sample !== '' && <div className="muted" style={{ fontSize: 12 }}>e.g. "{String(sample).slice(0, 40)}"</div>}
      </div>
      <select className="input" value={field} onChange={(e) => onChange(header, e.target.value)}>
        <option value="">-- skip this column --</option>
        {fields.map((f) => <option key={f.key} value={f.key}>{f.label}{f.required ? ' *' : ''}</option>)}
      </select>
    </div>
  );
}

export default function Import() {
  const [entityType, setEntityType] = useState(IMPORT_ENTITY_KEYS[0]);
  const spec = IMPORT_SPECS[entityType];

  const [file, setFile] = useState(null);
  const [parsed, setParsed] = useState(null); // { headers, rows }
  const [mapping, setMapping] = useState({});
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(null); // { done, total } while staging
  const [job, setJob] = useState(null); // current job row (with validCount/errorCount once validated)
  const [preview, setPreview] = useState(null); // { validCount, errorCount, sampleErrors }
  const [err, setErr] = useState(null);
  const [history, setHistory] = useState([]);

  const loadHistory = () => api.get(`/imports?entity_type=${entityType}`).then(setHistory).catch(() => setHistory([]));
  useEffect(() => { loadHistory(); }, [entityType]);

  // Switching entity type mid-flow starts a fresh upload — the mapping/spec
  // don't carry over between different target tables.
  const resetUpload = () => { setFile(null); setParsed(null); setMapping({}); setJob(null); setPreview(null); setErr(null); };

  const onEntityChange = (v) => { setEntityType(v); resetUpload(); };

  const onFile = async (e) => {
    const f = e.target.files?.[0];
    if (!f) return;
    setErr(null);
    resetUpload();
    setFile(f);
    try {
      const result = await parseFile(f);
      if (!result.rows.length) { setErr('That file has no data rows.'); return; }
      setParsed(result);
      setMapping(guessMapping(result.headers, spec.fields));
    } catch (ex) {
      setErr(ex.message || 'Could not read that file');
    }
  };

  const requiredMapped = useMemo(() => {
    if (!parsed) return true;
    const mappedTargets = new Set(Object.values(mapping).filter(Boolean));
    return spec.fields.filter((f) => f.required).every((f) => mappedTargets.has(f.key));
  }, [mapping, parsed, spec]);

  const stageAndValidate = async () => {
    if (!parsed || !file) return;
    setBusy(true); setErr(null); setPreview(null);
    try {
      const created = await api.post('/imports', { entityType, sourceFilename: file.name, columnMapping: mapping });
      setJob(created);
      for (let i = 0; i < parsed.rows.length; i += CHUNK) {
        const rows = parsed.rows.slice(i, i + CHUNK);
        setProgress({ done: i, total: parsed.rows.length });
        await api.post(`/imports/${created.id}/rows`, { rows, startRowNumber: i + 1 });
      }
      setProgress({ done: parsed.rows.length, total: parsed.rows.length });
      const result = await api.post(`/imports/${created.id}/validate`, {});
      setPreview(result);
      const refreshed = await api.get(`/imports/${created.id}`);
      setJob(refreshed);
      loadHistory();
    } catch (ex) {
      setErr(ex.message || 'Import failed');
    } finally {
      setBusy(false); setProgress(null);
    }
  };

  const commit = async () => {
    if (!job) return;
    setBusy(true); setErr(null);
    try {
      const result = await api.post(`/imports/${job.id}/commit`, {});
      const refreshed = await api.get(`/imports/${job.id}`);
      setJob(refreshed);
      setPreview((p) => ({ ...p, committed: result }));
      loadHistory();
    } catch (ex) {
      setErr(ex.message || 'Commit failed');
    } finally {
      setBusy(false);
    }
  };

  const rollback = async (jobId) => {
    if (!confirm('Roll back this import? Every row it created will be permanently deleted (rows it only updated are left as-is).')) return;
    try {
      await api.post(`/imports/${jobId}/rollback`, {});
      loadHistory();
      if (job?.id === jobId) setJob((j) => ({ ...j, status: 'rolled_back' }));
    } catch (ex) {
      alert(ex.message || 'Rollback failed');
    }
  };

  return (
    <>
      <PageHeader title="Import Data" subtitle="Bring in customers, sites, assets, items, or team members from a spreadsheet." />

      <div className="card" style={{ padding: 18, marginBottom: 20 }}>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 16 }}>
          <div>
            <label className="label">What are you importing?</label>
            <select className="input" style={{ width: 240 }} value={entityType} onChange={(e) => onEntityChange(e.target.value)}>
              {IMPORT_ENTITY_KEYS.map((k) => <option key={k} value={k}>{IMPORT_SPECS[k].label}</option>)}
            </select>
          </div>
          <button type="button" className="btn" onClick={() => downloadTemplate(spec.label, templateHeaders(entityType))}>Download {spec.label} template</button>
        </div>

        {spec.fields.some((f) => f.type === 'lookup') && (
          <p className="muted" style={{ fontSize: 12.5, marginTop: -8, marginBottom: 16 }}>
            {spec.fields.filter((f) => f.type === 'lookup').map((f) => `${IMPORT_SPECS[f.lookupEntity].label} must already exist in Nexus Field before you import ${spec.label.toLowerCase()} — match rows by that table's External ID or exact name.`).join(' ')}
          </p>
        )}

        <div>
          <label className="label">Spreadsheet (CSV or XLSX)</label>
          <input type="file" accept=".csv,.xlsx,.xls" onChange={onFile} disabled={busy} />
        </div>

        {err && <p className="badge badge-red" style={{ marginTop: 12 }}>{err}</p>}

        {parsed && (
          <div style={{ marginTop: 18 }}>
            <h3 style={{ margin: '0 0 4px' }}>Map columns</h3>
            <p className="muted" style={{ fontSize: 12.5, marginBottom: 10 }}>{parsed.rows.length} rows found. Match each spreadsheet column to a field — required fields are starred.</p>
            {parsed.headers.map((h) => (
              <MappingRow key={h} header={h} sample={parsed.rows[0]?.[h]} field={mapping[h] || ''} fields={spec.fields}
                onChange={(header, v) => setMapping((m) => ({ ...m, [header]: v }))} />
            ))}
            {!requiredMapped && <p className="badge badge-red" style={{ marginTop: 10 }}>Every required field needs a column mapped to it.</p>}
            <button type="button" className="btn btn-teal" style={{ marginTop: 14 }} disabled={!requiredMapped || busy} onClick={stageAndValidate}>
              {busy ? (progress ? `Uploading ${progress.done}/${progress.total}…` : 'Validating…') : 'Upload & validate'}
            </button>
          </div>
        )}

        {preview && (
          <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
            <h3 style={{ margin: '0 0 10px' }}>Preview</h3>
            <div style={{ display: 'flex', gap: 20, marginBottom: 12 }}>
              <div><div style={{ fontSize: 24, fontWeight: 800, color: 'var(--success, #5f9e1f)' }}>{preview.validCount}</div><div className="muted" style={{ fontSize: 12 }}>valid rows</div></div>
              <div><div style={{ fontSize: 24, fontWeight: 800, color: preview.errorCount ? 'var(--danger, #d64524)' : 'inherit' }}>{preview.errorCount}</div><div className="muted" style={{ fontSize: 12 }}>error rows</div></div>
            </div>
            {preview.sampleErrors?.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div className="label">Sample errors</div>
                <table className="data">
                  <thead><tr><th>Row</th><th>Field</th><th>Problem</th></tr></thead>
                  <tbody>
                    {preview.sampleErrors.map((e, i) => <tr key={i}><td>{e.row_number}</td><td>{e.field || '—'}</td><td>{e.message}</td></tr>)}
                  </tbody>
                </table>
              </div>
            )}
            {preview.committed
              ? <p className="badge" style={{ background: 'var(--surface-2)', color: 'var(--success, #5f9e1f)' }}>Committed — {preview.committed.inserted} added, {preview.committed.updated} updated{preview.committed.failed ? `, ${preview.committed.failed} failed` : ''}.</p>
              : <button type="button" className="btn btn-primary" disabled={!preview.validCount || busy} onClick={commit}>
                  {busy ? 'Committing…' : `Commit ${preview.validCount} row${preview.validCount === 1 ? '' : 's'}`}
                </button>}
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 18 }}>
        <h3 style={{ marginTop: 0 }}>Recent {spec.label.toLowerCase()} imports</h3>
        {!history.length && <p className="muted">No imports yet.</p>}
        {history.map((h) => (
          <div key={h.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, padding: '10px 0', borderBottom: '1px solid var(--border)' }}>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontWeight: 600, fontSize: 13.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{h.source_filename || 'Upload'}</div>
              <div className="muted" style={{ fontSize: 12 }}>{new Date(h.created_at).toLocaleString()} · {h.created_by} · {h.valid_rows} valid / {h.error_rows} errors{h.status === 'committed' ? ` · ${h.inserted_rows} added, ${h.updated_rows} updated` : ''}</div>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
              <StatusBadge status={h.status} />
              {h.status === 'committed' && spec.special !== 'members' && <button type="button" className="btn btn-danger" style={{ fontSize: 12 }} onClick={() => rollback(h.id)}>Roll back</button>}
            </div>
          </div>
        ))}
      </div>
    </>
  );
}
