import { useRecords } from '../lib/records';
import { useLiveEvent, useRouteStops } from '../lib/live';
import MapCanvas from '../components/MapCanvas';
import QueryFeedback from '../components/QueryFeedback';
import type { GroupRecord, RouteRecord } from '../types/domain';

export default function CollisionMapPanel({ eventId }: { eventId: string }) {
  return eventId ? <CollisionMapContent key={eventId} eventId={eventId} /> : <p>Select an event to inspect its collision map.</p>;
}
function CollisionMapContent({ eventId }: { eventId: string }) {
  const groups = useRecords<GroupRecord>('groups', 'eventId', eventId);
  const routes = useRecords<RouteRecord>('routes', 'eventId', eventId);
  const stops = useRouteStops(routes.items);
  const { live, collisions, error } = useLiveEvent(eventId);
  return <section className="panel"><h2>Collision map</h2><QueryFeedback state={routes} /><QueryFeedback state={groups} /><QueryFeedback state={stops} />
    {!routes.loading && !stops.loading && <MapCanvas routes={routes.items} stops={stops.items} groups={groups.items} live={live} collisions={collisions} />}
    <p>Red circles represent crowded stops; red group markers identify affected groups.</p>{error && <p className="error" role="alert">{error}</p>}
  </section>;
}
