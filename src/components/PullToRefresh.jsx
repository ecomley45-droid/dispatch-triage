import { useRef, useState } from 'react';
import { RefreshCw } from 'lucide-react';
import { useIsMobile } from './ui.jsx';

const THRESHOLD = 70; // px of pull before a release triggers a refresh
const MAX_PULL = 110;

// Native-feeling pull-to-refresh for mobile. Since every page fetches its own
// data independently (no shared store to invalidate), a full reload is the
// simplest reliable way to force a refetch everywhere — the PWA shell and
// router remount, but the current URL is preserved.
export default function PullToRefresh({ children }) {
  const isMobile = useIsMobile();
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const startY = useRef(null);
  const draggingRef = useRef(false);

  if (!isMobile) return children;

  const onTouchStart = (e) => {
    if (refreshing) return;
    // The Map page's Leaflet canvas and its draggable bottom sheet own the
    // vertical drag gesture there (panning / sheet-resize) — don't steal it.
    if (e.target.closest?.('.leaflet-container, .map-sheet')) return;
    // Only start tracking when the page is already scrolled to the top —
    // otherwise this would hijack ordinary downward scrolling mid-list. On
    // mobile the document itself scrolls (see .main{overflow:visible}), not
    // this wrapper, so check the real scroll position.
    const scrollTop = document.documentElement.scrollTop || document.body.scrollTop || 0;
    if (scrollTop > 0) return;
    startY.current = e.touches[0].clientY;
    draggingRef.current = true;
  };
  const onTouchMove = (e) => {
    if (!draggingRef.current || startY.current == null) return;
    const dy = e.touches[0].clientY - startY.current;
    if (dy <= 0) { setPull(0); return; }
    setPull(Math.min(MAX_PULL, dy * 0.5)); // resistance — half-speed drag
  };
  const onTouchEnd = () => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    startY.current = null;
    if (pull >= THRESHOLD) {
      setRefreshing(true);
      window.location.reload();
    } else {
      setPull(0);
    }
  };

  return (
    <div
      onTouchStart={onTouchStart}
      onTouchMove={onTouchMove}
      onTouchEnd={onTouchEnd}
      style={{ position: 'relative' }}
    >
      <div style={{
        display: 'flex', justifyContent: 'center', alignItems: 'center',
        height: refreshing ? 40 : pull, overflow: 'hidden',
        transition: draggingRef.current ? 'none' : 'height .2s ease',
        color: 'var(--muted, #888)',
      }}>
        <RefreshCw size={18} className={refreshing || pull >= THRESHOLD ? 'spin' : ''}
          style={{ transform: refreshing ? undefined : `rotate(${pull * 2.6}deg)`, opacity: Math.min(1, pull / THRESHOLD) }} />
      </div>
      {children}
    </div>
  );
}
