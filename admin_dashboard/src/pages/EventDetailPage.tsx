import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useEventContacts, useRecords } from '../lib/records';
import type { EventRecord } from '../types/domain';
import EventForm from './EventForm';

export default function EventDetailPage() {
  const { eventId } = useParams();
  const { items, loading, error } = useRecords<EventRecord>('events');
  const contactState = useEventContacts(eventId);
  const [editing, setEditing] = useState(false);
  const event = items.find((item) => item.id === eventId);
  if (loading || contactState.loading) return <p>Loading event...</p>;
  if (error || contactState.error) return <p className="error" role="alert">{error || contactState.error}</p>;
  if (!event) return <p>Event not found. <Link to="/events">Back to events</Link></p>;
  return <div><p><Link to="/events">← Events</Link></p><h1>{event.name}</h1>
    <section className="panel"><p>{event.description || 'No description'}</p>
      <p><strong>Status:</strong> {event.status}</p><p><strong>Temple:</strong> {event.mainTempleName || '—'}</p>
      <p><strong>Region:</strong> {event.cityRegion || '—'}</p><p><strong>Start:</strong> {event.startTime.toDate().toLocaleString()}</p>
      <p><strong>End:</strong> {event.endTime?.toDate().toLocaleString() || '—'}</p>
      <p><strong>Public:</strong> {event.isPublic ? 'Yes' : 'No'}</p>
      <p><strong>Organizer contact (private):</strong> {contactState.contacts.organizerContact || '—'}</p>
      <p><strong>Emergency contact (private):</strong> {contactState.contacts.emergencyContact || '—'}</p>
      <button onClick={() => setEditing((value) => !value)}>{editing ? 'Close editor' : 'Edit Event'}</button>
    </section>
    {editing && <EventForm key={event.id} initial={event} initialContacts={contactState.contacts} onCancel={() => setEditing(false)} onSaved={() => setEditing(false)} />}
  </div>;
}