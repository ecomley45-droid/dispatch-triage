import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';
import { useMe } from '../lib/useMe.jsx';
import { featureActive } from '../../lib/permissions.js';

export default function OfflineBanner() {
  const me = useMe();
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

  // Offline mode can be turned off per workspace — then never surface the banner.
  if (!featureActive(me?.org?.feature_flags, 'offline')) return null;
  if (!offline) return null;

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '7px 16px',
      background: '#92400e',
      color: '#fef3c7',
      fontSize: 13,
      fontWeight: 500,
    }}>
      <WifiOff size={14} />
      <span>You're offline — showing cached data. Changes will not be saved.</span>
    </div>
  );
}
