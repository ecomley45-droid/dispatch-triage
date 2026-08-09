import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import * as Sentry from '@sentry/react';
import { ClerkProvider, SignedIn, SignedOut, useAuth } from '@clerk/clerk-react';
import App from './App.jsx';
import SuperApp from './super/SuperApp.jsx';
import SignInApp from './SignInApp.jsx';
import LegalApp from './pages/Legal.jsx';
import PortalApp from './pages/Portal.jsx';
import { MeProvider } from './lib/useMe.jsx';
import { setTokenGetter, setWorkspaceGetter } from './lib/api.js';
import SignInScreen from './components/SignInScreen.jsx';
import './index.css';

// Every /api call carries the active workspace slug from the /space/<slug> URL,
// read live so it's always current. The server verifies membership before
// scoping to it (a forged slug can't reach another org's data).
setWorkspaceGetter(() => (window.location.pathname.match(/^\/space\/([^/]+)/) || [])[1] || null);

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

// Surfaces are chosen by HOSTNAME first (subdomains in production), with a PATH
// fallback so everything is reachable on localhost with no subdomains:
//   admin.nexusfieldhub.com      / /super-admin  → Super Admin console
//   accounts.nexusfieldhub.com   / /sign-in      → dedicated sign-in surface
//   nexusfieldhub.com/space/<ws>                 → a client workspace
const host = window.location.hostname;
const path = window.location.pathname;
// Legal + customer portal are public, link-based, and render before any Clerk gate.
const isLegal = path.startsWith('/legal');
const isPortal = path.startsWith('/portal');
// The Nexus Super Admin console — Clerk-authed, gated on platform-admin server-side.
const isAdmin = host.startsWith('admin.') || path.startsWith('/super-admin');
// The dedicated sign-in surface.
const isAccounts = host.startsWith('accounts.') || path.startsWith('/sign-in');

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
  <ClerkProvider publishableKey={clerkKey} afterSignOutUrl="/" signInUrl="/sign-in" appearance={{ variables: { colorPrimary: '#127c6e' } }}>
    {isAccounts ? (
      <SignInApp />
    ) : (
      <>
        <SignedOut><SignInScreen /></SignedOut>
        <SignedIn>{isAdmin ? signedInSuper : signedInApp}</SignedIn>
      </>
    )}
  </ClerkProvider>
) : isAdmin ? (
  // Dev bypass (no Clerk key): the server synthesizes a platform-admin viewer.
  <SuperApp />
) : isAccounts ? (
  // No Clerk in dev-bypass, so there's nothing to sign into — point at the app.
  <div style={{ display: 'grid', placeItems: 'center', height: '100vh', padding: 24, textAlign: 'center' }}>
    <div>Sign-in runs through Clerk (not configured in this dev environment).<br /><a href="/">Go to the app →</a></div>
  </div>
) : (
  <MeProvider>
    <App />
  </MeProvider>
);

createRoot(document.getElementById('root')).render(<StrictMode>{tree}</StrictMode>);
