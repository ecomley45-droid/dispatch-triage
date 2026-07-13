import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import { MeProvider } from './lib/useMe.jsx';
import './index.css';

const clerkKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY;

// Wrap in ClerkProvider only when a key is configured. Without it, the app
// runs against the server's dev-bypass viewer (no login). A tiny bridge
// registers Clerk's token getter with the API layer once mounted.
async function boot() {
  let tree = (
    <MeProvider>
      <App />
    </MeProvider>
  );

  if (clerkKey) {
    const { ClerkProvider, useAuth } = await import('@clerk/clerk-react');
    const { setTokenGetter } = await import('./lib/api.js');
    function TokenBridge({ children }) {
      const { getToken } = useAuth();
      setTokenGetter(() => getToken());
      return children;
    }
    tree = (
      <ClerkProvider publishableKey={clerkKey}>
        <TokenBridge>
          <MeProvider>
            <App />
          </MeProvider>
        </TokenBridge>
      </ClerkProvider>
    );
  }

  createRoot(document.getElementById('root')).render(<StrictMode>{tree}</StrictMode>);
}

boot();
