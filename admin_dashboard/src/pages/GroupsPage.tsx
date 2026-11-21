import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import QueryFeedback from '../components/QueryFeedback';
import { deleteDraftGroup } from '../lib/safe_mutations';
import { useRecords } from '../lib/records';
import type { EventRecord, GroupRecord, RouteRecord, StopPointRecord } from '../types/domain';
import GroupForm from './GroupForm';
import LeaderAssignmentPanel from './LeaderAssignmentPanel';
import GroupStatusOverridePanel from './GroupStatusOverridePanel';
import ArrivalAlertsPanel from './ArrivalAlertsPanel';
import GroupProgressPanel, { type ProgressRecord } from './GroupProgressPanel';

export default function GroupsPage() {
  const events = useRecords<EventRecord>('events');
  const [params] = useSearchParams();
  const [eventId, setEventId] = useState(params.get('event') ?? '');
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const [selectedId, setSelectedId] = useState(params.get('group') ?? '');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const progress = useRecords<ProgressRecord>('groupProgress', 'eventId', eventId);
  const event = events.items.find((item) => item.id === eventId);
  const group = groups.items.find((item) => item.id === selectedId);
  const stops = useRecords<StopPointRecord>('stopPoints', 'routeId', group?.routeId ?? '');
  const selectedRoute = routes.items.find((route) => route.id === group?.routeId);
  const startingStop = stops.items.find((stop) => stop.id === group?.startingStopPointId);
  const endingStop = stops.items.find((stop) => stop.id === group?.endingStopPointId);
  const planning = event && ['draft', 'scheduled'].includes(event.status);
  const deletable = event && ['draft', 'scheduled', 'completed', 'cancelled', 'archived'].includes(event.status);

  async function removeGroup() {
    if (!group || !deletable) { setError('Mark the event Completed or Cancelled before deleting groups.'); return; }
    if (!window.confirm(`Delete ${group.name}? Leaders will be unassigned, codes removed, and group members kept as event-only members.`)) return;
    setBusy(true);
    try { await deleteDraftGroup(eventId, group.id); setSelectedId(''); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Delete failed.'); }
    finally { setBusy(false); }
  }

  return <div><h1>Groups</h1><section className="panel"><label>Event<select value={eventId} onChange={(e) => { setEventId(e.target.value); setSelectedId(''); setEditing(false); }}>
    <option value="">Select event</option>{events.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select></label></section>
    <QueryFeedback state={events} />
    {eventId && <section className="panel"><button disabled={!planning || groups.items.length >= 100} onClick={() => { setSelectedId(''); setEditing(true); }}>+ Create Group</button>
      {groups.loading && <p>Loading groups...</p>}{groups.error && <p className="error">{groups.error}</p>}
      <div className="list">{groups.items.map((item) => <div className="item" key={item.id}>
        <span><i className="color-dot" style={{ background: item.color }} /><strong>{item.name}</strong> · {item.status}</span>
        <button onClick={() => { setSelectedId(item.id); setEditing(false); }}>Open Details</button>
      </div>)}</div>
    </section>}
    <QueryFeedback state={{ ...groups, loading: false, error: '' }} />
    <QueryFeedback state={routes} /><QueryFeedback state={stops} /><QueryFeedback state={progress} />
    {group && !editing && <section className="panel"><h2><i className="color-dot" style={{ background: group.color }} />{group.name}</h2>
      <p><strong>Status:</strong> {group.status}</p>
      <p><strong>Route:</strong> {selectedRoute?.name ?? 'Missing route'}</p>
      <p><strong>Start:</strong> {startingStop?.name ?? 'Not found'}</p>
      <p><strong>End:</strong> {endingStop?.name ?? 'Not found'}</p>
      <p><strong>Members:</strong> {group.memberCount}</p>
      <LeaderAssignmentPanel key={`leaders:${group.id}`} group={group} />
      <GroupStatusOverridePanel key={`status:${group.id}`} group={group} />
      <GroupProgressPanel progress={progress.items.find(p => p.groupId === group.id)} />
      <div className="actions"><button disabled={!planning} onClick={() => setEditing(true)}>Edit Group</button>
        <button className="danger" disabled={busy || !deletable} aria-describedby={event && !deletable ? 'group-delete-help' : undefined} onClick={() => void removeGroup()}>{busy ? 'Deleting…' : 'Delete group'}</button></div>
      {event && !deletable && <p id="group-delete-help" className="subtle">This group cannot be deleted while its event is active or paused. Open <Link to={`/events/${event.id}`}>event details</Link>, choose Edit event, and mark the event Completed or Cancelled before deleting the group. Releasing leaders removes their publishing assignment without deleting the group.</p>}
    </section>}
    {editing && eventId && <GroupForm key={group?.id ?? 'new'} eventId={eventId} initial={group} onCancel={() => setEditing(false)} onSaved={(id) => { setSelectedId(id); setEditing(false); }} />}
    {eventId && <ArrivalAlertsPanel eventId={eventId} />}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}
