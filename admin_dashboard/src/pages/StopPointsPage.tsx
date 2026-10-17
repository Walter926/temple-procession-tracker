import { useState } from 'react';
import { deleteDraftStop } from '../lib/safe_mutations';
import { useRecords } from '../lib/records';
import type { EventRecord, GroupRecord, RouteRecord, StopPointRecord } from '../types/domain';
import MapCanvas from '../components/MapCanvas';
import StopForm from './StopForm';

export default function StopPointsPage() {
  const events = useRecords<EventRecord>('events');
  const [eventId, setEventId] = useState('');
  const routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const [routeId, setRouteId] = useState('');
  const stops = useRecords<StopPointRecord>('stopPoints', 'routeId', routeId);
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const event = events.items.find((item) => item.id === eventId);
  const route = routes.items.find((item) => item.id === routeId);
  const selected = stops.items.find((item) => item.id === selectedId);
  const ordered = [...stops.items].sort((a, b) => a.order - b.order);

  async function removeStop() {
    if (!selected || !route || event?.status !== 'draft') { setError('Delete is allowed only for draft-event stops.'); return; }
    if (groups.items.some((group) => group.startingStopPointId === selected.id || group.endingStopPointId === selected.id)) {
      setError('A group uses this stop. Update or remove the group first.'); return;
    }
    if (!window.confirm(`Delete ${selected.name}?`)) return;
    try {
      await deleteDraftStop(eventId, route.id, selected.id);
      setSelectedId('');
      setError('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Delete failed.'); }
  }

  return <div><h1>Stop Points</h1><div className="panel form-grid">
    <label>Event<select value={eventId} onChange={(e) => { setEventId(e.target.value); setRouteId(''); setSelectedId(''); setEditing(false); }}>
      <option value="">Select event</option>{events.items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
    <label>Route<select value={routeId} onChange={(e) => { setRouteId(e.target.value); setSelectedId(''); setEditing(false); }}>
      <option value="">Select route</option>{routes.items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label>
  </div>
    {route && <section className="panel"><h2>{route.name} Stops</h2><button onClick={() => { setSelectedId(''); setEditing(true); }}>+ Add Stop Point</button>
      <MapCanvas route={route} stops={ordered} />
      {stops.loading && <p>Loading stops...</p>}{stops.error && <p className="error">{stops.error}</p>}
      <div className="list">{ordered.map((stop) => <div className="item" key={stop.id}><span>#{stop.order} · {stop.name} · {stop.type}</span>
        <button onClick={() => { setSelectedId(stop.id); setEditing(false); }}>Details</button></div>)}</div>
    </section>}
    {selected && !editing && <section className="panel"><h2>{selected.name}</h2>
      <p>{selected.description || 'No description'}</p><p>Type: {selected.type} · Order: {selected.order}</p>
      <p>Coordinates: {selected.latitude}, {selected.longitude}</p>
      <p>Arrival: {selected.expectedArrivalTime?.toDate().toLocaleString() ?? '—'}</p>
      <p>Departure: {selected.expectedDepartureTime?.toDate().toLocaleString() ?? '—'}</p>
      <p>Geofence: {selected.geofenceRadiusMeters} m · Maximum groups: {selected.maxAllowedGroups}</p>
      <div className="actions"><button onClick={() => setEditing(true)}>Edit Stop</button>
        <button disabled={event?.status !== 'draft'} onClick={() => void removeStop()}>Delete Draft Stop</button></div>
    </section>}
    {editing && route && <StopForm key={selected?.id ?? 'new'} route={route} existingStops={stops.items} initial={selected} onCancel={() => setEditing(false)} onSaved={(id) => { setSelectedId(id); setEditing(false); }} />}
    {error && <p className="error" role="alert">{error}</p>}
  </div>;
}