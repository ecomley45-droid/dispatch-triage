import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api.js';
import { PageHeader, Loading } from '../../components/ui.jsx';
import { useSuperMe } from '../useSuperMe.jsx';

const statusTone = (s) => (s === 'active' ? 'badge-green' : s === 'past_due' || s === 'canceled' ? 'badge-red' : '');

export default function Billing() {
  const me = useSuperMe();
  const [orgs, setOrgs] = useState(null);
  const [err, setErr] = useState(null);
  useEffect(() => { api.get('/super/orgs').then(setOrgs).catch((e) => setErr(e.message)); }, []);

  const byPlan = {};
  for (const o of orgs || []) byPlan[o.plan] = (byPlan[o.plan] || 0) + 1;

  return (
    <>
      <PageHeader title="Billing" subtitle="Plans and subscriptions across every workspace" />
      {!me.features?.payments && <div className="card" style={{ padding: '10px 14px', marginBottom: 16 }}><span className="muted">Stripe is not configured (<code>STRIPE_SECRET_KEY</code>). Plans and statuses below are managed manually per workspace.</span></div>}
      {err && <p className="badge badge-red">{err}</p>}
      {!orgs && !err && <Loading label="Loading billing…" />}

      {orgs && (
        <>
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 18 }}>
            {Object.entries(byPlan).map(([plan, n]) => (
              <div key={plan} className="card" style={{ padding: 16, flex: '1 1 140px', minWidth: 130 }}>
                <div className="muted" style={{ fontSize: 12, fontWeight: 600, textTransform: 'capitalize' }}>{plan}</div>
                <div style={{ fontSize: 26, fontWeight: 800, marginTop: 4 }}>{n}</div>
              </div>
            ))}
          </div>
          <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
            <table className="data" style={{ width: '100%' }}>
              <thead><tr><th>Workspace</th><th>Plan</th><th>Subscription</th><th>Billing email</th><th>Stripe</th></tr></thead>
              <tbody>
                {orgs.map((o) => (
                  <tr key={o.id}>
                    <td><Link to={`/workspaces/${o.id}`}>{o.branding?.displayName || o.name}</Link></td>
                    <td><span className="badge badge-blue">{o.plan}</span></td>
                    <td>{o.subscription_status ? <span className={`badge ${statusTone(o.subscription_status)}`}>{o.subscription_status}</span> : <span className="muted">—</span>}</td>
                    <td className="muted">{o.billing_email || '—'}</td>
                    <td>{o.has_stripe_customer ? <span className="badge badge-green">linked</span> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </>
  );
}
