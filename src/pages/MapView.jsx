import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { ArrowUpDown } from 'lucide-react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { PageHeader, Badge, useIsMobile } from '../components/ui.jsx';
import JobActions from '../components/JobActions.jsx';

// Geocoding + tiles use Azure Maps when VITE_AZURE_MAPS_KEY is set (Microsoft-
// native), otherwise OpenStreetMap so the map works with no key. Results cache
// in localStorage so each address is looked up once.
const AZURE_KEY = import.meta.env.VITE_AZURE_MAPS_KEY;
export const MAP_PROVIDER = AZURE_KEY ? 'Azure Maps' : 'OpenStreetMap';

const memCache = {};
async function geocode(address) {
  if (!address) return null;
  const key = 'geo:' + address.trim().toLowerCase();
  if (memCache[key]) return memCache[key];
  try { const c = localStorage.getItem(key); if (c) return (memCache[key] = JSON.parse(c)); } catch { /* ignore */ }
  try {
    const pt = await api.get(`/geocode?q=${encodeURIComponent(address)}`);
    if (!pt || !pt.lat || !pt.lon) return null;
    memCache[key] = pt;
    try { localStorage.setItem(key, JSON.stringify(pt)); } catch { /* ignore */ }
    return pt;
  } catch { return null; }
}

function addTiles(map) {
  if (AZURE_KEY) {
    L.tileLayer(`https://atlas.microsoft.com/map/tile?api-version=2024-04-01&tilesetId=microsoft.base.road&zoom={z}&x={x}&y={y}&tileSize=256&subscription-key=${AZURE_KEY}`, {
      attribution: '© Microsoft, © TomTom', maxZoom: 19,
    }).addTo(map);
  } else {
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OpenStreetMap', maxZoom: 19 }).addTo(map);
  }
}

const STATUS_COLOR = { requested: '#cf8a12', scheduled: '#127c6e', en_route: '#cf8a12', on_site: '#127c6e', completed: '#5f9e1f', invoiced: '#5f9e1f', cancelled: '#d64524' };
const pinIcon = (color) => L.divIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 18], popupAnchor: [0, -16],
});

const fmtDue = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : null);

// Expandable list item: tap to focus the pin and reveal the field-action row.
function OrderItem({ wo, subtitle, expanded, onToggle, onChange }) {
  const due = fmtDue(wo.sla_due);
  return (
    <div className="map-list-item" style={{ cursor: 'pointer' }}>
      <div onClick={onToggle}>
        <div style={{ fontWeight: 600 }}>{wo.number ? `${wo.number} · ` : ''}{wo.title}</div>
        <div className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>{subtitle}</div>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
          <div>
            <Badge value={wo.status} />
            {wo.approved_at && <span className="badge badge-green" style={{ marginLeft: 6 }}>approved</span>}
          </div>
          {due && <div className="muted" style={{ fontSize: 11.5, whiteSpace: 'nowrap', flexShrink: 0 }}>Due {due}</div>}
        </div>
      </div>
      {expanded && <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}><JobActions wo={wo} onChange={onChange} /></div>}
    </div>
  );
}

// "Today" / "Later" divider — only meaningful when the list is due-date
// ordered, so a tech can see at a glance which jobs need finishing today.
function SectionHeader({ label }) {
  return (
    <div className="muted" style={{ fontSize: 11, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '.05em', padding: '12px 16px 4px' }}>
      {label}
    </div>
  );
}

const SORT_OPTIONS = [
  { key: 'due', label: 'Due date' },
  { key: 'distance', label: 'Closest location' },
  { key: 'priority', label: 'Priority' },
];
const PRIORITY_RANK = { high: 0, medium: 1, low: 2 };
const distanceKm = (a, b) => {
  const R = 6371;
  const dLat = (b.lat - a.lat) * Math.PI / 180;
  const dLon = (b.lon - a.lon) * Math.PI / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * Math.PI / 180) * Math.cos(b.lat * Math.PI / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(s));
};

