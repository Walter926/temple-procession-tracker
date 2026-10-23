import { useState, type FormEvent } from 'react';
import { createRecord, patchRecord, useRecords } from '../lib/records';
import type { GroupRecord, GroupStatus, RouteRecord, StopPointRecord } from '../types/domain';

const allStatuses: GroupStatus[] = ['waiting', 'moving', 'stopped', 'delayed', 'completed', 'emergency'];
const initialStatuses: GroupStatus[] = ['waiting', 'stopped'];
interface Props { eventId: string; initial?: GroupRecord; onSaved: (id: string) => void; onCancel: () => void }

export default function GroupForm({ eventId, initial, onSaved, onCancel }: Props) {
  const routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? '#3169a6');
  const [routeId, setRouteId] = useState(initial?.routeId ?? '');
  const stops = useRecords<StopPointRecord>('stopPoints', 'routeId', routeId);
  const [startId, setStartId] = useState(initial?.startingStopPointId ?? '');
  const [endId, setEndId] = useState(initial?.endingStopPointId ?? '');
  const [status, setStatus] = useState<GroupStatus>(initial?.status ?? 'waiting');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const ordered = [...stops.items].sort((a, b) => a.order - b.order);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const start = stops.items.find((stop) => stop.id === startId);
    const end = stops.items.find((stop) => stop.id === endId);
    if (!name.trim() || !routeId || !routes.items.some((route) => route.id === routeId) || !start || !end || end.order < start.order) {
      setError('Choose a name, route, and valid ordered start/end stops on that route.'); return;
    }
    setBusy(true);
    setError('');
    try {
      const value = { name: name.trim(), color, routeId, startingStopPointId: startId, endingStopPointId: endId, status };
      if (initial) { await patchRecord('groups', initial.id, value); onSaved(initial.id); }
      else {
        const id = await createRecord('groups', { ...value, eventId, leaderUserId: '', memberCount: 0,
          currentLatitude: null, currentLongitude: null, lastLocationUpdateAt: null, accessCodeId: null });
        onSaved(id);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save group.'); }
    finally { setBusy(false); }
  }

  return <form className="panel" onSubmit={save}><h2>{initial ? 'Edit Group' : 'Create Group'}</h2><div className="form-grid">
    <label>Group name *<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label>Group color<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
    <label>Assigned route *<select required value={routeId} onChange={(e) => { setRouteId(e.target.value); setStartId(''); setEndId(''); }}>
      <option value="">Choose route</option>{routes.items.map((route) => <option value={route.id} key={route.id}>{route.name}</option>)}
    </select></label>
    <label>Initial/current status<select value={status} onChange={(e) => setStatus(e.target.value as GroupStatus)}>
      {(initial ? allStatuses : initialStatuses).map((item) => <option value={item} key={item}>{item}</option>)}
    </select></label>
    <label>Starting stop point *<select required value={startId} onChange={(e) => setStartId(e.target.value)}>
      <option value="">Choose start</option>{ordered.map((stop) => <option key={stop.id} value={stop.id}>#{stop.order} · {stop.name}</option>)}
    </select></label>
    <label>Ending stop point *<select required value={endId} onChange={(e) => setEndId(e.target.value)}>
      <option value="">Choose end</option>{ordered.map((stop) => <option key={stop.id} value={stop.id}>#{stop.order} · {stop.name}</option>)}
    </select></label>
  </div>{error && <p className="error" role="alert">{error}</p>}
    <div className="actions"><button disabled={busy} type="submit">{busy ? 'Saving...' : 'Save Group'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}