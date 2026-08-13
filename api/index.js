// Vercel serverless entry. Vercel's Node runtime passes standard
// http.IncomingMessage / http.ServerResponse objects — exactly what Express
// expects — so we can hand the request straight to the app. No serverless-http
// wrapper needed.
//
// Sentry MUST be the first import here so it initializes before server.js pulls
// in Express (ESM evaluates imports top-to-bottom); this is the Vercel-side
// equivalent of the local `--import ./instrument.mjs` flag.
import '../instrument.mjs';
import app from '../server.js';

export default function handler(req, res) {
  return app(req, res);
}

export const config = { runtime: 'nodejs' };
