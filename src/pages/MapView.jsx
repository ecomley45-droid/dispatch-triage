import { useEffect, useMemo, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
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
    let pt = null;
    if (AZURE_KEY) {
      const res = await fetch(`https://atlas.microsoft.com/search/address/json?api-version=1.0&subscription-key=${AZURE_KEY}&limit=1&query=${encodeURIComponent(address)}`);
      const data = await res.json();
      const p = data?.results?.[0]?.position;
      if (p) pt = { lat: p.lat, lon: p.lon };
    } else {
      const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
      const data = await res.json();
      if (data.length) pt = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    }
    if (!pt) return null;
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

// Expandable list item: tap to focus the pin and reveal the field-action row.
function OrderItem({ wo, subtitle, expanded, onToggle, onChange }) {
  return (
    <div className="map-list-item" style={{ cursor: 'pointer' }}>
      <div onClick={onToggle}>
        <div style={{ fontWeight: 600 }}>{wo.number ? `${wo.number} · ` : ''}{wo.title}</div>
        <div className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>{subtitle}</div>
        <Badge value={wo.status} />
        {wo.approved_at && <span className="badge badge-green" style={{ marginLeft: 6 }}>approved</span>}
      </div>
      {expanded && <div style={{ marginTop: 10 }} onClick={(e) => e.stopPropagation()}><JobActions wo={wo} onChange={onChange} /></div>}
    </div>
  );
}

export default function MapView() {
  const me = useMe();
  const isMobile = useIsMobile();
  const isDispatcher = me.viewer?.role === 'dispatcher';
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const [orders, setOrders] = useState([]);
  const [sites, setSites] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [located, setLocated] = useState([]);
  const [status, setStatus] = useState('Loading…');
  const [expanded, setExpanded] = useState(null);
  const userMarkerRef = useRef(null);
  const techMarkersRef = useRef({});
  const [userPos, setUserPos] = useState(() => {
    try { const s = localStorage.getItem('dispatch-last-pos'); return s ? JSON.parse(s) : null; } catch { return null; }
  });
  const [techLocs, setTechLocs] = useState([]);

  useEffect(() => {
    api.list('/work-orders').then(setOrders).catch(() => setOrders([]));
    api.list('/sites').then(setSites).catch(() => {});
    api.list('/customers').then(setCustomers).catch(() => {});
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
  const subtitleFor = (wo) => [custName[wo.customer_id], siteById[wo.site_id]?.name, !isDispatcher && wo.assignee_email ? `→ ${wo.assignee_email.split('@')[0]}` : (isDispatcher ? null : 'unassigned')].filter(Boolean).join(' · ');

  // Managers see everyone's work; dispatchers see only their own.
  const visible = useMemo(() => orders
    .filter((w) => w.status !== 'cancelled')
    .filter((w) => !isDispatcher || w.assignee_email === me.viewer?.email)
    .map((w) => ({ wo: w, address: siteById[w.site_id]?.address }))
    .filter((x) => x.address), [orders, siteById, isDispatcher, me.viewer?.email]);
  // Signature so geocoding/markers only rebuild when the mapped set/addresses change (not on status toggles).
  const sig = visible.map((x) => `${x.wo.id}|${x.address}`).join(',');
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
      for (const { wo, address } of items) {
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
        m.bindPopup(`<strong>${wo.number || ''} ${wo.title}</strong><br>${custName[wo.customer_id] || ''}<br>${wo.assignee_email ? 'Assigned: ' + wo.assignee_email + '<br>' : ''}<a href="${dir}" target="_blank" rel="noreferrer">Directions →</a>`);
        markersRef.current[wo.id] = m;
        bounds.push([lat, lon]);
      }
      if (bounds.length) map.fitBounds(bounds, { padding: isMobile ? [50, 50] : [40, 40], maxZoom: 12 });
      setTimeout(() => map.invalidateSize(), 120);
    })();
    return () => { cancelled = true; };
  }, [sig, isMobile]);

  const focus = (id) => { const m = markersRef.current[id]; if (m && mapRef.current) { mapRef.current.setView(m.getLatLng(), 13); m.openPopup(); } };
  const toggle = (id) => { focus(id); setExpanded((x) => (x === id ? null : id)); };

  const list = visible.map(({ wo }) => (
    <OrderItem key={wo.id} wo={wo} subtitle={subtitleFor(wo)} expanded={expanded === wo.id} onToggle={() => toggle(wo.id)} onChange={updateOrder} />
  ));

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
              <strong style={{ fontSize: 16 }}>{isDispatcher ? 'My work orders' : 'Work orders'}</strong>
              <span className="muted" style={{ fontSize: 12 }}>{status}</span>
            </div>
          </div>
          {list.length ? list : <div className="muted" style={{ padding: 16 }}>Work orders at a site address appear here.</div>}
        </div>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Map" subtitle={`${isDispatcher ? 'Your work orders' : 'All work orders + assignees'} · ${status} · ${MAP_PROVIDER}`} />
      <div className="map-grid">
        <div className="card" style={{ padding: 0, maxHeight: 580, overflow: 'auto' }}>
          {list.length ? list : <div className="muted" style={{ padding: 16 }}>Work orders at a site address will appear here.</div>}
        </div>
        <div ref={mapEl} className="card map-canvas" style={{ minHeight: 580, overflow: 'hidden' }} />
      </div>
    </>
  );
}
