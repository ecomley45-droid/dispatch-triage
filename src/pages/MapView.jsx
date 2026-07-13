import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api.js';
import { PageHeader, Badge, useIsMobile } from '../components/ui.jsx';

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

const STATUS_COLOR = { scheduled: '#127c6e', en_route: '#cf8a12', in_progress: '#127c6e', completed: '#5f9e1f', unscheduled: '#8a97a0', cancelled: '#d64524' };
const pinIcon = (color) => L.divIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 18], popupAnchor: [0, -16],
});

export default function MapView() {
  const isMobile = useIsMobile();
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const [jobs, setJobs] = useState([]);
  const [located, setLocated] = useState([]);
  const [status, setStatus] = useState('Loading…');

  useEffect(() => { api.get('/jobs').then(setJobs).catch(() => setJobs([])); }, []);

  // (Re)create the map when the layout (mobile/desktop) changes so it always
  // binds to the container that is actually rendered.
  useEffect(() => {
    if (!mapEl.current) return;
    const map = L.map(mapEl.current, { zoomControl: !isMobile }).setView([34.85, -82.4], 9);
    addTiles(map);
    mapRef.current = map;
    setTimeout(() => map.invalidateSize(), 120);
    return () => { map.remove(); mapRef.current = null; markersRef.current = {}; };
  }, [isMobile]);

  // Geocode jobs and drop markers.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const withLoc = jobs.filter((j) => j.location);
      if (!withLoc.length) { setStatus('No jobs have a location yet'); return; }
      setStatus('Locating jobs…');
      const out = [];
      for (const j of withLoc) {
        const pt = await geocode(j.location);
        if (cancelled) return;
        if (pt) out.push({ job: j, ...pt });
        if (!memCache['geo:' + j.location.trim().toLowerCase()]) await new Promise((r) => setTimeout(r, 250));
      }
      if (cancelled) return;
      setLocated(out);
      setStatus(`${out.length} of ${withLoc.length} jobs mapped`);

      const map = mapRef.current;
      if (!map) return;
      Object.values(markersRef.current).forEach((m) => m.remove());
      markersRef.current = {};
      const bounds = [];
      for (const { job, lat, lon } of out) {
        const m = L.marker([lat, lon], { icon: pinIcon(STATUS_COLOR[job.status] || '#127c6e') }).addTo(map);
        const dir = `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(job.location)}`;
        m.bindPopup(`<strong>${job.title}</strong><br>${job.location}<br><a href="${dir}" target="_blank" rel="noreferrer">Directions →</a>`);
        markersRef.current[job.id] = m;
        bounds.push([lat, lon]);
      }
      if (bounds.length) map.fitBounds(bounds, { padding: isMobile ? [50, 50] : [40, 40], maxZoom: 12 });
      setTimeout(() => map.invalidateSize(), 120);
    })();
    return () => { cancelled = true; };
  }, [jobs, isMobile]);

  const focus = (job) => {
    const m = markersRef.current[job.id];
    if (m && mapRef.current) { mapRef.current.setView(m.getLatLng(), 13); m.openPopup(); }
  };

  const list = located.map(({ job }) => (
    <button key={job.id} onClick={() => focus(job)} className="map-list-item">
      <div style={{ fontWeight: 600 }}>{job.title}</div>
      <div className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>{job.location}</div>
      <Badge value={job.status} />
    </button>
  ));

  // --- Mobile: full-bleed map with a Find My-style bottom sheet ---
  if (isMobile) {
    return (
      <div className="map-mobile">
        <div ref={mapEl} className="map-canvas-full" />
        <div className="map-sheet">
          <div className="map-sheet-grab" />
          <div style={{ padding: '0 16px 8px', display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
            <strong style={{ fontSize: 16 }}>Dispatch</strong>
            <span className="muted" style={{ fontSize: 12 }}>{status}</span>
          </div>
          {list.length ? list : <div className="muted" style={{ padding: 16 }}>Jobs with a location appear here.</div>}
        </div>
      </div>
    );
  }

  // --- Desktop: side list + map ---
  return (
    <>
      <PageHeader title="Map" subtitle={`Dispatch locations · ${status} · ${MAP_PROVIDER}`} />
      <div className="map-grid">
        <div className="card" style={{ padding: 0, maxHeight: 580, overflow: 'auto' }}>
          {list.length ? list : <div className="muted" style={{ padding: 16 }}>Jobs with a location will appear here to plan the day’s route.</div>}
        </div>
        <div ref={mapEl} className="card map-canvas" style={{ minHeight: 580, overflow: 'hidden' }} />
      </div>
    </>
  );
}
