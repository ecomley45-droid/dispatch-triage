import { NavLink } from 'react-router-dom';
import OfflineBanner from './OfflineBanner.jsx';
import { useEffect, useState } from 'react';
import { LayoutDashboard, ClipboardList, MessageSquare, CalendarDays, Building2, Receipt, Repeat, FolderKanban, Truck, MapPin, Package, Users, Clock, History, BarChart3, HelpCircle, Bell, Settings as SettingsIcon, Moon, Sun, Menu, X } from 'lucide-react';
import { UserButton } from '@clerk/clerk-react';
import { useNavigate } from 'react-router-dom';
import { useMe } from '../lib/useMe.jsx';
import { usePrefs } from '../lib/prefs.js';
import { api } from '../lib/api.js';
import { disabledFeaturePages } from '../../lib/permissions.js';
import Logo from './Logo.jsx';

// Banner shown while a super-admin is "viewing as" a client workspace. Exiting
// clears the view_as cookie and returns to the Super Admin console.
function ViewAsBanner({ orgName }) {
  const exit = async () => {
    try { await api.post('/super/view-as/clear', {}); } catch { /* ignore */ }
    window.location.assign('/super-admin');
  };
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '8px 16px', background: 'linear-gradient(90deg,#6366f1,#d946ef)', color: '#fff', fontSize: 13.5, fontWeight: 600 }}>
      <span>Viewing <b>{orgName}</b> as Super Admin</span>
      <button onClick={exit} style={{ marginLeft: 'auto', background: 'rgba(255,255,255,0.2)', color: '#fff', border: '1px solid rgba(255,255,255,0.4)', borderRadius: 8, padding: '4px 12px', fontWeight: 700, cursor: 'pointer' }}>Exit</button>
    </div>
  );
}

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Each nav item carries its permission `page` key (from lib/permissions.js);
// visibility is driven by the role's resolved page set (me.pages), not roles.
export const NAV = [
  { to: '/', label: 'Home', icon: LayoutDashboard, end: true, page: 'dashboard' },
  { to: '/work-orders', label: 'Work Orders', icon: ClipboardList, page: 'work_orders' },
  { to: '/tickets', label: 'Tickets', icon: MessageSquare, page: 'tickets' },
  { to: '/schedule', label: 'Schedule', icon: CalendarDays, page: 'schedule' },
  { to: '/customers', label: 'Customers', icon: Building2, page: 'customers' },
  { to: '/invoices', label: 'Invoices', icon: Receipt, page: 'invoices' },
  { to: '/maintenance', label: 'Maintenance', icon: Repeat, page: 'maintenance' },
  { to: '/dispatch', label: 'Dispatch', icon: Truck, page: 'dispatch' },
  { to: '/map', label: 'Map', icon: MapPin, page: 'map' },
  { to: '/projects', label: 'Projects', icon: FolderKanban, page: 'projects' },
  { to: '/items', label: 'Items', icon: Package, page: 'items' },
  { to: '/reports', label: 'Reports', icon: BarChart3, page: 'reports' },
  { to: '/timesheets', label: 'Timesheets', icon: Clock, page: 'timesheets' },
  { to: '/team', label: 'Users', icon: Users, page: 'team' },
  { to: '/audit', label: 'Activity', icon: History, page: 'audit' },
  { to: '/settings', label: 'Settings', icon: SettingsIcon, page: 'settings' },
];
// Nav = pages the role can view, minus pages hidden by a disabled workspace feature.
export const navFor = (pages = [], featureFlags = {}) => {
  const hidden = new Set(disabledFeaturePages(featureFlags));
  return NAV.filter((n) => pages.includes(n.page) && !hidden.has(n.page));
};
export const DEFAULT_BOTTOM = ['/', '/work-orders', '/schedule', '/customers', '/map'];
export const ROLE_LABEL = { manager_admin: 'Manager Admin', accountant_admin: 'Accountant Admin', dispatcher: 'Dispatcher' };
// Nav items eligible to pin as mobile top-bar icons: everything not on the bottom bar.
export const overflowFor = (pages, bottomPaths = DEFAULT_BOTTOM, featureFlags = {}) => navFor(pages, featureFlags).filter((n) => !bottomPaths.includes(n.to));

