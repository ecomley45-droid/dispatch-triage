import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';
import App from './App.jsx';
import SuperApp from './super/SuperApp.jsx';
import LegalApp from './pages/Legal.jsx';
import PortalApp from './pages/Portal.jsx';
import { MeProvider } from './lib/useMe.jsx';
import { setTokenGetter, setWorkspaceGetter } from './lib/api.js';
import { RESERVED_SEGMENTS } from './lib/routes.js';
import SignInScreen from './components/SignInScreen.jsx';
import './index.css';

// Workspaces live at bare /:orgSlug/*. The active workspace slug is the first
// path segment when it isn't a reserved top-level word. Every /api call carries
// it; the server verifies membership (or honors a super-admin view-as cookie).
const firstSegment = () => (window.location.pathname.split('/')[1] || '');
setWorkspaceGetter(() => { const s = firstSegment(); return s && !RESERVED_SEGMENTS.has(s) ? s : null; });

// Error monitoring — inert unless VITE_SENTRY_DSN is set. Enabled only in real
// deploys by default (set VITE_SENTRY_FORCE=1 to test locally).
const sentryDsn = import.meta.env.VITE_SENTRY_DSN;
if (sentryDsn) {
  Sentry.init({
    dsn: sentryDsn,
    environment: import.meta.env.MODE,
    enabled: import.meta.env.PROD || import.meta.env.VITE_SENTRY_FORCE === '1',
    integrations: [Sentry.browserTracingIntegration()],
    tracesSampleRate: 0.1,
  });
}

// The authenticated app lives on ONE origin (app.<domain>) so Clerk sessions
// never straddle two origins. Surfaces are chosen by the first path segment:
//   /super-admin/*  → Super Admin console
//   /:orgSlug/*     → a client workspace
//   /legal, /portal → public, link-based trees
// admin.<domain> is only an edge redirect to app.<domain>/super-admin.
const host = window.location.hostname;
const seg1 = firstSegment();
const isLegal = seg1 === 'legal';
const isPortal = seg1 === 'portal';
const isSuper = seg1 === 'super-admin';

// Belt-and-suspenders: if we somehow render on admin.<domain>, bounce to the
// app origin's /super-admin (vercel.json also does this at the edge).
if (host.startsWith('admin.')) {
  const root = host.split('.').slice(1).join('.');
  window.location.replace(`${window.location.protocol}//app.${root}/super-admin`);
}

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Registers Clerk's session-token getter with the API layer so every /api
// call carries a bearer token the Express backend (@clerk/express) verifies.
function TokenBridge({ children }) {
  const { getToken } = useAuth();
  useEffect(() => { setTokenGetter(() => getToken()); }, [getToken]);
  return children;
}

const signedInApp = (
  <TokenBridge>
    <MeProvider>
      <App />
    </MeProvider>
  </TokenBridge>
);

// The super-admin tree shares Clerk auth + the token bridge but manages its own
// session (SuperMeProvider inside SuperApp).
const signedInSuper = (
  <TokenBridge>
    <SuperApp />
  </TokenBridge>
);

// With Clerk configured, gate on the real session. Without it (local dev,
// no key), skip straight to the app — the server's dev-bypass synthesizes a
// Manager Admin viewer so you can work offline.
const tree = isPortal ? (
  <PortalApp />
) : isLegal ? (
  <LegalApp />
) : clerkKey ? (
  // Sign-in renders INLINE on this origin (no signInUrl → no bounce to a second
  // page/origin). After sign-in, <SignedIn> routes to the workspace or console.
  <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/" appearance={{ variables: { colorPrimary: '#127c6e' } }}>
    <SignedOut><SignInScreen /></SignedOut>
    <SignedIn>{isSuper ? signedInSuper : signedInApp}</SignedIn>
  </ClerkProvider>
) : isSuper ? (
  // Dev bypass (no Clerk key): the server synthesizes a platform-admin viewer.
  <SuperApp />
) : (
  <MeProvider>
    <App />
  </MeProvider>
);

createRoot(document.getElementById('root')).render(<StrictMode>{tree}</StrictMode>);
