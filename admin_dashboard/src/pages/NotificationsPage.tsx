import { useState } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { useRecords } from '../lib/records';
import type { EventRecord } from '../types/domain';
type Notice = { id: string; uid: string; eventId: string; type: string; title: string; body: string; isRead: boolean; createdAt: Timestamp };
export default function NotificationsPage() {
  const events = useRecords<EventRecord>('events');
  const notifications = useRecords<Notice>('notifications');
  const [eventId, setEventId] = useState(''), [onlyUnread, setOnlyUnread] = useState(false);
  const visible = notifications.items.filter(n => (!eventId || n.eventId === eventId) && (!onlyUnread || !n.isRead));
  return <div><h1>Notification Center</h1><section className="panel"><label>Event<select value={eventId} onChange={e => setEventId(e.target.value)}><option value="">All events</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label><input type="checkbox" checked={onlyUnread} onChange={e => setOnlyUnread(e.target.checked)} /> Unread only</label></section>
    {notifications.error && <p className="error">{notifications.error}</p>}
    <section className="panel"><h2>Delivery records ({visible.length})</h2>{visible.map(n => <div className="item" key={n.id}><span>{n.title} · {n.type} · recipient {n.uid} · {n.isRead ? 'Read' : 'Unread'} · {n.createdAt?.toDate?.().toLocaleString() ?? 'Pending'}<p>{n.body}</p></span></div>)}</section>
  </div>;
}