import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge, Modal, Field } from '../components/ui.jsx';

const ROLES = ['manager_admin', 'accountant_admin', 'dispatcher'];
const ROLE_LABEL = { manager_admin: 'Manager Admin', accountant_admin: 'Accountant Admin', dispatcher: 'Dispatcher' };
const ROLE_DESC = {
  manager_admin: 'Full access — projects, dispatch, items, and team.',
  accountant_admin: 'Manages item costs, service rates, and financials. Read-only on dispatch.',
  dispatcher: 'Schedules jobs, works punch items, logs time and material usage.',
};
const BLANK = { user_email: '', name: '', role: 'dispatcher' };

export default function Team() {
  const me = useMe();
  const [members, setMembers] = useState([]);
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);
  const canManage = me.can('members:write');

  const load = () => api.get('/members').then(setMembers).catch(() => setMembers([]));
  useEffect(() => { load(); }, []);

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
      <PageHeader title="Team" subtitle="Workspace members and their roles"
        action={canManage && <button className="btn btn-primary" onClick={() => setOpen(true)}>+ Invite member</button>} />

      {notice && (
        <div className="card" style={{ padding: '10px 14px', marginBottom: 14, borderColor: 'var(--success)', display: 'flex', justifyContent: 'space-between', gap: 12 }}>
          <span>{notice}</span>
          <button className="btn" style={{ padding: '2px 8px' }} onClick={() => setNotice(null)}>Dismiss</button>
        </div>
      )}

      <div className="card" style={{ marginBottom: 20 }}>
        <table className="data">
          <thead><tr><th>Name</th><th>Email</th><th>Role</th><th>Status</th>{canManage && <th></th>}</tr></thead>
          <tbody>
            {members.map((m) => {
              const isSelf = m.user_email === me.viewer?.email;
              return (
                <tr key={m.user_email}>
                  <td style={{ fontWeight: 600 }}>{m.name || '—'}{isSelf && <span className="muted"> (you)</span>}</td>
                  <td className="muted">{m.user_email}</td>
                  <td>
                    {canManage && !isSelf ? (
                      <select className="input" style={{ width: 180 }} value={m.role} onChange={(e) => changeRole(m.user_email, e.target.value)}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
                      </select>
                    ) : <Badge value={m.role} />}
                  </td>
                  <td>{m.joined_at ? <span className="badge badge-green">active</span> : <span className="badge badge-amber">pending</span>}</td>
                  {canManage && <td>{!isSelf && <button className="btn btn-danger" style={{ padding: '4px 10px' }} onClick={() => remove(m.user_email)}>Remove</button>}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <h3>Role permissions</h3>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(240px, 1fr))', gap: 14 }}>
        {ROLES.map((role) => (
          <div key={role} className="card" style={{ padding: 16 }}>
            <div style={{ fontWeight: 700, marginBottom: 4 }}>{ROLE_LABEL[role]}</div>
            <div className="muted" style={{ fontSize: 13 }}>{ROLE_DESC[role]}</div>
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
                {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABEL[r]}</option>)}
              </select>
            </Field>
            <p className="muted" style={{ fontSize: 12 }}>{ROLE_DESC[form.role]}</p>
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
