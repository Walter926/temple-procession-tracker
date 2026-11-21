import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { callManagement, errorMessage } from '../lib/management';
import { useManagedEvents, useRecords } from '../lib/records';
import { useRouteStops } from '../lib/live';
import QueryFeedback from '../components/QueryFeedback';
import CollisionMapPanel from './CollisionMapPanel';
import type { Timestamp } from 'firebase/firestore';
import type { GroupRecord, RouteRecord } from '../types/domain';

interface Alert { id: string; eventId: string; stopPointId: string; affectedGroupIds: string[]; severity: string; status: string; count: number; maxAllowedGroups: number; createdAt?: Timestamp; lastSeenAt?: Timestamp }
export default function AlertsPage() {
  const events = useManagedEvents();
  const [params, setParams] = useSearchParams();
  const eventId = events.items.find(e => e.id === params.get('event'))?.id ?? '';
  const alerts = useRecords<Alert>('collisionAlerts', 'eventId', eventId, { status: 'active' });
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const stops = useRouteStops(routes.items);
  const [message, setMessage] = useState('Please hold position and contact dispatch.');
  const [busyId, setBusyId] = useState(''), [notice, setNotice] = useState(''), [error, setError] = useState('');
  const active = alerts.items.filter(a => a.status === 'active');
  async function run(action: 'resolveCollisionAlert' | 'sendCollisionInstruction', id: string) {
    setBusyId(id); setNotice(''); setError('');
    try {
      await callManagement(action, action === 'resolveCollisionAlert' ? { alertId: id } : { alertId: id, message: message.trim() });
      setNotice(action === 'resolveCollisionAlert' ? 'Collision suppressed until the groups clear the stop.' : 'Instruction saved and delivery queued for the affected leaders.');
    } catch (reason) { setError(errorMessage(reason)); }
    finally { setBusyId(''); }
  }
  return <div><h1>Collision alerts</h1><section className="panel"><label>Event<select value={eventId} onChange={e => { setParams(e.target.value ? { event: e.target.value } : {}); setNotice(''); setError(''); }}><option value="">Choose an event</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><QueryFeedback state={events} />
    {eventId && <label>Instruction to affected leaders<textarea value={message} maxLength={500} onChange={e => setMessage(e.target.value)} /></label>}</section>
    {eventId && <><section className="panel"><h2>Active collisions ({active.length})</h2><QueryFeedback state={alerts} /><QueryFeedback state={groups} /><QueryFeedback state={routes} /><QueryFeedback state={stops} />
      {!alerts.loading && !alerts.error && !active.length && <p>No active collisions for this event. Resolved or suppressed incidents are not current alerts.</p>}
      <div className="list">{active.map(a => <article key={a.id} className="item"><div><strong>{stops.items.find(s => s.id === a.stopPointId)?.name ?? a.stopPointId}</strong> <span className="badge">{a.severity}</span><p>{a.count}/{a.maxAllowedGroups} groups · Capacity exceeded</p>
        <p>Groups: {a.affectedGroupIds.map(id => groups.items.find(g => g.id === id)?.name ?? id).join(', ')}</p>
        <p className="subtle">Created {a.createdAt?.toDate().toLocaleString() ?? 'recently'} · Last observed {a.lastSeenAt?.toDate().toLocaleString() ?? 'recently'}</p>
        <div className="actions"><button disabled={!!busyId} onClick={() => void run('resolveCollisionAlert', a.id)}>Resolve / suppress</button><button disabled={!!busyId || !message.trim()} onClick={() => void run('sendCollisionInstruction', a.id)}>Send instruction</button></div>
      </div></article>)}</div>
    </section><CollisionMapPanel eventId={eventId} /></>}
    {error && <p className="error" role="alert">{error}</p>}{notice && <p role="status">{notice}</p>}
  </div>;
}
