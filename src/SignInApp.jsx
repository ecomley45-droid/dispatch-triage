import { useEffect } from 'react';
import { SignedIn, SignedOut } from '@clerk/clerk-react';
import SignInScreen from './components/SignInScreen.jsx';

// Dedicated sign-in surface for accounts.nexusfieldhub.com/sign-in.
// Signed-out → the sign-in card; signed-in → bounce to the app origin (strip the
// `accounts.` subdomain). Visual mirror of Nexus CMS is applied to SignInScreen
// later; this file owns the routing/redirect behavior only.
function RedirectToApp() {
  useEffect(() => {
    const { origin } = window.location;
    const appOrigin = origin.replace(/:\/\/accounts\./, '://');
    window.location.replace(appOrigin === origin ? '/' : appOrigin + '/');
  }, []);
  return <div style={{ display: 'grid', placeItems: 'center', height: '100vh' }}>Signing you in…</div>;
}

export default function SignInApp() {
  return (
    <>
      <SignedOut><SignInScreen /></SignedOut>
      <SignedIn><RedirectToApp /></SignedIn>
    </>
  );
}
