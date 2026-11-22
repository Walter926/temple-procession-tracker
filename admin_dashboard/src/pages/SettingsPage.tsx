import { Link } from 'react-router-dom';
import { useRecords } from '../lib/records';
import type { EventRecord } from '../types/domain';
export default function SettingsPage() {
  const events = useRecords<EventRecord>('events');
  return <div><h1>Event Settings</h1><p>Select an event to manage visibility, schedule and lifecycle through the existing validated Event editor.</p>
    {events.error && <p role="alert" className="error">{events.error}</p>}
    <section className="panel">{events.items.map(e => <div className="item" key={e.id}><span>{e.name} · {e.status} · {e.isPublic ? 'Public' : 'Private'}</span><Link to={`/events/${e.id}`}>Edit event settings</Link></div>)}</section>
  </div>;
}