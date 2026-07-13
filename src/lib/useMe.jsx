import { createContext, useContext, useEffect, useState } from 'react';
import { api } from './api.js';

const MeContext = createContext(null);

export function MeProvider({ children }) {
  const [state, setState] = useState({ loading: true, viewer: null, org: null, capabilities: [], error: null });

  useEffect(() => {
    let alive = true;
    api.get('/me')
      .then((me) => alive && setState({ loading: false, ...me, error: null }))
      .catch((err) => alive && setState({ loading: false, viewer: null, org: null, capabilities: [], error: err.message }));
    return () => { alive = false; };
  }, []);

  const value = { ...state, can: (cap) => state.capabilities.includes(cap) };
  return <MeContext.Provider value={value}>{children}</MeContext.Provider>;
}

export const useMe = () => useContext(MeContext);
