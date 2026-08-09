// Optional SMS notifications via Twilio (e.g. "your technician is on the way").
// Inert unless TWILIO_ACCOUNT_SID + TWILIO_AUTH_TOKEN + TWILIO_FROM are set.
// Dependency-free: raw fetch to Twilio's REST API. Credentials are server-only.

export const smsEnabled = () =>
  !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM);

// Best-effort E.164 normalization for US-style numbers; returns null if unusable.
export function normalizePhone(raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.startsWith('+')) return '+' + s.slice(1).replace(/\D/g, '');
  const d = s.replace(/\D/g, '');
  if (d.length === 10) return '+1' + d;
  if (d.length === 11 && d[0] === '1') return '+' + d;
  return d ? '+' + d : null;
}

export async function sendSMS(to, body) {
  if (!smsEnabled()) return { sent: false, skipped: 'not-configured' };
  const num = normalizePhone(to);
  if (!num) return { sent: false, skipped: 'no-phone' };
  const sid = process.env.TWILIO_ACCOUNT_SID;
  const auth = Buffer.from(`${sid}:${process.env.TWILIO_AUTH_TOKEN}`).toString('base64');
  const form = new URLSearchParams({ To: num, From: process.env.TWILIO_FROM, Body: String(body).slice(0, 640) });
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${sid}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form,
  });
  if (!res.ok) {
    let msg = `SMS failed (${res.status})`;
    try { msg = (await res.json())?.message || msg; } catch { /* ignore */ }
    throw new Error(msg);
  }
  return { sent: true };
}
