export interface Point { lat: number; lng: number }

export function decodePolyline(encoded: string): Point[] {
  const points: Point[] = [];
  let index = 0;
  let latitude = 0;
  let longitude = 0;
  while (index < encoded.length) {
    const readDelta = () => {
      let shift = 0;
      let result = 0;
      let chunk: number;
      do {
        if (index >= encoded.length) throw new Error('Invalid encoded polyline.');
        chunk = encoded.charCodeAt(index++) - 63;
        if (chunk < 0 || chunk > 63) throw new Error('Invalid encoded polyline character.');
        result |= (chunk & 31) << shift;
        shift += 5;
        if (shift > 30) throw new Error('Invalid encoded polyline length.');
      } while (chunk >= 32);
      return result & 1 ? ~(result >> 1) : result >> 1;
    };
    latitude += readDelta();
    longitude += readDelta();
    const point = { lat: latitude / 100000, lng: longitude / 100000 };
    if (!validPoint(point)) throw new Error('Polyline coordinates are outside the world bounds.');
    points.push(point);
  }
  return points;
}

export const validPoint = (point: Point) => Number.isFinite(point.lat) && Number.isFinite(point.lng) && Math.abs(point.lat) <= 90 && Math.abs(point.lng) <= 180;

export function encodePolyline(points: Point[]): string {
  let latitude = 0, longitude = 0;
  const encode = (delta: number) => {
    let value = delta < 0 ? ~(delta << 1) : delta << 1, result = '';
    while (value >= 32) { result += String.fromCharCode((32 | (value & 31)) + 63); value >>>= 5; }
    return result + String.fromCharCode(value + 63);
  };
  return points.map(point => {
    if (!validPoint(point)) throw new Error('Invalid route coordinates.');
    const lat = Math.round(point.lat * 100000), lng = Math.round(point.lng * 100000);
    const encoded = encode(lat - latitude) + encode(lng - longitude);
    latitude = lat; longitude = lng;
    return encoded;
  }).join('');
}

export function distanceMeters(a: Point, b: Point): number {
  const radians = (value: number) => value * Math.PI / 180;
  const h = Math.sin(radians(b.lat - a.lat) / 2) ** 2 + Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(radians(b.lng - a.lng) / 2) ** 2;
  return 6371000 * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(Math.max(0, 1 - h)));
}

export function pathDistanceMeters(points: Point[]): number {
  return Math.round(points.slice(1).reduce((total, point, index) => total + distanceMeters(points[index], point), 0));
}
