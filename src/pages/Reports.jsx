import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, money, Loading } from '../components/ui.jsx';

const iso = (d) => d.toISOString().slice(0, 10);
const today = () => iso(new Date());
const monthStart = () => today().slice(0, 8) + '01';

// Range presets → {from, to}
function preset(name) {
  const n = new Date();
  const y = n.getFullYear(); const m = n.getMonth();
  if (name === 'this-month') return { from: iso(new Date(y, m, 1)), to: today() };
  if (name === 'last-month') return { from: iso(new Date(y, m - 1, 1)), to: iso(new Date(y, m, 0)) };
  if (name === 'quarter') { const q = Math.floor(m / 3) * 3; return { from: iso(new Date(y, q, 1)), to: today() }; }
  if (name === 'ytd') return { from: `${y}-01-01`, to: today() };
  return { from: monthStart(), to: today() };
}

function downloadCsv(filename, headers, rows) {
  const esc = (v) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const body = [headers.map(esc).join(','), ...rows.map((r) => r.map(esc).join(','))].join('\n');
  const url = URL.createObjectURL(new Blob([body], { type: 'text/csv' }));
  const a = document.createElement('a'); a.href = url; a.download = filename; a.click(); URL.revokeObjectURL(url);
}

function Tile({ label, value, tone }) {
  const color = tone === 'bad' ? 'var(--danger)' : tone === 'good' ? 'var(--brand-green-text)' : 'var(--text)';
  return (
    <div className="card" style={{ padding: 16, flex: '1 1 150px', minWidth: 140 }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4, color }}>{value}</div>
    </div>
  );
}

function Section({ title, onExport, children }) {
  return (
    <div className="card" style={{ padding: 18, marginTop: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 8 }}>
        <h3 style={{ margin: 0, fontSize: 16 }}>{title}</h3>
        <button className="btn no-print" onClick={onExport}>Export CSV</button>
      </div>
      <div className="table-wrap" style={{ overflowX: 'auto' }}>{children}</div>
    </div>
  );
}

