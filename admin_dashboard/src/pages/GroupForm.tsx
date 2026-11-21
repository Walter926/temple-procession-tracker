import { useState, type FormEvent } from 'react';
import { useRecords } from '../lib/records';
import { saveResource, errorMessage } from '../lib/management';
import { createSingleFlight } from '../lib/management_requests';
import type { FieldErrors } from '../lib/validation';
import FieldError from '../components/FieldError';
import QueryFeedback from '../components/QueryFeedback';
import type { GroupRecord, GroupStatus, RouteRecord, StopPointRecord } from '../types/domain';

const allStatuses: GroupStatus[] = ['waiting', 'preparing', 'moving', 'stopped', 'delayed', 'arrived', 'completed', 'emergency'];
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
  const [errors, setErrors] = useState<FieldErrors>({});
  const [flight] = useState(createSingleFlight);
  const ordered = [...stops.items].sort((a, b) => a.order - b.order);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation();
    const start = stops.items.find((stop) => stop.id === startId);
    const end = stops.items.find((stop) => stop.id === endId);
    const validation: FieldErrors = {};
    if (!name.trim() || name.trim().length > 120) validation.groupName = 'Group name must contain 1–120 characters.';
    if (!routes.items.some(route => route.id === routeId)) validation.groupRoute = 'Choose an available route.';
    if (!start) validation.groupStart = 'Choose a starting stop on this route.';
    if (!end || (start && end.order <= start.order)) validation.groupEnd = 'Choose an ending stop after the starting stop.';
    setErrors(validation);
    if (Object.keys(validation).length || routes.loading || stops.loading || routes.error || stops.error || !flight.start()) return;
    setBusy(true);
    setError('');
    try {
      const value = { name: name.trim(), color, routeId, startingStopPointId: startId, endingStopPointId: endId, status };
      onSaved(await saveResource('group', eventId, value, initial?.id));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }

  return <form className="panel" noValidate onSubmit={save}><h2>{initial ? 'Edit Group' : 'Create Group'}</h2><fieldset disabled={busy}><div className="form-grid">
    <label>Group name *<input name="groupName" required maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /><FieldError name="groupName" errors={errors} /></label>
    <label>Group color<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
    <label>Assigned route *<select name="groupRoute" required disabled={!!initial} value={routeId} onChange={(e) => { setRouteId(e.target.value); setStartId(''); setEndId(''); }}>
      <option value="">Choose route</option>{routes.items.map((route) => <option value={route.id} key={route.id}>{route.name}</option>)}
    </select><FieldError name="groupRoute" errors={errors} /></label>
    <label>Initial/current status<select value={status} onChange={(e) => setStatus(e.target.value as GroupStatus)}>
      {(initial ? allStatuses : initialStatuses).map((item) => <option value={item} key={item}>{item}</option>)}
    </select></label>
    <label>Starting stop point *<select name="groupStart" required value={startId} onChange={(e) => setStartId(e.target.value)}>
      <option value="">Choose start</option>{ordered.map((stop) => <option key={stop.id} value={stop.id}>#{stop.order} · {stop.name}</option>)}
    </select><FieldError name="groupStart" errors={errors} /></label>
    <label>Ending stop point *<select name="groupEnd" required value={endId} onChange={(e) => setEndId(e.target.value)}>
      <option value="">Choose end</option>{ordered.map((stop) => <option key={stop.id} value={stop.id}>#{stop.order} · {stop.name}</option>)}
    </select><FieldError name="groupEnd" errors={errors} /></label>
  </div></fieldset>{initial && <p className="subtle">An existing group's route is fixed. Create a replacement group to use another route.</p>}{error && <p className="error" role="alert">{error}</p>}
    <QueryFeedback state={routes} /><QueryFeedback state={stops} />
    <div className="actions"><button disabled={busy || routes.loading || stops.loading || !!routes.error || !!stops.error} type="submit">{busy ? 'Saving...' : 'Save Group'}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form>;
}
