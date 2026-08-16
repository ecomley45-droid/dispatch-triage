// Second pass for sites Nominatim couldn't match: strips suite/unit/floor
// tokens (which Nominatim's exact address matcher chokes on) and retries.
// UPDATE only, same as geocode-sites.mjs.
//
//   node scripts/geocode-sites-retry.mjs
import dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config();
import { db } from '../lib/db.js';

const ORG = 'family-dental';
const sb = db();
if (!sb) { console.error('Supabase not configured.'); process.exit(1); }

// Drop ", Suite X" / ", Ste X" / ", Suite M" / "#X" / "STE X" style unit
// designators — the building itself still geocodes fine without them.
function simplify(address) {
  return address
    .replace(/,?\s*(suite|ste|unit|#)\s*[\w-]+/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

async function geocode(address) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=1&q=${encodeURIComponent(address)}`, {
      headers: { 'User-Agent': 'DispatchFieldService/1.0 (repair script; contact: support@nexusfieldhub.com)' },
    });
    if (!res.ok) return null;
    const data = await res.json();
    return data.length ? { lat: parseFloat(data[0].lat), lon: parseFloat(data[0].lon) } : null;
  } catch { return null; }
}

async function main() {
  const { data: sites, error } = await sb.from('sites').select('id,name,address').eq('org_id', ORG).is('lat', null);
  if (error) throw new Error(error.message);
  console.log(`${sites.length} sites still missing coordinates.`);

  let ok = 0, failed = 0;
  for (const s of sites) {
    const simplified = simplify(s.address || '');
    const pt = await geocode(simplified);
    if (pt) {
      await sb.from('sites').update({ lat: pt.lat, lon: pt.lon }).eq('id', s.id);
      ok++; console.log(`  ✓ ${s.name} ("${simplified}") -> ${pt.lat}, ${pt.lon}`);
    } else {
      failed++; console.log(`  ✗ ${s.name} ("${simplified}") — still no match`);
    }
    await new Promise((r) => setTimeout(r, 1100));
  }
  console.log(`\nDone: ${ok} more geocoded, ${failed} still failing.`);
}

main().catch((e) => { console.error('Failed:', e.message); process.exit(1); });
