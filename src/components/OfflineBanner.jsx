import { useEffect, useState } from 'react';
import { WifiOff } from 'lucide-react';

export default function OfflineBanner() {
  const [offline, setOffline] = useState(!navigator.onLine);

  useEffect(() => {
    const on = () => setOffline(false);
    const off = () => setOffline(true);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); };
  }, []);

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
