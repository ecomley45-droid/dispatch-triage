// Sage Intacct integration. Each workspace supplies its OWN Intacct Web Services
// credentials (Settings → Integrations); we store them encrypted (lib/crypto.js)
// in the `integrations` table and talk to Intacct's XML Gateway on the
// workspace's behalf. Dependency-free: raw fetch of the XML API.
//
// Intacct auth is two-tier:
//   * sender  — the Web Services "sender id" + "sender password" (partner-level,
//     often shared; identifies the calling application to Intacct).
//   * login   — the workspace's Intacct company id + user id + user password.
// A login yields a session id used for subsequent calls. Docs:
// https://developer.intacct.com/web-services/
import { decryptSecret } from './crypto.js';

const GATEWAY = 'https://api.intacct.com/ia/xml/xmlgw.phtml';

// The non-secret shape a workspace configures. Secret fields are stored
// encrypted and only decrypted server-side at call time.
export const INTACCT_FIELDS = {
  sender_id: { label: 'Web Services sender ID', secret: false },
  sender_password: { label: 'Web Services sender password', secret: true },
  company_id: { label: 'Company ID', secret: false },
  user_id: { label: 'User ID', secret: false },
  user_password: { label: 'User password', secret: true },
  location_id: { label: 'Location/entity ID (optional)', secret: false },
};

// Resolve a stored integration row's config into usable credentials (decrypting
// the secret fields). Returns null when required fields are missing.
export function resolveIntacctConfig(row) {
  const c = row?.config || {};
  const cfg = {
    sender_id: c.sender_id || '',
    sender_password: decryptSecret(c.sender_password) || '',
    company_id: c.company_id || '',
    user_id: c.user_id || '',
    user_password: decryptSecret(c.user_password) || '',
    location_id: c.location_id || '',
  };
  const ok = cfg.sender_id && cfg.sender_password && cfg.company_id && cfg.user_id && cfg.user_password;
  return ok ? cfg : null;
}

const esc = (s) => String(s ?? '').replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));
const uid = () => 'req-' + Math.abs(Date.now()).toString(36);

// Wrap one or more <function> bodies in a full Intacct request envelope and POST
// it. Returns the parsed-ish result text. Throws with the Intacct error on failure.
async function callIntacct(cfg, functionsXml) {
  const controlId = uid();
  const xml =
    `<?xml version="1.0" encoding="UTF-8"?>` +
    `<request><control>` +
    `<senderid>${esc(cfg.sender_id)}</senderid>` +
    `<password>${esc(cfg.sender_password)}</password>` +
    `<controlid>${controlId}</controlid><uniqueid>false</uniqueid>` +
    `<dtdversion>3.0</dtdversion><includewhitespace>false</includewhitespace>` +
    `</control><operation><authentication><login>` +
    `<userid>${esc(cfg.user_id)}</userid>` +
    `<companyid>${esc(cfg.company_id)}</companyid>` +
    `<password>${esc(cfg.user_password)}</password>` +
    (cfg.location_id ? `<locationid>${esc(cfg.location_id)}</locationid>` : '') +
    `</login></authentication><content>${functionsXml}</content></operation></request>`;

  const res = await fetch(GATEWAY, {
    method: 'POST', headers: { 'Content-Type': 'application/xml' }, body: xml,
  });
  const text = await res.text();
  // The gateway returns 200 even for auth failures; surface the embedded error.
  const err = /<error>[\s\S]*?<description2?>([\s\S]*?)<\/description2?>/i.exec(text);
  const authFail = /<status>failure<\/status>/i.test(text) && /<authentication>/i.test(text);
  if (!res.ok || authFail || (/<result>[\s\S]*?<status>failure<\/status>/i.test(text) && err)) {
    throw new Error(err ? err[1].trim() : `Intacct request failed (${res.status})`);
  }
  return text;
}

// Verify credentials by asking Intacct for the current company's info. Returns
// { ok:true, company } or throws a human-readable error.
export async function testIntacct(cfg) {
  const fn = `<function controlid="c1"><getAPISession/></function>`;
  const text = await callIntacct(cfg, fn);
  const sid = /<sessionid>([\s\S]*?)<\/sessionid>/i.exec(text);
  if (!sid) throw new Error('Connected, but no session was returned — check the company/user credentials.');
  return { ok: true, company: cfg.company_id };
}

// Push an AR invoice into Intacct. `invoice` is our invoice row; `lines` are its
// invoice_lines. Minimal mapping — customer id must match an Intacct customer.
export async function pushInvoiceToIntacct(cfg, { invoice, lines, customerRef }) {
  const items = (lines || []).map((l) => (
    `<lineitem><glaccountno></glaccountno>` +
    `<amount>${esc(Number(l.amount ?? Number(l.quantity) * Number(l.unit_price)).toFixed(2))}</amount>` +
    `<memo>${esc(l.description || '')}</memo></lineitem>`
  )).join('');
  const fn =
    `<function controlid="inv1"><create_invoice>` +
    `<customerid>${esc(customerRef || '')}</customerid>` +
    `<datecreated><year>${invoice.issue_date?.slice(0, 4)}</year><month>${invoice.issue_date?.slice(5, 7)}</month><day>${invoice.issue_date?.slice(8, 10)}</day></datecreated>` +
    `<invoiceno>${esc(invoice.number || '')}</invoiceno>` +
    `<invoiceitems>${items}</invoiceitems>` +
    `</create_invoice></function>`;
  await callIntacct(cfg, fn);
  return { ok: true };
}
