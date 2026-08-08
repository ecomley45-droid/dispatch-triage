import { useEffect, useState } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { Loading, useResource, PageHeader, Badge, Modal, Field, money, date } from '../components/ui.jsx';

const term = (t) => (t || '').replace(/_/g, ' ');
const r2 = (n) => Math.round(Number(n) * 100) / 100;
const LINE_BLANK = { description: '', quantity: 1, unit_price: 0 };

export default function InvoiceDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const me = useMe();
  const [inv, setInv] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [err, setErr] = useState(null);
  const lines = useResource(`/invoice-lines?invoice_id=${id}`);

  const [lineForm, setLineForm] = useState(LINE_BLANK);
  const [payOpen, setPayOpen] = useState(false);
  const [payAmt, setPayAmt] = useState('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  const canInvoice = me.can('invoices:write');

  const load = () => api.get(`/invoices/${id}`).then((i) => {
    setInv(i); setNotes(i.notes || '');
    if (i.customer_id) api.get(`/customers/${i.customer_id}`).then(setCustomer).catch(() => {});
  }).catch((e) => setErr(e.message));
  useEffect(() => { load(); }, [id]);

  if (err) return <p className="badge badge-red">{err}</p>;
  if (!inv) return <Loading label="Loading invoice…" />;

  const tpl = me.org?.feature_flags?.invoice || {};
  const isDraft = inv.status === 'draft';
  const editable = canInvoice && isDraft;
  const balance = Math.max(0, Number(inv.total || 0) - Number(inv.amount_paid || 0));

  // Recompute denormalized totals from the given line set + tax rate, and persist.
  const syncTotals = async (lineList, taxRate = Number(inv.tax_rate) || 0) => {
    const subtotal = r2(lineList.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0));
    const tax_amount = r2(subtotal * taxRate / 100);
    const total = r2(subtotal + tax_amount);
    setInv(await api.patch(`/invoices/${id}`, { subtotal, tax_rate: taxRate, tax_amount, total }));
  };

  const addLine = async (e) => {
    e.preventDefault(); setSaving(true);
    try {
      const amount = r2(Number(lineForm.quantity) * Number(lineForm.unit_price));
      const row = await lines.create({ invoice_id: id, description: lineForm.description, quantity: Number(lineForm.quantity), unit_price: Number(lineForm.unit_price), amount });
      setLineForm(LINE_BLANK);
      await syncTotals([row, ...lines.rows]);
    } finally { setSaving(false); }
  };
  const removeLine = async (lineId) => {
    await lines.remove(lineId);
    await syncTotals(lines.rows.filter((l) => l.id !== lineId));
  };
  const setTaxRate = async (rate) => { await syncTotals(lines.rows, Number(rate) || 0); };
  const patch = async (body) => setInv(await api.patch(`/invoices/${id}`, body));

  const recordPayment = async (e) => {
    e.preventDefault();
    const amt = Number(payAmt);
    if (!(amt > 0)) return;
    const paid = r2(Number(inv.amount_paid || 0) + amt);
    await patch({ amount_paid: paid, status: paid >= Number(inv.total) ? 'paid' : inv.status });
    setPayOpen(false); setPayAmt('');
  };
  const markPaid = () => patch({ amount_paid: Number(inv.total), status: 'paid' });

  return (
    <>
      {/* Hide app chrome + editing controls when printing */}
      <style>{`@media print {
        .sidebar, .topbar, .bottom-nav, .app-shell > .main > footer, .no-print { display: none !important; }
        .content { padding: 0 !important; }
        body, .app-shell, .main { background: #fff !important; }
        .invoice-sheet { box-shadow: none !important; border: none !important; }
      }`}</style>

      <div className="no-print">
        <PageHeader
          title={`${inv.number || 'Invoice'}`}
          subtitle={<><Link to="/invoices">Invoices</Link>{customer && <> · <Link to={`/customers/${customer.id}`}>{customer.name}</Link></>}{inv.work_order_id && <> · <Link to={`/work-orders/${inv.work_order_id}`}>source work order</Link></>}</>}
          action={<div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <Badge value={inv.status} />
            {canInvoice && isDraft && <button className="btn btn-primary" disabled={saving} onClick={() => patch({ status: 'sent' })}>Mark as sent</button>}
            {canInvoice && inv.status === 'sent' && <button className="btn btn-primary" onClick={() => setPayOpen(true)}>Record payment</button>}
            {canInvoice && inv.status === 'sent' && <button className="btn" onClick={markPaid}>Mark paid</button>}
            {canInvoice && inv.status !== 'void' && inv.status !== 'paid' && <button className="btn btn-danger" onClick={() => { if (confirm('Void this invoice?')) patch({ status: 'void' }); }}>Void</button>}
            <button className="btn" onClick={() => window.print()}>Print / PDF</button>
          </div>} />
      </div>

      {/* Printable invoice sheet */}
      <div className="card invoice-sheet" style={{ padding: 32, maxWidth: 800, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>{tpl.business_name || me.org?.name || 'Dispatch'}</div>
            {tpl.address && <div className="muted" style={{ fontSize: 12 }}>{tpl.address}</div>}
            {(tpl.email || tpl.phone) && <div className="muted" style={{ fontSize: 12 }}>{[tpl.email, tpl.phone].filter(Boolean).join(' · ')}</div>}
            <div className="muted" style={{ fontSize: 13, marginTop: 2 }}>Invoice</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{inv.number}</div>
            <div className="muted" style={{ fontSize: 13 }}>Issued {date(inv.issue_date)}</div>
            <div className="muted" style={{ fontSize: 13 }}>Due {date(inv.due_date)}</div>
            <div style={{ marginTop: 4 }}><Badge value={inv.status} /></div>
          </div>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '20px 0' }} />

        <div>
          <div className="label">Bill to</div>
          <div style={{ fontWeight: 600 }}>{customer?.name || '—'}</div>
          {customer?.billing_address && <div>{customer.billing_address}</div>}
          {customer?.billing_email && <div className="muted" style={{ fontSize: 13 }}>{customer.billing_email}</div>}
          {customer && <div className="muted" style={{ fontSize: 13 }}>Terms: {term(customer.payment_terms)}</div>}
        </div>

        <table className="data" style={{ marginTop: 18 }}>
          <thead><tr><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Unit price</th><th style={{ textAlign: 'right' }}>Amount</th>{editable && <th className="no-print" />}</tr></thead>
          <tbody>
            {lines.rows.map((l) => (
              <tr key={l.id}>
                <td>{l.description}</td>
                <td style={{ textAlign: 'right' }}>{Number(l.quantity)}</td>
                <td style={{ textAlign: 'right' }}>{money(l.unit_price)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(Number(l.quantity) * Number(l.unit_price))}</td>
                {editable && <td className="no-print" style={{ textAlign: 'right' }}><button className="btn btn-danger" onClick={() => removeLine(l.id)}>Remove</button></td>}
              </tr>
            ))}
            {!lines.rows.length && <tr><td colSpan={editable ? 5 : 4} className="muted" style={{ textAlign: 'center', padding: 18 }}>No line items.</td></tr>}
          </tbody>
        </table>

        {/* Totals */}
        <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 14 }}>
          <table style={{ minWidth: 260 }}>
            <tbody>
              <tr><td className="muted" style={{ padding: '2px 12px' }}>Subtotal</td><td style={{ textAlign: 'right', padding: '2px 0' }}>{money(inv.subtotal)}</td></tr>
              <tr><td className="muted" style={{ padding: '2px 12px' }}>Tax ({Number(inv.tax_rate)}%)</td><td style={{ textAlign: 'right', padding: '2px 0' }}>{money(inv.tax_amount)}</td></tr>
              <tr style={{ borderTop: '2px solid var(--border)' }}><td style={{ fontWeight: 800, padding: '4px 12px' }}>Total</td><td style={{ textAlign: 'right', fontWeight: 800, padding: '4px 0' }}>{money(inv.total)}</td></tr>
              {Number(inv.amount_paid) > 0 && <tr><td className="muted" style={{ padding: '2px 12px' }}>Paid</td><td style={{ textAlign: 'right', padding: '2px 0' }}>−{money(inv.amount_paid)}</td></tr>}
              <tr><td style={{ fontWeight: 700, padding: '2px 12px' }}>Balance due</td><td style={{ textAlign: 'right', fontWeight: 700, padding: '2px 0' }}>{money(balance)}</td></tr>
            </tbody>
          </table>
        </div>

        {inv.notes && <div style={{ marginTop: 18 }}><div className="label">Notes</div><div style={{ whiteSpace: 'pre-wrap' }}>{inv.notes}</div></div>}
        {tpl.footer && <div className="muted" style={{ marginTop: 20, textAlign: 'center', fontSize: 13 }}>{tpl.footer}</div>}
      </div>

      {/* Draft editing controls (never printed) */}
      {editable && (
        <div className="card no-print" style={{ padding: 18, maxWidth: 800, margin: '16px auto 0' }}>
          <h3 style={{ marginTop: 0, fontSize: 16 }}>Edit draft</h3>
          <form onSubmit={addLine} style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: 14 }}>
            <div style={{ flex: '1 1 200px' }}><Field label="Description"><input className="input" required value={lineForm.description} onChange={(e) => setLineForm({ ...lineForm, description: e.target.value })} /></Field></div>
            <div style={{ width: 90 }}><Field label="Qty"><input className="input" type="number" step="0.25" value={lineForm.quantity} onChange={(e) => setLineForm({ ...lineForm, quantity: e.target.value })} /></Field></div>
            <div style={{ width: 120 }}><Field label="Unit price"><input className="input" type="number" step="0.01" value={lineForm.unit_price} onChange={(e) => setLineForm({ ...lineForm, unit_price: e.target.value })} /></Field></div>
            <button className="btn btn-teal" type="submit" disabled={saving} style={{ marginBottom: 14 }}>+ Add line</button>
          </form>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 12 }}>
            <Field label="Tax rate (%)"><input className="input" type="number" step="0.001" defaultValue={inv.tax_rate} onBlur={(e) => setTaxRate(e.target.value)} /></Field>
            <Field label="Due date"><input className="input" type="date" defaultValue={inv.due_date || ''} onBlur={(e) => patch({ due_date: e.target.value || null })} /></Field>
          </div>
          <Field label="Notes (shown on the invoice)"><textarea className="input" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} onBlur={() => notes !== (inv.notes || '') && patch({ notes })} /></Field>
        </div>
      )}

      {payOpen && (
        <Modal title="Record payment" onClose={() => setPayOpen(false)}>
          <form onSubmit={recordPayment}>
            <p className="muted" style={{ marginTop: 0 }}>Balance due: <b>{money(balance)}</b></p>
            <Field label="Amount received ($)"><input className="input" type="number" step="0.01" autoFocus value={payAmt} onChange={(e) => setPayAmt(e.target.value)} /></Field>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setPayAmt(String(balance))}>Full balance</button>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" className="btn" onClick={() => setPayOpen(false)}>Cancel</button>
                <button type="submit" className="btn btn-primary">Record</button>
              </div>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
