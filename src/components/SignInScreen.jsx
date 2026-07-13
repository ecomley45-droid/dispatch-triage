import { SignIn } from '@clerk/clerk-react';

// Full-screen sign-in shown to signed-out users. Clerk renders whatever
// connections are enabled in the dashboard — enable Microsoft (Entra ID)
// there so staff sign in with their Microsoft accounts.
export default function SignInScreen() {
  return (
    <div style={{ minHeight: '100vh', display: 'grid', placeItems: 'center', background: 'var(--bg)', padding: 24 }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{ fontWeight: 800, fontSize: 22, marginBottom: 4 }}>◆ Dispatch</div>
        <div className="muted" style={{ marginBottom: 24 }}>Field Service Management</div>
        <SignIn />
      </div>
    </div>
  );
}
