/** Haversine metres; inputs are degrees. Pure function, no Firebase dependency. */
export function distanceMeters(lat1: number, lon1: number, lat2: number, lon2: number): number {
  if (![lat1, lon1, lat2, lon2].every(Number.isFinite) || Math.abs(lat1) > 90 || Math.abs(lat2) > 90 || Math.abs(lon1) > 180 || Math.abs(lon2) > 180) throw Error('Invalid geographic coordinates.');
  const rad = Math.PI / 180, r = 6371008.8;
  const dLat = (lat2 - lat1) * rad, dLon = (lon2 - lon1) * rad;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * rad) * Math.cos(lat2 * rad) * Math.sin(dLon / 2) ** 2;
  return r * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

export function insideGeofence(distance: number, radius: number, accuracy: number): boolean {
  return Number.isFinite(distance) && Number.isFinite(radius) && Number.isFinite(accuracy) && radius >= 10 && accuracy >= 0 && accuracy <= radius && distance <= radius;
}