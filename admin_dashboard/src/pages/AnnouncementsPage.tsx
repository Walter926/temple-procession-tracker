import { useState, type FormEvent } from 'react';
import { addDoc, collection, serverTimestamp, updateDoc, doc } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { useRecords } from '../lib/records';
import type { EventRecord } from '../types/domain';

type AnnouncementRecord = { id: string; eventId: string; message: string; isActive: boolean };
export default function AnnouncementsPage() {
  const events = useRecords<EventRecord>('events');
  const [eventId, setEventId] = useState('');
  const items = useRecords<AnnouncementRecord>('publicAnnouncements', 'eventId', eventId);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const event = events.items.find(item => item.id === eventId);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError('');
    try {
      if (!event?.isPublic || !['scheduled', 'active'].includes(event.status)) throw Error('Publish the event first.');
      const clean = message.trim();
      if (!clean || clean.length > 500) throw Error('Announcement must contain 1–500 characters.');
      await addDoc(collection(db, 'publicAnnouncements'), { eventId, message: clean, isActive: true, createdAt: serverTimestamp(), updatedAt: serverTimestamp() });
      setMessage('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to publish announcement.'); }
    finally { setBusy(false); }
  }
  async function disable(id: string) {
    try { await updateDoc(doc(db, 'publicAnnouncements', id), { isActive: false, updatedAt: serverTimestamp() }); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to disable announcement.'); }
  }
  return <div><h1>Public Announcements</h1><section className="panel"><label>Published event<select value={eventId} onChange={e => setEventId(e.target.value)}>
    <option value="">Choose an event</option>{events.items.filter(e => e.isPublic && ['scheduled', 'active'].includes(e.status)).map(e => <option value={e.id} key={e.id}>{e.name}</option>)}
  </select></label></section>
    {eventId && <form className="panel" onSubmit={submit}><label>Announcement<textarea required maxLength={500} value={message} onChange={e => setMessage(e.target.value)} /></label><button disabled={busy}>{busy ? 'Publishing...' : 'Publish'}</button></form>}
    {items.error && <p role="alert" className="error">{items.error}</p>}{error && <p role="alert" className="error">{error}</p>}
    <section className="panel"><h2>Existing announcements</h2>{items.items.map(item => <div className="item" key={item.id}><span>{item.message} · {item.isActive ? 'Active' : 'Disabled'}</span><button disabled={!item.isActive} onClick={() => void disable(item.id)}>Disable</button></div>)}</section>
  </div>;
}