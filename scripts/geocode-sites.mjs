// One-off repair: geocode every site missing lat/lon in place (UPDATE only —
// never wipes/reinserts, unlike seed-fdh-locations.mjs). Nominatim's usage
// policy caps at 1 req/sec, so this is slow by design.
//
//   node scripts/geocode-sites.mjs
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { db } from '../lib/db.js';

const ORG = 'family-dental';
const sb = db();
if (!sb) { console.error('Supabase not configured.'); process.exit(1); }

async function geocode(address) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, {
      headers: { 'User-Agent': 'DispatchFieldService/1.0 (repair script; contact: support@nexusfieldhub.com)' },
    });
    if (!res.ok) { console.warn(`  HTTP ${res.status} for "${address}"`); return null; }
    const data = await res.json();
    return data.length ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
  } catch (e) {
    console.warn(`  fetch failed for "${address}": ${e.message}`);
    return null;
  }
}

async function main() {
  const { data: sites, error } = await sb.from('sites').select('id,name,address,lat,lon').eq('org_id', ORG).is('lat', null);
  if (error) throw new Error(error.message);
  console.log(`${sites.length} sites missing coordinates.`);

  let ok = 0, failed = 0;
  for (const s of sites) {
    if (!s.address) { failed++; continue; }
    const pt = await geocode(s.address);
    if (pt) {
      const { error: uErr } = await sb.from('sites').update({ lat: pt.lat, lon: pt.lon }).eq('id', s.id);
      if (uErr) { console.warn(`  update failed for ${s.name}: ${uErr.message}`); failed++; }
      else { ok++; console.log(`  ✓ ${s.name} -> ${pt.lat}, ${pt.lon}`); }
    } else {
      failed++;
      console.log(`  ✗ ${s.name} (${s.address}) — no match`);
    }
    await new Promise((r) => setTimeout(r, 1100)); // 1 req/sec
  }
  console.log(`\nDone: ${ok} geocoded, ${failed} failed.`);
}

main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
