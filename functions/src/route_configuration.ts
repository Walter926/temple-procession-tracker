import { getFirestore, type DocumentSnapshot } from 'firebase-admin/firestore';

export type RouteStop = Readonly<{
  id: string; order: number; latitude: number; longitude: number;
  geofenceRadiusMeters: number; maxAllowedGroups: number; expectedArrivalTime?: unknown;
}>;
export type RouteSegment = Readonly<{
  id: string; order: number; startLatitude: number; startLongitude: number; endLatitude: number; endLongitude: number;
}>;
export type RouteConfiguration = Readonly<{
  routeId: string; eventId: string; version: string; stops: readonly RouteStop[]; segments: readonly RouteSegment[];
}>;

/** Cache only immutable planning data, never account/event eligibility or assignments. */
export class RouteConfigurationCache {
  private readonly entries = new Map<string, { version: string; expiresAt: number; value: Promise<RouteConfiguration> }>();
  constructor(private readonly maximumEntries = 64, private readonly lifetimeMs = 300000, private readonly now = Date.now) {
    if (!Number.isInteger(maximumEntries) || maximumEntries < 1 || !Number.isFinite(lifetimeMs) || lifetimeMs <= 0) throw new Error('Invalid route cache bounds.');
  }

  get size(): number { return this.entries.size; }
  get(routeId: string, version: string, load: () => Promise<RouteConfiguration>): Promise<RouteConfiguration> {
    const previous = this.entries.get(routeId);
    if (previous?.version === version && previous.expiresAt > this.now()) {
      this.entries.delete(routeId); this.entries.set(routeId, previous);
      return previous.value;
    }
    // An older in-flight version can finish, but cannot replace the newer entry.
    const entry = { version, expiresAt: this.now() + this.lifetimeMs, value: Promise.resolve().then(load) };
    this.entries.delete(routeId); this.entries.set(routeId, entry);
    while (this.entries.size > this.maximumEntries) this.entries.delete(this.entries.keys().next().value!);
    entry.value = entry.value.catch(error => {
      if (this.entries.get(routeId) === entry) this.entries.delete(routeId);
      throw error;
    });
    return entry.value;
  }
  clear(): void { this.entries.clear(); }
}

export const routeConfigurationVersion = (snapshot: Pick<DocumentSnapshot, 'updateTime'>): string =>
  snapshot.updateTime ? `${snapshot.updateTime.seconds}:${snapshot.updateTime.nanoseconds}` : 'missing';
const configurationCache = new RouteConfigurationCache();

/** One fresh route metadata read validates the cache on every call. All trusted
 * stop/segment mutations also update their route in the same transaction. */
export async function loadRouteConfiguration(routeId: string): Promise<RouteConfiguration> {
  const db = getFirestore(), route = await db.doc(`routes/${routeId}`).get();
  const eventId = String(route.data()?.eventId ?? ''), version = routeConfigurationVersion(route);
  if (!route.exists || !eventId) return { routeId, eventId: '', version, stops: [], segments: [] };
  return configurationCache.get(routeId, version, async () => {
    const [stopQuery, segmentQuery] = await Promise.all([
      db.collection('stopPoints').where('routeId', '==', routeId).limit(201).get(),
      db.collection('routeSegments').where('routeId', '==', routeId).limit(201).get(),
    ]);
    if (stopQuery.size > 200 || segmentQuery.size > 200) throw new Error('A route supports at most 200 stops and 200 segments.');
    const stops = stopQuery.docs.map(doc => {
      const data = doc.data();
      return Object.freeze({ id: doc.id, order: Number(data.order), latitude: Number(data.latitude), longitude: Number(data.longitude),
        geofenceRadiusMeters: Number(data.geofenceRadiusMeters ?? 100), maxAllowedGroups: Number(data.maxAllowedGroups ?? 1), expectedArrivalTime: data.expectedArrivalTime });
    }).filter(stop => [stop.order, stop.latitude, stop.longitude, stop.geofenceRadiusMeters].every(Number.isFinite) &&
      Number.isInteger(stop.order) && stop.order >= 1 && Math.abs(stop.latitude) <= 90 && Math.abs(stop.longitude) <= 180 && stop.geofenceRadiusMeters >= 5 && stop.geofenceRadiusMeters <= 1000)
      .sort((a, b) => a.order - b.order);
    const segments = segmentQuery.docs.map(doc => {
      const data = doc.data();
      return Object.freeze({ id: doc.id, order: Number(data.order), startLatitude: Number(data.startLatitude), startLongitude: Number(data.startLongitude),
        endLatitude: Number(data.endLatitude), endLongitude: Number(data.endLongitude) });
    }).filter(segment => [segment.order, segment.startLatitude, segment.startLongitude, segment.endLatitude, segment.endLongitude].every(Number.isFinite) &&
      Math.abs(segment.startLatitude) <= 90 && Math.abs(segment.endLatitude) <= 90 && Math.abs(segment.startLongitude) <= 180 && Math.abs(segment.endLongitude) <= 180);
    return Object.freeze({ routeId, eventId, version, stops: Object.freeze(stops), segments: Object.freeze(segments) });
  });
}
