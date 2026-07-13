import { NavLink } from 'react-router-dom';
import { useState } from 'react';
import { LayoutDashboard, FolderKanban, Truck, Package, Users, Moon, Sun } from 'lucide-react';
import { useMe } from '../lib/useMe.jsx';

const NAV = [
  { to: '/', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/dispatch', label: 'Dispatch & Time', icon: Truck },
  { to: '/items', label: 'Items & Costs', icon: Package },
  { to: '/team', label: 'Team', icon: Users },
];

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
    <button className="btn" onClick={toggle} title="Toggle theme" style={{ padding: 8 }}>
      {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
    </button>
  );
}

export default function Layout({ children }) {
  const me = useMe();
  return (
    <div style={{ display: 'flex', height: '100%' }}>
      <aside style={{ width: 232, borderRight: '1px solid var(--border)', background: 'var(--surface)', display: 'flex', flexDirection: 'column', flexShrink: 0 }}>
        <div style={{ padding: '18px 18px 12px' }}>
          <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em' }}>◆ Dispatch</div>
          <div className="muted" style={{ fontSize: 12, marginTop: 2 }}>{me.org?.name}</div>
        </div>
        <nav style={{ padding: 8, flex: 1 }}>
          {NAV.map(({ to, label, icon: Icon, end }) => (
            <NavLink key={to} to={to} end={end}
              style={({ isActive }) => ({
                display: 'flex', alignItems: 'center', gap: 10, padding: '9px 12px', borderRadius: 8,
                marginBottom: 2, textDecoration: 'none', fontWeight: 600, fontSize: 13.5,
                color: isActive ? 'var(--primary)' : 'var(--text)',
                background: isActive ? 'color-mix(in srgb, var(--primary) 12%, transparent)' : 'transparent',
              })}>
              <Icon size={17} /> {label}
            </NavLink>
          ))}
        </nav>
        <div style={{ padding: 14, borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 32, height: 32, borderRadius: 999, background: 'var(--surface-2)', display: 'grid', placeItems: 'center', fontWeight: 700 }}>
            {(me.viewer?.name || '?').slice(0, 1).toUpperCase()}
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.viewer?.name}</div>
            <div className="muted" style={{ fontSize: 11 }}>{ROLE_LABEL[me.viewer?.role] || me.viewer?.role}</div>
          </div>
        </div>
      </aside>

      <main style={{ flex: 1, overflow: 'auto' }}>
        <header style={{ display: 'flex', justifyContent: 'flex-end', padding: '12px 24px', borderBottom: '1px solid var(--border)', gap: 8 }}>
          <span className="badge badge-blue" style={{ alignSelf: 'center' }}>{ROLE_LABEL[me.viewer?.role]}</span>
          <ThemeToggle />
        </header>
        <div style={{ padding: 24, maxWidth: 1200, margin: '0 auto' }}>{children}</div>
      </main>
    </div>
  );
}
