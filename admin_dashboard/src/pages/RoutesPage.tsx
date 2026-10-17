import { useState } from 'react';
import { doc, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { deleteDraftRoute } from '../lib/safe_mutations';
import { useRecords } from '../lib/records';
import type { EventRecord, GroupRecord, RouteRecord, RouteSegmentRecord, StopPointRecord } from '../types/domain';
import MapCanvas from '../components/MapCanvas';
import RouteForm from './RouteForm';
import SegmentForm from './SegmentForm';

export default function RoutesPage() {
  const events = useRecords<EventRecord>('events');
  const [eventId, setEventId] = useState('');
  const routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const segments = useRecords<RouteSegmentRecord>('routeSegments', 'routeId', selectedRouteId);
  const stops = useRecords<StopPointRecord>('stopPoints', 'routeId', selectedRouteId);
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');

  const event = events.items.find((item) => item.id === eventId);
  const route = routes.items.find((item) => item.id === selectedRouteId);
  const ordered = [...segments.items].sort((a, b) => a.order - b.order);
  const orderedStops = [...stops.items].sort((a, b) => a.order - b.order);

  async function removeRoute() {
    if (!route || !event) return;
    if (event.status !== 'draft') { setError('Only draft-event routes may be deleted.'); return; }
    if (event.routeId === route.id) { setError('Choose a different primary route before deleting this route.'); return; }
    if (segments.items.length || stops.items.length || groups.items.some((group) => group.routeId === route.id)) {
      setError('Remove segment, stop, and group references before deleting this route.');
      return;
    }
    if (!window.confirm('Delete this draft route?')) return;

    try {
      await deleteDraftRoute(eventId, route.id);
      setSelectedRouteId('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Delete failed.');
    }
  }

  async function setPrimaryRoute() {
    if (!route || !event) return;
    setError('');

    try {
      const batch = writeBatch(db);
      batch.update(doc(db, 'events', eventId), { routeId: route.id, updatedAt: Timestamp.now() });
      if (event.isPublic && (event.status === 'scheduled' || event.status === 'active')) batch.update(doc(db, 'publicEvents', eventId), { routeId: route.id });
      await batch.commit();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Unable to set primary route.');
    }
  }

  return (
    <div>
      <h1>Routes</h1>

      <section className="panel">
        <label>Event
          <select value={eventId} onChange={(e) => { setEventId(e.target.value); setSelectedRouteId(''); setEditing(false); }}>
            <option value="">Select event</option>
            {events.items.map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}
          </select>
        </label>
      </section>

      {eventId && (
        <section className="panel">
          <button onClick={() => { setSelectedRouteId(''); setEditing(true); }}>+ Create Route</button>
          {routes.loading && <p>Loading routes...</p>}
          {routes.error && <p className="error">{routes.error}</p>}

          <div className="list">
            {routes.items.map((item) => (
              <div className="item" key={item.id}>
                <span><i className="color-dot" style={{ background: item.color }} />{item.name} · {item.totalDistanceMeters} m {event?.routeId === item.id ? '· Primary' : ''}</span>
                <button onClick={() => { setSelectedRouteId(item.id); setEditing(false); }}>Open</button>
              </div>
            ))}
          </div>
        </section>
      )}

      {editing && eventId && <RouteForm key={route?.id ?? 'new'} eventId={eventId} initial={route} onCancel={() => setEditing(false)} onSaved={(id) => { setSelectedRouteId(id); setEditing(false); }} />}

      {route && !editing && (
        <section className="panel">
          <h2>{route.name}</h2>
          <p>{route.description || 'No description'}</p>
          <p><strong>Color:</strong> <i className="color-dot" style={{ background: route.color }} />{route.color}</p>
          <p><strong>Distance:</strong> {route.totalDistanceMeters} m · <strong>Duration:</strong> {route.estimatedDurationMinutes} min</p>
          <p><strong>Polyline:</strong> {route.encodedPolyline ? `${route.encodedPolyline.length} encoded characters` : 'Not entered yet'}</p>
          <p><strong>Primary route:</strong> {event?.routeId === route.id ? 'Yes' : 'No'}</p>
          <p><strong>Stop points:</strong> {stops.items.length}</p>

          {stops.error && <p className="error" role="alert">Unable to load stop points: {stops.error}</p>}
          {stops.loading && <p>Loading stop points...</p>}
          <MapCanvas route={route} stops={orderedStops} />

          <div className="actions">
            <button onClick={() => setEditing(true)}>Edit Route</button>
            <button disabled={event?.routeId === route.id} onClick={() => void setPrimaryRoute()}>{event?.routeId === route.id ? 'Current Primary Route' : 'Set as Event Primary Route'}</button>
            <button disabled={event?.status !== 'draft'} onClick={() => void removeRoute()}>Delete Draft Route</button>
          </div>

          <h3>Route Segments</h3>
          <div className="list">
            {ordered.map((segment) => <div className="item" key={segment.id}><span>#{segment.order}: {segment.instruction || 'Segment'} ({segment.distanceMeters} m)</span></div>)}
          </div>

          <SegmentForm routeId={route.id} nextOrder={Math.max(0, ...ordered.map((s) => s.order)) + 1} />
        </section>
      )}

      {error && <p className="error" role="alert">{error}</p>}
    </div>
  );
}