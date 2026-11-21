import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useEventContacts, useManagedEvent } from '../lib/records';
import { callManagement, deleteResource, errorMessage } from '../lib/management';
import EventForm from './EventForm';
import { EventLiveMap } from './LiveMapPage';
import { createSingleFlight } from '../lib/management_requests';
import { overdueEventNotice } from '../lib/event_dates';

export default function EventDetailPage() {
  const { eventId } = useParams();
  const { event, loading, error } = useManagedEvent(eventId);
  const contactState = useEventContacts(event?.id);
  const navigate = useNavigate();
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [flight] = useState(createSingleFlight);
  const [actionError, setActionError] = useState('');
  const [readiness, setReadiness] = useState<{ valid: boolean; errors: string[] }>();
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const deletable = event && ['draft', 'scheduled', 'completed', 'cancelled', 'archived'].includes(event.status);
  async function validate() {
    if (!event || !flight.start()) return;
    setBusy(true); setActionError(''); setReadiness(undefined);
    try { setReadiness(await callManagement<{ eventId: string }, { valid: boolean; errors: string[] }>('validateEvent', { eventId: event.id })); }
    catch (reason) { setActionError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }
  async function remove() {
    if (!event || !deletable || busy || !window.confirm(`Delete event “${event.name}” and its related routes, stops, groups, memberships and notices? This cannot be undone.`) || !flight.start()) return;
    setBusy(true); setActionError('');
    try { await deleteResource('event', event.id, event.id); navigate('/events', { replace: true }); }
    catch (reason) { setActionError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }
  if (loading || contactState.loading) return <p role="status">Loading event…</p>;
  if (error || contactState.error) return <p className="error" role="alert">{error || contactState.error}</p>;
  if (!event) return <p>Event unavailable or not in your management scope. <Link to="/events">Back to events</Link></p>;
  return <div><p><Link to="/events">← Events</Link></p><h1>{event.name}</h1>
    <section className="panel"><p>{event.description || 'No description added.'}</p>
      <p><strong>Status:</strong> <span className="badge">{event.status}</span></p><p><strong>Temple:</strong> {event.mainTempleName || '—'}</p>
      <p><strong>Region:</strong> {event.cityRegion || '—'}</p><p><strong>Start:</strong> {event.startTime.toDate().toLocaleString()}</p>
      <p><strong>End:</strong> {event.endTime?.toDate().toLocaleString() || '—'}</p><p><strong>Visibility:</strong> {event.isPublic ? 'Public when scheduled or active' : 'Private — members and assigned leaders only'}</p>
      {overdueEventNotice(event, now) && <p role="status" className="warning">{overdueEventNotice(event, now)}</p>}
      <p className="subtle">Event status is managed manually, not automatically changed by the end time. Geometry is locked outside draft/scheduled status.</p>
      <p><strong>Organizer contact (private):</strong> {contactState.contacts.organizerContact || '—'}</p>
      <p><strong>Emergency contact (private):</strong> {contactState.contacts.emergencyContact || '—'}</p>
      <p className="subtle">Supported per event: 20 routes, 100 groups and 400 stops. Each route supports 200 stops and 2000 geometry points.</p>
      <div className="actions"><button onClick={() => setEditing(value => !value)}>{editing ? 'Close editor' : 'Edit event'}</button><button disabled={busy} onClick={() => void validate()}>Check readiness</button><button className="danger" disabled={busy || !deletable} aria-describedby={!deletable ? 'event-delete-help' : undefined} onClick={() => void remove()}>Delete event</button></div>
      {!deletable && <p id="event-delete-help" className="subtle">Active or paused events cannot be deleted. Choose Edit event and mark the event Completed or Cancelled before deleting it. The end time does not change the status automatically.</p>}
      {readiness && <div role="status"><h3>{readiness.valid ? 'Event is ready to schedule or activate' : 'Resolve these items before scheduling or activation'}</h3>{readiness.errors.length > 0 && <ul>{readiness.errors.map((message, index) => <li key={index}>{message}</li>)}</ul>}</div>}
      <div className="actions"><Link to={`/routes?event=${event.id}`}>Manage routes</Link><Link to={`/stop-points?event=${event.id}`}>Manage stops</Link><Link to={`/groups?event=${event.id}`}>Manage groups</Link><Link to={`/route-suggestions?event=${event.id}`}>Route suggestions</Link></div>
      {actionError && <p className="error" role="alert">{actionError}</p>}
    </section>
    {editing && <EventForm key={`editor:${event.id}`} initial={event} initialContacts={contactState.contacts} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />}
    <EventLiveMap key={`map:${event.id}`} event={event} />
  </div>;
}
