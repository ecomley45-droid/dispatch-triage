import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useResource, PageHeader, Badge, money, date, useIsMobile, ListSkeleton } from '../components/ui.jsx';

const STATUSES = ['draft', 'sent', 'paid', 'void'];
const balance = (i) => Math.max(0, Number(i.total || 0) - Number(i.amount_paid || 0));
const overdue = (i) => i.status === 'sent' && i.due_date && new Date(i.due_date) < new Date();

export default function Invoices() {
  const nav = useNavigate();
  const { rows, loading, error } = useResource('/invoices');
  const isMobile = useIsMobile();
  const [customers, setCustomers] = useState([]);
  const [filter, setFilter] = useState('all');

  useEffect(() => { api.list('/customers').then(setCustomers).catch(() => {}); }, []);
  const custName = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c.name])), [customers]);
  const shown = rows.filter((i) => (filter === 'all' ? true : i.status === filter));
  const outstanding = rows.filter((i) => i.status === 'sent').reduce((s, i) => s + balance(i), 0);

  return (
    <>
      <PageHeader title="Invoices" subtitle={`Outstanding A/R: ${money(outstanding)}`} />
      {error && <p className="badge badge-red">{error}</p>}

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
