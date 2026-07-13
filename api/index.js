// Vercel serverless entry. Vercel's Node runtime passes standard
// http.IncomingMessage / http.ServerResponse objects — exactly what Express
// expects — so we can hand the request straight to the app. No serverless-http
// wrapper needed.
import app from '../server.js';

export default function handler(req, res) {
  return app(req, res);
}

export const config = { runtime: 'nodejs' };
