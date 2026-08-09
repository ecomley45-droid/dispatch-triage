import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';
import App from './App.jsx';
import LegalApp from './pages/Legal.jsx';
import PortalApp from './pages/Portal.jsx';
import { MeProvider } from './lib/useMe.jsx';
import { setTokenGetter } from './lib/api.js';
import SignInScreen from './components/SignInScreen.jsx';
import './index.css';

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

// Legal pages are public — they must render without a session (and before the
// Clerk gate). Reached via full-page links (<a href="/legal/…">), so a simple
// path check here routes them to a standalone, auth-free tree.
const isLegal = window.location.pathname.startsWith('/legal');
// The customer portal is public and link-based — no login, no Clerk.
const isPortal = window.location.pathname.startsWith('/portal');

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

// With Clerk configured, gate on the real session. Without it (local dev,
// no key), skip straight to the app — the server's dev-bypass synthesizes a
// Manager Admin viewer so you can work offline.
const tree = isPortal ? (
  <PortalApp />
) : isLegal ? (
  <LegalApp />
) : clerkKey ? (
  <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/" appearance={{ variables: { colorPrimary: '#127c6e' } }}>
    <SignedOut>
      <SignInScreen />
    </SignedOut>
    <SignedIn>{signedInApp}</SignedIn>
  </ClerkProvider>
) : (
  <MeProvider>
    <App />
  </MeProvider>
);

createRoot(document.getElementById('root')).render(<StrictMode>{tree}</StrictMode>);
