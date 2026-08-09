import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Logo from '../components/Logo.jsx';

const money = (n) => (n == null || n === '' ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const date = (d) => (d ? new Date(d).toLocaleDateString() : '—');
const tone = { requested: '#b8791b', scheduled: '#0f7c6e', en_route: '#b8791b', on_site: '#0f7c6e', completed: '#5f9e1f', invoiced: '#5f9e1f', paid: '#5f9e1f', sent: '#0f7c6e', draft: '#56685f' };
const Pill = ({ v }) => <span style={{ fontSize: 11.5, fontWeight: 700, textTransform: 'capitalize', color: '#fff', background: tone[v] || '#56685f', borderRadius: 999, padding: '2px 9px' }}>{String(v || '').replace(/_/g, ' ')}</span>;

const BLANK = { title: '', description: '', priority: 'medium', site_id: '', contact: '' };

function Portal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(null);

  const load = () => fetch(`/api/portal/${token}`).then((r) => { if (!r.ok) throw new Error('This portal link is invalid or has expired.'); return r.json(); }).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [token]);

  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setSent(null);
    try {
      const r = await fetch(`/api/portal/${token}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not submit');
      setSent(j.number); setForm(BLANK); load();
    } catch (ex) { setSent(null); setErr(ex.message); } finally { setSaving(false); }
  };

  if (err && !data) return <div style={{ maxWidth: 560, margin: '80px auto', textAlign: 'center', fontFamily: 'system-ui, sans-serif', color: '#12211d', padding: 24 }}><h2>Portal unavailable</h2><p style={{ color: '#56685f' }}>{err}</p></div>;
  if (!data) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><div className="loadingbar"><span /></div></div>;

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 16 };

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 64px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Logo size={26} />
          <span style={{ fontWeight: 800, fontSize: 18 }}>{data.org.name}</span>
        </header>
        <h1 style={{ fontSize: 24, margin: '10px 0 2px' }}>Customer portal</h1>
        <p className="muted" style={{ marginTop: 0 }}>{data.customer.name}</p>

        {/* Request form */}
        <div style={{ ...card, marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Request service</h3>
          {sent && <p style={{ background: 'color-mix(in srgb, #5f9e1f 16%, transparent)', color: '#4c7d18', padding: '8px 12px', borderRadius: 8 }}>Thanks! Your request was received as <b>{sent}</b>. We'll be in touch.</p>}
          <form onSubmit={submit}>
            <label className="label">What do you need help with?</label>
            <input className="input" required placeholder="e.g. Chair #3 water line leaking" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }} className="portal-pair">
              <div><label className="label">Location</label>
                <select className="input" value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}>
                  <option value="">— select —</option>
                  {data.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><label className="label">Priority</label>
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <label className="label" style={{ marginTop: 12 }}>Details</label>
            <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <label className="label" style={{ marginTop: 12 }}>Your name / contact</label>
            <input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            <div style={{ marginTop: 14, textAlign: 'right' }}><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Sending…' : 'Submit request'}</button></div>
          </form>
        </div>

        {/* Work orders */}
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Your service requests</h3>
          {data.workOrders.length ? data.workOrders.map((w) => (
            <div key={w.number} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ minWidth: 0 }}><div style={{ fontWeight: 600 }}>{w.number} · {w.title}</div><div className="muted" style={{ fontSize: 12.5 }}>{w.scheduled_start ? `Scheduled ${date(w.scheduled_start)}` : 'Not yet scheduled'}</div></div>
              <Pill v={w.status} />
            </div>
          )) : <p className="muted">No requests yet.</p>}
        </div>

        {/* Invoices */}
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Invoices</h3>
          {data.invoices.length ? data.invoices.map((i) => (
            <div key={i.number} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <div><div style={{ fontWeight: 600 }}>{i.number}</div><div className="muted" style={{ fontSize: 12.5 }}>Issued {date(i.issue_date)} · Due {date(i.due_date)}</div></div>
              <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700 }}>{money(i.total)}</div><Pill v={i.status} /></div>
            </div>
          )) : <p className="muted">No invoices yet.</p>}
        </div>

        <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Powered by {data.org.name} · This is your private link — please don't share it.</p>
      </div>
      <style>{`@media (max-width:520px){ .portal-pair{ grid-template-columns:1fr !important; } }`}</style>
    </div>
  );
}

export default function PortalApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/portal/:token" element={<Portal />} />
      </Routes>
    </BrowserRouter>
  );
}
