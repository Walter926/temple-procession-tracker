import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useRecords } from '../lib/records';
import type { EventRecord } from '../types/domain';
import EventForm from './EventForm';
import QueryFeedback from '../components/QueryFeedback';
import { overdueEventNotice } from '../lib/event_dates';

export default function EventsPage() {
  const events = useRecords<EventRecord>('events');
  const { items, loading, error } = events;
  const [adding, setAdding] = useState(false);
  const [now, setNow] = useState(Date.now);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  const navigate = useNavigate();
  const sorted = [...items].sort((a, b) => b.startTime.toMillis() - a.startTime.toMillis());
  return <div><h1>Events</h1><button onClick={() => setAdding((value) => !value)}>{adding ? 'Hide Form' : '+ Create Event'}</button>
    {adding && <EventForm onCancel={() => setAdding(false)} onSaved={(id) => navigate(`/events/${id}`)} />}
    {loading && <p>Loading events...</p>}{error && <p className="error">{error}</p>}
    <section className="panel list">{sorted.length === 0 && !loading && !error && <p>No events yet.</p>}
      {sorted.map((item) => <div className="item" key={item.id}>
        <div><strong>{item.name}</strong><p>{item.cityRegion || 'Unspecified region'} · {item.status} · {item.startTime.toDate().toLocaleString()}</p>{overdueEventNotice(item, now) && <p className="warning">{overdueEventNotice(item, now)}</p>}</div>
        <Link to={`/events/${item.id}`}>Open details</Link>
      </div>)}
    </section>
    <QueryFeedback state={{ ...events, loading: false, error: '' }} />
  </div>;
}
