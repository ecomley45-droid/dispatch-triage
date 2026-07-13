import { useEffect, useState } from 'react';
import { api } from '../lib/api.js';
import { useMe } from '../lib/useMe.jsx';
import { useResource, PageHeader, Modal, Field, money } from '../components/ui.jsx';

const BLANK_ITEM = { name: '', sku: '', unit: 'each', unit_cost: '', image_url: '' };

export default function Items() {
  const me = useMe();
  const { rows: items, create } = useResource('/items');
  const [usage, setUsage] = useState([]);
  const [projects, setProjects] = useState([]);
  const [addOpen, setAddOpen] = useState(false);
  const [useItem, setUseItem] = useState(null);
  const [item, setItem] = useState(BLANK_ITEM);
  const [useForm, setUseForm] = useState({ quantity: 1, project_id: '', notes: '' });
  const canWriteItems = me.can('items:write');
  const canLogUsage = me.can('usage:write');

  const loadUsage = () => api.get('/item-usage').then(setUsage).catch(() => setUsage([]));
  useEffect(() => { loadUsage(); api.get('/projects').then(setProjects).catch(() => {}); }, []);

  const usageFor = (itemId) => usage.filter((u) => u.item_id === itemId);
  const qtyUsed = (itemId) => usageFor(itemId).reduce((s, u) => s + Number(u.quantity || 0), 0);
  const costUsed = (itemId) => usageFor(itemId).reduce((s, u) => s + Number(u.quantity || 0) * Number(u.unit_cost_at_use || 0), 0);

  const addItem = async (e) => {
    e.preventDefault();
    await create({ ...item, unit_cost: item.unit_cost === '' ? 0 : Number(item.unit_cost) });
    setAddOpen(false); setItem(BLANK_ITEM);
  };

  const logUsage = async (e) => {
    e.preventDefault();
    const payload = { item_id: useItem.id, quantity: Number(useForm.quantity), unit_cost_at_use: Number(useItem.unit_cost), notes: useForm.notes };
    if (useForm.project_id) payload.project_id = useForm.project_id;
    await api.post('/item-usage', payload);
    setUseItem(null); setUseForm({ quantity: 1, project_id: '', notes: '' });
    loadUsage();
  };

  const grandTotal = usage.reduce((s, u) => s + Number(u.quantity || 0) * Number(u.unit_cost_at_use || 0), 0);

  return (
    <>
      <PageHeader title="Items & Costs" subtitle={`Item cost tracker · ${money(grandTotal)} logged across all projects`}
        action={canWriteItems && <button className="btn btn-primary" onClick={() => setAddOpen(true)}>+ New item</button>} />

      <div className="card">
        <table className="data">
          <thead><tr><th>Item</th><th>SKU</th><th>Unit</th><th>Cost / unit</th><th>Amount used</th><th>Total cost</th><th></th></tr></thead>
          <tbody>
            {items.map((it) => (
              <tr key={it.id}>
                <td style={{ fontWeight: 600, display: 'flex', alignItems: 'center', gap: 10 }}>
                  <div style={{ width: 34, height: 34, borderRadius: 6, background: 'var(--surface-2)', backgroundSize: 'cover', backgroundImage: it.image_url ? `url(${it.image_url})` : 'none' }} />
                  {it.name}
                </td>
                <td className="muted">{it.sku || '—'}</td>
                <td>{it.unit}</td>
                <td>{money(it.unit_cost)}</td>
                <td>{qtyUsed(it.id)} {it.unit}</td>
                <td style={{ fontWeight: 600 }}>{money(costUsed(it.id))}</td>
                <td>{canLogUsage && <button className="btn" style={{ padding: '4px 10px' }} onClick={() => setUseItem(it)}>Log usage</button>}</td>
              </tr>
            ))}
            {!items.length && <tr><td colSpan={7} className="muted" style={{ textAlign: 'center', padding: 32 }}>No items yet.</td></tr>}
          </tbody>
        </table>
      </div>

      {addOpen && (
        <Modal title="New item" onClose={() => setAddOpen(false)}>
          <form onSubmit={addItem}>
            <Field label="Item name"><input className="input" required value={item.name} onChange={(e) => setItem({ ...item, name: e.target.value })} /></Field>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12 }}>
              <Field label="SKU"><input className="input" value={item.sku} onChange={(e) => setItem({ ...item, sku: e.target.value })} /></Field>
              <Field label="Unit"><input className="input" value={item.unit} onChange={(e) => setItem({ ...item, unit: e.target.value })} /></Field>
              <Field label="Cost / unit ($)"><input className="input" type="number" step="0.01" required value={item.unit_cost} onChange={(e) => setItem({ ...item, unit_cost: e.target.value })} /></Field>
            </div>
            <Field label="Image URL (upload comes later)"><input className="input" placeholder="https://…" value={item.image_url} onChange={(e) => setItem({ ...item, image_url: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setAddOpen(false)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Add item</button>
            </div>
          </form>
        </Modal>
      )}

      {useItem && (
        <Modal title={`Log usage — ${useItem.name}`} onClose={() => setUseItem(null)}>
          <form onSubmit={logUsage}>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
              <Field label={`Quantity (${useItem.unit})`}><input className="input" type="number" step="0.01" min="0" required value={useForm.quantity} onChange={(e) => setUseForm({ ...useForm, quantity: e.target.value })} /></Field>
              <Field label="Project">
                <select className="input" value={useForm.project_id} onChange={(e) => setUseForm({ ...useForm, project_id: e.target.value })}>
                  <option value="">— none —</option>
                  {projects.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              </Field>
            </div>
            <p className="muted" style={{ fontSize: 13 }}>Captured cost: {money(Number(useItem.unit_cost) * Number(useForm.quantity || 0))} ({money(useItem.unit_cost)}/{useItem.unit})</p>
            <Field label="Notes"><input className="input" value={useForm.notes} onChange={(e) => setUseForm({ ...useForm, notes: e.target.value })} /></Field>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="btn" onClick={() => setUseItem(null)}>Cancel</button>
              <button type="submit" className="btn btn-primary">Log usage</button>
            </div>
          </form>
        </Modal>
      )}
    </>
  );
}
