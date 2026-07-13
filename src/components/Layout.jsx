import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { LayoutDashboard, FolderKanban, Truck, MapPin, Package, Users, Clock, Moon, Sun } from 'lucide-react';
import { UserButton } from '@clerk/clerk-react';
import { useMe } from '../lib/useMe.jsx';
import Logo from './Logo.jsx';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/dispatch', label: 'Dispatch', icon: Truck },
  { to: '/map', label: 'Map', icon: MapPin },
  { to: '/items', label: 'Items', icon: Package },
  { to: '/timesheets', label: 'Timesheets', icon: Clock, roles: ['manager_admin', 'accountant_admin'] },
  { to: '/team', label: 'Team', icon: Users },
];
const navFor = (role) => NAV.filter((n) => !n.roles || n.roles.includes(role));
// 5 primary tabs on phones; Timesheets/Team reached via top-bar icons.
const BOTTOM = NAV.filter((n) => !['/team', '/timesheets'].includes(n.to));

const ROLE_LABEL = { manager_admin: 'Manager Admin', accountant_admin: 'Accountant Admin', dispatcher: 'Dispatcher' };

function ThemeToggle() {
  const [theme, setTheme] = useState(document.documentElement.dataset.theme || 'light');
  const toggle = () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('dispatch-theme', next); } catch { /* ignore */ }
    setTheme(next);
  };
  return (
    <button className="btn icon-btn" onClick={toggle} title="Toggle theme" aria-label="Toggle theme">
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export default function Layout({ children }) {
  const me = useMe();
  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div style={{ padding: '18px 18px 14px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Logo size={26} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em', color: '#fff' }}>Dispatch</div>
            <div style={{ fontSize: 11.5, marginTop: 1, color: 'var(--sidebar-text-muted)' }}>{me.org?.name}</div>
          </div>
        </div>
        <nav style={{ padding: 8, flex: 1 }}>
          {navFor(me.viewer?.role).map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10, padding: '10px 12px', borderRadius: 8,
                marginBottom: 2, textDecoration: 'none', fontWeight: 600, fontSize: 13.5,
                color: isActive ? '#ffffff' : 'var(--sidebar-text)',
                background: isActive ? 'rgba(255,255,255,0.16)' : 'transparent',
              })}>
              <Icon size={17} /> {label === 'Home' ? 'Dashboard' : label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,0.12)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 999, background: 'rgba(255,255,255,0.16)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
            {(me.viewer?.name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', color: '#fff' }}>{me.viewer?.name}</div>
            <div style={{ fontSize: 11, color: 'var(--sidebar-text-muted)' }}>{ROLE_LABEL[me.viewer?.role] || me.viewer?.role}</div>
          </div>
        </div>
      </aside>

      <main className="main">
        <header className="topbar">
          <div className="topbar-brand">
            <Logo size={24} />
            <span style={{ fontWeight: 800, fontSize: 16 }}>Dispatch</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' }}>
            <span className="badge badge-blue hide-mobile" style={{ alignSelf: 'center' }}>{ROLE_LABEL[me.viewer?.role]}</span>
            {(me.viewer?.role === 'manager_admin' || me.viewer?.role === 'accountant_admin') &&
              <NavLink to="/timesheets" className="btn icon-btn only-mobile" title="Timesheets" aria-label="Timesheets"><Clock size={16} /></NavLink>}
            <NavLink to="/team" className="btn icon-btn only-mobile" title="Team" aria-label="Team"><Users size={16} /></NavLink>
            <ThemeToggle />
            {clerkEnabled && <span style={{ display: 'flex', alignItems: 'center' }}><UserButton afterSignOutUrl="/" /></span>}
          </div>
        </header>
        <div className="content">{children}</div>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="bottom-nav">
        {BOTTOM.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
            <Icon size={21} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>
    </div>
  );
}
