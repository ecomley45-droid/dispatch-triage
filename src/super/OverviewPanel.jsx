// Per-workspace executive overview — the metrics the old client-side /owner
// dashboard showed, now rendered inside the super-admin console for any org.
// Presentational: the caller fetches /super/orgs/:id/overview and passes `d`.
import { money, Loading } from '../components/ui.jsx';

const kFmt = (n) => { const v = Number(n || 0); return Math.abs(v) >= 1000 ? `$${(v / 1000).toFixed(1)}k` : money(v); };

function Tile({ label, value, hint, tone }) {
  const color = tone === 'bad' ? 'var(--danger)' : tone === 'good' ? 'var(--brand-green-text)' : 'var(--text)';
  return (
    <div className="card" style={{ padding: 16, flex: '1 1 160px', minWidth: 150 }}>
      <div className="muted" style={{ fontSize: 12, fontWeight: 600 }}>{label}</div>
      <div style={{ fontSize: 26, fontWeight: 800, letterSpacing: '-0.02em', marginTop: 4, color }}>{value}</div>
      {hint && <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{hint}</div>}
    </div>
  );
}

function Bars({ data }) {
  const max = Math.max(1, ...data.map((x) => x.total));
  return (
    <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, height: 170, paddingTop: 8 }}>
      {data.map((x) => (
        <div key={x.key} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, minWidth: 0 }}>
          <div style={{ fontSize: 10.5, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{x.total ? kFmt(x.total) : ''}</div>
          <div title={money(x.total)} style={{ width: '100%', maxWidth: 46, height: `${Math.round((x.total / max) * 120) + 3}px`, background: 'var(--primary)', borderRadius: '6px 6px 0 0', transition: 'height .3s' }} />
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{x.label}</div>
        </div>
      ))}
    </div>
  );
}

export default function OverviewPanel({ d }) {
  if (!d) return <Loading label="Crunching the numbers…" />;
  const maxCust = Math.max(1, ...d.topCustomers.map((c) => c.total));
  return (
    <>
      <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', margin: '2px 0 8px' }}>Money</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <Tile label="Collected (all-time)" value={money(d.money.collected)} tone="good" />
        <Tile label="Outstanding A/R" value={money(d.money.outstandingAR)} hint="unpaid, sent" />
        <Tile label="Overdue A/R" value={money(d.money.overdueAR)} tone={d.money.overdueAR > 0 ? 'bad' : undefined} hint="past due date" />
        <Tile label="Invoiced this month" value={money(d.money.invoicedThisMonth)} />
        <Tile label="Gross margin" value={money(d.money.margin)} hint={`${d.money.marginPct}% · billable ${kFmt(d.money.billable)}`} tone={d.money.margin >= 0 ? 'good' : 'bad'} />
      </div>

      <div className="muted" style={{ fontSize: 11.5, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', margin: '2px 0 8px' }}>Operations</div>
      <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 22 }}>
        <Tile label="Open work orders" value={d.ops.woOpen} hint={`${d.ops.woTotal} all-time`} />
        <Tile label="Overdue SLA" value={d.ops.woOverdue} tone={d.ops.woOverdue > 0 ? 'bad' : undefined} />
        <Tile label="Completed this month" value={d.ops.woCompletedThisMonth} />
        <Tile label="Awaiting approval" value={d.ops.awaitingApproval} tone={d.ops.awaitingApproval > 0 ? 'bad' : undefined} />
        <Tile label="Customers" value={d.ops.customers} />
        <Tile label="Maintenance due (30d)" value={d.ops.upcomingMaintenance} />
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 320px), 1fr))', gap: 16 }}>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Invoiced — last 6 months</h3>
          <Bars data={d.monthly} />
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Top customers</h3>
          {d.topCustomers.length ? d.topCustomers.map((c) => (
            <div key={c.name} style={{ margin: '10px 0' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, marginBottom: 3 }}><span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.name}</span><b>{money(c.total)}</b></div>
              <div style={{ height: 8, background: 'var(--surface-2)', borderRadius: 999 }}><div style={{ width: `${Math.round((c.total / maxCust) * 100)}%`, height: '100%', background: 'var(--primary)', borderRadius: 999 }} /></div>
            </div>
          )) : <p className="muted">No invoiced revenue yet.</p>}
        </div>
        <div className="card" style={{ padding: 18 }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Technician leaderboard</h3>
          {d.leaderboard.length ? (
            <table className="data">
              <thead><tr><th>Technician</th><th style={{ textAlign: 'right' }}>Hours</th><th style={{ textAlign: 'right' }}>Jobs done</th></tr></thead>
              <tbody>
                {d.leaderboard.map((t) => (
                  <tr key={t.email}><td>{t.email.split('@')[0]}</td><td style={{ textAlign: 'right' }}>{t.hours.toFixed(1)}</td><td style={{ textAlign: 'right' }}>{t.jobs}</td></tr>
                ))}
              </tbody>
            </table>
          ) : <p className="muted">No labor logged yet.</p>}
        </div>
      </div>
    </>
  );
}
