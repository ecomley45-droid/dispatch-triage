import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { SuperMeProvider, useSuperMe } from './useSuperMe.jsx';
import SuperLayout from './SuperLayout.jsx';
import { Loading } from '../components/ui.jsx';

const Workspaces = lazy(() => import('./pages/Workspaces.jsx'));
const WorkspaceDetail = lazy(() => import('./pages/WorkspaceDetail.jsx'));
const Billing = lazy(() => import('./pages/Billing.jsx'));
const Simulate = lazy(() => import('./pages/Simulate.jsx'));

function Denied({ message }) {
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
      <div className="card" style={{ padding: 28, maxWidth: 440, textAlign: 'center' }}>
        <h2 style={{ marginTop: 0 }}>Not authorized</h2>
        <p className="muted">{message || 'The Nexus Super Admin console is restricted to platform operators.'}</p>
        <a className="btn btn-primary" href="/" style={{ marginTop: 8 }}>Back to the app</a>
      </div>
    </div>
  );
}

function Gate() {
  const me = useSuperMe();
  if (me.loading) return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Loading label="Loading console…" /></div>;
  if (!me.platformAdmin) return <Denied message={me.error} />;
  // The console always lives at /super-admin on the app origin (single-origin
  // auth — admin.<domain> is only an edge redirect here).
  return (
    <BrowserRouter basename="/super-admin">
      <Suspense fallback={<Loading label="Loading…" />}>
        <Routes>
          {/* Full-bleed device simulator — deliberately outside SuperLayout so
              it isn't boxed in by the console's sidebar/topbar chrome. */}
          <Route path="/simulate/:id" element={<Simulate />} />
          <Route path="/*" element={
            <SuperLayout>
              <Routes>
                <Route path="/" element={<Workspaces />} />
                <Route path="/workspaces/:id" element={<WorkspaceDetail />} />
                <Route path="/billing" element={<Billing />} />
                <Route path="*" element={<Navigate to="/" replace />} />
              </Routes>
            </SuperLayout>
          } />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}

export default function SuperApp() {
  return (
    <SuperMeProvider>
      <Gate />
    </SuperMeProvider>
  );
}
