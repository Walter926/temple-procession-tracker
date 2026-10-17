import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRecords } from '../lib/records';
import type { EventRecord } from '../types/domain';
import EventForm from './EventForm';

export default function EventsPage() {
  const { items, loading, error } = useRecords<EventRecord>('events');
  const [adding, setAdding] = useState(false);
  const navigate = useNavigate();
  const sorted = [...items].sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis());
  return <div><h1>Events</h1><button onClick={() => setAdding((value) => !value)}>{adding ? 'Hide Form' : '+ Create Event'}</button>
    {adding && <EventForm onCancel={() => setAdding(false)} onSaved={(id) => navigate(`/events/${id}`)} />}
    {loading && <p>Loading events...</p>}{error && <p className="error">{error}</p>}
    <section className="panel list">{sorted.length === 0 && !loading && <p>No events yet.</p>}
      {sorted.map((item) => <div className="item" key={item.id}>
        <div><strong>{item.name}</strong><p>{item.cityRegion || 'Unspecified region'} · {item.status} · {item.startTime.toDate().toLocaleString()}</p></div>
        <Link to={`/events/${item.id}`}>Open details</Link>
      </div>)}
    </section>
  </div>;
}