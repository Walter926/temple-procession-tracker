
import { CircleF, GoogleMap, MarkerF, PolylineF, useJsApiLoader } from '@react-google-maps/api';
import { useEffect, useMemo, useState } from 'react';
import { decodePolyline, type Point } from '../lib/polyline';
import type { GroupRecord, RouteRecord, StopPointRecord } from '../types/domain';

export type MapLiveLocation = { latitude: number; longitude: number; recordedAt: number; accuracyMeters?: number };
export type MapActiveCollision = { stopPointId: string; affectedGroupIds: string[]; severity: string };
interface Props { route?: RouteRecord; stops?: StopPointRecord[]; groups?: GroupRecord[]; live?: Record<string, MapLiveLocation>; collisions?: MapActiveCollision[]; historyPath?: Point[]; onMapClick?: (point: Point) => void; onGroupClick?: (id: string) => void }

const vancouver = { lat: 49.2827, lng: -123.1207 };

export default function MapCanvas({ route, stops = [], groups = [], live = {}, collisions = [], historyPath = [], onMapClick, onGroupClick }: Props) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY ?? '';
  const { isLoaded, loadError } = useJsApiLoader({ id: 'temple-maps-script', googleMapsApiKey: apiKey });
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const path = useMemo(() => { try { return decodePolyline(route?.encodedPolyline ?? ''); } catch { return []; } }, [route?.encodedPolyline]);
  const livePositions = groups.filter(g => Number.isFinite(live[g.id]?.latitude) && Number.isFinite(live[g.id]?.longitude));
  const center = livePositions.length ? { lat: live[livePositions[0].id].latitude, lng: live[livePositions[0].id].longitude } : stops.length ? { lat: stops[0].latitude, lng: stops[0].longitude } : path[0] ?? vancouver;
  const crowdedStops = new Set(collisions.map(a => a.stopPointId));
  const crowdedGroups = new Set(collisions.flatMap(a => a.affectedGroupIds));

  if (!apiKey) return <p className="error">Set VITE_GOOGLE_MAPS_BROWSER_KEY in .env.local.</p>;
  if (loadError) return <p className="error">Could not load Google Maps: {loadError.message}</p>;
  if (!isLoaded) return <p>Loading Google Maps...</p>;

  return <div className="map"><GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={center} zoom={13} onClick={e => { if (e.latLng) onMapClick?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }); }}>
    {path.length >= 2 && <PolylineF path={path} options={{ strokeColor: route?.color || '#a33b3b', strokeWeight: 5 }} />}
    {historyPath.length >= 2 && <PolylineF path={historyPath} options={{ strokeColor: '#138a73', strokeWeight: 4 }} />}
    {stops.map(stop => <MarkerF key={stop.id} position={{ lat: stop.latitude, lng: stop.longitude }} title={`${stop.order}. ${stop.name}${crowdedStops.has(stop.id) ? ' · CROWDED' : ''}`} icon={crowdedStops.has(stop.id) ? { path: google.maps.SymbolPath.CIRCLE, scale: 10, fillColor: '#e11d48', fillOpacity: 1, strokeColor: 'white', strokeWeight: 2 } : undefined} />)}
    {stops.filter(s => crowdedStops.has(s.id)).map(s => <CircleF key={`collision-${s.id}`} center={{ lat: s.latitude, lng: s.longitude }} radius={s.geofenceRadiusMeters} options={{ fillColor: '#e11d48', fillOpacity: .14, strokeColor: '#e11d48', strokeWeight: 2 }} />)}
    {livePositions.map(g => { const point = live[g.id], stale = now - point.recordedAt > 60000; return <MarkerF key={`group-${g.id}`} position={{ lat: point.latitude, lng: point.longitude }} title={`${g.name} · ${g.status}${stale ? ' · GPS STALE' : ''}`} onClick={() => onGroupClick?.(g.id)} icon={{ path: google.maps.SymbolPath.CIRCLE, scale: crowdedGroups.has(g.id) ? 11 : 8, fillColor: crowdedGroups.has(g.id) ? '#e11d48' : stale ? '#64748b' : g.color || '#2563eb', fillOpacity: stale ? .55 : 1, strokeColor: 'white', strokeWeight: 2 }} />; })}
  </GoogleMap></div>;
}
