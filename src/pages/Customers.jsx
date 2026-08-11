import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '../lib/useMe.jsx';
import { api } from '../lib/api.js';
import { useResource, PageHeader, Modal, Field, Badge, useIsMobile, ListSkeleton } from '../components/ui.jsx';

const TERMS = ['due_on_receipt', 'net_15', 'net_30', 'net_45', 'net_60'];
const BLANK = { name: '', billing_email: '', phone: '', billing_address: '', payment_terms: 'net_30', po_required: false, status: 'active', notes: '', region_id: '' };
const term = (t) => (t || '').replace(/_/g, ' ');

export default function Customers() {
  const me = useMe();
  const nav = useNavigate();
  const { rows, loading, error, create } = useResource('/customers');
  const isMobile = useIsMobile();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [regions, setRegions] = useState([]);
  const [regionFilter, setRegionFilter] = useState('');
  const canWrite = me.can('customers:write');
  useEffect(() => { api.get('/regions').then(setRegions).catch(() => {}); }, []);
  const regionName = (id) => regions.find((r) => r.id === id)?.name || '—';
  const shown = regionFilter ? rows.filter((c) => c.region_id === regionFilter) : rows;

  const submit = async (e) => {
    e.preventDefault();
    setSaving(true);
    try {
      const row = await create({ ...form, region_id: form.region_id || null });
      setOpen(false); setForm(BLANK);
      nav(`/customers/${row.id}`);
    } finally { setSaving(false); }
  };

  return (
    <>
      <PageHeader title="Customers" subtitle="Business accounts you service"
        action={<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          {regions.length > 0 && (
            <select className="input" style={{ width: 'auto' }} value={regionFilter} onChange={(e) => setRegionFilter(e.target.value)}>
              <option value="">All regions</option>
              {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          )}
          {canWrite && <button className="btn btn-primary" onClick={() => setOpen(true)}>+ New customer</button>}
        </div>} />

      {error && <p className="badge badge-red">{error}</p>}

      {loading ? <ListSkeleton count={4} /> : isMobile ? (
        <div className="m-cards">
          {shown.map((c) => (
            <button key={c.id} className="m-card" onClick={() => nav(`/customers/${c.id}`)}>
              <div className="m-card-head">
                <div>
                  <div className="m-title">{c.name}</div>
                  <div className="m-meta">{[c.phone, c.billing_email].filter(Boolean).join(' · ') || '—'}</div>
                </div>
                <Badge value={c.status} />
              </div>
              <div className="m-facts">
                <span>Terms <b>{term(c.payment_terms)}</b></span>
                <span>PO <b>{c.po_required ? 'required' : 'no'}</b></span>
                {regions.length > 0 && <span>Region <b>{regionName(c.region_id)}</b></span>}
              </div>
            </button>
          ))}
          {!shown.length && <div className="muted" style={{ textAlign: 'center', padding: 24 }}>No customers{regionFilter ? ' in this region' : ' yet'}.</div>}
        </div>
      ) : (
        <div className="card">
          <table className="data">
            <thead><tr><th>Name</th><th>Contact</th>{regions.length > 0 && <th>Region</th>}<th>Terms</th><th>PO</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((c) => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/customers/${c.id}`)}>
                  <td style={{ fontWeight: 600 }}>{c.name}</td>
                  <td>{[c.phone, c.billing_email].filter(Boolean).join(' · ') || '—'}</td>
                  {regions.length > 0 && <td>{regionName(c.region_id)}</td>}
                  <td>{term(c.payment_terms)}</td>
                  <td>{c.po_required ? <span className="badge badge-amber">required</span> : <span className="muted">—</span>}</td>
                  <td><Badge value={c.status} /></td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 32 }}>No customers{regionFilter ? ' in this region' : ' yet'}.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {open && (
        <Modal title="New customer" onClose={() => setOpen(false)}>
          <form onSubmit={submit}>
            <Field label="Business name"><input className="input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label="Billing email"><input className="input" type="email" value={form.billing_email} onChange={(e) => setForm({ ...form, billing_email: e.target.value })} /></Field>
              <Field label="Phone"><input className="input" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} /></Field>
            </div>
            <Field label="Billing address"><input className="input" value={form.billing_address} onChange={(e) => setForm({ ...form, billing_address: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, alignItems: 'end' }}>
              <Field label="Payment terms">
                <select className="input" value={form.payment_terms} onChange={(e) => setForm({ ...form, payment_terms: e.target.value })}>
                  {TERMS.map((t) => <option key={t} value={t}>{term(t)}</option>)}
                </select>
              </Field>
              <Field label="Status">
                <select className="input" value={form.status} onChange={(e) => setForm({ ...form, status: e.target.value })}>
                  {['active', 'inactive'].map((s) => <option key={s} value={s}>{s}</option>)}
                </select>
              </Field>
              <Field label="PO required">
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, height: 36 }}>
                  <input type="checkbox" checked={form.po_required} onChange={(e) => setForm({ ...form, po_required: e.target.checked })} />
                  <span className="muted" style={{ fontSize: 13 }}>on all work</span>
                </label>
              </Field>
            </div>
            {regions.length > 0 && (
              <Field label="Region">
                <select className="input" value={form.region_id} onChange={(e) => setForm({ ...form, region_id: e.target.value })}>
                  <option value="">— none —</option>
                  {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            )}
            <Field label="Notes"><textarea className="input" rows={2} value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Create customer'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
