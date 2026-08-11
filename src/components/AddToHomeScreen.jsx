import { useEffect, useState } from 'react';
import { X, Share } from 'lucide-react';
import Logo from './Logo.jsx';

const DISMISSED_KEY = 'dispatch-a2hs-v1';

export default function AddToHomeScreen() {
  const [show, setShow] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [prompt, setPrompt] = useState(null);

  useEffect(() => {
    if (localStorage.getItem(DISMISSED_KEY)) return;
    if (window.matchMedia('(display-mode: standalone)').matches) return;

    const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) && !('MSStream' in window);
    setIsIOS(ios);

    if (ios) {
      // iOS doesn't fire beforeinstallprompt — show manual instructions after a delay.
      const t = setTimeout(() => setShow(true), 4000);
      return () => clearTimeout(t);
    }

    const handler = (e) => { e.preventDefault(); setPrompt(e); setTimeout(() => setShow(true), 4000); };
    window.addEventListener('beforeinstallprompt', handler);
    return () => window.removeEventListener('beforeinstallprompt', handler);
  }, []);

  const dismiss = () => { setShow(false); localStorage.setItem(DISMISSED_KEY, '1'); };

  const install = async () => {
    if (!prompt) return;
    prompt.prompt();
    const { outcome } = await prompt.userChoice;
    if (outcome === 'accepted') { setShow(false); localStorage.setItem(DISMISSED_KEY, '1'); }
    setPrompt(null);
  };

  if (!show) return null;

  return (
    <div style={{
      position: 'fixed', bottom: 80, left: 12, right: 12, zIndex: 9999,
      background: 'var(--surface)', border: '1px solid var(--border)',
      borderRadius: 18, padding: '14px 16px',
      boxShadow: '0 8px 32px rgba(0,0,0,.2)',
      display: 'flex', gap: 12, alignItems: 'flex-start',
      animation: 'a2hs-slide-up .3s ease',
    }}>
      <style>{`@keyframes a2hs-slide-up{from{opacity:0;transform:translateY(12px)}to{opacity:1;transform:translateY(0)}}`}</style>
      <Logo size={40} />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>Add Nexus Field to your Home Screen</div>
        {isIOS ? (
          <div style={{ fontSize: 13, color: 'var(--muted)', lineHeight: 1.5 }}>
            Tap <Share size={13} style={{ display: 'inline-block', verticalAlign: 'middle', marginBottom: 1 }} /> <strong>Share</strong> → <strong>Add to Home Screen</strong> for fast offline access.
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: 'var(--muted)', marginBottom: 10 }}>
              Install for fast offline access — works without the App Store.
            </div>
            <button className="btn btn-primary" style={{ fontSize: 13, padding: '7px 16px' }} onClick={install}>
              Install app
            </button>
          </>
        )}
      </div>
      <button onClick={dismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--muted)', padding: 2, flexShrink: 0, marginTop: -2 }}>
        <X size={18} />
      </button>
    </div>
  );
}
