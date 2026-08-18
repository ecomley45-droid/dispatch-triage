import { Megaphone, X } from 'lucide-react';
import { useMe } from '../lib/useMe.jsx';
import { useAnnouncements } from '../lib/announcements.js';
import { Modal } from './ui.jsx';
import { lazy, Suspense, useState } from 'react';

// Lazy: this banner mounts on every page for every signed-in user, but the
// markdown renderer (marked + dompurify) is only needed once someone actually
// opens the "View" modal — keeping it out of the main bundle.
const Markdown = lazy(() => import('./Markdown.jsx'));

const TYPE_LABEL = { release_note: 'What\'s new', announcement: 'Announcement', maintenance: 'Maintenance' };

// Shows the single oldest unread announcement as a slim banner (not every
// unread one at once — that gets noisy fast). Dismissing marks it read and
// reveals the next, if any. A user who never opens the banner sees it every
// session until they act on it; opening OR dismissing both count as read, so
// it never nags after that.
export default function AnnouncementBanner() {
  const me = useMe();
  const { unread, markRead } = useAnnouncements(me?.viewer?.email);
  const [open, setOpen] = useState(false);

  if (!unread.length) return null;
  const current = unread[unread.length - 1]; // oldest first (server returns newest-first)

  const dismiss = () => { markRead(current.id); setOpen(false); };

  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '9px 16px', background: 'var(--surface-2)', borderBottom: '1px solid var(--border)', fontSize: 13 }}>
        <Megaphone size={15} style={{ flexShrink: 0, color: 'var(--primary)' }} />
        <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <strong>{TYPE_LABEL[current.type] || 'Update'}:</strong> {current.title}
        </span>
        <button type="button" className="btn" style={{ padding: '4px 10px', fontSize: 12 }} onClick={() => setOpen(true)}>View</button>
        <button type="button" aria-label="Dismiss" onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', display: 'flex' }}><X size={15} /></button>
      </div>

      {open && (
        <Modal title={current.title} onClose={dismiss}>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 12 }}>
            <span className="badge">{TYPE_LABEL[current.type] || current.type}</span>
            {current.version && <span className="badge badge-blue">v{current.version}</span>}
            <span className="muted" style={{ fontSize: 12 }}>{new Date(current.published_at).toLocaleDateString()}</span>
          </div>
          <Suspense fallback={<p className="muted">Loading…</p>}>
            <Markdown text={current.body} />
          </Suspense>
        </Modal>
      )}
    </>
  );
}
