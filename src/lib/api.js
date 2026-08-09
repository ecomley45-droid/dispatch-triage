// Thin fetch wrapper. When Clerk is active, useMe.jsx registers a token getter
// so every request carries a bearer token; in dev-bypass mode there's no token
// and the server synthesizes a viewer.
let getToken = async () => null;
export function setTokenGetter(fn) { getToken = fn; }

// The active workspace slug (from the /space/<slug> URL). Sent as X-Workspace so
// the server scopes the request to that workspace — after verifying membership.
let getWorkspace = () => null;
export function setWorkspaceGetter(fn) { getWorkspace = fn; }
function authHeaders(base = {}) {
  const ws = getWorkspace();
  if (ws) base['X-Workspace'] = ws;
  return base;
}

async function request(path, { method = 'GET', body, raw = false } = {}) {
  const headers = authHeaders({ 'Content-Type': 'application/json' });
  const token = await getToken().catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method,
    headers,
    credentials: 'include',
    body: body ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return raw ? { data: null, res } : null;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return raw ? { data, res } : data;
}

// Fetch a whole collection while keeping every HTTP request bounded: follow the
// server's keyset cursor (X-Next-Cursor header) page by page and concatenate.
// Use this for any list the client aggregates over (timesheets, P&L) so a
// server-side page limit can never silently truncate a money total. `sep`
// preserves an existing query string when appending the cursor.
async function list(path, { pages = 100 } = {}) {
  const sep = path.includes('?') ? '&' : '?';
  let out = [];
  let cursor = null;
  for (let i = 0; i < pages; i++) {
    const url = cursor ? `${path}${sep}before=${encodeURIComponent(cursor)}` : path;
    const { data, res } = await request(url, { raw: true });
    if (Array.isArray(data)) out = out.concat(data);
    cursor = res.headers.get('X-Next-Cursor');
    if (!cursor) break;
  }
  return out;
}

// Stream a Server-Sent-Events endpoint (the AI assistant). Calls onText(chunk)
// as tokens arrive; resolves when the stream ends. Honors an AbortSignal.
async function streamSSE(path, body, { onText, signal } = {}) {
  const headers = authHeaders({ 'Content-Type': 'application/json' });
  const token = await getToken().catch(() => null);
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(`/api${path}`, {
    method: 'POST', headers, credentials: 'include', body: JSON.stringify(body), signal,
  });
  if (!res.ok || !res.body) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.error || `Request failed (${res.status})`);
  }
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let event = 'message';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).replace(/\r$/, '');
      buf = buf.slice(nl + 1);
      if (line.startsWith('event:')) { event = line.slice(6).trim(); continue; }
      if (!line.startsWith('data:')) { if (line === '') event = 'message'; continue; }
      const payload = line.slice(5).trim();
      let obj = {};
      try { obj = JSON.parse(payload); } catch { /* ignore */ }
      if (event === 'error') throw new Error(obj.error || 'Stream error');
      if (event === 'done') return;
      if (obj.text) onText?.(obj.text);
    }
  }
}

export const api = {
  get: (p) => request(p),
  list,
  post: (p, body) => request(p, { method: 'POST', body }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
  streamSSE,
};
