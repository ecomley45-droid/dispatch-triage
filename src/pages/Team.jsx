import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge } from '../components/ui.jsx';

const ROLE_LABEL = { manager_admin: 'Manager Admin', accountant_admin: 'Accountant Admin', dispatcher: 'Dispatcher' };
const ROLE_DESC = {
  manager_admin: 'Full access — projects, dispatch, items, and team.',
  accountant_admin: 'Manages item costs, service rates, and financials. Read-only on dispatch.',
  dispatcher: 'Schedules jobs, works punch items, logs time and material usage.',
};

export default function Team() {
  const me = useMe();
  const [members, setMembers] = useState([]);

  useEffect(() => { api.get('/members').then(setMembers).catch(() => setMembers([])); }, []);

  return (
    <>
      <PageHeader title="Team" subtitle="Workspace members and their roles" />

      <div className="card" style={{ marginBottom: 20 }}>
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th></tr></thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.user_email}>
                <td style={{ fontWeight: 600 }}>{m.name || '—'}{m.user_email === me.viewer?.email && <span className="muted"> (you)</span>}</td>
                <td className="muted">{m.user_email}</td>
                <td><Badge value={m.role} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h3>Role permissions</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {Object.entries(ROLE_LABEL).map(([role, label]) => (
          <div key={role} className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
            <div className="muted" style={{ fontSize: 13 }}>{ROLE_DESC[role]}</div>
          </div>
        ))}
      </div>
      {me.can('members:write') && <p className="muted" style={{ marginTop: 16, fontSize: 13 }}>Invite &amp; role management UI is stubbed — wire it to <code>POST /api/members</code> next (see HANDOFF.md).</p>}
    </>
  );
}
