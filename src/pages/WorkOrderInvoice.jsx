import { useEffect, useState } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { Loading, money, date } from '../components/ui.jsx';

const term = (t) => (t || '').replace(/_/g, ' ');
const fdate = (d) => (d ? new Date(d).toLocaleDateString() : '—');

// Print-optimized service report / invoice for a single work order. Renders from
// existing data (no new tables); "Print / Save PDF" uses the browser's print
// dialog. App chrome is hidden in print via the scoped @media print rules below.
export default function WorkOrderInvoice() {
  const { id } = useParams();
  const me = useMe();
  const [wo, setWo] = useState(null);
  const [customer, setCustomer] = useState(null);
  const [site, setSite] = useState(null);
  const [asset, setAsset] = useState(null);
  const [lines, setLines] = useState([]);
  const [err, setErr] = useState(null);

  useEffect(() => {
    api.get(`/work-orders/${id}`).then((w) => {
      setWo(w);
      if (w.customer_id) api.get(`/customers/${w.customer_id}`).then(setCustomer).catch(() => {});
      if (w.site_id) api.get(`/sites/${w.site_id}`).then(setSite).catch(() => {});
      if (w.asset_id) api.get(`/assets/${w.asset_id}`).then(setAsset).catch(() => {});
    }).catch((e) => setErr(e.message));
    api.list(`/work-order-lines?work_order_id=${id}`).then(setLines).catch(() => setLines([]));
  }, [id]);

  if (err) return <p className="badge badge-red">{err}</p>;
  if (!wo) return <Loading label="Loading work order…" />;

  const total = lines.reduce((s, l) => s + Number(l.quantity) * Number(l.unit_price), 0);
  const kindLabel = (k, qty) => (k === 'labor' ? `Labor · ${qty} hr` : k === 'part' ? 'Part' : 'Other');

  return (
    <>
      <style>{`
        @media print {
          .sidebar, .topbar, .bottom-nav, .app-shell > .main > footer, .no-print { display: none !important; }
          .content { padding: 0 !important; }
          body, .app-shell, .main { background: #fff !important; }
          .invoice-sheet { box-shadow: none !important; border: none !important; }
        }
      `}</style>

      <div className="no-print" style={{ display: 'flex', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
        <Link to={`/work-orders/${id}`} className="btn">← Back to work order</Link>
        <button className="btn btn-primary" onClick={() => window.print()}>Print / Save PDF</button>
      </div>

      <div className="card invoice-sheet" style={{ padding: 32, maxWidth: 780, margin: '0 auto' }}>
        {/* Header */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          <div>
            <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--primary)' }}>{me.org?.name || 'Dispatch'}</div>
            <div className="muted" style={{ fontSize: 13 }}>Service Report &amp; Invoice</div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontWeight: 800, fontSize: 18 }}>{wo.number || 'Work Order'}</div>
            <div className="muted" style={{ fontSize: 13 }}>Issued {fdate(wo.completed_at || new Date().toISOString())}</div>
            <div style={{ marginTop: 4, textTransform: 'capitalize' }}>{String(wo.status || '').replace(/_/g, ' ')}</div>
          </div>
        </div>

        <hr style={{ border: 0, borderTop: '1px solid var(--border)', margin: '20px 0' }} />

        {/* Bill-to + service location */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>
          <div>
            <div className="label">Bill to</div>
            <div style={{ fontWeight: 600 }}>{customer?.name || '—'}</div>
            {customer?.billing_address && <div>{customer.billing_address}</div>}
            {customer?.billing_email && <div className="muted" style={{ fontSize: 13 }}>{customer.billing_email}</div>}
            {customer && <div className="muted" style={{ fontSize: 13 }}>Terms: {term(customer.payment_terms)}{customer.po_required ? ' · PO required' : ''}</div>}
          </div>
          <div>
            <div className="label">Service location</div>
            <div style={{ fontWeight: 600 }}>{site?.name || '—'}</div>
            {site?.address && <div>{site.address}</div>}
            {asset && <div className="muted" style={{ fontSize: 13 }}>Asset: {asset.name}{asset.serial ? ` (SN ${asset.serial})` : ''}</div>}
            {wo.scheduled_start && <div className="muted" style={{ fontSize: 13 }}>Serviced: {fdate(wo.scheduled_start)}</div>}
          </div>
        </div>

        <div style={{ marginTop: 20 }}>
          <div className="label">Work performed</div>
          <div style={{ fontWeight: 600 }}>{wo.title}</div>
          {wo.description && <div className="muted" style={{ fontSize: 13, whiteSpace: 'pre-wrap' }}>{wo.description}</div>}
        </div>

        {/* Line items */}
        <table className="data" style={{ marginTop: 18 }}>
          <thead><tr><th>Type</th><th>Description</th><th style={{ textAlign: 'right' }}>Qty</th><th style={{ textAlign: 'right' }}>Unit price</th><th style={{ textAlign: 'right' }}>Amount</th></tr></thead>
          <tbody>
            {lines.map((l) => (
              <tr key={l.id}>
                <td style={{ textTransform: 'capitalize' }}>{kindLabel(l.kind, Number(l.quantity))}</td>
                <td>{l.description}</td>
                <td style={{ textAlign: 'right' }}>{Number(l.quantity)}</td>
                <td style={{ textAlign: 'right' }}>{money(l.unit_price)}</td>
                <td style={{ textAlign: 'right', fontWeight: 600 }}>{money(Number(l.quantity) * Number(l.unit_price))}</td>
              </tr>
            ))}
            {!lines.length && <tr><td colSpan={5} className="muted" style={{ textAlign: 'center', padding: 20 }}>No billable line items.</td></tr>}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)' }}>
              <td colSpan={4} style={{ textAlign: 'right', fontWeight: 700 }}>Total due</td>
              <td style={{ textAlign: 'right', fontWeight: 800, fontSize: 16 }}>{money(total)}</td>
            </tr>
          </tfoot>
        </table>

        {wo.resolution_notes && (
          <div style={{ marginTop: 18 }}>
            <div className="label">Resolution</div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{wo.resolution_notes}</div>
          </div>
        )}

        {/* Sign-off */}
        <div style={{ marginTop: 26, display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20, alignItems: 'end' }}>
          <div>
            <div className="label">Approved by</div>
            {wo.signature_url
              ? <img src={wo.signature_url} alt="signature" style={{ maxWidth: 200, maxHeight: 70 }} />
              : <div style={{ borderBottom: '1px solid var(--text)', height: 40 }} />}
            <div className="muted" style={{ fontSize: 12, marginTop: 4 }}>{wo.signature_name || 'Customer signature'}</div>
          </div>
          <div style={{ textAlign: 'right' }} className="muted">
            <div style={{ fontSize: 12 }}>Thank you for your business.</div>
          </div>
        </div>
      </div>
    </>
  );
}
