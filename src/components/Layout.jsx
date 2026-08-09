import { NavLink } from 'react-router-dom';
import { useEffect, useState } from 'react';
import { LayoutDashboard, ClipboardList, CalendarDays, Building2, Receipt, Repeat, FolderKanban, Truck, MapPin, Package, Users, Clock, History, HelpCircle, Settings as SettingsIcon, Moon, Sun, Menu, X } from 'lucide-react';
import { UserButton } from '@clerk/clerk-react';
import { useMe } from '../lib/useMe.jsx';
import { usePrefs } from '../lib/prefs.js';
import Logo from './Logo.jsx';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

export const NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true },
  { to: '/work-orders', label: 'Work Orders', icon: ClipboardList },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays },
  { to: '/customers', label: 'Customers', icon: Building2 },
  { to: '/invoices', label: 'Invoices', icon: Receipt, roles: ['manager_admin', 'accountant_admin'] },
  { to: '/maintenance', label: 'Maintenance', icon: Repeat },
  { to: '/dispatch', label: 'Dispatch', icon: Truck },
  { to: '/map', label: 'Map', icon: MapPin },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/items', label: 'Items', icon: Package },
  { to: '/timesheets', label: 'Timesheets', icon: Clock, roles: ['manager_admin', 'accountant_admin'] },
  { to: '/team', label: 'Team', icon: Users },
  { to: '/audit', label: 'Activity', icon: History, roles: ['manager_admin'] },
  { to: '/settings', label: 'Settings', icon: SettingsIcon },
];
export const navFor = (role) => NAV.filter((n) => !n.roles || n.roles.includes(role));
export const DEFAULT_BOTTOM = ['/', '/work-orders', '/schedule', '/customers', '/map'];
export const ROLE_LABEL = { manager_admin: 'Manager Admin', accountant_admin: 'Accountant Admin', dispatcher: 'Dispatcher' };
// Nav items eligible to pin as mobile top-bar icons: everything not on the bottom bar.
export const overflowFor = (role, bottomPaths = DEFAULT_BOTTOM) => navFor(role).filter((n) => !bottomPaths.includes(n.to));

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
  const prefs = usePrefs();
  const [menuOpen, setMenuOpen] = useState(false);
  const role = me.viewer?.role;
  const items = navFor(role);
  const pinned = overflowFor(role).filter((n) => (prefs.mobilePins || []).includes(n.to));
  const bottom = (prefs.bottomNav || DEFAULT_BOTTOM).map((p) => NAV.find((n) => n.to === p)).filter((n) => n && (!n.roles || n.roles.includes(role))).slice(0, 5);
  // Desktop sidebar order: honor a saved order, then append any nav items not in it.
  const ordered = (() => {
    if (!prefs.desktopOrder) return items;
    const saved = prefs.desktopOrder.map((p) => items.find((n) => n.to === p)).filter(Boolean);
    return [...saved, ...items.filter((n) => !saved.includes(n))];
  })();

  // Apply accessibility prefs to the document root.
  useEffect(() => {
    const r = document.documentElement;
    if (prefs.contrast) r.dataset.contrast = 'high'; else delete r.dataset.contrast;
    r.dataset.textsize = prefs.textSize || 'normal';
  }, [prefs.contrast, prefs.textSize]);
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
          {ordered.map(({ to, label, icon: Icon, end }) => (
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
          <div className="topbar-brand" style={prefs.logoRight ? { order: 2, marginLeft: 12 } : undefined}>
            <Logo size={24} />
            <span style={{ fontWeight: 800, fontSize: 16 }}>Dispatch</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: prefs.logoRight ? 0 : 'auto', marginRight: prefs.logoRight ? 'auto' : 0, order: prefs.logoRight ? 1 : undefined }}>
            <span className="badge badge-blue hide-mobile" style={{ alignSelf: 'center' }}>{ROLE_LABEL[me.viewer?.role]}</span>
            {pinned.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className="btn icon-btn only-mobile" title={label} aria-label={label}><Icon size={16} /></NavLink>
            ))}
            <button className="btn icon-btn only-mobile" title="Menu" aria-label="Menu" onClick={() => setMenuOpen(true)}><Menu size={16} /></button>
            <NavLink to="/help" className="btn icon-btn" title="Help" aria-label="Help"><HelpCircle size={16} /></NavLink>
            <ThemeToggle />
            {clerkEnabled && <span style={{ display: 'flex', alignItems: 'center' }}><UserButton afterSignOutUrl="/" /></span>}
          </div>
        </header>
        <div className="content">{children}</div>
        <footer className="muted" style={{ padding: '14px 18px 90px', fontSize: 12, textAlign: 'center' }}>
          {/* Full-page links so the standalone, auth-free legal tree handles them. */}
          <a href="/legal/privacy">Privacy</a> · <a href="/legal/terms">Terms</a> · <a href="/legal/dmca">DMCA</a>
        </footer>
      </main>

      {/* Mobile bottom navigation */}
      <nav className="bottom-nav">
        {bottom.map(({ to, label, icon: Icon, end }) => (
          <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'active' : undefined)}>
            <Icon size={21} />
            <span>{label}</span>
          </NavLink>
        ))}
      </nav>

      {/* Mobile full-nav drawer (opened by the hamburger) */}
      {menuOpen && (
        <div className="only-mobile" onClick={() => setMenuOpen(false)}
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.45)', zIndex: 60 }}>
          <div onClick={(e) => e.stopPropagation()}
            style={{ position: 'absolute', top: 0, right: 0, bottom: 0, width: 'min(320px, 84%)', background: 'var(--surface)', boxShadow: '-8px 0 24px rgba(0,0,0,.25)', padding: 14, overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <strong style={{ fontSize: 15 }}>Menu</strong>
              <button className="btn icon-btn" aria-label="Close menu" onClick={() => setMenuOpen(false)}><X size={16} /></button>
            </div>
            {items.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} onClick={() => setMenuOpen(false)}
                style={({ isActive }) => ({ display: 'flex', alignItems: 'center', gap: 12, padding: '12px 10px', borderRadius: 8, textDecoration: 'none', fontWeight: 600, color: 'var(--text)', background: isActive ? 'var(--surface-2)' : 'transparent' })}>
                <Icon size={18} /> {label === 'Home' ? 'Dashboard' : label}
              </NavLink>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
