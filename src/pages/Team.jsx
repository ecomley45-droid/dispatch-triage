import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge, Modal, Field, useIsMobile } from '../components/ui.jsx';
import { usePresence } from '../lib/presence.js';

// Green (online) / gray (offline) presence dot.
function OnlineDot({ on, since }) {
  return (
    <span
      title={on ? `Online${since ? ` since ${new Date(since).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}` : 'Offline'}
      style={{ display: 'inline-block', width: 9, height: 9, borderRadius: 999, marginRight: 8, verticalAlign: 'middle', flexShrink: 0,
        background: on ? 'var(--success)' : 'var(--border)',
        boxShadow: on ? '0 0 0 3px color-mix(in srgb, var(--success) 22%, transparent)' : 'none' }}
    />
  );
}

const ROLES = ['org_admin', 'manager_admin', 'accountant_admin', 'dispatcher'];
const ROLE_LABEL = { org_admin: 'Org Admin', manager_admin: 'Manager Admin', accountant_admin: 'Accountant Admin', dispatcher: 'Dispatcher' };
const ROLE_DESC = {
  org_admin: 'Owner — everything a manager can do, plus roles & permissions, integrations, and data export.',
  manager_admin: 'Runs a team or region — dispatch, work orders, customers, invoices, reports. No workspace configuration.',
  accountant_admin: 'Manages item costs, service rates, and financials. Read-only on dispatch.',
  dispatcher: 'Schedules jobs, works punch items, logs time and material usage.',
  technician: 'Field tech — sees only their own assigned work orders (view + notes/photos), personal schedule (clock in), and item logging.',
};
const BLANK = { user_email: '', name: '', role: 'dispatcher', region_id: '', team_id: '' };

// Teams management (managers): create teams under a region, rename, delete.
function TeamsSection({ regions, teams, reload }) {
  const [form, setForm] = useState({ name: '', region_id: '' });
  const add = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) return;
    try { await api.post('/teams', { name: form.name.trim(), region_id: form.region_id || null }); setForm({ name: '', region_id: '' }); reload(); }
    catch (ex) { alert(ex.message); }
  };
  const rename = async (t) => { const n = prompt('Team name', t.name); if (n == null || !n.trim() || n.trim() === t.name) return; try { await api.patch(`/teams/${t.id}`, { name: n.trim() }); reload(); } catch (ex) { alert(ex.message); } };
  const del = async (t) => { if (!confirm(`Delete team "${t.name}"?`)) return; try { await api.del(`/teams/${t.id}`); reload(); } catch (ex) { alert(ex.message); } };
  const regionName = (id) => regions.find((r) => r.id === id)?.name || '— no region —';
  return (
    <div className="card" style={{ padding: 18, marginBottom: 20 }}>
      <h3 style={{ marginTop: 0 }}>Teams</h3>
      <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Teams are a subsection of a region. Assign members to a team to scope their view.</p>
      {teams.map((t) => (
        <div key={t.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderTop: '1px solid var(--border)' }}>
          <span style={{ fontWeight: 600 }}>{t.name}</span>
          <span className="muted" style={{ fontSize: 12.5 }}>· {regionName(t.region_id)}</span>
          <button className="btn" style={{ padding: '4px 10px', marginLeft: 'auto' }} onClick={() => rename(t)}>Rename</button>
          <button className="btn btn-danger" style={{ padding: '4px 10px' }} onClick={() => del(t)}>Delete</button>
        </div>
      ))}
      {!teams.length && <p className="muted">No teams yet.</p>}
      <form onSubmit={add} style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <input className="input" placeholder="New team name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} style={{ flex: '1 1 160px' }} />
        <select className="input" style={{ width: 'auto' }} value={form.region_id} onChange={(e) => setForm({ ...form, region_id: e.target.value })}>
          <option value="">— region —</option>
          {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
        </select>
        <button className="btn btn-primary" type="submit">Add team</button>
      </form>
    </div>
  );
}

export default function Team() {
  const me = useMe();
  const [members, setMembers] = useState([]);
  const [regions, setRegions] = useState([]);
  const [teams, setTeams] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const canManage = me.can('members:write');
  const isMobile = useIsMobile();
  const online = usePresence(me.org?.id, me.viewer);
  const isOnline = (email) => !!online[String(email).toLowerCase()];
  const onlineCount = members.filter((m) => isOnline(m.user_email)).length;

  const [roles, setRoles] = useState([]);
  const roleLabel = Object.fromEntries(roles.map((r) => [r.key, r.name]));
  // Managers can build a team but can't hand out the Org Admin (owner) role, so
  // only offer it to someone who can manage roles. (The server enforces this too.)
  const assignRoles = (me.can('roles:write') ? roles : roles.filter((r) => r.key !== 'org_admin')).filter((r) => !r.hidden);
  const load = () => api.get('/members').then(setMembers).catch(() => setMembers([]));
  const loadStructure = () => { api.get('/regions').then(setRegions).catch(() => {}); api.get('/teams').then(setTeams).catch(() => {}); };
  useEffect(() => { load(); loadStructure(); api.get('/roles').then(setRoles).catch(() => setRoles([])); }, []);
  const regionName = (id) => regions.find((r) => r.id === id)?.name || '—';
  const teamName = (id) => teams.find((t) => t.id === id)?.name || '—';
  const setMemberField = async (email, patch) => { try { await api.patch(`/members/${encodeURIComponent(email)}`, patch); load(); } catch (ex) { alert(ex.message); } };

  const exportData = async () => {
    try {
      const data = await api.get('/export');
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `dispatch-export-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setNotice(`Export failed: ${e.message}`); }
  };

  const invite = async (e) => {
    e.preventDefault();
    setSaving(true); setError(null);
    try {
      const res = await api.post('/members', form);
      const email = form.user_email;
      setOpen(false); setForm(BLANK); load();
      setNotice(res?.invited
        ? `Invitation email sent to ${email}.`
        : `${email} added — they'll get access on first sign-in with that email.`);
    } catch (ex) { setError(ex.message); } finally { setSaving(false); }
  };

  const changeRole = async (email, role) => {
    await api.patch(`/members/${encodeURIComponent(email)}`, { role });
    load();
  };

  const remove = async (email) => {
    if (!confirm(`Remove ${email} from the workspace?`)) return;
    try { await api.del(`/members/${encodeURIComponent(email)}`); load(); }
    catch (ex) { alert(ex.message); }
  };

  return (
    <>
      <PageHeader title="Users" subtitle={`Workspace members · ${onlineCount} online now`}
        action={canManage && (
          <div style={{ display: 'flex', gap: 8 }}>
            {me.can('integrations:write') && <button className="btn" onClick={exportData} title="Download a full JSON backup of this workspace">Export data</button>}
            <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Invite member</button>
          </div>
        )} />

      {notice && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 14, borderColor: 'var(--success)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{notice}</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      {isMobile ? (
        <div className="m-cards" style={{ marginBottom: 20 }}>
          {members.map((m) => {
            const isSelf = m.user_email === me.viewer?.email;
            return (
              <div key={m.user_email} className="m-card" style={{ cursor: 'default' }}>
                <div className="m-card-head">
                  <div style={{ minWidth: 0 }}>
                    <div className="m-title"><OnlineDot on={isOnline(m.user_email)} since={online[m.user_email.toLowerCase()]?.online_at} />{m.name || '—'}{isSelf && <span className="muted"> (you)</span>}</div>
                    <div className="m-meta">{m.user_email}</div>
                  </div>
                  {m.joined_at ? <span className="badge badge-green">active</span> : <span className="badge badge-amber">pending</span>}
                </div>
                <div className="m-facts" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                  {canManage && !isSelf ? (
                    <select className="input" style={{ width: 180 }} value={m.role} onChange={(e) => changeRole(m.user_email, e.target.value)}>
                      {assignRoles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                    </select>
                  ) : <Badge value={roleLabel[m.role] || m.role} />}
                  {canManage && !isSelf && <button className="btn btn-danger" style={{ padding: '6px 12px' }} onClick={() => remove(m.user_email)}>Remove</button>}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
      <div className="card" style={{ marginBottom: 20 }}>
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th>{regions.length > 0 && <th>Region</th>}{teams.length > 0 && <th>Team</th>}<th>Status</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.user_email === me.viewer?.email;
              return (
                <tr key={m.user_email}>
                  <td style={{ fontWeight: 600 }}><OnlineDot on={isOnline(m.user_email)} since={online[m.user_email.toLowerCase()]?.online_at} />{m.name || '—'}{isSelf && <span className="muted"> (you)</span>}</td>
                  <td className="muted">{m.user_email}</td>
                  <td>
                    {canManage && !isSelf ? (
                      <select className="input" style={{ width: 180 }} value={m.role} onChange={(e) => changeRole(m.user_email, e.target.value)}>
                        {assignRoles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
                      </select>
                    ) : <Badge value={roleLabel[m.role] || m.role} />}
                  </td>
                  {regions.length > 0 && <td>
                    {canManage ? (
                      <select className="input" style={{ width: 150 }} value={m.region_id || ''} onChange={(e) => setMemberField(m.user_email, { region_id: e.target.value || null })}>
                        <option value="">—</option>
                        {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </select>
                    ) : regionName(m.region_id)}
                  </td>}
                  {teams.length > 0 && <td>
                    {canManage ? (
                      <select className="input" style={{ width: 150 }} value={m.team_id || ''} onChange={(e) => setMemberField(m.user_email, { team_id: e.target.value || null })}>
                        <option value="">—</option>
                        {teams.filter((t) => !m.region_id || !t.region_id || t.region_id === m.region_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                      </select>
                    ) : teamName(m.team_id)}
                  </td>}
                  <td>{m.joined_at ? <span className="badge badge-green">active</span> : <span className="badge badge-amber">pending</span>}</td>
                  {canManage && <td>{!isSelf && <button className="btn btn-danger" style={{ padding: '4px 10px' }} onClick={() => remove(m.user_email)}>Remove</button>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      )}

      {canManage && me.can('teams:write') && <TeamsSection regions={regions} teams={teams} reload={loadStructure} />}

      <h3>Role permissions</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {roles.map((r) => (
          <div key={r.key} className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{r.name} {r.preset ? '' : <span className="badge">custom</span>}</div>
            <div className="muted" style={{ fontSize: 13 }}>{ROLE_DESC[r.key] || `Sees ${r.permissions.pages.length} pages · ${r.permissions.caps.length} permissions`}</div>
          </div>
        ))}
      </div>

      {open && (
        <Modal title="Invite member" onClose={() => setOpen(false)}>
          <form onSubmit={invite}>
            <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>They get access with the role below the first time they sign in with this email (Microsoft or otherwise).</p>
            <Field label="Email"><input className="input" type="email" required value={form.user_email} onChange={(e) => setForm({ ...form, user_email: e.target.value })} /></Field>
            <Field label="Name (optional)"><input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></Field>
            <Field label="Role">
              <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
                {assignRoles.map((r) => <option key={r.key} value={r.key}>{r.name}</option>)}
              </select>
            </Field>
            <p className="muted" style={{ fontSize: 12 }}>{ROLE_DESC[form.role]}</p>
            {(regions.length > 0 || teams.length > 0) && (
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                {regions.length > 0 && (
                  <Field label="Region (optional — else the role's default)">
                    <select className="input" value={form.region_id} onChange={(e) => setForm({ ...form, region_id: e.target.value })}>
                      <option value="">— default —</option>
                      {regions.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                    </select>
                  </Field>
                )}
                {teams.length > 0 && (
                  <Field label="Team (optional)">
                    <select className="input" value={form.team_id} onChange={(e) => setForm({ ...form, team_id: e.target.value })}>
                      <option value="">— none —</option>
                      {teams.filter((t) => !form.region_id || !t.region_id || t.region_id === form.region_id).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                  </Field>
                )}
              </div>
            )}
            {error && <p className="badge badge-red">{error}</p>}
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
              <button type="button" className="btn" onClick={() => setOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={saving}>{saving ? 'Inviting…' : 'Send invite'}</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
