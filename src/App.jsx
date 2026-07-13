import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useMe } from './lib/useMe.jsx';
import Layout from './components/Layout.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Projects from './pages/Projects.jsx';
import ProjectDetail from './pages/ProjectDetail.jsx';
import Dispatch from './pages/Dispatch.jsx';
import Items from './pages/Items.jsx';
import Team from './pages/Team.jsx';

export default function App() {
  const me = useMe();

  if (me.loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }} className="muted">Loading workspace…</div>;
  }
  if (me.error || !me.viewer) {
    return (
      <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
        <div className="card" style={{ padding: 28, maxWidth: 420, textAlign: 'center' }}>
          <h2 style={{ marginTop: 0 }}>Not signed in</h2>
          <p className="muted">{me.error || 'No active session. Configure Clerk keys, or run with the dev bypass (no CLERK_SECRET_KEY).'}</p>
        </div>
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/dispatch" element={<Dispatch />} />
          <Route path="/items" element={<Items />} />
          <Route path="/team" element={<Team />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
