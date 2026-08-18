import { useMemo } from 'react';
import { marked } from 'marked';
import DOMPurify from 'dompurify';

marked.setOptions({ breaks: true, gfm: true });

// Announcement/release-note bodies are admin-authored markdown, stored as
// plain text and rendered here — never trust the stored/rendered HTML as a
// source of truth (regenerate it from the markdown each time), and always
// sanitize before dangerouslySetInnerHTML: a compromised or careless
// super-admin account writing here would otherwise get stored XSS shown to
// every user in every workspace, since these entries are platform-wide.
export default function Markdown({ text, style }) {
  const html = useMemo(() => DOMPurify.sanitize(marked.parse(text || '')), [text]);
  return <div className="markdown-body" style={style} dangerouslySetInnerHTML={{ __html: html }} />;
}
