import { useState, type FormEvent } from 'react';
import { saveResource, errorMessage } from '../lib/management';
import { stopFieldErrors, type FieldErrors } from '../lib/validation';
import { createSingleFlight } from '../lib/management_requests';
import { dateTimeLocal, parseLocalDateTime } from '../lib/event_dates';
import { decodePolyline } from '../lib/polyline';
import type { RouteRecord, StopPointRecord, StopPointType } from '../types/domain';
import MapCanvas from '../components/MapCanvas';
import FieldError from '../components/FieldError';

const types: StopPointType[] = ['temple', 'ritual', 'rest', 'checkpoint', 'food', 'medical', 'roadControl', 'other'];

interface Props { route: RouteRecord; existingStops: StopPointRecord[]; initial?: StopPointRecord; onSaved: (id: string) => void; onCancel: () => void }
export default function StopForm({ route, existingStops, initial, onSaved, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [type, setType] = useState<StopPointType>(initial?.type ?? 'temple');
  const firstPoint = (() => { try { return decodePolyline(route.encodedPolyline)[0]; } catch { return undefined; } })();
  const [latitude, setLatitude] = useState(String(initial?.latitude ?? firstPoint?.lat ?? ''));
  const [longitude, setLongitude] = useState(String(initial?.longitude ?? firstPoint?.lng ?? ''));
  const [arrival, setArrival] = useState(dateTimeLocal(initial?.expectedArrivalTime));
  const [departure, setDeparture] = useState(dateTimeLocal(initial?.expectedDepartureTime));
  const [geofence, setGeofence] = useState(String(initial?.geofenceRadiusMeters ?? 100));
  const [maxGroups, setMaxGroups] = useState(String(initial?.maxAllowedGroups ?? 1));
  const [order, setOrder] = useState(String(initial?.order ?? Math.max(0, ...existingStops.map((s) => s.order)) + 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const [flight] = useState(createSingleFlight);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation();
    const validation = stopFieldErrors({ name, description, latitude, longitude, order, radius: geofence, maxGroups, arrival, departure }, existingStops.filter(s => s.id !== initial?.id).map(s => s.order));
    setErrors(validation);
    if (Object.keys(validation).length || !flight.start()) return;
    const lat = Number(latitude), lng = Number(longitude), radius = Number(geofence), max = Number(maxGroups), index = Number(order);
    const duration = arrival && departure ? Math.round((parseLocalDateTime(departure) - parseLocalDateTime(arrival)) / 60000) : initial?.plannedStopMinutes ?? 0;
    setBusy(true);
    setError('');
    try {
      const payload = { routeId: route.id, name: name.trim(), description: description.trim(), type, latitude: lat, longitude: lng, order: index,
        expectedArrivalTimeMs: arrival ? parseLocalDateTime(arrival) : null,
        expectedDepartureTimeMs: departure ? parseLocalDateTime(departure) : null,
        plannedStopMinutes: duration, geofenceRadiusMeters: radius, maxAllowedGroups: max };
      onSaved(await saveResource('stop', route.eventId, payload, initial?.id));
    } catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }

  return <section className="panel"><h2>{initial ? 'Edit Stop Point' : 'New Stop Point'}</h2>
    <p>Click the map to fill in latitude and longitude.</p>
    <MapCanvas route={route} stops={existingStops} selectedPoint={latitude && longitude ? { lat: Number(latitude), lng: Number(longitude) } : undefined} onMapClick={busy ? undefined : (point) => { setLatitude(point.lat.toFixed(6)); setLongitude(point.lng.toFixed(6)); }} />
    <form noValidate onSubmit={save}><fieldset disabled={busy}><div className="form-grid">
      <label>Name *<input name="stopName" required maxLength={120} aria-invalid={!!errors.stopName} aria-describedby="stopName-error" value={name} onChange={(e) => setName(e.target.value)} /><FieldError name="stopName" errors={errors} /></label>
      <label>Type<select value={type} onChange={(e) => setType(e.target.value as StopPointType)}>{types.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="span-2">Description<textarea name="stopDescription" maxLength={4000} value={description} onChange={(e) => setDescription(e.target.value)} /><FieldError name="stopDescription" errors={errors} /></label>
      <label>Latitude<input name="stopLatitude" aria-invalid={!!errors.stopLatitude} aria-describedby="stopLatitude-error" type="number" step="any" required value={latitude} onChange={(e) => setLatitude(e.target.value)} /><FieldError name="stopLatitude" errors={errors} /></label>
      <label>Longitude<input name="stopLongitude" aria-invalid={!!errors.stopLongitude} aria-describedby="stopLongitude-error" type="number" step="any" required value={longitude} onChange={(e) => setLongitude(e.target.value)} /><FieldError name="stopLongitude" errors={errors} /></label>
      <label>Expected arrival<input name="stopArrival" type="datetime-local" value={arrival} onChange={(e) => setArrival(e.target.value)} /><FieldError name="stopArrival" errors={errors} /></label>
      <label>Expected departure<input name="stopDeparture" type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} /><FieldError name="stopDeparture" errors={errors} /></label>
      <label>Geofence radius (m)<input name="stopRadius" type="number" required min="5" max="1000" step="1" value={geofence} onChange={(e) => setGeofence(e.target.value)} /><FieldError name="stopRadius" errors={errors} /></label>
      <label>Maximum allowed groups<input name="stopCapacity" type="number" required min="1" max="100" step="1" value={maxGroups} onChange={(e) => setMaxGroups(e.target.value)} /><FieldError name="stopCapacity" errors={errors} /></label>
      <label>Display order<input name="stopOrder" type="number" min="1" max="10000" step="1" value={order} onChange={(e) => setOrder(e.target.value)} /><FieldError name="stopOrder" errors={errors} /></label>
    </div></fieldset>{error && <p className="error" role="alert">{error}</p>}
    <div className="actions"><button disabled={busy} type="submit">{busy ? 'Saving...' : 'Save Stop Point'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form></section>;
}