// Small dropdown for the sort control. Options are fixed (not user-editable),
// so a plain positioned panel is simpler than pulling in a full select widget.
function SortMenu({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const current = SORT_OPTIONS.find((o) => o.key === value) || SORT_OPTIONS[0];
  return (
    <div style={{ position: 'relative' }}>
      <button className="btn" style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }} onClick={() => setOpen((o) => !o)}>
        <ArrowUpDown size={14} /> Sort: {current.label}
      </button>
      {open && (
        <>
          <div onClick={() => setOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 70 }} />
          <div style={{ position: 'absolute', left: 0, top: 'calc(100% + 6px)', minWidth: 180, background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 10, boxShadow: '0 12px 32px rgba(0,0,0,.22)', zIndex: 71, overflow: 'hidden' }}>
            {SORT_OPTIONS.map((o) => (
              <button key={o.key} onClick={() => { onChange(o.key); setOpen(false); }}
                style={{ display: 'block', width: '100%', textAlign: 'left', background: o.key === value ? 'var(--surface-2)' : 'transparent', border: 'none', padding: '9px 14px', cursor: 'pointer', fontSize: 13, fontWeight: o.key === value ? 700 : 500, color: 'var(--text)' }}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

export default function MapView() {
  const me = useMe();
  const isMobile = useIsMobile();
  const isDispatcher = me.viewer?.role === 'dispatcher';
  // Dispatchers and technicians are field roles: the map should only ever
  // show what's assigned to them, not the whole org's work.
  const mineOnly = isDispatcher || me.viewer?.role === 'technician';
  const [sortBy, setSortBy] = useState('due');
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const [orders, setOrders] = useState([]);
  const [sites, setSites] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [members, setMembers] = useState([]);
  const [located, setLocated] = useState([]);
  const [status, setStatus] = useState('Loading…');
  const [expanded, setExpanded] = useState(null);
  const userMarkerRef = useRef(null);
  const techMarkersRef = useRef({});
  const didCenterRef = useRef(false); // center on the user's location once, on first load
  const [userPos, setUserPos] = useState(() => {
    try { const s = localStorage.getItem('dispatch-last-pos'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [techLocs, setTechLocs] = useState([]);

  useEffect(() => {
    api.list('/work-orders').then(setOrders).catch(() => setOrders([]));
    api.list('/sites').then(setSites).catch(() => {});
    api.list('/customers').then(setCustomers).catch(() => {});
    api.get('/members').then(setMembers).catch(() => {});
  }, []);

  // Managers/dispatchers poll tech locations every 30 s.
  useEffect(() => {
    if (!me.can('tech_locations:read')) return;
    const load = () => api.get('/tech-locations').then(setTechLocs).catch(() => {});
    load();
    const t = setInterval(load, 30_000);
    return () => clearInterval(t);
  }, [me.viewer?.email]);

  const siteById = useMemo(() => Object.fromEntries(sites.map((s) => [s.id, s])), [sites]);
  const custName = useMemo(() => Object.fromEntries(customers.map((c) => [c.id, c.name])), [customers]);
  const nameByEmail = useMemo(() => Object.fromEntries(members.map((m) => [m.user_email, m.name || m.user_email])), [members]);
  const assigneeName = (email) => (email ? nameByEmail[email] || email : null);
  const subtitleFor = (wo) => [custName[wo.customer_id], siteById[wo.site_id]?.name, !mineOnly && wo.assignee_email ? `→ ${assigneeName(wo.assignee_email)}` : (mineOnly ? null : 'unassigned')].filter(Boolean).join(' · ');

  // Managers/dispatchers-of-others see everyone's work; a dispatcher or
  // technician sees only what's assigned to them — all of it, any status
  // (besides cancelled), not just a narrower "open" subset.
  const visible = useMemo(() => orders
    .filter((w) => w.status !== 'cancelled')
    .filter((w) => !mineOnly || w.assignee_email === me.viewer?.email)
    .map((w) => {
      const site = siteById[w.site_id];
      // Prefer the site's stored coordinates (set at seed/creation time) — skips
      // the runtime geocoder entirely, so a site shows up even if the geocoding
      // API is slow, rate-limited, or fails to match the address text.
      return { wo: w, address: site?.address, lat: site?.lat ?? null, lon: site?.lon ?? null };
    })
    .filter((x) => x.address || (x.lat != null && x.lon != null)), [orders, siteById, mineOnly, me.viewer?.email]);
  // Signature so geocoding/markers only rebuild when the mapped set/addresses change (not on status toggles).
  const sig = visible.map((x) => `${x.wo.id}|${x.lat ?? ''}|${x.lon ?? ''}|${x.address}`).join(',');
  const visibleRef = useRef(visible); visibleRef.current = visible;

  const updateOrder = (u) => setOrders((rows) => rows.map((r) => (r.id === u.id ? u : r)));

  useEffect(() => {
    if (!mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: !isMobile }).setView([34.85, -82.4], 9);
    addTiles(map);
    mapRef.current = map;
    // Multiple invalidateSize calls handle iOS layout timing; ResizeObserver
    // catches orientation changes and bottom-sheet drag that alter the container.
    const resize = () => map.invalidateSize();
    [120, 400, 900].forEach((ms) => setTimeout(resize, ms));
    const ro = new ResizeObserver(resize);
    ro.observe(mapEl.current);
    return () => { ro.disconnect(); map.remove(); mapRef.current = null; markersRef.current = {}; userMarkerRef.current = null; techMarkersRef.current = {}; };
  }, [isMobile]);

  // Watch the device's GPS position. Persist the last known fix to localStorage
  // so the "you are here" dot survives a page refresh or brief offline gap.
  useEffect(() => {
    if (!navigator.geolocation) return;
    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        const pt = { lat: pos.coords.latitude, lon: pos.coords.longitude };
        setUserPos(pt);
        try { localStorage.setItem('dispatch-last-pos', JSON.stringify(pt)); } catch { /* ignore */ }
      },
      () => { /* permission denied or no signal — keep last known */ },
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 15_000 },
    );
    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // Center the map on a point, but shift it up so it lands in the middle of
  // the VISIBLE viewport rather than the whole container — on mobile the
  // work-orders sheet overlays the bottom sheetPct% of the map, so the true
  // center of the container is partly hidden behind it. Horizontally the pin
  // stays centered; only the vertical position is raised.
  const centerAboveSheet = (map, latlng, zoom, opts) => {
    const H = mapEl.current?.clientHeight || map.getSize().y || 0;
    const offsetY = isMobile ? (H * (pctRef.current || 50)) / 200 : 0;
    if (offsetY) {
      const pt = map.project(latlng, zoom).add([0, offsetY]);
      map.setView(map.unproject(pt, zoom), zoom, opts);
    } else {
      map.setView(latlng, zoom, opts);
    }
  };

  // Keep the "you are here" marker in sync with the latest position.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !userPos) return;
    const latlng = [userPos.lat, userPos.lon];
    const youIcon = L.divIcon({
      className: '',
      html: '<div style="width:14px;height:14px;border-radius:50%;background:#2563eb;border:2.5px solid #fff;box-shadow:0 0 0 3px rgba(37,99,235,.35)"></div>',
      iconSize: [14, 14], iconAnchor: [7, 7],
    });
    if (userMarkerRef.current) {
      userMarkerRef.current.setLatLng(latlng);
    } else {
      userMarkerRef.current = L.marker(latlng, { icon: youIcon, zIndexOffset: 1000 }).addTo(map).bindPopup('You are here');
    }
    // On initial load, center the map on the user's location (last-known fix
    // immediately, or the first GPS fix). Only once — after that the view is
    // the user's to pan/zoom, and marker updates don't yank it around.
    if (!didCenterRef.current) {
      centerAboveSheet(map, latlng, 13, { animate: false });
      didCenterRef.current = true;
    }
  }, [userPos]);

  // Tech location pins — blue avatars for managers/dispatchers.
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const seen = new Set();
    for (const loc of techLocs) {
      seen.add(loc.user_email);
      const label = (loc.name || loc.user_email).split('@')[0].slice(0, 2).toUpperCase();
      const html = `<div style="width:28px;height:28px;border-radius:50%;background:#2563eb;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;color:#fff;font-size:10px;font-weight:700">${label}</div>`;
      const icon = L.divIcon({ className: '', html, iconSize: [28, 28], iconAnchor: [14, 14] });
      if (techMarkersRef.current[loc.user_email]) {
        techMarkersRef.current[loc.user_email].setLatLng([loc.lat, loc.lon]);
      } else {
        techMarkersRef.current[loc.user_email] = L.marker([loc.lat, loc.lon], { icon, zIndexOffset: 900 })
          .addTo(map)
          .bindPopup(`<strong>${loc.name || loc.user_email}</strong><br>Last updated: ${new Date(loc.updated_at).toLocaleTimeString()}`);
      }
    }
    // Remove markers for techs who are no longer active.
    for (const [email, marker] of Object.entries(techMarkersRef.current)) {
      if (!seen.has(email)) { marker.remove(); delete techMarkersRef.current[email]; }
    }
  }, [techLocs]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const items = visibleRef.current;
      if (!items.length) { setStatus('No work orders with a location'); setLocated([]); return; }
      setStatus('Locating work orders…');
      const out = [];
      for (const { wo, address, lat, lon } of items) {
        if (lat != null && lon != null) { out.push({ wo, lat, lon }); continue; } // stored coordinates — no lookup needed
        const pt = await geocode(address);
        if (cancelled) return;
        if (pt) out.push({ wo, ...pt });
        if (!memCache['geo:' + address.trim().toLowerCase()]) await new Promise((r) => setTimeout(r, 250));
      }
      if (cancelled) return;
      setLocated(out);
      setStatus(`${out.length} of ${items.length} mapped`);
      const map = mapRef.current;
      if (!map) return;
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      const bounds = [];
      for (const { wo, lat, lon } of out) {
        const m = L.marker([lat, lon], { icon: pinIcon(STATUS_COLOR[wo.status] || '#127c6e') }).addTo(map);
        const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(siteById[wo.site_id]?.address || '')}`;
        m.bindPopup(`<strong>${wo.number || ''} ${wo.title}</strong><br>${custName[wo.customer_id] || ''}<br>${wo.assignee_email ? 'Assigned: ' + assigneeName(wo.assignee_email) + '<br>' : ''}<a href="${dir}" target="_blank" rel="noreferrer">Directions →</a>`);
        markersRef.current[wo.id] = m;
        bounds.push([lat, lon]);
      }
      // Fit all job markers only as a fallback — if we've already centered on
      // the user's own location, leave that view in place.
      if (bounds.length && !didCenterRef.current) map.fitBounds(bounds, { padding: isMobile ? [50, 50] : [40, 40], maxZoom: 12 });
      setTimeout(() => map.invalidateSize(), 120);
    })();
    return () => { cancelled = true; };
  }, [sig, isMobile]);

  const focus = (id) => {
    const m = markersRef.current[id];
    if (!m || !mapRef.current) return;
    centerAboveSheet(mapRef.current, m.getLatLng(), 13, { animate: true });
    m.openPopup();
  };
  const toggle = (id) => { focus(id); setExpanded((x) => (x === id ? null : id)); };

  const locByWoId = useMemo(() => Object.fromEntries(located.map((x) => [x.wo.id, x])), [located]);
  const sorted = useMemo(() => {
    const items = [...visible];
    if (sortBy === 'due') {
      items.sort((a, b) => (a.wo.sla_due ? new Date(a.wo.sla_due).getTime() : Infinity) - (b.wo.sla_due ? new Date(b.wo.sla_due).getTime() : Infinity));
    } else if (sortBy === 'distance') {
      items.sort((a, b) => {
        const da = userPos && locByWoId[a.wo.id] ? distanceKm(userPos, locByWoId[a.wo.id]) : Infinity;
        const db = userPos && locByWoId[b.wo.id] ? distanceKm(userPos, locByWoId[b.wo.id]) : Infinity;
        return da - db;
      });
    } else if (sortBy === 'priority') {
      items.sort((a, b) => (PRIORITY_RANK[a.wo.priority] ?? 99) - (PRIORITY_RANK[b.wo.priority] ?? 99));
    }
    return items;
  }, [visible, sortBy, locByWoId, userPos]);

  // "Today"/"Later" headers only make sense against due-date order — inject
  // them once, right before the first item that crosses the boundary.
  const todayEnd = useMemo(() => { const d = new Date(); d.setHours(23, 59, 59, 999); return d; }, []);
  let shownToday = false, shownLater = false;
  const list = sorted.map(({ wo }) => {
    const nodes = [];
    if (sortBy === 'due') {
      const isToday = wo.sla_due && new Date(wo.sla_due) <= todayEnd;
      if (isToday && !shownToday) { nodes.push(<SectionHeader key={`hdr-today`} label="Today" />); shownToday = true; }
      if (!isToday && !shownLater) { nodes.push(<SectionHeader key={`hdr-later`} label="Later" />); shownLater = true; }
    }
    nodes.push(<OrderItem key={wo.id} wo={wo} subtitle={subtitleFor(wo)} expanded={expanded === wo.id} onToggle={() => toggle(wo.id)} onChange={updateOrder} />);
    return nodes;
  });

  // Draggable bottom sheet: drag the handle to snap between peek / half / full.
  const SNAPS = [16, 50, 88];
  const [sheetPct, setSheetPct] = useState(50);
  const [dragging, setDragging] = useState(false);
  const pctRef = useRef(50);
  const setPct = (p) => { pctRef.current = p; setSheetPct(p); };
  const onGrab = (e) => {
    e.preventDefault();
    const containerH = e.currentTarget.closest('.map-mobile')?.clientHeight || window.innerHeight;
    const startY = e.clientY;
    const startPct = pctRef.current;
    setDragging(true);
    const move = (ev) => setPct(Math.max(10, Math.min(92, startPct + ((startY - ev.clientY) / containerH) * 100)));
    const up = () => {
      setDragging(false);
      setPct(SNAPS.reduce((a, b) => (Math.abs(b - pctRef.current) < Math.abs(a - pctRef.current) ? b : a)));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  if (isMobile) {
    return (
      <div className="map-mobile">
        <div ref={mapEl} className="map-canvas-full" />
        <div className="map-sheet" style={{ height: `${sheetPct}%`, transition: dragging ? 'none' : 'height .25s ease' }}>
          <div className="map-sheet-header" onPointerDown={onGrab}>
            <div className="map-sheet-grab" />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '0 16px' }}>
              <strong style={{ fontSize: 16 }}>{mineOnly ? 'My work orders' : 'Work orders'}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{status}</span>
            </div>
            <div style={{ padding: '8px 16px 0' }}><SortMenu value={sortBy} onChange={setSortBy} /></div>
          </div>
          {list.length ? list : <div className="muted" style={{ padding: 16 }}>Work orders at a site address appear here.</div>}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Map" subtitle={`${mineOnly ? 'Your work orders' : 'All work orders + assignees'} · ${status} · ${MAP_PROVIDER}`} />
      <div style={{ marginBottom: 12 }}><SortMenu value={sortBy} onChange={setSortBy} /></div>
      <div className="map-grid">
        <div className="card" style={{ padding: 0, maxHeight: 580, overflow: 'auto' }}>
          {list.length ? list : <div className="muted" style={{ padding: 16 }}>Work orders at a site address will appear here.</div>}
        </div>
        <div ref={mapEl} className="card map-canvas" style={{ minHeight: 580, overflow: 'hidden' }} />
      </div>
    </>
  );
}
