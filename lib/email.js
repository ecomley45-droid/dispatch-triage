// Optional transactional email via Resend (e.g. a staff reply to a customer
// ticket). Inert unless RESEND_API_KEY is set. Dependency-free: raw fetch to
// Resend's REST API. The API key is server-only.
//
// The "from" address is per-workspace: each org configures its own sender under
// feature_flags.email = { from, fromName, replyTo } (Settings → Communication),
// so a workspace emails customers from its own domain. A verified sending domain
// must exist in the Resend account for delivery to that domain to succeed.

export const emailEnabled = () => !!process.env.RESEND_API_KEY;

const emailRe = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

// Resolve the org's configured sender, falling back to a platform default env.
// Returns { from, replyTo } or null when no usable from-address is available.
export function orgSender(org) {
  const cfg = org?.feature_flags?.email || {};
  const addr = (cfg.from || process.env.EMAIL_FROM || '').trim();
  if (!emailRe.test(addr)) return null;
  const name = (cfg.fromName || org?.name || '').trim();
  const from = name ? `${name.replace(/[<>"]/g, '')} <${addr}>` : addr;
  const replyTo = emailRe.test((cfg.replyTo || '').trim()) ? cfg.replyTo.trim() : undefined;
  return { from, replyTo };
}

// Send one email. Best-effort: returns { sent:false, skipped } instead of
// throwing when unconfigured or the recipient/sender is unusable, so callers can
// fire-and-forget without guarding every path. A provider error still throws.
export async function sendEmail(org, { to, subject, text, html }) {
  if (!emailEnabled()) return { sent: false, skipped: 'not-configured' };
  if (!emailRe.test(String(to || '').trim())) return { sent: false, skipped: 'no-recipient' };
  const sender = orgSender(org);
  if (!sender) return { sent: false, skipped: 'no-sender' };
  const body = {
    from: sender.from,
    to: [String(to).trim()],
    subject: String(subject || '').slice(0, 200),
    text: text ? String(text) : undefined,
    html: html ? String(html) : undefined,
  };
  if (sender.replyTo) body.reply_to = sender.replyTo;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    let msg = `Email failed (${res.status})`;
    try { msg = (await res.json())?.message || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return { sent: true };
}
