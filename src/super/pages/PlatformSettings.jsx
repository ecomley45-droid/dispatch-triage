import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { PageHeader, Field, Loading } from '../../components/ui.jsx';

// Super Admin → Platform. Platform-wide (Nexus Field) settings that aren't tied
// to any one workspace. Today: the favicon shown on the app origin, sign-in, and
// the console itself.
export default function PlatformSettings() {
  const [faviconUrl, setFaviconUrl] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [notice, setNotice] = useState(null);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get('/super/settings')
      .then((s) => { setFaviconUrl(s.branding?.faviconUrl || ''); setLoaded(true); })
      .catch((e) => { setErr(e.message); setLoaded(true); });
  }, []);

  const save = async () => {
    setNotice(null); setErr(null);
    try {
      const s = await api.patch('/super/settings', { branding: { faviconUrl } });
      const saved = s.branding?.faviconUrl || '';
      setFaviconUrl(saved);
      // Update the live tab icon immediately (the console pins /api/favicon).
      const link = document.querySelector("link[rel~='icon']");
      if (link) link.href = `/api/favicon?v=${Date.now()}`;
      setNotice(saved ? 'Saved. The Nexus Field favicon is updated everywhere.' : 'Cleared — using the built-in Nexus Field icon.');
    } catch (e) { setErr(e.message); }
  };

  if (!loaded) return <Loading label="Loading platform settings…" />;

  return (
    <div>
      <PageHeader title="Platform" subtitle="Nexus Field settings that apply across the whole platform — not to any one workspace." />
      {notice && <div className="card" style={{ padding: '10px 14px', marginBottom: 14 }}><span className="muted">{notice}</span></div>}
      {err && <div className="card" style={{ padding: '10px 14px', marginBottom: 14 }}><span className="muted">{err}</span></div>}

      <div className="card" style={{ padding: 18, maxWidth: 620 }}>
        <h3 style={{ marginTop: 0 }}>Favicon</h3>
        <p className="muted" style={{ marginTop: 0, fontSize: 13 }}>
          The browser-tab icon for the app origin, sign-in, and this console. Individual workspaces set their own under Workspace → Branding; this is the default for everything else. Leave blank to use the built-in Nexus Field mark.
        </p>
        <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1 }}>
            <Field label="Favicon URL (PNG, SVG, or .ico)">
              <input className="input" value={faviconUrl} onChange={(e) => setFaviconUrl(e.target.value)} placeholder="https://…/nexus-favicon.png" />
            </Field>
          </div>
          {faviconUrl ? <img src={faviconUrl} alt="" style={{ width: 34, height: 34, borderRadius: 6, objectFit: 'cover', border: '1px solid var(--border)' }} /> : null}
        </div>
        <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={save}>Save favicon</button>
      </div>
    </div>
  );
}
