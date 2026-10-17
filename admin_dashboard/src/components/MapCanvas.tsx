import { GoogleMap, MarkerF, PolylineF, useJsApiLoader } from '@react-google-maps/api';
import { useMemo } from 'react';
import { decodePolyline, type Point } from '../lib/polyline';
import type { RouteRecord, StopPointRecord } from '../types/domain';

interface Props { route?: RouteRecord; stops?: StopPointRecord[]; onMapClick?: (point: Point) => void }
const vancouver = { lat: 49.2827, lng: -123.1207 };

export default function MapCanvas({ route, stops = [], onMapClick }: Props) {
  const apiKey = import.meta.env.VITE_GOOGLE_MAPS_BROWSER_KEY ?? '';
  const { isLoaded, loadError } = useJsApiLoader({ id: 'temple-maps-script', googleMapsApiKey: apiKey });

  const path = useMemo(() => {
    try { return decodePolyline(route?.encodedPolyline ?? ''); }
    catch { return []; }
  }, [route?.encodedPolyline]);

  const center = stops.length ? { lat: stops[0].latitude, lng: stops[0].longitude } : path[0] ?? vancouver;

  if (!apiKey) return <p className="error">Set VITE_GOOGLE_MAPS_BROWSER_KEY in .env.local.</p>;
  if (loadError) return <p className="error">Could not load Google Maps: {loadError.message}</p>;
  if (!isLoaded) return <p>Loading Google Maps...</p>;

  return (
    <div className="map">
      <GoogleMap mapContainerStyle={{ width: '100%', height: '100%' }} center={center} zoom={12} onClick={(event) => { if (event.latLng) onMapClick?.({ lat: event.latLng.lat(), lng: event.latLng.lng() }); }}>
        {path.length >= 2 && <PolylineF path={path} options={{ strokeColor: route?.color || '#a33b3b', strokeWeight: 5 }} />}
        {stops.map((stop) => <MarkerF key={stop.id} position={{ lat: stop.latitude, lng: stop.longitude }} title={`${stop.order}. ${stop.name}`} />)}
      </GoogleMap>
    </div>
  );
}