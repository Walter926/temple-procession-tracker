import { useState, type FormEvent } from 'react';
import { arrayUnion, collection, doc, Timestamp, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';
import { patchRecord } from '../lib/records';
import type { RouteRecord, StopPointRecord, StopPointType } from '../types/domain';
import MapCanvas from '../components/MapCanvas';

const types: StopPointType[] = ['temple', 'ritual', 'rest', 'checkpoint', 'food', 'medical', 'roadControl', 'other'];
const localTime = (time: Timestamp | null | undefined) => {
  if (!time) return '';
  const d = time.toDate();
  return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

interface Props { route: RouteRecord; existingStops: StopPointRecord[]; initial?: StopPointRecord; onSaved: (id: string) => void; onCancel: () => void }
export default function StopForm({ route, existingStops, initial, onSaved, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [type, setType] = useState<StopPointType>(initial?.type ?? 'temple');
  const [latitude, setLatitude] = useState(String(initial?.latitude ?? 49.2827));
  const [longitude, setLongitude] = useState(String(initial?.longitude ?? -123.1207));
  const [arrival, setArrival] = useState(localTime(initial?.expectedArrivalTime));
  const [departure, setDeparture] = useState(localTime(initial?.expectedDepartureTime));
  const [geofence, setGeofence] = useState(String(initial?.geofenceRadiusMeters ?? 100));
  const [maxGroups, setMaxGroups] = useState(String(initial?.maxAllowedGroups ?? 1));
  const [order, setOrder] = useState(String(initial?.order ?? Math.max(0, ...existingStops.map((s) => s.order)) + 1));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const lat = Number(latitude), lng = Number(longitude), radius = Number(geofence), max = Number(maxGroups), index = Number(order);
    if (!name.trim() || !Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180 || !Number.isInteger(index) || index < 1 || !Number.isFinite(radius) || radius <= 0 || !Number.isInteger(max) || max < 1) { setError('Invalid stop name, coordinates, order, radius or group limit.'); return; }
    if (departure && arrival && new Date(departure).getTime() < new Date(arrival).getTime()) { setError('Departure must be after arrival.'); return; }
    if (existingStops.some((s) => s.order === index && s.id !== initial?.id)) { setError('Stop order must be unique within this route.'); return; }
    const duration = arrival && departure ? Math.round((new Date(departure).getTime() - new Date(arrival).getTime()) / 60000) : initial?.plannedStopMinutes ?? 0;
    setBusy(true);
    setError('');
    try {
      const payload = { routeId: route.id, name: name.trim(), description: description.trim(), type, latitude: lat, longitude: lng, order: index,
        expectedArrivalTime: arrival ? Timestamp.fromDate(new Date(arrival)) : null,
        expectedDepartureTime: departure ? Timestamp.fromDate(new Date(departure)) : null,
        plannedStopMinutes: duration, geofenceRadiusMeters: radius, maxAllowedGroups: max };
      if (initial) { await patchRecord('stopPoints', initial.id, payload); onSaved(initial.id); }
      else {
        const ref = doc(collection(db, 'stopPoints'));
        const batch = writeBatch(db);
        batch.set(ref, payload);
        batch.update(doc(db, 'routes', route.id), { stopPointIds: arrayUnion(ref.id) });
        await batch.commit();
        onSaved(ref.id);
      }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save stop.'); }
    finally { setBusy(false); }
  }

  return <form className="panel" onSubmit={save}><h2>{initial ? 'Edit Stop Point' : 'New Stop Point'}</h2>
    <p>Click the map to fill in latitude and longitude.</p>
    <MapCanvas route={route} stops={existingStops} onMapClick={(point) => { setLatitude(point.lat.toFixed(6)); setLongitude(point.lng.toFixed(6)); }} />
    <div className="form-grid">
      <label>Name *<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Type<select value={type} onChange={(e) => setType(e.target.value as StopPointType)}>{types.map((item) => <option key={item} value={item}>{item}</option>)}</select></label>
      <label className="span-2">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
      <label>Latitude<input type="number" step="any" required value={latitude} onChange={(e) => setLatitude(e.target.value)} /></label>
      <label>Longitude<input type="number" step="any" required value={longitude} onChange={(e) => setLongitude(e.target.value)} /></label>
      <label>Expected arrival<input type="datetime-local" value={arrival} onChange={(e) => setArrival(e.target.value)} /></label>
      <label>Expected departure<input type="datetime-local" value={departure} onChange={(e) => setDeparture(e.target.value)} /></label>
      <label>Geofence radius (m)<input type="number" min="1" step="1" value={geofence} onChange={(e) => setGeofence(e.target.value)} /></label>
      <label>Maximum allowed groups<input type="number" min="1" step="1" value={maxGroups} onChange={(e) => setMaxGroups(e.target.value)} /></label>
      <label>Display order<input type="number" min="1" step="1" value={order} onChange={(e) => setOrder(e.target.value)} /></label>
    </div>{error && <p className="error" role="alert">{error}</p>}
    <div className="actions"><button disabled={busy} type="submit">{busy ? 'Saving...' : 'Save Stop Point'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}