export default function Reports() {
  const me = useMe();
  const [range, setRange] = useState(() => preset('this-month'));
  const [d, setD] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    setD(null);
    api.get(`/reports?from=${range.from}&to=${range.to}`).then(setD).catch((e) => setErr(e.message));
  }, [range.from, range.to]);

  if (!me.can('reports:read')) return <div className="muted" style={{ padding: 28, textAlign: 'center' }}>Reports are available to managers and accounting.</div>;

  const s = d?.summary;
  return (
    <>
      <style>{`@media print { .sidebar,.topbar,.bottom-nav,.app-shell>.main>footer,.no-print{display:none!important;} .content{padding:0!important;} body,.app-shell,.main{background:#fff!important;} .card{break-inside:avoid;} }`}</style>

      <PageHeader title="Reports" subtitle={`${range.from} → ${range.to}`}
        action={<button className="btn no-print" onClick={() => window.print()}>Print / PDF</button>} />

      {/* Controls */}
      <div className="card no-print" style={{ padding: 14, marginBottom: 16, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'center' }}>
        {[['this-month', 'This month'], ['last-month', 'Last month'], ['quarter', 'This quarter'], ['ytd', 'Year to date']].map(([k, label]) => (
          <button key={k} className="btn" onClick={() => setRange(preset(k))}>{label}</button>
        ))}
        <span style={{ marginLeft: 'auto', display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label className="label" style={{ margin: 0 }}>From <input className="input" type="date" value={range.from} max={range.to} onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))} style={{ width: 160 }} /></label>
          <label className="label" style={{ margin: 0 }}>To <input className="input" type="date" value={range.to} min={range.from} onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))} style={{ width: 160 }} /></label>
        </span>
      </div>

      {err && <p className="badge badge-red">{err}</p>}
      {!d ? <Loading label="Building report…" /> : (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 4 }}>
            <Tile label="Invoiced" value={money(s.invoiced)} />
            <Tile label="Collected" value={money(s.collected)} tone="good" />
            <Tile label="Outstanding" value={money(s.outstanding)} tone={s.outstanding > 0 ? 'bad' : undefined} />
            <Tile label="Jobs completed" value={s.jobsCompleted} />
            <Tile label="Work margin" value={money(s.woMargin)} tone={s.woMargin >= 0 ? 'good' : 'bad'} />
            <Tile label="Labor hours" value={s.laborHours.toFixed(1)} />
          </div>

          <Section title={`Invoices (${d.invoices.length})`} onExport={() => downloadCsv(`invoices_${range.from}_${range.to}.csv`, ['Number', 'Customer', 'Issued', 'Due', 'Total', 'Paid', 'Balance', 'Status'], d.invoices.map((r) => [r.number, r.customer, r.issue_date, r.due_date, r.total, r.amount_paid, r.balance, r.status]))}>
            <table className="data" style={{ minWidth: 620 }}>
              <thead><tr><th>#</th><th>Customer</th><th>Issued</th><th style={{ textAlign: 'right' }}>Total</th><th style={{ textAlign: 'right' }}>Paid</th><th style={{ textAlign: 'right' }}>Balance</th><th>Status</th></tr></thead>
              <tbody>
                {d.invoices.map((r) => <tr key={r.number}><td>{r.number}</td><td>{r.customer}</td><td>{r.issue_date}</td><td style={{ textAlign: 'right' }}>{money(r.total)}</td><td style={{ textAlign: 'right' }}>{money(r.amount_paid)}</td><td style={{ textAlign: 'right' }}>{money(r.balance)}</td><td style={{ textTransform: 'capitalize' }}>{r.status}</td></tr>)}
                {!d.invoices.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 20 }}>No invoices in range.</td></tr>}
              </tbody>
            </table>
          </Section>

          <Section title={`Revenue by customer (${d.byCustomer.length})`} onExport={() => downloadCsv(`revenue_by_customer_${range.from}_${range.to}.csv`, ['Customer', 'Invoiced', 'Collected'], d.byCustomer.map((r) => [r.name, r.invoiced, r.collected]))}>
            <table className="data" style={{ minWidth: 420 }}>
              <thead><tr><th>Customer</th><th style={{ textAlign: 'right' }}>Invoiced</th><th style={{ textAlign: 'right' }}>Collected</th></tr></thead>
              <tbody>
                {d.byCustomer.map((r) => <tr key={r.name}><td>{r.name}</td><td style={{ textAlign: 'right' }}>{money(r.invoiced)}</td><td style={{ textAlign: 'right' }}>{money(r.collected)}</td></tr>)}
                {!d.byCustomer.length && <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: 20 }}>—</td></tr>}
              </tbody>
            </table>
          </Section>

          <Section title={`Completed work (${d.completed.length})`} onExport={() => downloadCsv(`completed_work_${range.from}_${range.to}.csv`, ['Number', 'Title', 'Customer', 'Assignee', 'Completed', 'Billable', 'Cost', 'Margin'], d.completed.map((r) => [r.number, r.title, r.customer, r.assignee, r.completed_at, r.billable, r.cost, r.margin]))}>
            <table className="data" style={{ minWidth: 620 }}>
              <thead><tr><th>#</th><th>Title</th><th>Customer</th><th>Completed</th><th style={{ textAlign: 'right' }}>Billable</th><th style={{ textAlign: 'right' }}>Margin</th></tr></thead>
              <tbody>
                {d.completed.map((r) => <tr key={r.number}><td>{r.number}</td><td>{r.title}</td><td>{r.customer}</td><td>{r.completed_at}</td><td style={{ textAlign: 'right' }}>{money(r.billable)}</td><td style={{ textAlign: 'right' }}>{money(r.margin)}</td></tr>)}
                {!d.completed.length && <tr><td colSpan={6} className="muted" style={{ textAlign: 'center', padding: 20 }}>No work completed in range.</td></tr>}
              </tbody>
            </table>
          </Section>

          <Section title={`Labor by technician (${d.byTech.length})`} onExport={() => downloadCsv(`labor_${range.from}_${range.to}.csv`, ['Technician', 'Hours', 'Jobs completed'], d.byTech.map((r) => [r.email, r.hours, r.jobs]))}>
            <table className="data" style={{ minWidth: 360 }}>
              <thead><tr><th>Technician</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Jobs</th></tr></thead>
              <tbody>
                {d.byTech.map((r) => <tr key={r.email}><td>{r.email}</td><td style={{ textAlign: 'right' }}>{r.hours.toFixed(1)}</td><td style={{ textAlign: 'right' }}>{r.jobs}</td></tr>)}
                {!d.byTech.length && <tr><td colSpan={3} className="muted" style={{ textAlign: 'center', padding: 20 }}>No labor logged in range.</td></tr>}
              </tbody>
            </table>
          </Section>
        </>
      )}
    </>
  );
}
