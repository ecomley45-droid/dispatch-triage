// In-memory request counters for Nexus Command's uptime/requests graphs
// (comley-nexus-ecosystem-migration-plan.md §1/§4). Reset on process
// restart — /api/metrics also reports uptime_seconds, so Command can tell a
// counter reset apart from a real drop in traffic rather than misreading it.

let total = 0;
const byOrg = new Map();

export function countRequest(orgId) {
  total += 1;
  if (orgId) byOrg.set(orgId, (byOrg.get(orgId) || 0) + 1);
}

export function getRequestCounts() {
  return { total, by_org: Object.fromEntries(byOrg) };
}

// --- CPU usage, sampled since the last /api/metrics call ---
// process.cpuUsage() returns cumulative microseconds since process start, so
// we snapshot it (and the wall-clock time) each time it's read and diff
// against the previous snapshot. Relative to a single core: 100% means this
// process kept one core fully busy over the elapsed window.
let lastCpuUsage = process.cpuUsage();
let lastCpuTime = Date.now();

export function getCpuPercent() {
  try {
    const usage = process.cpuUsage(lastCpuUsage); // delta since lastCpuUsage
    const elapsedUs = (Date.now() - lastCpuTime) * 1000;
    lastCpuUsage = process.cpuUsage();
    lastCpuTime = Date.now();
    if (elapsedUs <= 0) return null;
    const pct = ((usage.user + usage.system) / elapsedUs) * 100;
    return Math.max(0, Math.min(100, Math.round(pct * 10) / 10));
  } catch {
    return null;
  }
}

// --- Latency: rolling window of the last 500 response times (ms) ---
// Fixed-size ring buffer, so worst-case memory is ~500 numbers (a few KB) —
// bounded regardless of traffic volume, and reset on process restart like
// the counters above.
const LATENCY_WINDOW = 500;
const latencies = [];

export function recordLatency(ms) {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return;
  latencies.push(ms);
  if (latencies.length > LATENCY_WINDOW) latencies.shift();
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

export function getLatencyStats() {
  if (!latencies.length) return null;
  try {
    const sorted = [...latencies].sort((a, b) => a - b);
    const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
    return {
      p50: Math.round(percentile(sorted, 50)),
      p95: Math.round(percentile(sorted, 95)),
      avg: Math.round(avg),
    };
  } catch {
    return null;
  }
}

export function requestCounterMiddleware(req, res, next) {
  countRequest(req.org?.id || null);
  const start = Date.now();
  res.on('finish', () => {
    try { recordLatency(Date.now() - start); } catch { /* never break the response */ }
  });
  next();
}
