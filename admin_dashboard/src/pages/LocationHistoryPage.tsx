import { useMemo, useState } from 'react';
import { type Timestamp } from 'firebase/firestore';
import { useRecords } from '../lib/records';
import MapCanvas from '../components/MapCanvas';
import type { EventRecord, GroupRecord, RouteRecord, StopPointRecord } from '../types/domain';
type HistoryPoint = { id: string; eventId: string; groupId: string; latitude: number; longitude: number; recordedAt: Timestamp; speedMetersPerSecond: number; headingDegrees: number };
type Arrival = { id: string; eventId: string; groupId: string; stopPointId: string; actualArrivalAt: Timestamp };
export default function LocationHistoryPage() {
  const events = useRecords<EventRecord>('events');
  const [eventId, setEventId] = useState(''), [groupId, setGroupId] = useState(''), [from, setFrom] = useState(''), [to, setTo] = useState('');
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId), routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const history = useRecords<HistoryPoint>('locationHistory', 'eventId', eventId), arrivals = useRecords<Arrival>('stopArrivals', 'eventId', eventId);
  const group = groups.items.find(g => g.id === groupId), route = routes.items.find(r => r.id === group?.routeId);
  const stops = useRecords<StopPointRecord>('stopPoints', 'routeId', route?.id ?? '');
  const filtered = useMemo(() => history.items.filter(p => (!groupId || p.groupId === groupId) && (!from || p.recordedAt?.toDate().getTime() >= new Date(from).getTime()) && (!to || p.recordedAt?.toDate().getTime() <= new Date(to).getTime())).sort((a, b) => a.recordedAt.toMillis() - b.recordedAt.toMillis()), [history.items, groupId, from, to]);
  function estimatedDeparture(arrival: Arrival): string {
    const stop = stops.items.find(s => s.id === arrival.stopPointId);
    if (!stop || !arrival.actualArrivalAt) return 'Unavailable';
    const latScale = 111195, lngScale = latScale * Math.cos(stop.latitude * Math.PI / 180);
    const after = filtered.find(point => point.groupId === arrival.groupId && point.recordedAt.toMillis() > arrival.actualArrivalAt.toMillis() &&
      Math.hypot((point.latitude - stop.latitude) * latScale, (point.longitude - stop.longitude) * lngScale) > stop.geofenceRadiusMeters);
    return after ? `First outside-geofence sample: ${after.recordedAt.toDate().toLocaleString()}` : 'Not observed';
  }
  return <div><h1>Location History</h1><section className="panel"><div className="form-grid"><label>Event<select value={eventId} onChange={e => { setEventId(e.target.value); setGroupId(''); }}><option value="">Choose event</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label>
    <label>Group<select value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">All groups</option>{groups.items.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>
    <label>From<input type="datetime-local" value={from} onChange={e => setFrom(e.target.value)} /></label><label>To<input type="datetime-local" value={to} onChange={e => setTo(e.target.value)} /></label></div></section>
    {history.error && <p role="alert" className="error">{history.error}</p>}
    {group && <MapCanvas route={route} stops={stops.items} historyPath={filtered.map(p => ({ lat: p.latitude, lng: p.longitude }))} />}
    <section className="panel"><h2>Recorded points ({filtered.length})</h2>{filtered.slice(0, 300).map(p => <div key={p.id} className="item"><span>{p.recordedAt?.toDate().toLocaleString() ?? 'Pending'} · {p.latitude.toFixed(6)}, {p.longitude.toFixed(6)} · {p.speedMetersPerSecond} m/s · heading {p.headingDegrees}°</span></div>)}</section>
    <section className="panel"><h2>Confirmed arrivals</h2>{arrivals.items.filter(a => (!groupId || a.groupId === groupId)).map(a => <div key={a.id} className="item"><span>{stops.items.find(s => s.id === a.stopPointId)?.name ?? a.stopPointId} · {a.actualArrivalAt?.toDate().toLocaleString() ?? 'Pending'} · Departure estimate: {estimatedDeparture(a)}</span></div>)}<p>Departure shown here is the first later history fix outside the geofence, not a trusted departure timestamp or precise crossing time.</p></section>
  </div>;
}