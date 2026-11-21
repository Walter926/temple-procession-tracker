import { CircleF, GoogleMap, PolylineF, useJsApiLoader, type Libraries } from '@react-google-maps/api';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { decodePolyline, validPoint, type Point } from '../lib/polyline';
import type { GroupRecord, RouteRecord, StopPointRecord } from '../types/domain';
import MapMarker from './MapMarker';

export type MapLiveLocation = { latitude: number; longitude: number; recordedAt: number; accuracyMeters?: number };
export type MapActiveCollision = { stopPointId: string; affectedGroupIds: string[]; severity: string };
interface Props {
  route?: RouteRecord; routes?: RouteRecord[]; stops?: StopPointRecord[]; groups?: GroupRecord[];
  live?: Record<string, MapLiveLocation>; collisions?: MapActiveCollision[]; historyPath?: Point[];
  editPath?: Point[]; editColor?: string; selectedPoint?: Point; onPointMove?: (index: number, point: Point) => void;
  onMapClick?: (point: Point) => void; onGroupClick?: (id: string) => void;
}
const fallback = { lat: 49.2827, lng: -123.1207 };
const mapContainerStyle = { width: '100%', height: '100%' };
// Advanced markers require a real Maps map ID. Keep legacy maps working until
// deployment configuration supplies one; do not silently use a demo map in production.
const mapId = import.meta.env.VITE_GOOGLE_MAPS_MAP_ID || undefined;
const advanced = !!mapId;
const libraries: Libraries = advanced ? ['marker'] : [];
const mapOptions: google.maps.MapOptions = { mapId, streetViewControl: false, mapTypeControl: false, fullscreenControl: true, gestureHandling: 'cooperative' };
const staleLocation = (point: MapLiveLocation, now: number) => !point.recordedAt || now - point.recordedAt > 45000 || point.recordedAt > now + 5000;
const decoded = (encoded: string) => { try { return decodePolyline(encoded); } catch { return []; } };

const RouteLayers = memo(function RouteLayers({ paths }: { paths: { id: string; color: string; path: Point[] }[] }) {
  return <>{paths.map(r => r.path.length >= 2 && <PolylineF key={r.id} path={r.path} options={{ strokeColor: r.color || '#475569', strokeWeight: 5 }} />)}</>;
});
const StopLayers = memo(function StopLayers({ stops, crowded }: { stops: StopPointRecord[]; crowded: Set<string> }) {
  const valid = stops.filter(s => validPoint({ lat: s.latitude, lng: s.longitude }));
  return <>{valid.map(s => <MapMarker advanced={advanced} key={s.id} position={{ lat: s.latitude, lng: s.longitude }} title={`${s.order}. ${s.name}${crowded.has(s.id) ? ' · Crowded' : ''}`} />)}
    {valid.filter(s => crowded.has(s.id)).map(s => <CircleF key={s.id} center={{ lat: s.latitude, lng: s.longitude }} radius={s.geofenceRadiusMeters} options={{ fillColor: '#be123c', fillOpacity: .14, strokeColor: '#be123c', strokeWeight: 2 }} />)}</>;
});
const GroupMarker = memo(function GroupMarker({ group, point, stale, crowded, onGroupClick }: { group: GroupRecord; point: MapLiveLocation; stale: boolean; crowded: boolean; onGroupClick?: (id: string) => void }) {
  return <MapMarker advanced={advanced} position={{ lat: point.latitude, lng: point.longitude }} title={`${group.name} · ${group.status}${stale ? ' · GPS stale' : ''}`} onClick={() => onGroupClick?.(group.id)}
    circle scale={crowded ? 13 : 10} color={crowded ? '#be123c' : stale ? '#64748b' : group.color || '#2563eb'} opacity={stale ? .55 : 1} />;
});

