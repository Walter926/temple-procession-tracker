import { useState } from 'react';
import CollisionMapPanel from './CollisionMapPanel';
import { getFunctions, httpsCallable } from 'firebase/functions';
import { useRecords } from '../lib/records';
import { firebaseApp } from '../lib/firebase';
import type { Timestamp } from 'firebase/firestore';
import type { EventRecord, GroupRecord, StopPointRecord } from '../types/domain';

type Alert = { id: string; eventId: string; stopPointId: string; affectedGroupIds: string[]; severity: string; status: string; count: number; maxAllowedGroups: number; createdAt?: Timestamp; lastSeenAt?: Timestamp };
export default function AlertsPage() {
  const events = useRecords<EventRecord>('events');
  const alerts = useRecords<Alert>('collisionAlerts');
  const groups = useRecords<GroupRecord>('groups');
  const stops = useRecords<StopPointRecord>('stopPoints');
  const [eventId, setEventId] = useState(''), [message, setMessage] = useState('Please hold position and contact dispatch.');
  const [busyId, setBusyId] = useState(''), [notice, setNotice] = useState('');
  const functions = getFunctions(firebaseApp, 'us-central1');
  const active = alerts.items.filter(a => a.status === 'active' && (!eventId || a.eventId === eventId));
  async function run(action: 'resolveCollisionAlert' | 'sendCollisionInstruction', id: string) {
    setBusyId(id); setNotice('');
    try {
      const call = httpsCallable(functions, action);
      await call(action === 'resolveCollisionAlert' ? { alertId: id } : { alertId: id, message: message.trim() });
      setNotice('Request accepted. Check Firestore for the server result.');
    } catch (e) { setNotice(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(''); }
  }
  return <div><h1>Collision Alerts</h1><section className="panel"><label>Event<select value={eventId} onChange={e => setEventId(e.target.value)}><option value="">All events</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><label>Instruction to affected leaders<textarea value={message} maxLength={500} onChange={e => setMessage(e.target.value)} /></label></section>
    {(alerts.error || groups.error || stops.error) && <p role="alert" className="error">{alerts.error || groups.error || stops.error}</p>}
    <section className="panel"><h2>Active collisions ({active.length})</h2>{!active.length && <p>No active collisions.</p>}
      {active.map(a => <article key={a.id} className="item"><div><strong>{stops.items.find(s => s.id === a.stopPointId)?.name ?? a.stopPointId}</strong> · {a.severity.toUpperCase()} · {a.count}/{a.maxAllowedGroups} groups (capacity exceeded)
        <p>Groups: {a.affectedGroupIds.map(id => groups.items.find(g => g.id === id)?.name ?? id).join(', ')}</p>
        <p>Created: {a.createdAt?.toDate().toLocaleString() ?? 'Pending'} · Last observed: {a.lastSeenAt?.toDate().toLocaleString() ?? 'Pending'}</p>
        <button disabled={busyId === a.id} onClick={() => void run('resolveCollisionAlert', a.id)}>Resolve / Suppress</button>
        <button disabled={busyId === a.id || !message.trim()} onClick={() => void run('sendCollisionInstruction', a.id)}>Send Instruction</button>
      </div></article>)}
    </section><CollisionMapPanel eventId={eventId} />{notice && <p role="status">{notice}</p>}
  </div>;
}