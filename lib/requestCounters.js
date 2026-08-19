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

export function requestCounterMiddleware(req, _res, next) {
  countRequest(req.org?.id || null);
  next();
}