export default memo(function MapCanvas({ route, routes, stops = [], groups = [], live = {}, collisions = [], historyPath = [], editPath, editColor, selectedPoint, onPointMove, onMapClick, onGroupClick }: Props) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY ?? '';
  const { isLoaded, loadError } = useJsApiLoader({ id: 'temple-maps-script', googleMapsApiKey: apiKey, libraries });
  const mapRef = useRef<google.maps.Map | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [ownPosition, setOwnPosition] = useState<Point>();
  const [locationError, setLocationError] = useState('');
  const [locating, setLocating] = useState(false);
  useEffect(() => { const timer = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(timer); }, []);
  const routePaths = useMemo(() => (routes ?? (route ? [route] : [])).map(r => ({ id: r.id, color: r.color, path: decoded(r.encodedPolyline) })), [route, routes]);
  const path = editPath ?? routePaths[0]?.path ?? [];
  const livePositions = groups.filter(g => validPoint({ lat: live[g.id]?.latitude, lng: live[g.id]?.longitude }));
  // Stable initial camera: incoming GPS must never override a user's pan or zoom.
  const [center] = useState<Point>(() => selectedPoint ?? path[0] ?? (stops[0] ? { lat: stops[0].latitude, lng: stops[0].longitude } : fallback));
  const crowdedStops = useMemo(() => new Set(collisions.map(a => a.stopPointId)), [collisions]);
  const crowdedGroups = useMemo(() => new Set(collisions.flatMap(a => a.affectedGroupIds ?? [])), [collisions]);

  function fit(map = mapRef.current) {
    if (!map) return;
    const points = [...routePaths.flatMap(r => r.path), ...path, ...historyPath, ...stops.map(s => ({ lat: s.latitude, lng: s.longitude })), ...livePositions.map(g => ({ lat: live[g.id].latitude, lng: live[g.id].longitude })), ...(selectedPoint ? [selectedPoint] : [])].filter(validPoint);
    if (!points.length) return;
    if (points.length === 1) { map.panTo(points[0]); map.setZoom(16); return; }
    const bounds = new google.maps.LatLngBounds();
    points.forEach(p => bounds.extend(p));
    map.fitBounds(bounds, 48);
  }
  function locate() {
    setLocationError('');
    if (!navigator.geolocation) { setLocationError('This browser does not support location.'); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(position => {
      const point = { lat: position.coords.latitude, lng: position.coords.longitude };
      setOwnPosition(point); setLocating(false); mapRef.current?.panTo(point); mapRef.current?.setZoom(16);
    }, reason => { setLocationError(reason.message); setLocating(false); }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 15000 });
  }
  if (!apiKey) return <p role="alert" className="error">The map is unavailable because a browser Maps key has not been configured.</p>;
  if (loadError) return <p role="alert" className="error">Could not load Google Maps: {loadError.message}</p>;
  if (!isLoaded) return <p role="status">Loading map…</p>;
  return <div>
    <div className="actions map-tools"><button type="button" onClick={() => fit()}>Fit route and groups</button><button type="button" disabled={locating} onClick={locate}>{locating ? 'Locating…' : 'You · Recenter'}</button><span className="subtle">Your position stays in this browser.</span></div>
    {locationError && <p className="error" role="alert">{locationError}</p>}
    <div className="map"><GoogleMap mapContainerStyle={mapContainerStyle} center={center} zoom={13}
      options={mapOptions}
      onLoad={map => { mapRef.current = map; fit(map); }} onUnmount={() => { mapRef.current = null; }}
      onClick={e => { if (e.latLng) onMapClick?.({ lat: e.latLng.lat(), lng: e.latLng.lng() }); }}>
      {editPath === undefined && <RouteLayers paths={routePaths} />}
      {editPath && editPath.length >= 2 && <PolylineF path={editPath} options={{ strokeColor: editColor || route?.color || '#475569', strokeWeight: 5 }} />}
      {editPath?.map((p, index) => <MapMarker advanced={advanced} key={index} position={p} label={String(index + 1)} title={`Route point ${index + 1}; drag to edit`} draggable={!!onPointMove} onMove={point => onPointMove?.(index, point)} />)}
      {historyPath.length >= 2 && <PolylineF path={historyPath} options={{ strokeColor: '#087f72', strokeWeight: 4 }} />}
      <StopLayers stops={stops} crowded={crowdedStops} />
      {selectedPoint && validPoint(selectedPoint) && <MapMarker advanced={advanced} position={selectedPoint} title="Selected stop location" label="S" />}
      {ownPosition && <MapMarker advanced={advanced} position={ownPosition} title="You (not uploaded)" label="You" circle scale={17} color="#1d4ed8" />}
      {livePositions.map(g => <GroupMarker key={g.id} group={g} point={live[g.id]} stale={staleLocation(live[g.id], now)} crowded={crowdedGroups.has(g.id)} onGroupClick={onGroupClick} />)}
    </GoogleMap></div>
  </div>;
});
