import { useState, type FormEvent } from 'react';
import { Timestamp } from 'firebase/firestore';
import { createRecord, patchRecord } from '../lib/records';
import type { RouteRecord } from '../types/domain';

interface Props { eventId: string; initial?: RouteRecord; onSaved: (id: string) => void; onCancel: () => void }
export default function RouteForm({ eventId, initial, onSaved, onCancel }: Props) {
  const [name, setName] = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [color, setColor] = useState(initial?.color ?? '#a33b3b');
  const [encodedPolyline, setEncodedPolyline] = useState(initial?.encodedPolyline ?? '');
  const [distance, setDistance] = useState(String(initial?.totalDistanceMeters ?? 0));
  const [duration, setDuration] = useState(String(initial?.estimatedDurationMinutes ?? 0));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const meters = Number(distance);
    const minutes = Number(duration);
    if (!name.trim() || !Number.isFinite(meters) || meters < 0 || !Number.isFinite(minutes) || minutes < 0) { setError('Enter a name, nonnegative distance and duration.'); return; }
    setBusy(true);
    setError('');
    try {
      const now = Timestamp.now();
      const value = { name: name.trim(), description: description.trim(), color, encodedPolyline: encodedPolyline.trim(), totalDistanceMeters: meters, estimatedDurationMinutes: minutes, updatedAt: now };
      if (initial) { await patchRecord('routes', initial.id, value); onSaved(initial.id); }
      else { const id = await createRecord('routes', { ...value, eventId, segmentIds: [], stopPointIds: [], createdAt: now }); onSaved(id); }
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to save route.'); }
    finally { setBusy(false); }
  }

  return <form className="panel" onSubmit={save}><h2>{initial ? 'Edit Route' : 'Create Route'}</h2><div className="form-grid">
    <label>Route name *<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
    <label>Route color<input type="color" value={color} onChange={(e) => setColor(e.target.value)} /></label>
    <label className="span-2">Description<textarea value={description} onChange={(e) => setDescription(e.target.value)} /></label>
    <label className="span-2">Encoded polyline<textarea placeholder="Google encoded polyline (optional until route geometry exists)" value={encodedPolyline} onChange={(e) => setEncodedPolyline(e.target.value)} /></label>
    <label>Distance in meters<input type="number" min="0" step="0.1" required value={distance} onChange={(e) => setDistance(e.target.value)} /></label>
    <label>Estimated duration in minutes<input type="number" min="0" step="1" required value={duration} onChange={(e) => setDuration(e.target.value)} /></label>
  </div>{error && <p className="error" role="alert">{error}</p>}
    <div className="actions"><button disabled={busy} type="submit">{busy ? 'Saving...' : 'Save Route'}</button><button type="button" onClick={onCancel}>Cancel</button></div>
  </form>;
}