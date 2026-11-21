import { memo, useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useManagedEvents, useRecords } from '../lib/records';
import { useLiveEvent, useRouteStops } from '../lib/live';
import { trackingLabel } from '../lib/validation';
import MapCanvas, { type MapLiveLocation } from '../components/MapCanvas';
import QueryFeedback from '../components/QueryFeedback';
import HistoryPanel from '../components/HistoryPanel';
import type { EventRecord, GroupRecord, RouteRecord } from '../types/domain';
import type { TrackingState } from '../lib/live';

export default function LiveMapPage() {
  const events = useManagedEvents();
  const [params, setParams] = useSearchParams();
  const event = events.items.find(item => item.id === params.get('event'));
  return <div><h1>Live event map</h1><p className="subtle">Routes, stops and group tracking in one place. Viewing does not publish GPS.</p>
    <section className="panel"><label>Event<select value={event?.id ?? ''} onChange={e => setParams(e.target.value ? { event: e.target.value } : {})}><option value="">Choose an event</option>{events.items.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}</select></label><QueryFeedback state={events} /></section>
    {event ? <EventLiveMap key={event.id} event={event} /> : <section className="panel"><p>Choose one of your events to see its groups and routes.</p></section>}
  </div>;
}

export function EventLiveMap({ event }: { event: EventRecord }) {
  const groups = useRecords<GroupRecord>('groups', 'eventId', event.id);
  const routes = useRecords<RouteRecord>('routes', 'eventId', event.id);
  const stops = useRouteStops(routes.items);
  const { live, tracking, collisions, error } = useLiveEvent(event.id);
  const [now, setNow] = useState(() => Date.now());
  const [selectedId, setSelectedId] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  return <section className="panel"><h2>{event.name} <span className="badge">{event.status}</span></h2>
    <QueryFeedback state={routes} /><QueryFeedback state={groups} /><QueryFeedback state={stops} />
    {!routes.loading && !routes.items.length && <p>No route has been drawn. <Link to="/routes">Create a route</Link> to add geometry and stops.</p>}
    {!routes.loading && !stops.loading && <MapCanvas routes={routes.items} stops={stops.items} groups={groups.items} live={live} collisions={collisions} onGroupClick={setSelectedId} />}
    {error && <p className="error" role="alert">Live updates unavailable: {error}</p>}
    <p className="subtle">Colored circles: groups · Gray: stale GPS · Red: crowded stops or affected groups · Blue “You”: browser-only position.</p>
    <h3>Group tracking</h3>{!groups.loading && !groups.items.length && <p>No groups yet. <Link to="/groups">Add a group</Link> after creating a route and ordered stops.</p>}
    <div className="list">{groups.items.map(group => <GroupTrackingRow key={group.id} group={group} point={live[group.id]} session={tracking[group.id]} eventStatus={event.status} selected={selectedId === group.id} now={now} />)}</div>
    <details onToggle={e => setHistoryOpen(e.currentTarget.open)}><summary>View recorded paths</summary>{historyOpen && <HistoryPanel eventId={event.id} groups={groups.items} />}</details>
  </section>;
}

const GroupTrackingRow = memo(function GroupTrackingRow({ group, point, session, eventStatus, selected, now }: { group: GroupRecord; point?: MapLiveLocation; session?: TrackingState; eventStatus: EventRecord['status']; selected: boolean; now: number }) {
  const authorized = session?.userId === group.leaderUserId && !!group.leaderUserId;
  const state = eventStatus === 'active' ? trackingLabel(authorized ? session.state : undefined, session?.updatedAt, point?.recordedAt, now) : eventStatus === 'paused' ? 'Event paused' : 'Event not active';
  return <article className={`item ${selected ? 'selected' : ''}`}><div><strong><i className="color-dot" style={{ background: group.color }} />{group.name}</strong><p>{group.status} · <span className="badge">{state}</span></p>
    <p className="subtle">{point ? `Last GPS: ${new Date(point.recordedAt).toLocaleString()} · ${Math.max(0, Math.floor((now - point.recordedAt) / 1000))}s ago` : 'Waiting for the primary leader’s first location.'}</p>
  </div><Link to={`/groups?event=${group.eventId}&group=${group.id}`}>Manage group</Link></article>;
});
