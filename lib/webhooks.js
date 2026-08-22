// Outbound webhook signing/delivery. Mirrors nexus-core's
// packages/standards/src/webhooks.js inline — same cross-repo-dependency
// reasoning as lib/apiKeys.js above. Field owns the actual `webhooks`/
// `webhook_deliveries` tables and the "which subscriptions match this
// event" lookup; this module only knows how to sign, deliver-once, and
// compute a backoff delay.
import crypto from 'node:crypto';
import { store } from './store.js';

export function signPayload(secret, rawBody) {
  return crypto.createHmac('sha256', secret).update(rawBody, 'utf8').digest('hex');
}

export function nextBackoffMs(attemptCount, { baseMs = 30_000, maxMs = 6 * 60 * 60_000 } = {}) {
  return Math.min(baseMs * 2 ** Math.max(0, attemptCount - 1), maxMs);
}

async function deliverOnce(url, payload, secret, { timeoutMs = 10_000 } = {}) {
  const rawBody = JSON.stringify(payload);
  const signature = signPayload(secret, rawBody);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'X-Nexus-Signature': `sha256=${signature}` },
      body: rawBody,
      signal: controller.signal,
    });
    return { ok: res.ok, status: res.status, error: res.ok ? null : `HTTP ${res.status}` };
  } catch (e) {
    return { ok: false, status: null, error: e?.name === 'AbortError' ? 'timeout' : (e?.message || 'delivery failed') };
  } finally {
    clearTimeout(timer);
  }
}

const MAX_ATTEMPTS = 5;

// Looks up every enabled webhook subscribed to `eventType` for this org and
// enqueues (then attempts) a delivery for each. Never throws — a webhook
// misconfiguration or an unreachable customer endpoint must never break the
// mutation that triggered it (same "additive, not load-bearing" posture as
// the existing audit_log inserts this is threaded alongside).
export async function dispatchEvent(orgId, eventType, data) {
  let hooks;
  try { hooks = await store.listWebhooksForEvent(orgId, eventType); } catch { return; }
  const payload = { event: eventType, org_id: orgId, timestamp: new Date().toISOString(), data };
  for (const hook of hooks) {
    let delivery;
    try { delivery = await store.createWebhookDelivery(hook.id, eventType, payload); } catch { continue; }
    const result = await deliverOnce(hook.url, payload, hook.secret);
    await recordAttempt(hook, delivery, result).catch(() => {});
  }
}

async function recordAttempt(hook, delivery, result) {
  const attempt_count = (delivery.attempt_count || 0) + 1;
  if (result.ok) {
    return store.updateWebhookDelivery(delivery.id, { status: 'success', attempt_count, last_error: null, next_attempt_at: null });
  }
  if (attempt_count >= MAX_ATTEMPTS) {
    return store.updateWebhookDelivery(delivery.id, { status: 'failed', attempt_count, last_error: result.error, next_attempt_at: null });
  }
  const next = new Date(Date.now() + nextBackoffMs(attempt_count)).toISOString();
  return store.updateWebhookDelivery(delivery.id, { status: 'pending', attempt_count, last_error: result.error, next_attempt_at: next });
}

// Called from the /api/cron/daily job (piggybacked per the cron-budget
// rule) — retries every delivery whose next_attempt_at is due.
export async function retryDueDeliveries() {
  const due = await store.listDueWebhookDeliveries();
  for (const delivery of due) {
    const hook = await store.getWebhook(delivery.webhook_id);
    if (!hook?.enabled) { await store.updateWebhookDelivery(delivery.id, { status: 'failed', last_error: 'webhook disabled' }).catch(() => {}); continue; }
    const result = await deliverOnce(hook.url, delivery.payload, hook.secret);
    await recordAttempt(hook, delivery, result).catch(() => {});
  }
}
