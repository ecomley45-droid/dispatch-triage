import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { PageHeader, Loading, Modal } from '../../components/ui.jsx';

// Super Admin → Role defaults. Edit the platform-wide default pages + capabilities
// for each built-in role. On save, choose whether to override the customizations
// individual workspaces have made, or leave those alone.
export default function RoleDefaults() {
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [sel, setSel] = useState(null);          // role key being edited
  const [draft, setDraft] = useState(null);       // { pages:Set, caps:Set }
  const [confirm, setConfirm] = useState(false);
  const [notice, setNotice] = useState(null);

  const load = () => api.get('/super/role-defaults').then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, []);

  const edit = (role) => {
    setSel(role.key);
    setDraft({ pages: new Set(role.effective.pages), caps: new Set(role.effective.caps) });
  };
  const togglePage = (k) => setDraft((d) => {
    const pages = new Set(d.pages);
    if (pages.has(k)) pages.delete(k); else pages.add(k);
    return { ...d, pages };
  });
  const toggleCap = (k) => setDraft((d) => {
    const caps = new Set(d.caps);
    if (caps.has(k)) caps.delete(k); else caps.add(k);
    return { ...d, caps };
  });

  const doSave = async (applyToWorkspaces) => {
    try {
      await api.patch(`/super/role-defaults/${sel}`, {
        permissions: { pages: [...draft.pages], caps: [...draft.caps] },
        applyToWorkspaces,
      });
      setConfirm(false); setSel(null); setDraft(null);
      setNotice(applyToWorkspaces
        ? 'Saved and applied to every workspace (their page customizations were reset).'
        : 'Default saved. Workspaces that customized this role keep their changes.');
      load();
    } catch (e) { setErr(e.message); }
  };

  if (err && !data) return <div style={{ padding: 24 }}><p className="muted">{err}</p></div>;
  if (!data) return <Loading label="Loading role defaults…" />;

  const role = data.roles.find((r) => r.key === sel);

  return (
    <div>
      <PageHeader title="Role defaults" subtitle="Platform-wide permissions for the built-in roles — applies to every workspace unless a workspace overrides it." />
      {notice && <div className="card" style={{ padding: '10px 14px', marginBottom: 14 }}><span className="muted">{notice}</span></div>}
      {err && <div className="card" style={{ padding: '10px 14px', marginBottom: 14 }}><span className="muted">{err}</span></div>}

      <div className="card" style={{ padding: 0, overflow: 'hidden' }}>
        {data.roles.map((r) => (
          <div key={r.key} style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '14px 18px', borderTop: '1px solid var(--border)' }}>
            <div style={{ flex: 1 }}>
              <div style={{ fontWeight: 700 }}>{r.label} {r.restricted && <span className="badge" style={{ fontSize: 10 }}>self-scoped</span>}</div>
              <div className="muted" style={{ fontSize: 12.5 }}>{r.effective.pages.length} pages · {r.effective.caps.length} capabilities</div>
            </div>
            <button className="btn" onClick={() => edit(r)}>Edit</button>
          </div>
        ))}
      </div>

      {role && draft && (
        <Modal title={`Default permissions — ${role.label}`} onClose={() => { setSel(null); setDraft(null); }}>
          <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>Pick the pages this role can see and the actions it can take, across all workspaces.</p>
          <div style={{ maxHeight: '52vh', overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: 10 }}>
            {data.pages.map((p) => {
              const on = draft.pages.has(p.key);
              return (
                <div key={p.key} style={{ padding: '8px 0', borderTop: '1px solid var(--border)' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 600, fontSize: 13.5 }}>
                    <input type="checkbox" checked={on} onChange={() => togglePage(p.key)} /> {p.label}
                    <span className="muted" style={{ fontWeight: 400, fontSize: 12 }}>can view</span>
                  </label>
                  {on && p.caps.length > 0 && (
                    <div style={{ paddingLeft: 26, marginTop: 6, display: 'grid', gap: 4 }}>
                      {p.caps.map((c) => (
                        <label key={c.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                          <input type="checkbox" checked={draft.caps.has(c.key)} onChange={() => toggleCap(c.key)} /> {c.label}
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
            <button className="btn" onClick={() => { setSel(null); setDraft(null); }}>Cancel</button>
            <button className="btn btn-primary" onClick={() => setConfirm(true)}>Save default</button>
          </div>
        </Modal>
      )}

      {confirm && (
        <Modal title="Apply to existing workspaces?" onClose={() => setConfirm(false)}>
          <p style={{ marginTop: 0, fontSize: 14 }}>
            Some workspaces may have customized the pages this role sees. Choose how to apply the new default:
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 8 }}>
            <button className="btn btn-primary" onClick={() => doSave(true)}>
              Override every workspace — reset their customizations to this default
            </button>
            <button className="btn" onClick={() => doSave(false)}>
              Set the default only — keep workspaces that already customized it
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
