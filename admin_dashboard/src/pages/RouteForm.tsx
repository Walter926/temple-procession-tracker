import { useState, type FormEvent } from 'react';
import { errorMessage } from '../lib/management';
import { useResourceWriter } from '../lib/useResourceWriter';
import { createSingleFlight } from '../lib/management_requests';
import { decodePolyline, encodePolyline, pathDistanceMeters, validPoint, type Point } from '../lib/polyline';
import { routeFieldErrors, type FieldErrors } from '../lib/validation';
import type { RouteRecord } from '../types/domain';
import MapCanvas from '../components/MapCanvas';
import FieldError from '../components/FieldError';

interface Props { eventId: string; initial?: RouteRecord; onSaved: (id: string) => void; onCancel: () => void }
const initialPath = (value: string) => { try { return decodePolyline(value); } catch { return []; } };

export default function RouteForm({ eventId, initial, onSaved, onCancel }: Props) {
  const write = useResourceWriter('route', eventId, initial?.id);
  const [flight] = useState(createSingleFlight);
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [color, setColor] = useState(initial?.color ?? '#475569');
  const [path, setPath] = useState<Point[]>(() => initialPath(initial?.encodedPolyline ?? ''));
  const [undo, setUndo] = useState<Point[][]>([]);
  const [edited, setEdited] = useState(false);
  const [importValue, setImportValue] = useState(initial?.encodedPolyline ?? '');
  const [duration, setDuration] = useState(String(initial?.estimatedDurationMinutes ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [errors, setErrors] = useState<FieldErrors>({});
  const encoded = edited ? encodePolyline(path) : initial?.encodedPolyline ?? encodePolyline(path);
  function change(next: Point[]) {
    if (next.some(p => !validPoint(p))) { setError('Coordinates must be within ±90 latitude and ±180 longitude.'); return; }
    if (next.length > 2000) { setError('A route supports up to 2000 points.'); return; }
    setUndo(history => [...history.slice(-49), path]); setPath(next); setEdited(true); setError('');
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation();
    const validation = routeFieldErrors({ name, description, color, encoded, duration });
    setErrors(validation);
    if (Object.keys(validation).length || !flight.start()) return;
    setBusy(true); setError('');
    try {
      const id = await write({ name: name.trim(), description: description.trim(), color,
        encodedPolyline: encoded, totalDistanceMeters: pathDistanceMeters(decodePolyline(encoded)), estimatedDurationMinutes: Number(duration) });
      onSaved(id);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }
  return <section className="panel"><h2>{initial ? 'Edit route' : 'Create route'}</h2>
    <p>Click the map to add points. Drag numbered markers or edit their coordinates below. Distance follows the drawn path.</p>
    <MapCanvas route={initial ? { ...initial, color } : undefined} editColor={color} editPath={path} onMapClick={busy ? undefined : p => change([...path, p])} onPointMove={busy ? undefined : (i, p) => change(path.map((old, index) => index === i ? p : old))} />
    <FieldError name="routeGeometry" errors={errors} />
    <div className="actions"><button type="button" disabled={busy || !undo.length} onClick={() => { setPath(undo[undo.length - 1]); setUndo(undo.slice(0, -1)); setEdited(true); }}>Undo</button>
      <button type="button" disabled={busy || !path.length} onClick={() => change([])}>Clear points</button><output>{path.length} points · {pathDistanceMeters(path).toLocaleString()} m</output></div>
    <details><summary>Point coordinates and encoded route import</summary>
      <fieldset disabled={busy}>
      <div className="point-list">{path.map((p, index) => <div className="point-row" key={index}>
        <span>{index + 1}</span><label>Latitude<input type="number" min="-90" max="90" step="0.00001" value={p.lat} onChange={e => { if (e.target.value !== '') change(path.map((v, i) => i === index ? { ...v, lat: Number(e.target.value) } : v)); }} /></label>
        <label>Longitude<input type="number" min="-180" max="180" step="0.00001" value={p.lng} onChange={e => { if (e.target.value !== '') change(path.map((v, i) => i === index ? { ...v, lng: Number(e.target.value) } : v)); }} /></label>
        <button type="button" aria-label={`Remove point ${index + 1}`} onClick={() => change(path.filter((_, i) => i !== index))}>Remove</button>
      </div>)}</div>
      <label>Import encoded polyline<textarea value={importValue} onChange={e => setImportValue(e.target.value)} /></label>
      <button type="button" onClick={() => { try { const next = decodePolyline(importValue.trim()); if (next.length < 2) throw Error('Import at least two points.'); change(next); } catch (reason) { setError(errorMessage(reason)); } }}>Import geometry</button>
      <label>Generated encoded polyline<textarea readOnly value={encoded} /></label>
      </fieldset>
    </details>
    <form noValidate onSubmit={save}><fieldset disabled={busy}><div className="form-grid">
      <label>Route name *<input name="routeName" required aria-invalid={!!errors.routeName} aria-describedby="routeName-error" maxLength={120} value={name} onChange={e => setName(e.target.value)} /><FieldError name="routeName" errors={errors} /></label>
      <label>Route color<input name="routeColor" type="color" value={color} onChange={e => setColor(e.target.value)} /><FieldError name="routeColor" errors={errors} /></label>
      <label className="span-2">Description<textarea name="routeDescription" maxLength={4000} value={description} onChange={e => setDescription(e.target.value)} /><FieldError name="routeDescription" errors={errors} /></label>
      <label>Calculated distance (meters)<input readOnly value={pathDistanceMeters(path)} /></label>
      <label>Estimated duration (minutes)<input name="routeDuration" aria-invalid={!!errors.routeDuration} aria-describedby="routeDuration-error" type="number" required min="0" max="10080" value={duration} onChange={e => setDuration(e.target.value)} /><FieldError name="routeDuration" errors={errors} /></label>
    </div></fieldset>{error && <p className="error" role="alert">{error}</p>}
    <div className="actions"><button disabled={busy}>{busy ? 'Saving…' : 'Save route'}</button><button type="button" disabled={busy} onClick={onCancel}>Cancel</button></div>
  </form></section>;
}
