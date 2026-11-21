import { useEffect, useState } from 'react';
import { collection, onSnapshot, orderBy, query, Timestamp, where, limit } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { validPoint, type Point } from '../lib/polyline';
import type { GroupRecord } from '../types/domain';
import MapCanvas from './MapCanvas';

// Time-window paging bounds reads and never joins different groups' paths.
export default function HistoryPanel({ eventId, groups }: { eventId: string; groups: GroupRecord[] }) {
  const [selected, setSelected] = useState('');
  const groupId = groups.some(group => group.id === selected) ? selected : groups[0]?.id ?? '';
  const [end, setEnd] = useState(() => Date.now());
  const [now, setNow] = useState(() => Date.now());
  const [state, setState] = useState<{ key: string; points: Point[]; error: string }>({ key: '', points: [], error: '' });
  const start = end - 3600000, key = `${eventId}:${groupId}:${end}`;
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 60000); return () => clearInterval(timer); }, []);
  useEffect(() => {
    if (!groupId) return;
    return onSnapshot(query(collection(db, 'locationHistory'), where('eventId', '==', eventId), where('groupId', '==', groupId),
      where('recordedAt', '>=', Timestamp.fromMillis(start)), where('recordedAt', '<', Timestamp.fromMillis(end)),
      orderBy('recordedAt', 'desc'), limit(1000)), snapshot => {
      const points = snapshot.docs.map(doc => ({ lat: Number(doc.data().latitude), lng: Number(doc.data().longitude) })).filter(validPoint).reverse();
      setState({ key, points, error: '' });
    }, error => setState({ key, points: [], error: error.message }));
  }, [eventId, groupId, start, end, key]);
  const current = state.key === key;
  return <section className="panel"><h3>Precise location history</h3>
    <p className="subtle">Managers only. Samples are kept for seven days. Choose a group and page through one-hour windows; the map fits once and respects panning.</p>
    <label>History group<select value={groupId} onChange={e => setSelected(e.target.value)}>{groups.map(group => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
    <div className="actions"><button type="button" disabled={start < now - 7 * 86400000} onClick={() => setEnd(end - 3600000)}>Previous hour</button>
      <button type="button" disabled={end >= now} onClick={() => setEnd(Math.min(Date.now(), end + 3600000))}>Next hour</button>
      <button type="button" onClick={() => setEnd(Date.now())}>Latest hour</button></div>
    <p>{new Date(start).toLocaleString()} – {new Date(end).toLocaleString()}</p>
    {!groupId ? <p>Add a group to view its history.</p> : !current ? <p role="status">Loading history…</p> : state.error ? <p role="alert" className="error">{state.error}</p> : state.points.length === 0 ? <p>No recorded path in this window.</p> : <>
      <p>{state.points.length} samples{state.points.length === 1000 ? ' (latest 1,000; legacy data may be truncated)' : ''}.</p>
      <MapCanvas key={key} historyPath={state.points} />
    </>}
  </section>;
}
