import { lazy, Suspense, useEffect } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { useMe } from './lib/useMe.jsx';
import Layout from './components/Layout.jsx';
import { Loading } from './components/ui.jsx';
import { PAGES } from '../lib/permissions.js';
import { RESERVED_SEGMENTS } from './lib/routes.js';

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
const Invoices = lazy(() => import('./pages/Invoices.jsx'));
const InvoiceDetail = lazy(() => import('./pages/InvoiceDetail.jsx'));
const Schedule = lazy(() => import('./pages/Schedule.jsx'));
const AuditLog = lazy(() => import('./pages/AuditLog.jsx'));
const Help = lazy(() => import('./pages/Help.jsx'));
const Maintenance = lazy(() => import('./pages/Maintenance.jsx'));
const Reports = lazy(() => import('./pages/Reports.jsx'));
const Projects = lazy(() => import('./pages/Projects.jsx'));
const ProjectDetail = lazy(() => import('./pages/ProjectDetail.jsx'));
const Dispatch = lazy(() => import('./pages/Dispatch.jsx'));
const JobDetail = lazy(() => import('./pages/JobDetail.jsx'));
const MapView = lazy(() => import('./pages/MapView.jsx'));
const Items = lazy(() => import('./pages/Items.jsx'));
const Timesheets = lazy(() => import('./pages/Timesheets.jsx'));
const Team = lazy(() => import('./pages/Team.jsx'));
const Settings = lazy(() => import('./pages/Settings.jsx'));

// The active workspace slug lives in the URL: /space/<slug>/...
// Workspaces live at bare /:orgSlug. The slug is the first path segment unless
// it's a reserved top-level word (super-admin, sign-in, legal, portal…).
const spaceSlug = () => { const s = window.location.pathname.split('/')[1] || ''; return s && !RESERVED_SEGMENTS.has(s) ? s : null; };

// Route guard: if the current route maps to a page the role can't see, bounce to
// the dashboard. Client-side UX guard; the server enforces reads/writes too.
function PageGuard({ pages }) {
  const loc = useLocation();
  const nav = useNavigate();
  useEffect(() => {
    const first = loc.pathname.split('/')[1] || '';
    const page = PAGES.find((p) => p.path === (first ? `/${first}` : '/'));
    if (page && !pages.includes(page.key)) nav('/', { replace: true });
  }, [loc.pathname, pages, nav]);
  return null;
}

// Landing on the app root (no /:orgSlug): route the user onward.
//   super-admin  → /super-admin (their home; they may have no workspace)
//   1 membership → straight into it
//   several      → pick one
//   none         → a clear message
function WorkspacePicker({ me }) {
  if (me.isSuperAdmin || me.platformAdmin) { window.location.replace('/super-admin'); return null; }
  const spaces = me.memberships?.length ? me.memberships : (me.org ? [{ id: me.org.id, name: me.org.name }] : []);
  if (spaces.length === 1) { window.location.replace(`/${spaces[0].id}`); return null; }
  return (
    <div style={{ display: 'grid', placeItems: 'center', height: '100%', padding: 24 }}>
      <div className="card" style={{ padding: 28, maxWidth: 460, width: '100%' }}>
        <h2 style={{ marginTop: 0 }}>Choose a workspace</h2>
        {spaces.length ? spaces.map((s) => (
          <a key={s.id} href={`/${s.id}`} className="btn" style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8, textDecoration: 'none' }}>
            <span style={{ fontWeight: 600 }}>{s.name}</span><span className="muted" style={{ fontSize: 12 }}>{s.id}</span>
          </a>
        )) : <p className="muted">You’re not a member of any workspace yet. Ask your administrator for an invite.</p>}
      </div>
    </div>
  );
}

export default function App() {
  const me = useMe();
  const slug = spaceSlug();

  if (me.loading) {
    return <div style={{ display: 'grid', placeItems: 'center', height: '100%' }}><Loading label="Loading workspace…" /></div>;
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
  // No workspace in the URL → route the user into one.
  if (!slug) return <WorkspacePicker me={me} />;

  return (
    <BrowserRouter basename={`/${slug}`}>
      <PageGuard pages={me.pages || []} />
      <Layout>
        <Suspense fallback={<Loading label="Loading…" />}>
        <Routes>
          <Route path="/" element={<Dashboard />} />
          <Route path="/reports" element={<Reports />} />
          <Route path="/customers" element={<Customers />} />
          <Route path="/customers/:id" element={<CustomerDetail />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/work-orders" element={<WorkOrders />} />
          <Route path="/work-orders/:id" element={<WorkOrderDetail />} />
          <Route path="/work-orders/:id/invoice" element={<WorkOrderInvoice />} />
          <Route path="/maintenance" element={<Maintenance />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/projects" element={<Projects />} />
          <Route path="/projects/:id" element={<ProjectDetail />} />
          <Route path="/dispatch" element={<Dispatch />} />
          <Route path="/dispatch/:id" element={<JobDetail />} />
          <Route path="/map" element={<MapView />} />
          <Route path="/items" element={<Items />} />
          <Route path="/timesheets" element={<Timesheets />} />
          <Route path="/team" element={<Team />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/audit" element={<AuditLog />} />
          <Route path="/help" element={<Help />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  );
}