// Notification bell: unread badge + dropdown. Polls quietly in the background.
function NotificationBell() {
  const nav = useNavigate();
  const [open, setOpen] = useState(false);
  const [items, setItems] = useState([]);
  const [unread, setUnread] = useState(0);
  const load = () => api.get('/notifications?limit=20').then((d) => { setItems(d.notifications || []); setUnread(d.unread || 0); }).catch(() => {});
  useEffect(() => { load(); const t = setInterval(load, 60000); return () => clearInterval(t); }, []);
  const when = (s) => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '');
  const openItem = async (n) => {
    setOpen(false);
    if (!n.read_at) { api.post(`/notifications/${n.id}/read`, {}).then(load).catch(() => {}); }
    if (n.link) nav(n.link);
  };
  const markAll = () => api.post('/notifications/read-all', {}).then(load).catch(() => {});
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn icon-btn" title="Notifications" aria-label="Notifications" onClick={() => { setOpen((o) => !o); if (!open) load(); }}>
        <Bell size={16} />
        {unread > 0 && <span style={{ position: 'absolute', top: -4, right: -4, background: 'var(--danger, #e5484d)', color: '#fff', borderRadius: 999, fontSize: 10, fontWeight: 700, minWidth: 16, height: 16, display: 'grid', placeItems: 'center', padding: '0 3px' }}>{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 70 }} />
          <div style={{ position: 'absolute', right: 0, top: 'calc(100% + 8px)', width: 'min(340px, 90vw)', background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 12px 32px rgba(0,0,0,.22)', zIndex: 71, overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid var(--border)' }}>
              <strong style={{ fontSize: 14 }}>Notifications</strong>
              {unread > 0 && <button className="btn" style={{ padding: '2px 8px', fontSize: 12 }} onClick={markAll}>Mark all read</button>}
            </div>
            <div style={{ maxHeight: 380, overflowY: 'auto' }}>
              {items.length ? items.map((n) => (
                <button key={n.id} onClick={() => openItem(n)} style={{ display: 'block', width: '100%', textAlign: 'left', background: n.read_at ? 'transparent' : 'var(--surface-2)', border: 'none', borderBottom: '1px solid var(--border)', padding: '10px 14px', cursor: 'pointer', color: 'var(--text)' }}>
                  <div style={{ fontWeight: 600, fontSize: 13 }}>{n.title}</div>
                  {n.body && <div className="muted" style={{ fontSize: 12.5, marginTop: 2 }}>{n.body}</div>}
                  <div className="muted" style={{ fontSize: 11, marginTop: 3 }}>{when(n.created_at)}</div>
                </button>
              )) : <p className="muted" style={{ padding: '18px 14px', margin: 0, fontSize: 13 }}>No notifications yet.</p>}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

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
  const pages = me.pages || [];
  const featureFlags = me.org?.feature_flags || {};
  const items = navFor(pages, featureFlags);
  // Per-workspace branding (set in the super-admin console). Falls back to the
  // product defaults.
  const branding = me.org?.branding || {};
  const brandName = branding.displayName || 'Nexus Field';
  const pinned = overflowFor(pages, DEFAULT_BOTTOM, featureFlags).filter((n) => (prefs.mobilePins || []).includes(n.to));
  const hiddenPages = new Set(disabledFeaturePages(featureFlags));
  const bottom = (prefs.bottomNav || DEFAULT_BOTTOM).map((p) => NAV.find((n) => n.to === p)).filter((n) => n && pages.includes(n.page) && !hiddenPages.has(n.page)).slice(0, 5);
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

  // Apply per-workspace branding colors by overriding the theme CSS variables
  // that drive the whole UI (--primary, --sidebar-bg). Cleared when unset so a
  // workspace with no branding shows the product default.
  useEffect(() => {
    const s = document.documentElement.style;
    if (branding.primaryColor) s.setProperty('--primary', branding.primaryColor); else s.removeProperty('--primary');
    if (branding.sidebarColor) s.setProperty('--sidebar-bg', branding.sidebarColor); else s.removeProperty('--sidebar-bg');
  }, [branding.primaryColor, branding.sidebarColor]);

  // Per-workspace favicon (set in the Super Admin console).
  useEffect(() => {
    if (!branding.faviconUrl) return;
    let link = document.querySelector("link[rel~='icon']");
    if (!link) { link = document.createElement('link'); link.rel = 'icon'; document.head.appendChild(link); }
    link.href = branding.faviconUrl;
  }, [branding.faviconUrl]);
  return (
    <div className="app-shell">
      {/* Desktop sidebar */}
      <aside className="sidebar">
        <div style={{ padding: '18px 18px 14px', display: 'flex', alignItems: 'center', gap: 9 }}>
          <Logo size={26} logoUrl={branding.logoUrl} />
          <div>
            <div style={{ fontWeight: 800, fontSize: 16, letterSpacing: '-0.01em', color: '#fff' }}>{brandName}</div>
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
            <Logo size={24} logoUrl={branding.logoUrl} />
            <span style={{ fontWeight: 800, fontSize: 16 }}>{brandName}</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginLeft: prefs.logoRight ? 0 : 'auto', marginRight: prefs.logoRight ? 'auto' : 0, order: prefs.logoRight ? 1 : undefined }}>
            {me.platformAdmin && (
              <a href="/super-admin" className="btn hide-mobile" style={{ fontWeight: 700, fontSize: 12.5 }}>Super Admin →</a>
            )}
            <span className="badge badge-blue hide-mobile" style={{ alignSelf: 'center' }}>{ROLE_LABEL[me.viewer?.role]}</span>
            {pinned.map(({ to, label, icon: Icon }) => (
              <NavLink key={to} to={to} className="btn icon-btn only-mobile" title={label} aria-label={label}><Icon size={16} /></NavLink>
            ))}
            <button className="btn icon-btn only-mobile" title="Menu" aria-label="Menu" onClick={() => setMenuOpen(true)}><Menu size={16} /></button>
            <NotificationBell />
            <NavLink to="/help" className="btn icon-btn" title="Help" aria-label="Help"><HelpCircle size={16} /></NavLink>
            <ThemeToggle />
            {clerkEnabled && <span style={{ display: 'flex', alignItems: 'center' }}><UserButton afterSignOutUrl="/" /></span>}
          </div>
        </header>
        {me.org?.viewingAs && <ViewAsBanner orgName={me.org?.name} />}
        <OfflineBanner />
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
