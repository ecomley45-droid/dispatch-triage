import { useEffect, useRef, useState } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { api } from '../lib/api.js';
import { PageHeader, Badge } from '../components/ui.jsx';

// Client-side geocoding via OpenStreetMap Nominatim, cached in localStorage so
// each address is only looked up once. Good enough for planning a day's route;
// for scale you'd geocode on save and store lat/lng (e.g. Azure Maps).
const memCache = {};
async function geocode(address) {
  if (!address) return null;
  const key = 'geo:' + address.trim().toLowerCase();
  if (memCache[key]) return memCache[key];
  try { const c = localStorage.getItem(key); if (c) return (memCache[key] = JSON.parse(c)); } catch { /* ignore */ }
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`);
    const data = await res.json();
    if (!data.length) return null;
    const pt = { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) };
    memCache[key] = pt;
    try { localStorage.setItem(key, JSON.stringify(pt)); } catch { /* ignore */ }
    return pt;
  } catch { return null; }
}

const STATUS_COLOR = { scheduled: '#127c6e', en_route: '#cf8a12', in_progress: '#127c6e', completed: '#5f9e1f', unscheduled: '#8a97a0', cancelled: '#d64524' };
const pinIcon = (color) => L.divIcon({
  className: '',
  html: `<div style="width:18px;height:18px;border-radius:50% 50% 50% 0;background:${color};transform:rotate(-45deg);border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.4)"></div>`,
  iconSize: [18, 18], iconAnchor: [9, 18], popupAnchor: [0, -16],
});

export default function MapView() {
  const mapEl = useRef(null);
  const mapRef = useRef(null);
  const markersRef = useRef({});
  const [jobs, setJobs] = useState([]);
  const [located, setLocated] = useState([]);
  const [status, setStatus] = useState('Loading…');

  useEffect(() => { api.get('/jobs').then(setJobs).catch(() => setJobs([])); }, []);

  // Init the Leaflet map once (with cleanup so React StrictMode re-mounts cleanly).
  useEffect(() => {
    if (!mapEl.current) return;
    const map = L.map(mapEl.current).setView([34.85, -82.4], 8); // Upstate SC default
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© OpenStreetMap contributors', maxZoom: 19,
    }).addTo(map);
    mapRef.current = map;
    return () => { map.remove(); mapRef.current = null; markersRef.current = {}; };
  }, []);

  // Geocode jobs and drop markers whenever the job list changes.
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
        await new Promise((r) => setTimeout(r, 250)); // be gentle on the geocoder
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
      if (bounds.length) map.fitBounds(bounds, { padding: [40, 40], maxZoom: 13 });
    })();
    return () => { cancelled = true; };
  }, [jobs]);

  const focus = (job) => {
    const m = markersRef.current[job.id];
    if (m && mapRef.current) { mapRef.current.setView(m.getLatLng(), 14); m.openPopup(); }
  };

  return (
    <>
      <PageHeader title="Map" subtitle={`Dispatch locations · ${status}`} />
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(240px, 300px) 1fr', gap: 16 }}>
        <div className="card" style={{ padding: 0, maxHeight: 580, overflow: 'auto' }}>
          {located.map(({ job }) => (
            <button key={job.id} onClick={() => focus(job)} style={{ display: 'block', width: '100%', textAlign: 'left', padding: '12px 14px', border: 'none', borderBottom: '1px solid var(--border)', background: 'transparent', color: 'inherit', cursor: 'pointer' }}>
              <div style={{ fontWeight: 600 }}>{job.title}</div>
              <div className="muted" style={{ fontSize: 12, margin: '2px 0 6px' }}>{job.location}</div>
              <Badge value={job.status} />
            </button>
          ))}
          {!located.length && <div className="muted" style={{ padding: 16 }}>Jobs with a location will appear here to plan the day’s route.</div>}
        </div>
        <div ref={mapEl} className="card" style={{ minHeight: 580, overflow: 'hidden' }} />
      </div>
    </>
  );
}
