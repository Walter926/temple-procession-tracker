import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { Timestamp } from 'firebase/firestore';
import { callManagement, errorMessage } from '../lib/management';
import { useManagedEvents, useRecords } from '../lib/records';
import QueryFeedback from '../components/QueryFeedback';
import type { GroupRecord } from '../types/domain';

interface Announcement { id: string; eventId: string; groupId?: string; audience: 'event' | 'group' | 'public'; message: string; state?: string; isActive: boolean; createdAt?: Timestamp; expiresAt?: Timestamp }
export default function AnnouncementsPage() {
  const events = useManagedEvents();
  const [eventId, setEventId] = useState('');
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const announcements = useRecords<Announcement>('announcements', 'eventId', eventId);
  const [audience, setAudience] = useState<'event' | 'group' | 'public'>('event');
  const [groupId, setGroupId] = useState('');
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 10000); return () => clearInterval(timer); }, []);
  const request = useRef<{ signature: string; id: string } | null>(null);
  const event = events.items.find(e => e.id === eventId);
  const publishable = event?.isPublic && ['scheduled', 'active'].includes(event.status);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault(); setBusy(true); setError(''); setNotice('');
    try {
      const clean = message.trim();
      if (!event || !['scheduled', 'active', 'paused'].includes(event.status)) throw Error('Select a scheduled, active or paused event.');
      if (!clean || clean.length > 500 || (audience === 'group' && !groups.items.some(g => g.id === groupId))) throw Error('Enter a message and select a valid audience.');
      if (audience === 'public' && !publishable) throw Error('Public announcements require a published scheduled or active event.');
      const payload = { eventId, audience, groupId: audience === 'group' ? groupId : '', message: clean };
      const signature = JSON.stringify(payload);
      if (request.current?.signature !== signature) request.current = { signature, id: crypto.randomUUID() };
      await callManagement('sendAnnouncement', { ...payload, requestId: request.current.id });
      request.current = null; setMessage('');
      setNotice(audience === 'public' ? 'Public announcement published.' : 'Private announcement saved. Delivery to eligible members and leaders is queued.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusy(false); }
  }
  const sorted = [...announcements.items].sort((a, b) => (b.createdAt?.toMillis() ?? 0) - (a.createdAt?.toMillis() ?? 0));
  return <div><h1>Announcements</h1><p className="subtle">Private event and group messages are delivered only to eligible members and assigned leaders. Public notices are a separate audience.</p>
    <section className="panel"><label>Event<select value={eventId} onChange={e => { setEventId(e.target.value); setGroupId(''); setAudience('event'); setNotice(''); setError(''); }}>
      <option value="">Choose an event</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}{!e.isPublic ? ' · Private' : ''}</option>)}</select></label><QueryFeedback state={events} /></section>
    {event && <form className="panel" onSubmit={submit}><div className="form-grid">
      <label>Audience<select value={audience} onChange={e => setAudience(e.target.value as typeof audience)}><option value="event">Event members and leaders (private)</option><option value="group">One group (private)</option>{publishable && <option value="public">Public map visitors</option>}</select></label>
      {audience === 'group' && <label>Group<select required value={groupId} onChange={e => setGroupId(e.target.value)}><option value="">Choose group</option>{groups.items.map(g => <option key={g.id} value={g.id}>{g.name}</option>)}</select></label>}
      <label className="span-2">Message<textarea required maxLength={500} value={message} onChange={e => setMessage(e.target.value)} /></label>
    </div><QueryFeedback state={groups} /><div className="actions"><button disabled={busy || !message.trim() || !['scheduled', 'active', 'paused'].includes(event.status)}>{busy ? 'Sending…' : audience === 'public' ? 'Publish public notice' : 'Send private announcement'}</button><span>{message.length}/500</span></div>
      {!['scheduled', 'active', 'paused'].includes(event.status) && <p>Announcements are available once this event is scheduled, active or paused.</p>}
    </form>}
    {eventId && <section className="panel"><h2>Announcement history</h2><QueryFeedback state={announcements} />
      {!announcements.loading && !announcements.error && !sorted.length && <p>No announcements for this event yet.</p>}
      <div className="list">{sorted.map(item => <article className="item" key={item.id}><div><span className="badge">{item.audience === 'public' ? 'Public' : item.audience === 'group' ? 'Private group' : 'Private event'}</span><p>{item.message}</p>
        <p className="subtle">{item.createdAt?.toDate().toLocaleString() ?? 'Just now'} · {!item.isActive ? item.state ?? 'Inactive' : item.expiresAt && item.expiresAt.toMillis() <= now ? 'Expired' : item.state ?? 'Active'}</p></div></article>)}</div>
    </section>}{error && <p role="alert" className="error">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
