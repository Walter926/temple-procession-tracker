import { useEffect, useState } from 'react';
import { onValue, ref } from 'firebase/database';
import { rtdb } from '../lib/firebase';
import { useRecords } from '../lib/records';
import type { EventRecord, GroupRecord, RouteRecord, StopPointRecord } from '../types/domain';
import MapCanvas, { type MapLiveLocation, type MapActiveCollision } from '../components/MapCanvas';
export default function LiveMapPage() {
  const events = useRecords<EventRecord>('events');
  const [eventId, setEventId] = useState(''), [selectedGroupId, setSelectedGroupId] = useState(''), [reload, setReload] = useState(0);
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId), routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const [live, setLive] = useState<Record<string, MapLiveLocation>>({}), [collisions, setCollisions] = useState<MapActiveCollision[]>([]), [error, setError] = useState('');
  const event = events.items.find(e => e.id === eventId), route = routes.items.find(r => r.id === event?.routeId) ?? routes.items[0];
  const stops = useRecords<StopPointRecord>('stopPoints', 'routeId', route?.id ?? '');
  useEffect(() => {
    if (!eventId) return;
    const unsubscribeLocations = onValue(ref(rtdb, `liveLocations/${eventId}`), snap => {
      const raw = (snap.val() ?? {}) as Record<string, Record<string, unknown>>;
      const next: Record<string, MapLiveLocation> = {};
      for (const [id, p] of Object.entries(raw)) {
        const latitude = Number(p.latitude), longitude = Number(p.longitude), recordedAt = Number(p.recordedAt);
        if (Number.isFinite(latitude) && Number.isFinite(longitude) && Number.isFinite(recordedAt) && Math.abs(latitude) <= 90 && Math.abs(longitude) <= 180) next[id] = { latitude, longitude, recordedAt, accuracyMeters: Number(p.accuracyMeters) };
      }
      setLive(next);
    }, err => setError(err.message));
    const unsubscribeAlerts = onValue(ref(rtdb, `activeCollisionAlerts/${eventId}`), snap => {
      const raw = (snap.val() ?? {}) as Record<string, MapActiveCollision>;
      setCollisions(Object.values(raw));
    }, err => setError(err.message));
    return () => { unsubscribeLocations(); unsubscribeAlerts(); };
  }, [eventId, reload]);
  const selected = groups.items.find(g => g.id === selectedGroupId), current = selected && live[selected.id];
  return <div><h1>Live Procession Map</h1><section className="panel"><label>Event<select value={eventId} onChange={e => { setEventId(e.target.value); setSelectedGroupId(''); setLive({}); }}><option value="">Select event</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><button onClick={() => setReload(n => n + 1)}>Refresh event subscriptions</button></section>
    {event && <><MapCanvas route={route} stops={stops.items} groups={groups.items} live={live} collisions={collisions} onGroupClick={setSelectedGroupId} />
      <section className="panel"><p>Event: {event.name} · Status: {event.status} · Route: {route?.name ?? 'None'} · Stops: {stops.items.length} · Groups: {groups.items.length}</p>
        <p>Live groups: {Object.keys(live).length} · Active collision zones: {collisions.length}</p>
        {groups.items.map(g => <button key={g.id} onClick={() => setSelectedGroupId(g.id)}>{g.name} · {g.status}{live[g.id] && Date.now() - live[g.id].recordedAt > 60000 ? ' (STALE)' : ''}</button>)}
        {selected && <div><h3>{selected.name}</h3><p>Status: {selected.status} · Leader UID: {selected.leaderUserId}</p><p>GPS: {current ? `${current.latitude}, ${current.longitude}` : 'Never reported'}</p><p>Last update: {current ? new Date(current.recordedAt).toLocaleString() : 'Never'} {current && Date.now() - current.recordedAt > 60000 ? ' · STALE' : ''}</p></div>}
      </section></>}
    {error && <p role="alert" className="error">Live map: {error}</p>}
  </div>;
}