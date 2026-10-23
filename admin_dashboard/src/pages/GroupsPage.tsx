import { useState } from 'react';
import { deleteDraftGroup } from '../lib/safe_mutations';
import { useRecords } from '../lib/records';
import type { EventRecord, GroupRecord, RouteRecord, StopPointRecord } from '../types/domain';
import GroupForm from './GroupForm';
import LeaderAssignmentPanel from './LeaderAssignmentPanel';

export default function GroupsPage() {
  const events = useRecords<EventRecord>('events');
  const [eventId, setEventId] = useState('');
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const [selectedId, setSelectedId] = useState('');
  const [editing, setEditing] = useState(false);
  const [error, setError] = useState('');
  const event = events.items.find((item) => item.id === eventId);
  const group = groups.items.find((item) => item.id === selectedId);
  const stops = useRecords<StopPointRecord>('stopPoints', 'routeId', group?.routeId ?? '');
  const selectedRoute = routes.items.find((route) => route.id === group?.routeId);
  const startingStop = stops.items.find((stop) => stop.id === group?.startingStopPointId);
  const endingStop = stops.items.find((stop) => stop.id === group?.endingStopPointId);

  async function removeGroup() {
    if (!group || event?.status !== 'draft') { setError('Group deletion requires a draft event.'); return; }
    if (group.leaderUserId || group.backupLeaderUserId || group.memberCount !== 0 || group.accessCodeId) {
      setError('Remove leaders, members and access codes before deleting the group.'); return;
    }
    if (!window.confirm(`Delete ${group.name}?`)) return;
    try { await deleteDraftGroup(eventId, group.id); setSelectedId(''); setError(''); }
    catch (reason) { setError(reason instanceof Error ? reason.message : 'Delete failed.'); }
  }

  return <div><h1>Groups</h1><section className="panel"><label>Event<select value={eventId} onChange={(e) => { setEventId(e.target.value); setSelectedId(''); setEditing(false); }}>
    <option value="">Select event</option>{events.items.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
  </select></label></section>
    {eventId && <section className="panel"><button onClick={() => { setSelectedId(''); setEditing(true); }}>+ Create Group</button>
      {groups.loading && <p>Loading groups...</p>}{groups.error && <p className="error">{groups.error}</p>}
      <div className="list">{groups.items.map((item) => <div className="item" key={item.id}>
        <span><i className="color-dot" style={{ background: item.color }} /><strong>{item.name}</strong> · {item.status}</span>
        <button onClick={() => { setSelectedId(item.id); setEditing(false); }}>Open Details</button>
      </div>)}</div>
    </section>}
    {group && !editing && <section className="panel"><h2><i className="color-dot" style={{ background: group.color }} />{group.name}</h2>
      <p><strong>Status:</strong> {group.status}</p>
      <p><strong>Route:</strong> {selectedRoute?.name ?? 'Missing route'}</p>
      <p><strong>Start:</strong> {startingStop?.name ?? 'Not found'}</p>
      <p><strong>End:</strong> {endingStop?.name ?? 'Not found'}</p>
      <p><strong>Members:</strong> {group.memberCount}</p>
      <LeaderAssignmentPanel key={group.id} group={group} />
      <div className="actions"><button onClick={() => setEditing(true)}>Edit Group</button>
        <button disabled={event?.status !== 'draft'} onClick={() => void removeGroup()}>Delete Draft Group</button></div>
    </section>}
    {editing && eventId && <GroupForm key={group?.id ?? 'new'} eventId={eventId} initial={group} onCancel={() => setEditing(false)} onSaved={(id) => { setSelectedId(id); setEditing(false); }} />}
    {error && <p role="alert" className="error">{error}</p>}
  </div>;
}