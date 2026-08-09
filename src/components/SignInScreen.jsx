import { SignIn } from '@clerk/clerk-react';

// Sign-in surface, styled to mirror the Nexus CMS sign-in: a dark page with a
// single centered Clerk card and a violet accent — no extra wordmark above it.
// Providers (Microsoft/Google/etc.) and the "Sign in to <app>" title come from
// the Clerk dashboard, not here. The card's own appearance is themed dark so it
// stays consistent regardless of the surrounding app theme.
const appearance = {
  variables: {
    colorPrimary: '#6c47ff',
    colorText: '#ffffff',
    colorTextSecondary: '#9b9ba6',
    colorBackground: '#1b1b1f',
    colorInputBackground: '#26262b',
    colorInputText: '#ffffff',
    colorTextOnPrimaryBackground: '#ffffff',
    borderRadius: '10px',
  },
  elements: {
    card: { boxShadow: '0 24px 64px rgba(0,0,0,0.55)', border: '1px solid #2a2a30' },
    socialButtonsBlockButton: { borderColor: '#33333a' },
    formFieldInput: { borderColor: '#33333a' },
  },
};

export default function SignInScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: '#0e0e11', padding: 24 }}>
      <div style={{ width: '100%', display: 'grid', placeItems: 'center' }}>
        <SignIn appearance={appearance} />
        <div style={{ marginTop: 20, fontSize: 12, color: '#6f6f78' }}>
          <a href="/legal/privacy" style={{ color: '#9b9ba6' }}>Privacy</a>
          {' · '}
          <a href="/legal/terms" style={{ color: '#9b9ba6' }}>Terms</a>
          {' · '}
          <a href="/legal/dmca" style={{ color: '#9b9ba6' }}>DMCA</a>
        </div>
      </div>
    </div>
  );
}
