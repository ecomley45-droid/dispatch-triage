import { useMemo, useState } from 'react';
import { Search, ArrowLeft, LifeBuoy } from 'lucide-react';
import { useMe } from '../lib/useMe.jsx';
import { ARTICLES, searchDocs, getArticle } from '../lib/docs.js';
import { PageHeader } from '../components/ui.jsx';

const SUPPORT_EMAIL = import.meta.env.VITE_SUPPORT_EMAIL || 'support@dispatch.app';

function Block({ b }) {
  if (b.h) return <h3 style={{ fontSize: 15, margin: '18px 0 6px' }}>{b.h}</h3>;
  if (b.p) return <p style={{ margin: '0 0 12px', lineHeight: 1.65 }}>{b.p}</p>;
  if (b.steps) return <ol style={{ margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.6 }}>{b.steps.map((s, i) => <li key={i} style={{ margin: '4px 0' }}>{s}</li>)}</ol>;
  if (b.list) return <ul style={{ margin: '0 0 12px', paddingLeft: 20, lineHeight: 1.6 }}>{b.list.map((s, i) => <li key={i} style={{ margin: '4px 0' }}>{s}</li>)}</ul>;
  return null;
}

export default function Help() {
  const me = useMe();
  const [q, setQ] = useState('');
  const [openId, setOpenId] = useState(null);

  const results = useMemo(() => searchDocs(q), [q]);
  const categories = useMemo(() => {
    const map = {};
    for (const a of ARTICLES) (map[a.category] ||= []).push(a);
    return Object.entries(map);
  }, []);

  const supportHref = () => {
    const subject = encodeURIComponent('Dispatch support request');
    const body = encodeURIComponent(`\n\n———\nWorkspace: ${me.org?.name || ''}\nUser: ${me.viewer?.email || ''} (${me.viewer?.role || ''})\nPage: ${openId || 'Help center'}`);
    return `mailto:${SUPPORT_EMAIL}?subject=${subject}&body=${body}`;
  };

  const article = openId ? getArticle(openId) : null;

  return (
    <>
      <PageHeader title="Help center" subtitle="Guides, how-tos, and troubleshooting"
        action={<a className="btn btn-teal" href={supportHref()}><LifeBuoy size={15} style={{ marginRight: 6 }} /> Contact support</a>} />

      {/* Search */}
      <div className="card" style={{ padding: 0, marginBottom: 18, display: 'flex', alignItems: 'center', gap: 8, paddingLeft: 12 }}>
        <Search size={18} className="muted" style={{ flexShrink: 0 }} />
        <input className="input" style={{ border: 0, background: 'transparent', fontSize: 15 }} placeholder="Search help… (e.g. invoice, clock in, overdue)" value={q} onChange={(e) => { setQ(e.target.value); setOpenId(null); }} autoFocus />
      </div>

      {/* Search results */}
      {q.trim() && !article && (
        <div>
          <p className="muted" style={{ fontSize: 13, marginTop: 0 }}>{results.length} result{results.length === 1 ? '' : 's'} for “{q.trim()}”</p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {results.map(({ article: a, snippet }) => (
              <button key={a.id} className="card" onClick={() => setOpenId(a.id)} style={{ display: 'block', textAlign: 'left', padding: 16, cursor: 'pointer' }}>
                <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--primary)' }}>{a.category}</div>
                <div style={{ fontWeight: 700, margin: '3px 0 4px' }}>{a.title}</div>
                <div className="muted" style={{ fontSize: 13 }}>{snippet}</div>
              </button>
            ))}
            {!results.length && <div className="muted" style={{ padding: 16 }}>No matches. Try different keywords, or <a href={supportHref()}>contact support</a>.</div>}
          </div>
        </div>
      )}

      {/* Article view */}
      {article && (
        <div className="card" style={{ padding: 'clamp(18px, 4vw, 28px)', maxWidth: 720 }}>
          <button className="btn" onClick={() => setOpenId(null)} style={{ marginBottom: 14 }}><ArrowLeft size={15} style={{ marginRight: 6 }} /> Back</button>
          <div style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--primary)' }}>{article.category}</div>
          <h2 style={{ margin: '4px 0 14px', fontSize: 22 }}>{article.title}</h2>
          {article.body.map((b, i) => <Block key={i} b={b} />)}
        </div>
      )}

      {/* Browse by category */}
      {!q.trim() && !article && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 300px), 1fr))', gap: 16 }}>
          {categories.map(([cat, list]) => (
            <div key={cat} className="card" style={{ padding: 18 }}>
              <h3 style={{ marginTop: 0, fontSize: 15 }}>{cat}</h3>
              <div style={{ display: 'flex', flexDirection: 'column' }}>
                {list.map((a) => (
                  <button key={a.id} onClick={() => setOpenId(a.id)} style={{ textAlign: 'left', background: 'transparent', border: 0, borderTop: '1px solid var(--border)', padding: '10px 0', cursor: 'pointer', color: 'var(--primary)', fontWeight: 600, fontSize: 13.5 }}>{a.title}</button>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </>
  );
}
