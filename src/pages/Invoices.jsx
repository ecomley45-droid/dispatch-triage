import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { useResource, PageHeader, Modal, Field, Badge, money, date, useIsMobile, ListSkeleton } from '../components/ui.jsx';

const STATUSES = ['draft', 'sent', 'paid', 'void'];
const SETTINGS_BLANK = { business_name: '', address: '', email: '', phone: '', tax_rate: '', footer: 'Thank you for your business.' };
const balance = (i) => Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0));
const overdue = (i) => i.status === 'sent' && i.due_date && new Date(i.due_date) < new Date();

export default function Invoices() {
  const nav = useNavigate();
  const me = useMe();
  const { rows, loading, error } = useResource('/invoices');
  const isMobile = useIsMobile();
  const [customers, setCustomers] = useState([]);
  const [filter, setFilter] = useState('all');
  const canSettings = me.can('members:write');
  const saved = me.org?.feature_flags?.invoice || {};
  const [setOpen, setSetOpen] = useState(false);
  const [tpl, setTpl] = useState({ ...SETTINGS_BLANK, ...saved });
  const [savedMsg, setSavedMsg] = useState(false);

  const saveTemplate = async (e) => {
    e.preventDefault();
    try { await api.patch('/org', { invoice: tpl }); setSavedMsg(true); setTimeout(() => { setSetOpen(false); setSavedMsg(false); }, 900); }
    catch (ex) { alert(ex.message); }
  };

  useEffect(() => { api.list('/customers').then(setCustomers).catch(() => {}); }, []);
  const custName = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c.name])), [customers]);
  const shown = rows.filter((i) => (filter === 'all' ? true : i.status === filter));
  const outstanding = rows.filter((i) => i.status === 'sent').reduce((s, i) => s + balance(i), 0);

  return (
    <>
      <PageHeader title="Invoices" subtitle={`Outstanding A/R: ${money(outstanding)}`}
        action={canSettings && <button className="btn" onClick={() => { setTpl({ ...SETTINGS_BLANK, ...saved }); setSetOpen(true); }}>Invoice template</button>} />
      {error && <p className="badge badge-red">{error}</p>}

      {setOpen && (
        <Modal title="Invoice template" onClose={() => setSetOpen(false)}>
          <form onSubmit={saveTemplate}>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(230px, 1fr))', gap: 20 }}>
              <div>
                <Field label="Business name"><input className="input" placeholder={me.org?.name} value={tpl.business_name} onChange={(e) => setTpl({ ...tpl, business_name: e.target.value })} /></Field>
                <Field label="Address"><input className="input" value={tpl.address} onChange={(e) => setTpl({ ...tpl, address: e.target.value })} /></Field>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <Field label="Email"><input className="input" value={tpl.email} onChange={(e) => setTpl({ ...tpl, email: e.target.value })} /></Field>
                  <Field label="Phone"><input className="input" value={tpl.phone} onChange={(e) => setTpl({ ...tpl, phone: e.target.value })} /></Field>
                </div>
                <Field label="Default tax rate (%)"><input className="input" type="number" step="0.001" value={tpl.tax_rate} onChange={(e) => setTpl({ ...tpl, tax_rate: e.target.value })} /></Field>
                <Field label="Footer"><textarea className="input" rows={2} value={tpl.footer} onChange={(e) => setTpl({ ...tpl, footer: e.target.value })} /></Field>
              </div>
              <div>
                <div className="label">Preview</div>
                <div className="card" style={{ padding: 14, fontSize: 12 }}>
                  <div style={{ fontWeight: 800, color: 'var(--primary)' }}>{tpl.business_name || me.org?.name || 'Your business'}</div>
                  <div className="muted">{tpl.address || 'Address'}</div>
                  <div className="muted">{[tpl.email, tpl.phone].filter(Boolean).join(' · ') || 'email · phone'}</div>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 10, fontWeight: 700 }}><span>INV-0001</span><span className="muted">Sample</span></div>
                  <table className="data" style={{ marginTop: 6, fontSize: 11, minWidth: 0 }}><tbody>
                    <tr><td>Labor · 2 hr</td><td style={{ textAlign: 'right' }}>{money(250)}</td></tr>
                    <tr><td>Parts</td><td style={{ textAlign: 'right' }}>{money(89)}</td></tr>
                  </tbody></table>
                  <div style={{ textAlign: 'right', marginTop: 4 }} className="muted">Tax ({Number(tpl.tax_rate) || 0}%) {money(339 * (Number(tpl.tax_rate) || 0) / 100)}</div>
                  <div style={{ textAlign: 'right', fontWeight: 800 }}>Total {money(339 * (1 + (Number(tpl.tax_rate) || 0) / 100))}</div>
                  <div className="muted" style={{ marginTop: 8 }}>{tpl.footer}</div>
                </div>
              </div>
            </div>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn" onClick={() => setSetOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">{savedMsg ? 'Saved ✓' : 'Save template'}</button>
            </div>
          </form>
        </Modal>
      )}

      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
        {['all', ...STATUSES].map((f) => (
          <button key={f} className={`btn ${filter === f ? 'btn-teal' : ''}`} onClick={() => setFilter(f)}>{f}</button>
        ))}
      </div>

      {loading ? <ListSkeleton count={5} /> : isMobile ? (
        <div className="m-cards">
          {shown.map((i) => (
            <button key={i.id} className="m-card" onClick={() => nav(`/invoices/${i.id}`)}>
              <div className="m-card-head">
                <div>
                  <div className="m-title">{i.number} · {money(i.total)}</div>
                  <div className="m-meta">{custName[i.customer_id] || '—'}</div>
                </div>
                <Badge value={i.status} />
              </div>
              <div className="m-facts">
                <span>Balance <b>{money(balance(i))}</b></span>
                <span>Due <b className={overdue(i) ? 'badge badge-red' : ''}>{date(i.due_date)}</b></span>
              </div>
            </button>
          ))}
          {!shown.length && <div className="muted" style={{ textAlign: 'center', padding: 24 }}>No invoices.</div>}
        </div>
      ) : (
        <div className="card">
          <table className="data">
            <thead><tr><th>#</th><th>Customer</th><th>Issued</th><th>Due</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Balance</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((i) => (
                <tr key={i.id} style={{ cursor: 'pointer' }} onClick={() => nav(`/invoices/${i.id}`)}>
                  <td style={{ fontWeight: 700 }}>{i.number || '—'}</td>
                  <td>{custName[i.customer_id] || '—'}</td>
                  <td>{date(i.issue_date)}</td>
                  <td>{overdue(i) ? <span className="badge badge-red">{date(i.due_date)} · overdue</span> : date(i.due_date)}</td>
                  <td style={{ textAlign: 'right' }}>{money(i.total)}</td>
                  <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(balance(i))}</td>
                  <td><Badge value={i.status} /></td>
                </tr>
              ))}
              {!shown.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 32 }}>No invoices.</td></tr>}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}
