import { distanceMeters, insideGeofence } from './geo_math';

export type CollisionGroup = { id: string; routeId: string; latitude: number; longitude: number; accuracy: number; recordedAt: number };
export type CollisionStop = { id: string; routeId: string; latitude: number; longitude: number; radiusMeters: number; maxAllowedGroups: number };
export type CollisionResult = { stopPointId: string; groupIds: string[]; count: number; maximum: number; severity: 'low' | 'medium' | 'high' };

/** Pure evaluation: a fresh, accurate GPS fix is required; one group counts at most once per stop. */
export function findCollisions(groups: CollisionGroup[], stops: CollisionStop[], now: number): CollisionResult[] {
  const fresh = groups.filter(g => Number.isFinite(g.recordedAt) && g.recordedAt <= now + 5000 && now - g.recordedAt <= 90000 && Number.isFinite(g.latitude) && Number.isFinite(g.longitude));
  return stops.flatMap(stop => {
    if (!Number.isFinite(stop.maxAllowedGroups) || stop.maxAllowedGroups < 1 || !Number.isFinite(stop.radiusMeters)) return [];
    const inside = fresh.filter(g => g.routeId === stop.routeId && insideGeofence(distanceMeters(g.latitude, g.longitude, stop.latitude, stop.longitude), stop.radiusMeters, g.accuracy)).map(g => g.id).sort();
    const count = inside.length, over = count - stop.maxAllowedGroups;
    if (over <= 0) return [];
    return [{ stopPointId: stop.id, groupIds: inside, count, maximum: stop.maxAllowedGroups, severity: over >= 3 ? 'high' as const : over === 2 ? 'medium' as const : 'low' as const }];
  });
}