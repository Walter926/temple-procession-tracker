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
    points.push({ lat: latitude / 100000, lng: longitude / 100000 });
  }
  return points;
}