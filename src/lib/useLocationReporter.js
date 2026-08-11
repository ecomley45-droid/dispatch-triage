// Silently reports the technician's GPS position to the server while clocked in.
// Runs for any user who CANNOT read tech locations (i.e. technicians).
// The server also enforces: rejects pings from users who aren't clocked in.
import { useEffect } from 'react';
import { api } from './api.js';
import { useMe } from './useMe.jsx';

export function useLocationReporter() {
  const me = useMe();

  useEffect(() => {
    if (!me.viewer || !navigator.geolocation) return;
    // Managers/dispatchers read locations — they don't report theirs.
    if (me.can('tech_locations:read')) return;
    // Feature must be on for this workspace (default on).
    if (me.org?.feature_flags?.features?.tech_tracking === false) return;

    let clocked = false;

    const checkShift = () =>
      api.get('/shifts/current')
        .then((r) => { clocked = !!r.shift; })
        .catch(() => { clocked = false; });

    const postPosition = (pos) => {
      if (!clocked) return;
      api.post('/location', {
        lat: pos.coords.latitude,
        lon: pos.coords.longitude,
        accuracy: pos.coords.accuracy ?? null,
      }).catch(() => {}); // offline or server error — silently skip
    };

    checkShift();
    const shiftPoll = setInterval(checkShift, 60_000);
    const onShift = () => checkShift();
    window.addEventListener('shift-changed', onShift);

    const watchId = navigator.geolocation.watchPosition(
      postPosition,
      () => {},
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 20_000 },
    );

    return () => {
      clearInterval(shiftPoll);
      window.removeEventListener('shift-changed', onShift);
      navigator.geolocation.clearWatch(watchId);
    };
  }, [me.viewer?.email, me.org?.id]);
}
