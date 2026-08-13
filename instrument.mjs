// Sentry server initialization. This MUST run before Express is imported so
// Sentry's ESM auto-instrumentation can hook it — and because ESM hoists all
// `import` statements to the top of a module, an inline `Sentry.init()` in
// server.js would run too late (express is already imported). So init lives in
// its own module, loaded first two ways:
//   • locally  — `node --import ./instrument.mjs server.js` (see package.json)
//   • Vercel   — the first import in api/index.js, before server.js
//
// Inert (no-op) unless SENTRY_DSN is set, so nothing changes without config.
import dotenv from 'dotenv';
// Match server.js: .env.local wins, then .env fills gaps. On Vercel these files
// don't exist and the vars come from the platform — dotenv is then a harmless no-op.
dotenv.config({ path: '.env.local' });
dotenv.config();
import * as Sentry from '@sentry/node';

if (process.env.SENTRY_DSN) {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    tracesSampleRate: 0.1,
  });
}
