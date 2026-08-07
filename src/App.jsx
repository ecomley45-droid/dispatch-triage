import { lazy, Suspense } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useMe } from './lib/useMe.jsx';
import Layout from './components/Layout.jsx';

// Route-level code splitting: each page (and its heavy deps — e.g. Leaflet on
// the Map) is a separate chunk fetched on first navigation, not in the initial
// bundle. Dashboard is the landing route so it can stay eager, but lazy keeps
// the split uniform and the first paint small.
const Dashboard = lazy(() => import('./pages/Dashboard.jsx'));
const Customers = lazy(() => import('./pages/Customers.jsx'));
const CustomerDetail = lazy(() => import('./pages/CustomerDetail.jsx'));
const WorkOrders = lazy(() => import('./pages/WorkOrders.jsx'));
const WorkOrderDetail = lazy(() => import('./pages/WorkOrderDetail.jsx'));
const WorkOrderInvoice = lazy(() => import('./pages/WorkOrderInvoice.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail.jsx'));
const Dispatch = lazy(() => import('./pages/Dispatch.jsx'));
const JobDetail = lazy(() => import('./pages/JobDetail.jsx'));
const MapView = lazy(() => import('./pages/MapView.jsx'));
const Items = lazy(() => import('./pages/Items.jsx'));
const Timesheets = lazy(() => import('./pages/Timesheets.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

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
        <Suspense fallback={<div style={{ display: 'grid', placeItems: 'center', padding: 48 }} className="muted">Loading…</div>}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/work-orders" element={<WorkOrders />} />
          <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
          <Route path="/work-orders/:id/invoice" element={<WorkOrderInvoice />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/dispatch" element={<Dispatch />} />
          <Route path="/dispatch/:id" element={<JobDetail />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/items" element={<Items />} />
          <Route path="/timesheets" element={<Timesheets />} />
          <Route path="/team" element={<Team />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
