import { NavLink } from 'react-router-dom';
import { Building2, CreditCard, LayoutDashboard, ShieldCheck, Settings2, Megaphone } from 'lucide-react';
import { UserButton } from '@clerk/clerk-react';
import { useSuperMe } from './useSuperMe.jsx';

const clerkEnabled = !!import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

const NAV = [
  { to: '/', label: 'Client workspaces', icon: Building2, end: true },
  { to: '/role-defaults', label: 'Role defaults', icon: ShieldCheck },
  { to: '/announcements', label: 'Announcements', icon: Megaphone },
  { to: '/billing', label: 'Billing', icon: CreditCard },
  { to: '/platform', label: 'Platform', icon: Settings2 },
];

// The "liquid glass" shell: near-black base, three slowly-drifting colored glow
// orbs behind everything, frosted translucent chrome, and an indigo→fuchsia→sky
// gradient accent. Scoped CSS-var overrides recolor the shared cards/tables/
// buttons/inputs to dark glass so every super-admin page is consistent.
const GLASS_CSS = `
.glass-shell{
  --bg:#0b0b14; --surface:rgba(255,255,255,.06); --surface-2:rgba(255,255,255,.04);
  --border:rgba(255,255,255,.10); --text:#f4f4f5; --text-muted:#a1a1aa; --muted:#a1a1aa;
  --primary:#6366f1; --primary-contrast:#fff;
  position:relative; min-height:100vh; background:var(--bg); color:var(--text);
}
.glass-orbs{position:fixed;inset:0;z-index:0;overflow:hidden;pointer-events:none}
.glass-orbs i{position:absolute;border-radius:9999px;filter:blur(120px);opacity:.22;display:block}
.glass-orbs .o1{top:-8rem;left:-5rem;width:36rem;height:36rem;background:#6366f1;animation:drift-a 22s ease-in-out infinite}
.glass-orbs .o2{top:33%;right:-6rem;width:32rem;height:32rem;background:#d946ef;opacity:.18;animation:drift-b 26s ease-in-out infinite}
.glass-orbs .o3{bottom:0;left:25%;width:28rem;height:28rem;background:#38bdf8;opacity:.14;animation:drift-c 19s ease-in-out infinite}
@keyframes drift-a{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(6%,8%) scale(1.08)}}
@keyframes drift-b{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-8%,-4%) scale(1.12)}}
@keyframes drift-c{0%,100%{transform:translate(0,0) scale(1)}50%{transform:translate(-5%,7%) scale(1.05)}}
.glass-shell .app-shell{position:relative;z-index:1;background:transparent}
/* Pin the sidebar to the viewport instead of letting it stretch to the right
   pane's (content-driven) height — otherwise the bottom user card follows the
   page height. sticky + a fixed 100vh keeps it full-height and in place while
   the content scrolls; the mobile rule that hides .sidebar still wins below. */
.glass-shell .sidebar{background:rgba(255,255,255,.05);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-right:1px solid rgba(255,255,255,.10);position:sticky;top:0;align-self:flex-start;height:100vh;overflow-y:auto}
.glass-shell .topbar{background:rgba(255,255,255,.04);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border-bottom:1px solid rgba(255,255,255,.10)}
.glass-shell .card{background:var(--surface);backdrop-filter:blur(20px);-webkit-backdrop-filter:blur(20px);border:1px solid var(--border);border-radius:16px;box-shadow:0 20px 40px rgba(0,0,0,.25)}
.glass-shell .input,.glass-shell select.input{background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.15);color:var(--text)}
.glass-shell .btn{background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.15);color:var(--text)}
.glass-shell .btn-primary{background:linear-gradient(120deg,#6366f1,#d946ef);border:0;color:#fff}
.glass-shell .data th{color:var(--muted);border-color:var(--border)}
.glass-shell .data td{border-color:var(--border)}
.glass-wordmark{font-weight:800;letter-spacing:-.01em;background:linear-gradient(90deg,#6366f1,#d946ef,#38bdf8);-webkit-background-clip:text;background-clip:text;color:transparent}
.glass-nav a{display:flex;align-items:center;gap:10px;position:relative;padding:9px 12px;border-radius:10px;margin-bottom:2px;text-decoration:none;font-size:13.5px;font-weight:600;color:#a1a1aa}
.glass-nav a:hover{color:#f4f4f5;background:rgba(255,255,255,.06)}
.glass-nav a.on{color:#f4f4f5;background:rgba(99,102,241,.18)}
.glass-nav a.on::before{content:"";position:absolute;left:3px;top:50%;transform:translateY(-50%);height:16px;width:2px;border-radius:9999px;background:linear-gradient(#6366f1,#d946ef)}
`;

export default function SuperLayout({ children }) {
  const me = useSuperMe();
  const initial = (me.viewer?.name || me.viewer?.email || '?').slice(0, 1).toUpperCase();
  return (
    <div className="glass-shell">
      <style>{GLASS_CSS}</style>
      <div className="glass-orbs" aria-hidden="true"><i className="o1" /><i className="o2" /><i className="o3" /></div>

      <div className="app-shell">
        <aside className="sidebar">
          <div style={{ padding: '18px 18px 16px' }}>
            <div className="glass-wordmark" style={{ fontSize: 17 }}>Nexus Super Admin</div>
            <div style={{ fontSize: 11, marginTop: 2, color: '#71717a' }}>Platform operations</div>
          </div>
          <nav className="glass-nav" style={{ padding: 8, flex: 1 }}>
            {NAV.map(({ to, label, icon: Icon, end }) => (
              <NavLink key={to} to={to} end={end} className={({ isActive }) => (isActive ? 'on' : undefined)}>
                <Icon size={16} /> {label}
              </NavLink>
            ))}
          </nav>
          <div style={{ padding: 14, borderTop: '1px solid rgba(255,255,255,0.10)', display: 'flex', alignItems: 'center', gap: 10 }}>
            <div style={{ width: 34, height: 34, borderRadius: 999, background: 'linear-gradient(120deg,#6366f1,#d946ef)', color: '#fff', display: 'grid', placeItems: 'center', fontWeight: 700, flexShrink: 0 }}>{initial}</div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 700, color: '#f4f4f5', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.viewer?.name || 'Operator'}</div>
              <div style={{ fontSize: 11.5, color: '#a1a1aa', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{me.viewer?.email}</div>
            </div>
          </div>
        </aside>

        <main className="main">
          <header className="topbar">
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <LayoutDashboard size={18} color="#a1a1aa" />
              <span className="glass-wordmark" style={{ fontSize: 15 }}>Nexus Super Admin</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginLeft: 'auto' }}>
              {/* Same reasoning as src/components/Layout.jsx's UserButton: route through
                  /api/session/clear so sign-out also drops the long-lived
                  shared_session cookie, not just this app's own Clerk session. */}
              {clerkEnabled && <span style={{ display: 'flex', alignItems: 'center' }}><UserButton afterSignOutUrl="/api/session/clear" /></span>}
            </div>
          </header>
          <div className="content">{children}</div>
        </main>
      </div>
    </div>
  );
}
