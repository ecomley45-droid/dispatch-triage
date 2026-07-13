import { SignIn } from '@clerk/clerk-react';

// Full-screen sign-in shown to signed-out users. Clerk renders whatever
// connections are enabled in the dashboard — enable Microsoft (Entra ID)
// there so staff sign in with their Microsoft accounts.
export default function SignInScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontSize: 40, marginBottom: 2 }}>🍎</div>
        <div style={{ fontWeight: 800, fontSize: 22, color: 'var(--primary)' }}>Dispatch</div>
        <div className="muted" style={{ marginBottom: 24 }}>Family Dental Health · Field Service</div>
        <SignIn />
      </div>
    </div>
  );
}
