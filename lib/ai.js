// Optional AI assistant, backed by Anthropic's Messages API. Inert unless
// ANTHROPIC_API_KEY is set (like Sentry). We stream Server-Sent Events so the
// client renders tokens as they arrive instead of waiting for the full reply.
//
// Deliberately dependency-free: a single fetch() to the REST endpoint rather
// than pulling in the SDK, matching this app's "run with zero setup" posture.
// The key is server-only and never reaches the browser.

const API_URL = 'https://api.anthropic.com/v1/messages';
// Default to a current, capable model; override per-deploy with ANTHROPIC_MODEL.
const MODEL = process.env.ANTHROPIC_MODEL || 'claude-opus-5';

export const aiConfigured = () => !!process.env.ANTHROPIC_API_KEY;

// The assistant is advisory only. This system prompt encodes the FTC-aligned
// guardrails we also disclose in the privacy policy: no fabrication, no
// professional advice, no autonomous actions, human stays in control.
const SYSTEM = `You are an assistant embedded in Dispatch, a field-service job-management app for a small business.
Help the user draft, summarize, and clarify work content (job notes, punch-list items, schedules, messages).
Rules:
- Be concise and practical. Prefer short, skimmable output.
- You only draft and suggest. You never take actions, dispatch jobs, or make decisions with legal, financial, safety, or medical consequences.
- If you are unsure or lack the information, say so plainly rather than inventing details. Do not fabricate names, prices, dates, or facts.
- You are not a lawyer, accountant, doctor, or safety authority; recommend the user verify anything important.`;

// Yields text chunks from Claude for a single-turn prompt. Throws on transport
// or API error so the caller can surface a clean message. `context` is optional
// workspace text the user chose to include.
export async function* streamAssist({ prompt, context }) {
  if (!aiConfigured()) throw new Error('AI is not configured');
  const userText = context
    ? `Context from my workspace:\n${context}\n\n---\n\nRequest: ${prompt}`
    : prompt;

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': process.env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 1024,
      stream: true,
      system: SYSTEM,
      messages: [{ role: 'user', content: String(prompt ? userText : '').slice(0, 12000) }],
    }),
  });

  if (!res.ok || !res.body) {
    let detail = '';
    try { detail = (await res.json())?.error?.message || ''; } catch { /* ignore */ }
    throw new Error(detail || `AI request failed (${res.status})`);
  }

  // Parse the SSE stream: accumulate bytes, split on newlines, and pull the
  // text out of each `content_block_delta` with a `text_delta`.
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    let nl;
    while ((nl = buf.indexOf('\n')) !== -1) {
      const line = buf.slice(0, nl).trim();
      buf = buf.slice(nl + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === '[DONE]') continue;
      let evt;
      try { evt = JSON.parse(payload); } catch { continue; }
      if (evt.type === 'content_block_delta' && evt.delta?.type === 'text_delta') {
        yield evt.delta.text;
      } else if (evt.type === 'error') {
        throw new Error(evt.error?.message || 'AI stream error');
      }
    }
  }
}
