import { useRef, useState } from 'react';
import { Sparkles } from 'lucide-react';
import { api } from '../lib/api.js';

// Optional AI drafting assistant. Renders only when the workspace has it enabled
// (see useMe().features.ai). Streams the reply token-by-token over SSE.
//
// The in-UI disclosure below is intentional: AI content is clearly labeled and
// its limits stated, consistent with the FTC AI disclosure in the Privacy Policy.
export default function AskAI() {
  const [prompt, setPrompt] = useState('');
  const [out, setOut] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const abortRef = useRef(null);

  const run = async (e) => {
    e?.preventDefault();
    const p = prompt.trim();
    if (!p || busy) return;
    setBusy(true); setErr(null); setOut('');
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    try {
      await api.streamSSE('/ai/assist', { prompt: p }, {
        signal: ctrl.signal,
        onText: (chunk) => setOut((s) => s + chunk),
      });
    } catch (ex) {
      if (ex.name !== 'AbortError') setErr(ex.message || 'AI request failed');
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const stop = () => abortRef.current?.abort();

  return (
    <div className="card" style={{ padding: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
        <Sparkles size={16} style={{ color: 'var(--primary)' }} />
        <strong style={{ fontSize: 14 }}>Ask Dispatch AI</strong>
        <span className="badge badge-blue" style={{ marginLeft: 'auto' }}>AI · beta</span>
      </div>
      <form onSubmit={run} style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          className="input"
          style={{ flex: 1, minWidth: 200 }}
          placeholder="e.g. Draft a punch-list item for a leaking chair water line"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          disabled={busy}
        />
        {busy
          ? <button type="button" className="btn" onClick={stop}>Stop</button>
          : <button type="submit" className="btn btn-teal" disabled={!prompt.trim()}>Draft</button>}
      </form>

      {(out || busy) && (
        <div style={{ marginTop: 12, whiteSpace: 'pre-wrap', fontSize: 13.5, lineHeight: 1.6 }}>
          {out}{busy && <span className="muted">▍</span>}
        </div>
      )}
      {err && <div className="badge badge-red" style={{ marginTop: 10 }}>{err}</div>}

      <p className="muted" style={{ fontSize: 11.5, marginTop: 12, marginBottom: 0 }}>
        AI-generated · can be inaccurate — review before use. It only drafts; it takes no actions.{' '}
        <a href="/legal/privacy">How we use AI</a>.
      </p>
    </div>
  );
}
