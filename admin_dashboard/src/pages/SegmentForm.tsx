import { useState, type FormEvent } from 'react';
import { arrayUnion, collection, doc, writeBatch } from 'firebase/firestore';
import { db } from '../lib/firebase';

interface Props { routeId: string; nextOrder: number }
export default function SegmentForm({ routeId, nextOrder }: Props) {
  const [startLat, setStartLat] = useState('49.2827');
  const [startLng, setStartLng] = useState('-123.1207');
  const [endLat, setEndLat] = useState('49.2837');
  const [endLng, setEndLng] = useState('-123.1197');
  const [distance, setDistance] = useState('0');
  const [instruction, setInstruction] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const a = Number(startLat), b = Number(startLng), c = Number(endLat), d = Number(endLng), meters = Number(distance);
    if (![a, b, c, d, meters].every(Number.isFinite) || Math.abs(a) > 90 || Math.abs(c) > 90 || Math.abs(b) > 180 || Math.abs(d) > 180 || meters < 0) { setError('Invalid coordinates or distance.'); return; }
    try {
      const segmentRef = doc(collection(db, 'routeSegments'));
      const batch = writeBatch(db);
      batch.set(segmentRef, { routeId, order: nextOrder, startLatitude: a, startLongitude: b, endLatitude: c, endLongitude: d, distanceMeters: meters, instruction: instruction.trim() });
      batch.update(doc(db, 'routes', routeId), { segmentIds: arrayUnion(segmentRef.id) });
      await batch.commit();
      setError('');
      setInstruction('');
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Unable to create segment.'); }
  }

  return <form onSubmit={submit}><h4>Add Segment #{nextOrder}</h4><div className="form-grid">
    <label>Start latitude<input type="number" step="any" value={startLat} onChange={(e) => setStartLat(e.target.value)} /></label>
    <label>Start longitude<input type="number" step="any" value={startLng} onChange={(e) => setStartLng(e.target.value)} /></label>
    <label>End latitude<input type="number" step="any" value={endLat} onChange={(e) => setEndLat(e.target.value)} /></label>
    <label>End longitude<input type="number" step="any" value={endLng} onChange={(e) => setEndLng(e.target.value)} /></label>
    <label>Distance (meters)<input type="number" min="0" step="0.1" value={distance} onChange={(e) => setDistance(e.target.value)} /></label>
    <label>Instruction<input value={instruction} onChange={(e) => setInstruction(e.target.value)} /></label>
  </div><div className="actions"><button type="submit">Add Segment</button></div>{error && <p className="error">{error}</p>}</form>;
}