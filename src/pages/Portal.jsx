import { BrowserRouter, Routes, Route, useParams } from 'react-router-dom';
import { useEffect, useState } from 'react';
import Logo from '../components/Logo.jsx';
import { Badge } from '../components/ui.jsx';

const money = (n) => (n == null || n === '' ? '—' : `$${Number(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`);
const date = (d) => (d ? new Date(d).toLocaleDateString() : '—');

const when = (s) => (s ? new Date(s).toLocaleString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—');
const BLANK = { title: '', description: '', priority: 'medium', site_id: '', contact: '' };

function Portal() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [err, setErr] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [saving, setSaving] = useState(false);
  const [sent, setSent] = useState(null);
  const [openWo, setOpenWo] = useState(null);       // expanded work order id
  const [reply, setReply] = useState({});           // ticketId -> draft text
  const [newTicket, setNewTicket] = useState({ subject: '', body: '', contact: '', work_order_id: '' });
  const [ticketMsg, setTicketMsg] = useState(null);

  const load = () => fetch(`/api/portal/${token}`).then((r) => { if (!r.ok) throw new Error('This portal link is invalid or has expired.'); return r.json(); }).then(setData).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [token]);

  const sendTicketReply = async (ticketId) => {
    const body = (reply[ticketId] || '').trim();
    if (!body) return;
    try {
      const r = await fetch(`/api/portal/${token}/tickets/${ticketId}/messages`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ body }) });
      if (!r.ok) throw new Error((await r.json()).error || 'Could not send');
      setReply((x) => ({ ...x, [ticketId]: '' })); load();
    } catch (ex) { setErr(ex.message); }
  };
  const openTicket = async (e) => {
    e.preventDefault();
    if (!newTicket.subject.trim() || !newTicket.body.trim()) return;
    try {
      const r = await fetch(`/api/portal/${token}/tickets`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(newTicket) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not submit');
      setNewTicket({ subject: '', body: '', contact: '', work_order_id: '' }); setTicketMsg(j.number); load();
    } catch (ex) { setErr(ex.message); }
  };

  const submit = async (e) => {
    e.preventDefault(); setSaving(true); setSent(null);
    try {
      const r = await fetch(`/api/portal/${token}/requests`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(form) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not submit');
      setSent(j.number); setForm(BLANK); load();
    } catch (ex) { setSent(null); setErr(ex.message); } finally { setSaving(false); }
  };

  const pay = async (number) => {
    try {
      const r = await fetch(`/api/portal/${token}/pay`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ number }) });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start payment');
      window.location.href = j.url;
    } catch (ex) { setErr(ex.message); }
  };

  if (err && !data) return <div style={{ maxWidth: 560, margin: '80px auto', textAlign: 'center', fontFamily: 'system-ui, sans-serif', color: '#12211d', padding: 24 }}><h2>Portal unavailable</h2><p style={{ color: '#56685f' }}>{err}</p></div>;
  if (!data) return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}><div className="loadingbar"><span /></div></div>;

  const card = { background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 14, padding: 18, marginBottom: 16 };

  return (
    <div style={{ minHeight: '100%', background: 'var(--bg)', color: 'var(--text)' }}>
      <div style={{ maxWidth: 720, margin: '0 auto', padding: '24px 16px 64px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <Logo size={26} />
          <span style={{ fontWeight: 800, fontSize: 18 }}>{data.org.name}</span>
        </header>
        <h1 style={{ fontSize: 24, margin: '10px 0 2px' }}>Customer portal</h1>
        <p className="muted" style={{ marginTop: 0 }}>{data.customer.name}</p>
        {new URLSearchParams(window.location.search).get('paid') === '1' && (
          <p style={{ background: 'color-mix(in srgb, #5f9e1f 16%, transparent)', color: '#4c7d18', padding: '8px 12px', borderRadius: 8 }}>Payment received — thank you! It may take a moment to reflect below.</p>
        )}

        {/* Request form */}
        <div style={{ ...card, marginTop: 12 }}>
          <h3 style={{ marginTop: 0 }}>Request service</h3>
          {sent && <p style={{ background: 'color-mix(in srgb, #5f9e1f 16%, transparent)', color: '#4c7d18', padding: '8px 12px', borderRadius: 8 }}>Thanks! Your request was received as <b>{sent}</b>. We'll be in touch.</p>}
          <form onSubmit={submit}>
            <label className="label">What do you need help with?</label>
            <input className="input" required placeholder="e.g. Chair #3 water line leaking" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginTop: 12 }} className="portal-pair">
              <div><label className="label">Location</label>
                <select className="input" value={form.site_id} onChange={(e) => setForm({ ...form, site_id: e.target.value })}>
                  <option value="">— select —</option>
                  {data.sites.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                </select>
              </div>
              <div><label className="label">Priority</label>
                <select className="input" value={form.priority} onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                  {['low', 'medium', 'high', 'urgent'].map((p) => <option key={p} value={p}>{p}</option>)}
                </select>
              </div>
            </div>
            <label className="label" style={{ marginTop: 12 }}>Details</label>
            <textarea className="input" rows={3} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <label className="label" style={{ marginTop: 12 }}>Your name / contact</label>
            <input className="input" value={form.contact} onChange={(e) => setForm({ ...form, contact: e.target.value })} />
            <div style={{ marginTop: 14, textAlign: 'right' }}><button className="btn btn-primary" type="submit" disabled={saving}>{saving ? 'Sending…' : 'Submit request'}</button></div>
          </form>
        </div>

        {/* Work orders */}
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Your service requests</h3>
          {data.workOrders.length ? data.workOrders.map((w) => {
            const expanded = openWo === w.id;
            return (
              <div key={w.number} style={{ padding: '10px 0', borderTop: '1px solid var(--border)' }}>
                <button onClick={() => setOpenWo(expanded ? null : w.id)} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, width: '100%', background: 'transparent', border: 'none', textAlign: 'left', cursor: 'pointer', color: 'inherit', padding: 0 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontWeight: 600 }}>{w.number} · {w.title}</div>
                    <div className="muted" style={{ fontSize: 12.5 }}>{w.scheduled_start ? `Scheduled ${when(w.scheduled_start)}` : 'Not yet scheduled'} · {expanded ? 'Hide details ▲' : 'View details ▼'}</div>
                  </div>
                  <Badge value={w.status} />
                </button>
                {expanded && (
                  <div style={{ marginTop: 10, paddingLeft: 2, fontSize: 13.5 }}>
                    {w.site_name && <div style={{ marginBottom: 6 }}><b>Location:</b> {w.site_name}</div>}
                    <div style={{ marginBottom: 6 }}><b>Priority:</b> {w.priority}</div>
                    {w.scheduled_start && <div style={{ marginBottom: 6 }}><b>Scheduled:</b> {when(w.scheduled_start)}{w.scheduled_end ? ` – ${when(w.scheduled_end)}` : ''}</div>}
                    {w.description && <div style={{ marginBottom: 6, whiteSpace: 'pre-wrap' }}><b>Details:</b> {w.description}</div>}
                    {w.completed_at && <div style={{ marginBottom: 6 }}><b>Completed:</b> {when(w.completed_at)}</div>}
                    {w.resolution_notes && <div style={{ marginBottom: 6, whiteSpace: 'pre-wrap' }}><b>Resolution:</b> {w.resolution_notes}</div>}
                    <button className="btn" style={{ marginTop: 4 }} onClick={() => { setNewTicket((n) => ({ ...n, work_order_id: w.id, subject: n.subject || `Re: ${w.number} ${w.title}` })); document.getElementById('portal-messages')?.scrollIntoView({ behavior: 'smooth' }); }}>Message us about this</button>
                  </div>
                )}
              </div>
            );
          }) : <p className="muted">No requests yet.</p>}
        </div>

        {/* Messages / tickets */}
        <div id="portal-messages" style={card}>
          <h3 style={{ marginTop: 0 }}>Messages</h3>
          {data.tickets?.length ? data.tickets.map((t) => (
            <div key={t.id} style={{ padding: '12px 0', borderTop: '1px solid var(--border)' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                <div style={{ fontWeight: 600 }}>{t.number} · {t.subject}{t.work_order_number ? ` (${t.work_order_number})` : ''}</div>
                <Badge value={t.status} />
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, margin: '8px 0' }}>
                {t.messages.map((m) => {
                  const staff = m.author_type === 'staff';
                  return (
                    <div key={m.id} style={{ alignSelf: staff ? 'flex-start' : 'flex-end', maxWidth: '85%', background: staff ? 'var(--surface-2)' : 'var(--primary)', color: staff ? 'var(--text)' : '#fff', borderRadius: 12, padding: '8px 12px' }}>
                      <div style={{ fontSize: 11, opacity: 0.85, marginBottom: 2 }}>{m.author_name} · {when(m.created_at)}</div>
                      <div style={{ whiteSpace: 'pre-wrap', fontSize: 13.5 }}>{m.body}</div>
                    </div>
                  );
                })}
              </div>
              {t.status !== 'closed' && (
                <div style={{ display: 'flex', gap: 8 }}>
                  <input className="input" placeholder="Reply…" value={reply[t.id] || ''} onChange={(e) => setReply((x) => ({ ...x, [t.id]: e.target.value }))} onKeyDown={(e) => { if (e.key === 'Enter') sendTicketReply(t.id); }} />
                  <button className="btn btn-primary" onClick={() => sendTicketReply(t.id)}>Send</button>
                </div>
              )}
            </div>
          )) : <p className="muted">No messages yet. Start a conversation below.</p>}

          {/* New conversation */}
          <form onSubmit={openTicket} style={{ borderTop: '1px solid var(--border)', marginTop: 12, paddingTop: 12 }}>
            <h4 style={{ margin: '0 0 8px' }}>Start a new message</h4>
            {ticketMsg && <p style={{ background: 'color-mix(in srgb, #5f9e1f 16%, transparent)', color: '#4c7d18', padding: '8px 12px', borderRadius: 8 }}>Sent as <b>{ticketMsg}</b> — we'll reply here and by email.</p>}
            {newTicket.work_order_id && <p className="muted" style={{ fontSize: 12 }}>About: {data.workOrders.find((w) => w.id === newTicket.work_order_id)?.number}</p>}
            <input className="input" placeholder="Subject" value={newTicket.subject} onChange={(e) => setNewTicket({ ...newTicket, subject: e.target.value })} />
            <textarea className="input" rows={3} placeholder="How can we help?" style={{ marginTop: 8 }} value={newTicket.body} onChange={(e) => setNewTicket({ ...newTicket, body: e.target.value })} />
            <input className="input" placeholder="Your name (optional)" style={{ marginTop: 8 }} value={newTicket.contact} onChange={(e) => setNewTicket({ ...newTicket, contact: e.target.value })} />
            <div style={{ marginTop: 10, textAlign: 'right' }}><button className="btn btn-primary" type="submit">Send message</button></div>
          </form>
        </div>

        {/* Invoices */}
        <div style={card}>
          <h3 style={{ marginTop: 0 }}>Invoices</h3>
          {data.invoices.length ? data.invoices.map((i) => {
            const bal = Number(i.total) - Number(i.amount_paid || 0);
            const payable = data.org.payments && bal > 0 && i.status !== 'paid';
            return (
              <div key={i.number} style={{ display: 'flex', justifyContent: 'space-between', gap: 10, alignItems: 'center', padding: '10px 0', borderTop: '1px solid var(--border)', flexWrap: 'wrap' }}>
                <div><div style={{ fontWeight: 600 }}>{i.number}</div><div className="muted" style={{ fontSize: 12.5 }}>Issued {date(i.issue_date)} · Due {date(i.due_date)}</div></div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ textAlign: 'right' }}><div style={{ fontWeight: 700 }}>{money(i.total)}</div><Badge value={i.status} /></div>
                  {payable && <button className="btn btn-primary" onClick={() => pay(i.number)}>Pay now</button>}
                </div>
              </div>
            );
          }) : <p className="muted">No invoices yet.</p>}
        </div>

        <p className="muted" style={{ fontSize: 12, textAlign: 'center' }}>Powered by {data.org.name} · This is your private link — please don't share it.</p>
      </div>
      <style>{`@media (max-width:520px){ .portal-pair{ grid-template-columns:1fr !important; } }`}</style>
    </div>
  );
}

export default function PortalApp() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/portal/:token" element={<Portal />} />
      </Routes>
    </BrowserRouter>
  );
}
