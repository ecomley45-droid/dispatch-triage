import { NavLink } from 'react-router-dom';
import { Building2, CreditCard, ShieldCheck } from 'lucide-react';
import { UserButton } from '@clerk/clerk-react';
import { useSuperMe } from './useSuperMe.jsx';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// The console deliberately uses a violet accent (not the client teal) so it is
// impossible to confuse the platform-operator surface with a client workspace.
const ACCENT = '#7c3aed';
const SIDEBAR_BG = '#1e1b2e';

const NAV = [
  { to: '/', label: 'Workspaces', icon: Building2, end: true },
  { to: '/billing', label: 'Billing', icon: CreditCard },
];

export default function SuperLayout({ children }) {
  const me = useSuperMe();
  return (
    <div className="app-shell" style={{ ['--primary']: ACCENT }}>
      <aside className="sidebar" style={{ background: SIDEBAR_BG }}>
        <div style={{ padding: '18px 18px 14px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: ACCENT, display: 'grid', placeItems: 'center', flexShrink: 0 }}>
            <ShieldCheck size={18} color="#fff" />
          </div>
          <div>
            <div style={{ fontWeight: 800, fontSize: 15, letterSpacing: '-0.01em', color: '#fff' }}>Nexus Super Admin</div>
            <div style={{ fontSize: 11, marginTop: 1, color: 'rgba(255,255,255,0.55)' }}>Platform operations</div>
          </div>
        </div>
        <nav style={{ padding: 8, flex: 1 }}>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
                marginBottom: 2, textDecoration: 'none', fontWeight: 600, fontSize: 13.5,
                color: isActive ? '#fff' : 'rgba(255,255,255,0.72)',
                background: isActive ? 'rgba(255,255,255,0.14)' : 'transparent',
              })}>
              <Icon size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,0.12)' }}>
          {/* On admin.<domain> the client app lives on the app.<domain> subdomain. */}
          <a href={window.location.hostname.startsWith('admin.') ? window.location.origin.replace('://admin.', '://app.') : '/'}
            style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.72)', textDecoration: 'none' }}>← Back to client app</a>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-brand">
            <ShieldCheck size={20} color={ACCENT} />
            <span style={{ fontWeight: 800, fontSize: 15 }}>Nexus Super Admin</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
            <span className="muted" style={{ fontSize: 12.5 }}>{me.viewer?.email}</span>
            {clerkEnabled && <span style={{ display: 'flex', alignItems: 'center' }}><UserButton afterSignOutUrl="/" /></span>}
          </div>
        </header>
        <div className="content">{children}</div>
      </main>
    </div>
  );
}
