import { useState, type FormEvent } from 'react';
import { saveResource, errorMessage } from '../lib/management';
import { createSingleFlight } from '../lib/management_requests';
import { distanceMeters } from '../lib/polyline';
import FieldError from '../components/FieldError';
import type { FieldErrors } from '../lib/validation';

interface Props { eventId: string; routeId: string; nextOrder: number }
export default function SegmentForm({ eventId, routeId, nextOrder }: Props) {
  const [startLat, setStartLat] = useState('');
  const [startLng, setStartLng] = useState('');
  const [endLat, setEndLat] = useState('');
  const [endLng, setEndLng] = useState('');
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [savedOrder, setSavedOrder] = useState<number>();
  const [flight] = useState(createSingleFlight);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); event.stopPropagation();
    if (savedOrder === nextOrder) return;
    const validation: FieldErrors = {};
    for (const [field, value, limit] of [['segmentStartLat', startLat, 90], ['segmentStartLng', startLng, 180], ['segmentEndLat', endLat, 90], ['segmentEndLng', endLng, 180]] as const) {
      if (!value.trim() || !Number.isFinite(Number(value)) || Math.abs(Number(value)) > limit) validation[field] = `Enter a coordinate between -${limit} and ${limit}.`;
    }
    setErrors(validation);
    if (Object.keys(validation).length) return;
    const a = Number(startLat), b = Number(startLng), c = Number(endLat), d = Number(endLng), meters = Math.round(distanceMeters({ lat: a, lng: b }, { lat: c, lng: d }));
    if (![startLat, startLng, endLat, endLng].every(Boolean) || ![a, b, c, d, meters].every(Number.isFinite) || Math.abs(a) > 90 || Math.abs(c) > 90 || Math.abs(b) > 180 || Math.abs(d) > 180 || meters <= 0) { setError('Enter valid, distinct segment endpoints.'); return; }
    if (!flight.start()) return;
    setBusy(true);
    try {
      await saveResource('segment', eventId, { routeId, order: nextOrder, startLatitude: a, startLongitude: b, endLatitude: c, endLongitude: d, distanceMeters: meters, instruction: instruction.trim() });
      setError('');
      setInstruction('');
      setSavedOrder(nextOrder);
    } catch (reason) { setError(errorMessage(reason)); }
    finally { flight.finish(); setBusy(false); }
  }

  return <form noValidate onSubmit={submit}><h4>Add Segment #{nextOrder}</h4><fieldset disabled={busy}><div className="form-grid">
    <label>Start latitude<input name="segmentStartLat" required min="-90" max="90" type="number" step="any" value={startLat} onChange={(e) => setStartLat(e.target.value)} /><FieldError name="segmentStartLat" errors={errors} /></label>
    <label>Start longitude<input name="segmentStartLng" required min="-180" max="180" type="number" step="any" value={startLng} onChange={(e) => setStartLng(e.target.value)} /><FieldError name="segmentStartLng" errors={errors} /></label>
    <label>End latitude<input name="segmentEndLat" required min="-90" max="90" type="number" step="any" value={endLat} onChange={(e) => setEndLat(e.target.value)} /><FieldError name="segmentEndLat" errors={errors} /></label>
    <label>End longitude<input name="segmentEndLng" required min="-180" max="180" type="number" step="any" value={endLng} onChange={(e) => setEndLng(e.target.value)} /><FieldError name="segmentEndLng" errors={errors} /></label>
    <p>Segment distance is calculated from its endpoints.</p>
    <label>Instruction<input maxLength={4000} value={instruction} onChange={(e) => setInstruction(e.target.value)} /></label>
  </div></fieldset><div className="actions"><button disabled={busy || savedOrder === nextOrder} type="submit">{busy ? 'Saving…' : 'Add segment'}</button></div>{savedOrder !== undefined && <p role="status">Segment #{savedOrder} saved.{savedOrder === nextOrder ? ' Waiting for the updated segment list…' : ''}</p>}{error && <p className="error" role="alert">{error}</p>}</form>;
}
