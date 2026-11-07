
import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '../lib/firebase';
import { useRecords } from '../lib/records';
import MapCanvas, { type MapActiveCollision, type MapLiveLocation } from '../components/MapCanvas';
import type { EventRecord, GroupRecord, RouteRecord, StopPointRecord } from '../types/domain';

export default function CollisionMapPanel({ eventId }: { eventId: string }) {
  if (!eventId) return <p>Select an event to inspect the collision map.</p>;
  return <CollisionMapContent key={eventId} eventId={eventId} />;
}

function CollisionMapContent({ eventId }: { eventId: string }) {
  const events = useRecords<EventRecord>('events');
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const event = events.items.find(e => e.id === eventId);
  const route = routes.items.find(r => r.id === event?.routeId) ?? routes.items[0];
  const stops = useRecords<StopPointRecord>('stopPoints', 'routeId', route?.id ?? '');
  const [live, setLive] = useState<Record<string, MapLiveLocation>>({});
  const [collisions, setCollisions] = useState<MapActiveCollision[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    const unsubLive = onValue(ref(rtdb, `liveLocations/${eventId}`), snap => {
      const raw = (snap.val() ?? {}) as Record<string, Record<string, unknown>>;
      const next: Record<string, MapLiveLocation> = {};
      for (const [id, p] of Object.entries(raw)) {
        const latitude = Number(p.latitude), longitude = Number(p.longitude), recordedAt = Number(p.recordedAt);
        if ([latitude, longitude, recordedAt].every(Number.isFinite) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) next[id] = { latitude, longitude, recordedAt };
      }
      setLive(next);
    }, e => setError(e.message));

    const unsubAlerts = onValue(ref(rtdb, `activeCollisionAlerts/${eventId}`), snap => {
      setCollisions(Object.values((snap.val() ?? {}) as Record<string, MapActiveCollision>));
    }, e => setError(e.message));

    return () => { unsubLive(); unsubAlerts(); };
  }, [eventId]);

  return <section className="panel">
    <h2>Collision map</h2>
    <MapCanvas route={route} stops={stops.items} groups={groups.items} live={live} collisions={collisions} />
    <p>Red circles represent crowded stops; red group markers identify affected groups.</p>
    {error && <p className="error">{error}</p>}
  </section>;
}
