// Optional online card payments via Stripe. Inert unless STRIPE_SECRET_KEY is
// set. Dependency-free: raw fetch to Stripe's REST API + HMAC webhook
// verification with node:crypto, matching this app's lightweight-integration
// posture. The secret key is server-only and never reaches the browser.
import crypto from 'node:crypto';

export const paymentsEnabled = () => !!process.env.STRIPE_SECRET_KEY;

// Create a Stripe Checkout Session for a one-off amount; returns the hosted URL.
export async function createCheckout({ amountCents, name, successUrl, cancelUrl, metadata = {} }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Payments are not configured');
  const body = new URLSearchParams();
  body.set('mode', 'payment');
  body.set('success_url', successUrl);
  body.set('cancel_url', cancelUrl);
  body.set('line_items[0][quantity]', '1');
  body.set('line_items[0][price_data][currency]', 'usd');
  body.set('line_items[0][price_data][unit_amount]', String(amountCents));
  body.set('line_items[0][price_data][product_data][name]', name);
  for (const [k, v] of Object.entries(metadata)) if (v != null) body.set(`metadata[${k}]`, String(v));

  const res = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe checkout failed');
  return { url: data.url, id: data.id };
}

// Create a Stripe Billing Portal session for a subscription customer. Returns
// the hosted URL where the customer manages their plan / payment method. Used
// by the super-admin console to manage a workspace's platform subscription.
export async function createBillingPortalSession({ customerId, returnUrl }) {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error('Payments are not configured');
  if (!customerId) throw new Error('A Stripe customer id is required');
  const body = new URLSearchParams();
  body.set('customer', customerId);
  if (returnUrl) body.set('return_url', returnUrl);
  const res = await fetch('https://api.stripe.com/v1/billing_portal/sessions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data?.error?.message || 'Stripe billing portal failed');
  return { url: data.url, id: data.id };
}

// Verify a Stripe webhook signature and return the parsed event, or null.
// Implements Stripe's scheme: header "t=<ts>,v1=<sig>", sig = HMAC-SHA256 of
// `${t}.${rawBody}` with the endpoint's signing secret.
export function verifyWebhook(rawBody, sigHeader, secret, toleranceSec = 300) {
  if (!secret || !sigHeader || !rawBody) return null;
  const parts = Object.fromEntries(String(sigHeader).split(',').map((kv) => kv.split('=')));
  const t = parts.t; const v1 = parts.v1;
  if (!t || !v1) return null;
  if (Math.abs(Date.now() / 1000 - Number(t)) > toleranceSec) return null;
  const payload = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : String(rawBody);
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex');
  const a = Buffer.from(expected); const b = Buffer.from(v1);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try { return JSON.parse(payload); } catch { return null; }
}
