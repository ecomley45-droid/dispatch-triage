// Applies db/schema.sql to a Postgres/Supabase database.
//
// Usage:
//   SUPABASE_DB_URL=postgres://... npm run db:apply
//
// SUPABASE_DB_URL is the direct connection string from the Supabase dashboard
// (Project Settings → Database → Connection string → URI). Needs the `pg`
// package: `npm i pg`. If pg or the URL is missing, this prints instructions
// so you can paste db/schema.sql into the Supabase SQL editor instead.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import 'dotenv/config';

const here = dirname(fileURLToPath(import.meta.url));
const sql = readFileSync(join(here, 'schema.sql'), 'utf8');
const url = process.env.SUPABASE_DB_URL;

if (!url) {
  console.log(
    '\nNo SUPABASE_DB_URL set. Two ways to apply the schema:\n' +
      '  1. Supabase dashboard → SQL Editor → paste the contents of db/schema.sql → Run.\n' +
      '  2. Set SUPABASE_DB_URL (and `npm i pg`), then re-run `npm run db:apply`.\n'
  );
  process.exit(0);
}

let pg;
try {
  pg = await import('pg');
} catch {
  console.error('The `pg` package is not installed. Run: npm i pg');
  process.exit(1);
}

const client = new pg.default.Client({ connectionString: url });
await client.connect();
try {
  await client.query(sql);
  console.log('Schema applied successfully.');
} finally {
  await client.end();
}
