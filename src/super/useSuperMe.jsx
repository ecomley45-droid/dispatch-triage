import { createContext, useContext, useEffect, useState } from 'react';
import { api } from '../lib/api.js';

// Session state for the super-admin console. Hits /super/me, which is gated by
// requirePlatformAdmin server-side — a non-platform-admin gets a 403 and lands
// on the "not authorized" screen instead of the console.
const SuperMeContext = createContext(null);

export function SuperMeProvider({ children }) {
  const [state, setState] = useState({ loading: true, viewer: null, platformAdmin: false, features: {}, error: null });
  useEffect(() => {
    let alive = true;
    api.get('/super/me')
      .then((me) => alive && setState({ loading: false, ...me, error: null }))
      .catch((err) => alive && setState({ loading: false, viewer: null, platformAdmin: false, features: {}, error: err.message }));
    return () => { alive = false; };
  }, []);
  return <SuperMeContext.Provider value={state}>{children}</SuperMeContext.Provider>;
}

export const useSuperMe = () => useContext(SuperMeContext);
