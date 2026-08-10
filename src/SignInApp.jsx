import { useEffect } from 'react';
import { SignedIn, SignedOut } from '@clerk/clerk-react';
import SignInScreen from './components/SignInScreen.jsx';

// Dedicated sign-in surface for accounts.nexusfieldhub.com/sign-in.
// Signed-out → the sign-in card; signed-in → bounce to the workspace app, which
// lives on the `app.` subdomain (the apex is the marketing site). On localhost
// (no subdomain) there's just one origin, so go to `/`.
function RedirectToApp() {
  useEffect(() => {
    const { hostname, protocol } = window.location;
    const parts = hostname.split('.');
    if (parts.length > 2) {
      // accounts.nexusfieldhub.com → app.nexusfieldhub.com
      window.location.replace(`${protocol}//app.${parts.slice(1).join('.')}/`);
    } else {
      window.location.replace('/');
    }
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
