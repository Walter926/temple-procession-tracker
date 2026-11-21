import { validPoint } from './polyline.ts';
import type { MapActiveCollision, MapLiveLocation } from '../components/MapCanvas';

export type TrackingState = { state: string; updatedAt: number; userId: string };
export type LiveState = { eventId: string; live: Record<string, MapLiveLocation>; tracking: Record<string, TrackingState>; collisions: MapActiveCollision[]; error: string };
export type LiveBranch = 'liveLocations' | 'trackingStatus' | 'activeCollisionAlerts';
export type ChildSource = (path: string, upsert: (id: string, raw: unknown) => void, remove: (id: string) => void, failed: (error: Error) => void) => () => void;
type Schedule = (publish: () => void) => () => void;

export const emptyLiveEvent = (eventId: string): LiveState => ({ eventId, live: {}, tracking: {}, collisions: [], error: '' });
const object = (raw: unknown): Record<string, unknown> | undefined => raw && typeof raw === 'object' && !Array.isArray(raw) ? raw as Record<string, unknown> : undefined;
const number = (raw: unknown) => typeof raw === 'number' && Number.isFinite(raw) ? raw : undefined;

function location(raw: unknown): MapLiveLocation | undefined {
  const p = object(raw);
  if (!p) return;
  const latitude = number(p.latitude), longitude = number(p.longitude), recordedAt = number(p.recordedAt);
  if (latitude === undefined || longitude === undefined || recordedAt === undefined || !validPoint({ lat: latitude, lng: longitude })) return;
  return { latitude, longitude, recordedAt, accuracyMeters: number(p.accuracyMeters) };
}
function tracking(raw: unknown): TrackingState | undefined {
  const p = object(raw);
  if (!p || typeof p.state !== 'string' || typeof p.userId !== 'string' || number(p.updatedAt) === undefined) return;
  return { state: p.state, userId: p.userId, updatedAt: p.updatedAt as number };
}
function collision(raw: unknown): MapActiveCollision | undefined {
  const p = object(raw);
  if (!p || typeof p.stopPointId !== 'string' || !Array.isArray(p.affectedGroupIds) || !p.affectedGroupIds.every(id => typeof id === 'string') || typeof p.severity !== 'string') return;
  return { stopPointId: p.stopPointId, affectedGroupIds: [...p.affectedGroupIds], severity: p.severity };
}

// Child callbacks parse exactly one record. A frame batches initial child_added
// bursts and simultaneous GPS/status changes into a single immutable snapshot.
export function subscribeLiveEvent(eventId: string, source: ChildSource, publish: (state: LiveState) => void, schedule: Schedule) {
  let current = emptyLiveEvent(eventId), disposed = false, failed = false;
  let cancel: (() => void) | undefined;
  const dirty = new Set<LiveBranch>();
  const live = new Map<string, MapLiveLocation>(), statuses = new Map<string, TrackingState>(), collisions = new Map<string, MapActiveCollision>();
  function changed(branch: LiveBranch) {
    dirty.add(branch);
    if (cancel) return;
    cancel = schedule(() => {
      cancel = undefined;
      if (disposed || failed) return;
      current = { ...current, ...(dirty.has('liveLocations') ? { live: Object.fromEntries(live) } : {}),
        ...(dirty.has('trackingStatus') ? { tracking: Object.fromEntries(statuses) } : {}),
        ...(dirty.has('activeCollisionAlerts') ? { collisions: [...collisions.values()] } : {}) };
      dirty.clear(); publish(current);
    });
  }
  function bind<T>(branch: LiveBranch, cache: Map<string, T>, parse: (raw: unknown) => T | undefined, equal: (a: T, b: T) => boolean) {
    return source(`${branch}/${eventId}`, (id, raw) => {
      if (disposed || failed) return;
      const next = parse(raw), previous = cache.get(id);
      if (next === undefined) { if (cache.delete(id)) changed(branch); }
      else if (previous === undefined || !equal(previous, next)) { cache.set(id, next); changed(branch); }
    }, id => { if (!disposed && !failed && cache.delete(id)) changed(branch); }, error => {
      if (disposed || failed) return;
      failed = true; cancel?.(); cancel = undefined;
      live.clear(); statuses.clear(); collisions.clear();
      current = { ...emptyLiveEvent(eventId), error: error.message }; publish(current);
    });
  }
  const stops = [
    bind('liveLocations', live, location, (a, b) => a.latitude === b.latitude && a.longitude === b.longitude && a.recordedAt === b.recordedAt && a.accuracyMeters === b.accuracyMeters),
    bind('trackingStatus', statuses, tracking, (a, b) => a.state === b.state && a.updatedAt === b.updatedAt && a.userId === b.userId),
    bind('activeCollisionAlerts', collisions, collision, (a, b) => a.stopPointId === b.stopPointId && a.severity === b.severity && a.affectedGroupIds.length === b.affectedGroupIds.length && a.affectedGroupIds.every((id, index) => id === b.affectedGroupIds[index])),
  ];
  return () => { disposed = true; cancel?.(); stops.forEach(stop => stop()); live.clear(); statuses.clear(); collisions.clear(); };
}
