import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { saveResource, errorMessage } from '../lib/management';
import { createSingleFlight } from '../lib/management_requests';
import { deleteDraftRoute } from '../lib/safe_mutations';
import { useRecords } from '../lib/records';
import type { EventRecord, RouteRecord, RouteSegmentRecord, StopPointRecord } from '../types/domain';
import MapCanvas from '../components/MapCanvas';
import RouteForm from './RouteForm';
import SegmentForm from './SegmentForm';
import QueryFeedback from '../components/QueryFeedback';

export default function RoutesPage() {
  const events = useRecords<EventRecord>('events');
  const [params] = useSearchParams();
  const [eventId, setEventId] = useState(params.get('event') ?? '');
  const routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const [selectedRouteId, setSelectedRouteId] = useState('');
  const segments = useRecords<RouteSegmentRecord>('routeSegments', 'routeId', selectedRouteId);
  const stops = useRecords<StopPointRecord>('stopPoints', 'routeId', selectedRouteId);
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState('');
  const [flight] = useState(createSingleFlight);

  const event = events.items.find((item) => item.id === eventId);
  const route = routes.items.find((item) => item.id === selectedRouteId);
  const ordered = [...segments.items].sort((a, b) => a.order - b.order);
  const orderedStops = [...stops.items].sort((a, b) => a.order - b.order);
  const planning = event && ['draft', 'scheduled'].includes(event.status);
  const deletable = event && ['draft', 'scheduled', 'completed', 'cancelled', 'archived'].includes(event.status);

  async function removeRoute() {
    if (!route || !event || busy) return;
    if (!deletable) { setError('Stop or complete the event before deleting routes.'); return; }
    if (!window.confirm(`Delete ${route.name} and its stops and segments? Groups must first be removed. Another route becomes primary if available. Planning events return to draft when their primary route changes; closed events stay closed.`)) return;
    if (!flight.start()) return;
    setBusy(true); setNotice('');

    try {
      await deleteDraftRoute(eventId, route.id);
      setSelectedRouteId('');
      setError('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Delete failed.');
    } finally { flight.finish(); setBusy(false); }
  }

  async function setPrimaryRoute() {
    if (!route || !event || !flight.start()) return;
    setError(''); setNotice(''); setBusy(true);

    try {
      await saveResource('event', eventId, { routeId: route.id }, eventId);
      setNotice('Primary route saved.');
    } catch (reason) {
      setError(errorMessage(reason));
    } finally { flight.finish(); setBusy(false); }
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
      <QueryFeedback state={events} />
      {event && !planning && <p role="status">Route geometry is locked while this event is {event.status}. Create and edit routes only in draft or scheduled events. Event status is managed manually.</p>}

      {eventId && (
        <section className="panel">
          <button disabled={!planning || routes.items.length >= 20} onClick={() => { setSelectedRouteId(''); setEditing(true); }}>+ Create Route</button>
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
          <QueryFeedback state={{ ...routes, loading: false, error: '' }} />
        </section>
      )}

      {editing && planning && eventId && <RouteForm key={`${eventId}:${route?.id ?? 'new'}`} eventId={eventId} initial={route} onCancel={() => setEditing(false)} onSaved={(id) => { setSelectedRouteId(id); setEditing(false); setNotice('Route saved.'); }} />}

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
          <QueryFeedback state={{ ...stops, loading: false, error: '' }} />
          <MapCanvas route={route} stops={orderedStops} />

          <div className="actions">
            <button disabled={!planning} onClick={() => setEditing(true)}>Edit Route</button>
            <button disabled={busy || event?.routeId === route.id} onClick={() => void setPrimaryRoute()}>{event?.routeId === route.id ? 'Current Primary Route' : 'Set as Event Primary Route'}</button>
            <button className="danger" disabled={busy || !deletable} onClick={() => void removeRoute()}>{busy ? 'Deleting…' : 'Delete route'}</button>
          </div>

          <h3>Route Segments</h3>
          <QueryFeedback state={segments} />
          <div className="list">
            {ordered.map((segment) => <div className="item" key={segment.id}><span>#{segment.order}: {segment.instruction || 'Segment'} ({segment.distanceMeters} m)</span></div>)}
          </div>

          {planning && <SegmentForm eventId={eventId} routeId={route.id} nextOrder={Math.max(0, ...ordered.map((s) => s.order)) + 1} />}
        </section>
      )}

      {error && <p className="error" role="alert">{error}</p>}
      {notice && <p role="status">{notice}</p>}
    </div>
  );
}
